import "server-only";
import { db } from "@/core/db";
import { type AttendanceStatus, classKeyOf } from "./class-record";
import { addDays, dateToYmd, isYmd, todayYmd, ymdToDate } from "./time";
import { getOccurrences } from "./timetable";

// A batch's classes over a date range, joined with what was covered, homework and attendance.
// Used by the "Class progress & homework" and "Attendance" tabs of the batch page.

export const MAX_RANGE_DAYS = 366;

/** From/to from the URL, defaulting to the last 30 days up to today; to is never after today. */
export function logRange(rawFrom?: string, rawTo?: string) {
  const today = todayYmd();
  let to = isYmd(rawTo) && rawTo <= today ? rawTo : today;
  let from = isYmd(rawFrom) ? rawFrom : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to, today };
}

export type LogClass = {
  key: string;
  date: string;
  startMin: number;
  durationMin: number;
  subjectName: string;
  subjectCode: string;
  color: string | null;
  cancelled: boolean;
  makeup: boolean;
  moved: boolean;
  notes: string | null;
  homework: string | null;
  homeworkDue: string | null;
  sentAt: Date | null;
  attendanceTaken: boolean;
  marks: Map<string, AttendanceStatus>;
};

export async function getBatchLog(batchId: string, from: string, to: string) {
  const [{ occurrences }, records, enrollments] = await Promise.all([
    getOccurrences({ batchId }, from, to),
    db.classRecord.findMany({
      where: { batchId, date: { gte: ymdToDate(from), lte: ymdToDate(to) } },
      include: { attendance: { select: { studentId: true, status: true } } },
    }),
    db.enrollment.findMany({
      where: {
        batchId,
        student: { archivedAt: null },
        joinedOn: { lte: ymdToDate(to) },
        OR: [{ leftOn: null }, { leftOn: { gte: ymdToDate(from) } }],
      },
      orderBy: { joinedOn: "asc" },
      select: { rollNo: true, joinedOn: true, leftOn: true, status: true, student: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);
  const byKey = new Map(records.map((r) => [r.classKey, r]));
  const used = new Set<string>();

  const classes: LogClass[] = occurrences.map((o) => {
    const k = classKeyOf(o);
    const r = byKey.get(k);
    if (r) used.add(k);
    return {
      key: k,
      date: o.date,
      startMin: o.startMin,
      durationMin: o.durationMin,
      subjectName: o.subjectName,
      subjectCode: o.subjectCode,
      color: o.color,
      cancelled: o.kind === "cancelled",
      makeup: !!o.makeup,
      moved: o.kind === "moved",
      notes: r?.notes ?? null,
      homework: r?.homework ?? null,
      homeworkDue: r?.homeworkDue ? dateToYmd(r.homeworkDue) : null,
      sentAt: r?.sentAt ?? null,
      attendanceTaken: !!r?.attendanceTakenAt,
      marks: new Map((r?.attendance ?? []).map((a) => [a.studentId, a.status as AttendanceStatus])),
    };
  });

  // Records whose class no longer exists in the timetable (e.g. the class was removed later): keep them visible.
  const orphans = records.filter((r) => !used.has(r.classKey));
  if (orphans.length) {
    const subjects = await db.batchSubject.findMany({ where: { id: { in: [...new Set(orphans.map((r) => r.batchSubjectId))] } }, include: { subject: true } });
    const sub = new Map(subjects.map((s) => [s.id, s.subject]));
    for (const r of orphans) {
      const s = sub.get(r.batchSubjectId);
      classes.push({
        key: r.classKey,
        date: dateToYmd(r.date),
        startMin: r.startMin,
        durationMin: s?.defaultDurationMin ?? 60,
        subjectName: s?.name ?? "Subject",
        subjectCode: s?.code ?? "",
        color: s?.color ?? null,
        cancelled: false,
        makeup: false,
        moved: false,
        notes: r.notes,
        homework: r.homework,
        homeworkDue: r.homeworkDue ? dateToYmd(r.homeworkDue) : null,
        sentAt: r.sentAt,
        attendanceTaken: !!r.attendanceTakenAt,
        marks: new Map(r.attendance.map((a) => [a.studentId, a.status as AttendanceStatus])),
      });
    }
  }
  classes.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);

  const seen = new Set<string>();
  const students = enrollments
    .filter((e) => !seen.has(e.student.id) && seen.add(e.student.id))
    .map((e) => ({
      id: e.student.id,
      name: `${e.student.firstName} ${e.student.lastName}`.trim(),
      rollNo: e.rollNo,
      joinedOn: dateToYmd(e.joinedOn),
      leftOn: e.leftOn ? dateToYmd(e.leftOn) : null,
    }))
    .sort((a, b) => (a.rollNo ?? "").localeCompare(b.rollNo ?? "", undefined, { numeric: true }) || a.name.localeCompare(b.name));

  return { classes, students };
}

/** Attendance totals per student over the classes where attendance was taken. */
export function attendanceTotals(classes: LogClass[], studentId: string) {
  let present = 0,
    late = 0,
    absent = 0;
  for (const c of classes) {
    const m = c.marks.get(studentId);
    if (m === "present") present++;
    else if (m === "late") late++;
    else if (m === "absent") absent++;
  }
  const marked = present + late + absent;
  return { present, late, absent, marked, pct: marked ? Math.round(((present + late) / marked) * 100) : null };
}
