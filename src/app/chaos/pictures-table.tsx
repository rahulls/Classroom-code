"use client";

import { useEffect, useState, useTransition } from "react";
import { picturePromptsAction } from "@/modules/chaos/actions";

type Row = { name: string; label: string; prompt: string; canva: boolean };
type Up = { state: "uploading" | "done" | "error"; preview?: string; error?: string };

/**
 * While creating a video: Claude's prompt for every picture, and an upload for each. An uploaded
 * picture is used as it is (Canva isn't asked for it). Optional: skip it and everything is automatic.
 * Goes inside the create form: it adds the hidden fields picturesToken and holdPictures.
 */
export function PicturesTable({ kind, csv, count, badge, title, vertical }: { kind: "quiz" | "facts"; csv: string; count: number; badge: string; title: string; vertical: boolean }) {
  const [token, setToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [ups, setUps] = useState<Record<string, Up>>({});
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const [hold, setHold] = useState(false);

  // Another CSV or number of items: the prompts no longer match
  const sig = `${csv.length}:${csv.slice(0, 200)}:${count}`;
  useEffect(() => {
    setToken("");
    setRows([]);
    setUps({});
    setMsg("");
  }, [sig]);

  const getPrompts = () =>
    start(async () => {
      setMsg("");
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("csv", csv);
      fd.set("count", String(count));
      fd.set("badge", badge);
      fd.set("title", title);
      const res = await picturePromptsAction(undefined, fd);
      if (!res?.ok) return setMsg(res?.ok === false ? res.error : "Something went wrong.");
      const data = res.data as { token: string; rows: Row[] };
      setToken(data.token);
      setRows(data.rows);
      setUps({});
    });

  const send = async (name: string, file: File | null) => {
    if (file && file.size > 10 * 1024 * 1024) return setUps((u) => ({ ...u, [name]: { state: "error", error: "Under 10 MB, please." } }));
    setUps((u) => ({ ...u, [name]: { state: "uploading", preview: file ? URL.createObjectURL(file) : undefined } }));
    const fd = new FormData();
    fd.set("token", token);
    fd.set("name", name);
    if (file) fd.set("file", file);
    try {
      const r = await fetch("/chaos/pictures", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || "Couldn't upload it.");
      setUps((u) => {
        const next = { ...u };
        if (file) next[name] = { state: "done", preview: u[name]?.preview };
        else delete next[name];
        return next;
      });
    } catch (e) {
      setUps((u) => ({ ...u, [name]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const mine = rows.filter((r) => ups[r.name]?.state === "done");
  const canvaMakes = rows.filter((r) => r.canva && ups[r.name]?.state !== "done").length;
  const shared = rows.filter((r) => !r.canva && ups[r.name]?.state !== "done").length;

  return (
    <div className="mt-3 rounded-lg border border-line bg-white/60 p-3">
      <input type="hidden" name="picturesToken" value={token} />
      <p className="text-sm font-medium">🖼️ Your own pictures (optional)</p>
      <p className="mt-1 text-xs text-muted">
        Get a prompt for every picture, make it in any image maker (or use a picture you may use), and upload it here: Canva is then not asked for that one, which saves
        credits. Rows you leave empty are made by Canva, or share a neighbouring picture where marked. Skip this and the video is made fully automatically.
      </p>
      {!rows.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn text-sm" disabled={pending || !csv} onClick={getPrompts}>
            {pending ? "Claude is writing the prompts…" : "✍️ Get picture prompts"}
          </button>
          <span className="text-xs text-muted">Claude writes one per picture (a few cents, about a minute).</span>
          {msg && <span className="text-sm text-bad">{msg}</span>}
        </div>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-2">Picture</th>
                  <th className="py-1 pr-2">Prompt</th>
                  <th className="py-1 pr-2">Without yours</th>
                  <th className="py-1">Yours</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const u = ups[r.name];
                  const sticker = r.name.startsWith("s");
                  return (
                    <tr key={r.name} className="border-t border-line align-top">
                      <td className="w-44 py-2 pr-2 text-xs">{r.label}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-start gap-1.5">
                          <p className="flex-1 whitespace-pre-wrap rounded bg-soft p-1.5 text-xs">{r.prompt}</p>
                          <button type="button" className="btn shrink-0 px-2 py-1 text-xs" onClick={() => void navigator.clipboard?.writeText(r.prompt)} title="Copy the prompt">
                            Copy
                          </button>
                        </div>
                      </td>
                      <td className="w-28 py-2 pr-2 text-xs">{u?.state === "done" ? <span className="text-ok">Canva skipped</span> : r.canva ? "Canva makes it" : <span className="text-muted">shares a picture</span>}</td>
                      <td className="w-52 py-2">
                        {u?.preview && u.state !== "error" ? (
                          <div className="flex items-start gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.preview} alt={`Your picture for ${r.label}`} className={`rounded border border-line object-cover ${sticker ? "h-16 w-16" : vertical ? "h-20 w-12" : "h-12 w-20"}`} />
                            <div className="text-xs">
                              {u.state === "uploading" ? <span className="text-muted">Uploading…</span> : <span className="text-ok">✓ Uploaded</span>}
                              {u.state === "done" && (
                                <button type="button" className="mt-1 block text-accent hover:underline" onClick={() => void send(r.name, null)}>
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp"
                              className="w-full text-xs"
                              aria-label={`Your picture for ${r.label}`}
                              onChange={(e) => void send(r.name, e.target.files?.[0] ?? null)}
                            />
                            {u?.state === "error" && <span className="mt-1 block text-xs text-bad">{u.error}</span>}
                            <span className="mt-0.5 block text-[11px] text-muted">{sticker ? "square-ish, plain background" : vertical ? "tall 9:16" : "wide 16:9"}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            {mine.length} of {rows.length} uploaded · Canva will make {canvaMakes} picture{canvaMakes === 1 ? "" : "s"}
            {shared ? ` · ${shared} will share a neighbouring picture` : ""}. Only use pictures you may use (your own, an AI image maker, or free licences like Wikimedia Commons).
          </p>
          {shared > 0 && (
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="checkbox" name="holdPictures" value="1" checked={hold} onChange={(e) => setHold(e.target.checked)} className="mt-0.5" />
              <span>
                Wait for me after Canva: I&apos;ll add the {shared} shared one{shared === 1 ? "" : "s"} on the video&apos;s page
                <span className="block text-xs text-muted">Off: the video is made as soon as Canva is done.</span>
              </span>
            </label>
          )}
        </>
      )}
    </div>
  );
}
