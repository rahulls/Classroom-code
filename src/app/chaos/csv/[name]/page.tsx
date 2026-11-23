import Link from "next/link";
import { notFound } from "next/navigation";
import { parseQuizCsv, YT_CATEGORIES, type CsvIssue, type QuizSettings } from "@/modules/chaos/csv";
import { parseFactsCsv } from "@/modules/chaos/facts";
import { readLibraryCsv } from "@/modules/chaos/jobs";
import { csvFileHref, makeVideoHref, nameFromParam } from "../links";

export const metadata = { title: "CSV" };

const LETTERS = ["A", "B", "C", "D"];

/** One CSV from the library, read-only: its settings lines, every question or fact, and any problems. */
export default async function CsvViewPage({ params }: { params: Promise<{ name: string }> }) {
  const name = nameFromParam((await params).name);
  const csv = readLibraryCsv(name);
  if (!csv) notFound();
  const facts = csv.kind === "facts";
  const quiz = facts ? null : parseQuizCsv(csv.content);
  const fact = facts ? parseFactsCsv(csv.content) : null;
  const parsed = (quiz ?? fact)!;
  const count = quiz ? quiz.questions.length : fact!.facts.length;
  const errors = parsed.issues.filter((i) => i.level === "error");
  const warnings = parsed.issues.filter((i) => i.level === "warning");
  const noun = facts ? "fact" : "question";

  return (
    <div className="space-y-4">
      <Link href="/chaos/dashboard" className="text-sm text-accent hover:underline">
        ← Dashboard
      </Link>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-bold text-[#2a1260] dark:text-[#d9c8ff]">{parsed.settings.videoName || csv.name}</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="mr-2 rounded-full bg-[#7a2fc0]/10 px-2 py-0.5 text-xs font-medium text-[#7a2fc0] dark:text-[#d9c8ff]">{facts ? "💡 Facts" : "🧠 Quiz"}</span>
            {csv.name} · {count} {noun}
            {count === 1 ? "" : "s"} · changed {new Date(csv.modifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={csvFileHref(csv.name)} download className="btn">
            ⬇ Download
          </a>
          {errors.length ? (
            <span className="btn cursor-not-allowed opacity-50" title="Fix the problems below first">
              ▶ Make a video from it
            </span>
          ) : (
            <Link href={makeVideoHref(csv.name, csv.kind)} className="btn btn-primary">
              ▶ Make a video from it
            </Link>
          )}
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && <Issues errors={errors} warnings={warnings} />}

      <Settings s={parsed.settings} />

      <section className="card p-0">
        <h2 className="px-4 pt-3 font-semibold text-[#2a1260] dark:text-[#d9c8ff]">
          {count} {noun}
          {count === 1 ? "" : "s"}
        </h2>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            {quiz ? (
              <>
                <thead>
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th>Question</th>
                    <th>Options (answer in green)</th>
                    <th>Fact</th>
                    <th className="text-right">Seconds</th>
                  </tr>
                </thead>
                <tbody>
                  {quiz.questions.map((q, i) => (
                    <tr key={q.row} className="align-top">
                      <td className="text-right tabular-nums text-muted">{i + 1}</td>
                      <td className="min-w-[16rem] font-medium">{q.question}</td>
                      <td className="min-w-[14rem]">
                        <ul className="space-y-0.5">
                          {q.options.map((o, k) => (
                            <li key={k} className={k === q.answer ? "font-semibold text-ok" : ""}>
                              {LETTERS[k]}. {o}
                              {k === q.answer && " ✓"}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="min-w-[14rem] text-muted">{q.fact}</td>
                      <td className="text-right tabular-nums">{q.seconds ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th>Headline</th>
                    <th>Detail</th>
                    <th>Read aloud as</th>
                    <th className="text-right">Seconds</th>
                  </tr>
                </thead>
                <tbody>
                  {fact!.facts.map((f, i) => (
                    <tr key={f.row} className="align-top">
                      <td className="text-right tabular-nums text-muted">{i + 1}</td>
                      <td className="min-w-[14rem] font-medium">
                        {f.headline}
                        {f.image && <span className="block text-xs text-muted">🖼 {f.image}</span>}
                      </td>
                      <td className="min-w-[16rem]">{f.detail}</td>
                      <td className="min-w-[14rem] text-muted">{f.narration || <span className="text-xs">headline + detail</span>}</td>
                      <td className="text-right tabular-nums">{f.seconds ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}

function Issues({ errors, warnings }: { errors: CsvIssue[]; warnings: CsvIssue[] }) {
  return (
    <section className={`card text-sm ${errors.length ? "border-bad" : "border-warn"}`}>
      {errors.length > 0 && (
        <>
          <b className="text-bad">
            {errors.length} problem{errors.length === 1 ? "" : "s"} to fix before a video can be made
          </b>
          <IssueList list={errors} />
        </>
      )}
      {warnings.length > 0 && (
        <>
          <b className="mt-2 block text-warn">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </b>
          <IssueList list={warnings} />
        </>
      )}
    </section>
  );
}

const IssueList = ({ list }: { list: CsvIssue[] }) => (
  <ul className="mt-1 list-disc space-y-0.5 pl-5">
    {list.map((i, k) => (
      <li key={k}>
        {i.row > 0 && <span className="text-muted">Row {i.row}: </span>}
        {i.message}
      </li>
    ))}
  </ul>
);

/** The settings lines at the top of the CSV, in plain words (only the ones it gives). */
function Settings({ s }: { s: QuizSettings }) {
  const onOff = (v: boolean | undefined) => (v === undefined ? undefined : v ? "On" : "Off");
  const rows: [string, React.ReactNode][] = (
    [
      ["Video name", s.videoName],
      ["Badge", s.badge],
      ["Intro tag", s.introTag],
      ["Intro title", [s.titleLine1, s.titleLine2].filter(Boolean).join(" / ") || undefined],
      ["Seconds", s.seconds ? `${s.seconds} s per question` : undefined],
      ["Music mood", s.musicMood],
      ["Kid voice", onOff(s.kidVoice)],
      ["Narration", s.narration === "record" ? "Recorded in the studio" : s.narration === "ai" ? "AI voice" : undefined],
      ["Ranks", s.ranks?.join(", ")],
      ["Thumbnail photo", s.thumbnailImage],
      ["YouTube title", s.youtubeTitle],
      ["YouTube category", s.youtubeCategory ? (YT_CATEGORIES.find((c) => c.id === s.youtubeCategory)?.name ?? s.youtubeCategory) : undefined],
      ["YouTube tags", s.youtubeTags?.length ? s.youtubeTags.join(", ") : undefined],
      ["YouTube description", s.youtubeDescription ? <span className="whitespace-pre-line">{s.youtubeDescription}</span> : undefined],
    ] as [string, React.ReactNode][]
  ).filter(([, v]) => v !== undefined && v !== "");
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2 className="mb-2 font-semibold text-[#2a1260] dark:text-[#d9c8ff]">Settings lines</h2>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
