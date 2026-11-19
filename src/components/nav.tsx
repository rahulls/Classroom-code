"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; icon: string; soon?: boolean }[] = [
  { href: "/today", label: "Today", icon: "◉" },
  { href: "/academics", label: "Academics", icon: "▣" },
  { href: "/students", label: "Students", icon: "👤" },
  { href: "/classrooms", label: "Classrooms", icon: "🏫", soon: true },
  { href: "/attendance", label: "Attendance", icon: "✓", soon: true },
  { href: "/calendar", label: "Calendar", icon: "📅" },
  { href: "/assessments", label: "Assessments", icon: "📝", soon: true },
  { href: "/fees", label: "Fees", icon: "₹", soon: true },
  { href: "/enquiries", label: "Enquiries", icon: "📞", soon: true },
  { href: "/messages", label: "Messages", icon: "✉" },
  { href: "/messages/broadcast", label: "Broadcast", icon: "📣" },
  { href: "/reports/classes", label: "Class report", icon: "📊" },
  { href: "/reports/progress", label: "Progress reports", icon: "📄", soon: true },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

/** Spinner next to a link from the moment it's clicked until the page arrives. */
function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="spinner ml-auto" aria-label="Loading" /> : null;
}

/** The longest matching item wins, so /messages/broadcast lights up Broadcast, not Messages too. */
const isActive = (path: string, href: string) =>
  (path === href || path.startsWith(`${href}/`)) && !ITEMS.some((o) => o.href.length > href.length && o.href.startsWith(`${href}/`) && (path === o.href || path.startsWith(`${o.href}/`)));

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
      {ITEMS.map((i) =>
        i.soon ? (
          <span key={i.href} className="flex shrink-0 cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted/60" title="Coming in a later phase">
            <span className="w-4 text-center">{i.icon}</span>
            {i.label}
          </span>
        ) : (
          <Link
            key={i.href}
            href={i.href}
            className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive(path, i.href) ? "bg-accent text-white" : "hover:bg-soft"}`}
          >
            <span className="w-4 text-center">{i.icon}</span>
            {i.label}
            <LinkPending />
          </Link>
        ),
      )}
    </nav>
  );
}
