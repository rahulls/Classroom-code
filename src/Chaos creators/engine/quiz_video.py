"""Chaos Creators quiz video engine (used by the /chaos page of the app).

Based on quiz-template/make_quiz.py (same look, sounds and timings), plus:
  * two formats: "shorts" (1080x1920, YouTube Shorts / Reels) and "youtube" (1920x1080, long videos)
  * parallel rendering on all CPU cores, so 100+ question videos finish in minutes
  * progress written to <job>/progress.json for the web page

Run:  python quiz_video.py <job-dir>
The job dir holds questions.csv and job.json ({"format", "limit", "settings": {...overrides}}).
Writes <job>/video.mp4 (and progress.json, error.txt on failure).
"""
import csv, json, math, os, random, subprocess, sys, time, pathlib, traceback
from functools import lru_cache
from multiprocessing import get_context

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ENGINE = pathlib.Path(__file__).resolve().parent
TEMPLATE = ENGINE.parent / "quiz-template" / "quiz-template"
# Canva looks: templates/<look>/{intro,background,outro}-{youtube,shorts}.png (any can be missing)
LOOKS_DIR = ENGINE.parent / "templates"
# Licensed sound files: sounds/<kind>/*.mp3|wav|ogg|m4a|flac (see sounds/README.md)
SOUNDS_DIR = pathlib.Path(os.environ.get("CHAOS_SOUNDS_DIR") or ENGINE.parent / "sounds")
SOUND_EXT = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}
FPS, SR = 30, 44100


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


# ============================== job I/O ==============================
class Job:
    def __init__(self, d):
        self.dir = pathlib.Path(d)
        self.spec = json.loads((self.dir / "job.json").read_text(encoding="utf-8"))
        self._last = 0.0
        self.started = time.time()

    def progress(self, stage, done=0, total=0, message="", force=False):
        now = time.time()
        if not force and now - self._last < 0.7:
            return
        self._last = now
        pct = 0.0
        if stage == "voice":
            pct = 2 + 8 * (done / total if total else 0)
        elif stage == "render":
            pct = 10 + 85 * (done / total if total else 0)
        elif stage == "finish":
            pct = 96
        elif stage == "done":
            pct = 100
        data = dict(stage=stage, done=done, total=total, percent=round(pct, 1), message=message,
                    elapsed=round(now - self.started, 1), updated=now)
        # Windows refuses to replace a file while the web page's status check is reading it.
        # Progress is only for the progress bar: retry briefly, and never let it stop the video.
        # Stage changes (force=True, e.g. "done") retry longer, then fall back to a direct write.
        tmp = self.dir / "progress.json.tmp"
        target = self.dir / "progress.json"
        text = json.dumps(data)
        for attempt in range(60 if force else 5):
            try:
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, target)
                return
            except OSError:
                time.sleep(0.05)
        if force:
            try:
                target.write_text(text, encoding="utf-8")
            except OSError:
                pass


# Long YouTube videos (not Shorts) end with a thank-you and a like / subscribe / comment call
YOUTUBE_OUTRO = {
    "outro_title": ["Thanks for", "watching!"],
    "outro_lines": ["Comment your score below!", "Like the video and subscribe", "for more quizzes"],
    "outro_voice": "Thank you for watching! How many did you get right? Comment your score below, "
                   "like this video, and subscribe to {channel} for more quizzes!",
}


# Long videos show a rank table after the intro ("keep score") and before the outro ("your rank")
DEFAULT_RANKS = ["Quiz Rookie", "Fast Learner", "Smart Cookie", "Quiz Expert", "Quiz Genius"]


def rank_list(cfg, fmt):
    """Rank titles, lowest score first, or None (Shorts, or settings.ranks = "off")."""
    if fmt != "youtube":
        return None
    r = cfg.get("ranks")
    if isinstance(r, str):
        r = [x for x in (y.strip() for y in r.replace("|", ",").replace(";", ",").split(",")) if x]
    r = [str(x).strip()[:22] for x in (r or []) if str(x).strip()]
    if len(r) == 1 and r[0].lower() == "off":
        return None
    return r[:6] if len(r) >= 2 else list(DEFAULT_RANKS)


def rank_bands(n, ranks):
    """Equal score bands, e.g. 25 questions, 5 ranks: 0-5, 6-10, 11-15, 16-20, 21-25.
    Same as rankBands() in src/modules/chaos/csv.ts. With fewer questions than ranks, empty
    bands are left out (the top rank always stays)."""
    k = len(ranks)
    out, lo = [], 0
    for i, name in enumerate(ranks):
        hi = int(math.floor(n * (i + 1) / k + 0.5))
        if hi >= lo:
            out.append(dict(name=name, lo=lo, hi=hi))
            lo = hi + 1
    return out


QUIZ_WORDS = {"quiz", "quizzes", "puzzle", "puzzles", "challenge", "test", "trivia", "riddles", "olympiad"}


def spoken_topic(settings):
    """What the narrator calls the quiz: "Maths quiz", "Science quiz", "Maths Puzzle".
    From the badge, else the intro title lines (when short, e.g. "Indian / History"), else General Knowledge."""
    badge = str(settings.get("quiz_badge") or "").split()
    title = " ".join(settings.get("title_lines") or []).replace("?", "").replace("!", "").split()
    words = badge or (title if len(title) <= 4 else [])
    out = []
    for w in words:
        if w.upper() == "GK":
            out += ["General", "Knowledge"]
        elif w.isupper() and len(w) <= 4 and w.isalpha() and w.lower() not in QUIZ_WORDS:
            out.append(w)                          # acronyms (IPL, ISRO) stay as letters
        else:
            out.append(w.capitalize() if w.isupper() else w)
    if not out:
        out = ["General", "Knowledge"]
    if out[-1].lower() not in QUIZ_WORDS:
        out.append("quiz")
    else:
        out[-1] = out[-1].lower() if out[-1].lower() == "quiz" else out[-1]
    return " ".join(out)


def load_cfg(spec):
    cfg = json.loads((TEMPLATE / "settings.json").read_text(encoding="utf-8"))
    if spec.get("format") == "youtube":
        cfg.update(YOUTUBE_OUTRO)
    for k, v in (spec.get("settings") or {}).items():
        if v not in (None, "", []):
            cfg[k] = v
    cfg["topic"] = spoken_topic(spec.get("settings") or {})
    return cfg


def load_questions(path, default_secs, limit=None):
    qs = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            if not row.get("question"):
                continue
            opts = [row.get(f"option_{c}", "") for c in "abcd"]
            if any(not o for o in opts):
                raise ValueError(f"Row {n}: all four options (option_a..option_d) are needed.")
            a = row.get("answer", "").upper()
            if len(a) == 1 and a in "ABCD":
                ans = "ABCD".index(a)
            elif a in ("1", "2", "3", "4"):
                ans = int(a) - 1
            elif row.get("answer", "") in opts:
                ans = opts.index(row["answer"])
            else:
                raise ValueError(f"Row {n}: answer must be A, B, C or D (got '{row.get('answer', '')}').")
            secs = row.get("seconds", "")
            qs.append(dict(q=row["question"], options=opts, answer=ans, fact=row.get("fact", ""),
                           seconds=max(1, min(60, int(secs))) if secs.isdigit() else int(default_secs)))
    if limit:
        qs = qs[:limit]
    if not qs:
        raise ValueError("No questions found in the CSV.")
    return qs


# ============================== templates ==============================
def pick_templates(cfg, fmt, seed):
    """Choose an intro, question background and outro picture for this video, each at random
    from every look in templates/ (so looks mix). settings.templates: "random" (default),
    "off", or a look's folder name to use only that look."""
    mode = str(cfg.get("templates") or "random")
    if mode == "off" or not LOOKS_DIR.is_dir():
        return {}
    looks = sorted(p for p in LOOKS_DIR.iterdir() if p.is_dir() and not p.name.startswith("_"))
    if mode != "random":
        looks = [p for p in looks if p.name == mode]
    r = random.Random(f"{seed}-templates")
    out = {}
    for kind in ("intro", "background", "outro"):
        files = [p / f"{kind}-{fmt}.png" for p in looks if (p / f"{kind}-{fmt}.png").exists()]
        if files:
            out[kind] = str(r.choice(files))
    return out


# ============================== audio ==============================
rng = np.random.default_rng(7)


def sound_pool(kind):
    d = SOUNDS_DIR / kind
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.suffix.lower() in SOUND_EXT and not p.name.startswith("_"))


def decode_sound(path, max_secs=None):
    """Any audio file -> mono float32 at SR, via the bundled ffmpeg."""
    cmd = [ffmpeg_exe(), "-v", "error", "-i", str(path)]
    if max_secs:
        cmd += ["-t", f"{max_secs:.2f}"]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(r.stderr.decode(errors="ignore")[-300:])
    return np.frombuffer(r.stdout, np.float32).copy()


def fit_sound(s, peak, max_secs=None, fade=0.25):
    """Trim, fade the tail and set the loudness peak so library sounds sit like the built-in ones."""
    loud = np.flatnonzero(np.abs(s) > np.abs(s).max() * 0.03)
    if len(loud):                                   # skip a quiet lead-in so the sound lands on cue
        s = s[max(0, loud[0] - int(0.01 * SR)):]
    if max_secs and len(s) > max_secs * SR:
        s = s[:int(max_secs * SR)].copy()
        n = min(len(s), int(fade * SR))
        s[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
    n = min(len(s), int(0.01 * SR))
    s[:n] *= np.linspace(0, 1, n, dtype=np.float32)
    return (s / (np.abs(s).max() + 1e-6) * peak).astype(np.float32)


def sound_credits(used):
    """Attribution lines for Creative Commons tracks this video used (sounds/CREDITS.json:
    {"file name": "credit text"}), for the YouTube description."""
    try:
        credits = json.loads((SOUNDS_DIR / "CREDITS.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    names = {pathlib.Path(n).name for files in used.values() for n in files}
    return [credits[n] for n in sorted(names) if credits.get(n)]


class Sounds:
    """Random picks from sounds/<kind>/ for this video. Returns None when a kind has no usable
    files, so the caller keeps its built-in synthetic sound. settings.sounds = "off" skips all."""

    def __init__(self, cfg, seed):
        self.on = str(cfg.get("sounds") or "on") != "off"
        self.r = random.Random(f"{seed}-sounds")
        self.used = {}

    def get(self, kind, peak, max_secs=None, count=1):
        pool = sound_pool(kind) if self.on else []
        self.r.shuffle(pool)
        out = []
        for p in pool:
            if len(out) >= count:
                break
            try:
                out.append(fit_sound(decode_sound(p, (max_secs or 0) + 1 if max_secs else None), peak, max_secs))
                self.used.setdefault(kind, []).append(p.name)
            except Exception as e:
                print(f"[sounds] skipped {p.name}: {e}", flush=True)
        if not out:
            return None
        return out if count > 1 else out[0]


def music_bed(sounds, cfg, total, voice_spans):
    """A background tune under the whole video: looped, faded, kept low and dipped further
    while the narrator speaks. settings.music_volume (default 1.0) scales it; 0 turns it off."""
    vol = float(cfg.get("music_volume", 1.0) or 0)
    mood = str(cfg.get("music_mood") or "upbeat").lower()
    if vol <= 0 or not sounds.on or mood == "off":
        return None
    # music/<mood>/ (e.g. upbeat, epic, suspense); "random" = every mood; loose files in music/ as a fallback
    root = SOUNDS_DIR / "music"
    moods = sorted(d.name for d in root.iterdir() if d.is_dir()) if root.is_dir() else []
    pool = [f for m in (moods if mood == "random" else [mood]) for f in sound_pool(f"music/{m}")]
    if not pool:
        pool = sound_pool("music")
    sounds.r.shuffle(pool)
    for p in pool:
        try:
            s = decode_sound(p)
        except Exception as e:
            print(f"[sounds] skipped {p.name}: {e}", flush=True)
            continue
        if len(s) < SR * 2:
            continue
        n = int(total * SR)
        reps = int(np.ceil(n / len(s)))
        m = np.tile(s, reps)[:n]
        rms = float(np.sqrt(np.mean(s ** 2))) + 1e-6
        m = m * (0.045 * vol / rms)                     # about -27 dBFS average
        duck = np.ones(n, np.float32)
        for a, b in voice_spans:
            duck[int(a * SR):int(b * SR)] = 0.45
        k = int(0.25 * SR)                              # smooth the dips
        duck = np.convolve(duck, np.ones(k, np.float32) / k, mode="same")
        fi, fo = min(n, int(1.5 * SR)), min(n, int(2.5 * SR))
        m[:fi] *= np.linspace(0, 1, fi)
        m[n - fo:] *= np.linspace(1, 0, fo)
        sounds.used.setdefault("music", []).append(f"{p.parent.name}/{p.name}" if p.parent != root else p.name)
        return np.clip(m * duck, -0.5, 0.5).astype(np.float32)
    return None


def bandpass(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x)).astype(np.float32)


def applause(dur=3.2):
    n = int(dur * SR)
    out = np.zeros(n, np.float32)
    t = np.linspace(0, 1, n)
    for _ in range(int(dur * 160)):
        st = int(rng.beta(1.6, 2.6) * (n - 2000))
        L = int(rng.uniform(0.004, 0.012) * SR)
        out[st:st + L] += rng.standard_normal(L) * np.exp(-np.linspace(0, 6, L)) * rng.uniform(0.3, 1.0)
    out = bandpass(out, 700, 5500)
    env = np.sin(np.pi * np.clip(t * 1.4, 0, 1)) ** 2
    crowd = bandpass(rng.standard_normal(n).astype(np.float32), 300, 2500) * 0.25
    cheer = np.zeros(n, np.float32)
    for _ in range(14):
        f0, ph = rng.uniform(260, 520), rng.uniform(0, 6.28)
        vib = (1 + 0.04 * np.sin(2 * np.pi * rng.uniform(4, 7) * t * dur)) * (1 + 0.25 * t)
        cheer += np.sin(2 * np.pi * f0 * np.cumsum(vib) / SR + ph) * rng.uniform(0.3, 1)
    cheer = bandpass(cheer, 250, 3000) * 0.06 * env
    mix = (out + crowd * env + cheer) * np.exp(-np.maximum(t - 0.55, 0) * 3)
    mix *= np.minimum(1, np.linspace(0, 1, n) / 0.04)
    return (mix / (np.abs(mix).max() + 1e-6) * 0.55).astype(np.float32)


def chime():
    out = np.zeros(int(1.4 * SR), np.float32)
    for i, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        st = int(i * 0.09 * SR)
        tt = np.arange(len(out) - st) / SR
        out[st:] += ((np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 3.2) * 0.22).astype(np.float32)
    return out


def tick(high=False):
    tt = np.arange(int(0.05 * SR)) / SR
    return (np.sin(2 * np.pi * (1800 if high else 1200) * tt) * np.exp(-tt * 90) * 0.5).astype(np.float32)


def whoosh():
    L = int(0.45 * SR)
    X = np.fft.rfft(rng.standard_normal(L).astype(np.float32))
    X *= np.exp(-((np.fft.rfftfreq(L, 1 / SR) - 900) / 700) ** 2)
    y = np.fft.irfft(X, L).astype(np.float32) * np.sin(np.pi * np.linspace(0, 1, L)) ** 2
    return y / (np.abs(y).max() + 1e-6) * 0.18


def riser(dur=0.8):
    L = int(dur * SR)
    y = bandpass(rng.standard_normal(L).astype(np.float32), 1500, 9000) * np.linspace(0, 1, L) ** 2.5
    return y / (np.abs(y).max() + 1e-6) * 0.22


def impact():
    L = int(1.6 * SR)
    tt = np.arange(L) / SR
    boom = np.sin(2 * np.pi * np.cumsum(110 * np.exp(-tt * 3) + 38) / SR) * np.exp(-tt * 2.6)
    crack = bandpass(rng.standard_normal(L).astype(np.float32), 200, 6000) * np.exp(-tt * 18) * 0.5
    y = boom + crack
    return (y / (np.abs(y).max() + 1e-6) * 0.7).astype(np.float32)


def popsnd():
    tt = np.arange(int(0.12 * SR)) / SR
    return (np.sin(2 * np.pi * (500 + 2500 * tt / 0.12) * tt) * np.exp(-tt * 35) * 0.35).astype(np.float32)


class Voice:
    def __init__(self, cfg, models_dir):
        from kokoro_onnx import Kokoro
        self.tts = Kokoro(str(models_dir / "kokoro.onnx"), str(models_dir / "voices.bin"))
        self.voice, self.lang = cfg.get("voice", "af_heart"), cfg.get("voice_lang", "en-us")
        self.cache = {}

    def say(self, text, speed=1.0):
        if text in self.cache:
            return self.cache[text]
        s, sr = self.tts.create(text, voice=self.voice, speed=speed, lang=self.lang)
        n = int(len(s) * SR / sr)
        s = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s).astype(np.float32)
        s = s / (np.abs(s).max() + 1e-6) * 0.85
        self.cache[text] = s
        return s


def build_timeline(cfg, qs, voice, job, sounds=None, ranks=None):
    """Events (what is on screen when) and the full audio mix.
    Library sounds (sounds/<kind>/) replace the built-in synthetic ones when present."""
    N = len(qs)
    secs = qs[0]["seconds"]
    fmt = lambda s: (s.replace("{n}", str(N)).replace("{seconds}", str(secs)).replace("{channel}", cfg["channel_name"])
                     .replace("{topic}", cfg.get("topic", "General Knowledge quiz")))
    events, audio, spans = [], [], []
    add = lambda at, s: audio.append((at, s))

    def say_at(at, s):
        add(at, s)
        spans.append((at, at + len(s) / SR))

    sounds = sounds or Sounds({"sounds": "off"}, 0)
    OPT_DELAY, HOLD = float(cfg.get("options_delay", 2.0)), float(cfg.get("answer_hold", 3.0))
    claps = sounds.get("applause", 0.5, HOLD + 0.2, count=4) or [applause(min(3.2, HOLD + 0.2)) for _ in range(4)]
    CHIME = sounds.get("reveal", 0.45, 2.0) if sounds.on else None
    CHIME = CHIME if CHIME is not None else chime()
    POP, TICK, TICKH = popsnd(), tick(), tick(True)
    whooshes = sounds.get("whoosh", 0.2, 2.0, count=3) or [whoosh() for _ in range(3)]
    intro_sting = sounds.get("intro", 0.7, 6.0)
    outro_sting = sounds.get("outro", 0.55, 9.0)

    SLAM = 0.9
    if intro_sting is not None:
        add(0.0, intro_sting)
    else:
        add(0.1, riser(SLAM - 0.1))
        add(SLAM, impact())
    job.progress("voice", 0, N + 2, "Recording the narration", force=True)
    intro_vo = voice.say(fmt(cfg["intro_voice"]))
    VO_AT = SLAM + 0.9
    say_at(VO_AT, intro_vo)
    t = max(VO_AT + len(intro_vo) / SR + 1.0, 7.5)
    events.append(dict(kind="intro", start=0, end=t, phase2=VO_AT + 1.6, slam=SLAM))

    if ranks:
        add(t, whooshes[-1])
        vo = voice.say(fmt(cfg.get("ranks_start_voice", "Keep count of your correct answers. At the end, find out which rank you get!")))
        say_at(t + 0.5, vo)
        end = max(t + 0.5 + len(vo) / SR + 1.5, t + 7.0)
        events.append(dict(kind="ranks", when="start", start=t, end=end))
        t = end

    for qi, q in enumerate(qs):
        job.progress("voice", qi + 1, N + 2, "Recording the narration")
        seg = dict(kind="q", idx=qi, q=q, start=t, cd=q["seconds"])
        add(t, whooshes[qi % len(whooshes)])
        say_at(t + 0.3, voice.say(cfg.get("question_voice", "Question {q}.").replace("{q}", str(qi + 1))))
        seg["opt_t"] = ot = t + 0.3 + OPT_DELAY
        add(ot, POP)
        seg["cd_start"] = ot + 0.3
        for k in range(seg["cd"]):
            add(seg["cd_start"] + k, TICKH if k >= seg["cd"] - 2 else TICK)
        seg["reveal"] = r = seg["cd_start"] + seg["cd"]
        add(r, CHIME)
        add(r + 0.15, claps[qi % len(claps)])
        seg["end"] = t = r + HOLD
        events.append(seg)

    if ranks:
        add(t + 0.1, whooshes[-1])
        if outro_sting is None:
            add(t + 0.3, impact() * 0.5)
        vo = voice.say(fmt(cfg.get("ranks_end_voice", "Time to count your score! Out of {n} questions, which rank did you get?")))
        say_at(t + 0.6, vo)
        end = max(t + 0.6 + len(vo) / SR + 3.0, t + 8.0)
        events.append(dict(kind="ranks", when="end", start=t, end=end))
        t = end

    outro_vo = voice.say(fmt(cfg["outro_voice"]))
    add(t + 0.1, whooshes[0] if len(whooshes) else whoosh())
    if outro_sting is not None:
        add(t + 0.2, outro_sting)
    else:
        add(t + 0.3, impact() * 0.6)
    say_at(t + 0.7, outro_vo)
    events.append(dict(kind="outro", start=t, end=t + 0.7 + len(outro_vo) / SR + 1.8))
    total = events[-1]["end"]

    mix = np.zeros(int((total + 2) * SR), np.float32)
    for at, s in audio:
        i = int(at * SR)
        mix[i:i + len(s)] += s[:len(mix) - i]
    mix = mix[:int(total * SR)]
    bed = music_bed(sounds, cfg, total, spans)
    if bed is not None:
        mix[:len(bed)] += bed
    mix /= max(1.0, np.abs(mix).max() / 0.95)
    return events, mix, total, fmt


# ============================== visuals ==============================
# Everything below runs in the render workers. init_render() sets these globals.
G = {}
ACC = [(255, 179, 0), (0, 194, 255), (255, 92, 141), (124, 220, 92)]
PAL = ACC + [(168, 85, 247), (255, 255, 255)]
GREEN, RED, INK = (34, 197, 94), (239, 68, 68), (28, 24, 64)


@lru_cache(maxsize=512)
def font(w, s):
    return ImageFont.truetype(str(TEMPLATE / "fonts" / f"Poppins-{w}.ttf"), max(8, int(s)))


def round_logo(path):
    """Cut the round badge out of the square logo (drops the sunburst corners)."""
    im = Image.open(path).convert("RGBA")
    S = im.width
    m = Image.new("L", (S * 4, S * 4), 0)
    r = S * 4 * 0.44
    c = S * 4 / 2
    ImageDraw.Draw(m).ellipse([c - r, c - r + 16, c + r, c + r + 16], fill=255)
    m = m.resize((S, S), Image.LANCZOS)
    im.putalpha(m)
    return im.crop(im.getbbox())


@lru_cache(maxsize=256)
def logo_at(which, size):
    return (G["LOGO"] if which == "logo" else G["MARK"]).resize((size, size), Image.LANCZOS)


@lru_cache(maxsize=64)
def tint_at(which, size, rgb):
    a = logo_at(which, size).getchannel("A").point(lambda v: int(v * 0.75))
    t = Image.new("RGBA", (size, size), rgb + (0,))
    t.putalpha(a)
    return t


def composite(img, src, x, y):
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(src.width, img.width - x), min(src.height, img.height - y)
    if ex > sx and ey > sy:
        piece = src.crop((sx, sy, ex, ey))
        img.paste(piece, (x + sx, y + sy), piece)


def overlay(img, rgba):
    layer = Image.new("RGBA", img.size, rgba)
    img.paste(layer, (0, 0), layer)


def paste_logo(img, which, cx, cy, size, glitch=0.0, t_=0.0, alpha=1.0):
    size = max(8, int(size))
    x, y = int(cx - size / 2), int(cy - size / 2)
    if glitch > 0.05:
        jr = random.Random(int(t_ * 30))
        dx = int(jr.uniform(8, 22) * glitch)
        composite(img, tint_at(which, size, (0, 230, 255)), x - dx, y)
        composite(img, tint_at(which, size, (255, 40, 120)), x + dx, y)
    lg = logo_at(which, size)
    if alpha < 1:
        lg = lg.copy()
        lg.putalpha(lg.getchannel("A").point(lambda v: int(v * alpha)))
    composite(img, lg, x, y)


def make_bg(W, H):
    y = np.linspace(0, 1, H)[:, None, None]
    x = np.linspace(0, 1, W)[None, :, None]
    k = y * 0.7 + x * 0.3
    g = np.array((30, 14, 74)) * (1 - k) + np.array((84, 30, 150)) * k
    img = Image.fromarray(np.broadcast_to(g, (H, W, 3)).astype(np.uint8))
    d = ImageDraw.Draw(img, "RGBA")
    r2 = random.Random(3)
    for _ in range(int(40 * W * H / (1080 * 1920))):
        cx, cy, rr = r2.randint(0, W), r2.randint(0, H), r2.randint(4, 14)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 255, 255, 18))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-300, -300, 700, 600], fill=(255, 179, 0, 40))
    gd.ellipse([W - 580, H - 520, W + 420, H + 380], fill=(255, 92, 141, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img.paste(glow, (0, 0), glow)
    return img


def auto_dim(img, target):
    """Bright designs (e.g. a yellow comic burst) would swallow white text: darken toward deep
    navy until the middle of the picture is no brighter than `target` (0-255 luminance)."""
    W, H = img.size
    mid = np.asarray(img.crop((int(W * .2), int(H * .15), int(W * .8), int(H * .85))).convert("L"), np.float32)
    lum = float(mid.mean())
    if lum <= target:
        return img
    a = min(0.82, (lum - target) / (lum - 12))
    print(f"[bg] auto-dim {a:.2f} (middle brightness {lum:.0f})", flush=True)
    return Image.blend(img, Image.new("RGB", img.size, (12, 8, 30)), a)


def load_bg(W, H, path, target=None):
    """A template background (e.g. a Canva PNG export), cropped to fill W x H.
    Falls back to the built-in gradient when no file is set or it cannot be read."""
    if path:
        p = pathlib.Path(path)
        if not p.is_absolute():
            p = ENGINE.parent / p
        try:
            src = Image.open(p).convert("RGB")
            s = max(W / src.width, H / src.height)
            src = src.resize((math.ceil(src.width * s), math.ceil(src.height * s)), Image.LANCZOS)
            x, y = (src.width - W) // 2, (src.height - H) // 2
            print(f"[bg] using template background {p}", flush=True)
            src = src.crop((x, y, x + W, y + H))
            return auto_dim(src, target) if target else src
        except Exception as e:
            print(f"[bg] could not use {p} ({e}); using the built-in background", flush=True)
    return make_bg(W, H)


def wrap(d, text, f, maxw):
    lines, cur = [], ""
    for w_ in text.split():
        test = (cur + " " + w_).strip()
        if d.textlength(test, font=f) <= maxw:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w_
    lines.append(cur)
    return lines


def clip_lines(lines, n):
    """At most n lines; mark cut text with an ellipsis."""
    if len(lines) <= n:
        return lines
    return lines[:n - 1] + [lines[n - 1].rstrip(" ,.;:") + "…"]


def ease(x):
    x = min(max(x, 0), 1)
    return 1 - (1 - x) ** 3


def pop(x):
    x = min(max(x, 0), 1)
    return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2


def fit_font(d, text, weight, size, maxw, min_size):
    f = font(weight, size)
    while d.textlength(text, font=f) > maxw and size > min_size:
        size -= 2
        f = font(weight, size)
    return f


def confetti(d, dt):
    for p in G["CONF"]:
        y = p["y0"] + p["vy"] * dt + 260 * dt * dt
        if y > G["H"] + 40:
            continue
        x = p["x"] + p["vx"] * dt + 30 * math.sin(dt * 3 + p["rot"])
        a = p["rot"] + p["vr"] * dt
        sq = abs(math.cos(a * 0.7)) * 0.8 + 0.2
        d.polygon([(x + math.cos(a + k * math.pi / 2) * p["s"] * (sq if k % 2 else 1) * 0.7,
                    y + math.sin(a + k * math.pi / 2) * p["s"] * (sq if k % 2 else 1) * 0.7) for k in range(4)], fill=p["c"])


def draw_shape(d, sh, x, y, rot, alpha):
    c, s_ = sh["c"] + (int(alpha),), sh["s"]
    if sh["kind"] == "circ":
        d.ellipse([x - s_ * .6, y - s_ * .6, x + s_ * .6, y + s_ * .6], fill=c)
    elif sh["kind"] == "ring":
        d.ellipse([x - s_, y - s_, x + s_, y + s_], outline=c, width=max(3, int(s_ / 4)))
    elif sh["kind"] in ("tri", "sq"):
        n = 3 if sh["kind"] == "tri" else 4
        d.polygon([(x + math.cos(rot + k * 2 * math.pi / n) * s_, y + math.sin(rot + k * 2 * math.pi / n) * s_) for k in range(n)], fill=c)
    elif sh["kind"] == "plus":
        for a in (rot, rot + math.pi / 2):
            d.line([(x - math.cos(a) * s_, y - math.sin(a) * s_), (x + math.cos(a) * s_, y + math.sin(a) * s_)], fill=c, width=max(4, int(s_ / 3)))
    else:
        pts = []
        for k in range(5):
            u, v = (k - 2) * s_ * .5, (s_ * .3 if k % 2 else -s_ * .3)
            pts.append((x + math.cos(rot) * u - math.sin(rot) * v, y + math.sin(rot) * u + math.cos(rot) * v))
        d.line(pts, fill=c, width=max(4, int(s_ / 4)), joint="curve")


def chaos_field(d, dt, cx, cy):
    for sh in G["SHAPES"]:
        if dt < 0:
            continue
        k, m = ease(dt / 1.1), ease((dt - 1.0) / 2.5)
        bx, by = cx + math.cos(sh["ang"]) * sh["sp"] * k, cy + math.sin(sh["ang"]) * sh["sp"] * k
        drift = 18 * math.sin(dt * 1.3 + sh["rot"])
        draw_shape(d, sh, bx * (1 - m) + sh["ax"] * m + drift, by * (1 - m) + sh["ay"] * m + drift * .6,
                   sh["rot"] + sh["vr"] * dt * (1 if dt < 1.2 else .25), 210 - 70 * m)


def dark_and_stripes(img, t_):
    W, H = G["W"], G["H"]
    overlay(img, (8, 6, 20, G.get("DIM", 130)))
    d = ImageDraw.Draw(img, "RGBA")
    off = (t_ * 120) % 160
    for i in range(-4, int((W + 800) / 160) + 2):
        x0 = i * 160 + off
        d.polygon([(x0, 0), (x0 + 60, 0), (x0 - 640 * H / 1920, H), (x0 - 700 * H / 1920, H)], fill=(255, 255, 255, 22))
    return d


def timer(d, seg, tt, cx, cy, R, num_size, label_font):
    CD = seg["cd"]
    if not (seg["cd_start"] - 0.3 <= tt < seg["reveal"] + 0.25):
        return
    rem = seg["reveal"] - tt
    a = 1 if tt < seg["reveal"] else max(0, 1 - (tt - seg["reveal"]) / 0.25)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(255, 255, 255, int(30 * a)))
    d.arc([cx - R, cy - R, cx + R, cy + R], -90, -90 + 360 * max(rem, 0) / CD,
          fill=((255, 179, 0) if rem > 2 else RED) + (int(255 * a),), width=max(12, int(R / 5.75)))
    beat = 1 + 0.15 * max(0, 1 - ((CD - rem) % 1) / 0.25)
    d.text((cx, cy), str(max(1, math.ceil(rem))) if rem > 0 else "0", font=font("Bold", num_size * beat),
           fill=(255, 255, 255, int(255 * a)), anchor="mm")
    if tt < seg["cd_start"] + 1.2:
        d.text((cx, cy - R - 45), G["CFG"].get("timer_text", "Think fast!"), font=label_font, fill=(255, 255, 255, int(220 * a)), anchor="mm")


def option_box(d, li, opt, x, y, w, h, seg, tt, ok, rk, revealed, f_let, opt_size, min_opt):
    ans = seg["q"]["answer"]
    fillc, txt, ring = (255, 255, 255, int(235 * ok)), INK, ACC[li]
    if revealed:
        if li == ans:
            fillc, txt, ring = GREEN + (255,), (255, 255, 255), (255, 255, 255)
        else:
            fillc, txt = (255, 255, 255, int(235 - 150 * rk)), INK + (int(255 - 140 * rk),)
    pad = (pop((tt - seg["reveal"]) / 0.4) - 1) * 40 if (revealed and li == ans) else 0
    d.rounded_rectangle([x - pad, y - pad, x + w + pad, y + h + pad], h // 2, fill=fillc)
    cr = h * 0.36
    lx, cy = x + 22 + cr, y + h / 2
    d.ellipse([lx - cr, cy - cr, lx + cr, cy + cr], fill=ring)
    d.text((lx, cy), "ABCD"[li], font=f_let, fill=GREEN if (revealed and li == ans) else INK, anchor="mm")
    fo = fit_font(d, opt, "Medium", opt_size, w - (lx + cr - x) - 140, min_opt)
    d.text((lx + cr + 28, cy), opt, font=fo, fill=txt, anchor="lm")
    mx = x + w - 60
    if revealed and li == ans:
        d.line([(mx - 26, cy), (mx - 8, cy + 20), (mx + 26, cy - 22)], fill="white", width=11, joint="curve")
    elif revealed and rk > 0.5:
        for a_, b_ in (((-18, -18), (18, 18)), ((-18, 18), (18, -18))):
            d.line([(mx + a_[0], cy + a_[1]), (mx + b_[0], cy + b_[1])], fill=RED + (int(200 * rk),), width=9)


def badge_pill(d, text, x0, y0, y1, size, max_right):
    """The yellow quiz tag: grows with its text up to max_right, then the text shrinks to fit."""
    pad = 36
    f = fit_font(d, text, "Bold", size, max_right - x0 - 2 * pad, 18)
    w = max(270, d.textlength(text, font=f) + 2 * pad)
    d.rounded_rectangle([x0, y0, x0 + w, y1], (y1 - y0) // 2, fill=(255, 179, 0))
    d.text((x0 + w / 2, (y0 + y1) / 2), text, font=f, fill=(30, 20, 60), anchor="mm")


# ---------- 9:16 (Shorts / Reels): same layout as the original template ----------
def header_tall(img, d, qi):
    N = G["N"]
    paste_logo(img, "mark", 118, 130, 128)
    counter = f"Question {qi + 1}/{N}"
    badge_pill(d, G["CFG"].get("quiz_badge", "GK QUIZ"), 200, 98, 162, 38, 1020 - d.textlength(counter, font=font("Bold", 38)) - 30)
    d.text((1020, 130), counter, font=font("Bold", 38), fill="white", anchor="rm")
    d.rounded_rectangle([60, 222, 1020, 236], 7, fill=(255, 255, 255, 40))
    d.rounded_rectangle([60, 222, 60 + 960 * (qi + 1) / N, 236], 7, fill=(255, 179, 0))


def draw_q_tall(img, seg, tt):
    d = ImageDraw.Draw(img, "RGBA")
    # Cached rendering: "static" draws everything but the timer and confetti, "dynamic" only those
    S = d if G["PARTS"] != "dynamic" else _NoDraw(d)
    dyn = G["PARTS"] != "static"
    q = seg["q"]
    if S is d:
        header_tall(img, d, seg["idx"])
    k = ease((tt - seg["start"]) / 0.45)
    off = int((1 - k) * 80)
    F_Q = font("Bold", 58)
    lines = wrap(d, q["q"], F_Q, 860)
    if len(lines) > 4:
        F_Q = font("Bold", 46)
        lines = wrap(d, q["q"], F_Q, 860)
    ch = int(len(lines) * F_Q.size * 1.2 + 110)
    top = 380 + off
    S.rounded_rectangle([390, top - 92, 690, top - 26], 33, fill=(255, 92, 141, int(255 * k)))
    S.text((540, top - 59), f"QUESTION {seg['idx'] + 1}", font=font("Medium", 30), fill=(255, 255, 255, int(255 * k)), anchor="mm")
    S.rounded_rectangle([60, top + 10, 1020, top + ch + 10], 44, fill=(0, 0, 0, int(70 * k)))
    S.rounded_rectangle([60, top, 1020, top + ch], 44, fill=(255, 255, 255, int(255 * k)))
    for i, ln in enumerate(lines):
        S.text((540, top + 55 + i * F_Q.size * 1.2), ln, font=F_Q, fill=INK + (int(255 * k),), anchor="ma")
    revealed = tt >= seg["reveal"]
    rk = ease((tt - seg["reveal"]) / 0.35)
    oy = top + ch + 60 - off
    ok = ease((tt - seg["opt_t"] + 0.1) / 0.35)
    if ok > 0:
        for li, opt in enumerate(q["options"]):
            option_box(S, li, opt, 60 + int((1 - ok) * 300), oy + li * 178, 960, 140, seg, tt, ok, rk, revealed, font("Bold", 48), 50, 30)
    by = oy + 4 * 178 + 60
    if dyn:
        timer(d, seg, tt, G["W"] / 2, by + 140, 115, 96, font("Medium", 40))
    if revealed and q["fact"]:
        fk = ease((tt - seg["reveal"] - 0.25) / 0.4)
        if fk > 0:
            F_FACT = font("Medium", 40)
            S.rounded_rectangle([60, by + 20, 1020, by + 280], 36, fill=(255, 255, 255, int(38 * fk)))
            S.text((100, by + 52), "DID YOU KNOW?", font=font("Medium", 30), fill=(255, 179, 0, int(255 * fk)))
            yy = by + 100
            for ln in clip_lines(wrap(d, q["fact"], F_FACT, 880), 3):
                S.text((100, yy), ln, font=F_FACT, fill=(255, 255, 255, int(240 * fk)))
                yy += 52
    if revealed and tt - seg["reveal"] < G["HOLD"] + 0.5:
        if dyn:
            confetti(d, tt - seg["reveal"])


def draw_intro_tall(img, seg, tt):
    W, H, CFG = G["W"], G["H"], G["CFG"]
    d = dark_and_stripes(img, tt)
    SLAM = seg["slam"]
    dt = tt - SLAM
    if dt < 0:
        k = tt / SLAM
        for i in range(14):
            a, r0 = i / 14 * 2 * math.pi, 1100 * (1 - k)
            d.line([(W / 2 + math.cos(a) * r0, H * .42 + math.sin(a) * r0),
                    (W / 2 + math.cos(a) * (r0 + 160), H * .42 + math.sin(a) * (r0 + 160))], fill=PAL[i % 6] + (200,), width=8)
        return
    chaos_field(d, dt, W / 2, H * 0.42)
    m = ease((tt - seg["phase2"]) / 0.7)
    size = 760 * (1 + 1.4 * (1 - ease(dt / 0.18))) * (1 - 0.3 * m)
    shake = 22 * max(0, 1 - dt / 0.5)
    sr = random.Random(int(tt * 60))
    cy = (H * 0.42) * (1 - m) + 450 * m
    paste_logo(img, "logo", W / 2 + sr.uniform(-shake, shake), cy + sr.uniform(-shake, shake), size,
               glitch=max(0, 1 - dt / 0.9) + (0.25 if sr.random() < 0.06 else 0), t_=tt)
    if dt < 0.12:
        overlay(img, (255, 255, 255, int(255 * (1 - dt / 0.12))))
    if m > 0:
        d = ImageDraw.Draw(img, "RGBA")
        yo = 40 * (1 - m)
        d.rounded_rectangle([250, 880 - yo, 830, 960 - yo], 40, fill=(255, 92, 141, int(255 * m)))
        d.text((540, 920 - yo), CFG.get("intro_badge", "TODAY'S QUIZ"), font=font("Bold", 38), fill=(255, 255, 255, int(255 * m)), anchor="mm")
        y = 1060
        for i, ln in enumerate(CFG["title_lines"]):
            x_ = (tt - seg["phase2"] - 0.2 - i * 0.12) / 0.45
            if ease(x_) > 0:
                f = fit_font(d, ln, "Bold", 130, 980, 60)
                d.text((540, y), ln, font=font("Bold", f.size * pop(x_)), fill=(255, 255, 255, int(255 * ease(x_))), anchor="mm")
            y += 150
        y += 50
        for i, ln in enumerate(CFG["intro_lines"]):
            kk = ease((tt - seg["phase2"] - 0.7 - i * 0.2) / 0.4)
            d.text((540, y), G["fmt"](ln), font=font("Medium", 46), fill=(255, 255, 255, int(235 * kk)), anchor="mm")
            y += 72


def draw_outro_tall(img, seg, tt):
    W, H, CFG = G["W"], G["H"], G["CFG"]
    d = dark_and_stripes(img, tt)
    dt = tt - seg["start"]
    chaos_field(d, dt + 0.6, W / 2, H * 0.5)
    k = ease(dt / 0.5)
    d.text((540, 330), CFG["outro_title"][0], font=font("Bold", 120 * pop(dt / 0.5)), fill=(255, 255, 255, int(255 * k)), anchor="mm")
    d.text((540, 480), CFG["outro_title"][1], font=font("Bold", 170 * pop((dt - .15) / 0.5)),
           fill=(255, 179, 0, int(255 * ease((dt - .15) / .5))), anchor="mm")
    y = 650
    for i, ln in enumerate(CFG["outro_lines"]):
        d.text((540, y), G["fmt"](ln), font=font("Medium", 48), fill=(255, 255, 255, int(235 * ease((dt - 0.5 - i * 0.2) / 0.4))), anchor="mm")
        y += 76
    lk = (dt - 1.0) / 0.6
    if lk > 0:
        paste_logo(img, "logo", 540, 1150, 560 * min(1, pop(lk)), alpha=ease(lk))
        subscribe(ImageDraw.Draw(img, "RGBA"), dt, 540, 1580, 1.0)


def subscribe(d, dt, cx, cy, scale):
    bk, pulse = ease((dt - 1.6) / 0.4), 1 + 0.05 * math.sin(dt * 6)
    bw, bh = 300 * pulse * scale, 64 * pulse * scale
    d.rounded_rectangle([cx - bw, cy - bh, cx + bw, cy + bh], int(bh), fill=(239, 35, 60, int(255 * bk)))
    d.text((cx, cy), "SUBSCRIBE", font=font("Bold", 60 * pulse * scale), fill=(255, 255, 255, int(255 * bk)), anchor="mm")


# ---------- 16:9 (YouTube): question on the left, timer on the right, 2x2 options ----------
def header_wide(img, d, qi):
    N, W = G["N"], G["W"]
    paste_logo(img, "mark", 110, 92, 112)
    counter = f"Question {qi + 1}/{N}"
    badge_pill(d, G["CFG"].get("quiz_badge", "GK QUIZ"), 186, 64, 120, 34, min(1100, W - 60 - d.textlength(counter, font=font("Bold", 38)) - 40))
    d.text((W - 60, 92), counter, font=font("Bold", 38), fill="white", anchor="rm")
    d.rounded_rectangle([60, 162, W - 60, 174], 6, fill=(255, 255, 255, 40))
    d.rounded_rectangle([60, 162, 60 + (W - 120) * (qi + 1) / N, 174], 6, fill=(255, 179, 0))


def draw_q_wide(img, seg, tt):
    W = G["W"]
    d = ImageDraw.Draw(img, "RGBA")
    # Cached rendering: "static" draws everything but the timer and confetti, "dynamic" only those
    S = d if G["PARTS"] != "dynamic" else _NoDraw(d)
    dyn = G["PARTS"] != "static"
    q = seg["q"]
    if S is d:
        header_wide(img, d, seg["idx"])
    k = ease((tt - seg["start"]) / 0.45)
    off = int((1 - k) * 60)
    x0, x1 = 60, 1480
    size = 56
    F_Q = font("Bold", size)
    lines = wrap(d, q["q"], F_Q, x1 - x0 - 100)
    while len(lines) > 3 and size > 38:
        size -= 4
        F_Q = font("Bold", size)
        lines = wrap(d, q["q"], F_Q, x1 - x0 - 100)
    ch = int(len(lines) * F_Q.size * 1.2 + 80)
    top = 262 + off
    S.rounded_rectangle([x0 + 40, top - 60, x0 + 300, top - 10], 25, fill=(255, 92, 141, int(255 * k)))
    S.text((x0 + 170, top - 35), f"QUESTION {seg['idx'] + 1}", font=font("Medium", 28), fill=(255, 255, 255, int(255 * k)), anchor="mm")
    S.rounded_rectangle([x0, top + 10, x1, top + ch + 10], 40, fill=(0, 0, 0, int(70 * k)))
    S.rounded_rectangle([x0, top, x1, top + ch], 40, fill=(255, 255, 255, int(255 * k)))
    for i, ln in enumerate(lines):
        S.text(((x0 + x1) / 2, top + 40 + i * F_Q.size * 1.2), ln, font=F_Q, fill=INK + (int(255 * k),), anchor="ma")
    if dyn:
        timer(d, seg, tt, 1690, top + max(ch, 230) / 2 + 20, 100, 84, font("Medium", 34))

    revealed = tt >= seg["reveal"]
    rk = ease((tt - seg["reveal"]) / 0.35)
    oy = top + max(ch, 230) + 46 - off
    ok = ease((tt - seg["opt_t"] + 0.1) / 0.35)
    bw, bh, gap = (W - 120 - 40) // 2, 128, 30
    if ok > 0:
        for li, opt in enumerate(q["options"]):
            col, row = li % 2, li // 2
            x = 60 + col * (bw + 40) + int((1 - ok) * (-200 if col == 0 else 200))
            option_box(S, li, opt, x, oy + row * (bh + gap), bw, bh, seg, tt, ok, rk, revealed, font("Bold", 42), 44, 26)
    fy = oy + 2 * bh + gap + 28
    if revealed and q["fact"]:
        fk = ease((tt - seg["reveal"] - 0.25) / 0.4)
        if fk > 0:
            F_FACT = font("Medium", 36)
            fl = clip_lines(wrap(d, q["fact"], F_FACT, W - 220), 2)
            fh = 70 + len(fl) * 46
            fy = min(fy, G["H"] - 24 - fh)
            S.rounded_rectangle([60, fy, W - 60, fy + fh], 32, fill=(255, 255, 255, int(38 * fk)))
            S.text((100, fy + 18), "DID YOU KNOW?", font=font("Medium", 28), fill=(255, 179, 0, int(255 * fk)))
            yy = fy + 58
            for ln in fl:
                S.text((100, yy), ln, font=F_FACT, fill=(255, 255, 255, int(240 * fk)))
                yy += 46
    if revealed and tt - seg["reveal"] < G["HOLD"] + 0.5:
        if dyn:
            confetti(d, tt - seg["reveal"])


def draw_intro_wide(img, seg, tt):
    W, H, CFG = G["W"], G["H"], G["CFG"]
    d = dark_and_stripes(img, tt)
    SLAM = seg["slam"]
    dt = tt - SLAM
    if dt < 0:
        k = tt / SLAM
        for i in range(14):
            a, r0 = i / 14 * 2 * math.pi, 1100 * (1 - k)
            d.line([(W / 2 + math.cos(a) * r0, H / 2 + math.sin(a) * r0),
                    (W / 2 + math.cos(a) * (r0 + 160), H / 2 + math.sin(a) * (r0 + 160))], fill=PAL[i % 6] + (200,), width=8)
        return
    chaos_field(d, dt, W / 2, H / 2)
    m = ease((tt - seg["phase2"]) / 0.7)
    size = 640 * (1 + 1.4 * (1 - ease(dt / 0.18))) * (1 - 0.15 * m)
    shake = 22 * max(0, 1 - dt / 0.5)
    sr = random.Random(int(tt * 60))
    cx = (W / 2) * (1 - m) + 540 * m
    paste_logo(img, "logo", cx + sr.uniform(-shake, shake), H / 2 + sr.uniform(-shake, shake), size,
               glitch=max(0, 1 - dt / 0.9) + (0.25 if sr.random() < 0.06 else 0), t_=tt)
    if dt < 0.12:
        overlay(img, (255, 255, 255, int(255 * (1 - dt / 0.12))))
    if m > 0:
        d = ImageDraw.Draw(img, "RGBA")
        RX = 1360
        yo = 40 * (1 - m)
        d.rounded_rectangle([RX - 280, 250 - yo, RX + 280, 326 - yo], 38, fill=(255, 92, 141, int(255 * m)))
        d.text((RX, 288 - yo), CFG.get("intro_badge", "TODAY'S QUIZ"), font=font("Bold", 36), fill=(255, 255, 255, int(255 * m)), anchor="mm")
        y = 430
        for i, ln in enumerate(CFG["title_lines"]):
            x_ = (tt - seg["phase2"] - 0.2 - i * 0.12) / 0.45
            if ease(x_) > 0:
                f = fit_font(d, ln, "Bold", 120, 900, 56)
                d.text((RX, y), ln, font=font("Bold", f.size * pop(x_)), fill=(255, 255, 255, int(255 * ease(x_))), anchor="mm")
            y += 136
        y += 40
        for i, ln in enumerate(CFG["intro_lines"]):
            kk = ease((tt - seg["phase2"] - 0.7 - i * 0.2) / 0.4)
            d.text((RX, y), G["fmt"](ln), font=font("Medium", 42), fill=(255, 255, 255, int(235 * kk)), anchor="mm")
            y += 64


def draw_outro_wide(img, seg, tt):
    W, H, CFG = G["W"], G["H"], G["CFG"]
    d = dark_and_stripes(img, tt)
    dt = tt - seg["start"]
    chaos_field(d, dt + 0.6, W / 2, H / 2)
    k = ease(dt / 0.5)
    LX = 620
    # Fitted so longer titles stay left of the logo (which sits at x 1130-1630)
    f1 = fit_font(d, CFG["outro_title"][0], "Bold", 110, 1060, 60)
    f2 = fit_font(d, CFG["outro_title"][1], "Bold", 160, 1060, 70)
    d.text((LX, 300), CFG["outro_title"][0], font=font("Bold", f1.size * pop(dt / 0.5)), fill=(255, 255, 255, int(255 * k)), anchor="mm")
    d.text((LX, 450), CFG["outro_title"][1], font=font("Bold", f2.size * pop((dt - .15) / 0.5)),
           fill=(255, 179, 0, int(255 * ease((dt - .15) / .5))), anchor="mm")
    y = 620
    for i, ln in enumerate(CFG["outro_lines"]):
        fl = fit_font(d, G["fmt"](ln), "Medium", 46, 1060, 30)
        d.text((LX, y), G["fmt"](ln), font=fl, fill=(255, 255, 255, int(235 * ease((dt - 0.5 - i * 0.2) / 0.4))), anchor="mm")
        y += 72
    lk = (dt - 1.0) / 0.6
    if lk > 0:
        paste_logo(img, "logo", 1380, 440, 500 * min(1, pop(lk)), alpha=ease(lk))
        subscribe(ImageDraw.Draw(img, "RGBA"), dt, 1380, 860, 0.85)


RANK_COLORS = [(0, 194, 255), (124, 220, 92), (255, 179, 0), (255, 122, 60), (255, 92, 141), (168, 85, 247)]


def star(d, cx, cy, r, fill):
    d.polygon([(cx + math.cos(-math.pi / 2 + k * math.pi / 5) * (r if k % 2 == 0 else r * 0.45),
                cy + math.sin(-math.pi / 2 + k * math.pi / 5) * (r if k % 2 == 0 else r * 0.45)) for k in range(10)], fill=fill)


def draw_ranks_wide(img, seg, tt):
    """The rank table: highest rank on top, rows sliding in from the lowest up."""
    W, H, N = G["W"], G["H"], G["N"]
    d = dark_and_stripes(img, tt)
    dt = tt - seg["start"]
    k = ease(dt / 0.45)
    start = seg["when"] == "start"
    pill = "KEEP SCORE!" if start else "TIME TO COUNT!"
    pw = d.textlength(pill, font=font("Bold", 34)) / 2 + 40
    d.rounded_rectangle([W / 2 - pw, 52, W / 2 + pw, 112], 30, fill=(255, 92, 141, int(255 * k)))
    d.text((W / 2, 82), pill, font=font("Bold", 34), fill=(255, 255, 255, int(255 * k)), anchor="mm")
    d.text((W / 2, 180), "What's your rank?", font=font("Bold", 84 * pop(dt / 0.5)), fill=(255, 179, 0, int(255 * k)), anchor="mm")
    sub = f"Count your correct answers out of {N}" if start else f"How many of the {N} did you get right?"
    d.text((W / 2, 258), sub, font=font("Medium", 40), fill=(255, 255, 255, int(230 * ease((dt - 0.3) / 0.4))), anchor="mm")
    bands = G["RANKS"]
    n = len(bands)
    top, bottom = 312, H - 40
    gap = 18
    rh = min(112, (bottom - top - gap * (n - 1)) / n)
    top += (bottom - top - (n * rh + gap * (n - 1))) / 2   # centred when there are few ranks
    for level in range(n - 1, -1, -1):
        b = bands[level]
        row = n - 1 - level                       # 0 = top row = highest rank
        y = top + row * (rh + gap)
        kk = ease((dt - 0.5 - level * 0.22) / 0.4)
        if kk <= 0:
            continue
        frac = level / (n - 1) if n > 1 else 1
        w = 900 + 420 * frac
        x0 = W / 2 - w / 2 + (1 - kk) * (-260 if level % 2 else 260)
        col = RANK_COLORS[round(frac * (len(RANK_COLORS) - 1))]
        a = int(255 * kk)
        d.rounded_rectangle([x0, y, x0 + w, y + rh], int(rh / 2), fill=(255, 255, 255, int(34 * kk)), outline=col + (a,), width=4)
        rng = f"{b['lo']}" if b["lo"] == b["hi"] else f"{b['lo']} – {b['hi']}"
        d.rounded_rectangle([x0 + 10, y + 10, x0 + 250, y + rh - 10], int((rh - 20) / 2), fill=col + (a,))
        d.text((x0 + 130, y + rh / 2), rng, font=fit_font(d, rng, "Bold", int(rh * 0.42), 210, 24), fill=INK + (a,), anchor="mm")
        sr_ = min(26, rh * 0.24)
        stars_w = (level + 1) * sr_ * 2.3
        f = fit_font(d, b["name"], "Bold", int(rh * 0.48), w - 300 - stars_w - 30, 26)
        d.text((x0 + 285, y + rh / 2), b["name"], font=f, fill=(255, 255, 255, a), anchor="lm")
        for s_ in range(level + 1):
            star(d, x0 + w - 40 - s_ * sr_ * 2.3, y + rh / 2, sr_, (255, 215, 0, a))


LAYOUTS = {
    "shorts": dict(W=1080, H=1920, intro=draw_intro_tall, outro=draw_outro_tall, q=draw_q_tall),
    "youtube": dict(W=1920, H=1080, intro=draw_intro_wide, outro=draw_outro_wide, q=draw_q_wide, ranks=draw_ranks_wide),
}


def init_render(state):
    """Worker setup: everything the drawing functions need."""
    G.clear()
    G.update(state)
    W, H = G["W"], G["H"]
    N, secs, cfg = G["N"], G["SECS"], G["CFG"]
    G["fmt"] = lambda s: s.replace("{n}", str(N)).replace("{seconds}", str(secs)).replace("{channel}", cfg["channel_name"])
    G["LOGO"] = round_logo(TEMPLATE / cfg["logo"])
    G["MARK"] = round_logo(TEMPLATE / cfg["logo_small"])
    tpl = G.get("TPL") or {}
    G["BG"] = load_bg(W, H, cfg.get(f"background_{G['FORMAT']}") or cfg.get("background") or tpl.get("background"), 95)
    # Intro / outro use their own Canva screen when one was picked, else the question background.
    # Canva screens are auto-darkened just enough for white text, then only lightly dimmed.
    for kind in ("intro", "outro"):
        G["BG_" + kind] = load_bg(W, H, tpl[kind], 80) if tpl.get(kind) else G["BG"]
        G["DIM_" + kind] = 45 if tpl.get(kind) else 130
    G["draw"] = {k: v for k, v in LAYOUTS[G["FORMAT"]].items() if k in ("intro", "outro", "q", "ranks")}
    cr = np.random.default_rng(11)
    G["CONF"] = [dict(x=cr.uniform(0, W), vy=cr.uniform(900, 1400) * H / 1920, vx=cr.uniform(-120, 120),
                      y0=cr.uniform(-300, 0), rot=cr.uniform(0, 6.28), vr=cr.uniform(-8, 8),
                      c=ACC[cr.integers(4)] + (230,), s=cr.uniform(10, 18)) for _ in range(int(80 * W / 1080))]
    crng = random.Random(21)
    shapes = []
    for i in range(70):
        side = i % 4
        ax, ay = [(crng.uniform(30, 150), crng.uniform(60, H - 60)), (crng.uniform(W - 150, W - 30), crng.uniform(60, H - 60)),
                  (crng.uniform(60, W - 60), crng.uniform(30, 170)), (crng.uniform(60, W - 60), crng.uniform(H - 200, H - 40))][side]
        shapes.append(dict(kind=crng.choice(["tri", "circ", "sq", "zig", "ring", "plus"]), c=crng.choice(PAL),
                           ang=crng.uniform(0, 2 * math.pi), sp=crng.uniform(350, 1300), rot=crng.uniform(0, 6.3),
                           vr=crng.uniform(-4, 4), s=crng.uniform(16, 46), ax=ax, ay=ay))
    G["SHAPES"] = shapes


class _NoDraw:
    """Stands in for ImageDraw when only the moving parts are drawn: measures text, draws nothing."""

    def __init__(self, d):
        self._d = d

    def textlength(self, *a, **k):
        return self._d.textlength(*a, **k)

    def __getattr__(self, name):
        return lambda *a, **k: None


def _static_key(seg, tt):
    """While a question is on screen most of the picture stands still: only the timer ticks
    (countdown) or the confetti falls (answer). Those stretches reuse one cached base image."""
    if seg["start"] + 0.45 <= tt < seg["opt_t"] - 0.1:
        return ("ask", seg["idx"])        # question only: every frame identical
    if seg["opt_t"] + 0.3 <= tt < seg["reveal"]:
        return ("count", seg["idx"])      # base + timer
    if tt >= seg["reveal"] + 0.7:
        return ("answer", seg["idx"])     # base + confetti
    return None


def _segment(tt):
    for seg in G["events"]:
        if seg["start"] <= tt < seg["end"]:
            return seg
    return None


def frame(tt):
    seg = _segment(tt)
    kind = seg["kind"] if seg else "q"
    img = G.get("BG_" + kind, G["BG"]).copy()
    G["DIM"] = G.get("DIM_" + kind, 130)
    G["PARTS"] = "all"
    if seg:
        G["draw"][seg["kind"]](img, seg, tt)
    return img


def frame_bytes(tt):
    """Raw RGB bytes for one frame, using the cached still parts where possible."""
    seg = _segment(tt)
    key = _static_key(seg, tt) if seg and seg["kind"] == "q" else None
    if key is None:
        return frame(tt).tobytes()
    if G.get("cache_key") != key:
        base = G["BG"].copy()
        G["PARTS"] = "static"
        G["draw"]["q"](base, seg, tt)
        G["cache_key"], G["cache_img"], G["cache_bytes"] = key, base, base.tobytes() if key[0] == "ask" else None
    if key[0] == "ask":
        return G["cache_bytes"]
    img = G["cache_img"].copy()
    G["PARTS"] = "dynamic"
    G["draw"]["q"](img, seg, tt)
    return img.tobytes()


def render_part(args):
    """Render frames [f0, f1) to a video-only MP4. Returns the part path."""
    idx, f0, f1, out, counter = args
    W, H = G["W"], G["H"]
    ff = subprocess.Popen([G["FFMPEG"], "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-threads", "2", str(out)],
                          stdin=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    for i in range(f0, f1):
        ff.stdin.write(frame_bytes(i / FPS))
        if (i - f0) % 15 == 14:
            with counter.get_lock():
                counter.value += 15
    ff.stdin.close()
    if ff.wait() != 0:
        raise RuntimeError(f"ffmpeg failed on part {idx}")
    with counter.get_lock():
        counter.value += (f1 - f0) % 15
    return str(out)


_COUNTER = None


def _pool_init(state, counter):
    global _COUNTER
    _COUNTER = counter
    init_render(state)


def _render_part_pooled(args):
    return render_part((*args, _COUNTER))


# ============================== main ==============================
def main(job_dir):
    job = Job(job_dir)
    spec = job.spec
    fmt_name = spec.get("format", "shorts")
    if fmt_name not in LAYOUTS:
        raise ValueError(f"Unknown format {fmt_name}")
    cfg = load_cfg(spec)
    qs = load_questions(job.dir / "questions.csv", cfg.get("timer_seconds", 5), spec.get("limit"))
    home = pathlib.Path(os.environ.get("CHAOS_HOME") or pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home())) / "RSC Classroom" / "chaos")
    models = pathlib.Path(spec.get("models_dir") or (home / "models"))
    job.progress("voice", 0, len(qs) + 2, "Loading the narrator voice", force=True)
    t0 = time.time()
    voice = Voice(cfg, models)
    print(f"[time] voice model loaded in {time.time() - t0:.1f}s", flush=True)
    # Different random templates and sounds for every video (the job folder name is unique);
    # settings.seed pins them, e.g. to re-render the same look.
    seed = str(cfg.get("seed") or job.dir.name)
    tpl = pick_templates(cfg, fmt_name, seed)
    print(f"[templates] {tpl or 'built-in'}", flush=True)
    sounds = Sounds(cfg, seed)
    ranks = rank_list(cfg, fmt_name)
    bands = rank_bands(len(qs), ranks) if ranks else []
    if bands:
        print("[ranks] " + ", ".join(f"{b['lo']}-{b['hi']} {b['name']}" for b in bands), flush=True)
    events, mix, total, _ = build_timeline(cfg, qs, voice, job, sounds, ranks)
    print(f"[sounds] {sounds.used or 'built-in'}", flush=True)
    print(f"[time] narration + sound in {time.time() - t0:.1f}s", flush=True)

    import soundfile as sf
    wav = job.dir / "audio.wav"
    sf.write(str(wav), mix, SR)
    del mix

    FF = ffmpeg_exe()
    lay = LAYOUTS[fmt_name]
    state = dict(W=lay["W"], H=lay["H"], FORMAT=fmt_name, CFG=cfg, N=len(qs), SECS=qs[0]["seconds"],
                 HOLD=float(cfg.get("answer_hold", 3.0)), events=events, FFMPEG=FF, TPL=tpl, RANKS=bands)
    nf = int(total * FPS)
    workers = max(1, min(int(spec.get("workers") or 0) or (os.cpu_count() or 2) - 1, 12))
    # Several parts per worker keeps every core busy to the end
    nparts = max(1, min(workers * 3, nf // (FPS * 4) or 1))
    bounds = [round(nf * i / nparts) for i in range(nparts + 1)]
    parts_dir = job.dir / "parts"
    parts_dir.mkdir(exist_ok=True)
    tasks = [(i, bounds[i], bounds[i + 1], parts_dir / f"part{i:04d}.mp4") for i in range(nparts)]

    ctx = get_context("spawn")
    counter = ctx.Value("i", 0)
    job.progress("render", 0, nf, f"Drawing {nf} frames on {workers} cores", force=True)
    with ctx.Pool(workers, initializer=_pool_init, initargs=(state, counter)) as pool:
        res = pool.map_async(_render_part_pooled, tasks)
        while not res.ready():
            res.wait(1.0)
            job.progress("render", min(counter.value, nf), nf, f"Drawing frames on {workers} cores")
        parts = res.get()
    print(f"[time] frames drawn + encoded in {time.time() - t0:.1f}s total", flush=True)

    job.progress("finish", nf, nf, "Joining video and sound", force=True)
    lst = job.dir / "parts.txt"
    lst.write_text("".join(f"file '{pathlib.Path(p).as_posix()}'\n" for p in parts), encoding="utf-8")
    out_tmp = job.dir / "video.tmp.mp4"
    r = subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-i", str(wav),
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out_tmp)],
                       capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError("ffmpeg could not join the video: " + r.stderr[-500:])
    os.replace(out_tmp, job.dir / "video.mp4")
    print(f"[time] joined in {time.time() - t0:.1f}s total", flush=True)
    # Tidy up the big intermediate files
    for p in parts:
        pathlib.Path(p).unlink(missing_ok=True)
    parts_dir.rmdir()
    lst.unlink(missing_ok=True)
    wav.unlink(missing_ok=True)
    # Where each question starts, for YouTube chapters in the description
    chapters = [dict(t=round(e["start"], 1), kind=e["kind"], q=e.get("idx")) for e in events]
    # A first thumbnail design (the page can make new ones). Never fails the video.
    job.progress("finish", nf, nf, "Designing the thumbnail", force=True)
    try:
        import thumbnail
        thumbnail.design(job.dir)
    except Exception:
        print("[thumbnail] " + traceback.format_exc(), flush=True)
    meta = dict(duration=round(total, 1), questions=len(qs), width=lay["W"], height=lay["H"], format=fmt_name,
                render_seconds=round(time.time() - job.started, 1), chapters=chapters,
                templates={k: pathlib.Path(v).parent.name for k, v in tpl.items()}, sounds=sounds.used,
                credits=sound_credits(sounds.used), ranks=bands)
    (job.dir / "result.json").write_text(json.dumps(meta), encoding="utf-8")
    # A copy for Rahul's videos folder, with a readable name. Never fails the video.
    if spec.get("export_dir") and spec.get("export_name"):
        try:
            import shutil
            out = pathlib.Path(spec["export_dir"])
            out.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(job.dir / "video.mp4", out / f"{spec['export_name']}.mp4")
            if (job.dir / "thumbnail.jpg").exists():
                shutil.copyfile(job.dir / "thumbnail.jpg", out / f"{spec['export_name']}.jpg")
            print(f"[export] copied to {out}", flush=True)
        except Exception:
            print("[export] " + traceback.format_exc(), flush=True)
    job.progress("done", nf, nf, "Video ready", force=True)


if __name__ == "__main__":
    d = pathlib.Path(sys.argv[1])
    try:
        main(d)
    except Exception as e:
        msg = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
        (d / "error.txt").write_text(msg + "\n\n" + traceback.format_exc(), encoding="utf-8")
        try:
            Job(d).progress("error", 0, 0, msg, force=True)
        except Exception:
            pass
        sys.exit(1)
