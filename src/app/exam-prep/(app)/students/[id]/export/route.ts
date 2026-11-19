import { currentTeacher } from "@/modules/exam-prep/auth";
import { examPrepEnabled } from "@/modules/exam-prep/config";
import { exportStudent } from "@/modules/exam-prep/services/privacy";

/** Data-subject copy of one student as a ZIP (R11). Teacher-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!examPrepEnabled()) return new Response("Not found", { status: 404 }); // feature flag off: no Exam Prep routes
  if (!(await currentTeacher())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const z = await exportStudent(id);
  return new Response(new Uint8Array(z.bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.fileName}"`, "Cache-Control": "no-store" } });
}
