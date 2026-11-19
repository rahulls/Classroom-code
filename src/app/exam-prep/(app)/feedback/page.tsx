import { feedbackAction } from "@/modules/exam-prep/actions";
import { epdb } from "@/modules/exam-prep/db";
import { feedbackByGroup, feedbackSummary } from "@/modules/exam-prep/services/metrics";
import { EpForm, Msg, Submit } from "../../ui";

export const metadata = { title: "Feedback" };

/** R13: two questions after each paper (from the Google Form), one per student per paper; individual answers teacher-only. */
export default async function FeedbackPage() {
  const [all, groups, students, papers, recent] = await Promise.all([
    feedbackSummary(),
    feedbackByGroup(),
    epdb.student.findMany({ where: { status: { not: "opted_out" } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    epdb.paper.findMany({ where: { status: { not: "draft" } }, orderBy: { id: "asc" }, select: { id: true } }),
    epdb.feedback.findMany({ include: { student: true }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-[#0f3460]">Feedback</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Responses", all.responses],
          ["Too easy / right / too hard", `${all.tooEasy} / ${all.right} / ${all.tooHard}`],
          ["Average rating", all.avgRating == null ? "-" : all.avgRating.toFixed(1)],
          ["Top chapter requests", all.chapterRequests.slice(0, 3).map(([c, n]) => `${c} (${n})`).join(", ") || "-"],
        ].map(([l, v]) => (
          <div key={String(l)} className="card">
            <div className="text-xl font-bold text-[#0f3460]">{v}</div>
            <div className="text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>
      <section className="card text-sm">
        <h2 className="mb-2 font-semibold text-[#0f3460]">By paper, class and board</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Paper</th>
              <th>Class</th>
              <th>Board</th>
              <th className="text-right">Responses</th>
              <th className="text-right">Rating</th>
              <th className="text-right">Too hard</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={`${g.paperId}${g.klass}${g.board}`}>
                <td className="font-mono text-xs">{g.paperId}</td>
                <td>{g.klass}</td>
                <td>{g.board}</td>
                <td className="text-right">{g.responses}</td>
                <td className="text-right">{g.avgRating?.toFixed(1) ?? "-"}</td>
                <td className="text-right">{Math.round(g.tooHardPct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold text-[#0f3460]">Enter a response</h2>
        <EpForm action={feedbackAction} className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Msg />
          </div>
          <select name="studentId" className="input">
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </select>
          <select name="paperId" className="input">
            {papers.map((p) => (
              <option key={p.id}>{p.id}</option>
            ))}
          </select>
          <select name="difficulty" className="input">
            <option value="too_easy">Too easy</option>
            <option value="right">About right</option>
            <option value="too_hard">Too hard</option>
          </select>
          <input name="nextChapterRequest" placeholder="Which chapter next?" className="input" />
          <select name="rating" className="input">
            <option value="">No rating</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <Submit>Save</Submit>
        </EpForm>
        <ul className="divide-y divide-line">
          {recent.map((f) => (
            <li key={f.id} className="py-1">
              {f.student.code} · {f.paperId} · {f.difficulty.replace("_", " ")}
              {f.rating && ` · ${f.rating}/5`}
              {f.nextChapterRequest && ` · next: ${f.nextChapterRequest}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
