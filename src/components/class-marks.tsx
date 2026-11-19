// Calendar dots showing whether a class was logged. No hooks, so usable from server and client components.

export type ClassMarks = { attendance: boolean; work: boolean };

/** Two dots: green = attendance taken, blue = class work / homework logged. Hollow = not done yet. */
export function MarkDots({ marks, className = "" }: { marks: ClassMarks; className?: string }) {
  const dot = (done: boolean, color: string, label: string) => (
    <span
      title={label}
      aria-label={label}
      className={`inline-block h-2 w-2 rounded-full border ${color} ${done ? "" : "!bg-transparent opacity-70"}`}
    />
  );
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {dot(marks.attendance, "border-ok bg-ok", marks.attendance ? "Attendance taken" : "Attendance not taken")}
      {dot(marks.work, "border-accent bg-accent", marks.work ? "Class work / homework logged" : "Class work / homework not logged")}
    </span>
  );
}

export const markLabel = (m?: ClassMarks) =>
  m ? ` · attendance ${m.attendance ? "taken" : "not taken"} · class work ${m.work ? "logged" : "not logged"}` : "";

/** Explains the calendar's dots. */
export function MarkLegend() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full border border-ok bg-ok" /> Attendance taken
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full border border-accent bg-accent" /> Class work / homework logged
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full border border-muted" /> Hollow = not done yet (past and today's classes only)
      </span>
    </p>
  );
}
