import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActionForm,
  CheckboxField,
  CustomFields,
  FormMessage,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/form";
import {
  Badge,
  Breadcrumbs,
  EditTag,
  Empty,
  PageHeader,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { can } from "@/core/rbac";
import { toDateInput } from "@/core/validation";
import { toFieldDTO } from "@/modules/config/fields";
import {
  addContactAction,
  endEnrollmentAction,
  enrollAction,
  removeContactAction,
  setStudentStatusAction,
  updateContactAction,
  updateEnrollmentAction,
  updateStudentAdminAction,
  updateConsentAction,
  updateStudentAction,
} from "@/modules/students/actions";
import { getEnrollableBatches, getStudent } from "@/modules/students/service";
import { getStudentAttendance } from "@/modules/academics/class-record";
import { addDays, fmtDate, fmtMin, fmtRange, todayYmd } from "@/modules/academics/time";
import { getOccurrences } from "@/modules/academics/timetable";

export const metadata = { title: "Student" };

export default async function StudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("students.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await getStudent(id, user);
  if (!s) notFound();

  const manage = can(user, "students.manage");
  const editMode = await isEditMode(user);
  const [batches, att] = await Promise.all([manage ? getEnrollableBatches() : [], getStudentAttendance(s.id)]);
  // The student's classes come from their batches' timetables: next 7 days, cancellations and moves included
  const todayIst = todayYmd();
  const activeIds = [...new Set(s.enrollments.filter((e) => e.status === "ACTIVE").map((e) => e.batchId))];
  const upcoming = (await Promise.all(activeIds.map((batchId) => getOccurrences({ batchId }, todayIst, addDays(todayIst, 6)))))
    .flatMap((r) => r.occurrences)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  const activeBatchIds = new Set(
    s.enrollments.filter((e) => e.status === "ACTIVE").map((e) => e.batchId),
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Today", href: "/today" },
          { label: "Students", href: "/students" },
          { label: `${s.firstName} ${s.lastName}`.trim() },
        ]}
      />
      <PageHeader
        title={`${s.firstName} ${s.lastName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{s.admissionNo}</span>
            <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
            <Badge>
              {s.learnerKind === "ADULT" ? "Adult learner" : "School student"}
            </Badge>
          </span>
        }
        actions={
          manage && (
            <span className="flex flex-wrap items-end gap-2">
              <Link
                href={`/messages/compose?s=${s.id}&who=both`}
                className="btn"
              >
                Message
              </Link>
              <ActionForm
                action={setStudentStatusAction}
                className="flex items-end gap-2"
              >
                <input type="hidden" name="id" value={s.id} />
                <select
                  name="status"
                  defaultValue={s.status}
                  className="input py-1"
                  aria-label="Status"
                >
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <SubmitButton variant="default">Set status</SubmitButton>
              </ActionForm>
            </span>
          )
        }
      />

      {editMode && (
        <section className="card mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            Record details
            <EditTag />
          </h2>
          <ActionForm
            action={updateStudentAdminAction}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <input type="hidden" name="id" value={s.id} />
            <TextField
              name="admissionNo"
              label="Admission number"
              required
              defaultValue={s.admissionNo}
              maxLength={30}
            />
            <SelectField
              name="learnerKind"
              label="Learner type"
              required
              defaultValue={s.learnerKind}
              options={[
                { value: "MINOR", label: "School / competitive (guardian)" },
                { value: "ADULT", label: "Adult / professional" },
              ]}
            />
            <SubmitButton variant="default">Save</SubmitButton>
            <div className="sm:col-span-3">
              <FormMessage />
            </div>
          </ActionForm>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile */}
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold">Profile</h2>
          {manage ? (
            <ActionForm action={updateStudentAction} className="space-y-3">
              <input type="hidden" name="id" value={s.id} />
              <FormMessage />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  name="firstName"
                  label="First name"
                  required
                  defaultValue={s.firstName}
                  maxLength={60}
                />
                <TextField
                  name="lastName"
                  label="Last name"
                  defaultValue={s.lastName}
                  maxLength={60}
                />
                <SelectField
                  name="gender"
                  label="Gender"
                  defaultValue={s.gender}
                  options={[
                    { value: "female", label: "Female" },
                    { value: "male", label: "Male" },
                    { value: "other", label: "Other" },
                  ]}
                />
                <TextField
                  name="dob"
                  label="Date of birth"
                  type="date"
                  defaultValue={s.dob ?? ""}
                />
              </div>
              <CustomFields
                defs={s.customDefs.map(toFieldDTO)}
                values={s.customValues}
              />
              <SubmitButton>Save profile</SubmitButton>
            </ActionForm>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {s.customDefs.map((d) => (
                <div key={d.id}>
                  <dt className="text-xs text-muted">{d.label}</dt>
                  <dd>{String(s.customValues[d.key] ?? "—")}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <div className="space-y-4">
          {/* Enrolments */}
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold">Batches</h2>
            {s.enrollments.length ? (
              <ul className="space-y-2 text-sm">
                {s.enrollments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/academics/${e.batchId}`}
                      className="font-medium hover:underline"
                    >
                      {[
                        e.batch.parent?.parent?.name,
                        e.batch.parent?.name,
                        e.batch.name,
                      ]
                        .filter(Boolean)
                        .join(" › ")}
                    </Link>
                    <Badge tone={e.status === "ACTIVE" ? "ok" : "neutral"}>
                      {e.status === "ACTIVE" ? "Active" : "Left"}
                    </Badge>
                    <span className="text-xs text-muted">
                      from {toDateInput(e.joinedOn)}
                      {e.leftOn ? ` to ${toDateInput(e.leftOn)}` : ""}
                    </span>
                    {manage && e.status === "ACTIVE" && (
                      <ActionForm
                        action={endEnrollmentAction}
                        confirm="End this enrolment?"
                        className="ml-auto"
                      >
                        <input type="hidden" name="enrollmentId" value={e.id} />
                        <button
                          type="submit"
                          className="text-xs text-bad hover:underline"
                        >
                          End
                        </button>
                      </ActionForm>
                    )}
                    {editMode && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-xs text-accent">
                          Edit enrolment
                          <EditTag />
                        </summary>
                        <ActionForm
                          action={updateEnrollmentAction}
                          className="mt-2 grid gap-2 sm:grid-cols-2"
                        >
                          <input
                            type="hidden"
                            name="enrollmentId"
                            value={e.id}
                          />
                          <TextField
                            name="joinedOn"
                            label="Joined on"
                            type="date"
                            required
                            defaultValue={toDateInput(e.joinedOn)}
                          />
                          <TextField
                            name="leftOn"
                            label="Left on"
                            type="date"
                            defaultValue={toDateInput(e.leftOn)}
                          />
                          <TextField
                            name="rollNo"
                            label="Roll no."
                            defaultValue={e.rollNo}
                            maxLength={20}
                          />
                          <SelectField
                            name="status"
                            label="Status"
                            required
                            defaultValue={e.status}
                            options={[
                              { value: "ACTIVE", label: "Active" },
                              { value: "LEFT", label: "Left" },
                              { value: "TRANSFERRED", label: "Transferred" },
                            ]}
                          />
                          <div className="flex items-center gap-2 sm:col-span-2">
                            <SubmitButton variant="default">
                              Save enrolment
                            </SubmitButton>
                            <FormMessage />
                          </div>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Not in any batch.</Empty>
            )}
            {manage && batches.some((b) => !activeBatchIds.has(b.id)) && (
              <ActionForm
                action={enrollAction}
                className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end"
                resetOnSuccess
              >
                <input type="hidden" name="studentId" value={s.id} />
                <SelectField
                  name="batchId"
                  label="Add to batch"
                  required
                  options={batches
                    .filter((b) => !activeBatchIds.has(b.id))
                    .map((b) => ({
                      value: b.id,
                      label: b.fullLabel,
                    }))}
                />
                <TextField
                  name="joinedOn"
                  label="From"
                  type="date"
                  required
                  defaultValue={today}
                />
                <SubmitButton variant="default">Enrol</SubmitButton>
                <div className="sm:col-span-3">
                  <FormMessage />
                </div>
              </ActionForm>
            )}
          </section>

          {/* Contacts */}
          <section className="card">
            <h2 className="mb-1 text-sm font-semibold">Contacts</h2>
            {!s.revealContacts && (
              <p className="mb-2 text-xs text-muted">
                Phone numbers and emails are hidden for your role.
              </p>
            )}
            {s.contactViews.length ? (
              <ul className="divide-y divide-soft text-sm">
                {s.contactViews.map(({ link, contact }) => (
                  <li key={link.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{contact.name}</span>
                      <span className="pill">{link.relation}</span>
                      {link.isPrimary && <Badge tone="accent">Primary</Badge>}
                      {manage && (
                        <ActionForm
                          action={removeContactAction}
                          confirm={`Remove ${contact.name}? Their details will be erased.`}
                          className="ml-auto"
                        >
                          <input type="hidden" name="studentId" value={s.id} />
                          <input
                            type="hidden"
                            name="contactId"
                            value={contact.id}
                          />
                          <button
                            type="submit"
                            className="text-xs text-bad hover:underline"
                          >
                            Remove
                          </button>
                        </ActionForm>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {contact.phone && (
                        <span className="mr-3">📱 {contact.phone}</span>
                      )}
                      {contact.whatsapp && (
                        <span className="mr-3">
                          WhatsApp{" "}
                          {contact.whatsapp === contact.phone
                            ? "(same)"
                            : contact.whatsapp}
                        </span>
                      )}
                      {contact.email && <span>✉ {contact.email}</span>}
                    </div>
                    {manage ? (
                      <ActionForm
                        action={updateConsentAction}
                        className="mt-1 flex flex-wrap items-center gap-3 text-xs"
                      >
                        <input type="hidden" name="studentId" value={s.id} />
                        <input
                          type="hidden"
                          name="contactId"
                          value={contact.id}
                        />
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            name="waOptIn"
                            defaultChecked={contact.waOptIn}
                            disabled={!contact.whatsapp}
                          />{" "}
                          WhatsApp consent
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            name="emailOptIn"
                            defaultChecked={contact.emailOptIn}
                            disabled={!contact.email}
                          />{" "}
                          Email consent
                        </label>
                        <SubmitButton
                          variant="default"
                          className="px-2 py-0.5 text-xs"
                        >
                          Save
                        </SubmitButton>
                        {contact.consentAt && (
                          <span className="text-muted">
                            since {toDateInput(contact.consentAt)} (
                            {contact.consentSource})
                          </span>
                        )}
                        <FormMessage />
                      </ActionForm>
                    ) : null}
                    {editMode && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-accent">
                          Edit contact details
                          <EditTag />
                        </summary>
                        <ActionForm
                          action={updateContactAction}
                          className="mt-2 space-y-2"
                        >
                          <input type="hidden" name="studentId" value={s.id} />
                          <input
                            type="hidden"
                            name="contactId"
                            value={contact.id}
                          />
                          <FormMessage />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <TextField
                              name="name"
                              label="Name"
                              required
                              defaultValue={contact.name}
                              maxLength={80}
                            />
                            <SelectField
                              name="relation"
                              label="Relation"
                              required
                              defaultValue={link.relation}
                              options={[
                                { value: "self", label: "Student (self)" },
                                { value: "father", label: "Father" },
                                { value: "mother", label: "Mother" },
                                { value: "guardian", label: "Guardian" },
                                { value: "other", label: "Other" },
                              ]}
                            />
                            <TextField
                              name="phone"
                              label="Phone"
                              type="tel"
                              defaultValue={contact.phone}
                              maxLength={25}
                            />
                            <TextField
                              name="whatsapp"
                              label="WhatsApp number"
                              type="tel"
                              defaultValue={contact.whatsapp}
                              maxLength={25}
                            />
                            <TextField
                              name="email"
                              label="Email"
                              type="email"
                              defaultValue={contact.email}
                              maxLength={254}
                            />
                            <SelectField
                              name="preferredChannel"
                              label="Preferred channel"
                              required
                              defaultValue={contact.preferredChannel}
                              options={[
                                { value: "whatsapp", label: "WhatsApp" },
                                { value: "email", label: "Email" },
                                { value: "both", label: "Both" },
                              ]}
                            />
                          </div>
                          <CheckboxField
                            name="isPrimary"
                            label="Primary contact"
                            defaultChecked={link.isPrimary}
                          />
                          <p className="text-xs text-muted">
                            Changing a number or email resets consent for that
                            channel.
                          </p>
                          <SubmitButton variant="default">
                            Save contact
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No contacts.</Empty>
            )}

            {manage && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-accent">
                  + Add contact
                </summary>
                <ActionForm
                  action={addContactAction}
                  className="mt-3 space-y-3"
                  resetOnSuccess
                >
                  <input type="hidden" name="studentId" value={s.id} />
                  <FormMessage />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <TextField
                      name="name"
                      label="Name"
                      required
                      maxLength={80}
                    />
                    <SelectField
                      name="relation"
                      label="Relation"
                      required
                      defaultValue="mother"
                      options={[
                        { value: "self", label: "Student (self)" },
                        { value: "father", label: "Father" },
                        { value: "mother", label: "Mother" },
                        { value: "guardian", label: "Guardian" },
                        { value: "other", label: "Other" },
                      ]}
                    />
                    <TextField
                      name="phone"
                      label="Phone"
                      type="tel"
                      maxLength={25}
                    />
                    <TextField
                      name="email"
                      label="Email"
                      type="email"
                      maxLength={254}
                    />
                  </div>
                  <CheckboxField
                    name="waSame"
                    label="Phone is on WhatsApp"
                    defaultChecked
                  />
                  <CheckboxField
                    name="waOptIn"
                    label="WhatsApp consent given"
                  />
                  <CheckboxField
                    name="emailOptIn"
                    label="Email consent given"
                  />
                  <CheckboxField
                    name="isPrimary"
                    label="Make primary contact"
                  />
                  <SubmitButton variant="default">Add contact</SubmitButton>
                </ActionForm>
              </details>
            )}
          </section>
        </div>
      </div>

      <section className="card mt-4" id="schedule">
        <h2 className="mb-1 text-sm font-semibold">Class schedule · next 7 days</h2>
        {upcoming.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Class</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((o) => (
                <tr key={`${o.key}:${o.date}`} className={o.kind === "cancelled" ? "text-muted line-through" : ""}>
                  <td>
                    {fmtDate(o.date)}
                    {o.date === todayIst && <span className="pill ml-2">today</span>}
                  </td>
                  <td>{fmtRange(o.startMin, o.durationMin)}</td>
                  <td>
                    <Link href={`/academics/${o.batchId}`} className="hover:underline">
                      {o.batchName}
                    </Link>{" "}
                    · {o.subjectName}
                    {o.kind === "moved" && <span className="pill ml-2">moved</span>}
                    {o.makeup && <span className="pill ml-2">make-up</span>}
                    {o.kind === "cancelled" && <span className="pill ml-2">cancelled</span>}
                  </td>
                  <td className="text-muted">{[o.room, o.mode !== "offline" ? o.mode : null].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">{activeIds.length ? "No classes in the next 7 days for this student's batches." : "Not in a batch yet: add one under Batches to give the student a timetable."}</p>
        )}
      </section>

      <section className="card mt-4" id="attendance">
        <h2 className="mb-1 text-sm font-semibold">Attendance</h2>
        {att.total ? (
          <>
            <p className="mb-3 text-sm">
              <b>{Math.round(((att.present + att.late) / att.total) * 100)}%</b> attended ({att.present + att.late} of {att.total} classes) ·{" "}
              <span className="text-ok">{att.present} present</span> · <span className="text-warn">{att.late} late</span> ·{" "}
              <span className="text-bad">{att.absent} absent</span>
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Class</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {att.recent.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {fmtDate(r.date)} <span className="text-xs text-muted">{fmtMin(r.startMin)}</span>
                    </td>
                    <td>
                      <Link href={`/academics/${r.batchId}`} className="hover:underline">
                        {r.batchName}
                      </Link>{" "}
                      · {r.subjectName}
                    </td>
                    <td className={r.status === "absent" ? "font-medium text-bad" : r.status === "late" ? "text-warn" : "text-ok"}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {att.total > att.recent.length && <p className="mt-2 text-xs text-muted">Showing the latest {att.recent.length} classes.</p>}
          </>
        ) : (
          <p className="text-sm text-muted">No attendance yet. Take it from the Calendar: click a class → Attendance.</p>
        )}
      </section>
    </>
  );
}
