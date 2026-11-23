import { requirePermission } from "@/core/auth/guard";
import { SAMPLE_CSV } from "@/modules/chaos/csv";
import { SAMPLE_FACTS_CSV } from "@/modules/chaos/facts";

/** A filled-in questions CSV to start from (?type=facts: a facts CSV). */
export async function GET(req: Request) {
  await requirePermission("settings.manage");
  const facts = new URL(req.url).searchParams.get("type") === "facts";
  return new Response("﻿" + (facts ? SAMPLE_FACTS_CSV : SAMPLE_CSV), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${facts ? "chaos-facts.csv" : "chaos-quiz-questions.csv"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
