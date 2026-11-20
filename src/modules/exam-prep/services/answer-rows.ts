import "server-only";
import { audit } from "../audit";
import { epdb } from "../db";
import { chapterBreakdown, chapterWeights, checkRowMarks, parseAnswerRows, rowsTotal, sheetScore, type AnswerRow } from "../domain/answer-rows";
import { EpError } from "../errors";
import { getSettings } from "../settings";

// Marking formats (one fixed list of answer rows per class/board/subject) and row-wise marking of
// uploaded papers. An uploaded paper takes a copy of its format when it is created, so later changes
// to the format never alter a paper that is already being marked.

export type { AnswerRow };

const parseOrThrow = (text: string) => {
  const r = parseAnswerRows(text);
  if (r.errors.length) throw new EpError(r.errors.slice(0, 6).join(" · "));
  return r.rows;
};

export const listFormats = () => epdb.markingFormat.findMany({ orderBy: [{ klass: "asc" }, { board: "asc" }, { subject: "asc" }] });

export async function getFormat(klass: number, board: string, subject: string) {
  const f = await epdb.markingFormat.findUnique({ where: { klass_board_subject: { klass, board, subject } } });
  return f ? (f.rows as AnswerRow[]) : null;
}

export async function saveFormat(klass: number, board: string, subject: string, text: string) {
  const rows = parseOrThrow(text);
  const old = await epdb.markingFormat.findUnique({ where: { klass_board_subject: { klass, board, subject } } });
  const f = await epdb.markingFormat.upsert({ where: { klass_board_subject: { klass, board, subject } }, create: { klass, board, subject, rows }, update: { rows } });
  await audit({ action: old ? "format.changed" : "format.created", entity: "MarkingFormat", entityId: f.id, old: old ? { rows: (old.rows as AnswerRow[]).length } : null, new: { klass, board, subject, rows: rows.length, total: rowsTotal(rows) } });
  return rows;
}

export async function deleteFormat(id: string) {
  await epdb.markingFormat.delete({ where: { id } });
  await audit({ action: "format.deleted", entity: "MarkingFormat", entityId: id });
}

export const paperRows = (p: { answerRows: unknown }) => (p.answerRows as AnswerRow[] | null) ?? [];

async function uploadPaper(paperId: string) {
  const p = await epdb.paper.findUnique({ where: { id: paperId } });
  if (!p) throw new EpError("Paper not found.");
  if (!p.uploadOnly) throw new EpError("Answer rows are for uploaded papers; this one is built question by question.");
  return p;
}

const markedCount = (paperId: string) => epdb.rowMark.count({ where: { submission: { paperId } } });

/** Sets a paper's rows (from CSV text). Refused once any sheet has row marks, so marks never lose their row. */
export async function setPaperRows(paperId: string, text: string) {
  const p = await uploadPaper(paperId);
  if (await markedCount(paperId)) throw new EpError("Sheets are already marked on these rows. Clear those marks first, or make a new version of the paper.");
  const rows = parseOrThrow(text);
  await epdb.paper.update({ where: { id: paperId }, data: { answerRows: rows } });
  await audit({ action: "paper.rows_set", entity: "Paper", entityId: paperId, old: { rows: paperRows(p).length }, new: { rows: rows.length, total: rowsTotal(rows) } });
  return rows;
}

/** Copies the class/board/subject format onto the paper. */
export async function loadFormatIntoPaper(paperId: string) {
  const p = await uploadPaper(paperId);
  const rows = await getFormat(p.klass, p.board, p.subject);
  if (!rows) throw new EpError(`No marking format for Class ${p.klass} ${p.board} ${p.subject} yet. Add it under Papers → Marking formats.`);
  if (await markedCount(paperId)) throw new EpError("Sheets are already marked on these rows. Clear those marks first.");
  await epdb.paper.update({ where: { id: paperId }, data: { answerRows: rows } });
  await audit({ action: "paper.rows_set", entity: "Paper", entityId: paperId, new: { fromFormat: true, rows: rows.length } });
  return rows;
}

/**
 * Saves one sheet's row marks. `marks` maps label → marks (null = not marked: an existing mark is
 * removed). Everything is checked first; one bad value saves nothing.
 */
export async function setRowMarks(submissionId: string, marks: Record<string, number | null>, tags: Record<string, string> = {}) {
  const sub = await epdb.submission.findUnique({ where: { id: submissionId }, include: { paper: true, rowMarks: true } });
  if (!sub) throw new EpError("Sheet not found.");
  const rows = paperRows(sub.paper);
  if (!rows.length) throw new EpError("Add the paper's answer rows first.");
  // The check sees the sheet as it will be after saving (existing marks not in this form stay).
  const after: Record<string, number | null> = Object.fromEntries(sub.rowMarks.map((m) => [m.label, m.marks]));
  Object.assign(after, marks);
  try {
    checkRowMarks(rows, after);
  } catch (e) {
    throw new EpError((e as Error).message);
  }
  let changed = 0;
  for (const [label, m] of Object.entries(marks)) {
    const r = rows.find((x) => x.label === label)!;
    const old = sub.rowMarks.find((x) => x.label === label);
    const tag = m == null || m >= r.max ? "none" : (tags[label] ?? "none");
    if (m == null) {
      if (!old) continue;
      await epdb.rowMark.delete({ where: { id: old.id } });
      await audit({ action: "rowmark.removed", entity: "RowMark", entityId: old.id, old: { label, marks: old.marks } });
      changed++;
      continue;
    }
    if (old && old.marks === m && old.errorTag === tag) continue;
    const saved = await epdb.rowMark.upsert({
      where: { submissionId_label: { submissionId, label } },
      create: { submissionId, label, maxMarks: r.max, marks: m, errorTag: tag },
      update: { marks: m, maxMarks: r.max, errorTag: tag },
    });
    await audit({ action: old ? "rowmark.changed" : "rowmark.entered", entity: "RowMark", entityId: saved.id, old: old ? { marks: old.marks } : null, new: { label, marks: m, errorTag: tag } });
    changed++;
  }
  const fresh = await epdb.rowMark.findMany({ where: { submissionId } });
  const score = sheetScore(rows, fresh);
  if (score.open === 0 && sub.status !== "marked") await epdb.submission.update({ where: { id: submissionId }, data: { status: "marked" } });
  // Marking complete: the report is made (or rebuilt from the new marks) straight away. A report
  // problem never loses the saved marks; it is shown in the save message instead.
  let report: "created" | "rebuilt" | "kept" | "failed" | null = null;
  let reportError: string | undefined;
  if (score.open === 0 && (changed > 0 || !(await epdb.reportCard.count({ where: { studentId: sub.studentId, paperId: sub.paperId } })))) {
    try {
      const { makeSheetReport } = await import("./reports");
      report = await makeSheetReport(submissionId);
    } catch (e) {
      report = "failed";
      reportError = e instanceof Error ? e.message : String(e);
      console.error("[exam-prep] automatic report failed", submissionId, e);
    }
  }
  return { changed, ...score, report, reportError };
}

/** Each current sheet's score on an uploaded paper. */
export async function rowScores(paperId: string) {
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  const rows = paperRows(p);
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true }, include: { rowMarks: true } });
  return new Map(subs.map((s) => [s.id, sheetScore(rows, s.rowMarks)]));
}

/**
 * Class chapter view of an uploaded paper: per chapter, the class's marks out of the marks attempted and
 * where marks were lost. Group figures are hidden below the minimum cohort (same rule as built papers).
 */
export async function rowChapterView(paperId: string) {

  const s = await getSettings();
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  const rows = paperRows(p);
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true }, include: { rowMarks: true } });
  const sheets = subs.filter((x) => x.rowMarks.length).map((x) => chapterBreakdown(rows, x.rowMarks));
  const weights = chapterWeights(rows);
  const agg = new Map<string, { chapter: string; weight: number; got: number; max: number; lostBy: Record<string, number> }>();
  for (const [ch, w] of weights) agg.set(ch, { chapter: ch, weight: w, got: 0, max: 0, lostBy: {} });
  for (const lines of sheets)
    for (const l of lines) {
      const a = agg.get(l.chapter) ?? { chapter: l.chapter, weight: 0, got: 0, max: 0, lostBy: {} };
      a.got += l.got;
      a.max += l.max;
      for (const [k, v] of Object.entries(l.lostBy)) a.lostBy[k] = (a.lostBy[k] ?? 0) + v;
      agg.set(l.chapter, a);
    }
  return { sheets: sheets.length, hidden: sheets.length < s["cohort.minSize"], minSize: s["cohort.minSize"], chapters: [...agg.values()] };
}
