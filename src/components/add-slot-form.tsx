"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextField, useActionResult, Req } from "@/components/form";
import type { ActionState } from "@/core/action";
import { WEEKDAYS, fmtMin, parseHHMM } from "@/modules/academics/time";

type Subject = { batchSubjectId: string; label: string; durationMin: number; source: string };
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Row = { on: boolean; start: string; end: string };

const addMinutes = (hhmm: string, minutes: number) => {
  const s = parseHHMM(hhmm);
  return s === null ? "" : fmtMin(Math.min(s + minutes, 23 * 60 + 59));
};
const lengthOf = (r: Row) => {
  const s = parseHHMM(r.start);
  const e = parseHHMM(r.end);
  return s !== null && e !== null && e > s ? e - s : null;
};

function FieldErr({ name }: { name: string }) {
  const st = useActionResult();
  const err = st && !st.ok ? st.fieldErrors?.[name] : undefined;
  return err ? <span className="block text-xs text-bad">{err}</span> : null;
}

/**
 * Add timings for one subject on several days. Each ticked day has its own start → end,
 * e.g. Wed 16:30–18:00 and Fri 18:00–19:30.
 */
export function AddSlotForm({
  action,
  subjects,
  presets,
  defaultRoom,
  defaultMode,
  defaultFrom,
}: {
  action: Action;
  subjects: Subject[];
  presets: number[];
  defaultRoom: string;
  defaultMode: string;
  defaultFrom: string;
}) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.batchSubjectId ?? "");
  const subject = subjects.find((s) => s.batchSubjectId === subjectId);
  const [defStart, setDefStart] = useState("16:00");
  const [defLen, setDefLen] = useState<number>(subject?.durationMin ?? 60);
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(WEEKDAYS.map((d) => [d.n, { on: false, start: "16:00", end: addMinutes("16:00", subject?.durationMin ?? 60) }])),
  );

  const setRow = (n: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [n]: { ...r[n]!, ...patch } }));
  const applyDefaults = (start = defStart, len = defLen, onlyTicked = false) =>
    setRows((r) => Object.fromEntries(Object.entries(r).map(([n, row]) => [n, onlyTicked && !row.on ? row : { ...row, start, end: addMinutes(start, len) }])));
  const ticked = WEEKDAYS.filter((d) => rows[d.n]?.on);

  return (
    <ActionForm action={action} className="space-y-4">
      <FormMessage />

      <label className="block max-w-md">
        <span className="label">Subject<Req /></span>
        <select
          name="batchSubjectId"
          required
          className="input"
          value={subjectId}
          onChange={(e) => {
            setSubjectId(e.target.value);
            const s = subjects.find((x) => x.batchSubjectId === e.target.value);
            if (s) {
              setDefLen(s.durationMin);
              applyDefaults(defStart, s.durationMin);
            }
          }}
        >
          {subjects.map((s) => (
            <option key={s.batchSubjectId} value={s.batchSubjectId}>
              {s.label}
            </option>
          ))}
        </select>
        {subject && <span className="mt-1 block text-xs text-muted">Usual length {subject.durationMin} min (from {subject.source})</span>}
      </label>

      <div className="rounded-md bg-soft/60 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label>
            <span className="label">Usual start</span>
            <input
              type="time"
              value={defStart}
              onChange={(e) => {
                setDefStart(e.target.value);
                applyDefaults(e.target.value, defLen);
              }}
              className="input w-32"
            />
          </label>
          <div>
            <span className="label">Usual length</span>
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setDefLen(p);
                    applyDefaults(defStart, p);
                  }}
                  className={`rounded-md border px-2 py-1.5 text-sm ${defLen === p ? "border-accent bg-accent/10 text-accent" : "border-line bg-panel"}`}
                >
                  {p}m
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">These fill in each day below. Change any day&apos;s start or end if it differs.</p>
      </div>

      <fieldset>
        <legend className="label">Days and times<Req /></legend>
        <div className="divide-y divide-soft rounded-md border border-line">
          {WEEKDAYS.map((d) => {
            const r = rows[d.n]!;
            const len = lengthOf(r);
            return (
              <div key={d.n} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${r.on ? "bg-accent/5" : ""}`}>
                <label className="flex w-32 cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="weekdays[]"
                    value={d.n}
                    checked={r.on}
                    onChange={(e) => setRow(d.n, { on: e.target.checked })}
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                  {d.long}
                </label>
                {r.on ? (
                  <>
                    <input
                      type="time"
                      name={`start_${d.n}`}
                      value={r.start}
                      required
                      aria-label={`${d.long} start`}
                      onChange={(e) => {
                        const keep = lengthOf(r) ?? defLen;
                        setRow(d.n, { start: e.target.value, end: addMinutes(e.target.value, keep) });
                      }}
                      className="input w-32 py-1"
                    />
                    <span className="text-muted">→</span>
                    <input
                      type="time"
                      name={`end_${d.n}`}
                      value={r.end}
                      required
                      aria-label={`${d.long} end`}
                      onChange={(e) => setRow(d.n, { end: e.target.value })}
                      className="input w-32 py-1"
                    />
                    <span className={`pill ${len ? "" : "border-bad text-bad"}`}>{len ? `${len} min` : "check times"}</span>
                    <FieldErr name={`start_${d.n}`} />
                    <FieldErr name={`end_${d.n}`} />
                  </>
                ) : (
                  <span className="text-xs text-muted">no class</span>
                )}
              </div>
            );
          })}
        </div>
        <FieldErr name="weekdays" />
        {ticked.length > 0 && <p className="mt-1 text-xs text-muted">{ticked.length} class(es) a week</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <TextField name="room" label="Room" defaultValue={defaultRoom} maxLength={40} placeholder="R-1" />
        <SelectField
          name="mode"
          label="Mode"
          required
          defaultValue={defaultMode}
          options={[
            { value: "offline", label: "Offline" },
            { value: "online", label: "Online" },
            { value: "hybrid", label: "Hybrid" },
          ]}
        />
        <TextField name="meetingUrl" label="Online link" type="url" maxLength={500} placeholder="https://meet…" />
        <TextField name="effectiveFrom" label="Starts from" type="date" required defaultValue={defaultFrom} />
        <TextField name="effectiveTo" label="Until" type="date" hint="Leave empty to run all term" />
        <TextField name="notes" label="Note" maxLength={200} />
      </div>
      <CheckboxField name="allowClash" label="Save anyway if the room or some students clash" />
      <CheckboxField name="notify" label="Tell students (email + WhatsApp)" defaultChecked />
      <SubmitButton>Add class timings</SubmitButton>
    </ActionForm>
  );
}
