import { notFound } from "next/navigation";
import { ActionForm, CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, EditTag, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { isUuid, toDateInput } from "@/core/validation";
import { archiveYearAction, updateYearAction } from "@/modules/academics/actions";

export const metadata = { title: "Edit academic year" };

export default async function EditYearPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("data.edit_all");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const year = await db.academicYear.findFirst({ where: { id, archivedAt: null } });
  if (!year) notFound();

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Academics", href: `/academics?year=${year.id}` }, { label: `Edit ${year.name}` }]} />
      <PageHeader title={<>Academic year {year.name} <EditTag /></>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="card">
          <ActionForm action={updateYearAction} className="space-y-3">
            <input type="hidden" name="id" value={year.id} />
            <FormMessage />
            <TextField name="name" label="Name" required defaultValue={year.name} maxLength={20} />
            <div className="grid grid-cols-2 gap-2">
              <TextField name="startDate" label="Starts" type="date" required defaultValue={toDateInput(year.startDate)} />
              <TextField name="endDate" label="Ends" type="date" required defaultValue={toDateInput(year.endDate)} />
            </div>
            <CheckboxField name="isCurrent" label="Current year" defaultChecked={year.isCurrent} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </section>
        <section className="card h-fit">
          <h2 className="mb-2 text-sm font-semibold">Archive</h2>
          <p className="mb-3 text-xs text-muted">Only possible when the year has no programs and isn&apos;t the current year.</p>
          <ActionForm action={archiveYearAction} confirm={`Archive ${year.name}?`}>
            <input type="hidden" name="id" value={year.id} />
            <FormMessage />
            <SubmitButton variant="danger">Archive year</SubmitButton>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
