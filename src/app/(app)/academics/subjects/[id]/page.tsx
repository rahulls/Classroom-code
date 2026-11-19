import { notFound } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, EditTag, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { isUuid } from "@/core/validation";
import { archiveSubjectAction, updateSubjectAction } from "@/modules/academics/actions";

export const metadata = { title: "Edit subject" };

export default async function EditSubjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("data.edit_all");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const subject = await db.subject.findFirst({ where: { id, archivedAt: null }, include: { _count: { select: { batchSubjects: true } } } });
  if (!subject) notFound();

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Today", href: "/today" },
          { label: "Academics", href: "/academics" },
          { label: "Subjects", href: "/academics/subjects" },
          { label: subject.name },
        ]}
      />
      <PageHeader title={<>{subject.name} <EditTag /></>} subtitle={`Used in ${subject._count.batchSubjects} batch(es)`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="card">
          <ActionForm action={updateSubjectAction} className="space-y-3">
            <input type="hidden" name="id" value={subject.id} />
            <FormMessage />
            <TextField name="name" label="Name" required defaultValue={subject.name} maxLength={80} />
            <TextField name="code" label="Code" required defaultValue={subject.code} maxLength={12} />
            <TextField name="boardTags" label="Tags" defaultValue={subject.boardTags.join(", ")} hint="Comma-separated" maxLength={200} />
            <TextField name="defaultDurationMin" label="Default class length (min)" type="number" min={15} max={600} defaultValue={subject.defaultDurationMin} />
            <TextField name="color" label="Colour" type="color" defaultValue={subject.color ?? "#3b5bdb"} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </section>
        <section className="card h-fit">
          <h2 className="mb-2 text-sm font-semibold">Archive</h2>
          <p className="mb-3 text-xs text-muted">Hidden from new batches. Batches already using it keep it.</p>
          <ActionForm action={archiveSubjectAction} confirm={`Archive ${subject.name}?`}>
            <input type="hidden" name="id" value={subject.id} />
            <SubmitButton variant="danger">Archive subject</SubmitButton>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
