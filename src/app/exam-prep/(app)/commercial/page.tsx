import Link from "next/link";
import { answerDoubtAction, attendanceAction, attendeeAction, doubtAction, offerStatusAction, offersAction, sessionAction } from "@/modules/exam-prep/actions";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { getSettings } from "@/modules/exam-prep/settings";
import { ActionButton, EpForm, Msg, Submit } from "../../ui";

export const metadata = { title: "Plans" };

/** R10: offers, teaching sessions, doubt window, payments (teacher-only). */
export default async function CommercialPage() {
  const s = await getSettings();
  const [offers, sessions, doubts, payments, students] = await Promise.all([
    epdb.offer.findMany({ include: { student: true }, orderBy: { createdAt: "desc" } }),
    epdb.teachingSession.findMany({ include: { attendees: { include: { student: true } } }, orderBy: { startsAt: "desc" }, take: 30 }),
    epdb.doubt.findMany({ include: { student: true }, orderBy: { createdAt: "desc" }, take: 40 }),
    epdb.payment.findMany({ include: { student: true }, orderBy: { paidAt: "desc" }, take: 40 }),
    epdb.student.findMany({ where: { status: { not: "opted_out" } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const tiers = s["commercial.tiers"];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#0f3460]">Plans and teaching</h1>
        <p className="text-sm text-muted">
          {tiers.free_practice} · {tiers.free_report} · {tiers.paid1} (₹{s["commercial.prices"].paid1}/subject) · {tiers.paid2} (₹{s["commercial.prices"].paid2}/subject) · family discount {s["commercial.familyDiscountPct"]}% for 2+ subjects ·
          trial: {s["commercial.trial"]}. Start a plan from the student's page.
        </p>
      </div>

      <section className="card space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-[#0f3460]">Offers</h2>
          <span className="text-xs text-muted">Suggested after two reports when a weak chapter repeats.</span>
          <ActionButton action={offersAction} fields={{}}>
            Check now
          </ActionButton>
        </div>
        {offers.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <Link href={`/exam-prep/students/${o.studentId}`} className="w-48 text-accent hover:underline">
              {o.student.name}
            </Link>
            <span className="flex-1">
              {o.subject}: {o.chapter} <span className="text-xs text-muted">({o.reason})</span>
            </span>
            <b className="w-20">{o.status}</b>
            {o.status === "suggested" && (
              <>
                <Link href="/exam-prep/messages" className="btn px-2 py-1 text-xs">
                  Message
                </Link>
                <ActionButton action={offerStatusAction} fields={{ id: o.id, status: "sent" }} tone="primary">
                  Approved and sent
                </ActionButton>
              </>
            )}
            {o.status === "sent" && (
              <>
                <ActionButton action={offerStatusAction} fields={{ id: o.id, status: "accepted" }}>
                  Accepted
                </ActionButton>
                <ActionButton action={offerStatusAction} fields={{ id: o.id, status: "declined" }}>
                  Declined
                </ActionButton>
              </>
            )}
          </div>
        ))}
        {!offers.length && <p className="text-muted">No offers yet.</p>}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3 text-sm">
          <h2 className="font-semibold text-[#0f3460]">Sessions</h2>
          <EpForm action={sessionAction} className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Msg />
            </div>
            <select name="type" className="input">
              {["revision", "chapter", "doubt", "workshop", "mock", "parent_call"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
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
            <select name="subject" className="input">
              {["Maths", "Science", "Physics", "Chemistry"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <input name="chapter" placeholder="Chapter (the gap it fixes)" className="input" />
            <input name="capacity" type="number" min={1} defaultValue={10} className="input" />
            <input name="startsAt" type="datetime-local" required className="input sm:col-span-2" />
            <Submit tone="plain">Schedule</Submit>
          </EpForm>
          {sessions.map((x) => (
            <div key={x.id} className="space-y-1 border-t border-line pt-2">
              <div>
                <b>{x.type}</b> · Class {x.klass} {x.board} {x.subject}
                {x.chapter && ` · ${x.chapter}`} · {x.startsAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} · {x.attendees.length}/{x.capacity}
              </div>
              <div className="flex flex-wrap gap-2">
                {x.attendees.map((a) => (
                  <ActionButton key={a.id} action={attendanceAction} fields={{ sessionId: x.id, studentId: a.studentId, attended: a.attended ? "false" : "true" }}>
                    {a.student.name} {a.attended == null ? "?" : a.attended ? "✓" : "✗"}
                  </ActionButton>
                ))}
              </div>
              <EpForm action={attendeeAction} className="flex gap-1">
                <input type="hidden" name="sessionId" value={x.id} />
                <select name="studentId" className="input w-auto py-1 text-xs">
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.code} {st.name}
                    </option>
                  ))}
                </select>
                <Submit tone="plain" className="px-2 py-1 text-xs">
                  Add
                </Submit>
                <Msg />
              </EpForm>
            </div>
          ))}
        </section>
        <section className="card space-y-3 text-sm">
          <h2 className="font-semibold text-[#0f3460]">Doubt window</h2>
          <EpForm action={doubtAction} className="grid gap-2">
            <Msg />
            <select name="studentId" className="input">
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.code} {st.name}
                </option>
              ))}
            </select>
            <select name="sessionId" className="input">
              <option value="">No session yet</option>
              {sessions
                .filter((x) => x.type === "doubt")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.startsAt.toLocaleDateString("en-IN")} Class {x.klass}
                  </option>
                ))}
            </select>
            <input type="file" name="photo" accept=".jpg,.jpeg,.png,.pdf" className="input" />
            <input name="note" placeholder="The doubt" className="input" />
            <Submit tone="plain">Add doubt</Submit>
          </EpForm>
          {doubts.map((d) => (
            <div key={d.id} className="space-y-1 border-t border-line pt-2">
              <div>
                <b>{d.student.name}</b> · {d.status} {d.note && `· ${d.note}`}{" "}
                {d.filePath && (
                  <a href={signedLink(d.filePath)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    photo
                  </a>
                )}
              </div>
              {d.response ? (
                <div className="text-xs text-muted">Response: {d.response}</div>
              ) : (
                <EpForm action={answerDoubtAction} className="flex gap-1">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="response" placeholder="Response note" className="input flex-1 py-1 text-xs" />
                  <Submit tone="plain" className="px-2 py-1 text-xs">
                    Answer
                  </Submit>
                </EpForm>
              )}
            </div>
          ))}
        </section>
      </div>

      <section className="card text-sm">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Payments (teacher-only)</h2>
        <table className="table">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs">{p.receiptNo}</td>
                <td>{p.student.name}</td>
                <td>₹{p.amount}</td>
                <td>{p.method}</td>
                <td>{p.paidAt.toLocaleDateString("en-IN")}</td>
                <td>
                  <a href={signedLink(`receipts/${p.receiptNo}.pdf`)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    receipt
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payments.length && <p className="text-muted">No payments yet.</p>}
      </section>
      <p className="text-xs text-muted">Timed mocks: create a paper of kind “Timed full-length mock” on the Papers page.</p>
    </div>
  );
}
