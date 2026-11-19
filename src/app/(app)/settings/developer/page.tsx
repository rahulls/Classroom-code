import { DebugToggle } from "@/components/debug";
import { Breadcrumbs, PageHeader } from "@/components/ui";
import { requireUser } from "@/core/auth/guard";

export const metadata = { title: "Developer" };

export default async function DeveloperPage() {
  await requireUser();
  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings", href: "/settings" }, { label: "Developer" }]} />
      <PageHeader title="Developer" subtitle="Tools for checking what the app sends and receives." />
      <section className="card max-w-2xl space-y-3 text-sm">
        <DebugToggle />
        <p className="text-muted">
          When on, every form you submit (save, add, delete…) is shown in a panel at the bottom-right and in the browser console (F12 → Console), as plain JSON: the fields that were sent, the reply,
          and how long it took. Passwords, setup tokens and 2FA codes are masked.
        </p>
        <p className="text-muted">
          Why the Network tab looks unreadable: Next.js sends form actions with internal fields (<code>$ACTION_ID…</code>) and replies in its own streaming format (React Server Components). That&apos;s a
          wire format, not encryption, and it can&apos;t be switched off. This log shows the same data in readable form.
        </p>
        <p className="text-muted">Nothing is changed on the server; the log lives only in this browser tab and clears on reload.</p>
      </section>
    </>
  );
}
