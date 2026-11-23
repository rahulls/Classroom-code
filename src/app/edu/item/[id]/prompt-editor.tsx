"use client";

import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { regenerateScriptAction } from "@/modules/edu/actions";

/**
 * The whole prompt behind a script (instructions + topic message), editable, with "Regenerate".
 * Starts from the prompt the current script was written with.
 */
export function PromptEditor({
  id,
  instructions,
  message,
  defaultInstructions,
  builtInInstructions,
  freshMessage,
  customDefault,
  usedEdited,
}: {
  id: string;
  instructions: string;
  message: string;
  defaultInstructions: string;
  builtInInstructions: string;
  freshMessage: string;
  customDefault: boolean;
  usedEdited: boolean;
}) {
  const [ins, setIns] = useState(instructions);
  const [msg, setMsg] = useState(message);
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  return (
    <ActionForm action={regenerateScriptAction} confirm="Replace the current script with a new one written from this prompt? Your edits to the current script will be lost." className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-muted">
        This is exactly what Claude gets. {usedEdited ? "The current script was written from an edited prompt (shown below)." : "Shown below is the prompt the current script was written with."} Claude still has to answer in the same scene format, so the
        review page and the video engine keep working whatever you write.
      </p>

      <label className="block">
        <span className="label flex flex-wrap items-center gap-2">
          <span>
            Instructions (the same for every video)<span className="text-bad"> *</span>
          </span>
          <span className="text-xs font-normal text-muted">{words(ins)} words</span>
        </span>
        <textarea name="instructions" value={ins} onChange={(e) => setIns(e.target.value)} rows={22} className="input font-mono text-xs leading-relaxed" spellCheck={false} required />
        <span className="mt-1 block text-xs text-muted">{"{{CHANNEL}}"} is replaced by the channel's name.</span>
      </label>
      <div className="flex flex-wrap gap-2 text-xs">
        {ins !== defaultInstructions && (
          <button type="button" className="btn text-xs" onClick={() => setIns(defaultInstructions)}>
            Use the default instructions{customDefault ? " (your saved version)" : ""}
          </button>
        )}
        {customDefault && ins !== builtInInstructions && (
          <button type="button" className="btn text-xs" onClick={() => setIns(builtInInstructions)}>
            Use the built-in instructions
          </button>
        )}
      </div>

      <label className="block">
        <span className="label flex flex-wrap items-center gap-2">
          <span>
            Topic message (this video)<span className="text-bad"> *</span>
          </span>
          <span className="text-xs font-normal text-muted">{words(msg)} words</span>
        </span>
        <textarea name="message" value={msg} onChange={(e) => setMsg(e.target.value)} rows={10} className="input font-mono text-xs leading-relaxed" spellCheck={false} required />
        <span className="mt-1 block text-xs text-muted">Topic, length, audience, your notes, must-include facts and the earlier videos not to repeat.</span>
      </label>
      {msg !== freshMessage && (
        <button type="button" className="btn text-xs" onClick={() => setMsg(freshMessage)}>
          Rebuild the topic message from the topic row
        </button>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="saveDefault" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" />
        <span>
          Also use these instructions for every new script
          <span className="block text-xs text-muted">Saved as the default (reset any time in Settings). The topic message is always built per topic.</span>
        </span>
      </label>

      <div className="space-y-2">
        <SubmitButton>↻ Regenerate with this prompt (about a minute)</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
