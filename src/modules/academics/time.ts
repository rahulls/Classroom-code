// Pure time helpers (safe for server and client). Times are institute-local wall clock.

export const WEEKDAYS = [
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
  { n: 6, short: "Sat", long: "Saturday" },
  { n: 7, short: "Sun", long: "Sunday" },
] as const;

export const dayShort = (n: number) => WEEKDAYS[n - 1]?.short ?? "?";

/** "16:30" → 990 */
export function parseHHMM(v: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 990 → "16:30" */
export const fmtMin = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const fmtRange = (start: number, duration: number) => `${fmtMin(start)}–${fmtMin(start + duration)}`;

export const overlapsTime = (aStart: number, aDur: number, bStart: number, bDur: number) => aStart < bStart + bDur && bStart < aStart + aDur;

/** Date ranges [from, to] where a null `to` means open-ended. */
export function overlapsDates(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null) {
  return aFrom <= (bTo ?? new Date(8640000000000000)) && bFrom <= (aTo ?? new Date(8640000000000000));
}

// ── Calendar days as "YYYY-MM-DD" strings (institute-local) ──
// Kept as plain strings so server and browser agree regardless of their own timezone.

export const INSTITUTE_TZ = "Asia/Kolkata";

export const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: INSTITUTE_TZ }).format(new Date());

export const ymdToDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const dateToYmd = (d: Date) => d.toISOString().slice(0, 10);

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ymdToDate(s).getTime()) && dateToYmd(ymdToDate(s)) === s;
}

export function addDays(s: string, n: number) {
  const d = ymdToDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return dateToYmd(d);
}

/** 1 = Monday … 7 = Sunday */
export const weekdayOf = (s: string) => ((ymdToDate(s).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (s: string) => addDays(s, 1 - weekdayOf(s));

/** "2026-11-03" → "Tue, 3 Nov" */
export const fmtDate = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  ymdToDate(s).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
