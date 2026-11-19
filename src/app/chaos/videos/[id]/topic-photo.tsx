"use client";

import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { topicPhotoAction } from "@/modules/chaos/actions";

/** Put a photo of the quiz's subject (e.g. MS Dhoni) on the thumbnail: upload one or reuse one. */
export function TopicPhoto({ id, current, images }: { id: string; current: { name: string; credit: string | null } | null; images: { name: string; credit: string | null }[] }) {
  const [mode, setMode] = useState<"upload" | "existing">(images.length ? "existing" : "upload");
  const [existing, setExisting] = useState(current?.name ?? images[0]?.name ?? "");
  const credit = images.find((i) => i.name === existing)?.credit ?? "";

  return (
    <details className="rounded-lg border border-line p-3" open={!current}>
      <summary className="cursor-pointer text-sm font-semibold text-[#2a1260]">
        Topic photo {current ? <span className="font-normal text-muted">· {current.name}</span> : <span className="font-normal text-muted">· none</span>}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted">
          A photo of the quiz&apos;s subject (a person, place or animal) makes the thumbnail stand out. Only use photos you may use: Wikimedia Commons (CC0, CC BY,
          CC BY-SA) or your own. Never Google Images. The credit goes into the YouTube description automatically.
        </p>
        <div className="flex gap-4 text-sm">
          {images.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> One I added before
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "upload"} onChange={() => setMode("upload")} /> Upload a new photo
          </label>
        </div>
        <ActionForm action={topicPhotoAction} className="space-y-3">
          <FormMessage />
          <input type="hidden" name="id" value={id} />
          {mode === "existing" ? (
            <>
              <label className="block">
                <span className="label">Photo</span>
                <select name="existing" value={existing} onChange={(e) => setExisting(e.target.value)} className="input">
                  {images.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Credit</span>
                <input key={existing} name="credit" defaultValue={credit} className="input text-xs" placeholder="e.g. Photo: “Name” by Author, CC BY-SA 4.0, via Wikimedia Commons" />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <span className="label">
                  Photo<span className="text-bad"> *</span>
                </span>
                <input type="file" name="file" accept=".jpg,.jpeg,.png,.webp" required className="input" />
                <span className="mt-1 block text-xs text-muted">JPG, PNG or WebP, under 8 MB. A PNG with a transparent background is shown as a cut-out.</span>
              </label>
              <label className="block">
                <span className="label">Credit</span>
                <input name="credit" className="input text-xs" placeholder="e.g. Photo: “Name” by Author, CC BY-SA 4.0, via Wikimedia Commons" />
                <span className="mt-1 block text-xs text-muted">Needed for Creative Commons photos. Leave empty for your own photos.</span>
              </label>
            </>
          )}
          <SubmitButton>🖼 Put it on the thumbnail</SubmitButton>
        </ActionForm>
        {current && (
          <ActionForm action={topicPhotoAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="remove" value="1" />
            <SubmitButton variant="default" className="text-xs">
              Take the photo off
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </details>
  );
}
