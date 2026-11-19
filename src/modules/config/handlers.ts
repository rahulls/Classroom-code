import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError } from "@/core/action";
import { audit } from "@/core/audit";
import { db } from "@/core/db";
import { zBool, zId, zOpt, zOptInt, zReq } from "@/core/validation";
import { FIELD_TYPES } from "./fields";

export const createFieldAction = defineAction({
  permission: "settings.manage",
  schema: z.object({
    entity: z.enum(["student", "mentor", "batch", "enquiry"]),
    scopeKey: z.string().regex(/^(\*|[a-z_]{2,30})$/).default("*"),
    label: zReq("Label", 80),
    key: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Lowercase letters, digits, underscores").optional()),
    type: z.enum(FIELD_TYPES),
    options: zOpt(1000),
    required: zBool,
    sensitive: zBool,
    groupName: zOpt(40),
    helpText: zOpt(200),
    order: zOptInt(0, 999),
  }),
  run: async (input, { user }) => {
    const key = input.key ?? input.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new UserError("Couldn't derive a key from the label; enter one.");
    const options = (input.options ?? "").split(/[,\n]/).map((o) => o.trim()).filter(Boolean).slice(0, 100);
    if ((input.type === "select" || input.type === "multiselect") && options.length < 1) throw new UserError("Add at least one option.");
    const exists = await db.fieldDefinition.findFirst({ where: { entity: input.entity, scopeKey: input.scopeKey, key } });
    if (exists) throw new UserError(`A field with key "${key}" already exists.`);
    const def = await db.fieldDefinition.create({
      data: {
        entity: input.entity,
        scopeKey: input.scopeKey,
        key,
        label: input.label,
        type: input.type,
        options,
        required: input.required,
        sensitive: input.sensitive,
        groupName: input.groupName ?? "General",
        helpText: input.helpText ?? null,
        order: input.order ?? 0,
      },
    });
    await audit({ action: "config.field.created", actor: user, entity: "field_definition", entityId: def.id, after: { entity: def.entity, key, type: def.type } });
    revalidatePath("/settings/fields");
    return { ok: true, message: `Field "${def.label}" added.` };
  },
});

export const archiveFieldAction = defineAction({
  permission: "settings.manage",
  schema: z.object({ id: zId }),
  run: async ({ id }, { user }) => {
    const def = await db.fieldDefinition.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit({ action: "config.field.archived", actor: user, entity: "field_definition", entityId: id, before: { key: def.key } });
    revalidatePath("/settings/fields");
  },
});

// Edit mode: change a field definition. Key, type and "sensitive" are fixed after creation
// because existing stored values depend on them.
export const updateFieldAction = defineAction({
  permission: "data.edit_all",
  schema: z.object({
    id: zId,
    label: zReq("Label", 80),
    options: zOpt(1000),
    required: zBool,
    scopeKey: z.string().regex(/^(\*|[a-z_]{2,30})$/),
    groupName: zOpt(40),
    helpText: zOpt(200),
    order: zOptInt(0, 999),
  }),
  run: async (input, { user }) => {
    const before = await db.fieldDefinition.findUnique({ where: { id: input.id } });
    if (!before) throw new UserError("Field not found.");
    const options = (input.options ?? "").split(/[,\n]/).map((o) => o.trim()).filter(Boolean).slice(0, 100);
    if ((before.type === "select" || before.type === "multiselect") && options.length < 1) throw new UserError("Add at least one option.");
    if (input.scopeKey !== before.scopeKey && (await db.fieldDefinition.findFirst({ where: { entity: before.entity, scopeKey: input.scopeKey, key: before.key } }))) {
      throw new UserError("A field with this key already exists for that program type.");
    }
    const data = { label: input.label, options, required: input.required, scopeKey: input.scopeKey, groupName: input.groupName ?? "General", helpText: input.helpText ?? null, order: input.order ?? 0 };
    await db.fieldDefinition.update({ where: { id: input.id }, data });
    await audit({
      action: "config.field.updated",
      actor: user,
      entity: "field_definition",
      entityId: input.id,
      before: { label: before.label, options: before.options, required: before.required, scopeKey: before.scopeKey, groupName: before.groupName },
      after: { label: data.label, options: data.options, required: data.required, scopeKey: data.scopeKey, groupName: data.groupName },
    });
    revalidatePath("/settings/fields");
    return { ok: true, message: "Field saved." };
  },
});
