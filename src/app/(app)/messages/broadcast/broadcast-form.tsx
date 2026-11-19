"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActionForm, FormMessage, Req, SubmitButton, TextField, useActionResult } from "@/components/form";
import type { ActionState } from "@/core/action";

export type BroadcastRow = {
  /** Contact id */
  id: string;
  name: string;
  role: "student" | "parent";
  /** First names of their student(s) */
  students: string;
  classIds: string[];
  classLabels: string;
  channel: "whatsapp" | "email";
};
type Skip = { name: string; role: "student" | "parent"; students: string; reason: string };

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  rows: BroadcastRow[];
  classes: { id: string; label: string }[];
  skipped: Skip[];
  accept: string;
  maxFileMb: number;
  maxImageMb: number;
  institute: string;
  waMode: "test" | "manual" | "cloud";
  templates: { text: string; image: string; document: string };
};

const who = (r: { role: "student" | "parent"; students: string }) => (r.role === "parent" ? `Parent of ${r.students}` : "Student");

export function BroadcastForm(props: Props) {
  const { rows } = props;
  const everyone = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const [ticked, setTicked] = useState<Set<string>>(everyone);
  // Bumped after a successful send so the form's fields start fresh
  const [round, setRound] = useState(0);
  const n = ticked.size;

  return (
    <ActionForm
      action={props.action}
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      confirm={`Send this broadcast to ${n} ${n === 1 ? "person" : "people"}?`}
      onSuccess={() => {
        setTicked(new Set(everyone));
        setRound((r) => r + 1);
      }}
    >
      <Recipients key={`r${round}`} {...props} ticked={ticked} setTicked={setTicked} />
      <Compose key={`c${round}`} {...props} count={n} />
    </ActionForm>
  );
}

function Recipients({ rows, classes, skipped, ticked, setTicked }: Props & { ticked: Set<string>; setTicked: (s: Set<string>) => void }) {
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const state = useActionResult();
  const err = state && !state.ok ? state.fieldErrors?.contactIds : undefined;

  const shown = (r: BroadcastRow) =>
    (!cls || r.classIds.includes(cls)) && (!q || `${r.name} ${r.students} ${r.classLabels}`.toLowerCase().includes(q.trim().toLowerCase()));
  const visible = rows.filter(shown);
  const students = rows.filter((r) => r.role === "student").length;
  const parents = rows.length - students;
  const pick = (f: (r: BroadcastRow) => boolean) => setTicked(new Set(rows.filter(f).map((r) => r.id)));
  const setShown = (on: boolean) => {
    const next = new Set(ticked);
    for (const r of visible) on ? next.add(r.id) : next.delete(r.id);
    setTicked(next);
  };
  const filtered = !!(q || cls);

  return (
    <section className="card min-w-0 space-y-3" aria-label="Recipients">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Send to <Req />
        </h2>
        <span className={`text-sm ${ticked.size ? "text-muted" : "text-bad"}`} aria-live="polite">
          <b className="text-ink">{ticked.size}</b> of {rows.length} ticked
        </span>
      </div>

      {rows.length ? (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick select">
            <button type="button" className="btn" onClick={() => pick(() => true)}>
              Everyone ({rows.length})
            </button>
            <button type="button" className="btn" onClick={() => pick((r) => r.role === "student")}>
              All students ({students})
            </button>
            <button type="button" className="btn" onClick={() => pick((r) => r.role === "parent")}>
              All parents ({parents})
            </button>
            <button type="button" className="btn" onClick={() => setTicked(new Set())}>
              Nobody
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-40 flex-1">
              <span className="label">Find</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, student or class" className="input" />
            </label>
            {classes.length > 1 && (
              <label className="block">
                <span className="label">Class</span>
                <select value={cls} onChange={(e) => setCls(e.target.value)} className="input">
                  <option value="">All classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {filtered && (
              <>
                <button type="button" className="btn" onClick={() => setShown(true)}>
                  Tick these {visible.length}
                </button>
                <button type="button" className="btn" onClick={() => setShown(false)}>
                  Untick these {visible.length}
                </button>
              </>
            )}
          </div>

          {err && <p className="text-xs text-bad">{err}</p>}
          <div className="max-h-[32rem] overflow-y-auto rounded-md border border-line">
            <table className="table">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  <th className="w-8">
                    <span className="sr-only">Send</span>
                  </th>
                  <th>Name</th>
                  <th>Who</th>
                  <th>Class</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  // Hidden rows stay in the form so a filter never drops ticked people
                  <tr key={r.id} className={shown(r) ? "" : "hidden"}>
                    <td>
                      <input
                        type="checkbox"
                        name="contactIds[]"
                        value={r.id}
                        checked={ticked.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(ticked);
                          e.target.checked ? next.add(r.id) : next.delete(r.id);
                          setTicked(next);
                        }}
                        aria-label={`${r.name} (${who(r)})`}
                        className="h-4 w-4 accent-[rgb(var(--accent))]"
                      />
                    </td>
                    <td>{r.name}</td>
                    <td>
                      <span className="pill whitespace-nowrap">{who(r)}</span>
                    </td>
                    <td className="text-xs text-muted">{r.classLabels || "—"}</td>
                    <td className="text-xs text-muted">{r.channel === "whatsapp" ? "WhatsApp" : "Email"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered && !visible.length && <p className="p-3 text-xs text-muted">Nobody matches.</p>}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Nobody can get messages yet: give students or parents WhatsApp / email consent on their profile.</p>
      )}

      {skipped.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-warn">{skipped.length} can’t get messages (no consent or number)</summary>
          <ul className="mt-1 space-y-0.5 text-muted">
            {skipped.map((s, i) => (
              <li key={i}>
                {s.name} ({who(s)}): {s.reason}. Fix it on the student’s profile.
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Compose({ count, accept, maxFileMb, maxImageMb, institute, waMode, templates }: Props & { count: number }) {
  const state = useActionResult();
  const errs = state && !state.ok ? state.fieldErrors : undefined;
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const isImage = !!file && /\.(jpe?g|png)$/i.test(file.name);
  const tooBig = !!file && file.size > (isImage ? maxImageMb : maxFileMb) * 1024 * 1024;

  useEffect(() => {
    if (!file || !isImage) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const template = !file ? templates.text : isImage ? templates.image : templates.document;
  const intro = !file ? `here is a notice about classes for <student> at ${institute}:` : `here is an update from ${institute} for <student>:`;

  return (
    <section className="card min-w-0 space-y-3" aria-label="Message">
      <h2 className="text-sm font-semibold">Message</h2>
      <FormMessage />
      <TextField name="subject" label="Title" required maxLength={80} placeholder="e.g. Diwali holidays" hint="Email subject, and how it’s listed under Messages." />
      <label className="block">
        <span className="label">
          Message
          <Req />
        </span>
        <textarea
          name="text"
          required
          rows={6}
          maxLength={600}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={!!errs?.text}
          className={`input ${errs?.text ? "border-bad" : ""}`}
          placeholder="e.g. Classes are off from Sat, 14 Nov to Mon, 16 Nov for Diwali. They resume on Tue, 17 Nov."
        />
        <span className={`mt-1 block text-xs ${errs?.text ? "text-bad" : "text-muted"}`}>
          {errs?.text ?? `${text.length}/600. Line breaks are kept in email; WhatsApp shows it as one paragraph.`}
        </span>
      </label>

      <label className="block">
        <span className="label">Attachment</span>
        <input
          type="file"
          name="file"
          accept={accept}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-soft file:px-3 file:py-1.5 file:text-sm"
        />
        <span className={`mt-1 block text-xs ${tooBig || errs?.file ? "text-bad" : "text-muted"}`}>
          {errs?.file ??
            (tooBig
              ? `Too big: ${(file!.size / 1024 / 1024).toFixed(1)} MB. ${isImage ? `Pictures up to ${maxImageMb} MB` : `Documents up to ${maxFileMb} MB`}.`
              : `One picture (JPG, PNG, up to ${maxImageMb} MB) or document (PDF, Word, Excel, PowerPoint, up to ${maxFileMb} MB).`)}
        </span>
      </label>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Attached picture" className="max-h-48 rounded-md border border-line" />
      )}

      <TextField name="sendAt" label="Send later" type="datetime-local" hint="Leave empty to send now. Times are IST." />

      <div className="rounded-md bg-soft p-3 text-xs">
        <b>On WhatsApp{waMode === "cloud" ? ` (template “${template}”)` : ""}:</b>
        <pre className="mt-1 whitespace-pre-wrap font-sans">
          {file ? `[${isImage ? "picture" : file.name}]\n` : ""}
          {`Hello <name>, ${intro}\n\n${text.trim().replace(/\s+/g, " ") || "<message>"}\n\nReply to this message if you have any questions.`}
        </pre>
        <p className="mt-2 text-muted">
          &lt;student&gt; is the student’s own name, or a parent’s child(ren). By email it comes with the title as the subject{file ? " and the file attached" : ""}.
          {waMode === "manual" && file && " Manual WhatsApp mode: attach the file yourself in each chat."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {count && !tooBig ? <SubmitButton>Send to {count}</SubmitButton> : <button type="button" disabled className="btn-primary">Send to {count}</button>}
        <Link href="/messages" className="btn">
          Messages
        </Link>
      </div>
    </section>
  );
}
