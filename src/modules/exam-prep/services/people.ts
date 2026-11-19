import "server-only";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import { EpError } from "../errors";
import { pdf } from "../adapters/pdf";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { ADVICE_TEXT, BOARDS, groupingAdvice, subjectsFor, validSubjects } from "../domain/programme";
import { getSettings } from "../settings";
import { esc, pageHtml } from "./html";
import { cancelQueuedFor, draft, renderTemplate, setLabel } from "./messaging";

// R1 onboarding and intake. Students and parents fill a Google Form; the teacher imports its CSV
// export (or adds someone by hand). Only the R1 fields are collected (R11 data minimisation).

export const CONSENT_V1 =
  "I am the parent or guardian of this student. I agree that their answer sheets, marks and reports are stored privately by the tutor for this programme, that AI software may help propose marks which the tutor checks, and that reports are sent to me and my child privately. I can reply STOP at any time, and ask for all data to be deleted.";

export function normalisePhone(raw: string) {
  const p = parsePhoneNumberFromString(String(raw ?? "").trim(), "IN");
  return p && p.isValid() ? p.number : null;
}

const yes = (v: unknown) => /^(y|yes|true|1|i agree|agree|haan|हाँ)/i.test(String(v ?? "").trim());

export const IntakeSchema = z
  .object({
    name: z.string().trim().min(2, "Student name is required").max(80),
    klass: z.coerce.number().int().refine((k) => [9, 10, 11, 12].includes(k), "Class must be 9, 10, 11 or 12"),
    board: z.enum(BOARDS, { message: "Choose a board" }),
    stateBoard: z.string().trim().max(80).optional(),
    medium: z.string().trim().max(40).optional(),
    subjects: z.array(z.string()).min(1, "Choose at least one subject"),
    school: z.string().trim().max(120).optional(),
    lastExamRange: z.string().trim().max(40).optional(),
    parentName: z.string().trim().min(2, "Parent or guardian name is required").max(80),
    parentWhatsapp: z.string().trim().min(8, "Parent WhatsApp number is required"),
    parentEmail: z.string().trim().email("That email doesn't look right").optional().or(z.literal("")),
    language: z.enum(["en", "hi"]).default("en"),
    consent: z.literal(true, { message: "Parent consent is required" }),
    rankConsent: z.boolean().default(false),
    reportTiming: z.enum(["same", "after"]).default("same"),
    source: z.enum(["google_form", "csv", "teacher"]).default("teacher"),
    isDemo: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!validSubjects(v.klass, v.subjects)) ctx.addIssue({ code: "custom", path: ["subjects"], message: `Class ${v.klass} can take: ${subjectsFor(v.klass).join(", ")}` });
    if (v.board === "State" && !v.stateBoard) ctx.addIssue({ code: "custom", path: ["stateBoard"], message: "Name the state board" });
    if (v.board !== "State" && (v.stateBoard || v.medium)) ctx.addIssue({ code: "custom", path: ["stateBoard"], message: "State board name and medium are only for State board students" });
    if (!normalisePhone(v.parentWhatsapp)) ctx.addIssue({ code: "custom", path: ["parentWhatsapp"], message: "Parent WhatsApp number isn't valid" });
  });
export type Intake = z.infer<typeof IntakeSchema>;

async function nextCode() {
  const rows = await epdb.student.findMany({ select: { code: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.replace(/\D/g, "")) || 0), 0);
  return (n: number) => `EP-${String(max + n).padStart(4, "0")}`;
}

/** Adds one student with a parent. Consent is required; the consent text version is recorded. */
export async function addStudent(input: Intake) {
  const v = IntakeSchema.parse(input);
  const s = await getSettings();
  const code = (await nextCode())(1);
  const st = await epdb.student.create({
    data: {
      code,
      name: v.name,
      klass: v.klass,
      board: v.board,
      stateBoard: v.board === "State" ? v.stateBoard : null,
      medium: v.board === "State" ? v.medium : null,
      subjects: v.subjects,
      school: v.school || null,
      lastExamRange: v.lastExamRange || null,
      rankConsent: v.rankConsent,
      source: v.source,
      isDemo: v.isDemo,
      parents: {
        create: {
          name: v.parentName,
          whatsapp: normalisePhone(v.parentWhatsapp)!,
          email: v.parentEmail || null,
          language: v.language,
          consentAt: new Date(),
          consentTextVersion: s["consent.currentVersion"],
          reportTiming: v.reportTiming,
        },
      },
    },
    include: { parents: true },
  });
  await audit({ action: "student.created", entity: "Student", entityId: st.id, new: { code, klass: v.klass, board: v.board, subjects: v.subjects, rankConsent: v.rankConsent } });
  await audit({ action: "consent.recorded", entity: "Parent", entityId: st.parents[0]!.id, new: { consentTextVersion: s["consent.currentVersion"] } });
  return st;
}

/**
 * A student on the roll whose intake is not complete (no parent consent yet). They show as missing in
 * trackers, but nothing is processed for them (no sheets, reports or messages) until consent exists.
 */
export async function addPendingStudent(o: { name: string; klass: number; board: string; subjects: string[]; parentName?: string; parentWhatsapp?: string; isDemo?: boolean }) {
  if (!validSubjects(o.klass, o.subjects)) throw new EpError(`Class ${o.klass} can take: ${subjectsFor(o.klass).join(", ")}`);
  const code = (await nextCode())(1);
  const phone = o.parentWhatsapp ? normalisePhone(o.parentWhatsapp) : null;
  const st = await epdb.student.create({
    data: {
      code,
      name: o.name,
      klass: o.klass,
      board: o.board,
      subjects: o.subjects,
      source: "teacher",
      isDemo: !!o.isDemo,
      parents: phone ? { create: { name: o.parentName ?? "Parent", whatsapp: phone } } : undefined,
    },
  });
  await audit({ action: "student.pending_intake", entity: "Student", entityId: st.id, new: { code, klass: o.klass, board: o.board } });
  return st;
}

/** Intake is complete once a parent's consent is recorded. */
export const hasConsent = (parents: { consentAt: Date | null; optedOutAt: Date | null }[]) => parents.some((p) => p.consentAt && !p.optedOutAt);

/** Records consent later (e.g. the parent filled the form after being added to the roll). */
export async function recordConsent(parentId: string) {
  const s = await getSettings();
  const p = await epdb.parent.update({ where: { id: parentId }, data: { consentAt: new Date(), consentTextVersion: s["consent.currentVersion"] } });
  await audit({ action: "consent.recorded", entity: "Parent", entityId: parentId, new: { consentTextVersion: p.consentTextVersion } });
}

// ------------------------------ CSV import (Google Form export) ------------------------------

const HEADERS: Record<string, keyof Intake | "consentRaw" | "rankRaw" | "subjectsRaw"> = {
  "student name": "name",
  name: "name",
  class: "klass",
  board: "board",
  "state board name": "stateBoard",
  "state board": "stateBoard",
  medium: "medium",
  subjects: "subjectsRaw",
  school: "school",
  "last exam range": "lastExamRange",
  "last exam marks": "lastExamRange",
  "parent name": "parentName",
  "parent or guardian name": "parentName",
  "parent whatsapp": "parentWhatsapp",
  "parent whatsapp number": "parentWhatsapp",
  "parent email": "parentEmail",
  "report language": "language",
  language: "language",
  "parent consent": "consentRaw",
  consent: "consentRaw",
  "rank consent": "rankRaw",
  "share rank": "rankRaw",
  "report timing": "reportTiming",
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const BOARD_ALIASES: Record<string, string> = { cbse: "CBSE", icse: "ICSE-ISC", isc: "ICSE-ISC", "icse-isc": "ICSE-ISC", "icse/isc": "ICSE-ISC", state: "State", "state board": "State", igcse: "IGCSE", other: "Other" };

/**
 * Imports intake rows. All or nothing: if any row has an error, nothing is saved and every row's
 * errors are reported (no partial import).
 */
export async function importIntakeCsv(text: string, opts: { isDemo?: boolean } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new EpError("The CSV has no rows under the header.");
  const head = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[?:*]/g, "").replace(/\s+/g, " "));
  const col = (k: string) => head.findIndex((h) => HEADERS[h] === k);
  const errors: { row: number; messages: string[] }[] = [];
  const good: Intake[] = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k: string) => (col(k) >= 0 ? (r[col(k)] ?? "").trim() : "");
    const klass = Number(get("klass").replace(/\D/g, ""));
    const board = BOARD_ALIASES[get("board").toLowerCase()] ?? get("board");
    const subjects = get("subjectsRaw")
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (/^math/i.test(x) ? "Maths" : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()));
    const lang = /hi|हिं/i.test(get("language")) ? "hi" : "en";
    const timing = /after/i.test(get("reportTiming")) ? "after" : "same";
    const candidate = {
      name: get("name"),
      klass,
      board,
      stateBoard: get("stateBoard") || undefined,
      medium: get("medium") || undefined,
      subjects,
      school: get("school") || undefined,
      lastExamRange: get("lastExamRange") || undefined,
      parentName: get("parentName"),
      parentWhatsapp: get("parentWhatsapp"),
      parentEmail: get("parentEmail") || undefined,
      language: lang,
      consent: yes(get("consentRaw")),
      rankConsent: yes(get("rankRaw")),
      reportTiming: timing,
      source: "csv",
      isDemo: !!opts.isDemo,
    };
    const p = IntakeSchema.safeParse(candidate);
    if (p.success) good.push(p.data);
    else errors.push({ row: i + 2, messages: p.error.issues.map((x) => x.message) });
  });
  if (errors.length) return { imported: 0, errors };
  const s = await getSettings();
  const code = await nextCode();
  const created = await epdb.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const [i, v] of good.entries()) {
      const st = await tx.student.create({
        data: {
          code: code(i + 1),
          name: v.name,
          klass: v.klass,
          board: v.board,
          stateBoard: v.board === "State" ? v.stateBoard : null,
          medium: v.board === "State" ? v.medium : null,
          subjects: v.subjects,
          school: v.school || null,
          lastExamRange: v.lastExamRange || null,
          rankConsent: v.rankConsent,
          source: "csv",
          isDemo: v.isDemo,
          parents: {
            create: {
              name: v.parentName,
              whatsapp: normalisePhone(v.parentWhatsapp)!,
              email: v.parentEmail || null,
              language: v.language,
              consentAt: new Date(),
              consentTextVersion: s["consent.currentVersion"],
              reportTiming: v.reportTiming,
            },
          },
        },
      });
      ids.push(st.id);
      await audit({ action: "student.imported", entity: "Student", entityId: st.id, new: { klass: v.klass, board: v.board, consentTextVersion: s["consent.currentVersion"] } }, tx);
    }
    return ids;
  });
  return { imported: created.length, errors: [] as typeof errors };
}

// ------------------------------ verification, edits, opt-out ------------------------------

/** Unverified parent numbers, each with its "reply YES" message drafted once. */
export async function unverifiedParents() {
  const parents = await epdb.parent.findMany({ where: { numberVerifiedAt: null, optedOutAt: null }, include: { student: true }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const p of parents) {
    const body = await renderTemplate("verify_number", { parent: p.name, student: p.student.name }, p.language as "en" | "hi");
    const msg = await draft({ dedupeKey: `verify:${p.id}`, templateKey: "verify_number", audience: "parent", body, studentId: p.studentId, parentId: p.id, to: p.whatsapp });
    if (!p.verifyDraftedAt) await epdb.parent.update({ where: { id: p.id }, data: { verifyDraftedAt: new Date() } });
    out.push({ parent: p, message: msg });
  }
  return out;
}

export async function markVerified(parentId: string) {
  const p = await epdb.parent.update({ where: { id: parentId }, data: { numberVerifiedAt: new Date() } });
  await audit({ action: "parent.verified", entity: "Parent", entityId: parentId, new: { numberVerifiedAt: p.numberVerifiedAt } });
  const m = await epdb.message.findUnique({ where: { dedupeKey: `verify:${parentId}` } });
  if (m && m.status === "drafted") await epdb.message.update({ where: { id: m.id }, data: { status: "sent", sentAt: new Date() } });
}

/** Can a report be queued for this parent at all? (consented, verified, not opted out) */
export const parentReachable = (p: { consentAt: Date | null; numberVerifiedAt: Date | null; optedOutAt: Date | null }) => !!p.consentAt && !!p.numberVerifiedAt && !p.optedOutAt;

/** STOP handled by the teacher: opted out at once, removed from every queue, confirmation drafted. */
export async function optOut(o: { studentId?: string; parentId?: string }) {
  let studentId = o.studentId;
  let confirmTo: { id: string; whatsapp: string; language: string } | null = null;
  if (o.parentId) {
    const p = await epdb.parent.update({ where: { id: o.parentId }, data: { optedOutAt: new Date() } });
    studentId ??= p.studentId;
    confirmTo = p;
    await audit({ action: "parent.opted_out", entity: "Parent", entityId: p.id, new: { optedOutAt: p.optedOutAt } });
  }
  if (o.studentId) {
    const st = await epdb.student.update({ where: { id: o.studentId }, data: { status: "opted_out", optedOutAt: new Date() }, include: { parents: true } });
    await setLabel(st.id, "Opted out");
    await epdb.student.update({ where: { id: st.id }, data: { label: "Opted out" } });
    for (const p of st.parents) {
      if (!p.optedOutAt) await epdb.parent.update({ where: { id: p.id }, data: { optedOutAt: new Date() } });
      confirmTo ??= p;
    }
    await audit({ action: "student.opted_out", entity: "Student", entityId: st.id, new: { status: "opted_out" } });
  }
  const cancelled = await cancelQueuedFor({ studentId, parentId: o.parentId });
  if (studentId) {
    const pending = await epdb.reportCard.updateMany({ where: { studentId, status: { in: ["draft", "ready", "failed"] } }, data: { status: "failed", error: "Opted out" } });
    void pending;
  }
  let confirmation = null;
  if (confirmTo) {
    const body = await renderTemplate("opt_out_confirmation", {}, confirmTo.language as "en" | "hi");
    confirmation = await draft({ dedupeKey: `optout:${confirmTo.id}`, templateKey: "opt_out_confirmation", audience: "parent", body, parentId: confirmTo.id, studentId, to: confirmTo.whatsapp, allowOptedOut: true });
  }
  return { cancelled, confirmation };
}

export async function updateStudent(id: string, patch: Partial<{ name: string; klass: number; board: string; stateBoard: string | null; medium: string | null; subjects: string[]; school: string | null; rankConsent: boolean; manualPath: boolean }>) {
  const old = await epdb.student.findUniqueOrThrow({ where: { id } });
  const klass = patch.klass ?? old.klass;
  const subjects = patch.subjects ?? old.subjects;
  if (!validSubjects(klass, subjects)) throw new EpError(`Class ${klass} can take: ${subjectsFor(klass).join(", ")}`);
  const board = patch.board ?? old.board;
  const st = await epdb.student.update({ where: { id }, data: { ...patch, stateBoard: board === "State" ? (patch.stateBoard ?? old.stateBoard) : null, medium: board === "State" ? (patch.medium ?? old.medium) : null } });
  const changed = (k: keyof typeof old) => JSON.stringify(old[k]) !== JSON.stringify(st[k]);
  const fields = ["klass", "board", "subjects", "rankConsent", "manualPath"].filter((k) => changed(k as keyof typeof old));
  if (fields.length)
    await audit({ action: fields.includes("rankConsent") ? "rank_consent.changed" : "student.updated", entity: "Student", entityId: id, old: Object.fromEntries(fields.map((f) => [f, old[f as keyof typeof old]])), new: Object.fromEntries(fields.map((f) => [f, st[f as keyof typeof st]])) });
  return st;
}

// ------------------------------ summary and welcome pack ------------------------------

/** Counts by class and board with the grouping advice. */
export async function intakeSummary() {
  const s = await getSettings();
  const rows = await epdb.student.groupBy({ by: ["klass", "board"], where: { status: { not: "opted_out" } }, _count: { _all: true }, orderBy: [{ klass: "asc" }, { board: "asc" }] });
  return rows.map((r) => {
    const advice = groupingAdvice(r._count._all, { own: s["cohort.ownPaper"], tagged: s["cohort.taggedPdf"] });
    return { klass: r.klass, board: r.board, count: r._count._all, advice, adviceText: ADVICE_TEXT[advice] };
  });
}

export async function welcomePackHtml(lang: "en" | "hi" = "en") {
  const s = await getSettings();
  const t = s["programme.times"];
  const en = `<h1>${esc(s["brand.tuitionName"])}: free weekly test papers</h1>
<p class="muted">Classes 9-12 · Maths and Science · ${esc(s["brand.tutorName"])}</p>
<h2>How to scan and submit</h2><ol><li>Write on plain paper. Put your student code, class and paper number at the top of page 1.</li><li>Photograph each page flat, in good light, one page per photo, in order (or scan to one PDF).</li><li>Submit through the Google Form for your class before the deadline. One PDF, or up to ${s["storage.maxImages"]} photos, up to ${s["storage.maxUploadMb"]} MB.</li></ol>
<h2>Deadlines</h2><p>Papers on ${esc(t.post)} · reminder ${esc(t.reminder)} · deadline ${esc(t.deadline)} · answer keys ${esc(t.key)} · private reports ${esc(t.reports)}. Late sheets (more than ${s["programme.graceHours"]} hours) are not reported.</p>
<h2>Our privacy promise</h2><p>Answer sheets, marks and reports are stored privately and never posted in the group. Only the tutor sees them. Ranks are told to you personally, only if you agreed. Reply STOP at any time to stop messages, or ask us to delete everything.</p>
<h2>How marking works</h2><p>AI software helps propose marks for written answers; the tutor checks every proposal before any report. The AI sees only the answer sheet, the marking scheme and a student code, never your name or number.</p>
<h2>Contact</h2><p>${esc(s["brand.contact"])}</p>`;
  const hi = `<h1>${esc(s["brand.tuitionName"])}: मुफ़्त साप्ताहिक टेस्ट पेपर</h1>
<p class="muted">कक्षा 9-12 · गणित और विज्ञान · ${esc(s["brand.tutorName"])}</p>
<h2>स्कैन करके कैसे जमा करें</h2><ol><li>सादे कागज़ पर लिखें। पहले पेज पर ऊपर अपना स्टूडेंट कोड, कक्षा और पेपर नंबर लिखें।</li><li>हर पेज की अच्छी रोशनी में सीधी फोटो लें, एक फोटो में एक पेज, क्रम से (या एक PDF बना लें)।</li><li>समय-सीमा से पहले अपनी कक्षा के Google Form से जमा करें। एक PDF या ${s["storage.maxImages"]} तक फोटो, ${s["storage.maxUploadMb"]} MB तक।</li></ol>
<h2>समय-सीमा</h2><p>पेपर ${esc(t.post)} · रिमाइंडर ${esc(t.reminder)} · अंतिम समय ${esc(t.deadline)} · उत्तर-कुंजी ${esc(t.key)} · निजी रिपोर्ट ${esc(t.reports)}। ${s["programme.graceHours"]} घंटे से ज़्यादा देर से आई शीट की रिपोर्ट नहीं बनती।</p>
<h2>गोपनीयता का वादा</h2><p>उत्तर-पत्र, अंक और रिपोर्ट निजी रूप से रखे जाते हैं और ग्रुप में कभी नहीं डाले जाते। रैंक केवल आपकी सहमति पर, व्यक्तिगत रूप से बताई जाती है। संदेश बंद करने के लिए कभी भी STOP लिखें, या सारा डेटा हटाने को कहें।</p>
<h2>जाँच कैसे होती है</h2><p>AI सॉफ़्टवेयर लिखित उत्तरों के अंक सुझाता है; हर रिपोर्ट से पहले शिक्षक हर सुझाव जाँचते हैं। AI को केवल उत्तर-पत्र, अंक-योजना और स्टूडेंट कोड दिखता है, आपका नाम या नंबर कभी नहीं।</p>
<h2>संपर्क</h2><p>${esc(s["brand.contact"])}</p>`;
  return pageHtml({ title: "Welcome pack", lang, onePage: true, body: lang === "hi" ? hi : en, footer: `Reply STOP to stop receiving these. · ${esc(s["brand.referralLine"])}` });
}

/** The welcome pack PDF (stored once per language) and the welcome message for one parent. */
export async function welcomeFor(parentId: string) {
  const p = await epdb.parent.findUniqueOrThrow({ where: { id: parentId }, include: { student: true } });
  const lang = p.language as "en" | "hi";
  const rel = `welcome/welcome-pack-${lang}.pdf`;
  if (!storage.exists(rel)) await storage.save(rel, await pdf.fromHtml(await welcomePackHtml(lang)));
  const body = await renderTemplate("welcome", { parent: p.name, student: p.student.name, class: p.student.klass, board: p.student.board }, lang);
  const message = await draft({ dedupeKey: `welcome:${p.id}`, templateKey: "welcome", audience: "parent", body, studentId: p.studentId, parentId: p.id, to: p.whatsapp });
  return { pdfPath: rel, message };
}

export async function seedConsentText() {
  await epdb.consentText.upsert({ where: { version: 1 }, create: { version: 1, text: CONSENT_V1 }, update: {} });
}
