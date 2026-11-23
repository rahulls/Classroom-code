import Link from "next/link";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { addTopicAction, deleteTopicAction, editTopicAction, importTopicsAction, moveTopicAction, writeNowAction } from "@/modules/edu/actions";
import { youtubeConnection } from "@/modules/chaos/youtube";
import { estimates, type Estimate } from "@/modules/edu/scheduler";
import { STATUS_LABEL, getSettings, listRows } from "@/modules/edu/store";
import { ActButton, CsvPicker } from "../parts";
import { TONE } from "../tone";

export const metadata = { title: "Topics" };
export const dynamic = "force-dynamic";

const FORMATS = [
  { value: "short", label: "Short (under 1 min, vertical)" },
  { value: "long", label: "Long (3–6 min, horizontal)" },
];

const IST = 5.5 * 3600_000;
const istDay = (t: number) => Math.floor((t + IST) / 86400_000);
/** "today 6:10 pm", "tomorrow 10:00 am", "Wed 25 Nov, 10:00 am" (India time) */
function when(t: number, now: number) {
  const time = new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  const d = istDay(t) - istDay(now);
  if (d === 0) return `today ${time}`;
  if (d === 1) return `tomorrow ${time}`;
  if (d === -1) return `yesterday ${time}`;
  return new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function EstimateCell({ e, now, hold }: { e?: Estimate; now: number; hold: string | null }) {
  if (!e) return <span className="text-xs text-muted">—</span>;
  const line = (label: string, t: number | undefined, done?: boolean) =>
    t == null ? null : (
      <div>
        <span className="text-muted">{label}</span> {done ? "" : "~"}
        {when(t, now)}
      </div>
    );
  return (
    <div className="whitespace-nowrap text-xs">
      {line("Script", e.script)}
      {line(e.madeDone ? "Made" : "Video", e.made, e.madeDone)}
      {e.uploadDone ? line("Uploaded", e.upload, true) : hold ? <div className="text-amber-600">Upload on hold: {hold}</div> : line("Upload", e.upload)}
      {e.waitsForYou && !e.uploadDone && <div className="text-muted">if reviewed in time</div>}
    </div>
  );
}

export default async function TopicsPage() {
  const rows = listRows();
  const now = Date.now();
  const est = estimates(now);
  const s = getSettings();
  const hold = s.paused ? "the schedule is paused" : !youtubeConnection("edu").connected ? "channel not connected" : null;
  let n = 0;
  return (
    <>
      <PageHeader
        title="Topics"
        subtitle="Topics are picked from the top, one per slot. A row can be changed only until its script is written; after that, add a new row."
        actions={
          <>
            <a className="btn" href="/edu/sample.csv">
              Sample CSV
            </a>
            <a className="btn" href="/edu/topics.csv">
              Download list
            </a>
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 font-semibold">Add from a CSV</h2>
          <p className="mb-3 text-xs text-muted">
            Columns: <code>topic,format,audience,notes,must_include</code>. Only topic is needed; format is <b>short</b> unless you write <b>long</b>. Topics already in the list are skipped.
          </p>
          <ActionForm action={importTopicsAction} className="space-y-3">
            <CsvPicker />
            <SubmitButton>Add topics</SubmitButton>
            <FormMessage />
          </ActionForm>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold">Add one topic</h2>
          <ActionForm action={addTopicAction} className="grid gap-3 sm:grid-cols-2">
            <TextField name="topic" label="Topic" required className="sm:col-span-2" placeholder="e.g. How do vaccines work" maxLength={200} />
            <SelectField name="format" label="Format" options={FORMATS} defaultValue="short" required />
            <TextField name="audience" label="Audience" placeholder="kids, teens, general…" maxLength={60} />
            <TextField name="notes" label="Notes for the script" className="sm:col-span-2" maxLength={500} />
            <TextField name="mustInclude" label="Must include" className="sm:col-span-2" maxLength={300} placeholder="key words or facts, separated by ;" />
            <div className="sm:col-span-2 space-y-2">
              <SubmitButton>Add</SubmitButton>
              <FormMessage />
            </div>
          </ActionForm>
        </section>
      </div>

      <h2 className="mb-1 font-semibold">The list ({rows.length})</h2>
      <p className="mb-2 text-xs text-muted">
        Estimates (India time) follow the schedule: one upload every {s.intervalHours} h, {s.keepAhead} topics kept in the works, one video made at a time. They assume you review scripts and videos
        soon after they're ready; a late review pushes that video and the ones after it to later slots.
        {s.paused && " The schedule is paused, so nothing moves until you start it."}
      </p>
      {rows.length ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Topic</th>
                <th>Format</th>
                <th>Status</th>
                <th title={`About when the video is made and uploaded (India time), one upload every ${s.intervalHours} h`}>Estimate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const queued = r.status === "queued";
                if (queued) n++;
                return (
                  <tr key={r.id} className={r.status === "rejected" ? "opacity-60" : ""}>
                    <td className="text-xs text-muted">{queued ? n : ""}</td>
                    <td className="min-w-[16rem]">
                      {queued ? (
                        <details>
                          <summary className="cursor-pointer font-medium">{r.topic}</summary>
                          <ActionForm action={editTopicAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                            <input type="hidden" name="id" value={r.id} />
                            <TextField name="topic" label="Topic" required defaultValue={r.topic} className="sm:col-span-2" maxLength={200} />
                            <SelectField name="format" label="Format" options={FORMATS} defaultValue={r.format} required />
                            <TextField name="audience" label="Audience" defaultValue={r.audience} maxLength={60} />
                            <TextField name="notes" label="Notes for the script" defaultValue={r.notes} className="sm:col-span-2" maxLength={500} />
                            <TextField name="mustInclude" label="Must include" defaultValue={r.mustInclude} className="sm:col-span-2" maxLength={300} />
                            <div className="sm:col-span-2 space-y-2">
                              <SubmitButton>Save</SubmitButton>
                              <FormMessage />
                            </div>
                          </ActionForm>
                        </details>
                      ) : (
                        <Link href={`/edu/item/${r.id}`} className="font-medium hover:underline">
                          {r.title || r.topic}
                        </Link>
                      )}
                      <div className="text-xs text-muted">
                        {[r.audience, r.notes, r.mustInclude && `must include: ${r.mustInclude}`].filter(Boolean).join(" · ") || r.source}
                      </div>
                    </td>
                    <td className="text-sm">{r.format}</td>
                    <td>
                      <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td>
                      <EstimateCell e={est.get(r.id)} now={now} hold={hold} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {queued && (
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <ActButton action={moveTopicAction} fields={{ id: r.id, dir: "up" }}>
                            ↑
                          </ActButton>
                          <ActButton action={moveTopicAction} fields={{ id: r.id, dir: "down" }}>
                            ↓
                          </ActButton>
                          <ActButton action={writeNowAction} fields={{ id: r.id }}>
                            Write now
                          </ActButton>
                          <ActButton action={deleteTopicAction} fields={{ id: r.id }} variant="danger" confirm={`Remove “${r.topic}” from the list?`}>
                            Remove
                          </ActButton>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>
          No topics yet. Add a CSV or one topic above.
        </Empty>
      )}
    </>
  );
}
