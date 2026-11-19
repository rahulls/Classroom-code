import { requirePermission } from "@/core/auth/guard";
import { getJob } from "@/modules/chaos/jobs";
import { getUpload } from "@/modules/chaos/youtube";

/** YouTube upload progress for one video, polled by the video page while uploading. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  if (!getJob(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(getUpload(id), { headers: { "Cache-Control": "no-store" } });
}
