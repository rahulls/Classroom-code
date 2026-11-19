import "server-only";
import { audit } from "../audit";
import { epdb } from "../db";
import { cohortKey, rankCohort, stoppedAfterBottomThird, tellingSentence, thirdOf, type CohortBand } from "../domain/ranking";
import { pct, weakest } from "../domain/scoring";
import { cutoffs, getSettings } from "../settings";
import { sheetAnalytics } from "./analytics";

// R8: ranks are computed per cohort (class, board, subject, paper) and are TEACHER-ONLY. Nothing that a
// student or parent sees (reports, PDFs, emails, group posts, offers) reads RankRecord: the privacy
// test scans those code paths for it.

/** Sheet percentage from the current marks (written + MCQ). Late-beyond-grace sheets are left out. */
async function cohortEntries(paperId: string) {
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: true } } } });
  const max = paper.items.reduce((s, i) => s + i.question.marks, 0);
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true, NOT: { flags: { has: "late_no_report" } } }, include: { marks: true, student: true } });
  return {
    paper,
    entries: subs
      .filter((s) => s.student.status !== "opted_out")
      .map((s) => ({ id: s.studentId, pct: pct(s.marks.reduce((a, m) => a + m.marksAwarded, 0), max), board: s.student.board, rankConsent: s.student.rankConsent })),
  };
}

/** Computes (or recomputes after a mark change) the RankRecords of one paper. Changes are audited. */
export async function computeRanks(paperId: string) {
  const s = await getSettings();
  const { paper, entries } = await cohortEntries(paperId);
  // A common-concept paper is taken by several boards: each board is its own cohort
  const boards = [...new Set(entries.map((e) => e.board))];
  const prevPaper = await epdb.paper.findFirst({ where: { klass: paper.klass, subject: paper.subject, board: paper.board, number: { lt: paper.number, gt: 0 }, kind: "paper", isCurrent: true }, orderBy: { number: "desc" } });
  const prevRanks = prevPaper ? await epdb.rankRecord.findMany({ where: { paperId: prevPaper.id } }) : [];
  let changed = 0;
  for (const board of boards) {
    const cohort = entries.filter((e) => e.board === board);
    const key = cohortKey({ klass: paper.klass, board, subject: paper.subject, paperBaseId: paper.baseId });
    for (const r of rankCohort(cohort, s["cohort.minSize"], cutoffs(s))) {
      const old = await epdb.rankRecord.findUnique({ where: { studentId_paperId: { studentId: r.id, paperId } } });
      const data = { cohortKey: key, cohortSize: r.cohortSize, rank: r.rank, band: r.band, percentage: r.pct, previousRank: prevRanks.find((p) => p.studentId === r.id)?.rank ?? null };
      if (old && old.rank === data.rank && old.band === data.band && Math.abs(old.percentage - data.percentage) < 1e-9 && old.cohortSize === data.cohortSize) continue;
      await epdb.rankRecord.upsert({ where: { studentId_paperId: { studentId: r.id, paperId } }, create: { studentId: r.id, paperId, ...data }, update: data });
      await audit({ action: old ? "rank.recomputed" : "rank.computed", entity: "RankRecord", entityId: `${r.id}|${paperId}`, old: old ? { rank: old.rank, band: old.band } : null, new: { rank: data.rank, band: data.band, cohortSize: data.cohortSize } });
      changed++;
    }
  }
  return changed;
}

/** The telling screen: ranked students who agreed, with change since the last paper, one weak chapter and the sentence. */
export async function tellingRows(paperId: string) {
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  const ranks = await epdb.rankRecord.findMany({ where: { paperId, rank: { not: null } }, include: { student: { include: { parents: true } } }, orderBy: { rank: "asc" } });
  const prevPaper = await epdb.paper.findFirst({ where: { klass: paper.klass, subject: paper.subject, board: paper.board, number: { lt: paper.number, gt: 0 }, kind: "paper", isCurrent: true }, orderBy: { number: "desc" } });
  const rows = [];
  for (const r of ranks) {
    if (!r.student.rankConsent || r.student.status === "opted_out") continue;
    const a = await sheetAnalytics(r.studentId, paperId);
    const weak = a ? weakest(a.rows, 1)[0]?.chapter : null;
    const sentence = tellingSentence({ rank: r.rank!, size: r.cohortSize, previousRank: r.previousRank, previousPaperNo: prevPaper?.number ?? null, weakChapter: weak });
    const parent = r.student.parents.find((p) => !p.optedOutAt && p.numberVerifiedAt);
    rows.push({ record: r, student: r.student, weak, sentence, bottomThird: thirdOf(r.rank!, r.cohortSize) === "Needs support", parent });
  }
  return rows;
}

export async function markTold(rankId: string, channel: string, by = "teacher") {
  const r = await epdb.rankRecord.update({ where: { id: rankId }, data: { toldAt: new Date(), toldBy: by, channel } });
  await audit({ action: "rank.told", entity: "RankRecord", entityId: rankId, new: { channel, toldAt: r.toldAt } });
}

/** Rank trend for one student across papers (teacher-only). */
export const rankTrend = (studentId: string) => epdb.rankRecord.findMany({ where: { studentId }, orderBy: { updatedAt: "asc" } });

/** Students who stopped submitting within two papers after a bottom-third rank: follow them up. */
export async function followUps(klass: number, subject: string, board: string) {
  const papers = await epdb.paper.findMany({ where: { klass, subject, board, kind: "paper", isCurrent: true, number: { gt: 0 }, status: { in: ["closed", "marked", "reported", "published"] } }, orderBy: { number: "asc" } });
  const ranks = await epdb.rankRecord.findMany({ where: { paperId: { in: papers.map((p) => p.id) } } });
  const history: Record<string, { paperId: string; band: CohortBand }[]> = {};
  for (const r of ranks) (history[r.studentId] ??= []).push({ paperId: r.paperId, band: r.band as CohortBand });
  const ids = stoppedAfterBottomThird(
    papers.map((p) => p.id),
    history,
  );
  return epdb.student.findMany({ where: { id: { in: ids } } });
}
