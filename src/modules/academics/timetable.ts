import "server-only";
import { db } from "@/core/db";
import { effectiveDuration, getSetting } from "./service";
import { addDays, dateToYmd, dayShort, fmtDate, fmtRange, overlapsDates, overlapsTime, weekdayOf, ymdToDate } from "./time";

export type SlotCandidate = {
  batchId: string;
  weekday: number;
  startMin: number;
  durationMin: number;
  room: string | null;
  mode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type Clashes = {
  /** Same batch already has a class then: always blocking. */
  batch: string[];
  /** Same physical room booked by another batch. */
  room: string[];
  /** Students in this batch who'd also be in another batch's class then. */
  students: { count: number; examples: string[] };
};

const label = (s: { weekday: number; startMin: number; durationMin: number }) => `${dayShort(s.weekday)} ${fmtRange(s.startMin, s.durationMin)}`;

type Booked = { batchId: string; batchName: string; subjectName: string; startMin: number; durationMin: number; room: string | null; mode: string; when: string };

/** Turns classes that overlap the candidate in time into batch / room / student clashes. */
async function clashesFrom(c: { batchId: string; room: string | null; mode: string }, overlapping: Booked[]): Promise<Clashes> {
  const batch = overlapping.filter((s) => s.batchId === c.batchId).map((s) => `${s.subjectName} ${s.when}`);

  const physical = c.mode !== "online" && c.room;
  const room = physical
    ? overlapping
        .filter((s) => s.batchId !== c.batchId && s.mode !== "online" && s.room?.trim().toLowerCase() === c.room!.trim().toLowerCase())
        .map((s) => `${s.room} is used by ${s.batchName} (${s.subjectName}) ${s.when}`)
    : [];

  // Students of this batch who are also actively enrolled in a batch that has an overlapping class
  const otherBatchIds = [...new Set(overlapping.filter((s) => s.batchId !== c.batchId).map((s) => s.batchId))];
  let students: Clashes["students"] = { count: 0, examples: [] };
  if (otherBatchIds.length) {
    const shared = await db.enrollment.findMany({
      where: { batchId: { in: otherBatchIds }, status: "ACTIVE", student: { archivedAt: null, enrollments: { some: { batchId: c.batchId, status: "ACTIVE" } } } },
      select: { student: { select: { id: true, firstName: true, lastName: true } }, batch: { select: { name: true } } },
    });
    const unique = new Map(shared.map((e) => [e.student.id, `${e.student.firstName} ${e.student.lastName}`.trim() + ` (also in ${e.batch.name})`]));
    students = { count: unique.size, examples: [...unique.values()].slice(0, 5) };
  }
  return { batch, room, students };
}

/** Clashes for a weekly slot against other weekly slots on the same weekday. */
export async function findClashes(c: SlotCandidate, excludeSlotId?: string): Promise<Clashes> {
  const sameDay = await db.timetableSlot.findMany({
    where: { weekday: c.weekday, ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}), batch: { archivedAt: null } },
    include: { batchSubject: { include: { subject: { select: { name: true } } } }, batch: { select: { id: true, name: true } } },
  });
  const overlapping = sameDay.filter(
    (s) => overlapsTime(c.startMin, c.durationMin, s.startMin, s.durationMin) && overlapsDates(c.effectiveFrom, c.effectiveTo, s.effectiveFrom, s.effectiveTo),
  );
  return clashesFrom(
    c,
    overlapping.map((s) => ({ batchId: s.batchId, batchName: s.batch.name, subjectName: s.batchSubject.subject.name, startMin: s.startMin, durationMin: s.durationMin, room: s.room, mode: s.mode, when: label(s) })),
  );
}

/** Clashes for a single dated class against everything that actually happens that day. */
export async function findDateClashes(
  c: { batchId: string; date: string; startMin: number; durationMin: number; room: string | null; mode: string },
  exclude: { slotId?: string | null; slotDate?: string | null; changeId?: string | null } = {},
): Promise<Clashes> {
  const { occurrences } = await getOccurrences({}, c.date, c.date);
  const overlapping = occurrences.filter(
    (o) =>
      o.kind !== "cancelled" &&
      !(exclude.changeId && o.changeId === exclude.changeId) &&
      !(exclude.slotId && o.slotId === exclude.slotId && o.slotDate === exclude.slotDate) &&
      overlapsTime(c.startMin, c.durationMin, o.startMin, o.durationMin),
  );
  return clashesFrom(
    c,
    overlapping.map((o) => ({ ...o, when: `${fmtDate(o.date)} ${fmtRange(o.startMin, o.durationMin)}` })),
  );
}

export async function getBatchSlots(batchId: string) {
  return db.timetableSlot.findMany({
    where: { batchId },
    include: { batchSubject: { include: { subject: true } } },
    orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
  });
}

// ─────────────── Batch labels ───────────────

/** "class 10 · mathematics": the top program plus the batch, so same-named batches can be told apart. */
export const classBatchLabel = (lineage: string[]) => (lineage.length > 1 ? `${lineage[0]} · ${lineage[lineage.length - 1]}` : (lineage[0] ?? ""));

// A batch and up to four levels above it (program › course › … › batch)
const batchWithParents = {
  name: true,
  parent: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } } } },
} as const;
type NamedNode = { name: string; parent?: NamedNode | null };
const lineageNames = (n: NamedNode) => {
  const names: string[] = [];
  for (let c: NamedNode | null | undefined = n; c; c = c.parent) names.unshift(c.name);
  return names;
};

/** Label for one batch, e.g. for notifications. */
export async function batchClassLabel(client: Pick<typeof db, "programNode">, batchId: string) {
  const b = await client.programNode.findUnique({ where: { id: batchId }, select: batchWithParents });
  return b ? classBatchLabel(lineageNames(b)) : "";
}

// ─────────────── Data for the interactive timetable editor ───────────────

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

type SlotRow = Awaited<ReturnType<typeof getBatchSlots>>[number] & { batch?: { name: string } };

export function toEditorSlots(rows: SlotRow[], batchLabel: (batchId: string) => string, warnIds: Set<string> = new Set()) {
  return rows.map((s) => ({
    id: s.id,
    batchId: s.batchId,
    batchLabel: batchLabel(s.batchId),
    batchSubjectId: s.batchSubjectId,
    subjectName: s.batchSubject.subject.name,
    subjectCode: s.batchSubject.subject.code,
    color: s.batchSubject.subject.color,
    weekday: s.weekday,
    startMin: s.startMin,
    durationMin: s.durationMin,
    room: s.room,
    mode: s.mode,
    meetingUrl: s.meetingUrl,
    effectiveFrom: ymd(s.effectiveFrom)!,
    effectiveTo: ymd(s.effectiveTo),
    notes: s.notes,
    warn: warnIds.has(s.id),
  }));
}

/** Every live batch of a year with its subjects and their effective class length. */
export async function getSchedulingBatches(yearId: string) {
  const [nodes, orgDefault] = await Promise.all([
    db.programNode.findMany({
      where: { yearId, archivedAt: null },
      include: { nodeType: true, batchSubjects: { include: { subject: true }, orderBy: { subject: { name: "asc" } } } },
    }),
    getSetting<number>("schedule.defaultDurationMin", 60),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lineageOf = (id: string) => {
    const chain: typeof nodes = [];
    for (let n = byId.get(id), g = 0; n && g < 20; n = n.parentId ? byId.get(n.parentId) : undefined, g++) chain.unshift(n);
    return chain;
  };
  return nodes
    .filter((n) => n.nodeType.enrollable)
    .map((n) => {
      const lineage = lineageOf(n.id);
      const attrs = n.attributes as { room?: string; mode?: string };
      return {
        id: n.id,
        label: lineage.map((l) => l.name).join(" › "),
        shortLabel: classBatchLabel(lineage.map((l) => l.name)),
        room: attrs.room ?? "",
        mode: attrs.mode ?? "offline",
        subjects: n.batchSubjects.map((bs) => {
          const d = effectiveDuration({ batchSubjectMin: bs.defaultDurationMin, lineage, subjectMin: bs.subject.defaultDurationMin, orgDefault });
          return { batchSubjectId: bs.id, label: `${bs.subject.name} (${bs.subject.code})`, durationMin: d.minutes, source: d.source };
        }),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ─────────────── Dated calendar: weekly pattern + one-date changes ───────────────

export type Occurrence = {
  /** Stable key: "<slotId>:<date>" for a weekly class, the change id otherwise. */
  key: string;
  date: string;
  /** weekly = usual class · extra = one-time class · moved = this date rescheduled · cancelled = not happening */
  kind: "weekly" | "extra" | "moved" | "cancelled";
  slotId: string | null;
  slotDate: string | null;
  changeId: string | null;
  batchId: string;
  /** "class 10 · mathematics" */
  batchName: string;
  batchSubjectId: string;
  subjectName: string;
  subjectCode: string;
  color: string | null;
  startMin: number;
  durationMin: number;
  room: string | null;
  mode: string;
  meetingUrl: string | null;
  notes: string | null;
  /** An extra class that makes up for a cancelled one */
  makeup?: boolean;
};

const occInclude = { batchSubject: { include: { subject: true } }, batch: { select: batchWithParents } } as const;

/**
 * Every class that happens (or was cancelled) between two dates, inclusive.
 * Scope: one batch, one year's live batches, or (empty) every live batch.
 */
export async function getOccurrences(scope: { batchId?: string; yearId?: string }, from: string, to: string) {
  const batch = scope.batchId ? { id: scope.batchId } : { archivedAt: null, ...(scope.yearId ? { yearId: scope.yearId } : {}) };
  const fromD = ymdToDate(from);
  const toD = ymdToDate(to);
  const [slots, changes] = await Promise.all([
    db.timetableSlot.findMany({
      where: { batch, effectiveFrom: { lte: toD }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromD } }] },
      include: occInclude,
      orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
    }),
    db.classDateChange.findMany({
      where: { batch, OR: [{ date: { gte: fromD, lte: toD } }, { slotDate: { gte: fromD, lte: toD } }] },
      include: occInclude,
    }),
  ]);

  const bySlotDate = new Map(changes.filter((c) => c.slotId && c.slotDate).map((c) => [`${c.slotId}:${dateToYmd(c.slotDate!)}`, c]));
  const occurrences: Occurrence[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    for (const s of slots) {
      if (s.weekday !== wd || dateToYmd(s.effectiveFrom) > d || (s.effectiveTo && dateToYmd(s.effectiveTo) < d)) continue;
      const key = `${s.id}:${d}`;
      const change = bySlotDate.get(key);
      if (change && change.kind !== "cancelled") continue; // shown below, on its new date
      occurrences.push({
        key,
        date: d,
        kind: change ? "cancelled" : "weekly",
        slotId: s.id,
        slotDate: d,
        changeId: change?.id ?? null,
        batchId: s.batchId,
        batchName: classBatchLabel(lineageNames(s.batch)),
        batchSubjectId: s.batchSubjectId,
        subjectName: s.batchSubject.subject.name,
        subjectCode: s.batchSubject.subject.code,
        color: s.batchSubject.subject.color,
        startMin: s.startMin,
        durationMin: s.durationMin,
        room: s.room,
        mode: s.mode,
        meetingUrl: s.meetingUrl,
        notes: change?.notes ?? s.notes,
      });
    }
  }
  for (const c of changes) {
    if (c.kind === "cancelled" || !c.date || c.startMin == null || c.durationMin == null) continue;
    const date = dateToYmd(c.date);
    if (date < from || date > to) continue;
    occurrences.push({
      key: c.id,
      date,
      kind: c.kind === "moved" ? "moved" : "extra",
      slotId: c.slotId,
      slotDate: c.slotDate ? dateToYmd(c.slotDate) : null,
      changeId: c.id,
      batchId: c.batchId,
      batchName: classBatchLabel(lineageNames(c.batch)),
      batchSubjectId: c.batchSubjectId,
      subjectName: c.batchSubject.subject.name,
      subjectCode: c.batchSubject.subject.code,
      color: c.batchSubject.subject.color,
      startMin: c.startMin,
      durationMin: c.durationMin,
      room: c.room,
      mode: c.mode ?? "offline",
      meetingUrl: c.meetingUrl,
      notes: c.notes,
      makeup: !!c.makeupForId,
    });
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  return { slots, occurrences };
}

/** Same-date clashes among occurrences: one batch double-booked, or one physical room used twice. */
export function occurrenceClashes(occ: Occurrence[]) {
  const live = occ.filter((o) => o.kind !== "cancelled");
  const ids = new Set<string>();
  const lines: string[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.date !== b.date || !overlapsTime(a.startMin, a.durationMin, b.startMin, b.durationMin)) continue;
      const sameBatch = a.batchId === b.batchId;
      const sameRoom = !!a.room && a.room.toLowerCase() === b.room?.toLowerCase() && a.mode !== "online" && b.mode !== "online";
      if (!sameBatch && !sameRoom) continue;
      ids.add(a.key).add(b.key);
      lines.push(
        `${fmtDate(a.date)}: ${a.batchName} ${a.subjectName} ${fmtRange(a.startMin, a.durationMin)} ↔ ${b.batchName} ${b.subjectName} ${fmtRange(b.startMin, b.durationMin)} (${sameBatch ? "same batch" : `room ${a.room}`})`,
      );
    }
  }
  return { ids, lines };
}
