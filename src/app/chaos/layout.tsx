import Link from "next/link";
import { requirePermission } from "@/core/auth/guard";

export const metadata = { title: { default: "Chaos Creators", template: "%s · Chaos Creators" } };

/** Chaos Creators studio: a separate area of the app (owner only), not part of the classroom. */
export default async function ChaosLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("settings.manage");
  return (
    <div className="min-h-screen bg-[#f6f3ff]">
      <header className="bg-gradient-to-r from-[#1e0e4a] via-[#3b1a7a] to-[#54219a] text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/chaos" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/chaos/logo.png" alt="" width={44} height={44} className="h-11 w-11 rounded-full bg-white/10" />
            <span>
              <span className="block text-lg font-bold leading-tight">Chaos Creators</span>
              <span className="block text-xs text-white/70">Quiz video studio</span>
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-2 text-sm">
            <Link href="/chaos" className="rounded px-3 py-1.5 hover:bg-white/10">
              Studio
            </Link>
            <Link href="/chaos/dashboard" className="rounded px-3 py-1.5 hover:bg-white/10">
              Dashboard
            </Link>
            <Link href="/chaos/youtube" className="rounded px-3 py-1.5 hover:bg-white/10">
              YouTube
            </Link>
            <Link href="/chaos/canva" className="rounded px-3 py-1.5 hover:bg-white/10">
              Canva
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
