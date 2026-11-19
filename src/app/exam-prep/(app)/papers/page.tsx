import Link from "next/link";
import { createPaperAction, quizAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { EpForm, Field, Msg, Submit } from "../../ui";

export const metadata = { title: "Papers" };

export default async function PapersPage() {
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
                <td>{p.isDiagnostic ? "diagnostic" : p.kind}</td>
                <td>{p.status}</td>
                <td className="text-right">{p._count.items}</td>
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
          <p className="text-xs text-muted">Paper 0 is the diagnostic. The sections come from the board's pattern template (Settings → Papers).</p>
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
    </div>
  );
}
