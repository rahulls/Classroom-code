// Free weekly test papers flyer: designed as a marked answer sheet.
//   node design/flyers/make-flyer.mjs   → design/flyers/weekly-papers-flyer.png (1080x1350, WhatsApp/Instagram)
//                                        design/flyers/weekly-papers-flyer.pdf (same design, for printing)
// Edit the TEXT block below and re-run. Rendered by the installed Microsoft Edge (playwright-core).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));

const TEXT = {
  phone: "+91 95603 15528",
  waNumber: "919560315528",
  waMessage: "Hi Rahul, I'd like my child to join the free weekly test papers. Class: ",
  place: "Nikoo Homes 2",
};

const logo = `data:image/png;base64,${fs.readFileSync(path.join(here, "rs-logo.png")).toString("base64")}`;
const qr = await QRCode.toDataURL(`https://wa.me/${TEXT.waNumber}?text=${encodeURIComponent(TEXT.waMessage)}`, { margin: 0, width: 360, color: { dark: "#13213f", light: "#00000000" } });

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">
<style>
:root { --navy:#13213f; --gold:#c9a14a; --gold2:#f2c230; --red:#d0312d; --paper:#fbf8f0; --line:#c9d6ec; }
* { box-sizing:border-box; margin:0; }
html,body { width:1080px; height:1350px; }
body { background:var(--navy); font-family:"Bricolage Grotesque", "Segoe UI", sans-serif; color:var(--navy); position:relative; overflow:hidden; }
/* faint gold grid behind the sheet, like graph paper on a desk */
body::before { content:""; position:absolute; inset:0; background-image:linear-gradient(rgba(201,161,74,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(201,161,74,.09) 1px, transparent 1px); background-size:36px 36px; }
.sheet { position:absolute; left:70px; top:48px; width:940px; height:1240px; background:var(--paper); transform:rotate(-1.3deg); box-shadow:0 30px 60px rgba(0,0,0,.45), 0 2px 0 rgba(255,255,255,.4) inset;
  background-image:repeating-linear-gradient(to bottom, transparent 0 47px, var(--line) 47px 48px); background-position:0 150px; border-radius:6px; }
.sheet::before { content:""; position:absolute; top:0; bottom:0; left:104px; width:2px; background:rgba(208,49,45,.55); }
.holes span { position:absolute; left:38px; width:30px; height:30px; border-radius:50%; background:var(--navy); box-shadow:inset 0 3px 6px rgba(0,0,0,.6); }
.inner { position:absolute; left:140px; right:56px; top:34px; }
.head { display:flex; align-items:center; gap:22px; font-family:"JetBrains Mono", monospace; font-size:19px; letter-spacing:.5px; color:#57627d; }
.head img { width:108px; height:108px; filter:drop-shadow(0 4px 8px rgba(19,33,63,.25)); }
.head .meta div { border-bottom:2px dotted #9aa6bf; padding:4px 0; min-width:420px; }
.head .meta b { color:var(--navy); }
.q { margin-top:34px; font-family:"Caveat", cursive; color:var(--red); font-size:70px; line-height:.95; transform:rotate(-1deg); }
.q small { display:block; font-size:36px; color:#9a3a37; margin-top:10px; }
.answer { margin-top:26px; font-size:60px; font-weight:800; line-height:1.0; letter-spacing:-1.5px; }
.answer .hl { background:linear-gradient(transparent 58%, var(--gold2) 58%, var(--gold2) 92%, transparent 92%); padding:0 6px; }
.facts { margin-top:16px; max-width:700px; font-size:23px; font-weight:500; color:#36405a; line-height:1.45; }
.facts b { font-weight:800; color:var(--navy); }
.score { position:absolute; right:74px; top:318px; width:176px; height:176px; border:6px solid var(--red); border-radius:50%; transform:rotate(9deg); font-family:"Caveat", cursive; color:var(--red);
  display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 0 0 3px rgba(208,49,45,.15); }
.score .n { font-size:86px; line-height:.8; font-weight:700; }
.score .t { font-size:30px; }
/* what comes back: numbered like answers */
.back { margin-top:22px; display:grid; grid-template-columns: 1fr 320px; gap:30px; align-items:start; }
.list { list-style:none; padding:0; counter-reset:a; }
.list li { counter-increment:a; position:relative; padding-left:60px; margin-bottom:16px; font-size:25px; line-height:1.2; font-weight:700; }
.list li::before { content:"(" counter(a, lower-alpha) ")"; position:absolute; left:0; top:-2px; font-family:"Caveat", cursive; font-size:44px; color:var(--red); font-weight:700; }
.list li span { display:block; font-size:19px; font-weight:500; color:#5a647d; margin-top:4px; }
.when { font-family:"Caveat", cursive; font-size:38px; color:var(--red); margin:0 0 10px; transform:rotate(-1.5deg); }
/* the taped-on sample report */
.card { position:relative; background:#fff; border-radius:10px; padding:22px 22px 18px; transform:rotate(3deg); box-shadow:0 12px 26px rgba(19,33,63,.22); }
.card::before, .card::after { content:""; position:absolute; top:-16px; width:96px; height:30px; background:rgba(242,194,48,.78); box-shadow:0 1px 3px rgba(0,0,0,.12); }
.card::before { left:18px; transform:rotate(-8deg); } .card::after { right:18px; transform:rotate(7deg); }
.card h4 { font-size:15px; letter-spacing:2px; text-transform:uppercase; color:#8a93a9; font-weight:700; }
.card .tot { font-size:36px; font-weight:800; margin:4px 0 12px; }
.row { display:grid; grid-template-columns: 112px 1fr 44px; gap:8px; align-items:center; font-size:15px; font-weight:500; margin:7px 0; }
.bar { height:10px; background:#eef0f6; border-radius:5px; overflow:hidden; } .bar i { display:block; height:100%; border-radius:5px; }
.g { background:#2f9e62; } .y { background:var(--gold2); } .r { background:var(--red); }
.card .note { font-family:"Caveat", cursive; color:var(--red); font-size:25px; margin-top:8px; line-height:1; }
/* tear-off strip */
.tear { position:absolute; left:0; right:0; bottom:0; height:236px; border-top:3px dashed #9aa6bf; display:flex; align-items:center; gap:30px; padding:0 56px 0 140px; }
.tear::before { content:"cut here and keep"; position:absolute; top:-30px; right:60px; font-family:"Caveat", cursive; color:#8a93a9; font-size:24px; }
.tear img.qr { width:164px; height:164px; padding:10px; background:#fff; border-radius:12px; border:3px solid var(--navy); }
.tear .who { flex:1; }
.tear .join { font-size:20px; text-transform:uppercase; letter-spacing:3px; font-weight:700; color:#8a93a9; }
.tear .ph { font-size:52px; font-weight:800; letter-spacing:-1px; line-height:1.05; }
.tear .by { font-size:20px; font-weight:500; color:#36405a; margin-top:6px; }
.tear .by b { color:var(--navy); }
.tear .free { font-family:"Caveat", cursive; color:var(--red); font-size:34px; margin-top:2px; }
.stamp { position:absolute; right:36px; bottom:60px; font-size:16px; letter-spacing:2px; color:var(--gold); font-weight:700; text-transform:uppercase; transform:rotate(-90deg); transform-origin:right bottom; white-space:nowrap; }
</style></head><body>
<div class="sheet">
  <div class="holes"><span style="top:110px"></span><span style="top:560px"></span><span style="top:1010px"></span></div>
  <div class="inner">
    <div class="head">
      <img src="${logo}" alt="Rahul Shah Classes">
      <div class="meta">
        <div>NAME: <b>Your child</b></div>
        <div>CLASS: <b>9 / 10 / 11 / 12</b> &nbsp; BOARD: <b>CBSE · ICSE · State</b></div>
        <div>SUBJECT: <b>Maths · Science · Physics · Chemistry</b></div>
      </div>
    </div>
    <div class="q">Q. How ready is your child for the exam?<small>Show your working.</small></div>
    <div class="answer">A free test paper,<br><span class="hl">every week.</span></div>
    <div class="facts">On your child's own board and syllabus. Written at home, sent as a photo or PDF. <b>Marks are never shared in any group.</b></div>
    <div class="back">
      <div>
      <div class="when">Back to you within 2 days, privately:</div>
      <ol class="list">
        <li>Marks<span>for every question, checked by the tutor</span></li>
        <li>Chapter-wise report<span>strong chapters, weak chapters, what to practise next</span></li>
        <li>Explained answers<span>the full working for every question</span></li>
      </ol>
      </div>
      <div class="card">
        <h4>Sample report</h4>
        <div class="tot">62 / 80</div>
        <div class="row">Real Numbers<div class="bar"><i class="g" style="width:92%"></i></div>92%</div>
        <div class="row">Polynomials<div class="bar"><i class="g" style="width:83%"></i></div>83%</div>
        <div class="row">Trigonometry<div class="bar"><i class="y" style="width:70%"></i></div>70%</div>
        <div class="row">Quadratics<div class="bar"><i class="r" style="width:40%"></i></div>40%</div>
        <div class="note">Fix this one first &rarr;</div>
      </div>
    </div>
  </div>
  <div class="score"><span class="n">?</span><span class="t">out of 80</span></div>
  <div class="tear">
    <img class="qr" src="${qr}" alt="WhatsApp QR">
    <div class="who">
      <div class="join">Scan or WhatsApp to join</div>
      <div class="ph">${TEXT.phone}</div>
      <div class="by"><b>Rahul Shah</b>, IIT &amp; IIM alum · ${TEXT.place}</div>
      <div class="free">Free. No coaching commitment.</div>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync(path.join(here, "weekly-papers-flyer.html"), html);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(here, "weekly-papers-flyer.png"), clip: { x: 0, y: 0, width: 1080, height: 1350 } });
await page.pdf({ path: path.join(here, "weekly-papers-flyer.pdf"), width: "1080px", height: "1350px", printBackground: true, pageRanges: "1" });
await browser.close();
console.log("made weekly-papers-flyer.png and .pdf");
