import Link from "next/link";
import { Empty, Stat } from "@/components/ui";
import { attendanceTotals, getBatchLog, type LogClass } from "@/modules/academics/batch-log";
import { addDays, fmtDate, fmtMin, fmtRange } from "@/modules/academics/time";

// "Class progress & homework" and "Attendance" tabs of a batch page. Server-rendered, read-only;
// notes and attendance are entered from the class in the Schedule tab or the Calendar.

type Props = { batchId: string; from: string; to: string; today: string };

const editHref = (batchId: string, date: string) => `/academics/${batchId}?tab=schedule&date=${date}`;

function RangeForm({ batchId, tab, from, to, today }: Props & { tab: string }) {
  const quick = [
    { label: "Last 7 days", from: addDays(today, -6) },
    { label: "Last 30 days", from: addDays(today, -29) },
    { label: "This month", from: `${today.slice(0, 7)}-01` },
    { label: "Last 90 days", from: addDays(today, -89) },
  ];
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-2">
      <form method="get" action={`/academics/${batchId}`} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="block">
          <span className="label">From</span>
          <input type="date" name="from" defaultValue={from} max={today} className="input" />
        </label>
        <label className="block">
          <span className="label">To</span>
          <input type="date" name="to" defaultValue={to} max={today} className="input" />
        </label>
        <button className="btn">Show</button>
      </form>
      <span className="flex flex-wrap gap-1 sm:ml-auto">
        {quick.map((q) => (
          <Link key={q.label} href={`/academics/${batchId}?tab=${tab}&from=${q.from}&to=${today}`} className={`btn px-2 py-1 text-xs ${q.from === from && to === today ? "border-accent text-accent" : ""}`}>
            {q.label}
          </Link>
        ))}
      </span>
    </div>
  );
}

function SubjectDot({ color }: { color: string | null }) {
  return <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: color ?? "rgb(var(--line))" }} />;
}

const held = (classes: LogClass[], today: string) => classes.filter((c) => !c.cancelled && c.date <= today);

export async function ProgressTab(props: Props) {
  const { batchId, from, to, today } = props;
  const { classes, students } = await getBatchLog(batchId, from, to);
  const past = held(classes, today);
  const withNotes = past.filter((c) => c.notes);
  const withHw = past.filter((c) => c.homework);
  const missing = past.filter((c) => !c.notes && !c.homework);
  const openHw = withHw.filter((c) => c.homeworkDue && c.homeworkDue >= today);

  const subjects = [...new Map(past.map((c) => [c.subjectName, { name: c.subjectName, code: c.subjectCode, color: c.color }])).values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <RangeForm {...props} tab="progress" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Classes held" value={past.length} />
        <Stat label="With notes" value={withNotes.length} />
        <Stat label="Homework given" value={withHw.length} />
        <Stat label="Homework due ahead" value={openHw.length} tone={openHw.length ? "warn" : undefined} />
        <Stat label="No notes or homework" value={missing.length} tone={missing.length ? "bad" : "ok"} />
      </div>

      {!past.length ? (
        <Empty>No classes between {fmtDate(from)} and {fmtDate(to)}.</Empty>
      ) : (
        <>
          <section className="card mb-4">
            <h2 className="mb-3 text-sm font-semibold">By subject</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {subjects.map((s) => {
                const mine = past.filter((c) => c.subjectName === s.name);
                const covered = mine.filter((c) => c.notes || c.homework);
                return (
                  <div key={s.name} className="rounded-md border border-line p-3">
                    <h3 className="mb-1 text-sm font-semibold">
                      <SubjectDot color={s.color} />
                      {s.name}
                    </h3>
                    <p className="mb-2 text-xs text-muted">
                      {mine.length} class{mine.length === 1 ? "" : "es"} · {mine.filter((c) => c.notes).length} with notes · {mine.filter((c) => c.homework).length} homework
                    </p>
                    {covered.length ? (
                      <ol className="space-y-1.5 text-sm">
                        {covered.map((c) => (
                          <li key={c.key} className="border-l-2 border-line pl-2">
                            <span className="text-xs text-muted">{fmtDate(c.date)}</span>
                            {c.notes && <span className="block">{c.notes}</span>}
                            {c.homework && (
                              <span className="block text-xs">
                                <b>HW:</b> {c.homework}
                                {c.homeworkDue && <span className="text-muted"> · by {fmtDate(c.homeworkDue)}</span>}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-muted">Nothing recorded yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h2 className="mb-1 text-sm font-semibold">Date-wise</h2>
            <p className="mb-3 text-xs text-muted">Newest first. Click “Add” or “Edit” to open that class in the schedule.</p>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Subject</th>
                    <th>Covered in class</th>
                    <th>Homework</th>
                    <th>Sent</th>
                    <th>Attendance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...past].reverse().map((c) => {
                    const t = [...c.marks.values()];
                    return (
                      <tr key={c.key}>
                        <td className="whitespace-nowrap">
                          {fmtDate(c.date)}
                          <span className="block text-xs text-muted">{fmtRange(c.startMin, c.durationMin)}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          <SubjectDot color={c.color} />
                          {c.subjectName}
                          {c.makeup && <span className="pill ml-1">make-up</span>}
                          {c.moved && <span className="pill ml-1">moved</span>}
                        </td>
                        <td className="min-w-48 whitespace-pre-line">{c.notes ?? <span className="text-muted">—</span>}</td>
                        <td className="min-w-40">
                          {c.homework ? (
                            <>
                              <span className="whitespace-pre-line">{c.homework}</span>
                              {c.homeworkDue && <span className={`block text-xs ${c.homeworkDue >= today ? "text-warn" : "text-muted"}`}>by {fmtDate(c.homeworkDue)}</span>}
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-xs">{c.sentAt ? <span className="text-ok">✓ sent</span> : c.notes || c.homework ? <span className="text-muted">not sent</span> : ""}</td>
                        <td className="whitespace-nowrap text-xs">
                          {c.attendanceTaken ? (
                            <>
                              {t.filter((s) => s !== "absent").length}/{t.length} present
                            </>
                          ) : (
                            <span className="text-muted">not taken</span>
                          )}
                        </td>
                        <td>
                          <Link href={editHref(batchId, c.date)} className="text-xs text-accent hover:underline">
                            {c.notes || c.homework ? "Edit" : "Add"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {!students.length && <p className="mt-3 text-xs text-muted">No students in this batch in this period.</p>}
    </>
  );
}

const CELL = { present: { t: "P", c: "bg-ok/15 text-ok" }, late: { t: "L", c: "bg-warn/15 text-warn" }, absent: { t: "A", c: "bg-bad/15 text-bad" } } as const;

export async function AttendanceTab(props: Props) {
  const { batchId, from, to, today } = props;
  const { classes, students } = await getBatchLog(batchId, from, to);
  const past = held(classes, today);
  const taken = past.filter((c) => c.attendanceTaken);
  const notTaken = past.filter((c) => !c.attendanceTaken);
  const totals = new Map(students.map((s) => [s.id, attendanceTotals(taken, s.id)]));
  const allMarks = taken.flatMap((c) => [...c.marks.values()]);
  const overall = allMarks.length ? Math.round((allMarks.filter((m) => m !== "absent").length / allMarks.length) * 100) : null;
  const low = students.filter((s) => {
    const p = totals.get(s.id)?.pct;
    return p !== null && p !== undefined && p < 75;
  });

  return (
    <>
      <RangeForm {...props} tab="attendance" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overall attendance" value={overall === null ? "—" : `${overall}%`} tone={overall === null ? undefined : overall >= 75 ? "ok" : "bad"} />
        <Stat label="Classes with attendance" value={`${taken.length} of ${past.length}`} />
        <Stat label="Not taken yet" value={notTaken.length} tone={notTaken.length ? "warn" : "ok"} />
        <Stat label="Students below 75%" value={low.length} tone={low.length ? "bad" : "ok"} />
      </div>

      {!students.length ? (
        <Empty>No students in this batch between {fmtDate(from)} and {fmtDate(to)}.</Empty>
      ) : (
        <>
          <section className="card mb-4">
            <h2 className="mb-1 text-sm font-semibold">Students</h2>
            <p className="mb-3 text-xs text-muted">Late counts as attended. Below 75% is shown in red.</p>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Classes marked</th>
                    <th>Present</th>
                    <th>Late</th>
                    <th>Absent</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const t = totals.get(s.id)!;
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.rollNo && <span className="mr-2 text-xs text-muted">{s.rollNo}</span>}
                          <Link href={`/students/${s.id}`} className="hover:underline">
                            {s.name}
                          </Link>
                          {s.joinedOn > from && <span className="pill ml-2 text-xs">joined {fmtDate(s.joinedOn)}</span>}
                          {s.leftOn && s.leftOn <= to && <span className="pill ml-2 text-xs">left {fmtDate(s.leftOn)}</span>}
                        </td>
                        <td>{t.marked}</td>
                        <td className="text-ok">{t.present}</td>
                        <td className="text-warn">{t.late}</td>
                        <td className="text-bad">{t.absent}</td>
                        <td className={`font-medium ${t.pct === null ? "text-muted" : t.pct < 75 ? "text-bad" : "text-ok"}`}>{t.pct === null ? "—" : `${t.pct}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card mb-4">
            <h2 className="mb-1 text-sm font-semibold">Date-wise</h2>
            <p className="mb-3 text-xs text-muted">
              <span className="text-ok">P</span> present · <span className="text-warn">L</span> late · <span className="text-bad">A</span> absent · – not marked. Only classes where attendance was taken.
            </p>
            {taken.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 border-b border-line bg-panel px-2 py-1.5 text-left font-semibold">Student</th>
                      {taken.map((c) => (
                        <th key={c.key} className="border-b border-l border-line px-1.5 py-1.5 text-center font-normal" title={`${c.subjectName} · ${fmtDate(c.date)} ${fmtMin(c.startMin)}`}>
                          <Link href={editHref(batchId, c.date)} className="block hover:underline">
                            <span className="block font-semibold">{fmtDate(c.date, { day: "numeric", month: "short" })}</span>
                            <span className="block text-muted">{c.subjectCode}</span>
                          </Link>
                        </th>
                      ))}
                      <th className="border-b border-l border-line px-2 py-1.5 text-right font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const t = totals.get(s.id)!;
                      return (
                        <tr key={s.id} className="hover:bg-soft/50">
                          <td className="sticky left-0 z-10 whitespace-nowrap border-b border-soft bg-panel px-2 py-1">{s.name}</td>
                          {taken.map((c) => {
                            const m = c.marks.get(s.id);
                            return (
                              <td key={c.key} className="border-b border-l border-soft p-0.5 text-center">
                                {m ? <span className={`inline-block w-6 rounded py-0.5 font-semibold ${CELL[m].c}`}>{CELL[m].t}</span> : <span className="text-muted">–</span>}
                              </td>
                            );
                          })}
                          <td className={`border-b border-l border-soft px-2 text-right font-medium ${t.pct === null ? "text-muted" : t.pct < 75 ? "text-bad" : "text-ok"}`}>{t.pct === null ? "—" : `${t.pct}%`}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="sticky left-0 z-10 bg-panel px-2 py-1 text-muted">Present</td>
                      {taken.map((c) => {
                        const v = [...c.marks.values()];
                        return (
                          <td key={c.key} className="border-l border-soft px-1 py-1 text-center text-muted">
                            {v.filter((m) => m !== "absent").length}/{v.length}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No attendance taken between {fmtDate(from)} and {fmtDate(to)}. Open a class in the Schedule tab to take it.</Empty>
            )}
          </section>

          {notTaken.length > 0 && (
            <section className="card">
              <h2 className="mb-2 text-sm font-semibold">Classes without attendance ({notTaken.length})</h2>
              <ul className="flex flex-wrap gap-2 text-xs">
                {[...notTaken].reverse().map((c) => (
                  <li key={c.key}>
                    <Link href={editHref(batchId, c.date)} className="btn px-2 py-1 text-xs">
                      {fmtDate(c.date)} · {c.subjectCode} {fmtMin(c.startMin)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
