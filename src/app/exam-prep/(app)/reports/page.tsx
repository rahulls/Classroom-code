import Link from "next/link";
import { deliverAction, discardReportAction, forceResendAction, messageSentAction, regenerateReportAction, sendReportAction } from "@/modules/exam-prep/actions";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { parentReachable } from "@/modules/exam-prep/services/people";
import { ActionButton, CopyButton } from "../../ui";

export const metadata = { title: "Reports" };

const SHOW = {
  open: { label: "To send", statuses: ["draft", "ready", "failed"] },
  sent: { label: "Sent", statuses: ["sent"] },
  discarded: { label: "Discarded", statuses: ["discarded"] },
  all: { label: "All", statuses: ["draft", "ready", "failed", "sent", "discarded"] },
} as const;
type Show = keyof typeof SHOW;

const STATUS: Record<string, { text: string; cls: string }> = {
  draft: { text: "To review", cls: "text-warn" },
  ready: { text: "Approved", cls: "text-accent" },
  failed: { text: "Failed", cls: "text-bad" },
  sent: { text: "Sent", cls: "text-ok" },
  discarded: { text: "Discarded", cls: "text-muted" },
};

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Every report, one row each: paper, class, student, the parent's WhatsApp number, the PDF, and the
 * three decisions: Discard, Regenerate, Send. Reports for checked answer sheets appear here by
 * themselves as soon as the last answer is marked. A sent WhatsApp report is finished with Mark sent.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const show: Show = sp.show && sp.show in SHOW ? (sp.show as Show) : "open";
  const [reports, counts] = await Promise.all([
    epdb.reportCard.findMany({
      where: { status: { in: [...SHOW[show].statuses] } },
      include: { student: { include: { parents: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    epdb.reportCard.groupBy({ by: ["status"], _count: true }),
  ]);
  const [messages, papers] = await Promise.all([
    epdb.message.findMany({ where: { dedupeKey: { in: reports.map((r) => `report:${r.id}`) } } }),
    epdb.paper.findMany({ where: { id: { in: [...new Set(reports.map((r) => r.paperId))] } }, select: { id: true, title: true } }),
  ]);
  const paperTitle = new Map(papers.map((p) => [p.id, p.title]));
  const count = (k: Show) => counts.filter((c) => (SHOW[k].statuses as readonly string[]).includes(c.status)).reduce((a, c) => a + c._count, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Reports</h1>
        <span className="text-sm text-muted">Made automatically when a sheet is fully marked. Review, then send.</span>
        <div className="ml-auto">
          <ActionButton action={deliverAction} fields={{}}>
            Run delivery now (emails + queue)
          </ActionButton>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 text-sm">
        {(Object.keys(SHOW) as Show[]).map((k) => (
          <Link key={k} href={`?show=${k}`} className={`rounded border px-3 py-1 ${k === show ? "border-accent bg-accent/10 font-semibold" : "border-line"}`}>
            {SHOW[k].label} <span className="text-xs text-muted">{count(k)}</span>
          </Link>
        ))}
      </nav>

      <section className="card overflow-x-auto">
        {reports.length ? (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Paper</th>
                <th>Class</th>
                <th>Student</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Report</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const parent = r.audience === "parent" ? r.student.parents.find((p) => p.id === r.parentId) : (r.student.parents.find((p) => parentReachable(p)) ?? r.student.parents[0]);
                const reachable = !!parent && parentReachable(parent);
                const msg = messages.find((m) => m.dedupeKey === `report:${r.id}`);
                const queued = msg && msg.status !== "sent" && r.status !== "sent";
                const st = STATUS[r.status] ?? { text: r.status, cls: "" };
                return (
                  <tr key={r.id} className={r.status === "discarded" ? "opacity-60" : ""}>
                    <td>
                      {paperTitle.get(r.paperId) ?? r.paperId}
                      <div className="font-mono text-xs text-muted">{r.paperId}</div>
                    </td>
                    <td>
                      {r.student.klass} <span className="text-xs text-muted">{r.student.board}</span>
                    </td>
                    <td>
                      <Link href={`/exam-prep/students/${r.studentId}`} className="hover:underline">
                        {r.student.name}
                      </Link>
                      <div className="font-mono text-xs text-muted">
                        {r.student.code}
                        {r.audience === "parent" ? ` · parent report (${r.language})` : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {parent?.whatsapp ?? <span className="text-muted">none</span>}
                      {parent && !reachable && <div className="text-xs text-warn">not verified</div>}
                    </td>
                    <td className={st.cls}>
                      {queued ? <span className="text-accent">In WhatsApp queue</span> : st.text}
                      {r.status === "sent" && r.sentAt && <div className="text-xs text-muted">{fmt(r.sentAt)}{r.channel ? ` · ${r.channel === "email" ? "email" : "WhatsApp"}` : ""}</div>}
                      {r.status !== "sent" && <div className="text-xs text-muted">made {fmt(r.createdAt)}</div>}
                      {r.error && <div className="text-xs text-bad">{r.error}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.pdfPath ? (
                        <>
                          <a href={signedLink(r.pdfPath)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            View
                          </a>
                          {" · "}
                          <a href={`${signedLink(r.pdfPath)}&download=1`} className="text-accent hover:underline">
                            Download
                          </a>
                        </>
                      ) : (
                        <span className="text-muted">no PDF</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-start gap-1">
                        {queued ? (
                          <>
                            {msg.waLink && (
                              <a href={msg.waLink} target="_blank" rel="noreferrer" className="btn px-2 py-1 text-xs">
                                Open WhatsApp ↗
                              </a>
                            )}
                            <CopyButton text={msg.body} label="Copy message" />
                            <ActionButton action={messageSentAction} fields={{ id: msg.id }} tone="primary">
                              Mark sent
                            </ActionButton>
                          </>
                        ) : r.status === "sent" ? (
                          <ActionButton action={forceResendAction} fields={{ reportId: r.id, regenerate: "true" }} confirm="Rebuild this report from the current marks and send it again (after a correction)?">
                            Regenerate and resend
                          </ActionButton>
                        ) : r.status !== "discarded" ? (
                          <ActionButton action={sendReportAction} fields={{ reportId: r.id }} tone="primary" confirm={`Send ${r.student.name}'s report${parent?.whatsapp ? ` to ${parent.whatsapp}` : ""}?`}>
                            Send
                          </ActionButton>
                        ) : null}
                        {r.status !== "sent" && (
                          <ActionButton action={regenerateReportAction} fields={{ reportId: r.id }}>
                            Regenerate
                          </ActionButton>
                        )}
                        {r.status !== "sent" && r.status !== "discarded" && (
                          <ActionButton action={discardReportAction} fields={{ reportId: r.id }} tone="danger" confirm="Discard this report? It won't be sent, and later mark changes won't rebuild it. Regenerate brings it back.">
                            Discard
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">{show === "open" ? "Nothing to send. Reports appear here as soon as a sheet is fully marked." : "No reports here."}</p>
        )}
      </section>
      <p className="text-xs text-muted">
        Send: email goes out by itself when it is set up for that parent; otherwise the report goes to the WhatsApp queue. Open WhatsApp (the message is filled in), attach the
        downloaded PDF, send, then press Mark sent.
      </p>
    </div>
  );
}
