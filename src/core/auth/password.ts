import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// Argon2id (the library default) with OWASP-recommended parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Spend the same time as a real check when the user doesn't exist (prevents user enumeration). */
export async function fakeVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword("rsc-dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "admin", "iloveyou", "rahulshah", "rsc", "classes"];

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters")
  .refine((p) => !/^(.)\1+$/.test(p), "Too repetitive")
  .refine((p) => new Set(p).size >= 6, "Use more varied characters")
  .refine((p) => !COMMON.some((c) => p.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(c)), "Too common or easy to guess");
