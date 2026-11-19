import { currentTeacher } from "@/modules/exam-prep/auth";
import { examPrepEnabled } from "@/modules/exam-prep/config";
import { pdf } from "@/modules/exam-prep/adapters/pdf";
import { formulaSheetHtml } from "@/modules/exam-prep/services/papers";

/** One-page formula sheet PDF for a chapter, from the tagged questions (R2). Teacher-only. */
export async function GET(req: Request) {
  if (!examPrepEnabled()) return new Response("Not found", { status: 404 }); // feature flag off: no Exam Prep routes
  if (!(await currentTeacher())) return new Response("Forbidden", { status: 403 });
  const u = new URL(req.url);
  const html = await formulaSheetHtml({ klass: Number(u.searchParams.get("klass")), subject: u.searchParams.get("subject") ?? "", chapter: u.searchParams.get("chapter") ?? "" });
  return new Response(new Uint8Array(await pdf.fromHtml(html)), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
