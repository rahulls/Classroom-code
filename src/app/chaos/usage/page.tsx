import { ActionForm, CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/form";
import { emailUsageReportAction, saveUsageSettingsAction } from "@/modules/chaos/actions";
import { canvaToday, istDay, loggedDays, summarise, usageSettings } from "@/modules/chaos/usage";

export const metadata = { title: "Usage" };
export const dynamic = "force-dynamic";

const fmtDay = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const rs = (n: number) => `₹${n.toFixed(n < 10 ? 1 : 0)}`;

export default function UsagePage() {
  const s = usageSettings();
  const today = summarise(istDay());
  const t = canvaToday();
  const days = loggedDays().slice(0, 30);
  if (!days.includes(today.day)) days.unshift(today.day);
  const rows = days.map((d) => summarise(d));
  const refused = Object.entries(today.canva.refused);

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#2a1260]">Usage</h1>
        <p className="text-sm text-muted">
          What Chaos Creators and Edu videos spend on Canva&apos;s AI and on the Claude API. A Canva AI action is one picture (image) or one design; waiting for a design and
          exporting it are free. The report for each day is emailed to you the next morning.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card space-y-1">
          <h2 className="font-semibold text-[#2a1260]">Canva today</h2>
          <p className="text-3xl font-bold">
            {t.made}
            <span className="text-base font-normal text-muted">{s.canvaDailyLimit > 0 ? ` of ${s.canvaDailyLimit} AI actions` : " AI actions (no limit)"}</span>
          </p>
          <p className="text-sm text-muted">
            {today.canva.images} images + {today.canva.designs} designs · about {rs(today.canva.rupees)} (estimate)
          </p>
          {refused.length > 0 && <p className="text-sm text-muted">Refused or failed: {refused.map(([k, v]) => `${v} × ${k}`).join(", ")}</p>}
          {s.canvaDailyLimit > 0 && t.left === 0 && (
            <p className="text-sm text-bad">The daily limit is used up: videos waiting for Canva carry on after midnight (or raise the limit below).</p>
          )}
        </section>
        <section className="card space-y-1">
          <h2 className="font-semibold text-[#2a1260]">Claude API today</h2>
          <p className="text-3xl font-bold">
            ${today.claude.usd.toFixed(2)}
            <span className="text-base font-normal text-muted"> · about {rs(today.claude.rupees)}</span>
          </p>
          <p className="text-sm text-muted">
            {today.claude.calls} call{today.claude.calls === 1 ? "" : "s"}
            {today.claude.failed ? ` (${today.claude.failed} failed)` : ""} · {today.claude.input.toLocaleString("en-IN")} tokens in, {today.claude.output.toLocaleString("en-IN")} out
          </p>
        </section>
      </div>

      {(today.canva.byWho.length > 0 || today.claude.byPurpose.length > 0) && (
        <section className="card space-y-3">
          <h2 className="font-semibold text-[#2a1260]">Today by video</h2>
          {today.canva.byWho.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Canva</th>
                  <th className="py-1 text-right">Images</th>
                  <th className="py-1 text-right">Designs</th>
                  <th className="py-1 text-right">Refused / failed</th>
                </tr>
              </thead>
              <tbody>
                {today.canva.byWho.map((w) => (
                  <tr key={w.who} className="border-t border-black/5">
                    <td className="py-1">{w.who}</td>
                    <td className="py-1 text-right">{w.images}</td>
                    <td className="py-1 text-right">{w.designs}</td>
                    <td className="py-1 text-right">{w.refused || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {today.claude.byPurpose.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Claude</th>
                  <th className="py-1 text-right">Calls</th>
                  <th className="py-1 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {today.claude.byPurpose.map((p) => (
                  <tr key={p.purpose} className="border-t border-black/5">
                    <td className="py-1">{p.purpose}</td>
                    <td className="py-1 text-right">{p.calls}</td>
                    <td className="py-1 text-right">${p.usd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold text-[#2a1260]">By day</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1">Day</th>
              <th className="py-1 text-right">Canva images</th>
              <th className="py-1 text-right">Canva designs</th>
              <th className="py-1 text-right">Canva ≈</th>
              <th className="py-1 text-right">Claude calls</th>
              <th className="py-1 text-right">Claude</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t border-black/5">
                <td className="py-1">{fmtDay(r.day)}</td>
                <td className="py-1 text-right">{r.canva.images}</td>
                <td className="py-1 text-right">{r.canva.designs}</td>
                <td className="py-1 text-right">{rs(r.canva.rupees)}</td>
                <td className="py-1 text-right">{r.claude.calls}</td>
                <td className="py-1 text-right">
                  ${r.claude.usd.toFixed(2)} <span className="text-muted">({rs(r.claude.rupees)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ActionForm action={emailUsageReportAction}>
          <div className="flex items-center gap-3">
            <SubmitButton variant="default">Email today&apos;s report now</SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-[#2a1260]">Settings</h2>
        <ActionForm action={saveUsageSettingsAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="canvaDailyLimit"
              label="Daily Canva limit (AI actions)"
              type="number"
              min={0}
              required
              defaultValue={String(s.canvaDailyLimit)}
              hint="When it's used up, videos waiting for Canva carry on after midnight. 0 = no limit. A 10-fact video needs about 33, a 7-question quiz about 13."
            />
            <TextField
              name="canvaSavingPercent"
              label="Fewer Canva pictures (%)"
              type="number"
              min={0}
              max={60}
              required
              defaultValue={String(s.canvaSavingPercent)}
              hint="Each video asks Canva for this much less: neighbouring facts share a background, and some quiz questions show the intro artwork."
            />
            <TextField
              name="canvaRupeesPerAction"
              label="₹ per Canva AI action (estimate)"
              required
              defaultValue={String(s.canvaRupeesPerAction)}
              hint="From your top-up: ₹384 for about 116 actions on 23 Nov."
            />
            <TextField name="rupeesPerDollar" label="₹ per US dollar" required defaultValue={String(s.rupeesPerDollar)} hint="For Claude's cost in rupees." />
          </div>
          <div className="mt-3">
            <CheckboxField name="emailReport" label="Email me the report every morning" defaultChecked={s.emailReport} hint="Around 8 am, for the day before." />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>Save</SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>
      </section>
      <p className="text-xs text-muted">Counting started on 23 Nov 2026. Exam Prep&apos;s Claude marking uses its own key and isn&apos;t counted here.</p>
    </div>
  );
}
