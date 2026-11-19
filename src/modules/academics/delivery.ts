import "server-only";
import { db } from "@/core/db";
import { addDays, dateToYmd, fmtDate, fmtRange, todayYmd, ymdToDate } from "./time";
import { batchClassLabel, getOccurrences } from "./timetable";

// Class delivery: what was planned vs what actually happened, per batch and subject.
// A class the teacher cancels is owed as a make-up until an extra class linked to it is held.
// A class a student skips is only an absence (attendance), never a make-up.

/** Cancelled classes still waiting for a make-up to be scheduled, oldest first. */
export async function getMakeupsOwed() {
  const rows = await db.classDateChange.findMany({
    where: { kind: "cancelled", makeupRequired: true, makeups: { none: {} }, batch: { archivedAt: null } },
    include: { slot: true, batchSubject: { include: { subject: true } } },
    orderBy: { slotDate: "asc" },
    take: 100,
  });
  const labels = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.batchId))) labels.set(id, await batchClassLabel(db, id));
  return rows
    .filter((r) => r.slot && r.slotDate)
    .map((r) => ({
      id: r.id,
      batchId: r.batchId,
      batchLabel: labels.get(r.batchId) ?? "",
      subjectName: r.batchSubject.subject.name,
      date: dateToYmd(r.slotDate!),
      startMin: r.slot!.startMin,
      durationMin: r.slot!.durationMin,
      room: r.slot!.room,
      mode: r.slot!.mode,
      reason: r.reason,
      when: `${fmtDate(dateToYmd(r.slotDate!))} ${fmtRange(r.slot!.startMin, r.slot!.durationMin)}`,
    }));
}

export type DeliveryRow = {
  batchId: string;
  batchLabel: string;
  subjectName: string;
  /** Planned for the month: weekly classes (incl. cancelled / moved ones) + one-time extras that aren't make-ups */
  scheduled: number;
  /** Took place (date today or earlier, not cancelled), including make-ups */
  held: number;
  upcoming: number;
  moved: number;
  cancelledByTeacher: number;
  holidays: number;
  /** Make-up held */
  madeUp: number;
  /** Make-up scheduled for a later date */
  makeupScheduled: number;
  /** Cancelled, make-up required, none scheduled yet */
  owed: number;
  /** Make-up classes held this month (they may cover an earlier month's cancellation) */
  makeupsHeld: number;
  /** Cancelled without a make-up (holiday, or marked "not needed") */
  notMadeUp: { date: string; reason: string }[];
  owedDates: string[];
};

/** Delivery for one month ("2026-11") across a year's batches, or one batch. */
export async function getClassDelivery(scope: { yearId?: string; batchId?: string }, month: string) {
  const from = `${month}-01`;
  const to = addDays(addDays(from, 32).slice(0, 8) + "01", -1);
  const today = todayYmd();
  const [{ occurrences }, cancelled] = await Promise.all([
    getOccurrences(scope, from, to),
    db.classDateChange.findMany({
      where: {
        kind: "cancelled",
        slotDate: { gte: ymdToDate(from), lte: ymdToDate(to) },
        batch: scope.batchId ? { id: scope.batchId } : { archivedAt: null, ...(scope.yearId ? { yearId: scope.yearId } : {}) },
      },
      include: { makeups: { select: { date: true } } },
    }),
  ]);
  const cancelInfo = new Map(cancelled.map((c) => [c.id, c]));

  const rows = new Map<string, DeliveryRow>();
  const labels = new Map<string, string>();
  for (const o of occurrences) {
    const key = `${o.batchId}:${o.batchSubjectId}`;
    if (!labels.has(o.batchId)) labels.set(o.batchId, await batchClassLabel(db, o.batchId));
    const r =
      rows.get(key) ??
      ({
        batchId: o.batchId,
        batchLabel: labels.get(o.batchId) ?? o.batchName,
        subjectName: o.subjectName,
        scheduled: 0,
        held: 0,
        upcoming: 0,
        moved: 0,
        cancelledByTeacher: 0,
        holidays: 0,
        madeUp: 0,
        makeupScheduled: 0,
        owed: 0,
        makeupsHeld: 0,
        notMadeUp: [],
        owedDates: [],
      } satisfies DeliveryRow);
    rows.set(key, r);

    if (o.kind === "cancelled") {
      r.scheduled++;
      const c = o.changeId ? cancelInfo.get(o.changeId) : undefined;
      const reason = c?.reason ?? "other";
      if (reason === "teacher") r.cancelledByTeacher++;
      if (reason === "holiday") r.holidays++;
      const makeupDate = c?.makeups.map((m) => (m.date ? dateToYmd(m.date) : "")).filter(Boolean)[0];
      if (makeupDate) {
        if (makeupDate <= today) r.madeUp++;
        else r.makeupScheduled++;
      } else if (c?.makeupRequired) {
        r.owed++;
        r.owedDates.push(o.date);
      } else {
        r.notMadeUp.push({ date: o.date, reason });
      }
      continue;
    }
    if (o.makeup) {
      if (o.date <= today) r.makeupsHeld++;
    } else {
      r.scheduled++;
    }
    if (o.kind === "moved") r.moved++;
    if (o.date <= today) r.held++;
    else r.upcoming++;
  }
  return {
    from,
    to,
    rows: [...rows.values()].sort((a, b) => a.batchLabel.localeCompare(b.batchLabel) || a.subjectName.localeCompare(b.subjectName)),
  };
}
