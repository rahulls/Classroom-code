import Link from "next/link";
import { attachAction, calendarAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { getSettings } from "@/modules/exam-prep/settings";
import { ActionButton, EpForm, Submit } from "../../ui";

export const metadata = { title: "Calendar" };

const day = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function CalendarPage() {
  const s = await getSettings();
  const [slots, papers] = await Promise.all([epdb.slot.findMany({ orderBy: [{ week: "asc" }, { klass: "asc" }, { board: "asc" }] }), epdb.paper.findMany({ where: { isCurrent: true, kind: { in: ["paper", "mock"] } }, orderBy: { id: "asc" } })]);
  const weeks = [...new Set(slots.map((x) => x.week))];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0f3460]">Programme calendar</h1>
          <p className="text-sm text-muted">
            Start {s["programme.startDate"] ?? "not set"} · {s["programme.weeks"]} weeks · classes {s["programme.launch"].firstClasses.join(" and ")} first, {s["programme.launch"].laterClasses.join(" and ")} after {s["programme.launch"].delayWeeks} weeks ·
            deadline {s["programme.times"].deadline} · grace {s["programme.graceHours"]} h.{" "}
            <Link href="/exam-prep/settings" className="text-accent hover:underline">
              Change
            </Link>
          </p>
        </div>
        <div className="ml-auto">
          <ActionButton action={calendarAction} fields={{}} tone="primary">
            Build / refresh the calendar
          </ActionButton>
        </div>
      </div>
      {weeks.map((w) => (
        <section key={w} className="card">
          <h2 className="mb-2 font-semibold text-[#0f3460]">Week {w}</h2>
          <table className="table text-sm">
            <tbody>
              {slots
                .filter((x) => x.week === w)
                .map((x) => (
                  <tr key={x.id}>
                    <td className="w-48">
                      Class {x.klass} {x.board}
                    </td>
                    <td className="w-28">{x.subject}</td>
                    <td className="text-xs text-muted">
                      {day(x.opensAt)} → due {day(x.dueAt)}
                    </td>
                    <td>
                      {x.paperId ? (
                        <Link href={`/exam-prep/papers/${x.paperId}`} className="font-mono text-xs text-accent hover:underline">
                          {x.paperId}
                        </Link>
                      ) : (
                        <EpForm action={attachAction} className="flex items-center gap-1">
                          <input type="hidden" name="slotId" value={x.id} />
                          <select name="paperId" className="input w-auto py-1 text-xs">
                            {papers
                              .filter((p) => p.klass === x.klass && p.subject === x.subject)
                              .map((p) => (
                                <option key={p.id}>{p.id}</option>
                              ))}
                          </select>
                          <Submit tone="plain" className="px-2 py-1 text-xs">
                            Attach
                          </Submit>
                        </EpForm>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      {!weeks.length && <p className="card text-sm text-muted">No calendar yet. Set the start date in Settings, add students, then build the calendar.</p>}
    </div>
  );
}
