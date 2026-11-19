import "server-only";
import { z } from "zod";
import { audit } from "./audit";
import { encrypt } from "./config";
import { epdb } from "./db";
import { DEFAULT_LAUNCH, DEFAULT_ROTATION, DEFAULT_TIMES } from "./domain/programme";

// R14: every threshold, price, time and switch is a setting with a default and validation. Nothing in
// the module hard-codes these values; read them with getSettings().

const pct = z.number().min(0).max(100);
const hhmm = z.string().regex(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01]\d|2[0-3]):[0-5]\d$/, "Use a day and time like Thu 20:00");
const classList = z.array(z.number().int().min(9).max(12));

export const SETTINGS = {
  // Programme
  "programme.startDate": { group: "Programme", label: "Start date (a Monday)", schema: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), default: null as string | null },
  "programme.weeks": { group: "Programme", label: "Number of weeks", schema: z.number().int().min(1).max(52), default: 12 },
  "programme.launch": {
    group: "Programme",
    label: "Launch order",
    schema: z.object({ firstClasses: classList, laterClasses: classList, delayWeeks: z.number().int().min(0).max(12) }),
    default: DEFAULT_LAUNCH,
  },
  "programme.rotation": {
    group: "Programme",
    label: "Rotation (week → class → subject)",
    schema: z.record(z.string(), z.record(z.string(), z.string())),
    default: DEFAULT_ROTATION as unknown as Record<string, Record<string, string>>,
  },
  "programme.times": {
    group: "Programme",
    label: "Weekly times (IST)",
    schema: z.object({ post: hhmm, reminder: hhmm, deadline: hhmm, key: hhmm, review: hhmm, reports: hhmm }),
    default: DEFAULT_TIMES,
  },
  "programme.graceHours": { group: "Programme", label: "Late grace (hours)", schema: z.number().int().min(0).max(168), default: 24 },
  // Cohorts and the shared group
  "cohort.minSize": { group: "Cohorts", label: "Minimum cohort for ranks and group figures", schema: z.number().int().min(2).max(50), default: 5 },
  "cohort.ownPaper": { group: "Cohorts", label: "Own paper from (students on one board)", schema: z.number().int().min(2).max(100), default: 8 },
  "cohort.taggedPdf": { group: "Cohorts", label: "Tagged PDF from", schema: z.number().int().min(1).max(100), default: 3 },
  "group.splitAt": { group: "Cohorts", label: "Suggest splitting the shared group at (students)", schema: z.number().int().min(10).max(1024), default: 60 },
  "group.maxPostsPerWeek": { group: "Cohorts", label: "Suggest splitting above (group posts a week)", schema: z.number().int().min(1).max(200), default: 12 },
  "group.memberCount": { group: "Cohorts", label: "Students in the WhatsApp group now", schema: z.number().int().min(0).max(5000), default: 0 },
  // Analytics
  "analytics.strong": { group: "Analytics", label: "Strong band from (%)", schema: pct, default: 75 },
  "analytics.okay": { group: "Analytics", label: "Okay band from (%)", schema: pct, default: 50 },
  "analytics.lowScore": { group: "Analytics", label: "Low-score wording below (%)", schema: pct, default: 35 },
  "analytics.gapBelow": { group: "Analytics", label: "Repeating gap: chapter below (%)", schema: pct, default: 50 },
  "analytics.gapPapers": { group: "Analytics", label: "Repeating gap: in this many papers", schema: z.number().int().min(2).max(10), default: 2 },
  "analytics.offerAfterReports": { group: "Analytics", label: "Offer after this many reports", schema: z.number().int().min(1).max(20), default: 2 },
  // Marking
  "marking.aiEnabled": { group: "Marking", label: "AI marking enabled", schema: z.boolean(), default: false },
  "marking.aiModel": { group: "Marking", label: "AI model", schema: z.string().min(3).max(80), default: "claude-sonnet-5-5" },
  "marking.aiKey": { group: "Marking", label: "Claude API key (stored encrypted)", schema: z.string().nullable(), default: null as string | null, secret: true },
  "marking.aiConfidence": { group: "Marking", label: "Needs review below confidence", schema: z.number().min(0).max(1), default: 0.7 },
  "marking.spotCount": { group: "Marking", label: "Spot-check sheets per paper (5-10)", schema: z.number().int().min(5).max(10), default: 5 },
  "marking.spotTolerance": { group: "Marking", label: "Spot-check match within (marks)", schema: z.number().min(0).max(10), default: 0 },
  "marking.calibrationSheets": { group: "Marking", label: "Calibration sheets", schema: z.number().int().min(1).max(50), default: 10 },
  "marking.calibrationTarget": { group: "Marking", label: "AI agreement target (%)", schema: pct, default: 85 },
  "marking.mcqShare": { group: "Marking", label: "MCQ share guideline (%)", schema: z.object({ min: pct, max: pct }), default: { min: 40, max: 50 } },
  "marking.chaptersPerPaper": { group: "Marking", label: "Chapters per paper guideline", schema: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }), default: { min: 4, max: 6 } },
  // Delivery
  "delivery.emailEnabled": { group: "Delivery", label: "Send report emails", schema: z.boolean(), default: false },
  "delivery.smtp": {
    group: "Delivery",
    label: "Email server (SMTP)",
    schema: z.object({ host: z.string(), port: z.number().int().min(1).max(65535), secure: z.boolean(), user: z.string(), pass: z.string(), from: z.string() }),
    default: { host: "127.0.0.1", port: 10250, secure: false, user: "", pass: "", from: "Exam Prep <reports@localhost>" },
    secret: true,
  },
  "delivery.maxAttempts": { group: "Delivery", label: "Retry a failed email up to (times)", schema: z.number().int().min(1).max(10), default: 3 },
  "delivery.parentDelayHours": { group: "Delivery", label: "Parent report 'after the student' delay (hours)", schema: z.number().int().min(0).max(72), default: 3 },
  // Commercial
  "commercial.tiers": {
    group: "Commercial",
    label: "Tier names",
    schema: z.object({ free_practice: z.string(), free_report: z.string(), paid1: z.string(), paid2: z.string() }),
    default: { free_practice: "Free practice", free_report: "Free first report", paid1: "Paid 1: Analytics", paid2: "Paid 2: Teaching" },
  },
  "commercial.prices": { group: "Commercial", label: "Monthly price per subject (₹)", schema: z.object({ paid1: z.number().min(0), paid2: z.number().min(0) }), default: { paid1: 0, paid2: 0 } },
  "commercial.familyDiscountPct": { group: "Commercial", label: "Family discount for 2+ subjects (%)", schema: pct, default: 10 },
  "commercial.trial": { group: "Commercial", label: "Trial", schema: z.string().max(120), default: "One session or one report cycle" },
  "commercial.refundLine": { group: "Commercial", label: "Refund line", schema: z.string().max(400), default: "" },
  "commercial.receiptPrefix": { group: "Commercial", label: "Receipt prefix", schema: z.string().regex(/^[A-Z0-9]{2,8}$/), default: "RSC" },
  "commercial.upiId": { group: "Commercial", label: "UPI id on receipts", schema: z.string().max(80), default: "" },
  // Brand, consent, language
  "brand.tuitionName": { group: "Brand", label: "Tuition name", schema: z.string().min(1).max(80), default: "Rahul Shah Classes" },
  "brand.tutorName": { group: "Brand", label: "Tutor name", schema: z.string().min(1).max(80), default: "Rahul Shah" },
  "brand.contact": { group: "Brand", label: "Contact line", schema: z.string().max(200), default: "Message the tutor on WhatsApp" },
  "brand.groupLink": {
    group: "Brand",
    label: "Shared WhatsApp group invite link",
    schema: z.string().regex(/^(https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+)?$/, "Paste the group's invite link (https://chat.whatsapp.com/...)"),
    default: "",
  },
  "brand.formLinks": { group: "Brand", label: "Google Form links by class", schema: z.record(z.string(), z.string()), default: {} as Record<string, string> },
  "brand.referralLine": { group: "Brand", label: "Referral line on PDFs", schema: z.string().max(160), default: "Know a student who would like free weekly papers? Share our group link." },
  "consent.currentVersion": { group: "Consent", label: "Current consent-text version", schema: z.number().int().min(1), default: 1 },
  // Storage and retention
  "storage.maxUploadMb": { group: "Storage", label: "Maximum upload size (MB)", schema: z.number().min(1).max(50), default: 15 },
  "storage.maxImages": { group: "Storage", label: "Maximum images per submission", schema: z.number().int().min(1).max(30), default: 10 },
  "retention.months": { group: "Storage", label: "Keep sheets and marks for (months after the programme)", schema: z.number().int().min(1).max(120), default: 12 },
  // Metrics targets
  "targets.intake": { group: "Targets", label: "Intake completion (%)", schema: pct, default: 80 },
  "targets.submission": { group: "Targets", label: "Submission rate by Paper 3 (%)", schema: pct, default: 70 },
  "targets.repeat": { group: "Targets", label: "Repeat rate (%)", schema: pct, default: 60 },
  "targets.accuracy": { group: "Targets", label: "Marks accuracy (%)", schema: pct, default: 90 },
  "targets.ai": { group: "Targets", label: "AI agreement (%)", schema: pct, default: 85 },
  "targets.reply": { group: "Targets", label: "Report reply rate (%)", schema: pct, default: 20 },
  "targets.paid": { group: "Targets", label: "Paid conversion (%)", schema: z.object({ min: pct, max: pct }), default: { min: 10, max: 15 } },
  "targets.satisfaction": { group: "Targets", label: "Satisfaction (out of 5)", schema: z.number().min(1).max(5), default: 4 },
  "targets.hours": { group: "Targets", label: "Weekly hours plan", schema: z.object({ min: z.number().min(0), max: z.number().min(0) }), default: { min: 15, max: 17 } },
  "targets.health": { group: "Targets", label: "Health: still submitting (%) and paid families by week 6", schema: z.object({ pct, paid: z.number().int().min(0) }), default: { pct: 60, paid: 2 } },
  // Board patterns: the sections a new paper starts with (the teacher edits these templates)
  "papers.patterns": {
    group: "Papers",
    label: "Board pattern templates",
    schema: z.record(z.string(), z.array(z.object({ name: z.string().min(1).max(4), type: z.enum(["mcq", "short", "long", "case", "assertion"]), label: z.string().max(80) }))),
    default: {
      // The CBSE board paper: A 20 x 1 (MCQ + assertion-reason), B 5 x 2, C 6 x 3, D 4 x 5, E 3 x 4 (case-based)
      CBSE: [
        { name: "A", type: "mcq", label: "MCQ and assertion-reason (1 mark)" },
        { name: "B", type: "short", label: "Very short answer (2 marks)" },
        { name: "C", type: "short", label: "Short answer (3 marks)" },
        { name: "D", type: "long", label: "Long answer (5 marks)" },
        { name: "E", type: "case", label: "Case-based (4 marks)" },
      ],
      "ICSE-ISC": [
        { name: "A", type: "mcq", label: "Compulsory short and objective" },
        { name: "B", type: "long", label: "Descriptive (internal choice)" },
      ],
      State: [
        { name: "A", type: "mcq", label: "Objective" },
        { name: "B", type: "short", label: "Short answer" },
        { name: "C", type: "long", label: "Long answer" },
      ],
      IGCSE: [
        { name: "A", type: "mcq", label: "Multiple choice" },
        { name: "B", type: "long", label: "Structured" },
      ],
      Other: [
        { name: "A", type: "mcq", label: "Objective" },
        { name: "B", type: "short", label: "Written" },
      ],
    } as Record<string, { name: string; type: "mcq" | "short" | "long" | "case" | "assertion"; label: string }[]>,
  },
  // Mocks and quizzes
  "mock.windowHours": { group: "Papers", label: "Mock window (hours)", schema: z.number().int().min(1).max(72), default: 3 },
  "quiz.minutes": { group: "Papers", label: "Chapter quiz length (minutes)", schema: z.number().int().min(5).max(30), default: 10 },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS)[K]["schema"]> };

/** All settings: stored values over the defaults. A stored value that no longer validates falls back to the default. */
export async function getSettings(): Promise<Settings> {
  const rows = await epdb.setting.findMany();
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(SETTINGS)) {
    const row = rows.find((r) => r.key === k);
    const parsed = row ? def.schema.safeParse(row.value) : null;
    out[k] = parsed?.success ? parsed.data : def.default;
  }
  return out as Settings;
}

export class SettingError extends Error {}

/** Validates and saves one setting; every change is audited (secrets are never written to the audit log). */
export async function setSetting<K extends SettingKey>(key: K, value: unknown) {
  const def = SETTINGS[key];
  if (!def) throw new SettingError(`Unknown setting ${key}`);
  let v = value;
  if (key === "marking.aiKey" && typeof v === "string" && v) v = encrypt(v);
  if (key === "delivery.smtp" && v && typeof v === "object" && "pass" in v && (v as { pass: string }).pass && !(v as { pass: string }).pass.startsWith("v1.")) {
    v = { ...(v as object), pass: encrypt((v as { pass: string }).pass) };
  }
  const parsed = def.schema.safeParse(v);
  if (!parsed.success) throw new SettingError(`${def.label}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
  if (key === "analytics.okay" || key === "analytics.strong") {
    const s = await getSettings();
    const strong = key === "analytics.strong" ? (parsed.data as number) : s["analytics.strong"];
    const okay = key === "analytics.okay" ? (parsed.data as number) : s["analytics.okay"];
    if (okay >= strong) throw new SettingError("The Okay cut-off must be below the Strong cut-off.");
  }
  const old = await epdb.setting.findUnique({ where: { key } });
  await epdb.setting.upsert({ where: { key }, create: { key, value: parsed.data as never }, update: { value: parsed.data as never } });
  const isSecret = "secret" in def && def.secret;
  await audit({ action: "setting.changed", entity: "Setting", entityId: key, old: isSecret ? "(secret)" : (old?.value ?? null), new: isSecret ? "(secret)" : parsed.data });
}

export const cutoffs = (s: Settings) => ({ strong: s["analytics.strong"], okay: s["analytics.okay"] });
