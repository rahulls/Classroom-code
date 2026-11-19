import { requirePermission } from "@/core/auth/guard";
import { SAMPLE_CSV } from "@/modules/chaos/csv";

/** A filled-in questions CSV to start from. */
export async function GET() {
  await requirePermission("settings.manage");
  return new Response("﻿" + SAMPLE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chaos-quiz-questions.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
