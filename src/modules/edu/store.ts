import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Edu videos: animated, narrated explainer videos made from a topic list and published to the
// Edu videos YouTube channel (its own, not Chaos Creators) on a schedule. A separate module
// (route /edu): it shares only the Google OAuth client, Canva and the Claude key with Chaos Creators.
//
// Nothing goes in the database. Everything lives in %LOCALAPPDATA%\RSC Classroom\edu (outside
// OneDrive; videos are big):
//   settings.json   schedule and options
//   topics.json     the topic list (one row per topic) with each row's progress
//   schedule.json   which write / publish slots have been handled
//   events.jsonl    the log; "alert" entries show on the dashboard until dismissed
//   items\<id>\     a row's working folder: script.json, timing, audio, pictures, video, thumbnail
// Finished videos are also copied to src\Edu videos\videos (OneDrive) under a readable name.

export const EDU_HOME = process.env.EDU_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "RSC Classroom", "edu");
export const EDU_LIBRARY = process.env.EDU_LIBRARY || path.join(process.cwd(), "src", "Edu videos");
export const EDU_ENGINE = path.join(process.cwd(), "src", "Edu videos", "engine");
const ITEMS = path.join(EDU_HOME, "items");

// ------------------------------- small file helpers -------------------------------

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Writes atomically (temp file + rename), retrying while Windows has the file open for reading. */
export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
  for (let i = 0; i < 30; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch {
      const until = Date.now() + 20;
      while (Date.now() < until) {
        /* brief wait */
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 1), "utf8");
  fs.rmSync(tmp, { force: true });
}

const ID_RE = /^[a-z0-9]{6,40}$/;
export const newId = () => `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
export function itemDir(id: string) {
  if (!ID_RE.test(id)) throw new Error("Bad item id");
  return path.join(ITEMS, id);
}

// ------------------------------------ settings ------------------------------------

export type EduSettings = {
  /** Nothing new is written, made or published while paused (running work finishes) */
  paused: boolean;
  /** One video every N hours */
  intervalHours: number;
  /** The first publishing slot of each day, India time, "HH:MM"; the others follow every intervalHours */
  firstSlot: string;
  /** Keep this many topics in the pipeline ahead of upload (being written, to review, being made, ready): the writer tops it up */
  keepAhead: number;
  /** Rahul wants at least this many approved videos waiting before each upload slot (warned when fewer) */
  minReady: number;
  /** Canva makes the thumbnail (else a minimal one, with an alert) */
  canvaThumbnail: boolean;
  /** Canva makes the pictures for picture scenes (else a plain card, with an alert) */
  canvaPictures: boolean;
  /** Short words shown in the top pill when the script doesn't give one */
  defaultKicker: string;
  /** The channel's name, said in the outro and written in the description (empty: the connected channel's title) */
  channelName: string;
  /** Narrator voices used in a shuffled rotation, one per video (ids in voices.ts) */
  voices: string[];
  /** When the schedule was last started (Start button) */
  startedAt?: string;
  updatedAt?: string;
};

export const DEFAULT_SETTINGS: EduSettings = {
  paused: true,
  intervalHours: 8,
  firstSlot: "10:00",
  keepAhead: 5,
  minReady: 2,
  canvaThumbnail: true,
  canvaPictures: true,
  defaultKicker: "EXPLAINED",
  channelName: "",
  voices: ["af_heart", "af_bella", "am_michael", "am_fenrir"],
};

const SETTINGS = () => path.join(EDU_HOME, "settings.json");
export const getSettings = (): EduSettings => ({ ...DEFAULT_SETTINGS, ...(readJson<Partial<EduSettings>>(SETTINGS()) ?? {}) });
export function saveSettings(patch: Partial<EduSettings>) {
  const s = { ...getSettings(), ...patch, updatedAt: new Date().toISOString() };
  writeJson(SETTINGS(), s);
  return s;
}

// ------------------------------------- topics -------------------------------------

export type VideoFormat = "short" | "long";

export type RowStatus =
  | "queued" // waiting in the list (the only state in which the row can be edited)
  | "writing" // Claude is writing the script
  | "script_review" // waiting for Rahul to read the script
  | "approved" // script approved, waiting for its turn to be made
  | "making" // pictures + animation being made
  | "video_review" // waiting for Rahul to watch the video
  | "ready" // video approved, waiting for a publishing slot
  | "uploading"
  | "published"
  | "rejected" // Rahul rejected the script or the video: the topic is closed (add a new row to try again)
  | "failed"; // something went wrong; see error (Retry puts it back a step)

export const STATUS_LABEL: Record<RowStatus, string> = {
  queued: "In the list",
  writing: "Writing script",
  script_review: "Script to review",
  approved: "Script approved",
  making: "Making video",
  video_review: "Video to review",
  ready: "Waiting for its slot",
  uploading: "Uploading",
  published: "On YouTube (private)",
  rejected: "Rejected",
  failed: "Failed",
};

export type TopicRow = {
  id: string;
  topic: string;
  format: VideoFormat;
  audience?: string;
  notes?: string;
  mustInclude?: string;
  addedAt: string;
  /** Which CSV it came from (or "added by hand") */
  source?: string;
  status: RowStatus;
  /** Where a failed row failed (Retry starts there again) */
  failedAt?: RowStatus;
  error?: string;
  /** Title and one-line summary of the script (for the overlap check of later topics) */
  title?: string;
  summary?: string;
  /** Rahul's note when asking Claude to rewrite */
  rewriteNote?: string;
  rejectReason?: string;
  pickedAt?: string;
  scriptAt?: string;
  scriptApprovedAt?: string;
  makeStartedAt?: string;
  videoAt?: string;
  videoApprovedAt?: string;
  publishedAt?: string;
  uploadAttempts?: number;
  /** Engine process making the video */
  pid?: number;
  youtube?: { videoId: string; privacy: string; channelTitle?: string; thumbnail?: string; thumbnailError?: string; thumbTriedAt?: string };
  /** Copy of the finished video in src\Edu videos\videos (without extension) */
  exportName?: string;
  /** Things Rahul should know about this video (Canva fallbacks etc.) */
  notices?: string[];
};

const TOPICS = () => path.join(EDU_HOME, "topics.json");
export const listRows = (): TopicRow[] => readJson<{ rows: TopicRow[] }>(TOPICS())?.rows ?? [];
const saveRows = (rows: TopicRow[]) => writeJson(TOPICS(), { rows });
export const getRow = (id: string) => listRows().find((r) => r.id === id) ?? null;

/** Changes one row (synchronous read-modify-write, so two changes never overwrite each other). */
export function updateRow(id: string, fn: (r: TopicRow) => TopicRow | void): TopicRow | null {
  const rows = listRows();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const next = fn({ ...rows[i]! }) ?? rows[i]!;
  rows[i] = next;
  saveRows(rows);
  return next;
}

export function addRows(add: Omit<TopicRow, "id" | "addedAt" | "status">[]) {
  const rows = listRows();
  const now = new Date().toISOString();
  const made = add.map((a) => ({ ...a, id: newId(), addedAt: now, status: "queued" as const }));
  saveRows([...rows, ...made]);
  return made;
}

export function deleteRow(id: string) {
  const rows = listRows();
  const r = rows.find((x) => x.id === id);
  if (!r || r.status !== "queued") return false;
  saveRows(rows.filter((x) => x.id !== id));
  return true;
}

/** Moves a queued row up or down among the queued rows (the order in which topics are picked). */
export function moveRow(id: string, dir: -1 | 1) {
  const rows = listRows();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return;
  let j = i + dir;
  while (j >= 0 && j < rows.length && rows[j]!.status !== "queued") j += dir;
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  saveRows(rows);
}

export const normTopic = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("a an the of to in on and or is are how why what when where who does do did your you vs versus explained explain".split(" "));
const words = (s: string) => new Set(normTopic(s).split(" ").filter((w) => w && !STOP.has(w)));

/** Rows that look like the same topic (same words, ignoring small ones), excluding rejected rows. */
export function similarRows(topic: string, rows = listRows(), skipId?: string) {
  const a = words(topic);
  return rows.filter((r) => {
    if (r.id === skipId || r.status === "rejected") return false;
    if (normTopic(r.topic) === normTopic(topic)) return true;
    const b = words(r.topic);
    if (!a.size || !b.size) return false;
    let both = 0;
    for (const w of a) if (b.has(w)) both++;
    return both / Math.min(a.size, b.size) >= 0.8 && both >= Math.min(2, a.size);
  });
}

// ------------------------------------ the log ------------------------------------

export type EduEvent = { id: string; at: string; kind: "info" | "alert" | "error"; text: string; rowId?: string; dismissed?: boolean };
const EVENTS = () => path.join(EDU_HOME, "events.jsonl");

export function logEvent(kind: EduEvent["kind"], text: string, rowId?: string) {
  fs.mkdirSync(EDU_HOME, { recursive: true });
  const e: EduEvent = { id: newId(), at: new Date().toISOString(), kind, text, rowId };
  fs.appendFileSync(EVENTS(), JSON.stringify(e) + "\n", "utf8");
  if (kind !== "info") console.log(`[edu] ${kind}: ${text}`);
  return e;
}

export function listEvents(limit = 300): EduEvent[] {
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(EVENTS(), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const dismissed = new Set(readJson<string[]>(path.join(EDU_HOME, "dismissed.json")) ?? []);
  const out: EduEvent[] = [];
  for (const l of lines.slice(-limit)) {
    try {
      const e = JSON.parse(l) as EduEvent;
      out.push({ ...e, dismissed: dismissed.has(e.id) });
    } catch {
      /* a half-written line */
    }
  }
  return out.reverse();
}

export function dismissEvents(ids: string[]) {
  const file = path.join(EDU_HOME, "dismissed.json");
  const all = new Set(readJson<string[]>(file) ?? []);
  for (const id of ids) all.add(id);
  writeJson(file, [...all].slice(-2000));
}
