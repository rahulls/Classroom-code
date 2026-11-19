// Renders a CBSE-format paper from its source (e.g. cbse-class10-maths-practice-1.mjs):
//   node design/sample-papers/make-cbse-paper.mjs [source.mjs]
// → <name>-paper.pdf (question paper), <name>-marking-scheme.pdf, <name>.json (Exam Prep import)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcFile = path.resolve(process.argv[2] ?? path.join(here, "cbse-class10-maths-practice-1.mjs"));
const { META, INSTRUCTIONS, SECTIONS, AR_DIRECTIONS, QUESTIONS } = await import(pathToFileURL(srcFile).href);
const base = path.join(here, path.basename(srcFile, ".mjs"));
const logo = `data:image/png;base64,${fs.readFileSync(path.join(here, "..", "flyers", "rs-logo.png")).toString("base64")}`;

// ------------------------------ checks: the paper must match the CBSE design ------------------------------
const expect = { A: [20, 1], B: [5, 2], C: [6, 3], D: [4, 5], E: [3, 4] };
for (const [sec, [n, m]] of Object.entries(expect)) {
  const qs = QUESTIONS.filter((q) => q.sec === sec);
  if (qs.length !== n || qs.some((q) => q.marks !== m)) throw new Error(`Section ${sec} must have ${n} questions of ${m} marks`);
}
QUESTIONS.forEach((q, i) => {
  if (q.n !== i + 1) throw new Error(`Question numbers must run 1-38 (found ${q.n} at ${i + 1})`);
  if (q.type === "mcq" && !(q.options?.length === 4 && "ABCD".includes(q.answer))) throw new Error(`Q${q.n}: four options and an answer`);
  const steps = (sch) => (sch ?? []).reduce((a, x) => a + x.marks, 0);
  if (q.scheme && steps(q.scheme) !== q.marks) throw new Error(`Q${q.n}: marking scheme adds to ${steps(q.scheme)}, not ${q.marks}`);
  if (q.or?.scheme && steps(q.or.scheme) !== q.marks) throw new Error(`Q${q.n} OR: marking scheme adds to ${steps(q.or.scheme)}`);
  if (q.parts) {
    if (q.parts.map((p) => p.marks).join() !== "1,1,2") throw new Error(`Q${q.n}: case parts must be 1, 1, 2`);
    q.parts.forEach((p) => {
      if (steps(p.scheme) !== p.marks || (p.or && steps(p.or.scheme) !== p.marks)) throw new Error(`Q${q.n} ${p.label}: scheme marks`);
    });
  }
});
const withChoice = (sec) => QUESTIONS.filter((q) => q.sec === sec && (q.or || q.parts?.some((p) => p.or))).map((q) => q.n);
if (withChoice("B").length !== 2 || withChoice("C").length !== 2 || withChoice("D").length !== 2 || withChoice("E").length !== 3) throw new Error("Internal choices must be 2 in B, C, D and in every 2-mark part of E");
if (QUESTIONS.reduce((a, q) => a + q.marks, 0) !== META.maxMarks) throw new Error("Total must be 80");

// ------------------------------ markup ------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (s) =>
  esc(s)
    .replace(/√\[([^\]]+)\]/g, '√<span class="rad">$1</span>')
    .replace(/\{([^{}|]+)\|([^{}]+)\}/g, '<span class="fr"><span>$1</span><span>$2</span></span>')
    // keep a minus sign with its number ("– 3"), and "fraction + fraction" on one line
    .replace(/– (?=[\w(√])/g, "–&nbsp;")
    .replace(/(<\/span><\/span>) ([+−=×]) (<span class="fr">)/g, "$1&nbsp;$2&nbsp;$3")
    .replace(/\n/g, "<br>");
const plain = (s) =>
  String(s)
    .replace(/√\[([^\]]+)\]/g, (_, x) => (/^[\w.]+$/.test(x) ? `√${x}` : `√(${x})`))
    .replace(/\{([^{}|]+)\|([^{}]+)\}/g, (_, a, b) => `${/^[\w.]+$/.test(a.trim()) ? a.trim() : `(${a.trim()})`}/${/^[\w.]+$/.test(b.trim()) ? b.trim() : `(${b.trim()})`}`);

const FIG = {
  bpt: `<svg width="190" height="140" viewBox="0 0 190 140" class="fig"><polygon points="95,10 15,128 175,128" fill="none" stroke="#000" stroke-width="1.4"/><line x1="63" y1="57" x2="127" y2="57" stroke="#000" stroke-width="1.4"/>
  <text x="91" y="8" font-size="12">A</text><text x="3" y="136" font-size="12">B</text><text x="178" y="136" font-size="12">C</text><text x="50" y="60" font-size="12">D</text><text x="131" y="60" font-size="12">E</text></svg>`,
};

const options = (q) => {
  const long = q.options.some((o) => plain(o).length > 22) || q.ar;
  if (q.ar) return "";
  return `<div class="opts ${long ? "two" : ""}">${q.options.map((o, i) => `<span>(${"ABCD"[i]}) ${html(o)}</span>`).join("")}</div>`;
};

function questionCell(q, alt = false) {
  const t = alt ? q.or : q;
  let body = `<div>${html(t.text)}</div>`;
  if (!alt && q.type === "mcq") body += options(q);
  if (t.figure) body += `<div class="figwrap">${FIG[t.figure]}</div>`;
  if (t.vi) body += `<div class="vi"><b>For visually Impaired Candidates:</b><br>${html(t.vi)}</div>`;
  return body;
}

function rowsFor(q) {
  if (q.type === "case") {
    let out = `<tr><td class="qn">${q.n}.</td><td>${html(q.stem)}`;
    if (q.table) out += `<table class="data"><tr>${q.table.head.map((h) => `<td>${html(h)}</td>`).join("")}</tr><tr>${q.table.row.map((h) => `<td>${html(h)}</td>`).join("")}</tr></table>`;
    if (q.after) out += `<div>${html(q.after)}</div>`;
    out += `<div class="based">Based on the above information, answer the following questions:</div></td><td class="mk"></td></tr>`;
    for (const p of q.parts) {
      out += `<tr><td></td><td><div class="partg"><span>${p.label}</span><span>${html(p.text)}</span></div></td><td class="mk">${p.marks}</td></tr>`;
      if (p.or) out += `<tr><td></td><td class="or">OR</td><td></td></tr><tr><td></td><td><div class="partg"><span>${p.or.label}</span><span>${html(p.or.text)}</span></div></td><td class="mk">${p.marks}</td></tr>`;
    }
    return out;
  }
  if (!q.or) return `<tr><td class="qn">${q.n}.</td><td>${questionCell(q)}</td><td class="mk">${q.marks}</td></tr>`;
  return `<tr><td class="qn">${q.n} (A).</td><td>${questionCell(q)}</td><td class="mk">${q.marks}</td></tr>
  <tr><td></td><td class="or">OR</td><td></td></tr>
  <tr><td class="qn">${q.n} (B).</td><td>${questionCell(q, true)}</td><td class="mk"></td></tr>`;
}

const STYLE = `
@page { size: A4; margin: 14mm 14mm 16mm; }
* { box-sizing: border-box; margin: 0; }
body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; line-height: 1.38; }
.header { display: flex; align-items: flex-start; gap: 12px; }
.titles { flex: 1; text-align: center; font-weight: bold; padding-top: 18px; }
.titles div { font-size: 13pt; } .titles .s { font-size: 14pt; }
.brand { flex: 0 0 214px; border: 1px solid #13213f; border-radius: 6px; padding: 6px 8px; font-family: Arial, sans-serif; font-size: 8.6pt; line-height: 1.5; }
.brand .top { display: flex; align-items: center; gap: 6px; border-bottom: 1px solid #c9a14a; padding-bottom: 4px; margin-bottom: 3px; }
.brand img { width: 40px; height: 40px; } .brand .bn { font-weight: bold; color: #13213f; font-size: 9.5pt; line-height: 1.15; } .brand .bn small { display: block; color: #9a7a2c; font-size: 7.5pt; letter-spacing: 1px; }
.brand .ln { display: flex; gap: 4px; } .brand .ln b { white-space: nowrap; } .brand .ln span { flex: 1; border-bottom: 1px dotted #555; min-height: 12px; }
.mm { display: flex; justify-content: space-between; font-weight: bold; margin: 8px 0 6px; padding-right: 0; }
.gi h3 { font-size: 12pt; font-weight: bold; text-decoration: underline; } .gi p { margin: 2px 0; }
.gi ol { list-style: none; padding: 0; } .gi li { display: grid; grid-template-columns: 34px 1fr; margin: 1.5px 0; text-align: justify; }
.sec { text-align: center; font-weight: bold; margin: 12px 0 2px; } .secsub { text-align: center; font-style: italic; margin-bottom: 4px; }
table.q { width: 100%; border-collapse: collapse; }
table.q th { text-align: left; font-weight: bold; border-bottom: 1px solid #000; padding: 2px 4px; }
table.q td { vertical-align: top; padding: 3px 4px; text-align: justify; }
td.qn { width: 58px; white-space: nowrap; } td.mk { width: 44px; text-align: center !important; }
table.q tr { page-break-inside: avoid; }
.or { text-align: center !important; font-weight: bold; padding: 1px !important; }
.opts { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 2px; } .opts.two { grid-template-columns: 1fr 1fr; }
.fr { display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; font-size: 0.92em; line-height: 1.05; margin: 0 2px; }
.fr > span:first-child { border-bottom: 1px solid #000; padding: 0 2px; }
.rad { border-top: 1px solid #000; padding-top: 1px; }
.ar { margin: 6px 0 2px; } .ar h4 { text-align: center; font-weight: bold; font-size: 12pt; } .ar ol { list-style: none; padding: 0; } .ar li { display: grid; grid-template-columns: 34px 1fr; }
.vi { margin-top: 4px; } .figwrap { text-align: center; margin: 4px 0; }
.partg { display: grid; grid-template-columns: 62px 1fr; } .based { margin-top: 3px; }
table.data { border-collapse: collapse; margin: 5px 0; font-size: 11pt; } table.data td { border: 1px solid #000; padding: 2px 7px; text-align: center; }
.end { text-align: center; margin-top: 14px; font-weight: bold; }
.ans { font-size: 11pt; } .ans .k { font-weight: bold; } .steps { margin: 2px 0 0 0; padding-left: 0; list-style: none; } .steps li { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dotted #999; }
`;

const header = (subtitle) => `<div class="header">
  <div class="titles"><div class="s">SUBJECT: ${META.subject}</div><div>${subtitle}</div><div>${META.klass}</div></div>
  <div class="brand">
    <div class="top"><img src="${logo}" alt=""><div class="bn">Rahul Shah Classes<small>WEEKLY TEST SERIES</small></div></div>
    <div class="ln"><b>Date:</b><span></span></div>
    <div class="ln"><b>Subject:</b>&nbsp;Maths Standard (041)</div>
    <div class="ln"><b>Class:</b>&nbsp;X &nbsp;&nbsp;<b>Board:</b>&nbsp;CBSE</div>
    <div class="ln"><b>Paper:</b>&nbsp;${META.paperCode}</div>
    <div class="ln"><b>Name:</b><span></span></div>
    <div class="ln"><b>Student code:</b><span></span></div>
  </div>
</div>`;

// ------------------------------ question paper ------------------------------
let body = header(META.title);
body += `<div class="mm"><span>Maximum Marks: ${META.maxMarks}</span><span>Time Allowed: ${META.time}</span></div>`;
body += `<div class="gi"><h3>General Instructions:</h3><p>Read the following instructions very carefully and strictly follow them:</p><ol>${INSTRUCTIONS.map((t, i) => `<li><span>(${["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][i]})</span><span>${html(t)}</span></li>`).join("")}</ol></div>`;
for (const sec of ["A", "B", "C", "D", "E"]) {
  const S = SECTIONS[sec];
  body += `<div class="sec">${S.head}</div><div class="secsub">${S.sub}${S.sub2 ? `<br>${S.sub2}` : ""}</div>`;
  body += `<table class="q">${sec === "A" ? `<tr><th>Q. No.</th><th>Questions</th><th style="text-align:center">Marks</th></tr>` : ""}`;
  for (const q of QUESTIONS.filter((x) => x.sec === sec)) {
    if (q.n === 19)
      body += `<tr><td colspan="3"><div class="ar"><h4>${AR_DIRECTIONS.title}</h4><div>${AR_DIRECTIONS.text}</div><div>${AR_DIRECTIONS.select}</div><ol>${AR_DIRECTIONS.options.map((o, i) => `<li><span>(${"ABCD"[i]})</span><span>${o}</span></li>`).join("")}</ol></div></td></tr>`;
    body += rowsFor(q);
  }
  body += `</table>`;
}
body += `<div class="end">*****</div>`;
const paperHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${META.paperCode}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

// ------------------------------ marking scheme ------------------------------
const stepList = (sch) => `<ul class="steps">${sch.map((x) => `<li><span>${html(x.step)}</span><b>${x.marks}</b></li>`).join("")}</ul>`;
let ms = header("MARKING SCHEME") + `<div class="mm"><span>Maximum Marks: ${META.maxMarks}</span><span>Time Allowed: ${META.time}</span></div>`;
for (const sec of ["A", "B", "C", "D", "E"]) {
  ms += `<div class="sec">${SECTIONS[sec].head}</div><table class="q ans"><tr><th>Q. No.</th><th>Answer / Value points</th><th style="text-align:center">Marks</th></tr>`;
  for (const q of QUESTIONS.filter((x) => x.sec === sec)) {
    if (q.type === "mcq") {
      ms += `<tr><td class="qn">${q.n}.</td><td><span class="k">(${q.answer}) ${q.ar ? "" : html(q.options["ABCD".indexOf(q.answer)])}</span><br>${html(q.solution)}</td><td class="mk">${q.marks}</td></tr>`;
    } else if (q.type === "case") {
      ms += `<tr><td class="qn">${q.n}.</td><td>${q.parts
        .map((p) => `<div><b>${p.label}</b>${stepList(p.scheme)}${p.or ? `<div class="or">OR</div><b>${p.or.label}</b>${stepList(p.or.scheme)}` : ""}</div>`)
        .join("")}</td><td class="mk">${q.marks}</td></tr>`;
    } else {
      ms += `<tr><td class="qn">${q.or ? `${q.n} (A).` : `${q.n}.`}</td><td>${html(q.solution)}${stepList(q.scheme)}</td><td class="mk">${q.marks}</td></tr>`;
      if (q.or) ms += `<tr><td></td><td class="or">OR</td><td></td></tr><tr><td class="qn">${q.n} (B).</td><td>${html(q.or.solution)}${stepList(q.or.scheme)}</td><td class="mk">${q.marks}</td></tr>`;
    }
  }
  ms += `</table>`;
}
const msHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${META.paperCode} marking scheme</title><style>${STYLE}</style></head><body>${ms}</body></html>`;

// ------------------------------ Exam Prep import (JSON) ------------------------------
const sectionType = { A: "mcq", B: "short", C: "short", D: "long", E: "case" };
const caseText = (q, which) =>
  [plain(q.stem), q.table ? `${q.table.head.join(" | ")}\n${q.table.row.join(" | ")}` : "", q.after ? plain(q.after) : "", ...q.parts.map((p) => (which === "B" && p.or ? `${p.or.label} ${plain(p.or.text)} [${p.marks}]` : `${p.label} ${plain(p.text)} [${p.marks}]`))]
    .filter(Boolean)
    .join("\n");
const caseScheme = (q, which) => q.parts.flatMap((p) => (which === "B" && p.or ? p.or.scheme : p.scheme).map((x) => ({ step: `${which === "B" && p.or ? p.or.label : p.label} ${plain(x.step)}`, marks: x.marks })));
const json = {
  paper: { title: META.title, code: META.paperCode, klass: 10, subject: "Maths", board: "CBSE", totalMarks: META.maxMarks, minutes: 180, format: "CBSE board paper (SQP 2026-27 design)" },
  questions: QUESTIONS.map((q) => {
    const row = { number: q.n, section: q.sec, chapter: q.ch, topic: q.topic, marks: q.marks, type: sectionType[q.sec] === "mcq" ? "mcq" : q.type, difficulty: q.diff };
    if (q.type === "mcq") return { ...row, text: plain(q.text), options: q.options.map(plain), correctOption: q.answer, solution: plain(q.solution) };
    if (q.type === "case")
      return { ...row, text: caseText(q, "A"), markingScheme: caseScheme(q, "A"), solution: plain(q.solution), or: { text: caseText(q, "B"), markingScheme: caseScheme(q, "B"), solution: plain(q.solution) } };
    const r = { ...row, text: plain(q.text), markingScheme: q.scheme.map((x) => ({ step: plain(x.step), marks: x.marks })), solution: plain(q.solution) };
    if (q.or)
      r.or = { text: plain(q.or.text) + (q.or.vi ? `\nFor visually impaired candidates: ${plain(q.or.vi)}` : ""), markingScheme: q.or.scheme.map((x) => ({ step: plain(x.step), marks: x.marks })), solution: plain(q.or.solution) };
    return r;
  }),
};
fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 2));

// ------------------------------ print ------------------------------
const browser = await chromium.launch({ channel: "msedge", headless: true });
const footer = `<div style="width:100%;font-family:'Times New Roman',serif;font-size:9pt;text-align:center;color:#000;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
for (const [name, doc] of [
  ["paper", paperHtml],
  ["marking-scheme", msHtml],
]) {
  const page = await browser.newPage();
  await page.setContent(doc, { waitUntil: "networkidle" });
  fs.writeFileSync(`${base}-${name}.html`, doc);
  await page.pdf({ path: `${base}-${name}.pdf`, format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" } });
  if (process.env.SHOTS) {
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.screenshot({ path: `${base}-${name}-p1.png`, fullPage: false });
  }
  await page.close();
}
await browser.close();
console.log(`made ${path.basename(base)}-paper.pdf, -marking-scheme.pdf and .json (${QUESTIONS.length} questions, ${META.maxMarks} marks; choices B ${withChoice("B")}, C ${withChoice("C")}, D ${withChoice("D")}, E ${withChoice("E")})`);
