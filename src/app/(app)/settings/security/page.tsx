import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { Badge, Breadcrumbs, PageHeader } from "@/components/ui";
import { requireUser } from "@/core/auth/guard";
import { getSession } from "@/core/auth/session";
import { totpQrDataUrl } from "@/core/auth/totp";
import { decrypt } from "@/core/crypto";
import { db } from "@/core/db";
import { env } from "@/core/env";
import {
  changePasswordAction,
  confirmTotpSetupAction,
  disableTotpAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  startTotpSetupAction,
} from "@/modules/auth/actions";
import { updateProfileAction } from "@/modules/platform/actions";
import { TotpConfirm } from "./totp-confirm";

export const metadata = { title: "Security" };

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireUser();
  const current = await getSession();
  const { required } = await searchParams;

  const [sessions, codesLeft] = await Promise.all([
    db.session.findMany({ where: { userId: user.id, revokedAt: null, mfaPending: false, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    db.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
  ]);

  let qr: string | null = null;
  let secret: string | null = null;
  if (!user.totpEnabledAt && user.totpPendingEnc) {
    secret = decrypt(user.totpPendingEnc, "user.totp");
    qr = await totpQrDataUrl(user.email, secret);
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Today", href: "/today" }, { label: "Settings", href: "/settings" }, { label: "Security" }]} />
      <PageHeader title="Security" subtitle={`Signed in as ${user.email}`} />
      {required && !user.totpEnabledAt && <p className="mb-4 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">Two-factor authentication is required before you can continue.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Two-factor authentication {user.totpEnabledAt ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}
          </h2>

          {user.totpEnabledAt ? (
            <>
              <p className="text-sm text-muted">
                On since {fmt(user.totpEnabledAt)}. {codesLeft} of 10 recovery codes left.
              </p>
              {!env.REQUIRE_2FA && (
                <details>
                  <summary className="cursor-pointer text-sm text-bad">Turn off two-factor authentication</summary>
                  <ActionForm action={disableTotpAction} className="mt-3 space-y-3">
                    <FormMessage />
                    <TextField name="password" label="Password" type="password" autoComplete="current-password" required />
                    <TextField name="code" label="Current 6-digit code" inputMode="numeric" required maxLength={6} />
                    <SubmitButton variant="danger">Turn off</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </>
          ) : qr && secret ? (
            <>
              <p className="text-sm">
                1. Scan with Google Authenticator, Microsoft Authenticator, 1Password or similar.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-md bg-white p-1" />
              <p className="text-xs text-muted">
                Can&apos;t scan? Enter this key: <code className="select-all break-all">{secret}</code>
              </p>
              <p className="text-sm">2. Enter the code it shows:</p>
              <TotpConfirm action={confirmTotpSetupAction} />
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Adds a 6-digit code from your phone at sign-in. Required before going live.</p>
              <ActionForm action={startTotpSetupAction}>
                <FormMessage />
                <SubmitButton>Set up two-factor authentication</SubmitButton>
              </ActionForm>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold">Change password</h2>
          <ActionForm action={changePasswordAction} className="space-y-3" resetOnSuccess>
            <FormMessage />
            <TextField name="current" label="Current password" type="password" autoComplete="current-password" required maxLength={128} />
            <TextField name="password" label="New password" type="password" autoComplete="new-password" required maxLength={128} hint="At least 12 characters" />
            <TextField name="confirm" label="Confirm new password" type="password" autoComplete="new-password" required maxLength={128} />
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold">Your profile</h2>
          <ActionForm action={updateProfileAction} className="space-y-3">
            <FormMessage />
            <TextField name="name" label="Name" required defaultValue={user.name} maxLength={100} autoComplete="name" />
            <TextField name="email" label="Sign-in email" type="email" required defaultValue={user.email} maxLength={254} autoComplete="username" />
            <TextField name="password" label="Current password" type="password" autoComplete="current-password" maxLength={128} hint="Only needed when changing your email" />
            <SubmitButton>Save profile</SubmitButton>
          </ActionForm>
        </section>

        <section className="card lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">Signed-in devices</h2>
            {sessions.length > 1 && (
              <ActionForm action={revokeOtherSessionsAction} confirm="Sign out all other devices?">
                <SubmitButton variant="default">Sign out all others</SubmitButton>
              </ActionForm>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Signed in</th>
                  <th>Last active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-xs truncate" title={s.userAgent ?? ""}>
                      {s.userAgent ?? "Unknown"}
                    </td>
                    <td>{s.ip ?? "—"}</td>
                    <td>{fmt(s.createdAt)}</td>
                    <td>{fmt(s.lastSeenAt)}</td>
                    <td>
                      {s.id === current?.id ? (
                        <Badge tone="accent">This device</Badge>
                      ) : (
                        <ActionForm action={revokeSessionAction}>
                          <input type="hidden" name="sessionId" value={s.id} />
                          <button type="submit" className="text-xs text-bad hover:underline">
                            Sign out
                          </button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
