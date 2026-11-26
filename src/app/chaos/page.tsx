import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { FORMATS, fmtDuration } from "@/modules/chaos/csv";
import { claudeKeyStatus } from "@/modules/chaos/generate";
import { engineReady, isRunning, listJobs, readLibraryCsv, type JobView } from "@/modules/chaos/jobs";
import { canvaConnection } from "@/modules/chaos/canva";
import { cardState, listDrafts, type FactsDraft } from "@/modules/chaos/facts-drafts";
import { deleteDraftAction, deleteVideoAction } from "@/modules/chaos/actions";
import { makeVideoHref } from "./csv/links";
import { FactsStudio } from "./facts-studio";
import { FlagsStudio } from "./flags-studio";
import { readFlagsLog } from "@/modules/chaos/flags-log";
import { Studio } from "./studio";

export const metadata = { title: "Studio" };

export default async function ChaosStudioPage({ searchParams }: { searchParams: Promise<{ type?: string; csv?: string }> }) {
  const sp = await searchParams;
  const facts = sp.type === "facts";
  const flags = sp.type === "flags";
  // "Make video" on the dashboard: open with that library CSV loaded (on the tab its kind belongs to)
  const lib = sp.csv ? readLibraryCsv(sp.csv) : null;
  if (lib && !flags && (lib.kind === "facts") !== facts) redirect(makeVideoHref(lib.name, lib.kind));
  const initial = lib ? { name: lib.name, content: lib.content } : undefined;
  const jobs = listJobs();
  const ready = engineReady();
  const busy = jobs.find(isRunning);
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-[#2a1260]">Make a video</h1>
      <p className="mb-4 text-sm text-muted">
        {flags
          ? "A memory game: flags flash by, then viewers find some of them hidden in a grid of flags. Pick a level, preview the flags, and the studio draws the whole video."
          : facts
          ? "Upload your facts (or let Claude write them), choose who reads them, and the studio builds the video with pictures, music and the kid voice."
          : "Upload your questions, pick a format, and the studio builds the video with narration, timer, sounds and confetti."}
      </p>
      <TypeTabs type={flags ? "flags" : facts ? "facts" : "quiz"} />
      {sp.csv && !lib && <p className="card mb-4 border-warn text-sm text-warn">“{sp.csv}” isn&apos;t in the csv folder any more. Upload it below instead.</p>}
      {!ready.ok && <p className="card mb-4 border-bad text-sm text-bad">{ready.problem}</p>}
      {busy && (
        <Link href={`/chaos/videos/${busy.id}`} className="card mb-4 block border-warn text-sm hover:bg-warn/5">
          <b className="text-warn">“{busy.title}” is being made ({Math.round(busy.status.percent)}%).</b> Open it to watch the progress →
        </Link>
      )}
      {flags ? (
        <FlagsStudio
          busy={!!busy}
          seed={Date.now() % 1_000_000_000}
          made={readFlagsLog().map((v) => ({ jobId: v.jobId, title: v.title, level: v.level, createdAt: v.createdAt, shown: v.rounds.flatMap((r) => r.show) }))}
        />
      ) : facts ? (
        <>
          <Decks />
          <FactsStudio key={initial?.name} busy={!!busy} claudeKey={claudeKeyStatus().ok} canva={canvaConnection().connected} initial={initial} />
        </>
      ) : (
        <Studio key={initial?.name} busy={!!busy} claudeKey={claudeKeyStatus().ok} canva={canvaConnection().connected} initial={initial} />
      )}

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

/** Quiz video or facts video: two tabs (the address keeps the choice, so a reload stays on it). */
function TypeTabs({ type }: { type: "quiz" | "facts" | "flags" }) {
  const tabs = [
    { href: "/chaos", on: type === "quiz", icon: "🧠", title: "Quiz video", text: "Questions, four options, a timer and the answer reveal" },
    { href: "/chaos?type=facts", on: type === "facts", icon: "💡", title: "Facts video", text: "“Did you know?” facts, read by the AI voice or recorded by you" },
    { href: "/chaos?type=flags", on: type === "flags", icon: "🚩", title: "Flag memory game", text: "Flags flash by, then find them in a grid of flags" },
  ];
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-3" role="tablist">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          role="tab"
          aria-selected={t.on}
          className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${t.on ? "border-[#7a2fc0] bg-panel shadow-sm" : "border-transparent bg-panel/60 hover:bg-panel"}`}
        >
          <span className="text-2xl">{t.icon}</span>
          <span>
            <b className={`block ${t.on ? "text-[#2a1260] dark:text-[#d9c8ff]" : ""}`}>{t.title}</b>
            <span className="block text-xs text-muted">{t.text}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Recording decks still open: carry on where you left off. */
function Decks() {
  const drafts = listDrafts();
  if (!drafts.length) return null;
  return (
    <section className="card mb-4">
      <h2 className="mb-2 font-semibold text-[#2a1260] dark:text-[#d9c8ff]">🎙️ Recording decks</h2>
      <ul className="divide-y divide-line">
        {drafts.map((d) => (
          <DeckRow key={d.id} d={d} />
        ))}
      </ul>
    </section>
  );
}

function DeckRow({ d }: { d: FactsDraft }) {
  const done = d.facts.filter((f) => cardState(d, f.key) === "done").length;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <Link href={`/chaos/facts/${d.id}`} className="min-w-0 flex-1 hover:underline">
        <b className="block truncate">{d.title}</b>
        <span className="text-xs text-muted">
          {FORMATS[d.format].label} · {done} of {d.facts.length} facts recorded
          {d.videos.length ? ` · ${d.videos.length} video${d.videos.length === 1 ? "" : "s"} made` : ""} · {new Date(d.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
        </span>
      </Link>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-soft">
        <div className="h-full bg-ok" style={{ width: `${(done / Math.max(1, d.facts.length)) * 100}%` }} />
      </div>
      <Link href={`/chaos/facts/${d.id}`} className="btn text-xs">
        {done === d.facts.length ? "Open" : "Continue"}
      </Link>
      <ActionForm action={deleteDraftAction} confirm={`Delete the recording deck “${d.title}” and its recordings? Videos made from it stay.`}>
        <input type="hidden" name="id" value={d.id} />
        <SubmitButton variant="default" className="text-xs">
          Delete
        </SubmitButton>
      </ActionForm>
    </li>
  );
}

const STAGE: Record<string, { label: string; cls: string }> = {
  done: { label: "Ready", cls: "bg-ok/15 text-ok" },
  error: { label: "Failed", cls: "bg-bad/15 text-bad" },
  stopped: { label: "Stopped", cls: "bg-soft text-muted" },
};

function VideoCard({ job }: { job: JobView }) {
  const st = STAGE[job.status.stage] ?? { label: job.status.stage === "pictures" ? "Waiting for your pictures" : `${job.status.stage === "canva" ? "Canva designs" : "Making…"} ${Math.round(job.status.percent)}%`, cls: "bg-warn/15 text-warn" };
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
            {job.kind === "facts" ? "💡 Facts · " : job.kind === "flags" ? "🚩 Flags · " : ""}
            {FORMATS[job.format].label} · {job.questions} {job.kind === "facts" ? "fact" : job.kind === "flags" ? "round" : "question"}
            {job.questions === 1 ? "" : "s"}
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
