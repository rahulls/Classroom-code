import { canvaStatus } from "@/modules/chaos/canva-jobs";
import type { JobView } from "@/modules/chaos/jobs";

/** Canva's reasons without the "fact 3 sticker:" prefixes, each said once. */
function reasons(error: string | undefined) {
  if (!error) return [];
  const all = error.split(" · ").map((e) => e.replace(/^[^:]{1,40}:\s*/, "").trim());
  return [...new Set(all)].slice(0, 3);
}

/**
 * What Canva made for a video with "Canva designs" ticked. When it failed the video still uses the
 * studio's own look, so say so plainly instead of leaving it to be noticed in the video.
 */
export function CanvaReport({ job }: { job: JobView }) {
  if (!job.settings.canva) return null;
  // While Canva's designs are being made the progress card says how it's going
  if (job.status.stage === "canva") return null;
  const st = canvaStatus(job.id);
  if (!st) return null;
  // Canva's work runs inside the web app: a restart while it runs leaves "running" behind for good
  if (st.state === "running" && ["done", "error", "stopped"].includes(job.status.stage))
    return (
      <p className="card mt-4 border-warn text-sm text-warn">
        🎨 Canva&apos;s designs were cut off: the app restarted while Canva was still working{st.note ? ` (${st.note.toLowerCase()})` : ""}. The video uses whatever had arrived. Make the video again to get all of Canva&apos;s pictures.
      </p>
    );
  if (st.state === "running")
    return st.note ? <p className="card mt-4 border-warn text-sm text-warn">🎨 {st.note}. The video waits for Canva&apos;s pictures.</p> : null;
  const planned = st.questionsPlanned ?? 0;
  const made = (st.questions?.length ?? 0) + (st.stickers?.length ?? 0);
  const all = st.state === "done" && st.screens && made >= planned;
  if (all) return null;
  const why = reasons(st.error);
  const cooling = why.some((r) => /cooling down/i.test(r));
  return (
    <section className={`card mt-4 text-sm ${st.state === "failed" ? "border-bad" : "border-warn"}`}>
      <b className={st.state === "failed" ? "text-bad" : "text-warn"}>
        🎨 {st.state === "failed" ? "Canva's designs didn't come through for this video" : "Canva made only part of the designs"}
      </b>
      <p className="mt-1">
        Intro and ending: {st.screens ? "made by Canva" : "studio's own"}
        {planned > 0 && ` · pictures: ${made} of ${planned} from Canva`}. The rest uses the studio&apos;s own look.
      </p>
      {cooling && (
        <p className="mt-1">
          Canva answered <i>&ldquo;Your credit usage is cooling down&rdquo;</i>: its AI allowance was used up or paused for a while. Make the video again once Canva works (the studio now waits and retries when this happens).
        </p>
      )}
      {why.length > 0 && !cooling && (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {why.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
