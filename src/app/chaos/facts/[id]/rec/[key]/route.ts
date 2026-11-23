import fs from "node:fs";
import { requirePermission } from "@/core/auth/guard";
import { CARD_KEY_RE, recordingPath } from "@/modules/chaos/facts-drafts";

const TYPES: Record<string, string> = { webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav" };

/** One recording from a facts video's recording deck, for playback in the deck. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  await requirePermission("settings.manage");
  const { id, key } = await params;
  if (!CARD_KEY_RE.test(key)) return new Response("Not found", { status: 404 });
  const rec = recordingPath(id, key);
  if (!rec) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(rec.file), {
    headers: { "Content-Type": TYPES[rec.ext] ?? "application/octet-stream", "Cache-Control": "private, no-store" },
  });
}
