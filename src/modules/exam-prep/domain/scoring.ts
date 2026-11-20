// Pure scoring and chapter analytics (R5 MCQ scoring, R6). No I/O, no dates from the clock.

export type QItem = { id: string; chapter: string; marks: number; type?: string; correctOption?: string | null };
export type Band = "Strong" | "Okay" | "Average" | "Needs support";
/** average: optional fourth band between Okay and Needs support (0 or unset = off) */
export type BandCutoffs = { strong: number; okay: number; average?: number };
export const DEFAULT_CUTOFFS: BandCutoffs = { strong: 75, okay: 50 };

/** Percentage rounded half-up for display (37.5 → 38, 66.67 → 67). Bands use the exact value. */
export const roundPct = (p: number) => Math.floor(p + 0.5 + 1e-9);

export const pct = (got: number, max: number) => (max > 0 ? (100 * got) / max : 0);

/** Strong at `strong`% or more, Okay from `okay`% up to just under `strong`, else Needs support. */
export function band(p: number, c: BandCutoffs = DEFAULT_CUTOFFS): Band {
  if (p >= c.strong - 1e-9) return "Strong";
  if (p >= c.okay - 1e-9) return "Okay";
  if (c.average && c.average < c.okay && p >= c.average - 1e-9) return "Average";
  return "Needs support";
}

/** MCQ marks: full marks for the correct option, 0 otherwise (blank = 0). */
export function scoreMcq(questions: QItem[], chosen: Record<string, string | null | undefined>) {
  return questions
    .filter((q) => q.type === "mcq" && q.correctOption)
    .map((q) => {
      const c = (chosen[q.id] ?? "").toString().trim().toUpperCase() || null;
      return { questionId: q.id, chosenOption: c, marksAwarded: c && c === q.correctOption!.toUpperCase() ? q.marks : 0 };
    });
}

export type ChapterRow = { chapter: string; max: number; got: number; pct: number; display: number; band: Band; order: number };

/**
 * Chapter-wise totals for one sheet. `order` is the syllabus order (chapter list); chapters not in the
 * list go last in first-seen order. Questions without a mark count as 0 (blank answers).
 */
export function chapterBreakdown(questions: QItem[], marks: Record<string, number | undefined>, syllabus: string[] = [], cutoffs = DEFAULT_CUTOFFS): ChapterRow[] {
  const rows = new Map<string, { max: number; got: number; first: number }>();
  questions.forEach((q, i) => {
    const r = rows.get(q.chapter) ?? { max: 0, got: 0, first: i };
    r.max += q.marks;
    r.got += Math.min(q.marks, Math.max(0, marks[q.id] ?? 0));
    rows.set(q.chapter, r);
  });
  const orderOf = (ch: string, first: number) => {
    const i = syllabus.indexOf(ch);
    return i >= 0 ? i : syllabus.length + first;
  };
  return [...rows.entries()]
    .map(([chapter, r]) => {
      const p = pct(r.got, r.max);
      return { chapter, max: r.max, got: r.got, pct: p, display: roundPct(p), band: band(p, cutoffs), order: orderOf(chapter, r.first) };
    })
    .sort((a, b) => a.order - b.order);
}

export function totals(rows: { max: number; got: number }[]) {
  const max = rows.reduce((s, r) => s + r.max, 0);
  const got = rows.reduce((s, r) => s + r.got, 0);
  return { got, max, pct: pct(got, max) };
}

/** The n weakest chapters: lowest % first; ties by syllabus order. */
export function weakest(rows: ChapterRow[], n = 2) {
  return [...rows].sort((a, b) => a.pct - b.pct || a.order - b.order).slice(0, n);
}

/** The n strongest chapters: highest % first; ties by syllabus order. */
export function strongest(rows: ChapterRow[], n = 2) {
  return [...rows].sort((a, b) => b.pct - a.pct || a.order - b.order).slice(0, n);
}

/** Class average per chapter = all marks in that chapter / all available marks (pooled). */
export function classAverageByChapter(sheets: ChapterRow[][], syllabus: string[] = []) {
  const acc = new Map<string, { max: number; got: number; order: number }>();
  for (const rows of sheets)
    for (const r of rows) {
      const a = acc.get(r.chapter) ?? { max: 0, got: 0, order: r.order };
      a.max += r.max;
      a.got += r.got;
      acc.set(r.chapter, a);
    }
  return [...acc.entries()]
    .map(([chapter, a]) => ({ chapter, pct: pct(a.got, a.max), display: roundPct(pct(a.got, a.max)), order: syllabus.includes(chapter) ? syllabus.indexOf(chapter) : a.order }))
    .sort((a, b) => a.order - b.order);
}

/** Marks lost per error type, for one chapter or the whole sheet (paid tier). */
export function errorBreakdown(items: { chapter: string; marks: number; awarded: number; errorTag: string }[], chapter?: string) {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (chapter && it.chapter !== chapter) continue;
    const lost = Math.max(0, it.marks - it.awarded);
    if (!lost || it.errorTag === "none") continue;
    out[it.errorTag] = (out[it.errorTag] ?? 0) + lost;
  }
  return out;
}

/** Trend across papers (oldest first): change in % from the previous paper, once 2+ exist. */
export function trend(series: { paperId: string; pct: number }[]) {
  if (series.length < 2) return null;
  const last = series[series.length - 1]!;
  const prev = series[series.length - 2]!;
  return { points: series.map((s) => ({ paperId: s.paperId, pct: roundPct(s.pct) })), change: roundPct(last.pct) - roundPct(prev.pct), direction: last.pct > prev.pct + 0.5 ? "up" : last.pct < prev.pct - 0.5 ? "down" : "flat" };
}

/**
 * Chapters below `below`% in at least `papers` different papers (default: below 50 in two papers):
 * the repeating gaps that trigger an Offer (R10).
 */
export function repeatingGaps(history: { paperId: string; rows: { chapter: string; pct: number }[] }[], below = 50, papers = 2) {
  const count = new Map<string, Set<string>>();
  for (const h of history)
    for (const r of h.rows)
      if (r.pct < below - 1e-9) {
        const s = count.get(r.chapter) ?? new Set();
        s.add(h.paperId);
        count.set(r.chapter, s);
      }
  return [...count.entries()].filter(([, s]) => s.size >= papers).map(([c]) => c);
}

/** Time analysis: minutes per section against marks lost in it. */
export function timeVsLoss(times: Record<string, number> | null | undefined, lostBySection: Record<string, number>) {
  if (!times) return [];
  return Object.keys({ ...times, ...lostBySection })
    .sort()
    .map((s) => ({ section: s, minutes: times[s] ?? null, lost: lostBySection[s] ?? 0 }));
}
