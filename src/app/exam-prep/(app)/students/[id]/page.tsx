import Link from "next/link";
import { notFound } from "next/navigation";
import {
  consentAction,
  deleteStudentAction,
  optOutAction,
  parentReplyAction,
  paymentAction,
  planAction,
  updateStudentAction,
  verifyAction,
  welcomeAction,
} from "@/modules/exam-prep/actions";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { subjectsFor } from "@/modules/exam-prep/domain/programme";
import { sheetAnalytics, studentHistory } from "@/modules/exam-prep/services/analytics";
import { rankTrend } from "@/modules/exam-prep/services/ranking";
import { ActionButton, EpForm, Field, Msg, Submit } from "../../../ui";

export const metadata = { title: "Student" };

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const st = await epdb.student.findUnique({
    where: { id },
    include: { parents: true, submissions: { where: { isCurrent: true }, include: { paper: true }, orderBy: { createdAt: "desc" } }, reports: { orderBy: { createdAt: "desc" } }, plans: true, payments: true, offers: true },
  });
  if (!st) notFound();
  const ranks = await rankTrend(st.id);
  const histories = await Promise.all(st.subjects.map(async (s) => ({ subject: s, h: await studentHistory(st.id, s) })));
  const latest = st.submissions[0] ? await sheetAnalytics(st.id, st.submissions[0].paperId) : null;
  return (
    <div className="space-y-5">
      <div>
        <Link href="/exam-prep/students" className="text-sm text-accent hover:underline">
          ← Students
        </Link>
        <h1 className="text-2xl font-bold text-[#0f3460]">
          {st.name} <span className="font-mono text-base text-muted">{st.code}</span>
        </h1>
        <p className="text-sm text-muted">
          Class {st.klass} · {st.board} · {st.subjects.join(", ")} · {st.status} · label {st.label}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold text-[#0f3460]">Details</h2>
          <EpForm action={updateStudentAction} reset={false} className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Msg />
            </div>
            <input type="hidden" name="id" value={st.id} />
            <Field label="Name" req>
              <input name="name" defaultValue={st.name} className="input" required />
            </Field>
            <Field label="Class" req>
              <select name="klass" defaultValue={st.klass} className="input">
                {[9, 10, 11, 12].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Board" req>
              <select name="board" defaultValue={st.board} className="input">
                {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="State board name" hint="State board only">
              <input name="stateBoard" defaultValue={st.stateBoard ?? ""} className="input" />
            </Field>
            <Field label="School">
              <input name="school" defaultValue={st.school ?? ""} className="input" />
            </Field>
            <fieldset className="text-sm">
              <legend className="label">Subjects</legend>
              {["Maths", "Science", "Physics", "Chemistry"].map((s) => (
                <label key={s} className="mr-3 inline-flex items-center gap-1">
                  <input type="checkbox" name="subjects[]" value={s} defaultChecked={st.subjects.includes(s)} disabled={!subjectsFor(st.klass).includes(s) && !st.subjects.includes(s)} /> {s}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="rankConsent" defaultChecked={st.rankConsent} /> Rank told personally
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="manualPath" defaultChecked={st.manualPath} /> Manual path (tutor files sheets)
            </label>
            <div className="sm:col-span-2">
              <Submit>Save</Submit>
            </div>
          </EpForm>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-[#0f3460]">Parents</h2>
          {st.parents.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border border-line p-3 text-sm">
              <div>
                <b>{p.name}</b> · <span className="font-mono text-xs">{p.whatsapp}</span> {p.email && <span className="text-xs text-muted">· {p.email}</span>}
              </div>
              <div className="text-xs text-muted">
                Consent: {p.consentAt ? `v${p.consentTextVersion}, ${p.consentAt.toLocaleDateString("en-IN")}` : "not yet"} · Number: {p.numberVerifiedAt ? "verified" : "unverified"} · Language: {p.language} · Report timing: {p.reportTiming}
                {p.optedOutAt && <b className="text-bad"> · opted out</b>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!p.consentAt && (
                  <ActionButton action={consentAction} fields={{ parentId: p.id }}>
                    Consent received
                  </ActionButton>
                )}
                {!p.numberVerifiedAt && (
                  <ActionButton action={verifyAction} fields={{ parentId: p.id }}>
                    Mark verified
                  </ActionButton>
                )}
                <ActionButton action={welcomeAction} fields={{ parentId: p.id }}>
                  Welcome pack
                </ActionButton>
                <ActionButton action={parentReplyAction} fields={{ parentId: p.id, paperId: st.submissions[0]?.paperId ?? "" }}>
                  Log a reply
                </ActionButton>
                {!p.optedOutAt && (
                  <ActionButton action={optOutAction} fields={{ parentId: p.id }} tone="danger" confirm="Opt this parent out (STOP)?">
                    STOP: opt out
                  </ActionButton>
                )}
              </div>
            </div>
          ))}
          {st.status !== "opted_out" && (
            <ActionButton action={optOutAction} fields={{ studentId: st.id }} tone="danger" confirm="Opt the student and parents out of everything?">
              Opt the student out
            </ActionButton>
          )}
        </section>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold text-[#0f3460]">Progress</h2>
        {histories.map(({ subject, h }) => (
          <div key={subject} className="text-sm">
            <b>{subject}:</b> {h.papers.length ? h.papers.map((p) => `P${p.number} ${Math.round(p.pct)}%`).join(" → ") : "no marked papers yet"}
            {h.repeatingGaps.length > 0 && <span className="ml-2 text-bad">Repeating gap: {h.repeatingGaps.join(", ")}</span>}
          </div>
        ))}
        {latest && (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{latest.paper.id}: chapter</th>
                <th>Marks</th>
                <th>%</th>
                <th>Band</th>
                <th>Lost by error type</th>
              </tr>
            </thead>
            <tbody>
              {latest.rows.map((r) => (
                <tr key={r.chapter}>
                  <td>{r.chapter}</td>
                  <td>
                    {r.got}/{r.max}
                  </td>
                  <td>{r.display}%</td>
                  <td>{r.band}</td>
                  <td className="text-xs">
                    {Object.entries(latest.errorsByChapter[r.chapter] ?? {})
                      .map(([k, v]) => `${k.replace("_", " ")} ${v}`)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-xs text-muted">
          Ranks (teacher-only): {ranks.length ? ranks.map((r) => `${r.paperId}: ${r.rank ? `${r.rank}/${r.cohortSize}` : r.band}`).join(" · ") : "none yet"}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold text-[#0f3460]">Sheets and reports</h2>
          {st.submissions.map((s) => {
            const f = (s.files as { path: string; name: string }[])[0];
            return (
              <div key={s.id}>
                {s.paper.id} · {s.submittedAt.toLocaleDateString("en-IN")} · {s.status}
                {s.flags.length > 0 && <span className="text-warn"> ({s.flags.join(", ")})</span>}{" "}
                {f && (
                  <a href={signedLink(f.path)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    sheet
                  </a>
                )}
              </div>
            );
          })}
          {st.reports.map((r) => (
            <div key={r.id}>
              Report {r.paperId} ({r.audience}, {r.language}) · {r.status}{" "}
              {r.pdfPath && (
                <a href={signedLink(r.pdfPath)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  PDF
                </a>
              )}
            </div>
          ))}
        </section>
        <section className="card space-y-3 text-sm">
          <h2 className="font-semibold text-[#0f3460]">Plan and payments (teacher-only)</h2>
          {st.plans.map((p) => (
            <div key={p.id}>
              {p.tier} · {p.subjects} subject(s) · ₹{p.price - p.discount}
              {p.isTrial && " (trial)"} · from {p.startedAt.toLocaleDateString("en-IN")}
            </div>
          ))}
          {st.payments.map((p) => (
            <div key={p.id}>
              {p.receiptNo} · ₹{p.amount} · {p.method}{" "}
              <a href={signedLink(`receipts/${p.receiptNo}.pdf`)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                receipt
              </a>
            </div>
          ))}
          <EpForm action={planAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="studentId" value={st.id} />
            <select name="tier" className="input w-auto">
              <option value="paid1">Paid 1</option>
              <option value="paid2">Paid 2</option>
              <option value="free_report">Free report</option>
            </select>
            <input name="subjects" type="number" min={1} max={3} defaultValue={st.subjects.length} className="input w-20" />
            <label className="flex items-center gap-1">
              <input type="checkbox" name="isTrial" /> Trial
            </label>
            <Submit tone="plain">Start plan</Submit>
            <Msg />
          </EpForm>
          <EpForm action={paymentAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="studentId" value={st.id} />
            <input type="hidden" name="planId" value={st.plans.at(-1)?.id ?? ""} />
            <input name="amount" type="number" step="0.01" placeholder="₹ amount" required className="input w-28" />
            <select name="method" className="input w-auto">
              <option>UPI</option>
              <option>cash</option>
              <option>bank</option>
            </select>
            <input name="reference" placeholder="UTR / ref" className="input w-32" />
            <Submit tone="plain">Record payment</Submit>
            <Msg />
          </EpForm>
        </section>
      </div>

      <section className="card space-y-3 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Privacy</h2>
        <a href={`/exam-prep/students/${st.id}/export`} className="btn inline-block">
          ⬇ Export this student's data (ZIP)
        </a>
        <EpForm action={deleteStudentAction} className="flex flex-wrap items-end gap-2" confirm="Delete all of this student's data? This cannot be undone.">
          <input type="hidden" name="id" value={st.id} />
          <Field label="Right to delete: type DELETE">
            <input name="confirm" className="input w-32" />
          </Field>
          <Submit tone="danger">Delete everything</Submit>
          <Msg />
        </EpForm>
      </section>
    </div>
  );
}
