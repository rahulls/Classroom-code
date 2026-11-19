import { describe, expect, it } from "vitest";
import { aiAgreement, offerDue, priceFor, programmeHealth, receiptNo, repeatRate, seededPick, spotCheckResult } from "../domain/commerce";
import {
  buildCalendar,
  checkPaper,
  groupingAdvice,
  lateness,
  mondayOf,
  paperId,
  reportFraming,
  sheetFileName,
  validSubjects,
  weekOf,
  weekTime,
} from "../domain/programme";
import { mostImproved, rankCohort, rankWithTies, stoppedAfterBottomThird, tellingList, tellingSentence, thirdOf } from "../domain/ranking";
import { band, chapterBreakdown, classAverageByChapter, errorBreakdown, repeatingGaps, roundPct, scoreMcq, strongest, totals, trend, weakest } from "../domain/scoring";
import { AARAV_QE_ERRORS, FIXTURE_A_CHAPTERS, fixtureAMarksFor, fixtureAQuestions } from "./fixtures/fixture-a";

const sheet = (s: string) => chapterBreakdown(fixtureAQuestions(), fixtureAMarksFor(s), FIXTURE_A_CHAPTERS);

describe("Fixture A: chapter analytics (Class 10 CBSE Maths, Paper 1)", () => {
  it("totals", () => {
    const t = (s: string) => totals(sheet(s));
    expect(t("Aarav")).toMatchObject({ got: 26, max: 40, pct: 65 });
    expect(t("Diya")).toMatchObject({ got: 27, max: 40, pct: 67.5 });
    expect(t("Kabir")).toMatchObject({ got: 17, max: 40, pct: 42.5 });
  });
  it("class average by chapter", () => {
    const avg = classAverageByChapter(["Aarav", "Diya", "Kabir"].map(sheet), FIXTURE_A_CHAPTERS);
    expect(avg.map((a) => [a.chapter, a.display])).toEqual([
      ["Real Numbers", 78],
      ["Polynomials", 61],
      ["Quadratic Equations", 50],
      ["Trigonometry", 60],
      ["Statistics", 50],
    ]);
  });
  it("Aarav's chapter percentages and bands", () => {
    const a = sheet("Aarav");
    expect(a.map((r) => r.display)).toEqual([83, 83, 40, 90, 38]);
    expect(a.map((r) => r.band)).toEqual(["Strong", "Strong", "Needs support", "Strong", "Needs support"]);
  });
  it("Diya's bands", () => {
    expect(sheet("Diya").map((r) => [r.band, r.display])).toEqual([
      ["Okay", 50],
      ["Okay", 67],
      ["Strong", 80],
      ["Okay", 50],
      ["Strong", 88],
    ]);
  });
  it("Kabir's bands", () => {
    expect(sheet("Kabir").map((r) => [r.band, r.display])).toEqual([
      ["Strong", 100],
      ["Needs support", 33],
      ["Needs support", 30],
      ["Needs support", 40],
      ["Needs support", 25],
    ]);
  });
  it("Aarav's weakest and strongest (ties broken by syllabus order)", () => {
    expect(weakest(sheet("Aarav")).map((r) => r.chapter)).toEqual(["Statistics", "Quadratic Equations"]);
    expect(strongest(sheet("Aarav")).map((r) => r.chapter)).toEqual(["Trigonometry", "Real Numbers"]);
  });
  it("Aarav's error tags in Quadratic Equations: 4 calculation, 2 missing steps", () => {
    expect(errorBreakdown(AARAV_QE_ERRORS, "Quadratic Equations")).toEqual({ calculation: 4, missing_steps: 2 });
  });
  it("cohort of 3 is ranked when the minimum is set to 3", () => {
    const r = rankCohort(["Aarav", "Diya", "Kabir"].map((s) => ({ id: s, pct: totals(sheet(s)).pct })), 3);
    expect(r.find((x) => x.id === "Diya")!.rank).toBe(1);
    expect(r.find((x) => x.id === "Kabir")!.rank).toBe(3);
  });
});

describe("Fixture B: ranking", () => {
  it("90, 85, 85, 70, 65, 40 rank 1, 2, 2, 4, 5, 6", () => {
    const r = rankCohort([90, 85, 85, 70, 65, 40].map((pct, i) => ({ id: `s${i}`, pct })), 5);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 2, 4, 5, 6]);
  });
  it("a cohort of 4 gets bands only", () => {
    const r = rankCohort([80, 60, 50, 30].map((pct, i) => ({ id: `s${i}`, pct })), 5);
    expect(r.every((x) => x.rank === null && !x.ranked)).toBe(true);
    expect(r.map((x) => x.band)).toEqual(["Top third", "Middle", "Middle", "Needs support"]);
  });
  it("a cohort of exactly 5 is ranked", () => {
    expect(rankCohort([5, 4, 3, 2, 1].map((pct, i) => ({ id: `s${i}`, pct })), 5).every((x) => x.ranked)).toBe(true);
  });
  it("no-consent student is out of the telling list but counted in the cohort", () => {
    const r = rankCohort([90, 85, 85, 70, 65, 40].map((pct, i) => ({ id: `s${i}`, pct })), 5);
    const rows = r.map((x) => ({ ...x, rankConsent: x.id !== "s1" }));
    expect(rows[0]!.cohortSize).toBe(6);
    expect(tellingList(rows).map((x) => x.id)).not.toContain("s1");
    expect(tellingList(rows)).toHaveLength(5);
  });
});

describe("scoring edge cases", () => {
  it("bands switch at exactly 75 and 50", () => {
    expect(band(75)).toBe("Strong");
    expect(band(74.99)).toBe("Okay");
    expect(band(50)).toBe("Okay");
    expect(band(49.99)).toBe("Needs support");
    expect(band(80, { strong: 80, okay: 60 })).toBe("Strong");
  });
  it("round half up for display", () => {
    expect(roundPct(37.5)).toBe(38);
    expect(roundPct(66.666)).toBe(67);
    expect(roundPct(83.333)).toBe(83);
  });
  it("zero-mark chapter, blank answers and a missing chapter", () => {
    const qs = [
      { id: "a", chapter: "X", marks: 4 },
      { id: "b", chapter: "Y", marks: 2 },
      { id: "c", chapter: "Unlisted", marks: 2 },
    ];
    const rows = chapterBreakdown(qs, { a: 0 }, ["Y", "X"]);
    expect(rows.map((r) => [r.chapter, r.got, r.pct])).toEqual([
      ["Y", 0, 0],
      ["X", 0, 0],
      ["Unlisted", 0, 0],
    ]);
  });
  it("marks are capped at the question's marks", () => {
    expect(chapterBreakdown([{ id: "a", chapter: "X", marks: 2 }], { a: 5 })[0]!.got).toBe(2);
  });
  it("MCQ totals equal a hand calculation", () => {
    const qs = [
      { id: "1", chapter: "A", marks: 1, type: "mcq", correctOption: "B" },
      { id: "2", chapter: "A", marks: 1, type: "mcq", correctOption: "C" },
      { id: "3", chapter: "B", marks: 2, type: "mcq", correctOption: "A" },
      { id: "4", chapter: "B", marks: 3, type: "short" },
    ];
    const s = scoreMcq(qs, { "1": "b", "2": "D", "3": "A" });
    expect(s.map((x) => x.marksAwarded)).toEqual([1, 0, 2]);
    expect(s.reduce((a, x) => a + x.marksAwarded, 0)).toBe(3);
  });
  it("trend needs two papers", () => {
    expect(trend([{ paperId: "p1", pct: 60 }])).toBeNull();
    expect(trend([{ paperId: "p1", pct: 60 }, { paperId: "p2", pct: 72 }])).toMatchObject({ change: 12, direction: "up" });
  });
  it("repeating gaps: same chapter below 50% in two papers", () => {
    const h = [
      { paperId: "p1", rows: [{ chapter: "QE", pct: 40 }, { chapter: "Stats", pct: 45 }] },
      { paperId: "p2", rows: [{ chapter: "QE", pct: 30 }, { chapter: "Stats", pct: 50 }] },
    ];
    expect(repeatingGaps(h)).toEqual(["QE"]);
  });
});

describe("ranking edge cases", () => {
  it("all tied", () => expect(rankWithTies([1, 1, 1].map((pct, i) => ({ id: `${i}`, pct }))).map((x) => x.rank)).toEqual([1, 1, 1]));
  it("thirds", () => {
    expect([1, 2, 3, 4, 5, 6].map((r) => thirdOf(r, 6))).toEqual(["Top third", "Top third", "Middle", "Middle", "Needs support", "Needs support"]);
  });
  it("telling sentence", () => {
    expect(tellingSentence({ rank: 6, size: 23, previousRank: 9, previousPaperNo: 2, weakChapter: "Quadratic Equations" })).toBe(
      "Rank 6 of 23, up 3 places since Paper 2; Quadratic Equations is the gap.",
    );
  });
  it("bottom third leads with progress and one fixable chapter", () => {
    const s = tellingSentence({ rank: 20, size: 23, previousRank: 22, previousPaperNo: 1, weakChapter: "Statistics" });
    expect(s.startsWith("Good progress: up 2 places since Paper 1")).toBe(true);
    expect(s).toContain("Statistics");
  });
  it("flags a student who stops after a bottom-third rank", () => {
    const papers = ["p1", "p2", "p3"];
    expect(stoppedAfterBottomThird(papers, { a: [{ paperId: "p1", band: "Needs support" }], b: [{ paperId: "p1", band: "Needs support" }, { paperId: "p2", band: "Middle" }] })).toEqual(["a"]);
  });
  it("most improved is by improvement, not rank", () => {
    expect(mostImproved({ a: [{ pct: 90 }, { pct: 92 }], b: [{ pct: 30 }, { pct: 55 }], c: [{ pct: 70 }, { pct: 60 }] }).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("programme rules", () => {
  it("paper ids and file names", () => {
    expect(paperId({ klass: 10, subject: "Maths", number: 1, board: "CBSE" })).toBe("C10-MAT-P1-CBSE");
    expect(paperId({ klass: 12, subject: "Chemistry", number: 3, board: "ICSE-ISC", version: 2 })).toBe("C12-CHE-P3-ICSE-v2");
    expect(sheetFileName({ klass: 10, name: "Aarav Shah", subject: "Maths", paperId: "C10-MAT-P1-CBSE" })).toBe("10_Aarav-Shah_MAT_C10-MAT-P1-CBSE.pdf");
  });
  it("Class 9 cannot take Physics", () => {
    expect(validSubjects(9, ["Physics"])).toBe(false);
    expect(validSubjects(11, ["Physics", "Maths"])).toBe(true);
    expect(validSubjects(10, [])).toBe(false);
  });
  it("12-week calendar follows the rotation and the launch order", () => {
    const cal = buildCalendar({ startDate: "2026-12-07", weeks: 12, boardsByClass: { 9: ["CBSE"], 10: ["CBSE"], 11: ["CBSE"], 12: ["CBSE"] } });
    const at = (w: number, k: number) => cal.find((s) => s.week === w && s.klass === k)?.subject;
    expect([at(1, 10), at(2, 10), at(3, 10), at(4, 10), at(5, 10)]).toEqual(["Maths", "Science", "Maths", "Science", "Maths"]);
    expect([at(1, 12), at(2, 12), at(3, 12), at(4, 12)]).toEqual(["Chemistry", "Maths", "Physics", "Chemistry"]);
    expect(at(1, 9)).toBeUndefined();
    expect(at(2, 11)).toBeUndefined();
    expect(at(3, 9)).toBe("Science");
    expect(at(3, 11)).toBe("Maths");
    expect(cal.filter((s) => s.klass === 10 && s.subject === "Maths").map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("Thursday 8 PM IST deadline, and a new start date shifts everything", () => {
    const a = buildCalendar({ startDate: "2026-12-07", weeks: 2, boardsByClass: { 10: ["CBSE"] } });
    expect(a[0]!.dueAt.toISOString()).toBe("2026-12-10T14:30:00.000Z");
    const b = buildCalendar({ startDate: "2026-12-14", weeks: 2, boardsByClass: { 10: ["CBSE"] } });
    expect(b[0]!.dueAt.getTime() - a[0]!.dueAt.getTime()).toBe(7 * 86_400_000);
    expect(mondayOf("2026-12-10")).toBe("2026-12-07");
    expect(weekOf("2026-12-07", weekTime("2026-12-07", 3, "Wed 10:00"))).toBe(3);
  });
  it("grouping advice thresholds", () => {
    expect([9, 8, 7, 3, 2].map((n) => groupingAdvice(n))).toEqual(["own", "own", "tagged", "tagged", "common"]);
  });
  it("late rule with 24h grace", () => {
    const due = new Date("2026-12-10T14:30:00Z");
    expect(lateness(new Date("2026-12-10T14:00:00Z"), due)).toEqual({ late: false, beyondGrace: false });
    expect(lateness(new Date("2026-12-11T10:00:00Z"), due)).toEqual({ late: true, beyondGrace: false });
    expect(lateness(new Date("2026-12-11T15:00:00Z"), due).beyondGrace).toBe(true);
  });
  it("paper checks: untagged question blocks publishing; share and chapter warnings", () => {
    const ok = { chapter: "A", topic: "t", difficulty: "easy", marks: 1, type: "mcq", correctOption: "A" };
    const r = checkPaper([ok, { ...ok, chapter: null }], ["A"]);
    expect(r.problems.length).toBeGreaterThan(0);
    const w = checkPaper([ok], ["A"]);
    expect(w.problems).toEqual([]);
    expect(w.warnings.join(" ")).toMatch(/MCQs are 100%/);
    expect(w.warnings.join(" ")).toMatch(/1 chapters covered/);
  });
  it("Class 9 wording never says exam readiness; low scores get kind framing", () => {
    for (const p of [10, 60, 95]) expect(JSON.stringify(reportFraming({ pct: p, klass: 9 }))).not.toMatch(/exam readiness/i);
    expect(reportFraming({ pct: 20, klass: 10 }).low).toBe(true);
    expect(reportFraming({ pct: 40, klass: 10 }).low).toBe(false);
  });
});

describe("commerce and quality", () => {
  it("family discount for 2+ subjects", () => {
    expect(priceFor({ base: 1000, subjects: 1, familyDiscountPct: 10 })).toEqual({ gross: 1000, discount: 0, net: 1000 });
    expect(priceFor({ base: 1000, subjects: 2, familyDiscountPct: 10 })).toEqual({ gross: 2000, discount: 200, net: 1800 });
  });
  it("receipt numbers", () => expect(receiptNo("RSC", 2026, 7)).toBe("RSC-2026-0007"));
  it("offer only after two reports and a repeating gap", () => {
    expect(offerDue(1, ["QE"])).toBe(false);
    expect(offerDue(2, [])).toBe(false);
    expect(offerDue(2, ["QE"])).toBe(true);
  });
  it("spot-check, AI agreement, repeat rate, health", () => {
    expect(spotCheckResult(30, 27)).toEqual({ delta: 3, result: "mismatch" });
    expect(aiAgreement([{ ai: 3, teacher: 4 }, { ai: 1, teacher: 4 }])).toBe(50);
    expect(repeatRate(["p1", "p2"], { a: new Set(["p1", "p2"]), b: new Set(["p1"]) })).toBe(50);
    expect(programmeHealth({ week: 6, stillSubmittingPct: 65, paidFamilies: 2 })).toBe("green");
    expect(seededPick([1, 2, 3, 4, 5, 6, 7, 8], 5, 42)).toHaveLength(5);
    expect(new Set(seededPick([1, 2, 3, 4, 5, 6, 7, 8], 5, 42)).size).toBe(5);
  });
});
