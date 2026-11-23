import "server-only";
import fs from "node:fs";
import path from "node:path";
import { youtubeConnection } from "@/modules/chaos/youtube";
import { EDU_HOME, getSettings } from "./store";

// The Edu channel's own name and logo (not Chaos Creators'). The name is said in each outro and
// written in the description; the logo sits in the corner of every video and thumbnail.

export const LOGO_EXTS = [".png", ".jpg", ".jpeg", ".webp"] as const;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** The name typed in Settings, else the connected Edu channel's title. */
export function channelName(): string | null {
  return getSettings().channelName.trim() || youtubeConnection("edu").channelTitle || null;
}

/** The uploaded logo (EDU_HOME\logo.<ext>), or null: then videos have no logo at all. */
export function logoFile(): string | null {
  for (const ext of LOGO_EXTS) {
    const f = path.join(EDU_HOME, `logo${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

export function saveLogo(name: string, data: Buffer) {
  const ext = path.extname(name).toLowerCase();
  if (!(LOGO_EXTS as readonly string[]).includes(ext)) throw new Error("Bad logo type");
  removeLogo();
  fs.mkdirSync(EDU_HOME, { recursive: true });
  fs.writeFileSync(path.join(EDU_HOME, `logo${ext}`), data);
}

export function removeLogo() {
  for (const ext of LOGO_EXTS) fs.rmSync(path.join(EDU_HOME, `logo${ext}`), { force: true });
}
