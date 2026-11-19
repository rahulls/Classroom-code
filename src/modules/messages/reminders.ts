import "server-only";
import type { Contact } from "@prisma/client";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { getSetting } from "@/modules/academics/service";
import { addDays, dateToYmd, fmtMin, todayYmd, ymdToDate } from "@/modules/academics/time";
import { getOccurrences, type Occurrence } from "@/modules/academics/timetable";
import { resolveAudience } from "./audience";
import { queueForAudience } from "./service";
import { demoAudience } from "@/modules/academics/demo";

// Class reminders: each student gets one message a few minutes before each of their classes
// (WhatsApp template class_reminder, or email if they have no WhatsApp). Runs every minute from
// the delivery loop. Cancelled classes get no reminder; moved and make-up classes use their new time.
// A reminder that can't go out before the class starts is dropped, never sent late.

export const REMINDER_DEFAULTS = { enabled: false, minutesBefore: 10 };
const IST_OFFSET_MIN = 330;

export async function getReminderSettings() {
  const [enabled, minutesBefore, teacherContactId] = await Promise.all([
    getSetting<boolean>("reminders.classes.enabled", REMINDER_DEFAULTS.enabled),
    getSetting<number>("reminders.classes.minutesBefore", REMINDER_DEFAULTS.minutesBefore),
    getSetting<string | null>("reminders.teacher.contactId", null),
  ]);
  return { enabled, minutesBefore, teacherContactId };
}

/** The teacher's own WhatsApp contact for reminders of every class (batch and demo), or null if not set. */
export async function getTeacherContact() {
  const { teacherContactId } = await getReminderSettings();
  return teacherContactId ? db.contact.findUnique({ where: { id: teacherContactId } }) : null;
}

/** When a class starts, as a real instant (dates and times are IST wall clock). */
export const classStart = (o: Pick<Occurrence, "date" | "startMin">) => new Date(Date.parse(`${o.date}T00:00:00Z`) + (o.startMin - IST_OFFSET_MIN) * 60_000);

/** "Room R-1", "Online: https://meet…", "Room R-1 or online: https://…" */
export function whereText(o: Pick<Occurrence, "mode" | "room" | "meetingUrl">) {
  const online = o.meetingUrl ? `online: ${o.meetingUrl}` : "online";
  if (o.mode === "online") return online.charAt(0).toUpperCase() + online.slice(1);
  const room = o.room ? `Room ${o.room}` : "At the institute";
  return o.mode === "hybrid" ? `${room} or ${online}` : room;
}

let running = false;

/** Queues reminders for classes starting within the next `minutesBefore` minutes. Safe to call every minute. */
export async function queueClassReminders(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    const { enabled, minutesBefore, teacherContactId } = await getReminderSettings();
    const lead = minutesBefore * 60_000;
    // The teacher gets a reminder of every class, whether or not students do (WhatsApp only)
    const teacher = teacherContactId && env.WHATSAPP_MODE !== "manual" ? await db.contact.findUnique({ where: { id: teacherContactId } }) : null;
    const demos = await queueDemoReminders(now, lead, teacher);
    if (!enabled && !teacher) return demos;
    const today = todayYmd();
    const { occurrences } = await getOccurrences({}, today, addDays(today, 1));
    const due = occurrences.filter((o) => {
      if (o.kind === "cancelled") return false;
      const ms = classStart(o).getTime() - now.getTime();
      return ms > 0 && ms <= lead;
    });
    let queued = demos;
    for (const o of due) {
      const time = fmtMin(o.startMin);
      const where = whereText(o);
      if (teacher) {
        const r = await queueForAudience(db, demoAudience(teacher), {
          purpose: "reminder",
          reason: "teacher.reminder",
          actorId: null,
          batchId: o.batchId,
          expiresAt: classStart(o),
          dedupeKey: () => `reminder:teacher:${o.key}:${o.date}`,
          render: () => ({
            subject: `${o.subjectName} class at ${time}`,
            lines: [`Reminder: your ${o.subjectName} class for ${o.batchName} starts at ${time} today.`, `Where: ${where}`],
            params: [o.subjectName, o.batchName, `${time} today`, where],
          }),
        });
        queued += r.whatsapp;
      }
      if (!enabled) continue;
      const audience = await resolveAudience(db, { batchIds: [o.batchId], groupIds: [], studentIds: [], who: "students" });
      // Manual WhatsApp mode means you send each message by hand: pointless for a 10-minute reminder
      if (env.WHATSAPP_MODE === "manual") audience.recipients = audience.recipients.filter((r) => r.channel === "email");
      if (!audience.recipients.length) continue;
      const r = await queueForAudience(db, audience, {
        purpose: "reminder",
        reason: "class.reminder",
        actorId: null,
        batchId: o.batchId,
        expiresAt: classStart(o),
        dedupeKey: (rc) => `reminder:${o.key}:${o.date}:${rc.contact.id}`,
        render: () => ({
          subject: `${o.subjectName} class at ${time}`,
          lines: [`Reminder: your ${o.subjectName} class for ${o.batchName} starts at ${time} today.`, `Where: ${where}`, "", "Please be on time."],
          params: [o.subjectName, o.batchName, `${time} today`, where],
        }),
      });
      queued += r.email + r.whatsapp;
    }
    return queued;
  } finally {
    running = false;
  }
}

/** Demo classes have their own "remind" tick, so they get a reminder even when student reminders are off. */
async function queueDemoReminders(now: Date, lead: number, teacher: Contact | null) {
  if (env.WHATSAPP_MODE === "manual") return 0; // WhatsApp only, and manual mode can't send in time
  const today = todayYmd();
  const rows = await db.demoClass.findMany({
    where: { ...(teacher ? {} : { remind: true }), cancelledAt: null, date: { gte: ymdToDate(today), lte: ymdToDate(addDays(today, 1)) } },
    include: { contact: true },
  });
  let queued = 0;
  for (const d of rows) {
    const o = { date: dateToYmd(d.date), startMin: d.startMin, mode: d.mode, room: d.room, meetingUrl: d.meetingUrl };
    const ms = classStart(o).getTime() - now.getTime();
    if (ms <= 0 || ms > lead) continue;
    const time = fmtMin(d.startMin);
    const where = whereText(o);
    if (teacher) {
      const t = await queueForAudience(db, demoAudience(teacher), {
        purpose: "reminder",
        reason: "teacher.reminder",
        actorId: null,
        expiresAt: classStart(o),
        dedupeKey: () => `reminder:teacher:demo:${d.id}`,
        render: () => ({
          subject: `Demo ${d.subject} class at ${time}`,
          lines: [`Reminder: your demo ${d.subject} class with ${d.personName} starts at ${time} today.`, `Where: ${where}`],
          params: [d.subject, `Demo class with ${d.personName}`, `${time} today`, where],
        }),
      });
      queued += t.whatsapp;
    }
    if (!d.remind) continue;
    const r = await queueForAudience(db, demoAudience(d.contact), {
      purpose: "reminder",
      reason: "demo.reminder",
      actorId: null,
      expiresAt: classStart(o),
      dedupeKey: (rc) => `reminder:demo:${d.id}:${rc.contact.id}`,
      render: () => ({
        subject: `Demo ${d.subject} class at ${time}`,
        lines: [`Reminder: your demo ${d.subject} class starts at ${time} today.`, `Where: ${where}`],
        params: [d.subject, "Demo class", `${time} today`, where],
      }),
    });
    queued += r.whatsapp;
  }
  return queued;
}
