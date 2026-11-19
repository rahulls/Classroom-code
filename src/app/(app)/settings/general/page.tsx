import { ActionForm, CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/form";
import { Breadcrumbs, EditTag, PageHeader } from "@/components/ui";
import { requirePermission } from "@/core/auth/guard";
import { env } from "@/core/env";
import { can } from "@/core/rbac";
import { getSetting } from "@/modules/academics/service";
import { updateReminderSettingsAction } from "@/modules/messages/actions";
import { getReminderSettings, getTeacherContact } from "@/modules/messages/reminders";
import { WA_TEMPLATES } from "@/modules/messages/service";
import { updateInstituteSettingsAction } from "@/modules/platform/actions";

export const metadata = { title: "Institute & defaults" };

export default async function GeneralSettingsPage() {
  const user = await requirePermission("data.edit_all");
  const [name, defaultDuration, presets, reminders] = await Promise.all([
    getSetting<string>("institute.name", "Rahul Shah Classes"),
    getSetting<number>("schedule.defaultDurationMin", 60),
    getSetting<number[]>("schedule.durationPresets", [45, 60, 90, 120, 180]),
    getReminderSettings(),
  ]);
  const teacher = await getTeacherContact();

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings", href: "/settings" }, { label: "Institute & defaults" }]} />
      <PageHeader title={<>Institute &amp; defaults <EditTag /></>} />
      <section className="card max-w-xl">
        <ActionForm action={updateInstituteSettingsAction} className="space-y-3">
          <FormMessage />
          <TextField name="instituteName" label="Institute name" required defaultValue={name} maxLength={100} hint="Used in messages and PDFs" />
          <TextField name="defaultDurationMin" label="Institute default class length (min)" type="number" required min={15} max={600} defaultValue={defaultDuration} hint="Used when no program, course, batch or subject sets one" />
          <TextField name="durationPresets" label="Duration quick picks (min)" required defaultValue={presets.join(", ")} maxLength={100} hint="Shown as one-click choices when scheduling, e.g. 45, 60, 90, 120, 180" />
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>

      {can(user, "messages.send") && (
        <section className="card mt-4 max-w-xl" id="reminders">
          <h2 className="mb-1 font-semibold">Class reminders</h2>
          <p className="mb-3 text-xs text-muted">
            Each student gets a message shortly before each of their classes, on their own WhatsApp (email if they have none). Cancelled classes get no reminder; moved and make-up classes use the new time. Uses the WhatsApp template “{WA_TEMPLATES.reminder.name}”: switch on once it shows Active.
            {env.WHATSAPP_MODE === "manual" && " WhatsApp is in manual mode, so only email reminders go out."}
          </p>
          <ActionForm action={updateReminderSettingsAction} className="space-y-3">
            <FormMessage />
            <CheckboxField name="enabled" label="Send class reminders to students" defaultChecked={reminders.enabled} />
            <TextField
              name="teacherPhone"
              label="Your WhatsApp number"
              type="tel"
              maxLength={20}
              defaultValue={teacher?.phoneLast4 ? `••••••${teacher.phoneLast4}` : ""}
              placeholder="98765 43210"
              hint="You get a reminder before every class, batch and demo, even when student reminders are off. Use your personal number, not the institute's WhatsApp business number. Leave blank for none."
            />
            <TextField name="minutesBefore" label="Minutes before the class" type="number" required min={5} max={120} defaultValue={reminders.minutesBefore} />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </section>
      )}
    </>
  );
}
