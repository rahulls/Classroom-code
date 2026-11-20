import { currentTeacher } from "@/modules/exam-prep/auth";
import { examPrepEnabled } from "@/modules/exam-prep/config";
import { epdb } from "@/modules/exam-prep/db";
import { rowsToCsv, type AnswerRow } from "@/modules/exam-prep/domain/answer-rows";
import { QUESTIONS_CSV_TEMPLATE } from "@/modules/exam-prep/services/papers";

// CSV downloads for the teacher: the question-import template, a marking format, a paper's answer rows.
export async function GET(req: Request) {
  if (!examPrepEnabled()) return new Response("Not found", { status: 404 });
  if (!(await currentTeacher())) return new Response("Forbidden", { status: 403 });
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind");
  let name = "template.csv";
  let body: string | null = null;
  if (kind === "questions") {
    name = "questions-template.csv";
    body = QUESTIONS_CSV_TEMPLATE;
  } else if (kind === "format-template") {
    name = "marking-format-template.csv";
    body = "answer,max,section,chapter,choice\n1,1,A,Real Numbers,\n1.1,1,A,,\n2.a,2,B,,\n2.b,2,B,,\n3.A,3,C,,3\n3.B,3,C,,3\n4.i,1,E,,\n4.ii,1,E,,\n4.iii.A,2,E,,4.iii\n4.iii.B,2,E,,4.iii\n";
  } else if (kind === "format") {
    const f = await epdb.markingFormat.findUnique({ where: { id: u.searchParams.get("id") ?? "" } });
    if (f) {
      name = `format-class${f.klass}-${f.board}-${f.subject}.csv`.replace(/[^\w.-]+/g, "-");
      body = rowsToCsv(f.rows as AnswerRow[]);
    }
  } else if (kind === "rows") {
    const p = await epdb.paper.findUnique({ where: { id: u.searchParams.get("paper") ?? "" } });
    if (p?.answerRows) {
      name = `${p.id}-answer-rows.csv`;
      body = rowsToCsv(p.answerRows as AnswerRow[]);
    }
  }
  if (body == null) return new Response("Not found", { status: 404 });
  return new Response("﻿" + body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
