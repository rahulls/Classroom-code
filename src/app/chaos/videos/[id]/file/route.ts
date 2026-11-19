import fs from "node:fs";
import { Readable } from "node:stream";
import { requirePermission } from "@/core/auth/guard";
import { getJob, videoPath } from "@/modules/chaos/jobs";

/**
 * The finished MP4. Streams with HTTP Range support so the in-page player can seek
 * without loading the whole (possibly 300 MB+) file. ?download=1 saves it instead.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const job = getJob(id);
  if (!job || job.status.stage !== "done") return new Response("Not found", { status: 404 });
  const file = videoPath(id);
  const size = fs.statSync(file).size;
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = `${job.title.replace(/[^\w\- ]+/g, "").trim() || "quiz"} (${job.format === "shorts" ? "Shorts" : "YouTube"}).mp4`;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };

  const range = req.headers.get("range");
  const m = range && !download ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1, start + 8 * 1024 * 1024 - 1); // at most 8 MB per request
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
