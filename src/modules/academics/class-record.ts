import "server-only";
import { db } from "@/core/db";
import { dateToYmd, ymdToDate } from "./time";
import { getOccurrences, type Occurrence } from "./timetable";

// One class on one date: what was covered, homework, and who attended.
// The key survives rescheduling: a weekly class keeps "<slotId>:<usual date>" even when moved.

export const ATTENDANCE = ["present", "late", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE)[number];

export const classKeyOf = (o: Pick<Occurrence, "slotId" | "slotDate" | "changeId">) => (o.slotId && o.slotDate ? `${o.slotId}:${o.slotDate}` : (o.changeId ?? ""));

/** The real (not cancelled) class with this key on this date, looked up on the server so the browser can't invent one. */
export async function findClass(batchId: string, date: string, classKey: string) {
  const { occurrences } = await getOccurrences({ batchId }, date, date);
  return occurrences.find((o) => o.kind !== "cancelled" && classKeyOf(o) === classKey) ?? null;
}

/**
 * Students for a class's attendance: everyone in the batch now (also those added after that date,
 * e.g. onboarded late but already attending), plus anyone who was in it then and has left since.
 */
export async function classRoster(batchId: string, date: string) {
  const d = ymdToDate(date);
  const rows = await db.enrollment.findMany({
    where: {
      batchId,
      student: { archivedAt: null },
      OR: [{ status: "ACTIVE", leftOn: null }, { joinedOn: { lte: d }, leftOn: { gte: d } }],
    },
    orderBy: { joinedOn: "asc" },
    select: { rollNo: true, joinedOn: true, student: { select: { id: true, firstName: true, lastName: true } } },
  });
  const seen = new Set<string>();
  return rows
    .filter((r) => !seen.has(r.student.id) && seen.add(r.student.id))
    .map((r) => ({
      id: r.student.id,
      name: `${r.student.firstName} ${r.student.lastName}`.trim(),
      rollNo: r.rollNo,
      /** Added to the batch after this class: shown, with a note */
      joinedAfter: dateToYmd(r.joinedOn) > date ? dateToYmd(r.joinedOn) : null,
    }))
    .sort((a, b) => (a.rollNo ?? "").localeCompare(b.rollNo ?? "", undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

/**
 * For the calendar's dots: whether attendance was taken and whether class work / homework was logged,
 * per occurrence key. Cancelled and future classes get no marks (nothing to log yet).
 */
export async function getClassMarks<T extends Pick<Occurrence, "key" | "kind" | "date" | "slotId" | "slotDate" | "changeId">>(occurrences: T[], today: string) {
  const due = occurrences.filter((o) => o.kind !== "cancelled" && o.date <= today);
  const keys = [...new Set(due.map(classKeyOf).filter(Boolean))];
  const recs = keys.length
    ? await db.classRecord.findMany({ where: { classKey: { in: keys } }, select: { classKey: true, attendanceTakenAt: true, notes: true, homework: true } })
    : [];
  const byKey = new Map(recs.map((r) => [r.classKey, r]));
  const marks = new Map<string, { attendance: boolean; work: boolean }>();
  for (const o of due) {
    const r = byKey.get(classKeyOf(o));
    marks.set(o.key, { attendance: !!r?.attendanceTakenAt, work: !!(r?.notes?.trim() || r?.homework?.trim()) });
  }
  return marks;
}

export async function getClassRecord(classKey: string) {
  return db.classRecord.findUnique({ where: { classKey }, include: { attendance: { select: { studentId: true, status: true } } } });
}

/** A student's attendance, newest first, with totals. */
export async function getStudentAttendance(studentId: string, limit = 30) {
  const rows = await db.attendance.findMany({
    where: { studentId },
    orderBy: { classRecord: { date: "desc" } },
    take: 500,
    select: {
      status: true,
      classRecord: { select: { date: true, startMin: true, batchId: true, batchSubjectId: true, batch: { select: { name: true } } } },
    },
  });
  const subjects = await db.batchSubject.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.classRecord.batchSubjectId))] } },
    select: { id: true, subject: { select: { name: true } } },
  });
  const subjectName = new Map(subjects.map((s) => [s.id, s.subject.name]));
  const count = (s: AttendanceStatus) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    present: count("present"),
    late: count("late"),
    absent: count("absent"),
    recent: rows.slice(0, limit).map((r) => ({
      date: dateToYmd(r.classRecord.date),
      startMin: r.classRecord.startMin,
      batchId: r.classRecord.batchId,
      batchName: r.classRecord.batch.name,
      subjectName: subjectName.get(r.classRecord.batchSubjectId) ?? "",
      status: r.status as AttendanceStatus,
    })),
  };
}
