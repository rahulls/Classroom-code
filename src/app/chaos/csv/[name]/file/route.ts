import { requirePermission } from "@/core/auth/guard";
import { readLibraryCsv } from "@/modules/chaos/jobs";
import { nameFromParam } from "../../links";

/** Download one CSV from the library (csv\ folder) as it is on disk. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  await requirePermission("settings.manage");
  const csv = readLibraryCsv(nameFromParam((await params).name));
  if (!csv) return new Response("Not found", { status: 404 });
  // BOM so Excel opens it as UTF-8 (₹, emojis)
  return new Response("\uFEFF" + csv.content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(csv.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
