// End-to-end: uploaded PDF papers marked row by row, and questions imported from CSV, through the real
// screens in Edge. Same test server as ui-flow.mjs (port 4313, test databases only), on an EMPTY test DB.
//   node src/modules/exam-prep/tests/e2e/rows-flow.mjs [screenshot-dir]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.EP_E2E_BASE ?? "http://localhost:4313";
const SHOTS = process.argv[2];
const root = path.resolve(import.meta.dirname, "../../../../..");
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

async function pdf(text) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 18, font: f });
  return Buffer.from(await d.save());
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
const go = (p) => page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
async function submitIn(form, button) {
  const reply = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 300_000 });
  await form.getByRole("button", { name: button }).click();
  await reply;
  await page.waitForFunction((el) => ![...el.querySelectorAll("button[type=submit]")].some((b) => b.disabled) && !!el.querySelector("p.rounded-md"), await form.elementHandle(), { timeout: 60_000 });
  await page.waitForTimeout(200);
  return form.locator("p.rounded-md").first().innerText();
}
const shot = async (name) => SHOTS && (await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }));

try {
  console.log("setup");
  await go("/exam-prep");
  if (page.url().endsWith("/setup")) {
    await page.fill("input[name=username]", "teacher");
    await page.fill("input[name=password]", "correct-horse-battery");
    await page.fill("input[name=confirm]", "correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(`${BASE}/exam-prep`);
  }
  await go("/exam-prep/students");
  const csv = "Student name,Class,Board,Subjects,Parent name,Parent WhatsApp,Parent email,Report language,Parent consent,Rank consent,Report timing\nRow Aarav,10,CBSE,Maths,Row Parent,+919711100071,,English,Yes,Yes,Same\n";
  const importForm = page.locator("form", { has: page.locator("input[name=csv]") });
  await importForm.locator("input[name=csv]").setInputFiles({ name: "intake.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  ok(/1/.test(await submitIn(importForm, "Import")), "student imported");

  console.log("marking format from CSV");
  await go("/exam-prep/papers");
  const fmtForm = page.locator("form", { has: page.locator("textarea[name=rows]") });
  await fmtForm.locator("input[name=csv]").setInputFiles(path.join(root, "design/marking-formats/cbse-class10-maths-standard-041.csv"));
  ok(/53 answer rows/.test(await submitIn(fmtForm, "Save format")), "CBSE Class 10 Maths format saved (53 rows)");
  await page.reload({ waitUntil: "networkidle" });
  ok(await page.locator("#formats").getByText("80", { exact: true }).isVisible(), "format listed with 80 marks");

  console.log("uploaded paper takes the format");
  const newForm = page.locator("form", { has: page.locator("select[name=mode]") });
  await newForm.locator("select[name=klass]").selectOption("10");
  await newForm.locator("input[name=number]").fill("5");
  await newForm.locator("select[name=mode]").selectOption("upload");
  await newForm.locator("input[name=file]").setInputFiles({ name: "paper5.pdf", mimeType: "application/pdf", buffer: await pdf("Practice paper 5") });
  await newForm.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/papers\/C10-MAT-P\d-CBSE$/, { timeout: 120_000 });
  await go("/exam-prep/papers/C10-MAT-P5-CBSE");
  ok(await page.getByText("53 rows · 80 marks · 9 OR choices").isVisible(), "paper shows 53 rows, 80 marks, 9 OR choices");
  await shot("1-paper-rows");
  const published = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 300_000 });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await published;
  await page.waitForTimeout(1500);
  await go("/exam-prep/papers/C10-MAT-P5-CBSE");
  ok(await page.getByText("status published").isVisible(), "paper published");
  const fileForm = page.locator("form", { has: page.locator("select[name=studentId]") });
  await fileForm.locator("select[name=studentId]").selectOption({ index: 1 });
  await fileForm.locator('input[name="files[]"]').setInputFiles({ name: "sheet.pdf", mimeType: "application/pdf", buffer: await pdf("Answer sheet: Row Aarav") });
  await submitIn(fileForm, "File the sheet");

  console.log("row marking");
  await go("/exam-prep/papers/C10-MAT-P5-CBSE/marking");
  ok(await page.locator("iframe").isVisible(), "answer sheet shown on the left");
  const grid = page.locator("form", { has: page.locator('input[name="m:1"]') });
  await grid.locator('input[name="m:1"]').fill("1");
  await grid.locator('input[name="m:2"]').fill("0");
  await grid.locator('select[name="t:2"]').selectOption("concept");
  await grid.locator('input[name="m:21.A"]').fill("2");
  await grid.locator('input[name="m:21.B"]').fill("1");
  ok(await page.getByText("Two OR alternatives both have marks").isVisible(), "OR clash is flagged while typing");
  ok(/alternatives/.test(await submitIn(grid, "Save marks")), "server refuses two marked alternatives");
  await grid.locator('input[name="m:21.B"]').fill("");
  await grid.getByRole("button", { name: "5", exact: true }).first().click(); // full marks on Q32
  ok(/Saved\. 8 \/ 80/.test(await submitIn(grid, "Save marks")), "marks saved: 8 / 80");
  await shot("2-row-marking");
  await go("/exam-prep/papers/C10-MAT-P5-CBSE");
  ok(await page.getByText("8 / 80").first().isVisible(), "tracker shows the score");

  console.log("questions from CSV");
  await go("/exam-prep/papers");
  await newForm.locator("select[name=klass]").selectOption("10");
  await newForm.locator("input[name=number]").fill("6");
  await newForm.locator("select[name=mode]").selectOption("questions");
  await newForm.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/papers\/C10-MAT-P\d-CBSE$/, { timeout: 120_000 });
  await go("/exam-prep/settings/chapters");
  await go("/exam-prep/papers/C10-MAT-P6-CBSE");
  const imp = page.locator("form", { has: page.locator('input[name=file][accept=".json,.csv"]') });
  await imp.locator("input[name=file]").setInputFiles(path.join(root, "design/sample-papers/cbse-class10-maths-practice-1.csv"));
  const r = await submitIn(imp, "Import");
  ok(/Imported 38 questions|is not in the chapter list/.test(r), `CSV import: ${r.slice(0, 120)}`);
  const t = await page.request.get(`${BASE}/exam-prep/templates?kind=questions`);
  ok(t.status() === 200 && (await t.text()).includes("or_text"), "questions CSV template downloads");
  console.log("ALL PASSED");
} catch (e) {
  await shot("failure");
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
