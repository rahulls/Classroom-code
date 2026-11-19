import "server-only";
import { EpError } from "../errors";
import { audit } from "../audit";
import { epdb } from "../db";
import { buildCalendar, CLASSES, groupingAdvice, weekOf, weekTime, mondayOf, type Rotation } from "../domain/programme";
import { getSettings, type Settings } from "../settings";
import { draft, groupTag, renderTemplate } from "./messaging";

// R3: programme calendar, weekly tasks and drafts, reminders and the tracker. Every job here can run
// any number of times: tasks and messages carry unique dedupe keys.

/** Boards that get their own paper slot per class: groups at or above the tagged-PDF threshold. */
export async function boardsByClass(s?: Settings) {
  s ??= await getSettings();
  const rows = await epdb.student.groupBy({ by: ["klass", "board"], where: { status: { not: "opted_out" } }, _count: { _all: true } });
  const out: Record<number, string[]> = {};
  for (const k of CLASSES) {
    const groups = rows.filter((r) => r.klass === k);
    const own = groups.filter((g) => groupingAdvice(g._count._all, { own: s["cohort.ownPaper"], tagged: s["cohort.taggedPdf"] }) !== "common").map((g) => g.board);
    // Small boards take the common-concept paper (CBSE's) instead of their own
    out[k] = own.length ? own : groups.length ? ["CBSE"] : [];
  }
  return out;
}

/**
 * Builds (or rebuilds after a settings change) the calendar slots. Slots keep any paper already
 * attached; changing the start date shifts every slot's dates.
 */
export async function generateCalendar() {
  const s = await getSettings();
  const start = s["programme.startDate"];
  if (!start) throw new EpError("Set the programme start date in settings first.");
  const slots = buildCalendar({
    startDate: start,
    weeks: s["programme.weeks"],
    rotation: Object.fromEntries(Object.entries(s["programme.rotation"]).map(([w, r]) => [Number(w), Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v]))])) as Rotation,
    launch: s["programme.launch"],
    times: s["programme.times"],
    boardsByClass: await boardsByClass(s),
  });
  const keep = new Set<string>();
  for (const sl of slots) {
    const k = { week: sl.week, klass: sl.klass, subject: sl.subject, board: sl.board };
    keep.add(`${sl.week}|${sl.klass}|${sl.subject}|${sl.board}`);
    await epdb.slot.upsert({ where: { week_klass_subject_board: k }, create: { ...k, opensAt: sl.opensAt, dueAt: sl.dueAt }, update: { opensAt: sl.opensAt, dueAt: sl.dueAt } });
    // Keep an attached paper's dates in step
    const slot = await epdb.slot.findUnique({ where: { week_klass_subject_board: k } });
    if (slot?.paperId) await epdb.paper.updateMany({ where: { id: slot.paperId, status: { in: ["draft", "published"] } }, data: { opensAt: sl.opensAt, dueAt: sl.dueAt } });
  }
  const stale = (await epdb.slot.findMany()).filter((x) => !keep.has(`${x.week}|${x.klass}|${x.subject}|${x.board}`) && !x.paperId);
  if (stale.length) await epdb.slot.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } });
  return slots.length;
}

export async function attachPaper(slotId: string, paperId: string) {
  const slot = await epdb.slot.findUniqueOrThrow({ where: { id: slotId } });
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  if (p.klass !== slot.klass || p.subject !== slot.subject) throw new EpError("That paper is for a different class or subject.");
  await epdb.slot.update({ where: { id: slotId }, data: { paperId } });
  await epdb.paper.update({ where: { id: paperId }, data: { opensAt: slot.opensAt, dueAt: slot.dueAt } });
  await audit({ action: "slot.paper_attached", entity: "Slot", entityId: slotId, new: { paperId } });
}

/** Students expected to sit a paper: same class, board group and subject, not opted out. */
export async function roster(paperId: string) {
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  const s = await getSettings();
  const boards = (await boardsByClass(s))[p.klass] ?? [];
  // A common-concept (CBSE) paper also covers students whose board is too small for its own paper
  const where = p.board === "CBSE" ? { OR: [{ board: "CBSE" }, { board: { notIn: boards } }] } : { board: p.board };
  return epdb.student.findMany({ where: { klass: p.klass, subjects: { has: p.subject }, status: { not: "opted_out" }, ...where }, include: { parents: true }, orderBy: { code: "asc" } });
}

/** Missing = roster minus current submissions (always). */
export async function missing(paperId: string) {
  const [r, subs] = await Promise.all([roster(paperId), epdb.submission.findMany({ where: { paperId, isCurrent: true }, select: { studentId: true } })]);
  const done = new Set(subs.map((x) => x.studentId));
  return r.filter((st) => !done.has(st.id));
}

/** The private reminder: at most one per student per paper. */
export async function draftPrivateReminder(studentId: string, paperId: string) {
  const st = await epdb.student.findUniqueOrThrow({ where: { id: studentId }, include: { parents: true } });
  const p = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  const s = await getSettings();
  const to = st.parents.find((x) => !x.optedOutAt && x.numberVerifiedAt) ?? st.parents.find((x) => !x.optedOutAt);
  const body = await renderTemplate("private_reminder", {
    student: st.name.split(" ")[0],
    subject: p.subject,
    paper: p.id,
    deadline: p.dueAt ? p.dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit" }) : "soon",
    formLink: s["brand.formLinks"][String(p.klass)] ?? "",
  });
  return draft({ dedupeKey: `reminder:${studentId}:${p.baseId}`, templateKey: "private_reminder", audience: "student", body, studentId, parentId: to?.id, paperId, to: to?.whatsapp });
}

async function task(t: { dedupeKey: string; week: number; kind: string; title: string; dueAt: Date; paperId?: string | null; messageId?: string | null }) {
  return epdb.task.upsert({ where: { dedupeKey: t.dedupeKey }, create: { ...t, paperId: t.paperId ?? undefined, messageId: t.messageId ?? undefined }, update: {} });
}

const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

/**
 * The weekly job: for the programme week containing `now`, creates the teacher's tasks with due times
 * and the drafts (tagged group post, Wednesday reminder, Thursday private reminders, key post,
 * Saturday review, Sunday reports and class note). Safe to run repeatedly.
 */
export async function weeklyTasks(now = new Date()) {
  const s = await getSettings();
  const start = s["programme.startDate"];
  if (!start) return { week: 0, tasks: 0 };
  const week = weekOf(start, now);
  if (week < 1 || week > s["programme.weeks"]) return { week, tasks: 0 };
  const monday = mondayOf(start);
  const t = s["programme.times"];
  const at = (x: string) => weekTime(monday, week, x);
  let n = 0;
  const slots = await epdb.slot.findMany({ where: { week }, orderBy: [{ klass: "asc" }, { board: "asc" }] });
  // Pinned weekly calendar
  const links = Object.entries(s["brand.formLinks"])
    .map(([k, v]) => `Class ${k}: ${v}`)
    .join("\n");
  const cal = await draft({ dedupeKey: `calendar:w${week}`, templateKey: "weekly_calendar", audience: "group", tags: ["All classes", `Week ${week}`], body: await renderTemplate("weekly_calendar", { week, deadline: t.deadline, formLinks: links }) });
  await task({ dedupeKey: `w${week}:calendar`, week, kind: "post", title: `Post and pin the week ${week} calendar`, dueAt: at(t.post), messageId: cal?.id });
  n++;
  for (const sl of slots) {
    const paper = sl.paperId ? await epdb.paper.findUnique({ where: { id: sl.paperId }, include: { items: { include: { question: true } } } }) : null;
    const label = `Class ${sl.klass} ${sl.board} ${sl.subject}`;
    const k = `w${week}:${sl.klass}:${sl.board}:${sl.subject}`;
    if (!paper) {
      await task({ dedupeKey: `${k}:attach`, week, kind: "prepare", title: `${label}: attach and publish this week's paper`, dueAt: at(t.post) });
      n++;
      continue;
    }
    const tag = groupTag({ klass: sl.klass, board: sl.board, subject: sl.subject, number: paper.number });
    const vars = { tag, title: paper.title, class: `Class ${sl.klass}`, board: sl.board, subject: sl.subject, marks: paper.items.reduce((a, i) => a + i.question.marks, 0), deadline: when(paper.dueAt), formLink: s["brand.formLinks"][String(sl.klass)] ?? "" };
    const post = await draft({ dedupeKey: `post:${paper.baseId}`, templateKey: "paper_post", audience: "group", tags: [tag], paperId: paper.id, body: await renderTemplate("paper_post", vars) });
    await task({ dedupeKey: `${k}:post`, week, kind: "post", title: `${label}: post ${paper.id} in the group${paper.status === "draft" ? " (publish it first)" : ""}`, dueAt: at(t.post), paperId: paper.id, messageId: post?.id });
    const rem = await draft({ dedupeKey: `wed:${paper.baseId}`, templateKey: "wed_reminder", audience: "group", tags: [tag], paperId: paper.id, body: await renderTemplate("wed_reminder", vars) });
    await task({ dedupeKey: `${k}:wed`, week, kind: "reminder", title: `${label}: Wednesday reminder`, dueAt: at(t.reminder), paperId: paper.id, messageId: rem?.id });
    await task({ dedupeKey: `${k}:thu`, week, kind: "private_reminders", title: `${label}: private reminders to students who haven't submitted`, dueAt: at(t.deadline), paperId: paper.id });
    const key = await draft({ dedupeKey: `key:${paper.baseId}`, templateKey: "key_post", audience: "group", tags: [tag], paperId: paper.id, body: await renderTemplate("key_post", vars) });
    await task({ dedupeKey: `${k}:key`, week, kind: "key", title: `${label}: post the answer key; AI draft marks`, dueAt: at(t.key), paperId: paper.id, messageId: key?.id });
    await task({ dedupeKey: `${k}:review`, week, kind: "review", title: `${label}: review needs-review marks and the spot-check`, dueAt: at(t.review), paperId: paper.id });
    await task({ dedupeKey: `${k}:reports`, week, kind: "reports", title: `${label}: approve reports, send the class note, tell ranks`, dueAt: at(t.reports), paperId: paper.id });
    n += 6;
  }
  // Thursday: drafts for the students still missing (after the reminder time)
  // (only students whose intake is complete: nothing is sent to the roll before consent)
  if (now >= at(t.reminder))
    for (const sl of slots) if (sl.paperId) for (const st of await missing(sl.paperId)) if (st.parents.some((p) => p.consentAt && !p.optedOutAt)) await draftPrivateReminder(st.id, sl.paperId);
  return { week, tasks: n };
}

export async function completeTask(id: string) {
  await epdb.task.update({ where: { id }, data: { doneAt: new Date() } });
}

/** Tracker: per paper, submitted vs missing with the reminder state. */
export async function tracker(paperId: string) {
  const [r, subs, reminders] = await Promise.all([
    roster(paperId),
    epdb.submission.findMany({ where: { paperId, isCurrent: true } }),
    epdb.message.findMany({ where: { templateKey: "private_reminder", paperId } }),
  ]);
  const byStudent = new Map(subs.map((x) => [x.studentId, x]));
  const reminded = new Set(reminders.map((m) => m.studentId));
  return r.map((st) => ({ student: st, submission: byStudent.get(st.id) ?? null, reminded: reminded.has(st.id) }));
}
