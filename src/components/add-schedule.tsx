"use client";

import { useState } from "react";
import type { ActionState } from "@/core/action";
import { AddSlotForm } from "./add-slot-form";
import { Req } from "./form";

type Batch = {
  id: string;
  label: string;
  room: string;
  mode: string;
  subjects: { batchSubjectId: string; label: string; durationMin: number; source: string }[];
};

/** Calendar: pick a batch, then add weekly timings for one of its subjects on several days. */
export function AddSchedule({
  batches,
  action,
  presets,
  defaultFrom,
  open,
}: {
  batches: Batch[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  presets: number[];
  defaultFrom: string;
  open: boolean;
}) {
  const schedulable = batches.filter((b) => b.subjects.length);
  const [batchId, setBatchId] = useState(schedulable[0]?.id ?? "");
  const batch = schedulable.find((b) => b.id === batchId) ?? schedulable[0];
  if (!batch) return null;

  return (
    <details className="card mb-4" open={open}>
      <summary className="cursor-pointer text-sm font-semibold">➕ Add a weekly schedule</summary>
      <p className="mt-1 text-xs text-muted">Pick the batch and subject, tick the days and set each day&apos;s time. For a one-time extra class, click an empty time on the calendar.</p>
      <div className="mt-4 space-y-4">
        <label className="block max-w-md">
          <span className="label">
            Batch
            <Req />
          </span>
          <select className="input" required value={batch.id} onChange={(e) => setBatchId(e.target.value)}>
            {schedulable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        {/* Keyed by batch: switching batch starts the form afresh with that batch's subjects, room and mode */}
        <AddSlotForm key={batch.id} action={action} subjects={batch.subjects} presets={presets} defaultRoom={batch.room} defaultMode={batch.mode || "offline"} defaultFrom={defaultFrom} />
      </div>
    </details>
  );
}
