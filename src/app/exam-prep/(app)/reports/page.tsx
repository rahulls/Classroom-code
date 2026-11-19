import { deliverAction, forceResendAction, messageSentAction } from "@/modules/exam-prep/actions";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { ActionButton, CopyButton } from "../../ui";

export const metadata = { title: "Reports" };

/** R7 delivery: the WhatsApp send queue (PDF + personal message + wa.me link) and email status. */
export default async function ReportsPage() {
  const [queue, other] = await Promise.all([
    epdb.message.findMany({ where: { status: "drafted", templateKey: { in: ["student_report", "parent_report"] } }, orderBy: { createdAt: "asc" } }),
    epdb.reportCard.findMany({ where: { OR: [{ status: "failed" }, { status: "sent" }, { status: "draft" }] }, include: { student: true }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const reportIds = queue.map((m) => m.dedupeKey?.replace("report:", "")).filter((x): x is string => !!x);
  const reports = await epdb.reportCard.findMany({ where: { id: { in: reportIds } }, include: { student: true } });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Reports</h1>
        <span className="text-sm text-muted">{queue.length} in the WhatsApp queue</span>
        <div className="ml-auto">
          <ActionButton action={deliverAction} fields={{}}>
            Run delivery now (emails + queue)
          </ActionButton>
        </div>
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold text-[#0f3460]">WhatsApp send queue</h2>
        <p className="text-xs text-muted">For each: download the PDF, open WhatsApp (the message is filled in), attach the PDF, send, then mark sent. Students get theirs first; parents the same day or after.</p>
        {queue.map((m) => {
          const rc = reports.find((r) => `report:${r.id}` === m.dedupeKey);
          return (
            <div key={m.id} className="card flex flex-wrap items-center gap-3 text-sm">
              <div className="w-56">
                <b>{rc?.student.name}</b> <span className="text-xs text-muted">{rc?.audience === "student" ? "student report" : "parent report"} · {rc?.paperId}</span>
              </div>
              <p className="flex-1 text-xs text-muted">{m.body}</p>
              {rc?.pdfPath && (
                <a href={`${signedLink(rc.pdfPath)}&download=1`} className="btn px-2 py-1 text-xs">
                  ⬇ PDF
                </a>
              )}
              {m.waLink && (
                <a href={m.waLink} target="_blank" rel="noreferrer" className="btn px-2 py-1 text-xs">
                  Open WhatsApp ↗
                </a>
              )}
              <CopyButton text={m.body} />
              <ActionButton action={messageSentAction} fields={{ id: m.id }} tone="primary">
                Sent ✓
              </ActionButton>
            </div>
          );
        })}
        {!queue.length && <p className="card text-sm text-muted">The queue is empty.</p>}
      </section>
      <section className="card">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Recent reports</h2>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Student</th>
              <th>Paper</th>
              <th>For</th>
              <th>Status</th>
              <th>Channel</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {other.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.student.name} <span className="font-mono text-xs text-muted">{r.student.code}</span>
                </td>
                <td className="font-mono text-xs">{r.paperId}</td>
                <td>
                  {r.audience} ({r.language})
                </td>
                <td className={r.status === "failed" ? "text-bad" : ""}>
                  {r.status}
                  {r.error && <span className="text-xs"> · {r.error}</span>}
                </td>
                <td>{r.channel ?? "-"}</td>
                <td className="flex gap-2">
                  {r.pdfPath && (
                    <a href={signedLink(r.pdfPath)} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                      view
                    </a>
                  )}
                  {r.status === "sent" && (
                    <ActionButton action={forceResendAction} fields={{ reportId: r.id, regenerate: "true" }} confirm="Send this report again (after a correction)?">
                      Force resend
                    </ActionButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
