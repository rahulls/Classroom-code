import Link from "next/link";
import type { DemoView } from "@/modules/academics/demo";
import type { Occurrence } from "@/modules/academics/timetable";
import { type ClassMarks, MarkDots, markLabel } from "./class-marks";
import { WEEKDAYS, addDays, fmtMin } from "@/modules/academics/time";

const MAX_PER_DAY = 4;
const DEMO_COLOR = "#d97706";

type Occ = Occurrence & { marks?: ClassMarks };
type Item = { kind: "class"; o: Occ; start: number } | { kind: "demo"; dm: DemoView; start: number };

/** Month overview. Each day links to its week, where classes can be changed. */
export function MonthGrid({
  from,
  to,
  month,
  today,
  occurrences,
  showBatch,
  dayHref,
  demos = [],
}: {
  from: string;
  to: string;
  /** "YYYY-MM" of the month being shown (other days are dimmed). */
  month: string;
  today: string;
  occurrences: Occ[];
  showBatch: boolean;
  dayHref: (date: string) => string;
  demos?: DemoView[];
}) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const byDate = new Map<string, Item[]>();
  const add = (date: string, it: Item) => byDate.set(date, [...(byDate.get(date) ?? []), it]);
  for (const o of occurrences) add(o.date, { kind: "class", o, start: o.startMin });
  for (const dm of demos) add(dm.date, { kind: "demo", dm, start: dm.startMin });

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 border-l border-t border-line text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d.n} className="border-b border-r border-line bg-soft px-2 py-1.5 font-semibold">
            {d.short}
          </div>
        ))}
        {days.map((d) => {
          const list = (byDate.get(d) ?? []).sort((a, b) => a.start - b.start);
          const other = d.slice(0, 7) !== month;
          return (
            <Link
              key={d}
              href={dayHref(d)}
              className={`min-h-24 border-b border-r border-line p-1.5 hover:bg-accent/5 ${other ? "bg-soft/40 text-muted" : ""}`}
              title="Open this week"
            >
              <span className={`mb-1 inline-block rounded px-1 font-semibold ${d === today ? "bg-accent text-white" : ""}`}>{Number(d.slice(8))}</span>
              {list.slice(0, MAX_PER_DAY).map((it) =>
                it.kind === "demo" ? (
                  <span
                    key={`demo:${it.dm.id}`}
                    className={`mb-0.5 block truncate rounded border-l-4 bg-panel px-1 ${it.dm.cancelled ? "line-through opacity-50" : ""}`}
                    style={{ borderLeftColor: DEMO_COLOR }}
                    title={`Demo class for ${it.dm.personName}${it.dm.cancelled ? " (cancelled)" : ""}`}
                  >
                    {fmtMin(it.dm.startMin)} Demo · {it.dm.subject}
                  </span>
                ) : (
                  <ClassLine key={it.o.key} o={it.o} showBatch={showBatch} />
                ),
              )}
              {list.length > MAX_PER_DAY && <span className="text-muted">+{list.length - MAX_PER_DAY} more</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ClassLine({ o, showBatch }: { o: Occ; showBatch: boolean }) {
  return (
    <span
      className={`mb-0.5 flex items-center gap-1 rounded border-l-4 bg-panel px-1 ${o.kind === "cancelled" ? "line-through opacity-50" : ""}`}
      style={{ borderLeftColor: o.color ?? "rgb(var(--accent))" }}
      title={o.kind === "cancelled" ? undefined : markLabel(o.marks).replace(/^ · /, "") || undefined}
    >
      <span className="min-w-0 flex-1 truncate">
        {fmtMin(o.startMin)} {showBatch ? `${o.batchName} · ${o.subjectCode}` : o.subjectName}
        {o.kind === "extra" ? " · once" : o.kind === "moved" ? " · moved" : ""}
      </span>
      {o.marks && o.kind !== "cancelled" && <MarkDots marks={o.marks} className="shrink-0" />}
    </span>
  );
}

export { MarkLegend } from "./class-marks";
