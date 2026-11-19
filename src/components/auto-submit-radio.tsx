"use client";

import type { InputHTMLAttributes } from "react";

/** A radio that re-submits its (GET) form as soon as it is picked, so the page updates without an extra button press. */
export function AutoSubmitRadio(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange">) {
  return <input {...props} type="radio" onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
