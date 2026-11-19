import { Breadcrumbs, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { getSetting } from "@/modules/academics/service";
import { sendBroadcastAction } from "@/modules/messages/actions";
import { ACCEPT, MAX_FILE_MB, MAX_IMAGE_MB } from "@/modules/messages/attachments";
import { resolveAudience } from "@/modules/messages/audience";
import { WA_TEMPLATES } from "@/modules/messages/service";
import { BroadcastForm, type BroadcastRow } from "./broadcast-form";

export const metadata = { title: "Broadcast" };

export default async function BroadcastPage() {
  await requirePermission("messages.send");
  const [audience, enrollments, institute] = await Promise.all([
    resolveAudience(db, { batchIds: [], groupIds: [], studentIds: [], who: "both", all: true }),
    db.enrollment.findMany({
      where: { status: "ACTIVE", batch: { archivedAt: null } },
      select: { studentId: true, batch: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } } },
    }),
    getSetting<string>("institute.name", "Rahul Shah Classes"),
  ]);

  // Each student's classes: "Class 10 · Alpha"; the filter offers each class (the batch's parent)
  const classesOf = new Map<string, { id: string; label: string }[]>();
  const classes = new Map<string, string>();
  for (const e of enrollments) {
    const cls = e.batch.parent ?? e.batch;
    classes.set(cls.id, cls.name);
    const list = classesOf.get(e.studentId) ?? [];
    list.push({ id: cls.id, label: e.batch.parent ? `${e.batch.parent.name} · ${e.batch.name}` : e.batch.name });
    classesOf.set(e.studentId, list);
  }

  const rows: BroadcastRow[] = audience.recipients.map((r) => {
    const cl = r.studentIds.flatMap((id) => classesOf.get(id) ?? []);
    return {
      id: r.contact.id,
      name: r.contact.name,
      role: r.role,
      students: r.students.join(", "),
      classIds: [...new Set(cl.map((c) => c.id))],
      classLabels: [...new Set(cl.map((c) => c.label))].join(", "),
      channel: r.channel,
    };
  });

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Messages", href: "/messages" }, { label: "Broadcast" }]} />
      <PageHeader title="Broadcast" subtitle="One message to every student and parent. Untick anyone who shouldn't get it. You can attach a picture or a document." />
      <BroadcastForm
        action={sendBroadcastAction}
        rows={rows}
        classes={[...classes].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }))}
        skipped={audience.skipped.map((s) => ({ name: s.name, role: s.role, students: s.students.join(", "), reason: s.reason }))}
        accept={ACCEPT}
        maxFileMb={MAX_FILE_MB}
        maxImageMb={MAX_IMAGE_MB}
        institute={institute}
        waMode={env.WHATSAPP_MODE}
        templates={{ text: WA_TEMPLATES.notice.name, image: WA_TEMPLATES.noticeImage.name, document: WA_TEMPLATES.noticeDocument.name }}
      />
    </>
  );
}
