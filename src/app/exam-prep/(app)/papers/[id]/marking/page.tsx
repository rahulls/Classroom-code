import Link from "next/link";
import { notFound } from "next/navigation";
import { aiAction, markGridAction, markedAction, selfMarksAction, setMarkAction, spotRecordAction, spotSelectAction } from "@/modules/exam-prep/actions";
import { signedLink } from "@/modules/exam-prep/adapters/storage";
import { epdb } from "@/modules/exam-prep/db";
import { calibration, enteredTotal, spotCheckSummary } from "@/modules/exam-prep/services/marking";
import { getSettings } from "@/modules/exam-prep/settings";
import { ActionButton, EpForm, Msg, Submit } from "../../../../ui";
import { ReviewPanel, type ReviewItem } from "./review-panel";
import { RowMarking } from "./row-marking";

export const metadata = { title: "Marking" };

export default async function MarkingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sheet?: string; all?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const paperId = decodeURIComponent(id);
  const paper = await epdb.paper.findUnique({ where: { id: paperId }, include: { items: { include: { question: true }, orderBy: { number: "asc" } } } });
  if (!paper) notFound();
  if (paper.uploadOnly) return <RowMarking paper={paper} sheet={sp.sheet} />;
  const s = await getSettings();
  const subs = await epdb.submission.findMany({ where: { paperId, isCurrent: true }, include: { student: true, marks: true, selfMarks: true }, orderBy: { student: { code: "asc" } } });
  const onlyReview = sp.all !== "1";
  const unmarkedIn = (x: (typeof subs)[number]) => paper.items.some((i) => !x.marks.some((m) => m.questionId === i.questionId));
  const queue = subs.filter((x) => !onlyReview || x.marks.some((m) => m.needsReview) || unmarkedIn(x));
  const current = subs.find((x) => x.id === sp.sheet) ?? queue[0];
  const [spot, spotSum, cal] = await Promise.all([epdb.spotCheck.findMany({ where: { paperId }, include: { submission: { include: { student: true } } } }), spotCheckSummary(paperId), calibration()]);
  const spotRows = await Promise.all(spot.map(async (x) => ({ ...x, entered: await enteredTotal(x.submissionId) })));
  const open = subs.reduce((a, x) => a + x.marks.filter((m) => m.needsReview).length, 0);
  const unmarked = subs.reduce((a, x) => a + paper.items.filter((i) => !x.marks.some((m) => m.questionId === i.questionId)).length, 0);
  const items: ReviewItem[] = current
    ? paper.items.flatMap((it) => {
        const m = current.marks.find((x) => x.questionId === it.questionId);
        if (!m) return [];
        return [
          {
            markId: m.id,
            number: it.number,
            text: it.question.text,
            chapter: it.question.chapter,
            max: it.question.marks,
            scheme: (it.question.markingScheme as { step: string; marks: number }[]) ?? [],
            orText: it.question.orText,
            orScheme: (it.question.orMarkingScheme as { step: string; marks: number }[] | null) ?? null,
            marks: m.marksAwarded,
            aiProposed: m.aiProposed,
            aiConfidence: m.aiConfidence,
            aiReasoning: m.aiReasoning,
            errorTag: m.errorTag,
            needsReview: m.needsReview,
            source: m.source,
          },
        ];
      })
    : [];
  const sheetPath = current ? (current.files as { path: string }[])[0]?.path : null;
  return (
    <div className="space-y-5">
      <div>
        <Link href={`/exam-prep/papers/${encodeURIComponent(paperId)}`} className="text-sm text-accent hover:underline">
          ← {paperId}
        </Link>
        <h1 className="text-2xl font-bold text-[#0f3460]">Marking</h1>
        <p className="text-sm text-muted">
          {subs.length} sheets · {open} need review · {unmarked} answers without a mark · AI marking {s["marking.aiEnabled"] ? "on" : "off (proposals are for calibration and all need review)"}
        </p>
      </div>
      <section className="card flex flex-wrap items-center gap-2 text-sm">
        <ActionButton action={aiAction} fields={{ paperId }} tone="primary">
          Propose marks with AI
        </ActionButton>
        <ActionButton action={markedAction} fields={{ paperId }}>
          Finish marking (→ marked)
        </ActionButton>
        <Link href={`?${onlyReview ? "all=1" : ""}`} className="btn px-2 py-1 text-xs">
          {onlyReview ? "Show all sheets" : "Needs review only"}
        </Link>
        <span className="ml-auto text-xs text-muted">
          Calibration: {cal.sheets}/{cal.neededSheets} sheets, AI within 1 mark on {cal.agreement == null ? "-" : `${Math.round(cal.agreement)}%`} (target {cal.target}%){cal.ready ? " ✓ ready for paid tiers" : ""}
        </span>
      </section>

      <div className="flex flex-wrap gap-1 text-xs">
        {queue.map((x) => (
          <Link key={x.id} href={`?sheet=${x.id}${onlyReview ? "" : "&all=1"}`} className={`rounded border px-2 py-1 ${x.id === current?.id ? "border-accent bg-accent/10" : "border-line"}`}>
            {x.student.code} {x.marks.some((m) => m.needsReview) ? "•" : ""}
          </Link>
        ))}
        {!queue.length && <span className="text-muted">Nothing needs review.</span>}
      </div>

      {current && sheetPath && (
        <>
          <p className="text-sm">
            <b>{current.student.code}</b> {current.student.name} · {current.marks.reduce((a, m) => a + m.marksAwarded, 0)} / {paper.items.reduce((a, i) => a + i.question.marks, 0)}
          </p>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <iframe src={signedLink(sheetPath)} title={`Answer sheet ${current.student.code}`} className="h-[85vh] w-full rounded-lg border border-line bg-white lg:sticky lg:top-2" />
            <EpForm action={markGridAction} className="card space-y-2 text-sm" key={current.id}>
              <div className="flex flex-wrap items-center gap-2">
                <b>Mark this sheet</b>
                <span className="text-xs text-muted">Type marks for each question (blank = not marked yet). Error type only matters where marks were lost.</span>
              </div>
              <input type="hidden" name="submissionId" value={current.id} />
              <div className="max-h-[70vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-panel">
                      <th className="py-1">Q</th>
                      <th>Chapter</th>
                      <th className="text-right">Max</th>
                      <th className="text-right">Marks</th>
                      <th>Where lost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paper.items.map((it) => {
                      const m = current.marks.find((x) => x.questionId === it.questionId);
                      return (
                        <tr key={it.questionId} className={`border-t border-line ${m?.needsReview ? "bg-bad/10" : ""}`}>
                          <td className="py-1 font-semibold">
                            {it.number}
                            {it.question.orText ? <span className="ml-1 text-[10px] text-muted">A/B</span> : null}
                          </td>
                          <td className="max-w-[12rem] truncate" title={it.question.text}>
                            {it.question.chapter}
                          </td>
                          <td className="text-right">{it.question.marks}</td>
                          <td className="text-right">
                            <input name={`m${it.number}`} type="number" min={0} max={it.question.marks} step={0.5} defaultValue={m?.marksAwarded ?? ""} className="input w-16 px-1 py-0.5 text-right" aria-label={`Marks for question ${it.number}`} />
                          </td>
                          <td>
                            <select name={`t${it.number}`} defaultValue={m?.errorTag ?? "none"} className="input w-auto px-1 py-0.5 text-xs" aria-label={`Where marks were lost on question ${it.number}`}>
                              {["none", "concept", "calculation", "missing_steps", "misread"].map((t) => (
                                <option key={t} value={t}>
                                  {t === "none" ? "-" : t.replace("_", " ")}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                <Submit>Save marks</Submit>
                <Msg />
              </div>
            </EpForm>
          </div>
          {items.some((x) => x.needsReview || x.aiProposed != null) && <ReviewPanel sheetUrl={signedLink(sheetPath)} items={items} student={current.student.code} key={current.id} />}
          <div className="grid gap-4 lg:grid-cols-2">
            <EpForm action={setMarkAction} className="card flex flex-wrap items-end gap-2 text-sm">
              <b className="w-full">Enter or correct a mark</b>
              <input type="hidden" name="submissionId" value={current.id} />
              <select name="questionId" className="input w-auto">
                {paper.items.map((i) => (
                  <option key={i.questionId} value={i.questionId}>
                    Q{i.number} ({i.question.marks})
                  </option>
                ))}
              </select>
              <input name="marks" type="number" step={0.5} min={0} required className="input w-20" />
              <select name="errorTag" className="input w-auto">
                {["none", "concept", "calculation", "missing_steps", "misread"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input name="note" placeholder="Correction note for the next report (optional)" className="input flex-1" />
              <Submit tone="plain">Save</Submit>
              <Msg />
            </EpForm>
            <EpForm action={selfMarksAction} className="card flex flex-wrap items-end gap-2 text-sm">
              <b className="w-full">Student's self-entered marks (fallback)</b>
              <input type="hidden" name="submissionId" value={current.id} />
              <input name="marks" placeholder="question:marks, e.g. 5:3 6:2" required className="input flex-1 font-mono" defaultValue={current.selfMarks.map((x) => `${paper.items.find((i) => i.questionId === x.questionId)?.number}:${x.marksClaimed}`).join(" ")} />
              <Submit tone="plain">Save</Submit>
              <Msg />
            </EpForm>
          </div>
        </>
      )}

      <section className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-[#0f3460]">Spot-check</h2>
          <span className="text-xs text-muted">
            {spotSum.checked} checked · mismatch rate {spotSum.mismatchRate == null ? "-" : `${Math.round(spotSum.mismatchRate)}%`}
          </span>
          {!spot.length && (
            <ActionButton action={spotSelectAction} fields={{ paperId }}>
              Pick {s["marking.spotCount"]} random sheets
            </ActionButton>
          )}
        </div>
        {spotRows.map((x) => (
          <EpForm key={x.id} action={spotRecordAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="spotCheckId" value={x.id} />
            <Link href={`?sheet=${x.submissionId}&all=1`} className="w-40 text-accent hover:underline">
              {x.submission.student.code}
            </Link>
            <span className="w-40 text-xs">Entered total: {x.entered}</span>
            <input name="teacherTotal" type="number" step={0.5} min={0} placeholder="Your total" defaultValue={x.result ? x.entered - (x.deltaMarks ?? 0) : undefined} className="input w-28" />
            <Submit tone="plain">Record</Submit>
            {x.result && <span className={x.result === "match" ? "text-ok" : "text-bad"}>{x.result === "match" ? "match" : `mismatch (${x.deltaMarks! > 0 ? "+" : ""}${x.deltaMarks})`}</span>}
            <Msg />
          </EpForm>
        ))}
      </section>
    </div>
  );
}
