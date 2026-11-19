"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionState } from "@/core/action";
import type { Occurrence } from "@/modules/academics/timetable";
import { fmtDate } from "@/modules/academics/time";
import { ActionForm, CheckboxField, FormMessage, SubmitButton, TextAreaField, TextField } from "./form";

// The "Notes & homework" and "Attendance" tabs of a class in the calendar.

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Status = "present" | "late" | "absent";
export type ClassData = {
  notes: string;
  homework: string;
  homeworkDue: string;
  sentAt: string | null;
  attendanceTakenAt: string | null;
  roster: { id: string; name: string; rollNo: string | null; joinedAfter: string | null; status: Status | null }[];
  canMark: boolean;
};

/** Same rule as the server: a weekly class keeps "<slotId>:<usual date>" even when moved. */
export const classKeyOf = (o: Pick<Occurrence, "slotId" | "slotDate" | "changeId">) => (o.slotId && o.slotDate ? `${o.slotId}:${o.slotDate}` : (o.changeId ?? ""));

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ClassRef({ occ }: { occ: Occurrence }) {
  return (
    <>
      <input type="hidden" name="classKey" value={classKeyOf(occ)} />
      <input type="hidden" name="batchId" value={occ.batchId} />
      <input type="hidden" name="date" value={occ.date} />
    </>
  );
}

/** Loads the class's notes, homework and attendance once the dialog opens. */
export function useClassData(occ: Occurrence, load: Action) {
  const [data, setData] = useState<ClassData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    const fd = new FormData();
    fd.set("classKey", classKeyOf(occ));
    fd.set("batchId", occ.batchId);
    fd.set("date", occ.date);
    load(undefined, fd)
      .then((s) => (s?.ok ? setData(s.data as unknown as ClassData) : setError(s?.error ?? "Couldn't load this class.")))
      .catch(() => setError("Couldn't load this class."));
  }, [occ, load]);
  useEffect(reload, [reload]);
  return { data, error };
}

function Loading({ error }: { error: string | null }) {
  return <p className={`p-4 text-sm ${error ? "text-bad" : "text-muted"}`}>{error ?? "Loading…"}</p>;
}

export function NotesPanel({ occ, data, error, action, onDone, onCancel }: { occ: Occurrence; data: ClassData | null; error: string | null; action: Action; onDone: (s: NonNullable<ActionState>) => void; onCancel: () => void }) {
  if (!data) return <Loading error={error} />;
  return (
    <ActionForm action={action} onSuccess={onDone} className="space-y-3 p-4">
      <ClassRef occ={occ} />
      <FormMessage />
      <TextAreaField name="notes" label="Covered in class" rows={3} defaultValue={data.notes} hint="e.g. Chapter 4: Quadratic equations, factorisation method. Up to 1000 characters." />
      <TextAreaField name="homework" label="Homework" rows={2} defaultValue={data.homework} hint="e.g. Exercise 4.2, questions 1 to 10. Leave empty if none." />
      <TextField name="homeworkDue" label="Submit by" type="date" defaultValue={data.homeworkDue} />
      <CheckboxField
        name="send"
        label="Send to all students of this batch (WhatsApp, or email if no WhatsApp)"
        defaultChecked={!data.sentAt}
        hint={data.sentAt ? `Already sent on ${when(data.sentAt)}. Tick to send again.` : "Students only, so they can follow along."}
      />
      <div className="rounded-md bg-soft p-3 text-xs">
        <b>What students get:</b>
        <pre className="mt-1 whitespace-pre-wrap font-sans">
          {`Hello <name>, here are the notes from the ${occ.subjectName} class for <class> on ${fmtDate(occ.date)}.\n\nCovered in class: <notes>\n\nHomework: <homework> (submit by <date>)\n\nPlease revise and complete the homework before the next class.`}
        </pre>
        <p className="mt-1 text-muted">With homework only (no notes), the homework message is sent instead.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>Save</SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Close
        </button>
      </div>
    </ActionForm>
  );
}

const STATUS: { value: Status; label: string; on: string }[] = [
  { value: "present", label: "Present", on: "bg-ok/15 text-ok border-ok/50" },
  { value: "late", label: "Late", on: "bg-warn/15 text-warn border-warn/50" },
  { value: "absent", label: "Absent", on: "bg-bad/15 text-bad border-bad/50" },
];

export function AttendancePanel({ occ, data, error, action, onDone, onCancel }: { occ: Occurrence; data: ClassData | null; error: string | null; action: Action; onDone: (s: NonNullable<ActionState>) => void; onCancel: () => void }) {
  const [marks, setMarks] = useState<Record<string, Status>>({});
  useEffect(() => {
    if (data) setMarks(Object.fromEntries(data.roster.map((s) => [s.id, s.status ?? "present"])));
  }, [data]);
  if (!data) return <Loading error={error} />;
  if (!data.canMark) return <p className="p-4 text-sm text-muted">Attendance opens on the day of the class ({fmtDate(occ.date)}).</p>;
  if (!data.roster.length) return <p className="p-4 text-sm text-muted">No students in this batch on {fmtDate(occ.date)}.</p>;
  const count = (s: Status) => data.roster.filter((r) => marks[r.id] === s).length;

  return (
    <ActionForm action={action} onSuccess={onDone} className="space-y-3 p-4">
      <ClassRef occ={occ} />
      <FormMessage />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{data.attendanceTakenAt ? `Taken on ${when(data.attendanceTakenAt)}. Change it below if needed.` : "Everyone starts as present: tap who was absent or late."}</span>
        <button type="button" className="btn ml-auto px-2 py-1 text-xs" onClick={() => setMarks(Object.fromEntries(data.roster.map((s) => [s.id, "present" as Status])))}>
          All present
        </button>
      </div>
      <ul className="divide-y divide-soft rounded-md border border-line">
        {data.roster.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <input type="hidden" name="studentIds[]" value={s.id} />
            <input type="hidden" name="statuses[]" value={marks[s.id] ?? "present"} />
            <span className="flex-1">
              {s.rollNo && <span className="mr-2 text-xs text-muted">{s.rollNo}</span>}
              {s.name}
              {s.joinedAfter && <span className="pill ml-2 text-xs">joined {fmtDate(s.joinedAfter)}</span>}
            </span>
            <span className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
              {STATUS.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  role="radio"
                  aria-checked={marks[s.id] === st.value}
                  onClick={() => setMarks((m) => ({ ...m, [s.id]: st.value }))}
                  className={`rounded-md border px-2 py-0.5 text-xs ${marks[s.id] === st.value ? st.on : "border-line text-muted hover:text-ink"}`}
                >
                  {st.label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {count("present")} present · {count("late")} late · {count("absent")} absent. Saved for reports to parents later; nobody is messaged now.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>Save attendance</SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Close
        </button>
      </div>
    </ActionForm>
  );
}
