import { notFound } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { db } from "@/core/db";
import { setupOwnerAction } from "@/modules/auth/actions";

export const metadata = { title: "First-time setup" };

export default async function SetupPage() {
  // Once an account exists this page no longer exists.
  if ((await db.user.count()) > 0) notFound();

  return (
    <ActionForm action={setupOwnerAction} className="space-y-4">
      <h1 className="text-base font-semibold">Create the Owner account</h1>
      <p className="text-sm text-muted">
        This page works only once. Paste the setup token that <code>npm run setup</code> printed (it&apos;s also <code>SETUP_TOKEN</code> in <code>.env</code>).
      </p>
      <FormMessage />
      <TextField name="setupToken" label="Setup token" type="password" autoComplete="off" required maxLength={200} />
      <TextField name="name" label="Your name" autoComplete="name" required maxLength={100} defaultValue="Rahul Shah" />
      <TextField name="email" label="Email" type="email" autoComplete="username" required maxLength={254} />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" required maxLength={128} hint="At least 12 characters. A passphrase works well." />
      <TextField name="confirm" label="Confirm password" type="password" autoComplete="new-password" required maxLength={128} />
      <SubmitButton className="w-full">Create account</SubmitButton>
    </ActionForm>
  );
}
