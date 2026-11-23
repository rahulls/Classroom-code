// Chaos Creators: "Did you know?" facts videos. Shared by the browser (studio, recording deck) and
// the server, and kept in step with load_facts() in "src/Chaos creators/engine/facts_video.py".
//
// A facts CSV has the same optional settings lines as a quiz CSV (csv.ts), plus "Video type,facts"
// and "Narration,ai|record", then the header and one fact per row:
//   headline   the fact itself, shown big (required), e.g. "Octopuses have three hearts"
//   detail     one more sentence, shown smaller under it (optional)
//   narration  what is read out, when it should differ from headline + detail (optional)
//   seconds    time on screen (optional; normally the narration's length + 1 s, kept within 5-10 s)
//   image      a picture in src\Chaos creators\images for this fact's sticker (optional; else Canva art)

import { IMAGE_NAME_RE, parseCsvRows, parseSettingsLines, type CsvIssue, type QuizSettings, type VideoFormat } from "./csv";

export const FACT_COLUMNS = ["headline", "detail", "narration", "seconds", "image"] as const;
export const MAX_FACTS = 120;
export const FACT_MIN_SECONDS = 5;
export const FACT_MAX_SECONDS = 10;
/** Fact counts offered in the studio ("First N"), by format */
export const FACT_COUNTS: Record<VideoFormat, number[]> = { shorts: [5, 8, 10], youtube: [20, 30, 50] };
/** Fact counts "Make facts with Claude" offers */
export const GENERATE_FACT_COUNTS = [5, 8, 10, 15, 20, 30, 50] as const;
export const DEFAULT_FACT_BADGE = "DID YOU KNOW?";

export type FactItem = {
  /** Spreadsheet row number (header = 1) */
  row: number;
  headline: string;
  detail: string;
  /** Spoken text when it differs from headline + detail ("" = read headline + detail) */
  narration: string;
  /** null = automatic (narration length + 1 s, 5-10 s) */
  seconds: number | null;
  /** Sticker picture from the images folder ("" = Canva art or none) */
  image: string;
};

export type ParsedFacts = { facts: FactItem[]; issues: CsvIssue[]; missingColumns: string[]; settings: QuizSettings };

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const norm = (h: string | undefined) => clean(h).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const ALIASES: Record<string, (typeof FACT_COLUMNS)[number]> = {
  headline: "headline",
  fact: "headline",
  facts: "headline",
  did_you_know: "headline",
  detail: "detail",
  details: "detail",
  explanation: "detail",
  more: "detail",
  narration: "narration",
  spoken: "narration",
  spoken_text: "narration",
  say: "narration",
  voice: "narration",
  seconds: "seconds",
  time: "seconds",
  image: "image",
  sticker: "image",
  picture: "image",
  photo: "image",
};

/** Index of the facts header row: the first row that starts with a column name and names a headline
 *  column (and no quiz "question"). Settings lines start with their own name, e.g. "YouTube tags,did you know,...". */
function headerRow(rows: string[][]) {
  return rows.findIndex((r) => {
    const cells = r.map(norm);
    return !!ALIASES[cells[0] ?? ""] && !cells.includes("question") && cells.some((c) => ALIASES[c] === "headline");
  });
}

/** "facts" for a facts CSV ("Video type,facts" or a headline column), "quiz" for a questions CSV, null when it's neither. */
export function detectCsvType(text: string): "quiz" | "facts" | null {
  const rows = parseCsvRows(text);
  const typeLine = rows.find((r) => /^(video ?type|type)$/i.test(clean(r[0])));
  const t = clean(typeLine?.[1]).toLowerCase();
  if (/fact|did ?you ?know|trivia/.test(t)) return "facts";
  if (rows.some((r) => r.map(norm).includes("question"))) return "quiz";
  if (headerRow(rows) >= 0) return "facts";
  return null;
}

/** What is read out for a fact: its narration, else headline and detail as two sentences. */
export function spokenText(f: Pick<FactItem, "headline" | "detail" | "narration">) {
  if (f.narration.trim()) return f.narration.trim();
  const end = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);
  return [f.headline, f.detail].map((s) => s.trim()).filter(Boolean).map(end).join(" ");
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Rough reading time of a text (the AI voice and most readers manage about 2.6 words a second). */
export const readSeconds = (text: string) => Math.max(1.2, words(text) / 2.6);

/** Time a fact stays on screen: its seconds, else the reading time + 1 s, within 5-10 s. */
export function factSeconds(f: Pick<FactItem, "headline" | "detail" | "narration" | "seconds">, spoken?: number) {
  const talk = spoken ?? readSeconds(spokenText(f));
  if (f.seconds) return Math.max(f.seconds, talk + 0.6);
  return Math.max(Math.min(FACT_MAX_SECONDS, Math.max(FACT_MIN_SECONDS, talk + 1)), talk + 0.8);
}

/** Rough length of the finished facts video (matches facts_video.py's timeline). */
export function estimateFactsSeconds(facts: FactItem[], format: VideoFormat, middles = 0) {
  const intro = 7.5;
  const outro = format === "youtube" ? 11 : 7.5;
  return intro + outro + middles * 2.4 + facts.reduce((t, f) => t + 0.6 + factSeconds(f), 0);
}

export function parseFactsCsv(text: string): ParsedFacts {
  const rows = parseCsvRows(text);
  const issues: CsvIssue[] = [];
  const facts: FactItem[] = [];
  if (!rows.length) return { facts, issues: [{ row: 0, message: "The file is empty.", level: "error" }], missingColumns: ["headline"], settings: {} };
  const h0 = headerRow(rows);
  if (h0 < 0) {
    const quiz = rows.some((r) => r.map(norm).includes("question"));
    return {
      facts,
      issues: [{ row: 0, message: quiz ? "This is a quiz questions CSV. Use it on the Quiz video tab." : "No header row with a headline column (headline, detail, narration, seconds, image).", level: "error" }],
      missingColumns: ["headline"],
      settings: parseSettingsLines(rows, 0, issues),
    };
  }
  const settings = parseSettingsLines(rows, h0, issues);
  const header = rows[h0]!.map((h) => ALIASES[norm(h)] ?? null);
  const col = (name: (typeof FACT_COLUMNS)[number]) => header.indexOf(name);
  const seen = new Set<string>();
  for (let r = h0 + 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const get = (name: (typeof FACT_COLUMNS)[number]) => (col(name) >= 0 ? clean(cells[col(name)]) : "");
    const rowNo = r + 1;
    const headline = get("headline");
    if (!headline) {
      if (cells.some((c) => clean(c))) issues.push({ row: rowNo, message: "No headline: row skipped.", level: "warning" });
      continue;
    }
    const detail = get("detail");
    const narration = get("narration");
    const rawSecs = get("seconds");
    let seconds: number | null = null;
    if (rawSecs) {
      if (/^\d+$/.test(rawSecs) && Number(rawSecs) >= 3 && Number(rawSecs) <= 20) {
        seconds = Number(rawSecs);
        if (seconds < FACT_MIN_SECONDS || seconds > FACT_MAX_SECONDS) issues.push({ row: rowNo, message: `${seconds} seconds: facts work best at 5 to 10 seconds.`, level: "warning" });
      } else {
        issues.push({ row: rowNo, message: `seconds must be a whole number from 3 to 20 (got "${rawSecs}")`, level: "error" });
        continue;
      }
    }
    const image = get("image");
    if (image && !IMAGE_NAME_RE.test(image)) issues.push({ row: rowNo, message: `image must be a .jpg, .png or .webp file name from the images folder (got "${image}"): ignored.`, level: "warning" });
    const key = headline.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) issues.push({ row: rowNo, message: "Same headline as an earlier fact.", level: "warning" });
    seen.add(key);
    const f: FactItem = { row: rowNo, headline, detail, narration, seconds, image: image && IMAGE_NAME_RE.test(image) ? image : "" };
    if (headline.length > 90) issues.push({ row: rowNo, message: "Long headline: the text will be made smaller to fit.", level: "warning" });
    if (detail.length > 170) issues.push({ row: rowNo, message: "Long detail: only the first lines are shown.", level: "warning" });
    const talk = readSeconds(spokenText(f));
    if (talk > FACT_MAX_SECONDS) issues.push({ row: rowNo, message: `About ${Math.round(talk)} seconds to read: the fact stays on screen longer than 10 seconds. Shorten it if you can.`, level: "warning" });
    facts.push(f);
  }
  if (!facts.length && !issues.some((i) => i.level === "error")) issues.push({ row: 0, message: "No facts found.", level: "error" });
  if (facts.length > MAX_FACTS) issues.push({ row: 0, message: `At most ${MAX_FACTS} facts per video (this file has ${facts.length}).`, level: "error" });
  return { facts, issues, missingColumns: [], settings };
}

// ------------------------------ recording deck ------------------------------

/** A line the reader records between facts ("Halfway there…"), said before fact `before` (0-based). */
export type MiddleCard = { key: string; before: number; text: string };
/** The reader's own intro or ending (optional cards; without a recording the kid voice or AI does it). */
export type SpokenCard = { key: string; text: string };

const FACT_WORDS = new Set(["fact", "facts", "did", "you", "know", "amazing", "fun", "trivia", "crazy", "mind-blowing"]);
/** Badge words kept in capitals (badges are written in capitals, so short words alone can't tell). Same list in facts_video.py. */
const ACRONYMS = new Set(["GK", "AI", "DNA", "NASA", "ISRO", "IPL", "GTA", "USA", "UK", "UAE", "FIFA", "NBA", "WWE", "ICC", "BCCI", "F1", "UN"]);

/** "human body" from the badge "HUMAN BODY FACTS" ("" when it holds no topic word). Same as facts_topic() in facts_video.py. */
export function factsTopic(badge: string | undefined) {
  return (badge ?? "")
    .split(/\s+/)
    .filter((w) => w && !FACT_WORDS.has(w.toLowerCase().replace(/[?!.,]/g, "")))
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w === w.toUpperCase() ? w.toLowerCase() : w))
    .join(" ");
}

/** Suggested words for the reader's intro and ending cards (editable in the deck). */
export function introOutroCards(n: number, badge?: string): { intro: SpokenCard; outro: SpokenCard } {
  const topic = factsTopic(badge);
  return {
    intro: { key: "i1", text: `Hey everyone, welcome to Chaos Creators! Here are ${n} amazing ${topic ? `${topic} ` : ""}facts that you probably didn't know. Let's go!` },
    outro: { key: "o1", text: "Which fact surprised you the most? Tell us in the comments, and subscribe to Chaos Creators for more amazing facts. Bye!" },
  };
}

const MIDDLE_TEXTS = {
  short: ["Wait till you hear this one!", "Okay, this next one is crazy!", "This one surprised me!"],
  halfway: ["We're halfway there, and the best ones are still coming!", "Halfway there! Keep watching!"],
  almost: ["Almost done, but don't skip the last ones!", "Just a few more, and they're good ones!"],
  generic: ["Wait till you hear this one!", "Okay, this one blew my mind!", "Keep watching, it gets better!", "This next one is crazy!", "Did you know this one?"],
};

/** Simple seeded random (same seed, same picks). */
function rand(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Where the reader's middle lines go, with suggested words (editable in the deck). Same rule as the
 * kid lines in quiz videos: a Short gets one line before fact 3 or 4; a long video gets "halfway",
 * "almost done" and a line about every 5 facts.
 */
export function planMiddleCards(n: number, format: VideoFormat, seed: string): MiddleCard[] {
  const r = rand(seed);
  const pick = (list: string[]) => list[Math.floor(r() * list.length)]!;
  if (n < 4) return [];
  const plan = new Map<number, string>();
  if (format === "shorts") plan.set(r() < 0.5 ? 2 : 3, pick(MIDDLE_TEXTS.short));
  else {
    plan.set(Math.floor(n / 2), pick(MIDDLE_TEXTS.halfway));
    if (n >= 8) plan.set(n - 2, pick(MIDDLE_TEXTS.almost));
    const generic = [...MIDDLE_TEXTS.generic].sort(() => r() - 0.5);
    for (let i = 5; i < n - 2; i += 5) if ([...plan.keys()].every((k) => Math.abs(i - k) >= 3)) plan.set(i, generic[plan.size % generic.length]!);
  }
  return [...plan.entries()]
    .filter(([i]) => i > 0 && i < n)
    .sort((a, b) => a[0] - b[0])
    .map(([before, text], k) => ({ key: `m${k + 1}`, before, text }));
}

/** A ready-to-fill facts CSV. */
export const SAMPLE_FACTS_CSV = `Video type,facts
Video name,Space Facts 1
Badge on every fact,SPACE FACTS
Intro tag,DID YOU KNOW?
Intro title line 1,Space
Intro title line 2,Facts
Music mood,epic
Kid voice,on
Narration,ai
YouTube title,Space Facts You Didn't Know: 5 Mind-Blowing Facts #shorts
YouTube description,"Space facts that sound made up but are 100% true! 5 mind-blowing facts about planets, stars and the Moon.

Which fact surprised you the most? Comment below 👇 and subscribe to Chaos Creators for more amazing facts.

#spacefacts #didyouknow #facts #space #shorts"
YouTube tags,space facts,did you know,amazing facts,facts about space,planet facts,science facts,fun facts,chaos creators
YouTube category,Science & Technology

headline,detail,narration,seconds,image
A day on Venus is longer than its year,Venus spins so slowly that it goes round the Sun before it turns once.,,,
Footprints on the Moon can last for millions of years,There is no wind or rain there to wipe them away.,,,
The Sun makes up 99.8% of the Solar System's mass,Everything else put together is just 0.2%.,,,
Saturn would float in a giant bathtub,It is less dense than water.,,,
One million Earths could fit inside the Sun,And the Sun is only a medium-sized star.,,,
`;
