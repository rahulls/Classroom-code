import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { epAction, EpError } from "./action";
import { changePassword, confirmTwoStep, createAccount, hasAccount, signIn, signOut } from "./auth";
import { epdb } from "./db";
import { tick } from "./jobs";
import { attachPaper, completeTask, draftPrivateReminder, generateCalendar } from "./services/calendar";
import { addAttendee, addDoubt, answerDoubt, createSession, recordPayment, setAttendance, setOfferStatus, startPlan, suggestOffers } from "./services/commerce";
import { markPaperMarked, proposeWithAi, recordSpotCheck, reviewMark, selectSpotCheck, setMark, enterSelfMarks } from "./services/marking";
import { markMessageSent, validateTemplate } from "./services/messaging";
import { logHours, recordFeedback } from "./services/metrics";
import { addPendingStudent, addStudent, importIntakeCsv, markVerified, optOut, recordConsent, updateStudent, welcomeFor } from "./services/people";
import { addQuestion, clonePaperToBoard, createPaper, importQuestions, makeChapterQuiz, newVersion, paperPdfs, publishPaper, removeQuestion, reuseQuestion, setChapterList } from "./services/papers";
import { applyRetention, deleteStudentData } from "./services/privacy";
import { computeRanks, markTold } from "./services/ranking";
import { approveReports, classNote, deliverReports, forceResend, generateReports, markReportSent, regenerateReport } from "./services/reports";
import { addSubmission, importMcqAnswers } from "./services/submissions";
import { SETTINGS, setSetting, type SettingKey } from "./settings";

// Every Exam Prep server action. Wrapped by epAction (feature flag, teacher session, validation).
// The public surface is ./actions.ts ("use server"), which only forwards to these.

const id = z.string().min(1).max(80);
const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const bool = z.preprocess((v) => v === "on" || v === "true" || v === "1" || v === true, z.boolean());
const file = z.instanceof(File);
const bytes = async (f: File) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
const done = (msg: string, ...paths: string[]) => {
  for (const p of paths.length ? paths : ["/exam-prep"]) revalidatePath(p, "layout");
  return { ok: true as const, message: msg };
};

// ------------------------------ sign-in ------------------------------

export const setupAction = epAction(
  z.object({ username: z.string().trim().min(3).max(40), password: z.string().min(10, "Use at least 10 characters").max(200), confirm: z.string() }),
  async (v) => {
    if (await hasAccount()) return { ok: false, error: "The teacher account already exists. Sign in instead." };
    if (v.password !== v.confirm) return { ok: false, error: "The passwords don't match.", fieldErrors: { confirm: "Doesn't match" } };
    await createAccount(v.username, v.password);
    await signIn(v.username, v.password);
    redirect("/exam-prep");
  },
  { public: true },
);

export const loginAction = epAction(
  z.object({ username: z.string().trim().min(1, "Enter your username"), password: z.string().min(1, "Enter your password"), code: z.string().trim().max(10).optional() }),
  async (v) => {
    const r = await signIn(v.username, v.password, v.code);
    if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.needCode ? { code: "needed" } : undefined };
    redirect("/exam-prep");
  },
  { public: true },
);

export const logoutAction = epAction(z.object({}), async () => {
  await signOut();
  redirect("/exam-prep/login");
});

export const twoStepAction = epAction(z.object({ secret: z.string().min(16), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }), async (v, { teacher }) => {
  if (!(await confirmTwoStep(teacher.id, v.secret, v.code))) return { ok: false, error: "That code didn't work. Try the next one." };
  return done("Two-step verification is on.", "/exam-prep/settings");
});

export const passwordAction = epAction(z.object({ current: z.string().min(1), next: z.string().min(10, "Use at least 10 characters"), confirm: z.string() }), async (v, { teacher }) => {
  if (v.next !== v.confirm) return { ok: false, error: "The new passwords don't match." };
  if (!(await changePassword(teacher.id, v.current, v.next))) return { ok: false, error: "The current password is wrong." };
  redirect("/exam-prep/login");
});

// ------------------------------ people (R1) ------------------------------

export const addStudentAction = epAction(
  z.object({
    name: z.string(),
    klass: z.coerce.number(),
    board: z.string(),
    stateBoard: z.string().optional(),
    medium: z.string().optional(),
    subjects: z.array(z.string()).default([]),
    school: z.string().optional(),
    lastExamRange: z.string().optional(),
    parentName: z.string(),
    parentWhatsapp: z.string(),
    parentEmail: z.string().optional(),
    language: z.string().default("en"),
    consent: bool,
    rankConsent: bool,
    reportTiming: z.string().default("same"),
  }),
  async (v) => {
    if (!v.consent) return { ok: false, error: "Parent consent is required.", fieldErrors: { consent: "Required" } };
    const { IntakeSchema } = await import("./services/people");
    const parsed = IntakeSchema.safeParse({ ...v, stateBoard: v.stateBoard || undefined, medium: v.medium || undefined, consent: true, source: "teacher" });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
    const st = await addStudent(parsed.data);
    return done(`Added ${st.code}.`, "/exam-prep/students");
  },
);

export const addPendingAction = epAction(z.object({ name: z.string().trim().min(2), klass: num(9, 12), board: z.string(), subjects: z.array(z.string()).min(1), parentName: z.string().optional(), parentWhatsapp: z.string().optional() }), async (v) => {
  const st = await addPendingStudent(v);
  return done(`${st.code} is on the roll; intake pending (no consent yet).`, "/exam-prep/students");
});

export const importIntakeAction = epAction(z.object({ csv: file }), async (v) => {
  const r = await importIntakeCsv(await v.csv.text());
  if (r.errors.length) return { ok: false, error: `Nothing imported. Fix these rows first: ${r.errors.slice(0, 8).map((e) => `row ${e.row}: ${e.messages.join("; ")}`).join(" · ")}${r.errors.length > 8 ? ` (and ${r.errors.length - 8} more)` : ""}` };
  return done(`Imported ${r.imported} student${r.imported === 1 ? "" : "s"}.`, "/exam-prep/students");
});

export const updateStudentAction = epAction(
  z.object({ id, name: z.string().trim().min(2), klass: num(9, 12), board: z.string(), stateBoard: z.string().optional(), medium: z.string().optional(), subjects: z.array(z.string()).min(1, "Choose a subject"), school: z.string().optional(), rankConsent: bool, manualPath: bool }),
  async (v) => {
    await updateStudent(v.id, { name: v.name, klass: v.klass, board: v.board, stateBoard: v.stateBoard || null, medium: v.medium || null, subjects: v.subjects, school: v.school || null, rankConsent: v.rankConsent, manualPath: v.manualPath });
    return done("Saved.", `/exam-prep/students/${v.id}`);
  },
);

export const verifyAction = epAction(z.object({ parentId: id }), async (v) => {
  await markVerified(v.parentId);
  return done("Number verified.", "/exam-prep/verify");
});

export const consentAction = epAction(z.object({ parentId: id }), async (v) => {
  await recordConsent(v.parentId);
  return done("Consent recorded.");
});

export const optOutAction = epAction(z.object({ studentId: z.string().optional(), parentId: z.string().optional() }), async (v) => {
  if (!v.studentId && !v.parentId) throw new EpError("Nothing to opt out.");
  const r = await optOut({ studentId: v.studentId || undefined, parentId: v.parentId || undefined });
  return done(`Opted out. ${r.cancelled} queued message${r.cancelled === 1 ? "" : "s"} cancelled; a confirmation is drafted.`);
});

export const welcomeAction = epAction(z.object({ parentId: id }), async (v) => {
  await welcomeFor(v.parentId);
  return done("Welcome pack and message ready in Messages.");
});

export const parentReplyAction = epAction(z.object({ parentId: id, paperId: z.string().optional(), note: z.string().max(400).optional() }), async (v) => {
  await epdb.parentReply.create({ data: { parentId: v.parentId, paperId: v.paperId || null, note: v.note } });
  return done("Reply recorded.");
});

export const deleteStudentAction = epAction(z.object({ id, confirm: z.literal("DELETE", { message: 'Type DELETE to confirm' }) }), async (v) => {
  await deleteStudentData(v.id);
  revalidatePath("/exam-prep", "layout");
  redirect("/exam-prep/privacy");
});

// ------------------------------ papers (R2) ------------------------------

export const createPaperAction = epAction(z.object({ klass: num(9, 12), subject: z.string(), board: z.string(), number: num(0, 99), title: z.string().optional(), kind: z.enum(["paper", "mock"]).default("paper"), mockMinutes: z.coerce.number().optional() }), async (v) => {
  const p = await createPaper({ ...v, title: v.title || undefined, mockMinutes: v.mockMinutes || undefined });
  redirect(`/exam-prep/papers/${p.id}`);
});

export const addQuestionAction = epAction(
  z.object({
    paperId: id,
    sectionId: id,
    chapter: z.string(),
    topic: z.string(),
    marks: z.coerce.number(),
    type: z.string(),
    difficulty: z.string(),
    text: z.string(),
    a: z.string().optional(),
    b: z.string().optional(),
    c: z.string().optional(),
    d: z.string().optional(),
    correctOption: z.string().optional(),
    scheme: z.string().optional(),
    solution: z.string().optional(),
  }),
  async (v) => {
    const markingScheme = (v.scheme ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(.*?)[\s:–-]+(\d+(?:\.\d+)?)\s*(?:marks?)?$/i.exec(l);
        if (!m) throw new EpError(`Scheme line "${l}" needs marks at the end, e.g. "Correct formula: 1".`);
        return { step: m[1]!.trim(), marks: Number(m[2]) };
      });
    await addQuestion(v.paperId, v.sectionId, {
      chapter: v.chapter,
      topic: v.topic,
      marks: v.marks,
      type: v.type as "mcq",
      difficulty: v.difficulty as "easy",
      text: v.text,
      options: [v.a, v.b, v.c, v.d].map((x) => x?.trim() ?? "").filter(Boolean),
      correctOption: v.correctOption || "",
      markingScheme,
      solution: v.solution || undefined,
    });
    return done("Question added.", `/exam-prep/papers/${v.paperId}`);
  },
);

export const reuseQuestionAction = epAction(z.object({ paperId: id, sectionId: id, questionId: id }), async (v) => {
  await reuseQuestion(v.paperId, v.sectionId, v.questionId);
  return done("Question added from the bank.", `/exam-prep/papers/${v.paperId}`);
});

export const removeQuestionAction = epAction(z.object({ paperId: id, pqId: id }), async (v) => {
  await removeQuestion(v.paperId, v.pqId);
  return done("Removed.", `/exam-prep/papers/${v.paperId}`);
});

export const importQuestionsAction = epAction(z.object({ paperId: id, file }), async (v) => {
  const r = await importQuestions(v.paperId, await v.file.text());
  if (r.errors.length) return { ok: false, error: `Nothing imported: ${r.errors.slice(0, 6).join(" · ")}` };
  return done(`Imported ${r.imported} questions.`, `/exam-prep/papers/${v.paperId}`);
});

export const publishAction = epAction(z.object({ paperId: id }), async (v) => {
  const c = await publishPaper(v.paperId);
  await paperPdfs(v.paperId);
  return done(`Published (${c.total} marks). Paper, key and solutions PDFs are ready.${c.warnings.length ? ` Note: ${c.warnings.join(" ")}` : ""}`, `/exam-prep/papers/${v.paperId}`);
});

export const pdfsAction = epAction(z.object({ paperId: id }), async (v) => {
  await paperPdfs(v.paperId);
  return done("PDFs made.", `/exam-prep/papers/${v.paperId}`);
});

export const newVersionAction = epAction(z.object({ paperId: id }), async (v) => {
  const p = await newVersion(v.paperId);
  redirect(`/exam-prep/papers/${p.id}`);
});

export const cloneAction = epAction(z.object({ paperId: id, board: z.string() }), async (v) => {
  const p = await clonePaperToBoard(v.paperId, v.board);
  redirect(`/exam-prep/papers/${p.id}`);
});

export const quizAction = epAction(z.object({ klass: num(9, 12), subject: z.string(), board: z.string(), chapter: z.string().min(1) }), async (v) => {
  const q = await makeChapterQuiz(v);
  redirect(`/exam-prep/papers/${q.id}`);
});

export const chaptersAction = epAction(z.object({ klass: num(9, 12), subject: z.string(), board: z.string(), chapters: z.string() }), async (v) => {
  await setChapterList(v.klass, v.subject, v.board, v.chapters.split("\n"));
  return done("Chapter list saved.", "/exam-prep/settings/chapters");
});

// ------------------------------ calendar (R3) ------------------------------

export const calendarAction = epAction(z.object({}), async () => {
  const n = await generateCalendar();
  return done(`Calendar has ${n} paper slots.`, "/exam-prep/calendar");
});

export const attachAction = epAction(z.object({ slotId: id, paperId: id }), async (v) => {
  await attachPaper(v.slotId, v.paperId);
  return done("Paper attached.", "/exam-prep/calendar");
});

export const runJobsAction = epAction(z.object({}), async () => {
  await tick();
  return done("Jobs run: tasks and drafts are up to date.");
});

export const taskDoneAction = epAction(z.object({ id }), async (v) => {
  await completeTask(v.id);
  return done("Done.");
});

export const reminderAction = epAction(z.object({ studentId: id, paperId: id }), async (v) => {
  const m = await draftPrivateReminder(v.studentId, v.paperId);
  if (!m) return { ok: false, error: "This student has opted out." };
  return done("Reminder drafted (one per student per paper).", `/exam-prep/papers/${v.paperId}`);
});

// ------------------------------ submissions (R4) ------------------------------

export const submissionAction = epAction(
  z.object({ paperId: id, studentId: id, files: z.array(file).default([]), source: z.enum(["form", "dm_manual", "google_form"]).default("dm_manual"), submittedAt: z.string().optional(), mcq: z.string().optional(), times: z.string().optional() }),
  async (v) => {
    const paper = await epdb.paper.findUniqueOrThrow({ where: { id: v.paperId }, include: { items: { include: { question: true }, orderBy: { number: "asc" } } } });
    // MCQ answers typed as "1:A, 2:C" or "ACBD..." in question order
    let mcq: Record<string, string> | undefined;
    const raw = (v.mcq ?? "").trim().toUpperCase();
    if (raw) {
      const mcqs = paper.items.filter((i) => i.question.type === "mcq");
      mcq = {};
      if (/^[ABCD-]+$/.test(raw.replace(/\s/g, ""))) [...raw.replace(/\s/g, "")].forEach((c, k) => mcqs[k] && c !== "-" && (mcq![mcqs[k]!.questionId] = c));
      else
        for (const part of raw.split(/[,;\s]+/)) {
          const m = /^(\d+)[:=.)-]?([ABCD])$/.exec(part);
          const it = m && paper.items.find((i) => i.number === Number(m[1]));
          if (it) mcq[it.questionId] = m![2]!;
        }
    }
    const sectionTimes = v.times ? Object.fromEntries(v.times.split(/[,;]/).map((p) => p.split(/[:=]/).map((x) => x.trim())).filter((p) => p.length === 2 && Number(p[1]) >= 0).map(([k, m]) => [k!.toUpperCase(), Number(m)])) : undefined;
    const sub = await addSubmission({ studentId: v.studentId, paperId: v.paperId, files: await Promise.all(v.files.map(bytes)), mcq, source: v.source, submittedAt: v.submittedAt ? new Date(v.submittedAt) : undefined, sectionTimes });
    return done(`Filed${sub.flags.length ? ` with flags: ${sub.flags.join(", ")}` : ""}.`, `/exam-prep/papers/${v.paperId}`);
  },
);

export const mcqImportAction = epAction(z.object({ paperId: id, file }), async (v) => {
  const r = await importMcqAnswers(v.paperId, await v.file.text());
  return done(`MCQ answers scored for ${r.updated} sheet${r.updated === 1 ? "" : "s"}.${r.errors.length ? ` Skipped: ${r.errors.slice(0, 5).join(" · ")}` : ""}`, `/exam-prep/papers/${v.paperId}`);
});

// ------------------------------ marking (R5) ------------------------------

export const aiAction = epAction(z.object({ paperId: id }), async (v) => {
  const r = await proposeWithAi(v.paperId);
  return done(`AI proposed ${r.proposed} marks; ${r.flagged} need review.`, `/exam-prep/papers/${v.paperId}`);
});

export const reviewAction = epAction(z.object({ markId: id, action: z.enum(["accept", "edit", "reject"]), marks: z.coerce.number().optional(), errorTag: z.string().optional(), qualityNote: z.string().max(300).optional() }), async (v) => {
  await reviewMark(v.markId, { action: v.action, marks: v.marks, errorTag: (v.errorTag || undefined) as never, qualityNote: v.qualityNote || undefined });
  return done("Saved.");
});

export const setMarkAction = epAction(z.object({ submissionId: id, questionId: id, marks: z.coerce.number(), errorTag: z.string().default("none"), note: z.string().max(300).optional() }), async (v) => {
  await setMark(v.submissionId, v.questionId, v.marks, v.errorTag as never, v.note || undefined);
  return done(v.note ? "Corrected; the next report will mention it." : "Saved.");
});

export const selfMarksAction = epAction(z.object({ submissionId: id, marks: z.string() }), async (v) => {
  const sub = await epdb.submission.findUniqueOrThrow({ where: { id: v.submissionId }, include: { paper: { include: { items: true } } } });
  const map: Record<string, number> = {};
  for (const part of v.marks.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)[:=](\d+(?:\.\d+)?)$/.exec(part);
    const it = m && sub.paper.items.find((i) => i.number === Number(m[1]));
    if (!it) throw new EpError(`"${part}": use question:marks, e.g. 5:3`);
    map[it.questionId] = Number(m![2]);
  }
  await enterSelfMarks(v.submissionId, map);
  return done("Self-entered marks saved (kept separate from the teacher's).");
});

export const spotSelectAction = epAction(z.object({ paperId: id }), async (v) => {
  const r = await selectSpotCheck(v.paperId);
  return done(`${r.length} sheets selected for the spot-check.`, `/exam-prep/papers/${v.paperId}/marking`);
});

export const spotRecordAction = epAction(z.object({ spotCheckId: id, teacherTotal: z.coerce.number().min(0) }), async (v) => {
  const r = await recordSpotCheck(v.spotCheckId, v.teacherTotal);
  return done(r.result === "match" ? "Match." : `Mismatch by ${r.delta > 0 ? "+" : ""}${r.delta} marks: correct the marks on the sheet.`);
});

export const markedAction = epAction(z.object({ paperId: id }), async (v) => {
  await markPaperMarked(v.paperId);
  return done("Marked. Ranks computed (teacher-only).", `/exam-prep/papers/${v.paperId}`);
});

// ------------------------------ reports (R7) ------------------------------

export const generateReportsAction = epAction(z.object({ paperId: id }), async (v) => {
  const r = await generateReports(v.paperId);
  return done(`${r.created} new report${r.created === 1 ? "" : "s"} (${r.total} in all). Check them, then approve.`, `/exam-prep/papers/${v.paperId}`);
});

export const approveReportsAction = epAction(z.object({ paperId: id }), async (v) => {
  const n = await approveReports(v.paperId);
  const d = await deliverReports();
  return done(`${n} report${n === 1 ? "" : "s"} approved. ${d.emailed} emailed, ${d.queued} added to the WhatsApp queue.`, "/exam-prep/reports");
});

export const deliverAction = epAction(z.object({}), async () => {
  const d = await deliverReports();
  return done(`${d.emailed} emailed, ${d.queued} added to the WhatsApp queue.`, "/exam-prep/reports");
});

export const reportSentAction = epAction(z.object({ reportId: id }), async (v) => {
  await markReportSent(v.reportId);
  return done("Marked sent.", "/exam-prep/reports");
});

export const forceResendAction = epAction(z.object({ reportId: id, regenerate: bool }), async (v) => {
  if (v.regenerate) await regenerateReport(v.reportId);
  await forceResend(v.reportId);
  return done("Ready to send again.", "/exam-prep/reports");
});

export const classNoteAction = epAction(z.object({ paperId: id }), async (v) => {
  const m = await classNote(v.paperId);
  if (!m) return { ok: false, error: "The cohort is too small for a class note (group figures hidden)." };
  return done("Class note drafted in Messages.", "/exam-prep/messages");
});

// ------------------------------ ranks (R8) ------------------------------

export const ranksAction = epAction(z.object({ paperId: id }), async (v) => {
  const n = await computeRanks(v.paperId);
  return done(`${n} rank record${n === 1 ? "" : "s"} updated.`, "/exam-prep/ranks");
});

export const toldAction = epAction(z.object({ rankId: id, channel: z.enum(["whatsapp", "call", "in_person"]).default("whatsapp") }), async (v) => {
  await markTold(v.rankId, v.channel);
  return done("Marked told.", "/exam-prep/ranks");
});

// ------------------------------ messages (R9) ------------------------------

export const messageSentAction = epAction(z.object({ id }), async (v) => {
  const m = await markMessageSent(v.id);
  const rep = m.dedupeKey?.startsWith("report:") ? m.dedupeKey.slice(7) : null;
  if (rep) await markReportSent(rep);
  return done("Marked sent.");
});

export const templateAction = epAction(z.object({ key: id, body: z.string().min(3).max(3000), bodyHi: z.string().max(3000).optional() }), async (v) => {
  const t = await epdb.messageTemplate.findUniqueOrThrow({ where: { key: v.key } });
  const problem = validateTemplate(t.audience, v.body);
  if (problem) return { ok: false, error: problem };
  await epdb.messageTemplate.update({ where: { key: v.key }, data: { body: v.body, bodyHi: v.bodyHi || null } });
  return done("Template saved.", "/exam-prep/messages");
});

// ------------------------------ commercial (R10) ------------------------------

export const offersAction = epAction(z.object({}), async () => {
  const r = await suggestOffers();
  return done(`${r.created} new offer${r.created === 1 ? "" : "s"} suggested.`, "/exam-prep/commercial");
});

export const offerStatusAction = epAction(z.object({ id, status: z.enum(["sent", "accepted", "declined"]) }), async (v) => {
  await setOfferStatus(v.id, v.status);
  return done("Offer updated.", "/exam-prep/commercial");
});

export const planAction = epAction(z.object({ studentId: id, tier: z.enum(["free_report", "paid1", "paid2"]), subjects: num(1, 3), isTrial: bool }), async (v) => {
  const r = await startPlan(v);
  return done(`Plan started: ₹${r.price.net}${r.price.discount ? ` after ₹${r.price.discount} family discount` : ""}.`);
});

export const paymentAction = epAction(z.object({ studentId: id, planId: z.string().optional(), amount: z.coerce.number().positive(), method: z.enum(["UPI", "cash", "bank"]), reference: z.string().max(80).optional(), paidAt: z.string().optional() }), async (v) => {
  const p = await recordPayment({ ...v, planId: v.planId || undefined, reference: v.reference || undefined, paidAt: v.paidAt ? new Date(v.paidAt) : undefined });
  return done(`Payment recorded: receipt ${p.receiptNo}.`);
});

export const sessionAction = epAction(z.object({ type: z.string(), klass: num(9, 12), board: z.string(), subject: z.string(), chapter: z.string().optional(), startsAt: z.string().min(1), capacity: num(1, 500), offerId: z.string().optional(), notes: z.string().max(300).optional() }), async (v) => {
  await createSession({ ...v, chapter: v.chapter || undefined, offerId: v.offerId || undefined, startsAt: new Date(v.startsAt) });
  return done("Session scheduled.", "/exam-prep/commercial");
});

export const attendeeAction = epAction(z.object({ sessionId: id, studentId: id }), async (v) => {
  await addAttendee(v.sessionId, v.studentId);
  return done("Added.", "/exam-prep/commercial");
});

export const attendanceAction = epAction(z.object({ sessionId: id, studentId: id, attended: bool }), async (v) => {
  await setAttendance(v.sessionId, v.studentId, v.attended);
  return done("Attendance saved.", "/exam-prep/commercial");
});

export const doubtAction = epAction(z.object({ studentId: id, sessionId: z.string().optional(), note: z.string().max(600).optional(), photo: file.optional() }), async (v) => {
  await addDoubt({ studentId: v.studentId, sessionId: v.sessionId || undefined, note: v.note, file: v.photo ? await bytes(v.photo) : undefined });
  return done("Doubt added.", "/exam-prep/commercial");
});

export const answerDoubtAction = epAction(z.object({ id, response: z.string().min(1).max(1000) }), async (v) => {
  await answerDoubt(v.id, v.response);
  return done("Answered.", "/exam-prep/commercial");
});

// ------------------------------ feedback, metrics (R12-R13) ------------------------------

export const feedbackAction = epAction(z.object({ studentId: id, paperId: id, difficulty: z.enum(["too_easy", "right", "too_hard"]), nextChapterRequest: z.string().max(120).optional(), rating: z.coerce.number().int().min(1).max(5).optional().or(z.literal("").transform(() => undefined)) }), async (v) => {
  await recordFeedback({ ...v, nextChapterRequest: v.nextChapterRequest || undefined });
  return done("Feedback saved.", "/exam-prep/feedback");
});

export const hoursAction = epAction(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hours: z.coerce.number(), note: z.string().max(200).optional() }), async (v) => {
  await logHours(v.weekStart, v.hours, v.note);
  return done("Hours logged.", "/exam-prep/metrics");
});

export const checklistAction = epAction(z.object({ weekStart: z.string(), item: z.string().max(200) }), async (v) => {
  await epdb.reviewCheck.upsert({ where: { weekStart_item: { weekStart: new Date(`${v.weekStart}T00:00:00Z`), item: v.item } }, create: { weekStart: new Date(`${v.weekStart}T00:00:00Z`), item: v.item }, update: {} });
  return done("Ticked.", "/exam-prep/metrics");
});

export const complaintAction = epAction(z.object({ note: z.string().min(3).max(500) }), async (v) => {
  await epdb.complaint.create({ data: { note: v.note } });
  return done("Complaint logged for review.", "/exam-prep/metrics");
});

// ------------------------------ settings (R14) and privacy (R11) ------------------------------

export const settingAction = epAction(z.object({ key: z.string(), value: z.string() }), async (v) => {
  if (!(v.key in SETTINGS)) throw new EpError("Unknown setting.");
  const def = SETTINGS[v.key as SettingKey];
  const d = def.default as unknown;
  let value: unknown = v.value;
  if (typeof d === "number") value = Number(v.value);
  else if (typeof d === "boolean") value = v.value === "true" || v.value === "on";
  else if (d === null && v.key === "programme.startDate") value = v.value || null;
  else if (d === null && v.key === "marking.aiKey") value = v.value || null;
  else if (typeof d === "object") {
    try {
      value = JSON.parse(v.value);
    } catch {
      throw new EpError(`${def.label}: that isn't valid JSON.`);
    }
  }
  await setSetting(v.key as SettingKey, value);
  return done(`${def.label} saved.`, "/exam-prep/settings");
});

export const retentionAction = epAction(z.object({ mode: z.enum(["archive", "delete"]), confirm: z.literal("APPROVE", { message: "Type APPROVE to confirm" }) }), async (v) => {
  const n = await applyRetention(v.mode);
  return done(`Retention applied to ${n} students (${v.mode}).`, "/exam-prep/privacy");
});
