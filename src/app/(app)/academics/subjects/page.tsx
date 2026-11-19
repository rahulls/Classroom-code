import Link from "next/link";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { db } from "@/core/db";
import { can } from "@/core/rbac";
import { createSubjectAction } from "@/modules/academics/actions";

export const metadata = { title: "Subjects" };

export default async function SubjectsPage() {
  const user = await requirePermission("academics.view");
  const editMode = await isEditMode(user);
  const subjects = await db.subject.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { batchSubjects: true } } },
  });

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Academics", href: "/academics" }, { label: "Subjects" }]} />
      <PageHeader title="Subjects" subtitle="The subject catalogue shared by all programs. Add subjects to batches from each batch's page." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card overflow-x-auto">
          {subjects.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>Tags</th>
                  <th>Default length</th>
                  <th>Batches</th>
                  {editMode && <th />}
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: s.color ?? "rgb(var(--line))" }} />
                      {s.name}
                    </td>
                    <td className="text-muted">{s.code}</td>
                    <td className="space-x-1">
                      {s.boardTags.map((t) => (
                        <span key={t} className="pill">
                          {t}
                        </span>
                      ))}
                    </td>
                    <td>{s.defaultDurationMin ? `${s.defaultDurationMin} min` : <span className="text-muted">—</span>}</td>
                    <td>{s._count.batchSubjects}</td>
                    {editMode && (
                      <td>
                        <Link href={`/academics/subjects/${s.id}`} className="text-xs text-accent hover:underline">
                          Edit
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No subjects yet.</Empty>
          )}
        </section>
        {can(user, "academics.manage") && (
          <section className="card h-fit">
            <h2 className="mb-3 text-sm font-semibold">Add subject</h2>
            <ActionForm action={createSubjectAction} className="space-y-3" resetOnSuccess>
              <FormMessage />
              <TextField name="name" label="Name" required maxLength={80} placeholder="Physics" />
              <TextField name="code" label="Code" required maxLength={12} placeholder="PHY" />
              <TextField name="boardTags" label="Tags" placeholder="CBSE, JEE, NSEP" hint="Comma-separated" maxLength={200} />
              <TextField name="defaultDurationMin" label="Default class length (min)" type="number" min={15} max={600} />
              <TextField name="color" label="Colour" type="color" defaultValue="#3b5bdb" />
              <SubmitButton>Add subject</SubmitButton>
            </ActionForm>
          </section>
        )}
      </div>
    </>
  );
}
