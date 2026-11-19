// npm run exam-prep:seed            chapter lists, message templates, consent text v1 (safe to re-run)
// npm run exam-prep:seed -- --demo  also a demo programme with fake students, clearly marked demo
//
// Runs only against an Exam Prep database (rsc_exam_prep or rsc_exam_prep_test). Settings need no seed:
// every setting has its default in code until the teacher changes it.
import fs from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }

export async function seedBase() {
  const { epdb } = await import("../db");
  const { NCERT } = await import("./chapters");
  const { seedTemplates } = await import("../services/messaging");
  const { seedConsentText } = await import("../services/people");
  const { BOARDS } = await import("../domain/programme");
  for (const [k, chapters] of Object.entries(NCERT)) {
    const [klass, subject] = k.split("|");
    for (const board of BOARDS)
      await epdb.chapterList.upsert({ where: { klass_subject_board: { klass: Number(klass), subject: subject!, board } }, create: { klass: Number(klass), subject: subject!, board, chapters }, update: {} });
  }
  await seedTemplates();
  await seedConsentText();
}

/** A small demo programme: 8 fake Class 10 CBSE students (names start with "Demo"), one paper. */
export async function seedDemo() {
  const { epdb } = await import("../db");
  const { addStudent } = await import("../services/people");
  if (await epdb.student.count({ where: { isDemo: true } })) return;
  for (let i = 1; i <= 8; i++)
    await addStudent({
      name: `Demo Student ${i}`,
      klass: 10,
      board: "CBSE",
      subjects: ["Maths", "Science"],
      parentName: `Demo Parent ${i}`,
      parentWhatsapp: `+9190000000${String(i).padStart(2, "0")}`,
      parentEmail: i % 2 ? `demo.parent${i}@example.invalid` : "",
      language: i === 3 ? "hi" : "en",
      consent: true,
      rankConsent: i !== 2,
      reportTiming: "same",
      source: "teacher",
      isDemo: true,
    });
}

async function main() {
  const url = process.env.EXAM_PREP_DATABASE_URL ?? "";
  const db = new URL(url).pathname.replace(/^\//, "");
  console.log(`database: ${db}`);
  if (!/^rsc_exam_prep(_test)?$/.test(db)) throw new Error(`Refusing: ${db} is not an Exam Prep database`);
  await seedBase();
  if (process.argv.includes("--demo")) await seedDemo();
  const { epdb } = await import("../db");
  console.log(`chapter lists: ${await epdb.chapterList.count()}, templates: ${await epdb.messageTemplate.count()}, consent texts: ${await epdb.consentText.count()}, demo students: ${await epdb.student.count({ where: { isDemo: true } })}`);
  await epdb.$disconnect();
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
