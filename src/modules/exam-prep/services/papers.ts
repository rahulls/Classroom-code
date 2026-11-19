import "server-only";
import { z } from "zod";
import { EpError } from "../errors";
import { pdf } from "../adapters/pdf";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { checkPaper, paperId as makePaperId, SUBJECT_CODE } from "../domain/programme";
import { getSettings } from "../settings";
import { esc, pageHtml } from "./html";
import { parseCsv } from "./people";

// R2 question bank and papers.

export const QuestionInput = z.object({
  chapter: z.string().trim().min(1, "Chapter is required"),
  topic: z.string().trim().min(1, "Topic is required").max(120),
  marks: z.coerce.number().positive("Marks must be more than 0").max(100),
  type: z.enum(["mcq", "short", "long", "case", "assertion"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  text: z.string().trim().min(3, "Question text is required").max(4000),
  options: z.array(z.string().trim()).max(4).default([]),
  correctOption: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[ABCD]$/)
    .optional()
    .or(z.literal("")),
  markingScheme: z.array(z.object({ step: z.string().trim().min(1), marks: z.coerce.number().min(0) })).default([]),
  solution: z.string().trim().max(6000).optional(),
  /** CBSE internal choice: the alternative (B) question, with its own marking scheme (same marks) */
  or: z
    .object({
      text: z.string().trim().min(3).max(4000),
      markingScheme: z.array(z.object({ step: z.string().trim().min(1), marks: z.coerce.number().min(0) })).default([]),
      solution: z.string().trim().max(6000).optional(),
    })
    .optional(),
});
export type QuestionIn = z.infer<typeof QuestionInput>;

// ------------------------------ chapter lists ------------------------------

export async function chapterList(klass: number, subject: string, board: string) {
  const row = (await epdb.chapterList.findUnique({ where: { klass_subject_board: { klass, subject, board } } })) ?? (await epdb.chapterList.findUnique({ where: { klass_subject_board: { klass, subject, board: "CBSE" } } }));
  return row?.chapters ?? [];
}

export async function setChapterList(klass: number, subject: string, board: string, chapters: string[]) {
  const clean = [...new Set(chapters.map((c) => c.trim()).filter(Boolean))];
  if (!clean.length) throw new EpError("Give at least one chapter.");
  const old = await epdb.chapterList.findUnique({ where: { klass_subject_board: { klass, subject, board } } });
  await epdb.chapterList.upsert({ where: { klass_subject_board: { klass, subject, board } }, create: { klass, subject, board, chapters: clean }, update: { chapters: clean } });
  await audit({ action: "chapters.changed", entity: "ChapterList", entityId: `${klass}|${subject}|${board}`, old: old?.chapters ?? null, new: clean });
}

// ------------------------------ papers ------------------------------

export async function createPaper(p: { klass: number; subject: string; board: string; number: number; title?: string; kind?: "paper" | "mock" | "quiz"; mockMinutes?: number; opensAt?: Date; dueAt?: Date; uploadOnly?: boolean; totalMarks?: number }) {
  const s = await getSettings();
  const id = makePaperId(p);
  if (await epdb.paper.findUnique({ where: { id } })) throw new EpError(`Paper ${id} already exists.`);
  if (p.uploadOnly && !(p.totalMarks && p.totalMarks > 0)) throw new EpError("Give the paper's total marks.");
  const pattern = s["papers.patterns"][p.board] ?? s["papers.patterns"].CBSE ?? [];
  const paper = await epdb.paper.create({
    data: {
      id,
      baseId: id,
      klass: p.klass,
      subject: p.subject,
      board: p.board,
      number: p.number,
      isDiagnostic: p.number === 0,
      kind: p.kind ?? "paper",
      mockMinutes: p.kind === "mock" ? (p.mockMinutes ?? 180) : null,
      title: p.title || (p.number === 0 ? `Paper 0 (diagnostic)` : p.kind === "quiz" ? "Chapter quiz" : p.kind === "mock" ? "Full-length mock" : `Paper ${p.number}`),
      pattern: s["papers.patterns"][p.board] ? p.board : "CBSE",
      opensAt: p.opensAt,
      dueAt: p.dueAt,
      uploadOnly: !!p.uploadOnly,
      totalMarks: p.uploadOnly ? p.totalMarks : null,
      sections: { create: (p.kind === "quiz" ? [{ name: "A", type: "mcq" as const }] : pattern).map((sec, i) => ({ name: sec.name, type: sec.type, order: i })) },
    },
  });
  await audit({ action: "paper.created", entity: "Paper", entityId: id, new: { klass: p.klass, subject: p.subject, board: p.board, number: p.number, kind: paper.kind } });
  return paper;
}

export async function paperWithQuestions(id: string) {
  return epdb.paper.findUnique({ where: { id }, include: { sections: { orderBy: { order: "asc" } }, items: { include: { question: true, section: true }, orderBy: { number: "asc" } } } });
}

function assertDraft(p: { status: string; id: string }) {
  if (p.status !== "draft") throw new EpError(`${p.id} is published and can't change. Make a new version to edit it.`);
}

async function validateChapter(klass: number, subject: string, board: string, chapter: string) {
  const list = await chapterList(klass, subject, board);
  if (list.length && !list.includes(chapter)) throw new EpError(`"${chapter}" is not in the Class ${klass} ${board} ${subject} chapter list.`);
}

function checkQuestion(q: QuestionIn) {
  if (q.type === "mcq") {
    if (q.options.filter(Boolean).length < 2) throw new EpError("An MCQ needs its options.");
    if (!q.correctOption) throw new EpError("An MCQ needs its correct option.");
  } else {
    if (!q.markingScheme.length) throw new EpError("Written questions need a marking scheme with marks per step.");
    const sum = q.markingScheme.reduce((a, s) => a + s.marks, 0);
    if (Math.abs(sum - q.marks) > 1e-9) throw new EpError(`The marking scheme adds up to ${sum}, but the question is worth ${q.marks}.`);
  }
  if (q.or) {
    if (q.type === "mcq") throw new EpError("Internal choice (OR) is for written questions, not MCQs.");
    const sum = q.or.markingScheme.reduce((a, s) => a + s.marks, 0);
    if (!q.or.markingScheme.length || Math.abs(sum - q.marks) > 1e-9) throw new EpError(`The OR question's marking scheme adds up to ${sum}, but the question is worth ${q.marks}.`);
  }
}

/** Adds a new question to the bank and to the paper. */
export async function addQuestion(paperId: string, sectionId: string, input: QuestionIn) {
  const q = QuestionInput.parse(input);
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: true } });
  assertDraft(paper);
  await validateChapter(paper.klass, paper.subject, paper.board, q.chapter);
  checkQuestion(q);
  const number = (paper.items.reduce((m, i) => Math.max(m, i.number), 0) || 0) + 1;
  return epdb.$transaction(async (tx) => {
    const row = await tx.question.create({
      data: {
        klass: paper.klass,
        subject: paper.subject,
        board: paper.board,
        chapter: q.chapter,
        topic: q.topic,
        marks: q.marks,
        type: q.type,
        difficulty: q.difficulty,
        text: q.text,
        options: q.type === "mcq" ? q.options : [],
        correctOption: q.type === "mcq" ? q.correctOption || null : null,
        markingScheme: q.type === "mcq" ? undefined : q.markingScheme,
        solution: q.solution,
        orText: q.or?.text,
        orMarkingScheme: q.or ? q.or.markingScheme : undefined,
        orSolution: q.or?.solution,
      },
    });
    await tx.paperQuestion.create({ data: { paperId, sectionId, questionId: row.id, number } });
    return row;
  });
}

/** Reuses a bank question in another paper (same class, subject and board). */
export async function reuseQuestion(paperId: string, sectionId: string, questionId: string) {
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: true } });
  assertDraft(paper);
  const q = await epdb.question.findUniqueOrThrow({ where: { id: questionId } });
  if (q.klass !== paper.klass || q.subject !== paper.subject) throw new EpError("That question is for a different class or subject.");
  if (paper.items.some((i) => i.questionId === questionId)) throw new EpError("That question is already on this paper.");
  const number = (paper.items.reduce((m, i) => Math.max(m, i.number), 0) || 0) + 1;
  return epdb.paperQuestion.create({ data: { paperId, sectionId, questionId, number } });
}

export async function removeQuestion(paperId: string, paperQuestionId: string) {
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  assertDraft(paper);
  await epdb.paperQuestion.delete({ where: { id: paperQuestionId } });
  // Renumber 1..n
  const rest = await epdb.paperQuestion.findMany({ where: { paperId }, orderBy: { number: "asc" } });
  for (const [i, r] of rest.entries()) await epdb.paperQuestion.update({ where: { id: r.id }, data: { number: -(i + 1) } });
  for (const [i, r] of rest.entries()) await epdb.paperQuestion.update({ where: { id: r.id }, data: { number: i + 1 } });
}

export async function paperCheck(id: string) {
  const p = await paperWithQuestions(id);
  if (!p) throw new EpError("Paper not found.");
  const s = await getSettings();
  const chapters = await chapterList(p.klass, p.subject, p.board);
  return checkPaper(
    p.items.map((i) => i.question),
    chapters,
    { mcqMin: s["marking.mcqShare"].min, mcqMax: s["marking.mcqShare"].max, chMin: s["marking.chaptersPerPaper"].min, chMax: s["marking.chaptersPerPaper"].max },
  );
}

/** Draft → published. Refused while any question is untagged or invalid. Locks the structure. */
export async function publishPaper(id: string) {
  const p = await epdb.paper.findUniqueOrThrow({ where: { id } });
  assertDraft(p);
  if (p.uploadOnly) {
    // The tutor's own file: it only needs the paper itself uploaded
    if (!(await currentPaperFile(id, "paper"))) throw new EpError("Upload the paper file (PDF or CSV) first.");
    await epdb.paper.update({ where: { id }, data: { status: "published", publishedAt: new Date() } });
    await audit({ action: "paper.published", entity: "Paper", entityId: id, old: { status: "draft" }, new: { status: "published", uploadOnly: true, total: p.totalMarks } });
    return { problems: [], warnings: [], total: p.totalMarks ?? 0, mcqShare: 0, chapters: [], byChapter: {} };
  }
  const c = await paperCheck(id);
  if (c.problems.length) throw new EpError(`Can't publish: ${c.problems[0]}${c.problems.length > 1 ? ` (and ${c.problems.length - 1} more)` : ""}`);
  const now = new Date();
  await epdb.paper.update({ where: { id }, data: { status: "published", publishedAt: now } });
  await audit({ action: "paper.published", entity: "Paper", entityId: id, old: { status: "draft" }, new: { status: "published", total: c.total } });
  return c;
}

/** A published paper is never edited: this makes version n+1 as a draft and keeps the old one. */
export async function newVersion(id: string) {
  const p = await paperWithQuestions(id);
  if (!p) throw new EpError("Paper not found.");
  if (p.status === "draft") throw new EpError("This paper is still a draft: edit it directly.");
  const latest = await epdb.paper.findFirst({ where: { baseId: p.baseId }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? p.version) + 1;
  const nid = makePaperId({ klass: p.klass, subject: p.subject, number: p.number, board: p.board, version });
  return epdb.$transaction(async (tx) => {
    await tx.paper.updateMany({ where: { baseId: p.baseId }, data: { isCurrent: false } });
    const np = await tx.paper.create({
      data: {
        id: nid,
        baseId: p.baseId,
        version,
        klass: p.klass,
        subject: p.subject,
        board: p.board,
        number: p.number,
        title: p.title,
        kind: p.kind,
        pattern: p.pattern,
        mockMinutes: p.mockMinutes,
        opensAt: p.opensAt,
        dueAt: p.dueAt,
        graceHours: p.graceHours,
        isDiagnostic: p.isDiagnostic,
        isCurrent: true,
      },
    });
    const map = new Map<string, string>();
    for (const sec of p.sections) {
      const ns = await tx.section.create({ data: { paperId: nid, name: sec.name, type: sec.type, order: sec.order } });
      map.set(sec.id, ns.id);
    }
    for (const it of p.items) await tx.paperQuestion.create({ data: { paperId: nid, sectionId: map.get(it.sectionId)!, questionId: it.questionId, number: it.number } });
    await audit({ action: "paper.versioned", entity: "Paper", entityId: nid, old: { from: id }, new: { version } }, tx);
    return np;
  });
}

/** Copies a paper to another board: new question rows with the same tags; the teacher then edits. */
export async function clonePaperToBoard(id: string, board: string) {
  const p = await paperWithQuestions(id);
  if (!p) throw new EpError("Paper not found.");
  if (board === p.board) throw new EpError("Choose a different board.");
  const np = await createPaper({ klass: p.klass, subject: p.subject, board, number: p.number, title: p.title, kind: p.kind as "paper", mockMinutes: p.mockMinutes ?? undefined });
  const secs = await epdb.section.findMany({ where: { paperId: np.id }, orderBy: { order: "asc" } });
  for (const it of p.items) {
    const target = secs.find((s) => s.type === it.section.type) ?? secs[0]!;
    const q = it.question;
    const nq = await epdb.question.create({
      data: {
        klass: q.klass,
        subject: q.subject,
        board,
        chapter: q.chapter,
        topic: q.topic,
        marks: q.marks,
        type: q.type,
        difficulty: q.difficulty,
        text: q.text,
        options: q.options,
        correctOption: q.correctOption,
        markingScheme: q.markingScheme ?? undefined,
        solution: q.solution,
        orText: q.orText,
        orMarkingScheme: q.orMarkingScheme ?? undefined,
        orSolution: q.orSolution,
      },
    });
    await epdb.paperQuestion.create({ data: { paperId: np.id, sectionId: target.id, questionId: nq.id, number: it.number } });
  }
  await audit({ action: "paper.cloned", entity: "Paper", entityId: np.id, old: { from: id }, new: { board } });
  return np;
}

// ------------------------------ import / export ------------------------------

export async function exportQuestions(paperId: string) {
  const p = await paperWithQuestions(paperId);
  if (!p) throw new EpError("Paper not found.");
  return {
    paper: { id: p.id, klass: p.klass, subject: p.subject, board: p.board, number: p.number, title: p.title },
    questions: p.items.map((i) => ({
      number: i.number,
      section: i.section.name,
      chapter: i.question.chapter,
      topic: i.question.topic,
      marks: i.question.marks,
      type: i.question.type,
      difficulty: i.question.difficulty,
      text: i.question.text,
      options: i.question.options,
      correctOption: i.question.correctOption,
      markingScheme: i.question.markingScheme,
      solution: i.question.solution,
      ...(i.question.orText ? { or: { text: i.question.orText, markingScheme: i.question.orMarkingScheme, solution: i.question.orSolution } } : {}),
    })),
  };
}

/**
 * Imports questions into a draft paper from JSON ({questions: [...]}) or CSV (section, chapter, topic,
 * marks, type, difficulty, text, option_a..d, correct_option, scheme as "step:marks|step:marks", solution).
 * All or nothing.
 */
export async function importQuestions(paperId: string, text: string) {
  const p = await paperWithQuestions(paperId);
  if (!p) throw new EpError("Paper not found.");
  assertDraft(p);
  let rows: (QuestionIn & { section?: string })[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const j = JSON.parse(trimmed) as { questions?: unknown[] } | unknown[];
    rows = (Array.isArray(j) ? j : (j.questions ?? [])) as typeof rows;
  } else {
    const csv = parseCsv(trimmed);
    const h = csv[0]!.map((x) => x.trim().toLowerCase());
    const g = (r: string[], k: string) => (h.indexOf(k) >= 0 ? (r[h.indexOf(k)] ?? "").trim() : "");
    rows = csv.slice(1).map((r) => ({
      section: g(r, "section"),
      chapter: g(r, "chapter"),
      topic: g(r, "topic"),
      marks: Number(g(r, "marks")),
      type: g(r, "type") as QuestionIn["type"],
      difficulty: g(r, "difficulty") as QuestionIn["difficulty"],
      text: g(r, "text"),
      options: ["option_a", "option_b", "option_c", "option_d"].map((k) => g(r, k)).filter(Boolean),
      correctOption: g(r, "correct_option"),
      markingScheme: g(r, "scheme")
        .split("|")
        .filter(Boolean)
        .map((s) => {
          const i = s.lastIndexOf(":");
          return { step: s.slice(0, i).trim(), marks: Number(s.slice(i + 1)) };
        }),
      solution: g(r, "solution") || undefined,
    }));
  }
  const errors: string[] = [];
  const chapters = await chapterList(p.klass, p.subject, p.board);
  const parsed = rows.map((r, i) => {
    const v = QuestionInput.safeParse(r);
    if (!v.success) {
      errors.push(`Question ${i + 1}: ${v.error.issues[0]?.message}`);
      return null;
    }
    try {
      checkQuestion(v.data);
      if (chapters.length && !chapters.includes(v.data.chapter)) throw new EpError(`"${v.data.chapter}" is not in the chapter list`);
    } catch (e) {
      errors.push(`Question ${i + 1}: ${(e as Error).message}`);
    }
    return { ...v.data, section: (r as { section?: string }).section };
  });
  if (errors.length) return { imported: 0, errors };
  for (const q of parsed) {
    const sec = p.sections.find((s) => s.name === q!.section) ?? p.sections.find((s) => (q!.type === "mcq" ? s.type === "mcq" : s.type !== "mcq")) ?? p.sections[0]!;
    await addQuestion(paperId, sec.id, q!);
  }
  return { imported: parsed.length, errors };
}

// ------------------------------ PDFs: paper, key, solutions, quiz, formula sheet ------------------------------

type Full = NonNullable<Awaited<ReturnType<typeof paperWithQuestions>>>;

function paperBody(p: Full, mode: "paper" | "key" | "solutions") {
  const total = p.items.reduce((s, i) => s + i.question.marks, 0);
  const head = `<h1>${esc(p.title)}${mode === "key" ? ": answer key" : mode === "solutions" ? ": worked solutions" : ""}</h1>
<p class="muted">${esc(p.id)} · Class ${p.klass} ${esc(p.board)} ${esc(p.subject)} · ${total} marks${p.kind === "mock" && p.mockMinutes ? ` · ${p.mockMinutes} minutes, exam conditions` : ""}</p>
${mode === "paper" ? `<p class="muted">Write your student code, class and paper id at the top of page 1. Show all steps.</p>` : ""}`;
  const secs = p.sections
    .map((sec) => {
      const items = p.items.filter((i) => i.sectionId === sec.id);
      if (!items.length) return "";
      const qs = items
        .map((i) => {
          const q = i.question;
          const opts = q.type === "mcq" ? `<div class="opts">${q.options.map((o, k) => `(${"ABCD"[k]}) ${esc(o)}`).join(" &nbsp; ")}</div>` : "";
          const ans =
            mode === "key"
              ? q.type === "mcq"
                ? `<div><b>Answer: ${esc(q.correctOption)}</b></div>`
                : `<div><b>Marking scheme:</b> ${((q.markingScheme as { step: string; marks: number }[]) ?? []).map((st) => `${esc(st.step)} [${st.marks}]`).join("; ")}</div>`
              : mode === "solutions"
                ? `<div><b>Solution:</b> ${esc(q.solution || (q.type === "mcq" ? `Answer ${q.correctOption}` : "See the marking scheme."))}</div>`
                : "";
          // Internal choice: the (B) alternative after "OR", with its own scheme or solution
          const orAns =
            mode === "key"
              ? `<div><b>Marking scheme:</b> ${((q.orMarkingScheme as { step: string; marks: number }[]) ?? []).map((st) => `${esc(st.step)} [${st.marks}]`).join("; ")}</div>`
              : mode === "solutions"
                ? `<div><b>Solution:</b> ${esc(q.orSolution || "See the marking scheme.")}</div>`
                : "";
          const alt = q.orText ? `<div style="text-align:center;font-weight:bold">OR</div><div><b>${i.number} (B).</b> ${esc(q.orText).replace(/\n/g, "<br>")}${orAns}</div>` : "";
          return `<div class="q"><b>${i.number}${q.orText ? " (A)" : ""}.</b> ${esc(q.text).replace(/\n/g, "<br>")} <span class="muted">[${q.marks}]</span>${opts}${ans}${alt}</div>`;
        })
        .join("");
      return `<h2>Section ${esc(sec.name)}</h2>${qs}`;
    })
    .join("");
  return head + secs;
}

export async function paperPdfs(id: string) {
  const p = await paperWithQuestions(id);
  if (!p) throw new EpError("Paper not found.");
  if (p.uploadOnly) return {}; // the tutor's own files are used as they are
  const s = await getSettings();
  const out: Record<string, string> = {};
  for (const mode of ["paper", "key", "solutions"] as const) {
    const rel = `papers/${p.id}/${p.id}-${mode}.pdf`;
    await storage.save(rel, await pdf.fromHtml(pageHtml({ title: `${p.id} ${mode}`, body: paperBody(p, mode), footer: `${esc(s["brand.tuitionName"])} · ${esc(p.id)}` })));
    out[mode] = rel;
  }
  return out;
}

/** A 10-minute chapter quiz: auto-scored MCQs from the bank for one chapter. */
export async function makeChapterQuiz(o: { klass: number; subject: string; board: string; chapter: string; count?: number }) {
  const mcqs = await epdb.question.findMany({ where: { klass: o.klass, subject: o.subject, chapter: o.chapter, type: "mcq", correctOption: { not: null } }, take: 50 });
  if (mcqs.length < 3) throw new EpError(`Only ${mcqs.length} MCQs are tagged "${o.chapter}" in the bank: add a few more first.`);
  const existing = await epdb.paper.count({ where: { klass: o.klass, subject: o.subject, board: o.board, kind: "quiz" } });
  const quiz = await createPaper({ klass: o.klass, subject: o.subject, board: o.board, number: 100 + existing + 1, kind: "quiz", title: `${o.chapter}: 10-minute quiz` });
  const sec = await epdb.section.findFirstOrThrow({ where: { paperId: quiz.id } });
  for (const [i, q] of mcqs.slice(0, o.count ?? 10).entries()) await epdb.paperQuestion.create({ data: { paperId: quiz.id, sectionId: sec.id, questionId: q.id, number: i + 1 } });
  return quiz;
}

/** A one-page formula sheet for a chapter, from the formulas in tagged questions' solutions. */
export async function formulaSheetHtml(o: { klass: number; subject: string; chapter: string }) {
  const qs = await epdb.question.findMany({ where: { klass: o.klass, subject: o.subject, chapter: o.chapter } });
  const lines = new Set<string>();
  for (const q of qs) for (const l of `${q.solution ?? ""}\n${((q.markingScheme as { step: string }[]) ?? []).map((s) => s.step).join("\n")}`.split(/\n|;/)) if (/[=≈∝]/.test(l) && l.trim().length < 140) lines.add(l.trim());
  const topics = [...new Set(qs.map((q) => q.topic))];
  return pageHtml({
    title: `${o.chapter} formula sheet`,
    onePage: true,
    body: `<h1>${esc(o.chapter)}: formula sheet</h1><p class="muted">Class ${o.klass} ${esc(o.subject)} · ${SUBJECT_CODE[o.subject] ?? ""}</p><h2>Topics</h2><p>${topics.map(esc).join(" · ") || "No tagged questions yet."}</p><h2>Formulas</h2>${lines.size ? `<ul>${[...lines].map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "<p class='muted'>Add solutions with formulas to the chapter's questions to fill this sheet.</p>"}`,
  });
}

// ------------------------------ the tutor's own paper files ------------------------------
// A paper can simply be a file the tutor made (PDF or CSV): upload, keep versions, share. Uploading the
// same kind again keeps the earlier file as an older version (nothing is overwritten).

export const PAPER_FILE_KINDS = { paper: "Question paper", key: "Answer key", solutions: "Worked solutions", other: "Other" } as const;
export type PaperFileKind = keyof typeof PAPER_FILE_KINDS;
const FILE_TYPES: Record<string, string> = { pdf: "application/pdf", csv: "text/csv" };

export async function addPaperFile(paperId: string, kind: PaperFileKind, file: { name: string; bytes: Uint8Array }) {
  const s = await getSettings();
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (!FILE_TYPES[ext]) throw new EpError("Upload a PDF or CSV file.");
  if (!(kind in PAPER_FILE_KINDS)) throw new EpError("Choose what the file is.");
  if (!file.bytes.byteLength) throw new EpError("That file is empty.");
  if (file.bytes.byteLength > s["storage.maxUploadMb"] * 1024 * 1024) throw new EpError(`The file is over ${s["storage.maxUploadMb"]} MB.`);
  if (ext === "pdf") {
    try {
      const { pageCount } = await import("../adapters/pdf");
      await pageCount(file.bytes);
    } catch {
      throw new EpError("That PDF can't be opened (damaged or password-protected).");
    }
  }
  const safe = file.name.replace(/[^\w.() -]+/g, "_").slice(-80);
  const rel = `papers/${paper.id}/uploads/${Date.now()}-${kind}-${safe}`;
  await storage.save(rel, file.bytes);
  const row = await epdb.$transaction(async (tx) => {
    await tx.paperFile.updateMany({ where: { paperId, kind, isCurrent: true }, data: { isCurrent: false } });
    return tx.paperFile.create({ data: { paperId, kind, name: file.name.slice(0, 120), path: rel, size: file.bytes.byteLength, mime: FILE_TYPES[ext]! } });
  });
  await audit({ action: "paper.file_uploaded", entity: "Paper", entityId: paperId, new: { kind, size: row.size, mime: row.mime } });
  return row;
}

/** Deletes one uploaded file; if it was the current one, the previous version becomes current again. */
export async function removePaperFile(fileId: string) {
  const f = await epdb.paperFile.findUniqueOrThrow({ where: { id: fileId } });
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: f.paperId } });
  if (paper.uploadOnly && paper.status !== "draft" && f.kind === "paper" && f.isCurrent && (await epdb.paperFile.count({ where: { paperId: f.paperId, kind: "paper" } })) === 1)
    throw new EpError("This is the published paper's only file: upload a new version instead.");
  await storage.remove(f.path);
  await epdb.paperFile.delete({ where: { id: fileId } });
  if (f.isCurrent) {
    const prev = await epdb.paperFile.findFirst({ where: { paperId: f.paperId, kind: f.kind }, orderBy: { uploadedAt: "desc" } });
    if (prev) await epdb.paperFile.update({ where: { id: prev.id }, data: { isCurrent: true } });
  }
  await audit({ action: "paper.file_removed", entity: "Paper", entityId: f.paperId, old: { kind: f.kind } });
}

export const paperFiles = (paperId: string) => epdb.paperFile.findMany({ where: { paperId }, orderBy: [{ kind: "asc" }, { uploadedAt: "desc" }] });

export const currentPaperFile = (paperId: string, kind: PaperFileKind) => epdb.paperFile.findFirst({ where: { paperId, kind, isCurrent: true } });

/** The file to send with a group post: the uploaded one, else the PDF the app made from the questions. */
export async function shareableFile(paperId: string, kind: "paper" | "key") {
  const up = await currentPaperFile(paperId, kind);
  if (up) return { path: up.path, name: up.name };
  const made = `papers/${paperId}/${paperId}-${kind}.pdf`;
  return storage.exists(made) ? { path: made, name: `${paperId}-${kind}.pdf` } : null;
}

/** First rows of a CSV paper, for the preview on the paper page. */
export async function csvPreview(path: string, rows = 25) {
  const text = (await storage.read(path)).toString("utf8");
  return parseCsv(text).slice(0, rows);
}
