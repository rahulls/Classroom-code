import { randomBytes } from "node:crypto";
import { COOKIE_SECURE } from "@/core/auth/cookie";
import { requirePermission } from "@/core/auth/guard";
import { STATE_COOKIE, authUrl, redirectUriFor } from "@/modules/chaos/youtube";

/** "Connect YouTube": off to Google's sign-in and permission page. */
export async function GET(req: Request) {
  await requirePermission("settings.manage");
  const back = new URL(req.url).searchParams.get("back") ?? "";
  const returnTo = /^\/chaos(\/[a-z0-9/]*)?$/.test(back) ? back : "/chaos/youtube";
  const redirectUri = redirectUriFor(req.headers);
  const state = randomBytes(24).toString("base64url");
  let url: string;
  try {
    url = authUrl(redirectUri, state);
  } catch {
    return Response.redirect(new URL("/chaos/youtube?yt=noclient", redirectUri), 303);
  }
  const cookie = [
    `${STATE_COOKIE}=${state}.${encodeURIComponent(returnTo)}`,
    "Path=/chaos/youtube",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=900",
    ...(COOKIE_SECURE ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
