import "server-only";
import { EpError } from "../errors";
import { mailer } from "../adapters/email";
import { imageSize, imagesToPdf, pageCount } from "../adapters/pdf";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { lateness, sheetFileName, sheetFolder } from "../domain/programme";
import { scoreMcq } from "../domain/scoring";
import { getSettings } from "../settings";
import { draft, renderTemplate, setLabel } from "./messaging";
import { hasConsent, parseCsv } from "./people";

// R4: submissions. Students submit through the Google Form; the teacher files each sheet here (or
// imports the form's MCQ answers). The latest submission wins; earlier ones stay as history.

export type Upload = { name: string; bytes: Uint8Array };

const kind = (name: string) => (/\.pdf$/i.test(name) ? "pdf" : /\.jpe?g$/i.test(name) ? "jpg" : /\.png$/i.test(name) ? "png" : null);

/** Checks the files and makes one ordered PDF. Returns the PDF and quality flags. */
export async function sheetFromFiles(files: Upload[], s: { maxMb: number; maxImages: number }) {
  if (!files.length) throw new EpError("Add the answer sheet: one PDF or photos of the pages.");
  for (const f of files) {
    if (!kind(f.name)) throw new EpError(`${f.name}: only PDF, JPG or PNG files are accepted.`);
    if (f.bytes.byteLength > s.maxMb * 1024 * 1024) throw new EpError(`${f.name} is over ${s.maxMb} MB.`);
  }
  const pdfs = files.filter((f) => kind(f.name) === "pdf");
  const flags: string[] = [];
  if (pdfs.length) {
    if (files.length > 1) throw new EpError("Send either one PDF or photos, not both or several PDFs.");
    try {
      const pages = await pageCount(pdfs[0]!.bytes);
      return { pdf: Buffer.from(pdfs[0]!.bytes), pages, flags };
    } catch {
      throw new EpError("That PDF can't be opened (damaged or password-protected).");
    }
  }
  if (files.length > s.maxImages) throw new EpError(`At most ${s.maxImages} photos per submission.`);
  // Pages out of order: photo names with page numbers that don't go up
  const nums = files.map((f) => Number(/(\d+)(?!.*\d)/.exec(f.name)?.[1] ?? NaN));
  if (nums.every((x) => !Number.isNaN(x)) && nums.some((x, i) => i > 0 && x < nums[i - 1]!)) flags.push("pages_out_of_order");
  for (const f of files) {
    const dim = imageSize(f.bytes);
    if (!dim) {
      flags.push("unreadable");
      continue;
    }
    const short = Math.min(dim.width, dim.height);
    const bytesPerPixel = f.bytes.byteLength / (dim.width * dim.height);
    if (short < 700 || bytesPerPixel < 0.04) flags.push("blurry_or_small");
  }
  const sorted = nums.every((x) => !Number.isNaN(x)) ? [...files].map((f, i) => ({ f, n: nums[i]! })).sort((a, b) => a.n - b.n).map((x) => x.f) : files;
  const doc = await imagesToPdf(sorted.map((f) => ({ bytes: f.bytes, type: kind(f.name) as "jpg" | "png" })));
  return { pdf: doc, pages: sorted.length, flags: [...new Set(flags)] };
}

/**
 * Files a submission: stores the sheet privately as {class}_{name}_{subject3}_{paper}.pdf under
 * class/subject/paper/, scores the MCQs, flags problems, replaces an earlier submission (kept as
 * history), and drafts the "received" reply.
 */
export async function addSubmission(o: {
  studentId: string;
  paperId: string;
  files: Upload[];
  mcq?: Record<string, string | null>;
  source: "form" | "dm_manual" | "google_form";
  submittedAt?: Date;
  sectionTimes?: Record<string, number>;
}) {
  const s = await getSettings();
  const st = await epdb.student.findUniqueOrThrow({ where: { id: o.studentId }, include: { parents: true } });
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: o.paperId }, include: { items: { include: { question: true } } } });
  if (st.status === "opted_out") throw new EpError("This student has opted out.");
  if (!hasConsent(st.parents)) throw new EpError("No parent consent yet: the sheet can't be filed until the intake is complete.");
  if (paper.status === "draft") throw new EpError("This paper isn't published yet.");
  const flags: string[] = [];
  if (paper.klass !== st.klass) throw new EpError(`Wrong paper: ${paper.id} is for Class ${paper.klass}, the student is in Class ${st.klass}.`);
  if (!st.subjects.includes(paper.subject)) flags.push("wrong_subject");
  if (paper.board !== st.board && paper.board !== "CBSE") flags.push("wrong_board");
  const sheet = await sheetFromFiles(o.files, { maxMb: s["storage.maxUploadMb"], maxImages: s["storage.maxImages"] });
  flags.push(...sheet.flags);
  const submittedAt = o.submittedAt ?? new Date();
  const late = lateness(submittedAt, paper.dueAt, paper.graceHours ?? s["programme.graceHours"]);
  if (late.late) flags.push(late.beyondGrace ? "late_no_report" : "late");
  const previous = await epdb.submission.findFirst({ where: { studentId: st.id, paperId: paper.id, isCurrent: true } });
  if (previous) flags.push("duplicate_replaced_earlier");
  const folder = sheetFolder({ klass: paper.klass, subject: paper.subject, paperId: paper.id });
  const fileName = sheetFileName({ klass: paper.klass, name: st.name, subject: paper.subject, paperId: paper.id });
  const rel = `${folder}/${fileName}`;
  // Keep the earlier file as history
  if (previous && storage.exists(rel)) await storage.save(`${folder}/history/${previous.id}.pdf`, await storage.read(rel));
  await storage.save(rel, sheet.pdf);

  const sub = await epdb.$transaction(async (tx) => {
    if (previous) {
      await tx.submission.update({ where: { id: previous.id }, data: { isCurrent: false, files: [{ path: `${folder}/history/${previous.id}.pdf`, name: fileName }] } });
    }
    const created = await tx.submission.create({
      data: {
        studentId: st.id,
        paperId: paper.id,
        submittedAt,
        source: o.source,
        files: [{ path: rel, name: fileName, size: sheet.pdf.byteLength, pages: sheet.pages }],
        status: flags.some((f) => f !== "late" && f !== "duplicate_replaced_earlier") ? "flagged" : "filed",
        flags: [...new Set(flags)],
        isLate: late.late,
        isCurrent: true,
        sectionTimes: o.sectionTimes ?? undefined,
      },
    });
    // MCQ section answered in the form: auto-scored now
    if (o.mcq) {
      const qs = paper.items.map((i) => ({ id: i.question.id, chapter: i.question.chapter, marks: i.question.marks, type: i.question.type, correctOption: i.question.correctOption }));
      for (const r of scoreMcq(qs, o.mcq)) {
        await tx.mcqResponse.create({ data: { submissionId: created.id, questionId: r.questionId, chosenOption: r.chosenOption, marksAwarded: r.marksAwarded } });
        await tx.mark.create({ data: { submissionId: created.id, questionId: r.questionId, marksAwarded: r.marksAwarded, source: "auto", errorTag: r.marksAwarded ? "none" : "concept" } });
      }
    }
    await audit({ action: previous ? "submission.replaced" : "submission.filed", entity: "Submission", entityId: created.id, old: previous ? { id: previous.id } : null, new: { paperId: paper.id, flags: created.flags, isLate: late.late } }, tx);
    return created;
  });
  await setLabel(st.id, "Submitted");
  // Confirmation: WhatsApp auto-reply draft, and an email when emails are on and the parent can receive them
  const parent = st.parents.find((p) => !p.optedOutAt && p.numberVerifiedAt && p.consentAt);
  const body = await renderTemplate("submission_received", { paper: paper.id, student: st.name.split(" ")[0] });
  await draft({ dedupeKey: `received:${sub.id}`, templateKey: "submission_received", audience: "student", body, studentId: st.id, parentId: parent?.id, paperId: paper.id, to: parent?.whatsapp });
  if (s["delivery.emailEnabled"] && parent?.email) await mailer.send({ to: parent.email, subject: `Received: ${paper.id}`, text: body }, s).catch(() => undefined);
  return sub;
}

/** MCQ answers from the Google Form export: code, then one column per MCQ (Q1, Q2... by question number). */
export async function importMcqAnswers(paperId: string, csvText: string) {
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: true }, orderBy: { number: "asc" } } } });
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new EpError("The CSV has no answers.");
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const codeCol = head.findIndex((h) => /code/.test(h));
  if (codeCol < 0) throw new EpError("The CSV needs a 'Student code' column.");
  const errors: string[] = [];
  let updated = 0;
  for (const [i, r] of rows.slice(1).entries()) {
    const code = (r[codeCol] ?? "").trim().toUpperCase();
    const st = await epdb.student.findUnique({ where: { code } });
    if (!st) {
      errors.push(`Row ${i + 2}: no student with code ${code}`);
      continue;
    }
    const sub = await epdb.submission.findFirst({ where: { studentId: st.id, paperId, isCurrent: true } });
    if (!sub) {
      errors.push(`Row ${i + 2}: ${code} has no sheet filed for ${paperId} yet`);
      continue;
    }
    const chosen: Record<string, string | null> = {};
    for (const it of paper.items) {
      const c = head.findIndex((h) => h === `q${it.number}` || h === `question ${it.number}` || h === String(it.number));
      if (c >= 0) chosen[it.question.id] = (r[c] ?? "").trim() || null;
    }
    const qs = paper.items.map((x) => ({ id: x.question.id, chapter: x.question.chapter, marks: x.question.marks, type: x.question.type, correctOption: x.question.correctOption }));
    for (const res of scoreMcq(qs, chosen)) {
      await epdb.mcqResponse.upsert({ where: { submissionId_questionId: { submissionId: sub.id, questionId: res.questionId } }, create: { submissionId: sub.id, ...res }, update: { chosenOption: res.chosenOption, marksAwarded: res.marksAwarded } });
      const m = await epdb.mark.findUnique({ where: { submissionId_questionId: { submissionId: sub.id, questionId: res.questionId } } });
      if (!m || m.source === "auto") await epdb.mark.upsert({ where: { submissionId_questionId: { submissionId: sub.id, questionId: res.questionId } }, create: { submissionId: sub.id, questionId: res.questionId, marksAwarded: res.marksAwarded, source: "auto", errorTag: res.marksAwarded ? "none" : "concept" }, update: { marksAwarded: res.marksAwarded } });
    }
    updated++;
  }
  return { updated, errors };
}

/** The sheets a student has for one paper: the current one and the history. */
export const submissionHistory = (studentId: string, paperId: string) => epdb.submission.findMany({ where: { studentId, paperId }, orderBy: { createdAt: "desc" } });
