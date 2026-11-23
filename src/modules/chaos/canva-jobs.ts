import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UserError } from "@/core/action";
import { canvaDesign, canvaPicture, withCanva } from "./canva";
import { factPicturePrompts, questionPicturePrompts } from "./generate";
import { LIMIT_MESSAGE, canvaToday, msToIstMidnight, usageFor, usageSettings } from "./usage";
import {
  CHAOS_HOME,
  PYTHON,
  ENGINE_DIR,
  VIDEO_FOLDER,
  getJob,
  getYoutubeMeta,
  jobDir,
  jobFacts,
  jobQuestions,
  listJobs,
  setCanvaProgress,
  setWaitingForPictures,
  startEngine,
  thumbPath,
  type JobView,
} from "./jobs";

// Canva designs for one video: the thumbnail (a full design with title, tag, one question and a hook,
// SEO-first) and the intro / ending artwork (no text: the engine writes on top). Raw exports go in
// jobs\<id>\canva\; engine/canva_images.py picks the pages and fits them to the video's sizes.
// canva\status.json tells the engine (which waits for it before drawing) how it went.

const HOOKS = ["CHALLENGE YOUR FRIENDS!", "CAN YOU GET THEM ALL?", "HOW MANY CAN YOU GET?", "BEAT THE TIMER!", "ONLY TRUE FANS SCORE {n}/{n}!"];
const NO_FACES = "Do not use realistic photos or likenesses of real, identifiable people (sportspeople, actors, politicians); use stylised silhouettes, jerseys or symbols instead. Fictional and game characters are fine.";

const canvaDir = (id: string) => path.join(jobDir(id), "canva");
type Status = {
  state: "running" | "done" | "failed";
  error?: string;
  thumbnail?: boolean;
  screens?: boolean;
  /** Questions (0-based) that got their own Canva background (facts videos: facts) */
  questions?: number[];
  /** Facts videos: facts (0-based) that got a Canva sticker */
  stickers?: number[];
  /** How many question pictures were asked for (the engine waits longer for more) */
  questionsPlanned?: number;
  designs?: Record<string, string>;
  /** While running: why it's taking longer (Canva cooling down) */
  note?: string;
  updatedAt: string;
};

/** Per-question pictures only up to this many questions: each one is ~1–2 minutes of Canva work. */
export const MAX_QUESTION_PICTURES = 25;
function setStatus(id: string, s: Omit<Status, "updatedAt">) {
  fs.mkdirSync(canvaDir(id), { recursive: true });
  fs.writeFileSync(path.join(canvaDir(id), "status.json"), JSON.stringify({ ...s, updatedAt: new Date().toISOString() }), "utf8");
}

export function canvaStatus(id: string): Status | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(canvaDir(id), "status.json"), "utf8")) as Status;
  } catch {
    return null;
  }
}

/** "GTA 6" from "GTA 6 Quiz" / badge "GTA 6 QUIZ". */
function topicOf(job: JobView) {
  const strip = (s: string) =>
    s
      .replace(/\b(quiz|questions?|facts?|did you know|amazing)\b/gi, " ")
      .replace(/[\s:|–()-]+/g, " ")
      .trim();
  const badge = strip(job.settings.quiz_badge ?? "");
  return badge && badge.length <= 30 ? badge : strip(job.title) || "general knowledge";
}

const SIZE = { youtube: { w: 1280, h: 720, thumb: "YouTube Thumbnail", screen: "Presentation (16:9)" }, shorts: { w: 1080, h: 1920, thumb: "Your Story", screen: "Your Story" } } as const;

export function thumbnailBrief(job: JobView, seed = Math.random()) {
  if (job.kind === "facts") return factsThumbnailBrief(job, seed);
  const qs = jobQuestions(job.id);
  const short = qs.filter((q) => q.question.length <= 80 && Math.max(...q.options.map((o) => o.length)) <= 22);
  const pool = short.length ? short : qs;
  const q = pool[Math.floor(seed * pool.length)] ?? pool[0];
  const hook = HOOKS[Math.floor(seed * 7919) % HOOKS.length]!.replaceAll("{n}", String(qs.length));
  const topic = topicOf(job);
  const keyword = (job.settings.quiz_badge || `${topic} QUIZ`).toUpperCase();
  const s = SIZE[job.format];
  const ytTitle = getYoutubeMeta(job.id)?.title;
  const shape = job.format === "shorts" ? `a vertical 9:16 YouTube Shorts cover, exactly ${s.w}x${s.h} pixels` : `a 16:9 YouTube video thumbnail, exactly ${s.w}x${s.h} pixels (YouTube's recommended size)`;
  const corner = job.format === "youtube" ? "the bottom-right corner (YouTube shows the video length there)" : "the bottom 20% (YouTube shows the Shorts title and buttons there)";
  return [
    `Create ${shape} for an ultimate quiz on ${topic}. Use bold imagery that instantly says "${topic}": its world, places, characters, objects and colours. A single page, filling the whole frame, no borders.`,
    `Make it SEO and click-through friendly: the search keyword "${keyword}" is the biggest, boldest text, readable even as a tiny phone thumbnail; one clear focal point with strong contrast on a vivid background; an excited, curious mood; few words, big letters, thick outlines, no clutter.` +
      (ytTitle ? ` It must match the video's YouTube title "${ytTitle}".` : ""),
    `Text, spelled exactly: title "${keyword}"; tag "${job.settings.intro_badge || "TODAY'S QUIZ"}"` +
      (q ? `; the question "${q.question}" with options ${q.options.map((o, i) => `"${"ABCD"[i]}) ${o}"`).join(", ")} (do not mark or highlight any option: the answer stays secret)` : "") +
      `; "${hook}".`,
    `Keep all text well inside the edges. Keep ${corner} and the bottom-left corner (a small round channel logo goes there) free of text. No other text, no watermarks. ${NO_FACES}`,
  ].join("\n");
}

/** The thumbnail of a "Did you know?" facts video: the topic keyword, DID YOU KNOW?, one fact as the hook. */
function factsThumbnailBrief(job: JobView, seed: number) {
  const facts = jobFacts(job.id);
  const short = facts.filter((f) => f.headline.length <= 60);
  const pool = short.length ? short : facts;
  const f = pool[Math.floor(seed * pool.length)];
  const topic = topicOf(job);
  const keyword = (job.settings.quiz_badge || `${topic} FACTS`).toUpperCase();
  const s = SIZE[job.format];
  const ytTitle = getYoutubeMeta(job.id)?.title;
  const shape = job.format === "shorts" ? `a vertical 9:16 YouTube Shorts cover, exactly ${s.w}x${s.h} pixels` : `a 16:9 YouTube video thumbnail, exactly ${s.w}x${s.h} pixels (YouTube's recommended size)`;
  const corner = job.format === "youtube" ? "the bottom-right corner (YouTube shows the video length there)" : "the bottom 20% (YouTube shows the Shorts title and buttons there)";
  const hook = ["YOU WON'T BELIEVE #{n}!", "99% DIDN'T KNOW THIS!", "{n} FACTS YOU DIDN'T KNOW!", "WAIT TILL THE LAST ONE!"][Math.floor(seed * 7919) % 4]!.replaceAll("{n}", String(facts.length));
  return [
    `Create ${shape} for a "Did you know?" facts video about ${topic}. Use one bold, eye-catching image of the topic's most surprising subject: its world, places, creatures, objects and colours. A single page, filling the whole frame, no borders.`,
    `Make it SEO and click-through friendly: the search keyword "${keyword}" is the biggest, boldest text, readable even as a tiny phone thumbnail; one clear focal point with strong contrast on a vivid background; an amazed, curious mood; few words, big letters, thick outlines, no clutter.` +
      (ytTitle ? ` It must match the video's YouTube title "${ytTitle}".` : ""),
    `Text, spelled exactly: title "${keyword}"; tag "DID YOU KNOW?"${f ? `; the fact "${f.headline}"` : ""}; "${hook}".`,
    `Keep all text well inside the edges. Keep ${corner} and the bottom-left corner (a small round channel logo goes there) free of text. No other text, no watermarks. ${NO_FACES}`,
  ].join("\n");
}

function screenBrief(job: JobView, kind: "intro" | "outro" | "both") {
  const topic = topicOf(job);
  const video = job.kind === "facts" ? '"Did you know?" facts video' : "quiz video";
  const s = SIZE[job.format];
  const shape = job.format === "shorts" ? `vertical 9:16 (${s.h === 1920 ? "1080x1920" : ""} video frame)` : "wide 16:9 (1920x1080 video frame)";
  const intro = `an exciting opening scene about ${topic}, full of anticipation, as if the show is about to start`;
  const outro = `a celebratory finale about ${topic}: warm light, victory mood, confetti or fireworks fitting the theme`;
  const what =
    kind === "both"
      ? `Exactly 2 slides of background artwork for a YouTube ${video} about ${topic}, ${shape}. Slide 1 (intro): ${intro}. Slide 2 (ending): ${outro}.`
      : `One page of background artwork for the ${kind === "intro" ? "intro" : "ending"} screen of a YouTube ${video} about ${topic}, ${shape}: ${kind === "intro" ? intro : outro}.`;
  return `${what}
Rich, cinematic, colourful imagery that instantly says "${topic}". Big white title text will be placed in the middle later, so keep the centre fairly simple and a little darker, with the detail towards the edges.
ABSOLUTELY NO TEXT: no words, letters, numbers, titles, logos or watermarks anywhere. ${NO_FACES}`;
}

function savePages(id: string, name: string, pages: Buffer[]) {
  const dir = canvaDir(id);
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${name}-p`)) fs.rmSync(path.join(dir, f));
  pages.forEach((b, i) => fs.writeFileSync(path.join(dir, `${name}-p${i + 1}.png`), b));
}

/**
 * Canva allows this account about one AI picture or design every ~5 minutes (23 Nov 2026, even on
 * Business): everything in between gets "credit usage is cooling down" or an instant "design
 * (failed)". Rahul: the videos can't go out without Canva's art. So a video with "Canva designs"
 * gets ALL its Canva work first, one request at a time, waiting RETRY_WAIT after each refusal and
 * trying again; the engine only starts once everything is in (about 1–2 hours for a 10-fact video).
 * Finished designs stay on disk, so the work carries on after an app restart (startCanvaSweep).
 */
const RETRY_WAIT = 5 * 60_000;
/** A design refused this many times is left out (Canva may be refusing its content); the video waits for Rahul. */
const MAX_TRIES = 15;
/** A video's Canva work gives up after this long; the video page offers "Continue with Canva". */
const MAX_WORK_MS = 8 * 3600_000;
/** The process doing a video's Canva work writes canva\worker.json; others leave the video alone while it's this fresh. */
const HEARTBEAT_STALE_MS = 10 * 60_000;
const ORIGINAL_ART = "\nUse original artwork inspired by the topic only: no copyrighted characters, film stills, posters or official logos.";

type Client = Parameters<Parameters<typeof withCanva>[0]>[0];
type Made = { pages: Buffer[]; url?: string };
/** One Canva design of a video: saved as canva\<name>-p<page>.png */
type Item = {
  name: string;
  label: string;
  make: (client: Client, tries: number) => Promise<Made>;
  after?: () => Promise<void>;
  /** Canva AI actions it needs now: 1 for a design, 2 for a picture (1 once its image is kept) */
  cost: () => number;
};
/**
 * A picture the video shows without asking Canva (the picture saving in usageSettings): a copy of
 * the first of `from` that Canva made (a neighbouring fact's background, or the intro artwork).
 */
type Copy = { name: string; from: string[]; label: string; prompt: string; vertical: boolean };

/**
 * The pictures without their own Canva picture, shown on the video page with their prompt so Rahul
 * can make or find one elsewhere and upload it (canva\your-pictures.json). Uploads can come while
 * Canva works; when Canva is done and some are still copies, the video waits for him ("pictures"
 * stage) until he uploads them or presses "Make the video now" (released).
 */
export type YourPictures = { slots: { name: string; label: string; prompt: string; vertical: boolean }[]; uploaded: string[]; released?: boolean };
const yourFile = (id: string) => path.join(canvaDir(id), "your-pictures.json");

export function yourPictures(id: string): YourPictures | null {
  try {
    return JSON.parse(fs.readFileSync(yourFile(id), "utf8")) as YourPictures;
  } catch {
    return null;
  }
}
function writeYourPictures(id: string, y: YourPictures) {
  fs.writeFileSync(yourFile(id), JSON.stringify(y, null, 1), "utf8");
}
const stillOpen = (y: YourPictures | null) => (y && !y.released ? y.slots.filter((sl) => !y.uploaded.includes(sl.name)) : []);

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
/** Rahul's own picture for a slot: replaces the copy (or what will be copied). */
export function saveYourPicture(id: string, name: string, data: Buffer) {
  const y = yourPictures(id);
  if (!y?.slots.some((sl) => sl.name === name)) throw new UserError("That picture isn't one you can add for this video.");
  const dir = canvaDir(id);
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${name}-p`) && f.endsWith(".png")) fs.rmSync(path.join(dir, f));
  // The engine reads it with PIL, which goes by the content (JPG, PNG or WebP), not the name
  fs.writeFileSync(path.join(dir, `${name}-p1.png`), data);
  if (!y.uploaded.includes(name)) y.uploaded.push(name);
  writeYourPictures(id, y);
  return stillOpen(y).length;
}

/** The video page's list: each slot with whether it's Rahul's upload and whether a picture is there yet. */
export function yourPictureSlots(id: string) {
  const y = yourPictures(id);
  if (!y?.slots.length) return null;
  return y.slots.map((sl) => ({ ...sl, uploaded: y.uploaded.includes(sl.name), hasPicture: madeAlready(id, sl.name) }));
}

/** "Make the video now": the pictures not uploaded stay copies, and the engine starts. */
export function releasePictures(id: string): boolean {
  const y = yourPictures(id);
  const job = getJob(id);
  if (!y || !job || job.status.stage !== "pictures") return false;
  y.released = true;
  writeYourPictures(id, y);
  return startEngine(id);
}

/**
 * Videos whose Canva work runs in this process. Kept on globalThis: Next loads this file once for
 * the pages/actions and again for instrumentation (the sweep), and two separate Sets let both start
 * the same video, so every design was bought twice.
 */
const working: Set<string> = ((globalThis as { __chaosCanvaWorking?: Set<string> }).__chaosCanvaWorking ??= new Set<string>());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isStopped = (id: string) => fs.existsSync(path.join(jobDir(id), "stopped"));
const madeAlready = (id: string, name: string) => fs.readdirSync(canvaDir(id)).some((f) => f.startsWith(`${name}-p`) && f.endsWith(".png"));
const clock = (t: number) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const workerFile = (id: string) => path.join(canvaDir(id), "worker.json");
function beat(id: string) {
  fs.writeFileSync(workerFile(id), JSON.stringify({ pid: process.pid, at: Date.now() }), "utf8");
}
function busyElsewhere(id: string) {
  try {
    const w = JSON.parse(fs.readFileSync(workerFile(id), "utf8")) as { pid: number; at: number };
    if (w.pid === process.pid || Date.now() - w.at >= HEARTBEAT_STALE_MS) return false;
    // After an app restart the old process is gone: carry on straight away
    try {
      process.kill(w.pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** Claude's picture prompts, written once and kept (a resumed video asks for the same pictures). */
async function savedPrompts<T>(id: string, file: string, ask: () => Promise<T>): Promise<T | null> {
  const p = path.join(canvaDir(id), file);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    /* not asked yet */
  }
  try {
    const v = await ask();
    fs.writeFileSync(p, JSON.stringify(v, null, 1), "utf8");
    return v;
  } catch (e) {
    console.error("[canva] picture prompts", id, e);
    return null;
  }
}

/** Which of n pictures Canva makes when `own` of them are allowed (0-based), spread evenly. */
function spread(n: number, own: number): Set<number> {
  const out = new Set<number>();
  for (let k = 0; k < own; k++) out.add(Math.floor((k * n) / own));
  return out;
}

/**
 * Every Canva design the video needs, in the order they're asked for, and the pictures that are
 * copies instead (Rahul, 23 Nov 2026: 20% fewer Canva designs and photos). A facts video keeps
 * every sticker (the fact's subject) and shares backgrounds between neighbouring facts; in a quiz
 * the questions in between get the intro artwork as their background.
 */
async function planItems(job: JobView): Promise<{ items: Item[]; copies: Copy[] }> {
  const id = job.id;
  const s = SIZE[job.format];
  const items: Item[] = [
    {
      name: "thumbnail",
      label: "thumbnail",
      // From the 3rd try: original artwork only, in case Canva refuses the topic's characters
      make: async (c, tries) => canvaDesign(thumbnailBrief(job) + (tries >= 2 ? ORIGINAL_ART : ""), s.thumb, c),
      cost: () => 1,
      after: async () => {
        thumbStatus(id, { state: "done" });
        await runImages(["thumbnail", jobDir(id)]).catch((e) => console.error("[canva] thumbnail image", id, e));
      },
    },
  ];
  const screen = (name: string, kind: "intro" | "outro" | "both", label: string): Item => ({ name, label, make: (c) => canvaDesign(screenBrief(job, kind), s.screen, c), cost: () => 1 });
  if (job.format === "youtube") items.push(screen("screens", "both", "intro and ending"));
  else items.push(screen("intro", "intro", "intro"), screen("outro", "outro", "ending"));
  const copies: Copy[] = [];
  if (!job.settings.canva_questions) return { items, copies };

  const topic = topicOf(job);
  const keep = 1 - Math.min(90, Math.max(0, usageSettings().canvaSavingPercent)) / 100;
  const intro = job.format === "youtube" ? "screens" : "intro";
  const mediaFile = (name: string) => path.join(canvaDir(id), `${name}-media.txt`);
  const picture = (name: string, label: string, prompt: string, vertical: boolean): Item => ({
    name,
    label,
    make: async (c: Client) => ({ pages: await canvaPicture(prompt, vertical, c, mediaFile(name)) }),
    // The image is the only AI action: the full-size page is a copy of a plain page (canva.ts)
    cost: () => (fs.existsSync(mediaFile(name)) ? 0 : 1),
  });
  if (job.kind === "facts") {
    const facts = jobFacts(id);
    if (!facts.length || facts.length > MAX_QUESTION_PICTURES) return { items, copies };
    const prompts = await savedPrompts(id, "fact-prompts.json", () => factPicturePrompts(topic, facts));
    // All of it: 3 designs + 2 pictures (1 action each) per fact. Every sticker stays; backgrounds
    // are cut until the whole video needs `keep` of that.
    const n = facts.length;
    const full = 3 + 2 * n;
    const ownBg = spread(n, Math.max(0, Math.min(n, Math.floor(full * keep) - 3 - n)));
    const ownList = [...ownBg].sort((a, b) => a - b);
    const SCENES = ["a wide establishing shot", "a dramatic close-up", "a night scene with glowing light", "a bright sunny scene", "an aerial view", "a moody, mysterious scene"];
    facts.forEach((f, i) => {
      const bg =
        prompts?.[i]?.background ??
        `Cinematic background artwork about ${topic}, for the fact "${f.headline}": ${SCENES[i % SCENES.length]}. Keep the middle calm. No people's faces. No text, no logos.`;
      const sticker =
        prompts?.[i]?.sticker ??
        `A bold, colourful cartoon illustration of the main subject of this fact: "${f.headline}". One clear subject, centred, filling the middle of the frame, plain light background, thick outlines, like a sticker. No people's faces. No text, no logos.`;
      // Stickers are cropped square from the middle, so a wide picture works for both formats
      if (ownBg.has(i)) items.push(picture(`q${i + 1}`, `fact ${i + 1} background`, bg, job.format === "shorts"));
      else {
        // The nearest earlier fact's background (then a later one), else the intro artwork
        const before = ownList.filter((k) => k < i).reverse();
        const after = ownList.filter((k) => k > i);
        copies.push({
          name: `q${i + 1}`,
          from: [...before, ...after].map((k) => `q${k + 1}`).concat(intro),
          label: `Fact ${i + 1} background: ${f.headline}`,
          prompt: bg,
          vertical: job.format === "shorts",
        });
      }
      items.push(picture(`s${i + 1}`, `fact ${i + 1} sticker`, sticker, false));
    });
  } else {
    const qs = jobQuestions(id);
    if (!qs.length || qs.length > MAX_QUESTION_PICTURES) return { items, copies };
    const prompts = await savedPrompts(id, "question-prompts.json", () => questionPicturePrompts(topic, qs));
    // All of it: 3 designs + one picture (1 action) per question
    const n = qs.length;
    const own = spread(n, Math.max(0, Math.min(n, Math.floor((3 + n) * keep) - 3)));
    // Without Claude: varied artwork about the topic, which can't give an answer away
    const SCENES = ["a wide establishing shot", "a dramatic close-up of an object", "a night scene with neon light", "a sunny daytime scene", "an aerial view", "a moody indoor scene"];
    qs.forEach((q, i) => {
      const prompt = prompts?.[i] ?? `Cinematic background artwork about ${topic}: ${SCENES[i % SCENES.length]}. Keep the middle calm. No people's faces. No text, no logos.`;
      // A question without its own picture gets the intro artwork: another question's picture
      // could point at the wrong answer
      if (own.has(i)) items.push(picture(`q${i + 1}`, `question ${i + 1} picture`, prompt, job.format === "shorts"));
      else copies.push({ name: `q${i + 1}`, from: [intro], label: `Question ${i + 1}: ${q.question}`, prompt, vertical: job.format === "shorts" });
    });
  }
  return { items, copies };
}

/** The pictures that are copies: each from the first of its sources Canva made. */
function makeCopies(id: string, copies: Copy[]) {
  const dir = canvaDir(id);
  for (const c of copies) {
    if (madeAlready(id, c.name)) continue;
    const src = c.from.find((f) => fs.existsSync(path.join(dir, `${f}-p1.png`)));
    if (src) fs.copyFileSync(path.join(dir, `${src}-p1.png`), path.join(dir, `${c.name}-p1.png`));
  }
}

/**
 * A video with "Canva designs" ticked: all its Canva designs, patiently (see RETRY_WAIT), then the
 * video engine. Safe to call again: it carries on where it stopped and never runs twice at once.
 */
export async function canvaForJob(id: string) {
  if (working.has(id)) return;
  const job = getJob(id);
  if (!job || job.status.stage !== "canva" || busyElsewhere(id)) return;
  working.add(id);
  try {
    // Every Canva / Claude call of this video is counted for it in the usage report
    await usageFor(job.title, () => makeAll(job));
  } catch (e) {
    console.error("[canva]", id, e);
  } finally {
    working.delete(id);
  }
}

async function makeAll(job: JobView) {
  const id = job.id;
  fs.mkdirSync(canvaDir(id), { recursive: true });
  beat(id);
  const { items: all, copies } = await planItems(job);
  // The pictures Rahul may add himself (kept across restarts: his uploads stay)
  const known = yourPictures(id);
  writeYourPictures(id, {
    slots: copies.map((c) => ({ name: c.name, label: c.label, prompt: c.prompt, vertical: c.vertical })),
    uploaded: known?.uploaded.filter((n) => copies.some((c) => c.name === n)) ?? [],
    released: known?.released,
  });
  const queue = all.filter((it) => !madeAlready(id, it.name));
  const left: Item[] = [];
  const tries = new Map<string, number>();
  const lastError = new Map<string, string>();
  const designs: Record<string, string> = { ...(canvaStatus(id)?.designs ?? {}) };
  const picturesPlanned = all.filter((it) => /^[qs]\d+$/.test(it.name)).length;
  let started = Date.now();
  let nextTry = 0;

  const report = (what: string) => {
    const made = all.filter((it) => madeAlready(id, it.name)).length;
    const msg = `Canva: ${made} of ${all.length} designs made · ${what}`;
    setCanvaProgress(id, made, all.length, msg);
    setStatus(id, { state: "running", questionsPlanned: picturesPlanned, designs, note: msg });
  };
  thumbStatus(id, { state: madeAlready(id, "thumbnail") ? "done" : "running" });
  report("starting");

  while (queue.length) {
    if (isStopped(id)) return;
    if (Date.now() - started > MAX_WORK_MS) break;
    // Waiting for Canva: in short steps, so Stop works and the heartbeat stays fresh
    while (Date.now() < nextTry) {
      if (isStopped(id)) return;
      beat(id);
      await sleep(Math.min(15_000, nextTry - Date.now()));
    }
    const it = queue[0]!;
    if (madeAlready(id, it.name)) {
      queue.shift(); // already bought: never pay for a design twice
      continue;
    }
    // The daily Canva limit: wait for midnight (not a try: nothing was asked)
    const today = canvaToday();
    if (today.left < it.cost()) {
      const waitFrom = Date.now();
      const until = waitFrom + msToIstMidnight();
      report(`${LIMIT_MESSAGE} (${today.made} of ${today.limit}), carrying on after midnight`);
      while (Date.now() < until && canvaToday().left < it.cost()) {
        if (isStopped(id)) return;
        beat(id);
        await sleep(Math.min(15_000, until - Date.now()));
      }
      started += Date.now() - waitFrom; // waiting for the limit doesn't count towards MAX_WORK_MS
      continue;
    }
    queue.shift();
    beat(id);
    report(`making the ${it.label}`);
    try {
      // A fresh Canva connection per design: the work runs for hours
      const d = await withCanva((c) => it.make(c, tries.get(it.name) ?? 0));
      if (isStopped(id)) return;
      savePages(id, it.name, d.pages);
      if (d.url) designs[it.name] = d.url;
      await it.after?.();
      report(queue.length ? "asking for the next one" : "all in");
    } catch (e) {
      const why = errText(e);
      const n = (tries.get(it.name) ?? 0) + 1;
      tries.set(it.name, n);
      lastError.set(it.name, why);
      console.warn("[canva]", id, it.label, `try ${n}:`, why);
      // To the back of the queue: one refused design doesn't hold up the others
      (n >= MAX_TRIES ? left : queue).push(it);
      nextTry = Date.now() + RETRY_WAIT;
      report(`${/cooling down/i.test(why) ? "Canva is cooling down" : "Canva turned the last one down"}, trying again at ${clock(nextTry)}`);
    }
  }

  const missing = [...queue, ...left];
  makeCopies(id, copies);
  const names = [...all.map((it) => it.name), ...copies.map((c) => c.name)];
  const has = (prefix: string) =>
    names
      .filter((n) => n.startsWith(prefix) && /\d$/.test(n) && madeAlready(id, n))
      .map((n) => Number(n.slice(1)) - 1)
      .sort((a, b) => a - b);
  setStatus(id, {
    state: missing.length ? "failed" : "done",
    thumbnail: madeAlready(id, "thumbnail"),
    screens: ["screens", "intro", "outro"].some((n) => madeAlready(id, n)),
    questions: has("q"),
    stickers: job.kind === "facts" ? has("s") : undefined,
    questionsPlanned: picturesPlanned,
    designs,
    error: missing.map((it) => `${it.label}: ${lastError.get(it.name) ?? "not made"}`).join(" · ") || undefined,
  });
  if (!madeAlready(id, "thumbnail")) thumbStatus(id, { state: "failed", error: lastError.get("thumbnail") ?? "not made" });
  fs.rmSync(workerFile(id), { force: true });
  if (missing.length) {
    // The video isn't made without Canva's designs: Rahul can continue once Canva works again
    fs.writeFileSync(path.join(canvaDir(id), "incomplete.json"), JSON.stringify({ missing: missing.map((it) => it.name), at: new Date().toISOString() }), "utf8");
    fs.writeFileSync(
      path.join(jobDir(id), "error.txt"),
      `Canva didn't make ${missing.length} of the ${all.length} designs (${missing.map((it) => it.label).join(", ")}). ` +
        `The ${all.length - missing.length} it made are kept: "Continue with Canva" asks for the rest again.`,
      "utf8",
    );
    return;
  }
  fs.rmSync(path.join(canvaDir(id), "incomplete.json"), { force: true });
  const open = stillOpen(yourPictures(id));
  if (open.length) {
    // Rahul adds his own pictures (or presses "Make the video now"): the video page shows how
    setWaitingForPictures(id, open.length);
    return;
  }
  startEngine(id);
}

/** "Continue with Canva" on a video whose Canva work gave up: asks for the missing designs again. */
export function continueCanva(id: string) {
  const job = getJob(id);
  if (!job || job.status.stage !== "error" || !job.status.canvaRetry) return false;
  fs.rmSync(path.join(jobDir(id), "error.txt"), { force: true });
  fs.rmSync(path.join(canvaDir(id), "incomplete.json"), { force: true });
  setCanvaProgress(id, 0, 0, "Asking Canva again…");
  void canvaForJob(id);
  return true;
}

/** Carries on every video still waiting for Canva (after a restart), and keeps checking. */
export function startCanvaSweep() {
  const g = globalThis as { __chaosCanvaSweep?: NodeJS.Timeout };
  if (g.__chaosCanvaSweep) return;
  const sweep = () => {
    try {
      for (const j of listJobs()) if (j.status.stage === "canva" && !working.has(j.id) && !busyElsewhere(j.id)) void canvaForJob(j.id);
    } catch (e) {
      console.error("[canva] sweep", e);
    }
  };
  sweep();
  g.__chaosCanvaSweep = setInterval(sweep, 60_000);
  g.__chaosCanvaSweep.unref?.();
}

/** Every video gets a Canva thumbnail, Canva designs on or off. Never throws. */
export async function canvaThumbnailForJob(id: string) {
  try {
    await withCanva((client) => thumbnailWithClient(id, client));
  } catch (e) {
    thumbStatus(id, { state: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

const thumbStatus = (id: string, s: { state: "running" | "done" | "failed"; error?: string; design?: string; tries?: number }) => {
  fs.mkdirSync(canvaDir(id), { recursive: true });
  fs.writeFileSync(path.join(canvaDir(id), "thumbnail-status.json"), JSON.stringify({ ...s, updatedAt: new Date().toISOString() }), "utf8");
};

/** Waits before each new try: Canva's "credit usage is cooling down" usually clears within minutes. */
const THUMB_RETRY_WAITS = [0, 60_000, 180_000];

/**
 * The Canva thumbnail for a video: up to 3 tries (the last with a brief that asks for original
 * artwork only, in case Canva refused the topic). Saved as canva\thumbnail-p<n>.png and made into
 * thumbnail.jpg; the engine also uses those pages if it finishes later. Returns true when done.
 */
async function thumbnailWithClient(id: string, client: Parameters<Parameters<typeof withCanva>[0]>[0]): Promise<boolean> {
  const job = getJob(id);
  if (!job) return false;
  const errors: string[] = [];
  thumbStatus(id, { state: "running" });
  for (let i = 0; i < THUMB_RETRY_WAITS.length; i++) {
    if (THUMB_RETRY_WAITS[i]) await new Promise((r) => setTimeout(r, THUMB_RETRY_WAITS[i]));
    let brief = thumbnailBrief(job);
    if (i === THUMB_RETRY_WAITS.length - 1)
      brief += "\nUse original artwork inspired by the topic only: no copyrighted characters, film stills, posters or official logos.";
    try {
      const d = await usageFor(job.title, () => canvaDesign(brief, SIZE[job.format].thumb, client));
      savePages(id, "thumbnail", d.pages);
      thumbStatus(id, { state: "done", design: d.url ?? d.designId, tries: i + 1 });
      try {
        await runImages(["thumbnail", jobDir(id)]);
        const name = job.exportName;
        if (name && fs.existsSync(path.join(VIDEO_FOLDER, `${name}.mp4`))) fs.copyFileSync(thumbPath(id), path.join(VIDEO_FOLDER, `${name}.jpg`));
      } catch (e) {
        console.error("[canva] thumbnail image", id, e);
      }
      return true;
    } catch (e) {
      errors.push(`try ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      thumbStatus(id, { state: "running", error: errors.join(" · "), tries: i + 1 });
    }
  }
  console.error("[canva] thumbnail", id, errors);
  thumbStatus(id, { state: "failed", error: errors.join(" · "), tries: THUMB_RETRY_WAITS.length });
  return false;
}

/** Runs engine/canva_images.py (page picking, fitting, logo). */
function runImages(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [path.join(ENGINE_DIR, "canva_images.py"), ...args], {
      cwd: ENGINE_DIR,
      windowsHide: true,
      env: { ...process.env, CHAOS_HOME, PYTHONIOENCODING: "utf-8" },
    });
    let err = "";
    child.stderr.on("data", (b: Buffer) => (err = (err + b.toString("utf8")).slice(-1500)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).slice(-2).join(" ") || `exit ${code}`))));
  });
}

/** "🎨 Canva thumbnail" on the video page: a new Canva design becomes the thumbnail (about 1–2 minutes). */
export async function canvaThumbnail(id: string) {
  const job = getJob(id);
  if (!job) throw new UserError("Video not found.");
  const d = await usageFor(job.title, () => canvaDesign(thumbnailBrief(job), SIZE[job.format].thumb));
  fs.mkdirSync(canvaDir(id), { recursive: true });
  savePages(id, "thumbnail", d.pages);
  try {
    await runImages(["thumbnail", jobDir(id)]);
  } catch (e) {
    throw new UserError(`Couldn't use Canva's design: ${e instanceof Error ? e.message : String(e)}`);
  }
  const name = job.exportName;
  if (name && fs.existsSync(path.join(VIDEO_FOLDER, `${name}.mp4`))) fs.copyFileSync(thumbPath(id), path.join(VIDEO_FOLDER, `${name}.jpg`));
  return d.url;
}
