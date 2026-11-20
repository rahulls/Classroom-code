import { ActionForm, SubmitButton } from "@/components/form";
import { disconnectCanvaAction } from "@/modules/chaos/actions";
import { canvaConnection } from "@/modules/chaos/canva";

export const metadata = { title: "Canva" };

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function CanvaPage({ searchParams }: { searchParams: Promise<{ canva?: string; msg?: string }> }) {
  const sp = await searchParams;
  const conn = canvaConnection();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#2a1260]">Canva</h1>
        <p className="text-sm text-muted">
          Connect your Canva account once. Then Canva&apos;s AI can design each video&apos;s thumbnail and its intro and ending artwork (tick “Canva designs” in the studio, or press
          🎨 Canva thumbnail on a finished video). Every design is also saved in your Canva folder “Chaos Creators - Video Templates”.
        </p>
      </div>
      {sp.canva === "connected" && <p className="card border-ok text-sm text-ok">✓ Canva is connected.</p>}
      {sp.canva === "error" && <p className="card border-bad text-sm text-bad">{sp.msg || "Connecting didn't work. Try again."}</p>}
      <section className="card space-y-3">
        <h2 className="font-semibold text-[#2a1260]">Connection</h2>
        {conn.connected ? (
          <>
            <p className="text-sm">
              ✓ Connected{conn.connectedAt ? <span className="text-muted"> since {fmtDate(conn.connectedAt)}</span> : null}.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/chaos/canva/connect" className="btn">
                Reconnect
              </a>
              <ActionForm action={disconnectCanvaAction} confirm="Disconnect Canva? The studio won't be able to make Canva designs until you connect again.">
                <SubmitButton variant="danger">Disconnect</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Canva will ask you to sign in and allow the studio to create and export designs.</p>
            <a href="/chaos/canva/connect" className="btn-primary inline-block">
              Connect Canva
            </a>
          </>
        )}
      </section>
    </div>
  );
}
