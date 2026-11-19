"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { pushThumbnailAction, saveYoutubeMetaAction, uploadToYoutubeAction } from "@/modules/chaos/actions";
import { DEFAULT_CATEGORY, YT_CATEGORIES, YT_DESCRIPTION_MAX, YT_TAGS_MAX, YT_TITLE_MAX, categoryName, parseTags } from "@/modules/chaos/csv";
import type { MusicCheck } from "@/modules/chaos/jobs";
import type { UploadState } from "@/modules/chaos/youtube";

const mb = (n: number) => `${(n / 1e6).toFixed(n > 1e8 ? 0 : 1)} MB`;
const PRIVACY = { private: "Private (only you)", unlisted: "Unlisted (anyone with the link)", public: "Public" } as const;
type Privacy = keyof typeof PRIVACY;

export type YoutubeDefaults = { title: string; description: string; tags: string[]; category?: string; fromCsvOrSaved: boolean };

/** Publish to YouTube: edit the details, review them, upload, then live progress and the links. */
export function YoutubePanel({
  id,
  configured,
  connected,
  channelTitle,
  hasThumb,
  thumbUrl,
  initial,
  defaults,
  music,
  onUploaded,
}: {
  id: string;
  configured: boolean;
  connected: boolean;
  channelTitle: string | null;
  hasThumb: boolean;
  thumbUrl?: string | null;
  initial: UploadState | null;
  defaults: YoutubeDefaults;
  music: MusicCheck;
  /** Called when the upload finishes (the dashboard ticks its row) */
  onUploaded?: (videoId: string, privacy: string) => void;
}) {
  const [upload, setUpload] = useState(initial);
  const uploading = upload?.state === "uploading";
  const done = useRef(onUploaded);
  done.current = onUploaded;

  useEffect(() => {
    if (!uploading) return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/chaos/videos/${id}/youtube`, { cache: "no-store" });
        if (!r.ok || stop) return;
        const u = (await r.json()) as UploadState | null;
        setUpload(u);
        if (u?.state === "done" && u.videoId) done.current?.(u.videoId, u.privacy);
      } catch {
        /* try again on the next tick */
      }
    }, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, uploading]);

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 font-semibold text-[#2a1260]">
        <span className="grid h-6 w-8 place-items-center rounded-md bg-[#ff0033] text-[10px] text-white">▶</span> Publish to YouTube
      </h2>

      {uploading ? (
        <div className="space-y-2">
          <p className="text-sm">
            Uploading to <b>{upload.channelTitle ?? channelTitle}</b>… {mb(upload.sent)} of {mb(upload.total)}
          </p>
          <div className="h-3 overflow-hidden rounded-full bg-soft">
            <div className="h-full rounded-full bg-[#ff0033] transition-[width] duration-700" style={{ width: `${Math.max(2, (100 * upload.sent) / upload.total)}%` }} />
          </div>
          <p className="text-xs text-muted">Keep the app running until it finishes. You can leave this page.</p>
        </div>
      ) : upload?.state === "done" && upload.videoId ? (
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-ok">
            ✓ Uploaded to {upload.channelTitle ?? channelTitle} as {upload.privacy}
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-primary" href={`https://youtu.be/${upload.videoId}`} target="_blank" rel="noreferrer">
              Open on YouTube ↗
            </a>
            <a className="btn" href={`https://studio.youtube.com/video/${upload.videoId}/edit`} target="_blank" rel="noreferrer">
              Edit in YouTube Studio ↗
            </a>
          </div>
          {upload.thumbnail === "set" && <p className="text-xs text-ok">✓ Thumbnail set</p>}
          {upload.thumbnail === "failed" && <p className="text-xs text-bad">Thumbnail not set: {upload.thumbnailError}</p>}
          {hasThumb && (
            <ActionForm action={pushThumbnailAction} onSuccess={() => setUpload({ ...upload, thumbnail: "set", thumbnailError: undefined })}>
              <FormMessage />
              <input type="hidden" name="id" value={id} />
              <SubmitButton variant="default" className="text-xs">
                Send the current thumbnail to YouTube
              </SubmitButton>
            </ActionForm>
          )}
          {upload.privacy !== "private" && (
            <p className="text-xs text-muted">If YouTube shows it as “Private (locked)”, that&apos;s the rule for new Google projects (see the YouTube page).</p>
          )}
        </div>
      ) : (
        <DetailsAndUpload
          id={id}
          configured={configured}
          connected={connected}
          channelTitle={channelTitle}
          hasThumb={hasThumb}
          thumbUrl={thumbUrl}
          lastError={upload?.state === "error" ? upload.error : undefined}
          defaults={defaults}
          music={music}
          onStarted={() =>
            setUpload({ state: "uploading", sent: 0, total: 1, startedAt: new Date().toISOString(), updatedAt: Date.now(), title: "", privacy: "private", channelTitle: channelTitle ?? undefined })
          }
        />
      )}
    </section>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={`text-xs tabular-nums ${n > max ? "text-bad" : n > max * 0.9 ? "text-warn" : "text-muted"}`}>{`${n} / ${max}`}</span>;
}

/** Step 1: edit (and save) the details. Step 2: review everything once, then upload. */
function DetailsAndUpload({
  id,
  configured,
  connected,
  channelTitle,
  hasThumb,
  thumbUrl,
  lastError,
  defaults,
  music,
  onStarted,
}: {
  id: string;
  configured: boolean;
  connected: boolean;
  channelTitle: string | null;
  hasThumb: boolean;
  thumbUrl?: string | null;
  lastError?: string;
  defaults: YoutubeDefaults;
  music: MusicCheck;
  onStarted: () => void;
}) {
  const [title, setTitle] = useState(defaults.title);
  const [description, setDescription] = useState(defaults.description);
  const [tags, setTags] = useState(defaults.tags.join(", "));
  const [category, setCategory] = useState(defaults.category || DEFAULT_CATEGORY);
  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [useThumb, setUseThumb] = useState(hasThumb);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [save, setSave] = useState<{ busy?: boolean; msg?: string; err?: string }>({});

  const tagList = parseTags(tags);
  const tagChars = tagList.join(",").length;
  const problems = [
    !title.trim() && "The title is empty.",
    title.length > YT_TITLE_MAX && `The title is over ${YT_TITLE_MAX} characters.`,
    description.length > YT_DESCRIPTION_MAX && `The description is over ${YT_DESCRIPTION_MAX} characters.`,
    !music.ok && music.problem,
  ].filter((p): p is string => !!p);
  const hints = [
    title.length < 30 && "Titles of 40 to 70 characters, with the topic first, do best in search.",
    !/#\w/.test(description) && "Add 3 to 5 #hashtags at the end of the description.",
    tagList.length < 5 && "Add a few more tags (the topic, the quiz type, the people or places in it).",
  ].filter((p): p is string => !!p);

  const saveDetails = async () => {
    setSave({ busy: true });
    const fd = new FormData();
    fd.set("id", id);
    fd.set("title", title);
    fd.set("description", description);
    fd.set("tags", tags);
    fd.set("category", category);
    const res = await saveYoutubeMetaAction(undefined, fd);
    setSave(res?.ok ? { msg: "Saved. These details stay with the video." } : { err: res && !res.ok ? res.error : "Couldn't save." });
  };

  if (step === "review")
    return (
      <ActionForm action={uploadToYoutubeAction} className="space-y-3" onSuccess={onStarted}>
        <FormMessage />
        <p className="rounded-md bg-warn/10 px-3 py-2 text-sm text-[#7a4a00]">
          <b>Review before uploading.</b> This is exactly what goes to <b>{channelTitle}</b>.
        </p>
        <dl className="space-y-3 text-sm">
          <div className="flex gap-3">
            {thumbUrl && useThumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl} alt="Thumbnail" className="h-24 w-auto rounded object-cover shadow" />
            )}
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase text-muted">Title</dt>
              <dd className="font-semibold">{title}</dd>
            </div>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Description</dt>
            <dd className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-soft/40 p-2 text-xs">{description || "(none)"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Tags ({tagList.length})</dt>
            <dd className="flex flex-wrap gap-1">
              {tagList.length ? tagList.map((t) => <span key={t} className="rounded-full bg-soft px-2 py-0.5 text-xs">{t}</span>) : "(none)"}
            </dd>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">Category</dt>
              <dd>{categoryName(category)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">Visibility</dt>
              <dd>{PRIVACY[privacy]}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">Made for kids</dt>
              <dd>No</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">Music</dt>
              <dd className={music.ok ? "" : "text-bad"}>{music.track ?? "None / unknown"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">Thumbnail</dt>
              <dd>{hasThumb ? (useThumb ? "The one shown here" : "YouTube picks a frame") : "YouTube picks a frame"}</dd>
            </div>
          </div>
        </dl>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="tags" value={tagList.join(", ")} />
        <input type="hidden" name="privacy" value={privacy} />
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="madeForKids" value="no" />
        {useThumb && <input type="hidden" name="useThumbnail" value="1" />}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => setStep("edit")}>
            ← Edit
          </button>
          <SubmitButton>✓ Confirm and upload</SubmitButton>
        </div>
      </ActionForm>
    );

  return (
    <div className="space-y-3">
      {lastError && <p className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">Last try failed: {lastError}</p>}
      <p className="text-xs text-muted">
        {defaults.fromCsvOrSaved ? "From the CSV (or your last save)." : "Suggested from the video: the CSV had no YouTube lines."} Change anything, then save or review.
      </p>
      <label className="block">
        <span className="label flex items-center justify-between">
          <span>
            Title<span className="text-bad"> *</span>
          </span>
          <Counter n={title.length} max={YT_TITLE_MAX} />
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={YT_TITLE_MAX + 20} className="input" />
      </label>
      <label className="block">
        <span className="label flex items-center justify-between">
          <span>Description</span>
          <Counter n={description.length} max={YT_DESCRIPTION_MAX} />
        </span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={10} className="input font-mono text-xs" />
        <span className="mt-1 block text-xs text-muted">Credits for Creative Commons music are added automatically.</span>
      </label>
      <label className="block">
        <span className="label flex items-center justify-between">
          <span>Tags</span>
          <Counter n={tagChars} max={YT_TAGS_MAX} />
        </span>
        <textarea value={tags} onChange={(e) => setTags(e.target.value)} rows={2} className="input text-sm" />
        <span className="mt-1 block text-xs text-muted">Separated by commas · {tagList.length} tags</span>
      </label>
      <label className="block">
        <span className="label">Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
          {YT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {hints.length > 0 && (
        <ul className="list-inside list-disc text-xs text-muted">
          {hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={save.busy || !title.trim()} onClick={saveDetails}>
          {save.busy ? "Saving…" : "💾 Save details"}
        </button>
        {save.msg && <span className="text-xs text-ok">{save.msg}</span>}
        {save.err && <span className="text-xs text-bad">{save.err}</span>}
      </div>

      <hr className="border-line" />
      {!connected ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted">Connect your Chaos Creators channel once to upload from here.</p>
          <a className="btn-primary inline-block" href={configured ? `/chaos/youtube/connect?back=/chaos/videos/${id}` : "/chaos/youtube"}>
            {configured ? "▶ Connect YouTube" : "Set up the YouTube connection →"}
          </a>
        </div>
      ) : (
        <>
          <label className="block">
            <span className="label">Visibility</span>
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)} className="input">
              {Object.entries(PRIVACY).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm">
            <span className="label">Made for kids</span>
            No. Chaos Creators videos are set as not made for kids.
          </p>
          {hasThumb && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useThumb} onChange={(e) => setUseThumb(e.target.checked)} className="h-4 w-4" /> Use the studio&apos;s thumbnail
            </label>
          )}
          <p className={`text-xs ${music.ok ? "text-muted" : "text-bad"}`}>Music: {music.track ?? "none / unknown"}</p>
          {problems.length > 0 && (
            <ul className="list-inside list-disc rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-primary" disabled={problems.length > 0} onClick={() => setStep("review")}>
            Review and upload →
          </button>
        </>
      )}
    </div>
  );
}
