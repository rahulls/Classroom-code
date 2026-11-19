import { retentionAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { retentionReview } from "@/modules/exam-prep/services/privacy";
import { EpForm, Field, Msg, Submit } from "../../ui";

export const metadata = { title: "Privacy" };

/** R11: deletion requests, retention (never without approval), and where the data lives. */
export default async function PrivacyPage() {
  const [reqs, retention] = await Promise.all([epdb.deletionRequest.findMany({ orderBy: { requestedAt: "desc" } }), retentionReview()]);
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold text-[#0f3460]">Privacy</h1>
      <section className="card space-y-1 text-sm">
        <p>Answer sheets, reports and receipts are stored privately on this laptop (outside OneDrive), opened only through 5-minute links while you're signed in.</p>
        <p>Only the R1 intake fields are collected: no Aadhaar, address or photos of children. AI requests carry only the sheet, the marking scheme and a student code.</p>
        <p>To delete a student (right to delete) or export their data, open the student's page.</p>
      </section>
      <section className="card text-sm">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Deletion requests</h2>
        <ul>
          {reqs.map((r) => (
            <li key={r.id}>
              {r.studentCode} · requested {r.requestedAt.toLocaleDateString("en-IN")} · {r.completedAt ? `completed ${r.completedAt.toLocaleDateString("en-IN")}` : "pending"} · confirmation drafted in Messages
            </li>
          ))}
        </ul>
        {!reqs.length && <p className="text-muted">None.</p>}
      </section>
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Retention</h2>
        <p>{retention.due ? "The retention period has passed: choose archive (identifiers removed, sheets deleted) or delete." : `Not due yet${"dueAt" in retention && retention.dueAt ? ` (from ${retention.dueAt.slice(0, 10)})` : ""}. Nothing is deleted without your approval.`}</p>
        {retention.due && (
          <EpForm action={retentionAction} className="flex flex-wrap items-end gap-2" confirm="Apply retention to all students?">
            <Msg />
            <select name="mode" className="input w-auto">
              <option value="archive">Archive (anonymise)</option>
              <option value="delete">Delete everything</option>
            </select>
            <Field label="Type APPROVE">
              <input name="confirm" className="input w-32" />
            </Field>
            <Submit tone="danger">Apply</Submit>
          </EpForm>
        )}
      </section>
    </div>
  );
}
