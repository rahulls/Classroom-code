"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ActionForm, FormMessage, Req, SubmitButton } from "@/components/form";
import { createFactsVideoAction, generateFactsAction, saveClaudeKeyAction } from "@/modules/chaos/actions";
import { FORMATS, MAX_CSV_BYTES, VOICES, fmtDuration, type VideoFormat } from "@/modules/chaos/csv";
import { DEFAULT_FACT_BADGE, FACT_COUNTS, GENERATE_FACT_COUNTS, detectCsvType, estimateFactsSeconds, factSeconds, parseFactsCsv, planMiddleCards } from "@/modules/chaos/facts";
import { CountChip, Field, Step } from "./studio";

/** Per-fact Canva art only up to this many facts (two pictures each). Same as MAX_QUESTION_PICTURES. */
const MAX_FACT_PICTURES = 25;

/** "Did you know?" facts videos: upload / write the facts, pick format and narration, then make the video or open the recording deck. */
export function FactsStudio({ busy, claudeKey, canva, initial }: { busy: boolean; claudeKey: boolean; canva: boolean; initial?: { name: string; content: string } }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState("");
  const [drag, setDrag] = useState(false);
  const [format, setFormat] = useState<VideoFormat>("shorts");
  const [count, setCount] = useState(0);
  const [narration, setNarration] = useState<"ai" | "record">("ai");
  const [kidVoice, setKidVoice] = useState(true);
  // Record mode: the reader also records the intro and the ending (else the kid voice or the AI voice)
  const [introOutro, setIntroOutro] = useState(true);
  const [mood, setMood] = useState<string>("upbeat");
  const [style, setStyle] = useState({ title: "", quizBadge: "", introBadge: "", titleLine1: "", titleLine2: "" });
  const [fromCsv, setFromCsv] = useState<string[]>([]);
  const setField = (k: keyof typeof style) => (e: React.ChangeEvent<HTMLInputElement>) => setStyle((st) => ({ ...st, [k]: e.target.value }));
  const input = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (csv ? parseFactsCsv(csv) : null), [csv]);
  const all = parsed?.facts ?? [];
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === "warning") ?? [];
  const used = count ? all.slice(0, count) : all;
  const middles = narration === "record" ? planMiddleCards(used.length, format, "preview").length : format === "shorts" ? (used.length >= 4 && kidVoice ? 1 : 0) : kidVoice ? Math.max(1, Math.floor(used.length / 5)) : 0;
  const length = used.length ? estimateFactsSeconds(used, format, middles) : 0;
  const valid = !!parsed && !errors.length && used.length > 0;
  const errorRows = new Set(errors.map((e) => e.row));

  const load = async (file: File | undefined) => {
    setReadError("");
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return setReadError("Choose a .csv file (in Excel: File › Save As › CSV UTF-8).");
    if (file.size > MAX_CSV_BYTES) return setReadError("That file is over 2 MB: is it really a facts CSV?");
    applyCsv(await file.text(), file.name);
  };

  const applyCsv = (text: string, name: string) => {
    setCsv(text);
    setFileName(name);
    setCount(0);
    const p = parseFactsCsv(text);
    setFormat(p.facts.length > 12 ? "youtube" : "shorts");
    const st = p.settings;
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
    if (st.musicMood) {
      setMood(st.musicMood);
      filled.push("music mood");
    }
    if (st.kidVoice !== undefined) {
      setKidVoice(st.kidVoice);
      filled.push("kid voice");
    }
    if (st.narration) {
      setNarration(st.narration);
      filled.push("narration");
    }
    setFromCsv(filled);
  };

  // Opened from the dashboard's "Make video": that CSV is already loaded, as if uploaded
  const loaded = useRef(false);
  useEffect(() => {
    if (!initial || loaded.current) return;
    loaded.current = true;
    applyCsv(initial.content, initial.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const pickFormat = (f: VideoFormat) => {
    setFormat(f);
    setCount(0);
  };
  const quizCsv = !!csv && detectCsvType(csv) === "quiz";

  return (
    <ActionForm action={createFactsVideoAction} className="space-y-4">
      <FormMessage />
      <input type="hidden" name="csv" value={csv} />
      <input type="hidden" name="fileName" value={fileName} />

      {/* 1. Facts */}
      <section className="card">
        <Step n={1} title="Facts" />
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
            {csv ? "Choose another CSV" : "Upload facts CSV"}
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
          <span className="text-sm text-muted">{fileName ? <b className="text-[#2a1260] dark:text-[#d9c8ff]">{fileName}</b> : "or drop the file here"}</span>
          <a href="/chaos/sample.csv?type=facts" className="ml-auto text-sm text-accent hover:underline">
            Download a sample CSV
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">
          Columns: <code>headline</code> (the fact, shown big), <code>detail</code> (one more sentence, optional), <code>narration</code> (what is read out, when it should differ;
          optional), <code>seconds</code> (optional; normally the reading time + 1 s, 5–10 s), <code>image</code> (a picture from the images folder for the sticker; optional). The same
          settings lines as a quiz CSV can go above the header, plus <code>Video type,facts</code> and <code>Narration,ai</code> or <code>record</code>.
        </p>
        {readError && <p className="mt-2 text-sm text-bad">{readError}</p>}
        {quizCsv && (
          <p className="mt-2 rounded bg-warn/10 px-3 py-2 text-sm text-warn">
            This is a quiz questions CSV.{" "}
            <a href="/chaos" className="font-medium underline">
              Open the Quiz video tab
            </a>{" "}
            and upload it there.
          </p>
        )}
        <FactsGenerator hasKey={claudeKey} onCsv={applyCsv} csv={csv} fileName={fileName} />

        {parsed && !quizCsv && (
          <div className="mt-4">
            <p className="mb-2 text-sm">
              <b>{all.length}</b> fact{all.length === 1 ? "" : "s"} ready
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
                      <th>Fact</th>
                      <th>Read out</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((f, i) => (
                      <tr key={f.row} className={`align-top ${count && i >= count ? "opacity-40" : ""} ${errorRows.has(f.row) ? "bg-bad/5" : ""}`}>
                        <td className="text-xs text-muted">{i + 1}</td>
                        <td className="min-w-[16rem]">
                          <b className="block">{f.headline}</b>
                          {f.detail && <span className="block text-xs text-muted">{f.detail}</span>}
                          {f.image && <span className="mt-0.5 block text-xs text-accent">🖼 {f.image}</span>}
                        </td>
                        <td className="min-w-[12rem] text-xs text-muted">{f.narration ? <i>{f.narration}</i> : "Headline + detail"}</td>
                        <td className="whitespace-nowrap text-xs">{f.seconds ? `${f.seconds}s` : <span className="text-muted">~{Math.round(factSeconds(f))}s</span>}</td>
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
                <span className="block text-xs text-muted">{f === "shorts" ? "5 to 10 facts for Shorts and Reels" : "Long videos: 20 to 50 facts"}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <span className="label">Facts in the video</span>
            <div className="flex flex-wrap gap-1.5">
              <CountChip active={count === 0} onClick={() => setCount(0)} label={`All${all.length ? ` (${all.length})` : ""}`} />
              {FACT_COUNTS[format].map((c) => (
                <CountChip key={c} active={count === c} disabled={all.length < c} onClick={() => setCount(c)} label={`First ${c}`} title={all.length < c ? `The CSV has only ${all.length} facts` : undefined} />
              ))}
            </div>
            <input type="hidden" name="count" value={count || ""} />
          </div>
          {used.length > 0 && (
            <p className="text-sm">
              Video length about <b>{fmtDuration(length)}</b>
              {format === "shorts" && length > 180 && <span className="block text-xs text-warn">Over 3 minutes: YouTube won&apos;t treat it as a Short. Use fewer facts or the YouTube format.</span>}
            </p>
          )}
        </div>
      </section>

      {/* 3. Narration */}
      <section className="card">
        <Step n={3} title="Narration" />
        <input type="hidden" name="narration" value={narration} />
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            active={narration === "ai"}
            onClick={() => setNarration("ai")}
            icon="🤖"
            title="AI voice reads the facts"
            text="The studio's narrator reads every fact. The video is made straight away."
          />
          <ChoiceCard
            active={narration === "record"}
            onClick={() => setNarration("record")}
            icon="🎙️"
            title="Record in the app"
            text="Someone reads the facts out loud, one card at a time, in the recording deck. Each recording is paired with its fact."
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {narration === "ai" ? (
            <Field label="Narrator voice">
              <select name="voice" className="input w-full" defaultValue="af_heart">
                {VOICES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="space-y-2 rounded-lg bg-[#7a2fc0]/5 p-3 text-sm">
              <input type="hidden" name="voice" value="af_heart" />
              <label className="flex items-start gap-2 font-medium">
                <input type="checkbox" name="introOutro" value="1" className="mt-0.5" checked={introOutro} onChange={(e) => setIntroOutro(e.target.checked)} />
                <span>
                  Record the intro and ending too
                  <span className="block text-xs font-normal text-muted">Two more cards in the deck, with suggested words you can change. Unticked or skipped: the kid voice or the AI voice does them.</span>
                </span>
              </label>
              <p className="text-muted">
                The deck opens with {introOutro ? "an intro card, " : ""}
                {used.length || "the"} fact card{used.length === 1 ? "" : "s"}
                {middles ? `, ${middles} middle line${middles === 1 ? "" : "s"} (e.g. “Halfway there!”)` : ""}
                {introOutro ? " and an ending card" : ""}, all for the same person to read. You can stop and carry on later; Make video unlocks when every fact is recorded.
              </p>
            </div>
          )}
          <Field
            label="Kid voice"
            hint={
              narration === "ai"
                ? "Recorded kid lines for the intro, the ending and a cheer between some facts. Off: the AI voice does the intro and ending, with no middle lines."
                : introOutro
                  ? "Used for the intro or ending only when its card isn't recorded (off: the AI voice). The middle lines come from the deck."
                  : "Recorded kid lines for the intro and the ending (off: the AI voice). The middle lines come from the deck."
            }
          >
            <label className="flex h-[38px] items-center gap-2 text-sm">
              <input type="checkbox" name="kidVoice" value="1" checked={kidVoice} onChange={(e) => setKidVoice(e.target.checked)} />
              Use the kid voice recordings
            </label>
          </Field>
        </div>
      </section>

      {/* 4. Look & music */}
      <section className="card">
        <Step n={4} title="Title, look and music" />
        {fromCsv.length > 0 && <p className="-mt-1 mb-3 rounded bg-ok/10 px-3 py-1.5 text-xs text-ok">Filled from the CSV: {fromCsv.join(", ")}. You can still change them here.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Video name" hint="For your list here; also the download's file name">
            <input name="title" className="input w-full" maxLength={80} value={style.title} onChange={setField("title")} placeholder={fileName.replace(/\.csv$/i, "") || "Space Facts 1"} />
          </Field>
          <Field label="Badge on every fact" hint="The yellow tag, e.g. SPACE FACTS">
            <input name="quizBadge" className="input w-full" maxLength={24} value={style.quizBadge} onChange={setField("quizBadge")} placeholder="AMAZING FACTS" />
          </Field>
          <Field label="Intro tag">
            <input name="introBadge" className="input w-full" maxLength={30} value={style.introBadge} onChange={setField("introBadge")} placeholder={DEFAULT_FACT_BADGE} />
          </Field>
          <Field label="Intro title, line 1">
            <input name="titleLine1" className="input w-full" maxLength={24} value={style.titleLine1} onChange={setField("titleLine1")} placeholder="Amazing" />
          </Field>
          <Field label="Intro title, line 2">
            <input name="titleLine2" className="input w-full" maxLength={24} value={style.titleLine2} onChange={setField("titleLine2")} placeholder="Facts" />
          </Field>
          <Field label="Background music">
            <p className="py-2 text-sm text-muted" data-mood={mood}>
              None. Videos are made without music, so add your own when you edit (avoids copyright claims).
            </p>
          </Field>
        </div>
        <FactsCanva connected={canva} facts={used.length} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {valid && (narration === "record" || !busy) ? (
          <SubmitButton className="px-6 py-2.5 text-base">{narration === "record" ? "🎙️ Open recording deck" : "🎬 Create video"}</SubmitButton>
        ) : (
          <button type="button" className="btn-primary cursor-not-allowed px-6 py-2.5 text-base opacity-50" disabled>
            {narration === "record" ? "🎙️ Open recording deck" : "🎬 Create video"}
          </button>
        )}
        <span className="text-sm text-muted">
          {!parsed || quizCsv
            ? "Upload a facts CSV (or make one with Claude) to start."
            : errors.length
              ? "Fix the problems in the CSV, then upload it again."
              : narration === "record"
                ? `${used.length} facts · ${FORMATS[format].label}. Next: record them in the deck.`
                : busy
                  ? "Another video is being made: wait for it to finish."
                  : `${used.length} facts · ${FORMATS[format].label}. Making it takes roughly ${fmtDuration(Math.max(60, length * 1.2 + 40))}; you can leave the page.`}
        </span>
      </div>
    </ActionForm>
  );
}

function ChoiceCard({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: string; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left ${active ? "border-[#7a2fc0] bg-[#7a2fc0]/5" : "border-line hover:bg-soft"}`}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span>
        <b className="block">{title}</b>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </button>
  );
}

/** Canva: thumbnail, intro and ending; optionally a background and a sticker for every fact. */
function FactsCanva({ connected, facts }: { connected: boolean; facts: number }) {
  const [on, setOn] = useState(connected);
  const [perFact, setPerFact] = useState(true);
  const tooMany = facts > MAX_FACT_PICTURES;
  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="canva" value="1" checked={on && connected} disabled={!connected} onChange={(e) => setOn(e.target.checked)} />
        🎨 Canva designs: thumbnail, intro and ending made by Canva&apos;s AI
      </label>
      {connected && on && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="canvaFacts" value="1" checked={perFact && !tooMany} disabled={tooMany} onChange={(e) => setPerFact(e.target.checked)} />
          Canva background and sticker art for every fact{" "}
          <span className="text-xs text-muted">
            {tooMany ? `(only for up to ${MAX_FACT_PICTURES} facts; this video has ${facts})` : `(adds about ${Math.max(2, Math.ceil((Math.max(facts, 1) * 2) / 4) * 1.5)} minutes)`}
          </span>
        </label>
      )}
      <p className="mt-1 text-xs text-muted">
        Without Canva art, a fact shows its picture from the CSV&apos;s image column, or a bright “?” badge. Every design is also saved in your Canva folder.
      </p>
      {!connected && (
        <a href="/chaos/canva/connect?back=/chaos?type=facts" className="btn mt-2 inline-block text-sm">
          Connect Canva
        </a>
      )}
    </div>
  );
}

/** "Make facts with Claude": topic + count → a facts CSV, shown like an upload. */
function FactsGenerator({ hasKey, onCsv, csv, fileName }: { hasKey: boolean; onCsv: (text: string, name: string) => void; csv: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
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
      const res = await generateFactsAction(undefined, fd);
      if (!res?.ok) return setMsg({ ok: false, text: res?.ok === false ? (res.fieldErrors?.topic ?? res.error) : "Something went wrong." });
      const data = res.data as { csv: string; fileName: string; facts: number };
      onCsv(data.csv, data.fileName);
      setMade(data.fileName);
      setMsg({ ok: true, text: `${data.facts} facts written. Check them in the table below before making the video.` });
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
        ✨ No CSV? Make facts with Claude
      </button>
    );

  return (
    <div className="mt-4 rounded-lg border border-[#7a2fc0]/30 bg-[#7a2fc0]/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <b className="text-sm text-[#2a1260] dark:text-[#d9c8ff]">✨ Make facts with Claude</b>
        <button type="button" className="ml-auto text-xs text-muted hover:underline" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
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
            placeholder="e.g. Space, Human body, Animals, Ancient India, Oceans"
          />
        </label>
        <label className="block">
          <span className="label">Facts</span>
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {GENERATE_FACT_COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary" disabled={pending || needKey || topic.trim().length < 3} onClick={make}>
          {pending && !needKey ? "Writing…" : "Make facts"}
        </button>
      </div>
      {pending && !needKey && <p className="mt-2 text-xs text-muted">Claude is writing {count} facts. This takes about {count <= 15 ? "a minute" : "1–3 minutes"}: keep this page open.</p>}
      {needKey ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="block min-w-[18rem] flex-1">
            <span className="label">
              Claude API key
              <Req />
            </span>
            <input type="password" autoComplete="off" className="input w-full" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
            <span className="mt-0.5 block text-xs text-muted">From console.anthropic.com › API keys. Saved encrypted on this laptop only.</span>
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
