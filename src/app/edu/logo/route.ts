import fs from "node:fs";
import path from "node:path";
import { requirePermission } from "@/core/auth/guard";
import { logoFile } from "@/modules/edu/brand";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** The Edu channel's logo (Settings), for the header and the Settings page. */
export async function GET() {
  await requirePermission("settings.manage");
  const f = logoFile();
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(f)), { headers: { "Content-Type": TYPES[path.extname(f).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "private, no-store" } });
}
