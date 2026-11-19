import Link from "next/link";
import { Breadcrumbs, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";

export const metadata = { title: "Audit log" };

const PREFIXES = ["auth", "student", "contact", "academics", "config", "platform"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePermission("audit.view");
  const { type } = await searchParams;
  const prefix = PREFIXES.includes(type ?? "") ? type : undefined;
  const rows = await db.auditLog.findMany({ where: prefix ? { action: { startsWith: `${prefix}.` } } : {}, orderBy: { at: "desc" }, take: 200 });

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings", href: "/settings" }, { label: "Audit log" }]} />
      <PageHeader title="Audit log" subtitle="Latest 200 entries. Entries can't be edited or deleted from the app." />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Link href="/settings/audit" className={`pill ${!prefix ? "border-accent text-accent" : ""}`}>
          All
        </Link>
        {PREFIXES.map((p) => (
          <Link key={p} href={`/settings/audit?type=${p}`} className={`pill ${prefix === p ? "border-accent text-accent" : ""}`}>
            {p}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4">When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap pl-4 text-xs">{r.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" })}</td>
                  <td>{r.actorName ?? <span className="text-muted">—</span>}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td className="text-xs text-muted">{r.entity ? `${r.entity}${r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}` : ""}</td>
                  <td className="max-w-xs truncate font-mono text-xs text-muted" title={JSON.stringify({ before: r.before, after: r.after })}>
                    {r.after ? JSON.stringify(r.after) : r.before ? JSON.stringify(r.before) : ""}
                  </td>
                  <td className="text-xs text-muted">{r.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No entries.</Empty>
      )}
    </>
  );
}
