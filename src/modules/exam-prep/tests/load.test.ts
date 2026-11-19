// Load (spec section 8): 100 students, 4 papers, 400 submissions. The Sunday report job finishes in a few
// minutes and never double-sends.
import { beforeAll, describe, expect, it } from "vitest";
import { stubOutbox } from "../adapters/email";
import { epdb } from "../db";
import { addStudent, markVerified } from "../services/people";
import { addQuestion, createPaper, publishPaper, setChapterList } from "../services/papers";
import { seedTemplates } from "../services/messaging";
import { approveReports, deliverReports, generateReports } from "../services/reports";
import { addSubmission } from "../services/submissions";
import { FIXTURE_CHAPTERS, fakeSheet, resetDb, setSettings } from "./helpers";

describe("load: 100 students, 4 papers, 400 submissions", () => {
  const papers: string[] = [];
  beforeAll(async () => {
    await resetDb();
    stubOutbox.length = 0;
    await seedTemplates();
    await setChapterList(10, "Maths", "CBSE", FIXTURE_CHAPTERS);
    await setSettings({ "delivery.emailEnabled": true });
    const students = [];
    for (let i = 0; i < 100; i++) {
      const st = await addStudent({
        name: `Load Student ${i}`,
        klass: 10,
        board: "CBSE",
        subjects: ["Maths"],
        parentName: `Load Parent ${i}`,
        parentWhatsapp: `+9197${String(30000000 + i)}`,
        parentEmail: i % 2 ? `load${i}@example.invalid` : "",
        language: i % 7 ? "en" : "hi",
        consent: true,
        rankConsent: true,
        reportTiming: "same",
        source: "teacher",
        isDemo: true,
      });
      await markVerified(st.parents[0]!.id);
      students.push(st);
    }
    const sheet = await fakeSheet(2);
    for (let n = 1; n <= 4; n++) {
      const p = await createPaper({ klass: 10, subject: "Maths", board: "CBSE", number: n });
      const secs = await epdb.section.findMany({ where: { paperId: p.id } });
      const mcq = secs.find((s) => s.type === "mcq")!;
      const long = secs.find((s) => s.type === "long")!;
      for (const ch of FIXTURE_CHAPTERS.slice(0, 4)) {
        await addQuestion(p.id, mcq.id, { chapter: ch, topic: "t", marks: 1, type: "mcq", difficulty: "easy", text: `${ch} question?`, options: ["a", "b", "c", "d"], correctOption: "A", markingScheme: [] });
        await addQuestion(p.id, long.id, { chapter: ch, topic: "t", marks: 2, type: "long", difficulty: "medium", text: `${ch} problem.`, options: [], markingScheme: [{ step: "s", marks: 2 }] });
      }
      await publishPaper(p.id);
      papers.push(p.id);
      const items = await epdb.paperQuestion.findMany({ where: { paperId: p.id }, include: { question: true } });
      for (const [i, st] of students.entries()) {
        const mcqAns = Object.fromEntries(items.filter((x) => x.question.type === "mcq").map((x, k) => [x.questionId, (i + k + n) % 3 ? "A" : "B"]));
        const sub = await addSubmission({ studentId: st.id, paperId: p.id, files: [{ name: "s.pdf", bytes: sheet }], mcq: mcqAns, source: "form" });
        await epdb.mark.createMany({ data: items.filter((x) => x.question.type !== "mcq").map((x, k) => ({ submissionId: sub.id, questionId: x.questionId, marksAwarded: (i + k + n) % 3, source: "teacher", reviewedAt: new Date() })) });
      }
      await epdb.paper.update({ where: { id: p.id }, data: { status: "marked" } });
    }
  }, 900_000);

  it("the Sunday report job finishes in a few minutes and never double-sends", async () => {
    expect(await epdb.submission.count()).toBe(400);
    const t0 = Date.now();
    for (const id of papers) {
      await generateReports(id);
      await approveReports(id);
    }
    const first = await deliverReports(new Date());
    const secs = (Date.now() - t0) / 1000;
    console.log(`[load] 800 reports generated and delivered in ${secs.toFixed(1)} s`);
    expect(secs).toBeLessThan(300);
    expect(await epdb.reportCard.count()).toBe(800);
    expect(first.emailed).toBe(200); // 50 parents with email × 4 papers
    const second = await deliverReports(new Date());
    expect(second).toEqual({ emailed: 0, queued: 0 });
    expect(stubOutbox.filter((m) => m.subject.includes("report"))).toHaveLength(200); // (plus one "received" email per sheet at filing)
    const dupes = await epdb.message.groupBy({ by: ["dedupeKey"], _count: { _all: true }, having: { dedupeKey: { _count: { gt: 1 } } } });
    expect(dupes).toHaveLength(0);
  }, 900_000);
});
