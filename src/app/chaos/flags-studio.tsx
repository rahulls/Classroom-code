"use client";

import { useMemo, useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/form";
import { createFlagsVideoAction } from "@/modules/chaos/actions";
import { FORMATS, VOICES, fmtDuration, type VideoFormat } from "@/modules/chaos/csv";
import {
  FLAG_DEFAULTS,
  FLAG_LEVELS,
  FLAG_POOLS,
  FLAG_SERIES,
  type MadeFlagsVideo,
  FLAG_LIMITS,
  flagName,
  flagsYoutubeDefaults,
  pickRound,
  type FlagLevel,
  type FlagOptions,
  type FlagRound,
} from "@/modules/chaos/flags";
import { CountChip, Field, Step } from "./studio";

const ROUND_CHOICES = [1, 2, 3, 4, 5];

/** About how long the video runs (the engine's timeline with an average narrator). */
function estimateSeconds(o: FlagOptions, rounds: number) {
  const round = (rounds > 1 ? 2.2 : 0) + 4 + o.show * o.flagSeconds + (3.6 + o.searchSeconds + 1.4) + (2.4 + o.find * 1.2 + 1.8);
  return 13 + rounds * round + 9;
}

/** Flag Memory Challenge: format, level, rounds, the game's sizes, then a preview of every round's flags (Shuffle to pick again). */
export function FlagsStudio({ busy, seed, made }: { busy: boolean; seed: number; made: MadeFlagsVideo[] }) {
  const [format, setFormat] = useState<VideoFormat>("shorts");
  const [level, setLevel] = useState<FlagLevel>("easy");
  const [rounds, setRounds] = useState(1);
  const [opt, setOpt] = useState<FlagOptions>(FLAG_DEFAULTS);
  const [seeds, setSeeds] = useState<number[]>(() => Array.from({ length: 10 }, (_, i) => seed + i * 7919));
  const [yt, setYt] = useState<{ title?: string; description?: string; tags?: string }>({});
  const [fresh, setFresh] = useState(true);

  // Flags earlier videos of this level showed: left out while enough new ones remain (oldest videos first to go)
  const { avoid, reused } = useMemo(() => {
    if (!fresh) return { avoid: new Set<string>(), reused: 0 };
    const earlier = made.filter((m) => m.level === level).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const need = opt.show * rounds + 2;
    const pool = FLAG_POOLS[level].length;
    let keep = earlier;
    while (keep.length && pool - new Set(keep.flatMap((m) => m.shown)).size < need) keep = keep.slice(0, -1);
    return { avoid: new Set(keep.flatMap((m) => m.shown)), reused: earlier.length - keep.length };
  }, [fresh, made, level, opt.show, rounds]);

  const out = (k: keyof typeof FLAG_LIMITS & keyof FlagOptions, label: string) =>
    !(opt[k] >= FLAG_LIMITS[k][0] && opt[k] <= FLAG_LIMITS[k][1]) ? `${label}: ${FLAG_LIMITS[k][0]} to ${FLAG_LIMITS[k][1]}.` : "";
  const problem =
    out("show", "Flags shown") ||
    out("find", "Flags to find") ||
    out("grid", "Flags in the grid") ||
    out("flagSeconds", "Seconds per flag") ||
    out("searchSeconds", "Seconds to search") ||
    (opt.find >= opt.show ? "Flags to find must be fewer than the flags shown." : opt.grid < opt.find * 2 ? "The grid needs at least twice as many flags as there are to find." : "");
  const picked: FlagRound[] = useMemo(() => {
    if (problem) return [];
    const used = new Set(avoid);
    const out: FlagRound[] = [];
    for (let i = 0; i < rounds; i++) {
      const rd = pickRound(level, seeds[i]!, opt, used);
      rd.show.forEach((c) => used.add(c));
      out.push(rd);
    }
    return out;
  }, [level, rounds, opt, seeds, problem, avoid]);

  const auto = flagsYoutubeDefaults(level, rounds, opt, format === "shorts");
  const length = estimateSeconds(opt, rounds);
  const shuffle = (i?: number) => setSeeds((s) => s.map((v, j) => (i === undefined || i === j ? Math.floor(Math.random() * 1e9) : v)));
  const setNum = (k: keyof FlagOptions) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) setOpt((o) => ({ ...o, [k]: v }));
  };
  const pickFormat = (f: VideoFormat) => {
    setFormat(f);
    setRounds(f === "shorts" ? 1 : 3);
  };

  return (
    <ActionForm action={createFlagsVideoAction} className="space-y-4">
      <input type="hidden" name="rounds" value={JSON.stringify(picked)} />
      <input type="hidden" name="level" value={level} />

      <SeriesPanel made={made} />

      {/* 1. Format */}
      <section className="card">
        <Step n={1} title="Format" />
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(FORMATS) as VideoFormat[]).map((f) => (
            <label key={f} className={`flex cursor-pointer items-center gap-4 rounded-lg border-2 p-3 ${format === f ? "border-[#7a2fc0] bg-[#7a2fc0]/5" : "border-line hover:bg-soft"}`}>
              <input type="radio" name="format" value={f} checked={format === f} onChange={() => pickFormat(f)} className="sr-only" />
              <span className={`grid shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#3b1a7a] to-[#7a2fc0] text-white ${f === "shorts" ? "h-16 w-9" : "h-9 w-16"}`}>▶</span>
              <span>
                <b className="block">{FORMATS[f].label}</b>
                <span className="block text-xs text-muted">{FORMATS[f].detail}</span>
                <span className="block text-xs text-muted">{f === "shorts" ? "One round, about 1½ minutes" : "Several rounds, getting harder is up to you"}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 2. Level and rounds */}
      <section className="card">
        <Step n={2} title="Level and rounds" />
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(FLAG_LEVELS) as FlagLevel[]).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel(lv)}
              className={`rounded-lg border-2 p-3 text-left ${level === lv ? "border-[#7a2fc0] bg-[#7a2fc0]/5" : "border-line hover:bg-soft"}`}
            >
              <b className="block">{lv === "easy" ? "🟢" : lv === "medium" ? "🟠" : "🔴"} {FLAG_LEVELS[lv].label}</b>
              <span className="block text-xs text-muted">{FLAG_LEVELS[lv].detail}</span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <span className="label">Rounds</span>
          <div className="flex flex-wrap gap-1.5">
            {ROUND_CHOICES.map((n) => (
              <CountChip key={n} active={rounds === n} onClick={() => setRounds(n)} label={String(n)} />
            ))}
          </div>
          <span className="mt-1 block text-xs text-muted">Each round has its own flags; no flag is shown twice in one video. The score at the end is out of {opt.find * rounds}.</span>
        </div>
      </section>

      {/* 3. The game */}
      <section className="card">
        <Step n={3} title="The game" />
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Flags shown">
            <input name="show" type="number" className="input w-full" min={FLAG_LIMITS.show[0]} max={FLAG_LIMITS.show[1]} value={opt.show} onChange={setNum("show")} />
          </Field>
          <Field label="Flags to find">
            <input name="find" type="number" className="input w-full" min={FLAG_LIMITS.find[0]} max={FLAG_LIMITS.find[1]} value={opt.find} onChange={setNum("find")} />
          </Field>
          <Field label="Flags in the grid">
            <input name="grid" type="number" className="input w-full" min={FLAG_LIMITS.grid[0]} max={FLAG_LIMITS.grid[1]} value={opt.grid} onChange={setNum("grid")} />
          </Field>
          <Field label="Seconds per flag">
            <input name="flagSeconds" type="number" step={0.5} className="input w-full" min={FLAG_LIMITS.flagSeconds[0]} max={FLAG_LIMITS.flagSeconds[1]} value={opt.flagSeconds} onChange={setNum("flagSeconds")} />
          </Field>
          <Field label="Seconds to search">
            <input name="searchSeconds" type="number" className="input w-full" min={FLAG_LIMITS.searchSeconds[0]} max={FLAG_LIMITS.searchSeconds[1]} value={opt.searchSeconds} onChange={setNum("searchSeconds")} />
          </Field>
        </div>
        <p className="mt-2 text-sm">
          {problem ? (
            <span className="text-bad">{problem}</span>
          ) : (
            <>
              {opt.show} flags flash by ({opt.flagSeconds} s each), then viewers find {opt.find} of them among {opt.grid} flags in {opt.searchSeconds} seconds. Video length about{" "}
              <b>{fmtDuration(length)}</b>.
              {format === "shorts" && length > 180 && <span className="block text-xs text-warn">Over 3 minutes: YouTube won&apos;t treat it as a Short. Use 1 round or the YouTube format.</span>}
            </>
          )}
          {(opt.show !== FLAG_DEFAULTS.show || opt.find !== FLAG_DEFAULTS.find || opt.grid !== FLAG_DEFAULTS.grid || opt.flagSeconds !== FLAG_DEFAULTS.flagSeconds || opt.searchSeconds !== FLAG_DEFAULTS.searchSeconds) && (
            <button type="button" className="ml-2 text-xs text-accent hover:underline" onClick={() => setOpt(FLAG_DEFAULTS)}>
              Back to 10 · 5 · 30 · 1 s · 30 s
            </button>
          )}
        </p>
      </section>

      {/* 4. The flags */}
      <section className="card">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Step n={4} title="The flags" />
          <button type="button" className="btn ml-auto" onClick={() => shuffle()} disabled={!!problem}>
            🔀 Shuffle all
          </button>
        </div>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} className="mt-0.5" />
          <span>
            Don&apos;t show flags that earlier {FLAG_LEVELS[level].label.toLowerCase()} videos showed
            <span className="block text-xs text-muted">
              {made.filter((m) => m.level === level).length
                ? `${avoid.size} flags left out.${reused ? ` Not enough new flags for every video: flags of the ${reused} oldest ${reused === 1 ? "video" : "videos"} may come back.` : ""}`
                : `No ${FLAG_LEVELS[level].label.toLowerCase()} video made yet.`}
            </span>
          </span>
        </label>
        {picked.map((rd, i) => (
          <RoundPreview key={i} n={i + 1} many={rounds > 1} rd={rd} onShuffle={() => shuffle(i)} />
        ))}
      </section>

      {/* 5. Look, voice and YouTube */}
      <section className="card">
        <Step n={5} title="Title, voice and YouTube" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Video name">
            <input name="title" className="input w-full" maxLength={80} placeholder={`Flag Memory Challenge (${FLAG_LEVELS[level].label})`} />
          </Field>
          <Field label="Badge on every screen">
            <input name="badge" className="input w-full" maxLength={24} placeholder="FLAG MEMORY CHALLENGE" />
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
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="kidVoice" value="1" defaultChecked className="mt-0.5" />
          <span>
            <b>Kid voice</b> for the intro (“Hey everyone… ready for a challenge?”), a cheer between rounds and the ending
            <span className="block text-xs text-muted">The narrator explains the game, counts down and names the flags. Off: the narrator does everything.</span>
          </span>
        </label>
        <div className="mt-3 grid gap-3">
          <Field label="YouTube title" hint="Filled in for you; change it if you like.">
            <input name="youtubeTitle" className="input w-full" maxLength={100} value={yt.title ?? auto.title} onChange={(e) => setYt((y) => ({ ...y, title: e.target.value }))} />
          </Field>
          <Field label="YouTube description">
            <textarea name="youtubeDescription" className="input min-h-[9rem] w-full" value={yt.description ?? auto.description} onChange={(e) => setYt((y) => ({ ...y, description: e.target.value }))} />
          </Field>
          <Field label="YouTube tags" hint="Separated by commas.">
            <input name="youtubeTags" className="input w-full" value={yt.tags ?? auto.tags.join(", ")} onChange={(e) => setYt((y) => ({ ...y, tags: e.target.value }))} />
          </Field>
          {(yt.title !== undefined || yt.description !== undefined || yt.tags !== undefined) && (
            <button type="button" className="justify-self-start text-xs text-accent hover:underline" onClick={() => setYt({})}>
              Use the suggested YouTube lines again
            </button>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {!busy && !problem && picked.length ? (
          <SubmitButton className="px-6 py-2.5 text-base">🎬 Create video</SubmitButton>
        ) : (
          <button type="button" className="btn-primary cursor-not-allowed px-6 py-2.5 text-base opacity-50" disabled>
            🎬 Create video
          </button>
        )}
        <span className="text-sm text-muted">
          {busy
            ? "Another video is being made: wait for it to finish."
            : problem
              ? "Fix the game settings first."
              : `${FLAG_LEVELS[level].label} · ${rounds} round${rounds === 1 ? "" : "s"} · ${FORMATS[format].label}. No Canva needed. Making it takes a few minutes; you can leave the page.`}
        </span>
        <FormMessage />
      </div>
    </ActionForm>
  );
}

/** The planned series (4 easy, 3 medium, 5 hard): how far it has got, and each video's flags. */
function SeriesPanel({ made }: { made: MadeFlagsVideo[] }) {
  const total = Object.values(FLAG_SERIES).reduce((a, b) => a + b, 0);
  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-3">
        <b className="text-[#2a1260] dark:text-[#d9c8ff]">Your series: {total} flag memory videos</b>
        {(Object.keys(FLAG_SERIES) as FlagLevel[]).map((lv) => {
          const n = made.filter((m) => m.level === lv).length;
          const done = n >= FLAG_SERIES[lv];
          return (
            <span key={lv} className={`rounded-full px-3 py-1 text-sm font-medium ${done ? "bg-ok/15 text-ok" : "bg-soft"}`}>
              {FLAG_LEVELS[lv].label} {n} / {FLAG_SERIES[lv]}
              {done ? " ✓" : ""}
            </span>
          );
        })}
      </div>
      {made.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-accent">The flags each video used ({made.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {[...made].reverse().map((m) => (
              <li key={m.jobId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <a href={`/chaos/videos/${m.jobId}`} className="min-w-[12rem] font-medium hover:underline">
                  {m.title}
                </a>
                <span className="text-xs text-muted">
                  {FLAG_LEVELS[m.level].label} · {new Date(m.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" })}
                </span>
                <span className="flex flex-wrap gap-1">
                  {m.shown.map((c) => (
                    <Flag key={c} code={c} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Flag({ code, size = "sm", find }: { code: string; size?: "sm" | "md"; find?: boolean }) {
  return (
    <span className={`inline-flex flex-col items-center ${size === "md" ? "w-[76px]" : "w-[52px]"}`} title={flagName(code)}>
      <span className={`grid place-items-center bg-white p-[2px] shadow ${find ? "ring-2 ring-[#2edc78]" : ""} ${size === "md" ? "h-[50px] w-[74px]" : "h-[34px] w-[50px]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/chaos/flag/${code}`} alt={flagName(code)} className="max-h-full max-w-full object-contain" loading="lazy" />
      </span>
      {size === "md" && <span className="mt-1 w-full truncate text-center text-[11px] leading-tight">{flagName(code)}</span>}
    </span>
  );
}

function RoundPreview({ n, many, rd, onShuffle }: { n: number; many: boolean; rd: FlagRound; onShuffle: () => void }) {
  return (
    <div className="mb-4 rounded-xl border border-line p-3 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        {many && <b className="text-[#2a1260] dark:text-[#d9c8ff]">Round {n}</b>}
        <span className="text-xs text-muted">Green = hidden in the grid ({rd.find.length} of {rd.show.length})</span>
        <button type="button" className="btn ml-auto text-xs" onClick={onShuffle}>
          🔀 Shuffle{many ? " this round" : ""}
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div>
          <span className="label">Shown, in this order</span>
          <div className="flex flex-wrap gap-2">
            {rd.show.map((c) => (
              <Flag key={c} code={c} size="md" find={rd.find.includes(c)} />
            ))}
          </div>
        </div>
        <div>
          <span className="label">The grid</span>
          <div className="grid w-max grid-cols-6 gap-1 rounded-lg bg-[#1a1040] p-2">
            {rd.grid.map((c, i) => (
              <span key={c} className="relative">
                <Flag code={c} find={rd.find.includes(c)} />
                <span className="absolute bottom-0 left-0 rounded-sm bg-[#140c32]/90 px-0.5 text-[9px] font-bold leading-tight text-white">{i + 1}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
