import fs from "node:fs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { Badge, PageHeader } from "@/components/ui";
import {
  addVisualsAction,
  approveScriptAction,
  approveVideoAction,
  backToScriptAction,
  publishNowAction,
  rejectAction,
  remakeVideoAction,
  resendThumbnailAction,
  retryAction,
  rewriteScriptAction,
  setVoiceAction,
  writeNowAction,
} from "@/modules/edu/actions";
import { makeProgress, makeResult, thumbFile, videoFile } from "@/modules/edu/making";
import { getEduUpload, publishMeta } from "@/modules/edu/publish";
import { STATUS_LABEL, getRow, getSettings, listEvents } from "@/modules/edu/store";
import { VOICES, voiceLabel } from "@/modules/edu/voices";
import { SCENE_HELP, builtInInstructions, estimateSeconds, getDraft, getInstructions, getPromptUsed, topicMessage } from "@/modules/edu/writer";
import { ActButton, AutoRefresh } from "../../parts";
import { TONE } from "../../tone";
import { PromptEditor } from "./prompt-editor";
import { ScriptEditor } from "./script-editor";

export const metadata = { title: "Review" };
export const dynamic = "force-dynamic";

const when = (t?: string) => (t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function RejectForm({ id, label = "Reject topic" }: { id: string; label?: string }) {
  return (
    <details className="inline-block">
      <summary className="btn-danger cursor-pointer list-none">{label}</summary>
      <ActionForm action={rejectAction} className="mt-2 w-80 space-y-2 rounded-lg border border-line bg-panel p-3">
        <input type="hidden" name="id" value={id} />
        <label className="block">
          <span className="label">Why (for the log)</span>
          <input name="reason" className="input" maxLength={500} />
        </label>
        <p className="text-xs text-muted">The topic is closed for good. To try it again, add a new row.</p>
        <SubmitButton variant="danger">Reject</SubmitButton>
        <FormMessage />
      </ActionForm>
    </details>
  );
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{6,40}$/.test(id)) notFound();
  const row = getRow(id);
  if (!row) notFound();
  const draft = getDraft(id);
  const result = makeResult(id);
  const progress = makeProgress(id);
  const upload = getEduUpload(id);
  const hasVideo = fs.existsSync(videoFile(id)) && !!result;
  const hasThumb = fs.existsSync(thumbFile(id));
  const meta = hasVideo ? publishMeta(id) : null;
  const events = listEvents(500).filter((e) => e.rowId === id);
  const running = ["writing", "making", "uploading", "approved"].includes(row.status);
  const s = getSettings();
  const v = Math.round(fs.existsSync(videoFile(id)) ? fs.statSync(videoFile(id)).mtimeMs : 0);
  const short = row.format === "short";

  return (
    <>
      <AutoRefresh every={8} when={running} />
      <div className="mb-2 text-sm">
        <Link href="/edu" className="text-accent hover:underline">
          ← Dashboard
        </Link>
      </div>
      <PageHeader
        title={draft?.title || row.topic}
        subtitle={
          <>
            Topic: {row.topic} · {short ? "Short" : "Long video"}
            {row.audience ? ` · for ${row.audience}` : ""}
          </>
        }
        actions={<Badge tone={TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>}
      />

      {(row.notices?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          {row.notices!.map((n, k) => (
            <p key={k}>! {n}</p>
          ))}
        </div>
      )}
      {row.error && row.status === "failed" && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-bad/5 p-3 text-sm text-bad">
          <p className="mb-2 font-semibold">It failed:</p>
          <p className="whitespace-pre-wrap">{row.error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActButton action={retryAction} fields={{ id }} variant="primary">
              Try again
            </ActButton>
            <RejectForm id={id} />
          </div>
        </div>
      )}

      {/* ---------------- step by step ---------------- */}
      {row.status === "queued" && (
        <div className="card mb-4 text-sm">
          <p className="mb-3">This topic is waiting in the list. Its script will be written at its turn.</p>
          <ActButton action={writeNowAction} fields={{ id }}>
            Write its script now
          </ActButton>
        </div>
      )}
      {row.status === "writing" && <div className="card mb-4 text-sm">Claude is writing the script (about a minute)…</div>}

      {row.status === "script_review" && draft && (
        <>
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="card text-sm">
              <h3 className="mb-2 font-semibold">Check these facts</h3>
              {draft.claims.length ? (
                <ul className="space-y-1">
                  {draft.claims.map((c, k) => (
                    <li key={k} className="flex gap-2">
                      <Badge tone={c.confidence === "high" ? "ok" : c.confidence === "medium" ? "warn" : "bad"}>{c.confidence}</Badge>
                      <span>{c.claim}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No factual claims listed.</p>
              )}
            </div>
            <div className="card text-sm">
              <h3 className="mb-2 font-semibold">Overlap with earlier videos</h3>
              <p>{draft.overlap_note || "No overlap"}</p>
              <h3 className="mb-1 mt-3 font-semibold">Summary</h3>
              <p className="text-muted">{draft.summary}</p>
              <ActionForm action={setVoiceAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={id} />
                <label className="block">
                  <span className="label">Narrator</span>
                  <select name="voice" defaultValue={draft.voice ?? "af_heart"} className="input py-1 text-sm">
                    {VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {voiceLabel(v.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton variant="default" className="text-xs">
                  Change voice
                </SubmitButton>
                <FormMessage />
              </ActionForm>
              <div className="mt-4 flex flex-wrap items-start gap-2">
                <ActButton action={approveScriptAction} fields={{ id }} variant="primary">
                  ✓ Approve script
                </ActButton>
                <ActButton action={addVisualsAction} fields={{ id }}>
                  {draft.scenes.some((sc) => sc.anim || sc.sticker) ? "↻ Redo 3D visuals" : "✨ Add 3D visuals"}
                </ActButton>
                <details className="inline-block">
                  <summary className="btn cursor-pointer list-none">Ask Claude to rewrite</summary>
                  <ActionForm action={rewriteScriptAction} className="mt-2 w-80 space-y-2 rounded-lg border border-line bg-panel p-3">
                    <input type="hidden" name="id" value={id} />
                    <label className="block">
                      <span className="label">What should change</span>
                      <textarea name="note" className="input" rows={3} maxLength={800} required />
                    </label>
                    <SubmitButton>Rewrite (about a minute)</SubmitButton>
                    <FormMessage />
                  </ActionForm>
                </details>
                <RejectForm id={id} />
              </div>
              <p className="mt-2 text-xs text-muted">
                Save your edits below before approving. Each scene has a 3D visual tick (animation by default, or a still sticker); “
                {draft.scenes.some((sc) => sc.anim || sc.sticker) ? "Redo" : "Add"} 3D visuals” asks Claude to choose them without changing any words.
              </p>
            </div>
          </div>
          <ScriptEditor key={draft.editedAt ?? draft.writtenAt} id={id} draft={draft} help={SCENE_HELP} format={row.format} />
        </>
      )}

      {(row.status === "script_review" || (row.status === "failed" && row.failedAt === "queued")) && (
        <>
          {(() => {
            const used = getPromptUsed(id);
            const def = getInstructions();
            const fresh = topicMessage(row);
            return (
              <details className="card mb-4" open={row.status === "failed"}>
                <summary className="cursor-pointer font-semibold">
                  ✎ Edit the prompt and regenerate{def.custom ? <span className="ml-2 text-xs font-normal text-muted">(your saved default instructions are in use)</span> : null}
                </summary>
                <div className="mt-3">
                  <PromptEditor
                    id={id}
                    instructions={used?.instructions ?? def.text}
                    message={used?.message ?? fresh}
                    defaultInstructions={def.text}
                    builtInInstructions={builtInInstructions()}
                    freshMessage={fresh}
                    customDefault={def.custom}
                    usedEdited={!!used?.edited}
                  />
                </div>
              </details>
            );
          })()}
        </>
      )}

      {(row.status === "approved" || row.status === "making") && (
        <div className="card mb-4 text-sm">
          {row.status === "approved" ? (
            <p>{s.paused ? "Script approved. The video will be made when the schedule is running (Start on the dashboard)." : "Script approved. The video starts being made within a minute (after any video already being made)."}</p>
          ) : (
            <>
              <p className="mb-2">{progress?.message ?? "Starting…"}</p>
              <div className="h-2 overflow-hidden rounded bg-soft">
                <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(3, progress?.percent ?? 0)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">A Short takes about 5–10 minutes, a long video 20–40.</p>
            </>
          )}
        </div>
      )}

      {hasVideo && ["video_review", "ready", "uploading", "published"].includes(row.status) && (
        <div className="mb-4 grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="card p-2">
            <video controls preload="metadata" src={`/edu/item/${id}/video?v=${v}`} className={`${short ? "h-[640px] w-[360px]" : "w-[640px]"} max-w-full rounded bg-black`} />
          </div>
          <div className="space-y-3">
            <div className="card text-sm">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge>{Math.round(result!.duration)} s</Badge>
                <Badge>{result!.scenes} scenes</Badge>
                <Badge tone={result!.thumbnail === "canva" ? "ok" : "warn"}>{result!.thumbnail === "canva" ? "Canva thumbnail" : "Minimal thumbnail (Canva failed)"}</Badge>
              </div>
              {hasThumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/edu/item/${id}/thumbnail?v=${v}`} alt="Thumbnail" className={`${short ? "w-40" : "w-80"} rounded border border-line`} />
              )}
            </div>
            {row.status === "video_review" && (
              <div className="card flex flex-wrap items-start gap-2">
                <ActButton action={approveVideoAction} fields={{ id }} variant="primary">
                  ✓ Approve video
                </ActButton>
                <ActButton action={remakeVideoAction} fields={{ id }}>
                  Make it again
                </ActButton>
                <ActButton action={backToScriptAction} fields={{ id }}>
                  Edit the script
                </ActButton>
                <RejectForm id={id} />
              </div>
            )}
            {row.status === "ready" && (
              <div className="card flex flex-wrap items-start gap-2 text-sm">
                <p className="w-full">Approved. It goes up (private) at the next free publishing slot.</p>
                <ActButton action={publishNowAction} fields={{ id }} variant="primary" confirm="Upload it to YouTube (private) now?">
                  Publish now
                </ActButton>
                <ActButton action={backToScriptAction} fields={{ id }}>
                  Edit the script
                </ActButton>
                <RejectForm id={id} />
              </div>
            )}
            {row.status === "uploading" && <div className="card text-sm">Uploading… {upload?.total ? `${Math.round((100 * upload.sent) / upload.total)}%` : ""}</div>}
            {row.status === "published" && row.youtube && (
              <div className="card text-sm">
                <p className="mb-1">
                  On YouTube as <b>private</b> since {when(row.publishedAt)}.
                </p>
                <a className="text-accent underline" href={`https://studio.youtube.com/video/${row.youtube.videoId}/edit`} target="_blank" rel="noreferrer">
                  Open in YouTube Studio
                </a>{" "}
                to check it and make it public.
                {row.youtube.thumbnail === "failed" && (
                  <div className="mt-2 space-y-2 rounded border border-warn/40 bg-warn/5 p-2">
                    <p className="text-warn">The thumbnail wasn&apos;t accepted: {row.youtube.thumbnailError}</p>
                    <p className="text-xs text-muted">
                      Verify the channel at{" "}
                      <a className="text-accent underline" href="https://www.youtube.com/verify" target="_blank" rel="noreferrer">
                        youtube.com/verify
                      </a>{" "}
                      (signed in as {row.youtube.channelTitle ?? "the Edu channel"}). The app sends the thumbnail again every 6 hours
                      {row.youtube.thumbTriedAt ? ` (last try ${when(row.youtube.thumbTriedAt)})` : ""}, or send it now:
                    </p>
                    <ActButton action={resendThumbnailAction} fields={{ id }}>
                      Send the thumbnail again
                    </ActButton>
                  </div>
                )}
                {row.youtube.thumbnail === "set" && <p className="mt-1 text-ok">Thumbnail set on YouTube.</p>}
              </div>
            )}
            {meta && (
              <div className="card text-sm">
                <h3 className="mb-1 font-semibold">Published with</h3>
                <p className="font-medium">{meta.title}</p>
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-sans text-xs text-muted">{meta.description}</pre>
                <p className="mt-1 text-xs text-muted">Tags: {meta.tags.join(", ")}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {draft && row.status !== "script_review" && (
        <details className="card mb-4">
          <summary className="cursor-pointer font-semibold">
            Script ({draft.scenes.length} scenes, about {estimateSeconds(draft.scenes)} s, narrator {voiceLabel(draft.voice)})
          </summary>
          <table className="table mt-2">
            <tbody>
              {draft.scenes.map((sc, k) => (
                <tr key={k}>
                  <td className="text-xs text-muted">{k + 1}</td>
                  <td className="text-xs">
                    <Badge>{sc.type}</Badge>
                    {sc.chapter && <div className="mt-1 text-accent">{sc.chapter}</div>}
                  </td>
                  <td className="text-sm">
                    {sc.say}
                    <div className="text-xs text-muted">{[sc.heading, sc.big, ...(sc.items ?? []).map((i) => [i.label, i.detail, i.value].filter(Boolean).join(" – "))].filter(Boolean).join(" · ")}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {row.status === "rejected" && <div className="card mb-4 text-sm">Rejected{row.rejectReason ? `: ${row.rejectReason}` : ""}. Add a new row on the Topics page to try this topic again.</div>}

      <section>
        <h2 className="mb-2 font-semibold">History</h2>
        <div className="card p-0">
          <table className="table">
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs text-muted">{when(e.at)}</td>
                  <td className={`text-sm ${e.kind === "error" ? "text-bad" : ""}`}>{e.text}</td>
                </tr>
              ))}
              <tr>
                <td className="whitespace-nowrap text-xs text-muted">{when(row.addedAt)}</td>
                <td className="text-sm text-muted">Added ({row.source ?? "list"})</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
