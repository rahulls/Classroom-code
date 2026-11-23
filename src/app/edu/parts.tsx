"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import type { ActionState } from "@/core/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A one-click action: hidden fields + a button, with the result shown under it. */
export function ActButton({
  action,
  fields,
  children,
  variant = "default",
  confirm,
  className,
}: {
  action: Action;
  fields?: Record<string, string | string[]>;
  children: ReactNode;
  variant?: "primary" | "default" | "danger";
  confirm?: string;
  className?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className={`inline-flex flex-col gap-1 ${className ?? ""}`}>
      {Object.entries(fields ?? {}).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((x, i) => <input key={`${k}${i}`} type="hidden" name={`${k}[]`} value={x} />) : [<input key={k} type="hidden" name={k} value={v} />],
      )}
      <SubmitButton variant={variant}>{children}</SubmitButton>
      <FormMessage />
    </ActionForm>
  );
}

/** Refreshes the page every few seconds while something is running. */
export function AutoRefresh({ every = 15, when = true }: { every?: number; when?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!when) return;
    const t = setInterval(() => router.refresh(), every * 1000);
    return () => clearInterval(t);
  }, [router, every, when]);
  return null;
}

/** Choose a CSV: its text goes into a hidden "csv" field (and its name into "fileName"). */
export function CsvPicker() {
  const [name, setName] = useState("");
  const text = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setName(f.name);
          if (text.current) text.current.value = await f.text();
        }}
      />
      <input ref={text} type="hidden" name="csv" />
      <input type="hidden" name="fileName" value={name} />
    </div>
  );
}
