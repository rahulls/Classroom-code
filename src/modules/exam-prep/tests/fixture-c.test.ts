// Fixture C (spec section 8): end-to-end dry run, Class 10 CBSE Maths, Paper 1. One automated test
// through the services against the test database, with the AI and email adapters stubbed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAiMarker, type AiMarker } from "../adapters/ai-marker";
import { stubOutbox } from "../adapters/email";
import { storage } from "../adapters/storage";
import { epdb } from "../db";
import { weekTime } from "../domain/programme";
import { generateCalendar, attachPaper, missing, weeklyTasks } from "../services/calendar";
import { proposeWithAi, reviewQueue, reviewMark, markPaperMarked, selectSpotCheck, recordSpotCheck, enteredTotal, setMark, spotCheckSummary } from "../services/marking";
import { suggestOffers } from "../services/commerce";
import { addPendingStudent, importIntakeCsv, markVerified, updateStudent } from "../services/people";
import { addQuestion, createPaper, publishPaper, setChapterList } from "../services/papers";
import { approveReports, classNote, deliverReports, generateReports } from "../services/reports";
import { seedTemplates } from "../services/messaging";
import { addSubmission } from "../services/submissions";
import { FIXTURE_CHAPTERS, fakeSheet, resetDb, setSettings } from "./helpers";

const START = "2026-12-07"; // a Monday
const at = (week: number, t: string) => weekTime(START, week, t);

// Chapter totals per pattern (Fixture A's three students), used to make every sheet's marks exact
const PATTERNS = [
  { "Real Numbers": 5, Polynomials: 5, "Quadratic Equations": 4, Trigonometry: 9, Statistics: 3 },
  { "Real Numbers": 3, Polynomials: 4, "Quadratic Equations": 8, Trigonometry: 5, Statistics: 7 },
  { "Real Numbers": 6, Polynomials: 2, "Quadratic Equations": 3, Trigonometry: 4, Statistics: 2 },
] as Record<string, number>[];
// Paper 1 (40 marks): per chapter, MCQ marks (1 each) and one written question
const LAYOUT: Record<string, { mcq: number; written: number }> = {
  "Real Numbers": { mcq: 2, written: 4 },
  Polynomials: { mcq: 2, written: 4 },
  "Quadratic Equations": { mcq: 4, written: 6 },
  Trigonometry: { mcq: 4, written: 6 },
  Statistics: { mcq: 4, written: 4 },
};
const split = (chapter: string, total: number) => {
  const w = Math.min(LAYOUT[chapter]!.written, total);
  return { written: w, mcq: total - w };
};

describe("Fixture C: end-to-end dry run", () => {
  const questionChapter = new Map<string, string>();
  const patternOf = new Map<string, number>(); // student code → pattern index
  let paper1 = "";

  beforeAll(async () => {
    await resetDb();
    stubOutbox.length = 0;
    await seedTemplates();
    await setSettings({ "programme.startDate": START, "delivery.emailEnabled": true, "group.memberCount": 28 });
    await setChapterList(10, "Maths", "CBSE", FIXTURE_CHAPTERS);
  });
  afterAll(() => setAiMarker(null));

  it("runs the whole week exactly as the spec describes", async () => {
    // 1. 28 students: 24 complete intake (21 CBSE + 3 on other boards), 4 still pending
    const head = "Student name,Class,Board,Subjects,Parent name,Parent WhatsApp,Parent email,Report language,Parent consent,Rank consent,Report timing";
    const boards = [...Array(21).fill("CBSE"), "ICSE", "IGCSE", "ICSE"];
    const lines = boards.map((b, i) => `Fixture Student ${i + 1},10,${b},"Maths, Science",Fixture Parent ${i + 1},+91 98${String(10000000 + i).slice(0, 8)},${i < 14 ? `fixture.parent${i + 1}@example.invalid` : ""},English,Yes,${i % 5 ? "Yes" : "No"},Same time`);
    const imp = await importIntakeCsv([head, ...lines].join("\n"), { isDemo: true });
    expect(imp.errors).toEqual([]);
    expect(imp.imported).toBe(24);
    for (let i = 0; i < 4; i++) await addPendingStudent({ name: `Pending Student ${i + 1}`, klass: 10, board: "CBSE", subjects: ["Maths"], isDemo: true });
    expect(await epdb.student.count()).toBe(28);
    for (const p of await epdb.parent.findMany({ where: { consentAt: { not: null } } })) await markVerified(p.id);

    // 2. Paper 0: three students can't sign in and move to the manual path
    const p0 = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 0 });
    const s0 = await epdb.section.findFirstOrThrow({ where: { paperId: p0.id, type: "mcq" } });
    for (const ch of FIXTURE_CHAPTERS) await addQuestion(p0.id, s0.id, { chapter: ch, topic: "Diagnostic", marks: 1, type: "mcq", difficulty: "easy", text: `Diagnostic ${ch}?`, options: ["1", "2", "3", "4"], correctOption: "A", markingScheme: [] });
    await publishPaper(p0.id);
    const all = await epdb.student.findMany({ where: { parents: { some: { consentAt: { not: null } } } }, orderBy: { code: "asc" } });
    for (const st of all.slice(0, 3)) await updateStudent(st.id, { manualPath: true });
    expect(await epdb.student.count({ where: { manualPath: true } })).toBe(3);

    // 3. Paper 1 (40 marks, the Fixture A chapters), published, attached to week 1, tagged group post drafted
    const p1 = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: 1 });
    paper1 = p1.id;
    expect(paper1).toBe("C10-MAT-P1-CBSE");
    const secs = await epdb.section.findMany({ where: { paperId: p1.id } });
    const mcqSec = secs.find((s) => s.type === "mcq")!;
    const longSec = secs.find((s) => s.type === "long")!;
    for (const ch of FIXTURE_CHAPTERS) {
      for (let k = 0; k < LAYOUT[ch]!.mcq; k++) {
        const q = await addQuestion(p1.id, mcqSec.id, { chapter: ch, topic: `${ch} basics`, marks: 1, type: "mcq", difficulty: "easy", text: `${ch} MCQ ${k + 1}`, options: ["w", "x", "y", "z"], correctOption: "B", markingScheme: [] });
        questionChapter.set(q.id, ch);
      }
      const w = LAYOUT[ch]!.written;
      const q = await addQuestion(p1.id, longSec.id, { chapter: ch, topic: `${ch} problem`, marks: w, type: "long", difficulty: "medium", text: `Solve the ${ch} problem.`, options: [], markingScheme: [{ step: "Method", marks: w / 2 }, { step: "Answer", marks: w / 2 }], solution: "x = 2" });
      questionChapter.set(q.id, ch);
    }
    const check = await publishPaper(p1.id);
    expect(check.total).toBe(40);
    await generateCalendar();
    const slot = await epdb.slot.findFirstOrThrow({ where: { week: 1, klass: 10, subject: "Maths", board: "CBSE" } });
    await attachPaper(slot.id, p1.id);
    await weeklyTasks(at(1, "Mon 10:00"));
    const post = await epdb.message.findUniqueOrThrow({ where: { dedupeKey: `post:${p1.baseId}` } });
    expect(post.body.startsWith("[Class 10 | CBSE | Maths | Paper 1]")).toBe(true);

    // 4. Submissions: 19 by Wednesday, the reminder job lists the 9 missing, 4 more come in (23), 5 still missing
    const consented = await epdb.student.findMany({ where: { id: { in: all.map((x) => x.id) } }, orderBy: { code: "asc" } }); // 24 with consent (fresh: 3 now on the manual path)
    const items = await epdb.paperQuestion.findMany({ where: { paperId: p1.id }, include: { question: true } });
    const sheet = await fakeSheet(3);
    const submit = async (st: (typeof consented)[number], idx: number, when: Date) => {
      const pattern = PATTERNS[idx % 3]!;
      patternOf.set(st.code, idx % 3);
      const mcq: Record<string, string> = {};
      for (const ch of FIXTURE_CHAPTERS) {
        const right = split(ch, pattern[ch]!).mcq;
        items.filter((i) => i.question.type === "mcq" && i.question.chapter === ch).forEach((i, k) => (mcq[i.questionId] = k < right ? "B" : "C"));
      }
      await addSubmission({ studentId: st.id, paperId: p1.id, files: [{ name: "sheet.pdf", bytes: sheet }], mcq, source: st.manualPath ? "dm_manual" : "form", submittedAt: when });
    };
    for (let i = 0; i < 19; i++) await submit(consented[i]!, i, at(1, "Tue 19:00"));
    await weeklyTasks(at(1, "Wed 19:00"));
    expect((await missing(p1.id)).length).toBe(9);
    for (let i = 19; i < 23; i++) await submit(consented[i]!, i, at(1, "Thu 18:00"));
    expect(await epdb.submission.count({ where: { paperId: p1.id, isCurrent: true } })).toBe(23);
    expect((await missing(p1.id)).length).toBe(5);

    // 5. Filing: 23 correctly named files and 23 rows
    const subs = await epdb.submission.findMany({ where: { paperId: p1.id }, include: { student: true } });
    expect(subs).toHaveLength(23);
    for (const s of subs) {
      const f = (s.files as { path: string; name: string }[])[0]!;
      expect(f.path).toBe(`class-10/Maths/C10-MAT-P1-CBSE/10_${s.student.name.replace(/ /g, "-")}_MAT_C10-MAT-P1-CBSE.pdf`);
      expect(storage.exists(f.path)).toBe(true);
    }
    expect(subs.filter((s) => s.source === "dm_manual")).toHaveLength(3);

    // 6. MCQs auto-scored at filing; the (stubbed) AI proposes the written marks and flags about 6
    let n = 0;
    const marker: AiMarker = {
      async propose(r) {
        const ch = questionChapter.get(r.questionId)!;
        const got = split(ch, PATTERNS[patternOf.get(r.studentCode)!]![ch]!).written;
        n++;
        return { marks: got, confidence: n % 20 === 0 ? 0.4 : 0.95, reasoning: "test", errorTag: got < r.maxMarks ? "calculation" : "none", blank: false, unreadable: false };
      },
    };
    setAiMarker(marker);
    await setSettings({ "marking.aiEnabled": true });
    const prop = await proposeWithAi(p1.id);
    expect(prop.proposed).toBe(23 * 5);
    expect(prop.flagged).toBeGreaterThanOrEqual(4);
    expect(prop.flagged).toBeLessThanOrEqual(8);
    await expect(markPaperMarked(p1.id)).rejects.toThrow(/needs? review/);
    for (const m of await reviewQueue(p1.id)) await reviewMark(m.id, { action: "accept" });
    expect((await reviewQueue(p1.id)).length).toBe(0);

    // 7. Spot-check: 5 sheets; 2 are 3 marks too high; the teacher corrects them; mismatch rate reported
    const picks = await selectSpotCheck(p1.id, 7);
    expect(picks).toHaveLength(5);
    expect(await selectSpotCheck(p1.id, 99)).toHaveLength(5); // same sheets on a re-run
    for (const [i, sc] of picks.entries()) {
      const entered = await enteredTotal(sc.submissionId);
      const r = await recordSpotCheck(sc.id, i < 2 ? entered - 3 : entered);
      expect(r.result).toBe(i < 2 ? "mismatch" : "match");
      if (i < 2) {
        const trig = items.find((it) => it.question.chapter === "Trigonometry" && it.question.type === "long")!;
        const cur = await epdb.mark.findUniqueOrThrow({ where: { submissionId_questionId: { submissionId: sc.submissionId, questionId: trig.questionId } } });
        await setMark(sc.submissionId, trig.questionId, cur.marksAwarded - 3, "calculation", "Trigonometry marks corrected after the spot-check.");
      }
    }
    expect((await spotCheckSummary(p1.id)).mismatchRate).toBe(40);
    await markPaperMarked(p1.id);

    // 8. Sunday: 23 student + 23 parent reports; 14 parents emailed, 9 in the WhatsApp queue; re-run changes nothing
    const g = await generateReports(p1.id);
    expect(await epdb.reportCard.count({ where: { paperId: p1.id, audience: "student" } })).toBe(23);
    expect(await epdb.reportCard.count({ where: { paperId: p1.id, audience: "parent" } })).toBe(23);
    expect(g.created).toBe(46);
    await approveReports(p1.id);
    const sunday = at(1, "Sun 18:00");
    const d1 = await deliverReports(sunday);
    expect(d1.emailed).toBe(14);
    expect(stubOutbox.filter((m) => m.subject.includes("report"))).toHaveLength(14);
    expect(await epdb.message.count({ where: { templateKey: "parent_report", status: "drafted" } })).toBe(9);
    const again = await generateReports(p1.id);
    expect(again.created).toBe(0);
    const d2 = await deliverReports(sunday);
    expect(d2).toEqual({ emailed: 0, queued: 0 });
    expect(stubOutbox.filter((m) => m.subject.includes("report"))).toHaveLength(14);
    expect(await epdb.message.count({ where: { templateKey: "parent_report" } })).toBe(9);

    // 9. The class note names Quadratic Equations and Statistics
    const note = await classNote(p1.id);
    expect(note!.body).toContain("Quadratic Equations and Statistics");

    // 10. Two parent replies; no Offer yet (only one report exists)
    const parents = await epdb.parent.findMany({ take: 2, where: { consentAt: { not: null } } });
    for (const p of parents) await epdb.parentReply.create({ data: { parentId: p.id, paperId: p1.id, note: "Thank you" } });
    expect(await epdb.parentReply.count()).toBe(2);
    expect((await suggestOffers()).created).toBe(0);
    expect(await epdb.offer.count()).toBe(0);
  });
});
