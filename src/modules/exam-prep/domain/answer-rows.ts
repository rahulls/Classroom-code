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
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
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
