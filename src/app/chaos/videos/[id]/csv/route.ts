import fs from "node:fs";
import { requirePermission } from "@/core/auth/guard";
import { jobCsv } from "@/modules/chaos/jobs";

/** Downloads the CSV a video was made from. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const csv = jobCsv(id);
  if (!csv || !fs.existsSync(csv.file)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(csv.file)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(csv.name.replace(/[\\/:*?"<>|]+/g, ""))}`,
    },
  });
}
