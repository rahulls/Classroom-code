import { requirePermission } from "@/core/auth/guard";
import { UserError } from "@/core/action";
import { canvaRedirectUri, startCanvaConnect } from "@/modules/chaos/canva";

const BACK_COOKIE = "chaos_canva_back";

/** "Connect Canva": off to Canva's sign-in page (the studio registers itself with Canva the first time). */
export async function GET(req: Request) {
  await requirePermission("settings.manage");
  const back = new URL(req.url).searchParams.get("back") ?? "";
  const returnTo = /^\/chaos(\/[a-z0-9/]*)?$/.test(back) ? back : "/chaos/canva";
  const redirectUri = canvaRedirectUri(req.headers);
  let url: string;
  try {
    url = (await startCanvaConnect(redirectUri)) || new URL(`${returnTo}?canva=connected`, redirectUri).toString();
  } catch (e) {
    console.error("[chaos canva connect]", e);
    const msg = e instanceof UserError ? e.message : "Couldn't reach Canva. Check the internet connection and try again.";
    return Response.redirect(new URL(`/chaos/canva?canva=error&msg=${encodeURIComponent(msg)}`, redirectUri), 303);
  }
  const cookie = `${BACK_COOKIE}=${encodeURIComponent(returnTo)}; Path=/chaos/canva; HttpOnly; SameSite=Lax; Max-Age=900`;
  return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
