import fs from "node:fs";
import path from "node:path";
import { requirePermission } from "@/core/auth/guard";
import { CHAOS_ASSETS } from "@/modules/chaos/jobs";
import { COUNTRIES, FLAG_CODE_RE } from "@/modules/chaos/flags";

/** One country's flag picture (the Flags tab's preview). */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  await requirePermission("settings.manage");
  const { code } = await params;
  const c = code.replace(/\.png$/, "");
  if (!FLAG_CODE_RE.test(c) || !(c in COUNTRIES)) return new Response("Not found", { status: 404 });
  const file = path.join(CHAOS_ASSETS, "flags", `${c}.png`);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=604800" },
  });
}
