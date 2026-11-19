"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ActionForm, FormMessage, Req, SubmitButton } from "@/components/form";
import { createVideoAction, generateQuizAction, saveClaudeKeyAction } from "@/modules/chaos/actions";
import {
  DEFAULT_RANKS,
  DIFFICULTIES,
  FORMATS,
  GENERATE_COUNTS,
  MAX_CSV_BYTES,
  MUSIC_MOODS,
  VOICES,
  estimateSeconds,
  fmtDuration,
  parseQuizCsv,
  parseRanks,
  rankBands,
  type VideoFormat,
} from "@/modules/chaos/csv";

const LONG_COUNTS = [50, 100, 150];
const SHORT_COUNTS = [5, 10, 15];

/** Upload + preview the questions CSV, choose the format and style, then create the video. */
export function Studio({ busy, claudeKey }: { busy: boolean; claudeKey: boolean }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState("");
  const [format, setFormat] = useState<VideoFormat>("shorts");
  const [count, setCount] = useState(0);
  // The timer follows the quiz type (maths 10 s, anything else 5 s) until the CSV or you set it
  const [seconds, setSeconds] = useState(5);
  const [secondsFixed, setSecondsFixed] = useState(false);
  const [drag, setDrag] = useState(false);
  const [mood, setMood] = useState<string>("upbeat");
  // Rank table at the start and end of long videos
  const [ranksOn, setRanksOn] = useState(true);
  const [ranks, setRanks] = useState("");
  // Style fields: typed here, or filled from the settings lines at the top of the CSV
  const [style, setStyle] = useState({ title: "", quizBadge: "", introBadge: "", titleLine1: "", titleLine2: "" });
  const [fromCsv, setFromCsv] = useState<string[]>([]);
  const setField = (k: keyof typeof style) => (e: React.ChangeEvent<HTMLInputElement>) => setStyle((st) => ({ ...st, [k]: e.target.value }));
  const input = useRef<HTMLInputElement>(null);
  const maths = isMathsQuiz(style);
  const secs = secondsFixed ? seconds : maths ? 10 : 5;

  const parsed = useMemo(() => (csv ? parseQuizCsv(csv) : null), [csv]);
  const all = parsed?.questions ?? [];
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === "warning") ?? [];
  const used = count ? all.slice(0, count) : all;
  const showRanks = format === "youtube" && ranksOn;
  const rankNames = parseRanks(ranks).length >= 2 ? parseRanks(ranks) : DEFAULT_RANKS;
  const length = used.length ? estimateSeconds(used, secs, showRanks) : 0;
  const valid = !!parsed && !errors.length && used.length > 0 && (!count || all.length >= count);
  const errorRows = new Set(errors.map((e) => e.row));

  const load = async (file: File | undefined) => {
    setReadError("");
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setReadError("Choose a .csv file (in Excel: File › Save As › CSV UTF-8).");
    if (file.size > MAX_CSV_BYTES) return setReadError("That file is over 2 MB: is it really a questions CSV?");
    applyCsv(await file.text(), file.name);
  };

  /** Show a CSV (uploaded or written by Claude) and fill the form from its settings lines. */
  const applyCsv = (text: string, name: string) => {
    setCsv(text);
    setFileName(name);
    setCount(0);
    // More than 5 questions: a long YouTube video; 5 or fewer: a Short / Reel (you can still switch)
    setFormat(parseQuizCsv(text).questions.length > 5 ? "youtube" : "shorts");
    // Fill the form from the CSV's settings lines (fields the CSV doesn't mention keep what you typed)
    const st = parseQuizCsv(text).settings;
    const filled: string[] = [];
    const next = { ...style };
    const put = (k: keyof typeof style, v: string | undefined, label: string) => {
      if (v) {
        next[k] = v;
        filled.push(label);
      }
    };
    put("title", st.videoName, "video name");
    put("quizBadge", st.badge, "badge");
    put("introBadge", st.introTag, "intro tag");
    put("titleLine1", st.titleLine1, "intro title line 1");
    put("titleLine2", st.titleLine2, "intro title line 2");
    setStyle(next);
    if (st.seconds) {
      setSeconds(st.seconds);
      filled.push("seconds per question");
    }
    setSecondsFixed(!!st.seconds);
    if (st.musicMood) {
      setMood(st.musicMood);
      filled.push("music mood");
    }
    if (st.ranks) {
      const off = st.ranks[0] === "off";
      setRanksOn(!off);
      setRanks(off ? "" : st.ranks.join(", "));
      filled.push("ranks");
    }
    setFromCsv(filled);
  };

  const counts = format === "youtube" ? LONG_COUNTS : SHORT_COUNTS;
  const pickFormat = (f: VideoFormat) => {
    setFormat(f);
    setCount(0);
  };

  return (
    <ActionForm action={createVideoAction} className="space-y-4">
      <FormMessage />
      <input type="hidden" name="csv" value={csv} />
      <input type="hidden" name="fileName" value={fileName} />

      {/* 1. Questions */}
      <section className="card">
        <Step n={1} title="Questions" />
        <div
          className={`flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed p-4 ${drag ? "border-[#7a2fc0] bg-[#7a2fc0]/5" : "border-line"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void load(e.dataTransfer.files[0]);
          }}
        >
          <button type="button" className="btn-primary" onClick={() => input.current?.click()}>
            {csv ? "Choose another CSV" : "Upload questions CSV"}
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
          <span className="text-sm text-muted">{fileName ? <b className="text-[#2a1260]">{fileName}</b> : "or drop the file here"}</span>
          <a href="/chaos/sample.csv" className="ml-auto text-sm text-accent hover:underline">
            Download a sample CSV
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">
          Columns: <code>question, option_a, option_b, option_c, option_d, answer</code> (A–D), <code>fact</code> (“Did you know?”, optional), <code>seconds</code> (optional timer for that question). Optional lines above the header fill step 3: <code>Video name</code>, <code>Badge on every question</code>, <code>Intro tag</code>, <code>Intro title line 1</code>, <code>Intro title line 2</code>, <code>Seconds per question</code>, <code>Music mood</code>, <code>Ranks</code> (see the sample).
        </p>
        {readError && <p className="mt-2 text-sm text-bad">{readError}</p>}
        <Generator hasKey={claudeKey} onCsv={applyCsv} csv={csv} fileName={fileName} />

        {parsed && (
          <div className="mt-4">
            <p className="mb-2 text-sm">
              <b>{all.length}</b> question{all.length === 1 ? "" : "s"} ready
              {errors.length > 0 && <span className="text-bad"> · {errors.length} problem{errors.length === 1 ? "" : "s"} to fix</span>}
              {warnings.length > 0 && <span className="text-warn"> · {warnings.length} note{warnings.length === 1 ? "" : "s"}</span>}
            </p>
            {parsed.issues.length > 0 && (
              <ul className="mb-3 max-h-36 space-y-0.5 overflow-y-auto rounded border border-line bg-soft/50 p-2 text-xs">
                {parsed.issues.map((i, k) => (
                  <li key={k} className={i.level === "error" ? "text-bad" : "text-warn"}>
                    {i.row ? `Row ${i.row}: ` : ""}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            {all.length > 0 && (
              <div className="max-h-[28rem] overflow-auto rounded border border-line">
                <table className="table text-sm">
                  <thead className="sticky top-0 bg-panel">
                    <tr>
                      <th>#</th>
                      <th>Question</th>
                      <th>A</th>
                      <th>B</th>
                      <th>C</th>
                      <th>D</th>
                      <th>Did you know?</th>
                      <th>Timer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((q, i) => (
                      <tr key={q.row} className={`align-top ${count && i >= count ? "opacity-40" : ""} ${errorRows.has(q.row) ? "bg-bad/5" : ""}`}>
                        <td className="text-xs text-muted">{i + 1}</td>
                        <td className="min-w-[14rem]">{q.question}</td>
                        {q.options.map((o, k) => (
                          <td key={k} className={k === q.answer ? "font-semibold text-ok" : ""}>
                            {k === q.answer && "✓ "}
                            {o}
                          </td>
                        ))}
                        <td className="min-w-[12rem] text-xs text-muted">{q.fact}</td>
                        <td className="whitespace-nowrap text-xs">{q.seconds ? `${q.seconds}s` : <span className="text-muted">{secs}s</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Format */}
      <section className="card">
        <Step n={2} title="Format" />
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(FORMATS) as VideoFormat[]).map((f) => (
            <label key={f} className={`flex cursor-pointer items-center gap-4 rounded-lg border-2 p-3 ${format === f ? "border-[#7a2fc0] bg-[#7a2fc0]/5" : "border-line hover:bg-soft"}`}>
              <input type="radio" name="format" value={f} checked={format === f} onChange={() => pickFormat(f)} className="sr-only" />
              <span className={`grid shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#3b1a7a] to-[#7a2fc0] text-white ${f === "shorts" ? "h-16 w-9" : "h-9 w-16"}`}>▶</span>
              <span>
                <b className="block">{FORMATS[f].label}</b>
                <span className="block text-xs text-muted">{FORMATS[f].detail}</span>
                <span className="block text-xs text-muted">{f === "shorts" ? "Short quizzes for Shorts and Reels" : "Long quizzes: 50, 100 or 150 questions"}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Questions in the video</span>
            <div className="flex flex-wrap gap-1.5">
              <CountChip active={count === 0} onClick={() => setCount(0)} label={`All${all.length ? ` (${all.length})` : ""}`} />
              {counts.map((c) => (
                <CountChip key={c} active={count === c} disabled={all.length < c} onClick={() => setCount(c)} label={`First ${c}`} title={all.length < c ? `The CSV has only ${all.length} questions` : undefined} />
              ))}
            </div>
            <input type="hidden" name="count" value={count || ""} />
          </div>
          {used.length > 0 && (
            <p className="text-sm">
              Video length about <b>{fmtDuration(length)}</b>
              {format === "shorts" && length > 180 && <span className="block text-xs text-warn">Over 3 minutes: YouTube won't treat it as a Short. Use fewer questions or the YouTube format.</span>}
            </p>
          )}
        </div>
      </section>

      {/* 3. Look & voice */}
      <section className="card">
        <Step n={3} title="Title, timer, voice and music" />
        {fromCsv.length > 0 && <p className="-mt-1 mb-3 rounded bg-ok/10 px-3 py-1.5 text-xs text-ok">Filled from the CSV: {fromCsv.join(", ")}. You can still change them here.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Video name" hint="For your list here; also the download's file name">
            <input name="title" className="input w-full" maxLength={80} value={style.title} onChange={setField("title")} placeholder={fileName.replace(/\.csv$/i, "") || "GK Quiz #1"} />
          </Field>
          <Field label="Badge on every question" hint="The yellow tag, e.g. GK QUIZ, SCIENCE, OLYMPIAD">
            <input name="quizBadge" className="input w-full" maxLength={24} value={style.quizBadge} onChange={setField("quizBadge")} placeholder="GK QUIZ" />
          </Field>
          <Field label="Intro tag">
            <input name="introBadge" className="input w-full" maxLength={30} value={style.introBadge} onChange={setField("introBadge")} placeholder="TODAY'S QUIZ" />
          </Field>
          <Field label="Intro title, line 1">
            <input name="titleLine1" className="input w-full" maxLength={24} value={style.titleLine1} onChange={setField("titleLine1")} placeholder="General" />
          </Field>
          <Field label="Intro title, line 2">
            <input name="titleLine2" className="input w-full" maxLength={24} value={style.titleLine2} onChange={setField("titleLine2")} placeholder="Knowledge" />
          </Field>
          <Field
            label="Seconds per question"
            hint={secondsFixed ? "Set by you or the CSV. Used where the CSV's seconds column is empty." : `Automatic: ${maths ? "10 s, because it's a maths quiz" : "5 s (maths quizzes get 10 s)"}`}
          >
            <input
              name="timerSeconds"
              type="number"
              min={3}
              max={60}
              required
              className="input w-full"
              value={secs}
              onChange={(e) => {
                setSeconds(Math.max(3, Math.min(60, Number(e.target.value) || 5)));
                setSecondsFixed(true);
              }}
            />
          </Field>
          <Field label="Narrator voice">
            <select name="voice" className="input w-full" defaultValue="af_heart">
              {VOICES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Background music" hint="A random track of this mood from the sounds folder. Intro, background and ending screens are picked at random too.">
            <select name="musicMood" className="input w-full" value={mood} onChange={(e) => setMood(e.target.value)}>
              {MUSIC_MOODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {format === "youtube" && (
          <div className="mt-4 rounded-lg border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="ranksOn" value="1" checked={ranksOn} onChange={(e) => setRanksOn(e.target.checked)} />
              Rank screen after the intro and before the ending
            </label>
            {ranksOn && (
              <>
                <Field label="Rank names" hint="Lowest score first, separated by commas (2 to 6). Empty = the names shown below.">
                  <input name="ranks" className="input w-full" maxLength={200} value={ranks} onChange={(e) => setRanks(e.target.value)} placeholder={DEFAULT_RANKS.join(", ")} />
                </Field>
                <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {rankBands(used.length || 25, rankNames)
                    .slice()
                    .reverse()
                    .map((b) => (
                      <span key={b.name} className="rounded-full bg-[#7a2fc0]/10 px-2 py-0.5">
                        <b>
                          {b.lo === b.hi ? b.lo : `${b.lo}–${b.hi}`}
                        </b>{" "}
                        {b.name}
                      </span>
                    ))}
                  {!used.length && <span className="text-muted">(example for 25 questions)</span>}
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {valid && !busy ? (
          <SubmitButton className="px-6 py-2.5 text-base">🎬 Create video</SubmitButton>
        ) : (
          <button type="button" className="btn-primary cursor-not-allowed px-6 py-2.5 text-base opacity-50" disabled>
            🎬 Create video
          </button>
        )}
        <span className="text-sm text-muted">
          {busy
            ? "Another video is being made: wait for it to finish."
            : !parsed
              ? "Upload a questions CSV to start."
              : errors.length
                ? "Fix the problems in the CSV, then upload it again."
                : `${used.length} questions · ${FORMATS[format].label}. Making it takes roughly ${fmtDuration(Math.max(60, length * (format === "youtube" ? 0.9 : 1.1) + 30))}; you can leave the page.`}
        </span>
      </div>
    </ActionForm>
  );
}

/** A maths quiz (badge, name or intro title mentions maths) gets 10 seconds per question. */
function isMathsQuiz(s: { title: string; quizBadge: string; titleLine1: string; titleLine2: string }) {
  return /math|ganit|गणित/i.test([s.quizBadge, s.title, s.titleLine1, s.titleLine2].join(" "));
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-semibold text-[#2a1260]">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#ffb300] text-xs font-bold text-[#1e0e4a]">{n}</span>
      {title}
    </h2>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function CountChip({ active, disabled, onClick, label, title }: { active: boolean; disabled?: boolean; onClick: () => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "border-[#7a2fc0] bg-[#7a2fc0] text-white" : "border-line bg-panel hover:bg-soft"} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

/** "Make questions with Claude": topic + count + difficulty → a questions CSV, shown like an upload. */
function Generator({ hasKey, onCsv, csv, fileName }: { hasKey: boolean; onCsv: (text: string, name: string) => void; csv: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(25);
  const [difficulty, setDifficulty] = useState<string>("medium");
  const [keySaved, setKeySaved] = useState(hasKey);
  const [askKey, setAskKey] = useState(false);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [made, setMade] = useState("");
  const [pending, start] = useTransition();
  const needKey = !keySaved || askKey;

  const make = () =>
    start(async () => {
      setMsg(null);
      const fd = new FormData();
      fd.set("topic", topic);
      fd.set("count", String(count));
      fd.set("difficulty", difficulty);
      const res = await generateQuizAction(undefined, fd);
      if (!res?.ok) return setMsg({ ok: false, text: res?.ok === false ? (res.fieldErrors?.topic ?? res.error) : "Something went wrong." });
      const data = res.data as { csv: string; fileName: string; questions: number };
      onCsv(data.csv, data.fileName);
      setMade(data.fileName);
      setMsg({ ok: true, text: `${data.questions} questions written. Check them in the table below before making the video.` });
    });

  const saveKey = () =>
    start(async () => {
      setMsg(null);
      const fd = new FormData();
      fd.set("apiKey", key);
      const res = await saveClaudeKeyAction(undefined, fd);
      if (!res?.ok) return setMsg({ ok: false, text: res?.ok === false ? (res.fieldErrors?.apiKey ?? res.error) : "Something went wrong." });
      setKey("");
      setKeySaved(true);
      setAskKey(false);
      setMsg({ ok: true, text: "Key saved." });
    });

  if (!open)
    return (
      <button type="button" className="mt-3 text-sm font-medium text-accent hover:underline" onClick={() => setOpen(true)}>
        ✨ No CSV? Make questions with Claude
      </button>
    );

  return (
    <div className="mt-4 rounded-lg border border-[#7a2fc0]/30 bg-[#7a2fc0]/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <b className="text-sm text-[#2a1260]">✨ Make questions with Claude</b>
        <button type="button" className="ml-auto text-xs text-muted hover:underline" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="block">
          <span className="label">
            Topic
            <Req />
          </span>
          <input
            className="input w-full"
            maxLength={200}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!pending && !needKey && topic.trim().length >= 3) make();
              }
            }}
            placeholder="e.g. Indian history, Solar system, Class 8 science, Cricket"
          />
        </label>
        <label className="block">
          <span className="label">Questions</span>
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {GENERATE_COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Difficulty</span>
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary" disabled={pending || needKey || topic.trim().length < 3} onClick={make}>
          {pending && !needKey ? "Writing…" : "Make questions"}
        </button>
      </div>
      {pending && !needKey && <p className="mt-2 text-xs text-muted">Claude is writing {count} questions. This takes about {count <= 25 ? "a minute" : count <= 50 ? "1–2 minutes" : "2–5 minutes"}: keep this page open.</p>}

      {needKey ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="block min-w-[18rem] flex-1">
            <span className="label">
              Claude API key
              <Req />
            </span>
            <input type="password" autoComplete="off" className="input w-full" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
            <span className="mt-0.5 block text-xs text-muted">
              From console.anthropic.com › API keys. Saved encrypted on this laptop only. Each video&apos;s questions cost a few cents to about 50 cents.
            </span>
          </label>
          <button type="button" className="btn" disabled={pending || !key.trim()} onClick={saveKey}>
            Save key
          </button>
          {keySaved && (
            <button type="button" className="text-xs text-muted hover:underline" onClick={() => setAskKey(false)}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Uses your Claude API key.{" "}
          <button type="button" className="hover:underline" onClick={() => setAskKey(true)}>
            Change key
          </button>
        </p>
      )}

      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
      {made && csv && fileName === made && (
        <a className="mt-1 inline-block text-sm text-accent hover:underline" download={made} href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + csv)}`}>
          Download this CSV (to edit it in Excel or keep it)
        </a>
      )}
    </div>
  );
}
