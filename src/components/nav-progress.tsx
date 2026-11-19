"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Top progress bar while moving between pages: from the click on an internal link (or a
// search/filter form submit) until the new URL has rendered.
// (A route-level loading.tsx would also do this, but in Next 15.5 it can stall
// server-action replies on pages with several forms, so it's deliberately not used.)
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, setPending] = useState(false);

  // New URL rendered → done
  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    const here = () => window.location.pathname + window.location.search;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname + url.search === here()) return;
      setPending(true);
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!e.defaultPrevented && form.method.toLowerCase() === "get") setPending(true);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  // Safety net: never leave the bar running if a navigation is cancelled
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), 15000);
    return () => clearTimeout(t);
  }, [pending]);

  return pending ? <span className="progress-bar" role="progressbar" aria-label="Loading page" /> : null;
}
