import Link from "next/link";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { sheetScore } from "@/modules/exam-prep/domain/answer-rows";
import { paperRows } from "@/modules/exam-prep/services/answer-rows";
import { RowGrid } from "./row-grid";

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
              <Link key={s.id} href={`?sheet=${s.id}`} className={`rounded border px-2 py-1 ${s.id === current?.s.id ? "border-accent bg-accent/10" : "border-line"}`}>
                {s.student.code} · {score.got}/{score.max}
                {score.open ? <span className="text-warn"> •</span> : <span className="text-ok"> ✓</span>}
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
                <RowGrid key={current.s.id} submissionId={current.s.id} rows={rows} saved={Object.fromEntries(current.s.rowMarks.map((m) => [m.label, { marks: m.marks, errorTag: m.errorTag }]))} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
