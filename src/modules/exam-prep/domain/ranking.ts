// Pure ranking (R8): competition ranking with ties, cohort rules, class bands, telling sentences.

export type CohortBand = "Top third" | "Middle" | "Needs support";

/** Same class, board, subject and paper (the base paper id ignores versions). */
export const cohortKey = (c: { klass: number; board: string; subject: string; paperBaseId: string }) => `${c.klass}|${c.board}|${c.subject}|${c.paperBaseId}`;

/** Ranks on percentage, highest first; ties share a rank and the next rank skips (1, 2, 2, 4). */
export function rankWithTies<T extends { id: string; pct: number }>(entries: T[]): (T & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id));
  const out: (T & { rank: number })[] = [];
  sorted.forEach((e, i) => {
    const prev = out[i - 1];
    const rank = prev && Math.abs(prev.pct - e.pct) < 1e-9 ? prev.rank : i + 1;
    out.push({ ...e, rank });
  });
  return out;
}

/** Top, middle or bottom third of the cohort by rank position. */
export function thirdOf(rank: number, size: number): CohortBand {
  if (rank <= Math.ceil(size / 3)) return "Top third";
  if (rank <= Math.ceil((2 * size) / 3)) return "Middle";
  return "Needs support";
}

/** Below the minimum cohort size there is no rank: the band comes from the student's own percentage. */
export function bandFromPct(p: number, cut = { strong: 75, okay: 50 }): CohortBand {
  return p >= cut.strong ? "Top third" : p >= cut.okay ? "Middle" : "Needs support";
}

export type RankResult = { id: string; pct: number; rank: number | null; band: CohortBand; cohortSize: number; ranked: boolean };

/**
 * Ranks one cohort. With fewer than `minCohort` submissions nobody gets a rank (bands only).
 * Everyone who submitted counts in the cohort, whatever their rank consent.
 */
export function rankCohort(entries: { id: string; pct: number }[], minCohort = 5, cut = { strong: 75, okay: 50 }): RankResult[] {
  const size = entries.length;
  if (size < minCohort) return entries.map((e) => ({ id: e.id, pct: e.pct, rank: null, band: bandFromPct(e.pct, cut), cohortSize: size, ranked: false }));
  return rankWithTies(entries).map((e) => ({ id: e.id, pct: e.pct, rank: e.rank, band: thirdOf(e.rank, size), cohortSize: size, ranked: true }));
}

/** Who the teacher tells personally: ranked students who said yes to rank sharing. */
export function tellingList<T extends { rank: number | null; rankConsent: boolean }>(rows: T[]) {
  return rows.filter((r) => r.rank != null && r.rankConsent);
}

/**
 * The sentence the teacher sends. Bottom third leads with progress and one fixable chapter.
 * e.g. "Rank 6 of 23, up 3 places since Paper 2; Quadratic Equations is the gap."
 */
export function tellingSentence(r: { rank: number; size: number; previousRank?: number | null; previousPaperNo?: number | null; weakChapter?: string | null }) {
  const bottom = thirdOf(r.rank, r.size) === "Needs support";
  const moved = r.previousRank != null ? r.previousRank - r.rank : null;
  const since = r.previousPaperNo != null ? ` since Paper ${r.previousPaperNo}` : "";
  const move = moved == null ? "" : moved > 0 ? `up ${moved} place${moved === 1 ? "" : "s"}${since}` : moved < 0 ? `down ${-moved} place${moved === -1 ? "" : "s"}${since}` : `same place as last time`;
  if (bottom) {
    const lead = moved != null && moved > 0 ? `Good progress: ${move}` : "Good effort on this paper";
    const fix = r.weakChapter ? `; one fixable chapter to work on next: ${r.weakChapter}` : "";
    return `${lead}${fix}. Rank ${r.rank} of ${r.size}.`;
  }
  return `Rank ${r.rank} of ${r.size}${move ? `, ${move}` : ""}${r.weakChapter ? `; ${r.weakChapter} is the gap` : ""}.`;
}

/**
 * Students to follow up: ranked in the bottom third on a paper and then missed the next one or two papers.
 * `papers` is the cohort's paper order; `history` maps student → paperIds they submitted and their bands.
 */
export function stoppedAfterBottomThird(papers: string[], history: Record<string, { paperId: string; band: CohortBand }[]>, window = 2) {
  const out: string[] = [];
  for (const [student, rows] of Object.entries(history)) {
    const submitted = new Set(rows.map((r) => r.paperId));
    for (const r of rows) {
      if (r.band !== "Needs support") continue;
      const i = papers.indexOf(r.paperId);
      const next = papers.slice(i + 1, i + 1 + window);
      if (next.length && next.every((p) => !submitted.has(p))) {
        out.push(student);
        break;
      }
    }
  }
  return out;
}

/** Most improved (recognition by improvement, never rank): change between first and latest paper. */
export function mostImproved(series: Record<string, { pct: number }[]>, top = 5) {
  return Object.entries(series)
    .filter(([, s]) => s.length >= 2)
    .map(([id, s]) => ({ id, change: s[s.length - 1]!.pct - s[0]!.pct }))
    .filter((x) => x.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, top);
}
