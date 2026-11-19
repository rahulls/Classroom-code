import "server-only";
import type { Prisma, StudentStatus } from "@prisma/client";
import { db } from "@/core/db";
import { decryptOpt } from "@/core/crypto";
import type { CurrentUser } from "@/core/auth/session";
import { can } from "@/core/rbac";
import { getFieldDefinitions, readCustomFields } from "@/modules/config/fields";
import { emailIndex, normalizePhone, phoneIndex, viewContact } from "./contacts";

export const PAGE_SIZE = 50;

export async function listStudents(opts: { q?: string; batchId?: string; status?: StudentStatus; page?: number }) {
  const where: Prisma.StudentWhereInput = { archivedAt: null };
  if (opts.status) where.status = opts.status;
  if (opts.batchId) where.enrollments = { some: { batchId: opts.batchId, status: "ACTIVE" } };

  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    const digits = q.replace(/\D/g, "");
    let idx: string | null = null;
    if (q.includes("@")) idx = emailIndex(q);
    else if (digits.length >= 7) {
      try {
        idx = phoneIndex(normalizePhone(q));
      } catch {
        idx = null;
      }
    }
    if (idx) {
      where.contacts = { some: { contact: { OR: [{ phoneIdx: idx }, { whatsappIdx: idx }, { emailIdx: idx }] } } };
    } else {
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { admissionNo: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  const page = Math.max(1, opts.page ?? 1);
  const [total, rows] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        enrollments: {
          where: { status: "ACTIVE" },
          include: {
            batch: {
              select: {
                id: true,
                name: true,
                parent: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } },
                batchSubjects: { select: { subject: { select: { name: true } } }, orderBy: { subject: { name: "asc" } } },
              },
            },
          },
        },
        contacts: { include: { contact: { select: { name: true, phoneLast4: true, waOptIn: true, emailEnc: true } } }, orderBy: { isPrimary: "desc" } },
      },
    }),
  ]);
  return { total, page, pageSize: PAGE_SIZE, rows };
}

export async function getStudent(id: string, user: CurrentUser) {
  const student = await db.student.findFirst({
    where: { id, archivedAt: null },
    include: {
      contacts: { include: { contact: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      enrollments: { include: { batch: { include: { programType: true, parent: { include: { parent: true } } } } }, orderBy: { joinedOn: "desc" } },
    },
  });
  if (!student) return null;

  const reveal = can(user, "students.view_contact");
  const programKeys = [...new Set(student.enrollments.map((e) => e.batch.programType?.key).filter(Boolean))] as string[];
  const defs = (await Promise.all([getFieldDefinitions("student"), ...programKeys.map((k) => getFieldDefinitions("student", k))])).flat();
  const uniqueDefs = [...new Map(defs.map((d) => [d.id, d])).values()];

  return {
    ...student,
    dob: reveal ? decryptOpt(student.dobEnc, "student.dob") : null,
    contactViews: student.contacts.map((l) => ({ link: l, contact: viewContact(l.contact, { reveal }) })),
    customDefs: uniqueDefs,
    customValues: readCustomFields(uniqueDefs, student.custom, { includeSensitive: reveal }),
    revealContacts: reveal,
  };
}

export async function getEnrollableBatches(yearId?: string) {
  const rows = await db.programNode.findMany({
    where: { archivedAt: null, nodeType: { enrollable: true }, ...(yearId ? { yearId } : { year: { isCurrent: true } }) },
    include: {
      parent: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } },
      programType: { select: { key: true, label: true, learnerKind: true, guardianRequired: true } },
      batchSubjects: { select: { subject: { select: { name: true } } }, orderBy: { subject: { name: "asc" } } },
    },
    orderBy: [{ parent: { name: "asc" } }, { name: "asc" }],
  });
  type Up = { name: string; parent?: Up | null } | null;
  return rows.map((b) => {
    const names: string[] = [];
    for (let c: Up = b.parent; c; c = c.parent ?? null) names.unshift(c.name);
    return { ...b, classPath: names.join(" · "), fullLabel: [...names, b.name].join(" · ") };
  }).sort((a, b) => a.fullLabel.localeCompare(b.fullLabel));
}
