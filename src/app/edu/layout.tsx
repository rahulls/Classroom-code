import Link from "next/link";
import { logoFile } from "@/modules/edu/brand";
import { requirePermission } from "@/core/auth/guard";

export const metadata = { title: { default: "Edu videos", template: "%s · Edu videos" } };

/** Edu videos: scheduled animated explainer videos for the Edu channel (owner only). */
export default async function EduLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("settings.manage");
  return (
    <div className="min-h-screen bg-[#f2f7ff] dark:bg-bg">
      <header className="bg-gradient-to-r from-[#0b1026] via-[#13306b] to-[#0e5a8a] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/edu" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoFile() ? <img src="/edu/logo" alt="" width={44} height={44} className="h-11 w-11 rounded-full bg-white/10 object-contain" /> : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-xl">🎓</span>}
            <span>
              <span className="block text-lg font-bold leading-tight">Edu videos</span>
              <span className="block text-xs text-white/70">Animated explainers, on a schedule</span>
            </span>
          </Link>
          <nav className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <Link href="/edu" className="rounded px-3 py-1.5 hover:bg-white/10">
              Dashboard
            </Link>
            <Link href="/edu/topics" className="rounded px-3 py-1.5 hover:bg-white/10">
              Topics
            </Link>
            <Link href="/edu/settings" className="rounded px-3 py-1.5 hover:bg-white/10">
              Settings
            </Link>
            <Link href="/chaos" className="rounded px-3 py-1.5 hover:bg-white/10">
              Chaos Creators
            </Link>
            <Link href="/today" className="rounded border border-white/30 px-3 py-1.5 hover:bg-white/10">
              ← RSC Classroom
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
