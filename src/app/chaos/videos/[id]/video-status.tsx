"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { continueCanvaAction, deleteVideoAction, stopVideoAction } from "@/modules/chaos/actions";
import { fmtDuration, type VideoFormat } from "@/modules/chaos/csv";
import type { JobStatus } from "@/modules/chaos/jobs";

const RUNNING = ["canva", "queued", "voice", "render", "finish"];
const STAGES = [
  { key: "canva", label: "Canva designs" },
  { key: "voice", label: "Narration" },
  { key: "render", label: "Drawing frames" },
  { key: "finish", label: "Adding sound" },
  { key: "done", label: "Ready" },
];

const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);

/** Live progress while the video is made, then the in-page player and download. */
export function VideoStatus({ id, title, format, initial }: { id: string; title: string; format: VideoFormat; initial: JobStatus }) {
  const [status, setStatus] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<{ t: number; pct: number } | null>(null);
  const running = RUNNING.includes(status.stage);
  const router = useRouter();
  const wasRunning = useRef(running);
  useEffect(() => {
    // Just finished: reload the server parts (thumbnail, YouTube) of the page
    if (wasRunning.current && status.stage === "done") router.refresh();
    wasRunning.current = running;
  }, [running, status.stage, router]);

  useEffect(() => {
    if (!running) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/chaos/videos/${id}/status`, { cache: "no-store" });
        if (r.ok && !stop) {
          const s = (await r.json()) as JobStatus;
          setStatus(s);
          setNow(Date.now());
          if (!seen.current && s.stage === "render" && s.percent > 12) seen.current = { t: Date.now(), pct: s.percent };
        }
      } catch {
        /* the next poll will try again */
      }
    };
    const t = setInterval(tick, 1500);
    void tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, running]);

  // Time left, from the drawing speed seen so far
  let eta: number | null = null;
  if (running && seen.current && status.percent > seen.current.pct + 1) {
    const rate = (status.percent - seen.current.pct) / ((now - seen.current.t) / 1000);
    eta = (100 - status.percent) / rate;
  }

  if (status.stage === "done") {
    const r = status.result;
    return (
      <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
        <div className={`overflow-hidden rounded-xl bg-black shadow-lg ${format === "shorts" ? "w-full max-w-[360px]" : "w-full max-w-[880px]"}`}>
          <video
            controls
            playsInline
            preload="metadata"
            src={`/chaos/videos/${id}/file`}
            className={`block w-full ${format === "shorts" ? "aspect-[9/16]" : "aspect-video"}`}
          />
        </div>
        <div className="space-y-3">
          <p className="inline-flex items-center gap-2 rounded-full bg-ok/15 px-3 py-1 text-sm font-medium text-ok">✓ Video ready</p>
          {r && (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">Length</dt>
              <dd>{fmtDuration(r.duration)}</dd>
              <dt className="text-muted">Size</dt>
              <dd>
                {r.width}×{r.height}
                {status.sizeBytes ? ` · ${fmtBytes(status.sizeBytes)}` : ""}
              </dd>
              <dt className="text-muted">{r.facts ? "Facts" : "Questions"}</dt>
              <dd>{r.questions}</dd>
              <dt className="text-muted">Made in</dt>
              <dd>{fmtDuration(r.render_seconds)}</dd>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <a className="btn-primary" href={`/chaos/videos/${id}/file?download=1`} download>
              ⬇ Download MP4
            </a>
            <ActionForm action={deleteVideoAction} confirm={`Delete “${title}” and its video file?`}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="back" value="1" />
              <SubmitButton variant="default">Delete</SubmitButton>
            </ActionForm>
          </div>
          <p className="text-xs text-muted">The preview plays here without downloading. Download when you're happy with it, then upload to {format === "shorts" ? "YouTube Shorts or Instagram Reels" : "YouTube"}.</p>
        </div>
      </div>
    );
  }

  if (status.stage === "error" || status.stage === "stopped") {
    return (
      <div className="card max-w-2xl space-y-3">
        <p className={status.stage === "error" ? "font-semibold text-bad" : "font-semibold text-muted"}>{status.stage === "error" ? "The video couldn't be made." : "You stopped this video."}</p>
        {status.error && <pre className="whitespace-pre-wrap rounded bg-soft p-2 text-xs">{status.error}</pre>}
        {status.canvaRetry && (
          <ActionForm action={continueCanvaAction} onSuccess={() => setStatus({ ...status, stage: "canva", message: "Asking Canva again…", error: undefined })}>
            <FormMessage />
            <input type="hidden" name="id" value={id} />
            <SubmitButton>🎨 Continue with Canva</SubmitButton>
          </ActionForm>
        )}
        <div className="flex gap-2">
          <a href="/chaos" className="btn-primary">
            Back to the studio
          </a>
          <ActionForm action={deleteVideoAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="back" value="1" />
            <SubmitButton variant="default">Delete</SubmitButton>
          </ActionForm>
        </div>
      </div>
    );
  }

  if (status.stage === "pictures") {
    return (
      <div className="card max-w-2xl space-y-3">
        <p className="font-semibold text-[#2a1260]">🎨 Canva&apos;s designs are in. The video is waiting for your pictures (below).</p>
        <p className="text-sm text-muted">Upload the ones you want, then the video is made. Other videos can be made meanwhile.</p>
        <ActionForm action={deleteVideoAction} confirm={`Delete “${title}”?`}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="back" value="1" />
          <SubmitButton variant="default">Delete</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  const stageIdx = STAGES.findIndex((s) => s.key === status.stage);
  return (
    <div className="card max-w-2xl space-y-4">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-[#2a1260] tabular-nums">{Math.round(status.percent)}%</span>
        <span className="text-sm text-muted">{status.message}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-soft">
        <div className="h-full rounded-full bg-gradient-to-r from-[#ffb300] via-[#ff5c8d] to-[#7a2fc0] transition-[width] duration-700" style={{ width: `${Math.max(2, status.percent)}%` }} />
      </div>
      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {STAGES.map((s, i) => (
          <li key={s.key} className={i < stageIdx ? "text-ok" : i === stageIdx ? "font-semibold text-[#2a1260]" : "text-muted"}>
            {i < stageIdx ? "✓" : i === stageIdx ? "●" : "○"} {s.label}
          </li>
        ))}
      </ol>
      {status.stage === "canva" && (
        <p className="text-sm text-muted">
          Canva makes the designs one at a time (about a minute each). If Canva refuses one, the studio waits 5 minutes and tries again, and past the daily Canva limit
          (Chaos Creators → Usage) it carries on after midnight. The video is made right after.
        </p>
      )}
      <p className="text-sm text-muted">
        Running for {fmtDuration(status.elapsed)}
        {eta != null && eta > 0 ? ` · about ${fmtDuration(eta)} left` : ""}. You can leave this page; the video keeps being made.
      </p>
      <ActionForm action={stopVideoAction} confirm="Stop making this video?" onSuccess={() => setStatus({ ...status, stage: "stopped" })}>
        <FormMessage />
        <input type="hidden" name="id" value={id} />
        <SubmitButton variant="danger">Stop</SubmitButton>
      </ActionForm>
    </div>
  );
}
