import "server-only";
import { epdb } from "../db";
import { rankCohort } from "../domain/ranking";
import { chapterBreakdown, classAverageByChapter, errorBreakdown, pct, repeatingGaps, roundPct, strongest, timeVsLoss, totals, trend, weakest, type ChapterRow } from "../domain/scoring";
import { cutoffs, getSettings } from "../settings";
import { chapterList } from "./papers";
import { NO_CHAPTER, type AnswerRow } from "../domain/answer-rows";

// R6 analytics, read from Mark joined to Question. All the maths is in domain/ (pure functions).
// Group-level figures are hidden when the cohort is under the minimum size. This file never reads
// RankRecord (reports use it).

async function paperQuestions(paperId: string) {
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: true, section: true }, orderBy: { number: "asc" } } } });
  return { paper: p, qs: p.items.map((i) => ({ id: i.questionId, chapter: i.question.chapter, marks: i.question.marks, type: i.question.type, section: i.section.name, number: i.number, text: i.question.text })) };
}

/** One student's sheet for one paper: chapter rows, totals, strongest/weakest, error breakdown, time. */
export async function sheetAnalytics(studentId: string, paperId: string) {
  const sub = await epdb.submission.findFirst({ where: { studentId, paperId, isCurrent: true }, include: { marks: true, rowMarks: true } });
  if (!sub) return null;
  const s = await getSettings();
  const { paper, qs: built } = await paperQuestions(paperId);
  const syllabus = await chapterList(paper.klass, paper.subject, paper.board);
  // An uploaded paper is read from its answer rows (one "question" per row; for an OR choice, the attempted one)
  const qs: { id: string; chapter: string; marks: number; type: string; section: string; number: number | string; text: string }[] = paper.uploadOnly ? uploadedItems(paper.answerRows, sub.rowMarks) : built;
  const markOf = (id: string) => {
    if (paper.uploadOnly) {
      const m = sub.rowMarks.find((x) => x.label === id);
      return m ? { awarded: m.marks, errorTag: m.errorTag, qualityNote: null as string | null } : null;
    }
    const m = sub.marks.find((x) => x.questionId === id);
    return m ? { awarded: m.marksAwarded, errorTag: m.errorTag, qualityNote: m.qualityNote } : null;
  };
  const marks = Object.fromEntries(qs.map((q) => [q.id, markOf(q.id)?.awarded]));
  const rows = chapterBreakdown(qs, marks, syllabus, cutoffs(s));
  const t = totals(rows);
  const items = qs.map((q) => {
    const m = markOf(q.id);
    return { ...q, awarded: m?.awarded ?? 0, errorTag: m?.errorTag ?? "none", qualityNote: m?.qualityNote ?? null };
  });
  // Where the marks were lost: per reason, the marks and the question numbers (always in the report)
  const lostDetail: { tag: string; marks: number; questions: string[] }[] = [];
  for (const it of items) {
    const lost = it.marks - it.awarded;
    if (lost <= 0) continue;
    const tag = it.errorTag && it.errorTag !== "none" ? it.errorTag : "other";
    const d = lostDetail.find((x) => x.tag === tag) ?? lostDetail[lostDetail.push({ tag, marks: 0, questions: [] }) - 1]!;
    d.marks += lost;
    d.questions.push(String(it.number));
  }
  lostDetail.sort((a, b) => (a.tag === "other" ? 1 : b.tag === "other" ? -1 : b.marks - a.marks));
  const lostBySection: Record<string, number> = {};
  for (const it of items) lostBySection[it.section] = (lostBySection[it.section] ?? 0) + Math.max(0, it.marks - it.awarded);
  // Redo list: the 5 questions with the most marks lost (weak chapters first)
  const weakSet = new Set(weakest(rows, 2).map((r) => r.chapter));
  const redo = [...items]
    .filter((i) => i.awarded < i.marks)
    .sort((a, b) => Number(weakSet.has(b.chapter)) - Number(weakSet.has(a.chapter)) || b.marks - b.awarded - (a.marks - a.awarded) || String(a.number).localeCompare(String(b.number), "en", { numeric: true }))
    .slice(0, 5)
    .map((i) => ({ number: i.number, chapter: i.chapter, lost: i.marks - i.awarded }));
  return {
    paper,
    submission: sub,
    rows,
    totals: t,
    weak: weakest(rows, 2),
    strong: strongest(rows, 2),
    errors: errorBreakdown(items),
    errorsByChapter: Object.fromEntries(rows.map((r) => [r.chapter, errorBreakdown(items, r.chapter)])),
    quality: items.filter((i) => i.qualityNote).map((i) => ({ number: i.number, note: i.qualityNote! })),
    time: timeVsLoss(sub.sectionTimes as Record<string, number> | null, lostBySection),
    redo,
    lostDetail,
  };
}

/** Answer rows of an uploaded paper as report items: one per row; an OR group gives the attempted alternative (or its first). */
function uploadedItems(answerRows: unknown, rowMarks: { label: string }[]) {
  const rows = (answerRows as AnswerRow[] | null) ?? [];
  const marked = new Set(rowMarks.map((m) => m.label));
  const seen = new Set<string>();
  const out: { id: string; chapter: string; marks: number; type: string; section: string; number: string; text: string }[] = [];
  for (const r of rows) {
    let row = r;
    if (r.choice) {
      if (seen.has(r.choice)) continue;
      seen.add(r.choice);
      row = rows.find((x) => x.choice === r.choice && marked.has(x.label)) ?? r;
    }
    out.push({ id: row.label, chapter: row.chapter || NO_CHAPTER, marks: row.max, type: "row", section: row.section ?? "", number: row.label, text: "" });
  }
  return out;
}

/** A student's papers in one subject (oldest first) with the overall and per-chapter trend and repeating gaps. */
export async function studentHistory(studentId: string, subject: string) {
  const s = await getSettings();
  const subs = await epdb.submission.findMany({ where: { studentId, isCurrent: true, paper: { subject, kind: "paper", number: { gt: 0 } } }, include: { paper: true }, orderBy: { paper: { number: "asc" } } });
  const papers: { paperId: string; number: number; rows: ChapterRow[]; pct: number }[] = [];
  for (const sub of subs) {
    const a = await sheetAnalytics(studentId, sub.paperId);
    if (!a || !(a.submission.marks.length || a.submission.rowMarks.length)) continue;
    papers.push({ paperId: sub.paperId, number: sub.paper.number, rows: a.rows, pct: a.totals.pct });
  }
  const chapters = [...new Set(papers.flatMap((p) => p.rows.map((r) => r.chapter)))];
  return {
    papers,
    overall: trend(papers.map((p) => ({ paperId: p.paperId, pct: p.pct }))),
    byChapter: Object.fromEntries(chapters.map((c) => [c, trend(papers.filter((p) => p.rows.some((r) => r.chapter === c)).map((p) => ({ paperId: p.paperId, pct: p.rows.find((r) => r.chapter === c)!.pct })))])),
    repeatingGaps: repeatingGaps(papers, s["analytics.gapBelow"], s["analytics.gapPapers"]),
  };
}

/**
 * Class view for one paper (same class and board only): average by chapter, weakest chapters,
 * submission rate, and the class-band thirds. Group figures are hidden under the minimum cohort.
 */
export async function classView(paperId: string, board?: string) {
  const s = await getSettings();
  const { paper, qs } = await paperQuestions(paperId);
  const syllabus = await chapterList(paper.klass, paper.subject, paper.board);
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true, NOT: { flags: { has: "late_no_report" } }, ...(board ? { student: { board } } : {}) }, include: { marks: true, student: true } });
  const sheets = subs.filter((x) => x.marks.length).map((x) => ({ studentId: x.studentId, rows: chapterBreakdown(qs, Object.fromEntries(x.marks.map((m) => [m.questionId, m.marksAwarded])), syllabus, cutoffs(s)) }));
  const cohortSize = sheets.length;
  const hidden = cohortSize < s["cohort.minSize"];
  const avg = classAverageByChapter(
    sheets.map((x) => x.rows),
    syllabus,
  );
  const weakestChapters = [...avg].sort((a, b) => a.pct - b.pct || a.order - b.order).slice(0, 2);
  const { roster } = await import("./calendar");
  const roll = (await roster(paperId)).filter((r) => !board || r.board === board).length;
  return {
    paper,
    cohortSize,
    hidden,
    average: hidden ? null : avg,
    weakest: hidden ? null : weakestChapters,
    submissionRate: roll ? (100 * subs.length) / roll : null,
    submitted: subs.length,
    roll,
    sheets,
  };
}

/** Class band (Top third / Middle / Needs support) for a parent report, from the cohort's percentages. Null under the minimum cohort. */
export async function classBand(studentId: string, paperId: string) {
  const s = await getSettings();
  const { qs } = await paperQuestions(paperId);
  const max = qs.reduce((a, q) => a + q.marks, 0);
  const me = await epdb.student.findUniqueOrThrow({ where: { id: studentId } });
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true, NOT: { flags: { has: "late_no_report" } }, student: { board: me.board } }, include: { marks: true } });
  if (subs.length < s["cohort.minSize"]) return null;
  const r = rankCohort(
    subs.map((x) => ({ id: x.studentId, pct: pct(x.marks.reduce((a, m) => a + m.marksAwarded, 0), max) })),
    s["cohort.minSize"],
    cutoffs(s),
  );
  return r.find((x) => x.id === studentId)?.band ?? null;
}

export const display = roundPct;
