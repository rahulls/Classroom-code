import "server-only";
import { notFound, redirect } from "next/navigation";
import { can, type Permission } from "../rbac";
import { getSession, type CurrentUser } from "./session";

/** For pages and actions: a fully authenticated (2FA-complete) user, or redirect to login. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session || session.mfaPending) redirect("/login");
  return session.user;
}

/** Page guard: hide pages the user may not access (404 rather than revealing they exist). */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) notFound();
  return user;
}
