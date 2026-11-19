import { currentTeacher } from "@/modules/exam-prep/auth";
import { exportQuestions } from "@/modules/exam-prep/services/papers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentTeacher())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const data = await exportQuestions(decodeURIComponent(id));
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${data.paper.id}-questions.json"`, "Cache-Control": "no-store" } });
}
