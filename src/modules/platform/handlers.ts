import "server-only";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineAction, UserError } from "@/core/action";
import { audit } from "@/core/audit";
import { COOKIE_SECURE } from "@/core/auth/cookie";
import { verifyPassword } from "@/core/auth/password";
import { db } from "@/core/db";
import { EDIT_MODE_COOKIE } from "@/core/edit-mode";
import { zBool, zId, zReq } from "@/core/validation";

// ─────────────── Edit mode switch ───────────────

export const toggleEditModeAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({ on: zBool }),
  run: async ({ on }, { user }) => {
    const jar = await cookies();
    if (on) jar.set(EDIT_MODE_COOKIE, "1", { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/", maxAge: 8 * 3600 });
    else jar.delete(EDIT_MODE_COOKIE);
    await audit({ action: on ? "platform.edit_mode.on" : "platform.edit_mode.off", actor: user, entity: "user", entityId: user.id });
    revalidatePath("/", "layout");
  },
});

// ─────────────── Institute settings ───────────────

export const updateInstituteSettingsAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({
    instituteName: zReq("Institute name", 100),
    defaultDurationMin: z.coerce.number().int().min(15).max(600),
    durationPresets: z
      .string()
      .max(100)
      .transform((v) => [...new Set(v.split(/[,\s]+/).filter(Boolean).map(Number))].sort((a, b) => a - b))
      .refine((a) => a.length >= 1 && a.length <= 10 && a.every((n) => Number.isInteger(n) && n >= 15 && n <= 600), "Use 1–10 whole numbers between 15 and 600"),
  }),
  run: async (input, { user }) => {
    const entries: [string, Prisma.InputJsonValue][] = [
      ["institute.name", input.instituteName],
      ["schedule.defaultDurationMin", input.defaultDurationMin],
      ["schedule.durationPresets", input.durationPresets],
    ];
    const before = await db.setting.findMany({ where: { key: { in: entries.map((e) => e[0]) } } });
    await db.$transaction(entries.map(([key, value]) => db.setting.upsert({ where: { key }, update: { value, updatedBy: user.id }, create: { key, value, updatedBy: user.id } })));
    await audit({
      action: "platform.settings.updated",
      actor: user,
      entity: "setting",
      before: Object.fromEntries(before.map((b) => [b.key, b.value as Prisma.InputJsonValue])),
      after: Object.fromEntries(entries),
    });
    revalidatePath("/settings/general");
    return { ok: true, message: "Settings saved." };
  },
});

// ─────────────── Program types ───────────────

export const updateProgramTypeAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({
    id: zId,
    label: zReq("Label", 60),
    learnerKind: z.enum(["MINOR", "ADULT"]),
    guardianRequired: zBool,
    defaultBilling: z.enum(["monthly", "quarterly", "one_time", "instalments", "per_class"]),
    defaultRecipients: z.enum(["student", "guardian", "both", "self"]),
    curriculumLevels: z
      .string()
      .max(200)
      .transform((v) => v.split(/[,>→]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))
      .refine((a) => a.length >= 1 && a.length <= 6 && a.every((s) => /^[a-z ]{2,20}$/.test(s)), "1–6 levels, letters only, e.g. unit, chapter, topic"),
  }),
  run: async (input, { user }) => {
    const before = await db.programType.findUnique({ where: { id: input.id } });
    if (!before) throw new UserError("Not found.");
    const { id, ...data } = input;
    await db.programType.update({ where: { id }, data });
    await audit({
      action: "platform.program_type.updated",
      actor: user,
      entity: "program_type",
      entityId: id,
      before: { label: before.label, learnerKind: before.learnerKind, guardianRequired: before.guardianRequired, defaultBilling: before.defaultBilling, defaultRecipients: before.defaultRecipients, curriculumLevels: before.curriculumLevels },
      after: data,
    });
    revalidatePath("/settings");
    return { ok: true, message: "Program type saved." };
  },
});

// ─────────────── Own profile ───────────────

export const updateProfileAction = defineAction({
  schema: z.object({
    name: zReq("Name", 100),
    email: z.email("Enter a valid email").max(254),
    password: z.string().max(128).optional(),
  }),
  run: async (input, { user }) => {
    const email = input.email.toLowerCase();
    const emailChanged = email !== user.email;
    if (emailChanged) {
      if (!input.password || !(await verifyPassword(user.passwordHash, input.password))) {
        return { ok: false, error: "Enter your current password to change your email.", fieldErrors: { password: "Required to change email" } };
      }
      if (await db.user.findUnique({ where: { email } })) throw new UserError("That email is already used.");
    }
    await db.user.update({ where: { id: user.id }, data: { name: input.name, email } });
    await audit({
      action: emailChanged ? "auth.profile.email_changed" : "auth.profile.updated",
      actor: { id: user.id, name: input.name },
      entity: "user",
      entityId: user.id,
      before: { name: user.name, emailChanged: false },
      after: { name: input.name, emailChanged },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: emailChanged ? "Profile saved. Use the new email next time you sign in." : "Profile saved." };
  },
});

