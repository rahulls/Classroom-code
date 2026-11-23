import "server-only";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { UserError } from "@/core/action";
import { decrypt, encrypt } from "@/core/crypto";
import { MUSIC_MOODS, YT_CATEGORIES, YT_TITLE_MAX, categoryId, parseTags, type Difficulty } from "./csv";
import { CHAOS_HOME } from "./jobs";
import { recordClaude, usageFor } from "./usage";

// Chaos Creators: writing a questions CSV with Claude from a topic, a count and a difficulty.
// The Claude API key is kept encrypted in %LOCALAPPDATA%\RSC Classroom\chaos\claude.json
// (outside OneDrive). ANTHROPIC_API_KEY in .env, when set, is used instead.

const FILE = path.join(CHAOS_HOME, "claude.json");
const P_KEY = "chaos.claude.apiKey";
const MODEL = "claude-opus-5-5";

function storedKey(): string | null {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8")) as { apiKey?: string };
    return s.apiKey ? decrypt(s.apiKey, P_KEY) : null;
  } catch {
    return null;
  }
}

/** Whether a key is available, and from where (never the key itself). */
export function claudeKeyStatus(): { ok: boolean; from?: "env" | "saved" } {
  if (process.env.ANTHROPIC_API_KEY) return { ok: true, from: "env" };
  return storedKey() ? { ok: true, from: "saved" } : { ok: false };
}

export function saveClaudeKey(key: string) {
  fs.mkdirSync(CHAOS_HOME, { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify({ apiKey: encrypt(key, P_KEY) }), "utf8");
  fs.renameSync(FILE + ".tmp", FILE);
}

const Out = z.object({
  video_name: z.string(),
  badge: z.string(),
  intro_title_line_1: z.string(),
  intro_title_line_2: z.string(),
  music_mood: z.string(),
  ranks: z.array(z.string()),
  youtube_title: z.string(),
  youtube_description: z.string(),
  youtube_tags: z.array(z.string()),
  youtube_category: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      option_a: z.string(),
      option_b: z.string(),
      option_c: z.string(),
      option_d: z.string(),
      answer: z.enum(["A", "B", "C", "D"]),
      fact: z.string(),
    }),
  ),
});

const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["video_name", "badge", "intro_title_line_1", "intro_title_line_2", "music_mood", "ranks", "youtube_title", "youtube_description", "youtube_tags", "youtube_category", "questions"],
  properties: {
    video_name: str,
    badge: str,
    intro_title_line_1: str,
    intro_title_line_2: str,
    music_mood: { type: "string", enum: ["upbeat", "epic", "suspense"] },
    ranks: { type: "array", items: str },
    youtube_title: str,
    youtube_description: str,
    youtube_tags: { type: "array", items: str },
    youtube_category: { type: "string", enum: YT_CATEGORIES.map((c) => c.name) },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "option_a", "option_b", "option_c", "option_d", "answer", "fact"],
        properties: {
          question: str,
          option_a: str,
          option_b: str,
          option_c: str,
          option_d: str,
          answer: { type: "string", enum: ["A", "B", "C", "D"] },
          fact: str,
        },
      },
    },
  },
} as const;

const LEVEL: Record<Difficulty, string> = {
  easy: "Easy: facts most school students know. Clear, familiar wording.",
  medium: "Medium: a good general quiz. Most viewers should get about half right.",
  hard: "Hard: for quiz enthusiasts. Less obvious facts, but still fair and checkable, never trick questions.",
  mixed: "Mixed: start easy and get steadily harder, so the last fifth of the questions are hard.",
};

const SYSTEM = `You write multiple-choice quiz questions for a family-friendly YouTube quiz channel, Chaos Creators. Viewers are mostly in India, from school students to adults.

Every question is read on screen with a short timer, so:
- Question: one clear sentence, at most 150 characters. No "Which of the following".
- Four options, each at most 35 characters, all plausible and of the same kind (all cities, all years, ...). Exactly one is correct.
- Never use "All of the above", "None of these", "Both A and B" or options that refer to other options: the options get shuffled.
- Fact: one or two short sentences (at most 150 characters) that teach something extra about the answer. Do not just repeat the answer.
- Only use facts you are certain of and that are widely documented. Avoid anything that changes often (current office holders, records, prices, populations) unless the question says "as of" a year. When unsure, choose a different question.
- No two questions may ask the same thing. Cover the topic broadly.

Also give, for the video:
- video_name: a short name for the video, at most 60 characters, e.g. "Indian History Quiz 1".
- badge: the tag shown on every question, UPPER CASE, at most 18 characters, e.g. "HISTORY QUIZ".
- intro_title_line_1 and intro_title_line_2: the big two-line intro title, at most 14 characters each, e.g. "Indian" / "History".
- music_mood: upbeat (fun, light topics), epic (history, space, sport, mythology) or suspense (mysteries, hard quizzes).
- ranks: exactly 5 rank titles from the lowest score to the highest, themed to the topic, each at most 18 characters, fun and never insulting. For a science quiz, for example: "Curious Kid", "Lab Assistant", "Young Scientist", "Science Whiz", "Einstein Level".
- youtube_title: an SEO-friendly YouTube title, 45 to 70 characters (never over 95). Put the main search words first (the topic plus "Quiz"), then a short punch line that dares the viewer, e.g. "Solar System Quiz: Only 1 in 10 Gets All 10 Right! 🚀". At most one emoji. No clickbait that the video doesn't deliver.
- youtube_description: 600 to 1200 characters, plain text with line breaks. Line 1 repeats the main keywords naturally in a hook sentence. Then 2 or 3 short lines about what the quiz covers (using words people search for), the number of questions and "Comment your score below 👇", "Subscribe to Chaos Creators for a new quiz every day". End with one line of 4 to 6 relevant hashtags (#quiz plus topic hashtags). Don't list the answers. Don't mention music.
- youtube_tags: 12 to 18 tags people actually search for, most specific first: the topic, "<topic> quiz", related names and terms, then general ones (quiz, gk quiz, general knowledge, trivia). Lower case, no # signs, all together under 450 characters.
- youtube_category: the YouTube category that fits the topic best: Sports for sport and sportspeople, Science & Technology for science, space and tech, Entertainment for films, music and celebrities, News & Politics for current affairs, Education for school subjects, general knowledge, history and geography.`;

/** Calls Claude and returns a ready-to-upload questions CSV (settings lines + questions). */
export async function generateQuizCsv(input: { topic: string; count: number; difficulty: Difficulty }): Promise<{ csv: string; questions: number; fileName: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || storedKey();
  if (!apiKey) throw new UserError("Add your Claude API key first (below the Make questions button).");
  const client = new Anthropic({ apiKey, timeout: 10 * 60 * 1000 });

  let message;
  const t0 = Date.now();
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Topic: ${input.topic}\nNumber of questions: ${input.count}\nDifficulty: ${LEVEL[input.difficulty]}\n\nWrite exactly ${input.count} questions.`,
        },
      ],
    });
    const done = await stream.finalMessage();
    message = done;
    void usageFor("Chaos studio", async () => recordClaude("questions CSV", t0, done));
  } catch (err) {
    void usageFor("Chaos studio", async () => recordClaude("questions CSV", t0, null, err));
    if (err instanceof Anthropic.AuthenticationError) throw new UserError("Claude didn't accept the API key. Check it and save it again.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new UserError("This Claude API key isn't allowed to use the model. Check your Claude Console account.");
    if (err instanceof Anthropic.RateLimitError) throw new UserError("Claude is busy or your account's limit was reached. Try again in a minute.");
    if (err instanceof Anthropic.APIConnectionError) throw new UserError("Couldn't reach Claude. Check the internet connection.");
    if (err instanceof Anthropic.APIError) {
      console.error("[chaos.generate]", err.status, err.message);
      throw new UserError(err.status === 400 && /credit|balance|billing/i.test(err.message) ? "Your Claude account has no credit left. Add credit in the Claude Console." : `Claude returned an error (${err.status}). Try again.`);
    }
    throw err;
  }
  if (message.stop_reason === "refusal") throw new UserError("Claude declined this topic. Try wording it differently.");
  if (message.stop_reason === "max_tokens") throw new UserError("The answer was cut off. Ask for fewer questions.");
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let out: z.infer<typeof Out>;
  try {
    out = Out.parse(JSON.parse(text));
  } catch {
    throw new UserError("Claude's answer couldn't be read. Try again.");
  }
  return buildCsv(out, input.count);
}

const cut = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n).trim();
const cell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The CSV the studio reads. Answers are re-shuffled so the correct letter is spread evenly. */
function buildCsv(out: z.infer<typeof Out>, want: number) {
  const seen = new Set<string>();
  const rows: string[] = [];
  // A, B, C, D in a shuffled cycle: about a quarter of the answers each, in no fixed pattern
  let slots: number[] = [];
  for (const q of out.questions) {
    const key = q.question.toLowerCase().replace(/[^a-z0-9]/g, "");
    const opts = [q.option_a, q.option_b, q.option_c, q.option_d].map((o) => cut(o, 60));
    if (!key || seen.has(key) || opts.some((o) => !o) || new Set(opts.map((o) => o.toLowerCase())).size < 4) continue;
    seen.add(key);
    const right = opts["ABCD".indexOf(q.answer)]!;
    const wrong = opts.filter((o) => o !== right).sort(() => Math.random() - 0.5);
    if (!slots.length) slots = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const at = slots.pop()!;
    wrong.splice(at, 0, right);
    rows.push([cut(q.question, 220), ...wrong, "ABCD"[at]!, cut(q.fact, 200), ""].map(cell).join(","));
    if (rows.length >= want) break;
  }
  if (!rows.length) throw new UserError("Claude's answer had no usable questions. Try again.");
  const mood = MUSIC_MOODS.some((m) => m.value === out.music_mood) ? out.music_mood : "upbeat";
  const ranks = out.ranks.map((r) => cut(r, 22)).filter(Boolean).slice(0, 6);
  const name = cut(out.video_name, 80) || "Quiz";
  const settings = [
    ["Video name", name],
    ["Badge on every question", cut(out.badge, 24).toUpperCase()],
    ["Intro tag", "TODAY'S QUIZ"],
    ["Intro title line 1", cut(out.intro_title_line_1, 24)],
    ["Intro title line 2", cut(out.intro_title_line_2, 24)],
    ["Music mood", mood],
    ["Kid voice", "on"],
    ...(ranks.length >= 2 ? [["Ranks", ...ranks]] : []),
    ...(out.youtube_title.trim() ? [["YouTube title", cut(out.youtube_title, YT_TITLE_MAX)]] : []),
    ...(out.youtube_description.trim() ? [["YouTube description", out.youtube_description.replace(/\r\n?/g, "\n").trim().slice(0, 4500)]] : []),
    ...(out.youtube_tags.length ? [["YouTube tags", parseTags(out.youtube_tags.join(",")).join(", ")]] : []),
    ["YouTube category", categoryId(out.youtube_category) ? out.youtube_category : "Education"],
  ].map((r) => r.map(cell).join(","));
  const csv = [...settings, "", "question,option_a,option_b,option_c,option_d,answer,fact,seconds", ...rows, ""].join("\n");
  const fileName = `${name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "quiz"}.csv`;
  return { csv, questions: rows.length, fileName };
}

// ------------------------- picture prompts for Canva -------------------------

const PICTURE_SYSTEM = `You write prompts for an AI image generator (Canva). Each picture becomes the full-screen background behind one multiple-choice question of a YouTube quiz video; the question card and four answer buttons are drawn on top.

For every question, write one prompt (at most 300 characters) for a vivid, cinematic picture that fits the question's theme and the quiz topic.

Hard rules:
- NEVER give away or hint at the correct answer. Assume the viewer studies the picture to find it: anything that points to one option over the others is forbidden (names, places, dates, numbers, people's gender or age when the options differ in that, landmarks, flags, team colours, logos, a picture of the answer itself). Picture the question's theme in a way that fits all four options equally.
- No text, letters, numbers, logos or watermarks in the picture: end every prompt with "No text, no logos."
- No realistic likeness of real, identifiable people (sportspeople, actors, politicians): use silhouettes, hidden faces, objects or places instead. Fictional and game characters are fine.
- Keep the middle of the picture fairly calm (the question sits there). Family-friendly.
- Vary the scenes so consecutive questions don't look alike.`;

/**
 * One Canva image prompt per question, written by Claude so no picture gives the answer away.
 * Returns null when there is no Claude key (the caller then uses plain topic artwork).
 */
export async function questionPicturePrompts(topic: string, questions: { question: string; options: string[]; answer: number }[]): Promise<string[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || storedKey();
  if (!apiKey || !questions.length) return null;
  const client = new Anthropic({ apiKey, timeout: 5 * 60 * 1000 });
  const list = questions
    .map((q, i) => `${i + 1}. ${q.question}\n   Options: ${q.options.join(" | ")}\n   Correct answer (never hint at it): ${q.options[q.answer]}`)
    .join("\n");
  const t0 = Date.now();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: { type: "object", additionalProperties: false, required: ["prompts"], properties: { prompts: { type: "array", items: { type: "string" } } } },
      },
    },
    system: PICTURE_SYSTEM,
    messages: [{ role: "user", content: `Quiz topic: ${topic}\n\nQuestions:\n${list}\n\nWrite exactly ${questions.length} prompts, in the same order.` }],
  });
  let message;
  try {
    message = await stream.finalMessage();
    recordClaude("question picture prompts", t0, message);
  } catch (err) {
    recordClaude("question picture prompts", t0, null, err);
    throw err;
  }
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") return null;
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    const prompts = z.object({ prompts: z.array(z.string()) }).parse(JSON.parse(text)).prompts;
    return prompts.length === questions.length ? prompts.map((p) => p.slice(0, 400)) : null;
  } catch {
    return null;
  }
}

// ------------------------- facts videos -------------------------

/**
 * One structured call to Claude, with the same friendly errors as the quiz generator.
 * Also used by the Edu videos module (src/modules/edu), which shares this Claude key.
 */
export async function askClaude(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  maxTokens: number,
  noKey = "Add your Claude API key first (below the Make facts button).",
  /** For the usage report: what the call is for, and (when not set by usageFor) for whom */
  track: { purpose?: string; who?: string } = {},
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY || storedKey();
  if (!apiKey) throw new UserError(noKey);
  const client = new Anthropic({ apiKey, timeout: 10 * 60 * 1000 });
  let message;
  const t0 = Date.now();
  const log = (m: { model?: string; usage?: unknown } | null, err?: unknown) => {
    const purpose = track.purpose ?? "Edu video script";
    if (track.who) void usageFor(track.who, async () => recordClaude(purpose, t0, m, err));
    else recordClaude(purpose, t0, m, err);
  };
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    });
    const done = await stream.finalMessage();
    message = done;
    log(done);
  } catch (err) {
    log(null, err);
    if (err instanceof Anthropic.AuthenticationError) throw new UserError("Claude didn't accept the API key. Check it and save it again.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new UserError("This Claude API key isn't allowed to use the model. Check your Claude Console account.");
    if (err instanceof Anthropic.RateLimitError) throw new UserError("Claude is busy or your account's limit was reached. Try again in a minute.");
    if (err instanceof Anthropic.APIConnectionError) throw new UserError("Couldn't reach Claude. Check the internet connection.");
    if (err instanceof Anthropic.APIError) {
      console.error("[chaos.generate]", err.status, err.message);
      throw new UserError(err.status === 400 && /credit|balance|billing/i.test(err.message) ? "Your Claude account has no credit left. Add credit in the Claude Console." : `Claude returned an error (${err.status}). Try again.`);
    }
    throw err;
  }
  if (message.stop_reason === "refusal") throw new UserError("Claude declined this topic. Try wording it differently.");
  if (message.stop_reason === "max_tokens") throw new UserError("The answer was cut off. Ask for fewer facts.");
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

const FactsOut = z.object({
  video_name: z.string(),
  badge: z.string(),
  intro_title_line_1: z.string(),
  intro_title_line_2: z.string(),
  music_mood: z.string(),
  youtube_title: z.string(),
  youtube_description: z.string(),
  youtube_tags: z.array(z.string()),
  youtube_category: z.string(),
  facts: z.array(z.object({ headline: z.string(), detail: z.string() })),
});

const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["video_name", "badge", "intro_title_line_1", "intro_title_line_2", "music_mood", "youtube_title", "youtube_description", "youtube_tags", "youtube_category", "facts"],
  properties: {
    video_name: str,
    badge: str,
    intro_title_line_1: str,
    intro_title_line_2: str,
    music_mood: { type: "string", enum: ["upbeat", "epic", "suspense"] },
    youtube_title: str,
    youtube_description: str,
    youtube_tags: { type: "array", items: str },
    youtube_category: { type: "string", enum: YT_CATEGORIES.map((c) => c.name) },
    facts: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["headline", "detail"], properties: { headline: str, detail: str } },
    },
  },
};

const FACTS_SYSTEM = `You write "Did you know?" facts for a family-friendly YouTube channel, Chaos Creators. Viewers are mostly in India, from school students to adults. Each fact is shown on screen and read out loud in 5 to 10 seconds.

Every fact has:
- headline: the surprising fact itself in one punchy sentence, at most 70 characters, e.g. "Octopuses have three hearts".
- detail: one short sentence that explains it or adds a twist, at most 110 characters. Headline and detail together must read aloud in under 9 seconds (about 22 words at most).

Rules:
- Only facts you are certain of and that are widely documented. No myths, no "scientists believe" guesses, nothing that changes often (records, prices, populations, office holders) unless it says "as of" a year. When unsure, choose a different fact.
- Surprising first: lead with facts that make people say "wait, really?", and keep a strong one for the end.
- No two facts about the same thing. Cover the topic broadly. Plain words, no jargon.

Also give, for the video (all SEO friendly: the main search phrase first, written the way people type it):
- video_name: at most 60 characters, starting with the topic + "Facts", e.g. "Space Facts You Didn't Know".
- badge: the tag on every fact, UPPER CASE, at most 18 characters, e.g. "SPACE FACTS".
- intro_title_line_1 and intro_title_line_2: the big two-line intro title, at most 14 characters each, e.g. "Space" / "Facts".
- music_mood: upbeat (fun, light topics), epic (history, space, giants of nature, sport) or suspense (mysteries, the deep sea, the strange).
- youtube_title: 45 to 70 characters (never over 95), the topic + "Facts" first, then a short punch line, e.g. "Space Facts That Sound Fake But Are True! 🚀". At most one emoji.
- youtube_description: 500 to 1000 characters, plain text with line breaks. The first 2 lines hold the main keywords and a hook. Then 2 or 3 short lines about what the facts cover, "Which fact surprised you the most? Comment below 👇" and "Subscribe to Chaos Creators for more amazing facts". End with one line of 4 to 6 hashtags, strongest first (#didyouknow #facts plus topic hashtags). No timestamps, no music.
- youtube_tags: 12 to 18 tags people search for, most specific first ("<topic> facts", "facts about <topic>", "did you know", related terms, then "amazing facts", "fun facts", "facts"). Lower case, no #, under 450 characters together.
- youtube_category: the YouTube category that fits best (Science & Technology for science, space and nature; Education for school topics, history and geography; Entertainment for films and celebrities; Sports for sport; Pets & Animals for animals).`;

/** Calls Claude and returns a ready-to-upload facts CSV (settings lines + facts). */
export async function generateFactsCsv(input: { topic: string; count: number }): Promise<{ csv: string; facts: number; fileName: string }> {
  const text = await askClaude(FACTS_SYSTEM, `Topic: ${input.topic}\nNumber of facts: ${input.count}\n\nWrite exactly ${input.count} facts.`, FACTS_SCHEMA, 32000, undefined, {
    purpose: "facts CSV",
    who: "Chaos studio",
  });
  let out: z.infer<typeof FactsOut>;
  try {
    out = FactsOut.parse(JSON.parse(text));
  } catch {
    throw new UserError("Claude's answer couldn't be read. Try again.");
  }
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const f of out.facts) {
    const key = f.headline.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push([cut(f.headline, 100), cut(f.detail, 180), "", "", ""].map(cell).join(","));
    if (rows.length >= input.count) break;
  }
  if (!rows.length) throw new UserError("Claude's answer had no usable facts. Try again.");
  const mood = MUSIC_MOODS.some((m) => m.value === out.music_mood) ? out.music_mood : "upbeat";
  const name = cut(out.video_name, 80) || "Amazing Facts";
  const settings = [
    ["Video type", "facts"],
    ["Video name", name],
    ["Badge on every fact", cut(out.badge, 24).toUpperCase()],
    ["Intro tag", "DID YOU KNOW?"],
    ["Intro title line 1", cut(out.intro_title_line_1, 24)],
    ["Intro title line 2", cut(out.intro_title_line_2, 24)],
    ["Music mood", mood],
    ["Kid voice", "on"],
    ["Narration", "ai"],
    ...(out.youtube_title.trim() ? [["YouTube title", cut(out.youtube_title, YT_TITLE_MAX)]] : []),
    ...(out.youtube_description.trim() ? [["YouTube description", out.youtube_description.replace(/\r\n?/g, "\n").trim().slice(0, 4500)]] : []),
    ...(out.youtube_tags.length ? [["YouTube tags", parseTags(out.youtube_tags.join(",")).join(", ")]] : []),
    ["YouTube category", categoryId(out.youtube_category) ? out.youtube_category : "Education"],
  ].map((r) => r.map(cell).join(","));
  const csv = [...settings, "", "headline,detail,narration,seconds,image", ...rows, ""].join("\n");
  const fileName = `${name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "facts"}.csv`;
  return { csv, facts: rows.length, fileName };
}

const FACT_PICTURE_SYSTEM = `You write prompts for an AI image generator (Canva) for a "Did you know?" facts video. For every fact, write two prompts (each at most 300 characters):
- background: a vivid, cinematic full-screen scene that sets the mood for the fact's subject. Text cards are drawn over the middle, so keep the middle fairly calm and the detail towards the edges.
- sticker: a bold, colourful illustration of the fact's main subject (one clear object, animal, place or idea), centred and filling the middle of the frame, on a simple plain background, like a sticker or a game icon.
Rules for both: no text, letters, numbers, logos or watermarks (end every prompt with "No text, no logos."); no realistic likeness of real, identifiable people (use silhouettes, objects or places instead); family-friendly; vary the scenes so facts that follow each other don't look alike.`;

/** Canva prompts per fact ({background, sticker}), or null without a Claude key (the caller then builds simple ones). */
export async function factPicturePrompts(topic: string, facts: { headline: string; detail: string }[]): Promise<{ background: string; sticker: string }[] | null> {
  if (!(process.env.ANTHROPIC_API_KEY || storedKey()) || !facts.length) return null;
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["pictures"],
    properties: {
      pictures: { type: "array", items: { type: "object", additionalProperties: false, required: ["background", "sticker"], properties: { background: str, sticker: str } } },
    },
  };
  const list = facts.map((f, i) => `${i + 1}. ${f.headline}${f.detail ? ` (${f.detail})` : ""}`).join("\n");
  try {
    const text = await askClaude(FACT_PICTURE_SYSTEM, `Topic: ${topic}\n\nFacts:\n${list}\n\nWrite exactly ${facts.length} pairs of prompts, in the same order.`, schema, 32000, undefined, {
      purpose: "fact picture prompts",
    });
    const pics = z.object({ pictures: z.array(z.object({ background: z.string(), sticker: z.string() })) }).parse(JSON.parse(text)).pictures;
    return pics.length === facts.length ? pics.map((p) => ({ background: p.background.slice(0, 400), sticker: p.sticker.slice(0, 400) })) : null;
  } catch (e) {
    console.error("[chaos] fact picture prompts", e);
    return null;
  }
}
