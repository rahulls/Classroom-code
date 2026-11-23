"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { makeVideoNowAction, uploadYourPictureAction } from "@/modules/chaos/actions";

type Slot = { name: string; label: string; prompt: string; vertical: boolean; uploaded: boolean; hasPicture: boolean };

/**
 * The facts / questions without their own Canva picture: each with a prompt to make or find a
 * picture elsewhere, and an upload. Until then they share a neighbouring picture (or the intro art).
 */
export function YourPictures({ id, slots, waiting, kind }: { id: string; slots: Slot[]; waiting: boolean; kind: "facts" | "quiz" }) {
  const router = useRouter();
  const open = slots.filter((s) => !s.uploaded).length;
  const [stamp, setStamp] = useState(0); // new preview after an upload
  return (
    <section className={`card mt-6 max-w-4xl space-y-4 ${waiting ? "border-warn" : ""}`}>
      <div>
        <h2 className="font-semibold text-[#2a1260]">Your pictures</h2>
        <p className="text-sm text-muted">
          To save Canva credits, {slots.length} {kind === "facts" ? "fact backgrounds" : "questions"} don&apos;t get their own Canva picture. Each one below has a prompt: use it
          in another image maker (or find a picture you may use), and upload the result in front of it. Until then,{" "}
          {kind === "facts" ? "these facts share a neighbouring fact's background" : "these questions show the intro artwork"}.
        </p>
        {waiting ? (
          <p className="mt-2 text-sm font-medium text-warn">
            Canva is done. The video waits for you: {open} picture{open === 1 ? "" : "s"} still to add. It starts by itself once the last one is uploaded.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted">You can upload now, while Canva works. When Canva is done, the video waits here for any still missing.</p>
        )}
      </div>

      <ol className="space-y-4">
        {slots.map((s) => (
          <li key={s.name} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[120px_1fr]">
            <div>
              {s.hasPicture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/chaos/videos/${id}/picture?name=${s.name}&v=${stamp}`}
                  alt={`Current picture for ${s.label}`}
                  className={`w-full rounded border border-line object-cover ${s.vertical ? "aspect-[9/16]" : "aspect-video"}`}
                />
              ) : (
                <div className={`flex w-full items-center justify-center rounded border border-dashed border-line text-xs text-muted ${s.vertical ? "aspect-[9/16]" : "aspect-video"}`}>
                  not yet
                </div>
              )}
              <p className={`mt-1 text-center text-xs ${s.uploaded ? "text-ok" : "text-muted"}`}>{s.uploaded ? "✓ yours" : s.hasPicture ? "shared for now" : ""}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{s.label}</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 whitespace-pre-wrap rounded bg-soft p-2 text-xs">{s.prompt}</pre>
                <button type="button" className="btn shrink-0 text-xs" onClick={() => void navigator.clipboard?.writeText(s.prompt)}>
                  Copy
                </button>
              </div>
              <p className="text-xs text-muted">
                Shape: {s.vertical ? "tall 9:16 (1080×1920)" : "wide 16:9 (1920×1080)"}. Other shapes are cropped to fit. Only pictures you may use: your own, an AI image maker, or free
                licences (e.g. Wikimedia Commons CC0 / CC BY).
              </p>
              <ActionForm
                action={uploadYourPictureAction}
                className="flex flex-wrap items-center gap-2"
                resetOnSuccess
                onSuccess={() => {
                  setStamp(Date.now());
                  router.refresh();
                }}
              >
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="name" value={s.name} />
                <input type="file" name="file" accept=".jpg,.jpeg,.png,.webp" required className="input max-w-xs text-xs" aria-label={`Picture for ${s.label}`} />
                <SubmitButton variant={s.uploaded ? "default" : "primary"}>{s.uploaded ? "Replace" : "Upload"}</SubmitButton>
                <FormMessage />
              </ActionForm>
            </div>
          </li>
        ))}
      </ol>

      {waiting && (
        <ActionForm action={makeVideoNowAction} onSuccess={() => router.refresh()} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <input type="hidden" name="id" value={id} />
          <SubmitButton>Make the video now</SubmitButton>
          <span className="text-xs text-muted">The {open} still missing keep the shared picture.</span>
          <FormMessage />
        </ActionForm>
      )}
    </section>
  );
}
