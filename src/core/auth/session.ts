import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "../db";
import { env } from "../env";
import { randomToken, sha256 } from "../crypto";
import { requestMeta } from "../request";
import { COOKIE_SECURE, SESSION_COOKIE } from "./cookie";

// Opaque random session tokens; only their SHA-256 is stored, so a DB leak doesn't leak sessions.
// Sessions have an absolute lifetime and an idle timeout, and are invalidated by a password change.

const MFA_PENDING_MINUTES = 10;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export async function createSession(userId: string, opts: { mfaPending: boolean }) {
  const token = randomToken(32);
  const { ip, userAgent } = await requestMeta();
  const expiresAt = opts.mfaPending
    ? new Date(Date.now() + MFA_PENDING_MINUTES * 60_000)
    : new Date(Date.now() + env.SESSION_ABSOLUTE_DAYS * 86_400_000);
  await db.session.create({ data: { tokenHash: sha256(token), userId, mfaPending: opts.mfaPending, expiresAt, ip, userAgent } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", path: "/", expires: expiresAt });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

const userInclude = { roles: { include: { role: true } } } as const;

export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;

  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: userInclude } } });
  if (!session) return null;

  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + env.SESSION_IDLE_HOURS * 3_600_000;
  const invalid =
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= now ||
    (!session.mfaPending && idleLimit <= now) ||
    session.user.status !== "ACTIVE" ||
    session.createdAt < session.user.passwordChangedAt;
  if (invalid) return null;

  if (!session.mfaPending && now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }
  return session;
});

export type SessionWithUser = NonNullable<Awaited<ReturnType<typeof getSession>>>;
export type CurrentUser = SessionWithUser["user"];

export async function revokeSession(id: string) {
  await db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
