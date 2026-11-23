"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { deleteDraftAction, deleteRecordingAction, editCardAction, makeFactsVideoAction, saveRecordingAction, setIntroOutroAction } from "@/modules/chaos/actions";
import { FACT_MAX_SECONDS, readSeconds, spokenText, type SpokenCard } from "@/modules/chaos/facts";
import type { FactsDraft, Recording } from "@/modules/chaos/facts-drafts";

type Card = { key: string; kind: "fact" | "middle" | "intro" | "outro"; n: number; before?: number };
type Phase = "idle" | "countdown" | "recording" | "review" | "saving";
type Take = { blob: Blob; url: string; seconds: number };

const MIDDLE_MAX_SECONDS = 5;
const INTRO_OUTRO_MAX_SECONDS = 15;
const AUTO_STOP_SECONDS = 60;
const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** The words a card asks for right now (same as cardText() on the server). */
function textOf(d: FactsDraft, c: Card) {
  if (c.kind === "fact") return spokenText(d.facts.find((f) => f.key === c.key)!);
  return lineOf(d, c)?.text ?? "";
}

/** The words of a middle line / intro / ending card (null for a fact card). */
function lineOf(d: FactsDraft, c: Card): SpokenCard | null {
  if (c.kind === "intro") return d.intro ?? null;
  if (c.kind === "outro") return d.outro ?? null;
  if (c.kind === "middle") return d.middles.find((m) => m.key === c.key) ?? null;
  return null;
}

function stateOf(d: FactsDraft, c: Card): "done" | "changed" | "todo" {
  const r = d.recordings[c.key];
  if (!r) return "todo";
  return r.text === textOf(d, c) ? "done" : "changed";
}

const fmtSecs = (s: number) => `${s.toFixed(1)} s`;

/**
 * The recording deck: one card at a time with big text. Record (3-2-1, level meter, timer that turns
 * red when it runs long), Stop, listen back, then Keep (saved and paired with the card) or Redo.
 * Middle lines are cards of their own between the facts, read by the same person; they can be skipped.
 */
export function RecordingDeck({ draft, busy, videos }: { draft: FactsDraft; busy: string | null; videos: { id: string; title: string; stage: string; createdAt: string }[] }) {
  const [d, setD] = useState(draft);
  const cards = useMemo<Card[]>(() => {
    const out: Card[] = [];
    if (d.intro) out.push({ key: d.intro.key, kind: "intro", n: 0 });
    d.facts.forEach((f, i) => {
      d.middles.filter((m) => m.before === i).forEach((m) => out.push({ key: m.key, kind: "middle", n: out.filter((c) => c.kind === "middle").length + 1, before: i }));
      out.push({ key: f.key, kind: "fact", n: i + 1 });
    });
    if (d.outro) out.push({ key: d.outro.key, kind: "outro", n: 0 });
    return out;
  }, [d.facts, d.middles, d.intro, d.outro]);
  const firstTodo = Math.max(0, cards.findIndex((c) => stateOf(d, c) !== "done"));
  const [at, setAt] = useState(firstTodo);
  const card = cards[Math.min(at, cards.length - 1)]!;
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const meter = useRef<HTMLDivElement | null>(null);
  const started = useRef(0);
  const timers = useRef<number[]>([]);

  const factsDone = d.facts.filter((f) => stateOf(d, { key: f.key, kind: "fact", n: 0 }) === "done").length;
  const middlesDone = d.middles.filter((m) => stateOf(d, { key: m.key, kind: "middle", n: 0 }) === "done").length;
  const ends = cards.filter((c) => c.kind === "intro" || c.kind === "outro");
  const endsDone = ends.filter((c) => stateOf(d, c) === "done").length;
  const ready = factsDone === d.facts.length;
  const text = textOf(d, card);
  const limit = card.kind === "fact" ? FACT_MAX_SECONDS : card.kind === "middle" ? MIDDLE_MAX_SECONDS : INTRO_OUTRO_MAX_SECONDS;
  const rec: Recording | undefined = d.recordings[card.key];
  const st = stateOf(d, card);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // Release the microphone when leaving the page
  useEffect(
    () => () => {
      clearTimers();
      stream.current?.getTracks().forEach((t) => t.stop());
      void audioCtx.current?.close();
    },
    [],
  );

  // Level meter: drawn straight onto the bar (no re-render per frame)
  useEffect(() => {
    if (phase !== "recording") return;
    let raf = 0;
    const buf = new Float32Array(2048);
    const loop = () => {
      const a = analyser.current;
      if (a && meter.current) {
        a.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
        const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        meter.current.style.width = `${pct}%`;
        meter.current.style.background = db > -3 ? "#dc2626" : db > -30 ? "#16a34a" : "#a3a3a3";
      }
      setElapsed((performance.now() - started.current) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const getMic = async () => {
    if (stream.current?.active) return stream.current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This page can't use the microphone here. Open the studio at http://localhost:4310 (not the network address), in Chrome or Edge.");
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    stream.current = s;
    audioCtx.current = new AudioContext();
    analyser.current = audioCtx.current.createAnalyser();
    analyser.current.fftSize = 2048;
    audioCtx.current.createMediaStreamSource(s).connect(analyser.current);
    return s;
  };

  const stop = useCallback(() => {
    clearTimers();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const record = useCallback(async () => {
    setError("");
    setEditing(false);
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    let s: MediaStream;
    try {
      s = await getMic();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/denied|NotAllowed/i.test(msg) ? "The microphone is blocked. Click the 🎤 icon in the address bar, allow the microphone for this site, then try again." : /NotFound|device/i.test(msg) ? "No microphone found. Plug one in and try again." : msg);
      return;
    }
    void audioCtx.current?.resume();
    setPhase("countdown");
    [3, 2, 1].forEach((n, i) => timers.current.push(window.setTimeout(() => setCount(n), i * 700)));
    timers.current.push(
      window.setTimeout(() => {
        const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m));
        const r = new MediaRecorder(s, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
        const chunks: Blob[] = [];
        r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        r.onstop = () => {
          const seconds = (performance.now() - started.current) / 1000;
          const blob = new Blob(chunks, { type: r.mimeType || mimeType || "audio/webm" });
          setTake({ blob, url: URL.createObjectURL(blob), seconds });
          setPhase("review");
        };
        recorder.current = r;
        started.current = performance.now();
        setElapsed(0);
        r.start(250);
        setPhase("recording");
        timers.current.push(window.setTimeout(() => r.state === "recording" && r.stop(), AUTO_STOP_SECONDS * 1000));
      }, 2100),
    );
  }, [take]);

  const go = (i: number) => {
    if (phase === "recording" || phase === "countdown" || phase === "saving") return;
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setPhase("idle");
    setEditing(false);
    setError("");
    setAt(Math.max(0, Math.min(cards.length - 1, i)));
  };

  const keep = useCallback(async () => {
    if (!take) return;
    setPhase("saving");
    const fd = new FormData();
    fd.set("id", d.id);
    fd.set("key", card.key);
    fd.set("seconds", String(Math.round(take.seconds * 10) / 10));
    const ext = take.blob.type.includes("ogg") ? "ogg" : take.blob.type.includes("mp4") ? "m4a" : "webm";
    fd.set("file", new File([take.blob], `${card.key}.${ext}`, { type: take.blob.type }));
    const res = await saveRecordingAction(undefined, fd);
    if (!res?.ok) {
      setError(res?.ok === false ? res.error : "Couldn't save the recording. Try again.");
      setPhase("review");
      return;
    }
    const saved = (res.data as { recording: Recording }).recording;
    const next = { ...d, recordings: { ...d.recordings, [card.key]: saved } };
    setD(next);
    URL.revokeObjectURL(take.url);
    setTake(null);
    setPhase("idle");
    // On to the next card that still needs recording (or simply the next one)
    const after = cards.findIndex((c, i) => i > at && stateOf(next, c) !== "done");
    setAt(after >= 0 ? after : Math.min(at + 1, cards.length - 1));
  }, [take, d, card, cards, at]);

  const [removing, startRemove] = useTransition();
  const remove = () =>
    startRemove(async () => {
      const fd = new FormData();
      fd.set("id", d.id);
      fd.set("key", card.key);
      const res = await deleteRecordingAction(undefined, fd);
      if (res?.ok) {
        const recs = { ...d.recordings };
        delete recs[card.key];
        setD({ ...d, recordings: recs });
      }
    });

  // Keyboard: Space = record / stop, Enter = keep, R = redo, ← → = previous / next card
  const keys = useRef({ phase, record, stop, keep, go, at, editing });
  keys.current = { phase, record, stop, keep, go, at, editing };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const tag = (e.target as HTMLElement)?.tagName;
      if (k.editing || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (k.phase === "idle" || k.phase === "review") void k.record();
        else if (k.phase === "recording") k.stop();
      } else if (e.key === "Enter" && k.phase === "review") {
        e.preventDefault();
        void k.keep();
      } else if ((e.key === "r" || e.key === "R") && k.phase === "review") void k.record();
      else if (e.key === "ArrowRight") k.go(k.at + 1);
      else if (e.key === "ArrowLeft") k.go(k.at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fact = card.kind === "fact" ? d.facts.find((f) => f.key === card.key)! : null;
  const middle = lineOf(d, card);
  const over = phase === "recording" && elapsed > limit;

  return (
    <div className="space-y-4">
      {/* Progress + make video */}
      <section className="card flex flex-wrap items-center gap-4">
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm">
            <b>{factsDone}</b> of {d.facts.length} facts recorded
            {d.middles.length > 0 && (
              <span className="text-muted">
                {" "}
                · {middlesDone} of {d.middles.length} middle line{d.middles.length === 1 ? "" : "s"} (optional)
              </span>
            )}
            {ends.length > 0 && (
              <span className="text-muted">
                {" "}
                · intro &amp; ending {endsDone} of {ends.length} (optional)
              </span>
            )}
          </p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-soft">
            <div className="h-full bg-ok transition-all" style={{ width: `${(factsDone / Math.max(1, d.facts.length)) * 100}%` }} />
          </div>
          <IntroOutroSwitch
            draftId={d.id}
            on={!!(d.intro || d.outro)}
            disabled={phase !== "idle"}
            onChange={(next) => {
              setD((x) => {
                const recs = { ...x.recordings };
                if (!next.intro) for (const c of [x.intro, x.outro]) if (c) delete recs[c.key];
                return { ...x, intro: next.intro, outro: next.outro, recordings: recs };
              });
              setAt(0);
            }}
          />
        </div>
        <ActionForm action={makeFactsVideoAction} className="flex flex-col items-end gap-1">
          <FormMessage />
          <input type="hidden" name="id" value={d.id} />
          {ready && !busy && phase === "idle" ? (
            <SubmitButton className="px-5 py-2">🎬 Make video</SubmitButton>
          ) : (
            <button type="button" className="btn-primary cursor-not-allowed px-5 py-2 opacity-50" disabled>
              🎬 Make video
            </button>
          )}
          <span className="text-xs text-muted">
            {!ready ? `${d.facts.length - factsDone} fact${d.facts.length - factsDone === 1 ? "" : "s"} still to record` : busy ? `Wait: “${busy}” is being made` : "Every fact is recorded"}
          </span>
        </ActionForm>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Card list */}
        <nav className="card max-h-[70vh] overflow-y-auto p-2" aria-label="Cards">
          <ol className="space-y-0.5">
            {cards.map((c, i) => {
              const s = stateOf(d, c);
              const label = c.kind === "fact" ? d.facts.find((f) => f.key === c.key)!.headline : (lineOf(d, c)?.text ?? "");
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === at ? "bg-[#7a2fc0] text-white" : "hover:bg-soft"} ${c.kind === "middle" ? "pl-5" : ""} ${c.kind === "intro" ? "mb-1" : c.kind === "outro" ? "mt-1" : ""}`}
                  >
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        s === "done" ? "bg-ok text-white" : s === "changed" ? "bg-warn text-white" : i === at ? "bg-white/25" : "bg-soft text-muted"
                      }`}
                    >
                      {s === "done" ? "✓" : s === "changed" ? "!" : c.kind === "fact" ? c.n : c.kind === "middle" ? "•" : "★"}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${c.kind !== "fact" ? "italic" : ""}`}>
                      {c.kind === "middle" ? `🎙 ${label}` : c.kind === "intro" ? `Intro: ${label}` : c.kind === "outro" ? `Ending: ${label}` : label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* The card */}
        <section className="card p-5 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded-full px-3 py-1 font-semibold ${card.kind === "fact" ? "bg-[#ffb300] text-[#1e0e4a]" : card.kind === "middle" ? "bg-[#ff5c8d] text-white" : "bg-[#7a2fc0] text-white"}`}
            >
              {card.kind === "fact"
                ? `Fact ${card.n} of ${d.facts.length}`
                : card.kind === "middle"
                  ? `Middle line · before fact ${(card.before ?? 0) + 1}`
                  : card.kind === "intro"
                    ? "Intro"
                    : "Ending"}
            </span>
            {card.kind === "middle" && <span className="text-xs text-muted">Optional: skip it to leave it out</span>}
            {(card.kind === "intro" || card.kind === "outro") && <span className="text-xs text-muted">Optional: skipped = the kid voice or the AI voice</span>}
            <span className="ml-auto text-xs text-muted">Aim for about {Math.round(readSeconds(text))} s</span>
          </div>

          {editing ? (
            <EditCard
              draftId={d.id}
              cardKey={card.key}
              fact={fact}
              middle={middle}
              lineLabel={card.kind === "intro" ? "Intro words" : card.kind === "outro" ? "Ending words" : "Middle line"}
              onCancel={() => setEditing(false)}
              onSaved={(patch) => {
                setEditing(false);
                const t = patch.text;
                setD((x) => ({
                  ...x,
                  facts: x.facts.map((f) => (f.key === card.key ? { ...f, ...patch } : f)),
                  middles: x.middles.map((m) => (m.key === card.key && t !== undefined ? { ...m, text: t } : m)),
                  intro: x.intro && x.intro.key === card.key && t !== undefined ? { ...x.intro, text: t } : x.intro,
                  outro: x.outro && x.outro.key === card.key && t !== undefined ? { ...x.outro, text: t } : x.outro,
                }));
              }}
            />
          ) : (
            <div className="min-h-[9rem]">
              {fact && fact.narration ? (
                <>
                  <p className="text-3xl font-bold leading-snug text-ink sm:text-4xl">{fact.narration}</p>
                  <p className="mt-3 text-sm text-muted">On screen: {fact.headline}</p>
                </>
              ) : fact ? (
                <>
                  <p className="text-3xl font-bold leading-snug text-ink sm:text-4xl">{fact.headline}</p>
                  {fact.detail && <p className="mt-3 text-xl leading-relaxed text-ink/80 sm:text-2xl">{fact.detail}</p>}
                </>
              ) : (
                <p className="text-3xl font-bold italic leading-snug text-ink sm:text-4xl">“{middle?.text}”</p>
              )}
              {phase === "idle" && (
                <button type="button" className="mt-3 text-xs text-accent hover:underline" onClick={() => setEditing(true)}>
                  ✏️ Change the words
                </button>
              )}
            </div>
          )}

          {/* Recorder */}
          <div className="mt-6 rounded-xl border border-line bg-soft/40 p-4">
            {phase === "countdown" && (
              <div className="flex flex-col items-center py-2">
                <span className="text-6xl font-bold tabular-nums text-[#7a2fc0] dark:text-[#c9a6ff]">{count}</span>
                <span className="text-sm text-muted">Get ready to read…</span>
              </div>
            )}
            {phase === "recording" && (
              <div className="flex flex-wrap items-center gap-4">
                <span className="relative flex h-4 w-4">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-4 w-4 rounded-full bg-red-600" />
                </span>
                <span className={`w-20 text-2xl font-bold tabular-nums ${over ? "text-bad" : ""}`}>{fmtSecs(elapsed)}</span>
                <div className="h-3 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-panel ring-1 ring-line">
                  <div ref={meter} className="h-full w-0 rounded-full transition-[width] duration-75" />
                </div>
                <button type="button" className="btn-primary px-5 py-2" onClick={stop}>
                  ■ Stop <kbd className="ml-1 text-xs opacity-70">Space</kbd>
                </button>
                {over && <p className="w-full text-xs text-bad">Over {limit} seconds: try a quicker read{card.kind === "fact" ? " (the fact will stay on screen longer)" : ""}.</p>}
              </div>
            )}
            {(phase === "review" || phase === "saving") && take && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio src={take.url} controls autoPlay className="h-10 min-w-[16rem] flex-1" />
                  <span className={`text-sm tabular-nums ${take.seconds > limit ? "text-warn" : "text-muted"}`}>{fmtSecs(take.seconds)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-primary px-5 py-2" disabled={phase === "saving"} onClick={() => void keep()}>
                    {phase === "saving" ? "Saving…" : "✓ Keep"} <kbd className="ml-1 text-xs opacity-70">Enter</kbd>
                  </button>
                  <button type="button" className="btn px-4 py-2" disabled={phase === "saving"} onClick={() => void record()}>
                    ↺ Redo <kbd className="ml-1 text-xs opacity-70">R</kbd>
                  </button>
                  <span className="text-xs text-muted">Listen back, then keep it or record again.</span>
                </div>
              </div>
            )}
            {phase === "idle" && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="inline-flex items-center gap-2 rounded-full bg-red-600 px-6 py-2.5 font-semibold text-white shadow hover:bg-red-700" onClick={() => void record()}>
                  <span className="h-3 w-3 rounded-full bg-white" />
                  {rec ? "Record again" : "Record"} <kbd className="text-xs opacity-80">Space</kbd>
                </button>
                {rec && (
                  <>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio src={`/chaos/facts/${d.id}/rec/${card.key}?v=${encodeURIComponent(rec.at)}`} controls className="h-10 min-w-[14rem] flex-1" />
                    <button type="button" className="text-xs text-muted hover:text-bad hover:underline" disabled={removing} onClick={remove}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            )}
            {phase === "idle" && st === "done" && rec && <p className="mt-2 text-xs text-ok">✓ Recorded ({fmtSecs(rec.seconds)}) and paired with this card.</p>}
            {phase === "idle" && st === "changed" && <p className="mt-2 text-xs font-medium text-warn">⚠ The words changed after this was recorded. Record it again.</p>}
            {error && <p className="mt-2 text-sm text-bad">{error}</p>}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button type="button" className="btn" disabled={at === 0 || phase !== "idle"} onClick={() => go(at - 1)}>
              ← Back
            </button>
            <button type="button" className="btn" disabled={at >= cards.length - 1 || phase !== "idle"} onClick={() => go(at + 1)}>
              Skip →
            </button>
            <span className="ml-auto text-xs text-muted">
              {at + 1} / {cards.length}
            </span>
          </div>
          <p className="mt-4 text-xs text-muted">
            Tips: a quiet room, the mic about a hand&apos;s width away, read lively and clearly. Silence at the start and end is trimmed, and every recording is set to the same
            loudness as the rest of the video.
          </p>
        </section>
      </div>

      {videos.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-semibold text-[#2a1260] dark:text-[#d9c8ff]">Videos made from this deck</h2>
          <ul className="space-y-1 text-sm">
            {videos.map((v) => (
              <li key={v.id}>
                <Link href={`/chaos/videos/${v.id}`} className="text-accent hover:underline">
                  {v.title}
                </Link>{" "}
                <span className="text-xs text-muted">
                  · {new Date(v.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} · {v.stage === "done" ? "ready" : v.stage}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ActionForm action={deleteDraftAction} confirm={`Delete this recording deck and all its recordings?${videos.length ? " Videos made from it stay." : ""}`} className="text-right">
        <input type="hidden" name="id" value={d.id} />
        <input type="hidden" name="back" value="1" />
        <SubmitButton variant="default" className="text-xs">
          Delete deck
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

function EditCard({
  draftId,
  cardKey,
  fact,
  middle,
  lineLabel,
  onCancel,
  onSaved,
}: {
  draftId: string;
  cardKey: string;
  fact: FactsDraft["facts"][number] | null;
  middle: SpokenCard | null;
  lineLabel: string;
  onCancel: () => void;
  onSaved: (patch: { headline?: string; detail?: string; narration?: string; text?: string }) => void;
}) {
  const [headline, setHeadline] = useState(fact?.headline ?? "");
  const [detail, setDetail] = useState(fact?.detail ?? "");
  const [narration, setNarration] = useState(fact?.narration ?? "");
  const [line, setLine] = useState(middle?.text ?? "");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", draftId);
      fd.set("key", cardKey);
      const patch = fact ? { headline: headline.trim(), detail: detail.trim(), narration: narration.trim() } : { text: line.trim() };
      for (const [k, v] of Object.entries(patch)) fd.set(k, v);
      const res = await editCardAction(undefined, fd);
      if (!res?.ok) return setMsg(res?.ok === false ? (Object.values(res.fieldErrors ?? {})[0] ?? res.error) : "Couldn't save.");
      onSaved(patch);
    });
  return (
    <div className="space-y-3">
      {fact ? (
        <>
          <label className="block">
            <span className="label">Headline (on screen, big)</span>
            <input className="input w-full text-lg" maxLength={160} value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Detail (on screen, smaller)</span>
            <textarea className="input w-full" rows={2} maxLength={240} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Read out instead (optional)</span>
            <textarea className="input w-full" rows={2} maxLength={400} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Empty: the headline and detail are read" />
          </label>
        </>
      ) : (
        <label className="block">
          <span className="label">{lineLabel}</span>
          <textarea className="input w-full text-lg" rows={3} maxLength={300} value={line} onChange={(e) => setLine(e.target.value)} />
        </label>
      )}
      {msg && <p className="text-sm text-bad">{msg}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save words"}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "Record the intro and ending too": adds the two cards (with suggested words) or takes them away. */
function IntroOutroSwitch({
  draftId,
  on,
  disabled,
  onChange,
}: {
  draftId: string;
  on: boolean;
  disabled: boolean;
  onChange: (cards: { intro: SpokenCard | null; outro: SpokenCard | null }) => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const flip = (next: boolean) => {
    if (!next && !window.confirm("Take the intro and ending cards out? Their recordings are deleted, and the kid voice or the AI voice does them instead.")) return;
    start(async () => {
      setMsg("");
      const fd = new FormData();
      fd.set("id", draftId);
      fd.set("on", next ? "1" : "0");
      const res = await setIntroOutroAction(undefined, fd);
      if (!res?.ok) return setMsg(res?.ok === false ? res.error : "Something went wrong.");
      onChange(res.data as { intro: SpokenCard | null; outro: SpokenCard | null });
    });
  };
  return (
    <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="checkbox" checked={on} disabled={disabled || pending} onChange={(e) => flip(e.target.checked)} />
      Record the intro and ending too
      <span className="text-xs text-muted">{on ? "(optional cards at the start and the end of the deck)" : "(now: the kid voice or the AI voice does them)"}</span>
      {msg && <span className="text-xs text-bad">{msg}</span>}
    </label>
  );
}
