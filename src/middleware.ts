import { NextResponse, type NextRequest } from "next/server";
import { IS_LOOPBACK, SESSION_COOKIE } from "./core/auth/cookie";

// Runs on every page request:
//  • builds a strict, per-request nonce-based Content-Security-Policy
//  • sends visitors without a session cookie to /login (real validation happens server-side)
// Note: middleware is a convenience gate, NOT the security boundary. Every page and
// server action independently calls requireUser() / defineAction().

const PUBLIC_PATHS = ["/login", "/setup"];

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(dev || IS_LOOPBACK ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!isPublic && !req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", path);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
