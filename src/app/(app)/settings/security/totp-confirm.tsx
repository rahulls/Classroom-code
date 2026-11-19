"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/core/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Confirms the TOTP code, then shows the one-time recovery codes. */
export function TotpConfirm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const router = useRouter();
  const codes = state?.ok ? (state.data?.recoveryCodes as string[] | undefined) : undefined;

  if (codes) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-ok/10 px-3 py-2 text-sm text-ok">Two-factor authentication is on.</p>
        <p className="text-sm">
          Save these <b>recovery codes</b> somewhere safe (a password manager or printed). Each works once if you lose your phone. <b>They won&apos;t be shown again.</b>
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-md bg-soft p-3 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button type="button" className="btn-primary" onClick={() => router.refresh()}>
          I&apos;ve saved them
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label>
        <span className="label">6-digit code from the app<span className="text-bad"> *</span></span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="input w-36" />
      </label>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Checking…" : "Turn on"}
      </button>
      {state && !state.ok && <p className="w-full text-sm text-bad">{state.fieldErrors?.code ?? state.error}</p>}
    </form>
  );
}
