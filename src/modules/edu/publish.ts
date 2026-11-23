import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CATEGORY } from "@/modules/chaos/csv";
import { UserError } from "@/core/action";
import { setThumbnailFile, uploadVideoFile, youtubeConnection, type UploadState } from "@/modules/chaos/youtube";
import { thumbFile, videoFile, makeResult } from "./making";
import { getRow, itemDir, listRows, logEvent, readJson, updateRow, writeJson } from "./store";
import { getDraft } from "./writer";


// Publishing an approved video to the Edu channel, always as PRIVATE (Rahul makes it
// public in YouTube Studio). Uploads go through the Edu channel's own YouTube connection
// (Edu videos → Settings), never the Chaos Creators one. Each row's upload state is kept in items\<id>\youtube.json.

const stamp = (t: number) => {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** YouTube chapters (long videos): first at 0:00, at least 3, each at least 10 seconds long. */
function chapterLines(id: string): string[] | null {
  const r = makeResult(id);
  if (!r?.chapters?.length) return null;
  const ch = [...r.chapters].sort((a, b) => a.t - b.t);
  ch[0] = { ...ch[0]!, t: 0 };
  const keep: typeof ch = [];
  for (const c of ch) {
    if (keep.length && c.t - keep.at(-1)!.t < 10) continue;
    keep.push(c);
  }
  if (keep.length > 1 && r.duration - keep.at(-1)!.t < 10) keep.pop();
  if (keep.length < 3) return null;
  return keep.map((c) => `${stamp(c.t)} ${c.title.replace(/[<>]/g, "")}`);
}

export type PublishMeta = { title: string; description: string; tags: string[] };

/** What the video is published with: the reviewed script's YouTube text, plus chapters / #shorts. */
export function publishMeta(id: string): PublishMeta | null {
  const d = getDraft(id);
  const row = getRow(id);
  if (!d || !row) return null;
  let title = (d.youtube_title || d.title).replace(/[<>]/g, "").trim();
  let description = d.youtube_description.replace(/[<>]/g, "").trim();
  if (row.format === "short") {
    if (!/#shorts\b/i.test(title) && title.length + 8 <= 100) title += " #shorts";
    if (!/#shorts\b/i.test(`${title}\n${description}`)) description += "\n#shorts";
  } else {
    const ch = chapterLines(id);
    if (ch) {
      // chapters go before the hashtag line
      const lines = description.split("\n");
      const tagLine = lines.length && /^\s*#/.test(lines.at(-1)!) ? lines.pop()! : null;
      description = [...lines, "", "Chapters:", ...ch, ...(tagLine ? ["", tagLine] : [])].join("\n");
    }
  }
  return { title: title.slice(0, 100), description: description.slice(0, 5000), tags: d.youtube_tags.slice(0, 18) };
}

const uploadFile = (id: string) => path.join(itemDir(id), "youtube.json");
export function getEduUpload(id: string): UploadState | null {
  const u = readJson<UploadState>(uploadFile(id));
  if (u?.state === "uploading" && Date.now() - u.updatedAt > 45_000) return { ...u, state: "error", error: "The upload was interrupted (the app restarted)." };
  return u;
}

const g = globalThis as unknown as { eduUploading?: Set<string> };
const uploading = (g.eduUploading ??= new Set<string>());

/** Uploads a ready row now (private). Returns at once; progress is in youtube.json. */
export function startPublish(id: string, why: string) {
  const row = getRow(id);
  const meta = publishMeta(id);
  if (!row || !meta || uploading.has(id)) return false;
  if (!fs.existsSync(videoFile(id))) {
    updateRow(id, (r) => ({ ...r, status: "failed", failedAt: "ready", error: "The video file is missing." }));
    return false;
  }
  const conn = youtubeConnection("edu");
  if (!conn.connected) {
    logEvent("alert", `Couldn't publish "${row.title}": the Edu channel's YouTube isn't connected (Edu videos → Settings). It stays ready for the next slot.`, id);
    return false;
  }
  uploading.add(id);
  updateRow(id, (r) => ({ ...r, status: "uploading", uploadAttempts: (r.uploadAttempts ?? 0) + 1 }));
  logEvent("info", `Uploading "${row.title}" to YouTube as private (${why})`, id);
  void (async () => {
    try {
      const st = await uploadVideoFile(
        videoFile(id),
        fs.existsSync(thumbFile(id)) ? thumbFile(id) : null,
        { ...meta, privacy: "private", madeForKids: false, useThumbnail: true, categoryId: DEFAULT_CATEGORY }, // never "made for kids" (Rahul)
        (state) => writeJson(uploadFile(id), state),
        "edu",
      );
      if (st.state === "done" && st.videoId) {
        updateRow(id, (r) => ({
          ...r,
          status: "published",
          publishedAt: new Date().toISOString(),
          error: undefined,
          youtube: { videoId: st.videoId!, privacy: "private", channelTitle: st.channelTitle, thumbnail: st.thumbnail, thumbnailError: st.thumbnailError },
        }));
        logEvent("alert", `Published "${row.title}" to YouTube as private. Make it public in YouTube Studio when you're happy: https://studio.youtube.com/video/${st.videoId}/edit`, id);
        if (st.thumbnail === "failed")
          logEvent("alert", `YouTube didn't take the thumbnail of "${row.title}": ${st.thumbnailError} The app sends it again every 6 hours (or press "Send the thumbnail again" on the video's page).`, id);
      } else {
        const attempts = getRow(id)?.uploadAttempts ?? 1;
        const giveUp = attempts >= 3;
        updateRow(id, (r) => ({ ...r, status: giveUp ? "failed" : "ready", failedAt: giveUp ? "ready" : undefined, error: st.error }));
        logEvent(giveUp ? "error" : "alert", `Upload of "${row.title}" failed${giveUp ? " 3 times" : ""}: ${st.error}${giveUp ? "" : " It will try again at the next slot."}`, id);
      }
    } finally {
      uploading.delete(id);
    }
  })();
  return true;
}

/** A row stuck in "uploading" after a restart goes back to ready (tried again at the next slot). */
export function checkUploading(id: string) {
  if (uploading.has(id)) return;
  const u = getEduUpload(id);
  if (u?.state === "done" && u.videoId) {
    updateRow(id, (r) => ({ ...r, status: "published", publishedAt: u.finishedAt ?? new Date().toISOString(), youtube: { videoId: u.videoId!, privacy: "private", channelTitle: u.channelTitle } }));
    return;
  }
  if (!u || u.state !== "uploading") updateRow(id, (r) => ({ ...r, status: "ready", error: u?.error ?? "The upload was interrupted." }));
}

// ------------------------------------ thumbnails YouTube refused ------------------------------------
// A new channel can't set custom thumbnails until it is phone-verified (youtube.com/verify). Until
// then the video goes up with YouTube's own frame; the thumbnail is sent again every 6 hours (and on
// "Send the thumbnail again"), so it lands by itself once the channel is verified.

const THUMB_RETRY_MS = 6 * 60 * 60 * 1000;
const sendingThumb = new Set<string>();

/** Sends the row's thumbnail to its uploaded video again. Throws a UserError with YouTube's reason. */
export async function resendThumbnail(id: string) {
  const row = getRow(id);
  const videoId = row?.youtube?.videoId;
  if (!row || !videoId) throw new UserError("This video hasn't been uploaded yet.");
  if (!fs.existsSync(thumbFile(id))) throw new UserError("There's no thumbnail file for this video.");
  if (sendingThumb.has(id)) throw new UserError("The thumbnail is being sent already.");
  sendingThumb.add(id);
  const at = new Date().toISOString();
  try {
    await setThumbnailFile(videoId, thumbFile(id), "edu");
    updateRow(id, (r) => (r.youtube ? { ...r, youtube: { ...r.youtube, thumbnail: "set", thumbnailError: undefined, thumbTriedAt: at } } : r));
    logEvent("info", `Thumbnail set on YouTube: "${row.title}"`, id);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : String(e);
    updateRow(id, (r) => (r.youtube ? { ...r, youtube: { ...r.youtube, thumbnail: "failed", thumbnailError: msg, thumbTriedAt: at } } : r));
    throw e instanceof UserError ? e : new UserError(msg);
  } finally {
    sendingThumb.delete(id);
  }
}

/** Scheduler: retries refused thumbnails, each at most every 6 hours (quietly: one alert was enough). */
export async function retryThumbnails(now = Date.now()) {
  for (const r of listRows()) {
    const y = r.youtube;
    if (r.status !== "published" || !y?.videoId || y.thumbnail !== "failed") continue;
    if (y.thumbTriedAt && now - Date.parse(y.thumbTriedAt) < THUMB_RETRY_MS) continue;
    try {
      await resendThumbnail(r.id);
    } catch {
      /* still refused: try again in 6 hours */
    }
  }
}
