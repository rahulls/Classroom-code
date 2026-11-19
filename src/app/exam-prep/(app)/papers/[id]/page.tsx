import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addQuestionAction,
  approveReportsAction,
  classNoteAction,
  cloneAction,
  generateReportsAction,
  importQuestionsAction,
  mcqImportAction,
  newVersionAction,
  paperPostsAction,
  pdfsAction,
  publishAction,
  reminderAction,
  removeQuestionAction,
  reuseQuestionAction,
  submissionAction,
} from "@/modules/exam-prep/actions";
import { signedLink, storage } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { classView } from "@/modules/exam-prep/services/analytics";
import { tracker } from "@/modules/exam-prep/services/calendar";
import { chapterList, paperCheck, paperWithQuestions } from "@/modules/exam-prep/services/papers";
import { ActionButton, EpForm, Field, Msg, Submit } from "../../../ui";
import { PaperFiles } from "./paper-files";

export const metadata = { title: "Paper" };

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await paperWithQuestions(decodeURIComponent(id));
  if (!p) notFound();
  const [check, chapters, track, bank, view, reports] = await Promise.all([
    paperCheck(p.id),
    chapterList(p.klass, p.subject, p.board),
    p.status === "draft" ? Promise.resolve([]) : tracker(p.id),
    p.status === "draft" ? epdb.question.findMany({ where: { klass: p.klass, subject: p.subject, uses: { none: { paperId: p.id } } }, orderBy: { createdAt: "desc" }, take: 30 }) : Promise.resolve([]),
    p.status === "draft" ? Promise.resolve(null) : classView(p.id),
    epdb.reportCard.groupBy({ by: ["status"], where: { paperId: p.id }, _count: { _all: true } }),
  ]);
  const pdfs = ["paper", "key", "solutions"].map((m) => ({ m, rel: `papers/${p.id}/${p.id}-${m}.pdf` })).filter((x) => storage.exists(x.rel));
  const draft = p.status === "draft";
  const up = p.uploadOnly;
  const submitted = track.filter((t) => t.submission);
  return (
    <div className="space-y-5">
      <div>
        <Link href="/exam-prep/papers" className="text-sm text-accent hover:underline">
          ← Papers
        </Link>
        <h1 className="text-2xl font-bold text-[#0f3460]">
          {p.title} <span className="font-mono text-base text-muted">{p.id}</span>
        </h1>
        <p className="text-sm text-muted">
          Class {p.klass} {p.board} {p.subject} · {p.kind}
          {p.mockMinutes ? ` (${p.mockMinutes} min)` : ""} · status <b>{p.status}</b> ·{" "}
          {up ? `${p.totalMarks ?? "?"} marks · uploaded file` : `${check.total} marks · MCQ ${Math.round(check.mcqShare)}% · ${check.chapters.length} chapters`}
          {p.dueAt && ` · due ${p.dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}`}
        </p>
      </div>

      {!up && (check.problems.length > 0 || check.warnings.length > 0) && (
        <div className="card space-y-1 text-sm">
          {check.problems.map((x) => (
            <p key={x} className="text-bad">
              ✗ {x}
            </p>
          ))}
          {check.warnings.map((x) => (
            <p key={x} className="text-warn">
              ! {x}
            </p>
          ))}
        </div>
      )}

      <section className="card flex flex-wrap items-center gap-2 text-sm">
        {draft ? (
          <ActionButton action={publishAction} fields={{ paperId: p.id }} tone="primary" confirm="Publish? The paper can't be edited after this (only versioned).">
            Publish
          </ActionButton>
        ) : (
          !up && (
            <ActionButton action={newVersionAction} fields={{ paperId: p.id }}>
              New version
            </ActionButton>
          )
        )}
        {!draft && (
          <ActionButton action={paperPostsAction} fields={{ paperId: p.id }}>
            Draft group posts
          </ActionButton>
        )}
        {!up && (
          <>
        <EpForm action={cloneAction} className="flex items-center gap-1">
          <input type="hidden" name="paperId" value={p.id} />
          <select name="board" className="input w-auto py-1 text-xs">
            {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"]
              .filter((b) => b !== p.board)
              .map((b) => (
                <option key={b}>{b}</option>
              ))}
          </select>
          <Submit tone="plain" className="px-2 py-1 text-xs">
            Clone to board
          </Submit>
        </EpForm>
        <ActionButton action={pdfsAction} fields={{ paperId: p.id }}>
          Make PDFs
        </ActionButton>
        {pdfs.map((x) => (
          <a key={x.m} href={signedLink(x.rel)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {x.m} PDF
          </a>
        ))}
        <a href={`/exam-prep/papers/${encodeURIComponent(p.id)}/export`} className="text-accent hover:underline">
          Export questions (JSON)
        </a>
          </>
        )}
        {!draft && !up && (
          <Link href={`/exam-prep/papers/${encodeURIComponent(p.id)}/marking`} className="btn-primary ml-auto px-3 py-1">
            Marking →
          </Link>
        )}
      </section>

      <PaperFiles paperId={p.id} uploadOnly={up} />

      {!up && (
      <section className="card">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Questions</h2>
        {p.sections.map((sec) => (
          <div key={sec.id} className="mb-3">
            <h3 className="text-sm font-semibold">
              Section {sec.name} <span className="font-normal text-muted">({sec.type})</span>
            </h3>
            <ul className="divide-y divide-line text-sm">
              {p.items
                .filter((i) => i.sectionId === sec.id)
                .map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start gap-2 py-1.5">
                    <b className="w-6">{i.number}.</b>
                    <span className="flex-1">
                      {i.question.text}
                      <span className="block text-xs text-muted">
                        {i.question.chapter} · {i.question.topic} · {i.question.difficulty} · {i.question.marks} mark{i.question.marks === 1 ? "" : "s"}
                        {i.question.type === "mcq" ? ` · answer ${i.question.correctOption}` : ` · scheme: ${((i.question.markingScheme as { step: string; marks: number }[]) ?? []).map((s) => `${s.step} [${s.marks}]`).join("; ")}`}
                      </span>
                    </span>
                    {draft && (
                      <ActionButton action={removeQuestionAction} fields={{ paperId: p.id, pqId: i.id }} tone="danger">
                        Remove
                      </ActionButton>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-muted">
          Marks by chapter:{" "}
          {Object.entries(check.byChapter)
            .map(([c, m]) => `${c} ${m}`)
            .join(" · ") || "none yet"}
        </p>
      </section>
      )}

      {draft && !up && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card space-y-2">
            <h2 className="font-semibold text-[#0f3460]">Add a question</h2>
            <EpForm action={addQuestionAction} className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Msg />
              </div>
              <input type="hidden" name="paperId" value={p.id} />
              <Field label="Section" req>
                <select name="sectionId" className="input">
                  {p.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type" req>
                <select name="type" className="input">
                  {["mcq", "short", "long", "case", "assertion"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Chapter" req>
                <select name="chapter" className="input">
                  {chapters.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Topic" req>
                <input name="topic" required className="input" />
              </Field>
              <Field label="Marks" req>
                <input name="marks" type="number" min={0.5} step={0.5} required className="input" />
              </Field>
              <Field label="Difficulty" req>
                <select name="difficulty" className="input">
                  <option>easy</option>
                  <option>medium</option>
                  <option>hard</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Question" req>
                  <textarea name="text" required rows={3} className="input" />
                </Field>
              </div>
              <Field label="MCQ options" hint="A-D (MCQ only)">
                <div className="grid grid-cols-2 gap-1">
                  {["a", "b", "c", "d"].map((o) => (
                    <input key={o} name={o} placeholder={o.toUpperCase()} className="input" />
                  ))}
                </div>
              </Field>
              <Field label="Correct option" hint="MCQ only">
                <select name="correctOption" className="input">
                  <option value="">-</option>
                  {["A", "B", "C", "D"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Marking scheme" hint='Written questions: one step per line ending with its marks, e.g. "Correct formula: 1". Must add up to the marks.'>
                  <textarea name="scheme" rows={3} className="input font-mono text-xs" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Worked solution">
                  <textarea name="solution" rows={2} className="input" />
                </Field>
              </div>
              <Submit>Add question</Submit>
            </EpForm>
          </section>
          <section className="card space-y-3">
            <h2 className="font-semibold text-[#0f3460]">From the bank</h2>
            <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
              {bank.map((q) => (
                <li key={q.id} className="flex items-center gap-2 py-1.5">
                  <span className="flex-1">
                    {q.text.slice(0, 90)}
                    <span className="block text-xs text-muted">
                      {q.chapter} · {q.type} · {q.marks}
                    </span>
                  </span>
                  <ActionButton action={reuseQuestionAction} fields={{ paperId: p.id, sectionId: (p.sections.find((s) => (q.type === "mcq" ? s.type === "mcq" : s.type !== "mcq")) ?? p.sections[0]!).id, questionId: q.id }}>
                    Add
                  </ActionButton>
                </li>
              ))}
              {!bank.length && <li className="py-2 text-muted">No other questions for this class and subject yet.</li>}
            </ul>
            <h2 className="font-semibold text-[#0f3460]">Import questions</h2>
            <p className="text-xs text-muted">JSON (as exported) or CSV with columns section, chapter, topic, marks, type, difficulty, text, option_a-d, correct_option, scheme ("step:marks|step:marks"), solution.</p>
            <EpForm action={importQuestionsAction} className="space-y-2">
              <Msg />
              <input type="hidden" name="paperId" value={p.id} />
              <input type="file" name="file" accept=".json,.csv" required className="input" />
              <Submit tone="plain">Import</Submit>
            </EpForm>
          </section>
        </div>
      )}

      {!draft && (
        <>
          <section className="card space-y-3">
            <h2 className="font-semibold text-[#0f3460]">
              Tracker: {submitted.length} of {track.length} submitted
            </h2>
            <div className="overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Status</th>
                    <th>Flags</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {track.map(({ student, submission, reminded }) => (
                    <tr key={student.id}>
                      <td>
                        <Link href={`/exam-prep/students/${student.id}`} className="text-accent hover:underline">
                          {student.name}
                        </Link>{" "}
                        <span className="font-mono text-xs text-muted">{student.code}</span>
                        {!student.parents.some((x) => x.consentAt) && <span className="ml-1 text-xs text-bad">intake pending</span>}
                      </td>
                      <td>{submission ? `${submission.isLate ? "late · " : ""}${submission.status}` : <span className="text-warn">missing</span>}</td>
                      <td className="text-xs">{submission?.flags.join(", ")}</td>
                      <td>
                        {submission ? (
                          <a href={signedLink((submission.files as { path: string }[])[0]?.path ?? "")} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                            sheet
                          </a>
                        ) : reminded ? (
                          <span className="text-xs text-muted">reminder drafted</span>
                        ) : (
                          student.parents.some((x) => x.consentAt) && (
                            <ActionButton action={reminderAction} fields={{ studentId: student.id, paperId: p.id }}>
                              Draft private reminder
                            </ActionButton>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card space-y-2">
              <h2 className="font-semibold text-[#0f3460]">File a sheet</h2>
              <p className="text-xs text-muted">From the Google Form's upload folder or a WhatsApp DM. One PDF, or up to the photo limit (joined in page order into one PDF).</p>
              <EpForm action={submissionAction} className="grid gap-2">
                <Msg />
                <input type="hidden" name="paperId" value={p.id} />
                <select name="studentId" className="input" required>
                  {track
                    .filter((t) => t.student.parents.some((x) => x.consentAt))
                    .map((t) => (
                      <option key={t.student.id} value={t.student.id}>
                        {t.student.code} {t.student.name}
                        {t.submission ? " (replace)" : ""}
                      </option>
                    ))}
                </select>
                <input type="file" name="files[]" multiple accept=".pdf,.jpg,.jpeg,.png" required className="input" />
                <select name="source" className="input">
                  <option value="google_form">Google Form upload</option>
                  <option value="dm_manual">WhatsApp DM (manual path)</option>
                </select>
                {!up && <input name="mcq" placeholder="MCQ answers in order, e.g. ABCAD (or 1:A 2:C)" className="input font-mono" />}
                <input name="times" placeholder="Time per section (optional), e.g. A:20, B:35" className="input" />
                <input name="submittedAt" type="datetime-local" className="input" title="When it was submitted (default now)" />
                <Submit>File the sheet</Submit>
              </EpForm>
              {!up && <h3 className="pt-2 text-sm font-semibold">MCQ answers from the form (CSV)</h3>}
              {!up && <EpForm action={mcqImportAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="paperId" value={p.id} />
                <input type="file" name="file" accept=".csv" required className="input flex-1" />
                <Submit tone="plain">Import answers</Submit>
                <Msg />
              </EpForm>}
            </section>
            {up ? (
              <section className="card space-y-2 text-sm">
                <h2 className="font-semibold text-[#0f3460]">Marking and reports</h2>
                <p className="text-muted">
                  This paper is your own uploaded file, so the app keeps the tracker and the filed sheets. AI marking, chapter analytics and the automatic reports need a paper built question by question.
                </p>
              </section>
            ) : (
            <section className="card space-y-2 text-sm">
              <h2 className="font-semibold text-[#0f3460]">Class view</h2>
              {view?.hidden ? (
                <p className="text-muted">Cohort of {view.cohortSize}: group figures are hidden below the minimum cohort size.</p>
              ) : (
                view?.average && (
                  <>
                    <p>
                      Submission rate {view.submissionRate == null ? "-" : `${Math.round(view.submissionRate)}%`} ({view.submitted}/{view.roll}). Weakest: <b>{view.weakest?.map((w) => w.chapter).join(" and ")}</b>
                    </p>
                    <ul>
                      {view.average.map((a) => (
                        <li key={a.chapter}>
                          {a.chapter}: {a.display}%
                        </li>
                      ))}
                    </ul>
                  </>
                )
              )}
              <h2 className="pt-2 font-semibold text-[#0f3460]">Reports</h2>
              <p className="text-xs text-muted">{reports.map((r) => `${r._count._all} ${r.status}`).join(" · ") || "None yet."}</p>
              <div className="flex flex-wrap gap-2">
                <ActionButton action={generateReportsAction} fields={{ paperId: p.id }}>
                  Generate reports
                </ActionButton>
                <ActionButton action={approveReportsAction} fields={{ paperId: p.id }} tone="primary" confirm="Approve and deliver this paper's reports?">
                  Approve and deliver
                </ActionButton>
                <ActionButton action={classNoteAction} fields={{ paperId: p.id }}>
                  Draft class note
                </ActionButton>
                <Link href="/exam-prep/reports" className="btn px-2 py-1 text-xs">
                  Send queue →
                </Link>
              </div>
            </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
