import { epdb } from "@/modules/exam-prep/db";

export const metadata = { title: "Audit log" };

/** Append-only: who, when, old and new value for marks, consent, rank visibility, payments, deletions and settings. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const { entity } = await searchParams;
  const rows = await epdb.auditLog.findMany({ where: entity ? { entity } : {}, orderBy: { at: "desc" }, take: 300 });
  const entities = await epdb.auditLog.groupBy({ by: ["entity"], _count: { _all: true } });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#0f3460]">Audit log</h1>
      <form className="flex gap-2 text-sm">
        <select name="entity" defaultValue={entity ?? ""} className="input w-auto">
          <option value="">Everything</option>
          {entities.map((e) => (
            <option key={e.entity} value={e.entity}>
              {e.entity} ({e._count._all})
            </option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="table text-xs">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Old</th>
              <th>New</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{r.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                <td>{r.actor}</td>
                <td>{r.action}</td>
                <td className="font-mono">
                  {r.entity} {r.entityId.slice(-10)}
                </td>
                <td className="max-w-xs truncate font-mono">{r.old == null ? "" : JSON.stringify(r.old)}</td>
                <td className="max-w-xs truncate font-mono">{r.new == null ? "" : JSON.stringify(r.new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
