import Link from "next/link";
import { loadFormatAction, paperRowsAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { rowsToCsv, rowsTotal } from "@/modules/exam-prep/domain/answer-rows";
import { getFormat, paperRows } from "@/modules/exam-prep/services/answer-rows";
import { ActionButton, EpForm, Msg, Submit } from "../../../ui";

/** An uploaded paper's answer rows: what the marking grid shows (answer number and max marks). */
export async function AnswerRowsCard({ paper }: { paper: { id: string; klass: number; board: string; subject: string; totalMarks: number | null; answerRows: unknown } }) {
  const rows = paperRows(paper);
  const [format, marked] = await Promise.all([getFormat(paper.klass, paper.board, paper.subject), epdb.rowMark.count({ where: { submission: { paperId: paper.id } } })]);
  const total = rowsTotal(rows);
  const mismatch = rows.length > 0 && paper.totalMarks != null && total !== paper.totalMarks;
  const choices = new Set(rows.filter((r) => r.choice).map((r) => r.choice)).size;
  return (
    <section className="card space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-[#0f3460]">Answer rows (marking format)</h2>
        <span className="text-xs text-muted">
          {rows.length ? `${rows.length} rows · ${total} marks${choices ? ` · ${choices} OR choice${choices === 1 ? "" : "s"}` : ""}` : "none yet"}
        </span>
        {rows.length > 0 && (
          <a href={`/exam-prep/templates?kind=rows&paper=${encodeURIComponent(paper.id)}`} className="ml-auto text-xs text-accent hover:underline">
            Download as CSV
          </a>
        )}
      </div>
      {mismatch && (
        <p className="text-xs text-warn">
          The rows add up to {total} but the paper says {paper.totalMarks} marks. Check the rows (OR alternatives count once when they share a choice key).
        </p>
      )}
      {!rows.length && (
        <p className="text-xs text-warn">
          Add the answer rows to mark sheets row by row.{" "}
          {format ? `A Class ${paper.klass} ${paper.board} ${paper.subject} format exists: load it below.` : (
            <>
              No format for Class {paper.klass} {paper.board} {paper.subject} yet: add one under{" "}
              <Link href="/exam-prep/papers#formats" className="text-accent hover:underline">
                Papers → Marking formats
              </Link>{" "}
              (used for every future paper), or type this paper&apos;s rows below.
            </>
          )}
        </p>
      )}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs">
          {rows.map((r) => (
            <span key={r.label} className="rounded border border-line px-1.5 py-0.5" title={[r.section && `Section ${r.section}`, r.chapter, r.choice && `choice ${r.choice}`].filter(Boolean).join(" · ")}>
              <b>{r.label}</b> · {r.max}
              {r.choice ? <span className="text-muted"> (OR)</span> : null}
            </span>
          ))}
        </div>
      )}
      {marked > 0 ? (
        <p className="text-xs text-muted">{marked} row marks are saved on these rows, so the rows are locked.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <EpForm action={paperRowsAction} className="space-y-2">
            <input type="hidden" name="paperId" value={paper.id} />
            <textarea name="rows" rows={8} defaultValue={rows.length ? rowsToCsv(rows) : "answer,max,section,chapter,choice\n1,1,A,,\n2.a,2,B,,\n2.b,2,B,,\n"} className="input w-full font-mono text-xs" aria-label="Answer rows CSV" />
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" name="csv" accept=".csv,.txt" className="input w-auto text-xs" aria-label="Or upload a rows CSV" />
              <Submit tone="plain">Save rows</Submit>
              <Msg />
            </div>
          </EpForm>
          <div className="space-y-2 text-xs text-muted">
            <p>
              One line per answer: <code>answer,max</code>, then optional <code>section</code>, <code>chapter</code>, <code>choice</code>. Answers like <code>1.1</code>, <code>4.a</code>, <code>36.iii.A</code> are fine.
            </p>
            <p>
              OR questions: give the alternatives the same <code>choice</code> key (e.g. <code>21.A</code> and <code>21.B</code> with choice <code>21</code>); they count once in the total and you mark the one attempted.
            </p>
            {format && (
              <ActionButton action={loadFormatAction} fields={{ paperId: paper.id }} confirm={rows.length ? "Replace these rows with the class format?" : undefined}>
                Load Class {paper.klass} {paper.board} {paper.subject} format ({format.length} rows)
              </ActionButton>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
