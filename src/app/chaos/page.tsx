import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { deleteVideoAction } from "@/modules/chaos/actions";
import { FORMATS, fmtDuration } from "@/modules/chaos/csv";
import { claudeKeyStatus } from "@/modules/chaos/generate";
import { engineReady, isRunning, listJobs, type JobView } from "@/modules/chaos/jobs";
import { canvaConnection } from "@/modules/chaos/canva";
import { Studio } from "./studio";

export const metadata = { title: "Studio" };

export default async function ChaosStudioPage() {
  const jobs = listJobs();
  const ready = engineReady();
  const busy = jobs.find(isRunning);
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-[#2a1260]">Make a quiz video</h1>
      <p className="mb-5 text-sm text-muted">Upload your questions, pick a format, and the studio builds the video with narration, timer, sounds and confetti.</p>
      {!ready.ok && <p className="card mb-4 border-bad text-sm text-bad">{ready.problem}</p>}
      {busy && (
        <Link href={`/chaos/videos/${busy.id}`} className="card mb-4 block border-warn text-sm hover:bg-warn/5">
          <b className="text-warn">“{busy.title}” is being made ({Math.round(busy.status.percent)}%).</b> Open it to watch the progress →
        </Link>
      )}
      <Studio busy={!!busy} claudeKey={claudeKeyStatus().ok} canva={canvaConnection().connected} />

      <section className="mt-8">
        <h2 className="mb-3 flex items-baseline gap-3 text-lg font-semibold text-[#2a1260]">
          Your videos
          <Link href="/chaos/dashboard" className="text-sm font-normal text-accent hover:underline">
            Open the dashboard (sortable list) →
          </Link>
        </h2>
        {jobs.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((j) => (
              <VideoCard key={j.id} job={j} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No videos yet.</p>
        )}
      </section>
    </>
  );
}

const STAGE: Record<string, { label: string; cls: string }> = {
  done: { label: "Ready", cls: "bg-ok/15 text-ok" },
  error: { label: "Failed", cls: "bg-bad/15 text-bad" },
  stopped: { label: "Stopped", cls: "bg-soft text-muted" },
};

function VideoCard({ job }: { job: JobView }) {
  const st = STAGE[job.status.stage] ?? { label: `Making… ${Math.round(job.status.percent)}%`, cls: "bg-warn/15 text-warn" };
  const r = job.status.result;
  return (
    <div className="card flex flex-col gap-2 p-3">
      <Link href={`/chaos/videos/${job.id}`} className="flex items-start gap-3 hover:opacity-90">
        {job.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/chaos/videos/${job.id}/thumbnail?v=${job.thumb}`} alt="" className={`shrink-0 rounded-lg object-cover ${job.format === "shorts" ? "h-20 w-[45px]" : "h-12 w-[85px]"}`} />
        ) : (
          <span className={`grid shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#3b1a7a] to-[#7a2fc0] text-xs font-bold text-white ${job.format === "shorts" ? "h-16 w-9" : "h-9 w-16"}`}>▶</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{job.title}</span>
          <span className="block text-xs text-muted">
            {FORMATS[job.format].label} · {job.questions} question{job.questions === 1 ? "" : "s"}
            {r ? ` · ${fmtDuration(r.duration)}` : ""}
          </span>
          <span className="block text-xs text-muted">{new Date(job.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
      </Link>
      <div className="flex items-center gap-2 text-sm">
        {job.status.stage === "done" && (
          <a className="btn" href={`/chaos/videos/${job.id}/file?download=1`} download>
            ⬇ Download
          </a>
        )}
        <ActionForm action={deleteVideoAction} confirm={`Delete “${job.title}”${job.status.stage === "done" ? " and its video file" : ""}?`} className="ml-auto">
          <input type="hidden" name="id" value={job.id} />
          <SubmitButton variant="default" className="text-xs">
            Delete
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
