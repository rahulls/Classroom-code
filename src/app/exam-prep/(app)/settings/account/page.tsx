import Link from "next/link";
import { passwordAction, twoStepAction } from "@/modules/exam-prep/actions";
import { requireTeacher, startTwoStep } from "@/modules/exam-prep/auth";
import { epdb } from "@/modules/exam-prep/db";
import { EpForm, Field, Msg, Submit } from "../../../ui";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const t = await requireTeacher();
  const setup = t.twoStep ? null : await startTwoStep(t.id);
  const signIns = await epdb.signInLog.findMany({ orderBy: { at: "desc" }, take: 15 });
  return (
    <div className="max-w-2xl space-y-5">
      <Link href="/exam-prep/settings" className="text-sm text-accent hover:underline">
        ← Settings
      </Link>
      <h1 className="text-2xl font-bold text-[#0f3460]">Account</h1>
      <section className="card space-y-3 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Two-step verification</h2>
        {t.twoStep ? (
          <p className="text-ok">On. Sign-in asks for the 6-digit code from your authenticator app.</p>
        ) : (
          setup && (
            <EpForm action={twoStepAction} className="space-y-2">
              <Msg />
              <p>Scan with Google Authenticator (or similar), then enter the code it shows.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="Two-step QR code" width={200} height={200} />
              <p className="font-mono text-xs text-muted">Or type: {setup.secret}</p>
              <input type="hidden" name="secret" value={setup.secret} />
              <Field label="Code" req>
                <input name="code" inputMode="numeric" required className="input w-32" />
              </Field>
              <Submit>Turn on</Submit>
            </EpForm>
          )
        )}
      </section>
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Change password</h2>
        <EpForm action={passwordAction} className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Msg />
          </div>
          <input name="current" type="password" placeholder="Current" required className="input" />
          <input name="next" type="password" placeholder="New (10+ characters)" required className="input" />
          <input name="confirm" type="password" placeholder="Confirm" required className="input" />
          <Submit tone="plain">Change</Submit>
        </EpForm>
      </section>
      <section className="card text-sm">
        <h2 className="mb-2 font-semibold text-[#0f3460]">Recent sign-ins</h2>
        <ul>
          {signIns.map((s) => (
            <li key={s.id} className={s.ok ? "" : "text-bad"}>
              {s.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {s.ok ? "signed in" : `failed (${s.reason})`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
