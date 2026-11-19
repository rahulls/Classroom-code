// Exam Prep migrations: applies prisma/exam-prep/migrations/<name>/migration.sql in order, or rolls the
// newest one back with its down.sql. Tracks what ran in the table _ep_migrations.
//
//   node scripts/exam-prep-migrate.mjs            apply pending (EXAM_PREP_DATABASE_URL)
//   node scripts/exam-prep-migrate.mjs --test     same, on EXAM_PREP_TEST_DATABASE_URL
//   node scripts/exam-prep-migrate.mjs --down     roll back the newest migration
//   node scripts/exam-prep-migrate.mjs --status   list applied / pending
//
// Safety (after the 2026-11-16 shadow-database incident): no shadow database, no Prisma reset, and the
// script refuses any database whose name does not start with "rsc_exam_prep". It never touches the
// classroom database.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
loadEnv();

const args = new Set(process.argv.slice(2));
const url = args.has("--test") ? process.env.EXAM_PREP_TEST_DATABASE_URL : process.env.EXAM_PREP_DATABASE_URL;
if (!url) {
  console.error("EXAM_PREP_DATABASE_URL (or EXAM_PREP_TEST_DATABASE_URL with --test) is not set.");
  process.exit(1);
}
const u = new URL(url);
const dbName = u.pathname.replace(/^\//, "");
console.log(`database: ${u.protocol}//${u.hostname}:${u.port}/${dbName}`);
if (!/^rsc_exam_prep(_test)?$/.test(dbName)) {
  console.error(`Refusing: "${dbName}" is not an Exam Prep database.`);
  process.exit(1);
}

const { PrismaClient } = require(path.join(root, "src/modules/exam-prep/generated/client"));
const db = new PrismaClient({ datasources: { db: { url } } });
const dir = path.join(root, "prisma/exam-prep/migrations");
const all = fs
  .readdirSync(dir)
  .filter((d) => fs.existsSync(path.join(dir, d, "migration.sql")))
  .sort();

/** Splits a SQL file into statements (handles $$ function bodies). */
function statements(sql) {
  const out = [];
  let cur = "";
  let dollar = false;
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line) && !dollar) continue;
    cur += line + "\n";
    if ((line.match(/\$\$/g) || []).length % 2 === 1) dollar = !dollar;
    if (!dollar && /;\s*$/.test(line)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function main() {
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS _ep_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.$queryRawUnsafe(`SELECT name FROM _ep_migrations`)).map((r) => r.name));
  if (args.has("--status")) {
    for (const m of all) console.log(`${done.has(m) ? "applied" : "pending"}  ${m}`);
    return;
  }
  if (args.has("--down")) {
    const last = [...all].reverse().find((m) => done.has(m));
    if (!last) return console.log("nothing to roll back");
    const down = path.join(dir, last, "down.sql");
    if (!fs.existsSync(down)) throw new Error(`${last} has no down.sql`);
    await db.$transaction([...statements(fs.readFileSync(down, "utf8")).map((s) => db.$executeRawUnsafe(s)), db.$executeRawUnsafe(`DELETE FROM _ep_migrations WHERE name = $1`, last)]);
    return console.log(`rolled back ${last}`);
  }
  for (const m of all) {
    if (done.has(m)) continue;
    const sql = fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8");
    await db.$transaction([...statements(sql).map((s) => db.$executeRawUnsafe(s)), db.$executeRawUnsafe(`INSERT INTO _ep_migrations (name) VALUES ($1)`, m)]);
    console.log(`applied ${m}`);
  }
  console.log("up to date");
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
