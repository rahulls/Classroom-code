import Link from "next/link";
import { requireTeacher } from "@/modules/exam-prep/auth";
import { logoutAction } from "@/modules/exam-prep/actions";
import { ActionButton } from "../ui";

const NAV = [
  ["/exam-prep", "Today"],
  ["/exam-prep/students", "Students"],
  ["/exam-prep/papers", "Papers"],
  ["/exam-prep/calendar", "Calendar"],
  ["/exam-prep/reports", "Reports"],
  ["/exam-prep/ranks", "Ranks"],
  ["/exam-prep/messages", "Messages"],
  ["/exam-prep/commercial", "Plans"],
  ["/exam-prep/feedback", "Feedback"],
  ["/exam-prep/metrics", "Metrics"],
  ["/exam-prep/settings", "Settings"],
] as const;

/** Teacher-only area. No links to the classroom or the studio: Exam Prep stands alone. */
export default async function ExamPrepAppLayout({ children }: { children: React.ReactNode }) {
  const t = await requireTeacher();
  return (
    <>
      <header className="bg-gradient-to-r from-[#0f3460] to-[#16507d] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/exam-prep" className="text-lg font-bold">
            Exam Prep
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-2.5 py-1 hover:bg-white/15">
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-white/80">
            <Link href="/today" className="rounded border border-white/30 px-3 py-1.5 text-sm text-white hover:bg-white/10">
              ← RSC Classroom
            </Link>
            {t.username}
            <ActionButton action={logoutAction} fields={{}}>
              Sign out
            </ActionButton>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
