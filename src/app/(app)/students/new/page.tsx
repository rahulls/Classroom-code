import Link from "next/link";
import { ActionForm, CheckboxField, CustomFields, FormMessage, SelectField, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { getFieldDefinitions, toFieldDTO } from "@/modules/config/fields";
import { createStudentAction } from "@/modules/students/actions";
import { ClassBatches } from "./class-batches";
import { GuardianField } from "./guardian-field";
import { StudentPhoneField } from "./student-phone";
import { getEnrollableBatches } from "@/modules/students/service";

export const metadata = { title: "Add student" };

export default async function NewStudentPage() {
  await requirePermission("students.manage");
  const [batches, programTypes, commonDefs, noBatch] = await Promise.all([
    getEnrollableBatches(),
    db.programType.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } }),
    getFieldDefinitions("student"),
    // Programs / courses with nothing under them yet: students can only join a batch
    db.programNode.findMany({
      where: { archivedAt: null, nodeType: { enrollable: false }, year: { isCurrent: true }, children: { none: { archivedAt: null } } },
      select: { id: true, name: true, parent: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const scoped = await Promise.all(
    programTypes.map(async (pt) => ({ pt, defs: (await getFieldDefinitions("student", pt.key)).filter((d) => d.scopeKey === pt.key).map(toFieldDTO) })),
  );
  const today = new Date().toISOString().slice(0, 10);
  // Which batches need a guardian (from their program type); others follow the learner type
  const guardianRules = Object.fromEntries(batches.filter((b) => b.programType).map((b) => [b.id, b.programType!.guardianRequired]));

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Students", href: "/students" }, { label: "Add student" }]} />
      <PageHeader title="Add student" subtitle="An admission number is assigned automatically." />
      <ActionForm action={createStudentAction} className="space-y-4">
        <FormMessage />

        <section className="card space-y-3">
          <h2 className="text-sm font-semibold">Student</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="firstName" label="First name" required maxLength={60} autoFocus />
            <TextField name="lastName" label="Last name" maxLength={60} />
            <SelectField
              name="gender"
              label="Gender"
              options={[
                { value: "female", label: "Female" },
                { value: "male", label: "Male" },
                { value: "other", label: "Other" },
              ]}
            />
            <TextField name="dob" label="Date of birth" type="date" hint="Stored encrypted" />
          </div>
        </section>

        <section className="card space-y-3">
          <h2 className="text-sm font-semibold">Class and subjects</h2>
          {batches.length === 0 && (
            <p className="text-sm text-warn">
              No batches yet. <Link href="/academics" className="underline">Create a class and batch</Link> first: every student needs one.
            </p>
          )}
          {noBatch.length > 0 && (
            <p className="text-xs text-muted">
              Not listed because they have no batch yet:{" "}
              {noBatch.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && ", "}
                  <Link href={`/academics/${n.id}`} className="underline">
                    {n.parent ? `${n.parent.name} · ${n.name}` : n.name}
                  </Link>
                </span>
              ))}
              . Open one and add a batch, then come back here.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <ClassBatches
                batches={batches.map((b) => ({
                  id: b.id,
                  name: b.name,
                  classId: b.parentId ?? b.id,
                  classPath: b.classPath,
                  subjects: b.batchSubjects.map((x) => x.subject.name),
                  programLabel: b.programType?.label ?? null,
                }))}
              />
            </div>
            <TextField name="joinedOn" label="Joined on" type="date" required defaultValue={today} />
          </div>
        </section>

        <section className="card grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Student&apos;s own contact</h2>
            <StudentPhoneField />
            <CheckboxField name="studentWaSame" label="Same number is on WhatsApp" defaultChecked />
            <TextField name="studentEmail" label="Email" type="email" maxLength={254} />
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Parent / guardian</h2>
            <div className="grid grid-cols-2 gap-2">
              <GuardianField rules={guardianRules} name="guardianName" label="Name" maxLength={80} />
              <SelectField
                name="guardianRelation"
                label="Relation"
                defaultValue="father"
                options={[
                  { value: "father", label: "Father" },
                  { value: "mother", label: "Mother" },
                  { value: "guardian", label: "Guardian" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
            <GuardianField rules={guardianRules} name="guardianPhone" label="Phone" type="tel" inputMode="tel" maxLength={25} />
            <CheckboxField name="guardianWaSame" label="Same number is on WhatsApp" defaultChecked />
            <TextField name="guardianEmail" label="Email" type="email" maxLength={254} />
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="text-sm font-semibold">Communication consent</h2>
          <p className="text-xs text-muted">Needed before any WhatsApp or email is sent (WhatsApp policy and India&apos;s DPDP Act). Recorded with a timestamp.</p>
          <CheckboxField name="waOptIn" label="Agreed to receive WhatsApp messages" defaultChecked />
          <CheckboxField name="emailOptIn" label="Agreed to receive emails" />
          <TextField name="consentSource" label="How was consent given?" defaultValue="Admission form" maxLength={100} />
        </section>

        {commonDefs.length > 0 && (
          <section className="card space-y-3">
            <h2 className="text-sm font-semibold">More details</h2>
            <CustomFields defs={commonDefs.map(toFieldDTO)} />
          </section>
        )}
        {scoped
          .filter((s) => s.defs.length)
          .map(({ pt, defs }) => (
            <details key={pt.id} className="card">
              <summary className="cursor-pointer text-sm font-semibold">Fields for {pt.label} students</summary>
              <p className="mb-3 mt-1 text-xs text-muted">Only saved when the chosen class belongs to a {pt.label} program.</p>
              <div className="space-y-3">
                <CustomFields defs={defs.map((d) => ({ ...d, required: false }))} />
              </div>
            </details>
          ))}

        <div className="flex gap-2">
          <SubmitButton>Add student</SubmitButton>
          <Link href="/students" className="btn">
            Cancel
          </Link>
        </div>
      </ActionForm>
    </>
  );
}
