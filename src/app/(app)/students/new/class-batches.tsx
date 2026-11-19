"use client";

import { useMemo, useState } from "react";
import { Req, useActionResult } from "@/components/form";

export type PickBatch = { id: string; name: string; classId: string; classPath: string; subjects: string[]; programLabel: string | null };

/**
 * Pick the class, then tick one or more of its batches (e.g. Mathematics and Physics).
 * A class with a single batch has it ticked automatically. Each ticked batch becomes an enrolment.
 */
export function ClassBatches({ batches }: { batches: PickBatch[] }) {
  const classes = useMemo(() => {
    const m = new Map<string, { id: string; label: string; programLabel: string | null }>();
    for (const b of batches) if (!m.has(b.classId)) m.set(b.classId, { id: b.classId, label: b.classPath || b.name, programLabel: b.programLabel });
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [batches]);
  const [classId, setClassId] = useState(classes.length === 1 ? classes[0]!.id : "");
  const inClass = batches.filter((b) => b.classId === classId);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(inClass.length === 1 ? [inClass[0]!.id] : []));
  const state = useActionResult();
  const err = state && !state.ok ? state.fieldErrors?.batchIds : undefined;

  const chooseClass = (id: string) => {
    setClassId(id);
    const mine = batches.filter((b) => b.classId === id);
    setPicked(new Set(mine.length === 1 ? [mine[0]!.id] : []));
  };
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">
          Class
          <Req />
        </span>
        <select name="classId" required value={classId} onChange={(e) => chooseClass(e.target.value)} className="input">
          <option value="">Choose…</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.programLabel ? ` (${c.programLabel})` : ""}
            </option>
          ))}
        </select>
      </label>

      {classId && (
        <div role="group" aria-label="Batches">
          <span className="label">
            Batches
            <Req />
          </span>
          <div className={`grid gap-2 rounded-md border p-3 sm:grid-cols-2 ${err ? "border-bad" : "border-line"}`}>
            {inClass.map((b) => {
              const extra = b.subjects.filter((s) => s.toLowerCase() !== b.name.toLowerCase());
              return (
                <label key={b.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="batchIds[]"
                    value={b.id}
                    checked={picked.has(b.id)}
                    onChange={() => toggle(b.id)}
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                  <span>
                    {b.name}
                    {extra.length > 0 && <span className="block text-xs text-muted">{extra.join(", ")}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {err ? (
            <span className="mt-1 block text-xs text-bad">{err}</span>
          ) : (
            <span className="mt-1 block text-xs text-muted">Tick every subject batch the student is joining. {picked.size ? `${picked.size} selected.` : ""}</span>
          )}
        </div>
      )}
    </div>
  );
}
