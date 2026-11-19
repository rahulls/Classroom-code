import "server-only";
import fs from "node:fs";
import path from "node:path";
import { sign, STORAGE_ROOT } from "../config";

// Private file storage (R11): files live outside the web root and OneDrive; there are no public or
// shareable URLs. The app hands out short-lived signed links that also need the teacher's session.

export interface Storage {
  save(rel: string, bytes: Uint8Array): Promise<void>;
  read(rel: string): Promise<Buffer>;
  remove(rel: string): Promise<void>;
  removeTree(rel: string): Promise<void>;
  exists(rel: string): boolean;
}

/** Resolves a stored path; refuses anything that escapes the storage root. */
export function resolveSafe(rel: string) {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const full = path.resolve(STORAGE_ROOT, clean);
  if (!full.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) throw new Error("Bad file path");
  return full;
}

export const localStorage: Storage = {
  async save(rel, bytes) {
    const f = resolveSafe(rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + ".tmp", bytes);
    fs.renameSync(f + ".tmp", f);
  },
  async read(rel) {
    return fs.readFileSync(resolveSafe(rel));
  },
  async remove(rel) {
    fs.rmSync(resolveSafe(rel), { force: true });
  },
  async removeTree(rel) {
    fs.rmSync(resolveSafe(rel), { recursive: true, force: true });
  },
  exists(rel) {
    try {
      return fs.existsSync(resolveSafe(rel));
    } catch {
      return false;
    }
  },
};

export const storage: Storage = localStorage;

const LINK_SECONDS = 300;

/** A link valid for 5 minutes (and only with the teacher signed in). */
export function signedLink(rel: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + LINK_SECONDS;
  return `/exam-prep/files?p=${encodeURIComponent(rel)}&e=${exp}&s=${sign(`${rel}|${exp}`)}`;
}

export function checkLink(rel: string, exp: string, sig: string, now = Date.now()) {
  const e = Number(exp);
  if (!rel || !Number.isFinite(e) || e * 1000 < now) return false;
  const want = sign(`${rel}|${e}`);
  return want.length === sig.length && want === sig;
}
