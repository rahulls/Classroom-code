"use client";

import { useEffect, useRef, useState } from "react";
import { TextField } from "@/components/form";

/**
 * Guardian name / phone: required (red *) when a ticked batch's program needs a guardian (or none is ticked yet).
 */
export function GuardianField({ rules, ...field }: { rules: Record<string, boolean>; name: string; label: string; type?: string; inputMode?: "tel"; maxLength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [required, setRequired] = useState(true);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => {
      const ids = [...form.querySelectorAll<HTMLInputElement>('input[name="batchIds[]"]:checked')].map((i) => i.value).filter((id) => id in rules);
      // Any ticked batch that needs a guardian makes it required; nothing ticked yet → required
      setRequired(ids.length ? ids.some((id) => rules[id]) : true);
    };
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, [rules]);
  return (
    <span ref={ref} className="block">
      <TextField {...field} required={required} />
    </span>
  );
}
