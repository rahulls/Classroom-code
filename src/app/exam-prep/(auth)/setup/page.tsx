import { redirect } from "next/navigation";
import { hasAccount } from "@/modules/exam-prep/auth";
import { setupAction } from "@/modules/exam-prep/actions";
import { EpForm, Field, Msg, Submit } from "../../ui";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if (await hasAccount()) redirect("/exam-prep/login");
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-2xl font-bold text-[#0f3460]">Set up Exam Prep</h1>
      <p className="mb-6 text-sm text-muted">Create the teacher account. It is separate from your classroom login and lives only in the Exam Prep database.</p>
      <EpForm action={setupAction} reset={false} className="card space-y-3">
        <Msg />
        <Field label="Username" req>
          <input name="username" required minLength={3} className="input" autoComplete="username" />
        </Field>
        <Field label="Password" req hint="At least 10 characters">
          <input name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" req>
          <input name="confirm" type="password" required className="input" autoComplete="new-password" />
        </Field>
        <Submit>Create account</Submit>
      </EpForm>
    </main>
  );
}
