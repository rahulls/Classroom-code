import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireUser } from "./auth/guard";
import type { CurrentUser } from "./auth/session";
import { can, type Permission } from "./rbac";

// Every server action goes through defineAction, which guarantees:
//  1. the caller is authenticated (unless explicitly public) and holds the permission,
//  2. input is FormData and passes a strict zod schema (unknown keys are dropped),
//  3. internal errors never leak to the browser.
// Next.js additionally rejects cross-origin server-action calls (Origin vs Host check).

export type ActionState =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}

function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (typeof value !== "string") {
      // A chosen file (schemas that don't ask for it drop it); an empty file input sends a 0-byte file
      if (value.size > 0) out[key] = value;
      continue;
    }
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      ((out[k] ??= []) as string[]).push(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

type Ctx<P extends boolean> = { user: P extends true ? CurrentUser | null : CurrentUser };

export function defineAction<S extends z.ZodType, P extends boolean = false>(opts: {
  schema: S;
  permission?: Permission;
  public?: P;
  run: (input: z.output<S>, ctx: Ctx<P>) => Promise<ActionState | void>;
}) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      if (!(formData instanceof FormData)) return { ok: false, error: "Invalid request." };
      let user: CurrentUser | null = null;
      if (!opts.public) {
        user = await requireUser();
        if (opts.permission && !can(user, opts.permission)) return { ok: false, error: "You don't have permission to do that." };
      }
      const parsed = opts.schema.safeParse(formToObject(formData));
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const k = issue.path.join(".") || "_";
          fieldErrors[k] ??= issue.message;
        }
        return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
      }
      return (await opts.run(parsed.data, { user } as Ctx<P>)) ?? { ok: true };
    } catch (err) {
      unstable_rethrow(err); // let redirect()/notFound() through
      if (err instanceof UserError) return { ok: false, error: err.message };
      console.error("[action]", err);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
