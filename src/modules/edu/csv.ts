import "server-only";
import { normTopic, similarRows, type TopicRow, type VideoFormat } from "./store";

// The topic list CSV. One row per video:
//   topic,format,audience,notes,must_include
//   How rainbows form,,kids,,refraction; 42 degrees
//   The French Revolution,long,teens,causes then events then results,
// Only `topic` is needed. format: short (default, under a minute, vertical) or long (3-6 minutes).

export const MAX_TOPICS_CSV = 512 * 1024;
export const SAMPLE_TOPICS_CSV = [
  "topic,format,audience,notes,must_include",
  "How rainbows form,short,kids,,refraction; why it is curved",
  "How does ChatGPT write its answers,short,general,,tokens; next word prediction",
  "Why do we have seasons,short,,Many people think it is the distance from the Sun: bust that myth,axis tilt",
  "The French Revolution,long,teens,Causes then events then results,1789; Bastille",
  "",
].join("\n");

/** Splits CSV text into rows of cells (quotes, doubled quotes and new lines inside quotes handled). */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

export type ParsedTopic = Pick<TopicRow, "topic" | "format" | "audience" | "notes" | "mustInclude">;
export type TopicIssue = { line: number; level: "error" | "warning"; text: string };

const cut = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function parseTopicsCsv(text: string, existing: TopicRow[]): { topics: ParsedTopic[]; issues: TopicIssue[] } {
  const rows = csvRows(text);
  const issues: TopicIssue[] = [];
  const topics: ParsedTopic[] = [];
  if (!rows.length) return { topics, issues: [{ line: 1, level: "error", text: "The file is empty." }] };
  const head = rows[0]!.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (name: string) => head.indexOf(name);
  const hasHeader = col("topic") >= 0;
  const at = {
    topic: hasHeader ? col("topic") : 0,
    format: hasHeader ? col("format") : 1,
    audience: hasHeader ? col("audience") : 2,
    notes: hasHeader ? col("notes") : 3,
    must: hasHeader ? Math.max(col("mustinclude"), col("must")) : 4,
  };
  const seen = new Map<string, number>();
  rows.slice(hasHeader ? 1 : 0).forEach((r, k) => {
    const line = k + (hasHeader ? 2 : 1);
    const topic = cut(r[at.topic], 200);
    if (!topic) {
      issues.push({ line, level: "error", text: "No topic: row skipped." });
      return;
    }
    const rawFormat = cut(at.format >= 0 ? r[at.format] : "", 20).toLowerCase();
    let format: VideoFormat = "short";
    if (rawFormat.startsWith("long")) format = "long";
    else if (rawFormat && !rawFormat.startsWith("short")) issues.push({ line, level: "warning", text: `Format "${rawFormat}" isn't short or long: made as a short.` });
    const key = normTopic(topic);
    if (seen.has(key)) {
      issues.push({ line, level: "error", text: `"${topic}" is already on line ${seen.get(key)} of this file: skipped.` });
      return;
    }
    const same = existing.filter((e) => e.status !== "rejected" && normTopic(e.topic) === key);
    if (same.length) {
      issues.push({ line, level: "error", text: `"${topic}" is already in the list: skipped (no repeated topics).` });
      return;
    }
    const similar = similarRows(topic, existing);
    if (similar.length) issues.push({ line, level: "warning", text: `"${topic}" looks close to "${similar[0]!.topic}". Added; the script will take a different angle and not repeat it.` });
    seen.set(key, line);
    topics.push({
      topic,
      format,
      audience: cut(at.audience >= 0 ? r[at.audience] : "", 60) || undefined,
      notes: cut(at.notes >= 0 ? r[at.notes] : "", 500) || undefined,
      mustInclude: cut(at.must >= 0 ? r[at.must] : "", 300) || undefined,
    });
  });
  if (!topics.length && !issues.length) issues.push({ line: 1, level: "error", text: "No topics found." });
  return { topics, issues };
}

const cell = (v: string | undefined) => {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The whole list as a CSV (with each row's progress), for download. */
export function topicsToCsv(rows: TopicRow[]) {
  const out = ["topic,format,audience,notes,must_include,status,title,youtube_id"];
  for (const r of rows) out.push([r.topic, r.format, r.audience, r.notes, r.mustInclude, r.status, r.title, r.youtube?.videoId].map(cell).join(","));
  return out.join("\n") + "\n";
}
