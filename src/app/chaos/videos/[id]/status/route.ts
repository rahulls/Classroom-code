import { requirePermission } from "@/core/auth/guard";
import { getJob } from "@/modules/chaos/jobs";

/** Progress of one video, polled by the video page while it is being made. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(job.status, { headers: { "Cache-Control": "no-store" } });
}
