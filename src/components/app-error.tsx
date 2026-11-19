"use client";

import { useEffect } from "react";

// A tab opened before the app was updated asks for code that no longer exists.
// Reload once (at most every 30 s) to pick up the new version instead of showing an error.
const STALE = /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Failed to find Server Action|older or newer deployment/i;
const KEY = "rsc:auto-reload";

export function isStaleVersion(error: Error) {
  return STALE.test(`${error?.name ?? ""} ${error?.message ?? ""}`);
}

export function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleVersion(error);
  useEffect(() => {
    if (!stale) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) ?? 0);
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {}
    if (Date.now() - last > 30_000) window.location.reload();
  }, [stale]);

  return (
    <div className="mx-auto max-w-lg p-6 text-sm">
      <h2 className="mb-2 text-base font-semibold">{stale ? "The app was updated" : "Something went wrong"}</h2>
      <p className="mb-4 text-muted">
        {stale ? "Reloading to the new version… Anything you saved is kept." : "This page hit an error. Your saved data is safe. Try again, or reload the page."}
        {!stale && error?.message && <span className="mt-2 block break-words font-mono text-xs">{error.message}</span>}
        {error?.digest && <span className="block text-xs">Ref: {error.digest}</span>}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload page
        </button>
        {!stale && (
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
