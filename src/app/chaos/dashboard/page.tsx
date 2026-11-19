import fs from "node:fs";
import path from "node:path";
import { CHAOS_ASSETS, getMarks, listCsvLibrary, listJobs, musicCheck } from "@/modules/chaos/jobs";
import { getUpload, videoMeta, youtubeConnection } from "@/modules/chaos/youtube";
import { Dashboard } from "./dashboard";
import type { VideoRow } from "./video-table";

export const metadata = { title: "Dashboard" };

/** What the engine uses when a video didn't set its own badge / intro (quiz-template settings.json). */
function templateDefaults() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CHAOS_ASSETS, "quiz-template", "quiz-template", "settings.json"), "utf8")) as {
      quiz_badge?: string;
      intro_badge?: string;
      title_lines?: string[];
    };
    return { badge: s.quiz_badge ?? "GK QUIZ", introTag: s.intro_badge ?? "TODAY'S QUIZ", titleLines: s.title_lines ?? ["General", "Knowledge"] };
  } catch {
    return { badge: "GK QUIZ", introTag: "TODAY'S QUIZ", titleLines: ["General", "Knowledge"] };
  }
}

export default async function ChaosDashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const d = templateDefaults();
  const jobs = listJobs();
  const csvs = listCsvLibrary(jobs);
  const conn = youtubeConnection();
  const rows: VideoRow[] = jobs.map((j) => {
    const upload = getUpload(j.id);
    const marks = getMarks(j.id);
    const lines = j.settings.title_lines?.length ? j.settings.title_lines : d.titleLines;
    return {
      id: j.id,
      createdAt: j.createdAt,
      title: j.title,
      csvName: j.fileName ?? null,
      format: j.format,
      questions: j.questions,
      badge: j.settings.quiz_badge || d.badge,
      badgeIsDefault: !j.settings.quiz_badge,
      introTag: j.settings.intro_badge || d.introTag,
      introTitle: lines.join(" / "),
      introIsDefault: !j.settings.intro_badge && !j.settings.title_lines?.length,
      seconds: j.settings.timer_seconds ?? null,
      duration: j.status.result?.duration ?? null,
      stage: j.status.stage,
      percent: Math.round(j.status.percent),
      thumb: j.thumb ?? null,
      uploadedMark: !!marks.uploaded,
      discarded: !!marks.discarded,
      youtube: upload?.state === "done" && upload.videoId ? { id: upload.videoId, privacy: upload.privacy } : upload?.state === "uploading" ? "uploading" : null,
      // What the upload window needs (finished videos only)
      publish: j.status.stage === "done" ? { defaults: videoMeta(j), music: musicCheck(j), upload } : null,
    };
  });
  return (
    // Wider than the studio's column: the table has many columns
    <div className="relative left-1/2 w-[min(calc(100vw-2rem),96rem)] -translate-x-1/2">
      <h1 className="mb-1 text-2xl font-bold text-[#2a1260]">Dashboard</h1>
      <p className="mb-5 text-sm text-muted">Every CSV and the videos made from it. Tick Uploaded once a video is on YouTube, and Discard what you won&apos;t use (nothing is deleted).</p>
      <Dashboard
        rows={rows}
        csvs={csvs}
        initialTab={tab === "videos" ? "videos" : "csv"}
        youtube={{ configured: !!conn.clientId && conn.hasSecret, connected: conn.connected, channelTitle: conn.channelTitle }}
      />
    </div>
  );
}
