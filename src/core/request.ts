import "server-only";
import { headers } from "next/headers";

/**
 * Client IP + user agent for audit logs and rate limiting.
 * Uses the right-most X-Forwarded-For entry (added by the closest proxy / Next server);
 * left-most entries are client-controlled and therefore ignored.
 */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const ip = xff ? (xff.split(",").pop()?.trim() ?? null) : h.get("x-real-ip");
  const ua = h.get("user-agent");
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: ua ? ua.slice(0, 300) : null };
}
