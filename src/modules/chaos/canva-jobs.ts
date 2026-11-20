import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UserError } from "@/core/action";
import { canvaDesign, canvaPicture, withCanva } from "./canva";
import { questionPicturePrompts } from "./generate";
import { CHAOS_HOME, PYTHON, ENGINE_DIR, VIDEO_FOLDER, getJob, getYoutubeMeta, jobDir, jobQuestions, thumbPath, type JobView } from "./jobs";

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
  /** Questions (0-based) that got their own Canva background */
  questions?: number[];
  /** How many question pictures were asked for (the engine waits longer for more) */
  questionsPlanned?: number;
  designs?: Record<string, string>;
  updatedAt: string;
};

/** Per-question pictures only up to this many questions: each one is ~1–2 minutes of Canva work. */
export const MAX_QUESTION_PICTURES = 25;
/** Canva pictures made at the same time (more trips Canva's rate limits). */
const PARALLEL_PICTURES = 4;

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
      .replace(/\b(quiz|questions?)\b/gi, " ")
      .replace(/[\s:|–()-]+/g, " ")
      .trim();
  const badge = strip(job.settings.quiz_badge ?? "");
  return badge && badge.length <= 30 ? badge : strip(job.title) || "general knowledge";
}

const SIZE = { youtube: { w: 1280, h: 720, thumb: "YouTube Thumbnail", screen: "Presentation (16:9)" }, shorts: { w: 1080, h: 1920, thumb: "Your Story", screen: "Your Story" } } as const;

export function thumbnailBrief(job: JobView, seed = Math.random()) {
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

function screenBrief(job: JobView, kind: "intro" | "outro" | "both") {
  const topic = topicOf(job);
  const s = SIZE[job.format];
  const shape = job.format === "shorts" ? `vertical 9:16 (${s.h === 1920 ? "1080x1920" : ""} video frame)` : "wide 16:9 (1920x1080 video frame)";
  const intro = `an exciting opening scene about ${topic}, full of anticipation, as if the show is about to start`;
  const outro = `a celebratory finale about ${topic}: warm light, victory mood, confetti or fireworks fitting the theme`;
  const what =
    kind === "both"
      ? `Exactly 2 slides of background artwork for a YouTube quiz video about ${topic}, ${shape}. Slide 1 (intro): ${intro}. Slide 2 (ending): ${outro}.`
      : `One page of background artwork for the ${kind === "intro" ? "intro" : "ending"} screen of a YouTube quiz video about ${topic}, ${shape}: ${kind === "intro" ? intro : outro}.`;
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
 * Started when a video is created with "Canva designs" on: thumbnail + intro + ending at the same
 * time (about 2 minutes). Never throws: the engine falls back to the normal pictures.
 */
export async function canvaForJob(id: string) {
  const job = getJob(id);
  if (!job) return;
  const qs = jobQuestions(id);
  const wantQuestions = !!job.settings.canva_questions && qs.length > 0 && qs.length <= MAX_QUESTION_PICTURES;
  setStatus(id, { state: "running", questionsPlanned: wantQuestions ? qs.length : 0 });
  const designs: Record<string, string> = {};
  const errors: string[] = [];
  let thumbnail = false;
  let screens = false;
  const questions: number[] = [];
  try {
    await withCanva(async (client) => {
      const tasks: Promise<void>[] = [];
      const one = async (name: string, brief: string, format: string) => {
        try {
          const d = await canvaDesign(brief, format, client);
          savePages(id, name, d.pages);
          designs[name] = d.url ?? d.designId;
          if (name === "thumbnail") thumbnail = true;
          else screens = true;
        } catch (e) {
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      const s = SIZE[job.format];
      tasks.push(one("thumbnail", thumbnailBrief(job), s.thumb));
      if (job.format === "youtube") tasks.push(one("screens", screenBrief(job, "both"), s.screen));
      else tasks.push(one("intro", screenBrief(job, "intro"), s.screen), one("outro", screenBrief(job, "outro"), s.screen));
      if (wantQuestions) tasks.push(questionPictures(job, qs, client, questions, errors));
      await Promise.all(tasks);
    });
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  if (errors.length) console.error("[canva]", id, errors);
  setStatus(id, {
    state: thumbnail || screens || questions.length ? "done" : "failed",
    thumbnail,
    screens,
    questions: questions.sort((a, b) => a - b),
    designs,
    error: errors.join(" · ") || undefined,
  });
}

/**
 * A Canva background for every question: Claude writes the picture prompts (never hinting at the
 * answer), Canva draws them, PARALLEL_PICTURES at a time. Saved as canva\q<n>-p<page>.png (n from 1).
 */
async function questionPictures(job: JobView, qs: ReturnType<typeof jobQuestions>, client: Parameters<Parameters<typeof withCanva>[0]>[0], done: number[], errors: string[]) {
  const topic = topicOf(job);
  let prompts: string[] | null = null;
  try {
    prompts = await questionPicturePrompts(topic, qs);
  } catch (e) {
    errors.push(`picture prompts: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Without Claude: varied artwork about the topic, which can't give an answer away
  const SCENES = ["a wide establishing shot", "a dramatic close-up of an object", "a night scene with neon light", "a sunny daytime scene", "an aerial view", "a moody indoor scene"];
  const promptFor = (i: number) =>
    prompts?.[i] ?? `Cinematic background artwork about ${topic}: ${SCENES[i % SCENES.length]}. Keep the middle calm. No people's faces. No text, no logos.`;
  let next = 0;
  const worker = async () => {
    while (next < qs.length) {
      const i = next++;
      try {
        savePages(job.id, `q${i + 1}`, await canvaPicture(promptFor(i), job.format === "shorts", client));
        done.push(i);
      } catch (e) {
        errors.push(`question ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  if (prompts) fs.writeFileSync(path.join(canvaDir(job.id), "question-prompts.json"), JSON.stringify(prompts, null, 1), "utf8");
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PICTURES, qs.length) }, worker));
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
  const d = await canvaDesign(thumbnailBrief(job), SIZE[job.format].thumb);
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
