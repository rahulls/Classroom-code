import "server-only";
import { EpError } from "../errors";
import { mailer } from "../adapters/email";
import { pageCount, pdf } from "../adapters/pdf";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { reportFraming } from "../domain/programme";
import { roundPct } from "../domain/scoring";
import { getSettings, type Settings } from "../settings";
import { classBand, sheetAnalytics, studentHistory } from "./analytics";
import { esc, pageHtml } from "./html";
import { draft, renderTemplate, setLabel } from "./messaging";
import { parentReachable } from "./people";

// R7 reports. One page each, student and parent, PDF and on screen. Idempotent per
// (student, paper, audience, guardian). Ranks never appear here: this file must not read RankRecord.

const L = {
  en: {
    student: "Student report",
    parent: "Progress report",
    total: "Total",
    chapter: "Chapter",
    marks: "Marks",
    band: "Band",
    strong: "Strongest chapters",
    weak: "Needs support",
    redo: "Redo these questions",
    next: "Next steps",
    trend: "Trend across papers",
    errors: "Where marks were lost",
    quality: "Answer-quality notes",
    time: "Time per section",
    classBand: "Class band (same class and board)",
    action: "Suggested action",
    revision: "A revision session on {chapter} is available for any student who wants it.",
    correction: "Correction",
    bands: { Strong: "Strong", Okay: "Okay", "Needs support": "Needs support" } as Record<string, string>,
    cohort: { "Top third": "Top third", Middle: "Middle", "Needs support": "Needs support" } as Record<string, string>,
    tags: { concept: "Concept", calculation: "Calculation", missing_steps: "Missing steps", misread: "Misread question" } as Record<string, string>,
    tasks: (w: string[]) => [`Redo the listed questions without looking at the key.`, `Re-read your notes on ${w.join(" and ")} and solve 5 textbook questions from each.`, `Check your redo answers against Friday's worked solutions.`],
    parentAction: (w: string) => `Ask your child to spend 20 minutes a day this week on ${w}, then try the redo list.`,
    first: "This is the first paper: the trend appears from the second paper.",
  },
  hi: {
    student: "छात्र रिपोर्ट",
    parent: "प्रगति रिपोर्ट",
    total: "कुल",
    chapter: "अध्याय",
    marks: "अंक",
    band: "स्तर",
    strong: "सबसे मज़बूत अध्याय",
    weak: "मदद की ज़रूरत",
    redo: "ये प्रश्न दोबारा हल करें",
    next: "अगले कदम",
    trend: "पेपरों में प्रगति",
    errors: "अंक कहाँ कटे",
    quality: "उत्तर-गुणवत्ता टिप्पणियाँ",
    time: "हर सेक्शन का समय",
    classBand: "कक्षा स्तर (समान कक्षा और बोर्ड)",
    action: "सुझाया गया कदम",
    revision: "{chapter} पर रिवीज़न सत्र किसी भी छात्र के लिए उपलब्ध है।",
    correction: "सुधार",
    bands: { Strong: "मज़बूत", Okay: "ठीक", "Needs support": "मदद चाहिए" } as Record<string, string>,
    cohort: { "Top third": "ऊपरी तिहाई", Middle: "बीच में", "Needs support": "मदद की ज़रूरत" } as Record<string, string>,
    tags: { concept: "अवधारणा", calculation: "गणना", missing_steps: "चरण छूटे", misread: "प्रश्न गलत पढ़ा" } as Record<string, string>,
    tasks: (w: string[]) => [`सूची के प्रश्न बिना उत्तर-कुंजी देखे दोबारा हल करें।`, `${w.join(" और ")} के नोट्स दोबारा पढ़ें और हर अध्याय से 5 प्रश्न हल करें।`, `शुक्रवार के हल से अपने उत्तर मिलाएँ।`],
    parentAction: (w: string) => `इस हफ़्ते रोज़ 20 मिनट ${w} पर अभ्यास करवाएँ, फिर दोबारा-हल सूची करवाएँ।`,
    first: "यह पहला पेपर है: प्रगति दूसरे पेपर से दिखेगी।",
  },
};

type Audience = "student" | "parent";
const STUDENT_KEY = "student";

/** Builds the report data (no rank anywhere). */
async function reportData(studentId: string, paperId: string, audience: Audience, lang: "en" | "hi", s: Settings) {
  const a = await sheetAnalytics(studentId, paperId);
  if (!a) throw new EpError("No sheet for this student and paper.");
  const st = await epdb.student.findUniqueOrThrow({ where: { id: studentId } });
  const hist = await studentHistory(studentId, a.paper.subject);
  const paid = st.status === "paid1" || st.status === "paid2";
  const framing = reportFraming({ pct: a.totals.pct, klass: st.klass, lowThreshold: s["analytics.lowScore"], lang });
  const corrections = await epdb.correctionNote.findMany({ where: { studentId, reportedIn: null } });
  return {
    student: { code: st.code, name: st.name, klass: st.klass, board: st.board },
    paper: { id: a.paper.id, number: a.paper.number, subject: a.paper.subject, title: a.paper.title },
    totals: { got: a.totals.got, max: a.totals.max, pct: roundPct(a.totals.pct) },
    chapter_breakdown: a.rows.map((r) => ({ chapter: r.chapter, got: r.got, max: r.max, pct: r.display, band: r.band })),
    strong: a.strong.map((r) => r.chapter),
    weak: a.weak.map((r) => r.chapter),
    trend: hist.overall,
    redo: a.redo,
    framing,
    classBand: audience === "parent" ? await classBand(studentId, paperId) : null,
    paid,
    errors: paid ? a.errors : null,
    quality: paid ? a.quality.slice(0, 4) : null,
    time: paid ? a.time : null,
    corrections: corrections.map((c) => ({ id: c.id, note: c.note })),
    lang,
  };
}
export type ReportData = Awaited<ReturnType<typeof reportData>>;

/** The one-page HTML. `compact` drops the optional blocks when a page would overflow. */
export function reportHtml(d: ReportData, audience: Audience, s: Settings, compact = false, scale = 1) {
  const t = L[d.lang];
  const bandCls = (b: string) => (b === "Needs support" ? "Needs" : b);
  const rows = d.chapter_breakdown
    .map((r) => `<tr><td>${esc(r.chapter)}</td><td>${r.got}/${r.max}</td><td style="width:30%"><div class="bar"><i style="width:${r.pct}%"></i></div></td><td>${r.pct}%</td><td><span class="pill ${bandCls(r.band)}">${esc(t.bands[r.band])}</span></td></tr>`)
    .join("");
  const trendLine = d.trend ? d.trend.points.map((p) => `${p.pct}%`).join(" → ") : t.first;
  const weak = d.weak.join(", ");
  const blocks: string[] = [];
  if (audience === "student") {
    blocks.push(`<div class="row"><div class="box"><h2>${t.redo}</h2><ol>${d.redo.map((r) => `<li>Q${r.number} · ${esc(r.chapter)} (${r.lost} ${t.marks.toLowerCase()})</li>`).join("")}</ol><p class="muted">Worked solutions: Friday's key post, ${esc(d.paper.id)}.</p></div><div class="box"><h2>${t.next}</h2><ol>${t
      .tasks(d.weak)
      .map((x) => `<li>${esc(x)}</li>`)
      .join("")}</ol></div></div>`);
  } else {
    blocks.push(`<div class="row"><div class="box"><h2>${t.strong}</h2><p>${esc(d.strong.join(", "))}</p><h2>${t.weak}</h2><p>${esc(weak)}</p></div><div class="box"><h2>${t.action}</h2><p>${esc(t.parentAction(weak))}</p>${
      d.weak[0] ? `<p class="muted">${esc(t.revision.replace("{chapter}", d.weak[0]))}</p>` : ""
    }${d.classBand ? `<h2>${t.classBand}</h2><p>${esc(t.cohort[d.classBand] ?? d.classBand)}</p>` : ""}</div></div>`);
  }
  if (!compact && d.paid) {
    const err = Object.entries(d.errors ?? {})
      .map(([k, v]) => `${esc(t.tags[k] ?? k)}: ${v}`)
      .join(" · ");
    if (err) blocks.push(`<h2>${t.errors}</h2><p>${err}</p>`);
    if (d.quality?.length) blocks.push(`<h2>${t.quality}</h2><ul>${d.quality.map((q) => `<li>Q${q.number}: ${esc(q.note)}</li>`).join("")}</ul>`);
    if (d.time?.length) blocks.push(`<h2>${t.time}</h2><p>${d.time.map((x) => `${esc(x.section)}: ${x.minutes ?? "?"} min, ${x.lost} lost`).join(" · ")}</p>`);
  }
  if (d.corrections.length) blocks.push(`<p class="muted"><b>${t.correction}:</b> ${d.corrections.map((c) => esc(c.note)).join(" ")}</p>`);
  const body = `<h1>${esc(audience === "student" ? t.student : t.parent)}: ${esc(d.student.name)}</h1>
<p class="muted">${esc(s["brand.tuitionName"])} · Class ${d.student.klass} ${esc(d.student.board)} · ${esc(d.paper.subject)} · ${esc(d.paper.id)}</p>
<p><b>${esc(d.framing.headline)}.</b> ${esc(d.framing.tone)}</p>
<div class="row"><div class="box"><b>${t.total}:</b> ${d.totals.got}/${d.totals.max} (${d.totals.pct}%)</div><div class="box"><b>${t.trend}:</b> ${esc(trendLine)}</div></div>
<h2>${t.chapter}</h2><table><tr><th>${t.chapter}</th><th>${t.marks}</th><th></th><th>%</th><th>${t.band}</th></tr>${rows}</table>
${blocks.join("")}`;
  return pageHtml({ title: `${d.paper.id} report`, lang: d.lang, onePage: true, scale, body, footer: `Reply STOP to stop receiving these. · ${esc(s["brand.referralLine"])}` });
}

/** Renders and stores the PDF, keeping it to one page. */
async function renderPdf(d: ReportData, audience: Audience, s: Settings, rel: string) {
  // One page: full detail first, then without the optional blocks, then smaller type
  let bytes = await pdf.fromHtml(reportHtml(d, audience, s));
  for (const [compact, scale] of [[true, 1], [true, 0.9], [true, 0.8], [true, 0.7], [true, 0.6]] as const) {
    if ((await pageCount(bytes)) <= 1) break;
    bytes = await pdf.fromHtml(reportHtml(d, audience, s, compact, scale));
  }
  await storage.save(rel, bytes);
  return { pages: await pageCount(bytes) };
}

/**
 * Generates the student report and one parent report per reachable guardian for every current,
 * fully-marked sheet of a paper. Running it again changes nothing (one report per key).
 */
export async function generateReports(paperId: string) {
  const s = await getSettings();
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  if (!["marked", "reported"].includes(paper.status)) throw new EpError("Finish marking first (the paper must be marked).");
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true, NOT: { flags: { has: "late_no_report" } } }, include: { student: { include: { parents: true } } } });
  let created = 0;
  for (const sub of subs) {
    const st = sub.student;
    if (st.status === "opted_out") continue;
    const targets: { audience: Audience; parentId: string; lang: "en" | "hi" }[] = [{ audience: "student", parentId: STUDENT_KEY, lang: "en" }];
    for (const p of st.parents) if (parentReachable(p)) targets.push({ audience: "parent", parentId: p.id, lang: p.language as "en" | "hi" });
    for (const tgt of targets) {
      const key = { studentId_paperId_audience_parentId: { studentId: st.id, paperId, audience: tgt.audience, parentId: tgt.parentId } };
      if (await epdb.reportCard.findUnique({ where: key })) continue;
      const d = await reportData(st.id, paperId, tgt.audience, tgt.lang, s);
      const rel = `reports/${paper.id}/${st.code}-${tgt.audience}${tgt.audience === "parent" ? `-${tgt.parentId.slice(-6)}` : ""}.pdf`;
      await renderPdf(d, tgt.audience, s, rel);
      try {
        const rc = await epdb.reportCard.create({ data: { studentId: st.id, paperId, audience: tgt.audience, parentId: tgt.parentId, language: tgt.lang, data: d as never, pdfPath: rel, status: "draft" } });
        if (d.corrections.length) await epdb.correctionNote.updateMany({ where: { id: { in: d.corrections.map((c) => c.id) } }, data: { reportedIn: rc.id } });
        created++;
      } catch (e) {
        if (!(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")) throw e; // made by a parallel run
      }
    }
  }
  return { created, total: await epdb.reportCard.count({ where: { paperId } }) };
}

/** The teacher approves a paper's reports: they become ready to deliver and the paper is "reported". */
export async function approveReports(paperId: string) {
  const r = await epdb.reportCard.updateMany({ where: { paperId, status: "draft" }, data: { status: "ready" } });
  const paper = await epdb.paper.findUniqueOrThrow({ where: { id: paperId } });
  if (paper.status !== "reported") {
    await epdb.paper.update({ where: { id: paperId }, data: { status: "reported" } });
    await audit({ action: "paper.reported", entity: "Paper", entityId: paperId, old: { status: paper.status }, new: { status: "reported" } });
  }
  return r.count;
}

/**
 * Delivery (the Sunday job; safe to re-run): student reports first; parent reports the same day, or
 * after the student per the parent's choice. Email goes automatically where the parent has an address,
 * consented, verified and emails are switched on; everything else lands in the WhatsApp send queue
 * (PDF, personal message and a wa.me link) for the tutor. A sent report is never re-sent.
 */
export async function deliverReports(now = new Date()) {
  const s = await getSettings();
  const ready = await epdb.reportCard.findMany({ where: { status: { in: ["ready", "failed"] }, attempts: { lt: s["delivery.maxAttempts"] } }, include: { student: { include: { parents: true } } }, orderBy: [{ audience: "desc" }, { createdAt: "asc" }] });
  let emailed = 0;
  let queued = 0;
  for (const rc of ready) {
    if (rc.status === "failed" && rc.error === "Opted out") continue;
    const st = rc.student;
    if (st.status === "opted_out") continue;
    const d = rc.data as unknown as ReportData;
    const vars = { student: st.name.split(" ")[0], subject: d.paper.subject, n: d.paper.number, strong: d.strong.join(", "), weak: d.weak.join(", "), chapter: d.weak[0] ?? "" };
    if (rc.audience === "student") {
      const to = st.parents.find((p) => parentReachable(p));
      if (!to) continue;
      const body = await renderTemplate("student_report", vars);
      const m = await draft({ dedupeKey: `report:${rc.id}`, templateKey: "student_report", audience: "student", body, studentId: st.id, parentId: to.id, paperId: rc.paperId, to: to.whatsapp });
      if (m && rc.channel !== "whatsapp_manual") {
        await epdb.reportCard.update({ where: { id: rc.id }, data: { channel: "whatsapp_manual" } });
        queued++;
      }
      continue;
    }
    const parent = st.parents.find((p) => p.id === rc.parentId);
    if (!parent || !parentReachable(parent)) continue; // opted out or unverified: never queued
    if (parent.reportTiming === "after") {
      const studentRc = await epdb.reportCard.findFirst({ where: { studentId: st.id, paperId: rc.paperId, audience: "student" } });
      const readyAt = (studentRc?.sentAt ?? rc.createdAt).getTime() + s["delivery.parentDelayHours"] * 3_600_000;
      if (studentRc?.status !== "sent" && now.getTime() < readyAt) continue;
    }
    const body = await renderTemplate("parent_report", { ...vars, parent: parent.name }, parent.language as "en" | "hi");
    if (parent.email && s["delivery.emailEnabled"]) {
      try {
        await epdb.reportCard.update({ where: { id: rc.id }, data: { attempts: { increment: 1 } } });
        await mailer.send({ to: parent.email, subject: `${d.student.name}: ${d.paper.subject} Paper ${d.paper.number} report`, text: `${body}\n\nReply STOP to stop receiving these.`, attachments: [{ filename: `${d.paper.id}-report.pdf`, content: await storage.read(rc.pdfPath!) }] }, s);
        await epdb.reportCard.update({ where: { id: rc.id }, data: { status: "sent", sentAt: new Date(), channel: "email", error: null } });
        emailed++;
      } catch (e) {
        await epdb.reportCard.update({ where: { id: rc.id }, data: { status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "send failed" } });
      }
      continue;
    }
    const m = await draft({ dedupeKey: `report:${rc.id}`, templateKey: "parent_report", audience: "parent", body, studentId: st.id, parentId: parent.id, paperId: rc.paperId, to: parent.whatsapp });
    if (m && rc.channel !== "whatsapp_manual") {
      await epdb.reportCard.update({ where: { id: rc.id }, data: { channel: "whatsapp_manual" } });
      queued++;
    }
  }
  return { emailed, queued };
}

/** The tutor sent it from WhatsApp: report and message are marked sent. */
export async function markReportSent(reportId: string) {
  const rc = await epdb.reportCard.findUniqueOrThrow({ where: { id: reportId } });
  if (rc.status === "sent") return rc;
  const done = await epdb.reportCard.update({ where: { id: reportId }, data: { status: "sent", sentAt: new Date(), channel: rc.channel ?? "whatsapp_manual" } });
  await epdb.message.updateMany({ where: { dedupeKey: `report:${reportId}` }, data: { status: "sent", sentAt: new Date() } });
  await setLabel(rc.studentId, "Report sent");
  return done;
}

/** Re-send only when the teacher forces it (e.g. after a correction). */
export async function forceResend(reportId: string) {
  const rc = await epdb.reportCard.findUniqueOrThrow({ where: { id: reportId } });
  await epdb.reportCard.update({ where: { id: reportId }, data: { status: "ready", sentAt: null, attempts: 0, channel: null } });
  await epdb.message.deleteMany({ where: { dedupeKey: `report:${reportId}`, status: { not: "sent" } } });
  await epdb.message.updateMany({ where: { dedupeKey: `report:${reportId}` }, data: { dedupeKey: `report:${reportId}:resent:${Date.now()}` } });
  await audit({ action: "report.force_resend", entity: "ReportCard", entityId: reportId, old: { status: rc.status } });
}

/** Regenerates one report's PDF (after a correction), keeping its row. */
export async function regenerateReport(reportId: string) {
  const s = await getSettings();
  const rc = await epdb.reportCard.findUniqueOrThrow({ where: { id: reportId } });
  const d = await reportData(rc.studentId, rc.paperId, rc.audience as Audience, rc.language as "en" | "hi", s);
  await renderPdf(d, rc.audience as Audience, s, rc.pdfPath!);
  await epdb.reportCard.update({ where: { id: reportId }, data: { data: d as never } });
}

export async function reportHtmlFor(reportId: string) {
  const s = await getSettings();
  const rc = await epdb.reportCard.findUniqueOrThrow({ where: { id: reportId } });
  return reportHtml(rc.data as unknown as ReportData, rc.audience as Audience, s);
}

/** Class note for the shared group: names the weakest chapters, no individual results. */
export async function classNote(paperId: string) {
  const { classView } = await import("./analytics");
  const v = await classView(paperId);
  const paper = v.paper;
  const chapters = v.weakest?.map((w) => w.chapter) ?? [];
  if (!chapters.length) return null;
  const { groupTag } = await import("./messaging");
  const tag = groupTag({ klass: paper.klass, board: paper.board, subject: paper.subject, number: paper.number });
  const body = await renderTemplate("class_note", { tag, chapters: chapters.join(" and ") });
  return draft({ dedupeKey: `classnote:${paper.baseId}`, templateKey: "class_note", audience: "group", tags: [tag], paperId, body });
}
