"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/core/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const markForm = (id: string, outcome: "sent" | "skipped") => {
  const fd = new FormData();
  fd.set("id", id);
  fd.set("outcome", outcome);
  return fd;
};

/**
 * Manual WhatsApp: opens your WhatsApp (Desktop or Web) with the chat and message filled in,
 * and marks the message as sent. You still press Send in WhatsApp.
 */
export function WaSendButtons({ id, href, mark }: { id: string; href: string; mark: Action }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-wrap gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={`btn-primary ${pending ? "pointer-events-none opacity-60" : ""}`}
        onClick={() => start(() => void mark(undefined, markForm(id, "sent")))}
      >
        Open WhatsApp
      </a>
      <button type="button" className="btn" disabled={pending} onClick={() => start(() => void mark(undefined, markForm(id, "skipped")))}>
        Skip
      </button>
    </span>
  );
}

/** Manual-mode test: opens WhatsApp with a sample message to the number typed in. Nothing is stored. */
export function WaTestLink({ sample }: { sample: string }) {
  const [to, setTo] = useState("");
  let digits = to.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) digits = `91${digits}`; // Indian mobile without country code
  const valid = digits.length >= 11 && digits.length <= 15;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="label">Your mobile number<span className="text-bad"> *</span></span>
        <input className="input" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="98xxxxxxxx" maxLength={20} inputMode="tel" />
      </label>
      <a
        href={valid ? `https://wa.me/${digits}?text=${encodeURIComponent(sample)}` : undefined}
        target="_blank"
        rel="noreferrer noopener"
        aria-disabled={!valid}
        className={`btn ${valid ? "" : "pointer-events-none opacity-50"}`}
      >
        Open WhatsApp test
      </a>
    </div>
  );
}
