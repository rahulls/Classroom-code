"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Developer aid: shows what each form action sent and what came back, as readable JSON.
// Off by default; the switch is per-browser (localStorage) and data never leaves this browser.

export type DebugEntry = {
  id: number;
  at: string;
  page: string;
  request: Record<string, unknown>;
  response?: unknown;
  ms?: number;
};

const KEY = "rsc.debugActions";
const SECRET_FIELDS = /pass(word)?|confirm|current|token|code|secret/i;
let entries: DebugEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isDebugOn(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugOn(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: stays off */
  }
  emit();
}

/** FormData → plain object; drops Next.js internals and masks secrets. */
export function readableForm(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const value = typeof v === "string" ? (SECRET_FIELDS.test(k) && v ? "••••••" : v) : `(file ${v.name})`;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], value);
    else out[k] = value;
  }
  return out;
}

export function startEntry(request: Record<string, unknown>): number {
  const id = ++seq;
  entries = [{ id, at: new Date().toLocaleTimeString(), page: window.location.pathname, request }, ...entries].slice(0, 20);
  emit();
  return id;
}

export function finishEntry(id: number, response: unknown, ms: number) {
  entries = entries.map((e) => (e.id === id ? { ...e, response: response ?? { ok: true }, ms: Math.round(ms) } : e));
  const e = entries.find((x) => x.id === id);
  if (e) {
    const ok = (response as { ok?: boolean } | undefined)?.ok !== false;
    console.groupCollapsed(`%c[action] ${e.page} · ${e.ms} ms · ${ok ? "ok" : "error"}`, `color:${ok ? "#2f9e44" : "#c92a2a"}`);
    console.log("request", e.request);
    console.log("response", e.response);
    console.groupEnd();
  }
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDebugOn() {
  return useSyncExternalStore(subscribe, isDebugOn, () => false);
}

/** Floating panel (bottom-right) listing recent requests/responses. Renders nothing when off. */
export function DebugPanel() {
  const on = useDebugOn();
  const list = useSyncExternalStore(
    subscribe,
    () => entries,
    () => entries,
  );
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !on) return null;

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[min(28rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-panel text-xs shadow-lg">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <b className="flex-1">Request / response log</b>
        <button type="button" className="text-muted hover:text-ink" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </button>
        <button type="button" className="text-bad hover:underline" onClick={() => setDebugOn(false)}>
          Turn off
        </button>
      </div>
      {open && (
        <div className="max-h-80 space-y-2 overflow-y-auto p-2">
          {list.length === 0 && <p className="p-2 text-muted">Submit any form to see what's sent and received.</p>}
          {list.map((e) => {
            const ok = (e.response as { ok?: boolean } | undefined)?.ok !== false;
            return (
              <details key={e.id} className="rounded border border-soft" open={e.id === list[0]?.id}>
                <summary className="cursor-pointer px-2 py-1">
                  <span className="text-muted">{e.at}</span> {e.page}{" "}
                  {e.ms === undefined ? <span className="spinner" /> : <span className={ok ? "text-ok" : "text-bad"}>{e.ms} ms · {ok ? "ok" : "error"}</span>}
                </summary>
                <div className="space-y-1 px-2 pb-2">
                  <div className="font-semibold">Request</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-soft p-2">{JSON.stringify(e.request, null, 2)}</pre>
                  <div className="font-semibold">Response</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-soft p-2">{e.response === undefined ? "…waiting" : JSON.stringify(e.response, null, 2)}</pre>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Switch used on Settings › Developer. */
export function DebugToggle() {
  const on = useDebugOn();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={mounted && on} onChange={(e) => setDebugOn(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
      Show readable request / response for every action (this browser only)
    </label>
  );
}
