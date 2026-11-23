import { requirePermission } from "@/core/auth/guard";
import { topicsToCsv } from "@/modules/edu/csv";
import { listRows } from "@/modules/edu/store";

export async function GET() {
  await requirePermission("settings.manage");
  return new Response("﻿" + topicsToCsv(listRows()), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="edu-topics.csv"' } });
}
