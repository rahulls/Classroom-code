"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/core/action";
import type { DemoView } from "@/modules/academics/demo";
import type { Occurrence } from "@/modules/academics/timetable";
import { WEEKDAYS, addDays, fmtDate, fmtMin, fmtRange, parseHHMM, weekdayOf } from "@/modules/academics/time";
import { AttendancePanel, NotesPanel, useClassData } from "./class-work";
import { ActionForm, CheckboxField, FormMessage, Req, SelectField, SubmitButton, TextField, useActionResult } from "./form";
import type { ClassMarks } from "./class-marks";
import { type GridBlock, WeekGrid } from "./week-grid";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A weekly series (the pattern behind "weekly" / "moved" classes). */
export type EditorSlot = {
  id: string;
  batchId: string;
  batchLabel: string;
  batchSubjectId: string;
  subjectName: string;
  subjectCode: string;
  color: string | null;
  weekday: number;
  startMin: number;
  durationMin: number;
  room: string | null;
  mode: string;
  meetingUrl: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  warn?: boolean;
};

/** One class on one date, as drawn on the calendar. */
export type EditorOccurrence = Occurrence & { batchLabel: string; warn?: boolean; marks?: ClassMarks };

export type EditorBatch = {
  id: string;
  label: string;
  room: string;
  mode: string;
  subjects: { batchSubjectId: string; label: string; durationMin: number }[];
};

export type EditorActions = {
  add: Action;
  reschedule: Action;
  removeOne: Action;
  restore: Action;
  updateSeries: Action;
  removeFollowing: Action;
  deleteSeries: Action;
  loadClass: Action;
  saveNotes: Action;
  saveAttendance: Action;
  /** Demo classes: only on the main calendar */
  addDemo?: Action;
  cancelDemo?: Action;
};

// The dialog keeps its own copy of the class it opened with: after a change the class may move
// or vanish from the refreshed week, and the form must stay mounted to report the result.
type Dialog = { kind: "add"; date: string; startMin: number } | { kind: "edit"; occ: EditorOccurrence; series?: EditorSlot } | { kind: "demo"; demo: DemoView } | null;

const DEMO_COLOR = "#d97706";

const MODES = [
  { value: "offline", label: "Offline" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
];
const KIND_LABEL: Record<Occurrence["kind"], string> = { weekly: "Weekly class", extra: "One-time class", moved: "Rescheduled (this date only)", cancelled: "Cancelled (this date only)" };
const addMin = (hhmm: string, m: number) => {
  const s = parseHHMM(hhmm);
  return s === null ? "" : fmtMin(Math.min(s + m, 23 * 60 + 59));
};
const longDate = (d: string) => fmtDate(d, { weekday: "long", day: "numeric", month: "short", year: "numeric" });

function Err({ name }: { name: string }) {
  const st = useActionResult();
  const e = st && !st.ok ? st.fieldErrors?.[name] : undefined;
  return e ? <span className="block text-xs text-bad">{e}</span> : null;
}

const Notify = () => <CheckboxField name="notify" label="Tell students (WhatsApp, or email if no WhatsApp)" defaultChecked hint="Students only, on their own phone. Untick for silent corrections." />;
const AllowClash = () => <CheckboxField name="allowClash" label="Save anyway if the room or some students clash" />;

/** One week of real dates: click empty time to add a class, or a class to reschedule / remove it. */
export function TimetableEditor({
  occurrences,
  series,
  batches,
  canEdit,
  showBatch,
  weekStart,
  today,
  actions,
  demos = [],
}: {
  occurrences: EditorOccurrence[];
  series: EditorSlot[];
  batches: EditorBatch[];
  canEdit: boolean;
  /** Overview: label blocks with batch + subject. Batch page: subject only. */
  showBatch: boolean;
  /** Monday of the week shown, "YYYY-MM-DD". */
  weekStart: string;
  today: string;
  actions: EditorActions;
  /** Demo classes this week (main calendar only) */
  demos?: DemoView[];
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const dates = WEEKDAYS.map((d) => addDays(weekStart, d.n - 1));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (dialog && !d.open) d.showModal();
    if (!dialog && d.open) d.close();
  }, [dialog]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const done = (s: NonNullable<ActionState>) => {
    setDialog(null);
    setNotice(s.ok ? (s.message ?? "Saved.") : null);
  };
  const schedulable = batches.filter((b) => b.subjects.length);
  const canDemo = !!actions.addDemo;
  const canAdd = schedulable.length > 0 || canDemo;
  const open = (key: string) => {
    if (key.startsWith("demo:")) {
      const demo = demos.find((d) => `demo:${d.id}` === key);
      if (demo) setDialog({ kind: "demo", demo });
      return;
    }
    const occ = occurrences.find((o) => o.key === key);
    if (occ) setDialog({ kind: "edit", occ, series: series.find((s) => s.id === occ.slotId) });
  };
  const defaultAddDate = dates.includes(today) ? today : weekStart;
  // Hours shown: 2 h before the earliest class to 2 h after the latest start (whole hours), using this
  // week's classes and the weekly pattern so the range stays steady from week to week.
  const times = [...occurrences, ...series, ...demos].map((c) => ({ start: c.startMin, end: c.startMin + c.durationMin }));
  const shownFrom = times.length ? Math.max(0, Math.floor((Math.min(...times.map((t) => t.start)) - 120) / 60) * 60) : 7 * 60;
  const shownTo = times.length ? Math.min(24 * 60, Math.ceil(Math.max(...times.map((t) => Math.max(t.start + 120, t.end))) / 60) * 60) : 21 * 60;

  return (
    <div>
      {canEdit && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Click an empty time to add a class · click a class to reschedule it, add notes &amp; homework, or take attendance.</span>
          <button type="button" className="btn ml-auto px-2 py-1 text-xs" onClick={() => setDialog({ kind: "add", date: defaultAddDate, startMin: 16 * 60 })} disabled={!canAdd}>
            + Add class
          </button>
        </div>
      )}
      {canEdit && batches.some((b) => !b.subjects.length) && (
        <p className="mb-2 text-xs text-muted">
          Not in Add class because they have no subject yet:{" "}
          {batches
            .filter((b) => !b.subjects.length)
            .map((b, i) => (
              <span key={b.id}>
                {i > 0 && ", "}
                <a href={`/academics/${b.id}`} className="underline">
                  {b.label}
                </a>
              </span>
            ))}
          . Open the batch and add a subject.
        </p>
      )}
      {notice && (
        <p className="mb-2 rounded-md bg-ok/10 px-3 py-2 text-sm text-ok" role="status">
          {notice}
        </p>
      )}
      <WeekGrid
        dates={dates}
        today={today}
        blocks={occurrences.map((o): GridBlock => ({
          id: o.key,
          weekday: weekdayOf(o.date),
          startMin: o.startMin,
          durationMin: o.durationMin,
          title: showBatch ? `${o.batchLabel} · ${o.subjectCode}` : o.subjectName,
          lines: [[o.room, o.mode !== "offline" ? o.mode : null].filter(Boolean).join(" · ")].filter(Boolean),
          color: o.color,
          href: `/academics/${o.batchId}`,
          warn: o.warn,
          badge: o.makeup ? "make-up" : o.kind === "extra" ? "once" : o.kind === "moved" ? "moved" : o.kind === "cancelled" ? "off" : undefined,
          cancelled: o.kind === "cancelled",
          marks: o.marks,
        })).concat(
          demos.map((d): GridBlock => ({
            id: `demo:${d.id}`,
            weekday: weekdayOf(d.date),
            startMin: d.startMin,
            durationMin: d.durationMin,
            title: `Demo · ${d.subject}`,
            lines: [d.personName, [d.room, d.mode !== "offline" ? d.mode : null].filter(Boolean).join(" · ")].filter(Boolean),
            color: DEMO_COLOR,
            href: undefined,
            warn: false,
            badge: d.cancelled ? "off" : "demo",
            cancelled: d.cancelled,
            marks: undefined,
          })),
        )}
        minFrom={canEdit || times.length ? shownFrom : undefined}
        minTo={canEdit || times.length ? shownTo : undefined}
        onEmptyClick={canEdit && canAdd ? (weekday, startMin) => setDialog({ kind: "add", date: dates[weekday - 1]!, startMin }) : undefined}
        onBlockClick={canEdit ? open : undefined}
        emptyText={canEdit ? (canAdd ? "No classes this week. Click any time to add one." : "Add subjects to a batch first.") : "No classes this week."}
      />

      <dialog
        ref={ref}
        onClose={() => setDialog(null)}
        className="max-h-[calc(100vh-2rem)] w-[min(38rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-panel p-0 text-ink shadow-xl backdrop:bg-black/40"
      >
        {dialog?.kind === "add" && (
          <AddClass
            key={`${dialog.date}-${dialog.startMin}`}
            at={dialog}
            batches={schedulable}
            action={actions.add}
            demoAction={actions.addDemo}
            onDone={done}
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "demo" && actions.cancelDemo && (
          <DemoDetails key={dialog.demo.id} demo={dialog.demo} action={actions.cancelDemo} today={today} onDone={done} onCancel={() => setDialog(null)} />
        )}
        {dialog?.kind === "edit" && (
          <EditClass key={dialog.occ.key} occ={dialog.occ} series={dialog.series} actions={actions} today={today} onDone={done} onCancel={() => setDialog(null)} />
        )}
      </dialog>
    </div>
  );
}

function DialogHeader({ title, sub, onCancel }: { title: string; sub?: string; onCancel: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-line px-4 py-3">
      <div className="flex-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      <button type="button" onClick={onCancel} className="text-muted hover:text-ink" aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/** Two big radio choices, used for "just this one or recurring?" questions. */
function Choice<T extends string>({ name, value, onChange, options }: { name: string; value: T; onChange: (v: T) => void; options: { value: T; title: string; detail: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={`cursor-pointer rounded-md border p-2.5 text-sm ${value === o.value ? "border-accent bg-accent/10" : "border-line hover:border-accent/50"}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mr-2 accent-[rgb(var(--accent))]" />
          <b>{o.title}</b>
          <span className="block pl-5 text-xs text-muted">{o.detail}</span>
        </label>
      ))}
    </div>
  );
}

/** Start → end inputs with a live length; end follows start so the length is kept. */
function TimeRange({ startMin, durationMin }: { startMin: number; durationMin: number }) {
  const [start, setStart] = useState(fmtMin(startMin));
  const [end, setEnd] = useState(fmtMin(startMin + durationMin));
  useEffect(() => setEnd(addMin(start, durationMin)), [durationMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  const len = s !== null && e !== null && e > s ? e - s : null;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Start<Req /></span>
          <input
            type="time"
            name="startTime"
            required
            className="input w-32"
            value={start}
            onChange={(ev) => {
              setStart(ev.target.value);
              setEnd(addMin(ev.target.value, len ?? durationMin));
            }}
          />
        </label>
        <span className="pb-2 text-muted">→</span>
        <label>
          <span className="label">End<Req /></span>
          <input type="time" name="endTime" required className="input w-32" value={end} onChange={(ev) => setEnd(ev.target.value)} />
        </label>
        <span className={`pill mb-2 ${len ? "" : "border-bad text-bad"}`}>{len ? `${len} min` : "check times"}</span>
      </div>
      <Err name="startTime" />
      <Err name="endTime" />
    </div>
  );
}

type AddProps = {
  at: { date: string; startMin: number };
  batches: EditorBatch[];
  action: Action;
  demoAction?: Action;
  onDone: (s: NonNullable<ActionState>) => void;
  onCancel: () => void;
};

/** Add class: a batch class, or (on the main calendar) a demo class for someone who isn't a student yet. */
function AddClass(props: AddProps) {
  const [kind, setKind] = useState<"batch" | "demo">(props.batches.length ? "batch" : "demo");
  if (!props.demoAction) return <AddBatchClass {...props} />;
  const choose = (
    <div className="px-4 pt-3">
      <Choice
        name="classKind"
        value={kind}
        onChange={setKind}
        options={[
          { value: "batch", title: "Batch class", detail: props.batches.length ? "A subject of one of your batches" : "No batch has a subject yet" },
          { value: "demo", title: "Demo class", detail: "Trial class for one person: any subject, their WhatsApp" },
        ]}
      />
    </div>
  );
  return kind === "demo" || !props.batches.length ? (
    <AddDemo {...props} action={props.demoAction} chooser={choose} />
  ) : (
    <AddBatchClass {...props} chooser={choose} />
  );
}

function AddDemo({ at, action, onDone, onCancel, chooser }: AddProps & { chooser: ReactNode }) {
  const [date, setDate] = useState(at.date);
  return (
    <>
      <DialogHeader title="Add demo class" sub={longDate(date)} onCancel={onCancel} />
      {chooser}
      <ActionForm action={action} onSuccess={onDone} className="space-y-3 p-4">
        <FormMessage />
        <TextField name="subject" label="Subject / class" required maxLength={80} placeholder="e.g. Class 10 Maths, Python basics" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="personName" label="Name" required maxLength={80} hint="Who gets the WhatsApp messages: the student or a parent." />
          <TextField name="phone" label="WhatsApp number" type="tel" required maxLength={20} placeholder="98765 43210" hint="Indian numbers without +91 are fine." />
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <label>
            <span className="label">Date<Req /></span>
            <input type="date" name="date" required className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Err name="date" />
          </label>
          <TimeRange startMin={at.startMin} durationMin={60} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="room" label="Room" maxLength={40} />
          <SelectField name="mode" label="Mode" required defaultValue="offline" options={MODES} />
          <TextField name="meetingUrl" label="Online link" type="url" maxLength={500} placeholder="https://…" />
          <TextField name="notes" label="Note" maxLength={200} hint="Added to the WhatsApp message." />
        </div>
        <CheckboxField name="notify" label="Send them the class details on WhatsApp now" defaultChecked />
        <CheckboxField name="remind" label="Send a WhatsApp reminder before the class" defaultChecked hint="Same timing as student reminders (Settings → Institute & defaults), even if those are off." />
        <div className="flex gap-2 pt-1">
          <SubmitButton>Add demo class</SubmitButton>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </ActionForm>
    </>
  );
}

function DemoDetails({ demo, action, today, onDone, onCancel }: { demo: DemoView; action: Action; today: string; onDone: (s: NonNullable<ActionState>) => void; onCancel: () => void }) {
  const where = [demo.room ? `Room ${demo.room}` : null, demo.mode !== "offline" ? demo.mode : null, demo.meetingUrl].filter(Boolean).join(" · ");
  return (
    <>
      <DialogHeader title={`Demo class · ${demo.subject}`} sub={`${longDate(demo.date)} · ${fmtRange(demo.startMin, demo.durationMin)}`} onCancel={onCancel} />
      <div className="space-y-3 p-4 text-sm">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
          <dt className="text-muted">For</dt>
          <dd>
            {demo.personName} {demo.phoneHint && <span className="text-muted">({demo.phoneHint})</span>}
          </dd>
          {where && (
            <>
              <dt className="text-muted">Where</dt>
              <dd className="break-all">{where}</dd>
            </>
          )}
          {demo.notes && (
            <>
              <dt className="text-muted">Note</dt>
              <dd>{demo.notes}</dd>
            </>
          )}
          <dt className="text-muted">Reminder</dt>
          <dd>{demo.remind ? "Yes, on WhatsApp before the class" : "No"}</dd>
          <dt className="text-muted">Status</dt>
          <dd>{demo.cancelled ? <span className="text-bad">Cancelled</span> : "Scheduled"}</dd>
        </dl>
        {!demo.cancelled && (
          <ActionForm action={action} onSuccess={onDone} className="space-y-3 border-t border-line pt-3" confirm="Cancel this demo class?">
            <FormMessage />
            <input type="hidden" name="id" value={demo.id} />
            {demo.date >= today && <CheckboxField name="notify" label={`Tell ${demo.personName} on WhatsApp`} defaultChecked />}
            <p className="text-xs text-muted">To change the time, cancel this one (untick the message if you like) and add a new demo class.</p>
            <SubmitButton>Cancel demo class</SubmitButton>
          </ActionForm>
        )}
      </div>
    </>
  );
}

function AddBatchClass({ at, batches, action, onDone, onCancel, chooser }: AddProps & { chooser?: ReactNode }) {
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const batch = batches.find((b) => b.id === batchId) ?? batches[0];
  const [subjectId, setSubjectId] = useState(batch?.subjects[0]?.batchSubjectId ?? "");
  const subject = batch?.subjects.find((s) => s.batchSubjectId === subjectId) ?? batch?.subjects[0];
  const [date, setDate] = useState(at.date);
  const [repeat, setRepeat] = useState<"once" | "weekly">("weekly");
  const dayName = WEEKDAYS[weekdayOf(date) - 1]?.long ?? "";

  return (
    <>
      <DialogHeader title="Add class" sub={longDate(date)} onCancel={onCancel} />
      {chooser}
      <ActionForm action={action} onSuccess={onDone} className="space-y-3 p-4">
        <FormMessage />
        {batches.length > 1 ? (
          <label className="block">
            <span className="label">Batch<Req /></span>
            <select
              className="input"
              value={batch?.id}
              onChange={(e) => {
                const b = batches.find((x) => x.id === e.target.value);
                setBatchId(e.target.value);
                setSubjectId(b?.subjects[0]?.batchSubjectId ?? "");
              }}
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm">
            Batch: <b>{batch?.label}</b>
          </p>
        )}
        <label className="block">
          <span className="label">Subject<Req /></span>
          <select name="batchSubjectId" className="input" required value={subject?.batchSubjectId ?? ""} onChange={(e) => setSubjectId(e.target.value)}>
            {batch?.subjects.map((s) => (
              <option key={s.batchSubjectId} value={s.batchSubjectId}>
                {s.label} · usually {s.durationMin} min
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="label">How often?<Req /></span>
          <Choice
            name="repeat"
            value={repeat}
            onChange={setRepeat}
            options={[
              { value: "once", title: "Just this once", detail: `Only on ${fmtDate(date)} (extra class)` },
              { value: "weekly", title: "Every week", detail: `Every ${dayName}, starting ${fmtDate(date)}` },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-start gap-3">
          <label>
            <span className="label">{repeat === "once" ? "Date" : "Starts on"}<Req /></span>
            <input type="date" name="date" required className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Err name="date" />
          </label>
          <TimeRange startMin={at.startMin} durationMin={subject?.durationMin ?? 60} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField key={`room-${batch?.id}`} name="room" label="Room" defaultValue={batch?.room} maxLength={40} />
          <SelectField key={`mode-${batch?.id}`} name="mode" label="Mode" required defaultValue={batch?.mode || "offline"} options={MODES} />
          <TextField name="meetingUrl" label="Online link" type="url" maxLength={500} placeholder="https://…" />
          {repeat === "weekly" && <TextField name="effectiveTo" label="Until" type="date" />}
          <TextField name="notes" label="Note" maxLength={200} />
        </div>
        <AllowClash />
        <Notify />
        <div className="flex gap-2 pt-1">
          <SubmitButton>{repeat === "once" ? "Add one-time class" : "Add weekly class"}</SubmitButton>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </ActionForm>
    </>
  );
}

/** Hidden fields that identify one dated class to the server. */
function OneRef({ occ }: { occ: EditorOccurrence }) {
  return occ.changeId ? (
    <input type="hidden" name="changeId" value={occ.changeId} />
  ) : (
    <>
      <input type="hidden" name="slotId" value={occ.slotId ?? ""} />
      <input type="hidden" name="slotDate" value={occ.slotDate ?? ""} />
    </>
  );
}

function EditClass({
  occ,
  series,
  actions,
  today,
  onDone,
  onCancel,
}: {
  occ: EditorOccurrence;
  series?: EditorSlot;
  actions: EditorActions;
  today: string;
  onDone: (s: NonNullable<ActionState>) => void;
  onCancel: () => void;
}) {
  if (occ.kind === "cancelled") return <ScheduleTab occ={occ} series={series} actions={actions} onDone={onDone} onCancel={onCancel} />;
  return <ClassTabs occ={occ} series={series} actions={actions} today={today} onDone={onDone} onCancel={onCancel} />;
}

type Tab = "schedule" | "notes" | "attendance";
const TABS: { value: Tab; label: string }[] = [
  { value: "schedule", label: "Reschedule / cancel" },
  { value: "notes", label: "Notes & homework" },
  { value: "attendance", label: "Attendance" },
];

/** A class that is on: three tabs. Past and today's classes open on Notes & homework, future ones on the schedule. */
function ClassTabs({
  occ,
  series,
  actions,
  today,
  onDone,
  onCancel,
}: {
  occ: EditorOccurrence;
  series?: EditorSlot;
  actions: EditorActions;
  today: string;
  onDone: (s: NonNullable<ActionState>) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<Tab>(occ.date <= today ? "notes" : "schedule");
  const { data, error } = useClassData(occ, actions.loadClass);
  const tabs = (
    <div className="flex gap-1 border-b border-line px-4 pt-2" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={tab === t.value}
          onClick={() => setTab(t.value)}
          className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${tab === t.value ? "border-line border-b-panel bg-panel font-medium" : "border-transparent text-muted hover:text-ink"}`}
        >
          {t.label}
          {t.value === "notes" && data?.sentAt && <span className="ml-1 text-ok">✓</span>}
          {t.value === "attendance" && data?.attendanceTakenAt && <span className="ml-1 text-ok">✓</span>}
        </button>
      ))}
    </div>
  );
  if (tab === "schedule") return <ScheduleTab occ={occ} series={series} actions={actions} onDone={onDone} onCancel={onCancel} tabs={tabs} />;
  return (
    <>
      <DialogHeader title={`${occ.batchLabel} · ${occ.subjectName}`} sub={`${longDate(occ.date)} · ${fmtRange(occ.startMin, occ.durationMin)}`} onCancel={onCancel} />
      {tabs}
      {tab === "notes" ? (
        <NotesPanel occ={occ} data={data} error={error} action={actions.saveNotes} onDone={onDone} onCancel={onCancel} />
      ) : (
        <AttendancePanel occ={occ} data={data} error={error} action={actions.saveAttendance} onDone={onDone} onCancel={onCancel} />
      )}
    </>
  );
}

function ScheduleTab({
  occ,
  series,
  actions,
  onDone,
  onCancel,
  tabs,
}: {
  occ: EditorOccurrence;
  series?: EditorSlot;
  actions: EditorActions;
  onDone: (s: NonNullable<ActionState>) => void;
  onCancel: () => void;
  tabs?: ReactNode;
}) {
  const recurring = !!series;
  const [scope, setScope] = useState<"one" | "series">("one");
  const dayName = series ? (WEEKDAYS[series.weekday - 1]?.long ?? "") : "";
  const title = `${occ.batchLabel} · ${occ.subjectName}`;
  const sub = `${longDate(occ.date)} · ${fmtRange(occ.startMin, occ.durationMin)} · ${KIND_LABEL[occ.kind]}${
    occ.kind === "moved" && occ.slotDate && series ? ` (usually ${fmtDate(occ.slotDate)} ${fmtRange(series.startMin, series.durationMin)})` : ""
  }`;
  const batchLink = (
    <Link href={`/academics/${occ.batchId}`} className="ml-auto text-sm text-accent hover:underline">
      Open batch →
    </Link>
  );

  if (occ.kind === "cancelled") {
    return (
      <>
        <DialogHeader title={title} sub={sub} onCancel={onCancel} />
        <div className="space-y-3 p-4">
          <p className="text-sm">This class is cancelled on {longDate(occ.date)}. The rest of the weekly series is unchanged.</p>
          <ActionForm action={actions.restore} onSuccess={onDone} className="space-y-3">
            <input type="hidden" name="changeId" value={occ.changeId ?? ""} />
            <FormMessage />
            <Notify />
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton>Restore this class</SubmitButton>
              <button type="button" className="btn" onClick={onCancel}>
                Close
              </button>
              {batchLink}
            </div>
          </ActionForm>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader title={title} sub={sub} onCancel={onCancel} />
      {tabs}
      <div className="space-y-4 p-4">
        {recurring && (
          <div>
            <span className="label">This is a weekly class. What do you want to change?</span>
            <Choice
              name="scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: "one", title: "Only this class", detail: `Just ${fmtDate(occ.date)}; other weeks stay the same` },
                { value: "series", title: "The whole series", detail: `Every ${dayName} class of this weekly timing` },
              ]}
            />
          </div>
        )}

        {scope === "one" || !series ? (
          <>
            <ActionForm action={actions.reschedule} onSuccess={onDone} className="space-y-3">
              <OneRef occ={occ} />
              <FormMessage />
              <h3 className="text-sm font-semibold">Reschedule {recurring ? "this class only" : "this class"}</h3>
              <div className="flex flex-wrap items-start gap-3">
                <TextField name="date" label="Date" type="date" required defaultValue={occ.date} />
                <TimeRange startMin={occ.startMin} durationMin={occ.durationMin} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="room" label="Room" defaultValue={occ.room} maxLength={40} />
                <SelectField name="mode" label="Mode" required defaultValue={occ.mode} options={MODES} />
                <TextField name="meetingUrl" label="Online link" type="url" defaultValue={occ.meetingUrl} maxLength={500} />
                <TextField name="notes" label="Note (sent with the message)" defaultValue={occ.kind === "weekly" ? "" : occ.notes} maxLength={200} />
              </div>
              <AllowClash />
              <Notify />
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton>{occ.kind === "extra" ? "Save" : "Reschedule"}</SubmitButton>
                <button type="button" className="btn" onClick={onCancel}>
                  Close
                </button>
                {batchLink}
              </div>
            </ActionForm>

            <div className="flex flex-wrap items-end gap-3 border-t border-soft pt-3">
              {recurring ? (
                <CancelClass occ={occ} action={actions.removeOne} onDone={onDone} />
              ) : (
                <ActionForm action={actions.removeOne} onSuccess={onDone} className="space-y-2" confirm={`Remove the one-time ${occ.subjectName} class on ${fmtDate(occ.date)}?`}>
                  <OneRef occ={occ} />
                  <FormMessage />
                  <Notify />
                  <SubmitButton variant="danger">Remove this class</SubmitButton>
                </ActionForm>
              )}
              {occ.kind === "moved" && occ.changeId && (
                <ActionForm action={actions.restore} onSuccess={onDone} className="space-y-2">
                  <input type="hidden" name="changeId" value={occ.changeId} />
                  <FormMessage />
                  <Notify />
                  <SubmitButton variant="default">Back to usual time</SubmitButton>
                </ActionForm>
              )}
            </div>
          </>
        ) : (
          <SeriesForms series={series} occ={occ} actions={actions} onDone={onDone} onCancel={onCancel} batchLink={batchLink} />
        )}
      </div>
    </>
  );
}

const REASONS = [
  { value: "teacher", label: "I can't take it (teacher unavailable)" },
  { value: "holiday", label: "Holiday / institute closed" },
  { value: "other", label: "Other" },
] as const;

/**
 * Cancel one date of a weekly class. A class the teacher cancels is owed as a make-up: schedule it now
 * (students get one message with both) or later (it waits on the Today page).
 */
function CancelClass({ occ, action, onDone }: { occ: EditorOccurrence; action: Action; onDone: (s: NonNullable<ActionState>) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("teacher");
  const [required, setRequired] = useState(true);
  const [when, setWhen] = useState<"now" | "later">("now");
  const now = required && when === "now";
  if (!open) {
    return (
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        Cancel this class only…
      </button>
    );
  }
  return (
    <ActionForm
      action={action}
      onSuccess={onDone}
      className="w-full space-y-3 rounded-md border border-bad/40 p-3"
      confirm={`Cancel only the ${occ.subjectName} class on ${fmtDate(occ.date)}? Other weeks stay.`}
    >
      <OneRef occ={occ} />
      <FormMessage />
      <h3 className="text-sm font-semibold">Cancel the {fmtDate(occ.date)} class</h3>
      <label className="block">
        <span className="label">Why?<Req /></span>
        <select
          name="reason"
          className="input"
          value={reason}
          onChange={(e) => {
            const r = e.target.value as typeof reason;
            setReason(r);
            setRequired(r !== "holiday");
          }}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="makeupRequired" checked={required} onChange={(e) => setRequired(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" />
        <span>
          A make-up class is needed
          <span className="block text-xs text-muted">Shown as “make-up owed” on Today and in the class report until it’s held.</span>
        </span>
      </label>
      {required && (
        <Choice
          name="makeup"
          value={when}
          onChange={setWhen}
          options={[
            { value: "now", title: "Schedule make-up now", detail: "Pick the date; one message tells students both" },
            { value: "later", title: "Later", detail: "Waits on the Today page until you schedule it" },
          ]}
        />
      )}
      {!required && <input type="hidden" name="makeup" value="later" />}
      {now && (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <label>
              <span className="label">Make-up date<Req /></span>
              <input type="date" name="makeupDate" required className="input" min={occ.date} defaultValue={addDays(occ.date, 1)} />
              <Err name="makeupDate" />
            </label>
            <TimeRange startMin={occ.startMin} durationMin={occ.durationMin} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="room" label="Room" defaultValue={occ.room} maxLength={40} />
            <SelectField name="mode" label="Mode" required defaultValue={occ.mode} options={MODES} />
            <TextField name="meetingUrl" label="Online link" type="url" defaultValue={occ.meetingUrl} maxLength={500} />
          </div>
          <AllowClash />
        </>
      )}
      <Notify />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="danger">{now ? "Cancel and schedule make-up" : "Cancel this class"}</SubmitButton>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
    </ActionForm>
  );
}

function SeriesForms({
  series,
  occ,
  actions,
  onDone,
  onCancel,
  batchLink,
}: {
  series: EditorSlot;
  occ: EditorOccurrence;
  actions: EditorActions;
  onDone: (s: NonNullable<ActionState>) => void;
  onCancel: () => void;
  batchLink: ReactNode;
}) {
  const dayName = WEEKDAYS[series.weekday - 1]?.long ?? "";
  const from = occ.slotDate ?? occ.date;
  return (
    <>
      <ActionForm action={actions.updateSeries} onSuccess={onDone} className="space-y-3">
        <input type="hidden" name="id" value={series.id} />
        <FormMessage />
        <h3 className="text-sm font-semibold">Reschedule the whole series (every {dayName})</h3>
        <div className="flex flex-wrap items-start gap-3">
          <SelectField name="weekday" label="Day" required defaultValue={String(series.weekday)} options={WEEKDAYS.map((d) => ({ value: String(d.n), label: d.long }))} />
          <TimeRange startMin={series.startMin} durationMin={series.durationMin} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="room" label="Room" defaultValue={series.room} maxLength={40} />
          <SelectField name="mode" label="Mode" required defaultValue={series.mode} options={MODES} />
          <TextField name="meetingUrl" label="Online link" type="url" defaultValue={series.meetingUrl} maxLength={500} />
          <TextField name="effectiveFrom" label="Series starts" type="date" required defaultValue={series.effectiveFrom} />
          <TextField name="effectiveTo" label="Series ends" type="date" defaultValue={series.effectiveTo} />
          <TextField name="notes" label="Note" defaultValue={series.notes} maxLength={200} />
        </div>
        <AllowClash />
        <Notify />
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton>Save series</SubmitButton>
          <button type="button" className="btn" onClick={onCancel}>
            Close
          </button>
          {batchLink}
        </div>
      </ActionForm>

      <div className="space-y-3 border-t border-soft pt-3">
        <h3 className="text-sm font-semibold">Remove the series</h3>
        <div className="flex flex-wrap items-end gap-3">
          <ActionForm action={actions.removeFollowing} onSuccess={onDone} className="space-y-2" confirm={`Remove every ${dayName} ${occ.subjectName} class from ${fmtDate(from)} onwards? Earlier classes stay on record.`}>
            <input type="hidden" name="id" value={series.id} />
            <input type="hidden" name="fromDate" value={from} />
            <FormMessage />
            <Notify />
            <SubmitButton variant="danger">Remove from {fmtDate(from)} onwards</SubmitButton>
          </ActionForm>
          <ActionForm action={actions.deleteSeries} onSuccess={onDone} className="space-y-2" confirm={`Delete the entire ${dayName} ${occ.subjectName} series, including past dates? This can't be undone.`}>
            <input type="hidden" name="id" value={series.id} />
            <FormMessage />
            <Notify />
            <SubmitButton variant="default">Delete entire series (incl. past)</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
