import { randomBytes } from "node:crypto";
import { COOKIE_SECURE } from "@/core/auth/cookie";
import { requirePermission } from "@/core/auth/guard";
import { STATE_COOKIE, authUrl, redirectUriFor } from "@/modules/chaos/youtube";

/** "Connect YouTube": off to Google's sign-in and permission page. */
export async function GET(req: Request) {
  await requirePermission("settings.manage");
  const q = new URL(req.url).searchParams;
  const channel = q.get("channel") === "edu" ? "edu" : "chaos"; // the Edu videos channel reuses this sign-in flow
  const back = q.get("back") ?? "";
  const home = channel === "edu" ? "/edu/settings" : "/chaos/youtube";
  const returnTo = (channel === "edu" ? /^\/edu(\/[a-z0-9/]*)?$/ : /^\/chaos(\/[a-z0-9/]*)?$/).test(back) ? back : home;
  const redirectUri = redirectUriFor(req.headers);
  const state = randomBytes(24).toString("base64url");
  let url: string;
  try {
    url = authUrl(redirectUri, state);
  } catch {
    return Response.redirect(new URL(`${home}?yt=noclient`, redirectUri), 303);
  }
  const cookie = [
    `${STATE_COOKIE}=${state}.${encodeURIComponent(returnTo)}.${channel}`,
    "Path=/chaos/youtube",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=900",
    ...(COOKIE_SECURE ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
