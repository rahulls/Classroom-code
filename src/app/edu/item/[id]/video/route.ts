import fs from "node:fs";
import { Readable } from "node:stream";
import { requirePermission } from "@/core/auth/guard";
import { videoFile } from "@/modules/edu/making";
import { getRow } from "@/modules/edu/store";

/** The finished MP4, streamed with HTTP Range support so the player can seek. ?download=1 saves it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  if (!/^[a-z0-9]{6,40}$/.test(id) || !getRow(id)) return new Response("Not found", { status: 404 });
  const file = videoFile(id);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const size = fs.statSync(file).size;
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="edu-video-${id}.mp4"`,
  };
  const range = req.headers.get("range");
  const m = range && !download ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1, start + 8 * 1024 * 1024 - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
