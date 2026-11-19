import Link from "next/link";
import { addPendingAction, addStudentAction, importIntakeAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { SUBJECTS_BY_CLASS } from "@/modules/exam-prep/domain/programme";
import { intakeSummary } from "@/modules/exam-prep/services/people";
import { EpForm, Field, IntakeFields, Msg, Submit } from "../../ui";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; klass?: string; board?: string; status?: string }> }) {
  const f = await searchParams;
  const where = {
    ...(f.klass ? { klass: Number(f.klass) } : {}),
    ...(f.board ? { board: f.board } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, { code: { contains: f.q.toUpperCase() } }] } : {}),
  };
  const [students, summary] = await Promise.all([epdb.student.findMany({ where, include: { parents: true }, orderBy: [{ klass: "asc" }, { code: "asc" }] }), intakeSummary()]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Students</h1>
        <span className="text-sm text-muted">{students.length} shown</span>
        <div className="ml-auto flex gap-2 text-sm">
          <Link href="/exam-prep/verify" className="btn">
            Verify numbers
          </Link>
          <a href="/exam-prep/students/labels" className="btn">
            Labels CSV
          </a>
        </div>
      </div>

      <section className="card">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Intake by class and board</h2>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Class</th>
              <th>Board</th>
              <th className="text-right">Students</th>
              <th>Advice</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={`${r.klass}${r.board}`}>
                <td>{r.klass}</td>
                <td>{r.board}</td>
                <td className="text-right">{r.count}</td>
                <td>{r.adviceText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form className="flex flex-wrap gap-2 text-sm">
        <input name="q" defaultValue={f.q} placeholder="Search name or code" className="input w-48" />
        <select name="klass" defaultValue={f.klass ?? ""} className="input w-auto">
          <option value="">All classes</option>
          {[9, 10, 11, 12].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select name="board" defaultValue={f.board ?? ""} className="input w-auto">
          <option value="">All boards</option>
          {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <select name="status" defaultValue={f.status ?? ""} className="input w-auto">
          <option value="">Any status</option>
          {["free", "paid1", "paid2", "opted_out"].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Class</th>
              <th>Board</th>
              <th>Subjects</th>
              <th>Consent</th>
              <th>Number</th>
              <th>Rank consent</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const p = s.parents[0];
              return (
                <tr key={s.id} className={s.status === "opted_out" ? "opacity-50" : ""}>
                  <td className="font-mono text-xs">{s.code}</td>
                  <td>
                    <Link href={`/exam-prep/students/${s.id}`} className="text-accent hover:underline">
                      {s.name}
                    </Link>
                    {s.isDemo && <span className="ml-1 rounded bg-soft px-1 text-[10px]">demo</span>}
                    {s.manualPath && <span className="ml-1 rounded bg-warn/20 px-1 text-[10px]">manual</span>}
                  </td>
                  <td>{s.klass}</td>
                  <td>{s.board === "State" ? `State (${s.stateBoard})` : s.board}</td>
                  <td>{s.subjects.join(", ")}</td>
                  <td>{p?.consentAt ? <span className="text-ok">v{p.consentTextVersion}</span> : <span className="text-bad">pending</span>}</td>
                  <td>{p?.optedOutAt ? <span className="text-muted">opted out</span> : p?.numberVerifiedAt ? <span className="text-ok">verified</span> : <span className="text-warn">unverified</span>}</td>
                  <td>{s.rankConsent ? "Yes" : "No"}</td>
                  <td>{s.label}</td>
                </tr>
              );
            })}
            {!students.length && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-muted">
                  No students yet. Import the Google Form responses or add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold text-[#0f3460]">Import the intake form (CSV)</h2>
          <p className="text-xs text-muted">
            In Google Forms → Responses → Download responses (.csv). Columns used: Student name, Class, Board, State board name, Medium, Subjects, School, Last exam range, Parent name, Parent WhatsApp, Parent
            email, Report language, Parent consent, Rank consent, Report timing. All rows are checked first: if any row has a problem, nothing is imported.
          </p>
          <EpForm action={importIntakeAction} className="space-y-2">
            <Msg />
            <input type="file" name="csv" accept=".csv" required className="input" />
            <Submit>Import</Submit>
          </EpForm>
          <h2 className="pt-3 font-semibold text-[#0f3460]">On the roll, intake pending</h2>
          <p className="text-xs text-muted">For a student in the group who hasn't filled the form: they count as missing, but nothing is processed until consent is recorded.</p>
          <EpForm action={addPendingAction} className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Msg />
            </div>
            <input name="name" placeholder="Student name" required className="input" />
            <select name="klass" className="input">
              {[9, 10, 11, 12].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <select name="board" className="input">
              {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <select name="subjects[]" className="input">
              {["Maths", "Science", "Physics", "Chemistry"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <input name="parentWhatsapp" placeholder="Parent WhatsApp (optional)" className="input sm:col-span-2" />
            <Submit tone="plain">Add to the roll</Submit>
          </EpForm>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold text-[#0f3460]">Add a student</h2>
          <EpForm action={addStudentAction} className="space-y-3">
            <Msg />
            <IntakeFields subjectsByClass={SUBJECTS_BY_CLASS} />
            <Field label="">
              <Submit>Add student</Submit>
            </Field>
          </EpForm>
        </section>
      </div>
    </div>
  );
}
