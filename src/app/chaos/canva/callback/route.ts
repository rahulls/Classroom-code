import { audit } from "@/core/audit";
import { requirePermission } from "@/core/auth/guard";
import { UserError } from "@/core/action";
import { canvaRedirectUri, finishCanvaConnect } from "@/modules/chaos/canva";

/** Canva sends Rahul back here after he allows (or refuses) the studio. */
export async function GET(req: Request) {
  const user = await requirePermission("settings.manage");
  const url = new URL(req.url);
  const redirectUri = canvaRedirectUri(req.headers);
  const raw = /(?:^|;\s*)chaos_canva_back=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  const back = /^\/chaos(\/[a-z0-9/]*)?$/.test(decodeURIComponent(raw)) ? decodeURIComponent(raw) : "/chaos/canva";
  const go = (path: string, params: Record<string, string>) => {
    const to = new URL(path, redirectUri);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    return new Response(null, {
      status: 303,
      headers: { Location: to.toString(), "Set-Cookie": "chaos_canva_back=; Path=/chaos/canva; HttpOnly; SameSite=Lax; Max-Age=0", "Cache-Control": "no-store" },
    });
  };
  const err = url.searchParams.get("error");
  if (err) return go("/chaos/canva", { canva: "error", msg: err === "access_denied" ? "You didn't allow access, so nothing was connected." : `Canva said: ${err}` });
  const code = url.searchParams.get("code");
  if (!code) return go("/chaos/canva", { canva: "error", msg: "Canva didn't send a sign-in code." });
  try {
    await finishCanvaConnect(redirectUri, code, url.searchParams.get("state") ?? "");
    await audit({ action: "chaos.canva.connected", actor: user, entity: "chaos_canva", entityId: "account" });
    return go(back, { canva: "connected" });
  } catch (e) {
    console.error("[chaos canva callback]", e);
    return go("/chaos/canva", { canva: "error", msg: e instanceof UserError ? e.message : "Couldn't finish connecting. Try again." });
  }
}
