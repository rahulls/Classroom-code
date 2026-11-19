"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CsvEntry } from "@/modules/chaos/jobs";
import { Filter, Tick, isUploaded, type Marks, type OnMark } from "./parts";
import { UploadButton, type VideoRow } from "./video-table";

type Made = "all" | "made" | "notMade";
type Up = "all" | "uploaded" | "notUploaded";
type Disc = "hide" | "show" | "only";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const STAGE: Record<string, [string, string]> = { done: ["Ready", "text-ok"], error: ["Failed", "text-bad"], stopped: ["Stopped", "text-muted"] };

/** Every CSV in the csv folder, the videos made from it, and their ticks. */
export function CsvTable({
  csvs,
  rows,
  marks,
  onMark,
  csvDiscarded,
  onDiscardCsv,
  onUpload,
}: {
  csvs: CsvEntry[];
  rows: VideoRow[];
  marks: Marks;
  onMark: OnMark;
  csvDiscarded: Record<string, boolean>;
  onDiscardCsv: (name: string, value: boolean) => void;
  onUpload: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [made, setMade] = useState<Made>("all");
  const [up, setUp] = useState<Up>("all");
  const [disc, setDisc] = useState<Disc>("hide");
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Discarded videos don't count: a CSV whose only video was thrown away still needs one
  const liveVideos = (c: CsvEntry) => c.videoIds.map((id) => byId.get(id)).filter((r): r is VideoRow => !!r && !marks[r.id]?.discarded);
  const hasVideo = (c: CsvEntry) => liveVideos(c).some((r) => r.stage === "done");
  const anyUploaded = (c: CsvEntry) => liveVideos(c).some((r) => isUploaded(r, marks));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return csvs
      .filter((c) => (disc === "hide" ? !csvDiscarded[c.name] : disc === "only" ? csvDiscarded[c.name] : true))
      .filter((c) => (made === "made" ? hasVideo(c) : made === "notMade" ? !hasVideo(c) : true))
      .filter((c) => (up === "uploaded" ? anyUploaded(c) : up === "notUploaded" ? hasVideo(c) && !anyUploaded(c) : true))
      .filter((c) => !needle || `${c.name} ${c.videoName ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvs, q, made, up, disc, marks, csvDiscarded, byId]);

  const live = csvs.filter((c) => !csvDiscarded[c.name]);
  const waiting = live.filter((c) => !hasVideo(c)).length;
  const toUpload = live.filter((c) => hasVideo(c) && !anyUploaded(c)).length;
  const linked = new Set(csvs.flatMap((c) => c.videoIds));
  const orphans = rows.filter((r) => !linked.has(r.id)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={() => { setMade("notMade"); setUp("all"); }} className="rounded-full bg-warn/10 px-3 py-1 text-warn hover:bg-warn/20">
          {waiting} CSV{waiting === 1 ? "" : "s"} without a video
        </button>
        <button type="button" onClick={() => { setMade("all"); setUp("notUploaded"); }} className="rounded-full bg-accent/10 px-3 py-1 text-accent hover:bg-accent/20">
          {toUpload} with a video not uploaded yet
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CSV or video name…" className="input w-full max-w-xs" aria-label="Search CSVs" />
        <Filter label="Video" value={made} onChange={setMade} options={[["all", "All"], ["made", "Made"], ["notMade", "Not made yet"]]} />
        <Filter label="YouTube" value={up} onChange={setUp} options={[["all", "All"], ["uploaded", "Uploaded"], ["notUploaded", "Not uploaded"]]} />
        <Filter label="Discarded" value={disc} onChange={setDisc} options={[["hide", "Hide"], ["show", "Show"], ["only", "Only discarded"]]} />
        <span className="text-sm text-muted">
          {shown.length} of {csvs.length} CSV{csvs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>CSV file</th>
              <th className="text-right">Questions</th>
              <th className="whitespace-nowrap">Changed</th>
              <th>Videos made from it</th>
              <th>Discard</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const videos = c.videoIds.map((id) => byId.get(id)).filter((r): r is VideoRow => !!r);
              const gone = !!csvDiscarded[c.name];
              return (
                <tr key={c.name} className={`align-top ${gone ? "opacity-50" : ""}`}>
                  <td className="min-w-[12rem]">
                    <span className="font-medium">{c.name}</span>
                    {c.videoName && <span className="block text-xs text-muted">{c.videoName}</span>}
                    {c.problems > 0 && <span className="block text-xs text-bad">{c.problems} problem{c.problems === 1 ? "" : "s"} to fix</span>}
                  </td>
                  <td className="text-right tabular-nums">{c.questions}</td>
                  <td className="whitespace-nowrap">{fmtDay(c.modifiedAt)}</td>
                  <td className="min-w-[22rem]">
                    {videos.length ? (
                      <ul className="space-y-1.5">
                        {videos.map((r) => {
                          const [label, color] = STAGE[r.stage] ?? [`Making ${r.percent}%`, "text-warn"];
                          const viaStudio = !!r.youtube && r.youtube !== "uploading";
                          const vDisc = !!marks[r.id]?.discarded;
                          return (
                            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${vDisc ? "opacity-50" : ""}`}>
                              <Link href={`/chaos/videos/${r.id}`} className="font-medium text-accent hover:underline">
                                {r.format === "shorts" ? "Shorts" : "YouTube"}
                              </Link>
                              <span className={`text-xs ${color}`}>{label}</span>
                              {r.stage === "done" && (
                                <>
                                  <Tick
                                    label="Uploaded"
                                    checked={isUploaded(r, marks)}
                                    disabled={viaStudio}
                                    title={viaStudio ? "Uploaded through the studio" : "Tick once it's on YouTube"}
                                    onChange={(v) => onMark(r.id, "uploaded", v)}
                                  />
                                  <Tick label="Discard" checked={vDisc} onChange={(v) => onMark(r.id, "discarded", v)} />
                                  {r.publish && !isUploaded(r, marks) && r.youtube !== "uploading" && <UploadButton onClick={() => onUpload(r.id)} blocked={!r.publish.music.ok} />}
                                </>
                              )}
                              {viaStudio && r.youtube !== "uploading" && r.youtube && (
                                <a href={`https://youtu.be/${r.youtube.id}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                                  watch ↗
                                </a>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <Link href="/chaos" className="text-xs text-warn hover:underline">
                        No video yet. Make one →
                      </Link>
                    )}
                  </td>
                  <td>
                    <Tick label="Discard" checked={gone} onChange={(v) => onDiscardCsv(c.name, v)} />
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted">
                  {csvs.length ? "No CSVs match the filters." : "No CSVs in the csv folder yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {orphans > 0 && (
        <p className="text-xs text-muted">
          {orphans} video{orphans === 1 ? " was" : "s were"} made before CSVs were kept (or from a CSV no longer in the folder): see the Videos tab.
        </p>
      )}
      <p className="text-xs text-muted">
        &quot;Without a video&quot; counts only finished videos that aren&apos;t discarded. Discarding just hides things here: no file is deleted.
      </p>
    </div>
  );
}
