"use client";

import { useState } from "react";
import { templateAction } from "@/modules/exam-prep/actions";
import { EpForm, Msg, Submit } from "../../ui";

const SAMPLE: Record<string, string> = {
  tag: "[Class 10 | CBSE | Maths | Paper 1]",
  title: "Paper 1",
  class: "Class 10",
  board: "CBSE",
  subject: "Maths",
  marks: "40",
  deadline: "Thu 8:00 pm",
  formLink: "https://forms.gle/…",
  student: "Aarav",
  parent: "Mrs Shah",
  paper: "C10-MAT-P1-CBSE",
  n: "1",
  strong: "Trigonometry, Real Numbers",
  weak: "Statistics, Quadratic Equations",
  chapter: "Statistics",
  chapters: "Quadratic Equations and Statistics",
  week: "1",
  formLinks: "Class 10: https://forms.gle/…",
  tier: "Paid 1",
  ref: "a1b2c3d4",
  date: "21/12/2026",
};

/** Live preview with sample values; saved templates are validated on the server (group posts need the tag, no personal variables). */
export function TemplateEditor({ t, brand }: { t: { key: string; audience: string; description: string; body: string; bodyHi: string | null }; brand: Record<string, string> }) {
  const [body, setBody] = useState(t.body);
  const [hi, setHi] = useState(t.bodyHi ?? "");
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => brand[k] ?? SAMPLE[k] ?? m);
  return (
    <EpForm action={templateAction} reset={false} className="card space-y-2">
      <div className="flex items-baseline gap-2">
        <b className="text-sm">{t.description}</b>
        <span className="rounded bg-soft px-1.5 text-[10px] uppercase">{t.audience}</span>
        <code className="ml-auto text-[10px] text-muted">{t.key}</code>
      </div>
      <Msg />
      <input type="hidden" name="key" value={t.key} />
      <div className="grid gap-2 lg:grid-cols-2">
        <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="input font-mono text-xs" />
        <pre className="whitespace-pre-wrap rounded-md bg-[#e7f6ec] p-2 text-xs">{fill(body)}</pre>
        {t.audience !== "group" && (
          <>
            <textarea name="bodyHi" value={hi} onChange={(e) => setHi(e.target.value)} rows={4} placeholder="Hindi version (optional)" className="input text-xs" />
            <pre className="whitespace-pre-wrap rounded-md bg-[#e7f6ec] p-2 text-xs">{fill(hi)}</pre>
          </>
        )}
      </div>
      <Submit tone="plain">Save template</Submit>
    </EpForm>
  );
}
