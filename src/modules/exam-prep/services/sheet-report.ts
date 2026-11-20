import "server-only";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { EpError } from "../errors";
import { epdb } from "../db";
import { sheetScore } from "../domain/answer-rows";
import type { Settings } from "../settings";
import { esc } from "./html";
import { paperRows } from "./answer-rows";
import { chapterRadar } from "./radar";

// The report for one checked answer sheet of an uploaded paper: one A4 page, built only from the
// tutor's own marks and "where lost" tags (chapter and section marks, lost-marks reasons, redo list).
// It never contains worked solutions or anything AI-written (the tutor's rule), and never a rank.

export const BANDS = [
  { min: 100, name: "Strong", cls: "s" },
  { min: 80, name: "Good", cls: "o" },
  { min: 60, name: "Average", cls: "a" },
  { min: -1, name: "Needs support", cls: "n" },
] as const;
const band = (pct: number) => BANDS.find((b) => pct >= b.min)!;

const TAGS: Record<string, [string, string]> = {
  calculation: ["Calculation slips", "Method was right; an arithmetic or algebra slip cost the marks. Re-checking each answer wins these back."],
  concept: ["Concept not clear", "The idea behind the question needs re-teaching: we start the 1:1 session here."],
  missing_steps: ["Steps missing", "Right direction, but marks were cut for working that was skipped. Show every step."],
  misread: ["Misread the question", "Read the question twice and underline what is asked."],
  none: ["Other", "Partly correct answers: we'll go through them in the 1:1 session."],
};

/** Everything the page shows (also kept on the ReportCard; delivery messages read paper/strong/weak). */
export async function sheetReportData(submissionId: string, s: Settings) {
  const sub = await epdb.submission.findUnique({ where: { id: submissionId }, include: { paper: true, rowMarks: true, student: true } });
  if (!sub) throw new EpError("Sheet not found.");
  const rows = paperRows(sub.paper);
  const sc = sheetScore(rows, sub.rowMarks);
  if (!sc.max) throw new EpError("Add the paper's answer rows first.");
  if (sc.open) throw new EpError(`${sc.open} answer${sc.open === 1 ? " is" : "s are"} not marked yet.`);
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  // Only the answered alternative of an OR choice is in the marks, which is what counts
  const marked = sub.rowMarks
    .filter((m) => byLabel.has(m.label))
    .map((m) => {
      const r = byLabel.get(m.label)!;
      return { label: m.label, q: m.label.split(".")[0]!, max: m.maxMarks, got: m.marks, tag: m.errorTag || "none", chapter: r.chapter || "No chapter given", section: r.section || "" };
    });
  const got = marked.reduce((a, r) => a + r.got, 0);
  const max = marked.reduce((a, r) => a + r.max, 0);
  const pct = Math.round((100 * got) / max);
  const chapters = [...new Set(marked.map((r) => r.chapter))].map((name) => {
    const rs = marked.filter((r) => r.chapter === name);
    const m = rs.reduce((a, r) => a + r.max, 0);
    const g = rs.reduce((a, r) => a + r.got, 0);
    const p = Math.round((100 * g) / m);
    return { name, got: g, max: m, pct: p, band: band(p).name };
  });
  const sections = [...new Set(marked.map((r) => r.section).filter(Boolean))].sort().map((name) => {
    const rs = marked.filter((r) => r.section === name);
    return { name, got: rs.reduce((a, r) => a + r.got, 0), max: rs.reduce((a, r) => a + r.max, 0) };
  });
  const lostRows = marked.filter((r) => r.got < r.max);
  const lost = Object.keys(TAGS)
    .map((tag) => {
      const rs = lostRows.filter((r) => (TAGS[r.tag] ? r.tag : "none") === tag);
      const per = new Map<string, number>();
      for (const r of rs) per.set(r.chapter, (per.get(r.chapter) ?? 0) + r.max - r.got);
      return { tag, why: TAGS[tag]![0], tip: TAGS[tag]![1], n: rs.reduce((a, r) => a + r.max - r.got, 0), where: [...per].sort((a, b) => b[1] - a[1]) };
    })
    .filter((x) => x.n > 0);
  const redo = [...new Set(lostRows.map((r) => r.q))].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  return {
    kind: "sheet" as const,
    student: { code: sub.student.code, name: sub.student.name, klass: sub.student.klass, board: sub.student.board },
    paper: { id: sub.paper.id, number: sub.paper.number, subject: sub.paper.subject, title: sub.paper.title, questions: new Set(rows.map((r) => r.label.split(".")[0])).size },
    submittedAt: sub.submittedAt.toISOString(),
    totals: { got, max, pct },
    band: band(pct).name,
    chapters,
    sections,
    lost,
    slips: lost.find((l) => l.tag === "calculation")?.n ?? 0,
    strong: chapters.filter((c) => c.pct === 100).map((c) => c.name),
    weak: chapters.filter((c) => c.pct < 60).sort((a, b) => a.pct - b.pct).map((c) => c.name),
    redo,
    tutor: s["brand.tutorName"],
    tuition: s["brand.tuitionName"],
    phone: s["brand.whatsapp"],
  };
}
export type SheetReportData = Awaited<ReturnType<typeof sheetReportData>>;

let logoCache: string | null = null;
function logo() {
  if (logoCache == null) {
    try {
      logoCache = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "src", "modules", "exam-prep", "assets", "rs-logo.png")).toString("base64")}`;
    } catch {
      logoCache = "";
    }
  }
  return logoCache;
}

const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

/** The one-page HTML. `scale` shrinks it when a paper has very many chapters. */
export async function sheetReportHtml(d: SheetReportData, scale = 1) {
  const digits = d.phone.replace(/\D/g, "");
  const qr = digits
    ? await QRCode.toDataURL(`https://wa.me/${digits}?text=${encodeURIComponent(`Hi ${d.tutor.split(" ")[0]}, I'd like to book a 1:1 session to go through the ${d.paper.subject} ${d.paper.title} report.`)}`, { margin: 0, width: 240, color: { dark: "#13213f", light: "#ffffff" } })
    : "";
  const lostTotal = d.totals.max - d.totals.got;
  const chRows = d.chapters
    .map((c) => {
      const b = band(c.pct);
      const l = c.max - c.got;
      return `<tr><td>${esc(c.name)}</td><td class="num">${c.got}/${c.max}</td><td><div class="bar"><i class="${b.cls}" style="width:${c.pct}%"></i></div></td><td class="num">${c.pct}%</td><td><span class="pill ${b.cls}">${b.name}</span></td><td class="lostc">${l ? `&minus;${l}` : ""}</td></tr>`;
    })
    .join("");
  const secRows = d.sections
    .map((x) => {
      const p = Math.round((100 * x.got) / x.max);
      return `<div class="drow"><span class="dk">Section ${esc(x.name)}</span><div class="bar"><i class="${band(p).cls}" style="width:${p}%"></i></div><span class="dv">${x.got}/${x.max}</span><span class="dp">${p}%</span></div>`;
    })
    .join("");
  const cards = d.lost
    .map((l) => {
      const where = l.where.length > 4 ? [...l.where.slice(0, 3), [`${l.where.length - 3} other chapters`, l.where.slice(3).reduce((a, [, n]) => a + n, 0)] as [string, number]] : l.where;
      return `<div class="lcard"><div class="ln">${l.n}<small>mark${l.n === 1 ? "" : "s"}</small></div><div class="lw">${esc(l.why)}</div><ul>${where.map(([c, n]) => `<li><span>${esc(c)}</span><b>${n}</b></li>`).join("")}</ul><div class="lt">${esc(l.tip)}</div></div>`;
    })
    .join("");
  const steps = [
    d.redo.length ? `Redo question${d.redo.length === 1 ? "" : "s"} ${d.redo.join(", ")} without looking at any answers` : "",
    d.weak.length ? `Revise ${d.weak.slice(0, 2).join(" and ")}: 5 textbook questions a day` : "",
    d.slips ? "Check every answer before moving on: most lost marks were slips" : "",
    "Bring your doubts to the 1:1 session",
  ].filter(Boolean);
  // Web chart of the chapter percentages (the Average and Good cut-offs are its dashed rings)
  const radar = chapterRadar(d.chapters.map((c) => ({ chapter: c.name, pct: c.pct, weak: c.pct < 60 })), [60, 80], 250);
  const lg = logo();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.paper.id)} report</title><style>
@page { size:A4; margin:0; }
* { box-sizing:border-box; margin:0; }
:root { --navy:#13213f; --gold:#f2c230; --ink:#1d2540; --muted:#6b7591; --line:#e4e7ef; --ok:#1e7a4c; --bad:#b3261e; }
html,body { width:794px; height:1123px; }
body { font-family:"Segoe UI","Nirmala UI",Arial,sans-serif; color:var(--ink); background:#fff; position:relative; overflow:hidden; font-size:12px; zoom:${scale}; }
.top { background:var(--navy); color:#fff; padding:16px 30px 14px; display:flex; align-items:center; gap:16px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.top h1 { font-size:21px; font-weight:800; } .top .sub { color:#c8cfe0; font-size:12.5px; margin-top:2px; }
.top img.logo { width:72px; height:72px; flex:none; }
.kpis { margin-left:auto; display:flex; gap:10px; }
.kpi { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.18); border-radius:10px; padding:7px 12px; text-align:center; min-width:104px; max-width:150px; }
.kpi b { display:block; font-size:27px; font-weight:800; color:var(--gold); line-height:1.05; } .kpi span { font-size:10.5px; color:#c8cfe0; }
.meta { display:flex; justify-content:space-between; gap:10px; white-space:nowrap; padding:8px 30px; background:#f6f7fb; border-bottom:1px solid var(--line); font-size:11px; color:var(--muted); } .meta b { color:var(--ink); }
.wrap { padding:10px 30px 0; }
h2 { font-size:14px; font-weight:800; color:var(--navy); margin:0 0 5px; } h2 small { font-weight:500; color:var(--muted); font-size:10.5px; margin-left:6px; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); font-weight:700; padding:0 6px 3px; border-bottom:1.5px solid var(--line); }
td { padding:1.5px 6px; border-bottom:1px solid var(--line); vertical-align:middle; font-size:11px; }
td.num { text-align:right; font-weight:700; white-space:nowrap; } td.lostc { text-align:right; color:var(--bad); font-weight:800; width:46px; }
.bar { height:7px; background:#eef0f6; border-radius:4px; overflow:hidden; min-width:60px; } .bar i { display:block; height:100%; border-radius:4px; }
i.s { background:#1e9e5a; } i.o { background:#3a7bd5; } i.a { background:#e0a400; } i.n { background:#d0312d; }
.pill { display:inline-block; font-size:10px; font-weight:700; border-radius:10px; padding:1px 8px; white-space:nowrap; }
.pill.s { background:#dcf3e6; color:#14663d; } .pill.o { background:#e1ecfb; color:#1f4f99; } .pill.a { background:#fbefd0; color:#8a5a00; } .pill.n { background:#fbe0de; color:var(--bad); }
.lost { margin-top:9px; border:2.5px solid var(--bad); border-radius:14px; background:#fff6f5; padding:8px 14px 9px; }
.lost h2 { color:var(--bad); font-size:17px; margin-bottom:6px; } .lost h2 span { background:var(--bad); color:#fff; border-radius:6px; padding:0 7px; margin:0 2px; }
.lcards { display:grid; gap:8px; grid-template-columns:repeat(${Math.max(1, d.lost.length)}, 1fr); }
.lcard { background:#fff; border-radius:10px; padding:7px 9px; border:1px solid #f3d2cf; }
.ln { font-size:26px; font-weight:800; color:var(--bad); line-height:1; } .ln small { font-size:10.5px; color:var(--muted); font-weight:600; margin-left:4px; }
.lw { font-size:12px; font-weight:800; color:var(--navy); margin:2px 0 3px; }
.lcard ul { list-style:none; padding:0; } .lcard li { display:flex; justify-content:space-between; gap:6px; font-size:10.5px; color:#3c4560; padding:1px 0; border-bottom:1px dotted #eccac6; } .lcard li b { color:var(--bad); }
.lt { font-size:9.5px; color:#6b4a47; margin-top:4px; line-height:1.25; }
.pen { color:var(--bad); font-size:14px; font-weight:700; font-style:italic; margin-top:6px; } .pen b { background:linear-gradient(transparent 55%, #ffe58a 55%); }
.full { margin-top:9px; border:2px solid #1e9e5a; border-radius:14px; background:#eef9f2; padding:10px 14px; color:var(--ok); font-weight:700; font-size:14px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:10px; align-items:start; }
.drow { display:grid; grid-template-columns:70px 1fr 44px 38px; gap:8px; align-items:center; padding:4px 0; border-bottom:1px solid var(--line); }
.dk { font-weight:800; color:var(--navy); } .dv { text-align:right; font-weight:700; } .dp { text-align:right; color:var(--muted); }
.box { border-radius:10px; padding:7px 11px; font-size:11.5px; margin-top:8px; } .box h3 { font-size:12.5px; font-weight:800; margin-bottom:3px; }
.box.g { background:#eaf6ef; } .box.g h3 { color:var(--ok); } .box.b { background:#eef1f8; } .box.b h3 { color:var(--navy); } .box ul { padding-left:16px; } .box li { margin:1px 0; line-height:1.3; }
.cta { position:absolute; left:30px; right:30px; bottom:40px; background:var(--navy); color:#fff; border-radius:14px; padding:11px 16px; display:flex; align-items:center; gap:16px; }
.cta img { width:74px; height:74px; background:#fff; padding:5px; border-radius:8px; } .cta h3 { font-size:16px; font-weight:800; } .cta p { font-size:11px; color:#c8cfe0; margin-top:2px; }
.cta .ph { margin-left:auto; text-align:right; } .cta .ph b { font-size:19px; color:var(--gold); display:block; white-space:nowrap; } .cta .ph span { font-size:10.5px; color:#c8cfe0; white-space:nowrap; }
.rkey { font-size:9.5px; color:var(--muted); margin-top:-2px; }
.foot { position:absolute; left:0; right:0; bottom:0; padding:8px 30px; border-top:1px solid var(--line); display:flex; justify-content:space-between; font-size:10px; color:var(--muted); background:#fafbfd; }
</style></head><body>
<div class="top">
  <div><h1>Progress report</h1><div class="sub">${esc(d.student.name)} · Class ${d.student.klass} ${esc(d.student.board)} · ${esc(d.paper.subject)} · ${esc(d.paper.title)}</div></div>
  <div class="kpis"><div class="kpi"><b>${d.totals.got}/${d.totals.max}</b><span>${d.totals.pct}% · ${esc(d.band)}</span></div>${d.slips ? `<div class="kpi"><b>+${d.slips}</b><span>marks within reach by checking</span></div>` : ""}</div>
  ${lg ? `<img class="logo" src="${lg}" alt="${esc(d.tuition)}">` : ""}
</div>
<div class="meta"><span>Paper: <b>${esc(d.paper.id)}</b></span><span>Questions: <b>${d.paper.questions}</b></span><span>Submitted: <b>${fmtDate(d.submittedAt)}</b></span><span>Report: <b>${fmtDate(new Date())}</b></span><span>Checked by: <b>${esc(d.tutor)}</b></span></div>
<div class="wrap">
  <h2>Chapter-wise marks <small>Strong: full marks · Good: 80-99% · Average: 60-79% · Needs support: below 60%</small></h2>
  <table><thead><tr><th>Chapter</th><th style="text-align:right">Marks</th><th></th><th style="text-align:right">%</th><th>Strength</th><th style="text-align:right">Lost</th></tr></thead><tbody>${chRows}</tbody></table>
  ${
    lostTotal
      ? `<div class="lost"><h2>Where the <span>${lostTotal}</span> mark${lostTotal === 1 ? " was" : "s were"} lost</h2><div class="lcards">${cards}</div>${d.slips ? `<div class="pen"><b>${d.slips} of ${lostTotal} lost marks were calculation slips.</b> Checking every answer could make it ${d.totals.got + d.slips}/${d.totals.max}.</div>` : ""}</div>`
      : `<div class="full">Full marks on this paper. Excellent work.</div>`
  }
  <div class="grid2">
    ${
      radar
        ? `<div><h2>Strengths and weaknesses at a glance</h2>${radar}<div class="rkey">Shaded shape: this paper's score in each chapter. Dashed rings: 60% and 80%. Red: needs support.</div>${d.strong.length ? `<div class="box g"><h3>Strong (full marks)</h3><p>${esc(d.strong.join(", "))}</p></div>` : ""}</div>
    <div>${secRows ? `<h2>Marks by section</h2>${secRows}` : ""}`
        : `<div>${secRows ? `<h2>Marks by section</h2>${secRows}` : ""}${d.strong.length ? `<div class="box g"><h3>Strong (full marks)</h3><p>${esc(d.strong.join(", "))}</p></div>` : ""}</div>
    <div>`
    }<div class="box b"${radar && secRows ? "" : ' style="margin-top:0"'}><h3>Next steps this week</h3><ul>${steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>${d.weak.length ? `<div class="box" style="background:#fbe0de"><h3 style="color:var(--bad)">Needs support</h3><p>${esc(d.weak.join(", "))}</p></div>` : ""}</div>
  </div>
</div>
<div class="cta">
  ${qr ? `<img src="${qr}" alt="WhatsApp QR">` : ""}
  <div><h3>Book a 1:1 session to go through this report</h3><p>We'll walk through every lost mark, fix the weak chapters and plan the next two weeks.${qr ? " Scan to message on WhatsApp." : ""}</p></div>
  <div class="ph"><b>${esc(d.phone)}</b><span>Call or WhatsApp · ${esc(d.tutor)}</span></div>
</div>
<div class="foot"><span>Checked and marked by ${esc(d.tutor)}.</span><span>Marks are never shared in any group.</span></div>
<script>(function(){var w=document.querySelector(".wrap"),c=document.querySelector(".cta"),z=1;if(!w||!c)return;while(z>0.6&&w.getBoundingClientRect().bottom>c.getBoundingClientRect().top-6){z-=0.02;w.style.zoom=String(z);}})();</script>
</body></html>`;
}
