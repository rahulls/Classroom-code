import Link from "next/link";
import { epdb } from "@/modules/exam-prep/db";
import { sheetScore } from "@/modules/exam-prep/domain/answer-rows";
import { paperRows } from "@/modules/exam-prep/services/answer-rows";

export const metadata = { title: "Marking" };

type Sheet = { id: string; code: string; name: string; got: number; max: number; left: number; review: number; report: string | null };

/**
 * Every paper with filed sheets: how many are still to mark, and each student's sheet one click
 * away. A sheet is "left" while any answer has no mark (or, on built papers, needs review).
 */
export default async function MarkingOverview({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const sp = await searchParams;
  const papers = await epdb.paper.findMany({
    where: { submissions: { some: { isCurrent: true } } },
    include: {
      items: { select: { questionId: true } },
      submissions: { where: { isCurrent: true }, include: { student: true, rowMarks: true, marks: { select: { questionId: true, needsReview: true, marksAwarded: true } } }, orderBy: { student: { code: "asc" } } },
    },
    orderBy: [{ klass: "asc" }, { subject: "asc" }, { number: "desc" }],
  });
  const reports = await epdb.reportCard.findMany({ where: { paperId: { in: papers.map((p) => p.id) }, audience: "student" }, select: { studentId: true, paperId: true, status: true } });
  const reportOf = (studentId: string, paperId: string) => reports.find((r) => r.studentId === studentId && r.paperId === paperId)?.status ?? null;

  const list = papers.map((p) => {
    const rows = p.uploadOnly ? paperRows(p) : [];
    const sheets: Sheet[] = p.submissions.map((s) => {
      if (p.uploadOnly) {
        const sc = sheetScore(rows, s.rowMarks);
        return { id: s.id, code: s.student.code, name: s.student.name, got: sc.got, max: sc.max, left: rows.length ? sc.open : 1, review: 0, report: reportOf(s.studentId, p.id) };
      }
      const left = p.items.filter((i) => !s.marks.some((m) => m.questionId === i.questionId)).length;
      return { id: s.id, code: s.student.code, name: s.student.name, got: s.marks.reduce((a, m) => a + m.marksAwarded, 0), max: 0, left, review: s.marks.filter((m) => m.needsReview).length, report: reportOf(s.studentId, p.id) };
    });
    const open = sheets.filter((x) => x.left || x.review);
    return { p, sheets, open };
  });
  const shown = sp.all === "1" ? list : list.filter((x) => x.open.length);
  const totalOpen = list.reduce((a, x) => a + x.open.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold text-[#0f3460]">Marking</h1>
        <span className="text-sm text-muted">
          {totalOpen} sheet{totalOpen === 1 ? "" : "s"} still to mark. A report is made by itself when a sheet is fully marked.
        </span>
        <Link href={sp.all === "1" ? "?" : "?all=1"} className="ml-auto text-sm text-accent hover:underline">
          {sp.all === "1" ? "Only papers with sheets to mark" : "Show all papers"}
        </Link>
      </div>
      {shown.map(({ p, sheets, open }) => {
        const base = `/exam-prep/papers/${encodeURIComponent(p.id)}/marking`;
        return (
          <section key={p.id} className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[#0f3460]">{p.title}</b>
              <span className="font-mono text-xs text-muted">{p.id}</span>
              <span className="text-xs text-muted">
                Class {p.klass} {p.board} · {p.subject}
              </span>
              <span className="text-xs">
                {sheets.length - open.length}/{sheets.length} marked
              </span>
              <Link href={base} className="btn-primary ml-auto px-3 py-1 text-sm">
                Open marking →
              </Link>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {sheets.map((x) => {
                const pending = x.left || x.review;
                return (
                  <Link key={x.id} href={`${base}?sheet=${x.id}`} className={`rounded border px-2 py-1 text-[#1d1838] hover:bg-accent/5 ${pending ? "border-warn bg-white" : "border-line bg-[#f4fbf6]"}`}>
                    <span className="font-mono text-[#0f3460]">{x.code}</span> · {x.name}
                    {x.max ? ` · ${x.got}/${x.max}` : ""}
                    {x.left ? <span className="text-warn"> · {x.left} left</span> : x.review ? <span className="text-warn"> · {x.review} to review</span> : <span className="text-ok"> ✓</span>}
                    {!pending && x.report && <span className="text-muted"> · report {x.report === "draft" ? "to review" : x.report}</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
      {!shown.length && <p className="card text-sm text-muted">{list.length ? "Everything is marked." : "No sheets filed yet."}</p>}
    </div>
  );
}
