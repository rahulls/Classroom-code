import Link from "next/link";
import { addDays, fmtDate, mondayOf, ymdToDate } from "@/modules/academics/time";

export type CalView = "week" | "month";

/** First day of the month containing a date, and the first of the next / previous month. */
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export function shiftMonth(d: string, n: number) {
  const x = ymdToDate(monthStart(d));
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}

/** Visible range for a view: Mon–Sun for a week; whole Mon-aligned weeks covering the month. */
export function viewRange(view: CalView, date: string) {
  if (view === "week") {
    const from = mondayOf(date);
    return { from, to: addDays(from, 6) };
  }
  const from = mondayOf(monthStart(date));
  const to = addDays(mondayOf(addDays(shiftMonth(date, 1), -1)), 6);
  return { from, to };
}

export function periodLabel(view: CalView, date: string) {
  if (view === "month") return fmtDate(monthStart(date), { month: "long", year: "numeric" });
  const from = mondayOf(date);
  const to = addDays(from, 6);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${fmtDate(from, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${fmtDate(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Previous / today / next, a date picker and the week ↔ month switch. Plain links + a GET form: works without JavaScript. */
export function CalendarNav({ base, params, view, date, today }: { base: string; params: Record<string, string | undefined>; view: CalView; date: string; today: string }) {
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, view, date, ...over })) if (v) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  const step = (n: number) => (view === "week" ? addDays(mondayOf(date), 7 * n) : shiftMonth(date, n));
  const unit = view === "week" ? "week" : "month";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Link href={href({ date: step(-1) })} className="btn px-2.5" aria-label={`Previous ${unit}`} title={`Previous ${unit}`}>
          ←
        </Link>
        <Link href={href({ date: today })} className="btn px-2.5">
          Today
        </Link>
        <Link href={href({ date: step(1) })} className="btn px-2.5" aria-label={`Next ${unit}`} title={`Next ${unit}`}>
          →
        </Link>
      </div>
      <h2 className="text-base font-semibold" aria-live="polite">
        {periodLabel(view, date)}
      </h2>
      <form method="get" action={base} className="ml-auto flex items-center gap-1">
        {Object.entries(params).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <input type="hidden" name="view" value={view} />
        <input type="date" name="date" defaultValue={date} className="input py-1" aria-label="Go to date" />
        <button className="btn px-2.5">Go</button>
      </form>
      <div className="flex overflow-hidden rounded-md border border-line text-sm" role="group" aria-label="View">
        {(["week", "month"] as const).map((v) => (
          <Link key={v} href={href({ view: v })} className={`px-3 py-1.5 ${v === view ? "bg-accent text-white" : "hover:bg-soft"}`} aria-current={v === view ? "page" : undefined}>
            {v === "week" ? "Week" : "Month"}
          </Link>
        ))}
      </div>
    </div>
  );
}
