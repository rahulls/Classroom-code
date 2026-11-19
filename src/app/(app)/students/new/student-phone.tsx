"use client";

import { useState } from "react";
import { TextField } from "@/components/form";

/** Student's phone, or "same as parent's phone": the server then copies the parent's number. */
export function StudentPhoneField() {
  const [same, setSame] = useState(false);
  return (
    <div className="space-y-1">
      {same ? (
        <label className="block">
          <span className="label">Phone</span>
          <input className="input" disabled value="" placeholder="Uses the parent's phone (below)" readOnly />
        </label>
      ) : (
        <TextField name="studentPhone" label="Phone" type="tel" inputMode="tel" maxLength={25} placeholder="98xxxxxxxx" />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="studentPhoneSameAsParent" checked={same} onChange={(e) => setSame(e.target.checked)} className="accent-[rgb(var(--accent))]" />
        Same as parent&apos;s phone
      </label>
    </div>
  );
}
