import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DebugPanel } from "@/components/debug";
import { ActionForm } from "@/components/form";
import { Nav } from "@/components/nav";
import { NavProgress } from "@/components/nav-progress";
import { PageMain } from "@/components/page-main";
import { Suspense } from "react";
import { requireUser } from "@/core/auth/guard";
import { isEditMode } from "@/core/edit-mode";
import { env } from "@/core/env";
import { can } from "@/core/rbac";
import { logoutAction } from "@/modules/auth/actions";
import { ensureDeliveryLoop } from "@/modules/messages/service";
import { toggleEditModeAction } from "@/modules/platform/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  ensureDeliveryLoop(); // retries messages queued while the laptop was offline
  const path = (await headers()).get("x-pathname") ?? "";
  if (env.REQUIRE_2FA && !user.totpEnabledAt && !path.startsWith("/settings/security")) redirect("/settings/security?required=1");
  const canEditAll = can(user, "data.edit_all");
  const editMode = await isEditMode(user);

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-panel md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <Link href="/today" className="block px-4 pt-3 font-semibold">
          RSC Classroom
        </Link>
        <Nav />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 text-sm">
          <span className="flex-1 truncate text-muted">Rahul Shah Classes</span>
          {can(user, "settings.manage") && (
            <Link href="/chaos" className="btn border-[#7a2fc0] bg-[#7a2fc0] text-white hover:bg-[#6a25ad]" title="Chaos Creators quiz-video studio">
              🎬 Studio
            </Link>
          )}
          {can(user, "settings.manage") && process.env.EXAM_PREP_ENABLED === "true" && (
            <Link href="/exam-prep" className="btn border-[#0f3460] bg-[#0f3460] text-white hover:bg-[#16507d]" title="Exam Prep: weekly test papers (separate module, own login)">
              📝 Exam Prep
            </Link>
          )}
          {canEditAll && (
            <ActionForm action={toggleEditModeAction}>
              {!editMode && <input type="hidden" name="on" value="on" />}
              <button
                type="submit"
                className={`btn ${editMode ? "border-warn bg-warn/15 text-warn" : ""}`}
                aria-pressed={editMode}
                title="Edit mode reveals edit controls for every record"
              >
                ✎ Edit mode: {editMode ? "On" : "Off"}
              </button>
            </ActionForm>
          )}
          <Link href="/settings/security" className="hidden hover:underline sm:inline">
            {user.name}
          </Link>
          <ActionForm action={logoutAction}>
            <button type="submit" className="btn">
              Sign out
            </button>
          </ActionForm>
        </header>
        {editMode && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">
            Edit mode is on: every record can be changed. All changes are recorded in the audit log. Turns off automatically after 8 hours.
          </div>
        )}
        {!user.totpEnabledAt && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">
            Two-factor authentication is off.{" "}
            <Link href="/settings/security" className="underline">
              Turn it on
            </Link>{" "}
            before going live.
          </div>
        )}
        <PageMain>{children}</PageMain>
        <DebugPanel />
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
      </div>
    </div>
  );
}
