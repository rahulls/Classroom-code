import { requirePermission } from "@/core/auth/guard";
import { SAMPLE_TOPICS_CSV } from "@/modules/edu/csv";

export async function GET() {
  await requirePermission("settings.manage");
  return new Response(SAMPLE_TOPICS_CSV, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="edu-topics-sample.csv"' } });
}
