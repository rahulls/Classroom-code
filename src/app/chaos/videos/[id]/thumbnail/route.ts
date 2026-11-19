import fs from "node:fs";
import { requirePermission } from "@/core/auth/guard";
import { getJob, thumbPath } from "@/modules/chaos/jobs";

/** The video's thumbnail (JPEG). ?download=1 saves it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const job = getJob(id);
  if (!job?.thumb) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = `${job.title.replace(/[^\w\- ]+/g, "").trim() || "quiz"} thumbnail.jpg`;
  return new Response(new Uint8Array(fs.readFileSync(thumbPath(id))), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable", // the URL carries ?v=<change time>
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
