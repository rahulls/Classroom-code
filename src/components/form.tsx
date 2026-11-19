"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/core/action";
import { finishEntry, isDebugOn, readableForm, startEntry } from "./debug";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const StateCtx = createContext<ActionState>(undefined);
const PendingCtx = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
  onSuccess,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  onSuccess?: (state: NonNullable<ActionState>) => void;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const debug = useRef<{ id: number; t0: number } | null>(null);
  useEffect(() => {
    if (!state) return;
    if (debug.current) {
      finishEntry(debug.current.id, state, performance.now() - debug.current.t0);
      debug.current = null;
    }
    if (state.ok) {
      // Cleared after a successful save (as React did); kept as typed when the server refuses
      // (resetOnSuccess is kept for readability at call sites; every form resets on success, as before)
      ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // Actions that redirect, or whose form disappears in the refresh (e.g. a deleted item),
  // never deliver a state here: close their log entry when the form unmounts.
  useEffect(
    () => () => {
      if (debug.current) finishEntry(debug.current.id, { ok: true, note: "page updated (form closed before the reply was shown)" }, performance.now() - debug.current.t0);
    },
    [],
  );
  return (
    <StateCtx.Provider value={state}>
      <PendingCtx.Provider value={pending}>
      <form
        ref={ref}
        action={formAction}
        className={className}
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) {
            e.preventDefault();
            return;
          }
          // Submit ourselves (not via React's form action) so a refused form isn't cleared.
          // Before the page's script loads, the form still posts to the server action natively.
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          if (isDebugOn()) debug.current = { id: startEntry(readableForm(fd)), t0: performance.now() };
          startTransition(() => formAction(fd));
        }}
      >
        <PendingBar />
        {children}
      </form>
      </PendingCtx.Provider>
    </StateCtx.Provider>
  );
}

/** Busy while this form's action runs: our own submit (context) or a native form action. */
function usePending() {
  const { pending } = useFormStatus();
  return useContext(PendingCtx) || pending;
}

/** Top-of-screen progress bar while this form's action runs (covers every button in the form). */
function PendingBar() {
  const pending = usePending();
  return pending ? <span className="progress-bar" role="progressbar" aria-label="Working…" /> : null;
}

export const useActionResult = () => useContext(StateCtx);

function useFieldError(name: string) {
  const s = useContext(StateCtx);
  return s && !s.ok ? s.fieldErrors?.[name] : undefined;
}

export function FormMessage() {
  const s = useContext(StateCtx);
  if (!s) return null;
  if (s.ok) return s.message ? <p className="rounded-md bg-ok/10 px-3 py-2 text-sm text-ok" role="status">{s.message}</p> : null;
  return <p className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">{s.error}</p>;
}

type InputProps = {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  className?: string;
  inputMode?: "numeric" | "tel" | "email" | "text";
  autoFocus?: boolean;
};

/** The red * after the label of a mandatory field. */
export const Req = () => <span className="text-bad"> *</span>;

export function TextField({ name, label, hint, className, defaultValue, ...rest }: InputProps) {
  const err = useFieldError(name);
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">
        {label}
        {rest.required && <span className="text-bad"> *</span>}
      </span>
      <input name={name} defaultValue={defaultValue ?? undefined} aria-invalid={!!err} className={`input ${err ? "border-bad" : ""}`} {...rest} type={rest.type ?? "text"} />
      {err ? <span className="mt-1 block text-xs text-bad">{err}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextAreaField({ name, label, defaultValue, required, hint, rows = 3 }: { name: string; label: string; defaultValue?: string | null; required?: boolean; hint?: string; rows?: number }) {
  const err = useFieldError(name);
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="text-bad"> *</span>}
      </span>
      <textarea name={name} defaultValue={defaultValue ?? undefined} required={required} rows={rows} maxLength={2000} className={`input ${err ? "border-bad" : ""}`} />
      {err ? <span className="mt-1 block text-xs text-bad">{err}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  required,
  placeholder,
  hint,
  className,
  multiple,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string | string[] | null;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
  multiple?: boolean;
}) {
  const err = useFieldError(multiple ? name.replace(/\[\]$/, "") : name);
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">
        {label}
        {required && <span className="text-bad"> *</span>}
      </span>
      <select name={name} defaultValue={defaultValue ?? (multiple ? [] : "")} required={required} multiple={multiple} className={`input ${err ? "border-bad" : ""}`}>
        {!multiple && <option value="">{placeholder ?? "—"}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {err ? <span className="mt-1 block text-xs text-bad">{err}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function CheckboxField({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ children, variant = "primary", className }: { children: ReactNode; variant?: "primary" | "default" | "danger"; className?: string }) {
  const pending = usePending();
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn";
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${cls} ${className ?? ""}`}>
      {pending && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

export type FieldDef = { key: string; label: string; type: string; options: string[]; required: boolean; groupName: string; helpText: string | null; sensitive: boolean };

/** Renders configurable custom fields (names are prefixed cf_). */
export function CustomFields({ defs, values }: { defs: FieldDef[]; values?: Record<string, unknown> }) {
  if (!defs.length) return null;
  const groups = [...new Set(defs.map((d) => d.groupName))];
  return (
    <>
      {groups.map((g) => (
        <fieldset key={g} className="space-y-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {defs
              .filter((d) => d.groupName === g)
              .map((d) => {
                const v = values?.[d.key];
                const name = `cf_${d.key}`;
                const label = d.label;
                const hint = d.helpText ?? undefined;
                switch (d.type) {
                  case "select":
                    return <SelectField key={d.key} name={name} label={label} required={d.required} hint={hint} defaultValue={typeof v === "string" ? v : ""} options={d.options.map((o) => ({ value: o, label: o }))} />;
                  case "multiselect":
                    return <SelectField key={d.key} multiple name={`${name}[]`} label={label} required={d.required} hint={hint ?? "Ctrl/⌘-click to pick several"} defaultValue={Array.isArray(v) ? (v as string[]) : []} options={d.options.map((o) => ({ value: o, label: o }))} />;
                  case "checkbox":
                    return <CheckboxField key={d.key} name={name} label={label} hint={hint} defaultChecked={v === true} />;
                  case "textarea":
                    return <TextAreaField key={d.key} name={name} label={label} required={d.required} hint={hint} defaultValue={typeof v === "string" ? v : ""} />;
                  default: {
                    const type = d.type === "number" ? "number" : d.type === "date" ? "date" : d.type === "email" ? "email" : d.type === "url" ? "url" : d.type === "phone" ? "tel" : "text";
                    return <TextField key={d.key} name={name} label={label} type={type} required={d.required} hint={hint} defaultValue={v === undefined || v === "••••••" ? "" : String(v)} />;
                  }
                }
              })}
          </div>
        </fieldset>
      ))}
    </>
  );
}
