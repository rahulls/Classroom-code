import { currentTeacher } from "@/modules/exam-prep/auth";
import { checkLink, storage } from "@/modules/exam-prep/adapters/storage";
import { examPrepEnabled } from "@/modules/exam-prep/config";

// Private files: only through a signed link that expires in 5 minutes, AND with the teacher signed in.
// Anything else gets 403 (R11). Files are never public.
export async function GET(req: Request) {
  if (!examPrepEnabled()) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const p = u.searchParams.get("p") ?? "";
  if (!(await currentTeacher()) || !checkLink(p, u.searchParams.get("e") ?? "", u.searchParams.get("s") ?? "")) return new Response("Forbidden", { status: 403 });
  if (!storage.exists(p)) return new Response("Not found", { status: 404 });
  const bytes = await storage.read(p);
  const type = p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".png") ? "image/png" : p.endsWith(".zip") ? "application/zip" : /\.jpe?g$/.test(p) ? "image/jpeg" : "application/octet-stream";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${u.searchParams.has("download") ? "attachment" : "inline"}; filename="${p.split("/").pop()}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
