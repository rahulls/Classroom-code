import "server-only";
import type { Contact, DemoClass } from "@prisma/client";
import { db } from "@/core/db";
import type { Audience } from "@/modules/messages/audience";
import { contactAddress } from "@/modules/students/contacts";
import { dateToYmd, ymdToDate } from "./time";

// Demo (trial) classes: a free-text subject for one person who isn't a student yet.
// They appear on the calendar and get WhatsApp messages (scheduled / cancelled, and a reminder
// before the class) like students do, but sit outside batches, attendance and class notes.

/** A demo class as drawn on the calendar. */
export type DemoView = {
  id: string;
  subject: string;
  date: string;
  startMin: number;
  durationMin: number;
  room: string | null;
  mode: string;
  meetingUrl: string | null;
  notes: string | null;
  personName: string;
  /** "••••••4321" */
  phoneHint: string | null;
  remind: boolean;
  cancelled: boolean;
};

const toView = (d: DemoClass & { contact: Contact | null }): DemoView => ({
  id: d.id,
  subject: d.subject,
  date: dateToYmd(d.date),
  startMin: d.startMin,
  durationMin: d.durationMin,
  room: d.room,
  mode: d.mode,
  meetingUrl: d.meetingUrl,
  notes: d.notes,
  personName: d.personName,
  phoneHint: d.contact?.phoneLast4 ? `••••••${d.contact.phoneLast4}` : null,
  remind: d.remind,
  cancelled: !!d.cancelledAt,
});

/** Demo classes between two dates (inclusive), cancelled ones included. */
export async function getDemos(from: string, to: string): Promise<DemoView[]> {
  const rows = await db.demoClass.findMany({
    where: { date: { gte: ymdToDate(from), lte: ymdToDate(to) } },
    orderBy: [{ date: "asc" }, { startMin: "asc" }],
    include: { contact: true },
  });
  return rows.map(toView);
}

/** The demo's person as a one-recipient audience (WhatsApp only), or empty if they have no number. */
export function demoAudience(contact: Contact | null): Audience {
  const address = contact ? contactAddress(contact, "whatsapp") : null;
  if (!contact || !address) return { studentCount: 0, recipients: [], skipped: [] };
  return { studentCount: 1, recipients: [{ contact, role: "student", students: [contact.name], studentIds: [], channel: "whatsapp", address }], skipped: [] };
}

