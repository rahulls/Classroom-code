"use client";

import { useMemo, useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { saveScriptAction } from "@/modules/edu/actions";
import type { Draft, Scene, SceneType } from "@/modules/edu/writer";

const TYPES: SceneType[] = ["title", "bullets", "steps", "cycle", "compare", "timeline", "stat", "bars", "diagram", "picture", "keyword", "demo", "quiz", "recap", "outro"];
const ANIMS = ["molecule", "reaction", "states", "balloon", "atom", "ions", "lattice", "mixture", "beaker", "formula", "sticker"] as const;
/** Scene types that show the scene's big animation (list scenes show item icons; with up to 3 items, the animation too). */
const BIG_VISUAL = ["title", "keyword", "stat", "demo", "picture"];

const itemsToText = (s: Scene) =>
  (s.items ?? []).map((i) => [i.label, i.detail ?? "", i.value ?? "", i.icon ?? "", i.icon2 ?? ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
const textToItems = (t: string) =>
  t
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p[0] || p[1])
    .slice(0, 6)
    .map(([label, detail, value, icon, icon2]) => ({ label: label ?? "", ...(detail ? { detail } : {}), ...(value ? { value } : {}), ...(icon ? { icon } : {}), ...(icon2 ? { icon2 } : {}) }));

function visualSummary(s: Scene) {
  const icons = (s.items ?? []).filter((i) => i.icon || i.icon2).length;
  const parts = [];
  if (s.anim) parts.push(`${s.anim}: ${s.anim_subject ?? ""}${s.anim_cue ? ` (on "${s.anim_cue}")` : ""}`);
  if (s.sticker) parts.push(`sticker: ${s.sticker.replace(/_/g, " ")}`);
  if (icons) parts.push(`${icons} item icon${icons === 1 ? "" : "s"}`);
  return parts.join(" · ") || "nothing chosen yet (use “Add 3D visuals”)";
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The script as editable scenes; Save sends it all back as JSON. */
export function ScriptEditor({ id, draft, help, format }: { id: string; draft: Draft; help: Record<SceneType, string>; format: "short" | "long" }) {
  const [d, setD] = useState(draft);
  const [itemsText, setItemsText] = useState(() => draft.scenes.map(itemsToText));
  const total = d.scenes.reduce((n, s) => n + words(s.say), 0);
  const secs = Math.round(total / 2.9 + d.scenes.length * 0.75);
  const tooLong = format === "short" ? secs > 59 : secs > 6.5 * 60;

  const payload = useMemo(
    () =>
      JSON.stringify({
        title: d.title,
        kicker: d.kicker,
        thumbnail_text: d.thumbnail_text,
        youtube_title: d.youtube_title,
        youtube_description: d.youtube_description,
        youtube_tags: d.youtube_tags,
        scenes: d.scenes.map((s, i) => {
          const items = textToItems(itemsText[i] ?? "");
          const out: Scene = { ...s, items: items.length ? items : undefined };
          return out;
        }),
      }),
    [d, itemsText],
  );

  const set = (i: number, patch: Partial<Scene>) => setD((x) => ({ ...x, scenes: x.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.scenes.length) return;
    setD((x) => {
      const sc = [...x.scenes];
      [sc[i], sc[j]] = [sc[j]!, sc[i]!];
      return { ...x, scenes: sc };
    });
    setItemsText((t) => {
      const c = [...t];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
  };
  const remove = (i: number) => {
    setD((x) => ({ ...x, scenes: x.scenes.filter((_, k) => k !== i) }));
    setItemsText((t) => t.filter((_, k) => k !== i));
  };
  const add = (i: number) => {
    setD((x) => {
      const sc = [...x.scenes];
      sc.splice(i + 1, 0, { type: "keyword", say: "", big: "" });
      return { ...x, scenes: sc };
    });
    setItemsText((t) => {
      const c = [...t];
      c.splice(i + 1, 0, "");
      return c;
    });
  };

  return (
    <ActionForm action={saveScriptAction} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="draft" value={payload} />

      <div className="card grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="label">Video name</span>
          <input className="input" value={d.title} maxLength={80} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Top label</span>
          <input className="input" value={d.kicker} maxLength={28} onChange={(e) => setD({ ...d, kicker: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Thumbnail words</span>
          <input className="input" value={d.thumbnail_text} maxLength={50} onChange={(e) => setD({ ...d, thumbnail_text: e.target.value })} />
        </label>
        <div className={`sm:col-span-2 self-end text-sm ${tooLong ? "text-bad" : "text-muted"}`}>
          {d.scenes.length} scenes · {total} words · about {secs >= 60 ? `${Math.floor(secs / 60)} min ${secs % 60} s` : `${secs} s`}
          {tooLong && (format === "short" ? " — too long for a Short (keep it under 60 s)" : " — longer than planned")}
        </div>
      </div>

      <div className="space-y-3">
        {d.scenes.map((s, i) => (
          <div key={i} className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-soft px-2 py-0.5 text-xs font-semibold">Scene {i + 1}</span>
              <select className="input w-auto py-1" value={s.type} onChange={(e) => set(i, { type: e.target.value as SceneType })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">{help[s.type]}</span>
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn px-2 py-0.5" onClick={() => move(i, -1)} title="Move up">
                  ↑
                </button>
                <button type="button" className="btn px-2 py-0.5" onClick={() => move(i, 1)} title="Move down">
                  ↓
                </button>
                <button type="button" className="btn px-2 py-0.5" onClick={() => add(i)} title="Add a scene after this one">
                  +
                </button>
                <button type="button" className="btn-danger px-2 py-0.5" onClick={() => remove(i)} disabled={d.scenes.length <= 2} title="Remove this scene">
                  ✕
                </button>
              </span>
            </div>
            <label className="block">
              <span className="label">
                Narration <span className="font-normal">({words(s.say)} words)</span>
              </span>
              <textarea className="input" rows={2} value={s.say} maxLength={900} onChange={(e) => set(i, { say: e.target.value })} />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="label">Heading</span>
                <input className="input" value={s.heading ?? ""} maxLength={70} onChange={(e) => set(i, { heading: e.target.value || undefined })} />
              </label>
              <label className="block">
                <span className="label">Big text</span>
                <input className="input" value={s.big ?? ""} maxLength={40} onChange={(e) => set(i, { big: e.target.value || undefined })} />
              </label>
            </div>
            <div className="space-y-2 rounded-md border border-line bg-soft/40 p-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                    checked={(s.visual ?? "animation") !== "none"}
                    onChange={(e) => set(i, { visual: e.target.checked ? "animation" : "none" })}
                  />
                  3D visual
                </label>
                {(s.visual ?? "animation") !== "none" && (
                  <span className="flex items-center gap-3 text-sm">
                    {(["animation", "sticker"] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1">
                        <input type="radio" className="accent-[rgb(var(--accent))]" checked={(s.visual ?? "animation") === m} onChange={() => set(i, { visual: m })} />
                        {m === "animation" ? "Animation" : "Sticker (still)"}
                      </label>
                    ))}
                  </span>
                )}
                <span className="text-xs text-muted">{(s.visual ?? "animation") === "none" ? "Text only" : visualSummary(s)}</span>
              </div>
              {(s.visual ?? "animation") !== "none" && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted">Change the visual</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <label className="block">
                      <span className="label">Animation</span>
                      <select className="input" value={s.anim ?? ""} onChange={(e) => set(i, { anim: (e.target.value || undefined) as Scene["anim"] })}>
                        <option value="">none</option>
                        {ANIMS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="label">Shows (formula, equation, state…)</span>
                      <input className="input font-mono text-xs" value={s.anim_subject ?? ""} maxLength={120} placeholder="2H2 + O2 -> 2H2O" onChange={(e) => set(i, { anim_subject: e.target.value || undefined })} />
                    </label>
                    <label className="block">
                      <span className="label">On the word(s)</span>
                      <input className="input" value={s.anim_cue ?? ""} maxLength={80} onChange={(e) => set(i, { anim_cue: e.target.value || undefined })} />
                    </label>
                    <label className="block">
                      <span className="label">Sticker</span>
                      <input className="input" value={s.sticker ?? ""} maxLength={40} placeholder="test_tube" onChange={(e) => set(i, { sticker: e.target.value || undefined })} />
                    </label>
                    <p className="text-xs text-muted sm:col-span-3 sm:self-end">
                      {BIG_VISUAL.includes(s.type)
                        ? "This scene shows the animation large."
                        : ["bullets", "steps", "recap"].includes(s.type)
                          ? "Shown above the list when it has up to 3 items; each item also gets its icon."
                          : "This scene shows each item's icon (set them in the items: 4th column, compare's right side in the 5th)."}
                    </p>
                  </div>
                </details>
              )}
            </div>
            {!["title", "keyword", "picture", "outro", "demo"].includes(s.type) && (
              <label className="block">
                <span className="label">Items, one per line: label | detail | value | icon | right icon</span>
                <textarea className="input font-mono text-xs" rows={Math.max(2, (itemsText[i] ?? "").split("\n").length)} value={itemsText[i] ?? ""} onChange={(e) => setItemsText((t) => t.map((x, k) => (k === i ? e.target.value : x)))} />
              </label>
            )}
            {s.type === "compare" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Left column title</span>
                  <input className="input" value={s.left_title ?? ""} maxLength={24} onChange={(e) => set(i, { left_title: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Right column title</span>
                  <input className="input" value={s.right_title ?? ""} maxLength={24} onChange={(e) => set(i, { right_title: e.target.value })} />
                </label>
              </div>
            )}
            {s.type === "bars" && (
              <label className="block max-w-xs">
                <span className="label">Unit</span>
                <input className="input" value={s.unit ?? ""} maxLength={12} onChange={(e) => set(i, { unit: e.target.value })} />
              </label>
            )}
            {s.type === "quiz" && (
              <label className="block max-w-xs">
                <span className="label">Right answer</span>
                <select className="input" value={s.answer ?? 0} onChange={(e) => set(i, { answer: Number(e.target.value) })}>
                  {textToItems(itemsText[i] ?? "").map((it, k) => (
                    <option key={k} value={k}>
                      {"ABCD"[k]}) {it.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {s.type === "picture" && (
              <label className="block">
                <span className="label">Picture for Canva</span>
                <textarea className="input" rows={2} value={s.picture_prompt ?? ""} maxLength={400} onChange={(e) => set(i, { picture_prompt: e.target.value })} />
              </label>
            )}
            {format === "long" && (
              <label className="block max-w-sm">
                <span className="label">Starts a chapter called</span>
                <input className="input" value={s.chapter ?? ""} maxLength={50} onChange={(e) => set(i, { chapter: e.target.value || undefined })} />
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold">YouTube</h3>
        <label className="block">
          <span className="label">
            Title <span className="font-normal">({d.youtube_title.length}/100)</span>
          </span>
          <input className="input" value={d.youtube_title} maxLength={100} onChange={(e) => setD({ ...d, youtube_title: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Description</span>
          <textarea className="input" rows={8} value={d.youtube_description} maxLength={4500} onChange={(e) => setD({ ...d, youtube_description: e.target.value })} />
          <span className="mt-1 block text-xs text-muted">{format === "long" ? "Chapters are added automatically from the scenes." : "#shorts is added automatically."}</span>
        </label>
        <label className="block">
          <span className="label">Tags, separated by commas</span>
          <input
            className="input"
            value={d.youtube_tags.join(", ")}
            onChange={(e) =>
              setD({
                ...d,
                youtube_tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t, k, a) => t || k === a.length - 1),
              })
            }
          />
        </label>
      </div>

      <div className="sticky bottom-2 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel p-3 shadow">
        <SubmitButton>Save changes</SubmitButton>
        <span className="text-xs text-muted">Save before approving.</span>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
