import Link from "next/link";
import { notFound } from "next/navigation";
import { FORMATS } from "@/modules/chaos/csv";
import { getDraft } from "@/modules/chaos/facts-drafts";
import { getJob, isRunning, listJobs } from "@/modules/chaos/jobs";
import { RecordingDeck } from "./deck";

export const metadata = { title: "Recording deck" };

export default async function FactsDeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = getDraft(id);
  if (!draft) notFound();
  const busy = listJobs().find(isRunning);
  const videos = draft.videos
    .map(getJob)
    .filter((j): j is NonNullable<typeof j> => !!j)
    .map((j) => ({ id: j.id, title: j.title, stage: j.status.stage, createdAt: j.createdAt }));
  return (
    <>
      <Link href="/chaos?type=facts" className="mb-3 inline-block text-sm text-accent hover:underline">
        ← Studio
      </Link>
      <h1 className="text-2xl font-bold text-[#2a1260]">🎙️ {draft.title}</h1>
      <p className="mb-5 text-sm text-muted">
        Recording deck · {FORMATS[draft.format].label} · {draft.facts.length} facts{draft.middles.length ? ` · ${draft.middles.length} middle line${draft.middles.length === 1 ? "" : "s"}` : ""}. Recordings are
        saved as you go: close the page any time and carry on later.
      </p>
      <RecordingDeck draft={draft} busy={busy ? busy.title : null} videos={videos} />
    </>
  );
}
