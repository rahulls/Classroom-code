import Link from "next/link";
import { createPaperAction, deleteFormatAction, quizAction, saveFormatAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { rowsTotal, type AnswerRow } from "@/modules/exam-prep/domain/answer-rows";
import { listFormats } from "@/modules/exam-prep/services/answer-rows";
import { ActionButton, EpForm, Field, Msg, Submit } from "../../ui";

export const metadata = { title: "Papers" };

export default async function PapersPage() {
  const formats = await listFormats();
  const papers = await epdb.paper.findMany({ orderBy: [{ klass: "asc" }, { subject: "asc" }, { board: "asc" }, { number: "asc" }, { version: "asc" }], include: { _count: { select: { items: true, submissions: true } } } });
  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Papers</h1>
        <Link href="/exam-prep/settings/chapters" className="ml-auto text-sm text-accent hover:underline">
          Chapter lists →
        </Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Paper</th>
              <th>Title</th>
              <th>Kind</th>
              <th>Status</th>
              <th className="text-right">Questions</th>
              <th className="text-right">Sheets</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {papers.map((p) => (
              <tr key={p.id} className={p.isCurrent ? "" : "opacity-50"}>
                <td className="font-mono text-xs">
                  <Link href={`/exam-prep/papers/${p.id}`} className="text-accent hover:underline">
                    {p.id}
                  </Link>
                </td>
                <td>{p.title}</td>
                <td>
                  {p.isDiagnostic ? "diagnostic" : p.kind}
                  {p.uploadOnly && <span className="ml-1 rounded bg-soft px-1 text-[10px]">uploaded file</span>}
                </td>
                <td>{p.status}</td>
                <td className="text-right">{p.uploadOnly ? "-" : p._count.items}</td>
                <td className="text-right">{p._count.submissions}</td>
                <td className="text-xs">{p.dueAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) ?? "-"}</td>
              </tr>
            ))}
            {!papers.length && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted">
                  No papers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold text-[#0f3460]">New paper</h2>
          <p className="text-xs text-muted">
            Two ways: <b>upload your own PDF</b> (marked row by row with the class&apos;s marking format below), or <b>build question by question</b>, typed in or imported from a CSV (
            <a href="/exam-prep/templates?kind=questions" className="text-accent hover:underline">
              download the questions CSV template
            </a>
            ). Question-by-question papers get AI marking, chapter analytics and reports. Paper 0 is the diagnostic.
          </p>
          <EpForm action={createPaperAction} className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Msg />
            </div>
            <Field label="Class" req>
              <select name="klass" className="input">
                {[9, 10, 11, 12].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Subject" req>
              <select name="subject" className="input">
                {["Maths", "Science", "Physics", "Chemistry"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Board" req>
              <select name="board" className="input">
                {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="Number" req>
              <input name="number" type="number" min={0} max={99} defaultValue={1} className="input" />
            </Field>
            <Field label="Kind">
              <select name="kind" className="input">
                <option value="paper">Weekly paper</option>
                <option value="mock">Timed full-length mock</option>
              </select>
            </Field>
            <Field label="Mock minutes">
              <input name="mockMinutes" type="number" min={30} max={240} placeholder="180" className="input" />
            </Field>
            <Field label="Title">
              <input name="title" className="input sm:col-span-2" placeholder="Paper 1" />
            </Field>
            <Field label="How you'll make it" req>
              <select name="mode" className="input">
                <option value="upload">Upload my own file (PDF or CSV)</option>
                <option value="questions">Build question by question</option>
              </select>
            </Field>
            <Field label="Total marks" hint="For an uploaded paper (taken from the marking format if blank)">
              <input name="totalMarks" type="number" min={1} step={0.5} className="input" />
            </Field>
            <Field label="Paper file" hint="PDF or CSV (you can add it later too)">
              <input name="file" type="file" accept=".pdf,.csv" className="input" />
            </Field>
            <div className="self-end">
              <Submit>Create</Submit>
            </div>
          </EpForm>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold text-[#0f3460]">10-minute chapter quiz</h2>
          <p className="text-xs text-muted">Auto-scored MCQs from the bank, for one chapter.</p>
          <EpForm action={quizAction} className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Msg />
            </div>
            <select name="klass" className="input">
              {[9, 10, 11, 12].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <select name="subject" className="input">
              {["Maths", "Science", "Physics", "Chemistry"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <select name="board" className="input">
              {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <input name="chapter" placeholder="Chapter" required className="input" />
            <Submit tone="plain">Make the quiz</Submit>
          </EpForm>
          <p className="text-xs text-muted">
            Formula sheets: open a chapter at <code>/exam-prep/papers/formula?klass=10&amp;subject=Maths&amp;chapter=…</code>
          </p>
        </section>
      </div>
      <section id="formats" className="card space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-[#0f3460]">Marking formats</h2>
          <span className="text-xs text-muted">The fixed answer rows (answer number and max marks) for each class, board and subject. A new uploaded paper copies its format; each paper can then be adjusted on its own page.</span>
        </div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Class</th>
              <th>Board</th>
              <th>Subject</th>
              <th className="text-right">Rows</th>
              <th className="text-right">Marks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {formats.map((f) => {
              const rows = f.rows as AnswerRow[];
              return (
                <tr key={f.id}>
                  <td>{f.klass}</td>
                  <td>{f.board}</td>
                  <td>{f.subject}</td>
                  <td className="text-right">{rows.length}</td>
                  <td className="text-right">{rowsTotal(rows)}</td>
                  <td className="flex flex-wrap items-center justify-end gap-2">
                    <a href={`/exam-prep/templates?kind=format&id=${f.id}`} className="text-xs text-accent hover:underline">
                      Download CSV
                    </a>
                    <ActionButton action={deleteFormatAction} fields={{ formatId: f.id }} tone="danger" confirm={`Delete the Class ${f.klass} ${f.board} ${f.subject} format? Papers already using it keep their rows.`}>
                      Delete
                    </ActionButton>
                  </td>
                </tr>
              );
            })}
            {!formats.length && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted">
                  No formats yet. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <EpForm action={saveFormatAction} className="grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-4">
            <Msg />
          </div>
          <Field label="Class" req>
            <select name="klass" className="input" defaultValue="10">
              {[9, 10, 11, 12].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="Board" req>
            <select name="board" className="input">
              {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field label="Subject" req>
            <select name="subject" className="input">
              {["Maths", "Science", "Physics", "Chemistry"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="CSV file" hint="Or type the rows below">
            <input type="file" name="csv" accept=".csv,.txt" className="input" />
          </Field>
          <div className="sm:col-span-4">
            <textarea name="rows" rows={5} placeholder={"answer,max,section,chapter,choice\n1,1,A,,\n21.A,2,B,,21\n21.B,2,B,,21"} className="input w-full font-mono text-xs" aria-label="Answer rows" />
          </div>
          <p className="text-xs text-muted sm:col-span-3">
            One line per answer: answer number (1, 1.1, 4.a, 36.iii.A), max marks, then optional section, chapter and choice. Rows sharing a choice key are OR alternatives (counted once).{" "}
            <a href="/exam-prep/templates?kind=format-template" className="text-accent hover:underline">
              Example CSV
            </a>
            . Saving a format that exists replaces it (papers already created keep theirs).
          </p>
          <div className="self-end">
            <Submit>Save format</Submit>
          </div>
        </EpForm>
      </section>
    </div>
  );
}
