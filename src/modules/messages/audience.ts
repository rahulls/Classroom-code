import "server-only";
import type { Contact, Prisma } from "@prisma/client";
import { contactAddress } from "@/modules/students/contacts";

// Who receives a message. Every recipient is a Contact linked to a student:
//  - "self" links are the student's own phone/email   → role "student"
//  - every other relation (father, mother, guardian…) → role "parent"
// Rules applied here, for every send:
//  1. only contacts who opted in to the channel;
//  2. WhatsApp first: email only for contacts without WhatsApp consent/number;
//  3. a parent who only receives fee messages is left out of academic messages;
//  4. one message per contact: a parent of two selected students gets one message naming both.

type Tx = Prisma.TransactionClient;

export type Who = "students" | "parents" | "both";
/** all: every active student (broadcast), whatever is picked */
export type AudienceSpec = { batchIds: string[]; groupIds: string[]; studentIds: string[]; who: Who; all?: boolean };

export type Recipient = {
  contact: Contact;
  role: "student" | "parent";
  /** First names of the selected students this contact is for */
  students: string[];
  /** Ids of those students */
  studentIds: string[];
  channel: "whatsapp" | "email";
  address: string;
};
export type Skipped = { name: string; role: "student" | "parent"; students: string[]; reason: string };
export type Audience = { studentCount: number; recipients: Recipient[]; skipped: Skipped[] };

/** The picked program-tree nodes plus everything under them (a class → all its batches). */
async function withDescendants(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const nodes = await tx.programNode.findMany({ where: { archivedAt: null }, select: { id: true, parentId: true } });
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const out = new Set<string>();
  const stack = ids.filter((id) => nodes.some((n) => n.id === id));
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...out];
}

export async function resolveAudience(tx: Tx, spec: AudienceSpec): Promise<Audience> {
  const batchIds = await withDescendants(tx, spec.batchIds);
  const or: Prisma.StudentWhereInput[] = [];
  if (batchIds.length) or.push({ enrollments: { some: { batchId: { in: batchIds }, status: "ACTIVE" } } });
  if (spec.groupIds.length) or.push({ groups: { some: { groupId: { in: spec.groupIds } } } });
  if (spec.studentIds.length) or.push({ id: { in: spec.studentIds } });
  if (!or.length && !spec.all) return { studentCount: 0, recipients: [], skipped: [] };

  const students = await tx.student.findMany({
    where: { archivedAt: null, status: "ACTIVE", ...(spec.all ? {} : { OR: or }) },
    select: { id: true, firstName: true, contacts: { include: { contact: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const byContact = new Map<string, { contact: Contact; role: "student" | "parent"; students: string[]; studentIds: string[] }>();
  for (const s of students) {
    for (const link of s.contacts) {
      const role = link.relation === "self" ? "student" : "parent";
      if (role === "student" && spec.who === "parents") continue;
      if (role === "parent" && spec.who === "students") continue;
      if (role === "parent" && link.receives === "fees") continue;
      const entry = byContact.get(link.contactId) ?? { contact: link.contact, role, students: [], studentIds: [] };
      if (!entry.studentIds.includes(s.id)) entry.studentIds.push(s.id);
      if (role === "parent") entry.role = "parent"; // also a parent of someone else: greet as parent
      if (!entry.students.includes(s.firstName)) entry.students.push(s.firstName);
      byContact.set(link.contactId, entry);
    }
  }

  const recipients: Recipient[] = [];
  const skipped: Skipped[] = [];
  for (const e of byContact.values()) {
    const wa = e.contact.waOptIn ? contactAddress(e.contact, "whatsapp") : null;
    const email = !wa && e.contact.emailOptIn ? contactAddress(e.contact, "email") : null;
    if (wa) recipients.push({ ...e, channel: "whatsapp", address: wa });
    else if (email) recipients.push({ ...e, channel: "email", address: email });
    else {
      const hasNumber = !!contactAddress(e.contact, "whatsapp");
      skipped.push({ name: e.contact.name, role: e.role, students: e.students, reason: hasNumber ? "No WhatsApp consent" : "No WhatsApp number or email consent" });
    }
  }
  // Two contacts with the same number (e.g. a student using a parent's phone) get one message:
  // greeted as the parent, naming every student it is for
  const byAddress = new Map<string, Recipient>();
  for (const r of recipients) {
    const k = `${r.channel}:${r.address}`;
    const seen = byAddress.get(k);
    if (!seen) byAddress.set(k, r);
    else {
      const ids = [...new Set([...seen.studentIds, ...r.studentIds])];
      if (r.role === "parent" && seen.role !== "parent") byAddress.set(k, { ...r, students: [...new Set([...r.students, ...seen.students])], studentIds: ids });
      else {
        seen.students = [...new Set([...seen.students, ...r.students])];
        seen.studentIds = ids;
      }
    }
  }
  const unique = [...byAddress.values()];
  unique.sort((a, b) => a.role.localeCompare(b.role) || a.contact.name.localeCompare(b.contact.name));
  return { studentCount: students.length, recipients: unique, skipped };
}

/** "Aarav & Diya (Class 10 · Maths)" for a parent; just "Class 10 · Maths" for the student. */
export const recipientLabel = (r: Pick<Recipient, "role" | "students">, label: string) =>
  r.role === "parent" ? `${r.students.join(" & ")}${label ? ` (${label})` : ""}` : label || r.students.join(" & ");
