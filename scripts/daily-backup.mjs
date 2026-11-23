// Daily backup + code push (run by the "RSC Classroom daily backup" Windows task; install it with
// scripts\install-daily-backup.ps1). Safe to run any number of times a day: today's folder is rewritten.
//
//   node scripts/daily-backup.mjs            backup, then commit + push the code
//   node scripts/daily-backup.mjs --no-push  backup only
//
// 1. DATA  → backups\daily\<YYYY-MM-DD>\  (India date; inside the OneDrive project folder, so OneDrive
//    keeps a copy off this PC; the folder is git-ignored and never pushed)
//      rsc_classroom.dump, rsc_exam_prep.dump   pg_dump -Fc of the real databases (read-only; test DBs skipped)
//      app-data.tar.gz                          %LOCALAPPDATA%\RSC Classroom: Edu topics/settings/scripts,
//                                               Exam Prep files, Chaos jobs/drafts/settings and logins.
//                                               Left out: rendered media (mp4/wav, job pictures), the Python
//                                               venvs and models (re-installable), logs, old backups.
//      env.txt                                  copy of .env (keys needed to restore)
//    Day folders older than KEEP_DAYS are deleted.
// 2. CODE  → git add -A, commit "Daily backup <date>" when something changed, git push.
//    Files over 50 MB are never committed (GitHub refuses 100 MB+).
//
// Restore a database:  docker exec -i <postgres container> pg_restore -U <user> -d <db> --clean < file.dump
// Restore app data:    tar -xzf app-data.tar.gz -C "%LOCALAPPDATA%\RSC Classroom"

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(process.env.LOCALAPPDATA || "", "RSC Classroom");
const KEEP_DAYS = 30;
const MAX_FILE = 50 * 1024 * 1024;
const push = !process.argv.includes("--no-push");

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OUT = path.join(ROOT, "backups", "daily", day);
const LOG = path.join(APP, "logs", `backup-${day.slice(0, 7)}.log`);
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const problems = [];
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const fail = (what, e) => {
  const msg = `${what}: ${(e?.stderr?.toString() || e?.message || String(e)).trim().split("\n").slice(-3).join(" | ")}`;
  problems.push(msg);
  log("ERROR " + msg);
};

function readEnv() {
  const env = {};
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return env;
  for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

// ---------------------------------------------------------------- 1. data
log(`backup ${day} → ${OUT}`);
fs.mkdirSync(OUT, { recursive: true });
const env = readEnv();

// databases (pg_dump inside the postgres container: no password over the network, nothing written to the DB)
let container = "";
try {
  container = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
    .split(/\r?\n/)
    .find((n) => /postgres/i.test(n)) ?? "";
  if (!container) throw new Error("the postgres container isn't running");
} catch (e) {
  fail("databases", e);
}
if (container) {
  for (const key of ["DATABASE_URL", "EXAM_PREP_DATABASE_URL"]) {
    const url = env[key];
    if (!url) continue;
    try {
      const u = new URL(url);
      const db = u.pathname.replace(/^\//, "");
      if (/_test$/.test(db)) continue;
      const file = path.join(OUT, `${db}.dump`);
      const r = spawnSync("docker", ["exec", container, "pg_dump", "-U", decodeURIComponent(u.username), "-d", db, "-Fc"], { maxBuffer: 2 * 1024 ** 3 });
      if (r.status !== 0 || !r.stdout?.length) throw Object.assign(new Error(`pg_dump ${db} failed`), { stderr: r.stderr });
      if (r.stdout.subarray(0, 5).toString() !== "PGDMP") throw new Error(`pg_dump ${db}: unexpected output`);
      fs.writeFileSync(file, r.stdout);
      log(`  ${db}.dump ${(r.stdout.length / 1024).toFixed(0)} KB`);
    } catch (e) {
      fail(key, e);
    }
  }
}

// app data (bsdtar: Windows' own tar.exe)
try {
  const tarFile = path.join(OUT, "app-data.tar.gz");
  const tmp = tarFile + ".part";
  const ex = [
    "chaos/venv", "chaos/anim-venv", "chaos/models", "logs", "backups",
    "*.mp4", "*.wav", "*.mov", "*.mkv", "*.lock",
    "chaos/jobs/*.png", "chaos/jobs/*.jpg", "chaos/explainers/*.png", "edu/items/*.png", "edu/items/*.jpg",
    "__pycache__",
  ];
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  const parts = ["edu", "exam-prep", "chaos"].filter((d) => fs.existsSync(path.join(APP, d)));
  execFileSync(tar, ["-czf", tmp, ...ex.flatMap((x) => ["--exclude", x]), "-C", APP, ...parts], { stdio: ["ignore", "ignore", "pipe"] });
  fs.renameSync(tmp, tarFile);
  log(`  app-data.tar.gz ${(fs.statSync(tarFile).size / 1024 / 1024).toFixed(1)} MB`);
} catch (e) {
  fail("app data", e);
}

try {
  fs.copyFileSync(path.join(ROOT, ".env"), path.join(OUT, "env.txt"));
} catch (e) {
  fail(".env", e);
}

// keep the last KEEP_DAYS days
try {
  const base = path.join(ROOT, "backups", "daily");
  const cutoff = new Date(Date.parse(day) - KEEP_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const d of fs.readdirSync(base)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) {
      fs.rmSync(path.join(base, d), { recursive: true, force: true });
      log(`  removed old backup ${d}`);
    }
  }
} catch (e) {
  fail("clean-up", e);
}

// ---------------------------------------------------------------- 2. code
if (push) {
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const gitDir = git("rev-parse", "--git-dir");
    const busy = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"].find((f) => fs.existsSync(path.resolve(ROOT, gitDir, f)));
    if (busy) throw new Error(`a git ${busy} is in progress; nothing committed`);
    git("add", "-A");
    // never commit huge files
    const staged = git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);
    for (const f of staged) {
      const p = path.join(ROOT, f);
      if (fs.existsSync(p) && fs.statSync(p).size > MAX_FILE) {
        git("reset", "-q", "--", f);
        problems.push(`not committed (over 50 MB): ${f}`);
        log(`  skipped big file ${f}`);
      }
    }
    const n = git("diff", "--cached", "--name-only").split(/\r?\n/).filter(Boolean).length;
    if (n) {
      git("commit", "-q", "-m", `Daily backup ${day} (${n} file${n === 1 ? "" : "s"})`);
      log(`  committed ${n} file(s)`);
    } else log("  no code changes");
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    const ahead = git("rev-list", "--count", `origin/${branch}..HEAD`);
    if (ahead !== "0") {
      git("push", "-q", "origin", branch);
      log(`  pushed ${ahead} commit(s) to origin/${branch}`);
    } else log("  nothing to push");
  } catch (e) {
    fail("git", e);
  }
}

log(problems.length ? `done with ${problems.length} problem(s)` : "done");
process.exitCode = problems.length ? 1 : 0;
