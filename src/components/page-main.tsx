"use client";

import { usePathname } from "next/navigation";

// Calendar and batch pages (timetable, attendance grid) use the full screen width; everything else stays at a readable width.
const WIDE = ["/calendar", "/academics/timetable"];
const BATCH_PAGE = /^\/academics\/[0-9a-f-]{36}$/i;

export function PageMain({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const wide = BATCH_PAGE.test(path) || WIDE.some((p) => path === p || path.startsWith(`${p}/`));
  return <main className={`mx-auto p-4 md:p-6 ${wide ? "max-w-none" : "max-w-6xl"}`}>{children}</main>;
}
