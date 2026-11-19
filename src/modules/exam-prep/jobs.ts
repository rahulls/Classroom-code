import "server-only";
import { examPrepEnabled } from "./config";
import { epdb } from "./db";
import { mondayOf, weekOf, weekTime } from "./domain/programme";
import { generateCalendar, weeklyTasks } from "./services/calendar";
import { suggestOffers } from "./services/commerce";
import { retentionReview } from "./services/privacy";
import { deliverReports } from "./services/reports";
import { getSettings } from "./settings";

// Exam Prep's scheduler (one registration in src/instrumentation.ts, only when EXAM_PREP_ENABLED).
// Every job is idempotent; JobRun records which period a once-per-period job has done.

/** Runs `fn` at most once per (job, period). */
export async function once<T>(job: string, periodKey: string, fn: () => Promise<T>) {
  const done = await epdb.jobRun.findUnique({ where: { job_periodKey: { job, periodKey } } });
  if (done) return { skipped: true as const, result: done.result as T };
  const result = await fn();
  try {
    await epdb.jobRun.create({ data: { job, periodKey, result: (result ?? null) as never } });
  } catch {
    /* a parallel run recorded it first */
  }
  return { skipped: false as const, result };
}

/** One scheduler tick. Safe to call any number of times. */
export async function tick(now = new Date()) {
  const s = await getSettings();
  const out: Record<string, unknown> = {};
  const day = now.toISOString().slice(0, 10);
  if (s["programme.startDate"]) {
    out.calendar = await once("calendar", `${day}:${s["programme.startDate"]}:${s["programme.weeks"]}`, generateCalendar);
    out.weekly = await weeklyTasks(now);
    // Sunday report delivery, from the configured time
    const week = weekOf(s["programme.startDate"], now);
    if (week >= 1 && now >= weekTime(mondayOf(s["programme.startDate"]), week, s["programme.times"].reports)) out.reports = await deliverReports(now);
  }
  out.offers = await once("offers", day, suggestOffers);
  out.retention = await once("retention", now.toISOString().slice(0, 7), retentionReview);
  return out;
}

const g = globalThis as unknown as { examPrepTimer?: ReturnType<typeof setInterval> };

export function startExamPrepScheduler(everyMs = 10 * 60_000) {
  if (!examPrepEnabled() || g.examPrepTimer) return;
  const run = () =>
    tick().catch((e) => console.error("[exam-prep] scheduler:", e instanceof Error ? e.message.replace(/\+?\d[\d\s-]{8,}/g, "[number]") : "error"));
  setTimeout(run, 30_000);
  g.examPrepTimer = setInterval(run, everyMs);
}
