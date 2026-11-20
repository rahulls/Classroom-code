import "server-only";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IMAGE_NAME_RE, parseQuizCsv, type QuizQuestion, type VideoFormat } from "./csv";

// Chaos Creators video jobs. Nothing goes in the database: each job is a folder under
// %LOCALAPPDATA%\RSC Classroom\chaos\jobs\<id> (outside OneDrive, videos are big) holding
// job.json (what to make), questions.csv, progress.json (written by the engine), video.mp4.
// The Python engine (src/Chaos creators/engine/quiz_video.py) runs in its own venv in ...\chaos\venv.

export const CHAOS_HOME = process.env.CHAOS_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "RSC Classroom", "chaos");
const JOBS = path.join(CHAOS_HOME, "jobs");
export const PYTHON = path.join(CHAOS_HOME, "venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
const ENGINE = path.join(process.cwd(), "src", "Chaos creators", "engine", "quiz_video.py");
const THUMBNAILER = path.join(path.dirname(ENGINE), "thumbnail.py");
export const ENGINE_DIR = path.dirname(ENGINE);
export const CHAOS_ASSETS = path.join(process.cwd(), "src", "Chaos creators");
/**
 * Rahul's own folders: every uploaded CSV is kept in csv\, and every finished video (with its
 * thumbnail) is copied into videos\ under a readable name. The working copies stay in the jobs folder.
 * CHAOS_LIBRARY moves both (the e2e tests point it at a scratch folder).
 */
const LIBRARY = process.env.CHAOS_LIBRARY || CHAOS_ASSETS;
export const CSV_FOLDER = path.join(LIBRARY, "csv");
export const VIDEO_FOLDER = path.join(LIBRARY, "videos");

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

/** "Maths Easy Quiz 1 - YouTube - 2026-11-18 0018": the name of the video's copy in videos\. */
function exportName(title: string, format: VideoFormat, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${safeName(title) || "Quiz"} - ${format === "shorts" ? "Shorts" : "YouTube"} - ${p.year}-${p.month}-${p.day} ${p.hour}${p.minute}`;
}

/** Browsers send uploaded files with CRLF line endings, so compare without them. */
const normCsv = (s: string) => s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
const sameCsv = (a: string, b: string) => normCsv(a) === normCsv(b);

/** Keeps the uploaded CSV in csv\ (same name; a different file with that name gets " (2)" etc.). */
function keepCsv(fileName: string | undefined, content: string) {
  try {
    fs.mkdirSync(CSV_FOLDER, { recursive: true });
    const base = (safeName(fileName ?? "") || "questions.csv").replace(/\.csv$/i, "");
    for (let n = 1; n < 100; n++) {
      const file = path.join(CSV_FOLDER, `${base}${n > 1 ? ` (${n})` : ""}.csv`);
      if (!fs.existsSync(file)) return fs.writeFileSync(file, content, "utf8");
      if (sameCsv(fs.readFileSync(file, "utf8"), content)) return; // already there
    }
  } catch (e) {
    console.error("[chaos] couldn't keep the CSV", e); // never stops the video
  }
}

const ID_RE = /^[a-z0-9]{6,40}$/;

export type JobSettings = {
  quiz_badge?: string;
  intro_badge?: string;
  title_lines?: string[];
  timer_seconds?: number;
  voice?: string;
  /** Background music folder (sounds/music/<mood>), "random" or "off" */
  music_mood?: string;
  /** Rank titles, lowest score first, or ["off"] (long videos only) */
  ranks?: string[];
  /** Topic photo for the thumbnail: a file in src\Chaos creators\images */
  thumb_image?: string;
  /** Canva designs: the thumbnail and the intro / ending artwork (canva-jobs.ts, engine/canva_images.py) */
  canva?: boolean;
  /** Canva background behind every question (needs canva; up to 25 questions) */
  canva_questions?: boolean;
};

export type JobSpec = {
  id: string;
  title: string;
  format: VideoFormat;
  questions: number;
  settings: JobSettings;
  createdAt: string;
  createdBy: string;
  /** The uploaded CSV's file name (videos made before 18 Nov 2026 don't have it) */
  fileName?: string;
  /** Name of the video's copy in videos\ (without .mp4 / .jpg) */
  exportName?: string;
  pid?: number;
};

export type JobStage = "queued" | "voice" | "render" | "finish" | "done" | "error" | "stopped";

export type JobStatus = {
  stage: JobStage;
  percent: number;
  message: string;
  elapsed: number;
  done: number;
  total: number;
  error?: string;
  result?: {
    duration: number;
    questions: number;
    width: number;
    height: number;
    render_seconds: number;
    /** Start of each part of the video (videos made before Nov 2026 don't have it) */
    chapters?: { t: number; kind: "intro" | "q" | "ranks" | "outro"; q: number | null }[];
    /** Attribution lines for Creative Commons music the video used (from sounds/CREDITS.json) */
    credits?: string[];
    /** Sound files used, by kind: music is "<mood>/<file>" under sounds/music */
    sounds?: Record<string, string[]>;
  };
  sizeBytes?: number;
};

export type JobView = JobSpec & { status: JobStatus; /** thumbnail.jpg's change time (cache buster), if there is one */ thumb?: number };

export function engineReady(): { ok: boolean; problem?: string } {
  if (!fs.existsSync(PYTHON)) return { ok: false, problem: `The video engine isn't installed (no Python at ${PYTHON}).` };
  if (!fs.existsSync(path.join(CHAOS_HOME, "models", "kokoro.onnx"))) return { ok: false, problem: "The narrator voice model is missing." };
  if (!fs.existsSync(ENGINE)) return { ok: false, problem: "The engine script is missing." };
  return { ok: true };
}

export const jobDir = (id: string) => {
  if (!ID_RE.test(id)) throw new Error("Bad job id");
  return path.join(JOBS, id);
};

const readJson = <T,>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

function alive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function statusOf(dir: string, spec: JobSpec): JobStatus {
  const p = readJson<{ stage: JobStage; percent: number; message: string; elapsed: number; done: number; total: number }>(path.join(dir, "progress.json"));
  const video = path.join(dir, "video.mp4");
  if (p?.stage === "done" && fs.existsSync(video)) {
    return { ...p, result: readJson(path.join(dir, "result.json")) ?? undefined, sizeBytes: fs.statSync(video).size };
  }
  if (fs.existsSync(path.join(dir, "stopped"))) return { stage: "stopped", percent: p?.percent ?? 0, message: "Stopped", elapsed: p?.elapsed ?? 0, done: 0, total: 0 };
  if (p?.stage === "error" || fs.existsSync(path.join(dir, "error.txt"))) {
    const err = fs.existsSync(path.join(dir, "error.txt")) ? fs.readFileSync(path.join(dir, "error.txt"), "utf8").split("\n\n")[0] : p?.message;
    return { stage: "error", percent: p?.percent ?? 0, message: "Failed", elapsed: p?.elapsed ?? 0, done: 0, total: 0, error: err || "Unknown error" };
  }
  const base = p ?? { stage: "queued" as JobStage, percent: 0, message: "Starting…", elapsed: 0, done: 0, total: 0 };
  // The engine stopped without saying why (app restarted, laptop shut down…)
  const started = Date.parse(spec.createdAt);
  if (!alive(spec.pid) && Date.now() - started > 15_000) return { ...base, stage: "error", error: "The video maker stopped unexpectedly. Try again." };
  return base;
}

export function getJob(id: string): JobView | null {
  if (!ID_RE.test(id)) return null;
  const dir = jobDir(id);
  const spec = readJson<JobSpec>(path.join(dir, "job.json"));
  if (!spec) return null;
  let thumb: number | undefined;
  try {
    thumb = Math.round(fs.statSync(path.join(dir, "thumbnail.jpg")).mtimeMs);
  } catch {
    /* no thumbnail yet */
  }
  return { ...spec, status: statusOf(dir, spec), thumb };
}

export function listJobs(): JobView[] {
  if (!fs.existsSync(JOBS)) return [];
  return fs
    .readdirSync(JOBS)
    .filter((n) => ID_RE.test(n))
    .map(getJob)
    .filter((j): j is JobView => !!j)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const isRunning = (j: JobView) => ["queued", "voice", "render", "finish"].includes(j.status.stage);

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function createJob(input: {
  title: string;
  format: VideoFormat;
  questions: QuizQuestion[];
  settings: JobSettings;
  userId: string;
  fileName?: string;
  sourceCsv?: string;
  youtube?: Partial<YoutubeMeta>;
}): JobView {
  const id = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  // The engine gets a clean CSV: only valid questions, in a fixed column order
  const lines = ["question,option_a,option_b,option_c,option_d,answer,fact,seconds"];
  for (const q of input.questions) lines.push([q.question, ...q.options, "ABCD"[q.answer], q.fact, q.seconds].map(csvCell).join(","));
  fs.writeFileSync(path.join(dir, "questions.csv"), lines.join("\n") + "\n", "utf8");
  // The file exactly as uploaded (with its settings lines), for the dashboard's download
  if (input.sourceCsv) {
    fs.writeFileSync(path.join(dir, "source.csv"), input.sourceCsv, "utf8");
    keepCsv(input.fileName, input.sourceCsv);
  }
  const spec: JobSpec = {
    id,
    title: input.title,
    format: input.format,
    questions: input.questions.length,
    settings: input.settings,
    createdAt: new Date().toISOString(),
    createdBy: input.userId,
    fileName: input.fileName,
    exportName: exportName(input.title, input.format, new Date()),
  };
  const engineSpec = {
    format: input.format,
    settings: input.settings,
    models_dir: path.join(CHAOS_HOME, "models"),
    export_dir: VIDEO_FOLDER, // the engine copies the finished video + thumbnail here
    export_name: spec.exportName,
  };
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ ...spec, ...engineSpec }, null, 1), "utf8");
  // YouTube title / description / tags from the CSV's settings lines (editable later)
  if (input.youtube && (input.youtube.title || input.youtube.description || input.youtube.tags?.length || input.youtube.category)) saveYoutubeMeta(id, input.youtube);

  // Canva designs are made by the web app (canva-jobs.ts) while the engine records the narration;
  // the engine waits for canva\status.json to say they're done before it draws the intro.
  if (input.settings.canva) {
    fs.mkdirSync(path.join(dir, "canva"), { recursive: true });
    fs.writeFileSync(path.join(dir, "canva", "status.json"), JSON.stringify({ state: "running", updatedAt: new Date().toISOString() }), "utf8");
  }
  const log = fs.openSync(path.join(dir, "engine.log"), "a");
  const child = spawn(PYTHON, [ENGINE, dir], {
    cwd: path.dirname(ENGINE),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, CHAOS_HOME, PYTHONIOENCODING: "utf-8" },
  });
  child.unref();
  fs.closeSync(log);
  spec.pid = child.pid;
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ ...spec, ...engineSpec }, null, 1), "utf8");
  return { ...spec, status: statusOf(dir, spec) };
}

/** Stops a running job (the engine and all its render workers). */
export function stopJob(id: string) {
  const job = getJob(id);
  if (!job) return false;
  fs.writeFileSync(path.join(jobDir(id), "stopped"), new Date().toISOString());
  if (job.pid && alive(job.pid)) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(job.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-job.pid, "SIGKILL");
  }
  return true;
}

export function deleteJob(id: string) {
  const job = getJob(id);
  if (!job) return false;
  if (isRunning(job)) stopJob(id);
  fs.rmSync(jobDir(id), { recursive: true, force: true });
  return true;
}

export const videoPath = (id: string) => path.join(jobDir(id), "video.mp4");
export const thumbPath = (id: string) => path.join(jobDir(id), "thumbnail.jpg");

/** The CSV to download for a video: the file as uploaded, or (older videos) the questions it used. */
export function jobCsv(id: string): { file: string; name: string } | null {
  const job = getJob(id);
  if (!job) return null;
  const source = path.join(jobDir(id), "source.csv");
  if (fs.existsSync(source)) return { file: source, name: job.fileName || `${job.title}.csv` };
  return { file: path.join(jobDir(id), "questions.csv"), name: `${job.title} (questions).csv` };
}

/** The video's questions as the engine got them (clean CSV written by createJob). */
export function jobQuestions(id: string): QuizQuestion[] {
  try {
    return parseQuizCsv(fs.readFileSync(path.join(jobDir(id), "questions.csv"), "utf8")).questions;
  } catch {
    return [];
  }
}

/** Designs a new thumbnail (about a second). A new seed gives a different design. */
export function designThumbnail(id: string, seed = Math.floor(Math.random() * 1_000_000)) {
  const r = spawnSync(PYTHON, [THUMBNAILER, jobDir(id), String(seed)], {
    cwd: path.dirname(THUMBNAILER),
    windowsHide: true,
    timeout: 60_000,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (r.status !== 0) throw new Error(`Thumbnail failed: ${(r.stderr || r.error?.message || "").slice(-400)}`);
  // Keep the copy in videos\ in step with the new design
  const name = getJob(id)?.exportName;
  if (name && fs.existsSync(path.join(VIDEO_FOLDER, `${name}.mp4`))) fs.copyFileSync(thumbPath(id), path.join(VIDEO_FOLDER, `${name}.jpg`));
}

// ------------------------- YouTube details -------------------------
// The title, description and tags a video is published with: from the CSV's "YouTube ..." lines,
// edited in the studio, or (when neither) suggested by youtube.ts. Kept in jobs\<id>\youtube-meta.json.

export type YoutubeMeta = { title: string; description: string; tags: string[]; /** YouTube category id */ category?: string };

export function getYoutubeMeta(id: string): Partial<YoutubeMeta> | null {
  return readJson<Partial<YoutubeMeta>>(path.join(jobDir(id), "youtube-meta.json"));
}

export function saveYoutubeMeta(id: string, meta: Partial<YoutubeMeta>) {
  const keep: Partial<YoutubeMeta> = {};
  if (meta.title) keep.title = meta.title;
  if (meta.description) keep.description = meta.description;
  if (meta.tags?.length) keep.tags = meta.tags;
  if (meta.category) keep.category = meta.category;
  fs.writeFileSync(path.join(jobDir(id), "youtube-meta.json"), JSON.stringify({ ...keep, savedAt: new Date().toISOString() }, null, 1), "utf8");
}

// ------------------------- topic photos (thumbnails) -------------------------
// src\Chaos creators\images holds photos of quiz subjects (only freely licensed or own photos;
// see images\README.md). images\CREDITS.json maps a file to its credit line, which goes into
// the YouTube description of every video whose thumbnail uses it.

export const IMAGES_DIR = path.join(CHAOS_ASSETS, "images");
const IMAGE_CREDITS = path.join(IMAGES_DIR, "CREDITS.json");
const readImageCredits = () => readJson<Record<string, string>>(IMAGE_CREDITS) ?? {};

export const imageCredit = (name: string | undefined) => (name ? readImageCredits()[name] : undefined);

/** Photos in the images folder, newest first. */
export function listImages(): { name: string; credit: string | null }[] {
  const credits = readImageCredits();
  try {
    return fs
      .readdirSync(IMAGES_DIR)
      .filter((n) => IMAGE_NAME_RE.test(n) && !n.startsWith("_"))
      .map((n) => ({ n, t: fs.statSync(path.join(IMAGES_DIR, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map(({ n }) => ({ name: n, credit: credits[n] ?? null }));
  } catch {
    return [];
  }
}

/** Saves an uploaded photo under a clean, unused name. Returns the name. */
export function saveImage(fileName: string, bytes: Buffer, credit?: string) {
  const ext = (/\.(jpe?g|png|webp)$/i.exec(fileName)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const base =
    fileName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "photo";
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  let name = `${base}.${ext}`;
  for (let n = 2; fs.existsSync(path.join(IMAGES_DIR, name)); n++) name = `${base}_${n}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, name), bytes);
  if (credit) setImageCredit(name, credit);
  return name;
}

export function setImageCredit(name: string, credit: string) {
  const all = readImageCredits();
  if (credit.trim()) all[name] = credit.trim();
  else delete all[name];
  fs.writeFileSync(IMAGE_CREDITS, JSON.stringify(all, null, 2) + "\n", "utf8");
}

/** Sets (or clears, with null) a video's topic photo. The caller redesigns the thumbnail. */
export function setThumbImage(id: string, name: string | null) {
  const file = path.join(jobDir(id), "job.json");
  const spec = readJson<JobSpec & Record<string, unknown>>(file);
  if (!spec) return false;
  if (name && !fs.existsSync(path.join(IMAGES_DIR, name))) return false;
  spec.settings = { ...spec.settings, thumb_image: name ?? undefined };
  fs.writeFileSync(file, JSON.stringify(spec, null, 1), "utf8");
  return true;
}

/** sounds\ (the engine's sound library). A music file that is no longer in music\ was taken out, e.g. after a copyright claim. */
const SOUNDS_DIR = path.join(CHAOS_ASSETS, "sounds");

export type MusicCheck = { track: string | null; ok: boolean; problem?: string };

/** Which background track a finished video used, and whether it's still allowed. */
export function musicCheck(job: JobView): MusicCheck {
  const used = job.status.result?.sounds?.music ?? [];
  const track = used[0] ?? null;
  if (!job.status.result?.sounds) return { track: null, ok: true }; // made before Nov 2026: unknown
  if (!track) return { track: null, ok: true }; // no music
  const file = path.join(SOUNDS_DIR, "music", ...track.split("/"));
  if (!fs.existsSync(file))
    return {
      track,
      ok: false,
      problem: `This video's music (${track}) has been taken out of the library, after a copyright claim. YouTube would block it. Make the video again: it will get a different track.`,
    };
  return { track, ok: true };
}

// ------------------------- dashboard marks -------------------------
// Rahul's own ticks on the dashboard: "uploaded" (he put it on YouTube himself) and "discarded"
// (not going to use it). They are only labels: nothing is deleted.

export type VideoMarks = { uploaded?: boolean; discarded?: boolean };

export function getMarks(id: string): VideoMarks {
  const marks = readJson<VideoMarks>(path.join(jobDir(id), "marks.json"));
  if (marks) return marks;
  return readUploadLog().some((e) => e.id === id) ? { uploaded: true } : {};
}

export function setMark(id: string, mark: keyof VideoMarks, value: boolean) {
  const job = getJob(id);
  if (!job) return false;
  const marks = { ...getMarks(id), [mark]: value };
  fs.writeFileSync(path.join(jobDir(id), "marks.json"), JSON.stringify(marks), "utf8");
  if (mark === "uploaded") logUpload(job, value);
  return true;
}

/**
 * The permanent record of what is on YouTube: src\Chaos creators\uploaded-videos.json (in OneDrive,
 * so it's backed up). It outlives the job folder (deleting a video in the studio keeps its entry) and
 * is what to check before making a quiz on a topic that may already be up.
 */
export const UPLOAD_LOG = path.join(LIBRARY, "uploaded-videos.json");

export type UploadLogEntry = { id: string; title: string; csv: string | null; format: VideoFormat; questions: number; madeAt: string; markedAt: string };

export const readUploadLog = () => readJson<UploadLogEntry[]>(UPLOAD_LOG) ?? [];

function logUpload(job: JobView, uploaded: boolean) {
  const log = readUploadLog().filter((e) => e.id !== job.id);
  if (uploaded)
    log.push({ id: job.id, title: job.title, csv: job.fileName ?? null, format: job.format, questions: job.questions, madeAt: job.createdAt, markedAt: new Date().toISOString() });
  log.sort((a, b) => a.markedAt.localeCompare(b.markedAt));
  fs.mkdirSync(LIBRARY, { recursive: true });
  fs.writeFileSync(UPLOAD_LOG + ".tmp", JSON.stringify(log, null, 1), "utf8");
  fs.renameSync(UPLOAD_LOG + ".tmp", UPLOAD_LOG);
}

const CSV_MARKS = path.join(CHAOS_HOME, "csv-marks.json");
const readCsvMarks = () => readJson<Record<string, { discarded?: boolean }>>(CSV_MARKS) ?? {};

/** A CSV in csv\ by its plain file name (never a path). */
function csvFile(name: string) {
  if (!/^[^\\/:*?"<>|\x00-\x1f]+\.csv$/i.test(name) || name.startsWith(".")) return null;
  const file = path.join(CSV_FOLDER, name);
  return fs.existsSync(file) ? file : null;
}

export function setCsvDiscarded(name: string, value: boolean) {
  if (!csvFile(name)) return false;
  const all = readCsvMarks();
  if (value) all[name] = { ...all[name], discarded: true };
  else delete all[name];
  fs.mkdirSync(CHAOS_HOME, { recursive: true });
  fs.writeFileSync(CSV_MARKS, JSON.stringify(all, null, 1), "utf8");
  return true;
}

export type CsvEntry = {
  name: string;
  modifiedAt: string;
  videoName: string | null;
  questions: number;
  problems: number;
  discarded: boolean;
  /** Ids of the videos made from this file, newest first */
  videoIds: string[];
};

/**
 * Every CSV in csv\ with the videos made from it. A video belongs to the file whose content
 * matches the CSV it was made from (line endings ignored); videos without a saved copy
 * (made before 18 Nov 2026) are matched by file name.
 */
export function listCsvLibrary(jobs: JobView[] = listJobs()): CsvEntry[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(CSV_FOLDER).filter((n) => /\.csv$/i.test(n) && csvFile(n));
  } catch {
    return [];
  }
  const marks = readCsvMarks();
  const files = names.map((name) => {
    const file = path.join(CSV_FOLDER, name);
    const content = fs.readFileSync(file, "utf8");
    const parsed = parseQuizCsv(content);
    return {
      name,
      norm: normCsv(content),
      entry: {
        name,
        modifiedAt: fs.statSync(file).mtime.toISOString(),
        videoName: parsed.settings.videoName ?? null,
        questions: parsed.questions.length,
        problems: parsed.issues.filter((i) => i.level === "error").length,
        discarded: !!marks[name]?.discarded,
        videoIds: [] as string[],
      } satisfies CsvEntry,
    };
  });
  for (const job of jobs) {
    let source: string | null = null;
    try {
      source = normCsv(fs.readFileSync(path.join(jobDir(job.id), "source.csv"), "utf8"));
    } catch {
      /* older video */
    }
    // Same content first; failing that (the CSV was edited afterwards) the same file name
    const same = source != null ? files.filter((f) => f.norm === source) : [];
    const matches = same.length ? same : files.filter((f) => f.name === job.fileName);
    const home = matches.find((f) => f.name === job.fileName) ?? matches[0];
    home?.entry.videoIds.push(job.id);
  }
  return files.map((f) => f.entry);
}
