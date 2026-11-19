import "server-only";
import { db } from "../db";
import { blindIndex } from "../crypto";

// Sliding-window limiter backed by Postgres (works with a single node; swap to Redis when scaling out).
// Keys are HMAC'd so raw emails/IPs are never stored in this table.

type Kind = "email" | "ip" | "setup" | "mfa";

const LIMITS: Record<Kind, { max: number; windowMin: number }> = {
  email: { max: 5, windowMin: 15 },
  ip: { max: 30, windowMin: 15 },
  setup: { max: 5, windowMin: 60 },
  mfa: { max: 5, windowMin: 15 },
};

const keyHash = (kind: Kind, key: string) => blindIndex(`ratelimit:${kind}`, key.toLowerCase());

export async function isRateLimited(kind: Kind, key: string | null): Promise<boolean> {
  if (!key) return false;
  const { max, windowMin } = LIMITS[kind];
  const failures = await db.loginAttempt.count({
    where: { kind, keyHash: keyHash(kind, key), success: false, createdAt: { gt: new Date(Date.now() - windowMin * 60_000) } },
  });
  return failures >= max;
}

export async function recordAttempt(kind: Kind, key: string | null, success: boolean) {
  if (!key) return;
  await db.loginAttempt.create({ data: { kind, keyHash: keyHash(kind, key), success } });
  // Opportunistic cleanup of old rows
  if (Math.random() < 0.02) {
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  }
}
