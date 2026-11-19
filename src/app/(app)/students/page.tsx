import Link from "next/link";
import type { StudentStatus } from "@prisma/client";
import { Badge, Breadcrumbs, Empty, PageHeader, STATUS_LABEL, STATUS_TONE } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { can } from "@/core/rbac";
import { getEnrollableBatches, listStudents } from "@/modules/students/service";

export const metadata = { title: "Students" };

const STATUSES = ["ACTIVE", "ON_HOLD", "ALUMNI", "DROPPED"] as const;

type Named = { name: string; parent?: Named | null } | null | undefined;
/** "class 10", or "Maang · Maang prep" for a deeper tree: every level above the batch. */
const classOf = (n: Named) => {
  const names: string[] = [];
  for (let c = n; c; c = c.parent) names.unshift(c.name);
  return names.join(" · ");
};
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; batch?: string; status?: string; page?: string }> }) {
  const user = await requirePermission("students.view");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as StudentStatus) : sp.status === "all" ? undefined : "ACTIVE";
  const batchId = sp.batch && /^[0-9a-f-]{36}$/i.test(sp.batch) ? sp.batch : undefined;
  const page = Math.min(1000, Math.max(1, Number(sp.page) || 1));

  const [{ rows, total, pageSize }, batches] = await Promise.all([listStudents({ q: sp.q, batchId, status, page }), getEnrollableBatches()]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) => new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(batchId ? { batch: batchId } : {}), status: sp.status ?? "ACTIVE", page: String(p) }).toString();

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Students" }]} />
      <PageHeader
        title={`Students (${total})`}
        actions={
          can(user, "students.manage") && (
            <Link href="/students/new" className="btn-primary">
              + Add student
            </Link>
          )
        }
      />
      <form className="card mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-56 flex-1">
          <span className="label">Search</span>
          <input name="q" defaultValue={sp.q} maxLength={100} placeholder="Name, admission no., phone or email" className="input" />
        </label>
        <label>
          <span className="label">Batch</span>
          <select name="batch" defaultValue={batchId ?? ""} className="input">
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fullLabel}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={sp.status ?? "ACTIVE"} className="input">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </label>
        <button className="btn">Apply</button>
      </form>

      {rows.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4">Name</th>
                <th>Admission no.</th>
                <th>Class</th>
                <th>Batch</th>
                <th>Subjects</th>
                <th>Primary contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const primary = s.contacts[0];
                const classes = uniq(s.enrollments.map((e) => classOf(e.batch.parent)));
                const subjects = uniq(s.enrollments.flatMap((e) => e.batch.batchSubjects.map((b) => b.subject.name)));
                return (
                  <tr key={s.id}>
                    <td className="pl-4">
                      <Link href={`/students/${s.id}`} className="font-medium text-accent hover:underline">
                        {s.firstName} {s.lastName}
                      </Link>
                      {s.learnerKind === "ADULT" && <span className="pill ml-2">Adult</span>}
                    </td>
                    <td className="text-muted">{s.admissionNo}</td>
                    <td>{classes.length ? classes.join(", ") : <span className="text-muted">—</span>}</td>
                    <td>
                      {s.enrollments.length ? (
                        s.enrollments.map((e, i) => (
                          <span key={e.id}>
                            {i > 0 && ", "}
                            <Link href={`/academics/${e.batch.id}`} className="text-accent hover:underline">
                              {e.batch.name}
                            </Link>
                          </span>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-sm">{subjects.length ? subjects.join(", ") : <span className="text-muted">—</span>}</td>
                    <td>
                      {primary ? (
                        <>
                          {primary.contact.name} <span className="text-xs text-muted">({primary.relation})</span>
                          <div className="text-xs text-muted">
                            {primary.contact.phoneLast4 ? `••••${primary.contact.phoneLast4}` : ""} {primary.contact.waOptIn ? "· WhatsApp ✔" : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-warn">none</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No students match.</Empty>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          {page > 1 && (
            <Link className="btn" href={`/students?${qs(page - 1)}`}>
              ← Prev
            </Link>
          )}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="btn" href={`/students?${qs(page + 1)}`}>
              Next →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
