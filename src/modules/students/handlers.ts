import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineAction, UserError } from "@/core/action";
import { audit } from "@/core/audit";
import { db } from "@/core/db";
import { encryptOpt } from "@/core/crypto";
import { emit } from "@/core/events";
import { zBool, zDate, zId, zOpt, zOptDate, zOptId, zReq } from "@/core/validation";
import { getFieldDefinitions, parseCustomFields } from "@/modules/config/fields";
import { contactPII } from "./contacts";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const zOptEmail = z.preprocess(blank, z.email("Enter a valid email").max(254).optional());
const zOptPhone = z.preprocess(blank, z.string().trim().max(25).optional());
const RELATIONS = ["father", "mother", "guardian", "other"] as const;

async function nextAdmissionNo(tx: Prisma.TransactionClient) {
  const year = await tx.academicYear.findFirst({ where: { isCurrent: true } });
  const y = (year?.startDate ?? new Date()).getUTCFullYear();
  const key = `admission:${y}`;
  // Atomic increment (parameterised query, safe against injection and races)
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return `RSC-${y}-${String(rows[0]!.value).padStart(4, "0")}`;
}

// ─────────────── Create ───────────────

export const createStudentAction = defineAction({
  permission: "students.manage",
  schema: z.looseObject({
    firstName: zReq("First name", 60),
    lastName: zOpt(60),
    gender: z.preprocess(blank, z.enum(["female", "male", "other"]).optional()),
    dob: zOptDate,
    learnerKind: z.enum(["MINOR", "ADULT"]).default("MINOR"),
    batchIds: z.array(z.uuid({ error: "Choose a valid batch" })).max(20).default([]),
    joinedOn: z.preprocess((v) => (v === "" ? undefined : v), z.string({ error: "Pick the join date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the join date")),
    studentPhone: zOptPhone,
    studentEmail: zOptEmail,
    studentWaSame: zBool,
    studentPhoneSameAsParent: zBool,
    guardianName: zOpt(80),
    guardianRelation: z.preprocess(blank, z.enum(RELATIONS).optional()),
    guardianPhone: zOptPhone,
    guardianEmail: zOptEmail,
    guardianWaSame: zBool,
    waOptIn: zBool,
    emailOptIn: zBool,
    consentSource: zOpt(100),
  }),
  run: async (raw, { user }) => {
    // "Same as parent's phone": the student's own contact gets the parent's number
    const input = raw.studentPhoneSameAsParent ? { ...raw, studentPhone: raw.guardianPhone } : raw;
    if (raw.studentPhoneSameAsParent && !raw.guardianPhone) {
      return { ok: false, error: "Enter the parent's phone, or untick “Same as parent's phone”.", fieldErrors: { guardianPhone: "Required when the student uses this number" } };
    }
    let learnerKind = input.learnerKind;
    let guardianRequired = learnerKind === "MINOR";
    let programKey: string | null = null;

    const batchIds = [...new Set(input.batchIds)];
    if (!batchIds.length) return { ok: false, error: "Choose the class and at least one batch.", fieldErrors: { batchIds: "Tick at least one batch" } };
    const chosen = await db.programNode.findMany({ where: { id: { in: batchIds }, archivedAt: null, nodeType: { enrollable: true } }, include: { programType: true } });
    if (chosen.length !== batchIds.length) throw new UserError("Choose a valid batch.");
    if (new Set(chosen.map((b) => b.parentId ?? b.id)).size > 1) {
      return { ok: false, error: "All batches must be in the same class.", fieldErrors: { batchIds: "Pick batches from one class" } };
    }
    const typed = chosen.find((b) => b.programType);
    if (typed?.programType) {
      learnerKind = typed.programType.learnerKind;
      programKey = typed.programType.key;
    }
    if (chosen.some((b) => b.programType)) guardianRequired = chosen.some((b) => b.programType?.guardianRequired);
    if (guardianRequired && (!input.guardianName || !input.guardianPhone)) {
      return { ok: false, error: "A guardian name and phone are required for school students.", fieldErrors: { guardianName: "Required", guardianPhone: "Required" } };
    }

    const defs = (await Promise.all([getFieldDefinitions("student"), programKey ? getFieldDefinitions("student", programKey) : []])).flat();
    const custom = parseCustomFields([...new Map(defs.map((d) => [d.id, d])).values()], input);
    if (!custom.ok) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: custom.fieldErrors };

    const consent = input.waOptIn || input.emailOptIn ? { consentAt: new Date(), consentSource: input.consentSource ?? "admission form" } : {};
    const studentPII = contactPII({ phone: input.studentPhone, whatsapp: input.studentWaSame ? input.studentPhone : undefined, email: input.studentEmail });
    const guardianPII = input.guardianPhone || input.guardianEmail
      ? contactPII({ phone: input.guardianPhone, whatsapp: input.guardianWaSame ? input.guardianPhone : undefined, email: input.guardianEmail })
      : null;

    const student = await db.$transaction(async (tx) => {
      const admissionNo = await nextAdmissionNo(tx);
      const s = await tx.student.create({
        data: {
          admissionNo,
          firstName: input.firstName,
          lastName: input.lastName ?? "",
          gender: input.gender ?? null,
          dobEnc: encryptOpt(input.dob, "student.dob"),
          learnerKind,
          custom: custom.values as Prisma.InputJsonValue,
        },
      });
      const fullName = `${input.firstName} ${input.lastName ?? ""}`.trim();
      if (input.studentPhone || input.studentEmail) {
        const c = await tx.contact.create({
          data: { name: fullName, ...studentPII, waOptIn: input.waOptIn && !!input.studentPhone, emailOptIn: input.emailOptIn && !!input.studentEmail, ...consent },
        });
        await tx.guardianLink.create({ data: { studentId: s.id, contactId: c.id, relation: "self", isPrimary: learnerKind === "ADULT" } });
      }
      if (guardianPII && input.guardianName) {
        const g = await tx.contact.create({
          data: { name: input.guardianName, ...guardianPII, waOptIn: input.waOptIn && !!input.guardianPhone, emailOptIn: input.emailOptIn && !!input.guardianEmail, ...consent },
        });
        await tx.guardianLink.create({ data: { studentId: s.id, contactId: g.id, relation: input.guardianRelation ?? "guardian", isPrimary: learnerKind === "MINOR" } });
      }
      for (const batchId of batchIds) {
        await tx.enrollment.create({ data: { studentId: s.id, batchId, joinedOn: new Date(`${input.joinedOn}T00:00:00Z`) } });
        await emit(tx, "student.enrolled", { studentId: s.id, batchId });
      }
      await emit(tx, "student.created", { studentId: s.id });
      await audit(
        {
          action: "student.created",
          actor: user,
          entity: "student",
          entityId: s.id,
          after: { admissionNo, learnerKind, batchIds, customKeys: Object.keys(custom.values), hasGuardian: !!guardianPII },
        },
        tx,
      );
      return s;
    });

    revalidatePath("/students");
    redirect(`/students/${student.id}`);
  },
});

// ─────────────── Update profile ───────────────

export const updateStudentAction = defineAction({
  permission: "students.manage",
  schema: z.looseObject({
    id: zId,
    firstName: zReq("First name", 60),
    lastName: zOpt(60),
    gender: z.preprocess(blank, z.enum(["female", "male", "other"]).optional()),
    dob: zOptDate,
  }),
  run: async (input, { user }) => {
    const before = await db.student.findFirst({ where: { id: input.id, archivedAt: null }, include: { enrollments: { where: { status: "ACTIVE" }, include: { batch: { include: { programType: true } } } } } });
    if (!before) throw new UserError("Student not found.");
    const keys = [...new Set(before.enrollments.map((e) => e.batch.programType?.key).filter(Boolean))] as string[];
    const defs = (await Promise.all([getFieldDefinitions("student"), ...keys.map((k) => getFieldDefinitions("student", k))])).flat();
    const custom = parseCustomFields([...new Map(defs.map((d) => [d.id, d])).values()], input);
    if (!custom.ok) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: custom.fieldErrors };

    await db.student.update({
      where: { id: input.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName ?? "",
        gender: input.gender ?? null,
        dobEnc: encryptOpt(input.dob, "student.dob"),
        custom: { ...(before.custom as Record<string, unknown>), ...custom.values } as Prisma.InputJsonValue,
      },
    });
    await audit({
      action: "student.updated",
      actor: user,
      entity: "student",
      entityId: input.id,
      before: { firstName: before.firstName, lastName: before.lastName },
      after: { firstName: input.firstName, lastName: input.lastName ?? "", customKeys: Object.keys(custom.values) },
    });
    revalidatePath(`/students/${input.id}`);
    return { ok: true, message: "Profile saved." };
  },
});

export const setStudentStatusAction = defineAction({
  permission: "students.manage",
  schema: z.object({ id: zId, status: z.enum(["ACTIVE", "ON_HOLD", "ALUMNI", "DROPPED"]) }),
  run: async ({ id, status }, { user }) => {
    const before = await db.student.findUnique({ where: { id } });
    if (!before) throw new UserError("Student not found.");
    await db.$transaction(async (tx) => {
      await tx.student.update({ where: { id }, data: { status } });
      await emit(tx, "student.status_changed", { studentId: id, from: before.status, to: status });
      await audit({ action: "student.status_changed", actor: user, entity: "student", entityId: id, before: { status: before.status }, after: { status } }, tx);
    });
    revalidatePath(`/students/${id}`);
    return { ok: true, message: "Status updated." };
  },
});

// ─────────────── Contacts / guardians ───────────────

export const addContactAction = defineAction({
  permission: "students.manage",
  schema: z.object({
    studentId: zId,
    name: zReq("Name", 80),
    relation: z.enum(["self", ...RELATIONS]),
    phone: zOptPhone,
    email: zOptEmail,
    waSame: zBool,
    waOptIn: zBool,
    emailOptIn: zBool,
    consentSource: zOpt(100),
    isPrimary: zBool,
  }),
  run: async (input, { user }) => {
    if (!input.phone && !input.email) return { ok: false, error: "Add a phone or an email.", fieldErrors: { phone: "Phone or email required" } };
    const student = await db.student.findFirst({ where: { id: input.studentId, archivedAt: null } });
    if (!student) throw new UserError("Student not found.");
    const pii = contactPII({ phone: input.phone, whatsapp: input.waSame ? input.phone : undefined, email: input.email });
    const consent = input.waOptIn || input.emailOptIn ? { consentAt: new Date(), consentSource: input.consentSource ?? "manual" } : {};
    await db.$transaction(async (tx) => {
      if (input.isPrimary) await tx.guardianLink.updateMany({ where: { studentId: student.id }, data: { isPrimary: false } });
      const c = await tx.contact.create({
        data: { name: input.name, ...pii, waOptIn: input.waOptIn && !!input.phone, emailOptIn: input.emailOptIn && !!input.email, ...consent },
      });
      await tx.guardianLink.create({ data: { studentId: student.id, contactId: c.id, relation: input.relation, isPrimary: input.isPrimary } });
      await audit({ action: "student.contact_added", actor: user, entity: "student", entityId: student.id, after: { contactId: c.id, relation: input.relation, waOptIn: input.waOptIn, emailOptIn: input.emailOptIn } }, tx);
    });
    revalidatePath(`/students/${student.id}`);
    return { ok: true, message: "Contact added." };
  },
});

export const updateConsentAction = defineAction({
  permission: "students.manage",
  schema: z.object({ studentId: zId, contactId: zId, waOptIn: zBool, emailOptIn: zBool, consentSource: zOpt(100) }),
  run: async (input, { user }) => {
    const link = await db.guardianLink.findUnique({ where: { studentId_contactId: { studentId: input.studentId, contactId: input.contactId } }, include: { contact: true } });
    if (!link) throw new UserError("Contact not found.");
    const c = link.contact;
    const granted = (input.waOptIn && !c.waOptIn) || (input.emailOptIn && !c.emailOptIn);
    await db.contact.update({
      where: { id: c.id },
      data: {
        waOptIn: input.waOptIn && !!c.whatsappEnc,
        emailOptIn: input.emailOptIn && !!c.emailEnc,
        ...(granted ? { consentAt: new Date(), consentSource: input.consentSource ?? "manual" } : {}),
      },
    });
    await audit({ action: "contact.consent_updated", actor: user, entity: "contact", entityId: c.id, before: { waOptIn: c.waOptIn, emailOptIn: c.emailOptIn }, after: { waOptIn: input.waOptIn, emailOptIn: input.emailOptIn } });
    revalidatePath(`/students/${input.studentId}`);
    return { ok: true, message: "Consent updated." };
  },
});

export const removeContactAction = defineAction({
  permission: "students.manage",
  schema: z.object({ studentId: zId, contactId: zId }),
  run: async ({ studentId, contactId }, { user }) => {
    await db.$transaction(async (tx) => {
      await tx.guardianLink.delete({ where: { studentId_contactId: { studentId, contactId } } });
      const stillLinked = await tx.guardianLink.count({ where: { contactId } });
      if (!stillLinked) await tx.contact.delete({ where: { id: contactId } }); // erase orphaned PII
      await audit({ action: "student.contact_removed", actor: user, entity: "student", entityId: studentId, before: { contactId } }, tx);
    });
    revalidatePath(`/students/${studentId}`);
  },
});

// ─────────────── Enrolment ───────────────

export const enrollAction = defineAction({
  permission: "students.manage",
  schema: z.object({ studentId: zId, batchId: zId, joinedOn: zDate("Join date"), rollNo: zOpt(20) }),
  run: async (input, { user }) => {
    const batch = await db.programNode.findFirst({ where: { id: input.batchId, archivedAt: null, nodeType: { enrollable: true } } });
    if (!batch) throw new UserError("Choose a valid batch.");
    const dup = await db.enrollment.findFirst({ where: { studentId: input.studentId, batchId: input.batchId, status: "ACTIVE" } });
    if (dup) throw new UserError("Already enrolled in that batch.");
    await db.$transaction(async (tx) => {
      const e = await tx.enrollment.create({ data: { studentId: input.studentId, batchId: input.batchId, joinedOn: input.joinedOn, rollNo: input.rollNo ?? null } });
      await emit(tx, "student.enrolled", { studentId: input.studentId, batchId: input.batchId });
      await audit({ action: "student.enrolled", actor: user, entity: "student", entityId: input.studentId, after: { enrollmentId: e.id, batchId: input.batchId } }, tx);
    });
    revalidatePath(`/students/${input.studentId}`);
    return { ok: true, message: `Enrolled in ${batch.name}.` };
  },
});

export const endEnrollmentAction = defineAction({
  permission: "students.manage",
  schema: z.object({ enrollmentId: zId }),
  run: async ({ enrollmentId }, { user }) => {
    const e = await db.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!e || e.status !== "ACTIVE") throw new UserError("Enrolment not active.");
    await db.$transaction(async (tx) => {
      await tx.enrollment.update({ where: { id: enrollmentId }, data: { status: "LEFT", leftOn: new Date() } });
      await emit(tx, "enrollment.ended", { studentId: e.studentId, batchId: e.batchId });
      await audit({ action: "student.enrollment_ended", actor: user, entity: "student", entityId: e.studentId, after: { enrollmentId } }, tx);
    });
    revalidatePath(`/students/${e.studentId}`);
  },
});


// ═══════════════ Edit mode (data.edit_all): modify any record ═══════════════

export const updateStudentAdminAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({
    id: zId,
    admissionNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9/_-]{2,29}$/, "3–30 letters, digits, - / _"),
    learnerKind: z.enum(["MINOR", "ADULT"]),
  }),
  run: async ({ id, admissionNo, learnerKind }, { user }) => {
    const before = await db.student.findFirst({ where: { id, archivedAt: null } });
    if (!before) throw new UserError("Student not found.");
    if (await db.student.findFirst({ where: { admissionNo, id: { not: id } } })) throw new UserError("Another student has that admission number.");
    await db.student.update({ where: { id }, data: { admissionNo, learnerKind } });
    await audit({
      action: "student.admin_updated",
      actor: user,
      entity: "student",
      entityId: id,
      before: { admissionNo: before.admissionNo, learnerKind: before.learnerKind },
      after: { admissionNo, learnerKind },
    });
    revalidatePath(`/students/${id}`);
    return { ok: true, message: "Saved." };
  },
});

export const updateContactAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({
    studentId: zId,
    contactId: zId,
    name: zReq("Name", 80),
    relation: z.enum(["self", ...RELATIONS]),
    phone: zOptPhone,
    whatsapp: zOptPhone,
    email: zOptEmail,
    preferredChannel: z.enum(["whatsapp", "email", "both"]),
    isPrimary: zBool,
  }),
  run: async (input, { user }) => {
    if (!input.phone && !input.email) return { ok: false, error: "Keep a phone or an email.", fieldErrors: { phone: "Phone or email required" } };
    const link = await db.guardianLink.findUnique({ where: { studentId_contactId: { studentId: input.studentId, contactId: input.contactId } }, include: { contact: true } });
    if (!link) throw new UserError("Contact not found.");
    const pii = contactPII({ phone: input.phone, whatsapp: input.whatsapp, email: input.email });
    const before = link.contact;
    const changed = {
      name: before.name !== input.name,
      phone: before.phoneIdx !== pii.phoneIdx,
      whatsapp: before.whatsappIdx !== pii.whatsappIdx,
      email: before.emailIdx !== pii.emailIdx,
    };
    await db.$transaction(async (tx) => {
      if (input.isPrimary) await tx.guardianLink.updateMany({ where: { studentId: input.studentId }, data: { isPrimary: false } });
      await tx.guardianLink.update({ where: { id: link.id }, data: { relation: input.relation, isPrimary: input.isPrimary } });
      await tx.contact.update({
        where: { id: before.id },
        data: {
          name: input.name,
          ...pii,
          preferredChannel: input.preferredChannel,
          // A changed number/email needs fresh consent for that channel
          waOptIn: changed.whatsapp ? false : before.waOptIn && !!pii.whatsappEnc,
          emailOptIn: changed.email ? false : before.emailOptIn && !!pii.emailEnc,
        },
      });
      // PII values are never written to the audit log, only which fields changed.
      await audit({ action: "contact.updated", actor: user, entity: "contact", entityId: before.id, after: { studentId: input.studentId, relation: input.relation, changed } }, tx);
    });
    revalidatePath(`/students/${input.studentId}`);
    return { ok: true, message: changed.whatsapp || changed.email ? "Saved. Consent was reset for the changed number/email; re-confirm it." : "Saved." };
  },
});

export const updateEnrollmentAction = defineAction({
  permission: "data.edit_all",
  schema: z
    .object({
      enrollmentId: zId,
      joinedOn: zDate("Join date"),
      leftOn: zOptDate,
      rollNo: zOpt(20),
      status: z.enum(["ACTIVE", "LEFT", "TRANSFERRED"]),
    })
    .refine((v) => !v.leftOn || new Date(`${v.leftOn}T00:00:00Z`) >= v.joinedOn, { path: ["leftOn"], message: "Can't be before the join date" }),
  run: async (input, { user }) => {
    const before = await db.enrollment.findUnique({ where: { id: input.enrollmentId } });
    if (!before) throw new UserError("Enrolment not found.");
    if (input.status === "ACTIVE" && before.status !== "ACTIVE") {
      const dup = await db.enrollment.findFirst({ where: { studentId: before.studentId, batchId: before.batchId, status: "ACTIVE", id: { not: before.id } } });
      if (dup) throw new UserError("There's already an active enrolment in this batch.");
    }
    const leftOn = input.status === "ACTIVE" ? null : input.leftOn ? new Date(`${input.leftOn}T00:00:00Z`) : (before.leftOn ?? new Date());
    await db.enrollment.update({ where: { id: input.enrollmentId }, data: { joinedOn: input.joinedOn, leftOn, rollNo: input.rollNo ?? null, status: input.status } });
    await audit({
      action: "student.enrollment_updated",
      actor: user,
      entity: "student",
      entityId: before.studentId,
      before: { enrollmentId: before.id, joinedOn: before.joinedOn.toISOString(), leftOn: before.leftOn?.toISOString() ?? null, status: before.status, rollNo: before.rollNo },
      after: { joinedOn: input.joinedOn.toISOString(), leftOn: leftOn?.toISOString() ?? null, status: input.status, rollNo: input.rollNo ?? null },
    });
    revalidatePath(`/students/${before.studentId}`);
    return { ok: true, message: "Enrolment saved." };
  },
});
