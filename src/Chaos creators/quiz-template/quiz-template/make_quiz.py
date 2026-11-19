"""Chaos Creators quiz video maker.

Fill questions.csv (and optionally settings.json), then run:
    python make_quiz.py                      # uses questions.csv + settings.json
    python make_quiz.py my_quiz.csv          # another questions file
    python make_quiz.py my_quiz.csv out.mp4  # and a custom output name

Output: a 1080x1920 (9:16) MP4 for YouTube Shorts / Reels, with narration on the
intro and outro, "Question N" voice, a ticking timer, applause + cheer on the answer,
and the channel logos.
"""
import csv, json, math, random, subprocess, sys, pathlib
from functools import lru_cache
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
W, H, FPS, SR = 1080, 1920, 30, 44100

# ---------------- inputs ----------------
CFG = json.loads((HERE / "settings.json").read_text(encoding="utf-8"))
QFILE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "questions.csv"
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "output" / (QFILE.stem + ".mp4")
OUT.parent.mkdir(parents=True, exist_ok=True)


def load_questions(path):
    qs = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            if not row.get("question"):
                continue
            opts = [row.get(f"option_{c}", "") for c in "abcd"]
            if any(not o for o in opts):
                sys.exit(f"Row {n}: all four options (option_a..option_d) are needed.")
            a = row.get("answer", "").upper()
            if a in "ABCD" and len(a) == 1:
                ans = "ABCD".index(a)
            elif a in ("1", "2", "3", "4"):
                ans = int(a) - 1
            elif row.get("answer", "") in opts:
                ans = opts.index(row["answer"])
            else:
                sys.exit(f"Row {n}: answer must be A, B, C or D (got '{row.get('answer', '')}').")
            secs = row.get("seconds", "")
            qs.append(dict(q=row["question"], options=opts, answer=ans, fact=row.get("fact", ""),
                           seconds=int(secs) if secs.isdigit() else int(CFG.get("timer_seconds", 5))))
    if not qs:
        sys.exit(f"No questions found in {path}")
    return qs


QS = load_questions(QFILE)
N = len(QS)
SECS = QS[0]["seconds"] if len({q["seconds"] for q in QS}) == 1 else None
fill = lambda s: s.replace("{n}", str(N)).replace("{seconds}", str(SECS or QS[0]["seconds"])).replace(
    "{channel}", CFG["channel_name"])

# ---------------- fonts & logos ----------------
@lru_cache(maxsize=512)
def font(w, s):
    return ImageFont.truetype(str(HERE / "fonts" / f"Poppins-{w}.ttf"), max(8, int(s)))


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


LOGO = round_logo(HERE / CFG["logo"])
MARK = round_logo(HERE / CFG["logo_small"])


@lru_cache(maxsize=256)
def logo_at(which, size):
    src = LOGO if which == "logo" else MARK
    return src.resize((size, size), Image.LANCZOS)


@lru_cache(maxsize=64)
def tint_at(which, size, rgb):
    a = logo_at(which, size).getchannel("A").point(lambda v: int(v * 0.75))
    t = Image.new("RGBA", (size, size), rgb + (0,))
    t.putalpha(a)
    return t


def composite(img, src, x, y):
    """Paste an RGBA source with its alpha, even when it hangs off the frame."""
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(src.width, img.width - x), min(src.height, img.height - y)
    if ex > sx and ey > sy:
        piece = src.crop((sx, sy, ex, ey))
        img.paste(piece, (x + sx, y + sy), piece)


def overlay(img, rgba):
    """Blend a flat colour over the whole frame (img stays RGB so ImageDraw 'RGBA' blends)."""
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


# ---------------- audio ----------------
rng = np.random.default_rng(7)
_tts = None


def say(text, speed=1.0):
    global _tts
    if _tts is None:
        from kokoro_onnx import Kokoro
        _tts = Kokoro(str(HERE / "models" / "kokoro.onnx"), str(HERE / "models" / "voices.bin"))
    s, sr = _tts.create(text, voice=CFG.get("voice", "af_heart"), speed=speed, lang=CFG.get("voice_lang", "en-us"))
    n = int(len(s) * SR / sr)
    s = np.interp(np.linspace(0, len(s) - 1, n), np.arange(len(s)), s).astype(np.float32)
    return s / (np.abs(s).max() + 1e-6) * 0.85


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


# ---------------- timeline ----------------
events, audio = [], []
add = lambda at, s: audio.append((at, s))
OPT_DELAY, HOLD = float(CFG.get("options_delay", 2.0)), float(CFG.get("answer_hold", 3.0))

SLAM = 0.9
add(0.1, riser(SLAM - 0.1))
add(SLAM, impact())
intro_vo = say(fill(CFG["intro_voice"]))
VO_AT = SLAM + 0.9
add(VO_AT, intro_vo)
t = max(VO_AT + len(intro_vo) / SR + 1.0, 7.5)
events.append(dict(kind="intro", start=0, end=t, phase2=VO_AT + 1.6))

for qi, q in enumerate(QS):
    seg = dict(kind="q", idx=qi, q=q, start=t, cd=q["seconds"])
    add(t, whoosh())
    add(t + 0.3, say(CFG.get("question_voice", "Question {q}.").replace("{q}", str(qi + 1))))
    seg["opt_t"] = ot = t + 0.3 + OPT_DELAY
    add(ot, popsnd())
    seg["cd_start"] = ot + 0.3
    for k in range(seg["cd"]):
        add(seg["cd_start"] + k, tick(high=k >= seg["cd"] - 2))
    seg["reveal"] = r = seg["cd_start"] + seg["cd"]
    add(r, chime())
    add(r + 0.15, applause(min(3.2, HOLD + 0.2)))
    seg["end"] = t = r + HOLD
    events.append(seg)

outro_vo = say(fill(CFG["outro_voice"]))
add(t + 0.1, whoosh())
add(t + 0.3, impact() * 0.6)
add(t + 0.7, outro_vo)
events.append(dict(kind="outro", start=t, end=t + 0.7 + len(outro_vo) / SR + 1.8))
TOTAL = events[-1]["end"]

mix = np.zeros(int((TOTAL + 2) * SR), np.float32)
for at, s in audio:
    i = int(at * SR)
    mix[i:i + len(s)] += s[:len(mix) - i]
mix = mix[:int(TOTAL * SR)]
mix /= max(1.0, np.abs(mix).max() / 0.95)
WAV = OUT.with_suffix(".wav")
sf.write(str(WAV), mix, SR)

# ---------------- visuals ----------------
ACC = [(255, 179, 0), (0, 194, 255), (255, 92, 141), (124, 220, 92)]
PAL = ACC + [(168, 85, 247), (255, 255, 255)]
GREEN, RED, INK = (34, 197, 94), (239, 68, 68), (28, 24, 64)


def make_bg():
    y = np.linspace(0, 1, H)[:, None, None]
    x = np.linspace(0, 1, W)[None, :, None]
    k = y * 0.7 + x * 0.3
    g = np.array((30, 14, 74)) * (1 - k) + np.array((84, 30, 150)) * k
    img = Image.fromarray(np.broadcast_to(g, (H, W, 3)).astype(np.uint8))
    d = ImageDraw.Draw(img, "RGBA")
    r2 = random.Random(3)
    for _ in range(40):
        cx, cy, rr = r2.randint(0, W), r2.randint(0, H), r2.randint(4, 14)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 255, 255, 18))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-300, -300, 700, 600], fill=(255, 179, 0, 40))
    gd.ellipse([500, 1400, 1500, 2300], fill=(255, 92, 141, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img.paste(glow, (0, 0), glow)
    return img


BG = make_bg()


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


def ease(x):
    x = min(max(x, 0), 1)
    return 1 - (1 - x) ** 3


def pop(x):
    x = min(max(x, 0), 1)
    return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2


F_PILL, F_Q, F_OPT, F_LET = font("Bold", 38), font("Bold", 58), font("Medium", 50), font("Bold", 48)
F_FACT, F_SMALL = font("Medium", 40), font("Medium", 30)


def header(img, d, qi):
    paste_logo(img, "mark", 118, 130, 128)
    d.rounded_rectangle([200, 98, 470, 162], 32, fill=(255, 179, 0))
    d.text((335, 130), CFG.get("quiz_badge", "GK QUIZ"), font=F_PILL, fill=(30, 20, 60), anchor="mm")
    d.text((1020, 130), f"Question {qi + 1}/{N}", font=F_PILL, fill="white", anchor="rm")
    d.rounded_rectangle([60, 222, 1020, 236], 7, fill=(255, 255, 255, 40))
    d.rounded_rectangle([60, 222, 60 + 960 * (qi + 1) / N, 236], 7, fill=(255, 179, 0))


conf_rng = np.random.default_rng(11)
CONF = [dict(x=conf_rng.uniform(0, W), vy=conf_rng.uniform(900, 1400), vx=conf_rng.uniform(-120, 120),
             y0=conf_rng.uniform(-300, 0), rot=conf_rng.uniform(0, 6.28), vr=conf_rng.uniform(-8, 8),
             c=ACC[conf_rng.integers(4)] + (230,), s=conf_rng.uniform(10, 18)) for _ in range(80)]


def confetti(d, dt):
    for p in CONF:
        y = p["y0"] + p["vy"] * dt + 260 * dt * dt
        if y > H + 40:
            continue
        x = p["x"] + p["vx"] * dt + 30 * math.sin(dt * 3 + p["rot"])
        a = p["rot"] + p["vr"] * dt
        sq = abs(math.cos(a * 0.7)) * 0.8 + 0.2
        d.polygon([(x + math.cos(a + k * math.pi / 2) * p["s"] * (sq if k % 2 else 1) * 0.7,
                    y + math.sin(a + k * math.pi / 2) * p["s"] * (sq if k % 2 else 1) * 0.7) for k in range(4)], fill=p["c"])


def draw_q(img, seg, tt):
    d = ImageDraw.Draw(img, "RGBA")
    q, ans, CD = seg["q"], seg["q"]["answer"], seg["cd"]
    header(img, d, seg["idx"])
    k = ease((tt - seg["start"]) / 0.45)
    off = int((1 - k) * 80)
    lines = wrap(d, q["q"], F_Q, 860)
    ch = int(len(lines) * F_Q.size * 1.2 + 110)
    top = 380 + off
    d.rounded_rectangle([390, top - 92, 690, top - 26], 33, fill=(255, 92, 141, int(255 * k)))
    d.text((540, top - 59), f"QUESTION {seg['idx'] + 1}", font=F_SMALL, fill=(255, 255, 255, int(255 * k)), anchor="mm")
    d.rounded_rectangle([60, top + 10, 1020, top + ch + 10], 44, fill=(0, 0, 0, int(70 * k)))
    d.rounded_rectangle([60, top, 1020, top + ch], 44, fill=(255, 255, 255, int(255 * k)))
    for i, ln in enumerate(lines):
        d.text((540, top + 55 + i * F_Q.size * 1.2), ln, font=F_Q, fill=INK + (int(255 * k),), anchor="ma")
    revealed = tt >= seg["reveal"]
    rk = ease((tt - seg["reveal"]) / 0.35)
    oy = top + ch + 60 - off
    ok = ease((tt - seg["opt_t"] + 0.1) / 0.35)
    for li, opt in enumerate(q["options"]):
        if ok <= 0:
            break
        y, x = oy + li * 178, 60 + int((1 - ok) * 300)
        fillc, txt, ring = (255, 255, 255, int(235 * ok)), INK, ACC[li]
        if revealed:
            if li == ans:
                fillc, txt, ring = GREEN + (255,), (255, 255, 255), (255, 255, 255)
            else:
                fillc, txt = (255, 255, 255, int(235 - 150 * rk)), INK + (int(255 - 140 * rk),)
        pad = (pop((tt - seg["reveal"]) / 0.4) - 1) * 40 if (revealed and li == ans) else 0
        d.rounded_rectangle([x - pad, y - pad, x + 960 + pad, y + 140 + pad], 70, fill=fillc)
        d.ellipse([x + 22, y + 20, x + 122, y + 120], fill=ring)
        d.text((x + 72, y + 70), "ABCD"[li], font=F_LET, fill=GREEN if (revealed and li == ans) else INK, anchor="mm")
        fo, sz = F_OPT, 50
        while d.textlength(opt, font=fo) > 690 and sz > 30:
            sz -= 2
            fo = font("Medium", sz)
        d.text((x + 150, y + 70), opt, font=fo, fill=txt, anchor="lm")
        cx, cy = x + 900, y + 70
        if revealed and li == ans:
            d.line([(cx - 26, cy), (cx - 8, cy + 20), (cx + 26, cy - 22)], fill="white", width=11, joint="curve")
        elif revealed and rk > 0.5:
            for a_, b_ in (((-18, -18), (18, 18)), ((-18, 18), (18, -18))):
                d.line([(cx + a_[0], cy + a_[1]), (cx + b_[0], cy + b_[1])], fill=RED + (int(200 * rk),), width=9)
    by = oy + 4 * 178 + 60
    if seg["cd_start"] - 0.3 <= tt < seg["reveal"] + 0.25:
        rem = seg["reveal"] - tt
        cx, cy, R = W / 2, by + 140, 115
        a = 1 if tt < seg["reveal"] else max(0, 1 - (tt - seg["reveal"]) / 0.25)
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(255, 255, 255, int(30 * a)))
        d.arc([cx - R, cy - R, cx + R, cy + R], -90, -90 + 360 * max(rem, 0) / CD,
              fill=((255, 179, 0) if rem > 2 else RED) + (int(255 * a),), width=20)
        beat = 1 + 0.15 * max(0, 1 - ((CD - rem) % 1) / 0.25)
        d.text((cx, cy), str(max(1, math.ceil(rem))) if rem > 0 else "0", font=font("Bold", 96 * beat),
               fill=(255, 255, 255, int(255 * a)), anchor="mm")
        if tt < seg["cd_start"] + 1.2:
            d.text((cx, cy - R - 50), CFG.get("timer_text", "Think fast!"), font=F_FACT, fill=(255, 255, 255, int(220 * a)), anchor="mm")
    if revealed and q["fact"]:
        fk = ease((tt - seg["reveal"] - 0.25) / 0.4)
        if fk > 0:
            d.rounded_rectangle([60, by + 20, 1020, by + 280], 36, fill=(255, 255, 255, int(38 * fk)))
            d.text((100, by + 52), "DID YOU KNOW?", font=F_SMALL, fill=(255, 179, 0, int(255 * fk)))
            yy = by + 100
            for ln in wrap(d, q["fact"], F_FACT, 880)[:3]:
                d.text((100, yy), ln, font=F_FACT, fill=(255, 255, 255, int(240 * fk)))
                yy += 52
    if revealed and tt - seg["reveal"] < HOLD + 0.5:
        confetti(d, tt - seg["reveal"])


# chaos shapes that burst out of the logo
crng = random.Random(21)
SHAPES = []
for i in range(70):
    side = i % 4
    ax, ay = [(crng.uniform(30, 150), crng.uniform(60, H - 60)), (crng.uniform(W - 150, W - 30), crng.uniform(60, H - 60)),
              (crng.uniform(60, W - 60), crng.uniform(30, 170)), (crng.uniform(60, W - 60), crng.uniform(H - 200, H - 40))][side]
    SHAPES.append(dict(kind=crng.choice(["tri", "circ", "sq", "zig", "ring", "plus"]), c=crng.choice(PAL),
                       ang=crng.uniform(0, 2 * math.pi), sp=crng.uniform(350, 1300), rot=crng.uniform(0, 6.3),
                       vr=crng.uniform(-4, 4), s=crng.uniform(16, 46), ax=ax, ay=ay))


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


def chaos_field(d, dt, cx=W / 2, cy=H * 0.42):
    for sh in SHAPES:
        if dt < 0:
            continue
        k, m = ease(dt / 1.1), ease((dt - 1.0) / 2.5)
        bx, by = cx + math.cos(sh["ang"]) * sh["sp"] * k, cy + math.sin(sh["ang"]) * sh["sp"] * k
        drift = 18 * math.sin(dt * 1.3 + sh["rot"])
        draw_shape(d, sh, bx * (1 - m) + sh["ax"] * m + drift, by * (1 - m) + sh["ay"] * m + drift * .6,
                   sh["rot"] + sh["vr"] * dt * (1 if dt < 1.2 else .25), 210 - 70 * m)


def dark_and_stripes(img, t_):
    overlay(img, (8, 6, 20, 130))
    d = ImageDraw.Draw(img, "RGBA")
    off = (t_ * 120) % 160
    for i in range(-4, 22):
        x0 = i * 160 + off
        d.polygon([(x0, 0), (x0 + 60, 0), (x0 - 640, H), (x0 - 700, H)], fill=(255, 255, 255, 22))
    return d


def draw_intro(img, seg, tt):
    d = dark_and_stripes(img, tt)
    dt = tt - SLAM
    if dt < 0:
        k = tt / SLAM
        for i in range(14):
            a, r0 = i / 14 * 2 * math.pi, 1100 * (1 - k)
            d.line([(W / 2 + math.cos(a) * r0, H * .42 + math.sin(a) * r0),
                    (W / 2 + math.cos(a) * (r0 + 160), H * .42 + math.sin(a) * (r0 + 160))], fill=PAL[i % 6] + (200,), width=8)
        return
    chaos_field(d, dt)
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
        d.text((540, 920 - yo), CFG.get("intro_badge", "TODAY'S QUIZ"), font=F_PILL, fill=(255, 255, 255, int(255 * m)), anchor="mm")
        y = 1060
        for i, ln in enumerate(CFG["title_lines"]):
            x_ = (tt - seg["phase2"] - 0.2 - i * 0.12) / 0.45
            if ease(x_) > 0:
                d.text((540, y), ln, font=font("Bold", 130 * pop(x_)), fill=(255, 255, 255, int(255 * ease(x_))), anchor="mm")
            y += 150
        y += 50
        for i, ln in enumerate(CFG["intro_lines"]):
            kk = ease((tt - seg["phase2"] - 0.7 - i * 0.2) / 0.4)
            d.text((540, y), fill(ln), font=font("Medium", 46), fill=(255, 255, 255, int(235 * kk)), anchor="mm")
            y += 72


def draw_outro(img, seg, tt):
    d = dark_and_stripes(img, tt)
    dt = tt - seg["start"]
    chaos_field(d, dt + 0.6, cy=H * 0.5)
    k = ease(dt / 0.5)
    d.text((540, 330), CFG["outro_title"][0], font=font("Bold", 120 * pop(dt / 0.5)), fill=(255, 255, 255, int(255 * k)), anchor="mm")
    d.text((540, 480), CFG["outro_title"][1], font=font("Bold", 170 * pop((dt - .15) / 0.5)),
           fill=(255, 179, 0, int(255 * ease((dt - .15) / .5))), anchor="mm")
    y = 650
    for i, ln in enumerate(CFG["outro_lines"]):
        d.text((540, y), fill(ln), font=font("Medium", 48), fill=(255, 255, 255, int(235 * ease((dt - 0.5 - i * 0.2) / 0.4))), anchor="mm")
        y += 76
    lk = (dt - 1.0) / 0.6
    if lk > 0:
        paste_logo(img, "logo", 540, 1150, 560 * min(1, pop(lk)), alpha=ease(lk))
        d = ImageDraw.Draw(img, "RGBA")
        bk, pulse = ease((dt - 1.6) / 0.4), 1 + 0.05 * math.sin(dt * 6)
        bw, bh = 300 * pulse, 64 * pulse
        d.rounded_rectangle([540 - bw, 1580 - bh, 540 + bw, 1580 + bh], int(bh), fill=(239, 35, 60, int(255 * bk)))
        d.text((540, 1580), "SUBSCRIBE", font=font("Bold", 60 * pulse), fill=(255, 255, 255, int(255 * bk)), anchor="mm")


def frame(tt):
    img = BG.copy()
    for seg in events:
        if seg["start"] <= tt < seg["end"]:
            {"intro": draw_intro, "outro": draw_outro, "q": draw_q}[seg["kind"]](img, seg, tt)
            break
    return img.convert("RGB")


nf = int(TOTAL * FPS)
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                       "-r", str(FPS), "-i", "-", "-i", str(WAV), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(OUT)],
                      stdin=subprocess.PIPE)
for i in range(nf):
    if i % (FPS * 10) == 0:
        print(f"  rendering {i // FPS}s / {int(TOTAL)}s", flush=True)
    ff.stdin.write(frame(i / FPS).tobytes())
ff.stdin.close()
ff.wait()
WAV.unlink(missing_ok=True)
if "--timeline" in sys.argv:
    json.dump([{k: v for k, v in s.items() if k != "q"} for s in events], open(OUT.with_suffix(".json"), "w"), indent=1)
print(f"Done: {OUT}  ({TOTAL:.0f} seconds, {N} questions)")
