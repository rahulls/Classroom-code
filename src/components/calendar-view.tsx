import { Breadcrumbs, PageHeader } from "@/components/ui";
import { AddSchedule } from "@/components/add-schedule";
import { CalendarNav, type CalView, viewRange } from "@/components/calendar-nav";
import { MarkLegend, MonthGrid } from "@/components/month-grid";
import { type EditorActions, TimetableEditor } from "@/components/timetable-editor";
import { requirePermission } from "@/core/auth/guard";
import { can } from "@/core/rbac";
import { isUuid } from "@/core/validation";
import {
  addClassAction,
  addDemoClassAction,
  cancelDemoClassAction,
  createSlotsAction,
  deleteSlotAction,
  loadClassAction,
  removeFollowingAction,
  removeOneAction,
  rescheduleOneAction,
  restoreOneAction,
  saveAttendanceAction,
  saveClassNotesAction,
  updateSlotAction,
} from "@/modules/academics/actions";
import { getClassMarks } from "@/modules/academics/class-record";
import { getDemos } from "@/modules/academics/demo";
import { getSetting, getYears, resolveYear } from "@/modules/academics/service";
import { isYmd, mondayOf, todayYmd } from "@/modules/academics/time";
import { getOccurrences, getSchedulingBatches, occurrenceClashes, toEditorSlots } from "@/modules/academics/timetable";

export const timetableActions: EditorActions = {
  add: addClassAction,
  reschedule: rescheduleOneAction,
  removeOne: removeOneAction,
  restore: restoreOneAction,
  updateSeries: updateSlotAction,
  removeFollowing: removeFollowingAction,
  deleteSeries: deleteSlotAction,
  loadClass: loadClassAction,
  saveNotes: saveClassNotesAction,
  saveAttendance: saveAttendanceAction,
};

/** The main calendar also books demo classes. */
const calendarActions: EditorActions = { ...timetableActions, addDemo: addDemoClassAction, cancelDemo: cancelDemoClassAction };

export type CalendarSearch = { year?: string; batch?: string; room?: string; view?: string; date?: string };

/** Dated calendar for all batches: week (editable) or month, with previous / next / jump-to-date. */
export async function CalendarView({ sp, base, crumbs, title }: { sp: CalendarSearch; base: string; crumbs: { label: string; href?: string }[]; title: string }) {
  const user = await requirePermission("academics.view");
  const canEdit = can(user, "academics.manage");
  const today = todayYmd();
  const view: CalView = sp.view === "month" ? "month" : "week";
  const date = isYmd(sp.date) && sp.date >= "2000-01-01" && sp.date <= "2100-12-31" ? sp.date : today;
  const { from, to } = viewRange(view, date);

  const [years, year] = await Promise.all([getYears(), resolveYear(sp.year && isUuid(sp.year) ? sp.year : undefined)]);
  const [{ slots, occurrences: all }, schedBatches, presets] = await Promise.all([
    year ? getOccurrences({ yearId: year.id }, from, to) : Promise.resolve({ slots: [], occurrences: [] }),
    year ? getSchedulingBatches(year.id) : Promise.resolve([]),
    getSetting<number[]>("schedule.durationPresets", [45, 60, 90, 120, 180]),
  ]);

  const rooms = [...new Set(all.map((s) => s.room).filter((r): r is string => !!r))].sort();
  const batchFilter = sp.batch && isUuid(sp.batch) ? sp.batch : undefined;
  const roomFilter = sp.room && rooms.includes(sp.room) ? sp.room : undefined;
  const shown = all.filter((s) => (!batchFilter || s.batchId === batchFilter) && (!roomFilter || s.room === roomFilter));
  const clashes = occurrenceClashes(all);
  const marks = await getClassMarks(shown, today);
  // Demo classes belong to no batch: shown when not filtering by batch
  const demos = batchFilter ? [] : (await getDemos(from, to)).filter((d) => !roomFilter || d.room === roomFilter);

  const shortLabel = new Map(schedBatches.map((b) => [b.id, b.shortLabel]));
  const labelOf = (id: string) => shortLabel.get(id) ?? "";
  const live = shown.filter((o) => o.kind !== "cancelled");
  const minutes = live.reduce((m, s) => m + s.durationMin, 0);
  const params = { year: sp.year && isUuid(sp.year) ? sp.year : undefined, batch: batchFilter, room: roomFilter };

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <PageHeader title={title} subtitle={`${live.length} classes · ${Math.round(minutes / 6) / 10} teaching hours in this ${view} · times are IST`} />

      <form className="card mb-4 flex flex-wrap items-end gap-2" action={base}>
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={date} />
        <label>
          <span className="label">Year</span>
          <select name="year" defaultValue={year?.id} className="input">
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Batch</span>
          <select name="batch" defaultValue={batchFilter ?? ""} className="input">
            <option value="">All batches</option>
            {schedBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Room</span>
          <select name="room" defaultValue={roomFilter ?? ""} className="input">
            <option value="">All rooms</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button className="btn">Show</button>
      </form>

      {clashes.lines.length > 0 && (
        <section className="mb-4 rounded-lg border border-bad/40 bg-bad/5 p-4 text-sm">
          <h2 className="mb-2 font-semibold text-bad">{clashes.lines.length} clash(es) in this {view}</h2>
          <ul className="list-disc space-y-1 pl-5">
            {clashes.lines.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <AddSchedule
          key={batchFilter ?? "all"}
          batches={schedBatches.filter((b) => !batchFilter || b.id === batchFilter)}
          action={createSlotsAction}
          presets={presets}
          defaultFrom={today}
          open={slots.length === 0}
        />
      )}

      <section className="card">
        <CalendarNav base={base} params={params} view={view} date={date} today={today} />
        {view === "week" ? (
          <TimetableEditor
            occurrences={shown.map((o) => ({ ...o, batchLabel: labelOf(o.batchId), warn: clashes.ids.has(o.key), marks: marks.get(o.key) }))}
            series={toEditorSlots(slots, labelOf)}
            batches={schedBatches.filter((b) => !batchFilter || b.id === batchFilter)}
            canEdit={canEdit}
            showBatch={!batchFilter}
            weekStart={mondayOf(date)}
            today={today}
            actions={calendarActions}
            demos={demos}
          />
        ) : (
          <MonthGrid
            from={from}
            to={to}
            month={date.slice(0, 7)}
            today={today}
            occurrences={shown.map((o) => ({ ...o, batchName: labelOf(o.batchId) || o.batchName, marks: marks.get(o.key) }))}
            showBatch={!batchFilter}
            demos={demos}
            dayHref={(d) => {
              const q = new URLSearchParams({ view: "week", date: d });
              for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
              return `${base}?${q.toString()}`;
            }}
          />
        )}
        <MarkLegend />
      </section>
    </>
  );
}
