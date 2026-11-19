import { notFound } from "next/navigation";
import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, EditTag, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { isUuid } from "@/core/validation";
import { updateProgramTypeAction } from "@/modules/platform/actions";

export const metadata = { title: "Edit program type" };

export default async function EditProgramTypePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("data.edit_all");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const pt = await db.programType.findFirst({ where: { id, archivedAt: null }, include: { _count: { select: { nodes: true } } } });
  if (!pt) notFound();

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings", href: "/settings" }, { label: pt.label }]} />
      <PageHeader title={<>{pt.label} <EditTag /></>} subtitle={`Key: ${pt.key} · used by ${pt._count.nodes} program node(s)`} />
      <section className="card max-w-xl">
        <ActionForm action={updateProgramTypeAction} className="space-y-3">
          <input type="hidden" name="id" value={pt.id} />
          <FormMessage />
          <TextField name="label" label="Label" required defaultValue={pt.label} maxLength={60} />
          <SelectField
            name="learnerKind"
            label="Learners"
            required
            defaultValue={pt.learnerKind}
            options={[
              { value: "MINOR", label: "Minors (school / competitive)" },
              { value: "ADULT", label: "Adults (professional)" },
            ]}
          />
          <CheckboxField name="guardianRequired" label="Guardian contact required" defaultChecked={pt.guardianRequired} />
          <SelectField
            name="defaultBilling"
            label="Default billing"
            required
            defaultValue={pt.defaultBilling}
            options={["monthly", "quarterly", "one_time", "instalments", "per_class"].map((v) => ({ value: v, label: v.replace("_", " ") }))}
          />
          <SelectField
            name="defaultRecipients"
            label="Messages go to"
            required
            defaultValue={pt.defaultRecipients}
            options={[
              { value: "both", label: "Student + guardian" },
              { value: "guardian", label: "Guardian only" },
              { value: "student", label: "Student only" },
              { value: "self", label: "Learner (adults)" },
            ]}
          />
          <TextField name="curriculumLevels" label="Curriculum levels" required defaultValue={pt.curriculumLevels.join(", ")} maxLength={200} hint="e.g. unit, chapter, topic  or  module, session, topic" />
          <SubmitButton>Save program type</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
