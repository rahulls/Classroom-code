"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { EpResult } from "@/modules/exam-prep/action";

// Exam Prep's own small form kit (it doesn't use the classroom's components).

type Action = (prev: EpResult, fd: FormData) => Promise<EpResult>;
const Ctx = createContext<EpResult>(undefined);

export function EpForm({ action, children, className, confirm, reset = true, onDone }: { action: Action; children: ReactNode; className?: string; confirm?: string; reset?: boolean; onDone?: () => void }) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Ctx.Provider value={state}>
      <form
        ref={ref}
        action={formAction}
        className={className}
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {children}
      </form>
    </Ctx.Provider>
  );
}

export function Msg() {
  const s = useContext(Ctx);
  if (!s) return null;
  return <p className={`rounded-md px-3 py-2 text-sm ${s.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{s.ok ? s.message : s.error}</p>;
}

export function Submit({ children, tone = "primary", className = "" }: { children: ReactNode; tone?: "primary" | "plain" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  const cls = tone === "primary" ? "btn-primary" : tone === "danger" ? "btn-danger" : "btn";
  return (
    <button type="submit" disabled={pending} className={`${cls} ${className} disabled:opacity-60`}>
      {pending ? "Working…" : children}
    </button>
  );
}

/** One-click form: hidden fields + a button. */
export function ActionButton({ action, fields, children, tone = "plain", confirm, className }: { action: Action; fields: Record<string, string>; children: ReactNode; tone?: "primary" | "plain" | "danger"; confirm?: string; className?: string }) {
  return (
    <EpForm action={action} confirm={confirm} className={`inline-flex flex-col gap-1 ${className ?? ""}`}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Submit tone={tone} className="px-2 py-1 text-xs">
        {children}
      </Submit>
      <Msg />
    </EpForm>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn px-2 py-1 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

export const Req = () => <span className="text-bad"> *</span>;

export function Field({ label, req, hint, children }: { label: string; req?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="label">
        {label}
        {req && <Req />}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Intake fields that depend on each other: State-board fields only for State board; subjects by class. */
export function IntakeFields({ subjectsByClass }: { subjectsByClass: Record<number, string[]> }) {
  const [klass, setKlass] = useState(10);
  const [board, setBoard] = useState("CBSE");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Student name" req>
        <input name="name" required className="input" maxLength={80} />
      </Field>
      <Field label="Class" req>
        <select name="klass" className="input" value={klass} onChange={(e) => setKlass(Number(e.target.value))}>
          {[9, 10, 11, 12].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Board" req>
        <select name="board" className="input" value={board} onChange={(e) => setBoard(e.target.value)}>
          {["CBSE", "ICSE-ISC", "State", "IGCSE", "Other"].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </Field>
      {board === "State" && (
        <>
          <Field label="State board name" req>
            <input name="stateBoard" required className="input" />
          </Field>
          <Field label="Medium">
            <input name="medium" className="input" />
          </Field>
        </>
      )}
      <fieldset className="text-sm sm:col-span-2">
        <legend className="label">
          Subjects
          <Req />
        </legend>
        <div className="flex flex-wrap gap-4">
          {(subjectsByClass[klass] ?? []).map((s) => (
            <label key={`${klass}-${s}`} className="flex items-center gap-1.5">
              <input type="checkbox" name="subjects[]" value={s} defaultChecked /> {s}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="School">
        <input name="school" className="input" />
      </Field>
      <Field label="Last exam range">
        <input name="lastExamRange" className="input" placeholder="e.g. 60-70%" />
      </Field>
      <Field label="Parent or guardian name" req>
        <input name="parentName" required className="input" />
      </Field>
      <Field label="Parent WhatsApp number" req>
        <input name="parentWhatsapp" required className="input" placeholder="+91 98765 43210" />
      </Field>
      <Field label="Parent email">
        <input name="parentEmail" type="email" className="input" />
      </Field>
      <Field label="Report language">
        <select name="language" className="input">
          <option value="en">English</option>
          <option value="hi">Hindi</option>
        </select>
      </Field>
      <Field label="Parent report timing">
        <select name="reportTiming" className="input">
          <option value="same">Same time as the student</option>
          <option value="after">After the student</option>
        </select>
      </Field>
      <div className="space-y-1 text-sm sm:col-span-2">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="consent" required className="mt-1" /> <span>Parent consent given (current consent text)<Req /></span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="rankConsent" /> Share rank personally (told by the tutor, never published)
        </label>
      </div>
    </div>
  );
}
