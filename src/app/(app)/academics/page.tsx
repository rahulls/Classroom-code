import Link from "next/link";
import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, EditTag, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { db } from "@/core/db";
import { createNodeAction, createYearAction } from "@/modules/academics/actions";
import { getTree, getYears, resolveYear, type TreeNode } from "@/modules/academics/service";

export const metadata = { title: "Academics" };

function Tree({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return (
    <ul className={depth ? "ml-4 border-l border-soft pl-3" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-1">
          <Link href={`/academics/${n.id}`} className="group flex items-center gap-2 text-sm">
            <span className="text-muted">{n.nodeType.enrollable ? "•" : "▸"}</span>
            <span className="group-hover:underline">{n.name}</span>
            <span className="text-xs text-muted">{n.nodeType.label}</span>
            {depth === 0 && n.programType && <span className="pill">{n.programType.label}</span>}
            {n.defaultDurationMin && <span className="pill">{n.defaultDurationMin} min</span>}
            <span className="ml-auto text-xs text-muted">{n.activeStudents} students</span>
          </Link>
          {n.children.length > 0 && <Tree nodes={n.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export default async function AcademicsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requirePermission("academics.view");
  const editMode = await isEditMode(user);
  const { year: yearParam } = await searchParams;
  const [years, year, programTypes, rootTypes] = await Promise.all([
    getYears(),
    resolveYear(yearParam),
    db.programType.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } }),
    db.nodeType.findMany({ where: { allowedParentKeys: { isEmpty: true } }, orderBy: { order: "asc" } }),
  ]);
  const tree = year ? await getTree(year.id) : [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Academics" }]} />
      <PageHeader
        title="Academics"
        subtitle="Programs → Courses → Batches. Each program's type decides its defaults (guardians, fees, curriculum)."
        actions={
          <>
            <Link href={year ? `/academics/timetable?year=${year.id}` : "/academics/timetable"} className="btn-primary">
              Timetable
            </Link>
            <Link href="/academics/subjects" className="btn">
              Subjects
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Academic year:</span>
        {years.map((y) => (
          <Link key={y.id} href={`/academics?year=${y.id}`} className={`pill ${y.id === year?.id ? "border-accent text-accent" : ""}`}>
            {y.name}
            {y.isCurrent ? " · current" : ""}
          </Link>
        ))}
        {editMode && year && (
          <Link href={`/academics/years/${year.id}`} className="text-accent hover:underline">
            Edit {year.name}
            <EditTag />
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card">
          {tree.length ? <Tree nodes={tree} /> : <Empty>No programs yet for this year. Add one on the right, e.g. “School Boards”, “JEE”, “Olympiad”, “Professional Bootcamps”.</Empty>}
        </section>

        <div className="space-y-4">
          {year && (
            <section className="card">
              <h2 className="mb-3 text-sm font-semibold">Add a program</h2>
              <ActionForm action={createNodeAction} className="space-y-3" resetOnSuccess>
                <input type="hidden" name="yearId" value={year.id} />
                {rootTypes.length === 1 ? (
                  <input type="hidden" name="nodeTypeId" value={rootTypes[0]!.id} />
                ) : (
                  <SelectField name="nodeTypeId" label="Level" required options={rootTypes.map((t) => ({ value: t.id, label: t.label }))} />
                )}
                <FormMessage />
                <TextField name="name" label="Name" required maxLength={100} placeholder="JEE" />
                <SelectField name="programTypeId" label="Program type" required options={programTypes.map((p) => ({ value: p.id, label: p.label }))} />
                <TextField name="defaultDurationMin" label="Default class length (min)" type="number" min={15} max={600} hint="Optional; courses, batches and subjects can override" />
                <SubmitButton>Add program</SubmitButton>
              </ActionForm>
            </section>
          )}
          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold">New academic year</summary>
            <ActionForm action={createYearAction} className="mt-3 space-y-3">
              <FormMessage />
              <TextField name="name" label="Name" required placeholder="2027-28" maxLength={20} />
              <div className="grid grid-cols-2 gap-2">
                <TextField name="startDate" label="Starts" type="date" required />
                <TextField name="endDate" label="Ends" type="date" required />
              </div>
              <CheckboxField name="isCurrent" label="Make this the current year" />
              <SubmitButton>Create year</SubmitButton>
            </ActionForm>
          </details>
        </div>
      </div>
    </>
  );
}
