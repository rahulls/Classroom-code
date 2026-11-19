import { timingSafeEqual } from "node:crypto";
import { audit } from "@/core/audit";
import { COOKIE_SECURE } from "@/core/auth/cookie";
import { requirePermission } from "@/core/auth/guard";
import { UserError } from "@/core/action";
import { STATE_COOKIE, finishConnect, redirectUriFor } from "@/modules/chaos/youtube";

/** Google sends Rahul back here after he allows (or refuses) uploads. */
export async function GET(req: Request) {
  const user = await requirePermission("settings.manage");
  const url = new URL(req.url);
  const redirectUri = redirectUriFor(req.headers);
  const raw = /(?:^|;\s*)chaos_yt_state=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  const [expected = "", backEnc = ""] = raw.split(".");
  const back = decodeURIComponent(backEnc || "%2Fchaos%2Fyoutube");
  const clear = `${STATE_COOKIE}=; Path=/chaos/youtube; HttpOnly; SameSite=Lax; Max-Age=0${COOKIE_SECURE ? "; Secure" : ""}`;
  const go = (path: string, params: Record<string, string>) => {
    const to = new URL(path, redirectUri);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    return new Response(null, { status: 303, headers: { Location: to.toString(), "Set-Cookie": clear, "Cache-Control": "no-store" } });
  };

  const state = url.searchParams.get("state") ?? "";
  const ok = expected.length > 0 && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!ok) return go("/chaos/youtube", { yt: "error", msg: "The sign-in took too long or came from somewhere else. Click Connect YouTube again." });
  const err = url.searchParams.get("error");
  if (err) return go("/chaos/youtube", { yt: "error", msg: err === "access_denied" ? "You didn't allow access, so nothing was connected." : `Google said: ${err}` });
  const code = url.searchParams.get("code");
  if (!code) return go("/chaos/youtube", { yt: "error", msg: "Google didn't send a sign-in code." });
  try {
    const channel = await finishConnect(code, redirectUri);
    await audit({ action: "chaos.youtube.connected", actor: user, entity: "chaos_youtube", entityId: "channel", after: { channel } });
    return go(back, { yt: "connected" });
  } catch (e) {
    console.error("[chaos youtube connect]", e);
    return go("/chaos/youtube", { yt: "error", msg: e instanceof UserError ? e.message : "Couldn't finish connecting. Try again." });
  }
}
