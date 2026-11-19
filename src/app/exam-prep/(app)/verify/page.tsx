import { verifyAction } from "@/modules/exam-prep/actions";
import { unverifiedParents } from "@/modules/exam-prep/services/people";
import { ActionButton, CopyButton } from "../../ui";

export const metadata = { title: "Verify numbers" };

/** R1: each unverified parent number gets a one-time "reply YES" message; no report goes to an unverified number. */
export default async function VerifyPage() {
  const rows = await unverifiedParents();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#0f3460]">Verify parent numbers</h1>
      <p className="text-sm text-muted">Send each message from the WhatsApp Business app. When the parent replies YES, mark the number verified. Reports are never queued for an unverified number.</p>
      <div className="space-y-2">
        {rows.map(({ parent, message }) => (
          <div key={parent.id} className="card flex flex-wrap items-center gap-3 text-sm">
            <div className="min-w-[14rem]">
              <b>{parent.name}</b> <span className="text-muted">for {parent.student.name} ({parent.student.code})</span>
              <div className="font-mono text-xs">{parent.whatsapp}</div>
            </div>
            <p className="flex-1 text-xs text-muted">{message?.body}</p>
            {message?.waLink && (
              <a href={message.waLink} target="_blank" rel="noreferrer" className="btn px-2 py-1 text-xs">
                Open WhatsApp ↗
              </a>
            )}
            {message && <CopyButton text={message.body} />}
            <ActionButton action={verifyAction} fields={{ parentId: parent.id }} tone="primary">
              Replied YES: verified
            </ActionButton>
          </div>
        ))}
        {!rows.length && <p className="card text-sm text-muted">Every parent number is verified.</p>}
      </div>
    </div>
  );
}
