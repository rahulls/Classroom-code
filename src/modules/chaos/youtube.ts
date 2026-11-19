import "server-only";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { UserError } from "@/core/action";
import { decrypt, encrypt } from "@/core/crypto";
import { DEFAULT_CATEGORY } from "./csv";
import { CHAOS_HOME, getJob, getYoutubeMeta, imageCredit, jobDir, jobQuestions, musicCheck, setMark, thumbPath, videoPath, type JobView, type YoutubeMeta } from "./jobs";

// Publishing Chaos Creators videos to YouTube (YouTube Data API v3).
// Rahul's own Google Cloud project supplies the OAuth client; he signs in on Google's page and
// allows uploads. We keep only the refresh token (encrypted) — never his Google password.
// Stored in %LOCALAPPDATA%\RSC Classroom\chaos\youtube.json, outside OneDrive. Each video's
// upload state lives next to it in jobs\<id>\youtube.json.

const FILE = path.join(CHAOS_HOME, "youtube.json");
const P_SECRET = "chaos.youtube.clientSecret";
const P_REFRESH = "chaos.youtube.refreshToken";
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
export const CALLBACK_PATH = "/chaos/youtube/callback";
export const STATE_COOKIE = "chaos_yt_state";

type Stored = {
  clientId?: string;
  clientSecret?: string; // encrypted
  refreshToken?: string; // encrypted
  channelId?: string;
  channelTitle?: string;
  connectedAt?: string;
  problem?: string;
};

const readStored = (): Stored => {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Stored;
  } catch {
    return {};
  }
};

function writeStored(s: Stored) {
  fs.mkdirSync(CHAOS_HOME, { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(s, null, 1), "utf8");
  fs.renameSync(FILE + ".tmp", FILE);
}

export type YoutubeConnection = {
  clientId: string | null;
  hasSecret: boolean;
  connected: boolean;
  channelId: string | null;
  channelTitle: string | null;
  connectedAt: string | null;
  problem: string | null;
};

export function youtubeConnection(): YoutubeConnection {
  const s = readStored();
  return {
    clientId: s.clientId ?? null,
    hasSecret: !!s.clientSecret,
    connected: !!s.refreshToken,
    channelId: s.channelId ?? null,
    channelTitle: s.channelTitle ?? null,
    connectedAt: s.connectedAt ?? null,
    problem: s.problem ?? null,
  };
}

/** Saves the OAuth client from Google Cloud. A different client means connecting again. */
export function saveClient(clientId: string, clientSecret: string | undefined) {
  const s = readStored();
  const changed = s.clientId !== clientId;
  if (!clientSecret && (changed || !s.clientSecret)) throw new UserError("Paste the client secret too.");
  writeStored(
    changed
      ? { clientId, clientSecret: encrypt(clientSecret!, P_SECRET) }
      : { ...s, clientSecret: clientSecret ? encrypt(clientSecret, P_SECRET) : s.clientSecret, problem: undefined },
  );
}

function client() {
  const s = readStored();
  if (!s.clientId || !s.clientSecret) throw new UserError("Add your Google OAuth client first (Chaos Creators → YouTube).");
  return { id: s.clientId, secret: decrypt(s.clientSecret, P_SECRET) };
}

/** The address Google sends Rahul back to. Must be listed in the OAuth client exactly. */
export function redirectUriFor(h: Headers) {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:4310";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}${CALLBACK_PATH}`;
}

export function authUrl(redirectUri: string, state: string) {
  const q = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline", // a refresh token, so uploads work without signing in every time
    prompt: "consent select_account", // always return a refresh token; let him pick the channel's account
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as TokenResponse;
}

/** Google redirected back with a code: swap it for tokens and find the channel. */
export async function finishConnect(code: string, redirectUri: string) {
  const c = client();
  const t = await tokenRequest({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.access_token) throw new UserError(`Google refused the sign-in: ${t.error_description || t.error || "unknown error"}`);
  if (!t.refresh_token) throw new UserError("Google didn't give lasting permission. Remove “Chaos Creators Studio” at myaccount.google.com/permissions and connect again.");
  const ch = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${t.access_token}` } });
  const body = (await ch.json().catch(() => ({}))) as { items?: { id: string; snippet?: { title?: string } }[]; error?: { message?: string } };
  if (!ch.ok) throw new UserError(`Couldn't read your channel: ${body.error?.message ?? ch.status}`);
  const item = body.items?.[0];
  if (!item) throw new UserError("That Google account has no YouTube channel. Connect again and choose the account (or brand account) that owns Chaos Creators.");
  writeStored({
    ...readStored(),
    refreshToken: encrypt(t.refresh_token, P_REFRESH),
    channelId: item.id,
    channelTitle: item.snippet?.title ?? "your channel",
    connectedAt: new Date().toISOString(),
    problem: undefined,
  });
  cachedToken = null;
  return item.snippet?.title ?? "your channel";
}

let cachedToken: { token: string; until: number } | null = null;

async function accessToken() {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.token;
  const s = readStored();
  if (!s.refreshToken) throw new UserError("YouTube isn't connected. Connect it on the YouTube page first.");
  const c = client();
  const t = await tokenRequest({ refresh_token: decrypt(s.refreshToken, P_REFRESH), client_id: c.id, client_secret: c.secret, grant_type: "refresh_token" });
  if (!t.access_token) {
    if (t.error === "invalid_grant") {
      // Revoked, password changed, or the 7-day limit of a "Testing" OAuth app
      writeStored({ ...readStored(), refreshToken: undefined, problem: "YouTube's permission expired or was removed. Connect again." });
      throw new UserError("YouTube's permission expired or was removed. Connect YouTube again (Chaos Creators → YouTube).");
    }
    if (t.error === "invalid_client" || t.error === "unauthorized_client") throw new UserError("Google rejected the client ID or secret. Check them on the YouTube page.");
    throw new UserError(`Google sign-in failed (${t.error ?? "no answer"}). Try again in a minute.`);
  }
  cachedToken = { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000 };
  return t.access_token;
}

export async function disconnect() {
  const s = readStored();
  if (s.refreshToken) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decrypt(s.refreshToken, P_REFRESH) }),
    }).catch(() => undefined);
  }
  writeStored({ clientId: s.clientId, clientSecret: s.clientSecret });
  cachedToken = null;
}

/** Turns a Google API error into something Rahul can act on. */
async function apiError(r: Response | { status: number; text: string }, what: string) {
  const text = r instanceof Response ? await r.text() : r.text;
  let reason = "";
  let message = text.slice(0, 300);
  try {
    const e = (JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } }).error;
    reason = e?.errors?.[0]?.reason ?? "";
    message = e?.message ?? message;
  } catch {
    /* not JSON */
  }
  const known: Record<string, string> = {
    quotaExceeded: "Your Google project's daily YouTube allowance is used up (about 6 uploads a day). Try again tomorrow.",
    uploadLimitExceeded: "Your channel has reached YouTube's upload limit for today. Try again tomorrow.",
    youtubeSignupRequired: "That Google account has no YouTube channel. Connect the account that owns Chaos Creators.",
    forbidden:
      what === "thumbnail"
        ? "YouTube didn't accept the thumbnail: custom thumbnails need a verified channel (youtube.com/verify, a phone check)."
        : "YouTube refused the upload (forbidden).",
    mediaBodyTooLarge: "The file is too big for YouTube.",
    invalidTitle: "YouTube didn't accept the title.",
    invalidDescription: "YouTube didn't accept the description.",
    invalidTags: "YouTube didn't accept the tags.",
  };
  return known[reason] ?? `YouTube error ${r.status}${reason ? ` (${reason})` : ""}: ${message}`;
}

// ------------------------------- uploads -------------------------------

export type UploadMeta = {
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  madeForKids: boolean;
  useThumbnail: boolean;
  /** YouTube category id (Education when not given) */
  categoryId?: string;
};

export type UploadState = {
  state: "uploading" | "done" | "error";
  sent: number;
  total: number;
  startedAt: string;
  updatedAt: number;
  title: string;
  privacy: UploadMeta["privacy"];
  channelTitle?: string;
  videoId?: string;
  finishedAt?: string;
  error?: string;
  thumbnail?: "set" | "failed" | "skipped";
  thumbnailError?: string;
};

const uploadFile = (id: string) => path.join(jobDir(id), "youtube.json");

export function getUpload(id: string): UploadState | null {
  try {
    const u = JSON.parse(fs.readFileSync(uploadFile(id), "utf8")) as UploadState;
    // The uploader writes a heartbeat every few seconds; silence means the app was restarted mid-upload
    if (u.state === "uploading" && Date.now() - u.updatedAt > 45_000) return { ...u, state: "error", error: "The upload was interrupted (the app restarted). Try again." };
    return u;
  } catch {
    return null;
  }
}

function saveUpload(id: string, u: UploadState) {
  const f = uploadFile(id);
  fs.writeFileSync(f + ".tmp", JSON.stringify(u), "utf8");
  for (let i = 0; i < 20; i++) {
    try {
      fs.renameSync(f + ".tmp", f);
      return;
    } catch {
      /* Windows: the status poll is reading it; try again */
    }
  }
  fs.writeFileSync(f, JSON.stringify(u), "utf8");
}

const clean = (s: string) => s.replace(/[<>]/g, "");

/** Starts the upload in the background; the video page polls getUpload() for progress. */
export async function startUpload(id: string, meta: UploadMeta) {
  const job = getJob(id);
  if (!job || job.status.stage !== "done") throw new UserError("This video isn't ready yet.");
  const prev = getUpload(id);
  if (prev?.state === "uploading") throw new UserError("It's already uploading.");
  if (prev?.state === "done") throw new UserError("This video is already on YouTube.");
  const music = musicCheck(job);
  if (!music.ok) throw new UserError(music.problem!);
  const conn = youtubeConnection();
  await accessToken(); // fail now (not in the background) if the connection is broken
  const size = fs.statSync(videoPath(id)).size;
  const state: UploadState = {
    state: "uploading",
    sent: 0,
    total: size,
    startedAt: new Date().toISOString(),
    updatedAt: Date.now(),
    title: meta.title,
    privacy: meta.privacy,
    channelTitle: conn.channelTitle ?? undefined,
  };
  saveUpload(id, state);
  void runUpload(id, meta, state);
}

async function runUpload(id: string, meta: UploadMeta, state: UploadState) {
  const beat = setInterval(() => {
    state.updatedAt = Date.now();
    saveUpload(id, state);
  }, 3000);
  try {
    const file = videoPath(id);
    const token = await accessToken();
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(state.total),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          title: clean(meta.title),
          description: clean(meta.description),
          tags: meta.tags,
          categoryId: meta.categoryId || DEFAULT_CATEGORY,
          defaultLanguage: "en",
          defaultAudioLanguage: "en",
        },
        status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: meta.madeForKids, embeddable: true, license: "youtube" },
      }),
    });
    if (!init.ok) throw new UserError(await apiError(init, "video"));
    const location = init.headers.get("location");
    if (!location) throw new Error("YouTube gave no upload address");

    const video = await sendResumable(location, file, state, () => accessToken());
    state.videoId = video.id;
    state.sent = state.total;

    if (meta.useThumbnail && fs.existsSync(thumbPath(id))) {
      try {
        await setThumbnail(id, video.id);
        state.thumbnail = "set";
      } catch (e) {
        state.thumbnail = "failed";
        state.thumbnailError = e instanceof UserError ? e.message : String(e);
      }
    } else state.thumbnail = "skipped";
    state.state = "done";
    state.finishedAt = new Date().toISOString();
    try {
      setMark(id, "uploaded", true); // ticks it on the dashboard and adds it to the upload log
    } catch (e) {
      console.error("[chaos youtube upload] couldn't log the upload", e);
    }
  } catch (e) {
    state.state = "error";
    state.error = e instanceof UserError ? e.message : `Upload failed: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[chaos youtube upload]", e);
  } finally {
    clearInterval(beat);
    state.updatedAt = Date.now();
    saveUpload(id, state);
  }
}

type HttpResult = { status: number; text: string; headers: Record<string, string | string[] | undefined> };

function put(url: string, headers: Record<string, string>, body?: fs.ReadStream, onData?: (n: number) => void): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "PUT", headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text, headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("network timeout")));
    if (body) {
      body.on("data", (c) => onData?.(c.length));
      body.on("error", reject);
      body.pipe(req);
    } else req.end();
  });
}

/** Sends the file; after a network drop it asks YouTube how much arrived and carries on from there. */
async function sendResumable(location: string, file: string, state: UploadState, token: () => Promise<string>): Promise<{ id: string }> {
  const size = state.total;
  let start = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const auth = `Bearer ${await token()}`;
      const headers: Record<string, string> = { Authorization: auth, "Content-Type": "video/mp4", "Content-Length": String(size - start) };
      if (start > 0) headers["Content-Range"] = `bytes ${start}-${size - 1}/${size}`;
      state.sent = start;
      const r = await put(location, headers, fs.createReadStream(file, { start }), (n) => (state.sent += n));
      if (r.status === 200 || r.status === 201) return JSON.parse(r.text) as { id: string };
      if (r.status < 500 && r.status !== 308) throw new UserError(await apiError(r, "video"));
    } catch (e) {
      if (e instanceof UserError || attempt >= 6) throw e;
    }
    // Something went wrong in transit: wait, then ask how much YouTube already has
    await new Promise((res) => setTimeout(res, Math.min(30_000, 2000 * 2 ** attempt)));
    const q = await put(location, { Authorization: `Bearer ${await token()}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" }).catch(() => null);
    if (q && (q.status === 200 || q.status === 201)) return JSON.parse(q.text) as { id: string };
    const range = q?.headers.range;
    const m = typeof range === "string" ? /bytes=0-(\d+)/.exec(range) : null;
    start = m ? Number(m[1]) + 1 : q?.status === 308 ? 0 : start;
  }
}

async function setThumbnail(id: string, videoId: string) {
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "image/jpeg" },
    body: fs.readFileSync(thumbPath(id)),
  });
  if (!r.ok) throw new UserError(await apiError(r, "thumbnail"));
}

/** Sends the current thumbnail design to the already-uploaded video. */
export async function pushThumbnail(id: string) {
  const u = getUpload(id);
  if (u?.state !== "done" || !u.videoId) throw new UserError("Upload the video first.");
  if (!fs.existsSync(thumbPath(id))) throw new UserError("There's no thumbnail yet.");
  try {
    await setThumbnail(id, u.videoId);
    saveUpload(id, { ...u, thumbnail: "set", thumbnailError: undefined });
  } catch (e) {
    saveUpload(id, { ...u, thumbnail: "failed", thumbnailError: e instanceof UserError ? e.message : String(e) });
    throw e;
  }
}

// ------------------------- suggested title etc. -------------------------

const titleCase = (s: string) => s.toLowerCase().replace(/\b(gk|iq)\b/g, (w) => w.toUpperCase()).replace(/\b[a-z]/g, (c) => c.toUpperCase());
const stamp = (t: number) => {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** Chapters for long videos: YouTube needs the first at 0:00, at least 3, each 10+ seconds. */
function chapterLines(job: JobView, labels: "full" | "short"): string[] | null {
  const ch = job.status.result?.chapters;
  const end = job.status.result?.duration;
  if (job.format !== "youtube" || !ch?.length || !end) return null;
  const qs = jobQuestions(job.id);
  const parts = ch.map((c, i) => ({ ...c, len: (ch[i + 1]?.t ?? end) - c.t }));
  const out: { t: number; label: string }[] = [];
  for (const p of parts) {
    if (p.kind === "intro" || (p.kind === "ranks" && !out.length)) continue; // folded into the first question below
    if (p.kind === "q" && p.q != null) {
      const text = qs[p.q]?.question ?? "";
      const label = labels === "full" && text ? `Q${p.q + 1}: ${text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text}` : `Question ${p.q + 1}`;
      out.push({ t: out.length ? p.t : 0, label: out.length ? label : `Intro + ${label}` });
    } else if (p.kind === "ranks") out.push({ t: p.t, label: "Your rank & thanks for watching" });
    else if (p.kind === "outro" && p.len >= 10 && !out.at(-1)?.label.startsWith("Your rank")) out.push({ t: p.t, label: "Your score & thanks for watching" });
  }
  // Every chapter (except the last) must last 10 s or more
  for (let i = 0; i < out.length - 1; i++) if (out[i + 1]!.t - out[i]!.t < 10) return null;
  if (out.length < 3) return null;
  return out.map((c) => `${stamp(c.t)} ${clean(c.label)}`);
}

export function suggestedMeta(job: JobView): Omit<UploadMeta, "privacy" | "madeForKids" | "useThumbnail"> {
  const badge = titleCase(job.settings.quiz_badge || "GK Quiz");
  const n = job.questions;
  const secs = job.settings.timer_seconds ?? 5;
  const shorts = job.format === "shorts";
  let title = `${badge} | ${n} Question${n === 1 ? "" : "s"} | Can You Get Them All?`;
  if (shorts) title += " #shorts";
  if (title.length > 100) title = `${badge} | ${n} Questions${shorts ? " #shorts" : ""}`.slice(0, 100);

  const intro = [
    `Test your knowledge with this ${n}-question ${badge.toLowerCase().includes("quiz") ? badge : `${badge} quiz`}! You get ${secs} seconds for each question.`,
    "How many did you get right? Comment your score below 👇",
  ];
  const outro = [
    shorts ? "Subscribe to Chaos Creators for more quizzes!" : "Thanks for watching! Like the video and subscribe to Chaos Creators for more quizzes!",
    "",
    `#quiz #gk #generalknowledge #trivia${shorts ? " #shorts" : ""}`,
  ];
  // Creative Commons music must be credited: these lines are never dropped to save space
  const credits = job.status.result?.credits ?? [];
  const music = credits.length ? ["", "Music:", ...credits] : [];
  let description = "";
  for (const labels of ["full", "short"] as const) {
    const ch = chapterLines(job, labels);
    description = [...intro, "", ...(ch ? ["Questions:", ...ch, ""] : []), ...outro, ...music].join("\n");
    if (description.length <= 4900) break;
  }
  if (description.length > 4900) description = [...intro, "", ...outro, ...music].join("\n");

  return { title: clean(title), description: clean(description), tags: ["quiz", "gk quiz", "general knowledge", "trivia", "quiz time", "chaos creators"] };
}

/**
 * The title / description / tags to publish with: what was saved for the video (from its CSV or
 * edited in the studio), else the suggestion above. Creative Commons music always gets its credit
 * line, and a Short always carries #shorts, whatever was typed.
 */
export function videoMeta(job: JobView): YoutubeMeta & { fromCsvOrSaved: boolean } {
  const saved = getYoutubeMeta(job.id);
  const auto = suggestedMeta(job);
  const title = saved?.title || auto.title;
  let description = saved?.description || auto.description;
  const tags = saved?.tags?.length ? saved.tags : auto.tags;
  if (job.format === "shorts" && !/#shorts\b/i.test(`${title}\n${description}`)) description += `${description ? "\n" : ""}#shorts`;
  const credits = (job.status.result?.credits ?? []).filter((c) => !description.includes(c));
  if (credits.length) description += `\n\nMusic:\n${credits.join("\n")}`;
  // The thumbnail's topic photo (Creative Commons photos must be credited too)
  const photo = imageCredit(job.settings.thumb_image);
  if (photo && !description.includes(photo)) description += `${credits.length ? "\n" : "\n\n"}${photo}`;
  return {
    title,
    description: description.slice(0, 5000),
    tags,
    category: saved?.category || DEFAULT_CATEGORY,
    fromCsvOrSaved: !!(saved?.title || saved?.description || saved?.tags?.length),
  };
}
