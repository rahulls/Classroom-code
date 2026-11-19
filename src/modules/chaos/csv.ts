// Chaos Creators: reading a quiz questions CSV. Shared by the browser preview and the server,
// and kept in step with load_questions() in "src/Chaos creators/engine/quiz_video.py".
// Columns: question, option_a, option_b, option_c, option_d, answer (A-D), fact, seconds
//
// Optional settings lines can come BEFORE the header row, one "name,value" per line, named like
// the studio's form fields. They fill the form as soon as the file is uploaded:
//   Video name,Maths Quiz 1
//   Badge on every question,MATHS QUIZ
//   Intro tag,TODAY'S QUIZ
//   Intro title line 1,Maths
//   Intro title line 2,Quiz
//   Seconds per question,10
//   Music mood,upbeat        (upbeat, epic, suspense, random or off)
//   Ranks,Beginner,Learner,Smart,Expert,Genius   (2-6 rank titles, lowest score first; long videos)

export const CSV_COLUMNS = ["question", "option_a", "option_b", "option_c", "option_d", "answer", "fact", "seconds"] as const;
export const MAX_QUESTIONS = 300;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export type QuizQuestion = {
  /** Spreadsheet row number (header = 1) */
  row: number;
  question: string;
  options: [string, string, string, string];
  /** 0-3 (A-D) */
  answer: number;
  fact: string;
  /** null = use the default timer */
  seconds: number | null;
};

export type CsvIssue = { row: number; message: string; level: "error" | "warning" };

/** The settings lines at the top of the CSV (only the ones it gives). */
export type QuizSettings = {
  videoName?: string;
  badge?: string;
  introTag?: string;
  titleLine1?: string;
  titleLine2?: string;
  seconds?: number;
  musicMood?: MusicMood;
  /** Rank titles from the lowest score to the highest, or ["off"] */
  ranks?: string[];
  /** What the video is published with on YouTube (editable later in the studio) */
  youtubeTitle?: string;
  youtubeDescription?: string;
  youtubeTags?: string[];
  /** YouTube category id, e.g. "17" (Sports) */
  youtubeCategory?: string;
  /** Topic photo for the thumbnail: a file in src\Chaos creators\images */
  thumbnailImage?: string;
};

/** YouTube's video categories (the ones open to uploads). */
export const YT_CATEGORIES = [
  { id: "27", name: "Education" },
  { id: "24", name: "Entertainment" },
  { id: "17", name: "Sports" },
  { id: "28", name: "Science & Technology" },
  { id: "25", name: "News & Politics" },
  { id: "22", name: "People & Blogs" },
  { id: "23", name: "Comedy" },
  { id: "20", name: "Gaming" },
  { id: "1", name: "Film & Animation" },
  { id: "10", name: "Music" },
  { id: "15", name: "Pets & Animals" },
  { id: "19", name: "Travel & Events" },
  { id: "2", name: "Autos & Vehicles" },
  { id: "26", name: "Howto & Style" },
  { id: "29", name: "Nonprofits & Activism" },
] as const;
export const DEFAULT_CATEGORY = "27";

/** "Sports", "sports", "17" or "Science and Technology" → the category id, or null. */
export function categoryId(v: string): string | null {
  const k = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const c = YT_CATEGORIES.find((c) => c.id === v.trim() || k(c.name) === k(v));
  return c?.id ?? null;
}
export const categoryName = (id: string | undefined) => YT_CATEGORIES.find((c) => c.id === id)?.name ?? "Education";

/** A plain image file name (no folders), as kept in the images folder. */
export const IMAGE_NAME_RE = /^[\w][\w .()'-]{0,100}\.(jpe?g|png|webp)$/i;

/** YouTube's limits: title 100, description 5000, all tags together about 500 characters. */
export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;
export const YT_TAGS_MAX = 480;

/** "quiz, #dhoni, cricket quiz" → ["quiz", "dhoni", "cricket quiz"]: no #, no duplicates, within YouTube's limit. */
export function parseTags(raw: string): string[] {
  const out: string[] = [];
  let len = 0;
  for (const t of raw.split(/[,\n]/)) {
    const tag = t.replace(/[<>"#]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!tag || out.some((o) => o.toLowerCase() === tag.toLowerCase())) continue;
    if (len + tag.length + (out.length ? 1 : 0) > YT_TAGS_MAX) break;
    len += tag.length + (out.length ? 1 : 0);
    out.push(tag);
  }
  return out;
}

/** Ranks shown in long videos when neither the CSV nor the studio gives any. */
export const DEFAULT_RANKS = ["Quiz Rookie", "Fast Learner", "Smart Cookie", "Quiz Expert", "Quiz Genius"];
export const MAX_RANKS = 6;
export const MAX_RANK_CHARS = 22;

/** The score range for each rank: the questions split into equal bands, e.g. 25 → 0-5, 6-10 ... 21-25.
 *  With fewer questions than ranks, empty bands are left out. Same as rank_bands() in quiz_video.py. */
export function rankBands(n: number, ranks: string[]) {
  const out: { name: string; lo: number; hi: number }[] = [];
  let lo = 0;
  ranks.forEach((name, i) => {
    const hi = Math.floor((n * (i + 1)) / ranks.length + 0.5);
    if (hi >= lo) {
      out.push({ name, lo, hi });
      lo = hi + 1;
    }
  });
  return out;
}

/** "Beginner, Learner | Smart" → ["Beginner", "Learner", "Smart"] (commas, | or ;). */
export function parseRanks(text: string): string[] {
  return text
    .split(/[,|;]/)
    .map((r) => r.replace(/\s+/g, " ").trim().slice(0, MAX_RANK_CHARS))
    .filter(Boolean)
    .slice(0, MAX_RANKS);
}

/** Background music moods: folders in "src/Chaos creators/sounds/music/" (random = any, off = none). */
export const MUSIC_MOODS = [
  { value: "upbeat", label: "Upbeat (happy, pop)" },
  { value: "epic", label: "Epic (orchestral, drums)" },
  { value: "suspense", label: "Suspense (tense)" },
  { value: "random", label: "Any mood (random)" },
  { value: "off", label: "No music" },
] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number]["value"];

export const DIFFICULTIES = [
  { value: "easy", label: "Easy (school level, well-known facts)" },
  { value: "medium", label: "Medium (a good general quiz)" },
  { value: "hard", label: "Hard (for quiz lovers)" },
  { value: "mixed", label: "Mixed (starts easy, gets harder)" },
] as const;
export type Difficulty = (typeof DIFFICULTIES)[number]["value"];
/** Question counts the studio's "Make questions with Claude" offers. */
export const GENERATE_COUNTS = [5, 10, 15, 25, 50, 100, 150] as const;

export type ParsedQuiz = { questions: QuizQuestion[]; issues: CsvIssue[]; missingColumns: string[]; settings: QuizSettings };

type TextSetting = Exclude<keyof QuizSettings, "seconds" | "musicMood" | "ranks" | "youtubeDescription" | "youtubeTags" | "youtubeCategory" | "thumbnailImage">;

/** Setting names (lower case, letters and digits only) → field, with its length limit. */
const SETTING_KEYS: Record<string, { key: TextSetting; max: number } | { key: "seconds" } | { key: "musicMood" } | { key: "ranks" } | { key: "youtubeDescription" } | { key: "youtubeTags" } | { key: "youtubeCategory" } | { key: "thumbnailImage" }> = {
  videoname: { key: "videoName", max: 80 },
  title: { key: "videoName", max: 80 },
  badgeoneveryquestion: { key: "badge", max: 24 },
  badge: { key: "badge", max: 24 },
  quizbadge: { key: "badge", max: 24 },
  introtag: { key: "introTag", max: 30 },
  introbadge: { key: "introTag", max: 30 },
  introtitleline1: { key: "titleLine1", max: 24 },
  introtitle1: { key: "titleLine1", max: 24 },
  titleline1: { key: "titleLine1", max: 24 },
  introtitleline2: { key: "titleLine2", max: 24 },
  introtitle2: { key: "titleLine2", max: 24 },
  titleline2: { key: "titleLine2", max: 24 },
  secondsperquestion: { key: "seconds" },
  timerseconds: { key: "seconds" },
  musicmood: { key: "musicMood" },
  music: { key: "musicMood" },
  ranks: { key: "ranks" },
  ranknames: { key: "ranks" },
  rank: { key: "ranks" },
  youtubetitle: { key: "youtubeTitle", max: YT_TITLE_MAX },
  yttitle: { key: "youtubeTitle", max: YT_TITLE_MAX },
  youtubedescription: { key: "youtubeDescription" },
  ytdescription: { key: "youtubeDescription" },
  description: { key: "youtubeDescription" },
  youtubetags: { key: "youtubeTags" },
  yttags: { key: "youtubeTags" },
  tags: { key: "youtubeTags" },
  youtubecategory: { key: "youtubeCategory" },
  ytcategory: { key: "youtubeCategory" },
  category: { key: "youtubeCategory" },
  thumbnailimage: { key: "thumbnailImage" },
  thumbnailphoto: { key: "thumbnailImage" },
  topicphoto: { key: "thumbnailImage" },
  image: { key: "thumbnailImage" },
  photo: { key: "thumbnailImage" },
};

/** RFC 4180 CSV: quoted fields, "" escapes, commas and line breaks inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

export function parseQuizCsv(text: string): ParsedQuiz {
  const rows = parseCsvRows(text);
  const issues: CsvIssue[] = [];
  const questions: QuizQuestion[] = [];
  const settings: QuizSettings = {};
  if (!rows.length) return { questions, issues: [{ row: 0, message: "The file is empty.", level: "error" }], missingColumns: [...CSV_COLUMNS], settings };
  const norm = (h: string | undefined) => clean(h).toLowerCase().replace(/\s+/g, "_");
  // The header is the first row with a "question" column; the lines above it are settings
  let h0 = rows.findIndex((r) => r.map(norm).includes("question"));
  if (h0 < 0) h0 = 0;
  for (let r = 0; r < h0; r++) {
    const [rawKey, ...rest] = rows[r]!;
    const value = clean(rest.filter((v) => clean(v)).join(", "));
    const k = clean(rawKey).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k && !value) continue;
    const def = SETTING_KEYS[k];
    if (!def) {
      issues.push({ row: r + 1, message: `Unknown setting "${clean(rawKey)}": ignored.`, level: "warning" });
      continue;
    }
    if (!value) continue;
    if (def.key === "youtubeDescription") {
      // Keeps its line breaks (put it in "quotes" in the CSV); commas outside quotes are kept too
      const text = rest.join(",").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length > YT_DESCRIPTION_MAX) issues.push({ row: r + 1, message: `YouTube description is cut to ${YT_DESCRIPTION_MAX} characters.`, level: "warning" });
      settings.youtubeDescription = text.slice(0, YT_DESCRIPTION_MAX);
    } else if (def.key === "youtubeCategory") {
      const id = categoryId(value);
      if (id) settings.youtubeCategory = id;
      else issues.push({ row: r + 1, message: `YouTube category "${value}" isn't one of YouTube's (e.g. Education, Entertainment, Sports): Education is used.`, level: "warning" });
    } else if (def.key === "thumbnailImage") {
      if (IMAGE_NAME_RE.test(value)) settings.thumbnailImage = value;
      else issues.push({ row: r + 1, message: `Thumbnail image must be a .jpg, .png or .webp file name from the images folder (got "${value}"): ignored.`, level: "warning" });
    } else if (def.key === "youtubeTags") {
      const tags = parseTags(rest.join(","));
      if (tags.length) settings.youtubeTags = tags;
    } else if (def.key === "ranks") {
      const ranks = parseRanks(rest.join(","));
      if (ranks.length === 1 && ranks[0]!.toLowerCase() === "off") settings.ranks = ["off"];
      else if (ranks.length >= 2) settings.ranks = ranks;
      else issues.push({ row: r + 1, message: `Ranks needs 2 to ${MAX_RANKS} titles (lowest score first), or "off": ignored.`, level: "warning" });
    } else if (def.key === "seconds") {
      if (/^\d+$/.test(value) && Number(value) >= 3 && Number(value) <= 60) settings.seconds = Number(value);
      else issues.push({ row: r + 1, message: `Seconds per question must be a whole number from 3 to 60 (got "${value}"): ignored.`, level: "warning" });
    } else if (def.key === "musicMood") {
      const mood = MUSIC_MOODS.find((m) => m.value === value.toLowerCase());
      if (mood) settings.musicMood = mood.value;
      else issues.push({ row: r + 1, message: `Music mood must be one of ${MUSIC_MOODS.map((m) => m.value).join(", ")} (got "${value}"): ignored.`, level: "warning" });
    } else {
      if (value.length > def.max) issues.push({ row: r + 1, message: `${clean(rawKey)} is cut to ${def.max} characters.`, level: "warning" });
      settings[def.key] = value.slice(0, def.max);
    }
  }
  const header = rows[h0]!.map(norm);
  const col = (name: string) => header.indexOf(name);
  const required = ["question", "option_a", "option_b", "option_c", "option_d", "answer"];
  const missingColumns = required.filter((c) => col(c) < 0);
  if (missingColumns.length)
    return { questions, issues: [...issues, { row: h0 + 1, message: `Missing column${missingColumns.length > 1 ? "s" : ""}: ${missingColumns.join(", ")}`, level: "error" }], missingColumns, settings };

  for (let r = h0 + 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const get = (name: string) => clean(cells[col(name)]);
    const rowNo = r + 1;
    const question = get("question");
    if (!question) {
      if (cells.some((c) => clean(c))) issues.push({ row: rowNo, message: "No question text: row skipped.", level: "warning" });
      continue;
    }
    const options = [get("option_a"), get("option_b"), get("option_c"), get("option_d")] as [string, string, string, string];
    const errs: string[] = [];
    if (options.some((o) => !o)) errs.push("all four options are needed");
    const rawAnswer = get("answer");
    const a = rawAnswer.toUpperCase();
    let answer = -1;
    if (/^[ABCD]$/.test(a)) answer = "ABCD".indexOf(a);
    else if (/^[1-4]$/.test(a)) answer = Number(a) - 1;
    else if (rawAnswer && options.includes(rawAnswer)) answer = options.indexOf(rawAnswer);
    else errs.push(`answer must be A, B, C or D (got "${rawAnswer}")`);
    const rawSecs = col("seconds") >= 0 ? get("seconds") : "";
    let seconds: number | null = null;
    if (rawSecs) {
      if (/^\d+$/.test(rawSecs) && Number(rawSecs) >= 1 && Number(rawSecs) <= 60) seconds = Number(rawSecs);
      else errs.push(`seconds must be a whole number from 1 to 60 (got "${rawSecs}")`);
    }
    if (errs.length) {
      issues.push({ row: rowNo, message: errs.join("; "), level: "error" });
      continue;
    }
    const fact = col("fact") >= 0 ? get("fact") : "";
    if (question.length > 220) issues.push({ row: rowNo, message: "Long question: the text will be made smaller to fit.", level: "warning" });
    if (options.some((o) => o.length > 40)) issues.push({ row: rowNo, message: "Long option: the text will be made smaller to fit.", level: "warning" });
    if (fact.length > 170) issues.push({ row: rowNo, message: "Long fact: only the first 2-3 lines are shown.", level: "warning" });
    questions.push({ row: rowNo, question, options, answer, fact, seconds });
  }
  if (!questions.length && !issues.some((i) => i.level === "error")) issues.push({ row: 0, message: "No questions found.", level: "error" });
  if (questions.length > MAX_QUESTIONS) issues.push({ row: 0, message: `At most ${MAX_QUESTIONS} questions per video (this file has ${questions.length}).`, level: "error" });
  return { questions, issues, missingColumns, settings };
}

export const FORMATS = {
  shorts: { label: "Shorts / Reels", detail: "9:16 vertical · 1080×1920", w: 1080, h: 1920 },
  youtube: { label: "YouTube video", detail: "16:9 landscape · 1920×1080", w: 1920, h: 1080 },
} as const;
export type VideoFormat = keyof typeof FORMATS;

export const VOICES = [
  { value: "af_heart", label: "Heart (female, US)" },
  { value: "af_bella", label: "Bella (female, US)" },
  { value: "am_adam", label: "Adam (male, US)" },
  { value: "bf_emma", label: "Emma (female, British)" },
] as const;

/** Rough length of the finished video, matching the engine's timeline. */
export function estimateSeconds(questions: Pick<QuizQuestion, "seconds">[], defaultSeconds: number, ranks = false, optionsDelay = 2, answerHold = 3) {
  const intro = 9.5 + (ranks ? 8 : 0);
  const outro = 11 + (ranks ? 9 : 0);
  return intro + outro + questions.reduce((t, q) => t + 0.3 + optionsDelay + 0.3 + (q.seconds ?? defaultSeconds) + answerHold, 0);
}

export const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m} min ${r ? `${r} s` : ""}`.trim() : `${r} s`;
};

/** A ready-to-fill CSV with the sample questions. */
export const SAMPLE_CSV = `Video name,GK Quiz 1
Badge on every question,GK QUIZ
Intro tag,TODAY'S QUIZ
Intro title line 1,General
Intro title line 2,Knowledge
Seconds per question,5
Music mood,upbeat
Ranks,Quiz Rookie,Fast Learner,Smart Cookie,Quiz Expert,Quiz Genius
YouTube title,GK Quiz: 5 Questions Only Toppers Get Right! 🧠
YouTube description,"Think you're a GK champion? Answer 5 general knowledge questions in 5 seconds each!

Comment your score below 👇 and subscribe to Chaos Creators for a new quiz every day.

#gkquiz #generalknowledge #quiz #trivia"
YouTube tags,gk quiz,general knowledge,quiz,trivia,gk questions,quiz time,chaos creators
YouTube category,Education

question,option_a,option_b,option_c,option_d,answer,fact,seconds
Which planet is known as the Red Planet?,Venus,Mars,Jupiter,Saturn,B,"Mars looks red because of iron oxide, or rust, in its soil.",
Which is the largest ocean on Earth?,Atlantic Ocean,Indian Ocean,Pacific Ocean,Arctic Ocean,C,The Pacific Ocean covers about one third of the Earth's surface.,
"Who wrote India's national anthem, Jana Gana Mana?",Bankim Chandra Chatterjee,Rabindranath Tagore,Sarojini Naidu,Subramania Bharati,B,"Tagore also wrote Amar Shonar Bangla, the national anthem of Bangladesh.",
What is the hardest natural substance on Earth?,Gold,Iron,Diamond,Quartz,C,"Diamond is pure carbon, with its atoms locked in a very strong crystal structure.",
How many bones are there in an adult human body?,206,208,212,196,A,A newborn baby has around 300 bones. Many of them fuse together as we grow.,
`;
