import Link from "next/link";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { WaSendButtons, WaTestLink } from "@/components/wa-send";
import { markWhatsAppAction, retryMessagesAction, sendTestMessageAction } from "@/modules/messages/actions";
import { WA_TEMPLATES, ensureDeliveryLoop, whatsAppLink } from "@/modules/messages/service";
import { contactAddress } from "@/modules/students/contacts";

export const metadata = { title: "Messages" };

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Waiting", cls: "text-warn" },
  sending: { label: "Sending", cls: "text-warn" },
  sent: { label: "Sent", cls: "text-ok" },
  simulated: { label: "Test mode (not sent)", cls: "text-muted" },
  failed: { label: "Failed", cls: "text-bad" },
  manual: { label: "For you to send", cls: "text-warn" },
  skipped: { label: "Skipped", cls: "text-muted" },
};

/** The message without greeting and signature, e.g. "Timetable update for Diya (Alpha): Maths class … rescheduled …" */
const preview = (body: string, max: number) =>
  body
    .split("\n")
    .filter((l) => l && !l.startsWith("Hello") && !l.startsWith("— "))
    .join(" ")
    .slice(0, max);

/** What each message was for, in plain words (the log's "Type" column and filter). */
const REASONS: Record<string, string> = {
  "class.reminder": "Class reminder (student)",
  "teacher.reminder": "Class reminder (you)",
  "demo.reminder": "Demo reminder",
  "demo.scheduled": "Demo booked",
  "demo.cancelled": "Demo cancelled",
  "timetable.changed": "Timetable change",
  "timetable.makeup": "Make-up class",
  "class.summary": "Class notes",
  homework: "Homework",
  notice: "Notice",
  broadcast: "Broadcast",
  test: "Test",
};
const reasonLabel = (r: string) => REASONS[r] ?? r.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
const PAGE_SIZE = 100;

const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

type LogSearch = { type?: string; status?: string; page?: string };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<LogSearch> }) {
  await requirePermission("messages.view");
  const sp = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const logWhere = {
    ...(sp.type ? { reason: sp.type } : {}),
    ...(sp.status && sp.status in STATUS ? { status: sp.status } : {}),
  };
  const [messages, total, reasons, waiting, toSend, campaigns] = await Promise.all([
    db.outboundMessage.findMany({ where: logWhere, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { attachment: { select: { id: true, fileName: true } } } }),
    db.outboundMessage.count({ where: logWhere }),
    db.outboundMessage.groupBy({ by: ["reason"], _count: { _all: true } }),
    db.outboundMessage.count({ where: { status: { in: ["queued", "failed"] } } }),
    // Manual WhatsApp, oldest first. Numbers are decrypted only to build the links (owner-only page).
    db.outboundMessage.findMany({ where: { channel: "whatsapp", status: "manual" }, orderBy: { createdAt: "asc" }, take: 100, include: { contact: true, attachment: { select: { id: true, fileName: true } } } }),
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { messages: { select: { status: true, channel: true } } } }),
  ]);
  const sample = "This is a test message from RSC Classroom. Class timetable updates will arrive like this.";
  ensureDeliveryLoop();
  const mailPort = env.SMTP_PORT ?? 10250;

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Messages" }]} />
      <PageHeader
        title="Messages"
        subtitle="Every email and WhatsApp message the app sends: students, parents, demo classes and your own reminders"
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="#log" className="btn">
              🧾 Message log
            </a>
            <Link href="/messages/broadcast" className="btn">
              📣 Broadcast
            </Link>
            <Link href="/messages/compose" className="btn-primary">
              + New message
            </Link>
          </div>
        }
      />

      <section className="card mb-4 space-y-1 text-sm">
        <p>
          <b>Email:</b>{" "}
          {env.MAIL_LOOPBACK ? (
            <>
              <span className="text-warn">test mode</span>: local inbox (Mailpit) at{" "}
              <a href={`http://localhost:${process.env.MAILPIT_UI_PORT ?? "10251"}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                localhost:{process.env.MAILPIT_UI_PORT ?? "10251"}
              </a>
              . Nothing leaves this computer. (Port {mailPort})
            </>
          ) : (
            <>
              <span className="text-ok">live</span>: sent from {env.MAIL_FROM_ADDRESS ?? env.MAIL_USER} through {env.MAIL_HOST}.
            </>
          )}
        </p>
        <p>
          <b>WhatsApp:</b>{" "}
          {env.WHATSAPP_MODE === "cloud" ? (
            <>
              <span className="text-ok">live</span>: WhatsApp Business Cloud API ({env.WHATSAPP_TEMPLATE_LANG}). Templates: schedule “{WA_TEMPLATES.schedule.name}”, homework “{WA_TEMPLATES.homework.name}”, notice “{WA_TEMPLATES.notice.name}”, make-up “{WA_TEMPLATES.makeup.name}”, class notes “{WA_TEMPLATES.summary.name}”, reminder “{WA_TEMPLATES.reminder.name}”, broadcast with picture “{WA_TEMPLATES.noticeImage.name}” / document “{WA_TEMPLATES.noticeDocument.name}”.
            </>
          ) : env.WHATSAPP_MODE === "manual" ? (
            <>
              <span className="text-ok">manual</span>: each message is prepared for you. One click opens your WhatsApp with it filled in; you press Send.
            </>
          ) : (
            <>
              <span className="text-warn">test mode</span>: recorded here but not sent.
            </>
          )}
        </p>
        <p className="text-xs text-muted">Only contacts who agreed to email / WhatsApp updates (on the student’s profile) receive messages. WhatsApp first; email only for contacts without WhatsApp.</p>
        {waiting > 0 && (
          <ActionForm action={retryMessagesAction} className="flex flex-wrap items-center gap-2 pt-2">
            <SubmitButton variant="default">Send {waiting} waiting / failed now</SubmitButton>
            <FormMessage />
          </ActionForm>
        )}
      </section>

      {env.WHATSAPP_MODE === "manual" && (
        <section className="card mb-4">
          <h2 className="mb-1 text-sm font-semibold">WhatsApp to send ({toSend.length})</h2>
          {toSend.length ? (
            <>
              <p className="mb-3 text-xs text-muted">
                “Open WhatsApp” opens the chat with the message filled in (WhatsApp Desktop, or web.whatsapp.com logged in to your number). Press Send there, then come back for the next one.
              </p>
              <ul className="divide-y divide-soft text-sm">
                {toSend.map((m) => {
                  const to = m.contact ? contactAddress(m.contact, "whatsapp") : null;
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="w-40 shrink-0">
                        {m.toName}
                        <span className="block text-xs text-muted">{m.toHint}</span>
                      </span>
                      <span className="min-w-0 flex-1 text-xs">
                        {preview(m.body, 200)}
                        {m.attachment && (
                          <a href={`/messages/attachments/${m.attachment.id}`} target="_blank" rel="noreferrer" className="block text-accent hover:underline">
                            📎 {m.attachment.fileName}: download it, then attach it in the chat
                          </a>
                        )}
                        <span className="block text-muted">{when(m.createdAt)}</span>
                      </span>
                      {to ? (
                        <WaSendButtons id={m.id} href={whatsAppLink(to, m.body)} mark={markWhatsAppAction} />
                      ) : (
                        <span className="text-xs text-bad">This contact has no WhatsApp number now</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted">Nothing waiting. When you change a class and tick “Tell students”, the WhatsApp messages appear here.</p>
          )}
        </section>
      )}

      {campaigns.length > 0 && (
        <section className="card mb-4 overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold">Broadcasts, homework, class notes and notices sent</h2>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Sent</th>
                <th>Waiting</th>
                <th>Failed</th>
                <th>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const n = (st: string[]) => c.messages.filter((m) => st.includes(m.status)).length;
                const skipped = Array.isArray(c.skipped) ? c.skipped.length : 0;
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap text-xs">
                      {when(c.createdAt)}
                      {c.scheduledAt && <span className="block text-muted">for {when(c.scheduledAt)}</span>}
                    </td>
                    <td>{c.title}</td>
                    <td className="text-ok">{n(["sent", "simulated"])}</td>
                    <td className="text-warn">{n(["queued", "sending", "manual"]) || ""}</td>
                    <td className="text-bad">{n(["failed"]) || ""}</td>
                    <td className="text-muted">{skipped || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card mb-4">
        <h2 className="mb-2 text-sm font-semibold">Send a test</h2>
        <ActionForm action={sendTestMessageAction} className="flex flex-wrap items-end gap-2">
          <SelectField
            name="channel"
            label="Channel"
            required
            defaultValue="email"
            options={[
              { value: "email", label: "Email" },
              { value: "whatsapp", label: "WhatsApp" },
            ]}
          />
          <TextField name="to" label="To (email or mobile number)" required maxLength={200} placeholder="you@gmail.com or 98xxxxxxxx" />
          <SubmitButton variant="default">Send test</SubmitButton>
          <div className="w-full">
            <FormMessage />
          </div>
        </ActionForm>
        {env.WHATSAPP_MODE === "manual" && (
          <div className="mt-3 border-t border-soft pt-3">
            <p className="mb-2 text-xs text-muted">WhatsApp (manual mode): opens WhatsApp with a sample message to the number you type.</p>
            <WaTestLink sample={sample} />
          </div>
        )}
      </section>

      <section className="mb-2 mt-6 flex flex-wrap items-end gap-3" id="log">
        <h2 className="flex-1 text-sm font-semibold">
          Message log <span className="font-normal text-muted">({total})</span>
        </h2>
        <form method="get" action="/messages#log" className="flex flex-wrap items-end gap-2">
          <label>
            <span className="label">Type</span>
            <select name="type" defaultValue={sp.type ?? ""} className="input">
              <option value="">All types</option>
              {reasons
                .map((r) => ({ value: r.reason, label: reasonLabel(r.reason), n: r._count._all }))
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} ({r.n})
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="label">Status</span>
            <select name="status" defaultValue={sp.status ?? ""} className="input">
              <option value="">Any status</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn">Show</button>
          {(sp.type || sp.status) && (
            <Link href="/messages#log" className="btn">
              Clear
            </Link>
          )}
        </form>
      </section>
      {messages.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Channel</th>
                <th>To</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const st = STATUS[m.status] ?? { label: m.status, cls: "" };
                return (
                  <tr key={m.id} className="align-top">
                    <td className="whitespace-nowrap text-xs">{when(m.createdAt)}</td>
                    <td className="whitespace-nowrap text-xs">{reasonLabel(m.reason)}</td>
                    <td>{m.channel === "email" ? "Email" : "WhatsApp"}</td>
                    <td className="whitespace-nowrap">
                      {m.toName}
                      <span className="block text-xs text-muted">{m.toHint}</span>
                    </td>
                    <td className="max-w-md">
                      {m.subject && <b className="block">{m.subject}</b>}
                      <details>
                        <summary className="cursor-pointer text-xs text-muted">{preview(m.body, 110) || "Show"}</summary>
                        <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{m.body}</pre>
                      </details>
                      {m.attachment && (
                        <a href={`/messages/attachments/${m.attachment.id}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                          📎 {m.attachment.fileName}
                        </a>
                      )}
                    </td>
                    <td className={`whitespace-nowrap text-xs ${st.cls}`}>
                      {st.label}
                      {m.sentAt && <span className="block text-muted">{when(m.sentAt)}</span>}
                      {m.lastError && <span className="block max-w-[14rem] whitespace-normal text-bad">{m.lastError}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              {page > 1 && (
                <Link className="btn" href={logHref(sp, page - 1)}>
                  ← Newer
                </Link>
              )}
              <span className="text-muted">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE)} of {total}
              </span>
              {page * PAGE_SIZE < total && (
                <Link className="btn" href={logHref(sp, page + 1)}>
                  Older →
                </Link>
              )}
            </div>
          )}
        </div>
      ) : (
        <Empty>{sp.type || sp.status ? "No messages match this filter." : "No messages yet. Every message the app sends is logged here."}</Empty>
      )}
    </>
  );
}

function logHref(sp: LogSearch, page: number) {
  const q = new URLSearchParams();
  if (sp.type) q.set("type", sp.type);
  if (sp.status) q.set("status", sp.status);
  if (page > 1) q.set("page", String(page));
  const qs = q.toString();
  return `/messages${qs ? `?${qs}` : ""}#log`;
}
