import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VideoFormat } from "./csv";
import { introOutroCards, planMiddleCards, spokenText, type FactItem, type MiddleCard, type SpokenCard } from "./facts";
import { CHAOS_HOME, type FactRecording, type JobSettings, type YoutubeMeta } from "./jobs";

// Recording decks for facts videos read by a person. A draft is everything needed to make the
// video (facts, settings, YouTube lines) plus the recordings, one per card, kept until the draft is
// deleted, so a session can stop and carry on later. Nothing goes in the database: each draft is a
// folder %LOCALAPPDATA%\RSC Classroom\chaos\drafts\<id> with draft.json and the audio files.

const DRAFTS = path.join(CHAOS_HOME, "drafts");
const ID_RE = /^[a-z0-9]{6,40}$/;
/** f = fact, m = middle line, i = intro, o = ending */
export const CARD_KEY_RE = /^[fmio]\d{1,3}$/;
/** Audio the browser's recorder makes (Chrome / Edge: webm, Firefox: ogg, Safari: mp4) */
export const RECORDING_EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" } as const;
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;

export type DraftFact = FactItem & { key: string };
export type Recording = {
  file: string;
  /** The words on the card when it was recorded: when the card changes, it needs recording again */
  text: string;
  seconds: number;
  at: string;
};

export type FactsDraft = {
  id: string;
  title: string;
  format: VideoFormat;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  fileName?: string;
  settings: JobSettings;
  youtube?: Partial<YoutubeMeta>;
  facts: DraftFact[];
  middles: MiddleCard[];
  /** The reader's own intro and ending (optional; decks made before 21 Nov 2026 have none) */
  intro?: SpokenCard | null;
  outro?: SpokenCard | null;
  recordings: Record<string, Recording>;
  /** Videos made from this deck, oldest first */
  videos: string[];
};

const dirOf = (id: string) => {
  if (!ID_RE.test(id)) throw new Error("Bad draft id");
  return path.join(DRAFTS, id);
};

function write(d: FactsDraft) {
  const file = path.join(dirOf(d.id), "draft.json");
  d.updatedAt = new Date().toISOString();
  fs.writeFileSync(file + ".tmp", JSON.stringify(d, null, 1), "utf8");
  fs.renameSync(file + ".tmp", file);
}

export function getDraft(id: string): FactsDraft | null {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dirOf(id), "draft.json"), "utf8")) as FactsDraft;
  } catch {
    return null;
  }
}

export function listDrafts(): FactsDraft[] {
  if (!fs.existsSync(DRAFTS)) return [];
  return fs
    .readdirSync(DRAFTS)
    .filter((n) => ID_RE.test(n))
    .map(getDraft)
    .filter((d): d is FactsDraft => !!d)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createDraft(input: {
  title: string;
  format: VideoFormat;
  facts: FactItem[];
  settings: JobSettings;
  userId: string;
  fileName?: string;
  sourceCsv?: string;
  youtube?: Partial<YoutubeMeta>;
  /** Intro and ending cards for the reader too */
  introOutro?: boolean;
}): FactsDraft {
  const id = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  fs.mkdirSync(dirOf(id), { recursive: true });
  if (input.sourceCsv) fs.writeFileSync(path.join(dirOf(id), "source.csv"), input.sourceCsv, "utf8");
  const now = new Date().toISOString();
  const d: FactsDraft = {
    id,
    title: input.title,
    format: input.format,
    createdAt: now,
    updatedAt: now,
    createdBy: input.userId,
    fileName: input.fileName,
    settings: input.settings,
    youtube: input.youtube,
    facts: input.facts.map((f, i) => ({ ...f, key: `f${i + 1}` })),
    middles: planMiddleCards(input.facts.length, input.format, id),
    ...(input.introOutro ? introOutroCards(input.facts.length, input.settings.quiz_badge) : {}),
    recordings: {},
    videos: [],
  };
  write(d);
  return d;
}

export const draftSourceCsv = (id: string) => {
  try {
    return fs.readFileSync(path.join(dirOf(id), "source.csv"), "utf8");
  } catch {
    return undefined;
  }
};

/** The words a card asks the reader to say right now. */
export function cardText(d: FactsDraft, key: string): string | null {
  const f = d.facts.find((x) => x.key === key);
  if (f) return spokenText(f);
  if (d.intro?.key === key) return d.intro.text;
  if (d.outro?.key === key) return d.outro.text;
  return d.middles.find((m) => m.key === key)?.text ?? null;
}

export function saveRecording(id: string, key: string, bytes: Buffer, ext: string, seconds: number) {
  const d = getDraft(id);
  if (!d) return null;
  const text = cardText(d, key);
  if (text == null) return null;
  const old = d.recordings[key];
  const file = `${key}-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(dirOf(id), file), bytes);
  d.recordings[key] = { file, text, seconds: Math.round(seconds * 10) / 10, at: new Date().toISOString() };
  write(d);
  if (old) fs.rmSync(path.join(dirOf(id), old.file), { force: true });
  return d.recordings[key];
}

export function removeRecording(id: string, key: string) {
  const d = getDraft(id);
  if (!d?.recordings[key]) return false;
  fs.rmSync(path.join(dirOf(id), d.recordings[key].file), { force: true });
  delete d.recordings[key];
  write(d);
  return true;
}

/** Changes a card's words (a fact's headline / detail / narration, or a middle line). */
export function editCard(id: string, key: string, patch: { headline?: string; detail?: string; narration?: string; text?: string }) {
  const d = getDraft(id);
  if (!d) return false;
  const f = d.facts.find((x) => x.key === key);
  if (f) {
    if (patch.headline !== undefined) f.headline = patch.headline;
    if (patch.detail !== undefined) f.detail = patch.detail;
    if (patch.narration !== undefined) f.narration = patch.narration;
  } else {
    const m = d.middles.find((x) => x.key === key) ?? (d.intro?.key === key ? d.intro : d.outro?.key === key ? d.outro : null);
    if (!m || patch.text === undefined) return false;
    m.text = patch.text;
  }
  write(d);
  return true;
}

/** Adds (with suggested words) or takes away the reader's intro and ending cards. Returns the new cards. */
export function setIntroOutro(id: string, on: boolean) {
  const d = getDraft(id);
  if (!d) return null;
  if (on) {
    const cards = introOutroCards(d.facts.length, d.settings.quiz_badge);
    d.intro ??= cards.intro;
    d.outro ??= cards.outro;
  } else {
    for (const c of [d.intro, d.outro]) {
      if (c && d.recordings[c.key]) {
        fs.rmSync(path.join(dirOf(id), d.recordings[c.key]!.file), { force: true });
        delete d.recordings[c.key];
      }
    }
    d.intro = null;
    d.outro = null;
  }
  write(d);
  return { intro: d.intro ?? null, outro: d.outro ?? null };
}

export function recordingPath(id: string, key: string): { file: string; ext: string } | null {
  const d = getDraft(id);
  const r = d?.recordings[key];
  if (!r) return null;
  const file = path.join(dirOf(id), r.file);
  return fs.existsSync(file) ? { file, ext: path.extname(r.file).slice(1) } : null;
}

/** Card state for the deck: recorded (and still matching its words), changed since, or not yet. */
export function cardState(d: FactsDraft, key: string): "done" | "changed" | "todo" {
  const r = d.recordings[key];
  if (!r) return "todo";
  return r.text === cardText(d, key) ? "done" : "changed";
}

/** What the video needs from the deck: every fact recorded with its current words. Middle lines are optional. */
export function draftReadiness(d: FactsDraft) {
  const missing = d.facts.filter((f) => cardState(d, f.key) !== "done").map((f) => f.key);
  return { ready: missing.length === 0, missing };
}

export function draftRecordings(d: FactsDraft) {
  const rec = (key: string): FactRecording | undefined => (d.recordings[key] ? { from: path.join(dirOf(d.id), d.recordings[key].file), name: d.recordings[key].file } : undefined);
  return {
    facts: d.facts.map((f) => ({ ...f, recording: rec(f.key) })),
    middles: d.middles.filter((m) => cardState(d, m.key) === "done").map((m) => ({ before: m.before, recording: rec(m.key)! })),
    // Recorded intro / ending (else the kid voice or the AI voice does them)
    intro: d.intro && cardState(d, d.intro.key) === "done" ? rec(d.intro.key) : undefined,
    outro: d.outro && cardState(d, d.outro.key) === "done" ? rec(d.outro.key) : undefined,
  };
}

export function addDraftVideo(id: string, jobId: string) {
  const d = getDraft(id);
  if (!d) return;
  d.videos.push(jobId);
  write(d);
}

export function deleteDraft(id: string) {
  if (!getDraft(id)) return false;
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  return true;
}
