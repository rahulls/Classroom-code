// Pure programme rules: subjects, boards, paper ids, rotation and calendar (R1, R2, R3).

export const CLASSES = [9, 10, 11, 12] as const;
export const BOARDS = ["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"] as const;
export type Board = (typeof BOARDS)[number];
export const SUBJECTS_BY_CLASS: Record<number, string[]> = { 9: ["Maths", "Science"], 10: ["Maths", "Science"], 11: ["Maths", "Physics", "Chemistry"], 12: ["Maths", "Physics", "Chemistry"] };
export const SUBJECT_CODE: Record<string, string> = { Maths: "MAT", Science: "SCI", Physics: "PHY", Chemistry: "CHE" };
export const BOARD_CODE: Record<string, string> = { CBSE: "CBSE", "ICSE-ISC": "ICSE", State: "STATE", IGCSE: "IGCSE", Other: "OTHER" };

export const subjectsFor = (klass: number) => SUBJECTS_BY_CLASS[klass] ?? [];
export const validSubjects = (klass: number, subjects: string[]) => subjects.length > 0 && subjects.every((s) => subjectsFor(klass).includes(s));

/** C10-MAT-P1-CBSE; versions after the first get -v2, -v3. */
export function paperId(p: { klass: number; subject: string; number: number; board: string; version?: number }) {
  const base = `C${p.klass}-${SUBJECT_CODE[p.subject] ?? p.subject.slice(0, 3).toUpperCase()}-P${p.number}-${BOARD_CODE[p.board] ?? p.board.toUpperCase()}`;
  return p.version && p.version > 1 ? `${base}-v${p.version}` : base;
}

/** {class}_{name}_{subject3}_{paper}.pdf, file-system safe. */
export function sheetFileName(p: { klass: number; name: string; subject: string; paperId: string }) {
  const name = p.name.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "student";
  return `${p.klass}_${name}_${(SUBJECT_CODE[p.subject] ?? p.subject.slice(0, 3)).toUpperCase()}_${p.paperId}.pdf`;
}

/** class/subject/paper/ folder for a sheet. */
export const sheetFolder = (p: { klass: number; subject: string; paperId: string }) => `class-${p.klass}/${p.subject}/${p.paperId}`;

// ------------------------------ rotation and calendar ------------------------------

export type Rotation = Record<number, Record<number, string>>; // rotation week (1-4) → class → subject
export const DEFAULT_ROTATION: Rotation = {
  1: { 9: "Science", 10: "Maths", 11: "Physics", 12: "Chemistry" },
  2: { 9: "Maths", 10: "Science", 11: "Chemistry", 12: "Maths" },
  3: { 9: "Science", 10: "Maths", 11: "Maths", 12: "Physics" },
  4: { 9: "Maths", 10: "Science", 11: "Physics", 12: "Chemistry" },
};

export type WeeklyTimes = { post: string; reminder: string; deadline: string; key: string; review: string; reports: string }; // "Mon 09:00"
export const DEFAULT_TIMES: WeeklyTimes = { post: "Mon 09:00", reminder: "Wed 18:00", deadline: "Thu 20:00", key: "Fri 18:00", review: "Sat 10:00", reports: "Sun 17:00" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** IST is UTC+5:30 all year. */
const IST_MS = 330 * 60_000;

/** The Monday (IST) on or before a yyyy-mm-dd date, as yyyy-mm-dd. */
export function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** "Thu 20:00" in programme week `week` (1-based) → the UTC instant. */
export function weekTime(startMonday: string, week: number, at: string) {
  const [day, hm] = at.split(" ");
  const [h, m] = (hm ?? "00:00").split(":").map(Number);
  const dayIdx = Math.max(0, DAYS.indexOf(day ?? "Mon"));
  const base = Date.parse(`${startMonday}T00:00:00Z`) + ((week - 1) * 7 + dayIdx) * 86_400_000 + ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
  return new Date(base - IST_MS);
}

export type LaunchOrder = { firstClasses: number[]; laterClasses: number[]; delayWeeks: number };
export const DEFAULT_LAUNCH: LaunchOrder = { firstClasses: [10, 12], laterClasses: [9, 11], delayWeeks: 2 };

export type CalendarSlot = { week: number; klass: number; subject: string; board: string; opensAt: Date; dueAt: Date; number: number };

/**
 * The programme calendar: one paper per class per week from the rotation (the 4-week block repeats),
 * for every board group big enough to get its own paper. Later-launch classes start `delayWeeks` late.
 * Paper numbers count per class, subject and board from 1.
 */
export function buildCalendar(o: {
  startDate: string;
  weeks: number;
  rotation?: Rotation;
  launch?: LaunchOrder;
  times?: WeeklyTimes;
  boardsByClass: Record<number, string[]>;
}): CalendarSlot[] {
  const rotation = o.rotation ?? DEFAULT_ROTATION;
  const launch = o.launch ?? DEFAULT_LAUNCH;
  const times = o.times ?? DEFAULT_TIMES;
  const start = mondayOf(o.startDate);
  const blockLen = Object.keys(rotation).length || 4;
  const counters = new Map<string, number>();
  const out: CalendarSlot[] = [];
  for (let week = 1; week <= o.weeks; week++) {
    const row = rotation[((week - 1) % blockLen) + 1] ?? {};
    for (const klass of CLASSES) {
      if (launch.laterClasses.includes(klass) && week <= launch.delayWeeks) continue;
      const subject = row[klass];
      if (!subject) continue;
      for (const board of o.boardsByClass[klass] ?? []) {
        const k = `${klass}|${subject}|${board}`;
        const number = (counters.get(k) ?? 0) + 1;
        counters.set(k, number);
        out.push({ week, klass, subject, board, opensAt: weekTime(start, week, times.post), dueAt: weekTime(start, week, times.deadline), number });
      }
    }
  }
  return out;
}

/** The programme week (1-based) that contains `now`, or 0 before the start. */
export function weekOf(startDate: string, now: Date) {
  const start = Date.parse(`${mondayOf(startDate)}T00:00:00Z`) - IST_MS;
  const diff = now.getTime() - start;
  return diff < 0 ? 0 : Math.floor(diff / (7 * 86_400_000)) + 1;
}

/** Board grouping advice (R1): 8+ own paper and later own group; 3-7 tagged PDF in the shared group; under 3 common-concept paper. */
export function groupingAdvice(count: number, t = { own: 8, tagged: 3 }) {
  if (count >= t.own) return "own" as const;
  if (count >= t.tagged) return "tagged" as const;
  return "common" as const;
}
export const ADVICE_TEXT = {
  own: "Own paper now, and its own group later",
  tagged: "Tagged PDF in the shared group",
  common: "Common-concept paper",
} as const;

/** Late after the deadline plus the grace hours. */
export function lateness(submittedAt: Date, dueAt: Date | null, graceHours = 24) {
  if (!dueAt) return { late: false, beyondGrace: false };
  const late = submittedAt.getTime() > dueAt.getTime();
  return { late, beyondGrace: submittedAt.getTime() > dueAt.getTime() + graceHours * 3_600_000 };
}

// ------------------------------ paper rules (R2) ------------------------------

export type PaperQ = { chapter: string | null; marks: number; type: string; topic?: string | null; difficulty?: string | null; markingScheme?: unknown; correctOption?: string | null };

/** Warnings and blocking problems for a paper. Problems block publishing; warnings don't. */
export function checkPaper(qs: PaperQ[], chapters: string[], g = { mcqMin: 40, mcqMax: 50, chMin: 4, chMax: 6 }) {
  const problems: string[] = [];
  const warnings: string[] = [];
  const total = qs.reduce((s, q) => s + q.marks, 0);
  const mcq = qs.filter((q) => q.type === "mcq").reduce((s, q) => s + q.marks, 0);
  const share = total ? (100 * mcq) / total : 0;
  const covered = [...new Set(qs.map((q) => q.chapter).filter(Boolean))] as string[];
  if (!qs.length) problems.push("The paper has no questions.");
  qs.forEach((q, i) => {
    const n = i + 1;
    if (!q.chapter || !q.topic || !q.difficulty || !(q.marks > 0)) problems.push(`Question ${n} is not fully tagged (chapter, topic, marks, difficulty).`);
    else if (chapters.length && !chapters.includes(q.chapter)) problems.push(`Question ${n}: "${q.chapter}" is not in the chapter list.`);
    if (q.type === "mcq" && !q.correctOption) problems.push(`Question ${n} (MCQ) has no correct option.`);
    if (q.type !== "mcq" && !(Array.isArray(q.markingScheme) && q.markingScheme.length)) problems.push(`Question ${n} needs a marking scheme with marks per step.`);
  });
  if (qs.length && (share < g.mcqMin || share > g.mcqMax)) warnings.push(`MCQs are ${Math.round(share)}% of the marks (guideline ${g.mcqMin}-${g.mcqMax}%).`);
  if (qs.length && (covered.length < g.chMin || covered.length > g.chMax)) warnings.push(`${covered.length} chapters covered (guideline ${g.chMin}-${g.chMax}).`);
  const byChapter: Record<string, number> = {};
  for (const q of qs) if (q.chapter) byChapter[q.chapter] = (byChapter[q.chapter] ?? 0) + q.marks;
  return { problems, warnings, total, mcqShare: share, chapters: covered, byChapter };
}

// ------------------------------ wording (R7) ------------------------------

/** Report headline wording: kind framing below the low-score threshold; Class 9 never says "exam readiness". */
export function reportFraming(p: { pct: number; klass: number; lowThreshold?: number; lang?: "en" | "hi" }) {
  const low = p.pct < (p.lowThreshold ?? 35);
  const hi = p.lang === "hi";
  const goal = p.klass === 9 ? (hi ? "मज़बूत नींव बनाना" : "building strong basics") : hi ? "परीक्षा की तैयारी" : "exam readiness";
  if (low)
    return {
      low,
      goal,
      headline: hi ? "हर अध्याय सुधारा जा सकता है: यहाँ से शुरू करें" : "Every chapter here is fixable: here is where to start",
      tone: hi ? "आइए एक-एक अध्याय पर काम करें।" : "Let's work through it one chapter at a time.",
    };
  return {
    low,
    goal,
    headline: hi ? "आपकी प्रगति" : p.klass === 9 ? "Building strong basics: your progress" : "Your progress towards exam readiness",
    tone: hi ? "अच्छा काम, आगे बढ़ते रहें।" : "Good work, keep going.",
  };
}
