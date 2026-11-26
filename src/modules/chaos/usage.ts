import "server-only";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { UserError } from "@/core/action";
import { env } from "@/core/env";
import { CANVA_PER_VIDEO_CSV, CHAOS_HOME, getJob, jobDir, listJobs } from "./jobs";

// What the studio spends on Canva's AI and on the Claude API, per day (IST), shared by Chaos
// Creators and the Edu videos module (they use the same Canva login and the same Claude key).
//   %LOCALAPPDATA%\RSC Classroom\chaos\usage\
//     YYYY-MM-DD.jsonl   one line per Canva AI action (made, refused or failed) and per Claude call
//     settings.json      the daily Canva limit, the picture saving, the email report, price estimates
//     sent.json          the days whose report has been emailed
// Canva's AI actions are "image" (generate-image) and "design" (create-design: thumbnails, screens,
// and the full-size page around each picture). Waiting for a design or exporting it is free.

const DIR = path.join(CHAOS_HOME, "usage");
const SETTINGS = path.join(DIR, "settings.json");
const SENT = path.join(DIR, "sent.json");

/** Prices per million tokens in USD (Claude API list prices). Unknown models count as Opus 5.5. */
const CLAUDE_PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export type UsageSettings = {
  /** Canva AI actions (images + designs) the studio may use per day; 0 = no limit */
  canvaDailyLimit: number;
  /** How much fewer Canva pictures a video asks for than one per fact/question (percent; "saving" mode) */
  canvaSavingPercent: number;
  /** "minimum" (Rahul, 24 Nov 2026: "reduce it to minimum, create background on your own"): Canva makes
   *  only the thumbnail and the stickers of facts without a picture of their own; backgrounds, intro and
   *  ending are made without Canva. "saving": Canva makes everything, less canvaSavingPercent. */
  canvaMode: "minimum" | "saving";
  /** Email the day's report the next morning */
  emailReport: boolean;
  /** Estimates for the report: rupees per Canva AI action, rupees per US dollar */
  canvaRupeesPerAction: number;
  rupeesPerDollar: number;
};
const DEFAULTS: UsageSettings = { canvaDailyLimit: 60, canvaSavingPercent: 20, canvaMode: "minimum", emailReport: true, canvaRupeesPerAction: 3.3, rupeesPerDollar: 88 };

export function usageSettings(): UsageSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(SETTINGS, "utf8")) as Partial<UsageSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveUsageSettings(s: UsageSettings) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(SETTINGS + ".tmp", JSON.stringify(s, null, 1), "utf8");
  fs.renameSync(SETTINGS + ".tmp", SETTINGS);
}

// ------------------------------ who is asking ------------------------------

// Kept on globalThis: Next loads this file more than once (pages/actions and instrumentation).
type Who = { who: string; video?: string };
const als: AsyncLocalStorage<Who> = ((globalThis as { __chaosUsageWho2?: AsyncLocalStorage<Who> }).__chaosUsageWho2 ??= new AsyncLocalStorage());

/** Runs fn with every Canva / Claude call inside it counted for `who` (e.g. the video's name). */
export const usageFor = <T>(who: string, fn: () => Promise<T>, video?: string): Promise<T> => als.run({ who, video }, fn);
/** Calls without a label come from the Edu videos module (every Chaos path labels its calls). */
const currentWho = () => als.getStore()?.who ?? "Edu videos";

// ------------------------------ the log ------------------------------

export type CanvaEntry = { at: string; kind: "canva"; action: "image" | "design"; ok: boolean; outcome: string; who: string; ms: number; /** the Chaos job id */ video?: string };
export type ClaudeEntry = {
  at: string;
  kind: "claude";
  purpose: string;
  who: string;
  model: string;
  ok: boolean;
  outcome: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number;
  ms: number;
};
type Entry = CanvaEntry | ClaudeEntry;

/** The IST calendar day (YYYY-MM-DD) of a moment. */
export const istDay = (t = Date.now()) => new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10);
const dayFile = (day: string) => path.join(DIR, `${day}.jsonl`);

function append(e: Entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(dayFile(istDay(Date.parse(e.at))), JSON.stringify(e) + "\n", "utf8");
  } catch (err) {
    console.error("[usage] couldn't log", err);
  }
  if (e.kind === "canva") soonVideoCsv();
}

export function readDay(day: string): Entry[] {
  try {
    return fs
      .readFileSync(dayFile(day), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Entry);
  } catch {
    return [];
  }
}

/** Canva's answer in a few words, for the report. */
export function canvaOutcome(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  if (/daily Canva limit/i.test(s)) return "stopped by the daily limit";
  if (/cooling down/i.test(s)) return "refused: credit cooling down";
  if (/\((failed|error)\)/i.test(s)) return "refused: design failed";
  if (/503|service unavailable/i.test(s)) return "Canva server busy (503)";
  if (/abort|reach Connect|ECONNRESET|fetch failed|timed? ?out|took more than/i.test(s)) return "connection dropped / timed out";
  if (/signed the studio out|Connect Canva/i.test(s)) return "not connected";
  return "error: " + s.slice(0, 80);
}

/**
 * One Canva AI action, logged with its result. Checks the daily limit first (a refused action
 * never reaches Canva). `cost` actions must be left: a picture checks for 2 before its image.
 */
export async function trackCanva<T>(action: "image" | "design", fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const v = await fn();
    append({ at: new Date().toISOString(), kind: "canva", action, ok: true, outcome: "made", who: currentWho(), ms: Date.now() - t0, video: als.getStore()?.video });
    return v;
  } catch (e) {
    append({ at: new Date().toISOString(), kind: "canva", action, ok: false, outcome: canvaOutcome(e), who: currentWho(), ms: Date.now() - t0, video: als.getStore()?.video });
    throw e;
  }
}

/** Canva AI actions made today, and how many the daily limit still allows (Infinity = no limit). */
export function canvaToday(): { made: number; limit: number; left: number } {
  const limit = usageSettings().canvaDailyLimit;
  const made = readDay(istDay()).filter((e) => e.kind === "canva" && e.ok).length;
  return { made, limit, left: limit > 0 ? Math.max(0, limit - made) : Infinity };
}

export const LIMIT_MESSAGE = "Today's daily Canva limit is used up";
/** Throws when today's Canva limit can't cover `cost` more AI actions. */
export function assertCanvaBudget(cost: number) {
  const t = canvaToday();
  if (t.left < cost) throw new UserError(`${LIMIT_MESSAGE} (${t.made} of ${t.limit} AI actions). Raise it in Chaos Creators → Usage, or it starts again after midnight.`);
}

/** Milliseconds until the next IST midnight (when the daily limit starts again). */
export function msToIstMidnight(now = Date.now()) {
  const ist = now + 5.5 * 3_600_000;
  return 86_400_000 - (ist % 86_400_000) + 5_000;
}

/** Logs one Claude call from its final message (or its error) and returns its cost. */
export function recordClaude(purpose: string, t0: number, message: { model?: string; usage?: unknown } | null, error?: unknown) {
  const u = (message?.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  const model = message?.model ?? "claude-opus-5-5";
  const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES["claude-opus-5-5"]!;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const usd = (input * p.in + output * p.out + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1_000_000;
  append({
    at: new Date().toISOString(),
    kind: "claude",
    purpose,
    who: currentWho(),
    model,
    ok: !error,
    outcome: error ? (error instanceof Error ? error.message : String(error)).slice(0, 120) : "ok",
    input,
    output,
    cacheRead,
    cacheWrite,
    usd,
    ms: Date.now() - t0,
  });
  return usd;
}

// ------------------------------ per video (CSV) ------------------------------

/** Rebuilt a few seconds after each Canva action (Excel may have it open: then the next one writes it). */
function soonVideoCsv() {
  const g = globalThis as { __chaosVideoCsv?: NodeJS.Timeout };
  if (g.__chaosVideoCsv) return;
  g.__chaosVideoCsv = setTimeout(() => {
    g.__chaosVideoCsv = undefined;
    writeVideoCsv();
  }, 5_000);
  g.__chaosVideoCsv.unref?.();
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * canva-usage-per-video.csv in the Chaos Creators folder: one row per video (Chaos job; earlier
 * lines without a job id and Edu videos are grouped by name), newest first.
 */
export function writeVideoCsv(): boolean {
  const s = usageSettings();
  type Row = { key: string; name: string; id: string; images: number; designs: number; refused: number; first: string; last: string };
  const rows = new Map<string, Row>();
  // Lines from before job ids were logged: a name that only one video has is that video
  const byTitle = new Map<string, string | null>();
  for (const j of listJobs()) byTitle.set(j.title, byTitle.has(j.title) ? null : j.id);
  for (const day of loggedDays()) {
    for (const e of readDay(day)) {
      if (e.kind !== "canva") continue;
      const id = e.video ?? byTitle.get(e.who) ?? undefined;
      const key = id ?? `name:${e.who}`;
      const r = rows.get(key) ?? { key, name: e.who, id: id ?? "", images: 0, designs: 0, refused: 0, first: e.at, last: e.at };
      if (e.ok) r[e.action === "image" ? "images" : "designs"]++;
      else r.refused++;
      if (e.at < r.first) r.first = e.at;
      if (e.at > r.last) r.last = e.at;
      rows.set(key, r);
    }
  }
  const lines = [
    ["Video", "Video id", "Type", "Format", "Status", "Canva images", "Canva designs", "AI actions", "About ₹ (estimate)", "Refused or failed", "Your own pictures", "Shared pictures", "First Canva use", "Last Canva use"].join(","),
  ];
  for (const r of [...rows.values()].sort((a, b) => b.first.localeCompare(a.first))) {
    const job = r.id ? getJob(r.id) : null;
    let yours = "";
    let shared = "";
    if (job) {
      try {
        const y = JSON.parse(fs.readFileSync(path.join(jobDir(job.id), "canva", "your-pictures.json"), "utf8")) as { slots: { name: string }[]; uploaded: string[] };
        yours = String(y.uploaded.length);
        shared = String(y.slots.filter((sl) => !y.uploaded.includes(sl.name)).length);
      } catch {
        /* made before pictures could be shared */
      }
    }
    const actions = r.images + r.designs;
    lines.push(
      [
        job?.title ?? r.name,
        r.id,
        job ? (job.kind === "facts" || job.kind === "flags" ? job.kind : "quiz") : /^Edu/i.test(r.name) ? "edu" : "",
        job?.format ?? "",
        job?.status.stage ?? (r.id ? "deleted" : ""),
        r.images,
        r.designs,
        actions,
        Math.round(actions * s.canvaRupeesPerAction),
        r.refused,
        yours,
        shared,
        istTime(r.first),
        istTime(r.last),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  try {
    fs.writeFileSync(CANVA_PER_VIDEO_CSV + ".tmp", "\ufeff" + lines.join("\r\n") + "\r\n", "utf8");
    fs.renameSync(CANVA_PER_VIDEO_CSV + ".tmp", CANVA_PER_VIDEO_CSV);
    return true;
  } catch (e) {
    // Open in Excel: written again after the next Canva action
    console.warn("[usage] couldn't write the per-video CSV:", e instanceof Error ? e.message : e);
    fs.rmSync(CANVA_PER_VIDEO_CSV + ".tmp", { force: true });
    return false;
  }
}

// ------------------------------ the report ------------------------------

export type DaySummary = {
  day: string;
  canva: { images: number; designs: number; refused: Record<string, number>; byWho: { who: string; images: number; designs: number; refused: number }[]; rupees: number; rebuilt: boolean };
  claude: { calls: number; failed: number; input: number; output: number; usd: number; rupees: number; byPurpose: { purpose: string; calls: number; usd: number }[] };
};

export function summarise(day: string): DaySummary {
  const s = usageSettings();
  const es = readDay(day);
  const cv = es.filter((e): e is CanvaEntry => e.kind === "canva");
  const cl = es.filter((e): e is ClaudeEntry => e.kind === "claude");
  const refused: Record<string, number> = {};
  const who = new Map<string, { who: string; images: number; designs: number; refused: number }>();
  for (const e of cv) {
    const w = who.get(e.who) ?? { who: e.who, images: 0, designs: 0, refused: 0 };
    if (e.ok) w[e.action === "image" ? "images" : "designs"]++;
    else {
      w.refused++;
      refused[e.outcome] = (refused[e.outcome] ?? 0) + 1;
    }
    who.set(e.who, w);
  }
  const images = cv.filter((e) => e.ok && e.action === "image").length;
  const designs = cv.filter((e) => e.ok && e.action === "design").length;
  const purpose = new Map<string, { purpose: string; calls: number; usd: number }>();
  for (const e of cl) {
    const k = `${e.purpose} (${e.who})`;
    const p = purpose.get(k) ?? { purpose: k, calls: 0, usd: 0 };
    p.calls++;
    p.usd += e.usd;
    purpose.set(k, p);
  }
  const usd = cl.reduce((a, e) => a + e.usd, 0);
  return {
    day,
    canva: { images, designs, refused, byWho: [...who.values()].sort((a, b) => b.images + b.designs - (a.images + a.designs)), rupees: (images + designs) * s.canvaRupeesPerAction, rebuilt: cv.some((e) => (e as { rebuilt?: boolean }).rebuilt) },
    claude: {
      calls: cl.length,
      failed: cl.filter((e) => !e.ok).length,
      input: cl.reduce((a, e) => a + e.input + e.cacheRead + e.cacheWrite, 0),
      output: cl.reduce((a, e) => a + e.output, 0),
      usd,
      rupees: usd * s.rupeesPerDollar,
      byPurpose: [...purpose.values()].sort((a, b) => b.usd - a.usd),
    },
  };
}

/** Days that have a log, newest first. */
export function loggedDays(): string[] {
  try {
    return fs
      .readdirSync(DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

const rs = (n: number) => `₹${n.toFixed(n < 10 ? 1 : 0)}`;
const many = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtDay = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function reportText(d: DaySummary): { subject: string; text: string } {
  const s = usageSettings();
  const actions = d.canva.images + d.canva.designs;
  const subject = `Studio usage ${fmtDay(d.day)}: Canva ${actions} AI actions (~${rs(d.canva.rupees)}), Claude $${d.claude.usd.toFixed(2)} (~${rs(d.claude.rupees)})`;
  const lines = [
    `Chaos Creators + Edu videos: usage on ${fmtDay(d.day)}`,
    ``,
    `CANVA`,
    `  AI actions used: ${actions} (${many(d.canva.images, "image")} + ${many(d.canva.designs, "design")}) · about ${rs(d.canva.rupees)} at ${rs(s.canvaRupeesPerAction)} each (estimate)`,
    s.canvaDailyLimit > 0 ? `  Daily limit: ${s.canvaDailyLimit}` : `  Daily limit: none`,
    ...(Object.keys(d.canva.refused).length ? [`  Refused or failed: ${Object.entries(d.canva.refused).map(([k, v]) => `${v} × ${k}`).join(", ")}`] : []),
    ...(d.canva.byWho.length ? [``, `  By video:`, ...d.canva.byWho.map((w) => `    ${w.who}: ${many(w.images, "image")} + ${many(w.designs, "design")}${w.refused ? `, ${w.refused} refused/failed` : ""}`)] : [`  No Canva requests.`]),
    ``,
    `CLAUDE API`,
    `  Calls: ${d.claude.calls}${d.claude.failed ? ` (${d.claude.failed} failed)` : ""} · ${d.claude.input.toLocaleString("en-IN")} tokens in, ${d.claude.output.toLocaleString("en-IN")} tokens out`,
    `  Cost: $${d.claude.usd.toFixed(2)} (about ${rs(d.claude.rupees)} at ₹${s.rupeesPerDollar}/$)`,
    ...(d.claude.byPurpose.length ? [``, `  By task:`, ...d.claude.byPurpose.map((p) => `    ${p.purpose}: ${p.calls} call${p.calls === 1 ? "" : "s"}, $${p.usd.toFixed(3)}`)] : []),
    ``,
    ...(d.canva.rebuilt ? [`Part of this day's Canva use was rebuilt from Canva's own record (counting started that evening); Claude calls before then weren't counted.`] : []),
    `Exam Prep's Claude marking uses its own key and isn't counted here.`,
    `Details and settings: RSC Classroom → Chaos Creators → Usage.`,
  ];
  return { subject, text: lines.join("\n") };
}

/** Rahul's own address: the account the app sends mail from. */
const reportTo = () => env.MAIL_FROM_ADDRESS ?? env.MAIL_USER;

export async function emailReport(day: string): Promise<string> {
  const to = reportTo();
  if (!to) throw new UserError("No mail account is set up (MAIL_USER in .env).");
  const { sendEmail } = await import("@/modules/messages/service");
  const { subject, text } = reportText(summarise(day));
  await sendEmail({ name: "Rahul", address: to }, subject, text);
  return to;
}

function sentDays(): string[] {
  try {
    return JSON.parse(fs.readFileSync(SENT, "utf8")) as string[];
  } catch {
    return [];
  }
}

/** Every morning from 8 am IST: yesterday's report by email (once; catches up after a restart). */
export function startUsageReports() {
  const g = globalThis as { __chaosUsageReports?: NodeJS.Timeout };
  if (g.__chaosUsageReports) return;
  const tick = async () => {
    try {
      if (!usageSettings().emailReport) return;
      const now = Date.now();
      const istHour = new Date(now + 5.5 * 3_600_000).getUTCHours();
      if (istHour < 8) return;
      const day = istDay(now - 86_400_000);
      const sent = sentDays();
      if (sent.includes(day)) return;
      const markSent = () => {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(SENT, JSON.stringify([...sent, day].slice(-60)), "utf8");
      };
      // Nothing used that day (or before counting started): no email
      if (!readDay(day).length) return markSent();
      const to = await emailReport(day);
      markSent();
      console.log(`[usage] report for ${day} emailed to ${to.replace(/^.*@/, "***@")}`);
    } catch (e) {
      console.error("[usage] daily report", e);
    }
  };
  void tick();
  g.__chaosUsageReports = setInterval(() => void tick(), 15 * 60_000);
  g.__chaosUsageReports.unref?.();
}
