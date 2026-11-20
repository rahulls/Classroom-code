// Writes the question-import CSV for a paper JSON (same columns as the app's CSV template).
//   node to-csv.mjs cbse-class10-maths-practice-1.json
import fs from "node:fs";
const src = process.argv[2] ?? "cbse-class10-maths-practice-1.json";
const j = JSON.parse(fs.readFileSync(src, "utf8"));
const qs = Array.isArray(j) ? j : j.questions;
const cols = ["number", "section", "chapter", "topic", "marks", "type", "difficulty", "text", "option_a", "option_b", "option_c", "option_d", "correct_option", "scheme", "solution", "or_text", "or_scheme", "or_solution"];
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const scheme = (x) => (x ?? []).map((s) => `${s.step.replace(/\|/g, "/")}:${s.marks}`).join("|");
const lines = [cols.join(",")];
for (const q of qs) {
  const o = q.options ?? [];
  lines.push([q.number, q.section, q.chapter, q.topic, q.marks, q.type, q.difficulty, q.text, o[0], o[1], o[2], o[3], q.correctOption, scheme(q.markingScheme), q.solution, q.or?.text, scheme(q.or?.markingScheme), q.or?.solution].map(cell).join(","));
}
const out = src.replace(/\.json$/, ".csv");
fs.writeFileSync(out, "﻿" + lines.join("\n") + "\n");
console.log(`${out}: ${qs.length} questions`);
