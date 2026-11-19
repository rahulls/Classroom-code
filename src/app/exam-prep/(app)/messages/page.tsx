import { messageSentAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { groupAdvice, renderTemplate, seedTemplates } from "@/modules/exam-prep/services/messaging";
import { getSettings } from "@/modules/exam-prep/settings";
import { ActionButton, CopyAndOpenGroup, CopyButton } from "../../ui";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Messages" };

/** R9: drafts to send from the Business app (group posts are tagged), the template library, labels. */
export default async function MessagesPage() {
  await seedTemplates(); // makes sure every template exists (never overwrites edits)
  const s = await getSettings();
  const [drafts, templates, advice, rules] = await Promise.all([
    epdb.message.findMany({ where: { status: "drafted", templateKey: { notIn: ["student_report", "parent_report"] } }, orderBy: [{ audience: "asc" }, { createdAt: "asc" }], take: 200 }),
    epdb.messageTemplate.findMany({ orderBy: [{ audience: "asc" }, { key: "asc" }] }),
    groupAdvice(),
    renderTemplate("group_rules", {}),
  ]);
  const group = drafts.filter((d) => d.audience === "group");
  const priv = drafts.filter((d) => d.audience !== "group");
  const Row = ({ m }: { m: (typeof drafts)[number] }) => (
    <div className="card flex flex-wrap items-start gap-3 text-sm">
      <span className="w-40 shrink-0 text-xs text-muted">
        {m.templateKey.replace(/_/g, " ")}
        {m.paperId && <span className="block font-mono">{m.paperId}</span>}
      </span>
      <pre className="flex-1 whitespace-pre-wrap font-sans text-sm">{m.body}</pre>
      <div className="flex flex-col gap-1">
        {m.audience === "group" ? <CopyAndOpenGroup text={m.body} groupLink={s["brand.groupLink"]} /> : <CopyButton text={m.body} />}
        {m.waLink && (
          <a href={m.waLink} target="_blank" rel="noreferrer" className="btn px-2 py-1 text-xs">
            WhatsApp ↗
          </a>
        )}
        <ActionButton action={messageSentAction} fields={{ id: m.id }} tone="primary">
          Sent ✓
        </ActionButton>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Messages</h1>
        <div className="ml-auto flex gap-2 text-sm">
          <a href="/exam-prep/students/labels" className="btn">
            Labels CSV
          </a>
          <a href="/exam-prep/students/labels?names=1" className="btn">
            Labels CSV with names
          </a>
        </div>
      </div>
      {advice.split && <p className="card border-warn text-sm text-warn">Suggest splitting the shared group by class: {advice.reasons.join("; ")}.</p>}
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Group rules (post once and pin)</h2>
        <pre className="whitespace-pre-wrap font-sans">{rules}</pre>
        <CopyAndOpenGroup text={rules} groupLink={s["brand.groupLink"]} />
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-[#0f3460]">Shared group posts ({group.length})</h2>
        {group.map((m) => (
          <Row key={m.id} m={m} />
        ))}
        {!group.length && <p className="text-sm text-muted">None waiting.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-[#0f3460]">Private messages ({priv.length})</h2>
        {priv.map((m) => (
          <Row key={m.id} m={m} />
        ))}
        {!priv.length && <p className="text-sm text-muted">None waiting.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-[#0f3460]">Template library</h2>
        {templates.map((t) => (
          <TemplateEditor key={t.key} t={t} brand={{ tuition: s["brand.tuitionName"], tutor: s["brand.tutorName"], contact: s["brand.contact"] }} />
        ))}
      </section>
    </div>
  );
}
