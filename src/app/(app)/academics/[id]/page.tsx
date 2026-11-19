import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge, Breadcrumbs, EditTag, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { db } from "@/core/db";
import { can } from "@/core/rbac";
import {
  archiveNodeAction,
  attachSubjectAction,
  createNodeAction,
  detachSubjectAction,
  moveNodeAction,
  updateBatchSubjectAction,
  updateNodeAction,
} from "@/modules/academics/actions";
import { effectiveDuration, getLineage, getSetting } from "@/modules/academics/service";
import { logRange } from "@/modules/academics/batch-log";
import { fmtDate } from "@/modules/academics/time";
import { AttendanceTab, ProgressTab } from "./log-tabs";
import { TimetableSection } from "./timetable-section";

const TABS = [
  { value: "about", label: "About & students" },
  { value: "schedule", label: "Schedule" },
  { value: "progress", label: "Class progress & homework" },
  { value: "attendance", label: "Attendance" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export const metadata = { title: "Program / batch" };

export default async function NodePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string; tab?: string; from?: string; to?: string }> }) {
  const user = await requirePermission("academics.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const node = await db.programNode.findFirst({
    where: { id, archivedAt: null },
    include: {
      nodeType: true,
      programType: true,
      children: { where: { archivedAt: null }, include: { nodeType: true }, orderBy: { name: "asc" } },
      batchSubjects: { include: { subject: true }, orderBy: { subject: { name: "asc" } } },
      enrollments: { where: { status: "ACTIVE" }, include: { student: true }, orderBy: { student: { firstName: "asc" } } },
    },
  });
  if (!node) notFound();
  const sp = await searchParams;
  const tabbed = node.nodeType.enrollable;
  const tab: Tab = TABS.some((t) => t.value === sp.tab) ? (sp.tab as Tab) : sp.date ? "schedule" : "about";
  const range = logRange(sp.from, sp.to);

  const manage = can(user, "academics.manage");
  const editMode = await isEditMode(user);
  const [lineage, childTypes, subjects, orgDefault, presets] = await Promise.all([
    getLineage(node.id),
    db.nodeType.findMany({ where: { allowedParentKeys: { has: node.nodeType.key } }, orderBy: { order: "asc" } }),
    node.nodeType.enrollable ? db.subject.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    getSetting<number>("schedule.defaultDurationMin", 60),
    getSetting<number[]>("schedule.durationPresets", [45, 60, 90, 120, 180]),
  ]);
  const attRows = tabbed
    ? await db.attendance.groupBy({ by: ["studentId", "status"], where: { classRecord: { batchId: node.id } }, _count: { _all: true } })
    : [];
  const attPct = (studentId: string) => {
    const mine = attRows.filter((r) => r.studentId === studentId);
    const total = mine.reduce((n, r) => n + r._count._all, 0);
    const came = mine.filter((r) => r.status !== "absent").reduce((n, r) => n + r._count._all, 0);
    return total ? { pct: Math.round((came / total) * 100), total } : null;
  };
  const attrs = node.attributes as { capacity?: number; mode?: string; room?: string };
  const attachedIds = new Set(node.batchSubjects.map((b) => b.subjectId));

  // Edit mode: valid new parents = same year, allowed type, not this node or anything under it.
  let moveTargets: { value: string; label: string }[] = [];
  let programTypes: { value: string; label: string }[] = [];
  if (editMode) {
    const [yearNodes, pts] = await Promise.all([
      db.programNode.findMany({ where: { yearId: node.yearId, archivedAt: null }, select: { id: true, parentId: true, name: true, nodeType: { select: { key: true, label: true } } } }),
      db.programType.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } }),
    ]);
    const blocked = new Set([node.id]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const n of yearNodes) if (n.parentId && blocked.has(n.parentId) && !blocked.has(n.id)) (blocked.add(n.id), (changed = true));
    }
    const byId = new Map(yearNodes.map((n) => [n.id, n]));
    const path = (id: string | null): string => {
      const n = id ? byId.get(id) : undefined;
      return n ? `${n.parentId ? `${path(n.parentId)} › ` : ""}${n.name}` : "";
    };
    moveTargets = yearNodes
      .filter((n) => !blocked.has(n.id) && node.nodeType.allowedParentKeys.includes(n.nodeType.key))
      .map((n) => ({ value: n.id, label: `${path(n.id)} (${n.nodeType.label})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
    programTypes = pts.map((p) => ({ value: p.id, label: p.label }));
  }
  const canBeRoot = node.nodeType.allowedParentKeys.length === 0;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Today", href: "/today" },
          { label: "Academics", href: `/academics?year=${node.yearId}` },
          ...lineage.slice(0, -1).map((l) => ({ label: l.name, href: `/academics/${l.id}` })),
          { label: node.name },
        ]}
      />
      <PageHeader
        title={node.name}
        subtitle={
          <span className="flex flex-wrap gap-2">
            <Badge>{node.nodeType.label}</Badge>
            {node.programType && <Badge tone="accent">{node.programType.label}</Badge>}
            {node.programType && <Badge>{node.programType.learnerKind === "ADULT" ? "Adult learners" : "Guardian required"}</Badge>}
          </span>
        }
        actions={
          manage && (
            <span className="flex flex-wrap items-end gap-2">
              <Link href={`/messages/compose?b=${node.id}`} className="btn">
                Message this {node.nodeType.label.toLowerCase()}
              </Link>
              <ActionForm action={archiveNodeAction} confirm={`Archive "${node.name}"?`}>
                <input type="hidden" name="id" value={node.id} />
                <SubmitButton variant="danger">Archive</SubmitButton>
              </ActionForm>
            </span>
          )
        }
      />

      {tabbed && (
        <nav className="-mt-2 mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Batch sections">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={`/academics/${node.id}${t.value === "about" ? "" : `?tab=${t.value}`}`}
              role="tab"
              aria-selected={tab === t.value}
              className={`-mb-px whitespace-nowrap rounded-t-md border px-3 py-2 text-sm ${tab === t.value ? "border-line border-b-bg bg-bg font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.label}
              {t.value === "about" && <span className="ml-1 text-xs text-muted">({node.enrollments.length})</span>}
            </Link>
          ))}
        </nav>
      )}

      {tabbed && tab === "schedule" && (
        <TimetableSection
          batchId={node.id}
          batchLabel={node.name}
          date={sp.date}
          manage={manage}
          presets={presets}
          defaultRoom={attrs.room ?? ""}
          defaultMode={attrs.mode ?? "offline"}
          subjects={node.batchSubjects.map((bs) => {
            const d = effectiveDuration({ batchSubjectMin: bs.defaultDurationMin, lineage, subjectMin: bs.subject.defaultDurationMin, orgDefault });
            return { batchSubjectId: bs.id, name: bs.subject.name, code: bs.subject.code, color: bs.subject.color, durationMin: d.minutes, source: d.source };
          })}
        />
      )}
      {tabbed && tab === "progress" && <ProgressTab batchId={node.id} {...range} />}
      {tabbed && tab === "attendance" && <AttendanceTab batchId={node.id} {...range} />}

      {(!tabbed || tab === "about") && (
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {node.nodeType.enrollable && (
            <section className="card">
              <h2 className="mb-1 text-sm font-semibold">Subjects &amp; class length</h2>
              <p className="mb-3 text-xs text-muted">The most specific setting wins: subject-in-batch → batch → course/program → subject default → institute default ({orgDefault} min).</p>
              {node.batchSubjects.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Class length</th>
                        <th>Comes from</th>
                        {manage && <th>Override for this batch</th>}
                        {manage && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {node.batchSubjects.map((bs) => {
                        const d = effectiveDuration({ batchSubjectMin: bs.defaultDurationMin, lineage, subjectMin: bs.subject.defaultDurationMin, orgDefault });
                        return (
                          <tr key={bs.id}>
                            <td>
                              {bs.subject.name} <span className="text-xs text-muted">{bs.subject.code}</span>
                            </td>
                            <td className="font-medium">{d.minutes} min</td>
                            <td className="text-xs text-muted">{d.source}</td>
                            {manage && (
                              <td>
                                <ActionForm action={updateBatchSubjectAction} className="flex items-center gap-1">
                                  <input type="hidden" name="id" value={bs.id} />
                                  <input name="defaultDurationMin" type="number" min={15} max={600} defaultValue={bs.defaultDurationMin ?? ""} placeholder="inherit" className="input w-24 py-1" aria-label="Minutes" />
                                  <SubmitButton variant="default">Save</SubmitButton>
                                </ActionForm>
                              </td>
                            )}
                            {manage && (
                              <td>
                                <ActionForm action={detachSubjectAction} confirm={`Remove ${bs.subject.name} from this batch?`}>
                                  <input type="hidden" name="id" value={bs.id} />
                                  <button type="submit" className="text-xs text-bad hover:underline">
                                    Remove
                                  </button>
                                </ActionForm>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No subjects yet.</Empty>
              )}
              {manage && subjects.some((s) => !attachedIds.has(s.id)) && (
                <ActionForm action={attachSubjectAction} className="mt-3 flex flex-wrap items-end gap-2" resetOnSuccess>
                  <input type="hidden" name="batchId" value={node.id} />
                  <SelectField name="subjectId" label="Add subject" required className="min-w-48" options={subjects.filter((s) => !attachedIds.has(s.id)).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
                  <TextField name="defaultDurationMin" label="Length (min)" type="number" min={15} max={600} className="w-28" placeholder="inherit" />
                  <SubmitButton variant="default">Add</SubmitButton>
                  <div className="w-full">
                    <FormMessage />
                  </div>
                </ActionForm>
              )}
            </section>
          )}

          {node.nodeType.enrollable && (
            <section className="card">
              <h2 className="mb-3 text-sm font-semibold">Students ({node.enrollments.length})</h2>
              {node.enrollments.length ? (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Admission no</th>
                        <th>Roll no</th>
                        <th>Joined</th>
                        <th>Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {node.enrollments.map((e) => {
                        const a = attPct(e.studentId);
                        return (
                          <tr key={e.id}>
                            <td>
                              <Link href={`/students/${e.studentId}`} className="hover:underline">
                                {e.student.firstName} {e.student.lastName}
                              </Link>
                            </td>
                            <td className="text-muted">{e.student.admissionNo}</td>
                            <td className="text-muted">{e.rollNo ?? "—"}</td>
                            <td className="whitespace-nowrap">{fmtDate(e.joinedOn.toISOString().slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}</td>
                            <td className={a ? (a.pct < 75 ? "text-bad" : "text-ok") : "text-muted"}>
                              {a ? (
                                <Link href={`/academics/${node.id}?tab=attendance`} className="hover:underline">
                                  {a.pct}% <span className="text-xs text-muted">of {a.total}</span>
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  No students yet. <Link href="/students/new" className="text-accent hover:underline">Add a student</Link>.
                </Empty>
              )}
            </section>
          )}

          {childTypes.length > 0 && (
            <section className="card">
              <h2 className="mb-3 text-sm font-semibold">{childTypes.map((t) => t.label).join(" / ")}s</h2>
              {node.children.length ? (
                <ul className="space-y-1 text-sm">
                  {node.children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/academics/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>{" "}
                      <span className="text-xs text-muted">{c.nodeType.label}</span>
                      {c.defaultDurationMin && <span className="pill ml-2">{c.defaultDurationMin} min</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nothing here yet.</Empty>
              )}
              {manage && (
                <ActionForm action={createNodeAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto] sm:items-end">
                  <input type="hidden" name="yearId" value={node.yearId} />
                  <input type="hidden" name="parentId" value={node.id} />
                  {childTypes.length === 1 ? (
                    <input type="hidden" name="nodeTypeId" value={childTypes[0]!.id} />
                  ) : (
                    <SelectField name="nodeTypeId" label="Level" required options={childTypes.map((t) => ({ value: t.id, label: t.label }))} />
                  )}
                  <TextField name="name" label={`New ${childTypes[0]!.label.toLowerCase()} name`} required maxLength={100} placeholder={childTypes[0]!.enrollable ? "Morning batch" : "Class 10"} />
                  <TextField name="defaultDurationMin" label="Length (min)" type="number" min={15} max={600} placeholder="inherit" />
                  <SubmitButton variant="default">Add</SubmitButton>
                  <div className="sm:col-span-4">
                    <FormMessage />
                  </div>
                </ActionForm>
              )}
            </section>
          )}
        </div>

        <div className="space-y-4">
        {manage && (
          <section className="card h-fit">
            <h2 className="mb-3 text-sm font-semibold">Details</h2>
            <ActionForm action={updateNodeAction} className="space-y-3">
              <input type="hidden" name="id" value={node.id} />
              <FormMessage />
              <TextField name="name" label="Name" required defaultValue={node.name} maxLength={100} />
              <TextField name="code" label="Code" defaultValue={node.code} maxLength={30} />
              <TextField name="defaultDurationMin" label="Default class length (min)" type="number" min={15} max={600} defaultValue={node.defaultDurationMin} hint="Leave empty to inherit" />
              {node.nodeType.enrollable && (
                <>
                  <TextField name="capacity" label="Capacity" type="number" min={1} max={10000} defaultValue={attrs.capacity} />
                  <SelectField
                    name="mode"
                    label="Mode"
                    defaultValue={attrs.mode}
                    options={[
                      { value: "offline", label: "Offline" },
                      { value: "online", label: "Online" },
                      { value: "hybrid", label: "Hybrid" },
                    ]}
                  />
                  <TextField name="room" label="Default room" defaultValue={attrs.room} maxLength={40} />
                </>
              )}
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </section>
        )}
        {editMode && (
          <section className="card h-fit">
            <h2 className="mb-1 text-sm font-semibold">
              Move / program type
              <EditTag />
            </h2>
            <p className="mb-3 text-xs text-muted">Everything underneath moves too and takes the new program type.</p>
            <ActionForm action={moveNodeAction} className="space-y-3">
              <input type="hidden" name="id" value={node.id} />
              <FormMessage />
              <SelectField
                name="parentId"
                label="Place under"
                defaultValue={node.parentId ?? ""}
                placeholder={canBeRoot ? "(top level)" : "Choose…"}
                required={!canBeRoot}
                options={moveTargets}
              />
              {canBeRoot && <SelectField name="programTypeId" label="Program type" defaultValue={node.programTypeId} options={programTypes} hint="Only for top-level items; everything under it inherits it" />}
              <SubmitButton variant="default">Apply</SubmitButton>
            </ActionForm>
          </section>
        )}
        </div>
      </div>
      )}
    </>
  );
}
