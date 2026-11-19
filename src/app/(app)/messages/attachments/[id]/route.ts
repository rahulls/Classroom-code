import { requirePermission } from "@/core/auth/guard";
import { db } from "@/core/db";
import { isUuid } from "@/core/validation";
import { attachmentFile } from "@/modules/messages/service";

/** A file sent with a broadcast (owner only). Pictures open in the browser; documents download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("messages.view");
  const { id } = await params;
  const a = isUuid(id) ? await db.messageAttachment.findUnique({ where: { id } }) : null;
  if (!a) return new Response("Not found", { status: 404 });
  const file = attachmentFile(a);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${a.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
