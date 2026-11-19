import { headers } from "next/headers";
import { ActionForm, FormMessage, SubmitButton, TextField } from "@/components/form";
import { disconnectYoutubeAction, saveYoutubeClientAction } from "@/modules/chaos/actions";
import { redirectUriFor, youtubeConnection } from "@/modules/chaos/youtube";

export const metadata = { title: "YouTube" };

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function YoutubePage({ searchParams }: { searchParams: Promise<{ yt?: string; msg?: string }> }) {
  const sp = await searchParams;
  const conn = youtubeConnection();
  const h = await headers();
  const redirectUri = redirectUriFor(h);
  const onLocalhost = /^http:\/\/localhost(:\d+)?\//.test(redirectUri);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#2a1260]">YouTube</h1>
        <p className="text-sm text-muted">Connect your channel once, then publish any finished video from its page with its thumbnail.</p>
      </div>

      {sp.yt === "connected" && <p className="card border-ok text-sm text-ok">✓ YouTube is connected.</p>}
      {sp.yt === "error" && <p className="card border-bad text-sm text-bad">{sp.msg || "Connecting didn't work. Try again."}</p>}
      {sp.yt === "noclient" && <p className="card border-bad text-sm text-bad">Save your Google client ID and secret first (step 2 below).</p>}

      <section className="card space-y-3">
        <h2 className="font-semibold text-[#2a1260]">Connection</h2>
        {conn.connected ? (
          <>
            <p className="text-sm">
              <span className="font-semibold text-ok">✓ Connected</span> to <b>{conn.channelTitle}</b>
              {conn.connectedAt ? <span className="text-muted"> since {fmtDate(conn.connectedAt)}</span> : null}.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/chaos/youtube/connect" className="btn">
                Switch channel / reconnect
              </a>
              <ActionForm action={disconnectYoutubeAction} confirm="Disconnect YouTube? The studio won't be able to upload until you connect again.">
                <FormMessage />
                <SubmitButton variant="danger">Disconnect</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : (
          <>
            {conn.problem && <p className="text-sm text-bad">{conn.problem}</p>}
            <p className="text-sm text-muted">
              {conn.clientId && conn.hasSecret ? "Your Google client is saved. Connect your channel:" : "Do steps 1 and 2 below first, then connect."}
            </p>
            {conn.clientId && conn.hasSecret ? (
              <a href="/chaos/youtube/connect" className="btn-primary inline-block">
                ▶ Connect YouTube
              </a>
            ) : (
              <span className="btn-primary inline-block cursor-not-allowed opacity-50">▶ Connect YouTube</span>
            )}
          </>
        )}
        {!onLocalhost && (
          <p className="rounded bg-warn/10 p-2 text-xs text-warn">
            You opened the studio at <code>{redirectUri.replace(/\/chaos.*$/, "")}</code>. Google only allows plain-http sign-in on <b>localhost</b>, so connect from this laptop
            at <code>http://localhost:4310/chaos/youtube</code>. Once connected, uploading works from anywhere.
          </p>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-[#2a1260]">Step 2: your Google client</h2>
        <p className="text-sm text-muted">Paste the two values from Google Cloud (step 1 below). The secret is stored encrypted on this laptop and never shown again.</p>
        <ActionForm action={saveYoutubeClientAction} className="space-y-3">
          <FormMessage />
          <TextField name="clientId" label="Client ID" required defaultValue={conn.clientId} placeholder="1234567890-abc….apps.googleusercontent.com" autoComplete="off" />
          <TextField
            name="clientSecret"
            label="Client secret"
            required={!conn.hasSecret}
            type="password"
            placeholder={conn.hasSecret ? "Saved (leave empty to keep it)" : "GOCSPX-…"}
            autoComplete="off"
          />
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>

      <details className="card" open={!conn.clientId}>
        <summary className="cursor-pointer font-semibold text-[#2a1260]">Step 1: set up Google Cloud (once, about 10 minutes)</summary>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm">
          <li>
            Open <b>console.cloud.google.com</b> signed in with the Google account that owns the Chaos Creators channel. Top bar → project picker → <b>New project</b>, name it{" "}
            <i>Chaos Creators Studio</i> → Create, and make sure it's selected.
          </li>
          <li>
            Menu → <b>APIs &amp; Services → Library</b> → search <b>YouTube Data API v3</b> → <b>Enable</b>.
          </li>
          <li>
            Menu → <b>Google Auth Platform</b> (called “OAuth consent screen” in some accounts) → <b>Get started</b>: app name <i>Chaos Creators Studio</i>, your email as
            support email → Audience <b>External</b> → your email as contact → agree → <b>Create</b>.
          </li>
          <li>
            <b>Audience</b> page → under <i>Test users</i> add your own Gmail address. Then click <b>Publish app</b> (→ “In production”). Without publishing, Google cancels
            the permission every 7 days and you'd have to reconnect weekly. You don't need Google's app verification: it's only you using it.
          </li>
          <li>
            <b>Clients → Create client</b> → Application type <b>Web application</b>, name <i>Chaos Studio</i>. Under <b>Authorized redirect URIs</b> → Add URI and paste
            exactly:
            <code className="mt-1 block select-all break-all rounded bg-soft p-2 text-xs">{onLocalhost ? redirectUri : "http://localhost:4310/chaos/youtube/callback"}</code>
            Leave “Authorized JavaScript origins” empty → <b>Create</b>.
          </li>
          <li>
            Copy the <b>Client ID</b> and <b>Client secret</b> it shows into step 2 above and Save. Then click <b>Connect YouTube</b>.
          </li>
          <li>
            On Google's page: choose your account, and if it lists channels, the <b>Chaos Creators</b> one. Google will warn “Google hasn't verified this app”, which is
            expected for your own app: click <b>Advanced → Go to Chaos Creators Studio</b>, then tick both permissions and <b>Continue</b>.
          </li>
        </ol>
      </details>

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold text-[#2a1260]">Good to know</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-muted">
          <li>
            <b>Uploads start as private.</b> YouTube keeps videos uploaded through a new, un-audited Google project private. Request the free audit (search “YouTube API
            Services audit and quota extension form”) to publish straight from here; until then, set each video public in YouTube Studio, or upload it by hand if YouTube
            won't let you change it.
          </li>
          <li>
            <b>Custom thumbnails</b> need a verified channel (youtube.com/verify, a one-time phone check). Without it the video still uploads, and you can send the
            thumbnail later from the video page.
          </li>
          <li>
            <b>About 6 uploads a day.</b> Google's free allowance is 10,000 units a day and each upload costs 1,600.
          </li>
          <li>
            Your Google password never reaches this app. To cut access any time: Disconnect above, or remove the app at myaccount.google.com/permissions.
          </li>
        </ul>
      </section>
    </div>
  );
}
