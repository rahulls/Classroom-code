import { redirect } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { getSession } from "@/core/auth/session";
import { verifyMfaAction } from "@/modules/auth/actions";

export const metadata = { title: "Two-factor check" };

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mfaPending) redirect("/today");

  return (
    <ActionForm action={verifyMfaAction} className="space-y-4">
      <h1 className="text-base font-semibold">Two-factor check</h1>
      <p className="text-sm text-muted">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <FormMessage />
      <TextField name="code" label="Code" autoComplete="one-time-code" inputMode="numeric" required autoFocus maxLength={20} />
      <SubmitButton className="w-full">Verify</SubmitButton>
    </ActionForm>
  );
}
