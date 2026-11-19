import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineAction, UserError, type ActionState } from "@/core/action";
import { audit } from "@/core/audit";
import { db } from "@/core/db";
import { emit } from "@/core/events";
import { zBool, zDate, zId, zOpt, zOptDate, zOptId, zOptInt, zReq } from "@/core/validation";
import { recipientLabel, resolveAudience } from "@/modules/messages/audience";
import { describeNotify, deliverPending, notifyBatch, notifyMakeup, type NotifyResult, oneLine, queueForAudience } from "@/modules/messages/service";
import { env } from "@/core/env";
import { classStart, whereText } from "@/modules/messages/reminders";
import { contactPII } from "@/modules/students/contacts";
import { ATTENDANCE, classRoster, findClass, getClassRecord } from "./class-record";
import { demoAudience } from "./demo";
import { addDays, dateToYmd, dayShort, fmtDate, fmtRange, isYmd, parseHHMM, todayYmd, weekdayOf, ymdToDate } from "./time";
import { batchClassLabel, findClashes, findDateClashes, type Clashes } from "./timetable";

const durationField = zOptInt(15, 600);

// ─────────────── Academic years ───────────────

export const createYearAction = defineAction({
  permission: "academics.manage",
  schema: z
    .object({ name: zReq("Name", 20), startDate: zDate("Start date"), endDate: zDate("End date"), isCurrent: zBool })
    .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "End must be after start" }),
  run: async (input, { user }) => {
    if (await db.academicYear.findFirst({ where: { name: input.name } })) throw new UserError("A year with that name exists.");
    const year = await db.$transaction(async (tx) => {
      if (input.isCurrent) await tx.academicYear.updateMany({ data: { isCurrent: false } });
      const y = await tx.academicYear.create({ data: input });
      await audit({ action: "academics.year.created", actor: user, entity: "academic_year", entityId: y.id, after: { name: y.name } }, tx);
      return y;
    });
    revalidatePath("/academics");
    redirect(`/academics?year=${year.id}`);
  },
});

// ─────────────── Program / course / batch nodes ───────────────

export const createNodeAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    yearId: zId,
    parentId: zOptId,
    nodeTypeId: zId,
    programTypeId: zOptId,
    name: zReq("Name", 100),
    code: zOpt(30),
    defaultDurationMin: durationField,
  }),
  run: async (input, { user }) => {
    const nodeType = await db.nodeType.findUnique({ where: { id: input.nodeTypeId } });
    if (!nodeType) throw new UserError("Unknown type.");
    let programTypeId = input.programTypeId ?? null;

    if (input.parentId) {
      const parent = await db.programNode.findFirst({ where: { id: input.parentId, yearId: input.yearId, archivedAt: null }, include: { nodeType: true } });
      if (!parent) throw new UserError("Parent not found.");
      if (!nodeType.allowedParentKeys.includes(parent.nodeType.key)) {
        throw new UserError(`A ${nodeType.label} can't be placed under a ${parent.nodeType.label}.`);
      }
      programTypeId = parent.programTypeId; // children inherit the program type
    } else {
      if (nodeType.allowedParentKeys.length > 0) throw new UserError(`A ${nodeType.label} needs a parent.`);
      if (!programTypeId) throw new UserError("Choose a program type (School, Competitive, Professional…).");
    }

    const node = await db.programNode.create({
      data: {
        yearId: input.yearId,
        parentId: input.parentId ?? null,
        nodeTypeId: nodeType.id,
        programTypeId,
        name: input.name,
        code: input.code ?? null,
        defaultDurationMin: input.defaultDurationMin ?? null,
      },
    });
    await audit({ action: "academics.node.created", actor: user, entity: "program_node", entityId: node.id, after: { name: node.name, type: nodeType.key } });
    revalidatePath("/academics");
    redirect(`/academics/${node.id}`);
  },
});

export const updateNodeAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    id: zId,
    name: zReq("Name", 100),
    code: zOpt(30),
    defaultDurationMin: durationField,
    capacity: zOptInt(1, 10000),
    mode: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["offline", "online", "hybrid"]).optional()),
    room: zOpt(40),
  }),
  run: async (input, { user }) => {
    const before = await db.programNode.findUnique({ where: { id: input.id } });
    if (!before || before.archivedAt) throw new UserError("Not found.");
    const attributes = { ...(before.attributes as Record<string, unknown>), capacity: input.capacity ?? null, mode: input.mode ?? null, room: input.room ?? null };
    const node = await db.programNode.update({
      where: { id: input.id },
      data: { name: input.name, code: input.code ?? null, defaultDurationMin: input.defaultDurationMin ?? null, attributes },
    });
    await audit({
      action: "academics.node.updated",
      actor: user,
      entity: "program_node",
      entityId: node.id,
      before: { name: before.name, defaultDurationMin: before.defaultDurationMin },
      after: { name: node.name, defaultDurationMin: node.defaultDurationMin },
    });
    revalidatePath(`/academics/${node.id}`);
    return { ok: true, message: "Saved." };
  },
});

export const archiveNodeAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId }),
  run: async ({ id }, { user }) => {
    const node = await db.programNode.findUnique({
      where: { id },
      include: { _count: { select: { children: { where: { archivedAt: null } }, enrollments: { where: { status: "ACTIVE" } } } } },
    });
    if (!node) throw new UserError("Not found.");
    if (node._count.children > 0) throw new UserError("Archive or move its children first.");
    if (node._count.enrollments > 0) throw new UserError("It still has active students.");
    await db.programNode.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit({ action: "academics.node.archived", actor: user, entity: "program_node", entityId: id, before: { name: node.name } });
    revalidatePath("/academics");
    redirect(`/academics?year=${node.yearId}`);
  },
});

// ─────────────── Subjects ───────────────

export const createSubjectAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    name: zReq("Name", 80),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/, "2–12 letters/digits"),
    boardTags: zOpt(200),
    color: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()),
    defaultDurationMin: durationField,
  }),
  run: async (input, { user }) => {
    if (await db.subject.findFirst({ where: { code: input.code } })) throw new UserError("That code is already used.");
    const subject = await db.subject.create({
      data: {
        name: input.name,
        code: input.code,
        color: input.color ?? null,
        defaultDurationMin: input.defaultDurationMin ?? null,
        boardTags: (input.boardTags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
      },
    });
    await audit({ action: "academics.subject.created", actor: user, entity: "subject", entityId: subject.id, after: { code: subject.code } });
    revalidatePath("/academics/subjects");
    return { ok: true, message: `${subject.name} added.` };
  },
});

export const attachSubjectAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ batchId: zId, subjectId: zId, defaultDurationMin: durationField }),
  run: async (input, { user }) => {
    const batch = await db.programNode.findFirst({ where: { id: input.batchId, archivedAt: null }, include: { nodeType: true } });
    if (!batch?.nodeType.enrollable) throw new UserError("Subjects can only be added to a batch.");
    const exists = await db.batchSubject.findUnique({ where: { batchId_subjectId: { batchId: input.batchId, subjectId: input.subjectId } } });
    if (exists) throw new UserError("That subject is already in this batch.");
    const bs = await db.batchSubject.create({ data: { batchId: input.batchId, subjectId: input.subjectId, defaultDurationMin: input.defaultDurationMin ?? null } });
    await audit({ action: "academics.batch_subject.added", actor: user, entity: "batch_subject", entityId: bs.id, after: { batchId: input.batchId, subjectId: input.subjectId } });
    revalidatePath(`/academics/${input.batchId}`);
    return { ok: true, message: "Subject added." };
  },
});

export const updateBatchSubjectAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId, defaultDurationMin: durationField }),
  run: async ({ id, defaultDurationMin }, { user }) => {
    const bs = await db.batchSubject.update({ where: { id }, data: { defaultDurationMin: defaultDurationMin ?? null } });
    await audit({ action: "academics.batch_subject.updated", actor: user, entity: "batch_subject", entityId: id, after: { defaultDurationMin: bs.defaultDurationMin } });
    revalidatePath(`/academics/${bs.batchId}`);
    return { ok: true, message: "Duration saved." };
  },
});

export const detachSubjectAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId }),
  run: async ({ id }, { user }) => {
    const bs = await db.batchSubject.delete({ where: { id } });
    await audit({ action: "academics.batch_subject.removed", actor: user, entity: "batch_subject", entityId: id, before: { batchId: bs.batchId, subjectId: bs.subjectId } });
    revalidatePath(`/academics/${bs.batchId}`);
  },
});

// ═══════════════ Edit mode (data.edit_all): modify any record ═══════════════

export const updateYearAction = defineAction({
  permission: "data.edit_all",
  schema: z
    .object({ id: zId, name: zReq("Name", 20), startDate: zDate("Start date"), endDate: zDate("End date"), isCurrent: zBool })
    .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "End must be after start" }),
  run: async ({ id, ...input }, { user }) => {
    const before = await db.academicYear.findUnique({ where: { id } });
    if (!before) throw new UserError("Not found.");
    if (await db.academicYear.findFirst({ where: { name: input.name, id: { not: id } } })) throw new UserError("Another year has that name.");
    await db.$transaction(async (tx) => {
      if (input.isCurrent) await tx.academicYear.updateMany({ where: { id: { not: id } }, data: { isCurrent: false } });
      await tx.academicYear.update({ where: { id }, data: input });
      await audit(
        {
          action: "academics.year.updated",
          actor: user,
          entity: "academic_year",
          entityId: id,
          before: { name: before.name, startDate: before.startDate.toISOString(), endDate: before.endDate.toISOString(), isCurrent: before.isCurrent },
          after: { ...input, startDate: input.startDate.toISOString(), endDate: input.endDate.toISOString() },
        },
        tx,
      );
    });
    revalidatePath("/academics");
    return { ok: true, message: "Year saved." };
  },
});

export const archiveYearAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({ id: zId }),
  run: async ({ id }, { user }) => {
    const year = await db.academicYear.findUnique({ where: { id }, include: { _count: { select: { nodes: { where: { archivedAt: null } } } } } });
    if (!year) throw new UserError("Not found.");
    if (year._count.nodes > 0) throw new UserError("Archive this year's programs first.");
    if (year.isCurrent) throw new UserError("Make another year current first.");
    await db.academicYear.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit({ action: "academics.year.archived", actor: user, entity: "academic_year", entityId: id, before: { name: year.name } });
    revalidatePath("/academics");
    redirect("/academics");
  },
});

export const updateSubjectAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({
    id: zId,
    name: zReq("Name", 80),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/, "2–12 letters/digits"),
    boardTags: zOpt(200),
    color: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()),
    defaultDurationMin: durationField,
  }),
  run: async (input, { user }) => {
    const before = await db.subject.findUnique({ where: { id: input.id } });
    if (!before) throw new UserError("Not found.");
    if (await db.subject.findFirst({ where: { code: input.code, id: { not: input.id } } })) throw new UserError("That code is already used.");
    const data = {
      name: input.name,
      code: input.code,
      color: input.color ?? null,
      defaultDurationMin: input.defaultDurationMin ?? null,
      boardTags: (input.boardTags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
    };
    await db.subject.update({ where: { id: input.id }, data });
    await audit({
      action: "academics.subject.updated",
      actor: user,
      entity: "subject",
      entityId: input.id,
      before: { name: before.name, code: before.code, defaultDurationMin: before.defaultDurationMin, boardTags: before.boardTags },
      after: { name: data.name, code: data.code, defaultDurationMin: data.defaultDurationMin, boardTags: data.boardTags },
    });
    revalidatePath("/academics/subjects");
    return { ok: true, message: "Subject saved." };
  },
});

export const archiveSubjectAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({ id: zId }),
  run: async ({ id }, { user }) => {
    const s = await db.subject.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit({ action: "academics.subject.archived", actor: user, entity: "subject", entityId: id, before: { code: s.code } });
    revalidatePath("/academics/subjects");
    redirect("/academics/subjects");
  },
});

/** All descendant ids of a node (bounded depth). */
async function descendantIds(tx: Prisma.TransactionClient, rootId: string): Promise<string[]> {
  const out: string[] = [];
  let frontier = [rootId];
  for (let depth = 0; frontier.length && depth < 20; depth++) {
    const kids = await tx.programNode.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id);
    out.push(...frontier);
  }
  return out;
}

export const moveNodeAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({ id: zId, parentId: zOptId, programTypeId: zOptId }),
  run: async ({ id, parentId, programTypeId }, { user }) => {
    await db.$transaction(async (tx) => {
      const node = await tx.programNode.findFirst({ where: { id, archivedAt: null }, include: { nodeType: true } });
      if (!node) throw new UserError("Not found.");
      const subtree = await descendantIds(tx, id);
      let newProgramTypeId: string | null;

      if (parentId) {
        if (parentId === id || subtree.includes(parentId)) throw new UserError("Can't move something inside itself.");
        const parent = await tx.programNode.findFirst({ where: { id: parentId, yearId: node.yearId, archivedAt: null }, include: { nodeType: true } });
        if (!parent) throw new UserError("New parent not found in this year.");
        if (!node.nodeType.allowedParentKeys.includes(parent.nodeType.key)) throw new UserError(`A ${node.nodeType.label} can't be placed under a ${parent.nodeType.label}.`);
        newProgramTypeId = parent.programTypeId;
      } else {
        if (node.nodeType.allowedParentKeys.length > 0) throw new UserError(`A ${node.nodeType.label} needs a parent.`);
        newProgramTypeId = programTypeId ?? node.programTypeId;
        if (!newProgramTypeId) throw new UserError("Choose a program type.");
      }

      await tx.programNode.update({ where: { id }, data: { parentId: parentId ?? null, programTypeId: newProgramTypeId } });
      if (subtree.length) await tx.programNode.updateMany({ where: { id: { in: subtree } }, data: { programTypeId: newProgramTypeId } });
      await audit(
        {
          action: "academics.node.moved",
          actor: user,
          entity: "program_node",
          entityId: id,
          before: { parentId: node.parentId, programTypeId: node.programTypeId },
          after: { parentId: parentId ?? null, programTypeId: newProgramTypeId, descendantsUpdated: subtree.length },
        },
        tx,
      );
    });
    revalidatePath("/academics");
    revalidatePath(`/academics/${id}`);
    return { ok: true, message: "Moved. Program type applied to everything underneath." };
  },
});

// ═══════════════ Timetable: weekly class slots + one-date changes ═══════════════
// Each weekday can have its own time, e.g. Wed 16:30–18:00 and Fri 18:00–19:30.
// A single date can be rescheduled, cancelled or given an extra class without touching the weekly pattern.
// Every change can notify the batch's students (email + WhatsApp, to contacts who opted in).

const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const zYmd = (label: string) => z.string({ error: `${label} is required` }).refine(isYmd, `${label} must be a date`);

const slotFields = {
  room: zOpt(40),
  mode: z.enum(["offline", "online", "hybrid"]),
  meetingUrl: z.preprocess(blankToUndef, z.url({ protocol: /^https$/, error: "Use an https:// link" }).max(500).optional()),
  effectiveFrom: zDate("Starts from"),
  effectiveTo: zOptDate,
  notes: zOpt(200),
  allowClash: zBool,
  notify: zBool,
};

/** Fields for one dated class (one-time, or one rescheduled occurrence). */
const oneClassFields = {
  date: zYmd("Date"),
  startTime: z.string().max(5),
  endTime: z.string().max(5),
  room: zOpt(40),
  mode: z.enum(["offline", "online", "hybrid"]),
  meetingUrl: slotFields.meetingUrl,
  notes: zOpt(200),
  allowClash: zBool,
  notify: zBool,
};

/** "16:30" + "18:00" → { startMin: 990, durationMin: 90 }, or an error message. */
function toRange(start: unknown, end: unknown): { startMin: number; durationMin: number } | { error: string; field: "start" | "end" } {
  const s = typeof start === "string" ? parseHHMM(start) : null;
  const e = typeof end === "string" ? parseHHMM(end) : null;
  if (s === null) return { error: "Enter a start time", field: "start" };
  if (e === null) return { error: "Enter an end time", field: "end" };
  if (e <= s) return { error: "End must be after start (classes can't cross midnight)", field: "end" };
  if (e - s < 15) return { error: "At least 15 minutes", field: "end" };
  if (e - s > 600) return { error: "At most 10 hours", field: "end" };
  return { startMin: s, durationMin: e - s };
}

const rangeError = (r: { error: string; field: "start" | "end" }): ActionState => ({
  ok: false,
  error: r.error,
  fieldErrors: { [r.field === "start" ? "startTime" : "endTime"]: r.error },
});

function toEffectiveTo(effectiveFrom: Date, effectiveTo?: string): Date | null {
  const to = effectiveTo ? new Date(`${effectiveTo}T00:00:00Z`) : null;
  if (to && to < effectiveFrom) throw new UserError("“Until” can't be before “Starts from”.");
  return to;
}

/** Returns an error state for blocking clashes, or for warnings the user hasn't accepted. */
function clashError(all: { when: string; clashes: Clashes }[], allowClash: boolean): ActionState | null {
  const blocking = all.flatMap((c) => c.clashes.batch.map((b) => `${c.when}: this batch already has ${b}`));
  if (blocking.length) return { ok: false, error: `Time clash. ${blocking.join("; ")}.` };
  const warnings = all.flatMap((c) => [
    ...c.clashes.room,
    ...(c.clashes.students.count ? [`${c.when}: ${c.clashes.students.count} student(s) double-booked, e.g. ${c.clashes.students.examples.join(", ")}`] : []),
  ]);
  if (warnings.length && !allowClash) {
    return { ok: false, error: `Possible clash: ${warnings.join("; ")}. Tick “Save anyway” to keep it.`, fieldErrors: { allowClash: "Confirm to save despite the clash" } };
  }
  return null;
}

/** "Tue, 3 Nov 18:30–20:00 · Room 2 · online" */
function whenText(o: { date?: string; startMin: number; durationMin: number; room?: string | null; mode?: string | null }) {
  return [`${o.date ? `${fmtDate(o.date)} ` : ""}${fmtRange(o.startMin, o.durationMin)}`, o.room, o.mode && o.mode !== "offline" ? o.mode : null].filter(Boolean).join(" · ");
}

function revalidateTimetable(batchId: string) {
  revalidatePath(`/academics/${batchId}`);
  revalidatePath("/academics/timetable");
  revalidatePath("/calendar");
  revalidatePath("/today");
}

/** Queue student notifications in the change's transaction; deliver them after the response. */
async function notifyIf(tx: Prisma.TransactionClient, on: boolean, opts: { batchId: string; batchLabel: string; subject: string; text: string; actorId: string }) {
  if (!on) return null;
  // Parents see "Diya (class 10 · mathematics)", not just the batch name
  const batchLabel = (await batchClassLabel(tx, opts.batchId)) || opts.batchLabel;
  return notifyBatch(tx, { ...opts, batchLabel, reason: "timetable.changed" });
}
function finish(message: string, notified: NotifyResult | null, batchId: string): ActionState {
  revalidateTimetable(batchId);
  if (notified && notified.email + notified.whatsapp > 0) after(() => deliverPending().catch(() => {}));
  return { ok: true, message: `${message} ${describeNotify(notified)}` };
}

type Bs = Prisma.BatchSubjectGetPayload<{ include: { batch: true; subject: true } }>;
async function liveBatchSubject(id: string): Promise<Bs> {
  const bs = await db.batchSubject.findUnique({ where: { id }, include: { batch: true, subject: true } });
  if (!bs || bs.batch.archivedAt) throw new UserError("Subject not found in this batch.");
  return bs;
}

/** Creates weekly slots (one per day) after clash checks. Shared by both "add" forms. */
async function createWeekly(
  bs: Bs,
  entries: { weekday: number; startMin: number; durationMin: number }[],
  input: { room?: string; mode: string; meetingUrl?: string; notes?: string; effectiveFrom: Date; effectiveTo: Date | null; allowClash: boolean; notify: boolean },
  user: { id: string; name: string },
): Promise<ActionState> {
  const common = { batchId: bs.batchId, room: input.room ?? null, mode: input.mode, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo };
  const clashes = await Promise.all(entries.map(async (e) => ({ when: dayShort(e.weekday), clashes: await findClashes({ ...common, ...e }) })));
  const err = clashError(clashes, input.allowClash);
  if (err) return err;

  const summary = entries.map((e) => `${dayShort(e.weekday)} ${fmtRange(e.startMin, e.durationMin)}`);
  const from = dateToYmd(input.effectiveFrom);
  const notified = await db.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.timetableSlot.create({ data: { ...common, ...e, batchSubjectId: bs.id, meetingUrl: input.meetingUrl ?? null, notes: input.notes ?? null } });
    }
    await emit(tx, "timetable.changed", { batchId: bs.batchId });
    await audit(
      {
        action: "academics.timetable.slots_created",
        actor: user,
        entity: "program_node",
        entityId: bs.batchId,
        after: { subject: bs.subject.code, slots: summary, from, room: common.room, mode: common.mode, clashAccepted: input.allowClash },
      },
      tx,
    );
    return notifyIf(tx, input.notify, {
      batchId: bs.batchId,
      batchLabel: bs.batch.name,
      actorId: user.id,
      subject: `New weekly ${bs.subject.name} class`,
      text: `New weekly ${bs.subject.name} class: every ${summary.join(", ")}${common.room ? ` · ${common.room}` : ""}, starting ${fmtDate(from)}.`,
    });
  });
  return finish(`${bs.subject.name}: ${summary.join(", ")} added.`, notified, bs.batchId);
}

/** Batch page form: several weekdays at once, each with its own time (start_<day> / end_<day>). */
export const createSlotsAction = defineAction({
  permission: "academics.manage",
  schema: z.looseObject({
    batchSubjectId: zId,
    weekdays: z.array(z.coerce.number().int().min(1).max(7), { error: "Pick at least one day" }).min(1, "Pick at least one day").max(7),
    ...slotFields,
  }),
  run: async (input, { user }) => {
    const bs = await liveBatchSubject(input.batchSubjectId);
    const effectiveTo = toEffectiveTo(input.effectiveFrom, input.effectiveTo);
    const days = [...new Set(input.weekdays)].sort((a, b) => a - b);

    const fieldErrors: Record<string, string> = {};
    const entries: { weekday: number; startMin: number; durationMin: number }[] = [];
    for (const day of days) {
      const r = toRange(input[`start_${day}`], input[`end_${day}`]);
      if ("error" in r) fieldErrors[`${r.field}_${day}`] = r.error;
      else entries.push({ weekday: day, ...r });
    }
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Check the times for the highlighted days.", fieldErrors };
    return createWeekly(bs, entries, { ...input, effectiveTo }, user);
  },
});

/** Calendar "Add class": just once on a date, or every week on that weekday from that date. */
export const addClassAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ batchSubjectId: zId, repeat: z.enum(["once", "weekly"]), effectiveTo: zOptDate, ...oneClassFields }),
  run: async (input, { user }) => {
    const bs = await liveBatchSubject(input.batchSubjectId);
    const r = toRange(input.startTime, input.endTime);
    if ("error" in r) return rangeError(r);

    if (input.repeat === "weekly") {
      const effectiveFrom = ymdToDate(input.date);
      return createWeekly(bs, [{ weekday: weekdayOf(input.date), ...r }], { ...input, effectiveFrom, effectiveTo: toEffectiveTo(effectiveFrom, input.effectiveTo) }, user);
    }

    const cls = { batchId: bs.batchId, date: input.date, ...r, room: input.room ?? null, mode: input.mode };
    const err = clashError([{ when: fmtDate(input.date), clashes: await findDateClashes(cls) }], input.allowClash);
    if (err) return err;
    const when = whenText(cls);
    const notified = await db.$transaction(async (tx) => {
      await tx.classDateChange.create({
        data: { kind: "extra", batchSubjectId: bs.id, batchId: bs.batchId, date: ymdToDate(input.date), ...r, room: cls.room, mode: cls.mode, meetingUrl: input.meetingUrl ?? null, notes: input.notes ?? null },
      });
      await emit(tx, "timetable.changed", { batchId: bs.batchId });
      await audit({ action: "academics.timetable.extra_class_added", actor: user, entity: "program_node", entityId: bs.batchId, after: { subject: bs.subject.code, when, clashAccepted: input.allowClash } }, tx);
      return notifyIf(tx, input.notify, {
        batchId: bs.batchId,
        batchLabel: bs.batch.name,
        actorId: user.id,
        subject: `Extra ${bs.subject.name} class on ${fmtDate(input.date)}`,
        text: `Extra ${bs.subject.name} class: ${when}.${input.notes ? ` Note: ${input.notes}` : ""}`,
      });
    });
    return finish(`Extra ${bs.subject.name} class on ${when} added.`, notified, bs.batchId);
  },
});

/** The weekly slot behind an occurrence, checked to really fall on that date. */
async function slotOn(slotId: string, slotDate: string) {
  const slot = await db.timetableSlot.findUnique({ where: { id: slotId }, include: { batchSubject: { include: { subject: true } }, batch: true } });
  if (!slot) throw new UserError("Class not found.");
  const ok = weekdayOf(slotDate) === slot.weekday && dateToYmd(slot.effectiveFrom) <= slotDate && (!slot.effectiveTo || dateToYmd(slot.effectiveTo) >= slotDate);
  if (!ok) throw new UserError("That weekly class doesn't happen on that date.");
  return slot;
}

/** Identifies one dated class: an existing change row, or a weekly slot on a date. */
const oneRef = {
  changeId: zOptId,
  slotId: zOptId,
  slotDate: z.preprocess(blankToUndef, zYmd("Class date").optional()),
};
type OneRef = { changeId?: string; slotId?: string; slotDate?: string };

async function loadOne(ref: OneRef) {
  if (ref.changeId) {
    const change = await db.classDateChange.findUnique({ where: { id: ref.changeId }, include: { batchSubject: { include: { subject: true } }, batch: true, slot: true } });
    if (!change) throw new UserError("Class not found.");
    // What the class was before this edit (for the message): the change itself, or the weekly time it replaced
    const was =
      change.kind !== "cancelled" && change.date && change.startMin != null && change.durationMin != null
        ? { date: dateToYmd(change.date), startMin: change.startMin, durationMin: change.durationMin, room: change.room, mode: change.mode }
        : change.slot && change.slotDate
          ? { date: dateToYmd(change.slotDate), startMin: change.slot.startMin, durationMin: change.slot.durationMin, room: change.slot.room, mode: change.slot.mode }
          : null;
    return { change, slot: change.slot, batchId: change.batchId, batchName: change.batch.name, subject: change.batchSubject.subject, batchSubjectId: change.batchSubjectId, was };
  }
  if (!ref.slotId || !ref.slotDate) throw new UserError("Class not found.");
  const slot = await slotOn(ref.slotId, ref.slotDate);
  const existing = await db.classDateChange.findUnique({ where: { slotId_slotDate: { slotId: slot.id, slotDate: ymdToDate(ref.slotDate) } } });
  if (existing) return loadOne({ changeId: existing.id });
  return {
    change: null,
    slot,
    batchId: slot.batchId,
    batchName: slot.batch.name,
    subject: slot.batchSubject.subject,
    batchSubjectId: slot.batchSubjectId,
    was: { date: ref.slotDate, startMin: slot.startMin, durationMin: slot.durationMin, room: slot.room, mode: slot.mode },
  };
}

/** Reschedule just one class: a one-time class, or one date of a weekly class (the rest of the series is unchanged). */
export const rescheduleOneAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ ...oneRef, ...oneClassFields }),
  run: async (input, { user }) => {
    const one = await loadOne(input);
    const r = toRange(input.startTime, input.endTime);
    if ("error" in r) return rangeError(r);
    const cls = { batchId: one.batchId, date: input.date, ...r, room: input.room ?? null, mode: input.mode };
    const exclude = { changeId: one.change?.id, slotId: one.slot?.id ?? one.change?.slotId, slotDate: one.change?.slotDate ? dateToYmd(one.change.slotDate) : input.slotDate };
    const err = clashError([{ when: fmtDate(input.date), clashes: await findDateClashes(cls, exclude) }], input.allowClash);
    if (err) return err;

    const data = { date: ymdToDate(input.date), ...r, room: cls.room, mode: cls.mode, meetingUrl: input.meetingUrl ?? null, notes: input.notes ?? null };
    const before = one.was ? whenText(one.was) : "cancelled";
    const now = whenText(cls);
    const notified = await db.$transaction(async (tx) => {
      if (one.change) await tx.classDateChange.update({ where: { id: one.change.id }, data: { ...data, kind: one.change.kind === "extra" ? "extra" : "moved" } });
      else await tx.classDateChange.create({ data: { ...data, kind: "moved", batchSubjectId: one.batchSubjectId, batchId: one.batchId, slotId: one.slot!.id, slotDate: ymdToDate(input.slotDate!) } });
      await emit(tx, "timetable.changed", { batchId: one.batchId });
      await audit({ action: "academics.timetable.class_rescheduled", actor: user, entity: "program_node", entityId: one.batchId, before: { subject: one.subject.code, when: before }, after: { when: now, clashAccepted: input.allowClash } }, tx);
      return notifyIf(tx, input.notify, {
        batchId: one.batchId,
        batchLabel: one.batchName,
        actorId: user.id,
        subject: `${one.subject.name} class rescheduled`,
        text: `${one.subject.name} class on ${before} is rescheduled to ${now}.${input.notes ? ` Note: ${input.notes}` : ""}`,
      });
    });
    return finish(`${one.subject.name} rescheduled to ${now}.`, notified, one.batchId);
  },
});

const makeupFields = {
  reason: z.enum(["teacher", "holiday", "other"]).default("teacher"),
  makeupRequired: zBool,
  makeup: z.enum(["later", "now"]).default("later"),
  makeupDate: z.preprocess(blankToUndef, zYmd("Make-up date").optional()),
  startTime: z.string().max(5).optional(),
  endTime: z.string().max(5).optional(),
  room: zOpt(40),
  mode: z.enum(["offline", "online", "hybrid"]).default("offline"),
  meetingUrl: slotFields.meetingUrl,
  allowClash: zBool,
};

/**
 * Remove just one class. A one-time class is deleted. One date of a weekly class is cancelled with a reason;
 * a class Rahul cancels is owed as a make-up (until an extra class is linked to it), and the make-up can be
 * scheduled right away: students then get one message with both.
 */
export const removeOneAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ ...oneRef, notify: zBool, ...makeupFields }),
  run: async (input, { user }) => {
    const one = await loadOne(input);
    if (one.change?.kind === "cancelled") return { ok: true, message: "That class is already cancelled." };
    const was = one.was ? whenText(one.was) : "";
    const label = (await batchClassLabel(db, one.batchId)) || one.batchName;

    if (one.change?.kind === "extra") {
      const extra = one.change;
      const notified = await db.$transaction(async (tx) => {
        await tx.classDateChange.delete({ where: { id: extra.id } }); // a make-up removed: its cancelled class is owed again
        await emit(tx, "timetable.changed", { batchId: one.batchId });
        await audit({ action: "academics.timetable.class_cancelled", actor: user, entity: "program_node", entityId: one.batchId, before: { subject: one.subject.code, when: was } }, tx);
        return notifyIf(tx, input.notify, { batchId: one.batchId, batchLabel: one.batchName, actorId: user.id, subject: `${one.subject.name} class cancelled`, text: `${one.subject.name} class on ${was} is cancelled.` });
      });
      const owedAgain = extra.makeupForId ? " It was a make-up, so the original class is owed again (see Today)." : "";
      return finish(`${one.subject.name} on ${was} removed.${owedAgain}`, notified, one.batchId);
    }

    const makeupRequired = input.makeup === "now" || input.makeupRequired;
    let makeup: { date: string; startMin: number; durationMin: number; room: string | null; mode: string } | null = null;
    if (input.makeup === "now") {
      if (!input.makeupDate) return { ok: false, error: "Pick the make-up date.", fieldErrors: { makeupDate: "Pick a date" } };
      const r = toRange(input.startTime, input.endTime);
      if ("error" in r) return rangeError(r);
      makeup = { date: input.makeupDate, ...r, room: input.room ?? null, mode: input.mode };
      const exclude = { slotId: one.slot?.id, slotDate: input.slotDate ?? (one.change?.slotDate ? dateToYmd(one.change.slotDate) : undefined), changeId: one.change?.id };
      const err = clashError([{ when: fmtDate(makeup.date), clashes: await findDateClashes({ batchId: one.batchId, ...makeup }, exclude) }], input.allowClash);
      if (err) return err;
    }
    const makeupText = makeup ? whenText(makeup) : "";
    const originalDate = one.was?.date ?? input.slotDate ?? "";

    const notified = await db.$transaction(async (tx) => {
      const cancelled = { kind: "cancelled", date: null, startMin: null, durationMin: null, room: null, mode: null, meetingUrl: null, reason: input.reason, makeupRequired };
      const row = one.change
        ? await tx.classDateChange.update({ where: { id: one.change.id }, data: cancelled })
        : await tx.classDateChange.create({ data: { ...cancelled, batchSubjectId: one.batchSubjectId, batchId: one.batchId, slotId: one.slot!.id, slotDate: ymdToDate(input.slotDate!) } });
      if (makeup) {
        await tx.classDateChange.create({
          data: {
            kind: "extra",
            batchSubjectId: one.batchSubjectId,
            batchId: one.batchId,
            date: ymdToDate(makeup.date),
            startMin: makeup.startMin,
            durationMin: makeup.durationMin,
            room: makeup.room,
            mode: makeup.mode,
            meetingUrl: input.meetingUrl ?? null,
            notes: `Make-up for the ${fmtDate(originalDate)} class`,
            makeupForId: row.id,
          },
        });
      }
      await emit(tx, "timetable.changed", { batchId: one.batchId });
      await audit(
        {
          action: "academics.timetable.class_cancelled",
          actor: user,
          entity: "program_node",
          entityId: one.batchId,
          before: { subject: one.subject.code, when: was },
          after: { reason: input.reason, makeupRequired, makeup: makeupText || null },
        },
        tx,
      );
      if (!input.notify) return null;
      if (makeup) return notifyMakeup(tx, { batchId: one.batchId, batchLabel: label, subjectName: one.subject.name, was, makeup: makeupText, actorId: user.id });
      return notifyIf(tx, true, {
        batchId: one.batchId,
        batchLabel: one.batchName,
        actorId: user.id,
        subject: `${one.subject.name} class cancelled`,
        text: `${one.subject.name} class on ${was} is cancelled.${makeupRequired ? " A make-up class will be scheduled; the date will be shared soon." : ""}`,
      });
    });
    const tail = makeup ? ` Make-up on ${makeupText}.` : makeupRequired ? " Make-up owed: it's on the Today page until you schedule it." : "";
    revalidatePath("/reports/classes");
    return finish(`${one.subject.name} on ${was} cancelled.${tail}`, notified, one.batchId);
  },
});

/** Schedule the make-up for a class that was cancelled earlier (from the Today page's "make-up owed" list). */
export const scheduleMakeupAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    cancelledId: zId,
    date: zYmd("Date"),
    startTime: z.string().max(5),
    endTime: z.string().max(5),
    room: zOpt(40),
    mode: z.enum(["offline", "online", "hybrid"]).default("offline"),
    meetingUrl: slotFields.meetingUrl,
    allowClash: zBool,
    notify: zBool,
  }),
  run: async (input, { user }) => {
    const c = await db.classDateChange.findUnique({
      where: { id: input.cancelledId },
      include: { slot: true, batch: true, batchSubject: { include: { subject: true } }, makeups: { select: { id: true } } },
    });
    if (!c || c.kind !== "cancelled" || !c.slot || !c.slotDate) throw new UserError("Cancelled class not found.");
    if (c.makeups.length) return { ok: true, message: "A make-up is already scheduled for that class." };
    const r = toRange(input.startTime, input.endTime);
    if ("error" in r) return rangeError(r);
    const cls = { batchId: c.batchId, date: input.date, ...r, room: input.room ?? null, mode: input.mode };
    const err = clashError([{ when: fmtDate(input.date), clashes: await findDateClashes(cls) }], input.allowClash);
    if (err) return err;
    const original = dateToYmd(c.slotDate);
    const was = whenText({ date: original, startMin: c.slot.startMin, durationMin: c.slot.durationMin });
    const now = whenText(cls);
    const subject = c.batchSubject.subject.name;
    const label = (await batchClassLabel(db, c.batchId)) || c.batch.name;
    const notified = await db.$transaction(async (tx) => {
      await tx.classDateChange.update({ where: { id: c.id }, data: { makeupRequired: true } });
      await tx.classDateChange.create({
        data: {
          kind: "extra",
          batchSubjectId: c.batchSubjectId,
          batchId: c.batchId,
          date: ymdToDate(input.date),
          ...r,
          room: cls.room,
          mode: cls.mode,
          meetingUrl: input.meetingUrl ?? null,
          notes: `Make-up for the ${fmtDate(original)} class`,
          makeupForId: c.id,
        },
      });
      await emit(tx, "timetable.changed", { batchId: c.batchId });
      await audit({ action: "academics.timetable.makeup_scheduled", actor: user, entity: "program_node", entityId: c.batchId, after: { subject: c.batchSubject.subject.code, for: was, when: now } }, tx);
      return input.notify ? notifyMakeup(tx, { batchId: c.batchId, batchLabel: label, subjectName: subject, was, makeup: now, actorId: user.id }) : null;
    });
    revalidatePath("/reports/classes");
    return finish(`Make-up for ${subject} (${was}) scheduled on ${now}.`, notified, c.batchId);
  },
});

/** "No make-up needed" for a cancelled class (e.g. the topic was covered in another class). */
export const waiveMakeupAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ cancelledId: zId }),
  run: async ({ cancelledId }, { user }) => {
    const { count } = await db.classDateChange.updateMany({ where: { id: cancelledId, kind: "cancelled" }, data: { makeupRequired: false } });
    if (count) await audit({ action: "academics.timetable.makeup_waived", actor: user, entity: "class_date_change", entityId: cancelledId });
    revalidatePath("/today");
    revalidatePath("/reports/classes");
    return { ok: true, message: "Marked as no make-up needed." };
  },
});

/** Undo a one-date change to a weekly class: it goes back to its usual time on its usual date. */
export const restoreOneAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ changeId: zId, notify: zBool }),
  run: async (input, { user }) => {
    const change = await db.classDateChange.findUnique({ where: { id: input.changeId }, include: { slot: true, batch: true, batchSubject: { include: { subject: true } } } });
    if (!change?.slot || !change.slotDate) throw new UserError("Only a rescheduled or cancelled weekly class can be restored.");
    const usual = whenText({ date: dateToYmd(change.slotDate), startMin: change.slot.startMin, durationMin: change.slot.durationMin, room: change.slot.room, mode: change.slot.mode });
    const subject = change.batchSubject.subject.name;
    const notified = await db.$transaction(async (tx) => {
      await tx.classDateChange.delete({ where: { id: change.id } });
      await emit(tx, "timetable.changed", { batchId: change.batchId });
      await audit({ action: "academics.timetable.class_restored", actor: user, entity: "program_node", entityId: change.batchId, after: { subject: change.batchSubject.subject.code, when: usual } }, tx);
      return notifyIf(tx, input.notify, {
        batchId: change.batchId,
        batchLabel: change.batch.name,
        actorId: user.id,
        subject: `${subject} class back to its usual time`,
        text: `${subject} class is back to its usual time: ${usual}.`,
      });
    });
    return finish(`${subject} is back to ${usual}.`, notified, change.batchId);
  },
});

/** Change the whole weekly series. */
export const updateSlotAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId, weekday: z.coerce.number().int().min(1).max(7), startTime: z.string().max(5), endTime: z.string().max(5), ...slotFields }),
  run: async (input, { user }) => {
    const before = await db.timetableSlot.findUnique({ where: { id: input.id }, include: { batchSubject: { include: { subject: true } }, batch: true } });
    if (!before) throw new UserError("Class slot not found.");
    const r = toRange(input.startTime, input.endTime);
    if ("error" in r) return rangeError(r);
    const effectiveTo = toEffectiveTo(input.effectiveFrom, input.effectiveTo);
    const next = { batchId: before.batchId, weekday: input.weekday, ...r, room: input.room ?? null, mode: input.mode, effectiveFrom: input.effectiveFrom, effectiveTo };
    const err = clashError([{ when: dayShort(input.weekday), clashes: await findClashes(next, before.id) }], input.allowClash);
    if (err) return err;

    const subject = before.batchSubject.subject.name;
    const was = `every ${dayShort(before.weekday)} ${whenText(before)}`;
    const now = `every ${dayShort(next.weekday)} ${whenText(next)}`;
    const notified = await db.$transaction(async (tx) => {
      await tx.timetableSlot.update({ where: { id: before.id }, data: { ...next, meetingUrl: input.meetingUrl ?? null, notes: input.notes ?? null } });
      // One-date changes are tied to the old weekday's dates; upcoming ones no longer match the series.
      if (next.weekday !== before.weekday) await tx.classDateChange.deleteMany({ where: { slotId: before.id, slotDate: { gte: ymdToDate(todayYmd()) } } });
      await emit(tx, "timetable.changed", { batchId: before.batchId });
      await audit(
        {
          action: "academics.timetable.slot_updated",
          actor: user,
          entity: "program_node",
          entityId: before.batchId,
          before: { subject: before.batchSubject.subject.code, day: dayShort(before.weekday), time: fmtRange(before.startMin, before.durationMin), room: before.room, mode: before.mode },
          after: { day: dayShort(next.weekday), time: fmtRange(r.startMin, r.durationMin), room: next.room, mode: next.mode, clashAccepted: input.allowClash },
        },
        tx,
      );
      return notifyIf(tx, input.notify, {
        batchId: before.batchId,
        batchLabel: before.batch.name,
        actorId: user.id,
        subject: `${subject} weekly timing changed`,
        text: `${subject} weekly class changes from ${was} to ${now}, from ${fmtDate(dateToYmd(input.effectiveFrom))}.`,
      });
    });
    return finish("Weekly class saved.", notified, before.batchId);
  },
});

/** Ends a slot after a date but keeps it on record (history for attendance later). */
export const endSlotAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId, endOn: zDate("Last day"), notify: zBool }),
  run: async ({ id, endOn, notify }, { user }) => {
    const slot = await db.timetableSlot.findUnique({ where: { id }, include: { batchSubject: { include: { subject: true } }, batch: true } });
    if (!slot) throw new UserError("Class slot not found.");
    if (endOn < slot.effectiveFrom) throw new UserError("Last day can't be before the slot starts. Delete it instead.");
    const subject = slot.batchSubject.subject.name;
    const notified = await db.$transaction(async (tx) => {
      await tx.timetableSlot.update({ where: { id }, data: { effectiveTo: endOn } });
      await tx.classDateChange.deleteMany({ where: { slotId: id, slotDate: { gt: endOn } } });
      await emit(tx, "timetable.changed", { batchId: slot.batchId });
      await audit({ action: "academics.timetable.slot_ended", actor: user, entity: "program_node", entityId: slot.batchId, after: { slotId: id, endOn: dateToYmd(endOn) } }, tx);
      return notifyIf(tx, notify, {
        batchId: slot.batchId,
        batchLabel: slot.batch.name,
        actorId: user.id,
        subject: `${subject} weekly class ending`,
        text: `${subject} class every ${dayShort(slot.weekday)} ${whenText(slot)} ends after ${fmtDate(dateToYmd(endOn))}.`,
      });
    });
    return finish("Slot ends on that date.", notified, slot.batchId);
  },
});

/** Remove a weekly class from a date onwards (earlier classes stay on record). */
export const removeFollowingAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId, fromDate: zYmd("From"), notify: zBool }),
  run: async ({ id, fromDate, notify }, { user }) => {
    const slot = await db.timetableSlot.findUnique({ where: { id }, include: { batchSubject: { include: { subject: true } }, batch: true } });
    if (!slot) throw new UserError("Class slot not found.");
    const subject = slot.batchSubject.subject.name;
    const lastDay = addDays(fromDate, -1);
    const wholeSeries = lastDay < dateToYmd(slot.effectiveFrom);
    const notified = await db.$transaction(async (tx) => {
      if (wholeSeries) await tx.timetableSlot.delete({ where: { id } });
      else {
        await tx.timetableSlot.update({ where: { id }, data: { effectiveTo: ymdToDate(lastDay) } });
        await tx.classDateChange.deleteMany({ where: { slotId: id, slotDate: { gte: ymdToDate(fromDate) } } });
      }
      await emit(tx, "timetable.changed", { batchId: slot.batchId });
      await audit(
        { action: wholeSeries ? "academics.timetable.slot_deleted" : "academics.timetable.slot_ended", actor: user, entity: "program_node", entityId: slot.batchId, before: { subject: slot.batchSubject.subject.code, day: dayShort(slot.weekday), time: fmtRange(slot.startMin, slot.durationMin) }, after: { from: fromDate } },
        tx,
      );
      return notifyIf(tx, notify, {
        batchId: slot.batchId,
        batchLabel: slot.batch.name,
        actorId: user.id,
        subject: `${subject} weekly class stopped`,
        text: `${subject} class every ${dayShort(slot.weekday)} ${whenText(slot)} will not happen from ${fmtDate(fromDate)} onwards.`,
      });
    });
    return finish(`${subject} every ${dayShort(slot.weekday)} removed from ${fmtDate(fromDate)} on.`, notified, slot.batchId);
  },
});

/** Delete the whole weekly series, including its past dates and one-date changes. */
export const deleteSlotAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId, notify: zBool }),
  run: async ({ id, notify }, { user }) => {
    const slot = await db.timetableSlot.findUnique({ where: { id }, include: { batchSubject: { include: { subject: true } }, batch: true } });
    if (!slot) throw new UserError("Class slot not found.");
    const subject = slot.batchSubject.subject.name;
    const notified = await db.$transaction(async (tx) => {
      await tx.timetableSlot.delete({ where: { id } });
      await emit(tx, "timetable.changed", { batchId: slot.batchId });
      await audit(
        {
          action: "academics.timetable.slot_deleted",
          actor: user,
          entity: "program_node",
          entityId: slot.batchId,
          before: { subject: slot.batchSubject.subject.code, day: dayShort(slot.weekday), time: fmtRange(slot.startMin, slot.durationMin), room: slot.room },
        },
        tx,
      );
      return notifyIf(tx, notify && (!slot.effectiveTo || dateToYmd(slot.effectiveTo) >= todayYmd()), {
        batchId: slot.batchId,
        batchLabel: slot.batch.name,
        actorId: user.id,
        subject: `${subject} weekly class removed`,
        text: `${subject} class every ${dayShort(slot.weekday)} ${whenText(slot)} is removed from the timetable.`,
      });
    });
    return finish("Class removed.", notified, slot.batchId);
  },
});

// ─────────────── One class: notes, homework, attendance ───────────────

const classRef = { classKey: z.string().min(3).max(80), batchId: zId, date: z.string().refine(isYmd, "Invalid date") };

async function classOrThrow(batchId: string, date: string, classKey: string) {
  const occ = await findClass(batchId, date, classKey);
  if (!occ) throw new UserError("That class isn't on the timetable any more. Refresh the calendar.");
  return occ;
}

/** Data for the Notes & homework and Attendance tabs of a class. */
export const loadClassAction = defineAction({
  permission: "academics.view",
  schema: z.object(classRef),
  run: async ({ classKey, batchId, date }) => {
    await classOrThrow(batchId, date, classKey);
    const [rec, roster] = await Promise.all([getClassRecord(classKey), classRoster(batchId, date)]);
    const marks = new Map(rec?.attendance.map((a) => [a.studentId, a.status]) ?? []);
    return {
      ok: true,
      data: {
        notes: rec?.notes ?? "",
        homework: rec?.homework ?? "",
        homeworkDue: rec?.homeworkDue ? dateToYmd(rec.homeworkDue) : "",
        sentAt: rec?.sentAt?.toISOString() ?? null,
        attendanceTakenAt: rec?.attendanceTakenAt?.toISOString() ?? null,
        roster: roster.map((s) => ({ ...s, status: marks.get(s.id) ?? null })),
        canMark: date <= todayYmd(),
      },
    };
  },
});

export const saveClassNotesAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    ...classRef,
    notes: z.string().trim().max(1000, "Keep it under 1000 characters"),
    homework: z.string().trim().max(600, "Keep it under 600 characters"),
    homeworkDue: z.preprocess((v) => (v === "" ? undefined : v), z.string().refine(isYmd, "Pick a date").optional()),
    send: zBool,
  }),
  run: async (input, { user }): Promise<ActionState> => {
    const occ = await classOrThrow(input.batchId, input.date, input.classKey);
    if (input.send && !input.notes && !input.homework) return { ok: false, error: "Write the notes or the homework first.", fieldErrors: { notes: "Nothing to send" } };
    if (input.homeworkDue && input.homeworkDue < input.date) return { ok: false, error: "Submit-by date is before the class.", fieldErrors: { homeworkDue: "Pick a date on or after the class" } };
    const label = (await batchClassLabel(db, occ.batchId)) || occ.batchName;
    const classDate = fmtDate(input.date);
    const notes = oneLine(input.notes);
    const hw = oneLine(input.homework);
    const due = input.homeworkDue ? fmtDate(input.homeworkDue) : "";
    const hwText = hw ? `${hw}${due ? ` (submit by ${due})` : ""}` : "No homework this time";

    const out = await db.$transaction(async (tx) => {
      const data = {
        notes: input.notes || null,
        homework: input.homework || null,
        homeworkDue: input.homeworkDue ? ymdToDate(input.homeworkDue) : null,
        date: ymdToDate(input.date),
        startMin: occ.startMin,
        batchSubjectId: occ.batchSubjectId,
        updatedById: user.id,
        ...(input.send ? { sentAt: new Date() } : {}),
      };
      const rec = await tx.classRecord.upsert({
        where: { classKey: input.classKey },
        update: data,
        create: { ...data, classKey: input.classKey, batchId: occ.batchId, createdById: user.id },
      });
      if (!input.send) return { rec, sent: null };
      const spec = { batchIds: [occ.batchId], groupIds: [] as string[], studentIds: [] as string[], who: "students" as const };
      const audience = await resolveAudience(tx, spec);
      if (!audience.recipients.length) throw new UserError("Nothing sent: no student in this batch has WhatsApp or email consent. Notes not saved either; untick “Send” to just save them.");
      const homeworkOnly = !notes;
      const campaign = await tx.campaign.create({
        data: {
          purpose: homeworkOnly ? "homework" : "class_summary",
          title: `${homeworkOnly ? "Homework" : "Class notes"} · ${label} · ${occ.subjectName} · ${classDate}`,
          audience: spec,
          skipped: audience.skipped,
          createdById: user.id,
        },
      });
      const sent = await queueForAudience(tx, audience, {
        purpose: homeworkOnly ? "homework" : "summary",
        reason: homeworkOnly ? "homework" : "class.summary",
        actorId: user.id,
        batchId: occ.batchId,
        campaignId: campaign.id,
        render: (r) => {
          const who = recipientLabel(r, label);
          return homeworkOnly
            ? {
                subject: `Homework: ${occ.subjectName} (${label})`,
                lines: [`Homework has been assigned for ${who} · ${occ.subjectName}.`, "", `Homework: ${hw}`, `Submit by: ${due || "the next class"}`, "", "Please complete it before the next class."],
                params: [`${who} · ${occ.subjectName}`, hw, due || "the next class"],
              }
            : {
                subject: `${occ.subjectName} class notes, ${classDate}`,
                lines: [`Here are the notes from the ${occ.subjectName} class for ${who} on ${classDate}.`, "", `Covered in class: ${notes}`, "", `Homework: ${hwText}`, "", "Please revise and complete the homework before the next class."],
                params: [occ.subjectName, who, classDate, notes, hwText],
              };
        },
      });
      await audit(
        { action: "academics.class.notes_sent", actor: user, entity: "class_record", entityId: rec.id, after: { classKey: input.classKey, whatsapp: sent.whatsapp, email: sent.email, skipped: audience.skipped.length } },
        tx,
      );
      return { rec, sent };
    });

    if (out.sent) after(() => deliverPending().catch(() => {}));
    revalidatePath("/messages");
    revalidateTimetable(occ.batchId); // calendar dots
    if (!out.sent) return { ok: true, message: "Notes saved (not sent)." };
    const skipped = out.sent.noConsent ? ` ${out.sent.noConsent} student(s) skipped: no WhatsApp or email consent.` : "";
    return { ok: true, message: `Notes saved and sent to students: ${out.sent.whatsapp} WhatsApp, ${out.sent.email} email${out.sent.email === 1 ? "" : "s"}.${skipped}` };
  },
});

export const saveAttendanceAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    ...classRef,
    studentIds: z.array(zId).max(300).default([]),
    statuses: z.array(z.enum(ATTENDANCE)).max(300).default([]),
  }),
  run: async (input, { user }) => {
    const occ = await classOrThrow(input.batchId, input.date, input.classKey);
    if (input.date > todayYmd()) throw new UserError("Attendance can be taken on or after the class date.");
    if (input.studentIds.length !== input.statuses.length) throw new UserError("Invalid attendance form. Reload and try again.");
    const roster = new Set((await classRoster(occ.batchId, input.date)).map((s) => s.id));
    const marks = input.studentIds.map((id, i) => ({ studentId: id, status: input.statuses[i]! })).filter((m) => roster.has(m.studentId));
    if (!marks.length) throw new UserError("No students in this batch on that date.");

    await db.$transaction(async (tx) => {
      const rec = await tx.classRecord.upsert({
        where: { classKey: input.classKey },
        update: { attendanceTakenAt: new Date(), updatedById: user.id, date: ymdToDate(input.date), startMin: occ.startMin },
        create: {
          classKey: input.classKey,
          batchId: occ.batchId,
          batchSubjectId: occ.batchSubjectId,
          date: ymdToDate(input.date),
          startMin: occ.startMin,
          attendanceTakenAt: new Date(),
          createdById: user.id,
        },
      });
      for (const m of marks) {
        await tx.attendance.upsert({
          where: { classRecordId_studentId: { classRecordId: rec.id, studentId: m.studentId } },
          update: { status: m.status, markedById: user.id },
          create: { classRecordId: rec.id, studentId: m.studentId, status: m.status, markedById: user.id },
        });
      }
      await audit(
        {
          action: "academics.class.attendance",
          actor: user,
          entity: "class_record",
          entityId: rec.id,
          after: { classKey: input.classKey, absent: marks.filter((m) => m.status === "absent").length, late: marks.filter((m) => m.status === "late").length, total: marks.length },
        },
        tx,
      );
    });
    revalidatePath("/students", "layout");
    revalidateTimetable(occ.batchId); // calendar dots
    const absent = marks.filter((m) => m.status === "absent").length;
    const late = marks.filter((m) => m.status === "late").length;
    return { ok: true, message: `Attendance saved: ${marks.length - absent - late} present${late ? `, ${late} late` : ""}, ${absent} absent.` };
  },
});

// ─────────────── Demo classes ───────────────

const demoText = (d: { subject: string; date: string; startMin: number; durationMin: number; room?: string | null; mode: string; meetingUrl?: string | null }) =>
  `${fmtDate(d.date)} ${fmtRange(d.startMin, d.durationMin)}. Where: ${whereText({ mode: d.mode, room: d.room ?? null, meetingUrl: d.meetingUrl ?? null })}`;

/** A trial class for someone who isn't a student yet: any subject, one person to message on WhatsApp. */
export const addDemoClassAction = defineAction({
  permission: "academics.manage",
  schema: z.object({
    subject: zReq("Subject", 80),
    personName: zReq("Name", 80),
    phone: zReq("WhatsApp number", 20),
    date: zYmd("Date"),
    startTime: z.string().max(5),
    endTime: z.string().max(5),
    room: zOpt(40),
    mode: z.enum(["offline", "online", "hybrid"]),
    meetingUrl: slotFields.meetingUrl,
    notes: zOpt(200),
    notify: zBool,
    remind: zBool,
  }),
  run: async (input, { user }) => {
    const r = toRange(input.startTime, input.endTime);
    if ("error" in r) return rangeError(r);
    if (classStart({ date: input.date, startMin: r.startMin }).getTime() <= Date.now())
      return { ok: false, error: "That time has already passed.", fieldErrors: { date: "Pick a time in the future" } };
    let pii;
    try {
      pii = contactPII({ phone: input.phone, whatsapp: input.phone });
    } catch (e) {
      if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: { phone: "Enter a valid mobile number, e.g. 98765 43210" } };
      throw e;
    }
    const d = { subject: input.subject, date: input.date, ...r, room: input.room ?? null, mode: input.mode, meetingUrl: input.meetingUrl ?? null };
    const when = demoText(d);

    const notified = await db.$transaction(async (tx) => {
      // Their own contact, not linked to any student: they agreed to WhatsApp by booking the demo
      const contact = await tx.contact.create({
        data: { name: input.personName, ...pii, waOptIn: true, consentAt: new Date(), consentSource: "demo class booking", preferredChannel: "whatsapp" },
      });
      const demo = await tx.demoClass.create({
        data: { ...d, date: ymdToDate(input.date), notes: input.notes ?? null, personName: input.personName, contactId: contact.id, remind: input.remind, createdById: user.id },
      });
      await audit({ action: "academics.demo.added", actor: user, entity: "demo_class", entityId: demo.id, after: { subject: d.subject, when, notify: input.notify, remind: input.remind } }, tx);
      if (!input.notify) return null;
      return queueForAudience(tx, demoAudience(contact), {
        purpose: "schedule",
        reason: "demo.scheduled",
        actorId: user.id,
        render: () => ({
          subject: `Demo ${d.subject} class on ${fmtDate(d.date)}`,
          lines: [`Your demo ${d.subject} class is booked: ${when}.${input.notes ? ` Note: ${input.notes}` : ""}`],
          params: [`Demo class · ${d.subject}`, `Demo ${d.subject} class booked: ${when}.${input.notes ? ` Note: ${input.notes}` : ""}`],
        }),
      });
    });
    revalidateDemo();
    const msg = notified ? (notified.whatsapp ? ` WhatsApp ${describeWa()}to ${input.personName}.` : "") : ` ${input.personName} not notified.`;
    const rem = input.remind ? " A reminder goes out before the class." : "";
    if (notified) after(() => deliverPending().catch(() => {}));
    return { ok: true, message: `Demo class added: ${d.subject}, ${fmtDate(d.date)} ${fmtRange(d.startMin, d.durationMin)}.${msg}${rem}` };
  },
});

export const cancelDemoClassAction = defineAction({
  permission: "academics.manage",
  schema: z.object({ id: zId, notify: zBool }),
  run: async (input, { user }) => {
    const demo = await db.demoClass.findUnique({ where: { id: input.id }, include: { contact: true } });
    if (!demo) throw new UserError("Demo class not found.");
    if (demo.cancelledAt) return { ok: true, message: "Already cancelled." };
    const d = { subject: demo.subject, date: dateToYmd(demo.date), startMin: demo.startMin, durationMin: demo.durationMin, room: demo.room, mode: demo.mode, meetingUrl: demo.meetingUrl };
    const when = `${fmtDate(d.date)} ${fmtRange(d.startMin, d.durationMin)}`;
    const notified = await db.$transaction(async (tx) => {
      await tx.demoClass.update({ where: { id: demo.id }, data: { cancelledAt: new Date() } });
      await audit({ action: "academics.demo.cancelled", actor: user, entity: "demo_class", entityId: demo.id, after: { subject: d.subject, when, notify: input.notify } }, tx);
      // A reminder already queued for it must not go out
      await tx.outboundMessage.updateMany({
        where: { dedupeKey: { in: [`reminder:demo:${demo.id}:${demo.contactId}`, `reminder:teacher:demo:${demo.id}`] }, status: "queued" },
        data: { status: "skipped", lastError: "Demo class cancelled" },
      });
      if (!input.notify || d.date < todayYmd()) return null;
      return queueForAudience(tx, demoAudience(demo.contact), {
        purpose: "schedule",
        reason: "demo.cancelled",
        actorId: user.id,
        render: () => ({
          subject: `Demo ${d.subject} class cancelled`,
          lines: [`Your demo ${d.subject} class on ${when} is cancelled.`],
          params: [`Demo class · ${d.subject}`, `Demo ${d.subject} class on ${when} is cancelled.`],
        }),
      });
    });
    revalidateDemo();
    if (notified?.whatsapp) after(() => deliverPending().catch(() => {}));
    return { ok: true, message: `Demo class cancelled: ${d.subject}, ${when}.${notified?.whatsapp ? ` WhatsApp ${describeWa()}to ${demo.personName}.` : ""}` };
  },
});

function revalidateDemo() {
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath("/academics/timetable");
  revalidatePath("/messages");
}
const describeWa = () => (env.WHATSAPP_MODE === "manual" ? "ready on the Messages page " : env.WHATSAPP_MODE === "test" ? "(test mode) " : "sent ");
