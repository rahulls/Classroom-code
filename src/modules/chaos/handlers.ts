import "server-only";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { defineAction } from "@/core/action";
import { audit } from "@/core/audit";
import {
  DIFFICULTIES,
  FORMATS,
  GENERATE_COUNTS,
  IMAGE_NAME_RE,
  MAX_CSV_BYTES,
  MUSIC_MOODS,
  VOICES,
  YT_CATEGORIES,
  YT_DESCRIPTION_MAX,
  YT_TAGS_MAX,
  YT_TITLE_MAX,
  parseQuizCsv,
  parseRanks,
  parseTags,
} from "./csv";
import { generateQuizCsv, saveClaudeKey } from "./generate";
import { canvaThumbnail, canvaForJob } from "./canva-jobs";
import { canvaConnection, disconnectCanva } from "./canva";
import {
  createJob,
  deleteJob,
  designThumbnail,
  engineReady,
  getJob,
  isRunning,
  jobDir,
  listImages,
  listJobs,
  saveImage,
  saveYoutubeMeta,
  setCsvDiscarded,
  setImageCredit,
  setMark,
  setThumbImage,
  stopJob,
} from "./jobs";
import { disconnect, pushThumbnail, saveClient, startUpload } from "./youtube";

// Chaos Creators (quiz videos). Owner only: it has nothing to do with the classroom.
const PERMISSION = "settings.manage" as const;

const text = (max: number) => z.string().trim().max(max).optional();

export const createVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    csv: z.string().min(1, "Upload a questions CSV first").max(MAX_CSV_BYTES, "The CSV is too big"),
    fileName: text(200),
    format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS, ...(keyof typeof FORMATS)[]]),
    count: z.coerce.number().int().min(0).max(1000).optional(),
    title: text(80),
    quizBadge: text(24),
    introBadge: text(30),
    titleLine1: text(24),
    titleLine2: text(24),
    timerSeconds: z.coerce.number().int().min(3, "At least 3 seconds").max(60, "At most 60 seconds"),
    voice: z.enum(VOICES.map((v) => v.value) as [string, ...string[]]),
    musicMood: z.enum(MUSIC_MOODS.map((m) => m.value) as [string, ...string[]]).optional(),
    ranks: text(200),
    ranksOn: z.string().optional(),
    canva: z.string().optional(),
    canvaQuestions: z.string().optional(),
  }),
  run: async (input, { user }) => {
    const ready = engineReady();
    if (!ready.ok) return { ok: false, error: ready.problem! };
    if (listJobs().some(isRunning)) return { ok: false, error: "Another video is being made. Wait for it to finish (or stop it) first: one at a time keeps the laptop usable." };
    const parsed = parseQuizCsv(input.csv);
    const errors = parsed.issues.filter((i) => i.level === "error");
    if (errors.length) return { ok: false, error: `Fix the CSV first: ${errors.slice(0, 3).map((e) => (e.row ? `row ${e.row}: ${e.message}` : e.message)).join(" · ")}` };
    let questions = parsed.questions;
    if (input.count) {
      if (questions.length < input.count) return { ok: false, error: `The CSV has ${questions.length} questions; ${input.count} were asked for.`, fieldErrors: { count: "Not enough questions" } };
      questions = questions.slice(0, input.count);
    }
    if (input.canva && !canvaConnection().connected) return { ok: false, error: "Connect Canva first (Chaos Creators → Canva), or untick Canva designs." };
    const titleLines = [input.titleLine1, input.titleLine2].filter((s): s is string => !!s);
    const job = createJob({
      title: input.title || input.fileName?.replace(/\.csv$/i, "") || "Quiz video",
      format: input.format,
      questions,
      userId: user.id,
      fileName: input.fileName,
      sourceCsv: input.csv,
      youtube: { title: parsed.settings.youtubeTitle, description: parsed.settings.youtubeDescription, tags: parsed.settings.youtubeTags, category: parsed.settings.youtubeCategory },
      settings: {
        thumb_image: parsed.settings.thumbnailImage && listImages().some((i) => i.name === parsed.settings.thumbnailImage) ? parsed.settings.thumbnailImage : undefined,
        quiz_badge: input.quizBadge?.toUpperCase(),
        intro_badge: input.introBadge?.toUpperCase(),
        title_lines: titleLines.length ? titleLines : undefined,
        timer_seconds: input.timerSeconds,
        voice: input.voice,
        music_mood: input.musicMood,
        canva: input.canva ? true : undefined,
        canva_questions: input.canva && input.canvaQuestions ? true : undefined,
        ranks: input.format !== "youtube" ? undefined : !input.ranksOn ? ["off"] : parseRanks(input.ranks ?? "").length >= 2 ? parseRanks(input.ranks ?? "") : undefined,
      },
    });
    if (job.settings.canva) void canvaForJob(job.id); // runs on while the engine records the narration
    await audit({ action: "chaos.video.created", actor: user, entity: "chaos_video", entityId: job.id, after: { format: job.format, questions: job.questions } });
    revalidatePath("/chaos");
    redirect(`/chaos/videos/${job.id}`);
  },
});

// ------------------------- questions from Claude -------------------------

export const generateQuizAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    topic: z.string().trim().min(3, "Type a topic").max(200, "Keep the topic under 200 characters"),
    count: z.coerce.number().int().refine((n) => (GENERATE_COUNTS as readonly number[]).includes(n), "Choose a number of questions"),
    difficulty: z.enum(DIFFICULTIES.map((d) => d.value) as [(typeof DIFFICULTIES)[number]["value"], ...(typeof DIFFICULTIES)[number]["value"][]]),
  }),
  run: async (input, { user }) => {
    const res = await generateQuizCsv(input);
    await audit({ action: "chaos.quiz.generated", actor: user, entity: "chaos_quiz", entityId: "claude", after: { topic: input.topic, count: input.count, difficulty: input.difficulty, made: res.questions } });
    return { ok: true, message: `${res.questions} questions written.`, data: res };
  },
});

export const saveClaudeKeyAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    apiKey: z
      .string()
      .trim()
      .regex(/^sk-ant-[\w-]{20,}$/, "That isn't a Claude API key (it starts with sk-ant-)"),
  }),
  run: async ({ apiKey }, { user }) => {
    saveClaudeKey(apiKey);
    await audit({ action: "chaos.claude.key_saved", actor: user, entity: "chaos_claude", entityId: "key" });
    return { ok: true, message: "Key saved." };
  },
});

export const stopVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: z.string().regex(/^[a-z0-9]{6,40}$/) }),
  run: async ({ id }) => {
    if (!stopJob(id)) return { ok: false, error: "Video not found." };
    revalidatePath("/chaos");
    return { ok: true, message: "Stopped." };
  },
});

export const deleteVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: z.string().regex(/^[a-z0-9]{6,40}$/), back: z.string().optional() }),
  run: async ({ id, back }, { user }) => {
    if (!deleteJob(id)) return { ok: false, error: "Video not found." };
    await audit({ action: "chaos.video.deleted", actor: user, entity: "chaos_video", entityId: id });
    revalidatePath("/chaos");
    if (back) redirect("/chaos");
    return { ok: true, message: "Deleted." };
  },
});

// ------------------------- dashboard ticks -------------------------

const flag = z.enum(["0", "1"]).transform((v) => v === "1");

export const markVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: z.string().regex(/^[a-z0-9]{6,40}$/), mark: z.enum(["uploaded", "discarded"]), value: flag }),
  run: async ({ id, mark, value }) => {
    if (!setMark(id, mark, value)) return { ok: false, error: "Video not found." };
    revalidatePath("/chaos/dashboard");
    return { ok: true };
  },
});

export const discardCsvAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ name: z.string().min(1).max(200), value: flag }),
  run: async ({ name, value }) => {
    if (!setCsvDiscarded(name, value)) return { ok: false, error: "That CSV isn't in the csv folder any more." };
    revalidatePath("/chaos/dashboard");
    return { ok: true };
  },
});

// ------------------------------ thumbnails ------------------------------

const jobId = z.string().regex(/^[a-z0-9]{6,40}$/);

export const disconnectCanvaAction = defineAction({
  permission: PERMISSION,
  schema: z.object({}),
  run: async (_input, { user }) => {
    disconnectCanva();
    await audit({ action: "chaos.canva.disconnected", actor: user, entity: "chaos_canva", entityId: "account" });
    revalidatePath("/chaos/canva");
    return { ok: true, message: "Canva disconnected." };
  },
});

/** A thumbnail designed by Canva's AI (1–2 minutes). The old one stays if it fails. */
export const canvaThumbnailAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: jobId }),
  run: async ({ id }, { user }) => {
    const job = getJob(id);
    if (!job || job.status.stage !== "done") return { ok: false, error: "The video isn't ready yet." };
    const url = await canvaThumbnail(id);
    await audit({ action: "chaos.thumbnail.canva", actor: user, entity: "chaos_video", entityId: id, after: { design: url } });
    revalidatePath(`/chaos/videos/${id}`);
    revalidatePath("/chaos");
    return { ok: true, message: "Canva thumbnail made. The design is also in your Canva folder." };
  },
});

export const newThumbnailAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: jobId }),
  run: async ({ id }) => {
    const job = getJob(id);
    if (!job || job.status.stage !== "done") return { ok: false, error: "The video isn't ready yet." };
    designThumbnail(id);
    revalidatePath(`/chaos/videos/${id}`);
    revalidatePath("/chaos");
    return { ok: true, message: "New thumbnail designed." };
  },
});

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Puts a topic photo (a new upload or one already in the images folder) on the thumbnail, or takes it off. */
export const topicPhotoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    id: jobId,
    file: z
      .instanceof(File)
      .refine((f) => f.size <= MAX_PHOTO_BYTES, "The photo must be under 8 MB")
      .refine((f) => /\.(jpe?g|png|webp)$/i.test(f.name), "Use a .jpg, .png or .webp photo")
      .optional(),
    existing: z.string().regex(IMAGE_NAME_RE).optional(),
    credit: z.string().trim().max(400, "Keep the credit under 400 characters").optional(),
    remove: z.string().optional(),
  }),
  run: async (input) => {
    const job = getJob(input.id);
    if (!job || job.status.stage !== "done") return { ok: false, error: "The video isn't ready yet." };
    let name: string | null = null;
    if (!input.remove) {
      if (input.file) name = saveImage(input.file.name, Buffer.from(await input.file.arrayBuffer()), input.credit);
      else if (input.existing && listImages().some((i) => i.name === input.existing)) {
        name = input.existing;
        if (input.credit) setImageCredit(name, input.credit);
      } else return { ok: false, error: "Choose a photo file, or one you used before." };
    }
    setThumbImage(input.id, name);
    // Same design (colours and layout), now with or without the photo
    let seed: number | undefined;
    try {
      seed = (JSON.parse(fs.readFileSync(path.join(jobDir(input.id), "thumbnail.json"), "utf8")) as { seed?: number }).seed;
    } catch {
      /* no thumbnail yet */
    }
    designThumbnail(input.id, seed);
    revalidatePath(`/chaos/videos/${input.id}`);
    revalidatePath("/chaos/dashboard");
    return { ok: true, message: name ? "Photo added to the thumbnail." : "Photo taken off the thumbnail." };
  },
});

// ------------------------------- YouTube --------------------------------

export const saveYoutubeClientAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    clientId: z
      .string()
      .trim()
      .regex(/^[\w-]+\.apps\.googleusercontent\.com$/, "That isn't a Google client ID (it ends in .apps.googleusercontent.com)"),
    clientSecret: z.string().trim().max(200).optional(),
  }),
  run: async ({ clientId, clientSecret }, { user }) => {
    saveClient(clientId, clientSecret || undefined);
    await audit({ action: "chaos.youtube.client_saved", actor: user, entity: "chaos_youtube", entityId: "client" });
    revalidatePath("/chaos/youtube");
    return { ok: true, message: "Saved. Now click Connect YouTube." };
  },
});

export const disconnectYoutubeAction = defineAction({
  permission: PERMISSION,
  schema: z.object({}),
  run: async (_input, { user }) => {
    await disconnect();
    await audit({ action: "chaos.youtube.disconnected", actor: user, entity: "chaos_youtube", entityId: "channel" });
    revalidatePath("/chaos/youtube");
    return { ok: true, message: "Disconnected. The app can no longer upload to YouTube." };
  },
});

const ytTitle = z.string().trim().min(1, "Give it a title").max(YT_TITLE_MAX, `YouTube allows ${YT_TITLE_MAX} characters`);
const ytDescription = z.string().trim().max(YT_DESCRIPTION_MAX, `YouTube allows ${YT_DESCRIPTION_MAX} characters`).optional();
const ytTags = z.string().trim().max(YT_TAGS_MAX + 100, "Too many tags (YouTube allows about 500 characters)").optional();
const ytCategory = z.enum(YT_CATEGORIES.map((c) => c.id) as [string, ...string[]]).optional();

export const saveYoutubeMetaAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: jobId, title: ytTitle, description: ytDescription, tags: ytTags, category: ytCategory }),
  run: async (input) => {
    if (!getJob(input.id)) return { ok: false, error: "Video not found." };
    saveYoutubeMeta(input.id, { title: input.title, description: input.description, tags: parseTags(input.tags ?? ""), category: input.category });
    revalidatePath(`/chaos/videos/${input.id}`);
    revalidatePath("/chaos/dashboard");
    return { ok: true, message: "Saved." };
  },
});

export const uploadToYoutubeAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    id: jobId,
    title: ytTitle,
    description: ytDescription,
    tags: ytTags,
    category: ytCategory,
    privacy: z.enum(["private", "unlisted", "public"]),
    // Chaos Creators videos are not made for kids (Rahul's choice); the form still asks, preset to "no"
    madeForKids: z.enum(["yes", "no"]).default("no"),
    useThumbnail: z.string().optional(),
  }),
  run: async (input, { user }) => {
    const tags = parseTags(input.tags ?? "");
    // What was reviewed is what the video keeps (for a re-upload or the dashboard)
    saveYoutubeMeta(input.id, { title: input.title, description: input.description, tags, category: input.category });
    await startUpload(input.id, {
      title: input.title,
      description: input.description ?? "",
      tags,
      categoryId: input.category,
      privacy: input.privacy,
      madeForKids: input.madeForKids === "yes",
      useThumbnail: !!input.useThumbnail,
    });
    await audit({ action: "chaos.youtube.upload_started", actor: user, entity: "chaos_video", entityId: input.id, after: { privacy: input.privacy } });
    revalidatePath(`/chaos/videos/${input.id}`);
    return { ok: true, message: "Uploading…" };
  },
});

export const pushThumbnailAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: jobId }),
  run: async ({ id }) => {
    await pushThumbnail(id);
    revalidatePath(`/chaos/videos/${id}`);
    return { ok: true, message: "Thumbnail updated on YouTube." };
  },
});
