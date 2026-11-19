import Link from "next/link";
import { currentTeacher } from "@/modules/exam-prep/auth";
import { runJobsAction, taskDoneAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { weekOf } from "@/modules/exam-prep/domain/programme";
import { groupAdvice } from "@/modules/exam-prep/services/messaging";
import { getSettings } from "@/modules/exam-prep/settings";
import { ActionButton } from "../ui";

export const metadata = { title: "Today" };

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function ExamPrepToday() {
  const [s, t] = await Promise.all([getSettings(), currentTeacher()]);
  const now = new Date();
  const week = s["programme.startDate"] ? weekOf(s["programme.startDate"], now) : 0;
  const [tasks, counts, advice] = await Promise.all([
    epdb.task.findMany({ where: { doneAt: null }, orderBy: { dueAt: "asc" }, take: 40 }),
    Promise.all([
      epdb.student.count({ where: { status: { not: "opted_out" }, isDemo: false } }),
      epdb.parent.count({ where: { numberVerifiedAt: null, optedOutAt: null } }),
      epdb.mark.count({ where: { needsReview: true, submission: { isCurrent: true } } }),
      epdb.message.count({ where: { status: "drafted" } }),
      epdb.reportCard.count({ where: { status: { in: ["draft", "ready", "failed"] } } }),
      epdb.offer.count({ where: { status: "suggested" } }),
    ]),
    groupAdvice(now),
  ]);
  const [students, unverified, review, drafts, reports, offers] = counts;
  const stats: [string, number, string][] = [
    ["Students", students, "/exam-prep/students"],
    ["Numbers to verify", unverified, "/exam-prep/verify"],
    ["Marks needing review", review, "/exam-prep/papers"],
    ["Messages to send", drafts, "/exam-prep/messages"],
    ["Reports not sent", reports, "/exam-prep/reports"],
    ["Offers to review", offers, "/exam-prep/commercial"],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0f3460]">Today</h1>
          <p className="text-sm text-muted">{s["programme.startDate"] ? (week >= 1 && week <= s["programme.weeks"] ? `Programme week ${week} of ${s["programme.weeks"]}` : week < 1 ? `Starts ${s["programme.startDate"]}` : "The programme has ended") : "Set the start date in Settings to build the calendar."}</p>
        </div>
        <div className="ml-auto">
          <ActionButton action={runJobsAction} fields={{}} tone="primary">
            Run the weekly jobs now
          </ActionButton>
        </div>
      </div>
      {!t?.twoStep && (
        <p className="card border-warn text-sm">
          <b className="text-warn">Turn on two-step verification.</b> These are minors' records: protect the teacher account in <Link href="/exam-prep/settings/account" className="text-accent underline">Settings → Account</Link>.
        </p>
      )}
      {advice.split && (
        <p className="card border-warn text-sm">
          <b className="text-warn">Time to split the shared group by class:</b> {advice.reasons.join("; ")}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, n, href]) => (
          <Link key={label} href={href} className="card hover:bg-soft/50">
            <div className="text-2xl font-bold text-[#0f3460]">{n}</div>
            <div className="text-xs text-muted">{label}</div>
          </Link>
        ))}
      </div>
      <section className="card">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Tasks</h2>
        {tasks.length ? (
          <ul className="divide-y divide-line">
            {tasks.map((x) => (
              <li key={x.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${x.dueAt < now ? "" : "opacity-80"}`}>
                <span className={`w-36 shrink-0 text-xs ${x.dueAt < now ? "font-semibold text-bad" : "text-muted"}`}>{fmt(x.dueAt)}</span>
                <span className="flex-1">{x.title}</span>
                {x.paperId && (
                  <Link href={`/exam-prep/papers/${x.paperId}`} className="text-xs text-accent hover:underline">
                    {x.paperId}
                  </Link>
                )}
                {x.messageId && (
                  <Link href="/exam-prep/messages" className="text-xs text-accent hover:underline">
                    message
                  </Link>
                )}
                <ActionButton action={taskDoneAction} fields={{ id: x.id }}>
                  Done
                </ActionButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No open tasks. Tasks appear here each week once the calendar is set and papers are attached.</p>
        )}
      </section>
    </div>
  );
}
