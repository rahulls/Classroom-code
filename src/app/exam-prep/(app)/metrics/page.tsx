import { checklistAction, complaintAction, hoursAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { mondayOf } from "@/modules/exam-prep/domain/programme";
import { metrics, SUNDAY_CHECKLIST } from "@/modules/exam-prep/services/metrics";
import { getSettings } from "@/modules/exam-prep/settings";
import { ActionButton, EpForm, Msg, Submit } from "../../ui";

export const metadata = { title: "Metrics" };

const fmt = (v: number | null, unit = "%") => (v == null ? "-" : `${unit === "%" ? Math.round(v) : v.toFixed(1)}${unit}`);

/** R12: teacher-only metrics against editable targets, workload, Sunday checklist and the week-8 review. */
export default async function MetricsPage() {
  const [m, s, hours, checks] = await Promise.all([metrics(), getSettings(), epdb.workloadEntry.findMany({ orderBy: { weekStart: "desc" }, take: 16 }), epdb.reviewCheck.findMany()]);
  const thisWeek = mondayOf(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const done = new Set(checks.filter((c) => c.weekStart.toISOString().slice(0, 10) === thisWeek).map((c) => c.item));
  const plan = s["targets.hours"];
  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Metrics</h1>
        <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${m.health === "green" ? "bg-ok/15 text-ok" : m.health === "amber" ? "bg-warn/15 text-warn" : "bg-soft text-muted"}`}>
          Programme health: {m.health === "early" ? "too early (week 6 check)" : m.health}
        </span>
        <span className="text-xs text-muted">Still submitting: {fmt(m.stillSubmitting)}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="text-right">Now</th>
              <th>Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.label}
                  {"detail" in r && r.detail && <span className="block text-xs text-muted">{r.detail}</span>}
                </td>
                <td className="text-right tabular-nums">{fmt(r.value, "unit" in r ? (r.unit ?? "%") : "%")}</td>
                <td className="text-xs">{r.target}</td>
                <td>{r.ok == null ? <span className="text-muted">-</span> : r.ok ? <span className="text-ok">on track</span> : <span className="text-bad">below</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold text-[#0f3460]">
            Workload (plan {plan.min}-{plan.max} h/week)
          </h2>
          <EpForm action={hoursAction} className="flex flex-wrap gap-2">
            <input name="weekStart" type="date" defaultValue={thisWeek} className="input w-auto" />
            <input name="hours" type="number" step={0.5} min={0} placeholder="Hours" required className="input w-24" />
            <input name="note" placeholder="Note" className="input flex-1" />
            <Submit tone="plain">Log</Submit>
            <Msg />
          </EpForm>
          <ul>
            {hours.map((h) => (
              <li key={h.id} className={h.hours > plan.max ? "text-bad" : ""}>
                Week of {h.weekStart.toISOString().slice(0, 10)}: {h.hours} h {h.note && `· ${h.note}`}
              </li>
            ))}
          </ul>
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold text-[#0f3460]">Sunday 30-minute review (week of {thisWeek})</h2>
          <ul className="space-y-1">
            {SUNDAY_CHECKLIST.map((item) => (
              <li key={item} className="flex items-center gap-2">
                {done.has(item) ? (
                  <span className="text-ok">✓</span>
                ) : (
                  <ActionButton action={checklistAction} fields={{ weekStart: thisWeek, item }}>
                    Tick
                  </ActionButton>
                )}
                <span className={done.has(item) ? "text-muted line-through" : ""}>{item}</span>
              </li>
            ))}
          </ul>
          <h2 className="pt-2 font-semibold text-[#0f3460]">Log a complaint</h2>
          <EpForm action={complaintAction} className="flex gap-2">
            <input name="note" placeholder="What happened (no personal details needed)" required className="input flex-1" />
            <Submit tone="plain">Log</Submit>
            <Msg />
          </EpForm>
        </section>
      </div>
      <section className="card space-y-1 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Week-8 review summary</h2>
        <p className="text-muted">Programme week {m.week}. Use this at week 8 to decide what to keep, change or stop.</p>
        <ul className="list-inside list-disc">
          {m.rows.map((r) => (
            <li key={r.key}>
              {r.label}: {fmt(r.value, "unit" in r ? (r.unit ?? "%") : "%")} against {r.target} {r.ok === false ? "→ needs action" : r.ok ? "→ keep" : ""}
            </li>
          ))}
          <li>Hours: average {hours.length ? (hours.reduce((a, h) => a + h.hours, 0) / hours.length).toFixed(1) : "-"} h against {plan.min}-{plan.max} h</li>
        </ul>
      </section>
    </div>
  );
}
