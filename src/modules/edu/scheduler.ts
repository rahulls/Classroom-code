import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isRunning, listJobs } from "@/modules/chaos/jobs";
import { youtubeConnection } from "@/modules/chaos/youtube";
import { checkMaking, isMakingHere, startMaking } from "./making";
import { checkUploading, retryThumbnails, startPublish } from "./publish";
import { EDU_HOME, getSettings, listRows, logEvent, readJson, updateRow, writeJson, type EduSettings, type RowStatus, type TopicRow } from "./store";
import { writeScript } from "./writer";

// The conveyor belt (started from src/instrumentation.ts in the production server):
//  1. WRITER  — keeps keepAhead topics (default 5) in the pipeline ahead of upload: whenever fewer are
//               being written / waiting for review / being made / ready, Claude writes the next topic's
//               script (one at a time). After a failed write it waits 30 minutes before trying again.
//  2. MAKER   — whenever a script is approved and nothing else is being made, makes its video.
//  3. PUBLISHER — at each publishing slot uploads the oldest approved video (private). No approved
//               video = the slot is skipped (logged); nothing unreviewed is ever published.
// Slots: every intervalHours, counted from firstSlot (India time). Missed slots (PC off) are not
// made up: only the latest slot counts.

const IST = 5.5 * 3600_000;
const HOUR = 3600_000;

function reference(s: EduSettings) {
  const [h, m] = s.firstSlot.split(":").map(Number);
  return Date.UTC(2026, 0, 1, h || 0, m || 0) - IST; // firstSlot on 1 Jan 2026, India time, as UTC ms
}
export const slotAtOrBefore = (t: number, s: EduSettings) => {
  const ref = reference(s);
  const iv = s.intervalHours * HOUR;
  return ref + Math.floor((t - ref) / iv) * iv;
};
export const nextSlot = (t: number, s: EduSettings) => slotAtOrBefore(t, s) + s.intervalHours * HOUR;

type Schedule = { lastWriteSlot?: number; lastPublishSlot?: number; holdAlerted?: boolean; writeFailedAt?: number; listDoneAlerted?: boolean };
const SCHEDULE = () => path.join(EDU_HOME, "schedule.json");
const getSchedule = () => readJson<Schedule>(SCHEDULE()) ?? {};
const saveSchedule = (patch: Schedule) => writeJson(SCHEDULE(), { ...getSchedule(), ...patch });

/** Called by the Start button: writes the first script straight away; publishing starts from the next slot. */
export function resetSchedule(now = Date.now()) {
  const s = getSettings();
  writeJson(SCHEDULE(), { lastPublishSlot: slotAtOrBefore(now, s) } satisfies Schedule);
}

/** The pipeline ahead of upload: what keepAhead counts. */
const IN_PROGRESS: RowStatus[] = ["writing", "script_review", "approved", "making", "video_review", "ready", "uploading"];
export const inProgress = (rows: TopicRow[]) => rows.filter((r) => IN_PROGRESS.includes(r.status));
const WRITE_RETRY_MS = 30 * 60_000;

const g = globalThis as unknown as { eduWriting?: Set<string>; eduTimer?: ReturnType<typeof setInterval>; eduTicking?: boolean };
const writing = (g.eduWriting ??= new Set<string>());

/** Writes the script of one row now (or of the next topic in the list). Resolves when done. */
export async function writeNow(id?: string, prompt?: { instructions?: string; message?: string }): Promise<TopicRow | null> {
  const rows = listRows();
  const row = id ? rows.find((r) => r.id === id) : rows.find((r) => r.status === "queued");
  if (!row || writing.has(row.id)) return null;
  writing.add(row.id);
  updateRow(row.id, (r) => ({ ...r, status: "writing", pickedAt: r.pickedAt ?? new Date().toISOString(), error: undefined, failedAt: undefined }));
  try {
    const d = await writeScript(row, prompt);
    if (getSchedule().writeFailedAt) saveSchedule({ writeFailedAt: undefined });
    const done = updateRow(row.id, (r) => ({ ...r, status: "script_review", title: d.title, summary: d.summary, scriptAt: new Date().toISOString(), rewriteNote: undefined }));
    logEvent("alert", `Script ready to review: "${d.title}"`, row.id);
    return done;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateRow(row.id, (r) => ({ ...r, status: "failed", failedAt: "queued", error: msg }));
    saveSchedule({ writeFailedAt: Date.now() }); // the belt waits 30 minutes before writing again
    logEvent("error", `Couldn't write the script for "${row.topic}": ${msg}`, row.id);
    return null;
  } finally {
    writing.delete(row.id);
  }
}

const otherEngineBusy = () => {
  try {
    return listJobs().some(isRunning); // a Chaos Creators video is rendering: don't fight it for the CPU
  } catch {
    return false;
  }
};

/** One pass of the belt. Safe to call any number of times. */
export async function tick(now = Date.now()) {
  const s = getSettings();
  // Tidy up after restarts and finished background work
  for (const r of listRows()) {
    if (r.status === "writing" && !writing.has(r.id)) updateRow(r.id, (x) => ({ ...x, status: "queued" }));
    if (r.status === "making") checkMaking(r);
    if (r.status === "uploading") checkUploading(r.id);
  }
  void retryThumbnails(now);
  if (s.paused) return;

  // 2. MAKER
  const rows = listRows();
  if (!rows.some((r) => r.status === "making" || isMakingHere(r.id)) && !otherEngineBusy()) {
    const next = rows.filter((r) => r.status === "approved").sort((a, b) => (a.scriptApprovedAt ?? "").localeCompare(b.scriptApprovedAt ?? ""))[0];
    if (next) startMaking(next.id);
  }

  // 3. PUBLISHER
  const sch = getSchedule();
  const slot = slotAtOrBefore(now, s);
  if (sch.lastPublishSlot == null) saveSchedule({ lastPublishSlot: slot });
  else if (slot > sch.lastPublishSlot) {
    saveSchedule({ lastPublishSlot: slot });
    const ready = listRows()
      .filter((r) => r.status === "ready")
      .sort((a, b) => (a.videoApprovedAt ?? "").localeCompare(b.videoApprovedAt ?? ""))[0];
    const when = new Date(slot).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const linked = youtubeConnection("edu").connected;
    if (linked && getSchedule().holdAlerted) saveSchedule({ holdAlerted: false });
    if (ready && !linked) {
      const waiting = listRows().filter((r) => r.status === "ready").length;
      if (!getSchedule().holdAlerted) {
        saveSchedule({ holdAlerted: true });
        logEvent("alert", `Uploads are on hold: the Edu channel's YouTube isn't connected. Videos keep being made and wait as "ready" (${waiting} now); connect the channel in Settings and they go up one per slot (or use Publish now).`);
      } else logEvent("info", `Slot ${when}: upload on hold, no channel connected (${waiting} video${waiting === 1 ? "" : "s"} ready).`);
    } else if (ready) {
      startPublish(ready.id, `slot ${when}`);
      const left = listRows().filter((r) => r.status === "ready" && r.id !== ready.id).length;
      if (left < s.minReady) logEvent("alert", `Only ${left} approved video${left === 1 ? "" : "s"} left for the next slots (you wanted ${s.minReady} ahead). ${reviewHint()}`);
    } else logEvent("alert", `Slot ${when} skipped: no approved video was waiting. Review the scripts and videos on the dashboard.`);
  }

  // 1. WRITER: top the pipeline up to keepAhead, one script at a time
  const now2 = listRows();
  const queued = now2.some((r) => r.status === "queued");
  if (!queued) {
    if (!now2.some((r) => IN_PROGRESS.includes(r.status)) && !getSchedule().listDoneAlerted) {
      saveSchedule({ listDoneAlerted: true });
      logEvent("alert", "The topic list is finished: add more topics to keep the schedule going.");
    }
  } else {
    if (getSchedule().listDoneAlerted) saveSchedule({ listDoneAlerted: false });
    const failedAt = getSchedule().writeFailedAt ?? 0;
    if (!writing.size && inProgress(now2).length < s.keepAhead && now - failedAt > WRITE_RETRY_MS) void writeNow();
  }
}

/** "Review: 2 scripts, 1 video waiting." */
export function reviewHint(rows = listRows()) {
  const sc = rows.filter((r) => r.status === "script_review").length;
  const vi = rows.filter((r) => r.status === "video_review").length;
  if (!sc && !vi) return "Nothing is waiting for review: the next scripts are on their way.";
  return `Waiting for your review: ${[sc && `${sc} script${sc === 1 ? "" : "s"}`, vi && `${vi} video${vi === 1 ? "" : "s"}`].filter(Boolean).join(", ")}.`;
}

const LOCK = () => path.join(EDU_HOME, "scheduler.lock");

/** Only one app process runs the belt (the production server); a second one stays idle. */
function holdLock() {
  const l = readJson<{ pid: number; beat: number }>(LOCK());
  if (l && l.pid !== process.pid && Date.now() - l.beat < 3 * 60_000) {
    try {
      process.kill(l.pid, 0);
      return false;
    } catch {
      /* that process is gone */
    }
  }
  fs.mkdirSync(EDU_HOME, { recursive: true });
  writeJson(LOCK(), { pid: process.pid, beat: Date.now() });
  return true;
}

export function startEduScheduler(everyMs = 60_000) {
  if (g.eduTimer) return;
  const run = async () => {
    if (g.eduTicking || !holdLock()) return;
    g.eduTicking = true;
    try {
      await tick();
    } catch (e) {
      console.error("[edu] scheduler:", e);
    } finally {
      g.eduTicking = false;
    }
  };
  setTimeout(run, 20_000);
  g.eduTimer = setInterval(run, everyMs);
}

export type Estimate = {
  /** When the script is written (rows still in the list) */
  script?: number;
  /** When the video is (about to be) made; done = already made */
  made?: number;
  madeDone?: boolean;
  /** The publishing slot it should go up in (or when it went up) */
  upload?: number;
  uploadDone?: boolean;
  /** Needs Rahul's review before it can move on (estimates assume a prompt review) */
  waitsForYou?: boolean;
};

const WRITE_MS = 3 * 60_000;
/** How long making a video takes: the average of the last 3 makes of that format, never less than the floor. */
function makeMs(rows: TopicRow[], format: TopicRow["format"]) {
  const floor = (format === "long" ? 60 : 20) * 60_000;
  const took = rows
    .filter((r) => r.format === format && r.makeStartedAt && r.videoAt && r.videoAt > r.makeStartedAt)
    .sort((a, b) => (b.videoAt ?? "").localeCompare(a.videoAt ?? ""))
    .slice(0, 3)
    .map((r) => Date.parse(r.videoAt!) - Date.parse(r.makeStartedAt!));
  const avg = took.length ? took.reduce((a, b) => a + b, 0) / took.length : 0;
  return Math.max(floor, avg);
}

/** For the topics list: about when each row's script is written, its video made and uploaded.
 *  Follows the belt: uploads one per slot oldest-approved first, the writer keeps keepAhead in the
 *  pipeline (so a listed topic is written after enough uploads free a place), the maker makes one
 *  video at a time. Review time is unknown, so it assumes scripts and videos are reviewed promptly. */
export function estimates(now = Date.now()): Map<string, Estimate> {
  const s = getSettings();
  const rows = listRows();
  const iv = s.intervalHours * HOUR;
  const out = new Map<string, Estimate>();
  const slotFrom = (t: number) => {
    const at = slotAtOrBefore(t, s);
    return at >= t ? at : at + iv;
  };
  const by = (k: keyof TopicRow) => (a: TopicRow, b: TopicRow) => String(a[k] ?? "").localeCompare(String(b[k] ?? ""));
  const pick = (st: RowStatus, k?: keyof TopicRow) => {
    const l = rows.filter((r) => r.status === st);
    return k ? l.sort(by(k)) : l;
  };

  for (const r of rows) if (r.status === "published") out.set(r.id, { upload: r.publishedAt ? Date.parse(r.publishedAt) : undefined, uploadDone: true, made: r.videoAt ? Date.parse(r.videoAt) : undefined, madeDone: true });

  let makerFree = now;
  const making = rows.find((r) => r.status === "making");
  if (making) {
    makerFree = Math.max(now + 2 * 60_000, (making.makeStartedAt ? Date.parse(making.makeStartedAt) : now) + makeMs(rows, making.format));
  }
  const failedAt = getSchedule().writeFailedAt ?? 0;
  let writerFree = Math.max(now, failedAt + WRITE_RETRY_MS);

  // The order videos go up in
  const order: TopicRow[] = [
    ...pick("ready", "videoApprovedAt"),
    ...pick("video_review", "videoAt"),
    ...(making ? [making] : []),
    ...pick("approved", "scriptApprovedAt"),
    ...pick("script_review", "scriptAt"),
    ...pick("writing"),
    ...pick("queued"),
  ];
  const ahead = inProgress(rows).length;
  const uploads: number[] = [];
  const uploading = rows.find((r) => r.status === "uploading");
  if (uploading) {
    out.set(uploading.id, { made: uploading.videoAt ? Date.parse(uploading.videoAt) : undefined, madeDone: true, upload: now });
    uploads.push(now);
  }
  let cursor = nextSlot(now, s);
  let k = 0; // position among the listed (queued) rows
  for (const r of order) {
    const e: Estimate = {};
    const D = makeMs(rows, r.format);
    let readyAt = now;
    if (r.status === "ready" || r.status === "video_review") {
      e.made = r.videoAt ? Date.parse(r.videoAt) : undefined;
      e.madeDone = true;
      e.waitsForYou = r.status === "video_review";
    } else if (r.status === "making") {
      e.made = readyAt = makerFree;
    } else {
      let scriptAt = now;
      if (r.status === "writing") scriptAt = now + WRITE_MS;
      if (r.status === "queued") {
        k++;
        // written once the pipeline has room: straight away, or after the upload that frees a place
        const freedBy = ahead + k - s.keepAhead; // the n-th upload from now frees this row's place
        const from = freedBy <= 0 ? writerFree : (uploads[freedBy - 1] ?? cursor) + 2 * 60_000;
        scriptAt = Math.max(writerFree, from) + WRITE_MS;
        writerFree = scriptAt;
        e.script = scriptAt;
      }
      e.waitsForYou = r.status !== "approved";
      e.made = readyAt = Math.max(makerFree, scriptAt) + D;
      makerFree = e.made;
    }
    e.upload = slotFrom(Math.max(cursor, readyAt));
    cursor = e.upload + iv;
    uploads.push(e.upload);
    out.set(r.id, e);
  }
  return out;
}

/** For the dashboard: when things happen next. */
export function timeline(now = Date.now()) {
  const s = getSettings();
  const sch = getSchedule();
  const rows = listRows();
  const nextPublish = nextSlot(now, s);
  const queued = rows.filter((r) => r.status === "queued").length;
  const ahead = inProgress(rows).length;
  const failedAt = sch.writeFailedAt ?? 0;
  return {
    nextPublish,
    /** When the next script is written: now (pipeline short), after a failed write's pause, or when an upload frees a place */
    nextWrite: !queued ? null : ahead < s.keepAhead ? Math.max(now, failedAt + WRITE_RETRY_MS) : nextPublish,
    ahead,
    readyCount: rows.filter((r) => r.status === "ready").length,
    queued,
    inProgress: inProgress(rows).length,
    /** About when the list runs out, at one video per slot */
    runsOutAt: queued ? nextPublish + (queued + inProgress(rows).length - 1) * s.intervalHours * HOUR : null,
    running: !!g.eduTimer,
  };
}
