import "server-only";
import { cookies } from "next/headers";
import type { CurrentUser } from "./auth/session";
import { can } from "./rbac";

// Edit mode is a UI switch that reveals edit controls for every record. It is NOT the
// security boundary: every edit-all handler independently requires `data.edit_all`.
export const EDIT_MODE_COOKIE = "rsc_edit";

export async function isEditMode(user: CurrentUser): Promise<boolean> {
  if (!can(user, "data.edit_all")) return false;
  return (await cookies()).get(EDIT_MODE_COOKIE)?.value === "1";
}
