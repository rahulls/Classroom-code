import "server-only";
import { z } from "zod";
import { currentTeacher, type Teacher } from "./auth";
import { examPrepEnabled } from "./config";
import { EpError } from "./errors";
import { SettingError } from "./settings";

export { EpError };

// Exam Prep's own server-action wrapper: feature flag, teacher sign-in, validation, safe errors.
// (The classroom's defineAction is not used: it checks classroom users.)

export type EpResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string> } | undefined;


function formToObject(fd: FormData) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v !== "string") {
      if (v.size > 0) {
        const key = k.endsWith("[]") ? k.slice(0, -2) : k;
        if (k.endsWith("[]")) ((out[key] ??= []) as unknown[]).push(v);
        else out[key] = v;
      }
      continue;
    }
    if (k.endsWith("[]")) ((out[k.slice(0, -2)] ??= []) as string[]).push(v);
    else out[k] = v;
  }
  return out;
}

export function epAction<S extends z.ZodType>(schema: S, run: (input: z.infer<S>, ctx: { teacher: Teacher }) => Promise<EpResult>, opts: { public?: boolean } = {}) {
  return async (_prev: EpResult, fd: FormData): Promise<EpResult> => {
    if (!examPrepEnabled()) return { ok: false, error: "Exam Prep is switched off." };
    const teacher = await currentTeacher();
    if (!teacher && !opts.public) return { ok: false, error: "Please sign in again." };
    const parsed = schema.safeParse(formToObject(fd));
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
      return { ok: false, error: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors };
    }
    try {
      return await run(parsed.data, { teacher: teacher ?? { id: "", username: "", twoStep: false } });
    } catch (e) {
      if (e instanceof EpError || e instanceof SettingError) return { ok: false, error: e.message };
      // Redirects and not-found are control flow, not errors
      if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
      console.error("[exam-prep] action failed:", e instanceof Error ? e.name + ": " + e.message.replace(/\+?\d[\d\s-]{8,}/g, "[number]") : "error");
      return { ok: false, error: "Something went wrong. Nothing was changed." };
    }
  };
}
