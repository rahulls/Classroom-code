import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Empty } from "@/components/ui";
import { CalendarNav } from "@/components/calendar-nav";
import { timetableActions } from "@/components/calendar-view";
import { TimetableEditor } from "@/components/timetable-editor";
import { toDateInput } from "@/core/validation";
import { createSlotsAction, deleteSlotAction, endSlotAction, updateSlotAction } from "@/modules/academics/actions";
import { WEEKDAYS, addDays, dayShort, fmtMin, fmtRange, isYmd, mondayOf, todayYmd } from "@/modules/academics/time";
import { getBatchSlots, getOccurrences, toEditorSlots } from "@/modules/academics/timetable";
import { getClassMarks } from "@/modules/academics/class-record";
import { MarkLegend } from "@/components/month-grid";
import { AddSlotForm } from "@/components/add-slot-form";

type SubjectInfo = { batchSubjectId: string; name: string; code: string; color: string | null; durationMin: number; source: string };

const MODES = [
  { value: "offline", label: "Offline" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
];

export async function TimetableSection({
  batchId,
  batchLabel,
  subjects,
  presets,
  defaultRoom,
  defaultMode,
  manage,
  date: rawDate,
}: {
  /** Any day of the week to show ("YYYY-MM-DD"); defaults to this week. */
  date?: string;
  batchId: string;
  batchLabel: string;
  subjects: SubjectInfo[];
  presets: number[];
  defaultRoom: string;
  defaultMode: string;
  manage: boolean;
}) {
  const todayStr = todayYmd();
  const date = isYmd(rawDate) && rawDate >= "2000-01-01" && rawDate <= "2100-12-31" ? rawDate : todayStr;
  const weekStart = mondayOf(date);
  const [slots, week] = await Promise.all([getBatchSlots(batchId), getOccurrences({ batchId }, weekStart, addDays(weekStart, 6))]);
  const marks = await getClassMarks(week.occurrences, todayStr);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const isActive = (s: (typeof slots)[number]) => s.effectiveFrom <= todayUtc && (!s.effectiveTo || s.effectiveTo >= todayUtc);
  const upcomingOrActive = slots.filter((s) => !s.effectiveTo || s.effectiveTo >= todayUtc);


  const perWeek = (bsId: string) => upcomingOrActive.filter((s) => s.batchSubjectId === bsId && isActive(s));

  return (
    <section className="card">
      <h2 className="mb-1 text-sm font-semibold">Timetable</h2>
      <p className="mb-3 text-xs text-muted">Each block is drawn at its real length. Times are local (IST).</p>
      <CalendarNav base={`/academics/${batchId}`} params={{ tab: "schedule" }} view="week" date={date} today={todayStr} />
      <TimetableEditor
        occurrences={week.occurrences.map((o) => ({ ...o, batchLabel, marks: marks.get(o.key) }))}
        series={toEditorSlots(week.slots, () => batchLabel)}
        batches={[{ id: batchId, label: batchLabel, room: defaultRoom, mode: defaultMode, subjects: subjects.map((s) => ({ batchSubjectId: s.batchSubjectId, label: `${s.name} (${s.code})`, durationMin: s.durationMin })) }]}
        canEdit={manage}
        showBatch={false}
        weekStart={weekStart}
        today={todayStr}
        actions={timetableActions}
      />
      <MarkLegend />

      {subjects.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Classes / week</th>
                <th>Timings</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((sub) => {
                const mine = slots.filter((s) => s.batchSubjectId === sub.batchSubjectId);
                return (
                  <tr key={sub.batchSubjectId}>
                    <td className="whitespace-nowrap">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: sub.color ?? "rgb(var(--line))" }} />
                      {sub.name}
                    </td>
                    <td>{perWeek(sub.batchSubjectId).length}</td>
                    <td className="space-y-1">
                      {mine.length === 0 && <span className="text-xs text-muted">none</span>}
                      {mine.map((s) => {
                        const ended = s.effectiveTo && s.effectiveTo < todayUtc;
                        return (
                          <details key={s.id} className={ended ? "opacity-60" : ""}>
                            <summary className="cursor-pointer text-sm" data-slot-id={s.id}>
                              <span className="font-medium">
                                {dayShort(s.weekday)} {fmtRange(s.startMin, s.durationMin)}
                              </span>{" "}
                              <span className="pill">{s.durationMin} min</span> <span className="text-xs text-muted">{[s.room, s.mode !== "offline" ? s.mode : null].filter(Boolean).join(" · ")}</span>
                              {s.effectiveTo && <span className="ml-1 text-xs text-muted">{ended ? "ended" : "until"} {toDateInput(s.effectiveTo)}</span>}
                              {s.effectiveFrom > todayUtc && <span className="ml-1 text-xs text-warn">starts {toDateInput(s.effectiveFrom)}</span>}
                            </summary>
                            {manage && (
                              <div className="mt-2 space-y-3 rounded-md border border-soft p-3">
                                <ActionForm action={updateSlotAction} className="grid gap-2 sm:grid-cols-3">
                                  <input type="hidden" name="id" value={s.id} />
                                  <div className="sm:col-span-3">
                                    <FormMessage />
                                  </div>
                                  <SelectField name="weekday" label="Day" required defaultValue={String(s.weekday)} options={WEEKDAYS.map((d) => ({ value: String(d.n), label: d.long }))} />
                                  <TextField name="startTime" label="Start" type="time" required defaultValue={fmtMin(s.startMin)} />
                                  <TextField name="endTime" label={`End (now ${s.durationMin} min)`} type="time" required defaultValue={fmtMin(s.startMin + s.durationMin)} />
                                  <TextField name="room" label="Room" defaultValue={s.room} maxLength={40} />
                                  <SelectField name="mode" label="Mode" required defaultValue={s.mode} options={MODES} />
                                  <TextField name="meetingUrl" label="Online link" type="url" defaultValue={s.meetingUrl} maxLength={500} />
                                  <TextField name="effectiveFrom" label="Starts from" type="date" required defaultValue={toDateInput(s.effectiveFrom)} />
                                  <TextField name="effectiveTo" label="Until" type="date" defaultValue={toDateInput(s.effectiveTo)} />
                                  <TextField name="notes" label="Note" defaultValue={s.notes} maxLength={200} />
                                  <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                                    <SubmitButton variant="default">Save</SubmitButton>
                                    <CheckboxField name="allowClash" label="Save anyway if room/students clash" />
                                    <CheckboxField name="notify" label="Tell students" defaultChecked />
                                  </div>
                                </ActionForm>
                                <div className="flex flex-wrap items-end gap-4 border-t border-soft pt-3">
                                  <ActionForm action={endSlotAction} className="flex items-end gap-2">
                                    <input type="hidden" name="id" value={s.id} />
                                    <TextField name="endOn" label="Stop after (keeps history)" type="date" required />
                                    <CheckboxField name="notify" label="Tell students" defaultChecked />
                                    <SubmitButton variant="default">End</SubmitButton>
                                    <FormMessage />
                                  </ActionForm>
                                  <ActionForm action={deleteSlotAction} confirm={`Delete ${sub.name} ${dayShort(s.weekday)} ${fmtRange(s.startMin, s.durationMin)}?`}>
                                    <input type="hidden" name="id" value={s.id} />
                                    <CheckboxField name="notify" label="Tell students" defaultChecked />
                                    <SubmitButton variant="danger">Delete</SubmitButton>
                                  </ActionForm>
                                </div>
                              </div>
                            )}
                          </details>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {manage &&
        (subjects.length ? (
          <div className="mt-4 border-t border-soft pt-4">
            <h3 className="mb-3 text-sm font-semibold">Add class timing</h3>
            <AddSlotForm
              action={createSlotsAction}
              subjects={subjects.map((s) => ({ batchSubjectId: s.batchSubjectId, label: `${s.name} (${s.code})`, durationMin: s.durationMin, source: s.source }))}
              presets={presets}
              defaultRoom={defaultRoom}
              defaultMode={defaultMode}
              defaultFrom={toDateInput(new Date())}
            />
          </div>
        ) : (
          <div className="mt-4">
            <Empty>Add subjects to this batch first, then schedule their timings.</Empty>
          </div>
        ))}
    </section>
  );
}
