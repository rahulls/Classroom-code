import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Field-level encryption: AES-256-GCM with a random 96-bit IV per value.
// `purpose` is bound as AAD so a ciphertext can't be moved to a different field.
// Format: v1:<iv>:<tag>:<ciphertext> (base64url). The version prefix enables key rotation.

const ENC_KEY = Buffer.from(env.ENCRYPTION_KEY, "base64");
const IDX_KEY = Buffer.from(env.BLIND_INDEX_KEY, "base64");
const VERSION = "v1";

export function encrypt(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decrypt(payload: string, purpose: string): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", ENC_KEY, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Binary version (files): <iv 12 bytes><tag 16 bytes><ciphertext>, same key and AAD binding. */
export function encryptBytes(plain: Buffer, purpose: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptBytes(payload: Uint8Array, purpose: string): Buffer {
  const buf = Buffer.from(payload);
  const decipher = createDecipheriv("aes-256-gcm", ENC_KEY, buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export const encryptOpt = (v: string | null | undefined, purpose: string) => (v ? encrypt(v, purpose) : null);
export const decryptOpt = (v: string | null | undefined, purpose: string) => (v ? decrypt(v, purpose) : null);

/** Deterministic keyed hash for exact-match lookups on encrypted values. */
export function blindIndex(purpose: string, normalizedValue: string): string {
  return createHmac("sha256", IDX_KEY).update(`${purpose}\u0000${normalizedValue}`).digest("base64url");
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Constant-time string comparison (hashes first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
