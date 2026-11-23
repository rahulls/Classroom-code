import "server-only";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { canvaConnection, canvaDesign, canvaPicture, withCanva } from "@/modules/chaos/canva";
import { CHAOS_HOME, PYTHON } from "@/modules/chaos/jobs";
import { channelName, logoFile } from "./brand";
import { EDU_ENGINE, EDU_LIBRARY, getRow, getSettings, itemDir, logEvent, readJson, updateRow, writeJson, type TopicRow } from "./store";
import { getDraft, type Draft } from "./writer";

// Making a video from an approved script: Canva pictures (picture scenes) and the Canva thumbnail
// first, then the engine (src/Edu videos/engine/run.py: voice -> animation -> MP4 -> thumbnail) in a
// detached process that keeps going if the page is closed. When Canva can't deliver, the engine
// draws a plain card / a minimal thumbnail instead, and Rahul gets an alert saying so.

const ANIM_PYTHON = path.join(CHAOS_HOME, "anim-venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
const RUNNER = path.join(EDU_ENGINE, "run.py");

export function engineProblem(): string | null {
  if (!fs.existsSync(PYTHON)) return `The video engine isn't installed (no Python at ${PYTHON}).`;
  if (!fs.existsSync(ANIM_PYTHON)) return `The animation engine isn't installed (no ${ANIM_PYTHON}).`;
  if (!fs.existsSync(path.join(CHAOS_HOME, "models", "kokoro.onnx"))) return "The narrator voice model is missing.";
  if (!fs.existsSync(RUNNER)) return "The edu engine script is missing.";
  return null;
}

const g = globalThis as unknown as { eduMaking?: Set<string> };
const active = (g.eduMaking ??= new Set<string>());
export const isMakingHere = (id: string) => active.has(id);

export function alive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type MakeProgress = { stage: string; percent: number; message: string; updated?: number };
export const makeProgress = (id: string) => readJson<MakeProgress>(path.join(itemDir(id), "progress.json"));
export const videoFile = (id: string) => path.join(itemDir(id), "video.mp4");
export const thumbFile = (id: string) => path.join(itemDir(id), "thumbnail.jpg");
export type MakeResult = { duration: number; scenes: number; chapters: { t: number; title: string }[]; thumbnail: "canva" | "fallback"; scene_fallbacks: string[]; render_seconds: number };
export const makeResult = (id: string) => readJson<MakeResult>(path.join(itemDir(id), "result.json"));
export function makeError(id: string) {
  try {
    return fs.readFileSync(path.join(itemDir(id), "error.txt"), "utf8").split("\n\n")[0]!.slice(0, 600);
  } catch {
    return null;
  }
}

function setProgress(id: string, stage: string, percent: number, message: string) {
  writeJson(path.join(itemDir(id), "progress.json"), { stage, percent, message, updated: Date.now() / 1000 });
}

function notice(id: string, text: string) {
  updateRow(id, (r) => ({ ...r, notices: [...(r.notices ?? []), text].slice(-20) }));
  logEvent("alert", text, id);
}

/** The engine's script.json: the reviewed draft plus the voice. */
function engineScript(d: Draft) {
  return { title: d.title, format: d.format, kicker: d.kicker, thumbnail_text: d.thumbnail_text, channel: channelName() ?? "", voice: d.voice || "af_heart", speed: 1.0, scenes: d.scenes };
}

const SIZE = { long: { thumb: "YouTube Thumbnail", shape: "a 16:9 YouTube video thumbnail, exactly 1280x720 pixels", corner: "the bottom-right corner (YouTube shows the video length there)" }, short: { thumb: "Your Story", shape: "a vertical 9:16 YouTube Shorts cover, exactly 1080x1920 pixels", corner: "the bottom 20% (YouTube shows the Shorts title and buttons there)" } } as const;

function thumbnailBrief(row: TopicRow, d: Draft) {
  const s = SIZE[d.format];
  return [
    `Create ${s.shape} for an animated educational explainer video, "${d.youtube_title || d.title}", about ${row.topic}. Use one bold, simple, colourful image that instantly says "${row.topic}". A single page, filling the whole frame, no borders.`,
    `Make it click-through friendly: the title text is the biggest, boldest thing, readable even as a tiny phone thumbnail; one clear focal point with strong contrast; a curious, "I want to know" mood; few words, big letters, thick outlines, no clutter.`,
    `Text, spelled exactly: title "${d.thumbnail_text}"; small tag "${d.kicker}". No other text.`,
    `Keep all text well inside the edges. Keep ${s.corner} and the bottom-left corner (a small round channel logo goes there) free of text. No watermarks. No realistic photos or likenesses of real, identifiable people.`,
  ].join("\n");
}

const COOLING = /cool|rate|limit|429|busy/i;

/** Canva pictures and thumbnail for one video. Never throws: failures become notices. */
async function canvaWork(row: TopicRow, d: Draft) {
  const s = getSettings();
  const dir = itemDir(row.id);
  const pictures = d.scenes.map((sc, i) => ({ sc, i })).filter((x) => x.sc.type === "picture");
  const wantPics = s.canvaPictures && pictures.length > 0;
  const wantThumb = s.canvaThumbnail;
  if (!wantPics && !wantThumb) return;
  if (!canvaConnection().connected) {
    notice(row.id, `"${d.title}": Canva isn't connected, so ${[wantThumb && "the thumbnail", wantPics && "the pictures"].filter(Boolean).join(" and ")} will be simple ones made by the engine. Connect Canva in Chaos Creators → Canva.`);
    return;
  }
  const failed: string[] = [];
  try {
    await withCanva(async (client) => {
      const attempt = async <T,>(what: string, fn: () => Promise<T>): Promise<T | null> => {
        for (let k = 0; k < 2; k++) {
          try {
            return await fn();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (k === 0 && COOLING.test(msg)) {
              await new Promise((r) => setTimeout(r, 90_000)); // Canva's "cooling down" usually clears in a minute or two
              continue;
            }
            failed.push(`${what} (${msg.slice(0, 160)})`);
            return null;
          }
        }
        return null;
      };
      if (wantPics) {
        fs.mkdirSync(path.join(dir, "pics"), { recursive: true });
        for (const [k, { sc, i }] of pictures.entries()) {
          setProgress(row.id, "pictures", 1 + k, `Canva picture ${k + 1} of ${pictures.length}`);
          const pages = await attempt(`picture for scene ${i + 1}`, () => canvaPicture(sc.picture_prompt || sc.heading || row.topic, d.format === "short", client));
          if (pages?.[0]) fs.writeFileSync(path.join(dir, "pics", `scene${i + 1}.png`), pages[0]);
        }
      }
      if (wantThumb) {
        setProgress(row.id, "pictures", 1 + pictures.length, "Canva thumbnail");
        const design = await attempt("thumbnail", () => canvaDesign(thumbnailBrief(row, d), SIZE[d.format].thumb, client));
        if (design?.pages[0]) {
          fs.mkdirSync(path.join(dir, "canva"), { recursive: true });
          fs.writeFileSync(path.join(dir, "canva", "thumbnail.png"), design.pages[0]);
        }
      }
    });
  } catch (e) {
    failed.push(`Canva login (${e instanceof Error ? e.message.slice(0, 160) : String(e)})`);
  }
  if (failed.length)
    notice(
      row.id,
      `"${d.title}": Canva couldn't make ${failed.join("; ")}. The engine used a plain card / a minimal thumbnail instead. Check it before approving (Canva's AI allowance renews on the 23rd).`,
    );
}

/** Removes a row's copy in the video library (src\Edu videosideos) once that video is discarded:
 * remade, sent back to the script or rejected. Only the published / current version stays there. */
export function discardLibraryCopy(id: string) {
  const row = getRow(id);
  if (!row?.exportName || row.status === "published") return;
  for (const ext of [".mp4", ".jpg"]) fs.rmSync(path.join(EDU_LIBRARY, "videos", row.exportName + ext), { force: true });
  updateRow(id, (r) => ({ ...r, exportName: undefined }));
}

/** Starts making the video of an approved row (returns at once; the work goes on in the background). */
export function startMaking(id: string) {
  const row = getRow(id);
  const d = getDraft(id);
  if (!row || !d || active.has(id)) return false;
  const problem = engineProblem();
  if (problem) {
    updateRow(id, (r) => ({ ...r, status: "failed", failedAt: "approved", error: problem }));
    logEvent("error", `Couldn't make "${d.title}": ${problem}`, id);
    return false;
  }
  const dir = itemDir(id);
  discardLibraryCopy(id); // the old version is being replaced
  for (const f of ["video.mp4", "thumbnail.jpg", "result.json", "error.txt", "progress.json", "timing.json", "audio.wav"]) fs.rmSync(path.join(dir, f), { force: true });
  for (const f of ["pics", "canva", "media"]) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  writeJson(path.join(dir, "script.json"), engineScript(d));
  // The Edu channel's logo (Settings). None uploaded: the video and thumbnail simply have no logo.
  for (const f of fs.readdirSync(dir)) if (/^logo_(src\.\w+|round\.png)$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const logo = logoFile();
  if (logo) fs.copyFileSync(logo, path.join(dir, `logo_src${path.extname(logo).toLowerCase()}`));
  updateRow(id, (r) => ({ ...r, status: "making", makeStartedAt: new Date().toISOString(), error: undefined, failedAt: undefined, notices: [], pid: undefined }));
  setProgress(id, "pictures", 0, "Getting pictures from Canva");
  active.add(id);
  void (async () => {
    try {
      await canvaWork(row, d);
      setProgress(id, "voice", 1, "Starting the engine");
      const log = fs.openSync(path.join(dir, "engine.log"), "a");
      const child = spawn(PYTHON, [RUNNER, dir], {
        cwd: EDU_ENGINE,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: { ...process.env, CHAOS_HOME, PYTHONIOENCODING: "utf-8" },
      });
      child.unref();
      fs.closeSync(log);
      updateRow(id, (r) => ({ ...r, pid: child.pid }));
      logEvent("info", `Making the video of "${d.title}"`, id);
    } catch (e) {
      updateRow(id, (r) => ({ ...r, status: "failed", failedAt: "approved", error: e instanceof Error ? e.message : String(e) }));
      logEvent("error", `Couldn't start making "${d.title}": ${e instanceof Error ? e.message : String(e)}`, id);
    } finally {
      active.delete(id);
    }
  })();
  return true;
}

export function stopMaking(id: string) {
  const row = getRow(id);
  if (row?.pid && alive(row.pid)) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(row.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-row.pid, "SIGKILL");
  }
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);

/** Called by the scheduler for rows being made: moves them on when the engine has finished. */
export function checkMaking(row: TopicRow) {
  if (row.status !== "making" || active.has(row.id)) return;
  const dir = itemDir(row.id);
  const result = makeResult(row.id);
  if (result && fs.existsSync(videoFile(row.id))) {
    const d = getDraft(row.id);
    const at = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date())
      .reduce<Record<string, string>>((o, p) => ({ ...o, [p.type]: p.value }), {});
    const exportName = `${safeName(d?.title || row.topic)} - ${row.format === "short" ? "Short" : "Long"} - ${at.year}-${at.month}-${at.day} ${at.hour}${at.minute}`;
    try {
      const out = path.join(EDU_LIBRARY, "videos");
      fs.mkdirSync(out, { recursive: true });
      fs.copyFileSync(videoFile(row.id), path.join(out, `${exportName}.mp4`));
      if (fs.existsSync(thumbFile(row.id))) fs.copyFileSync(thumbFile(row.id), path.join(out, `${exportName}.jpg`));
    } catch (e) {
      console.error("[edu] couldn't copy the video to the library", e);
    }
    updateRow(row.id, (r) => ({ ...r, status: "video_review", videoAt: new Date().toISOString(), pid: undefined, exportName }));
    if (result.scene_fallbacks?.length) {
      const drawn = result.scene_fallbacks.filter((f) => f.includes("fell back"));
      if (drawn.length) notice(row.id, `"${d?.title}": ${drawn.length} scene(s) couldn't be drawn as planned and became plain text cards. Watch them before approving.`);
    }
    logEvent("alert", `Video ready to review: "${d?.title || row.topic}" (${Math.round(result.duration)} s)`, row.id);
    return;
  }
  const err = makeError(row.id);
  if (err) {
    updateRow(row.id, (r) => ({ ...r, status: "failed", failedAt: "approved", error: err, pid: undefined }));
    logEvent("error", `Making the video of "${row.title || row.topic}" failed: ${err}`, row.id);
    return;
  }
  // Neither finished nor failed, and the engine isn't running: the app or PC restarted mid-way
  const p = makeProgress(row.id);
  const quiet = !p?.updated || Date.now() / 1000 - p.updated > 120;
  if (!alive(row.pid) && quiet && fs.existsSync(dir)) {
    updateRow(row.id, (r) => ({ ...r, status: "approved", pid: undefined }));
    logEvent("info", `Making "${row.title || row.topic}" was interrupted (restart); it will start again.`, row.id);
  }
}
