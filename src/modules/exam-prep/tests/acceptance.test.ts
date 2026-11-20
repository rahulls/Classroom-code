// Acceptance criteria R1-R14 (integration, against rsc_exam_prep_test).
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { assertRedacted, setAiMarker } from "../adapters/ai-marker";
import { checkLink, signedLink, storage } from "../adapters/storage";
import { epdb } from "../db";
import { addSubmission } from "../services/submissions";
import { attachPaper, draftPrivateReminder, generateCalendar, missing, weeklyTasks } from "../services/calendar";
import { recordPayment, startPlan, suggestOffers } from "../services/commerce";
import { setMark, setMarks, proposeWithAi, calibration, reviewMark } from "../services/marking";
import { DEFAULT_TEMPLATES, draft, validateTemplate, seedTemplates } from "../services/messaging";
import { recordFeedback, feedbackSummary, metrics } from "../services/metrics";
import { addStudent, importIntakeCsv, IntakeSchema, markVerified, optOut, parentReachable } from "../services/people";
import { addQuestion, clonePaperToBoard, createPaper, newVersion, paperCheck, publishPaper, setChapterList } from "../services/papers";
import { deleteStudentData, exportStudent } from "../services/privacy";
import { computeRanks, tellingRows } from "../services/ranking";
import { approveReports, deliverReports, generateReports, reportHtml, type ReportData } from "../services/reports";
import { getSettings, setSetting } from "../settings";
import { reportFraming, weekTime } from "../domain/programme";
import { FIXTURE_CHAPTERS, fakePng, fakeSheet, resetDb, setSettings } from "./helpers";

const base = {
  klass: 10,
  board: "CBSE" as const,
  subjects: ["Maths"],
  parentName: "Test Parent",
  parentWhatsapp: "+919812345678",
  parentEmail: "",
  language: "en" as const,
  consent: true as const,
  rankConsent: true,
  reportTiming: "same" as const,
  source: "teacher" as const,
  isDemo: false,
};
let phoneN = 0;
const student = (o: Partial<typeof base> & { name?: string } = {}) => addStudent({ ...base, name: o.name ?? `Test Student ${++phoneN}`, parentWhatsapp: `+9198${String(20000000 + phoneN)}`, ...o } as never);

/** A published 10-mark paper: 2 MCQs (1 mark) and 2 written questions (4 marks), over 2 chapters. */
async function smallPaper(number = 1, board = "CBSE") {
  const p = await createPaper({ klass: 10, subject: "Maths", board, number });
  const secs = await epdb.section.findMany({ where: { paperId: p.id } });
  const mcq = secs.find((s) => s.type === "mcq")!;
  const long = secs.find((s) => s.type === "long")!;
  for (const ch of ["Real Numbers", "Polynomials"]) {
    await addQuestion(p.id, mcq.id, { chapter: ch, topic: "t", marks: 1, type: "mcq", difficulty: "easy", text: `${ch}?`, options: ["a", "b", "c", "d"], correctOption: "A", markingScheme: [] });
    await addQuestion(p.id, long.id, { chapter: ch, topic: "t", marks: 4, type: "long", difficulty: "medium", text: `Prove ${ch}.`, options: [], markingScheme: [{ step: "a", marks: 2 }, { step: "b", marks: 2 }] });
  }
  await publishPaper(p.id);
  return epdb.paper.findUniqueOrThrow({ where: { id: p.id }, include: { items: { include: { question: true } } } });
}

/** Files a sheet and gives every written answer `got` marks (teacher-entered). */
async function fileAndMark(studentId: string, paperId: string, got = 2, when?: Date) {
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: true } } } });
  const mcq = Object.fromEntries(p.items.filter((i) => i.question.type === "mcq").map((i) => [i.questionId, "A"]));
  const sub = await addSubmission({ studentId, paperId, files: [{ name: "s.pdf", bytes: await fakeSheet() }], mcq, source: "form", submittedAt: when });
  for (const i of p.items.filter((x) => x.question.type !== "mcq")) await setMark(sub.id, i.questionId, got);
  return sub;
}

beforeEach(async () => {
  await resetDb();
  await seedTemplates();
  await setChapterList(10, "Maths", "CBSE", FIXTURE_CHAPTERS);
  await setChapterList(10, "Maths", "ICSE-ISC", FIXTURE_CHAPTERS);
  setAiMarker(null);
});

describe("R1 onboarding and intake", () => {
  it("rejects an intake without consent", () => {
    expect(IntakeSchema.safeParse({ ...base, name: "A B", consent: false }).success).toBe(false);
  });
  it("a Class 9 student cannot take Physics; State fields only for State board", () => {
    expect(IntakeSchema.safeParse({ ...base, name: "A B", klass: 9, subjects: ["Physics"] }).success).toBe(false);
    expect(IntakeSchema.safeParse({ ...base, name: "A B", board: "CBSE", stateBoard: "MSBSHSE" }).success).toBe(false);
    expect(IntakeSchema.safeParse({ ...base, name: "A B", board: "State" }).success).toBe(false);
    expect(IntakeSchema.safeParse({ ...base, name: "A B", board: "State", stateBoard: "MSBSHSE", medium: "English" }).success).toBe(true);
  });
  it("an unverified parent number blocks sending", async () => {
    const st = await student();
    expect(parentReachable(st.parents[0]!)).toBe(false);
    await markVerified(st.parents[0]!.id);
    expect(parentReachable((await epdb.parent.findUniqueOrThrow({ where: { id: st.parents[0]!.id } })))).toBe(true);
  });
  it("CSV import reports row-level errors without partial corruption", async () => {
    const csv = ["Student name,Class,Board,Subjects,Parent name,Parent WhatsApp,Parent consent", "Good Row,10,CBSE,Maths,P One,+919811111111,Yes", "No Consent,10,CBSE,Maths,P Two,+919822222222,No", "Bad Subject,9,CBSE,Physics,P Three,+919833333333,Yes"].join("\n");
    const r = await importIntakeCsv(csv);
    expect(r.imported).toBe(0);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(await epdb.student.count()).toBe(0);
  });
  it("consent text version and time are recorded", async () => {
    const st = await student();
    expect(st.parents[0]!.consentTextVersion).toBe(1);
    expect(st.parents[0]!.consentAt).toBeInstanceOf(Date);
  });
});

describe("R2 question bank and papers", () => {
  it("a paper with an untagged question cannot be published; chapter totals are shown", async () => {
    const p = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 1 });
    const sec = await epdb.section.findFirstOrThrow({ where: { paperId: p.id, type: "mcq" } });
    await addQuestion(p.id, sec.id, { chapter: "Real Numbers", topic: "t", marks: 1, type: "mcq", difficulty: "easy", text: "Question?", options: ["a", "b"], correctOption: "A", markingScheme: [] });
    const bad = await epdb.question.create({ data: { klass: 10, subject: "Maths", board: "CBSE", chapter: "", topic: "", marks: 2, type: "mcq", difficulty: "easy", text: "Untagged?", options: ["a", "b"], correctOption: "A" } });
    await epdb.paperQuestion.create({ data: { paperId: p.id, sectionId: sec.id, questionId: bad.id, number: 2 } });
    await expect(publishPaper(p.id)).rejects.toThrow(/not fully tagged/);
    expect((await paperCheck(p.id)).byChapter).toEqual({ "Real Numbers": 1 });
  });
  it("chapters are validated against the chapter list", async () => {
    const p = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 1 });
    const sec = await epdb.section.findFirstOrThrow({ where: { paperId: p.id } });
    await expect(addQuestion(p.id, sec.id, { chapter: "Calculus", topic: "t", marks: 1, type: "mcq", difficulty: "easy", text: "Question?", options: ["a", "b"], correctOption: "A", markingScheme: [] })).rejects.toThrow(/not in the/);
  });
  it("published papers are immutable except by versioning; cloning keeps tags", async () => {
    const p = await smallPaper();
    const sec = await epdb.section.findFirstOrThrow({ where: { paperId: p.id } });
    await expect(addQuestion(p.id, sec.id, { chapter: "Real Numbers", topic: "t", marks: 1, type: "mcq", difficulty: "easy", text: "Question?", options: ["a", "b"], correctOption: "A", markingScheme: [] })).rejects.toThrow(/published/);
    const v2 = await newVersion(p.id);
    expect(v2.id).toBe("C10-MAT-P1-CBSE-v2");
    expect((await epdb.paper.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("published");
    expect(await epdb.paperQuestion.count({ where: { paperId: v2.id } })).toBe(4);
    const c = await clonePaperToBoard(p.id, "ICSE-ISC");
    const cq = await epdb.paperQuestion.findMany({ where: { paperId: c.id }, include: { question: true } });
    expect(cq.map((x) => [x.question.chapter, x.question.topic, x.question.difficulty, x.question.board])).toEqual(p.items.map((i) => [i.question.chapter, i.question.topic, i.question.difficulty, "ICSE-ISC"]));
  });
});

describe("R3 calendar and jobs", () => {
  it("changing the start date shifts everything; jobs run twice create no duplicates", async () => {
    await student();
    await setSettings({ "programme.startDate": "2026-12-07" });
    await generateCalendar();
    const a = await epdb.slot.findFirstOrThrow({ where: { week: 1, klass: 10 } });
    await setSettings({ "programme.startDate": "2026-12-14" });
    await generateCalendar();
    const b = await epdb.slot.findFirstOrThrow({ where: { week: 1, klass: 10 } });
    expect(b.dueAt.getTime() - a.dueAt.getTime()).toBe(7 * 86_400_000);
    const p = await smallPaper();
    await attachPaper(b.id, p.id);
    const now = weekTime("2026-12-14", 1, "Thu 10:00");
    await weeklyTasks(now);
    const t1 = await epdb.task.count();
    const m1 = await epdb.message.count();
    await weeklyTasks(now);
    expect(await epdb.task.count()).toBe(t1);
    expect(await epdb.message.count()).toBe(m1);
  });
  it("the private reminder cannot be drafted twice for the same student and paper", async () => {
    const st = await student();
    const p = await smallPaper();
    const a = await draftPrivateReminder(st.id, p.id);
    const b = await draftPrivateReminder(st.id, p.id);
    expect(a!.id).toBe(b!.id);
    expect(await epdb.message.count({ where: { templateKey: "private_reminder" } })).toBe(1);
  });
});

describe("R4 submissions", () => {
  it("a second submission replaces the first and history remains; the missing list is roster minus submissions", async () => {
    const a = await student();
    const b = await student();
    const p = await smallPaper();
    await addSubmission({ studentId: a.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet() }], source: "form" });
    await addSubmission({ studentId: a.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet(4) }], source: "form" });
    const rows = await epdb.submission.findMany({ where: { studentId: a.id, paperId: p.id } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(rows.find((r) => !r.isCurrent)!.files).toBeTruthy();
    expect(rows.find((r) => r.isCurrent)!.flags).toContain("duplicate_replaced_earlier");
    expect((await missing(p.id)).map((s) => s.id)).toEqual([b.id]);
  });
  it("labels late submissions and refuses files of other types or too many photos", async () => {
    const a = await student();
    const p = await smallPaper();
    await epdb.paper.update({ where: { id: p.id }, data: { dueAt: new Date("2026-12-10T14:30:00Z") } });
    const sub = await addSubmission({ studentId: a.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet() }], source: "form", submittedAt: new Date("2026-12-11T10:00:00Z") });
    expect(sub.isLate).toBe(true);
    expect(sub.flags).toContain("late");
    await expect(addSubmission({ studentId: a.id, paperId: p.id, files: [{ name: "x.docx", bytes: new Uint8Array(10) }], source: "form" })).rejects.toThrow(/only PDF, JPG or PNG/);
    const png = fakePng(1200, 1600);
    await expect(addSubmission({ studentId: a.id, paperId: p.id, files: Array.from({ length: 11 }, (_, i) => ({ name: `p${i}.png`, bytes: png })), source: "form" })).rejects.toThrow(/At most 10/);
  });
  it("joins photos into one ordered PDF and flags small or out-of-order pages", async () => {
    const a = await student();
    const p = await smallPaper();
    const sub = await addSubmission({ studentId: a.id, paperId: p.id, files: [{ name: "page2.png", bytes: fakePng(300, 400) }, { name: "page1.png", bytes: fakePng(1200, 1600) }], source: "form" });
    expect(sub.flags).toEqual(expect.arrayContaining(["pages_out_of_order", "blurry_or_small"]));
    expect((sub.files as { pages: number }[])[0]!.pages).toBe(2);
  });
  it("a student's file is only reachable through a signed, unexpired link", () => {
    const link = signedLink("class-10/Maths/P/x.pdf", Date.now());
    const u = new URL(link, "http://x");
    expect(checkLink(u.searchParams.get("p")!, u.searchParams.get("e")!, u.searchParams.get("s")!)).toBe(true);
    expect(checkLink("class-10/Maths/P/other.pdf", u.searchParams.get("e")!, u.searchParams.get("s")!)).toBe(false);
    expect(checkLink(u.searchParams.get("p")!, u.searchParams.get("e")!, u.searchParams.get("s")!, Date.now() + 10 * 60_000)).toBe(false);
  });
});

describe("R5 marking", () => {
  it("no AI request contains a name or phone number, and the redaction guard refuses one that does", async () => {
    const st = await student({ name: "Ishaan Verma" });
    const p = await smallPaper();
    await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet() }], source: "form" });
    await proposeWithAi(p.id);
    const logs = await epdb.aiRequestLog.findMany();
    expect(logs.length).toBe(2);
    const text = JSON.stringify(logs.map((l) => l.payload));
    expect(text).not.toContain("Ishaan");
    expect(text).not.toMatch(/9198\d{8}/);
    expect(text).toContain(st.code);
    expect(() => assertRedacted({ studentCode: st.code, questionId: "q", questionNumber: 1, questionText: "Ishaan Verma's answer", maxMarks: 2, markingScheme: [], sheet: {} }, ["Ishaan Verma"])).toThrow();
    expect(() => assertRedacted({ studentCode: st.code, name: "x" } as never)).toThrow(/not allowed/);
    expect(() => assertRedacted({ studentCode: st.code, questionText: "call +91 98123 45678" } as never)).toThrow(/phone/);
  });
  it("a mark change appears in the audit log; calibration shows the agreement", async () => {
    const st = await student();
    const p = await smallPaper();
    await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet() }], source: "form" });
    await proposeWithAi(p.id);
    const [m1, m2] = await epdb.mark.findMany({ where: { source: "ai" } });
    await reviewMark(m1!.id, { action: "edit", marks: Math.min(4, m1!.aiProposed! + 1.5 > 4 ? 0 : m1!.aiProposed! + 1.5) });
    await reviewMark(m2!.id, { action: "accept" });
    const log = await epdb.auditLog.findMany({ where: { entity: "Mark" } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["mark.edit", "mark.accept"]));
    const c = await calibration();
    expect(c.questions).toBe(2);
    expect(c.agreement).toBe(50);
  });
  it("the marking grid saves a whole sheet at once; one bad entry saves nothing", async () => {
    const st = await student();
    const p = await smallPaper();
    const sub = await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet() }], source: "form" });
    const written = p.items.filter((i) => i.question.type !== "mcq").map((i) => i.number);
    await expect(setMarks(sub.id, [{ number: written[0]!, marks: 3 }, { number: written[1]!, marks: 9 }])).rejects.toThrow(/between 0 and 4/);
    expect(await epdb.mark.count({ where: { submissionId: sub.id, source: "teacher" } })).toBe(0);
    await setMarks(sub.id, [{ number: written[0]!, marks: 3, errorTag: "calculation" }, { number: written[1]!, marks: 4, errorTag: "concept" }]);
    const marks = await epdb.mark.findMany({ where: { submissionId: sub.id, source: "teacher" } });
    expect(marks.map((m) => [m.marksAwarded, m.errorTag]).sort()).toEqual([[3, "calculation"], [4, "none"]]);
    expect(await epdb.auditLog.count({ where: { entity: "Mark", action: "mark.entered" } })).toBe(2);
  });
});

describe("R6-R7 analytics and reports", () => {
  async function marked(n: number, klass = 10) {
    const p = await smallPaper();
    const ids = [];
    for (let i = 0; i < n; i++) {
      const st = await student({ klass, parentEmail: i % 2 ? `t${i}@example.invalid` : "" } as never);
      await markVerified(st.parents[0]!.id);
      await fileAndMark(st.id, p.id, i % 5);
      ids.push(st.id);
    }
    await epdb.paper.update({ where: { id: p.id }, data: { status: "marked" } });
    return { p, ids };
  }
  it("the same report is never created twice; opted-out or unverified parents are never queued", async () => {
    const { p, ids } = await marked(6);
    const unverified = await student();
    await fileAndMark(unverified.id, p.id, 2);
    await optOut({ parentId: (await epdb.parent.findFirstOrThrow({ where: { studentId: ids[0] } })).id });
    const r1 = await generateReports(p.id);
    const r2 = await generateReports(p.id);
    expect(r2.created).toBe(0);
    expect(r1.total).toBe(r1.created);
    expect(await epdb.reportCard.count({ where: { audience: "parent", OR: [{ studentId: ids[0] }, { studentId: unverified.id }] } })).toBe(0);
    await setSettings({ "delivery.emailEnabled": true });
    await approveReports(p.id);
    await deliverReports(new Date());
    const queued = await epdb.message.findMany({ where: { templateKey: { in: ["parent_report", "student_report"] } } });
    expect(queued.some((m) => m.studentId === ids[0] || m.studentId === unverified.id)).toBe(false);
  });
  it("Class 9 reports never say 'exam readiness'; low scores get kind framing; Hindi report text", async () => {
    const s = await getSettings();
    const d = (klass: number, pct: number, lang: "en" | "hi" = "en") =>
      ({
        student: { code: "EP-0001", name: "X", klass, board: "CBSE" },
        paper: { id: "P", number: 1, subject: "Maths", title: "Paper 1" },
        totals: { got: pct, max: 100, pct },
        chapter_breakdown: [{ chapter: "A", got: 1, max: 2, pct: 50, band: "Okay" }],
        strong: ["A"],
        weak: ["A"],
        trend: null,
        redo: [],
        framing: reportFraming({ pct, klass, lang }),
        classBand: null,
        paid: false,
        errors: null,
        quality: null,
        time: null,
        corrections: [],
        lang,
      }) as unknown as ReportData;
    for (const pct of [10, 50, 90]) expect(reportHtml(d(9, pct), "student", s)).not.toMatch(/exam readiness/i);
    expect(reportHtml(d(10, 20), "student", s)).toMatch(/fixable/);
    const hi = reportHtml(d(10, 60, "hi"), "parent", s);
    expect(hi).toContain("प्रगति रिपोर्ट");
    expect(hi).toMatch(/Nirmala UI/);
    expect(hi).toContain("Reply STOP to stop receiving these.");
  });
});

describe("R8 ranking privacy", () => {
  it("no student, parent, report, group-message or offer code path reads RankRecord", () => {
    const dir = path.resolve(__dirname, "..");
    const forbidden = ["services/reports.ts", "services/analytics.ts", "services/messaging.ts", "services/commerce.ts", "services/people.ts", "services/submissions.ts", "services/html.ts", "adapters/email.ts", "adapters/whatsapp.ts"];
    for (const f of forbidden) {
      const src = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/rankRecord|RankRecord|from "\.\/ranking"/);
    }
  });
  it("ties, the minimum cohort and the no-consent rule hold end to end", async () => {
    const p = await smallPaper();
    const got = [4, 3, 3, 2, 1, 0];
    const ids: string[] = [];
    for (const [i, g] of got.entries()) {
      const st = await student({ rankConsent: i !== 1 });
      await fileAndMark(st.id, p.id, g);
      ids.push(st.id);
    }
    await computeRanks(p.id);
    const r = await epdb.rankRecord.findMany({ where: { paperId: p.id } });
    expect(ids.map((id) => r.find((x) => x.studentId === id)!.rank)).toEqual([1, 2, 2, 4, 5, 6]);
    const tell = await tellingRows(p.id);
    expect(tell.map((t) => t.student.id)).not.toContain(ids[1]);
    expect(tell[0]!.record.cohortSize).toBe(6);
  });
  it("ranks and personal results never appear in report data, messages or group posts", async () => {
    const p = await smallPaper();
    for (let i = 0; i < 5; i++) {
      const st = await student({ name: `Rank Test ${i}` });
      await markVerified(st.parents[0]!.id);
      await fileAndMark(st.id, p.id, i);
    }
    await epdb.paper.update({ where: { id: p.id }, data: { status: "marked" } });
    await computeRanks(p.id);
    await generateReports(p.id);
    await approveReports(p.id);
    await deliverReports(new Date());
    for (const rc of await epdb.reportCard.findMany()) {
      const text = JSON.stringify(rc.data);
      expect(text).not.toMatch(/"rank"|Rank \d+ of/);
    }
    for (const m of await epdb.message.findMany()) expect(m.body).not.toMatch(/Rank \d+ of|rank \d/i);
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.audience === "group")) expect(validateTemplate("group", t.body)).toBeNull();
    expect(validateTemplate("group", "{tag} {student} scored {score}")).toMatch(/can't include/);
    expect(validateTemplate("group", "Hello all")).toMatch(/must start with the tag/);
  });
});

describe("R9 messaging", () => {
  it("an opted-out contact never appears in any queue", async () => {
    const st = await student();
    await markVerified(st.parents[0]!.id);
    const p = await smallPaper();
    await draftPrivateReminder(st.id, p.id);
    const r = await optOut({ studentId: st.id });
    expect(r.cancelled).toBe(1);
    expect(r.confirmation?.templateKey).toBe("opt_out_confirmation");
    expect(await draft({ templateKey: "x", audience: "parent", body: "b", studentId: st.id, parentId: st.parents[0]!.id })).toBeNull();
    expect(await epdb.message.count({ where: { studentId: st.id, status: "drafted", NOT: { templateKey: "opt_out_confirmation" } } })).toBe(0);
  });
});

describe("R10 commercial", () => {
  it("receipt numbers are unique and sequential; the family discount is automatic", async () => {
    await setSettings({ "commercial.prices": { paid1: 500, paid2: 1500 }, "commercial.familyDiscountPct": 10 });
    const st = await student();
    const { plan, price } = await startPlan({ studentId: st.id, tier: "paid1", subjects: 2 });
    expect(price).toEqual({ gross: 1000, discount: 100, net: 900 });
    const a = await recordPayment({ studentId: st.id, planId: plan.id, amount: 900, method: "UPI", reference: "UTR1" });
    const b = await recordPayment({ studentId: st.id, planId: plan.id, amount: 900, method: "cash" });
    const y = new Date().getFullYear();
    expect([a.receiptNo, b.receiptNo]).toEqual([`RSC-${y}-0001`, `RSC-${y}-0002`]);
    expect(storage.exists(`receipts/${a.receiptNo}.pdf`)).toBe(true);
  });
  it("an Offer only comes after two reports and a repeating gap", async () => {
    const st = await student();
    await markVerified(st.parents[0]!.id);
    for (const n of [1, 2]) {
      const p = await smallPaper(n);
      await fileAndMark(st.id, p.id, 0); // Real Numbers and Polynomials below 50% in both
      await epdb.paper.update({ where: { id: p.id }, data: { status: "marked" } });
      await generateReports(p.id);
      if (n === 1) {
        await approveReports(p.id);
        expect((await suggestOffers()).created).toBe(0);
      } else await approveReports(p.id);
    }
    expect((await suggestOffers()).created).toBe(2);
    expect((await suggestOffers()).created).toBe(0);
    const msg = await epdb.message.findFirstOrThrow({ where: { templateKey: "paid_offer" } });
    expect(msg.body).not.toMatch(/rank/i);
  });
});

describe("R11 privacy", () => {
  it("a deleted student's files are gone and the deletion is logged; export is a ZIP", async () => {
    const st = await student({ name: "Delete Me" });
    const p = await smallPaper();
    const sub = await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "x.pdf", bytes: await fakeSheet() }], source: "form" });
    const file = (sub.files as { path: string }[])[0]!.path;
    const zip = await exportStudent(st.id);
    expect(zip.bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(storage.exists(file)).toBe(true);
    const r = await deleteStudentData(st.id);
    expect(storage.exists(file)).toBe(false);
    expect(await epdb.student.count({ where: { id: st.id } })).toBe(0);
    expect(await epdb.submission.count({ where: { studentId: st.id } })).toBe(0);
    expect((await epdb.deletionRequest.findUniqueOrThrow({ where: { id: r.request } })).completedAt).toBeInstanceOf(Date);
    expect(await epdb.auditLog.count({ where: { action: "student.deleted", entityId: st.id } })).toBe(1);
  });
  it("no audit-log row contains a name or phone number; the audit log is append-only", async () => {
    const st = await student({ name: "Zara Quill" });
    await markVerified(st.parents[0]!.id);
    await optOut({ studentId: st.id });
    const rows = JSON.stringify(await epdb.auditLog.findMany());
    expect(rows).not.toContain("Zara");
    expect(rows).not.toMatch(/\+?9198\d{8}/);
    const one = await epdb.auditLog.findFirstOrThrow();
    await expect(epdb.auditLog.update({ where: { id: one.id }, data: { action: "x" } })).rejects.toThrow();
    await expect(epdb.auditLog.delete({ where: { id: one.id } })).rejects.toThrow();
  });
});

describe("R12-R14 metrics, feedback, settings", () => {
  it("one feedback response per student per paper; aggregates", async () => {
    const st = await student();
    const p = await smallPaper();
    await recordFeedback({ studentId: st.id, paperId: p.id, difficulty: "right", rating: 4 });
    await expect(recordFeedback({ studentId: st.id, paperId: p.id, difficulty: "too_hard" })).rejects.toThrow(/already/);
    expect((await feedbackSummary(p.id)).avgRating).toBe(4);
  });
  it("metrics match a hand calculation and targets follow settings", async () => {
    await setSettings({ "group.memberCount": 4 });
    const p = await smallPaper();
    const a = await student();
    await student();
    await fileAndMark(a.id, p.id, 2);
    const m = await metrics();
    const row = (k: string) => m.rows.find((r) => r.key === k)!;
    expect(row("intake").value).toBe(50); // 2 forms / 4 in the group
    expect(row("submission").value).toBe(50); // 1 sheet / 2 on the roll
    await setSetting("targets.intake", 40);
    expect((await metrics()).rows.find((r) => r.key === "intake")!.ok).toBe(true);
  });
  it("invalid settings are rejected and audited changes recorded", async () => {
    await expect(setSetting("cohort.minSize", 1)).rejects.toThrow();
    await expect(setSetting("programme.times", { post: "Monday 9", reminder: "Wed 18:00", deadline: "Thu 20:00", key: "Fri 18:00", review: "Sat 10:00", reports: "Sun 17:00" })).rejects.toThrow(/day and time/);
    await expect(setSetting("analytics.okay", 80)).rejects.toThrow(/below the Strong/);
    await setSetting("cohort.minSize", 6);
    expect((await getSettings())["cohort.minSize"]).toBe(6);
    expect(await epdb.auditLog.count({ where: { action: "setting.changed", entityId: "cohort.minSize" } })).toBe(1);
  });
});

describe("Uploaded papers (the tutor's own PDF or CSV)", () => {
  it("publishes without questions once the paper file is uploaded; keeps versions; drafts posts with the file", async () => {
    const { addPaperFile, currentPaperFile, removePaperFile, shareableFile, csvPreview, paperFiles } = await import("../services/papers");
    const { draftPaperPosts } = await import("../services/calendar");
    await expect(createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 7, uploadOnly: true })).rejects.toThrow(/total marks/);
    const p = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 7, uploadOnly: true, totalMarks: 40 });
    await expect(publishPaper(p.id)).rejects.toThrow(/Upload the paper file/);
    await expect(addPaperFile(p.id, "paper", { name: "paper.docx", bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/PDF or CSV/);
    await expect(addPaperFile(p.id, "paper", { name: "broken.pdf", bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow(/can't be opened/);
    const v1 = await addPaperFile(p.id, "paper", { name: "Paper 7.pdf", bytes: await fakeSheet(2) });
    const v2 = await addPaperFile(p.id, "paper", { name: "Paper 7 fixed.pdf", bytes: await fakeSheet(3) });
    expect((await currentPaperFile(p.id, "paper"))!.id).toBe(v2.id);
    expect((await paperFiles(p.id)).filter((f) => f.kind === "paper")).toHaveLength(2);
    const c = await publishPaper(p.id);
    expect(c.total).toBe(40);
    expect((await epdb.paper.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("published");
    // Removing the current version brings the earlier one back; the only file of a published paper can't go
    await removePaperFile(v2.id);
    expect((await currentPaperFile(p.id, "paper"))!.id).toBe(v1.id);
    await expect(removePaperFile(v1.id)).rejects.toThrow(/only file/);
    // CSV key with a preview
    const key = await addPaperFile(p.id, "key", { name: "key.csv", bytes: new TextEncoder().encode("Q,Answer\n1,B\n2,D\n") });
    expect(await csvPreview(key.path)).toEqual([["Q", "Answer"], ["1", "B"], ["2", "D"]]);
    // Group posts: tagged, with the total marks, drafted once, with the files to attach
    const a = await draftPaperPosts(p.id);
    const b = await draftPaperPosts(p.id);
    expect(a.post!.id).toBe(b.post!.id);
    expect(a.post!.body.startsWith("[Class 10 | CBSE | Maths | Paper 7]")).toBe(true);
    expect(a.post!.body).toContain("Total 40 marks");
    expect((await shareableFile(p.id, "paper"))!.name).toBe("Paper 7.pdf");
    expect((await shareableFile(p.id, "key"))!.name).toBe("key.csv");
    expect(storage.exists(v1.path)).toBe(true);
    expect(storage.exists(v2.path)).toBe(false);
  });
});

describe("CBSE board paper with internal choices (OR)", () => {
  it("imports the practice paper exactly: 38 questions, 80 marks, sections A-E, OR in Q21, 22, 28, 31, 34-38", async () => {
    const { importQuestions, paperWithQuestions, exportQuestions } = await import("../services/papers");
    const { NCERT } = await import("../seed/chapters");
    await setChapterList(10, "Maths", "CBSE", NCERT["10|Maths"]!);
    const p = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 11 });
    const json = fs.readFileSync(path.resolve(__dirname, "../../../../design/sample-papers/cbse-class10-maths-practice-1.json"), "utf8");
    const r = await importQuestions(p.id, json);
    expect(r.errors).toEqual([]);
    expect(r.imported).toBe(38);
    const full = (await paperWithQuestions(p.id))!;
    const by = (sec: string) => full.items.filter((i) => i.section.name === sec);
    expect(["A", "B", "C", "D", "E"].map((s) => [by(s).length, by(s).reduce((a, i) => a + i.question.marks, 0)])).toEqual([[20, 20], [5, 10], [6, 18], [4, 20], [3, 12]]);
    expect(full.items.filter((i) => i.question.orText).map((i) => i.number)).toEqual([21, 22, 28, 31, 34, 35, 36, 37, 38]);
    for (const i of full.items.filter((x) => x.question.orText)) {
      const sum = ((i.question.orMarkingScheme as { marks: number }[]) ?? []).reduce((a, s) => a + s.marks, 0);
      expect(sum, `Q${i.number} OR scheme`).toBe(i.question.marks);
    }
    await publishPaper(p.id);
    expect((await exportQuestions(p.id)).questions.filter((q) => "or" in q)).toHaveLength(9);
    // The AI request for an OR question carries the alternative and still passes the redaction check
    const st = await student();
    await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "s.pdf", bytes: await fakeSheet() }], source: "form" });
    await proposeWithAi(p.id);
    const q21 = full.items.find((i) => i.number === 21)!;
    const log = await epdb.aiRequestLog.findFirstOrThrow({ where: { questionId: q21.questionId } });
    expect((log.payload as { alternativeText?: string }).alternativeText).toContain("runners");
    // An OR scheme that doesn't add up is refused
    const p2 = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 12 });
    const sec = await epdb.section.findFirstOrThrow({ where: { paperId: p2.id, name: "B" } });
    await expect(addQuestion(p2.id, sec.id, { chapter: "Real Numbers", topic: "t", marks: 2, type: "short", difficulty: "easy", text: "Question one?", options: [], markingScheme: [{ step: "a", marks: 2 }], or: { text: "Question two?", markingScheme: [{ step: "b", marks: 1 }] } } as never)).rejects.toThrow(/OR question's marking scheme/);
  });
});

describe("uploaded papers marked row by row; questions from CSV", () => {
  it("a new uploaded paper copies its class format; row marks are all-or-nothing and audited", async () => {
    const { saveFormat, setRowMarks, setPaperRows, rowScores } = await import("../services/answer-rows");
    const fmt = fs.readFileSync(path.resolve(__dirname, "../../../../design/marking-formats/cbse-class10-maths-standard-041.csv"), "utf8");
    const rows = await saveFormat(10, "CBSE", "Maths", fmt);
    expect(rows).toHaveLength(53);
    const p = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 21, uploadOnly: true });
    expect(p.totalMarks).toBe(80);
    expect((p.answerRows as unknown[]).length).toBe(53);
    const { addPaperFile } = await import("../services/papers");
    await addPaperFile(p.id, "paper", { name: "paper.pdf", bytes: await fakeSheet(1) });
    await publishPaper(p.id);
    const st = await student();
    const sub = await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "s.pdf", bytes: await fakeSheet() }], source: "form" });
    // One bad value (and an OR clash) saves nothing
    await expect(setRowMarks(sub.id, { "1": 1, "21.A": 2, "21.B": 1 })).rejects.toThrow(/alternatives/);
    await expect(setRowMarks(sub.id, { "1": 1, "26": 4 })).rejects.toThrow(/between 0 and 3/);
    expect(await epdb.rowMark.count()).toBe(0);
    const r = await setRowMarks(sub.id, { "1": 1, "2": 0, "21.B": 1.5, "36.i": 1, "36.iii.A": 2 }, { "2": "concept", "21.B": "calculation" });
    expect(r).toMatchObject({ got: 5.5, max: 80 });
    expect((await epdb.rowMark.findFirstOrThrow({ where: { label: "2" } })).errorTag).toBe("concept");
    // Blank removes a mark; full marks clear the error type
    await setRowMarks(sub.id, { "2": null, "21.B": 2 }, { "21.B": "calculation" });
    expect(await epdb.rowMark.findFirst({ where: { label: "2" } })).toBeNull();
    expect((await epdb.rowMark.findFirstOrThrow({ where: { label: "21.B" } })).errorTag).toBe("none");
    expect((await rowScores(p.id)).get(sub.id)).toMatchObject({ got: 6, max: 80 });
    expect(await epdb.auditLog.count({ where: { entity: "RowMark" } })).toBeGreaterThanOrEqual(6);
    // Rows are locked once marks exist
    await expect(setPaperRows(p.id, "1,1")).rejects.toThrow(/already marked/);
    // Marking every row marks the sheet
    const all: Record<string, number> = {};
    for (const row of rows) if (!row.choice || row.label.endsWith(".A")) all[row.label] = row.max;
    const done = await setRowMarks(sub.id, { ...all, "21.B": null });
    expect(done).toMatchObject({ got: 80, open: 0 });
    expect((await epdb.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("marked");
  });

  it("the CSV version of the practice paper imports exactly like the JSON; the template CSV imports", async () => {
    const { importQuestions, paperWithQuestions, QUESTIONS_CSV_TEMPLATE } = await import("../services/papers");
    const { NCERT } = await import("../seed/chapters");
    await setChapterList(10, "Maths", "CBSE", NCERT["10|Maths"]!);
    const dir = path.resolve(__dirname, "../../../../design/sample-papers");
    const a = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 31 });
    const b = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 32 });
    expect((await importQuestions(a.id, fs.readFileSync(path.join(dir, "cbse-class10-maths-practice-1.json"), "utf8"))).errors).toEqual([]);
    const rb = await importQuestions(b.id, fs.readFileSync(path.join(dir, "cbse-class10-maths-practice-1.csv"), "utf8"));
    expect(rb.errors).toEqual([]);
    expect(rb.imported).toBe(38);
    const shape = async (id: string) =>
      (await paperWithQuestions(id))!.items.map((i) => [i.number, i.section.name, i.question.chapter, i.question.marks, i.question.type, i.question.text, i.question.correctOption, JSON.stringify(i.question.markingScheme), i.question.orText ?? null, JSON.stringify(i.question.orMarkingScheme ?? null)]);
    expect(await shape(b.id)).toEqual(await shape(a.id));
    const c = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 33 });
    const rc = await importQuestions(c.id, QUESTIONS_CSV_TEMPLATE);
    expect(rc.errors).toEqual([]);
    expect(rc.imported).toBe(4);
    expect((await paperWithQuestions(c.id))!.items.filter((i) => i.question.orText).map((i) => i.number)).toEqual([3, 4]);
    // A CSV with a bad row imports nothing and names the row
    const bad = QUESTIONS_CSV_TEMPLATE.replace("1,A,Real Numbers,HCF and LCM,1,", "1,A,Real Numbers,HCF and LCM,0,");
    const d = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 34 });
    const rd = await importQuestions(d.id, bad);
    expect(rd.imported).toBe(0);
    expect(rd.errors[0]).toMatch(/Question 1/);
  });
});
