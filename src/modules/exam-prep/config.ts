import "server-only";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

// Exam Prep runtime configuration. Everything else (thresholds, prices, times) is in settings.ts.

/** Feature flag: off means no Exam Prep pages, actions, jobs or links. */
export const examPrepEnabled = () => process.env.EXAM_PREP_ENABLED === "true";

/** Private file storage, outside OneDrive and outside the web root. Never served directly. */
export const STORAGE_ROOT =
  process.env.EXAM_PREP_STORAGE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "RSC Classroom", "exam-prep", "files");

/** AES-256-GCM with EXAM_PREP_SECRET (Exam Prep's own key; nothing shared with the classroom). */
function key() {
  const s = process.env.EXAM_PREP_SECRET;
  if (!s || s.length < 32) throw new Error("EXAM_PREP_SECRET is not set");
  return crypto.createHash("sha256").update(s).digest();
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decrypt(token: string) {
  const [v, iv, tag, body] = token.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Bad encrypted value");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

/** HMAC signature for short-lived file links. */
export const sign = (data: string) => crypto.createHmac("sha256", key()).update(data).digest("base64url");
