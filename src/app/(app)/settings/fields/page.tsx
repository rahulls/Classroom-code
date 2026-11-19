import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import Link from "next/link";
import { Badge, Breadcrumbs, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { db } from "@/core/db";
import { archiveFieldAction, createFieldAction } from "@/modules/config/actions";
import { FIELD_TYPES } from "@/modules/config/fields";

export const metadata = { title: "Custom fields" };

export default async function FieldsPage() {
  const user = await requirePermission("settings.manage");
  const editMode = await isEditMode(user);
  const [defs, programTypes] = await Promise.all([
    db.fieldDefinition.findMany({ where: { entity: "student", archivedAt: null }, orderBy: [{ scopeKey: "asc" }, { groupName: "asc" }, { order: "asc" }] }),
    db.programType.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } }),
  ]);
  const scopeLabel = (k: string) => (k === "*" ? "All students" : (programTypes.find((p) => p.key === k)?.label ?? k));

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings", href: "/settings" }, { label: "Custom fields" }]} />
      <PageHeader title="Student profile fields" subtitle="Add fields without code changes. Fields can apply to all students or only one program type." />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="card overflow-x-auto">
          {defs.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Applies to</th>
                  <th>Group</th>
                  <th>Rules</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.label} <div className="text-xs text-muted">{d.key}</div>
                    </td>
                    <td>
                      {d.type}
                      {d.options.length > 0 && <div className="text-xs text-muted">{d.options.join(", ")}</div>}
                    </td>
                    <td>{scopeLabel(d.scopeKey)}</td>
                    <td>{d.groupName}</td>
                    <td className="space-x-1">
                      {d.required && <Badge>required</Badge>}
                      {d.sensitive && <Badge tone="warn">encrypted · owner only</Badge>}
                    </td>
                    <td className="space-x-3 whitespace-nowrap">
                      {editMode && (
                        <Link href={`/settings/fields/${d.id}`} className="text-xs text-accent hover:underline">
                          Edit
                        </Link>
                      )}
                      <ActionForm action={archiveFieldAction} className="inline" confirm={`Archive "${d.label}"? Existing values are kept but hidden.`}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="text-xs text-bad hover:underline">
                          Archive
                        </button>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No custom fields.</Empty>
          )}
        </section>

        <section className="card h-fit">
          <h2 className="mb-3 text-sm font-semibold">Add field</h2>
          <ActionForm action={createFieldAction} className="space-y-3" resetOnSuccess>
            <input type="hidden" name="entity" value="student" />
            <FormMessage />
            <TextField name="label" label="Label" required maxLength={80} placeholder="School name" />
            <SelectField name="type" label="Type" required defaultValue="text" options={FIELD_TYPES.map((t) => ({ value: t, label: t }))} />
            <TextField name="options" label="Options" placeholder="CBSE, ICSE, State" maxLength={1000} hint="Comma-separated; only for select types" />
            <SelectField name="scopeKey" label="Applies to" defaultValue="*" options={[{ value: "*", label: "All students" }, ...programTypes.map((p) => ({ value: p.key, label: `${p.label} only` }))]} />
            <TextField name="groupName" label="Group / tab" placeholder="Academic" maxLength={40} />
            <TextField name="helpText" label="Help text" maxLength={200} />
            <CheckboxField name="required" label="Required" />
            <CheckboxField name="sensitive" label="Sensitive" hint="Encrypted at rest, hidden from mentors" />
            <SubmitButton>Add field</SubmitButton>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
