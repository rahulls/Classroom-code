import { notFound } from "next/navigation";
import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge, Breadcrumbs, EditTag, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { isUuid } from "@/core/validation";
import { updateFieldAction } from "@/modules/config/actions";

export const metadata = { title: "Edit field" };

export default async function EditFieldPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("data.edit_all");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [def, programTypes] = await Promise.all([
    db.fieldDefinition.findFirst({ where: { id, archivedAt: null } }),
    db.programType.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } }),
  ]);
  if (!def) notFound();
  const hasOptions = def.type === "select" || def.type === "multiselect";

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Today", href: "/today" },
          { label: "Settings", href: "/settings" },
          { label: "Custom fields", href: "/settings/fields" },
          { label: def.label },
        ]}
      />
      <PageHeader
        title={<>{def.label} <EditTag /></>}
        subtitle={
          <span className="flex flex-wrap gap-2">
            <Badge>key: {def.key}</Badge>
            <Badge>type: {def.type}</Badge>
            {def.sensitive && <Badge tone="warn">encrypted</Badge>}
          </span>
        }
      />
      <section className="card max-w-xl">
        <p className="mb-3 text-xs text-muted">Key, type and encryption can&apos;t change after creation because stored values depend on them. To change those, archive this field and add a new one.</p>
        <ActionForm action={updateFieldAction} className="space-y-3">
          <input type="hidden" name="id" value={def.id} />
          <FormMessage />
          <TextField name="label" label="Label" required defaultValue={def.label} maxLength={80} />
          {hasOptions && <TextField name="options" label="Options" required defaultValue={def.options.join(", ")} maxLength={1000} hint="Comma-separated. Removing an option doesn't erase values already saved." />}
          <SelectField name="scopeKey" label="Applies to" required defaultValue={def.scopeKey} options={[{ value: "*", label: "All students" }, ...programTypes.map((p) => ({ value: p.key, label: `${p.label} only` }))]} />
          <div className="grid grid-cols-2 gap-2">
            <TextField name="groupName" label="Group / tab" defaultValue={def.groupName} maxLength={40} />
            <TextField name="order" label="Order" type="number" min={0} max={999} defaultValue={def.order} />
          </div>
          <TextField name="helpText" label="Help text" defaultValue={def.helpText} maxLength={200} />
          <CheckboxField name="required" label="Required" defaultChecked={def.required} />
          <SubmitButton>Save field</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
