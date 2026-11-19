import "server-only";
import { EpError } from "../errors";
import { aiMarker, assertRedacted, requestSummary, type MarkRequest } from "../adapters/ai-marker";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { aiAgreement, seededPick, spotCheckResult } from "../domain/commerce";
import { getSettings } from "../settings";
import { computeRanks } from "./ranking";

// R5 marking: MCQ auto-score, AI-assisted proposals (redacted), teacher review, error tags,
// self-marks, spot-checks and calibration. Every mark change is audited.

const ERROR_TAGS = ["concept", "calculation", "missing_steps", "misread", "none"] as const;
export type ErrorTag = (typeof ERROR_TAGS)[number];

/** Re-scores the MCQs of a submission from its saved responses (keeps any teacher override). */
export async function autoScoreMcq(submissionId: string) {
  const sub = await epdb.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { mcq: true, paper: { include: { items: { include: { question: true } } } } } });
  for (const r of sub.mcq) {
    const q = sub.paper.items.find((i) => i.questionId === r.questionId)?.question;
    if (!q || q.type !== "mcq") continue;
    const got = r.chosenOption && q.correctOption && r.chosenOption.toUpperCase() === q.correctOption.toUpperCase() ? q.marks : 0;
    const m = await epdb.mark.findUnique({ where: { submissionId_questionId: { submissionId, questionId: q.id } } });
    if (m && m.source === "teacher") continue;
    await epdb.mark.upsert({ where: { submissionId_questionId: { submissionId, questionId: q.id } }, create: { submissionId, questionId: q.id, marksAwarded: got, source: "auto", errorTag: got ? "none" : "concept" }, update: { marksAwarded: got } });
  }
}

/**
 * Proposes marks for every written question of every current sheet that has no mark yet. When AI
 * marking is off (the default) the proposals are kept for calibration and every one needs review.
 */
export async function proposeWithAi(paperId: string) {
  const s = await getSettings();
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: true }, orderBy: { number: "asc" } } } });
  const written = paper.items.filter((i) => i.question.type !== "mcq");
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true, NOT: { flags: { has: "late_no_report" } } }, include: { marks: true, student: { include: { parents: true } } } });
  let proposed = 0;
  let flagged = 0;
  for (const sub of subs) {
    const file = (sub.files as { path: string }[])[0];
    if (!file) continue;
    const base64 = (await storage.read(file.path)).toString("base64");
    for (const it of written) {
      if (sub.marks.some((m) => m.questionId === it.questionId)) continue;
      const req: MarkRequest = {
        studentCode: sub.student.code,
        questionId: it.questionId,
        questionNumber: it.number,
        questionText: it.question.text,
        maxMarks: it.question.marks,
        markingScheme: (it.question.markingScheme as { step: string; marks: number }[]) ?? [],
        sheet: { mediaType: "application/pdf", base64 },
      };
      // Personal data never leaves: refuse a request carrying the name, a parent's number or email, or the school
      assertRedacted(req as unknown as Record<string, unknown>, [sub.student.name, sub.student.school ?? "", ...sub.student.parents.flatMap((p) => [p.name, p.whatsapp, p.email ?? ""])]);
      await epdb.aiRequestLog.create({ data: { submissionId: sub.id, questionId: it.questionId, payload: requestSummary(req) as never } });
      const p = await aiMarker.propose(req, s);
      const needsReview = !s["marking.aiEnabled"] || p.confidence < s["marking.aiConfidence"] || p.blank || p.unreadable || (p.marks > 0 && p.marks < it.question.marks && p.confidence < 0.9 && p.reasoning.toLowerCase().includes("partial"));
      await epdb.mark.create({
        data: { submissionId: sub.id, questionId: it.questionId, marksAwarded: p.marks, source: "ai", aiProposed: p.marks, aiConfidence: p.confidence, aiReasoning: p.reasoning, aiErrorTag: p.errorTag, errorTag: p.errorTag, needsReview },
      });
      proposed++;
      if (needsReview) flagged++;
    }
  }
  return { proposed, flagged };
}

/** Teacher review: accept the proposal, or set the marks (edit / reject). Audited; ranks recomputed. */
export async function reviewMark(markId: string, o: { action: "accept" | "edit" | "reject"; marks?: number; errorTag?: ErrorTag; qualityNote?: string }) {
  const m = await epdb.mark.findUniqueOrThrow({ where: { id: markId }, include: { submission: true } });
  const q = await epdb.question.findUniqueOrThrow({ where: { id: m.questionId } });
  let marks = m.marksAwarded;
  if (o.action !== "accept") {
    marks = o.action === "reject" && o.marks == null ? 0 : Number(o.marks);
    if (!Number.isFinite(marks) || marks < 0 || marks > q.marks) throw new EpError(`Marks must be between 0 and ${q.marks}.`);
  }
  const errorTag = o.errorTag ?? (marks >= q.marks ? "none" : m.errorTag);
  if (!ERROR_TAGS.includes(errorTag as ErrorTag)) throw new EpError("Unknown error type.");
  const updated = await epdb.mark.update({
    where: { id: markId },
    data: { marksAwarded: marks, source: o.action === "accept" && m.source === "ai" ? "ai" : "teacher", errorTag, needsReview: false, reviewedAt: new Date(), qualityNote: o.qualityNote ?? m.qualityNote },
  });
  await audit({ action: `mark.${o.action}`, entity: "Mark", entityId: markId, old: { marks: m.marksAwarded, source: m.source, errorTag: m.errorTag }, new: { marks, source: updated.source, errorTag } });
  if (await epdb.rankRecord.count({ where: { paperId: m.submission.paperId } })) await computeRanks(m.submission.paperId);
  return updated;
}

/** Teacher enters a mark directly (no AI proposal). */
export async function setMark(submissionId: string, questionId: string, marks: number, errorTag: ErrorTag = "none", note?: string) {
  const q = await epdb.question.findUniqueOrThrow({ where: { id: questionId } });
  if (marks < 0 || marks > q.marks) throw new EpError(`Marks must be between 0 and ${q.marks}.`);
  const old = await epdb.mark.findUnique({ where: { submissionId_questionId: { submissionId, questionId } } });
  const m = await epdb.mark.upsert({
    where: { submissionId_questionId: { submissionId, questionId } },
    create: { submissionId, questionId, marksAwarded: marks, source: "teacher", errorTag: marks >= q.marks ? "none" : errorTag, reviewedAt: new Date() },
    update: { marksAwarded: marks, source: "teacher", errorTag: marks >= q.marks ? "none" : errorTag, needsReview: false, reviewedAt: new Date() },
  });
  await audit({ action: old ? "mark.changed" : "mark.entered", entity: "Mark", entityId: m.id, old: old ? { marks: old.marksAwarded, source: old.source } : null, new: { marks, source: "teacher", errorTag: m.errorTag } });
  const sub = await epdb.submission.findUniqueOrThrow({ where: { id: submissionId } });
  if (note) await epdb.correctionNote.create({ data: { studentId: sub.studentId, paperId: sub.paperId, note } });
  if (await epdb.rankRecord.count({ where: { paperId: sub.paperId } })) await computeRanks(sub.paperId);
  return m;
}

/** Self-entered marks (fallback): stored separately, never used as the final mark. */
export async function enterSelfMarks(submissionId: string, marks: Record<string, number>) {
  for (const [questionId, v] of Object.entries(marks)) {
    const q = await epdb.question.findUniqueOrThrow({ where: { id: questionId } });
    const claimed = Math.max(0, Math.min(q.marks, Number(v) || 0));
    await epdb.selfMarkEntry.upsert({ where: { submissionId_questionId: { submissionId, questionId } }, create: { submissionId, questionId, marksClaimed: claimed }, update: { marksClaimed: claimed } });
  }
}

// ------------------------------ spot-check and calibration ------------------------------

/** Picks the spot-check sheets once per paper (5-10 from settings). Running it again returns the same sheets. */
export async function selectSpotCheck(paperId: string, seed = Date.now()) {
  const existing = await epdb.spotCheck.findMany({ where: { paperId } });
  if (existing.length) return existing;
  const s = await getSettings();
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true }, select: { id: true }, orderBy: { id: "asc" } });
  const pick = seededPick(subs, s["marking.spotCount"], seed);
  for (const p of pick) await epdb.spotCheck.create({ data: { paperId, submissionId: p.id } });
  return epdb.spotCheck.findMany({ where: { paperId } });
}

/** Entered total for a sheet: self-marks where they exist, else the current (AI/auto) marks. */
export async function enteredTotal(submissionId: string) {
  const self = await epdb.selfMarkEntry.findMany({ where: { submissionId } });
  if (self.length) return self.reduce((a, x) => a + x.marksClaimed, 0);
  const marks = await epdb.mark.findMany({ where: { submissionId } });
  return marks.reduce((a, x) => a + x.marksAwarded, 0);
}

/** Records the teacher's own total for a spot-checked sheet against the entered marks. */
export async function recordSpotCheck(spotCheckId: string, teacherTotal: number) {
  const s = await getSettings();
  const sc = await epdb.spotCheck.findUniqueOrThrow({ where: { id: spotCheckId } });
  const entered = await enteredTotal(sc.submissionId);
  const r = spotCheckResult(entered, teacherTotal, s["marking.spotTolerance"]);
  await epdb.spotCheck.update({ where: { id: spotCheckId }, data: { result: r.result, deltaMarks: r.delta, checkedAt: new Date() } });
  await audit({ action: "spotcheck.recorded", entity: "SpotCheck", entityId: spotCheckId, new: r });
  return r;
}

export async function spotCheckSummary(paperId?: string) {
  const rows = await epdb.spotCheck.findMany({ where: { ...(paperId ? { paperId } : {}), checkedAt: { not: null } } });
  const mismatches = rows.filter((r) => r.result === "mismatch").length;
  return { checked: rows.length, mismatches, mismatchRate: rows.length ? (100 * mismatches) / rows.length : null, accuracy: rows.length ? (100 * (rows.length - mismatches)) / rows.length : null };
}

/** Calibration (R5): share of questions where the AI was within 1 mark of the teacher's final mark. */
export async function calibration() {
  const s = await getSettings();
  const marks = await epdb.mark.findMany({ where: { aiProposed: { not: null }, reviewedAt: { not: null } } });
  const sheets = new Set(marks.map((m) => m.submissionId)).size;
  const agreement = aiAgreement(marks.map((m) => ({ ai: m.aiProposed!, teacher: m.marksAwarded })));
  return { sheets, questions: marks.length, agreement, target: s["marking.calibrationTarget"], neededSheets: s["marking.calibrationSheets"], ready: sheets >= s["marking.calibrationSheets"] && (agreement ?? 0) >= s["marking.calibrationTarget"] };
}

/** Needs-review queue for a paper. */
export async function reviewQueue(paperId: string, onlyNeedsReview = true) {
  return epdb.mark.findMany({
    where: { submission: { paperId, isCurrent: true }, ...(onlyNeedsReview ? { needsReview: true } : {}) },
    include: { submission: { include: { student: true } } },
    orderBy: [{ submissionId: "asc" }, { questionId: "asc" }],
  });
}

/**
 * Published/closed → marked. Refused while any mark needs review or any written answer has no mark.
 * Computes the ranks.
 */
export async function markPaperMarked(paperId: string) {
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: true } } } });
  const open = await epdb.mark.count({ where: { needsReview: true, submission: { paperId, isCurrent: true } } });
  if (open) throw new EpError(`${open} mark${open === 1 ? " still needs" : "s still need"} review.`);
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true, NOT: { flags: { has: "late_no_report" } } }, include: { marks: true } });
  const missingMarks = subs.reduce((a, s) => a + paper.items.filter((i) => !s.marks.some((m) => m.questionId === i.questionId)).length, 0);
  if (missingMarks) throw new EpError(`${missingMarks} answer${missingMarks === 1 ? " has" : "s have"} no mark yet.`);
  await epdb.paper.update({ where: { id: paperId }, data: { status: "marked" } });
  await audit({ action: "paper.marked", entity: "Paper", entityId: paperId, old: { status: paper.status }, new: { status: "marked" } });
  await computeRanks(paperId);
}
