import { currentTeacher } from "@/modules/exam-prep/auth";
import { labelsCsv } from "@/modules/exam-prep/services/messaging";

/** Labels for the WhatsApp Business app (R9). Codes and labels only unless ?names=1. Teacher-only. */
export async function GET(req: Request) {
  if (!(await currentTeacher())) return new Response("Forbidden", { status: 403 });
  const withNames = new URL(req.url).searchParams.get("names") === "1";
  return new Response(await labelsCsv(withNames), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="exam-prep-labels.csv"`, "Cache-Control": "no-store" },
  });
}
