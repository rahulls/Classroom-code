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

describe("answer rows (uploaded papers)", async () => {
  const { parseAnswerRows, rowsTotal, checkRowMarks, sheetScore, rowsToCsv } = await import("../domain/answer-rows");
  it("parses labels like 1.1, 4.a, 36.iii.A with an optional header; OR choices count once", () => {
    const r = parseAnswerRows("answer,max,section,chapter,choice\n1.1,1,A,,\n4.a,2,B,Real Numbers,\n21.A,2,B,,21\n21.B,2,B,,21\n36.iii.A,2,E,,36.iii\n36.iii.B,2,E,,36.iii\n");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.label)).toEqual(["1.1", "4.a", "21.A", "21.B", "36.iii.A", "36.iii.B"]);
    expect(r.rows[1]).toEqual({ label: "4.a", max: 2, section: "B", chapter: "Real Numbers" });
    expect(rowsTotal(r.rows)).toBe(7);
    expect(parseAnswerRows(rowsToCsv(r.rows)).rows).toEqual(r.rows);
    expect(parseAnswerRows("1,1\n2,0.5").rows).toHaveLength(2);
  });
  it("reports every bad row and saves none", () => {
    const r = parseAnswerRows("1,1\n1,2\n2,abc\nx y,1\n3.A,2,,,3\n");
    expect(r.rows).toEqual([]);
    expect(r.errors.join(" | ")).toMatch(/Line 2: 1 appears twice.*Line 3.*Line 4.*Choice "3" has only one row/);
    expect(parseAnswerRows("5.A,2,,,5\n5.B,3,,,5").errors[0]).toMatch(/same marks/);
  });
  it("checks marks: range, halves, one alternative per choice; score and open count", () => {
    const { rows } = parseAnswerRows("1,1\n2.a,2\n3.A,3,,,3\n3.B,3,,,3");
    expect(() => checkRowMarks(rows, { "2.a": 3 })).toThrow(/between 0 and 2/);
    expect(() => checkRowMarks(rows, { "2.a": 1.25 })).toThrow(/half/);
    expect(() => checkRowMarks(rows, { "3.A": 2, "3.B": 1 })).toThrow(/alternatives/);
    expect(() => checkRowMarks(rows, { "9": 1 })).toThrow(/not an answer row/);
    expect(sheetScore(rows, [{ label: "1", marks: 1 }, { label: "3.B", marks: 2.5 }])).toEqual({ got: 3.5, max: 6, open: 1 });
  });
});

describe("paper details: chapter analysis", async () => {
  const { parseAnswerRows, chapterBreakdown, chapterWeights, rowsTotal, NO_CHAPTER } = await import("../domain/answer-rows");
  it("groups saved marks by chapter, weakest first, with where marks were lost; OR uses the attempted row", () => {
    const { rows } = parseAnswerRows("1,1,A,Real Numbers\n2,2,B,Polynomials\n3.A,3,C,Real Numbers,3\n3.B,3,C,Polynomials,3\n4,1,A,");
    const lines = chapterBreakdown(rows, [
      { label: "1", marks: 1 },
      { label: "2", marks: 1, errorTag: "calculation" },
      { label: "3.B", marks: 1, errorTag: "concept" },
      { label: "4", marks: 0 },
    ]);
    expect(lines.map((l) => [l.chapter, l.got, l.max])).toEqual([[NO_CHAPTER, 0, 1], ["Polynomials", 2, 5], ["Real Numbers", 1, 1]]);
    expect(lines[1]!.lostBy).toEqual({ calculation: 1, concept: 2 });
    expect(lines[0]!.lostBy).toEqual({ "not tagged": 1 });
    expect(Object.fromEntries(chapterWeights(rows))).toEqual({ "Real Numbers": 4, Polynomials: 2, [NO_CHAPTER]: 1 });
  });
  it("the practice paper 1 questions CSV gives the marking board: 53 rows, 80 marks, every answer has a chapter in the NCERT list", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { NCERT } = await import("../seed/chapters");
    const text = fs.readFileSync(path.resolve(__dirname, "../../../../design/sample-papers/cbse-class10-maths-practice-1.csv"), "utf8");
    const { rows, errors } = parseAnswerRows(text);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(53);
    expect(rowsTotal(rows)).toBe(80);
    expect(rows.filter((r) => r.choice).map((r) => r.label)).toEqual(["21.A", "21.B", "22.A", "22.B", "28.A", "28.B", "31.A", "31.B", "34.A", "34.B", "35.A", "35.B", "36.iii.A", "36.iii.B", "37.iii.A", "37.iii.B", "38.iii.A", "38.iii.B"]);
    expect(rows.filter((r) => r.label.startsWith("36")).map((r) => [r.label, r.max])).toEqual([["36.i", 1], ["36.ii", 1], ["36.iii.A", 2], ["36.iii.B", 2]]);
    expect(rows.filter((r) => r.section === "A")).toHaveLength(20);
    for (const r of rows) expect(NCERT["10|Maths"], r.label).toContain(r.chapter);
    const w = chapterWeights(rows);
    expect([...w.values()].reduce((a, b) => a + b, 0)).toBe(80);
  });
});

describe("optional Average band", async () => {
  const { band } = await import("../domain/scoring");
  it("100 Strong, 80 Okay, 60 Average, below Needs support; off when not set", () => {
    const c = { strong: 100, okay: 80, average: 60 };
    expect([100, 99, 80, 79, 60, 59.9].map((p) => band(p, c))).toEqual(["Strong", "Okay", "Okay", "Average", "Average", "Needs support"]);
    expect(band(60, { strong: 75, okay: 50 })).toBe("Okay");
    expect(band(40, { strong: 75, okay: 50, average: 0 })).toBe("Needs support");
  });
});

describe("report web chart", async () => {
  const { chapterRadar, shortChapter } = await import("../services/radar");
  it("needs at least 3 chapters", () => {
    expect(chapterRadar([{ chapter: "A", pct: 50, weak: true }, { chapter: "B", pct: 90, weak: false }], [60, 80])).toBeNull();
  });
  it("draws one point per chapter, dashed cut-off rings, weak chapters in red", () => {
    const svg = chapterRadar(
      [
        { chapter: "Real Numbers", pct: 50, weak: true },
        { chapter: "Quadratic Equations", pct: 100, weak: false },
        { chapter: "Surface Areas and Volumes", pct: 0, weak: true },
        { chapter: "Circles", pct: 86, weak: false },
      ],
      [60, 80],
    )!;
    expect(svg.match(/<circle /g)).toHaveLength(4);
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(2);
    expect(svg).toContain(">Real No.<");
    expect(svg).toContain(">Surface Area &amp; Vol.<");
    expect(svg.match(/fill="#b3261e" font-weight="700"/g)).toHaveLength(2);
  });
  it("shortens unknown long chapter names", () => {
    expect(shortChapter("Circles")).toBe("Circles");
    expect(shortChapter("A Very Long Chapter Name Here").endsWith("…")).toBe(true);
  });
});
