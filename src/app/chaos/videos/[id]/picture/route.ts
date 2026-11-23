import fs from "node:fs";
import path from "node:path";
import { requirePermission } from "@/core/auth/guard";
import { getJob, jobDir } from "@/modules/chaos/jobs";

/** One of the video's pictures (canva\q<n>-p1.png): a Canva picture, a shared copy or Rahul's upload. ?name=q3 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePermission("settings.manage");
  const { id } = await params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!/^[qs]\d{1,3}$/.test(name) || !getJob(id)) return new Response("Not found", { status: 404 });
  const file = path.join(jobDir(id), "canva", `${name}-p1.png`);
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const data = fs.readFileSync(file);
  // Uploads keep their own format under the .png name
  const type = data[0] === 0xff && data[1] === 0xd8 ? "image/jpeg" : data.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp" : "image/png";
  return new Response(new Uint8Array(data), { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
}
