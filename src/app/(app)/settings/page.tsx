import Link from "next/link";
import { Breadcrumbs, EditTag, PageHeader } from "@/components/ui";
import { requireUser } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { db } from "@/core/db";
import { can } from "@/core/rbac";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const programTypes = await db.programType.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } });
  const admin = can(user, "settings.manage");
  const editMode = await isEditMode(user);

  const links = [
    { href: "/settings/security", title: "Security", body: "Password, two-factor authentication, signed-in devices", show: true },
    { href: "/settings/fields", title: "Custom fields", body: "Configurable student-profile fields, per program type", show: admin },
    { href: "/settings/audit", title: "Audit log", body: "Every sign-in, change and export, with who, when and from where", show: can(user, "audit.view") },
    { href: "/academics/subjects", title: "Subjects", body: "Subject catalogue and default class lengths", show: true },
    { href: "/settings/developer", title: "Developer", body: "Readable request / response log for every action", show: true },
    { href: "/settings/general", title: "Institute & defaults", body: "Institute name, default class length, duration presets", show: can(user, "data.edit_all") },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings" }]} />
      <PageHeader title="Settings" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {links
          .filter((l) => l.show)
          .map((l) => (
            <Link key={l.href} href={l.href} className="card hover:border-accent">
              <div className="font-medium">{l.title}</div>
              <div className="text-sm text-muted">{l.body}</div>
            </Link>
          ))}
      </div>

      <section className="card mb-4 overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold">
          Program types
          {editMode && <EditTag />}
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Learners</th>
              <th>Guardian</th>
              <th>Billing</th>
              <th>Curriculum levels</th>
              <th>Messages go to</th>
              {editMode && <th />}
            </tr>
          </thead>
          <tbody>
            {programTypes.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.label}</td>
                <td>{p.learnerKind === "ADULT" ? "Adults" : "Minors"}</td>
                <td>{p.guardianRequired ? "Required" : "—"}</td>
                <td>{p.defaultBilling}</td>
                <td>{p.curriculumLevels.join(" → ")}</td>
                <td>{p.defaultRecipients}</td>
                {editMode && (
                  <td>
                    <Link href={`/settings/program-types/${p.id}`} className="text-xs text-accent hover:underline">
                      Edit
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 text-sm font-semibold">Integrations</h2>
        <p className="text-muted">
          WhatsApp, email and Google Drive are added in the communication phase. Until you provide the account details (see <code>design/09-integrations-setup.md</code>), the app runs in local test mode and nothing is sent to real students.
        </p>
      </section>
    </>
  );
}
