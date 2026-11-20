// Answer rows: how an uploaded paper is marked. One row per answer number as written on the paper
// (1, 1.1, 4.a, 21.A ...), with its maximum marks. Rows that share a "choice" key are internal
// choices (OR): the student answers one of them, so the group counts once in the total.
//
// CSV (header optional): answer,max,section,chapter,choice
//   1.1,1,A,Real Numbers,
//   21.A,2,B,,21
//   21.B,2,B,,21

export type AnswerRow = { label: string; max: number; section?: string; chapter?: string; choice?: string };

const LABEL = /^[0-9A-Za-z][0-9A-Za-z.()\-]{0,19}$/;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** Parses the rows CSV. Returns every problem found (with its line number); rows only when there are none. */
export function parseAnswerRows(text: string): { rows: AnswerRow[]; errors: string[] } {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  if (/(^|,)\s*text\s*(,|$)/i.test(firstLine) && /(^|,)\s*marks\s*(,|$)/i.test(firstLine)) return rowsFromQuestionsCsv(text);
  const lines =text.replace(/^﻿/, "").split(/\r?\n/);
  const errors: string[] = [];
  const rows: AnswerRow[] = [];
  let cols = ["answer", "max", "section", "chapter", "choice"];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitCsvLine(line);
    if (!rows.length && !errors.length && /^(answer|question|q|label|no)/i.test(cells[0] ?? "") && isNaN(Number(cells[1]))) {
      cols = cells.map((c) => c.toLowerCase().replace(/^(question|q|label|no\.?|answer no\.?)$/, "answer").replace(/^(max marks|marks|max_marks)$/, "max"));
      return;
    }
    const get = (k: string) => (cols.indexOf(k) >= 0 ? (cells[cols.indexOf(k)] ?? "") : "");
    const label = get("answer");
    const max = Number(get("max"));
    const at = `Line ${i + 1}`;
    if (!LABEL.test(label)) return void errors.push(`${at}: "${label}" is not an answer number (use e.g. 1, 1.1, 4.a, 21.A)`);
    if (!(max > 0 && max <= 100) || Math.round(max * 2) !== max * 2) return void errors.push(`${at}: max marks for ${label} must be a whole or half number above 0`);
    if (rows.some((r) => r.label.toLowerCase() === label.toLowerCase())) return void errors.push(`${at}: ${label} appears twice`);
    const row: AnswerRow = { label, max };
    if (get("section")) row.section = get("section").slice(0, 10);
    if (get("chapter")) row.chapter = get("chapter").slice(0, 120);
    if (get("choice")) row.choice = get("choice").slice(0, 20);
    rows.push(row);
  });
  const groups = new Map<string, AnswerRow[]>();
  for (const r of rows) if (r.choice) groups.set(r.choice, [...(groups.get(r.choice) ?? []), r]);
  for (const [k, g] of groups) {
    if (g.length < 2) errors.push(`Choice "${k}" has only one row (${g[0]!.label}); a choice needs at least two alternatives`);
    else if (g.some((r) => r.max !== g[0]!.max)) errors.push(`Choice "${k}": the alternatives must carry the same marks`);
  }
  if (!rows.length && !errors.length) errors.push("No answer rows found.");
  return errors.length ? { rows: [], errors } : { rows, errors };
}

/** Total of a paper's rows: a choice group counts once. */
export function rowsTotal(rows: AnswerRow[]) {
  const seen = new Set<string>();
  let t = 0;
  for (const r of rows) {
    if (r.choice) {
      if (seen.has(r.choice)) continue;
      seen.add(r.choice);
    }
    t += r.max;
  }
  return t;
}

const cell = (s: string | number | undefined) => {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function rowsToCsv(rows: AnswerRow[]) {
  return ["answer,max,section,chapter,choice", ...rows.map((r) => [r.label, r.max, r.section, r.chapter, r.choice].map(cell).join(","))].join("\n") + "\n";
}

/**
 * Checks one sheet's marks against the rows: known labels, 0..max in halves, and at most one
 * alternative marked per choice group. Blank (null) means "not marked".
 */
export function checkRowMarks(rows: AnswerRow[], marks: Record<string, number | null>) {
  for (const [label, m] of Object.entries(marks)) {
    const r = rows.find((x) => x.label === label);
    if (!r) throw new Error(`${label} is not an answer row of this paper.`);
    if (m == null) continue;
    if (!Number.isFinite(m) || m < 0 || m > r.max) throw new Error(`${label}: marks must be between 0 and ${r.max}.`);
    if (Math.round(m * 2) !== m * 2) throw new Error(`${label}: use whole or half marks.`);
  }
  const groups = new Map<string, string[]>();
  for (const r of rows) if (r.choice && marks[r.label] != null) groups.set(r.choice, [...(groups.get(r.choice) ?? []), r.label]);
  for (const [, ls] of groups) if (ls.length > 1) throw new Error(`${ls.join(" and ")} are alternatives (OR): mark only the one the student attempted.`);
}

/** Score of a sheet: marks got, out of the paper total; and how many rows are still unmarked. */
export function sheetScore(rows: AnswerRow[], marks: { label: string; marks: number }[]) {
  const by = new Map(marks.map((m) => [m.label, m.marks]));
  const got = rows.reduce((a, r) => a + (by.get(r.label) ?? 0), 0);
  const done = new Set<string>();
  let open = 0;
  for (const r of rows) {
    if (r.choice) {
      if (done.has(r.choice)) continue;
      done.add(r.choice);
      if (!rows.some((x) => x.choice === r.choice && by.has(x.label))) open++;
    } else if (!by.has(r.label)) open++;
  }
  return { got, max: rowsTotal(rows), open };
}

export const NO_CHAPTER = "No chapter given";

export type ChapterLine = { chapter: string; got: number; max: number; marked: number; lostBy: Record<string, number> };

/**
 * Chapter-wise result of one sheet, from the rows' chapters. Only marked answers count, so a half-marked
 * sheet shows what is known so far. For an OR choice the attempted alternative's chapter is used.
 */
export function chapterBreakdown(rows: AnswerRow[], marks: { label: string; marks: number; errorTag?: string }[]): ChapterLine[] {
  const by = new Map(marks.map((m) => [m.label, m]));
  const out = new Map<string, ChapterLine>();
  for (const r of rows) {
    const m = by.get(r.label);
    if (!m) continue;
    const ch = r.chapter || NO_CHAPTER;
    const line = out.get(ch) ?? { chapter: ch, got: 0, max: 0, marked: 0, lostBy: {} };
    line.got += m.marks;
    line.max += r.max;
    line.marked++;
    const lost = r.max - m.marks;
    if (lost > 0) {
      const tag = m.errorTag && m.errorTag !== "none" ? m.errorTag : "not tagged";
      line.lostBy[tag] = (line.lostBy[tag] ?? 0) + lost;
    }
    out.set(ch, line);
  }
  return [...out.values()].sort((a, b) => a.got / a.max - b.got / b.max);
}

/** Chapter max marks of the paper itself (an OR group counts once, under its first alternative's chapter). */
export function chapterWeights(rows: AnswerRow[]) {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.choice) {
      if (seen.has(r.choice)) continue;
      seen.add(r.choice);
    }
    const ch = r.chapter || NO_CHAPTER;
    out.set(ch, (out.get(ch) ?? 0) + r.max);
  }
  return out;
}

// ------------------------------ answer rows from a questions CSV ------------------------------

/** Full CSV parse (quoted cells may hold commas and line breaks). */
function parseCsvFull(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') (f += '"'), i++;
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(f), (f = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(f), rows.push(row), (row = []), (f = "");
    } else f += c;
  }
  if (f || row.length) row.push(f), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

type Step = { step: string; marks: number };
const steps = (t: string): Step[] =>
  t
    .split("|")
    .filter((x) => x.trim())
    .map((x) => {
      const i = x.lastIndexOf(":");
      return { step: x.slice(0, i).trim(), marks: Number(x.slice(i + 1)) };
    });

const PART = /^\(\s*(i{1,3}|iv|v|vi{0,3})\s*\)/i;
/** Case-study parts from scheme steps labelled (i), (ii), (iii)…: part → marks and the steps' text. Null if not every step is labelled. */
function parts(sch: Step[]) {
  if (sch.length < 2 || !sch.every((s) => PART.test(s.step))) return null;
  const out = new Map<string, { marks: number; text: string[] }>();
  for (const s of sch) {
    const k = PART.exec(s.step)![1]!.toLowerCase();
    const p = out.get(k) ?? { marks: 0, text: [] };
    p.marks += s.marks;
    p.text.push(s.step);
    out.set(k, p);
  }
  return out.size >= 2 ? out : null;
}

/**
 * The marking board from a question-by-question CSV (number, section, chapter, marks, scheme,
 * or_text, or_scheme, …): one row per question; an OR question gives .A and .B (choice = number); a
 * case study whose scheme steps are labelled (i), (ii), (iii) gives one row per part, and the parts
 * whose OR scheme differs become .A/.B choices (e.g. 36.iii.A / 36.iii.B).
 */
export function rowsFromQuestionsCsv(text: string): { rows: AnswerRow[]; errors: string[] } {
  const csv = parseCsvFull(text);
  const h = (csv[0] ?? []).map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"));
  const g = (r: string[], k: string) => (h.indexOf(k) >= 0 ? (r[h.indexOf(k)] ?? "").trim() : "");
  const errors: string[] = [];
  const out: AnswerRow[] = [];
  csv.slice(1).forEach((r, i) => {
    const n = g(r, "number") || String(i + 1);
    const marks = Number(g(r, "marks"));
    const base = { section: g(r, "section") || undefined, chapter: g(r, "chapter") || undefined };
    const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
    if (!(marks > 0)) return void errors.push(`Question ${n}: marks missing`);
    const main = parts(steps(g(r, "scheme")));
    const hasOr = !!g(r, "or_text");
    if (main && [...main.values()].reduce((a, p) => a + p.marks, 0) === marks) {
      const alt = hasOr ? parts(steps(g(r, "or_scheme"))) : null;
      for (const [k, p] of main) {
        const q = alt?.get(k);
        if (alt && q && q.text.join("|") !== p.text.join("|")) {
          out.push(clean({ label: `${n}.${k}.A`, max: p.marks, ...base, choice: `${n}.${k}` }));
          out.push(clean({ label: `${n}.${k}.B`, max: q.marks, ...base, choice: `${n}.${k}` }));
        } else out.push(clean({ label: `${n}.${k}`, max: p.marks, ...base }));
      }
    } else if (hasOr) {
      out.push(clean({ label: `${n}.A`, max: marks, ...base, choice: n }));
      out.push(clean({ label: `${n}.B`, max: marks, ...base, choice: n }));
    } else out.push(clean({ label: n, max: marks, ...base }));
  });
  if (errors.length) return { rows: [], errors };
  // Same checks as a typed details list
  const check = parseAnswerRows(rowsToCsv(out));
  return check.errors.length ? { rows: [], errors: check.errors } : { rows: out, errors: [] };
}
