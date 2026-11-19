import { redirect } from "next/navigation";
import { currentTeacher, hasAccount } from "@/modules/exam-prep/auth";
import { loginAction } from "@/modules/exam-prep/actions";
import { EpForm, Field, Msg, Submit } from "../../ui";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (!(await hasAccount())) redirect("/exam-prep/setup");
  if (await currentTeacher()) redirect("/exam-prep");
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-2xl font-bold text-[#0f3460]">Exam Prep</h1>
      <p className="mb-6 text-sm text-muted">Weekly test papers · teacher sign-in</p>
      <EpForm action={loginAction} reset={false} className="card space-y-3">
        <Msg />
        <Field label="Username" req>
          <input name="username" autoComplete="username" required className="input" />
        </Field>
        <Field label="Password" req>
          <input name="password" type="password" autoComplete="current-password" required className="input" />
        </Field>
        <Field label="Two-step code" hint="Only if two-step verification is on">
          <input name="code" inputMode="numeric" autoComplete="one-time-code" className="input" />
        </Field>
        <Submit>Sign in</Submit>
      </EpForm>
    </main>
  );
}
