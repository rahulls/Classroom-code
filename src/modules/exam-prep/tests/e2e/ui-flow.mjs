// End-to-end UI flow (spec section 8): R1, R2, R4, R5, R7, R8 through the real screens, including a
// phone-sized viewport. Drives the installed Microsoft Edge with playwright-core.
//
// Needs a test server on port 4313 using ONLY the test databases (see README "End-to-end UI test"):
//   node src/modules/exam-prep/tests/e2e/ui-flow.mjs
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";

const BASE = process.env.EP_E2E_BASE ?? "http://localhost:4313";
const ok = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
const go = (p) => page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
/** Submits a form and waits for its result message. */
async function submitIn(form, button) {
  const msg = form.locator("p.rounded-md").first();
  // The server action's reply, then the form idle again ("Working…" gone)
  const reply = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"], { timeout: 300_000 });
  await form.getByRole("button", { name: button }).click();
  await reply;
  await page.waitForFunction((el) => ![...el.querySelectorAll("button[type=submit]")].some((b) => b.disabled) && !!el.querySelector("p.rounded-md"), await form.elementHandle(), { timeout: 60_000 });
  await page.waitForTimeout(150);
  return msg.innerText();
}

try {
  console.log("R1 setup and sign-in");
  await go("/exam-prep");
  ok(page.url().endsWith("/exam-prep/setup"), "first visit goes to setup");
  await page.fill("input[name=username]", "teacher");
  await page.fill("input[name=password]", "correct-horse-battery");
  await page.fill("input[name=confirm]", "correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${BASE}/exam-prep`);
  ok((await page.locator("h1").innerText()) === "Today", "signed in to Today");

  console.log("R14 settings");
  await go("/exam-prep/settings");
  const minForm = page.locator("form", { has: page.locator('input[name=key][value="cohort.minSize"]') });
  await minForm.locator("input[name=value]").fill("1");
  ok(/at least|greater|>=|too small/i.test(await submitIn(minForm, "Save")), "an invalid setting is rejected");
  await minForm.locator("input[name=value]").fill("3");
  ok(/saved/i.test(await submitIn(minForm, "Save")), "minimum cohort set to 3");

  console.log("R1 intake: CSV import and the add form");
  await go("/exam-prep/students");
  const csv = [
    "Student name,Class,Board,Subjects,Parent name,Parent WhatsApp,Parent email,Report language,Parent consent,Rank consent,Report timing",
    "UI Aarav,10,CBSE,Maths,UI Parent A,+919711100001,ui.a@example.invalid,English,Yes,Yes,Same",
    "UI Diya,10,CBSE,Maths,UI Parent D,+919711100002,,Hindi,Yes,Yes,Same",
    "UI Kabir,10,CBSE,Maths,UI Parent K,+919711100003,,English,Yes,No,After",
  ].join("\n");
  const importForm = page.locator("form", { has: page.locator("input[name=csv]") });
  await importForm.locator("input[name=csv]").setInputFiles({ name: "intake.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  ok(/Imported 3/.test(await submitIn(importForm, "Import")), "imported 3 students from the form CSV");
  const add = page.locator("form", { has: page.locator("input[name=parentName]") });
  ok((await add.locator("input[name=stateBoard]").count()) === 0, "State board fields hidden for CBSE");
  await add.locator("select[name=board]").selectOption("State");
  ok((await add.locator("input[name=stateBoard]").count()) === 1, "State board fields appear for State board");
  await add.locator("select[name=board]").selectOption("CBSE");
  await add.locator("select[name=klass]").selectOption("9");
  ok((await add.locator('input[name="subjects[]"][value="Physics"]').count()) === 0, "Class 9 can't pick Physics");
  await add.locator("select[name=klass]").selectOption("10");
  await add.locator("input[name=name]").fill("UI Meera");
  await add.locator("input[name=parentName]").fill("UI Parent M");
  await add.locator("input[name=parentWhatsapp]").fill("+919711100004");
  await add.locator("input[name=consent]").check();
  await add.locator("input[name=rankConsent]").check();
  ok(/Added EP-/.test(await submitIn(add, "Add student")), "added a student through the form");

  console.log("R1 number verification");
  await go("/exam-prep/verify");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Replied YES: verified" }).first().click();
    await page.waitForTimeout(800);
    await go("/exam-prep/verify");
  }
  ok((await page.getByText("Every parent number is verified.").count()) === 1, "all four numbers verified");

  console.log("R2 paper: questions, checks, publish");
  await go("/exam-prep/papers");
  const np = page.locator("form", { has: page.locator("input[name=number]") });
  await np.locator("select[name=klass]").selectOption("10");
  await np.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/exam-prep\/papers\/C10-MAT-P1-CBSE$/);
  const qf = () => page.locator("form", { has: page.locator("textarea[name=text]") });
  const addQ = async (q) => {
    const f = qf();
    await f.locator("select[name=sectionId]").selectOption({ label: q.section });
    await f.locator("select[name=type]").selectOption(q.type);
    await f.locator("select[name=chapter]").selectOption(q.chapter);
    await f.locator("input[name=topic]").fill("Practice");
    await f.locator("input[name=marks]").fill(String(q.marks));
    await f.locator("textarea[name=text]").fill(q.text);
    if (q.type === "mcq") {
      for (const o of ["a", "b", "c", "d"]) await f.locator(`input[name=${o}]`).fill(`Option ${o}`);
      await f.locator("select[name=correctOption]").selectOption("A");
    } else await f.locator("textarea[name=scheme]").fill(`Method: ${q.marks / 2}\nAnswer: ${q.marks / 2}`);
    ok(/added/i.test(await submitIn(f, "Add question")), `added ${q.type} on ${q.chapter}`);
  };
  await addQ({ section: "A (mcq)", type: "mcq", chapter: "Real Numbers", marks: 1, text: "Which of these is irrational?" });
  await addQ({ section: "A (mcq)", type: "mcq", chapter: "Polynomials", marks: 1, text: "Degree of a quadratic polynomial?" });
  await addQ({ section: "D (long)", type: "long", chapter: "Quadratic Equations", marks: 4, text: "Solve x^2 - 5x + 6 = 0." });
  await addQ({ section: "D (long)", type: "long", chapter: "Statistics", marks: 4, text: "Find the mean of 2, 4, 6, 8." });
  await go("/exam-prep/papers/C10-MAT-P1-CBSE");
  ok((await page.getByText("Marks by chapter").innerText()).includes("Quadratic Equations 4"), "chapter totals shown");
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByText(/Published \(10 marks\)/).waitFor({ timeout: 120_000 });
  ok(true, "published; paper, key and solutions PDFs made");

  console.log("R4 file sheets");
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  const sheet = Buffer.from(await doc.save());
  await go("/exam-prep/papers/C10-MAT-P1-CBSE");
  const opts = await page.locator("select[name=studentId] option").allInnerTexts();
  ok(opts.length === 4, "four students on the tracker can be filed");
  for (const [i, label] of opts.entries()) {
    const f = page.locator("form", { has: page.locator('input[name="files[]"]') });
    await f.locator("select[name=studentId]").selectOption({ label });
    await f.locator('input[name="files[]"]').setInputFiles({ name: `sheet${i}.pdf`, mimeType: "application/pdf", buffer: sheet });
    await f.locator("input[name=mcq]").fill(i % 2 ? "AB" : "AA");
    ok(/Filed/.test(await submitIn(f, "File the sheet")), `filed ${label.trim()}`);
    await go("/exam-prep/papers/C10-MAT-P1-CBSE");
  }
  ok((await page.getByText("Tracker: 4 of 4 submitted").count()) === 1, "tracker shows 4 of 4");

  console.log("R5 marking: AI proposals and keyboard review");
  await go("/exam-prep/papers/C10-MAT-P1-CBSE/marking");
  await page.getByRole("button", { name: "Propose marks with AI" }).click();
  await page.getByText(/AI proposed 8 marks/).waitFor({ timeout: 60_000 });
  ok(true, "AI (stub) proposed marks for 8 written answers");
  for (let guard = 0; guard < 10; guard++) {
    await go("/exam-prep/papers/C10-MAT-P1-CBSE/marking");
    if (await page.getByText("Nothing needs review.").count()) break;
    await page.locator("iframe").waitFor();
    for (let k = 0; k < 4; k++) {
      await page.keyboard.press("a");
      await page.waitForTimeout(400);
    }
  }
  ok((await page.getByText("Nothing needs review.").count()) === 1, "every proposal reviewed with the keyboard");
  await page.getByRole("button", { name: "Finish marking (→ marked)" }).click();
  await page.getByText(/Marked\. Ranks computed/).waitFor();
  ok(true, "paper moved to marked");

  console.log("R7 reports");
  await go("/exam-prep/papers/C10-MAT-P1-CBSE");
  await page.getByRole("button", { name: "Generate reports" }).click();
  await page.getByText(/8 new reports/).waitFor({ timeout: 300_000 });
  ok(true, "8 reports generated (4 student + 4 parent)");
  await page.getByRole("button", { name: "Approve and deliver" }).click();
  await page.getByText(/reports approved/).waitFor({ timeout: 120_000 });
  await go("/exam-prep/reports");
  const queued = await page.getByRole("button", { name: "Sent ✓" }).count();
  ok(queued === 7, `WhatsApp queue has 7 (4 student + 3 parents without email); got ${queued}`);
  const hindi = page.locator("div.card", { hasText: "UI Diya" }).filter({ hasText: "parent report" });
  const href = await hindi.getByRole("link", { name: "⬇ PDF" }).getAttribute("href");
  const pdfRes = await page.request.get(`${BASE}${href}`);
  const pdfBytes = Buffer.from(await pdfRes.body());
  const pdf = await PDFDocument.load(pdfBytes);
  ok(pdf.getPageCount() === 1, "the Hindi parent report is one page");
  ok(/Nirmala/i.test(pdfBytes.toString("latin1")), "the Hindi report embeds the Devanagari font (Nirmala UI)");
  const anon = await (await browser.newContext()).request.get(`${BASE}${href}`);
  ok(anon.status() === 403, "the same file link without the teacher session is refused (403)");

  console.log("R8 ranks (teacher-only)");
  await go("/exam-prep/ranks");
  const tell = await page.getByRole("button", { name: "Mark told" }).count();
  ok(tell === 3, `telling list has the 3 students with rank consent (Kabir said no); got ${tell}`);
  ok((await page.getByText(/Rank \d of 4/).count()) >= 1, "telling sentences show rank of 4");

  console.log("Mobile viewport");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await ctx.storageState() });
  const m = await phone.newPage();
  for (const p of ["/exam-prep", "/exam-prep/students", "/exam-prep/reports", "/exam-prep/papers/C10-MAT-P1-CBSE"]) {
    await m.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 2, `${p} fits a 390px phone (overflow ${over}px)`);
  }
  await m.screenshot({ path: process.env.EP_E2E_SHOT ?? "ep-mobile.png", fullPage: false });
  console.log("\nUI flow passed.");
} catch (e) {
  console.error(e.message);
  await page.screenshot({ path: process.env.EP_E2E_FAIL ?? "ep-e2e-failure.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
