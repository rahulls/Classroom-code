import fs from "node:fs";
import { requirePermission } from "@/core/auth/guard";
import { thumbFile } from "@/modules/edu/making";
import { getRow } from "@/modules/edu/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  if (!/^[a-z0-9]{6,40}$/.test(id) || !getRow(id) || !fs.existsSync(thumbFile(id))) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(thumbFile(id))), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
}
