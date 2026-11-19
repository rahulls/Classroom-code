import Link from "next/link";
import { AutoSubmitRadio } from "@/components/auto-submit-radio";
import { ActionForm, FormMessage, SubmitButton, TextAreaField, TextField } from "@/components/form";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { isUuid } from "@/core/validation";
import { getTree, resolveYear, type TreeNode } from "@/modules/academics/service";
import { addDays, todayYmd } from "@/modules/academics/time";
import { batchClassLabel } from "@/modules/academics/timetable";
import { sendCampaignAction } from "@/modules/messages/actions";
import { resolveAudience, type Who } from "@/modules/messages/audience";
import { WA_TEMPLATES } from "@/modules/messages/service";

export const metadata = { title: "New message" };

type Search = { purpose?: string; who?: string; b?: string | string[]; g?: string | string[]; s?: string | string[] };
const ids = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(isUuid).slice(0, 200);

const PURPOSES = {
  homework: { label: "Homework", hint: "Uses the WhatsApp template “homework_update” (must be Active in WhatsApp Manager)." },
  notice: { label: "Class notice", hint: "Holidays, test dates, changes… Uses the WhatsApp template “class_notice”." },
} as const;
const WHO: { value: Who; label: string; detail: string }[] = [
  { value: "students", label: "Students", detail: "Their own phone (contact marked “Student (self)”)" },
  { value: "parents", label: "Parents", detail: "Father / mother / guardian" },
  { value: "both", label: "Students and parents", detail: "Each person gets one message" },
];

function flatten(nodes: TreeNode[], depth = 0): { node: TreeNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children, depth + 1)]);
}

export default async function ComposePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("messages.send");
  const sp = await searchParams;
  const purpose = sp.purpose === "notice" ? "notice" : "homework";
  const who: Who = sp.who === "parents" || sp.who === "both" ? sp.who : purpose === "homework" ? "students" : "both";
  const batchIds = ids(sp.b);
  const groupIds = ids(sp.g);
  const studentIds = ids(sp.s);
  const picked = batchIds.length + groupIds.length + studentIds.length > 0;

  const year = await resolveYear();
  const [tree, groups, pickedStudents] = await Promise.all([
    year ? getTree(year.id) : [],
    db.studentGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } }),
    studentIds.length ? db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const nodes = flatten(tree);
  const audience = picked ? await resolveAudience(db, { batchIds, groupIds, studentIds, who }) : null;

  // "For" label: the class of a single picked batch, else the picked names
  const pickedNames = [
    ...nodes.filter((n) => batchIds.includes(n.node.id)).map((n) => n.node.name),
    ...groups.filter((g) => groupIds.includes(g.id)).map((g) => g.name),
    ...pickedStudents.map((s) => `${s.firstName} ${s.lastName}`.trim()),
  ];
  const forLabel = batchIds.length === 1 && !groupIds.length && !studentIds.length ? await batchClassLabel(db, batchIds[0]!) : pickedNames.slice(0, 3).join(", ");
  const wa = audience?.recipients.filter((r) => r.channel === "whatsapp").length ?? 0;
  const email = (audience?.recipients.length ?? 0) - wa;
  const tomorrow = addDays(todayYmd(), 1);

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Messages", href: "/messages" }, { label: "New message" }]} />
      <PageHeader title="New message" subtitle="Homework or a notice to a class, a group or chosen students: on WhatsApp, or email for those without WhatsApp" />

      {/* Step 1: who (a plain GET form, so the recipient preview is computed on the server) */}
      <form className="card mb-4 space-y-4" action="/messages/compose">
        <div className="flex flex-wrap gap-6">
          <fieldset>
            <legend className="label">What</legend>
            {Object.entries(PURPOSES).map(([k, p]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <AutoSubmitRadio name="purpose" value={k} defaultChecked={purpose === k} className="accent-[rgb(var(--accent))]" /> {p.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="label">Send to</legend>
            {WHO.map((w) => (
              <label key={w.value} className="flex items-center gap-2 text-sm">
                <AutoSubmitRadio name="who" value={w.value} defaultChecked={who === w.value} className="accent-[rgb(var(--accent))]" />
                {w.label} <span className="text-xs text-muted">{w.detail}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="label">Classes / batches {year && <span className="text-muted">({year.name})</span>}</legend>
            <p className="mb-1 text-xs text-muted">Ticking a class includes every batch under it.</p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-line p-2">
              {nodes.length ? (
                nodes.map(({ node, depth }) => (
                  <label key={node.id} className="flex items-center gap-2 py-0.5 text-sm" style={{ paddingLeft: depth * 16 }}>
                    <input type="checkbox" name="b" value={node.id} defaultChecked={batchIds.includes(node.id)} className="accent-[rgb(var(--accent))]" />
                    {node.name}
                    <span className="text-xs text-muted">
                      {node.nodeType.label} · {node.activeStudents} student{node.activeStudents === 1 ? "" : "s"}
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-muted">No classes yet.</p>
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Groups</legend>
            <div className="max-h-64 overflow-y-auto rounded-md border border-line p-2">
              {groups.length ? (
                groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" name="g" value={g.id} defaultChecked={groupIds.includes(g.id)} className="accent-[rgb(var(--accent))]" />
                    {g.name} <span className="text-xs text-muted">{g._count.members} students</span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-muted">No student groups yet.</p>
              )}
            </div>
            {pickedStudents.length > 0 && (
              <div className="mt-3">
                <span className="label">Chosen students</span>
                {pickedStudents.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="s" value={s.id} defaultChecked className="accent-[rgb(var(--accent))]" /> {s.firstName} {s.lastName}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>
        <button className="btn">Show who will get it</button>
      </form>

      {audience && (
        <section className="card mb-4 text-sm">
          <h2 className="mb-1 font-semibold">
            {audience.recipients.length} recipient{audience.recipients.length === 1 ? "" : "s"} · {audience.studentCount} student{audience.studentCount === 1 ? "" : "s"}
          </h2>
          <p className="text-muted">
            {wa} on WhatsApp{email ? `, ${email} by email (no WhatsApp)` : ""}.{" "}
            {audience.skipped.length > 0 && <span className="text-warn">{audience.skipped.length} skipped (see below).</span>}
          </p>
          {audience.recipients.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-accent">Show the list</summary>
              <ul className="mt-2 divide-y divide-soft">
                {audience.recipients.map((r) => (
                  <li key={r.contact.id} className="flex flex-wrap gap-3 py-1">
                    <span className="w-48">{r.contact.name}</span>
                    <span className="pill">{r.role === "parent" ? `parent of ${r.students.join(", ")}` : "student"}</span>
                    <span className="text-xs text-muted">{r.channel === "whatsapp" ? "WhatsApp" : "Email"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {audience.skipped.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-warn">
              {audience.skipped.map((s, i) => (
                <li key={i}>
                  {s.name} ({s.role === "parent" ? `parent of ${s.students.join(", ")}` : "student"}): {s.reason}. Fix it on the student’s profile.
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {audience && audience.recipients.length > 0 && (
        <section className="card">
          <h2 className="mb-1 text-sm font-semibold">{PURPOSES[purpose].label}</h2>
          <p className="mb-3 text-xs text-muted">{PURPOSES[purpose].hint}</p>
          <ActionForm action={sendCampaignAction} className="space-y-3" confirm={`Send this to ${audience.recipients.length} people?`}>
            <input type="hidden" name="purpose" value={purpose} />
            <input type="hidden" name="who" value={who} />
            {batchIds.map((id) => (
              <input key={id} type="hidden" name="batchIds[]" value={id} />
            ))}
            {groupIds.map((id) => (
              <input key={id} type="hidden" name="groupIds[]" value={id} />
            ))}
            {studentIds.map((id) => (
              <input key={id} type="hidden" name="studentIds[]" value={id} />
            ))}
            <FormMessage />
            <TextField name="forLabel" label="For (class / subject)" required maxLength={80} defaultValue={forLabel} hint="Parents see it with their child’s name, e.g. “Aarav (Class 10 · Maths)”." />
            <TextAreaField
              name="text"
              label={purpose === "homework" ? "Homework" : "Notice"}
              required
              rows={3}
              hint={purpose === "homework" ? "e.g. Exercise 4.2, questions 1 to 10. Up to 600 characters; line breaks become spaces on WhatsApp." : "e.g. No class on Sat, 14 Nov due to Diwali. Classes resume on Mon, 16 Nov."}
            />
            <div className="flex flex-wrap gap-3">
              {purpose === "homework" && <TextField name="dueDate" label="Submit by" type="date" required defaultValue={tomorrow} />}
              <TextField name="sendAt" label="Send later" type="datetime-local" hint="Leave empty to send now. Times are IST." />
            </div>

            <div className="rounded-md bg-soft p-3 text-xs">
              <b>What they get{env.WHATSAPP_MODE === "cloud" ? ` (WhatsApp template “${WA_TEMPLATES[purpose].name}”)` : ""}:</b>
              <pre className="mt-1 whitespace-pre-wrap font-sans">
                {purpose === "homework"
                  ? "Hello <name>, homework has been assigned for <for>.\n\nHomework: <homework>\nSubmit by: <date>\n\nPlease complete it before the next class."
                  : "Hello <name>, here is a notice about classes for <for>:\n\n<notice>\n\nReply to this message if you have any questions."}
              </pre>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton>Send to {audience.recipients.length}</SubmitButton>
              <Link href="/messages" className="btn">
                Messages
              </Link>
            </div>
          </ActionForm>
        </section>
      )}
    </>
  );
}
