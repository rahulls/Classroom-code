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
  KID_VOICE_PACK,
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
import { generateFactsCsv, generateQuizCsv, saveClaudeKey } from "./generate";
import { GENERATE_FACT_COUNTS, parseFactsCsv } from "./facts";
import { FLAG_LEVELS, FLAG_LIMITS, roundProblems, type FlagLevel, type FlagOptions, type FlagRound } from "./flags";
import { addFlagsLog } from "./flags-log";
import {
  CARD_KEY_RE,
  MAX_RECORDING_BYTES,
  RECORDING_EXT,
  addDraftVideo,
  createDraft,
  deleteDraft,
  draftReadiness,
  draftRecordings,
  draftSourceCsv,
  editCard,
  getDraft,
  removeRecording,
  saveRecording,
  setIntroOutro,
} from "./facts-drafts";
import { MAX_PICTURE_BYTES, adoptStagedPictures, canvaThumbnail, canvaForJob, canvaThumbnailForJob, continueCanva, releasePictures, saveYourPicture, stagePicturePrompts } from "./canva-jobs";
import { canvaConnection, disconnectCanva } from "./canva";
import { emailReport, istDay, saveUsageSettings } from "./usage";
import {
  createFactsJob,
  createFlagsJob,
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
  type JobSettings,
} from "./jobs";
import { disconnect, pushThumbnail, saveClient, startUpload } from "./youtube";

// Chaos Creators (quiz videos). Owner only: it has nothing to do with the classroom.
const PERMISSION = "settings.manage" as const;

const text = (max: number) => z.string().trim().max(max).optional();
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

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
    kidVoice: z.string().optional(),
    canva: z.string().optional(),
    canvaQuestions: z.string().optional(),
    picturesToken: z.string().optional(),
    holdPictures: z.string().optional(),
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
        voice_pack: input.kidVoice ? KID_VOICE_PACK : "off",
        canva: input.canva ? true : undefined,
        canva_questions: input.canva && input.canvaQuestions ? true : undefined,
        ranks: input.format !== "youtube" ? undefined : !input.ranksOn ? ["off"] : parseRanks(input.ranks ?? "").length >= 2 ? parseRanks(input.ranks ?? "") : undefined,
      },
    });
    // Pictures chosen in the studio's table (an upload means Canva isn't asked for that one)
    if (job.settings.canva_questions) adoptStagedPictures(input.picturesToken, job.id, !!input.holdPictures);
    // Runs on while the engine records the narration. The Canva thumbnail is made for every video.
    if (job.settings.canva) void canvaForJob(job.id);
    else void canvaThumbnailForJob(job.id);
    await audit({ action: "chaos.video.created", actor: user, entity: "chaos_video", entityId: job.id, after: { format: job.format, questions: job.questions } });
    revalidatePath("/chaos");
    redirect(`/chaos/videos/${job.id}`);
  },
});

// ------------------------- Flag Memory Challenge videos -------------------------

const num = (lo: number, hi: number, what: string) => z.coerce.number().min(lo, `${what}: at least ${lo}`).max(hi, `${what}: at most ${hi}`);

/** A Flag Memory Challenge from the studio's Flags tab: the rounds the page previewed (checked again here). */
export const createFlagsVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS, ...(keyof typeof FORMATS)[]]),
    level: z.enum(Object.keys(FLAG_LEVELS) as [FlagLevel, ...FlagLevel[]]),
    rounds: z.string().min(2, "Pick the flags first").max(20_000),
    show: num(FLAG_LIMITS.show[0], FLAG_LIMITS.show[1], "Flags shown").int(),
    find: num(FLAG_LIMITS.find[0], FLAG_LIMITS.find[1], "Flags to find").int(),
    grid: num(FLAG_LIMITS.grid[0], FLAG_LIMITS.grid[1], "Flags in the grid").int(),
    flagSeconds: num(FLAG_LIMITS.flagSeconds[0], FLAG_LIMITS.flagSeconds[1], "Seconds per flag"),
    searchSeconds: num(FLAG_LIMITS.searchSeconds[0], FLAG_LIMITS.searchSeconds[1], "Seconds to search").int(),
    title: text(80),
    badge: text(24),
    voice: z.enum(VOICES.map((v) => v.value) as [string, ...string[]]),
    kidVoice: z.string().optional(),
    youtubeTitle: text(YT_TITLE_MAX),
    youtubeDescription: z.string().max(YT_DESCRIPTION_MAX).optional(),
    youtubeTags: z.string().max(YT_TAGS_MAX + 200).optional(),
  }),
  run: async (input, { user }) => {
    const ready = engineReady();
    if (!ready.ok) return { ok: false, error: ready.problem! };
    if (listJobs().some(isRunning)) return { ok: false, error: "Another video is being made. Wait for it to finish (or stop it) first: one at a time keeps the laptop usable." };
    if (input.find >= input.show) return { ok: false, error: "Flags to find must be fewer than the flags shown." };
    if (input.grid < input.find * 2) return { ok: false, error: "The grid needs at least twice as many flags as there are to find." };
    const options: FlagOptions = { show: input.show, find: input.find, grid: input.grid, flagSeconds: input.flagSeconds, searchSeconds: input.searchSeconds };
    let rounds: FlagRound[];
    try {
      rounds = JSON.parse(input.rounds) as FlagRound[];
    } catch {
      return { ok: false, error: "The flags didn't come through. Press Shuffle and try again." };
    }
    if (!Array.isArray(rounds) || rounds.length < FLAG_LIMITS.rounds[0] || rounds.length > FLAG_LIMITS.rounds[1]) return { ok: false, error: `1 to ${FLAG_LIMITS.rounds[1]} rounds.` };
    for (const [i, rd] of rounds.entries()) {
      const p = roundProblems(rd, options);
      if (p.length) return { ok: false, error: `Round ${i + 1} doesn't fit the settings (${p.join(", ")}). Press Shuffle to pick again.` };
    }
    const level = FLAG_LEVELS[input.level].label;
    const job = createFlagsJob({
      title: input.title || `Flag Memory Challenge (${level})`,
      format: input.format,
      level: input.level,
      options,
      rounds,
      userId: user.id,
      settings: { voice: input.voice, quiz_badge: (input.badge || "FLAG MEMORY CHALLENGE").toUpperCase(), voice_pack: input.kidVoice ? KID_VOICE_PACK : "off" },
      youtube: { title: input.youtubeTitle, description: input.youtubeDescription, tags: input.youtubeTags ? parseTags(input.youtubeTags) : undefined, category: "24" },
    });
    // The series record: which flags each video used (the Flags tab avoids them next time)
    addFlagsLog({ jobId: job.id, title: job.title, level: input.level, format: job.format, createdAt: job.createdAt, rounds });
    await audit({ action: "chaos.video.created", actor: user, entity: "chaos_video", entityId: job.id, after: { kind: "flags", format: job.format, level: input.level, rounds: rounds.length } });
    revalidatePath("/chaos");
    redirect(`/chaos/videos/${job.id}`);
  },
});

// ------------------------- facts videos ("Did you know?") -------------------------

const draftId = z.string().regex(/^[a-z0-9]{6,40}$/);
const cardKey = z.string().regex(CARD_KEY_RE);

/**
 * Facts video from the studio's Facts tab. AI narration: the video is made straight away.
 * Recorded narration: a recording deck (draft) is made first; its "Make video" makes the video.
 */
export const createFactsVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    csv: z.string().min(1, "Upload a facts CSV first").max(MAX_CSV_BYTES, "The CSV is too big"),
    fileName: text(200),
    format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS, ...(keyof typeof FORMATS)[]]),
    count: z.coerce.number().int().min(0).max(1000).optional(),
    narration: z.enum(["ai", "record"]),
    title: text(80),
    quizBadge: text(24),
    introBadge: text(30),
    titleLine1: text(24),
    titleLine2: text(24),
    voice: z.enum(VOICES.map((v) => v.value) as [string, ...string[]]),
    musicMood: z.enum(MUSIC_MOODS.map((m) => m.value) as [string, ...string[]]).optional(),
    kidVoice: z.string().optional(),
    canva: z.string().optional(),
    canvaFacts: z.string().optional(),
    introOutro: z.string().optional(),
    picturesToken: z.string().optional(),
    holdPictures: z.string().optional(),
  }),
  run: async (input, { user }) => {
    const parsed = parseFactsCsv(input.csv);
    const errors = parsed.issues.filter((i) => i.level === "error");
    if (errors.length) return { ok: false, error: `Fix the CSV first: ${errors.slice(0, 3).map((e) => (e.row ? `row ${e.row}: ${e.message}` : e.message)).join(" · ")}` };
    let facts = parsed.facts;
    if (input.count) {
      if (facts.length < input.count) return { ok: false, error: `The CSV has ${facts.length} facts; ${input.count} were asked for.` };
      facts = facts.slice(0, input.count);
    }
    if (input.canva && !canvaConnection().connected) return { ok: false, error: "Connect Canva first (Chaos Creators → Canva), or untick Canva designs." };
    const titleLines = [input.titleLine1, input.titleLine2].filter((s): s is string => !!s);
    const title = input.title || input.fileName?.replace(/\.csv$/i, "") || "Facts video";
    const settings: JobSettings = {
      thumb_image: parsed.settings.thumbnailImage && listImages().some((i) => i.name === parsed.settings.thumbnailImage) ? parsed.settings.thumbnailImage : undefined,
      quiz_badge: input.quizBadge?.toUpperCase(),
      intro_badge: input.introBadge?.toUpperCase(),
      title_lines: titleLines.length ? titleLines : undefined,
      voice: input.voice,
      music_mood: input.musicMood,
      voice_pack: input.kidVoice ? KID_VOICE_PACK : "off",
      canva: input.canva ? true : undefined,
      canva_questions: input.canva && input.canvaFacts ? true : undefined,
    };
    const youtube = { title: parsed.settings.youtubeTitle, description: parsed.settings.youtubeDescription, tags: parsed.settings.youtubeTags, category: parsed.settings.youtubeCategory };
    if (input.narration === "record") {
      const draft = createDraft({ title, format: input.format, facts, settings, userId: user.id, fileName: input.fileName, sourceCsv: input.csv, youtube, introOutro: !!input.introOutro });
      await audit({ action: "chaos.facts.deck_created", actor: user, entity: "chaos_facts_deck", entityId: draft.id, after: { format: draft.format, facts: facts.length } });
      revalidatePath("/chaos");
      redirect(`/chaos/facts/${draft.id}`);
    }
    const ready = engineReady();
    if (!ready.ok) return { ok: false, error: ready.problem! };
    if (listJobs().some(isRunning)) return { ok: false, error: "Another video is being made. Wait for it to finish (or stop it) first: one at a time keeps the laptop usable." };
    const job = createFactsJob({ title, format: input.format, facts, narration: "ai", settings, userId: user.id, fileName: input.fileName, sourceCsv: input.csv, youtube });
    if (job.settings.canva_questions) adoptStagedPictures(input.picturesToken, job.id, !!input.holdPictures);
    if (job.settings.canva) void canvaForJob(job.id);
    else void canvaThumbnailForJob(job.id);
    await audit({ action: "chaos.video.created", actor: user, entity: "chaos_video", entityId: job.id, after: { kind: "facts", format: job.format, facts: job.questions } });
    revalidatePath("/chaos");
    redirect(`/chaos/videos/${job.id}`);
  },
});

/** One recording from the deck (replaces the card's earlier one). */
export const saveRecordingAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    id: draftId,
    key: cardKey,
    seconds: z.coerce.number().min(0.2, "That recording is empty").max(120, "Keep a recording under 2 minutes"),
    file: z
      .instanceof(File, { message: "No recording came through. Try again." })
      .refine((f) => f.size > 0 && f.size <= MAX_RECORDING_BYTES, "The recording is too big"),
  }),
  run: async ({ id, key, seconds, file }) => {
    const mime = (file.type || "audio/webm").split(";")[0]!.trim() as keyof typeof RECORDING_EXT;
    const ext = RECORDING_EXT[mime];
    if (!ext) return { ok: false, error: `This browser records ${file.type}, which the studio can't use. Use Chrome or Edge.` };
    const rec = saveRecording(id, key, Buffer.from(await file.arrayBuffer()), ext, seconds);
    if (!rec) return { ok: false, error: "That card isn't in this deck any more. Reload the page." };
    return { ok: true, data: { recording: rec } };
  },
});

/** The deck's "Record the intro and ending too" switch. */
export const setIntroOutroAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: draftId, on: z.enum(["0", "1"]) }),
  run: async ({ id, on }) => {
    const cards = setIntroOutro(id, on === "1");
    if (!cards) return { ok: false, error: "This recording deck was deleted." };
    revalidatePath(`/chaos/facts/${id}`);
    return { ok: true, data: cards };
  },
});

export const deleteRecordingAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: draftId, key: cardKey }),
  run: async ({ id, key }) => {
    removeRecording(id, key);
    return { ok: true };
  },
});

/** Changes a card's words: a fact's headline / detail / narration, or a middle line. */
export const editCardAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    id: draftId,
    key: cardKey,
    headline: z.string().trim().min(1, "The headline can't be empty").max(160).optional(),
    detail: z.string().trim().max(240).optional(),
    narration: z.string().trim().max(400).optional(),
    text: z.string().trim().min(1, "Type the line to say").max(160).optional(),
  }),
  run: async ({ id, key, ...patch }) => {
    if (!editCard(id, key, patch)) return { ok: false, error: "That card isn't in this deck any more. Reload the page." };
    revalidatePath(`/chaos/facts/${id}`);
    return { ok: true };
  },
});

/** "Make video" on a recording deck: every fact must be recorded (middle lines are optional). */
export const makeFactsVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: draftId }),
  run: async ({ id }, { user }) => {
    const draft = getDraft(id);
    if (!draft) return { ok: false, error: "This recording deck was deleted." };
    const { ready, missing } = draftReadiness(draft);
    if (!ready) return { ok: false, error: `Record every fact first: ${missing.length} still to record (or recorded before their words changed).` };
    const engine = engineReady();
    if (!engine.ok) return { ok: false, error: engine.problem! };
    if (listJobs().some(isRunning)) return { ok: false, error: "Another video is being made. Wait for it to finish (or stop it) first." };
    if (draft.settings.canva && !canvaConnection().connected) return { ok: false, error: "Canva designs are on for this deck, but Canva isn't connected. Connect Canva first." };
    const rec = draftRecordings(draft);
    const job = createFactsJob({
      title: draft.title,
      format: draft.format,
      facts: rec.facts,
      middles: rec.middles,
      intro: rec.intro,
      outro: rec.outro,
      narration: "record",
      settings: draft.settings,
      userId: user.id,
      fileName: draft.fileName,
      sourceCsv: draftSourceCsv(id),
      youtube: draft.youtube,
    });
    addDraftVideo(id, job.id);
    if (job.settings.canva) void canvaForJob(job.id);
    else void canvaThumbnailForJob(job.id);
    await audit({ action: "chaos.video.created", actor: user, entity: "chaos_video", entityId: job.id, after: { kind: "facts", narration: "record", deck: id, facts: job.questions } });
    revalidatePath("/chaos");
    redirect(`/chaos/videos/${job.id}`);
  },
});

export const deleteDraftAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: draftId, back: z.string().optional() }),
  run: async ({ id, back }, { user }) => {
    if (!deleteDraft(id)) return { ok: false, error: "Deck not found." };
    await audit({ action: "chaos.facts.deck_deleted", actor: user, entity: "chaos_facts_deck", entityId: id });
    revalidatePath("/chaos");
    if (back) redirect("/chaos?type=facts");
    return { ok: true, message: "Deleted." };
  },
});

export const generateFactsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    topic: z.string().trim().min(3, "Type a topic").max(200, "Keep the topic under 200 characters"),
    count: z.coerce.number().int().refine((n) => (GENERATE_FACT_COUNTS as readonly number[]).includes(n), "Choose a number of facts"),
  }),
  run: async (input, { user }) => {
    const res = await generateFactsCsv(input);
    await audit({ action: "chaos.facts.generated", actor: user, entity: "chaos_facts", entityId: "claude", after: { topic: input.topic, count: input.count, made: res.facts } });
    return { ok: true, message: `${res.facts} facts written.`, data: res };
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

/** A video whose Canva designs didn't all come: ask Canva for the missing ones again (then the video is made). */
export const continueCanvaAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: z.string().regex(/^[a-z0-9]{6,40}$/) }),
  run: async ({ id }) => {
    if (listJobs().some((j) => j.id !== id && isRunning(j))) return { ok: false, error: "Another video is being made. Wait for it to finish (or stop it) first." };
    if (!continueCanva(id)) return { ok: false, error: "This video isn't waiting for Canva." };
    revalidatePath("/chaos");
    return { ok: true, message: "Asking Canva again." };
  },
});

/**
 * "Get picture prompts" in the studio: Claude's prompt for every picture of the video about to be
 * made (one call, a few cents), for the table where Rahul can upload his own pictures.
 */
export const picturePromptsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    kind: z.enum(["quiz", "facts"]),
    csv: z.string().min(1, "Upload a CSV first").max(MAX_CSV_BYTES),
    count: z.coerce.number().int().min(0).max(1000),
    badge: text(40),
    title: text(120),
  }),
  run: async (input) => {
    const badge = input.badge ?? "";
    const title = input.title ?? "";
    if (input.kind === "facts") {
      const all = parseFactsCsv(input.csv).facts;
      const facts = input.count ? all.slice(0, input.count) : all;
      return { ok: true, data: await stagePicturePrompts({ kind: "facts", badge, title, facts }) };
    }
    const all = parseQuizCsv(input.csv).questions;
    const questions = input.count ? all.slice(0, input.count) : all;
    return { ok: true, data: await stagePicturePrompts({ kind: "quiz", badge, title, questions }) };
  },
});

/** Rahul's own picture for a fact / question without its own Canva picture (from its prompt). */
export const uploadYourPictureAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    id: z.string().regex(/^[a-z0-9]{6,40}$/),
    name: z.string().regex(/^q\d{1,3}$/),
    file: z
      .instanceof(File, { message: "Choose a picture" })
      .refine((f) => f.size > 0, "Choose a picture")
      .refine((f) => f.size <= MAX_PICTURE_BYTES, "The picture must be under 10 MB")
      .refine((f) => /\.(jpe?g|png|webp)$/i.test(f.name), "Use a .jpg, .png or .webp picture"),
  }),
  run: async ({ id, name, file }) => {
    const job = getJob(id);
    if (!job || !["canva", "pictures"].includes(job.status.stage)) return { ok: false, error: "The video is already being made, so its pictures can't change now." };
    const open = saveYourPicture(id, name, Buffer.from(await file.arrayBuffer()));
    // The last one in while the video waits: make it straight away
    if (!open && job.status.stage === "pictures") releasePictures(id);
    revalidatePath(`/chaos/videos/${id}`);
    return { ok: true, message: open ? `Picture added. ${open} still to add (or make the video now).` : "Picture added." };
  },
});

/** The video waits for Rahul's pictures: make it now, with the shared pictures for the rest. */
export const makeVideoNowAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: z.string().regex(/^[a-z0-9]{6,40}$/) }),
  run: async ({ id }) => {
    if (listJobs().some((j) => j.id !== id && isRunning(j))) return { ok: false, error: "Another video is being made. Wait for it to finish (or stop it) first." };
    if (!releasePictures(id)) return { ok: false, error: "This video isn't waiting for pictures." };
    revalidatePath(`/chaos/videos/${id}`);
    revalidatePath("/chaos");
    return { ok: true, message: "Making the video." };
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

export const saveUsageSettingsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    canvaDailyLimit: z.coerce.number().int("A whole number").min(0).max(2000),
    canvaSavingPercent: z.coerce.number().int("A whole number").min(0, "0 to 60").max(60, "0 to 60"),
    canvaMode: z.enum(["minimum", "saving"]),
    emailReport: checkbox,
    canvaRupeesPerAction: z.coerce.number().min(0).max(100),
    rupeesPerDollar: z.coerce.number().min(1).max(500),
  }),
  run: async (input, { user }) => {
    saveUsageSettings(input);
    await audit({ action: "chaos.usage.settings_saved", actor: user, entity: "chaos_usage", entityId: "settings", after: input });
    revalidatePath("/chaos/usage");
    return { ok: true, message: "Saved." };
  },
});

export const emailUsageReportAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  run: async ({ day }) => {
    const to = await emailReport(day ?? istDay());
    return { ok: true, message: `Report emailed to ${to}.` };
  },
});

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
