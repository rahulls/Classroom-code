import "server-only";
import fs from "node:fs";
import path from "node:path";
import { CHAOS_ASSETS } from "./jobs";
import type { FlagLevel, FlagRound } from "./flags";

// Every Flag Memory video made, with its flags (Rahul, 26 Nov 2026: a series of 12, "keep the
// combination somewhere"). Kept in src\Chaos creators\flags\made-videos.json (OneDrive), and it keeps
// its entries when a video is deleted. The Flags tab uses it to show the series' progress and to pick
// flags that earlier videos of the same level didn't show.

export type FlagsLogEntry = { jobId: string; title: string; level: FlagLevel; format: string; createdAt: string; rounds: FlagRound[] };

const FILE = path.join(CHAOS_ASSETS, "flags", "made-videos.json");

export function readFlagsLog(): FlagsLogEntry[] {
  try {
    return (JSON.parse(fs.readFileSync(FILE, "utf8")) as { videos: FlagsLogEntry[] }).videos ?? [];
  } catch {
    return [];
  }
}

export function addFlagsLog(e: FlagsLogEntry) {
  const videos = [...readFlagsLog().filter((v) => v.jobId !== e.jobId), e];
  fs.writeFileSync(FILE + ".tmp", JSON.stringify({ videos }, null, 1) + "\n", "utf8");
  fs.renameSync(FILE + ".tmp", FILE);
}
