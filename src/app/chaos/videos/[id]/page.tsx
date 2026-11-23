import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { canvaThumbnailAction, newThumbnailAction } from "@/modules/chaos/actions";
import { FORMATS } from "@/modules/chaos/csv";
import { getJob, imageCredit, listImages, musicCheck, type JobView } from "@/modules/chaos/jobs";
import { canvaConnection } from "@/modules/chaos/canva";
import { getUpload, videoMeta, youtubeConnection } from "@/modules/chaos/youtube";
import { yourPictureSlots } from "@/modules/chaos/canva-jobs";
import { CanvaReport } from "./canva-report";
import { TopicPhoto } from "./topic-photo";
import { VideoStatus } from "./video-status";
import { YoutubePanel } from "./youtube-panel";
import { YourPictures } from "./your-pictures";

export const metadata = { title: "Video" };

export default async function ChaosVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();
  return (
    <>
      <Link href="/chaos" className="mb-3 inline-block text-sm text-accent hover:underline">
        ← Studio
      </Link>
      <h1 className="text-2xl font-bold text-[#2a1260]">{job.title}</h1>
      <p className="mb-5 text-sm text-muted">
        {job.kind === "facts" ? `💡 Facts video${job.narration === "record" ? " (recorded narration)" : ""} · ` : ""}
        {FORMATS[job.format].label} ({FORMATS[job.format].detail}) · {job.questions} {job.kind === "facts" ? "fact" : "question"}
        {job.questions === 1 ? "" : "s"} · made{" "}
        {new Date(job.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
      </p>
      {/* A new key when the video stops / starts waiting for pictures: the live status starts afresh */}
      <VideoStatus key={job.status.stage === "pictures" ? "pictures" : "live"} id={job.id} title={job.title} format={job.format} initial={job.status} />
      <PicturesPanel job={job} />
      <CanvaReport job={job} />
      {job.status.stage === "done" && <Publish job={job} />}
    </>
  );
}

function PicturesPanel({ job }: { job: JobView }) {
  if (job.status.stage !== "canva" && job.status.stage !== "pictures") return null;
  const slots = yourPictureSlots(job.id);
  if (!slots) return null;
  return <YourPictures id={job.id} slots={slots} waiting={job.status.stage === "pictures"} kind={job.kind === "facts" ? "facts" : "quiz"} />;
}

function Publish({ job }: { job: JobView }) {
  const conn = youtubeConnection();
  return (
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="card space-y-3">
        <h2 className="font-semibold text-[#2a1260]">Thumbnail</h2>
        {job.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/chaos/videos/${job.id}/thumbnail?v=${job.thumb}`}
            alt="Thumbnail for this video"
            className={`block rounded-lg shadow ${job.format === "shorts" ? "w-full max-w-[240px]" : "w-full"}`}
          />
        ) : (
          <p className="text-sm text-muted">No thumbnail yet.</p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <ActionForm action={newThumbnailAction}>
            <FormMessage />
            <input type="hidden" name="id" value={job.id} />
            <SubmitButton variant={job.thumb ? "default" : "primary"}>{job.thumb ? "🎲 New design" : "Design a thumbnail"}</SubmitButton>
          </ActionForm>
          {canvaConnection().connected && (
            <ActionForm action={canvaThumbnailAction}>
              <FormMessage />
              <input type="hidden" name="id" value={job.id} />
              <SubmitButton variant="default">🎨 Canva thumbnail</SubmitButton>
            </ActionForm>
          )}
          {job.thumb ? (
            <a className="btn" href={`/chaos/videos/${job.id}/thumbnail?download=1&v=${job.thumb}`} download>
              ⬇ Download
            </a>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          {job.format === "shorts" ? "1080×1920 cover, for Shorts and Reels." : "1280×720, the size YouTube wants."} Each design is different:{" "}
          {job.kind === "facts" ? "new background, picture and slogan." : "new colours, layout, featured question and slogan. The answer is never shown."}
          {canvaConnection().connected ? (
            " 🎨 Canva thumbnail asks Canva's AI for a full SEO-friendly design about the topic (1–2 minutes; also saved in your Canva folder)."
          ) : (
            <>
              {" "}
              <a href="/chaos/canva/connect" className="text-accent hover:underline">
                Connect Canva
              </a>{" "}
              to get a 🎨 Canva thumbnail button.
            </>
          )}
        </p>
        <TopicPhoto
          id={job.id}
          current={job.settings.thumb_image ? { name: job.settings.thumb_image, credit: imageCredit(job.settings.thumb_image) ?? null } : null}
          images={listImages()}
        />
      </section>
      <YoutubePanel
        id={job.id}
        configured={!!conn.clientId && conn.hasSecret}
        connected={conn.connected}
        channelTitle={conn.channelTitle}
        hasThumb={!!job.thumb}
        thumbUrl={job.thumb ? `/chaos/videos/${job.id}/thumbnail?v=${job.thumb}` : null}
        initial={getUpload(job.id)}
        defaults={videoMeta(job)}
        music={musicCheck(job)}
      />
    </div>
  );
}
