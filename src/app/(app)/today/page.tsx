import Link from "next/link";
import {
  ActionForm,
  CheckboxField,
  FormMessage,
  SubmitButton,
  Req,
} from "@/components/form";
import { PageHeader, Stat } from "@/components/ui";
import { requireUser } from "@/core/auth/guard";
import { db } from "@/core/db";
import { can } from "@/core/rbac";
import { resolveYear } from "@/modules/academics/service";
import {
  scheduleMakeupAction,
  waiveMakeupAction,
} from "@/modules/academics/actions";
import { getMakeupsOwed } from "@/modules/academics/delivery";
import { getDemos } from "@/modules/academics/demo";
import { addDays, fmtMin, fmtRange, todayYmd } from "@/modules/academics/time";
import { getOccurrences } from "@/modules/academics/timetable";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const user = await requireUser();
  const [students, batches, subjects, recent, waToSend, owed] =
    await Promise.all([
      db.student.count({ where: { status: "ACTIVE", archivedAt: null } }),
      db.programNode.count({
        where: {
          archivedAt: null,
          nodeType: { enrollable: true },
          year: { isCurrent: true },
        },
      }),
      db.subject.count({ where: { archivedAt: null } }),
      db.auditLog.findMany({ orderBy: { at: "desc" }, take: 8 }),
      can(user, "messages.view")
        ? db.outboundMessage.count({
            where: { channel: "whatsapp", status: "manual" },
          })
        : 0,
      can(user, "academics.manage") ? getMakeupsOwed() : [],
    ]);

  // Today's classes in the institute's timezone, including one-time, rescheduled and cancelled ones
  const year = await resolveYear();
  const day = todayYmd();
  const [todays, demos] = await Promise.all([
    year
      ? getOccurrences({ yearId: year.id }, day, day).then((r) => r.occurrences)
      : Promise.resolve([]),
    getDemos(day, day),
  ]);
  type Row =
    | { kind: "class"; s: (typeof todays)[number]; start: number }
    | { kind: "demo"; d: (typeof demos)[number]; start: number };
  const rows: Row[] = [
    ...todays.map((s): Row => ({ kind: "class", s, start: s.startMin })),
    ...demos.map((d): Row => ({ kind: "demo", d, start: d.startMin })),
  ].sort((a, b) => a.start - b.start);

  const checklist = [
    {
      done: !!user.totpEnabledAt,
      label: "Turn on two-factor authentication",
      href: "/settings/security",
    },
    { done: subjects > 0, label: "Add subjects", href: "/academics/subjects" },
    {
      done: batches > 0,
      label: "Create programs, courses and batches",
      href: "/academics",
    },
    {
      done: students > 0,
      label: "Add your first student",
      href: "/students/new",
    },
    {
      done: todays.length > 0 || (await db.timetableSlot.count()) > 0,
      label: "Schedule class timings for a batch",
      href: "/academics/timetable",
    },
  ];

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });

  return (
    <>
      <PageHeader
        title={`Today · ${today}`}
        actions={
          <>
            <Link href="/students/new" className="btn-primary">
              + Student
            </Link>
            <Link href="/academics" className="btn">
              Academics
            </Link>
          </>
        }
      />
      {waToSend > 0 && (
        <Link
          href="/messages"
          className="card mb-4 block border-warn text-sm hover:bg-warn/5"
        >
          <b className="text-warn">
            {waToSend} WhatsApp message{waToSend === 1 ? "" : "s"} to send.
          </b>{" "}
          Open Messages and click “Open WhatsApp” for each →
        </Link>
      )}
      {owed.length > 0 && (
        <section className="card mb-4 border-warn">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold text-warn">
              {owed.length} make-up class{owed.length === 1 ? "" : "es"} owed
            </h2>
            <Link
              href="/reports/classes"
              className="text-xs text-accent hover:underline"
            >
              Class report →
            </Link>
          </div>
          <p className="mb-2 text-xs text-muted">
            Classes you cancelled. Pick a date to schedule the make-up; students
            get one message with both dates.
          </p>
          <ul className="divide-y divide-soft text-sm">
            {owed.map((o) => (
              <li key={o.id} className="py-2">
                <p className="mb-1">
                  <b>{o.batchLabel}</b> · {o.subjectName} ·{" "}
                  <span className="text-muted">cancelled {o.when}</span>
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <ActionForm
                    action={scheduleMakeupAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="cancelledId" value={o.id} />
                    <input type="hidden" name="room" value={o.room ?? ""} />
                    <input type="hidden" name="mode" value={o.mode} />
                    <label>
                      <span className="label">
                        Make-up date
                        <Req />
                      </span>
                      <input
                        type="date"
                        name="date"
                        required
                        className="input"
                        defaultValue={addDays(day, 1)}
                        min={day}
                      />
                    </label>
                    <label>
                      <span className="label">
                        Start
                        <Req />
                      </span>
                      <input
                        type="time"
                        name="startTime"
                        required
                        className="input w-28"
                        defaultValue={fmtMin(o.startMin)}
                      />
                    </label>
                    <label>
                      <span className="label">
                        End
                        <Req />
                      </span>
                      <input
                        type="time"
                        name="endTime"
                        required
                        className="input w-28"
                        defaultValue={fmtMin(o.startMin + o.durationMin)}
                      />
                    </label>
                    <CheckboxField
                      name="notify"
                      label="Tell students"
                      defaultChecked
                    />
                    <CheckboxField
                      name="allowClash"
                      label="Save anyway if it clashes"
                    />
                    <SubmitButton>Schedule make-up</SubmitButton>
                    <div className="w-full">
                      <FormMessage />
                    </div>
                  </ActionForm>
                  <ActionForm
                    action={waiveMakeupAction}
                    confirm="No make-up for this class? It stays on the report as cancelled without a make-up."
                  >
                    <input type="hidden" name="cancelledId" value={o.id} />
                    <SubmitButton variant="default">Not needed</SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="active students" value={students} />
        <Stat label="batches this year" value={batches} />
        <Stat label="subjects" value={subjects} />
        <Stat
          label="2FA"
          value={user.totpEnabledAt ? "On" : "Off"}
          tone={user.totpEnabledAt ? "ok" : "warn"}
        />
      </div>
      <section className="card mb-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Today's classes
          </h2>
          <Link
            href="/calendar"
            className="text-xs text-accent hover:underline"
          >
            Calendar →
          </Link>
        </div>
        {rows.length ? (
          <ul className="divide-y divide-soft text-sm">
            {rows.map((r) => {
              if (r.kind === "demo") {
                const d = r.d;
                return (
                  <li
                    key={`demo:${d.id}`}
                    className={`flex flex-wrap items-center gap-3 py-1.5 ${d.cancelled ? "text-muted line-through" : ""}`}
                  >
                    <span className="w-28 font-medium tabular-nums">
                      {fmtRange(d.startMin, d.durationMin)}
                    </span>
                    <span className="pill">{d.durationMin} min</span>
                    <Link
                      href={`/calendar?date=${day}`}
                      className="hover:underline"
                    >
                      {d.personName}
                    </Link>
                    <span>{d.subject}</span>
                    <span className="pill border-[#d97706] text-[#d97706]">
                      {d.cancelled ? "demo · cancelled" : "demo"}
                    </span>
                    <span className="text-xs text-muted">
                      {[d.room, d.mode !== "offline" ? d.mode : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                );
              }
              const s = r.s;
              return (
                <li
                  key={s.key}
                  className={`flex flex-wrap items-center gap-3 py-1.5 ${s.kind === "cancelled" ? "text-muted line-through" : ""}`}
                >
                  <span className="w-28 font-medium tabular-nums">
                    {fmtRange(s.startMin, s.durationMin)}
                  </span>
                  <span className="pill">{s.durationMin} min</span>
                  <Link
                    href={`/academics/${s.batchId}`}
                    className="hover:underline"
                  >
                    {s.batchName}
                  </Link>
                  <span>{s.subjectName}</span>
                  {s.kind !== "weekly" && (
                    <span className="pill">
                      {s.makeup
                        ? "make-up"
                        : s.kind === "extra"
                          ? "one-time"
                          : s.kind === "moved"
                            ? "rescheduled"
                            : "cancelled"}
                    </span>
                  )}
                  <span className="text-xs text-muted">
                    {[s.room, s.mode !== "offline" ? s.mode : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No classes scheduled today.</p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Getting started
          </h2>
          <ul className="space-y-2 text-sm">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                <span className={c.done ? "text-ok" : "text-muted"}>
                  {c.done ? "✔" : "○"}
                </span>
                <Link
                  href={c.href}
                  className={
                    c.done ? "text-muted line-through" : "hover:underline"
                  }
                >
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Attendance, fees and the rest arrive in the next build phases.
          </p>
        </section>
        <section className="card">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Recent activity
          </h2>
          <ul className="space-y-1.5 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span className="w-28 shrink-0 text-xs text-muted">
                  {r.at.toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span className="truncate">{r.action}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/settings/audit"
            className="mt-3 inline-block text-xs text-accent hover:underline"
          >
            Full audit log →
          </Link>
        </section>
      </div>
    </>
  );
}
