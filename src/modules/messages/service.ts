import "server-only";
import nodemailer from "nodemailer";
import type { MessageAttachment, Prisma } from "@prisma/client";
import { decryptBytes } from "@/core/crypto";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { getSetting } from "@/modules/academics/service";
import { contactAddress } from "@/modules/students/contacts";
import { type Audience, type Recipient, recipientLabel, resolveAudience } from "./audience";

// Outgoing email / WhatsApp. Messages are queued inside the same transaction as the change
// that caused them (so a rolled-back change never notifies anyone), then delivered in the
// background with retries: the laptop may be offline for a while. Only contacts who opted
// in to a channel receive it.

type Tx = Prisma.TransactionClient;

export type NotifyResult = { email: number; whatsapp: number; noConsent: number };

/** Meta template per purpose. Each needs approval in WhatsApp Manager (category Utility, language en). */
export const WA_TEMPLATES = {
  schedule: { name: env.WHATSAPP_TEMPLATE, params: ["contact name", "student(s) and class", "the change"] },
  homework: { name: "homework_update", params: ["contact name", "class / student(s)", "homework", "submit by"] },
  notice: { name: "class_notice", params: ["contact name", "student(s) and class", "notice"] },
  makeup: { name: "class_cancelled_makeup", params: ["contact name", "subject", "student(s) and class", "cancelled class", "make-up class"] },
  reminder: { name: "class_reminder", params: ["contact name", "subject", "class", "start time", "where"] },
  summary: { name: "class_summary", params: ["contact name", "subject", "class", "date", "covered in class", "homework"] },
  /** Broadcast with a picture (template header: Image) */
  noticeImage: { name: "notice_image", params: ["contact name", "student(s)", "message"] },
  /** Broadcast with a PDF / Word / Excel / PowerPoint file (template header: Document) */
  noticeDocument: { name: "notice_document", params: ["contact name", "student(s)", "message"] },
} as const;
export type Purpose = keyof typeof WA_TEMPLATES;

const maskEmail = (e: string) => {
  const [u = "", d = ""] = e.split("@");
  return `${u.slice(0, 1)}•••@${d}`;
};
const maskPhone = (p: string) => `••••••${p.slice(-4)}`;
/** WhatsApp template values may not contain newlines, tabs or long runs of spaces. */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 900);

/**
 * Queues one message per recipient (WhatsApp, or email for contacts without WhatsApp), inside the
 * caller's transaction so a rolled-back change never notifies anyone.
 */
export async function queueForAudience(
  tx: Tx,
  audience: Audience,
  opts: {
    purpose: Purpose;
    reason: string;
    actorId: string | null;
    batchId?: string;
    campaignId?: string;
    /** File sent with every message (WhatsApp header / email attachment) */
    attachmentId?: string;
    notBefore?: Date | null;
    /** Skipped instead of sent after this time */
    expiresAt?: Date | null;
    /** Rows whose key already exists are not queued again */
    dedupeKey?: (r: Recipient) => string;
    /** Text for one recipient: email subject + body, and the WhatsApp template values (after the name) */
    render: (r: Recipient, institute: string) => { subject: string; lines: string[]; params: string[] };
  },
): Promise<NotifyResult> {
  const institute = await getSetting<string>("institute.name", "Rahul Shah Classes");
  const result: NotifyResult = { email: 0, whatsapp: 0, noConsent: audience.skipped.length };
  const rows: Prisma.OutboundMessageCreateManyInput[] = audience.recipients.map((r) => {
    const t = opts.render(r, institute);
    const body = `Hello ${r.contact.name},\n\n${t.lines.join("\n")}\n\n— ${institute}`;
    const common = {
      contactId: r.contact.id,
      toName: r.contact.name,
      body,
      reason: opts.reason,
      batchId: opts.batchId ?? null,
      campaignId: opts.campaignId ?? null,
      attachmentId: opts.attachmentId ?? null,
      notBefore: opts.notBefore ?? null,
      expiresAt: opts.expiresAt ?? null,
      dedupeKey: opts.dedupeKey?.(r) ?? null,
      createdById: opts.actorId,
    };
    if (r.channel === "email") {
      result.email++;
      return { ...common, channel: "email", toHint: maskEmail(r.address), subject: `${institute}: ${t.subject}` };
    }
    result.whatsapp++;
    return {
      ...common,
      channel: "whatsapp",
      toHint: maskPhone(r.address),
      templateName: WA_TEMPLATES[opts.purpose].name,
      params: [oneLine(r.contact.name), ...t.params.map(oneLine)],
      status: env.WHATSAPP_MODE === "manual" ? "manual" : "queued",
    };
  });
  if (rows.length) await tx.outboundMessage.createMany({ data: rows, skipDuplicates: true });
  return result;
}

/** Schedule messages (changes, cancellations, make-ups) go to students only, on their own phone. */
const SCHEDULE_AUDIENCE = "students" as const;

/** Timetable change for one batch, to its students. */
export async function notifyBatch(
  tx: Tx,
  opts: { batchId: string; batchLabel: string; reason: string; subject: string; text: string; actorId: string },
): Promise<NotifyResult> {
  const audience = await resolveAudience(tx, { batchIds: [opts.batchId], groupIds: [], studentIds: [], who: SCHEDULE_AUDIENCE });
  return queueForAudience(tx, audience, {
    purpose: "schedule",
    reason: opts.reason,
    actorId: opts.actorId,
    batchId: opts.batchId,
    render: (r) => {
      const who = recipientLabel(r, opts.batchLabel);
      return { subject: opts.subject, lines: [`Timetable update for ${who}:`, opts.text], params: [who, opts.text] };
    },
  });
}

/** A cancelled class with its make-up date, in one message (template class_cancelled_makeup). */
export async function notifyMakeup(
  tx: Tx,
  opts: { batchId: string; batchLabel: string; subjectName: string; was: string; makeup: string; actorId: string },
): Promise<NotifyResult> {
  const audience = await resolveAudience(tx, { batchIds: [opts.batchId], groupIds: [], studentIds: [], who: SCHEDULE_AUDIENCE });
  return queueForAudience(tx, audience, {
    purpose: "makeup",
    reason: "timetable.makeup",
    actorId: opts.actorId,
    batchId: opts.batchId,
    render: (r) => {
      const who = recipientLabel(r, opts.batchLabel);
      return {
        subject: `${opts.subjectName} class cancelled, make-up on ${opts.makeup}`,
        lines: [`The ${opts.subjectName} class for ${who} on ${opts.was} is cancelled.`, `A make-up class will be held on ${opts.makeup}.`, "", "Sorry for the inconvenience."],
        params: [opts.subjectName, who, opts.was, opts.makeup],
      };
    },
  });
}

/** "Notified: 2 emails, 2 WhatsApp." */
export function describeNotify(r: NotifyResult | null) {
  if (!r) return "Students not notified.";
  const waNote = env.WHATSAPP_MODE === "test" ? " (test mode, not really sent)" : env.WHATSAPP_MODE === "manual" ? " ready for you to send from the Messages page" : "";
  const parts = [`${r.email} email${r.email === 1 ? "" : "s"}`, `${r.whatsapp} WhatsApp${waNote}`];
  const extra = r.noConsent ? ` ${r.noConsent} contact(s) skipped: no email/WhatsApp consent or address.` : "";
  return `Notified: ${parts.join(", ")}.${extra}`;
}

/** Errors that retrying won't fix (bad address, wrong password, template not approved…). */
class PermanentError extends Error {}

// ─────────────── Email ───────────────

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  transport ??= nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    requireTLS: !env.MAIL_SECURE && !env.MAIL_LOOPBACK, // never send the password or student data in clear text
    auth: env.MAIL_USER ? { user: env.MAIL_USER, pass: env.MAIL_PASSWORD ?? "" } : undefined,
    connectionTimeout: 15_000,
  });
  return transport;
}

export type FileOut = { fileName: string; mimeType: string; data: Buffer };

export async function sendEmail(to: { name: string; address: string }, subject: string, text: string, file?: FileOut): Promise<string | null> {
  try {
    const info = await mailer().sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_ADDRESS ?? env.MAIL_USER ?? "no-reply@rsc.localhost" },
      to,
      subject,
      text,
      attachments: file ? [{ filename: file.fileName, content: file.data, contentType: file.mimeType }] : undefined,
    });
    return info.messageId ?? null;
  } catch (e) {
    const code = (e as { responseCode?: number }).responseCode;
    const msg = e instanceof Error ? e.message : String(e);
    if (code === 535 || code === 534) throw new PermanentError(`Mail login refused: check MAIL_USER / MAIL_PASSWORD (Gmail needs an App password). ${msg}`);
    if (code && code >= 500) throw new PermanentError(msg);
    throw e; // network / temporary: retry later
  }
}

// ─────────────── WhatsApp (official Cloud API) ───────────────

/** Manual mode: a wa.me link that opens your own WhatsApp with the chat and message filled in. */
export const whatsAppLink = (toE164: string, text: string) => `https://wa.me/${toE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

/** Template header with an uploaded file (media id from uploadWhatsAppMedia). */
export type WaHeader = { kind: "image" | "document"; mediaId: string; fileName: string };

const waError = (data: { error?: { message?: string; code?: number; error_data?: { details?: string } } }, fallback: string) =>
  [data.error?.message, data.error?.error_data?.details, data.error?.code ? `(code ${data.error.code})` : ""].filter(Boolean).join(" ") || fallback;

/** Uploads a file to WhatsApp once; the returned id can be used in many messages for about 30 days. */
async function uploadWhatsAppMedia(file: FileOut): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mimeType);
  form.append("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName);
  const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
  if (res.ok && data.id) return data.id;
  const msg = `WhatsApp didn't accept the file “${file.fileName}”: ${waError(data, res.statusText)}`;
  if (res.status === 429 || res.status >= 500) throw new Error(msg);
  throw new PermanentError(msg);
}

/** Media id for this attachment: reused while under 25 days old, otherwise uploaded (again). */
async function mediaIdFor(a: MessageAttachment, file: FileOut): Promise<string> {
  if (a.waMediaId && a.waMediaAt && Date.now() - a.waMediaAt.getTime() < 25 * 86_400_000) return a.waMediaId;
  const id = await uploadWhatsAppMedia(file);
  await db.messageAttachment.update({ where: { id: a.id }, data: { waMediaId: id, waMediaAt: new Date() } });
  a.waMediaId = id;
  a.waMediaAt = new Date();
  return id;
}

export const attachmentFile = (a: MessageAttachment): FileOut => ({ fileName: a.fileName, mimeType: a.mimeType, data: decryptBytes(a.dataEnc, `attachment:${a.id}`) });

export async function sendWhatsApp(toE164: string, params: string[], templateName: string = env.WHATSAPP_TEMPLATE, header?: WaHeader): Promise<string | null> {
  if (env.WHATSAPP_MODE === "test") return null;
  const components: unknown[] = [];
  if (header)
    components.push({
      type: "header",
      parameters: [header.kind === "image" ? { type: "image", image: { id: header.mediaId } } : { type: "document", document: { id: header.mediaId, filename: header.fileName } }],
    });
  components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text })) });
  const res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164.replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: env.WHATSAPP_TEMPLATE_LANG },
        components,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } };
  if (res.ok) return data.messages?.[0]?.id ?? null;
  const detail = waError(data, "");
  const msg =
    data.error?.code === 132001
      ? `WhatsApp template “${templateName}” isn't approved yet (or its name / language in WhatsApp Manager differs). Once it shows Active, press “Send waiting / failed now”.`
      : data.error?.code === 132000
        ? `WhatsApp template “${templateName}” has a different number of {{…}} values than the app sends (${params.length}). Check its wording in WhatsApp Manager.`
        : data.error?.code === 131049
          ? `WhatsApp held back this Marketing message (“${templateName}”): Meta limits how many marketing messages one person gets. Try again tomorrow, or reach them another way.`
          : data.error?.code === 131050
            ? `This person has turned off marketing messages from you on WhatsApp, so “${templateName}” can't reach them. Utility messages (schedule, homework, make-up) still can.`
            : `WhatsApp refused the message: ${detail || res.statusText}`;
  if (res.status === 429 || res.status >= 500) throw new Error(msg); // rate limit / Meta outage: retry
  throw new PermanentError(msg);
}

// ─────────────── Delivery ───────────────

/**
 * The same message through an already-approved template, for templates still waiting on Meta:
 *  - make-up      → class_schedule_change
 *  - class notes  → homework_update (notes + homework; submit-by kept), or class_notice (notes only)
 */
function standIn(templateName: string | null, params: string[], toName: string): { template: string; params: string[] } | null {
  if (templateName === WA_TEMPLATES.makeup.name) {
    const [name = toName, subject = "", who = "", was = "", makeup = ""] = params;
    return { template: WA_TEMPLATES.schedule.name, params: [name, who, `${subject} class on ${was} is cancelled. Make-up class: ${makeup}.`] };
  }
  if (templateName === WA_TEMPLATES.summary.name) {
    const [name = toName, subject = "", klass = "", date = "", covered = "", homework = ""] = params;
    const coveredText = `${subject} class on ${date}: covered ${covered}.`;
    if (!homework || homework === "No homework this time") return { template: WA_TEMPLATES.notice.name, params: [name, klass, `${coveredText} No homework this time.`] };
    const due = homework.match(/\s*\(submit by ([^)]+)\)$/);
    const hw = due ? homework.slice(0, due.index) : homework;
    return { template: WA_TEMPLATES.homework.name, params: [name, klass, `${coveredText} Homework: ${hw}`, due?.[1] ?? "the next class"] };
  }
  return null;
}

const MAX_ATTEMPTS = 8;
/** Wait before retry n: 1, 2, 4 … up to 60 minutes. Eight tries cover about four hours offline. */
const backoffMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
let running: Promise<void> | null = null;

/** Sends due messages. Safe to call often: concurrent calls share one run, and each row is claimed before sending. */
export function deliverPending(opts: { ignoreBackoff?: boolean } = {}): Promise<void> {
  running ??= (async () => {
    try {
      // Rows stuck in "sending" (app stopped mid-send) become retryable after 10 minutes
      await db.outboundMessage.updateMany({ where: { status: "sending", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "queued" } });
      const now = Date.now();
      const queued = await db.outboundMessage.findMany({
        where: { status: "queued", OR: [{ notBefore: null }, { notBefore: { lte: new Date(now) } }] },
        orderBy: { createdAt: "asc" },
        take: 200,
        include: { contact: true, attachment: true },
      });
      const files = new Map<string, FileOut>(); // decrypted once per run
      const fileOf = (a: MessageAttachment) => {
        if (!files.has(a.id)) files.set(a.id, attachmentFile(a));
        return files.get(a.id)!;
      };
      for (const m of queued) {
        if (m.expiresAt && m.expiresAt.getTime() < now) {
          await db.outboundMessage.updateMany({ where: { id: m.id, status: "queued" }, data: { status: "skipped", lastError: "Too late to send: the class had already started" } });
          continue;
        }
        if (m.channel === "whatsapp" && env.WHATSAPP_MODE === "manual") {
          // Queued before switching to manual mode: hand it over to the "send on WhatsApp" list
          await db.outboundMessage.updateMany({ where: { id: m.id, status: "queued" }, data: { status: "manual" } });
          continue;
        }
        if (!opts.ignoreBackoff && m.attempts > 0 && now - m.updatedAt.getTime() < backoffMs(m.attempts)) continue;
        const claimed = await db.outboundMessage.updateMany({ where: { id: m.id, status: "queued" }, data: { status: "sending", attempts: { increment: 1 } } });
        if (!claimed.count) continue;
        try {
          if (!m.contact) throw new PermanentError("Contact was deleted");
          let ref: string | null;
          if (m.channel === "email") {
            const to = contactAddress(m.contact, "email");
            if (!to) throw new PermanentError("Contact has no email now");
            ref = await sendEmail({ name: m.toName, address: to }, m.subject ?? "Update", m.body, m.attachment ? fileOf(m.attachment) : undefined);
          } else {
            const to = contactAddress(m.contact, "whatsapp");
            if (!to) throw new PermanentError("Contact has no WhatsApp number now");
            const params = Array.isArray(m.params) ? (m.params as string[]) : [m.toName, "", m.body];
            let header: WaHeader | undefined;
            if (m.attachment && env.WHATSAPP_MODE === "cloud") {
              const file = fileOf(m.attachment);
              header = { kind: m.attachment.kind === "image" ? "image" : "document", mediaId: await mediaIdFor(m.attachment, file), fileName: file.fileName };
            }
            try {
              ref = await sendWhatsApp(to, params, m.templateName ?? undefined, header);
            } catch (e) {
              // Template not approved yet: say the same thing with one that is (see standIn)
              const alt = e instanceof PermanentError && e.message.includes("isn't approved yet") ? standIn(m.templateName, params, m.toName) : null;
              if (!alt) throw e;
              ref = await sendWhatsApp(to, alt.params, alt.template);
            }
          }
          const simulated = m.channel === "whatsapp" && env.WHATSAPP_MODE === "test";
          await db.outboundMessage.update({ where: { id: m.id }, data: { status: simulated ? "simulated" : "sent", sentAt: new Date(), providerRef: ref, lastError: null } });
        } catch (e) {
          const permanent = e instanceof PermanentError || m.attempts + 1 >= MAX_ATTEMPTS;
          await db.outboundMessage.update({
            where: { id: m.id },
            data: { status: permanent ? "failed" : "queued", lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500) },
          });
        }
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Background retry loop (every minute) so messages queued while the laptop was offline or asleep
 * go out once it's back, and class reminders get queued. Started when the server starts
 * (src/instrumentation.ts) and again on page loads as a safety net; runs once per process.
 */
export function ensureDeliveryLoop() {
  const g = globalThis as { __rscDeliveryLoop?: ReturnType<typeof setInterval> };
  if (g.__rscDeliveryLoop) return;
  const tick = () =>
    void import("./reminders")
      .then((r) => r.queueClassReminders())
      .catch((e) => console.error("[reminders]", e instanceof Error ? e.message : e))
      .finally(() => deliverPending().catch(() => {}));
  g.__rscDeliveryLoop = setInterval(tick, 60_000);
  g.__rscDeliveryLoop.unref?.();
  tick();
}
