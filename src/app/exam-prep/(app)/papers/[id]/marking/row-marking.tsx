import Link from "next/link";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { chapterBreakdown, sheetScore } from "@/modules/exam-prep/domain/answer-rows";
import { paperRows } from "@/modules/exam-prep/services/answer-rows";
import { RowGrid } from "./row-grid";
import { sheetReportAction } from "@/modules/exam-prep/actions";
import { parentReachable } from "@/modules/exam-prep/services/people";
import { ActionButton } from "../../../../ui";

/** Marking for an uploaded paper: the answer sheet on the left, the paper's answer rows on the right. */
export async function RowMarking({ paper, sheet }: { paper: { id: string; title: string; answerRows: unknown; totalMarks: number | null }; sheet?: string }) {
  const rows = paperRows(paper);
  const subs = await epdb.submission.findMany({ where: { paperId: paper.id, isCurrent: true }, include: { student: true, rowMarks: true }, orderBy: { student: { code: "asc" } } });
  const scored = subs.map((s) => ({ s, score: sheetScore(rows, s.rowMarks) }));
  const current = scored.find((x) => x.s.id === sheet) ?? scored.find((x) => x.score.open > 0) ?? scored[0];
  const done = scored.filter((x) => x.score.open === 0).length;
  const sheetPath = current ? (current.s.files as { path: string }[])[0]?.path : null;
  const back = `/exam-prep/papers/${encodeURIComponent(paper.id)}`;
  return (
    <div className="space-y-4">
      <div>
        <Link href={back} className="text-sm text-accent hover:underline">
          ← {paper.id}
        </Link>
        <h1 className="text-2xl font-bold text-[#0f3460]">Marking</h1>
        <p className="text-sm text-muted">
          {subs.length} sheet{subs.length === 1 ? "" : "s"} · {done} fully marked · {rows.length} answer rows
        </p>
      </div>
      {!rows.length ? (
        <p className="card text-sm text-warn">
          This paper has no answer rows yet. Add them on the{" "}
          <Link href={back} className="text-accent hover:underline">
            paper page
          </Link>{" "}
          (or load the class&apos;s marking format there), then come back to mark.
        </p>
      ) : !subs.length ? (
        <p className="card text-sm text-muted">No sheets filed yet. File them on the paper page under &quot;File a sheet&quot;.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 text-xs">
            {scored.map(({ s, score }) => (
              <Link
                key={s.id}
                href={`?sheet=${s.id}`}
                title={score.open ? `${score.open} answer${score.open === 1 ? "" : "s"} not marked yet` : "Fully marked"}
                className={`rounded border px-2 py-1 text-[#1d1838] hover:bg-accent/5 ${s.id === current?.s.id ? "border-accent bg-accent/10 font-semibold" : "border-line bg-white"}`}
              >
                <span className="font-mono text-[#0f3460]">{s.student.code}</span> · {s.student.name} · {score.got}/{score.max}
                {score.open ? <span className="text-warn"> • {score.open} left</span> : <span className="text-ok"> ✓</span>}
              </Link>
            ))}
          </div>
          {current && (
            <>
              <p className="text-sm">
                <b>{current.s.student.code}</b> {current.s.student.name}
              </p>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                {sheetPath ? (
                  <iframe src={signedLink(sheetPath)} title={`Answer sheet ${current.s.student.code}`} className="h-[85vh] w-full rounded-lg border border-line bg-white lg:sticky lg:top-2" />
                ) : (
                  <p className="card text-sm text-warn">This sheet has no file.</p>
                )}
                <div className="space-y-3">
                  <RowGrid key={current.s.id} submissionId={current.s.id} rows={rows} saved={Object.fromEntries(current.s.rowMarks.map((m) => [m.label, { marks: m.marks, errorTag: m.errorTag }]))} />
                  <SheetReport submissionId={current.s.id} studentId={current.s.studentId} paperId={paper.id} open={current.score.open} />
                  <SheetChapters lines={chapterBreakdown(rows, current.s.rowMarks)} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const LOST_NAMES: Record<string, string> = { concept: "concept", calculation: "calculation", missing_steps: "missing steps", misread: "misread", "not tagged": "not tagged" };

/** This sheet, chapter by chapter (saved marks only), weakest first. */
function SheetChapters({ lines }: { lines: ReturnType<typeof chapterBreakdown> }) {
  if (!lines.length) return null;
  const lost: Record<string, number> = {};
  for (const l of lines) for (const [k, v] of Object.entries(l.lostBy)) lost[k] = (lost[k] ?? 0) + v;
  return (
    <section className="card space-y-2 text-xs">
      <b className="text-sm">Chapter-wise (saved marks)</b>
      <table className="w-full">
        <tbody>
          {lines.map((l) => {
            const pct = Math.round((100 * l.got) / l.max);
            return (
              <tr key={l.chapter} className="border-t border-line">
                <td className="py-1">{l.chapter}</td>
                <td className="text-right font-semibold">
                  {l.got} / {l.max}
                </td>
                <td className={`w-12 text-right ${pct === 100 ? "text-ok" : pct < 60 ? "text-bad" : "text-warn"}`}>{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {Object.keys(lost).length > 0 && (
        <p className="text-muted">
          Marks lost:{" "}
          {Object.entries(lost)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${v} ${LOST_NAMES[k] ?? k}`)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}

/** Report for this sheet: made automatically once every answer is marked; reviewed and sent from Reports. */
async function SheetReport({ submissionId, studentId, paperId, open }: { submissionId: string; studentId: string; paperId: string; open: number }) {
  const [rcs, st] = await Promise.all([
    epdb.reportCard.findMany({ where: { studentId, paperId }, orderBy: { audience: "desc" } }),
    epdb.student.findUniqueOrThrow({ where: { id: studentId }, include: { parents: true } }),
  ]);
  const reachable = st.parents.some((p) => parentReachable(p));
  const LABEL: Record<string, string> = { draft: "made · to review", ready: "approved", sent: "sent", failed: "failed", discarded: "discarded" };
  return (
    <section className="card space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>Report</b>
        {open > 0 && <span className="text-xs text-muted">Made automatically when every answer is marked ({open} left; give 0 for a blank answer).</span>}
      </div>
      {open === 0 && !rcs.length && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-warn">Fully marked, but no report yet.</span>
          <ActionButton action={sheetReportAction} fields={{ submissionId }} tone="primary">
            Make report
          </ActionButton>
        </div>
      )}
      {rcs.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className={r.status === "sent" ? "text-ok" : r.status === "failed" ? "text-bad" : r.status === "discarded" ? "text-muted" : "text-warn"}>{LABEL[r.status] ?? r.status}</span>
          {r.pdfPath && (
            <a href={signedLink(r.pdfPath)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Open PDF ↗
            </a>
          )}
          <Link href="/exam-prep/reports" className="text-accent hover:underline">
            Send, regenerate or discard in Reports →
          </Link>
        </div>
      ))}
      {!reachable && (
        <p className="text-xs text-warn">
          The parent&apos;s WhatsApp number isn&apos;t verified (or consent is missing), so there is no parent report and nothing can be queued for WhatsApp.{" "}
          <Link href={`/exam-prep/students/${studentId}`} className="text-accent hover:underline">
            Verify it on the student page
          </Link>
          .
        </p>
      )}
    </section>
  );
}
