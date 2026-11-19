import "server-only";
import type { FieldDefinition } from "@prisma/client";
import { z } from "zod";
import { db } from "@/core/db";
import { decrypt, encrypt } from "@/core/crypto";

// Generic configurable-field engine (design/04-configuration.md §2).
// Definitions live in the DB; values live in the entity's `custom` JSONB column.
// Fields marked `sensitive` are stored encrypted inside that JSON.

export const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "checkbox", "email", "phone", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldEntity = "student" | "mentor" | "batch" | "enquiry";

const ENC_PREFIX = "enc:";

export async function getFieldDefinitions(entity: FieldEntity, scopeKey?: string | null) {
  return db.fieldDefinition.findMany({
    where: { entity, archivedAt: null, scopeKey: { in: scopeKey ? ["*", scopeKey] : ["*"] } },
    orderBy: [{ groupName: "asc" }, { order: "asc" }, { label: "asc" }],
  });
}

function valueSchema(def: FieldDefinition): z.ZodType {
  const blank = (v: unknown) => (v === "" || v === undefined || (Array.isArray(v) && v.length === 0) ? undefined : v);
  let s: z.ZodType;
  switch (def.type as FieldType) {
    case "number":
      s = z.coerce.number({ error: `${def.label} must be a number` });
      break;
    case "date":
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${def.label} must be a date`);
      break;
    case "select":
      s = z.enum(def.options as [string, ...string[]], { error: `Choose a valid ${def.label}` });
      break;
    case "multiselect":
      s = z.array(z.enum(def.options as [string, ...string[]])).max(50);
      break;
    case "checkbox":
      return z.preprocess((v) => v === "on" || v === "true", z.boolean());
    case "email":
      s = z.email(`${def.label} must be an email`).max(254);
      break;
    case "url":
      s = z.url({ protocol: /^https?$/, error: `${def.label} must be a web link` }).max(500);
      break;
    case "phone":
      s = z.string().regex(/^[+\d][\d\s-]{6,19}$/, `${def.label} must be a phone number`);
      break;
    case "textarea":
      s = z.string().trim().max(2000);
      break;
    default:
      s = z.string().trim().max(300);
  }
  return z.preprocess(blank, def.required ? s : s.optional());
}

/** Reads `cf_<key>` / `cf_<key>[]` entries from the raw form object and validates them. */
export function parseCustomFields(
  defs: FieldDefinition[],
  raw: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; fieldErrors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const fieldErrors: Record<string, string> = {};
  for (const def of defs) {
    const name = `cf_${def.key}`;
    const input = def.type === "multiselect" ? raw[name] ?? [] : raw[name];
    const res = valueSchema(def).safeParse(input);
    if (!res.success) {
      fieldErrors[name] = def.required && (input === undefined || input === "") ? `${def.label} is required` : (res.error.issues[0]?.message ?? "Invalid");
      continue;
    }
    if (res.data === undefined) continue;
    values[def.key] = def.sensitive ? ENC_PREFIX + encrypt(JSON.stringify(res.data), `custom.${def.entity}.${def.key}`) : res.data;
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, values };
}

/** Decrypts sensitive values for display. Returns plain JS values keyed by field key. */
export function readCustomFields(defs: FieldDefinition[], stored: unknown, opts: { includeSensitive: boolean }) {
  const obj = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const v = obj[def.key];
    if (v === undefined) continue;
    if (typeof v === "string" && v.startsWith(ENC_PREFIX)) {
      if (!opts.includeSensitive) {
        out[def.key] = "••••••";
        continue;
      }
      try {
        out[def.key] = JSON.parse(decrypt(v.slice(ENC_PREFIX.length), `custom.${def.entity}.${def.key}`));
      } catch {
        out[def.key] = "(unreadable)";
      }
    } else out[def.key] = v;
  }
  return out;
}

export type FieldDefDTO = Pick<FieldDefinition, "key" | "label" | "type" | "options" | "required" | "groupName" | "helpText" | "sensitive">;
export const toFieldDTO = (d: FieldDefinition): FieldDefDTO => ({
  key: d.key,
  label: d.label,
  type: d.type,
  options: d.options,
  required: d.required,
  groupName: d.groupName,
  helpText: d.helpText,
  sensitive: d.sensitive,
});
