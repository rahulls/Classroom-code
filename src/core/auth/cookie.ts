// Edge-safe (no Node imports): shared by middleware and server code.

/** True when the app is served only on this computer (http://localhost / 127.0.0.1). */
export const IS_LOOPBACK = (() => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.APP_URL ?? "").hostname);
  } catch {
    return false;
  }
})();

// Production on a real domain always uses Secure cookies. A local production build on
// http://localhost can't (no HTTPS), so it follows COOKIE_SECURE instead.
export const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && !IS_LOOPBACK);

// The __Host- prefix forces Secure, Path=/ and no Domain, so subdomains can't plant or read the cookie.
export const SESSION_COOKIE = COOKIE_SECURE ? "__Host-rsc_sid" : "rsc_sid";
