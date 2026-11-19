import "server-only";
import { EpError } from "../errors";
import { audit } from "../audit";
import { epdb } from "../db";
import { programmeHealth, rate, repeatRate } from "../domain/commerce";
import { weekOf } from "../domain/programme";
import { getSettings } from "../settings";
import { calibration, spotCheckSummary } from "./marking";

// R12 metrics dashboard and R13 feedback. Teacher-only.

// ------------------------------ feedback (R13) ------------------------------

export async function recordFeedback(o: { studentId: string; paperId: string; difficulty: "too_easy" | "right" | "too_hard"; nextChapterRequest?: string; rating?: number }) {
  if (o.rating != null && (o.rating < 1 || o.rating > 5)) throw new EpError("Rating is 1 to 5.");
  const existing = await epdb.feedback.findUnique({ where: { studentId_paperId: { studentId: o.studentId, paperId: o.paperId } } });
  if (existing) throw new EpError("This student already gave feedback for this paper.");
  return epdb.feedback.create({ data: o });
}

/** Aggregates by paper (live): difficulty split, chapter requests, average rating. */
export async function feedbackSummary(paperId?: string) {
  const rows = await epdb.feedback.findMany({ where: paperId ? { paperId } : {} });
  const by = (d: string) => rows.filter((r) => r.difficulty === d).length;
  const rated = rows.filter((r) => r.rating != null);
  const chapters: Record<string, number> = {};
  for (const r of rows) if (r.nextChapterRequest) chapters[r.nextChapterRequest] = (chapters[r.nextChapterRequest] ?? 0) + 1;
  return {
    responses: rows.length,
    tooEasy: by("too_easy"),
    right: by("right"),
    tooHard: by("too_hard"),
    avgRating: rated.length ? rated.reduce((a, r) => a + r.rating!, 0) / rated.length : null,
    chapterRequests: Object.entries(chapters).sort((a, b) => b[1] - a[1]),
  };
}

export async function feedbackByGroup() {
  const rows = await epdb.feedback.findMany({ include: { student: true } });
  const groups = new Map<string, { n: number; ratingSum: number; rated: number; tooHard: number }>();
  for (const r of rows) {
    const k = `${r.paperId}|Class ${r.student.klass}|${r.student.board}`;
    const g = groups.get(k) ?? { n: 0, ratingSum: 0, rated: 0, tooHard: 0 };
    g.n++;
    if (r.rating != null) {
      g.ratingSum += r.rating;
      g.rated++;
    }
    if (r.difficulty === "too_hard") g.tooHard++;
    groups.set(k, g);
  }
  return [...groups.entries()].map(([k, g]) => {
    const [paperId, klass, board] = k.split("|");
    return { paperId, klass, board, responses: g.n, avgRating: g.rated ? g.ratingSum / g.rated : null, tooHardPct: (100 * g.tooHard) / g.n };
  });
}

// ------------------------------ metrics (R12) ------------------------------

export async function metrics(now = new Date()) {
  const s = await getSettings();
  const students = await epdb.student.findMany({ where: { isDemo: false }, include: { parents: true } });
  const active = students.filter((x) => x.status !== "opted_out");
  // Intake completion: intake forms / students in the group, within 48 hours (forms counted from the group count date)
  const intake = rate(students.length, s["group.memberCount"]);
  // Submission rate on the latest paper with a deadline passed (and by Paper 3)
  const papers = await epdb.paper.findMany({ where: { kind: "paper", number: { gt: 0 }, isCurrent: true, status: { not: "draft" } }, orderBy: { number: "asc" }, include: { submissions: { where: { isCurrent: true } } } });
  const { roster } = await import("./calendar");
  let rolls = 0;
  let sheets = 0;
  let rollsP3 = 0;
  let sheetsP3 = 0;
  for (const p of papers) {
    const r = (await roster(p.id)).length;
    rolls += r;
    sheets += p.submissions.length;
    if (p.number === 3) {
      rollsP3 += r;
      sheetsP3 += p.submissions.length;
    }
  }
  // Repeat: students who submitted two papers in a row (per class/subject/board track)
  const tracks = new Map<string, string[]>();
  for (const p of papers) tracks.set(`${p.klass}|${p.subject}|${p.board}`, [...(tracks.get(`${p.klass}|${p.subject}|${p.board}`) ?? []), p.id]);
  const submitted: Record<string, Set<string>> = {};
  for (const p of papers) for (const sub of p.submissions) (submitted[sub.studentId] ??= new Set()).add(p.id);
  let repNum = 0;
  let repDen = 0;
  for (const ids of tracks.values()) {
    const inTrack = Object.fromEntries(Object.entries(submitted).filter(([, set]) => ids.some((i) => set.has(i))));
    const r = repeatRate(ids, inTrack);
    if (r != null) {
      repNum += (r * Object.keys(inTrack).length) / 100;
      repDen += Object.keys(inTrack).length;
    }
  }
  const spot = await spotCheckSummary();
  const cal = await calibration();
  // Report reply rate: parents who replied / parents sent a report
  const sentParents = new Set((await epdb.reportCard.findMany({ where: { audience: "parent", status: "sent" }, select: { parentId: true } })).map((r) => r.parentId));
  const replied = new Set((await epdb.parentReply.findMany({ select: { parentId: true } })).map((r) => r.parentId));
  const replyRate = rate([...sentParents].filter((p) => p && replied.has(p)).length, sentParents.size);
  // Paid conversion: paid families / families who received 2 reports
  const twoReports = (await epdb.reportCard.groupBy({ by: ["studentId"], where: { audience: "parent", status: "sent" }, _count: { _all: true } })).filter((g) => g._count._all >= 2).map((g) => g.studentId);
  const paidStudents = active.filter((x) => x.status === "paid1" || x.status === "paid2");
  const paidConv = rate(paidStudents.filter((x) => twoReports.includes(x.id)).length, twoReports.length);
  // Improvement Paper 1 → Paper 4 for repeat students
  const p1 = papers.filter((p) => p.number === 1);
  const p4 = papers.filter((p) => p.number === 4);
  const scoreOf = async (paperId: string, studentId: string) => {
    const sub = await epdb.submission.findFirst({ where: { paperId, studentId, isCurrent: true }, include: { marks: true, paper: { include: { items: { include: { question: true } } } } } });
    if (!sub || !sub.marks.length) return null;
    const max = sub.paper.items.reduce((a, i) => a + i.question.marks, 0);
    return (100 * sub.marks.reduce((a, m) => a + m.marksAwarded, 0)) / max;
  };
  const deltas: number[] = [];
  for (const a of p1)
    for (const b of p4.filter((x) => x.klass === a.klass && x.subject === a.subject && x.board === a.board))
      for (const sub of a.submissions) {
        const x = await scoreOf(a.id, sub.studentId);
        const y = await scoreOf(b.id, sub.studentId);
        if (x != null && y != null) deltas.push(y - x);
      }
  const fb = await feedbackSummary();
  const optOuts = students.filter((x) => x.status === "opted_out").length + (await epdb.parent.count({ where: { optedOutAt: { not: null }, student: { status: { not: "opted_out" } } } }));
  const complaints = await epdb.complaint.count();
  const week = s["programme.startDate"] ? weekOf(s["programme.startDate"], now) : 0;
  const last = papers.filter((p) => p.dueAt && p.dueAt < now).slice(-4);
  const stillSubmitting = rate(new Set(last.flatMap((p) => p.submissions.map((x) => x.studentId))).size, active.length);
  return {
    week,
    rows: [
      { key: "intake", label: "Intake completion", value: intake, target: `${s["targets.intake"]}% or more`, ok: intake == null ? null : intake >= s["targets.intake"] },
      { key: "submission", label: "Submission rate", value: rate(sheets, rolls), detail: rollsP3 ? `Paper 3: ${Math.round(rate(sheetsP3, rollsP3)!)}%` : undefined, target: `${s["targets.submission"]}% or more by Paper 3`, ok: rollsP3 ? rate(sheetsP3, rollsP3)! >= s["targets.submission"] : null },
      { key: "repeat", label: "Repeat rate", value: rate(repNum, repDen), target: `${s["targets.repeat"]}% or more`, ok: repDen ? rate(repNum, repDen)! >= s["targets.repeat"] : null },
      { key: "accuracy", label: "Marks accuracy", value: spot.accuracy, target: `${s["targets.accuracy"]}% or more`, ok: spot.accuracy == null ? null : spot.accuracy >= s["targets.accuracy"] },
      { key: "ai", label: "AI agreement", value: cal.agreement, target: `${s["targets.ai"]}% or more before AI marking is paid for`, ok: cal.agreement == null ? null : cal.agreement >= s["targets.ai"] },
      { key: "reply", label: "Report reply rate", value: replyRate, target: `${s["targets.reply"]}% or more`, ok: replyRate == null ? null : replyRate >= s["targets.reply"] },
      { key: "paid", label: "Paid conversion", value: paidConv, target: `${s["targets.paid"].min}-${s["targets.paid"].max}%`, ok: paidConv == null ? null : paidConv >= s["targets.paid"].min },
      { key: "improvement", label: "Improvement (Paper 1 → 4)", value: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null, unit: "pts", target: "Upward", ok: deltas.length ? deltas.reduce((a, b) => a + b, 0) > 0 : null },
      { key: "satisfaction", label: "Satisfaction", value: fb.avgRating, unit: "/5", target: `${s["targets.satisfaction"]} out of 5 or more`, ok: fb.avgRating == null ? null : fb.avgRating >= s["targets.satisfaction"] },
      { key: "optouts", label: "Opt-outs and complaints", value: optOuts + complaints, unit: "", target: "Near zero; each reviewed", ok: optOuts + complaints === 0 },
    ],
    health: programmeHealth({ week, stillSubmittingPct: stillSubmitting, paidFamilies: paidStudents.length, minPct: s["targets.health"].pct, minPaid: s["targets.health"].paid }),
    stillSubmitting,
  };
}

/** Weekly workload (hours) against the plan. */
export async function logHours(weekStart: string, hours: number, note?: string) {
  if (hours < 0 || hours > 100) throw new EpError("Hours must be 0-100.");
  const d = new Date(`${weekStart}T00:00:00Z`);
  const old = await epdb.workloadEntry.findUnique({ where: { weekStart: d } });
  await epdb.workloadEntry.upsert({ where: { weekStart: d }, create: { weekStart: d, hours, note }, update: { hours, note } });
  await audit({ action: "workload.logged", entity: "WorkloadEntry", entityId: weekStart, old: old ? { hours: old.hours } : null, new: { hours } });
}

export const SUNDAY_CHECKLIST = [
  "All needs-review marks resolved; spot-check recorded",
  "Reports generated, checked and approved",
  "Emails sent; WhatsApp report queue cleared",
  "Class notes posted (weakest chapters only)",
  "Ranks told to consenting students",
  "Opt-outs, replies and complaints handled",
  "Next week's papers attached and published",
  "Hours logged for the week",
];
