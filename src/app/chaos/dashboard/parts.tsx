"use client";

import type { VideoMarks } from "@/modules/chaos/jobs";
import type { VideoRow } from "./video-table";

export type Marks = Record<string, VideoMarks>;
export type OnMark = (id: string, mark: keyof VideoMarks, value: boolean) => void;

/** On YouTube: uploaded through the studio, or ticked by hand. */
export const isUploaded = (r: VideoRow, marks: Marks) => (!!r.youtube && r.youtube !== "uploading") || !!marks[r.id]?.uploaded;

/** A labelled filter drop-down. */
export function Filter<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="input w-auto py-1">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The Uploaded / Discard tick boxes. */
export function Tick({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <label className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${disabled ? "cursor-default" : "cursor-pointer"}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#7a2fc0]" />
      {label}
    </label>
  );
}
