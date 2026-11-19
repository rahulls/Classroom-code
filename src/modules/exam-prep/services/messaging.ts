import "server-only";
import { waLink } from "../adapters/whatsapp";
import { audit } from "../audit";
import { epdb, type Tx } from "../db";
import { getSettings } from "../settings";

// R9: template library, tagged group posts, private drafts, labels, opt-out, group-size advice.
// Group templates never carry an individual's score or rank: renderTemplate refuses those variables.

export type TemplateDef = { key: string; audience: "group" | "parent" | "student"; description: string; body: string; bodyHi?: string };

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    key: "group_rules",
    audience: "group",
    description: "Group rules (post once and pin)",
    body: "[All classes | Group rules]\nWelcome to {tuition} free weekly test papers.\n• This group is for papers, answer keys and announcements only. Replies are off.\n• Scores and reports are never shared here: they come to you privately.\n• Submit your answer sheet through the form for your class, not in this group.\n• Reply STOP to the tutor privately to stop receiving messages.",
  },
  {
    key: "weekly_calendar",
    audience: "group",
    description: "Pinned weekly calendar with form links",
    body: "[All classes | Week {week} calendar]\nMon: papers posted · Wed: reminder · Thu {deadline}: deadline · Fri: answer keys · Sun: private reports.\n{formLinks}",
  },
  {
    key: "paper_post",
    audience: "group",
    description: "Monday paper post (tagged)",
    body: "{tag} {title}\nPaper for {class} {board} {subject} is attached. Total {marks} marks.\nSubmit by {deadline} through your class form: {formLink}\nScan guide: one page per photo, good light, pages in order.",
  },
  { key: "wed_reminder", audience: "group", description: "Wednesday reminder", body: "{tag} Reminder: answer sheets are due {deadline}. Submit through your class form: {formLink}" },
  {
    key: "submission_received",
    audience: "student",
    description: "Submission received auto-reply",
    body: "Received your answer sheet for {paper}, {student}. Your report comes on Sunday. Thank you!",
  },
  {
    key: "private_reminder",
    audience: "student",
    description: "Private reminder (once per student per paper)",
    body: "Hi {student}, your {subject} paper ({paper}) is due {deadline}. Submit through the form when you can: {formLink}",
  },
  { key: "key_post", audience: "group", description: "Friday answer-key post (tagged)", body: "{tag} Answer key and worked solutions are attached. Check your work before Sunday's report." },
  {
    key: "class_note",
    audience: "group",
    description: "Sunday class note: weakest chapters (no individual results)",
    body: "{tag} Class note\nThis week's chapters to revise: {chapters}. Worked solutions are in Friday's key. Reports are coming to you privately.",
  },
  {
    key: "paid_offer",
    audience: "parent",
    description: "Paid offer to a parent (private)",
    body: "Hello {parent}, {student}'s last two {subject} papers show {chapter} needs support. A short revision plan on {chapter} is available ({tier}). Reply here if you would like the details.",
    bodyHi: "नमस्ते {parent}, {student} के पिछले दो {subject} पेपर में {chapter} पर और मदद की ज़रूरत दिखी है। {chapter} पर एक छोटा रिवीज़न प्लान ({tier}) उपलब्ध है। जानकारी चाहिए तो यहीं जवाब दें।",
  },
  {
    key: "opt_out_confirmation",
    audience: "parent",
    description: "Opt-out confirmation",
    body: "You will not receive any more messages from {tuition} Exam Prep. Thank you. If this was a mistake, reply START.",
    bodyHi: "अब आपको {tuition} Exam Prep से कोई संदेश नहीं मिलेगा। धन्यवाद। अगर यह गलती से हुआ हो तो START लिखकर जवाब दें।",
  },
  {
    key: "welcome",
    audience: "parent",
    description: "Welcome message",
    body: "Welcome to {tuition} free weekly papers, {parent}! {student} is registered for Class {class} {board}. The welcome pack is attached: how to scan and submit, deadlines, our privacy promise, and how marking works (AI suggests marks, the tutor checks every one). Questions: {contact}.",
    bodyHi: "{tuition} के मुफ़्त साप्ताहिक पेपर में आपका स्वागत है, {parent}! {student} कक्षा {class} {board} के लिए पंजीकृत है। स्वागत पत्र साथ में है: स्कैन और जमा करने का तरीका, समय-सीमा, हमारी गोपनीयता नीति, और जाँच का तरीका (AI अंक सुझाता है, शिक्षक हर अंक जाँचते हैं)। प्रश्न: {contact}।",
  },
  {
    key: "verify_number",
    audience: "parent",
    description: "Number verification (reply YES)",
    body: "Hello {parent}, this is {tutor} from {tuition}. Please reply YES to confirm this is the right number for {student}'s progress reports.",
    bodyHi: "नमस्ते {parent}, मैं {tuition} से {tutor} बोल रहा हूँ। कृपया YES लिखकर पुष्टि करें कि {student} की प्रगति रिपोर्ट के लिए यही सही नंबर है।",
  },
  {
    key: "parent_report",
    audience: "parent",
    description: "Parent report message",
    body: "Hello {parent}, this is {tutor} from {tuition}. Attached is {student}'s Paper {n} progress report for {subject}. Strong areas: {strong}. Needs support: {weak}. Reply here if you would like to discuss. A revision session on {chapter} is open for any student who wants it.",
    bodyHi: "नमस्ते {parent}, मैं {tuition} से {tutor}। {student} की {subject} पेपर {n} की प्रगति रिपोर्ट साथ में है। मज़बूत अध्याय: {strong}। मदद की ज़रूरत: {weak}। चर्चा करनी हो तो यहीं जवाब दें। {chapter} पर रिवीज़न सत्र किसी भी छात्र के लिए खुला है।",
  },
  { key: "student_report", audience: "student", description: "Student report message", body: "Hi {student}, your {subject} Paper {n} report is attached. Redo the questions on the list first: {weak}." },
  {
    key: "feedback_request",
    audience: "student",
    description: "Feedback request after a paper",
    body: "Hi {student}, two quick questions about {paper}: was it too easy, about right, or too hard? Which chapter should come next? (Optional: rate it 1-5.)",
  },
  { key: "deletion_confirmation", audience: "parent", description: "Deletion confirmation", body: "As requested, {tuition} has deleted {student}'s answer sheets, marks and reports (request {ref}, completed {date})." },
];

/** Variables that would expose an individual's result: never allowed in a group template. */
const PRIVATE_VARS = ["rank", "score", "marks_got", "percentage", "pct", "total_got", "student", "parent"];

export async function seedTemplates(tx: Tx = epdb) {
  for (const t of DEFAULT_TEMPLATES) await tx.messageTemplate.upsert({ where: { key: t.key }, create: t, update: {} });
}

export async function getTemplate(key: string) {
  const row = await epdb.messageTemplate.findUnique({ where: { key } });
  return row ?? DEFAULT_TEMPLATES.find((t) => t.key === key) ?? null;
}

export function fill(body: string, vars: Record<string, string | number | null | undefined>) {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k])));
}

/** Checks a template body before saving: group templates must start with a {tag} (or [ ... ]) and use no personal variables. */
export function validateTemplate(audience: string, body: string) {
  const vars = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  if (audience === "group") {
    const bad = vars.filter((v) => PRIVATE_VARS.includes(v));
    if (bad.length) return `Group posts can't include {${bad.join("}, {")}}.`;
    if (!/^\s*(\{tag\}|\[)/.test(body)) return "Group posts must start with the tag, e.g. {tag} or [Class 10 | CBSE | Maths | Paper 1].";
  }
  return null;
}

/** [Class 10 | CBSE | Maths | Paper 1] */
export const groupTag = (p: { klass: number; board: string; subject: string; number: number }) => `[Class ${p.klass} | ${p.board} | ${p.subject} | Paper ${p.number}]`;

export async function renderTemplate(key: string, vars: Record<string, string | number | null | undefined>, lang: "en" | "hi" = "en") {
  const t = await getTemplate(key);
  if (!t) throw new Error(`No template ${key}`);
  const s = await getSettings();
  const base = { tuition: s["brand.tuitionName"], tutor: s["brand.tutorName"], contact: s["brand.contact"], ...vars };
  return fill(lang === "hi" && t.bodyHi ? t.bodyHi : t.body, base);
}

/** Opted-out students and parents never get anything drafted (R9, R11). */
export async function isOptedOut(p: { studentId?: string | null; parentId?: string | null }) {
  if (p.parentId) {
    const par = await epdb.parent.findUnique({ where: { id: p.parentId }, select: { optedOutAt: true } });
    if (!par || par.optedOutAt) return true;
  }
  if (p.studentId) {
    const st = await epdb.student.findUnique({ where: { id: p.studentId }, select: { status: true } });
    if (!st || st.status === "opted_out") return true;
  }
  return false;
}

/**
 * Drafts a message once: the same dedupeKey never makes a second draft. Private messages to opted-out
 * people are refused (returns null). `to` (E.164) adds a wa.me link.
 */
export async function draft(m: {
  dedupeKey?: string;
  templateKey: string;
  audience: "group" | "parent" | "student";
  body: string;
  tags?: string[];
  studentId?: string | null;
  parentId?: string | null;
  paperId?: string | null;
  to?: string | null;
  allowOptedOut?: boolean;
}) {
  if (m.audience !== "group" && !m.allowOptedOut && (await isOptedOut({ studentId: m.studentId, parentId: m.parentId }))) return null;
  if (m.dedupeKey) {
    const existing = await epdb.message.findUnique({ where: { dedupeKey: m.dedupeKey } });
    if (existing) return existing;
  }
  try {
    return await epdb.message.create({
      data: {
        dedupeKey: m.dedupeKey,
        templateKey: m.templateKey,
        audience: m.audience,
        tags: m.tags ?? [],
        body: m.body,
        studentId: m.studentId ?? undefined,
        parentId: m.parentId ?? undefined,
        paperId: m.paperId ?? undefined,
        waLink: m.to ? waLink(m.to, m.body) : undefined,
      },
    });
  } catch (e) {
    // Two jobs racing on the same key: the other one won
    if (m.dedupeKey && e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") return epdb.message.findUnique({ where: { dedupeKey: m.dedupeKey } });
    throw e;
  }
}

export async function markMessageSent(id: string) {
  const msg = await epdb.message.findUniqueOrThrow({ where: { id } });
  if (msg.status === "sent") return msg;
  return epdb.message.update({ where: { id }, data: { status: "sent", sentAt: new Date() } });
}

/** Removes every unsent draft for an opted-out student/parent from the queues. */
export async function cancelQueuedFor(p: { studentId?: string; parentId?: string }) {
  const or = [p.studentId ? { studentId: p.studentId } : null, p.parentId ? { parentId: p.parentId } : null].filter(Boolean) as object[];
  if (!or.length) return 0;
  const r = await epdb.message.updateMany({ where: { status: "drafted", OR: or, NOT: { templateKey: "opt_out_confirmation" } }, data: { status: "cancelled" } });
  return r.count;
}

/** Group split advice (R9): over the student threshold, or more group posts a week than the limit. */
export async function groupAdvice(now = new Date()) {
  const s = await getSettings();
  const students = await epdb.student.count({ where: { status: { not: "opted_out" }, isDemo: false } });
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const posts = await epdb.message.count({ where: { audience: "group", createdAt: { gte: weekAgo } } });
  const reasons: string[] = [];
  if (students > s["group.splitAt"]) reasons.push(`${students} students (split suggested above ${s["group.splitAt"]})`);
  if (posts > s["group.maxPostsPerWeek"]) reasons.push(`${posts} group posts this week (above ${s["group.maxPostsPerWeek"]})`);
  return { split: reasons.length > 0, reasons, students, posts };
}

/** Labels for the Business app (R9), as CSV: student code, label (no names unless asked). */
export async function labelsCsv(withNames: boolean) {
  const rows = await epdb.student.findMany({ orderBy: { code: "asc" }, include: { parents: true } });
  const head = withNames ? "code,student,parent_whatsapp,label" : "code,label";
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [head, ...rows.map((r) => (withNames ? [r.code, r.name, r.parents.map((p) => p.whatsapp).join(" "), r.label] : [r.code, r.label]).map(q).join(","))].join("\n") + "\n";
}

export async function setLabel(studentId: string, label: string) {
  const s = await epdb.student.findUnique({ where: { id: studentId }, select: { label: true } });
  if (!s || s.label === label) return;
  // Opted out and paid labels are not overwritten by the weekly flow
  if (s.label === "Opted out" || ((s.label === "Paid 1" || s.label === "Paid 2") && (label === "Submitted" || label === "Report sent"))) return;
  await epdb.student.update({ where: { id: studentId }, data: { label } });
  await audit({ action: "label.changed", entity: "Student", entityId: studentId, old: s.label, new: label });
}
