// Flag Memory Challenge videos (the studio's Flags tab; engine: src/Chaos creators/engine/flags_video.py).
// A round: `show` flags flash one by one (1 s each), then a grid of `grid` flags with only `find` of
// them hidden in it; viewers have `searchSeconds` to spot them, then the found flags pop in the grid.
// Shared by the studio page (preview + Shuffle) and the server (it checks what the page sends), so
// what Rahul sees in the preview is exactly what the video shows.

import COUNTRIES_JSON from "@/Chaos creators/flags/countries.json";

export const COUNTRIES = COUNTRIES_JSON as Record<string, string>;
export const flagName = (code: string) => COUNTRIES[code] ?? code.toUpperCase();
export const FLAG_CODE_RE = /^[a-z]{2}$/;

export const FLAG_LEVELS = {
  easy: { label: "Easy", detail: "Well-known flags, no look-alikes" },
  medium: { label: "Medium", detail: "More countries, a few look-alikes in the grid" },
  hard: { label: "Hard", detail: "Look-alike flags hidden among the decoys (Chad and Romania…)" },
} as const;
export type FlagLevel = keyof typeof FLAG_LEVELS;

export const FLAG_DEFAULTS = { show: 10, find: 5, grid: 30, flagSeconds: 1, searchSeconds: 30 };
/** Rahul's planned series (26 Nov 2026): 12 flag memory videos. */
export const FLAG_SERIES: Record<FlagLevel, number> = { easy: 4, medium: 3, hard: 5 };
/** A made video, for the series panel and for not repeating flags (from flags-log.ts). */
export type MadeFlagsVideo = { jobId: string; title: string; level: FlagLevel; createdAt: string; shown: string[] };
export const FLAG_LIMITS = { show: [4, 15], find: [2, 10], grid: [12, 36], flagSeconds: [0.5, 3], searchSeconds: [10, 60], rounds: [1, 10] } as const;
export type FlagOptions = typeof FLAG_DEFAULTS;
export type FlagRound = { show: string[]; find: string[]; grid: string[] };

/** Flags most viewers know (easy). */
const EASY = (
  "in us gb fr de it es jp cn br ca au ru mx ar za eg ng ke sa ae tr kr pk bd lk np nz ie ch se no fi dk nl be pt gr pl ua il " +
  "jm cu cl co pe th vn my sg ph qa gh"
).split(" ");
/** Added for medium: well-travelled countries with distinctive or tricky flags. */
const MEDIUM_MORE = (
  "at hu cz sk ro bg hr rs si ee lv lt is lu mc ma dz tn et tz ug ci sn cm jo kw bh om lb sy iq ir af kz uz mn kh la mm bt mv " +
  "ve ec bo py uy cr pa do ht bs tt hn gt sv ni td md ad ml gn id ye ly sd zw zm ao mz na bw cy mt ge am az by al mk ba me ne pw lr cg cd"
).split(" ");

/** Look-alike flags (hard level): each group's flags are easily confused. */
export const LOOKALIKES: string[][] = [
  ["td", "ro", "ad", "md"],
  ["id", "mc", "pl"],
  ["ie", "ci", "it", "mx"],
  ["nl", "lu", "py", "hr"],
  ["au", "nz"],
  ["sn", "ml", "gn", "cm"],
  ["no", "is", "dk", "fi", "se"],
  ["ve", "co", "ec"],
  ["sk", "si", "ru", "rs"],
  ["be", "de"],
  ["in", "ne"],
  ["jp", "bd", "pw"],
  ["hn", "ni", "sv", "gt", "ar"],
  ["qa", "bh"],
  ["kw", "ae", "jo", "ps", "sd"],
  ["lt", "bo", "gh"],
  ["at", "lv", "lb"],
  ["ye", "eg", "sy", "iq"],
  ["tr", "tn"],
  ["cn", "vn"],
  ["us", "lr", "my"],
];
const GROUP_OF = new Map(LOOKALIKES.flatMap((g, i) => g.map((c) => [c, i] as const)));

const known = (codes: string[]) => codes.filter((c) => c in COUNTRIES);
export const FLAG_POOLS: Record<FlagLevel, string[]> = {
  easy: known(EASY),
  medium: known([...new Set([...EASY, ...MEDIUM_MORE])]),
  hard: Object.keys(COUNTRIES),
};

/** A small seeded random generator (the same seed always picks the same flags). */
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T,>(list: T[], r: () => number) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/**
 * One round's flags. Easy: no two flags of a look-alike group anywhere. Medium: a few look-alikes of
 * the shown flags among the decoys. Hard: shown flags come mostly from look-alike groups and every
 * shown flag's twin is in the grid (a twin of a flag that is NOT hidden is the nastiest decoy).
 */
export function pickRound(level: FlagLevel, seed: number, opt: FlagOptions = FLAG_DEFAULTS, avoid: Set<string> = new Set()): FlagRound {
  const r = rng(seed);
  const pool = FLAG_POOLS[level].filter((c) => !avoid.has(c));
  const show: string[] = [];
  const usedGroups = new Set<number>();
  const canShow = (c: string) => !show.includes(c) && (GROUP_OF.get(c) === undefined || !usedGroups.has(GROUP_OF.get(c)!));
  const take = (c: string) => {
    show.push(c);
    const g = GROUP_OF.get(c);
    if (g !== undefined) usedGroups.add(g);
  };
  if (level === "hard") {
    // about 7 of 10 from different look-alike groups
    for (const g of shuffle(LOOKALIKES, r)) {
      if (show.length >= Math.ceil(opt.show * 0.7)) break;
      const c = shuffle(g.filter((x) => x in COUNTRIES && !avoid.has(x)), r)[0];
      if (c) take(c);
    }
  }
  for (const c of shuffle(pool, r)) {
    if (show.length >= opt.show) break;
    if (canShow(c)) take(c);
  }
  const shownSet = new Set(show);
  const find = shuffle(show, r).slice(0, opt.find);
  const grid = [...find];
  const inGrid = new Set(grid);
  const add = (c: string) => {
    if (grid.length < opt.grid && !inGrid.has(c) && !shownSet.has(c) && c in COUNTRIES) {
      grid.push(c);
      inGrid.add(c);
    }
  };
  const twins = (c: string) => (GROUP_OF.get(c) === undefined ? [] : shuffle(LOOKALIKES[GROUP_OF.get(c)!]!.filter((x) => x !== c), r));
  if (level === "hard") {
    const notHidden = show.filter((c) => !find.includes(c));
    for (const c of [...notHidden, ...find]) twins(c).slice(0, 1).forEach(add);
  } else if (level === "medium") {
    for (const c of shuffle(show, r).slice(0, 3)) twins(c).slice(0, 1).forEach(add);
  }
  // Easy: decoys never share a look-alike group with a shown flag
  const okDecoy = (c: string) => level !== "easy" || GROUP_OF.get(c) === undefined || !show.some((s) => GROUP_OF.get(s) === GROUP_OF.get(c));
  for (const c of shuffle(FLAG_POOLS[level === "hard" ? "medium" : level], r)) if (okDecoy(c)) add(c);
  for (const c of shuffle(Object.keys(COUNTRIES), r)) add(c); // a tiny pool (custom sizes): fill from all
  return { show, find, grid: shuffle(grid, r) };
}

/** Several rounds: no flag is shown twice in one video. */
export function pickRounds(level: FlagLevel, seed: number, rounds: number, opt: FlagOptions = FLAG_DEFAULTS): FlagRound[] {
  const out: FlagRound[] = [];
  const avoid = new Set<string>();
  for (let i = 0; i < rounds; i++) {
    const rd = pickRound(level, seed + i * 7919, opt, avoid);
    rd.show.forEach((c) => avoid.add(c));
    out.push(rd);
  }
  return out;
}

/** What's wrong with a round sent by the page (empty = fine). */
export function roundProblems(rd: FlagRound, opt: FlagOptions): string[] {
  const p: string[] = [];
  const all = [...rd.show, ...rd.grid];
  if (all.some((c) => !(c in COUNTRIES))) p.push("unknown flag");
  if (rd.show.length !== opt.show) p.push(`${opt.show} flags to show`);
  if (rd.find.length !== opt.find) p.push(`${opt.find} flags to find`);
  if (rd.grid.length !== opt.grid) p.push(`${opt.grid} flags in the grid`);
  if (new Set(rd.show).size !== rd.show.length || new Set(rd.grid).size !== rd.grid.length) p.push("a flag twice");
  if (rd.find.some((c) => !rd.show.includes(c) || !rd.grid.includes(c))) p.push("a flag to find that isn't shown or isn't in the grid");
  if (rd.grid.some((c) => rd.show.includes(c) && !rd.find.includes(c))) p.push("a shown flag in the grid that isn't one to find");
  return p;
}

/** The game's name in the YouTube lines (a suggestion; Rahul may pick another). */
export const FLAG_GAME_NAME = "Flag Flash";

/** Ready-made YouTube lines (editable in the studio). */
export function flagsYoutubeDefaults(level: FlagLevel, rounds: number, opt: FlagOptions, shorts: boolean) {
  const lv = FLAG_LEVELS[level].label;
  const title = `Flag Memory Challenge (${lv}): Can You Find ${opt.find} of ${opt.show} Flags in ${opt.searchSeconds} Seconds?${shorts ? " #shorts" : ""}`;
  // Rahul's fun description (26 Nov 2026), filled in with this video's sizes, level and rounds
  const each = opt.flagSeconds === 1 ? "one second each" : `${opt.flagSeconds} seconds each`;
  const total = opt.find * rounds;
  const levelLine =
    level === "hard"
      ? "🔴 This one is HARD: look-alike flags are hiding in the grid to trick you! 😱 Think you can tell Chad from Romania? 😉"
      : level === "medium"
        ? "🟠 This one is MEDIUM: more countries, and a few sneaky look-alikes! 😏"
        : "🟢 This one is EASY: perfect for warming up your brain! 😄";
  const description = [
    `🚩⚡ ${FLAG_GAME_NAME.toUpperCase()}: The Flag Memory Challenge! Can YOU find ${opt.find} flags in ${opt.searchSeconds} seconds?`,
    "",
    `Get ready to test your brain! 🧠 ${opt.show} flags will FLASH on your screen, ${each}, super fast! Then the real challenge begins: ${opt.find} of them are hiding in a giant grid of ${opt.grid} flags. You've got just ${opt.searchSeconds} seconds to spot them all! ⏱️`,
    "",
    "👀 Watch closely… remember the colours, the stars, the stripes…",
    "🔍 Hunt them down in the grid. Every flag has a number, so shout it out when you find one!",
    "⏰ Beat the clock before time's up!",
    "✨ Then watch the hidden flags POP out and see how many you got right!",
    ...(rounds > 1 ? [`🏁 ${rounds} rounds, ${rounds * opt.show} different flags. Keep count as you go!`] : []),
    "",
    "Are you a 🥇 Flag Genius, a 🥈 Map Master, a 🥉 Explorer… or a lost traveller? 😄",
    "",
    levelLine,
    "",
    `👇 Comment your score out of ${total}! Then challenge your friends and family to beat it!`,
    "🔔 Subscribe to Chaos Creators for more fun brain games!",
    "",
    `#flagquiz #memorygame #${FLAG_GAME_NAME.toLowerCase().replace(/[^a-z0-9]/g, "")} #geography #braingames${shorts ? " #shorts" : ""}`,
  ].join("\n");
  const tags = [FLAG_GAME_NAME.toLowerCase(), "flag memory challenge", "flag quiz", "guess the flag", "memory game", "flags of the world", "geography quiz", "country flags", "brain games", "memory test", "flag game", `${lv.toLowerCase()} flag quiz`, "chaos creators"];
  return { title, description, tags };
}
