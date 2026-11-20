"use client";

import { useRef, useState } from "react";
import { rowMarksAction } from "@/modules/exam-prep/actions";
import type { AnswerRow } from "@/modules/exam-prep/domain/answer-rows";
import { EpForm, Msg, Submit } from "../../../../ui";

const TAGS = ["none", "concept", "calculation", "missing_steps", "misread"];

/**
 * Row-wise marking of an uploaded paper: answer number, max marks, marks given, where marks were lost.
 * Click a max to give full marks. The total updates as you type; OR alternatives count once.
 */
export function RowGrid({ submissionId, rows, saved }: { submissionId: string; rows: AnswerRow[]; saved: Record<string, { marks: number; errorTag: string }> }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.label, saved[r.label] != null ? String(saved[r.label]!.marks) : ""])));
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const seen = new Set<string>();
  let max = 0;
  for (const r of rows) {
    if (r.choice) {
      if (seen.has(r.choice)) continue;
      seen.add(r.choice);
    }
    max += r.max;
  }
  const got = rows.reduce((a, r) => a + (Number(vals[r.label]) || 0), 0);
  const openGroups = new Set<string>();
  let open = 0;
  for (const r of rows) {
    if (r.choice) {
      if (openGroups.has(r.choice)) continue;
      openGroups.add(r.choice);
      if (!rows.some((x) => x.choice === r.choice && vals[x.label] !== "")) open++;
    } else if (vals[r.label] === "") open++;
  }
  const clash = (r: AnswerRow) => !!r.choice && vals[r.label] !== "" && rows.some((x) => x !== r && x.choice === r.choice && vals[x.label] !== "");
  const set = (label: string, v: string) => setVals((s) => ({ ...s, [label]: v }));
  let lastSection: string | undefined;

  return (
    <EpForm action={rowMarksAction} className="card space-y-2 text-sm">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-center gap-2">
        <b>
          Total {got} / {max}
        </b>
        <span className="text-xs text-muted">{open ? `${open} answer${open === 1 ? "" : "s"} not marked` : "all answers marked"}</span>
        <span className="ml-auto text-xs text-muted">Tab to move · click a max to give full marks · blank = not marked</span>
      </div>
      <div className="max-h-[72vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-panel [&>th]:py-1">
              <th>Answer</th>
              <th className="text-right">Max</th>
              <th className="pr-2 text-right">Marks</th>
              <th>Where lost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const head = r.section && r.section !== lastSection;
              lastSection = r.section ?? lastSection;
              const v = vals[r.label] ?? "";
              const lost = v !== "" && Number(v) < r.max;
              return [
                head ? (
                  <tr key={`sec-${r.section}-${r.label}`}>
                    <td colSpan={4} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Section {r.section}
                    </td>
                  </tr>
                ) : null,
                <tr key={r.label} className={`border-t border-line ${clash(r) ? "bg-bad/10" : ""}`}>
                  <td className="py-1">
                    <b>{r.label}</b>
                    {r.choice && <span className="ml-1 rounded bg-soft px-1 text-[10px] text-muted">OR {r.choice}</span>}
                    {r.chapter && <span className="ml-1 text-muted">{r.chapter}</span>}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="rounded px-1 text-accent hover:bg-soft"
                      title="Full marks"
                      onClick={() => {
                        set(r.label, String(r.max));
                        refs.current[r.label]?.focus();
                      }}
                    >
                      {r.max}
                    </button>
                  </td>
                  <td className="text-right">
                    <input
                      ref={(el) => {
                        refs.current[r.label] = el;
                      }}
                      name={`m:${r.label}`}
                      type="number"
                      min={0}
                      max={r.max}
                      step={0.5}
                      value={v}
                      onChange={(e) => set(r.label, e.target.value)}
                      className="input w-16 px-1 py-0.5 text-right"
                      aria-label={`Marks for answer ${r.label}`}
                    />
                  </td>
                  <td>
                    <select name={`t:${r.label}`} defaultValue={saved[r.label]?.errorTag ?? "none"} disabled={!lost} className="input w-auto px-1 py-0.5 text-xs disabled:opacity-40" aria-label={`Where marks were lost on ${r.label}`}>
                      {TAGS.map((t) => (
                        <option key={t} value={t}>
                          {t === "none" ? "-" : t.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      {rows.some(clash) && <p className="text-xs text-bad">Two OR alternatives both have marks: keep only the one the student attempted.</p>}
      <div className="flex items-center gap-2">
        <Submit>Save marks</Submit>
        <Msg />
      </div>
    </EpForm>
  );
}
