import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { UserError } from "@/core/action";
import { askClaude } from "@/modules/chaos/generate";
import { channelName } from "./brand";
import { nextVoice } from "./voices";
import { ANIM_KINDS, VISUAL_MODES, cleanIcon, cleanSticker, cleanSubject, visualRules, type AnimKind, type VisualMode } from "./visuals";
import { EDU_HOME, getSettings, itemDir, listRows, readJson, writeJson, type TopicRow, type VideoFormat } from "./store";

// Claude writes each video's script: the narration, split into scenes, each scene naming one of the
// engine's animated scene types (src/Edu videos/engine/scenes.py) and filling its on-screen text;
// plus the YouTube title / description / tags, the claims to double-check, and how it avoids
// repeating earlier videos. Saved as items\<id>\draft.json for Rahul to review and edit.

export const SCENE_TYPES = ["title", "bullets", "steps", "cycle", "compare", "timeline", "stat", "bars", "diagram", "picture", "keyword", "demo", "quiz", "recap", "outro"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export type SceneItem = { label: string; detail?: string; value?: string; icon?: string; icon2?: string };
export type Scene = {
  type: SceneType;
  say: string;
  heading?: string;
  big?: string;
  items?: SceneItem[];
  left_title?: string;
  right_title?: string;
  unit?: string;
  answer?: number;
  picture_prompt?: string;
  chapter?: string;
  /** The scene's 3D visual: animation (default), a still sticker, or none (Rahul's tick on the review page) */
  visual?: VisualMode;
  anim?: AnimKind;
  anim_subject?: string;
  anim_cue?: string;
  sticker?: string;
};
export type Claim = { claim: string; confidence: "high" | "medium" | "low" };
export type Draft = {
  title: string;
  kicker: string;
  thumbnail_text: string;
  youtube_title: string;
  youtube_description: string;
  youtube_tags: string[];
  summary: string;
  claims: Claim[];
  overlap_note: string;
  scenes: Scene[];
  format: VideoFormat;
  /** The narrator (Kokoro voice id), picked from the rotation when the script is first written */
  voice?: string;
  writtenAt: string;
  editedAt?: string;
};

/** What each scene type shows, for the review screen and for Claude. */
export const SCENE_HELP: Record<SceneType, string> = {
  title: "Opening title card: heading = the big title; big = a short hook line under it; the scene's 3D animation shows above it.",
  bullets: "Heading + 2-5 points (items[].label, optional items[].detail) that appear one by one.",
  steps: "A process: heading + 2-6 steps in order (items[].label, optional detail), joined by arrows.",
  cycle: "A loop: heading + 3-5 stages (items[].label) on a circle with arrows.",
  compare: "Two columns: left_title vs right_title; each item is one row: label = left side, detail = right side (2-4 rows).",
  timeline: "Heading + 2-6 dated events: items[].label = the date, items[].detail = what happened.",
  stat: "One big number that counts up: big = the number with its unit (\"8 minutes\", \"300,000 km/s\"); heading = what it means.",
  bars: "Bar chart: heading + 2-6 bars, items[].label + items[].value (a plain number); unit = the unit.",
  diagram: "Hub and spokes: big = the central idea; items[].label = 3-6 connected parts.",
  picture: "A Canva picture filling the screen: picture_prompt = what to draw; heading = short caption.",
  keyword: "A term and its meaning: big = the term; heading = a short definition; the scene's 3D animation shows under it.",
  demo: "The 3D animation fills the screen (a reaction, a change of state, an atom...): heading = short caption; big = optional label that appears when spoken.",
  quiz: "Quick question: heading = the question; items = 3-4 options; answer = index of the right one (0-based). The narration asks it, pauses, then says the answer.",
  recap: "Ticked list of 3-5 takeaways (items[].label).",
  outro: "Closing: heading = one-line takeaway; the narration ends with \"Follow <the channel> for more.\"",
};

const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "kicker", "thumbnail_text", "youtube_title", "youtube_description", "youtube_tags", "summary", "claims", "overlap_note", "scenes"],
  properties: {
    title: str,
    kicker: str,
    thumbnail_text: str,
    youtube_title: str,
    youtube_description: str,
    youtube_tags: { type: "array", items: str },
    summary: str,
    claims: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["claim", "confidence"], properties: { claim: str, confidence: { type: "string", enum: ["high", "medium", "low"] } } },
    },
    overlap_note: str,
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "say"],
        properties: {
          type: { type: "string", enum: [...SCENE_TYPES] },
          say: str,
          heading: str,
          big: str,
          items: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["label"], properties: { label: str, detail: str, value: str, icon: str, icon2: str } },
          },
          left_title: str,
          right_title: str,
          unit: str,
          answer: { type: "integer" },
          picture_prompt: str,
          chapter: str,
          anim: { type: "string", enum: [...ANIM_KINDS] },
          anim_subject: str,
          anim_cue: str,
          sticker: str,
        },
      },
    },
  },
} as const;

const Out = z.object({
  title: z.string(),
  kicker: z.string(),
  thumbnail_text: z.string(),
  youtube_title: z.string(),
  youtube_description: z.string(),
  youtube_tags: z.array(z.string()),
  summary: z.string(),
  claims: z.array(z.object({ claim: z.string(), confidence: z.enum(["high", "medium", "low"]) })),
  overlap_note: z.string(),
  scenes: z.array(
    z.object({
      type: z.string(),
      say: z.string(),
      heading: z.string().optional(),
      big: z.string().optional(),
      items: z.array(z.object({ label: z.string(), detail: z.string().optional(), value: z.string().optional(), icon: z.string().optional(), icon2: z.string().optional() })).optional(),
      left_title: z.string().optional(),
      right_title: z.string().optional(),
      unit: z.string().optional(),
      answer: z.number().int().optional(),
      picture_prompt: z.string().optional(),
      chapter: z.string().optional(),
      visual: z.string().optional(),
      anim: z.string().optional(),
      anim_subject: z.string().optional(),
      anim_cue: z.string().optional(),
      sticker: z.string().optional(),
    }),
  ),
});

const LENGTH: Record<VideoFormat, string> = {
  short:
    "A YouTube Short, vertical, under 60 seconds: 7 to 10 scenes and 115 to 145 words of narration in total (never more than 150). One clear idea, explained fast. At most 2 picture scenes. No chapters (leave chapter empty).",
  long:
    "A normal (horizontal) YouTube video of 3 to 6 minutes: 16 to 32 scenes and 480 to 900 words of narration in total. Organise it in 3 to 7 chapters: set `chapter` (2-5 words) on the first scene of each chapter, the very first scene included; every chapter must last at least 20 seconds. At most 5 picture scenes.",
};

// The instructions live in a file Rahul edits: src/Edu videos/prompts/script-instructions.md
// (read on every script, so an edit applies to the next one). <!-- comments --> are left out;
// {{SCENE_TYPES}} becomes the engine's scene types, {{CHANNEL}} the channel's name.
export const INSTRUCTIONS_FILE = path.join(process.cwd(), "src", "Edu videos", "prompts", "script-instructions.md");

/** The instructions from the file, with the scene types filled in ({{CHANNEL}} stays for later). */
export function builtInInstructions(): string {
  let text: string;
  try {
    text = fs.readFileSync(INSTRUCTIONS_FILE, "utf8").replace(/^\uFEFF/, "");
  } catch {
    throw new UserError(`The script instructions file is missing: ${INSTRUCTIONS_FILE}`);
  }
  text = text.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new UserError(`The script instructions file is empty: ${INSTRUCTIONS_FILE}`);
  return text.replaceAll("{{SCENE_TYPES}}", SCENE_TYPES.map((t) => `- ${t}: ${SCENE_HELP[t]}`).join("\n"));
}

/** About how long the narration takes: ~2.9 spoken words a second plus the pause between scenes. */
export function estimateSeconds(scenes: Pick<Scene, "say">[]) {
  const words = scenes.reduce((n, s) => n + s.say.split(/\s+/).filter(Boolean).length, 0);
  return Math.round(words / 2.9 + scenes.length * 0.75);
}

// On-screen text: the engine's font has Latin letters and common punctuation; anything else (emoji) is dropped
const screen = (s: string | undefined, n: number) =>
  (s ?? "")
    .replace(/[^\p{Script=Latin}\p{N}\s.,:;!?'"’‘“”()\-–—%&+/°×=<>#@$€£₹*]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const spoken = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 900);

/** Cleans Claude's (or Rahul's edited) scenes: known types, limits, a title first and an outro last. */
export function normaliseScenes(raw: z.infer<typeof Out>["scenes"], format: VideoFormat): Scene[] {
  const long = format === "long";
  const scenes: Scene[] = raw
    .filter((s) => s.say?.trim())
    .map((s) => {
      const type = (SCENE_TYPES as readonly string[]).includes(s.type) ? (s.type as SceneType) : "keyword";
      const items = (s.items ?? [])
        .map((it) => ({
          label: screen(it.label, 60),
          detail: screen(it.detail, 100) || undefined,
          value: screen(it.value, 24) || undefined,
          icon: cleanIcon(it.icon) || undefined,
          icon2: cleanIcon(it.icon2) || undefined,
        }))
        .filter((it) => it.label || it.detail)
        .slice(0, 6);
      const sc: Scene = { type, say: spoken(s.say) };
      const h = screen(s.heading, long ? 70 : 60);
      if (h) sc.heading = h;
      const b = screen(s.big, 40);
      if (b) sc.big = b;
      if (items.length) sc.items = items;
      if (s.left_title) sc.left_title = screen(s.left_title, 24);
      if (s.right_title) sc.right_title = screen(s.right_title, 24);
      if (s.unit) sc.unit = screen(s.unit, 12);
      if (type === "quiz") sc.answer = Math.min(Math.max(0, s.answer ?? 0), Math.max(0, items.length - 1));
      if (type === "picture") sc.picture_prompt = (s.picture_prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || `A simple, colourful picture about: ${sc.heading ?? sc.say}. No text, no logos.`;
      if (long && s.chapter?.trim()) sc.chapter = screen(s.chapter, 50);
      const visual = (VISUAL_MODES as readonly string[]).includes(s.visual ?? "") ? (s.visual as VisualMode) : "animation";
      if (visual !== "animation") sc.visual = visual;
      if (s.anim && (ANIM_KINDS as readonly string[]).includes(s.anim)) {
        const subj = cleanSubject(s.anim_subject);
        if (subj) {
          sc.anim = s.anim as AnimKind;
          sc.anim_subject = subj;
        }
      }
      const cue = (s.anim_cue ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (cue && sc.anim) sc.anim_cue = cue;
      const st = cleanSticker(s.sticker);
      if (st) sc.sticker = st;
      return sc;
    });
  if (!scenes.length) throw new UserError("The script has no scenes.");
  if (scenes[0]!.type !== "title") scenes[0] = { ...scenes[0]!, type: "title", heading: scenes[0]!.heading };
  if (scenes.at(-1)!.type !== "outro") scenes[scenes.length - 1] = { ...scenes.at(-1)!, type: "outro" };
  if (long && !scenes[0]!.chapter) scenes[0]!.chapter = "Introduction";
  return scenes;
}

/** Earlier videos (titles + summaries) Claude must not repeat. */
function history(except: string) {
  return listRows()
    .filter((r) => r.id !== except && r.title && r.status !== "rejected" && r.status !== "queued")
    .map((r) => `- ${r.title}${r.summary ? `: ${r.summary}` : ""}`)
    .slice(-250);
}

export const draftPath = (id: string) => path.join(itemDir(id), "draft.json");
export const getDraft = (id: string) => readJson<Draft>(draftPath(id));
export function saveDraft(id: string, d: Draft) {
  writeJson(draftPath(id), d);
}

// ------------------------------- the prompt (editable) -------------------------------
// Two parts: the INSTRUCTIONS (the same for every video; {{CHANNEL}} = the channel's name) and the
// TOPIC MESSAGE (built from the topic's row and the list of earlier videos). Rahul can edit both on
// a script's review page and regenerate; he can also save edited instructions as the new default
// for every future script (EDU_HOME\prompt.json; "reset" goes back to the instructions file).

const CUSTOM_INSTRUCTIONS = () => path.join(EDU_HOME, "prompt.json");
export const MAX_INSTRUCTIONS = 30_000;
export const MAX_MESSAGE = 30_000;

/** The instructions used for new scripts: Rahul's saved version, else the built-in one. */
export function getInstructions(): { text: string; custom: boolean; savedAt?: string } {
  const c = readJson<{ text: string; savedAt: string }>(CUSTOM_INSTRUCTIONS());
  return c?.text?.trim() ? { text: c.text, custom: true, savedAt: c.savedAt } : { text: builtInInstructions(), custom: false };
}
/** Saves new default instructions (null: back to the built-in ones). */
export function saveInstructions(text: string | null) {
  if (text === null || text.trim() === builtInInstructions().trim()) fs.rmSync(CUSTOM_INSTRUCTIONS(), { force: true });
  else writeJson(CUSTOM_INSTRUCTIONS(), { text, savedAt: new Date().toISOString() });
}

/** Fills in the channel's name, or channel-free wording while the channel has no name yet. */
export function renderInstructions(text: string, channel: string | null) {
  // the visual rules (kinds, sticker names) come from the engine; a saved prompt without the placeholder still gets them
  text = text.includes("{{VISUALS}}") ? text.replaceAll("{{VISUALS}}", visualRules()) : `${text}\n\n${visualRules()}`;
  if (channel) return text.replaceAll("{{CHANNEL}}", channel);
  return text
    .replace("for {{CHANNEL}}, a family-friendly", "for a family-friendly")
    .replace('ends with "Follow {{CHANNEL}} for more."', 'ends with "Subscribe for more explainers." (never name a channel)')
    .replace('"Subscribe to {{CHANNEL}} for more explainers!"', '"Subscribe for more explainers!" (never name a channel)')
    .replaceAll("{{CHANNEL}}", "this channel");
}

/** The topic message for a row, as it would be sent now. */
export function topicMessage(row: TopicRow) {
  const past = history(row.id);
  const previous = getDraft(row.id);
  return [
    `Topic: ${row.topic}`,
    `Video: ${LENGTH[row.format]}`,
    row.audience ? `Audience: ${row.audience}` : "Audience: general (students and adults)",
    row.notes ? `Rahul's notes: ${row.notes}` : "",
    row.mustInclude ? `Must include: ${row.mustInclude}` : "",
    row.rewriteNote && previous ? `This is a rewrite. The previous script's title was "${previous.title}". Rahul asks: ${row.rewriteNote}` : "",
    past.length ? `\nThe channel's earlier explainer videos (do not repeat their content):\n${past.join("\n")}` : "\nThe channel has no earlier explainer videos yet.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export type PromptUsed = { instructions: string; message: string; at: string; edited?: boolean };
const promptPath = (id: string) => path.join(itemDir(id), "prompt.json");
/** The prompt the row's current script was written with (instructions still with {{CHANNEL}}). */
export const getPromptUsed = (id: string) => readJson<PromptUsed>(promptPath(id));

/** Asks Claude for the script of one topic row and saves it as the row's draft. `prompt` replaces either part (Rahul's edits). */
export async function writeScript(row: TopicRow, prompt?: { instructions?: string; message?: string }): Promise<Draft> {
  const s = getSettings();
  const channel = channelName(); // none yet: the ending says "Subscribe for more" instead of naming the channel
  const previous = getDraft(row.id);
  const instructions = prompt?.instructions?.trim() ? prompt.instructions : getInstructions().text;
  const user = prompt?.message?.trim() ? prompt.message : topicMessage(row);
  const text = await askClaude(renderInstructions(instructions, channel), user, SCHEMA, row.format === "long" ? 32000 : 16000, "No Claude API key yet: add it on Edu videos → Settings.");
  let out: z.infer<typeof Out>;
  try {
    out = Out.parse(JSON.parse(text));
  } catch {
    throw new UserError("Claude's answer couldn't be read. Try again.");
  }
  const draft: Draft = {
    title: screen(out.title, 80) || row.topic,
    kicker: screen(out.kicker, 28).toUpperCase() || s.defaultKicker,
    thumbnail_text: screen(out.thumbnail_text, 50) || screen(out.title, 50),
    youtube_title: out.youtube_title.replace(/\s+/g, " ").trim().slice(0, 95),
    youtube_description: out.youtube_description.replace(/\r\n?/g, "\n").trim().slice(0, 4300),
    youtube_tags: out.youtube_tags.map((t) => t.replace(/[#<>]/g, "").trim().toLowerCase()).filter(Boolean).slice(0, 20),
    summary: out.summary.replace(/\s+/g, " ").trim().slice(0, 300),
    claims: out.claims.slice(0, 40),
    overlap_note: out.overlap_note.trim().slice(0, 500),
    scenes: normaliseScenes(out.scenes, row.format),
    format: row.format,
    voice: previous?.voice || nextVoice(), // a rewrite keeps its narrator
    writtenAt: new Date().toISOString(),
  };
  fs.mkdirSync(itemDir(row.id), { recursive: true });
  saveDraft(row.id, draft);
  writeJson(promptPath(row.id), { instructions, message: user, at: draft.writtenAt, edited: !!(prompt?.instructions?.trim() || prompt?.message?.trim()) } satisfies PromptUsed);
  return draft;
}

// ------------------------------- 3D visuals for an existing script -------------------------------
// Scripts written before the visuals existed (or that Rahul wants redone) get them from Claude
// without touching a word of the narration or the on-screen text.

const VIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "sticker"],
        properties: {
          index: { type: "integer" },
          anim: { type: "string", enum: [...ANIM_KINDS] },
          anim_subject: str,
          anim_cue: str,
          sticker: str,
          icons: { type: "array", items: str },
          icons2: { type: "array", items: str },
        },
      },
    },
  },
} as const;
const VisOut = z.object({
  scenes: z.array(
    z.object({
      index: z.number().int(),
      anim: z.string().optional(),
      anim_subject: z.string().optional(),
      anim_cue: z.string().optional(),
      sticker: z.string().optional(),
      icons: z.array(z.string()).optional(),
      icons2: z.array(z.string()).optional(),
    }),
  ),
});

/** The prompt "Add 3D visuals" sends for a script (system + user message). */
export function visualsPrompt(d: Draft, format: VideoFormat) {
  const system = `You add the 3D visuals to an animated explainer video's script. The script is final: do NOT change any narration or on-screen text. For each scene (by its index) return its visual fields.

Scene types and where visuals show:
${SCENE_TYPES.map((t) => `- ${t}: ${SCENE_HELP[t]}`).join("\n")}

${visualRules()}

Return one entry per scene, same order: anim + anim_subject + anim_cue where an animation fits (title, keyword, stat, demo, and bullets/steps/recap with up to 3 items), sticker always, and icons = one icon per item of the scene in the same order (quiz options too), icons2 = the right-hand icons of a compare scene. Animations must show exactly what that scene's narration says, scientifically correct.`;
  const user = JSON.stringify(
    d.scenes.map((s, index) => ({ index, type: s.type, say: s.say, heading: s.heading, big: s.big, items: s.items?.map((it) => [it.label, it.detail].filter(Boolean).join(": ")) })),
    null,
    1,
  );
  return { system, user: `Topic: ${d.title}\nFormat: ${format}\n\nScenes:\n${user}` };
}

/** Asks Claude to add the 3D visuals (animations, stickers, item icons) to a row's script; the text stays as it is. */
export async function addVisuals(id: string, format: VideoFormat): Promise<Draft> {
  const d = getDraft(id);
  if (!d) throw new UserError("The script is missing.");
  const { system, user } = visualsPrompt(d, format);
  const text = await askClaude(system, user, VIS_SCHEMA, 12000, "No Claude API key yet: add it on Edu videos → Settings.");
  let out: z.infer<typeof VisOut>;
  try {
    out = VisOut.parse(JSON.parse(text));
  } catch {
    throw new UserError("Claude's answer couldn't be read. Try again.");
  }
  const byIndex = new Map(out.scenes.map((v) => [v.index, v]));
  const scenes = normaliseScenes(
    d.scenes.map((s, i) => {
      const v = byIndex.get(i);
      if (!v) return s;
      return {
        ...s,
        anim: v.anim,
        anim_subject: v.anim_subject,
        anim_cue: v.anim_cue,
        sticker: v.sticker,
        items: s.items?.map((it, k) => ({ ...it, icon: v.icons?.[k] ?? it.icon, icon2: v.icons2?.[k] ?? it.icon2 })),
      };
    }),
    format,
  );
  const next: Draft = { ...d, scenes, editedAt: new Date().toISOString() };
  saveDraft(id, next);
  return next;
}
