import Link from "next/link";
import { Breadcrumbs, Empty, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { getClassDelivery } from "@/modules/academics/delivery";
import { resolveYear } from "@/modules/academics/service";
import { fmtDate, todayYmd } from "@/modules/academics/time";

export const metadata = { title: "Class report" };

const REASON: Record<string, string> = { teacher: "cancelled by teacher", holiday: "holiday", other: "cancelled" };

export default async function ClassReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePermission("academics.view");
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : todayYmd().slice(0, 7);
  const year = await resolveYear();
  const { rows } = year ? await getClassDelivery({ yearId: year.id }, month) : { rows: [] };
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const total = rows.reduce(
    (t, r) => ({
      scheduled: t.scheduled + r.scheduled,
      held: t.held + r.held,
      cancelled: t.cancelled + r.cancelledByTeacher,
      madeUp: t.madeUp + r.madeUp,
      owed: t.owed + r.owed,
    }),
    { scheduled: 0, held: 0, cancelled: 0, madeUp: 0, owed: 0 },
  );

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Class report" }]} />
      <PageHeader
        title={`Class report · ${monthName}`}
        subtitle="Planned classes vs classes held, per batch and subject. Classes you cancel are owed as make-ups; students skipping a class is attendance, not shown here."
      />
      <form className="card mb-4 flex flex-wrap items-end gap-2" action="/reports/classes">
        <label>
          <span className="label">Month</span>
          <input type="month" name="month" defaultValue={month} className="input" />
        </label>
        <button className="btn">Show</button>
      </form>

      {rows.length ? (
        <>
          <p className="mb-3 text-sm">
            <b>{total.held}</b> classes held of <b>{total.scheduled}</b> planned · <b>{total.cancelled}</b> cancelled by you · <b className="text-ok">{total.madeUp}</b> made up ·{" "}
            <b className={total.owed ? "text-bad" : ""}>{total.owed}</b> make-up{total.owed === 1 ? "" : "s"} still owed
            {total.owed > 0 && (
              <Link href="/today" className="ml-2 text-accent hover:underline">
                Schedule them →
              </Link>
            )}
          </p>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Subject</th>
                  <th title="Weekly classes (including cancelled / moved ones) and one-time extra classes">Planned</th>
                  <th>Held</th>
                  <th>Upcoming</th>
                  <th>Moved</th>
                  <th>Cancelled by you</th>
                  <th>Made up</th>
                  <th>Make-up booked</th>
                  <th>Owed</th>
                  <th>Holidays</th>
                  <th title="Make-up classes held this month, possibly for an earlier month's cancellation">Make-ups held</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.batchId}:${r.subjectName}`} className="align-top">
                    <td>
                      <Link href={`/academics/${r.batchId}`} className="hover:underline">
                        {r.batchLabel}
                      </Link>
                    </td>
                    <td>{r.subjectName}</td>
                    <td>{r.scheduled}</td>
                    <td className="font-medium">{r.held}</td>
                    <td className="text-muted">{r.upcoming || ""}</td>
                    <td className="text-muted">{r.moved || ""}</td>
                    <td>{r.cancelledByTeacher || ""}</td>
                    <td className="text-ok">{r.madeUp || ""}</td>
                    <td className="text-muted">{r.makeupScheduled || ""}</td>
                    <td className={r.owed ? "font-semibold text-bad" : ""}>
                      {r.owed || ""}
                      {r.owedDates.length > 0 && <span className="block text-xs font-normal">{r.owedDates.map((d) => fmtDate(d)).join(", ")}</span>}
                    </td>
                    <td className="text-muted">{r.holidays || ""}</td>
                    <td className="text-muted">{r.makeupsHeld || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.notMadeUp.length) && (
            <section className="card mt-4 text-sm">
              <h2 className="mb-1 font-semibold">Cancelled without a make-up</h2>
              <ul className="space-y-0.5 text-xs text-muted">
                {rows.flatMap((r) =>
                  r.notMadeUp.map((n) => (
                    <li key={`${r.batchId}:${r.subjectName}:${n.date}`}>
                      {fmtDate(n.date)} · {r.batchLabel} · {r.subjectName} ({REASON[n.reason] ?? n.reason})
                    </li>
                  )),
                )}
              </ul>
            </section>
          )}
        </>
      ) : (
        <Empty>No classes in {monthName}.</Empty>
      )}
    </>
  );
}
