import "server-only";
import type { CurrentUser } from "./auth/session";
import { env } from "./env";

// Permission keys are registered here per module. Owner implicitly has all of them.
// Row-level scope (batches / classrooms / mentees) is enforced in each module's service
// once mentor logins arrive; for now only the Owner can sign in.

export const PERMISSIONS = {
  "academics.view": "View programs, courses, batches and subjects",
  "academics.manage": "Create and edit programs, courses, batches and subjects",
  "students.view": "View student profiles",
  "students.view_contact": "See phone numbers and emails",
  "students.manage": "Create and edit students, guardians and enrolments",
  "settings.manage": "Change configuration (fields, program types…)",
  "audit.view": "View the audit log",
  "messages.view": "See the log of emails / WhatsApp messages sent to students and parents",
  "messages.send": "Send homework and notices to students and parents (bulk)",
  "reports.approve_send": "Approve and send progress reports (Owner only)",
  "data.edit_all": "Edit mode: modify every record (Owner + FULL_EDIT_EMAILS only)",
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Permissions that can never be granted to a non-owner role. */
export const OWNER_ONLY: Permission[] = ["reports.approve_send", "settings.manage", "audit.view", "messages.view", "messages.send", "data.edit_all"];

export function can(user: CurrentUser, permission: Permission): boolean {
  // Edit-all is granted only by the server's env allowlist, never by DB roles.
  if (permission === "data.edit_all") return user.isOwner && env.FULL_EDIT_EMAILS.includes(user.email.toLowerCase());
  if (user.isOwner) return true;
  if (OWNER_ONLY.includes(permission)) return false;
  return user.roles.some((r) => r.role.permissions.includes(permission));
}
