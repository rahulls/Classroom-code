import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/core/auth/guard";
import { CHAOS_ASSETS } from "@/modules/chaos/jobs";

/** The Chaos Creators logo for the studio header. */
export async function GET() {
  await requireUser();
  const data = fs.readFileSync(path.join(CHAOS_ASSETS, "chaos_creators_logo_option2.png"));
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
}
