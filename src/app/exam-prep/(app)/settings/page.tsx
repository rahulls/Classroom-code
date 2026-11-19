import Link from "next/link";
import { settingAction } from "@/modules/exam-prep/actions";
import { getSettings, SETTINGS, type SettingKey } from "@/modules/exam-prep/settings";
import { EpForm, Msg, Submit } from "../../ui";

export const metadata = { title: "Settings" };

/** R14: every threshold, price, time and switch, validated and audited on change. */
export default async function SettingsPage() {
  const s = await getSettings();
  const groups = [...new Set(Object.values(SETTINGS).map((d) => d.group))];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Settings</h1>
        <div className="ml-auto flex gap-2 text-sm">
          <Link href="/exam-prep/settings/chapters" className="btn">
            Chapter lists
          </Link>
          <Link href="/exam-prep/settings/account" className="btn">
            Account and two-step
          </Link>
          <Link href="/exam-prep/privacy" className="btn">
            Privacy
          </Link>
          <Link href="/exam-prep/audit" className="btn">
            Audit log
          </Link>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g} className="card space-y-2">
          <h2 className="font-semibold text-[#0f3460]">{g}</h2>
          {(Object.entries(SETTINGS) as [SettingKey, (typeof SETTINGS)[SettingKey]][])
            .filter(([, d]) => d.group === g)
            .map(([key, d]) => {
              const v = s[key] as unknown;
              const secret = "secret" in d && d.secret;
              const isObj = v !== null && typeof v === "object";
              const shown = secret ? (key === "delivery.smtp" ? JSON.stringify({ ...(v as object), pass: (v as { pass: string }).pass ? "(saved)" : "" }) : v ? "" : "") : isObj ? JSON.stringify(v, null, 1) : String(v ?? "");
              return (
                <EpForm key={key} action={settingAction} reset={false} className="grid items-start gap-2 border-t border-line pt-2 text-sm sm:grid-cols-[16rem_1fr_auto]">
                  <input type="hidden" name="key" value={key} />
                  <span>
                    {d.label}
                    <code className="block text-[10px] text-muted">{key}</code>
                  </span>
                  <div>
                    {typeof d.default === "boolean" ? (
                      <select name="value" defaultValue={String(v)} className="input w-auto">
                        <option value="true">On</option>
                        <option value="false">Off</option>
                      </select>
                    ) : isObj ? (
                      <textarea name="value" defaultValue={shown} rows={Math.min(12, shown.split("\n").length + 1)} className="input font-mono text-xs" />
                    ) : (
                      <input name="value" type={secret ? "password" : key === "programme.startDate" ? "date" : "text"} defaultValue={secret ? "" : shown} placeholder={secret ? (v ? "(saved; type to replace)" : "not set") : undefined} className="input" />
                    )}
                    <Msg />
                  </div>
                  <Submit tone="plain" className="px-3 py-1">
                    Save
                  </Submit>
                </EpForm>
              );
            })}
        </section>
      ))}
    </div>
  );
}
