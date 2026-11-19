import { redirect } from "next/navigation";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { db } from "@/core/db";
import { getSession } from "@/core/auth/session";
import { loginAction } from "@/modules/auth/actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  if ((await db.user.count()) === 0) redirect("/setup");
  const session = await getSession();
  if (session && !session.mfaPending) redirect("/today");
  const { setup } = await searchParams;

  return (
    <ActionForm action={loginAction} className="space-y-4">
      <h1 className="text-base font-semibold">Sign in</h1>
      {setup === "done" && <p className="rounded-md bg-ok/10 px-3 py-2 text-sm text-ok">Owner account created. Sign in to continue.</p>}
      <FormMessage />
      <TextField name="email" label="Email" type="email" autoComplete="username" required autoFocus maxLength={254} />
      <TextField name="password" label="Password" type="password" autoComplete="current-password" required maxLength={128} />
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}
