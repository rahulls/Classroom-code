// Test environment: Exam Prep's own test database and a scratch storage folder. The real Exam Prep
// database and the classroom database are never used by tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const envFile = path.resolve(__dirname, "../../../../.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
}
const testUrl = process.env.EXAM_PREP_TEST_DATABASE_URL;
if (testUrl) {
  if (!/\/rsc_exam_prep_test(\?|$)/.test(testUrl)) throw new Error("EXAM_PREP_TEST_DATABASE_URL must point at rsc_exam_prep_test");
  process.env.EXAM_PREP_DATABASE_URL = testUrl;
}
process.env.EXAM_PREP_ENABLED = "true";
process.env.EXAM_PREP_STORAGE = fs.mkdtempSync(path.join(os.tmpdir(), "exam-prep-test-"));
process.env.EXAM_PREP_AI_ADAPTER = "stub";
process.env.EXAM_PREP_EMAIL_ADAPTER = "stub";
process.env.EXAM_PREP_PDF_ADAPTER = process.env.EXAM_PREP_PDF_ADAPTER ?? "stub";
