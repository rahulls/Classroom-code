import { z } from "zod";

// Shared zod helpers for FormData input (everything arrives as strings).

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const zReq = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const zOpt = (max = 200) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const zId = z.uuid("Invalid id");
export const zOptId = z.preprocess(blankToUndefined, z.uuid("Invalid id").optional());

export const zOptInt = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());

export const zDate = (label: string) =>
  z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`).transform((s) => new Date(`${s}T00:00:00Z`));

export const zOptDate = z.preprocess(
  blankToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date").optional(),
);

export const zEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const toDateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
