import Link from "next/link";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { canvaConnection } from "@/modules/chaos/canva";
import { claudeKeyStatus } from "@/modules/chaos/generate";
import { youtubeConnection } from "@/modules/chaos/youtube";
import { dismissAlertsAction, pauseScheduleAction, startScheduleAction, writeNowAction } from "@/modules/edu/actions";
import { engineProblem, makeProgress } from "@/modules/edu/making";
import { getEduUpload } from "@/modules/edu/publish";
import { timeline } from "@/modules/edu/scheduler";
import { channelName } from "@/modules/edu/brand";
import { STATUS_LABEL, getSettings, listEvents, listRows, type RowStatus, type TopicRow } from "@/modules/edu/store";
import { ActButton, AutoRefresh } from "./parts";
import { TONE } from "./tone";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const when = (t: number | string | null | undefined) =>
  t == null ? "—" : new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });


function progressOf(r: TopicRow) {
  if (r.status === "making") {
    const p = makeProgress(r.id);
    return p ? `${Math.round(p.percent)}% · ${p.message}` : "starting…";
  }
  if (r.status === "uploading") {
    const u = getEduUpload(r.id);
    return u?.total ? `${Math.round((100 * u.sent) / u.total)}% uploaded` : "starting…";
  }
  if (r.status === "writing") return "Claude is writing (about a minute)";
  return null;
}

function LatestCard({ label, row, empty, children }: { label: string; row?: TopicRow; empty: string; children?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      {row ? (
        <>
          <Link href={`/edu/item/${row.id}`} className="mt-0.5 block truncate font-medium hover:underline" title={row.title || row.topic}>
            {row.title || row.topic}
          </Link>
          <div className="text-xs text-muted">{children}</div>
        </>
      ) : (
        <div className="mt-0.5 text-sm text-muted">{empty}</div>
      )}
    </div>
  );
}

export default async function EduDashboard() {
  const s = getSettings();
  const rows = listRows();
  const tl = timeline();
  const events = listEvents(200);
  const alerts = events.filter((e) => e.kind !== "info" && !e.dismissed);
  const yt = youtubeConnection("edu");
  const name = channelName();
  const canva = canvaConnection();
  const claude = claudeKeyStatus();
  const engine = engineProblem();
  const needs = rows.filter((r) => r.status === "script_review" || r.status === "video_review" || r.status === "failed");
  const active = rows.filter((r) => ["writing", "approved", "making", "ready", "uploading"].includes(r.status));
  const published = rows.filter((r) => r.status === "published").sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const count = (st: RowStatus) => rows.filter((r) => r.status === st).length;
  const running = rows.some((r) => ["writing", "making", "uploading"].includes(r.status));
  const ready = rows.filter((r) => r.status === "ready").sort((a, b) => (a.videoApprovedAt ?? "").localeCompare(b.videoApprovedAt ?? ""));
  const latest = (key: "scriptApprovedAt" | "videoApprovedAt") =>
    rows.filter((r) => r[key] && r.status !== "rejected").sort((a, b) => (b[key] ?? "").localeCompare(a[key] ?? ""))[0];
  const lastScript = latest("scriptApprovedAt");
  const lastVideo = latest("videoApprovedAt");
  const making = rows.find((r) => r.status === "making");
  const writingRow = rows.find((r) => r.status === "writing");
  const uploadingRow = rows.find((r) => r.status === "uploading");
  const approvedWaiting = count("approved");
  const slots = Array.from({ length: 5 }, (_, k) => tl.nextPublish + k * s.intervalHours * 3600_000);

  return (
    <>
      <AutoRefresh every={running ? 10 : 30} />
      <PageHeader
        title="Edu videos"
        subtitle={`A video every ${s.intervalHours} hours, uploaded to YouTube as private after your two reviews (script, then video).`}
        actions={
          s.paused ? (
            <ActButton action={startScheduleAction} variant="primary">
              ▶ Start schedule
            </ActButton>
          ) : (
            <ActButton action={pauseScheduleAction}>⏸ Pause</ActButton>
          )
        }
      />

      {/* status strip */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="text-xs text-muted">Schedule</div>
          <div className={`text-lg font-semibold ${s.paused ? "text-warn" : "text-ok"}`}>{s.paused ? "Paused" : "Running"}</div>
          <div className="text-xs text-muted">
            every {s.intervalHours} h from {s.firstSlot} · keeps {s.keepAhead} topics ahead · wants {s.minReady} approved ready
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Next publishing slot</div>
          <div className="text-lg font-semibold">{when(tl.nextPublish)}</div>
          <div className="text-xs text-muted">{ready.length ? `“${ready[0]!.title}” goes up then` : "No approved video yet: the slot will be skipped"}</div>
          <div className={`mt-1 text-xs font-medium ${ready.length >= s.minReady ? "text-ok" : "text-warn"}`}>
            {ready.length} approved video{ready.length === 1 ? "" : "s"} ready (want {s.minReady})
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Next script</div>
          <div className="text-lg font-semibold">{s.paused || tl.nextWrite == null ? "—" : tl.nextWrite <= Date.now() + 90_000 ? "Now" : when(tl.nextWrite)}</div>
          <div className="text-xs text-muted">
            {tl.nextWrite == null ? "The list is finished. " : tl.ahead >= s.keepAhead ? `${tl.ahead} topics already ahead: the next is written when one goes up. ` : `${tl.ahead} of ${s.keepAhead} ahead. `}
            {tl.queued} topic{tl.queued === 1 ? "" : "s"} in the list{tl.runsOutAt ? ` · lasts until about ${when(tl.runsOutAt)}` : ""}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-muted">Connections</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li className={yt.connected ? "text-ok" : "text-warn"}>{yt.connected ? `✓ YouTube: ${yt.channelTitle}` : `! YouTube not connected: uploads on hold${rows.some((r) => r.status === "ready") ? ` (${rows.filter((r) => r.status === "ready").length} ready)` : ""}`}</li>
            <li className={name ? "text-ok" : "text-warn"}>{name ? `✓ Channel name: ${name}` : "! No channel name yet (endings say “Subscribe for more”)"}</li>
            <li className={canva.connected ? "text-ok" : "text-warn"}>{canva.connected ? "✓ Canva" : "! Canva not connected (simple thumbnails)"}</li>
            <li className={claude.ok ? "text-ok" : "text-bad"}>{claude.ok ? "✓ Claude key" : "✗ No Claude API key"}</li>
            <li className={engine ? "text-bad" : "text-ok"}>{engine ? `✗ ${engine}` : "✓ Video engine"}</li>
          </ul>
          {(!yt.connected || !canva.connected || !claude.ok || !name) && (
            <div className="mt-1 text-xs">
              <Link className="text-accent underline" href={!claude.ok || !yt.connected || !name ? "/edu/settings" : "/chaos/canva"}>
                {!claude.ok ? "Add the Claude key in Settings" : !yt.connected || !name ? "Set up the channel in Settings" : "Connect Canva in Chaos Creators"}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* alerts */}
      {alerts.length > 0 && (
        <section className="mb-5 rounded-lg border border-warn/40 bg-warn/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-semibold">Alerts ({alerts.length})</h2>
            <ActButton action={dismissAlertsAction} fields={{ ids: alerts.map((a) => a.id) }} className="ml-auto">
              Dismiss all
            </ActButton>
          </div>
          <ul className="space-y-2 text-sm">
            {alerts.slice(0, 15).map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <span className={a.kind === "error" ? "text-bad" : "text-warn"}>{a.kind === "error" ? "✗" : "!"}</span>
                <span className="flex-1">
                  <span className="text-muted">{when(a.at)} · </span>
                  {a.text}
                  {a.rowId && (
                    <>
                      {" "}
                      <Link href={`/edu/item/${a.rowId}`} className="text-accent underline">
                        open
                      </Link>
                    </>
                  )}
                </span>
                <ActButton action={dismissAlertsAction} fields={{ ids: [a.id] }}>
                  ✓
                </ActButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* latest progress */}
      <section className="mb-5">
        <h2 className="mb-2 font-semibold">Latest</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LatestCard label="Being made now" row={making ?? writingRow} empty={approvedWaiting ? `${approvedWaiting} approved script${approvedWaiting === 1 ? "" : "s"} waiting to be made` : "Nothing being made"}>
            {making ? progressOf(making) : writingRow ? "Claude is writing the script" : null}
          </LatestCard>
          <LatestCard label="Latest upload" row={uploadingRow ?? published[0]} empty="Nothing uploaded yet">
            {uploadingRow ? progressOf(uploadingRow) : published[0] ? (
              <>
                {when(published[0].publishedAt)} ·{" "}
                {published[0].youtube && (
                  <a className="text-accent underline" href={`https://studio.youtube.com/video/${published[0].youtube.videoId}/edit`} target="_blank" rel="noreferrer">
                    YouTube Studio
                  </a>
                )}
              </>
            ) : null}
          </LatestCard>
          <LatestCard label="Latest script approved" row={lastScript} empty="No script approved yet">
            {lastScript ? `${when(lastScript.scriptApprovedAt)} · now: ${STATUS_LABEL[lastScript.status]}` : null}
          </LatestCard>
          <LatestCard label="Latest video approved" row={lastVideo} empty="No video approved yet">
            {lastVideo ? `${when(lastVideo.videoApprovedAt)} · now: ${STATUS_LABEL[lastVideo.status]}` : null}
          </LatestCard>
        </div>
        <p className="mt-2 text-xs text-muted">
          Ahead of upload: {tl.ahead} of {s.keepAhead} ({count("script_review")} script{count("script_review") === 1 ? "" : "s"} to review, {count("approved") + count("making")} to make, {count("video_review")} video{count("video_review") === 1 ? "" : "s"} to review, {ready.length} ready)
        </p>
      </section>

      {/* needs you */}
      <section className="mb-5">
        <h2 className="mb-2 font-semibold">Waiting for you</h2>
        {needs.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {needs.map((r) => (
              <Link key={r.id} href={`/edu/item/${r.id}`} className="card flex items-center gap-3 hover:border-accent">
                <span className="text-2xl">{r.status === "script_review" ? "📝" : r.status === "video_review" ? "🎬" : "⚠️"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.title || r.topic}</span>
                  <span className="text-xs text-muted">
                    {r.status === "script_review" ? "Read and approve the script" : r.status === "video_review" ? "Watch and approve the video" : `Failed: ${r.error?.slice(0, 90)}`} · {r.format}
                  </span>
                </span>
                <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>Nothing to review right now.</Empty>
        )}
      </section>

      {/* counts */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["In the list", count("queued")],
            ["In progress", tl.inProgress],
            ["Published", count("published")],
            ["Rejected", count("rejected")],
            ["Failed", count("failed")],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="card">
            <div className="text-2xl font-semibold">{v}</div>
            <div className="text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {/* pipeline */}
        <section>
          <h2 className="mb-2 font-semibold">On the belt</h2>
          {active.length ? (
            <div className="card p-0">
              <table className="table">
                <tbody>
                  {active.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/edu/item/${r.id}`} className="font-medium hover:underline">
                          {r.title || r.topic}
                        </Link>
                        <div className="text-xs text-muted">{progressOf(r) ?? r.format}</div>
                      </td>
                      <td className="text-right">
                        <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              Nothing in progress.{" "}
              {tl.queued > 0 && (
                <span className="mt-2 block">
                  <ActButton action={writeNowAction}>Write the next script now</ActButton>
                </span>
              )}
            </Empty>
          )}
        </section>

        {/* upcoming slots */}
        <section>
          <h2 className="mb-2 font-semibold">Next publishing slots</h2>
          <div className="card p-0">
            <table className="table">
              <tbody>
                {slots.map((t, k) => (
                  <tr key={t}>
                    <td className="whitespace-nowrap">{when(t)}</td>
                    <td className="text-sm">{ready[k] ? <span className="text-ok">{ready[k]!.title}</span> : <span className="text-muted">needs an approved video</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* published */}
      <section className="mb-5">
        <h2 className="mb-2 font-semibold">On YouTube (private)</h2>
        {published.length ? (
          <div className="card p-0">
            <table className="table">
              <tbody>
                {published.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/edu/item/${r.id}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                      <div className="text-xs text-muted">
                        {r.format} · {when(r.publishedAt)}
                      </div>
                    </td>
                    <td className="text-right text-sm">
                      {r.youtube && (
                        <a className="text-accent underline" href={`https://studio.youtube.com/video/${r.youtube.videoId}/edit`} target="_blank" rel="noreferrer">
                          Open in YouTube Studio
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nothing published yet.</Empty>
        )}
      </section>

      {/* log */}
      <section>
        <h2 className="mb-2 font-semibold">Log</h2>
        <div className="card max-h-96 overflow-auto p-0">
          <table className="table">
            <tbody>
              {events.slice(0, 60).map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs text-muted">{when(e.at)}</td>
                  <td className={`text-sm ${e.kind === "error" ? "text-bad" : e.kind === "alert" ? "" : "text-muted"}`}>{e.text}</td>
                </tr>
              ))}
              {!events.length && (
                <tr>
                  <td className="text-sm text-muted">Nothing yet. Add topics, then press Start.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
