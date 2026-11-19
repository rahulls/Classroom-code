"use client";

import Link from "next/link";
import { type ClassMarks, MarkDots, markLabel } from "./class-marks";
import { WEEKDAYS, fmtDate, fmtMin, fmtRange } from "@/modules/academics/time";

export type GridBlock = {
  id: string;
  weekday: number;
  startMin: number;
  durationMin: number;
  title: string;
  lines?: string[];
  color?: string | null;
  href?: string;
  warn?: boolean;
  /** Small tag in the corner, e.g. "once" or "moved". */
  badge?: string;
  /** Drawn faded and struck through (a cancelled class). */
  cancelled?: boolean;
  /** Logged-status dots for a past / today's class. */
  marks?: ClassMarks;
};


const PX_PER_MIN = 0.8; // 60 min = 48px, so block height is proportional to class length
const SNAP = 15; // clicking an empty spot snaps to 15-minute steps

/**
 * Mon–Sun time grid. Overlapping blocks on the same day are placed side by side in lanes.
 * Interactive when onEmptyClick / onBlockClick are given: click empty time to add, a block to edit.
 */
export function WeekGrid({
  blocks,
  emptyText = "No classes scheduled yet.",
  onEmptyClick,
  onBlockClick,
  minFrom,
  minTo,
  dates,
  today,
}: {
  blocks: GridBlock[];
  emptyText?: string;
  onEmptyClick?: (weekday: number, startMin: number) => void;
  onBlockClick?: (id: string) => void;
  /** Always show at least this range (minutes), so there's empty space to click. */
  minFrom?: number;
  minTo?: number;
  /** The 7 dates (Mon…Sun, "YYYY-MM-DD") when showing a real week rather than the weekly pattern. */
  dates?: string[];
  today?: string;
}) {
  const starts = blocks.map((b) => b.startMin);
  const ends = blocks.map((b) => b.startMin + b.durationMin);
  let from = Math.floor(Math.min(...starts, minFrom ?? Infinity, blocks.length ? Infinity : 8 * 60) / 60) * 60;
  let to = Math.ceil(Math.max(...ends, minTo ?? -Infinity, blocks.length ? -Infinity : 20 * 60) / 60) * 60;
  if (to - from < 4 * 60) to = Math.min(24 * 60, from + 4 * 60);
  if (to - from < 4 * 60) from = Math.max(0, to - 4 * 60);
  const height = (to - from) * PX_PER_MIN;
  const hourPx = 60 * PX_PER_MIN;
  const interactive = !!onEmptyClick;

  // Lane layout per day
  const placed = new Map<string, { lane: number; lanes: number }>();
  for (const d of WEEKDAYS) {
    const day = blocks.filter((b) => b.weekday === d.n).sort((a, b) => a.startMin - b.startMin || b.durationMin - a.durationMin);
    const laneEnds: number[] = [];
    const assigned: [string, number][] = [];
    for (const b of day) {
      let lane = laneEnds.findIndex((end) => end <= b.startMin);
      if (lane === -1) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = b.startMin + b.durationMin;
      assigned.push([b.id, lane]);
    }
    for (const [id, lane] of assigned) placed.set(id, { lane, lanes: Math.max(1, laneEnds.length) });
  }

  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[760px] text-xs" style={{ gridTemplateColumns: "48px repeat(7, minmax(96px, 1fr))" }}>
        <div />
        {WEEKDAYS.map((d) => {
          const date = dates?.[d.n - 1];
          const isToday = !!date && date === today;
          return (
            <div key={d.n} className={`border-b border-line px-2 py-1.5 font-semibold ${isToday ? "bg-accent/15 text-accent" : "bg-soft"}`}>
              {date ? fmtDate(date, { weekday: "short", day: "numeric", month: "short" }) : d.short}
              {isToday && <span className="ml-1 text-[10px] font-normal">today</span>}
            </div>
          );
        })}
        <div className="relative" style={{ height }}>
          {hours.map((m) => (
            <span key={m} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted" style={{ top: (m - from) * PX_PER_MIN }}>
              {fmtMin(m)}
            </span>
          ))}
        </div>
        {WEEKDAYS.map((d) => (
          <div
            key={d.n}
            className={`relative border-l border-soft ${interactive ? "cursor-cell hover:bg-accent/5" : ""}`}
            title={interactive ? `Click to add a class on ${dates ? fmtDate(dates[d.n - 1]!, { weekday: "long", day: "numeric", month: "short" }) : d.long}` : undefined}
            onClick={
              interactive
                ? (e) => {
                    if (e.target !== e.currentTarget) return; // clicks on a block are handled by the block
                    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                    const min = from + Math.floor(y / PX_PER_MIN / SNAP) * SNAP;
                    onEmptyClick(d.n, Math.max(0, Math.min(min, 23 * 60)));
                  }
                : undefined
            }
            style={{
              height,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourPx - 1}px, rgb(var(--soft)) ${hourPx - 1}px, rgb(var(--soft)) ${hourPx}px)`,
            }}
          >
            {blocks
              .filter((b) => b.weekday === d.n)
              .map((b) => {
                const p = placed.get(b.id) ?? { lane: 0, lanes: 1 };
                const w = 100 / p.lanes;
                const style = {
                  top: (b.startMin - from) * PX_PER_MIN,
                  height: Math.max(18, b.durationMin * PX_PER_MIN - 2),
                  left: `calc(${p.lane * w}% + 2px)`,
                  width: `calc(${w}% - 4px)`,
                  borderLeftColor: b.color ?? "rgb(var(--accent))",
                };
                const body = (
                  <>
                    <span className="absolute right-1 top-0.5 rounded bg-soft px-1 text-[10px]">{b.badge ?? `${b.durationMin}m`}</span>
                    <b className="line-clamp-2 block pr-7 leading-tight">{b.title}</b>
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="truncate">{fmtRange(b.startMin, b.durationMin)}</span>
                      {b.marks && !b.cancelled && <MarkDots marks={b.marks} className="shrink-0" />}
                    </span>
                    {b.lines?.map((l) => (
                      <span key={l} className="block truncate text-muted">
                        {l}
                      </span>
                    ))}
                  </>
                );
                const cls = `absolute overflow-hidden rounded border border-line border-l-4 bg-panel px-1.5 py-0.5 text-left leading-tight hover:border-accent ${b.warn ? "ring-2 ring-bad/60" : ""} ${b.cancelled ? "border-dashed opacity-50 line-through" : ""}`;
                const label = `${b.title} · ${d.long} ${fmtRange(b.startMin, b.durationMin)}${b.cancelled ? " (cancelled)" : b.badge ? ` (${b.badge})` : ""}${b.cancelled ? "" : markLabel(b.marks)}`;
                if (onBlockClick)
                  return (
                    <button key={b.id} type="button" className={cls} style={style} title={`${label} (click to change)`} onClick={() => onBlockClick(b.id)}>
                      {body}
                    </button>
                  );
                if (b.href)
                  return (
                    <Link key={b.id} href={b.href} className={cls} style={style} title={label}>
                      {body}
                    </Link>
                  );
                return (
                  <div key={b.id} className={cls} style={style} title={label}>
                    {body}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      {!blocks.length && <p className="mt-2 text-center text-xs text-muted">{emptyText}</p>}
    </div>
  );
}
