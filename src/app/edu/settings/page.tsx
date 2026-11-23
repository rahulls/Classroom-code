import Link from "next/link";
import { ActionForm, CheckboxField, FormMessage, SubmitButton, TextField } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { saveClaudeKeyAction } from "@/modules/chaos/actions";
import { claudeKeyStatus } from "@/modules/chaos/generate";
import { youtubeConnection } from "@/modules/chaos/youtube";
import { disconnectEduYoutubeAction, resetInstructionsAction, saveLogoAction, saveSettingsAction } from "@/modules/edu/actions";
import { channelName, logoFile } from "@/modules/edu/brand";
import { getSettings } from "@/modules/edu/store";
import { VOICES, voiceLabel } from "@/modules/edu/voices";
import { getInstructions } from "@/modules/edu/writer";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function EduSettingsPage({ searchParams }: { searchParams: Promise<{ yt?: string; msg?: string }> }) {
  const q = await searchParams;
  const s = getSettings();
  const key = claudeKeyStatus();
  const yt = youtubeConnection("edu");
  const chaos = youtubeConnection("chaos");
  const name = channelName();
  const logo = logoFile();
  const ins = getInstructions();
  return (
    <>
      <PageHeader title="Settings" subtitle="The Edu channel, how often videos go up, and how far ahead scripts are written. Times are India time." />

      {q.yt === "connected" && <p className="card mb-5 max-w-2xl border-ok/40 text-sm text-ok">Connected to {yt.channelTitle}. Videos will be uploaded there, as private.</p>}
      {q.yt === "error" && <p className="card mb-5 max-w-2xl border-bad/40 text-sm text-bad">{q.msg || "Couldn't connect."}</p>}
      {q.yt === "noclient" && <p className="card mb-5 max-w-2xl border-bad/40 text-sm text-bad">The Google OAuth client isn't set up yet. Add it on Chaos Creators → YouTube first.</p>}

      {!key.ok && (
        <ActionForm action={saveClaudeKeyAction} className="card mb-5 max-w-2xl space-y-3 border-bad/40">
          <h2 className="font-semibold text-bad">Claude API key needed</h2>
          <p className="text-sm text-muted">
            Scripts are written by Claude. Create a key at console.anthropic.com (API keys) and paste it here. It is stored encrypted on this PC and shared with the Chaos Creators studio.
          </p>
          <TextField name="apiKey" label="Claude API key" type="password" required placeholder="sk-ant-…" autoComplete="off" />
          <div className="space-y-2">
            <SubmitButton>Save key</SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>
      )}

      <section className={`card mb-5 max-w-2xl space-y-3 ${yt.connected ? "" : "border-bad/40"}`}>
        <h2 className="font-semibold">YouTube channel</h2>
        {yt.connected ? (
          <>
            <p className="text-sm">
              Uploading to <b>{yt.channelTitle}</b>
              {yt.channelId && (
                <>
                  {" "}
                  (
                  <a className="text-accent underline" href={`https://studio.youtube.com/channel/${yt.channelId}`} target="_blank" rel="noreferrer">
                    YouTube Studio
                  </a>
                  )
                </>
              )}
              . Always as private.
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="btn" href="/chaos/youtube/connect?channel=edu&back=/edu/settings">
                Connect a different channel
              </a>
              <ActionForm action={disconnectEduYoutubeAction}>
                <SubmitButton variant="danger">Disconnect</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {yt.problem ?? "Not connected: videos are still written, made and reviewed, and wait as “ready” until you connect; then they go up one per slot."} On Google's page, choose the account or brand account that owns the new Edu channel, not Chaos
              Creators{chaos.channelTitle ? ` (${chaos.channelTitle})` : ""}. This doesn't change the Chaos Creators connection.
            </p>
            {yt.clientId && yt.hasSecret ? (
              <a className="btn-primary inline-block" href="/chaos/youtube/connect?channel=edu&back=/edu/settings">
                Connect the Edu channel
              </a>
            ) : (
              <p className="text-sm">
                First add the Google OAuth client on{" "}
                <Link className="text-accent underline" href="/chaos/youtube">
                  Chaos Creators → YouTube
                </Link>
                . The Edu channel uses the same one.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card mb-5 max-w-2xl space-y-3">
        <h2 className="font-semibold">Channel logo</h2>
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/edu/logo" alt="Channel logo" width={72} height={72} className="h-[72px] w-[72px] rounded-full bg-white/10 object-contain" />
          ) : (
            <span className="text-sm text-muted">No logo yet: videos and thumbnails are made without one.</span>
          )}
        </div>
        <ActionForm action={saveLogoAction} className="space-y-2">
          <label className="block">
            <span className="label">
              Logo<span className="text-bad"> *</span>
            </span>
            <input type="file" name="file" accept=".png,.jpg,.jpeg,.webp" required className="input" />
            <span className="mt-1 block text-xs text-muted">Square PNG, JPG or WebP, under 5 MB. A square picture is cut to a circle; a round PNG with a transparent background is used as it is.</span>
          </label>
          <SubmitButton>Save logo</SubmitButton>
          <FormMessage />
        </ActionForm>
        {logo && (
          <ActionForm action={saveLogoAction}>
            <input type="hidden" name="remove" value="1" />
            <SubmitButton variant="default" className="text-xs">
              Remove logo
            </SubmitButton>
          </ActionForm>
        )}
      </section>

      <section className="card mb-5 max-w-2xl space-y-2">
        <h2 className="font-semibold">Script instructions</h2>
        <p className="text-sm text-muted">
          {ins.custom
            ? `New scripts use your saved instructions (saved ${new Date(ins.savedAt ?? "").toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}).`
            : "New scripts use the built-in instructions."}{" "}
          To change them, open any script under review, use “Edit the prompt and regenerate”, and tick “Also use these instructions for every new script”.
        </p>
        {ins.custom && (
          <ActionForm action={resetInstructionsAction} confirm="Go back to the built-in instructions for new scripts?">
            <SubmitButton variant="default" className="text-xs">
              Reset to the built-in instructions
            </SubmitButton>
            <FormMessage />
          </ActionForm>
        )}
      </section>

      <ActionForm action={saveSettingsAction} className="card max-w-2xl space-y-5">
        <TextField
          name="channelName"
          label="Channel name"
          defaultValue={s.channelName}
          maxLength={60}
          placeholder={yt.channelTitle ?? "e.g. the new channel's name"}
          hint={`Said in each video's ending ("Follow … for more") and in the description. ${s.channelName ? "" : name ? `Empty: uses "${name}" from YouTube.` : "Empty for now: endings say “Subscribe for more” without a name."}`}
        />
        <section className="grid gap-3 sm:grid-cols-2">
          <TextField name="intervalHours" label="One video every (hours)" type="number" min={1} max={168} defaultValue={s.intervalHours} required hint="8 = three a day. Lower it once you're confident." />
          <TextField name="firstSlot" label="Slots counted from" defaultValue={s.firstSlot} required placeholder="10:00" hint="With 8 hours and 10:00: 10:00, 18:00, 02:00…" />
          <TextField name="keepAhead" label="Keep this many topics ahead of upload" type="number" min={1} max={15} defaultValue={s.keepAhead} required hint="Scripts are written as soon as fewer are being written, waiting for review, being made or ready. 5 = always 4-5 ahead." />
          <TextField name="minReady" label="Approved videos to keep ready" type="number" min={0} max={10} defaultValue={s.minReady} required hint="You get an alert when fewer approved videos are waiting for the next uploads." />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">
            Narrator voices<span className="text-bad"> *</span>
          </h3>
          <p className="text-xs text-muted">Each video gets one of the ticked voices, in a shuffled order: every voice once per round, never the same voice twice in a row. Samples: src/Edu videos/voice samples.</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {VOICES.map((v) => (
              <label key={v.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="voices[]" value={v.id} defaultChecked={s.voices.includes(v.id)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                <span>{voiceLabel(v.id)}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="space-y-2">
          <CheckboxField name="canvaThumbnail" label="Canva makes the thumbnail" defaultChecked={s.canvaThumbnail} hint="If Canva can't, a minimal thumbnail is made and you get an alert." />
          <CheckboxField name="canvaPictures" label="Canva makes the pictures for picture scenes" defaultChecked={s.canvaPictures} hint="If Canva can't, the scene becomes a plain text card and you get an alert." />
        </section>
        <TextField name="defaultKicker" label="Top label when the script has none" defaultValue={s.defaultKicker} required maxLength={28} />
        <p className="text-xs text-muted">Videos are always uploaded as private. Background music is never added.</p>
        <div className="space-y-2">
          <SubmitButton>Save settings</SubmitButton>
          <FormMessage />
        </div>
      </ActionForm>
    </>
  );
}
