import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { type ActionState, defineAction, UserError } from "@/core/action";
import { audit } from "@/core/audit";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { getSetting } from "@/modules/academics/service";
import { fmtDate, isYmd } from "@/modules/academics/time";
import { zBool, zId } from "@/core/validation";
import { contactPII, normalizePhone } from "@/modules/students/contacts";
import { saveAttachment } from "./attachments";
import { recipientLabel, resolveAudience } from "./audience";
import { deliverPending, oneLine, queueForAudience, sendEmail, sendWhatsApp } from "./service";

/** Re-queue failed messages and try sending everything waiting now. */
export const retryMessagesAction = defineAction({
  permission: "messages.view",
  schema: z.object({}),
  run: async () => {
    const { count } = await db.outboundMessage.updateMany({ where: { status: "failed" }, data: { status: "queued", attempts: 0 } });
    await deliverPending({ ignoreBackoff: true });
    const left = await db.outboundMessage.count({ where: { status: { in: ["queued", "failed"] } } });
    revalidatePath("/messages");
    return left
      ? { ok: false, error: `${left} message(s) still not sent. See the error column.` }
      : { ok: true, message: `All sent.${count ? ` Retried ${count} failed message(s).` : ""}` };
  },
});

/** Send one test email / WhatsApp to check the setup. Sent straight away, not queued. */
export const sendTestMessageAction = defineAction({
  permission: "messages.view",
  schema: z.object({ channel: z.enum(["email", "whatsapp"]), to: z.string().trim().min(3).max(200) }),
  run: async ({ channel, to }, { user }) => {
    const institute = await getSetting<string>("institute.name", "Rahul Shah Classes");
    const sample = "This is a test message from RSC Classroom. Class timetable updates will arrive like this.";
    // Logged on the Messages page like every other message, sent or failed
    const log = (status: "sent" | "failed", extra: { providerRef?: string | null; lastError?: string; toHint: string; body: string }) =>
      db.outboundMessage.create({ data: { channel, toName: "Test", reason: "test", status, sentAt: status === "sent" ? new Date() : null, attempts: 1, ...extra } });
    const hint = channel === "email" ? to.replace(/^(.).*(@.*)$/, "$1•••$2") : `••••••${to.replace(/\D/g, "").slice(-4)}`;
    let ref: string | null | undefined;
    let body = "";
    try {
      if (channel === "email") {
        const address = z.email().safeParse(to.toLowerCase());
        if (!address.success) return { ok: false, error: "Enter a valid email address.", fieldErrors: { to: "Not an email address" } };
        body = `Hello,

${sample}

— ${institute}`;
        ref = await sendEmail({ name: "Test", address: address.data }, `${institute}: test message`, body);
      } else {
        if (env.WHATSAPP_MODE === "test") throw new UserError("WhatsApp is in test mode. Set WHATSAPP_MODE=manual (or cloud) in .env, then restart the app.");
        if (env.WHATSAPP_MODE === "manual") throw new UserError("WhatsApp is in manual mode: use the “Open WhatsApp” test link above instead.");
        body = sample;
        ref = await sendWhatsApp(normalizePhone(to), ["Rahul", `a test student (${institute})`, sample]);
      }
    } catch (e) {
      if (e instanceof UserError) throw e;
      const error = e instanceof Error ? e.message : String(e);
      await log("failed", { toHint: hint, body: body || sample, lastError: error.slice(0, 500) });
      revalidatePath("/messages");
      return { ok: false, error };
    }
    await log("sent", { toHint: hint, body, providerRef: typeof ref === "string" ? ref : null });
    revalidatePath("/messages");
    await audit({ action: "messages.test_sent", actor: user, entity: "message", after: { channel } });
    return { ok: true, message: channel === "email" ? "Test email sent. Check that inbox (and Spam)." : "Test WhatsApp sent. Check the phone." };
  },
});

/** Manual WhatsApp mode: record that a prepared message was sent from your own WhatsApp (or skipped). */
export const markWhatsAppAction = defineAction({
  permission: "messages.view",
  schema: z.object({ id: z.string().min(1).max(40), outcome: z.enum(["sent", "skipped"]) }),
  run: async ({ id, outcome }, { user }) => {
    const { count } = await db.outboundMessage.updateMany({
      where: { id, channel: "whatsapp", status: "manual" },
      data: outcome === "sent" ? { status: "sent", sentAt: new Date(), attempts: { increment: 1 } } : { status: "skipped" },
    });
    if (count) await audit({ action: `messages.whatsapp_${outcome}`, actor: user, entity: "message", entityId: id });
    revalidatePath("/messages");
    revalidatePath("/today");
    return { ok: true };
  },
});

// ─────────────── Bulk send: homework and class notices ───────────────

const IST_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Homework or a class notice to students and/or parents of the picked classes, groups or students. */
export const sendCampaignAction = defineAction({
  permission: "messages.send",
  schema: z.object({
    purpose: z.enum(["homework", "notice"]),
    who: z.enum(["students", "parents", "both"]),
    batchIds: z.array(zId).max(200).default([]),
    groupIds: z.array(zId).max(200).default([]),
    studentIds: z.array(zId).max(500).default([]),
    forLabel: z.string().trim().min(1, "Say who it's for, e.g. Class 10 · Maths").max(80),
    text: z.string().trim().min(3, "Write the message").max(600, "Keep it under 600 characters"),
    dueDate: z.preprocess((v) => (v === "" ? undefined : v), z.string().refine(isYmd, "Pick a date").optional()),
    sendAt: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(IST_LOCAL, "Pick a date and time").optional()),
  }),
  run: async (input, { user }): Promise<ActionState> => {
    if (input.purpose === "homework" && !input.dueDate) return { ok: false, error: "When should it be submitted?", fieldErrors: { dueDate: "Pick the submit-by date" } };
    const notBefore = input.sendAt ? new Date(`${input.sendAt}:00+05:30`) : null;
    if (notBefore && notBefore.getTime() < Date.now() - 60_000) return { ok: false, error: "That time has passed.", fieldErrors: { sendAt: "Pick a future time, or leave empty to send now" } };
    const spec = { batchIds: input.batchIds, groupIds: input.groupIds, studentIds: input.studentIds, who: input.who };
    const due = input.dueDate ? fmtDate(input.dueDate) : "";
    const text = oneLine(input.text);

    const { result, skipped, campaignId } = await db.$transaction(async (tx) => {
      const audience = await resolveAudience(tx, spec);
      if (!audience.recipients.length) throw new UserError(audience.studentCount ? "Nobody to send to: none of these contacts has WhatsApp or email consent." : "No active students in what you picked.");
      const campaign = await tx.campaign.create({
        data: {
          purpose: input.purpose,
          title: `${input.purpose === "homework" ? "Homework" : "Notice"} · ${input.forLabel}`,
          audience: spec,
          skipped: audience.skipped,
          scheduledAt: notBefore,
          createdById: user.id,
        },
      });
      const result = await queueForAudience(tx, audience, {
        purpose: input.purpose,
        reason: input.purpose,
        actorId: user.id,
        campaignId: campaign.id,
        notBefore,
        render: (r) => {
          const who = recipientLabel(r, input.forLabel);
          return input.purpose === "homework"
            ? {
                subject: `Homework: ${input.forLabel}`,
                lines: [`Homework has been assigned for ${who}.`, "", `Homework: ${text}`, `Submit by: ${due}`, "", "Please complete it before the next class."],
                params: [who, text, due],
              }
            : {
                subject: `Notice: ${input.forLabel}`,
                lines: [`Here is a notice about classes for ${who}:`, "", text, "", "Reply to this message if you have any questions."],
                params: [who, text],
              };
        },
      });
      await audit({ action: `messages.campaign_${input.purpose}`, actor: user, entity: "campaign", entityId: campaign.id, after: { ...spec, forLabel: input.forLabel, whatsapp: result.whatsapp, email: result.email, skipped: audience.skipped.length, sendAt: input.sendAt ?? null } }, tx);
      return { result, skipped: audience.skipped.length, campaignId: campaign.id };
    });

    if (!notBefore) after(() => deliverPending().catch(() => {}));
    revalidatePath("/messages");
    const parts = [`${result.whatsapp} WhatsApp`, `${result.email} email${result.email === 1 ? "" : "s"}`];
    const when = notBefore ? ` Scheduled for ${notBefore.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.` : "";
    const manual = env.WHATSAPP_MODE === "manual" && result.whatsapp ? " WhatsApp ones are waiting on the Messages page for you to send." : "";
    return { ok: true, message: `Sending: ${parts.join(", ")}.${skipped ? ` ${skipped} contact(s) skipped (no consent or number).` : ""}${when}${manual}`, data: { campaignId } };
  },
});

// ─────────────── Broadcast: one message to everyone (minus those unticked) ───────────────

/**
 * A message (optionally with a picture or document) to the ticked students and parents.
 * The list is worked out again here from every active student, so only real, opted-in contacts get it.
 */
export const sendBroadcastAction = defineAction({
  permission: "messages.send",
  schema: z.object({
    contactIds: z.array(zId).max(5000).default([]),
    subject: z.string().trim().min(3, "Give it a short title").max(80, "Keep the title under 80 characters"),
    text: z.string().trim().min(3, "Write the message").max(600, "Keep it under 600 characters"),
    file: z.instanceof(File).optional(),
    sendAt: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(IST_LOCAL, "Pick a date and time").optional()),
  }),
  run: async (input, { user }): Promise<ActionState> => {
    const ticked = new Set(input.contactIds);
    if (!ticked.size) return { ok: false, error: "Nobody is ticked.", fieldErrors: { contactIds: "Tick at least one person" } };
    const notBefore = input.sendAt ? new Date(`${input.sendAt}:00+05:30`) : null;
    if (notBefore && notBefore.getTime() < Date.now() - 60_000) return { ok: false, error: "That time has passed.", fieldErrors: { sendAt: "Pick a future time, or leave empty to send now" } };
    const text = input.text.replace(/\r\n?/g, "\n");

    const { result, campaignId, fileName } = await db.$transaction(
      async (tx) => {
        const all = await resolveAudience(tx, { batchIds: [], groupIds: [], studentIds: [], who: "both", all: true });
        const audience = { ...all, skipped: [], recipients: all.recipients.filter((r) => ticked.has(r.contact.id)) };
        if (!audience.recipients.length) throw new UserError("None of the ticked people can get messages now (no WhatsApp or email consent). Reload the page.");
        const file = input.file ? await saveAttachment(tx, input.file, user.id) : null;
        const campaign = await tx.campaign.create({
          data: {
            purpose: "broadcast",
            title: `Broadcast · ${input.subject}${file ? ` · 📎 ${file.fileName}` : ""}`,
            audience: { all: true, contactIds: [...ticked] },
            skipped: all.skipped,
            scheduledAt: notBefore,
            attachmentId: file?.id ?? null,
            createdById: user.id,
          },
        });
        const result = await queueForAudience(tx, audience, {
          purpose: !file ? "notice" : file.kind === "image" ? "noticeImage" : "noticeDocument",
          reason: "broadcast",
          actorId: user.id,
          campaignId: campaign.id,
          attachmentId: file?.id,
          notBefore,
          render: (r) => ({
            subject: input.subject,
            lines: [text, ...(file ? ["", `Attached: ${file.fileName}`] : [])],
            params: [recipientLabel(r, ""), oneLine(text)],
          }),
        });
        await audit(
          { action: "messages.broadcast", actor: user, entity: "campaign", entityId: campaign.id, after: { subject: input.subject, recipients: audience.recipients.length, whatsapp: result.whatsapp, email: result.email, attachment: file?.fileName ?? null, sendAt: input.sendAt ?? null } },
          tx,
        );
        return { result, campaignId: campaign.id, fileName: file?.fileName ?? null };
      },
      { timeout: 60_000 },
    );

    if (!notBefore) after(() => deliverPending().catch(() => {}));
    revalidatePath("/messages");
    const parts = [`${result.whatsapp} WhatsApp`, `${result.email} email${result.email === 1 ? "" : "s"}`];
    const when = notBefore ? ` Scheduled for ${notBefore.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.` : "";
    const manual = env.WHATSAPP_MODE === "manual" && result.whatsapp ? ` WhatsApp ones are waiting on the Messages page for you to send${fileName ? " (attach the file yourself)" : ""}.` : "";
    return { ok: true, message: `Broadcast sending: ${parts.join(", ")}${fileName ? `, with ${fileName}` : ""}.${when}${manual}`, data: { campaignId } };
  },
});

/** Class reminders: on/off, how many minutes before the class, and the teacher's own WhatsApp number. */
export const updateReminderSettingsAction = defineAction({
  permission: "messages.send",
  schema: z.object({
    enabled: zBool,
    minutesBefore: z.coerce.number().int().min(5, "At least 5 minutes").max(120, "At most 120 minutes"),
    teacherPhone: z.string().trim().max(20).optional(),
  }),
  run: async ({ enabled, minutesBefore, teacherPhone }, { user }) => {
    // Teacher number: blank = no teacher reminders. Kept encrypted in a Contact like everyone else's.
    // The form shows the saved number masked ("••••••1234"); sending that back means "unchanged".
    let teacherContactId = await getSetting<string | null>("reminders.teacher.contactId", null);
    if (!teacherPhone) teacherContactId = null;
    else if (!/^•+\d{4}$/.test(teacherPhone)) {
      let pii;
      try {
        pii = contactPII({ phone: teacherPhone, whatsapp: teacherPhone });
      } catch (e) {
        if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: { teacherPhone: "Enter a valid mobile number, e.g. 98765 43210" } };
        throw e;
      }
      const data = { name: user.name || "Teacher", ...pii, waOptIn: true, consentAt: new Date(), consentSource: "teacher reminders (settings)" };
      const existing = teacherContactId ? await db.contact.findUnique({ where: { id: teacherContactId } }) : null;
      teacherContactId = existing ? (await db.contact.update({ where: { id: existing.id }, data })).id : (await db.contact.create({ data })).id;
    }
    const entries = [
      ["reminders.classes.enabled", enabled],
      ["reminders.classes.minutesBefore", minutesBefore],
      ...(teacherContactId ? [["reminders.teacher.contactId", teacherContactId] as const] : []),
    ] as const;
    await db.$transaction([
      ...entries.map(([key, value]) => db.setting.upsert({ where: { key }, update: { value, updatedBy: user.id }, create: { key, value, updatedBy: user.id } })),
      ...(teacherContactId ? [] : [db.setting.deleteMany({ where: { key: "reminders.teacher.contactId" } })]),
    ]);
    await audit({ action: "messages.reminders.updated", actor: user, entity: "setting", after: { enabled, minutesBefore, teacher: !!teacherContactId } });
    revalidatePath("/settings/general");
    revalidatePath("/messages");
    const students = enabled ? `Students get a reminder ${minutesBefore} minutes before each class.` : "Student reminders off.";
    const teacher = teacherContactId ? ` You get one ${minutesBefore} minutes before every class, demo classes included.` : " No teacher reminders.";
    return { ok: true, message: students + teacher };
  },
});
