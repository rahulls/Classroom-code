"use client";

import { useEffect, useRef, useState } from "react";
import { reviewAction } from "@/modules/exam-prep/actions";

export type ReviewItem = {
  markId: string;
  number: number;
  text: string;
  chapter: string;
  max: number;
  scheme: { step: string; marks: number }[];
  /** Internal choice (B): the student answers either this or the main question */
  orText?: string | null;
  orScheme?: { step: string; marks: number }[] | null;
  marks: number;
  aiProposed: number | null;
  aiConfidence: number | null;
  aiReasoning: string | null;
  errorTag: string;
  needsReview: boolean;
  source: string;
};

const TAGS = ["none", "concept", "calculation", "missing_steps", "misread"];

/**
 * One sheet: the PDF beside its questions. Keyboard: J/K next/previous question, A accept,
 * E edit marks, R reject (0), 1-4 error type. Every change is saved (and audited) at once.
 */
export function ReviewPanel({ sheetUrl, items, student }: { sheetUrl: string; items: ReviewItem[]; student: string }) {
  const [list, setList] = useState(items);
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const cur = list[i];

  async function save(action: "accept" | "edit" | "reject", marks?: number, errorTag?: string) {
    if (!cur) return;
    const fd = new FormData();
    fd.set("markId", cur.markId);
    fd.set("action", action);
    if (marks != null) fd.set("marks", String(marks));
    if (errorTag) fd.set("errorTag", errorTag);
    const r = await reviewAction(undefined, fd);
    if (r && !r.ok) return setMsg(r.error);
    setMsg(`Q${cur.number} saved`);
    setList((l) => l.map((x, k) => (k === i ? { ...x, needsReview: false, marks: action === "accept" ? x.marks : (marks ?? 0), errorTag: errorTag ?? x.errorTag } : x)));
    setI((k) => Math.min(k + 1, list.length - 1));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      if (e.key === "j") setI((k) => Math.min(k + 1, list.length - 1));
      else if (e.key === "k") setI((k) => Math.max(k - 1, 0));
      else if (e.key === "a") void save("accept");
      else if (e.key === "r") void save("reject", 0);
      else if (e.key === "e") {
        e.preventDefault();
        editRef.current?.focus();
        editRef.current?.select();
      } else if (/^[1-4]$/.test(e.key) && cur) void save("edit", cur.marks, TAGS[Number(e.key)]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <iframe src={sheetUrl} title={`Answer sheet ${student}`} className="h-[78vh] w-full rounded-lg border border-line bg-white" />
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Keys: <b>J/K</b> next/previous · <b>A</b> accept · <b>E</b> edit · <b>R</b> reject (0) · <b>1-4</b> error type (concept, calculation, missing steps, misread)
        </p>
        {msg && <p className="text-sm text-ok">{msg}</p>}
        <ul className="space-y-1">
          {list.map((x, k) => (
            <li key={x.markId}>
              <button type="button" onClick={() => setI(k)} className={`w-full rounded px-2 py-1 text-left text-sm ${k === i ? "bg-accent/15 font-semibold" : "hover:bg-soft"}`}>
                Q{x.number} · {x.marks}/{x.max} {x.needsReview ? <span className="text-bad">needs review</span> : <span className="text-ok">✓</span>} <span className="text-xs text-muted">{x.chapter}</span>
              </button>
            </li>
          ))}
        </ul>
        {cur && (
          <div className="card space-y-2 text-sm">
            <p>
              <b>Q{cur.number}.</b> {cur.text}
            </p>
            <p className="text-xs text-muted">
              {cur.orText ? "(A) scheme: " : "Scheme: "}
              {cur.scheme.map((s) => `${s.step} [${s.marks}]`).join("; ") || "MCQ (auto)"}
            </p>
            {cur.orText && (
              <div className="rounded border border-line p-2 text-xs">
                <b>OR (B):</b> {cur.orText}
                <p className="mt-1 text-muted">(B) scheme: {(cur.orScheme ?? []).map((s) => `${s.step} [${s.marks}]`).join("; ")}</p>
                <p className="mt-1 text-warn">Mark whichever alternative the student attempted, by its own scheme.</p>
              </div>
            )}
            {cur.aiProposed != null && (
              <p className="rounded bg-soft/60 p-2 text-xs">
                AI proposal: <b>{cur.aiProposed}</b>/{cur.max} · confidence {Math.round((cur.aiConfidence ?? 0) * 100)}% · {cur.aiReasoning}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary px-3 py-1" onClick={() => save("accept")}>
                Accept (A)
              </button>
              <input ref={editRef} type="number" min={0} max={cur.max} step={0.5} defaultValue={cur.marks} key={cur.markId} className="input w-20" onKeyDown={(e) => e.key === "Enter" && save("edit", Number((e.target as HTMLInputElement).value), cur.errorTag)} />
              <button type="button" className="btn px-3 py-1" onClick={() => save("edit", Number(editRef.current?.value ?? 0), cur.errorTag)}>
                Save marks (E)
              </button>
              <button type="button" className="btn-danger px-3 py-1" onClick={() => save("reject", 0)}>
                Reject (R)
              </button>
              <select value={cur.errorTag} onChange={(e) => save("edit", cur.marks, e.target.value)} className="input w-auto py-1">
                {TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
