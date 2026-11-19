"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtDuration, type VideoFormat } from "@/modules/chaos/csv";
import type { JobStage, MusicCheck } from "@/modules/chaos/jobs";
import type { UploadState } from "@/modules/chaos/youtube";
import type { YoutubeDefaults } from "../videos/[id]/youtube-panel";
import { Filter, Tick, isUploaded, type Marks, type OnMark } from "./parts";

export type VideoRow = {
  id: string;
  createdAt: string;
  title: string;
  csvName: string | null;
  format: VideoFormat;
  questions: number;
  badge: string;
  badgeIsDefault: boolean;
  introTag: string;
  introTitle: string;
  introIsDefault: boolean;
  seconds: number | null;
  duration: number | null;
  stage: JobStage;
  percent: number;
  thumb: number | null;
  youtube: { id: string; privacy: string } | "uploading" | null;
  /** Rahul's ticks (as loaded; the dashboard keeps the live copy) */
  uploadedMark: boolean;
  discarded: boolean;
  publish: { defaults: YoutubeDefaults; music: MusicCheck; upload: UploadState | null } | null;
};

type Col = { key: string; label: string; value: (r: VideoRow, m: Marks) => string | number | null; className?: string };

const STAGE_LABEL: Record<string, string> = { done: "Ready", error: "Failed", stopped: "Stopped" };
const statusText = (r: VideoRow) => STAGE_LABEL[r.stage] ?? `Making ${r.percent}%`;
const youtubeText = (r: VideoRow) => (r.youtube === "uploading" ? "Uploading" : r.youtube ? `Uploaded (${r.youtube.privacy})` : "");

const COLS: Col[] = [
  { key: "created", label: "Made on", value: (r) => r.createdAt },
  { key: "title", label: "Video title", value: (r) => r.title.toLowerCase() },
  { key: "csv", label: "CSV file", value: (r) => (r.csvName ?? "").toLowerCase() },
  { key: "format", label: "Format", value: (r) => r.format },
  { key: "questions", label: "Questions", value: (r) => r.questions, className: "text-right" },
  { key: "badge", label: "Badge", value: (r) => r.badge.toLowerCase() },
  { key: "intro", label: "Intro", value: (r) => `${r.introTag} ${r.introTitle}`.toLowerCase() },
  { key: "seconds", label: "Timer", value: (r) => r.seconds, className: "text-right" },
  { key: "length", label: "Length", value: (r) => r.duration, className: "text-right" },
  { key: "status", label: "Status", value: (r) => statusText(r) },
  { key: "youtube", label: "YouTube", value: (r) => youtubeText(r) },
  { key: "uploaded", label: "Uploaded", value: (r, m) => (isUploaded(r, m) ? 1 : 0) },
  { key: "discarded", label: "Discard", value: (r, m) => (m[r.id]?.discarded ? 1 : 0) },
];

type Fmt = "all" | "shorts" | "youtube";
type St = "all" | "done" | "making" | "failed";
type Up = "all" | "uploaded" | "notUploaded";
type Disc = "hide" | "show" | "only";
const stageGroup = (r: VideoRow): St => (r.stage === "done" ? "done" : r.stage === "error" || r.stage === "stopped" ? "failed" : "making");

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** All videos, sortable on every column, with filters and the Uploaded / Discard ticks. */
export function VideoTable({ rows, marks, onMark, onUpload }: { rows: VideoRow[]; marks: Marks; onMark: OnMark; onUpload: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "created", dir: -1 });
  const [q, setQ] = useState("");
  const [fmt, setFmt] = useState<Fmt>("all");
  const [st, setSt] = useState<St>("all");
  const [up, setUp] = useState<Up>("all");
  const [disc, setDisc] = useState<Disc>("hide");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows
      .filter((r) => (disc === "hide" ? !marks[r.id]?.discarded : disc === "only" ? !!marks[r.id]?.discarded : true))
      .filter((r) => fmt === "all" || r.format === fmt)
      .filter((r) => st === "all" || stageGroup(r) === st)
      .filter((r) => (up === "uploaded" ? isUploaded(r, marks) : up === "notUploaded" ? r.stage === "done" && !isUploaded(r, marks) : true))
      .filter((r) => !needle || [r.title, r.csvName ?? "", r.badge, r.introTag, r.introTitle, r.format, statusText(r)].join(" ").toLowerCase().includes(needle));
    const col = COLS.find((c) => c.key === sort.key) ?? COLS[0]!;
    return [...list].sort((a, b) => {
      const va = col.value(a, marks);
      const vb = col.value(b, marks);
      // Empty values always go last, whichever way the column is sorted
      if (va == null || va === "") return vb == null || vb === "" ? 0 : 1;
      if (vb == null || vb === "") return -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "en", { numeric: true });
      return c * sort.dir;
    });
  }, [rows, q, sort, fmt, st, up, disc, marks]);

  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "created" ? -1 : 1 }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, CSV, badge, intro…" className="input w-full max-w-xs" aria-label="Search videos" />
        <Filter label="Format" value={fmt} onChange={setFmt} options={[["all", "All"], ["shorts", "Shorts"], ["youtube", "YouTube"]]} />
        <Filter label="Status" value={st} onChange={setSt} options={[["all", "All"], ["done", "Ready"], ["making", "Being made"], ["failed", "Failed / stopped"]]} />
        <Filter label="YouTube" value={up} onChange={setUp} options={[["all", "All"], ["uploaded", "Uploaded"], ["notUploaded", "Ready, not uploaded"]]} />
        <Filter label="Discarded" value={disc} onChange={setDisc} options={[["hide", "Hide"], ["show", "Show"], ["only", "Only discarded"]]} />
        <span className="text-sm text-muted">
          {shown.length} of {rows.length} video{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="table text-sm">
          <thead>
            <tr>
              <th className="w-16" aria-label="Thumbnail" />
              {COLS.map((c) => (
                <th key={c.key} className={`whitespace-nowrap ${c.className ?? ""}`} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => toggle(c.key)} className={`inline-flex items-center gap-1 hover:text-[#7a2fc0] ${sort.key === c.key ? "font-semibold text-[#2a1260]" : ""}`}>
                    {c.label}
                    <span className="text-[10px]">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={`align-top hover:bg-soft/50 ${marks[r.id]?.discarded ? "opacity-50" : ""}`}>
                <td>
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/chaos/videos/${r.id}/thumbnail?v=${r.thumb}`} alt="" className={`rounded object-cover ${r.format === "shorts" ? "h-14 w-8" : "h-9 w-16"}`} />
                  ) : null}
                </td>
                <td className="whitespace-nowrap">{fmtWhen(r.createdAt)}</td>
                <td className="min-w-[10rem]">
                  <Link href={`/chaos/videos/${r.id}`} className="font-medium text-accent hover:underline">
                    {r.title}
                  </Link>
                  {r.stage === "done" && (
                    <a href={`/chaos/videos/${r.id}/file?download=1`} download className="block text-xs text-muted hover:text-accent">
                      ⬇ MP4
                    </a>
                  )}
                </td>
                <td className="min-w-[8rem]">
                  <a href={`/chaos/videos/${r.id}/csv`} download className="text-accent hover:underline" title="Download the CSV">
                    {r.csvName ?? <span className="text-muted">questions.csv</span>}
                  </a>
                </td>
                <td className="whitespace-nowrap">{r.format === "shorts" ? "Shorts" : "YouTube"}</td>
                <td className="text-right tabular-nums">{r.questions}</td>
                <td className="whitespace-nowrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.badgeIsDefault ? "bg-soft text-muted" : "bg-[#ffb300] text-[#1e0e4a]"}`}>{r.badge}</span>
                </td>
                <td className={`min-w-[10rem] text-xs ${r.introIsDefault ? "text-muted" : ""}`}>
                  <b>{r.introTag}</b>
                  <span className="block">{r.introTitle}</span>
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">{r.seconds ? `${r.seconds}s` : "—"}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{r.duration ? fmtDuration(r.duration) : "—"}</td>
                <td className="whitespace-nowrap">
                  <span className={r.stage === "done" ? "text-ok" : r.stage === "error" ? "text-bad" : r.stage === "stopped" ? "text-muted" : "text-warn"}>{statusText(r)}</span>
                </td>
                <td className="whitespace-nowrap text-xs">
                  {r.youtube && r.youtube !== "uploading" ? (
                    <a href={`https://youtu.be/${r.youtube.id}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {youtubeText(r)} ↗
                    </a>
                  ) : r.youtube === "uploading" ? (
                    <button type="button" className="text-warn hover:underline" onClick={() => onUpload(r.id)}>
                      Uploading… (open)
                    </button>
                  ) : r.publish && !marks[r.id]?.uploaded ? (
                    <UploadButton onClick={() => onUpload(r.id)} blocked={!r.publish.music.ok} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  {r.stage === "done" ? (
                    <Tick
                      label=""
                      checked={isUploaded(r, marks)}
                      disabled={!!r.youtube && r.youtube !== "uploading"}
                      title={r.youtube && r.youtube !== "uploading" ? "Uploaded through the studio" : "Tick once it's on YouTube"}
                      onChange={(v) => onMark(r.id, "uploaded", v)}
                    />
                  ) : null}
                </td>
                <td>
                  <Tick label="" title="Discard (hides it; nothing is deleted)" checked={!!marks[r.id]?.discarded} onChange={(v) => onMark(r.id, "discarded", v)} />
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={COLS.length + 1} className="py-6 text-center text-muted">
                  {rows.length ? "No videos match the filter." : "No videos yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Grey badge or intro = the template's default (the video didn't set its own).</p>
    </div>
  );
}

/** Opens the upload window (details, review, upload). Red when the video's music was taken out. */
export function UploadButton({ onClick, blocked }: { onClick: () => void; blocked?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={blocked ? "This video's music was removed after a copyright claim: make it again" : "Check the title, description and tags, then upload"}
      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold text-white ${blocked ? "bg-bad/70" : "bg-[#ff0033] hover:bg-[#d4002b]"}`}
    >
      {blocked ? "⚠ Music claimed" : "⬆ Upload"}
    </button>
  );
}
