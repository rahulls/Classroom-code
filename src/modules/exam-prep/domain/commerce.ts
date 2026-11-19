// Pure commercial, marking-quality and metrics rules (R5 spot-check/calibration, R10, R12).

/** Price after the family discount (automatic for 2+ subjects). */
export function priceFor(p: { base: number; subjects: number; familyDiscountPct: number }) {
  const gross = p.base * Math.max(1, p.subjects);
  const discount = p.subjects >= 2 ? Math.round((gross * p.familyDiscountPct) / 100) : 0;
  return { gross, discount, net: gross - discount };
}

/** RCP-2026-0001: prefix, year and a sequence number that only goes up. */
export const receiptNo = (prefix: string, year: number, seq: number) => `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

/** An Offer is due only after `minReports` reports and only for repeating gaps. */
export const offerDue = (reportCount: number, gaps: string[], minReports = 2) => reportCount >= minReports && gaps.length > 0;

/** Deterministic pseudo-random pick (tests pass a seed; the app passes Date.now()). */
export function seededPick<T>(items: T[], n: number, seed: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.min(n, a.length));
}

/** Spot-check outcome: match when the totals are within `tolerance` marks. */
export function spotCheckResult(entered: number, teacher: number, tolerance = 0) {
  const delta = entered - teacher;
  return { delta, result: Math.abs(delta) <= tolerance + 1e-9 ? ("match" as const) : ("mismatch" as const) };
}

/** Share (0-100) of questions where the AI was within `within` marks of the teacher. */
export function aiAgreement(pairs: { ai: number; teacher: number }[], within = 1) {
  if (!pairs.length) return null;
  return (100 * pairs.filter((p) => Math.abs(p.ai - p.teacher) <= within + 1e-9).length) / pairs.length;
}

export const rate = (num: number, den: number) => (den > 0 ? (100 * num) / den : null);

/** Students who submitted two papers in a row (in the cohort's paper order). */
export function repeatRate(papers: string[], submitted: Record<string, Set<string>>) {
  const students = Object.keys(submitted);
  if (papers.length < 2 || !students.length) return null;
  const rep = students.filter((s) => papers.some((p, i) => i > 0 && submitted[s]!.has(p) && submitted[s]!.has(papers[i - 1]!)));
  return rate(rep.length, students.length);
}

/** Programme health (R12): green when, by week 6, enough students still submit and a few families pay. */
export function programmeHealth(p: { week: number; stillSubmittingPct: number | null; paidFamilies: number; minPct?: number; minPaid?: number }) {
  if (p.week < 6) return "early" as const;
  return (p.stillSubmittingPct ?? 0) >= (p.minPct ?? 60) && p.paidFamilies >= (p.minPaid ?? 2) ? ("green" as const) : ("amber" as const);
}
