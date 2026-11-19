// Sample student report (Class 10 CBSE Mathematics, 80 marks), to show parents what they will get.
//   node design/flyers/make-sample-report.mjs  → sample-report-class10-maths.pdf (A4) and .png
// All numbers are illustrative (a sample student), and the page says so.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const logo = `data:image/png;base64,${fs.readFileSync(path.join(here, "rs-logo.png")).toString("base64")}`;
const PHONE = "+91 95603 15528";
const WA = "919560315528";
const qr = await QRCode.toDataURL(`https://wa.me/${WA}?text=${encodeURIComponent("Hi Rahul, I'd like to book a 1:1 session to go through my child's report.")}`, { margin: 0, width: 240, color: { dark: "#13213f", light: "#ffffff" } });

// Chapter, short label (chart), marks available, marks scored
const CH = [
  ["Real Numbers", "Real No.", 6, 6],
  ["Polynomials", "Polynomials", 5, 5],
  ["Pair of Linear Equations", "Linear Eq.", 7, 7],
  ["Quadratic Equations", "Quadratics", 8, 4],
  ["Arithmetic Progressions", "AP", 6, 5],
  ["Triangles", "Triangles", 8, 7],
  ["Coordinate Geometry", "Coord. Geo.", 6, 4],
  ["Trigonometry and its Applications", "Trigonometry", 12, 9],
  ["Circles", "Circles", 7, 6],
  ["Areas and Volumes", "Areas & Vol.", 8, 6],
  ["Statistics and Probability", "Stats & Prob.", 7, 3],
].map(([name, short, max, got]) => ({ name, short, max, got, pct: Math.round((100 * got) / max) }));
const DIFF = [
  { k: "Easy", max: 24, got: 23 },
  { k: "Medium", max: 32, got: 26 },
  { k: "Hard", max: 24, got: 13 },
];
// Marks lost, by reason, and where (chapter: marks). Adds up to the marks lost.
const LOST = [
  { why: "Calculation slips", n: 8, where: [["Trigonometry", 3], ["Quadratic Equations", 2], ["Areas and Volumes", 2], ["Coordinate Geometry", 1]], tip: "Careless, not conceptual: checking each answer wins these back." },
  { why: "Concept not clear", n: 6, where: [["Statistics and Probability", 4], ["Quadratic Equations", 2]], tip: "Needs re-teaching: the 1:1 session starts here." },
  { why: "Steps missing", n: 4, where: [["Triangles", 1], ["Arithmetic Progressions", 1], ["Circles", 1], ["Coordinate Geometry", 1]], tip: "Right answer, marks cut for skipped working." },
];
const RANK = { rank: 4, of: 23 };

const total = CH.reduce((a, c) => a + c.got, 0);
const max = CH.reduce((a, c) => a + c.max, 0);
const lost = max - total;
if (LOST.reduce((a, l) => a + l.n, 0) !== lost || LOST.some((l) => l.where.reduce((a, [, n]) => a + n, 0) !== l.n)) throw new Error("Lost marks don't add up");
if (DIFF.reduce((a, d) => a + d.got, 0) !== total) throw new Error("Difficulty marks don't add up");

// Bands: full marks = Strong, 80-99% = Okay, 60-79% = Average, below 60% = Needs support
const band = (p) => (p >= 100 ? ["Strong", "s"] : p >= 80 ? ["Okay", "o"] : p >= 60 ? ["Average", "a"] : ["Needs support", "n"]);

// ------------------------------ web (radar) chart, single series ------------------------------
function radar(size = 290) {
  const c = size / 2;
  const R = c - 58;
  const padX = 62;
  const n = CH.length;
  const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i, r) => [c + r * Math.cos(ang(i)), c + r * Math.sin(ang(i))];
  const ring = (p) => CH.map((_, i) => pt(i, (R * p) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
  const marked = [60, 80];
  const grid = [20, 40, 60, 80, 100]
    .map((p) => `<polygon points="${ring(p)}" fill="none" stroke="${marked.includes(p) ? "#9aa6bf" : "#e4e7ef"}" stroke-width="${marked.includes(p) ? 1.2 : 1}" ${marked.includes(p) ? 'stroke-dasharray="4 4"' : ""}/>`)
    .join("");
  const spokes = CH.map((_, i) => {
    const [x, y] = pt(i, R);
    return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e4e7ef"/>`;
  }).join("");
  const shape = CH.map((ch, i) => pt(i, (R * ch.pct) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
  const dots = CH.map((ch, i) => {
    const [x, y] = pt(i, (R * ch.pct) / 100);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="#13213f" stroke="#fff" stroke-width="2"/>`;
  }).join("");
  const labels = CH.map((ch, i) => {
    const [x, y] = pt(i, R + 28);
    const a = Math.cos(ang(i));
    const anchor = Math.abs(a) < 0.2 ? "middle" : a > 0 ? "start" : "end";
    const weak = ch.pct < 60;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="11" fill="${weak ? "#b3261e" : "#36405a"}" font-weight="${weak ? 700 : 500}">${ch.short}<tspan x="${x.toFixed(1)}" dy="12.5" font-size="10" fill="${weak ? "#b3261e" : "#6b7591"}">${ch.pct}%</tspan></text>`;
  }).join("");
  const [lx, ly60] = pt(0, R * 0.6);
  const [, ly80] = pt(0, R * 0.8);
  return `<svg viewBox="${-padX} 0 ${size + 2 * padX} ${size}" width="${size + 2 * padX}" height="${size}" role="img" aria-label="Chapter-wise strength web chart">
    ${grid}${spokes}
    <text x="${lx + 4}" y="${ly60 - 3}" font-size="9" fill="#6b7591">60</text><text x="${lx + 4}" y="${ly80 - 3}" font-size="9" fill="#6b7591">80</text>
    <polygon points="${shape}" fill="rgba(19,33,63,.16)" stroke="#13213f" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${labels}</svg>`;
}

const rows = CH.map((c) => {
  const [b, cls] = band(c.pct);
  const l = c.max - c.got;
  return `<tr><td>${c.name}</td><td class="num">${c.got}/${c.max}</td><td><div class="bar"><i class="${cls}" style="width:${c.pct}%"></i></div></td><td class="num">${c.pct}%</td><td><span class="pill ${cls}">${b}</span></td><td class="lostc">${l ? `&minus;${l}` : ""}</td></tr>`;
}).join("");
const diff = DIFF.map((d) => {
  const p = Math.round((100 * d.got) / d.max);
  const [, cls] = band(p);
  return `<div class="drow"><span class="dk">${d.k}</span><div class="bar"><i class="${cls}" style="width:${p}%"></i></div><span class="dv">${d.got}/${d.max}</span><span class="dp">${p}%</span></div>`;
}).join("");
const lostCards = LOST.map(
  (l) => `<div class="lcard"><div class="ln">${l.n}<small>marks</small></div><div class="lw">${l.why}</div><ul>${l.where.map(([ch, n]) => `<li><span>${ch}</span><b>${n}</b></li>`).join("")}</ul><div class="lt">${l.tip}</div></div>`,
).join("");
const strong = CH.filter((c) => c.pct === 100);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=block" rel="stylesheet">
<style>
@page { size:A4; margin:0; }
* { box-sizing:border-box; margin:0; }
:root { --navy:#13213f; --gold:#f2c230; --ink:#1d2540; --muted:#6b7591; --line:#e4e7ef; --ok:#1e7a4c; --bad:#b3261e; }
html,body { width:794px; height:1123px; }
body { font-family:"Bricolage Grotesque","Segoe UI",sans-serif; color:var(--ink); background:#fff; position:relative; overflow:hidden; font-size:12px; }
.top { background:var(--navy); color:#fff; padding:16px 30px 14px; display:flex; align-items:center; gap:16px; }
.top img { width:64px; height:64px; }
.top h1 { font-size:21px; font-weight:800; letter-spacing:-.3px; }
.top .sub { color:#c8cfe0; font-size:12.5px; margin-top:2px; }
.tag { display:inline-block; vertical-align:middle; background:var(--gold); color:var(--navy); font-size:10px; font-weight:800; letter-spacing:3px; padding:2px 8px; border-radius:4px; margin-left:8px; transform:rotate(-3deg); }
.kpis { margin-left:auto; display:flex; gap:10px; }
.kpi { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.18); border-radius:10px; padding:7px 12px; text-align:center; min-width:104px; }
.kpi b { display:block; font-size:28px; font-weight:800; color:var(--gold); letter-spacing:-1px; line-height:1.05; }
.kpi span { font-size:10.5px; color:#c8cfe0; white-space:nowrap; }
.meta { display:flex; justify-content:space-between; gap:10px; white-space:nowrap; padding:8px 30px; background:#f6f7fb; border-bottom:1px solid var(--line); font-size:11px; color:var(--muted); }
.meta b { color:var(--ink); font-weight:700; }
.wrap { padding:11px 30px 0; }
h2 { font-size:14px; font-weight:800; color:var(--navy); margin:0 0 6px; letter-spacing:-.2px; }
h2 small { font-weight:500; color:var(--muted); font-size:11px; margin-left:6px; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); font-weight:700; padding:0 6px 4px; border-bottom:1.5px solid var(--line); }
td { padding:2px 6px; border-bottom:1px solid var(--line); vertical-align:middle; }
td.num { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; white-space:nowrap; }
td.lostc { text-align:right; color:var(--bad); font-weight:800; width:46px; }
.bar { height:7px; background:#eef0f6; border-radius:4px; overflow:hidden; min-width:60px; } .bar i { display:block; height:100%; border-radius:4px; }
i.s { background:#1e9e5a; } i.o { background:#3a7bd5; } i.a { background:#e0a400; } i.n { background:#d0312d; }
.pill { display:inline-block; font-size:10px; font-weight:700; border-radius:10px; padding:2px 8px; white-space:nowrap; }
.pill.s { background:#dcf3e6; color:#14663d; } .pill.o { background:#e1ecfb; color:#1f4f99; } .pill.a { background:#fbefd0; color:#8a5a00; } .pill.n { background:#fbe0de; color:var(--bad); }
.grid2 { display:grid; grid-template-columns: 386px 1fr; gap:16px; margin-top:8px; align-items:start; }
.legend { font-size:10.5px; color:var(--muted); margin-top:-10px; }
.legend i { display:inline-block; width:18px; border-top:2px dashed #9aa6bf; vertical-align:middle; margin:0 4px 0 0; }
.drow { display:grid; grid-template-columns:58px 1fr 44px 38px; gap:8px; align-items:center; padding:4px 0; border-bottom:1px solid var(--line); }
.dk { font-weight:800; color:var(--navy); } .dv { text-align:right; font-weight:700; } .dp { text-align:right; color:var(--muted); }
.box { border-radius:10px; padding:8px 11px; font-size:11.5px; margin-top:10px; } .box h3 { font-size:12.5px; font-weight:800; margin-bottom:4px; }
.box.g { background:#eaf6ef; } .box.g h3 { color:var(--ok); } .box.b { background:#eef1f8; } .box.b h3 { color:var(--navy); }
.box ul { padding-left:16px; } .box li { margin:1px 0; line-height:1.3; }
/* the highlight: where the marks were lost */
.lost { margin-top:8px; border:2.5px solid var(--bad); border-radius:14px; background:#fff6f5; padding:10px 14px 12px; position:relative; }
.lost h2 { color:var(--bad); font-size:17px; margin-bottom:6px; }
.lost h2 span { background:var(--bad); color:#fff; border-radius:6px; padding:0 7px; margin:0 2px; }
.lcards { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; }
.lcard { background:#fff; border-radius:10px; padding:8px 10px; box-shadow:0 1px 0 #f3d2cf; border:1px solid #f3d2cf; }
.ln { font-size:30px; font-weight:800; color:var(--bad); line-height:1; } .ln small { font-size:11px; color:var(--muted); font-weight:600; margin-left:4px; }
.lw { font-size:13px; font-weight:800; color:var(--navy); margin:2px 0 4px; }
.lcard ul { list-style:none; padding:0; } .lcard li { display:flex; justify-content:space-between; font-size:11px; color:#3c4560; padding:1.5px 0; border-bottom:1px dotted #eccac6; } .lcard li b { color:var(--bad); }
.lt { font-size:10.5px; color:#6b4a47; margin-top:5px; line-height:1.3; }
.pen { font-family:"Caveat",cursive; color:var(--bad); font-size:21px; line-height:1.05; margin-top:8px; }
.pen b { background:linear-gradient(transparent 55%, #ffe58a 55%); font-weight:700; }
/* booking strip */
.cta { position:absolute; left:30px; right:30px; bottom:40px; background:var(--navy); color:#fff; border-radius:14px; padding:12px 16px; display:flex; align-items:center; gap:16px; }
.cta img { width:78px; height:78px; background:#fff; padding:5px; border-radius:8px; }
.cta h3 { font-size:17px; font-weight:800; } .cta p { font-size:11.5px; color:#c8cfe0; margin-top:2px; } .cta .ph { margin-left:auto; text-align:right; } .cta .ph b { font-size:20px; color:var(--gold); display:block; white-space:nowrap; } .cta .ph span { font-size:10.5px; color:#c8cfe0; white-space:nowrap; }
.foot { position:absolute; left:0; right:0; bottom:0; padding:8px 30px; border-top:1px solid var(--line); display:flex; justify-content:space-between; font-size:10px; color:var(--muted); background:#fafbfd; }
</style></head><body>
<div class="top">
  <img src="${logo}" alt="Rahul Shah Classes">
  <div><h1>Progress report <span class="tag">SAMPLE</span></h1><div class="sub">Sample Student · Class 10 CBSE · Maths · Paper 4</div></div>
  <div class="kpis">
    <div class="kpi"><b>${total}/${max}</b><span>${Math.round((100 * total) / max)}% · was 66% last paper</span></div>
    <div class="kpi"><b>Rank ${RANK.rank}</b><span>of ${RANK.of} who took this paper</span></div>
  </div>
</div>
<div class="meta"><span>Paper: <b>C10-MAT-P4-CBSE</b></span><span>Questions: <b>38</b></span><span>Submitted: <b>Thu, 8:05 pm</b></span><span>Report: <b>Sat (within 2 days)</b></span><span>Checked by: <b>Rahul Shah</b></span></div>
<div class="wrap">
  <h2>Chapter-wise marks <small>Strong: full marks · Okay: 80%+ · Average: 60-79% · Needs support: below 60%</small></h2>
  <table><thead><tr><th>Chapter</th><th style="text-align:right">Marks</th><th></th><th style="text-align:right">%</th><th>Strength</th><th style="text-align:right">Lost</th></tr></thead><tbody>${rows}</tbody></table>

  <div class="lost">
    <h2>Where the <span>${lost}</span> marks were lost</h2>
    <div class="lcards">${lostCards}</div>
    <div class="pen"><b>${LOST[0].n} of ${lost} lost marks were careless slips.</b> Checking every answer could make it ${total + LOST[0].n}/${max}.</div>
  </div>

  <div class="grid2">
    <div>
      <h2>Strengths and weaknesses at a glance</h2>
      ${radar(262)}
      <div class="legend">Shaded shape: this paper's score in each chapter. <i></i>dashed rings: 60% and 80%.</div>
    </div>
    <div>
      <h2>Marks by question difficulty</h2>
      ${diff}
      <div class="box b"><h3>Next steps this week</h3><ul><li>Redo questions 14, 21, 29, 33, 36</li><li>10 mixed Quadratics problems a day</li><li>Read the explained answers before Monday</li></ul></div>
    </div>
  </div>
</div>
<div class="cta">
  <img src="${qr}" alt="WhatsApp QR">
  <div><h3>Book a 1:1 session to go through this report</h3><p>We'll walk through every lost mark, fix the weak chapters and plan the next two weeks. Scan to message on WhatsApp.</p></div>
  <div class="ph"><b>${PHONE}</b><span>Call or WhatsApp · Rahul Shah</span></div>
</div>
<div class="foot"><span>Explained answers for all 38 questions come with this report as a separate PDF.</span><span>Sample report · marks are never shared in any group</span></div>
</body></html>`;

fs.writeFileSync(path.join(here, "sample-report-class10-maths.html"), html);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2.5 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
// The booking strip sits at the bottom: make sure the content above never runs under it
const clash = await page.evaluate(() => document.querySelector(".wrap").getBoundingClientRect().bottom - document.querySelector(".cta").getBoundingClientRect().top);
await page.screenshot({ path: path.join(here, "sample-report-class10-maths.png"), clip: { x: 0, y: 0, width: 794, height: 1123 } });
await page.pdf({ path: path.join(here, "sample-report-class10-maths.pdf"), format: "A4", printBackground: true, pageRanges: "1" });
await browser.close();
console.log(`made sample-report-class10-maths.png and .pdf; total ${total}/${max}, lost ${lost}; content ${clash > 0 ? `OVERLAPS the booking strip by ${Math.round(clash)}px` : `clear of the booking strip by ${Math.round(-clash)}px`}`);
