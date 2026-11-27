"""Chaos Creators "Flag Memory Challenge" video engine (the studio's Flags tab).

A round: N flags flash one by one (about 1 s each), then a grid of flags with only some of them
hidden in it; viewers have a few seconds to spot them, then the hidden flags pop out in the grid.
Shares the voice, sounds and render pipeline with quiz_video.py (imported, never changed by it).

Run:  python flags_video.py <job-dir>                    make the video
      python flags_video.py thumbnail <job-dir>          design the thumbnail again
      python flags_video.py still <job-dir> <t> [<t>..]  draw single frames (stills/<t>.jpg), for checks
The job dir holds job.json ({"kind": "flags", "format", "settings", "flags": {level, show, find, grid,
flag_seconds, search_seconds}}) and rounds.json ([{"show": [codes], "find": [codes], "grid": [codes]}]).
Flag pictures: src/Chaos creators/flags/<code>.png (+ countries.json). Icons (optional, Rahul's):
src/Chaos creators/icons/<name>.png; a missing icon is simply left out.
"""
import json, math, os, pathlib, random, subprocess, sys, time, traceback
from multiprocessing import get_context

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import quiz_video as qv
from quiz_video import FPS, SR, font as F

ASSETS = qv.ENGINE.parent
FLAGS_DIR = ASSETS / "flags"
ICONS_DIR = ASSETS / "icons"
INK = (24, 14, 58)
WHITE = (255, 255, 255)
GOLD, GOLD2 = (255, 214, 64), (255, 140, 0)
PINK, CYAN, GREEN, RED = (255, 72, 140), (64, 220, 255), (46, 220, 120), (235, 60, 60)
RANK_NAMES = ["Flag Genius", "Map Master", "Explorer", "Tourist", "Lost Traveller"]
RANK_COLORS = [GOLD, (200, 210, 230), (230, 160, 100), CYAN, PINK]
S = {}  # render state (per worker process)


class KidFlags(qv.KidVoice):
    """Rahul's kid recordings (sounds/kid voice sounds) for flag videos: the intro hook, a cheer
    between rounds and the ending. Optional flag-game lines in its 7_flags/ folder (file names
    starting with the keys below) replace the narrator's line of the same key."""
    INTROS = [("intro_01", "intro_02", "intro_03"), ("introalt_01", "introalt_02", "introalt_03")]  # hey everyone / welcome / ready for a challenge?
    SHORT_ENDING = ("ending_01", "mix_08", "endalt_06", "ending_07_")             # that's a wrap / how many did you get right, comment below / keep creating chaos / bye
    LONG_ENDING = ("ending_01", "mix_08", "mix_09", "endalt_06", "ending_07_")    # ... + don't forget to subscribe
    # key (file name start) -> what the kid says. The numbered lines assume 10 shown, 5 to find, 30 in the grid, 30 seconds.
    KEYS = {"flags_intro": "Let's play a memory game!",
            "flags_rule1": "Ten flags will flash on your screen, really fast.",
            "flags_rule2": "Then find five of them, hidden in a grid of thirty flags.",
            "flags_rule3": "You have only thirty seconds.",
            "flags_rule4": "Let's see how many you can find!",
            "flags_remember": "Remember these flags!",
            "flags_find": "Now find the five flags you saw! Your time starts now!",
            "flags_ten_left": "Ten seconds left!",
            "flags_times_up": "Time's up!",
            "flags_lets_see": "Let's see how you did!",
            "flags_round2": "Round two!", "flags_round3": "Round three!", "flags_round4": "Round four!", "flags_round5": "Round five!"}

    def intro(self):
        return self._join([self._file(p) for p in self.r.choice(self.INTROS)])

    def ending(self):
        return self._join([self._file(p) for p in (self.LONG_ENDING if self.fmt == "youtube" else self.SHORT_ENDING)])

    def between(self, ri, n):
        """Before round ri (from the 2nd): "almost there" before the last, "doing great" otherwise."""
        f = self._file("mix_07" if ri == n - 1 and n > 2 else "mix_03")
        return self._load(f) if f else None

    def line(self, key):
        f = self._file(key + "_") or self._file(key + ".")
        return self._load(f) if f else None

NUM = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def words(n):
    n = int(n)
    if n < 20:
        return NUM[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else "-" + NUM[n % 10])
    return str(n)


def ease(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def pop(x):
    """0 → 1 with a little overshoot."""
    x = min(1.0, max(0.0, x))
    return 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2


# ============================== drawing helpers ==============================
def glow(img, shape_fn, color, blur, alpha=255):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    shape_fn(ImageDraw.Draw(layer), color + (alpha,))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def icon(name, size):
    """Rahul's icon (icons/<name>.png), or None when he hasn't added it yet."""
    cache = S.setdefault("ICONS", {})
    if (name, size) not in cache:
        p = ICONS_DIR / f"{name}.png"
        im = None
        if p.is_file():
            try:
                im = Image.open(p).convert("RGBA")
                bb = im.getchannel("A").getbbox()
                if bb:
                    im = im.crop(bb)
                s = size / max(im.size)
                im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
            except Exception as e:
                print(f"[icon] {p.name}: {e}", flush=True)
                im = None
        cache[(name, size)] = im
    return cache[(name, size)]


def paste_icon(img, name, cx, cy, size, k=1.0):
    im = icon(name, size)
    if im is None or k <= 0:
        return
    if k < 1:
        s = max(0.05, pop(k))
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        a = im.getchannel("A").point(lambda v: int(v * min(1, k * 2)))
        im = im.copy()
        im.putalpha(a)
    img.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def background(W, H, seed, spot, spot_r):
    rng = random.Random(seed)
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    top, bot = np.array([10, 14, 48]), np.array([46, 12, 92])
    k = np.clip(y * 0.85 + x * 0.15, 0, 1)[..., None]
    arr = top * (1 - k) + bot * k
    d = np.sqrt(((np.arange(W)[None, :] - spot[0]) / spot_r) ** 2 + ((np.arange(H)[:, None] - spot[1]) / spot_r) ** 2)
    arr = arr + (np.clip(1 - d, 0, 1) ** 2)[..., None] * np.array([70, 60, 130])
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")
    # a big wireframe globe rising from the bottom
    g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    R = max(W, H) * 0.51 if H > W else W * 0.62
    cx, cy = W / 2, H + R * 0.39
    tilt = math.radians(18)

    def proj(lat, lon):
        la, lo = math.radians(lat), math.radians(lon)
        x3, y3, z3 = math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)
        y3, z3 = y3 * math.cos(tilt) - z3 * math.sin(tilt), y3 * math.sin(tilt) + z3 * math.cos(tilt)
        return (cx + R * x3, cy - R * y3), z3

    for lat in range(-75, 90, 15):
        pts = [proj(lat, lo) for lo in range(-180, 181, 3)]
        for (p, z), (q, z2) in zip(pts, pts[1:]):
            if z > 0 and z2 > 0:
                gd.line([p, q], fill=CYAN + (70,), width=3)
    for lon in range(-180, 180, 15):
        pts = [proj(la, lon) for la in range(-90, 91, 3)]
        for (p, z), (q, z2) in zip(pts, pts[1:]):
            if z > 0 and z2 > 0:
                gd.line([p, q], fill=CYAN + (70,), width=3)
    gd.ellipse([cx - R, cy - R, cx + R, cy + R], outline=CYAN + (150,), width=5)
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(6)))
    img.alpha_composite(g)
    b = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(b)
    for _ in range(int(40 * W * H / (1080 * 1920))):
        x0, y0, r = rng.uniform(0, W), rng.uniform(0, H * 0.75), rng.uniform(2, 9)
        bd.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=(255, 255, 255, rng.randint(40, 140)))
    img.alpha_composite(b.filter(ImageFilter.GaussianBlur(1.5)))
    return img


def pill(img, text, cx, cy, size, fill, ink, icon_name=None, k=1.0, shadow=True):
    if k <= 0:
        return
    d = ImageDraw.Draw(img)
    f = F("Bold", size)
    ic = icon(icon_name, int(size * 1.35)) if icon_name else None
    iw = size * 1.5 if ic is not None else 0
    w = d.textlength(text, font=f) + 70 + iw
    h = size * 1.75
    if k < 1:  # pop in: drawn on its own layer, scaled
        lay = Image.new("RGBA", (int(w + 40), int(h + 40)), (0, 0, 0, 0))
        pill(lay, text, lay.width / 2, lay.height / 2, size, fill, ink, icon_name, 1.0, shadow=False)
        s = max(0.05, pop(k))
        lay = lay.resize((max(1, int(lay.width * s)), max(1, int(lay.height * s))), Image.LANCZOS)
        img.alpha_composite(lay, (int(cx - lay.width / 2), int(cy - lay.height / 2)))
        return
    box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
    if shadow:
        glow(img, lambda dd, c: dd.rounded_rectangle([box[0], box[1] + 8, box[2], box[3] + 8], int(h / 2), fill=c), (0, 0, 0), 10, 140)
    d.rounded_rectangle(box, int(h / 2), fill=fill)
    if ic is not None:
        img.alpha_composite(ic, (int(box[0] + 22), int(cy - ic.height / 2)))
    d.text((cx + iw / 2, cy), text, font=f, fill=ink, anchor="mm")


def title_layer(W, H, text, cy, size, cx=None, maxw=None, top=GOLD, bottom=GOLD2, stroke=8):
    """Bold title with a gold gradient, dark outline and drop shadow, on its own RGBA layer."""
    cx = W / 2 if cx is None else cx
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = F("Bold", size)
    while maxw and d.textlength(text, font=f) > maxw and size > 30:
        size -= 4
        f = F("Bold", size)
    l, t, r, b = d.textbbox((cx, cy), text, font=f, anchor="mm", stroke_width=stroke)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((cx, cy + 10), text, font=f, anchor="mm", fill=(0, 0, 0, 170), stroke_width=stroke, stroke_fill=(0, 0, 0, 170))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(8)))
    d.text((cx, cy), text, font=f, anchor="mm", fill=INK, stroke_width=stroke, stroke_fill=INK)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).text((cx, cy), text, font=f, anchor="mm", fill=255)
    ys = np.clip((np.arange(H)[:, None] - t) / max(1, b - t), 0, 1)[..., None]
    arr = np.array(top) * (1 - ys) + np.array(bottom) * ys
    grad = Image.fromarray(np.repeat(arr, W, axis=1).astype(np.uint8)).convert("RGBA")
    img.paste(grad, (0, 0), mask)
    return img


def white_text(img, text, cx, cy, size, stroke=6, maxw=None, anchor="mm"):
    d = ImageDraw.Draw(img)
    f = F("Bold", size)
    while maxw and d.textlength(text, font=f) > maxw and size > 24:
        size -= 3
        f = F("Bold", size)
    d.text((cx, cy), text, font=f, anchor=anchor, fill=WHITE, stroke_width=stroke, stroke_fill=INK)


def glass(img, box, radius=40, alpha=34):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius, fill=(255, 255, 255, alpha), outline=(255, 255, 255, 90), width=3)
    img.alpha_composite(layer)


def fade(im, k):
    if k >= 1:
        return im
    out = im.copy()
    out.putalpha(im.getchannel("A").point(lambda v: int(v * max(0.0, k))))
    return out


# ------------------------------ flags ------------------------------
def flag_src(code):
    cache = S.setdefault("FSRC", {})
    if code not in cache:
        cache[code] = Image.open(FLAGS_DIR / f"{code}.png").convert("RGBA")
    return cache[code]


def flag_fit(code, w, h):
    src = flag_src(code)
    s = min(w / src.width, h / src.height)
    return src.resize((max(1, round(src.width * s)), max(1, round(src.height * s))), Image.LANCZOS)


def tile(code, w, h, ring=WHITE, border=4, dim=0.0):
    """The flag in its true shape inside a w x h cell: almost square corners, a thin white edge,
    a soft shadow. Returned with a 26 px margin all round (for the shadow / glow)."""
    key = (code, int(w), int(h), ring, border, round(dim, 2))
    cache = S.setdefault("TILES", {})
    if key in cache:
        return cache[key]
    f = flag_fit(code, w - 2 * border, h - 2 * border)
    fw, fh = f.width + 2 * border, f.height + 2 * border
    pad = 26
    t = Image.new("RGBA", (fw + 2 * pad, fh + 2 * pad), (0, 0, 0, 0))
    glow(t, lambda dd, c: dd.rectangle([pad, pad + 8, pad + fw, pad + fh + 8], fill=c), (0, 0, 0), 10, 150)
    ImageDraw.Draw(t).rounded_rectangle([pad, pad, pad + fw, pad + fh], 3, fill=ring + (255,))
    t.alpha_composite(f, (pad + border, pad + border))
    if dim:
        shade = Image.new("RGBA", t.size, (10, 8, 36, 0))
        shade.putalpha(t.getchannel("A").point(lambda v: int(v * dim)))
        t.alpha_composite(shade)
    if len(cache) > 600:
        cache.clear()
    cache[key] = t
    return t


def number_badge(img, code, n, cx, cy, w, h, scale=1.0, border=4):
    """The flag's grid number in a small dark badge on its bottom-left corner (viewers remember numbers)."""
    f = flag_fit(code, w - 2 * border, h - 2 * border) if (code, w, h) not in S.setdefault("FSIZE", {}) else None
    if f is not None:
        S["FSIZE"][(code, w, h)] = (f.width + 2 * border, f.height + 2 * border)
    fw, fh = S["FSIZE"][(code, w, h)]
    fw, fh = fw * scale, fh * scale
    d = ImageDraw.Draw(img)
    fs = max(15, int(min(h, w / 1.5) * 0.2 * scale))
    font = F("Bold", fs)
    txt = str(n)
    tw = d.textlength(txt, font=font)
    pw, ph = tw + fs * 0.55, fs * 1.25
    x0, y1 = cx - fw / 2 - 3 * scale, cy + fh / 2 + 3 * scale
    d.rounded_rectangle([x0, y1 - ph, x0 + pw, y1], int(ph * 0.3), fill=(20, 12, 50, 235), outline=(255, 255, 255, 200), width=max(1, int(2 * scale)))
    d.text((x0 + pw / 2, y1 - ph / 2), txt, font=font, fill=WHITE, anchor="mm")


def paste_tile(img, t, cx, cy, scale=1.0, alpha=1.0):
    if scale != 1.0:
        t = t.resize((max(1, int(t.width * scale)), max(1, int(t.height * scale))), Image.LANCZOS)
    if alpha < 1:
        t = fade(t, alpha)
    img.alpha_composite(t, (int(cx - t.width / 2), int(cy - t.height / 2)))


def waving(code, w, h, tt, amp=1.0):
    """The flag fitted into w x h, waving like cloth (shaded folds moving along it)."""
    cache = S.setdefault("WAVE", {})
    if (code, w, h) not in cache:
        cache.clear()
        cache[(code, w, h)] = np.asarray(flag_fit(code, w, h), np.float32)
    a = cache[(code, w, h)]
    hh, ww = a.shape[:2]
    pad = int(hh * 0.07) + 2
    xs = np.arange(ww)
    ph = xs / ww * 2.2 * math.pi - tt * 5.0
    rise = np.clip(xs / (ww * 0.18), 0, 1)                     # the pole side moves less
    off = (np.sin(ph) * amp * hh * 0.05 * rise).astype(np.int32)
    shade = 1 + 0.15 * amp * np.cos(ph) * rise
    rows = np.arange(hh + 2 * pad)[:, None] - pad - off[None, :]
    ok = (rows >= 0) & (rows < hh)
    rows = np.clip(rows, 0, hh - 1)
    out = a[rows, xs[None, :]]
    out[..., :3] *= shade[None, :, None]
    out[..., 3] *= ok
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# ============================== layout ==============================
def grid_cells(n, box, gap=(14, 22)):
    """Centres and tile size for n flags in box (x, y, w, h): the column count that gives the biggest tiles."""
    x0, y0, w, h = box
    best = None
    for cols in range(3, 9):
        rows = math.ceil(n / cols)
        tw = min((w - (cols - 1) * gap[0]) / cols, ((h - (rows - 1) * gap[1]) / rows) * 1.5)
        if best is None or tw > best[0]:
            best = (tw, cols, rows)
    tw, cols, rows = best
    th = tw / 1.5
    gw, gh = cols * tw + (cols - 1) * gap[0], rows * th + (rows - 1) * gap[1]
    gx, gy = x0 + (w - gw) / 2, y0 + (h - gh) / 2
    cells = []
    for i in range(n):
        r, c = divmod(i, cols)
        in_row = min(cols, n - r * cols)                        # a short last row is centred
        ox = (cols - in_row) * (tw + gap[0]) / 2
        cells.append((gx + ox + c * (tw + gap[0]) + tw / 2, gy + r * (th + gap[1]) + th / 2))
    return cells, int(tw), int(th), (gx, gy, gw, gh)


def layout(W, H):
    if H > W:  # Shorts
        return dict(tall=True, header_y=104, badge_x=610, logo=(34, 44, 120),
                    title_y=260, sub_y=350, grid=(60, 520, W - 120, 940), timer=(W / 2, 1600, 110), hour=(W / 2 + 200, 1600),
                    flag_box=(820, 560), flag_c=(W / 2, 900), count_y=1450, bar_y=1340, brain=(W - 135, 1610),
                    reveal_pill_y=1580, rev_count_y=385, memo_title_y=300)
    return dict(tall=False, header_y=80, badge_x=560, logo=(30, 22, 110),
                title_y=230, sub_y=320, grid=(620, 150, W - 680, 880), timer=(330, 700, 150), hour=(520, 700),
                flag_box=(780, 470), flag_c=(W / 2, 575), count_y=965, bar_y=885, brain=(W - 140, 940),
                reveal_pill_y=900, rev_count_y=470, memo_title_y=185)


# ============================== timeline + audio ==============================
def build_timeline(cfg, opt, rounds, voice, job, sounds, kid=None):
    N, K, G_, FS, SS = opt["show"], opt["find"], opt["grid"], opt["flag_seconds"], opt["search_seconds"]
    names = S["NAMES"]
    events, audio, voices = [], [], []
    add = lambda at, s: audio.append((at, s))

    def say(at, text, key=None):
        """The narrator's line, or the kid's recording of it (7_flags/<key>…) when there is one."""
        s = kid.line(key) if kid and key else None
        if s is None:
            s = voice.say(text)
        voices.append((at, s))
        return len(s) / SR

    def play(at, clip):
        voices.append((at, clip))
        return len(clip) / SR

    tick, tick_hi = qv.tick(), qv.tick(True)
    whoosh = sounds.get("whoosh", 0.2, 2.0) if sounds else None
    whoosh = whoosh if whoosh is not None else qv.whoosh()
    sting = sounds.get("intro", 0.7, 6.0) if sounds else None
    applause = sounds.get("applause", 0.5, 4.0) if sounds else None
    applause = applause if applause is not None else qv.applause(3.0)
    chime = qv.chime()
    popsnd = qv.popsnd()
    job.progress("voice", 0, len(rounds) + 2, "Recording the narration", force=True)

    # ---- intro: the title, then each step as its sentence starts (like presentation slides)
    if sting is not None:
        add(0.0, sting)
    else:
        add(0.1, qv.riser(0.7))
        add(0.8, qv.impact())
    lines = ["Let's play a memory game!",
             f"{words(N).capitalize()} flags will flash on your screen, really fast.",
             f"Then find {words(K)} of them, hidden in a grid of {words(G_)} flags.",
             f"You have only {words(SS)} seconds.",
             "Let's see how many you can find!"]
    t = 0.9
    cues = []
    hook = kid.intro() if kid else None          # "Hey everyone, welcome to Chaos Creators, ready for a challenge?"
    if hook is not None:
        cues.append(t)                           # the title comes with the kid's hook
        t += play(t, hook) + 0.35
    keys = ["flags_intro", "flags_rule1" if N == 10 else None, "flags_rule2" if (K, G_) == (5, 30) else None,
            # 30 s: flags_rule3_… ("thirty seconds"); other times: flags_rule3s<seconds>_… e.g. flags_rule3s15_.m4a
            "flags_rule3" if SS == 30 else f"flags_rule3s{SS}", "flags_rule4"]
    for i, line in enumerate(lines):
        if i or hook is None:
            cues.append(t)
        if i:
            add(t, popsnd)
        t += say(t, line, keys[i]) + 0.35
    # 5 cues: title (with the kid's hook, else the first line), step 1, step 2, step 3, the last line
    events.append(dict(kind="intro", start=0.0, end=t + 0.6, cues=cues))
    t += 0.6

    total_find = K * len(rounds)
    for ri, rd in enumerate(rounds):
        job.progress("voice", ri + 1, len(rounds) + 2, "Recording the narration")
        if len(rounds) > 1:
            add(t, whoosh)
            d = say(t + 0.3, f"Round {words(ri + 1)}!", f"flags_round{ri + 1}")
            cheer = kid.between(ri, len(rounds)) if kid and ri else None
            if cheer is not None:                # "You're doing great, keep going!" / "Almost there!"
                d += 0.3 + play(t + 0.3 + d + 0.3, cheer)
            events.append(dict(kind="round", start=t, end=t + max(2.2, d + 0.9), r=ri))
            t += max(2.2, d + 0.9)
        # get ready: voice, then 3-2-1
        add(t, whoosh)
        d = say(t + 0.2, "Remember these flags!", "flags_remember")
        cd = t + 0.2 + d + 0.2
        for k in range(3):
            add(cd + k * 0.7, tick_hi if k == 2 else tick)
        events.append(dict(kind="ready", start=t, end=cd + 2.1, cd=cd, r=ri))
        t = cd + 2.1
        # memorise: one flag every FS seconds
        for k in range(N):
            add(t + k * FS, tick)
        events.append(dict(kind="memo", start=t, end=t + N * FS, r=ri))
        t += N * FS
        # search: the grid, the instruction, then the timer
        add(t, whoosh)
        d = say(t + 0.4, f"Now find the {words(K)} flags you saw! Your time starts now!", "flags_find" if K == 5 else None)
        t0 = t + 0.4 + d + 0.2
        for s in range(int(SS)):
            add(t0 + s, tick_hi if SS - s <= 5 else tick)
        if SS >= 15:
            say(t0 + SS - 10 + 0.1, "Ten seconds left!", "flags_ten_left")
        end = t0 + SS
        add(end, qv.impact() * 0.7)
        d = say(end + 0.15, "Time's up!", "flags_times_up")
        events.append(dict(kind="search", start=t, end=end + max(1.4, d + 0.5), t0=t0, r=ri))
        t = end + max(1.4, d + 0.5)
        # reveal: the hidden flags pop out one by one, each named
        d = say(t + 0.3, "Let's see how you did!", "flags_lets_see")
        p0 = t + 0.3 + d + 0.3
        pops = []
        at = p0
        for code in rd["find"]:
            pops.append(at)
            add(at, chime)
            # "Number seven: Japan!" (viewers remember the numbers on the grid)
            n = say(at + 0.1, f"Number {words(rd['grid'].index(code) + 1)}: {names.get(code, code.upper())}!")
            at += max(1.1, n + 0.35)
        events.append(dict(kind="reveal", start=t, end=at + 1.8, pops=pops, r=ri))
        t = at + 1.8

    # ---- score
    job.progress("voice", len(rounds) + 1, len(rounds) + 2, "Recording the narration")
    add(t, whoosh)
    add(t + 0.3, applause)
    ending = kid.ending() if kid else None
    if ending is not None:                       # "That's a wrap! How many did you get right? Comment below ... bye!"
        d = play(t + 0.5, ending)
    else:
        d = say(t + 0.5, f"How many did you find? Comment your score out of {words(total_find)} below, "
                         f"and subscribe to {cfg.get('channel_name') or 'Chaos Creators'} for more fun challenges!")
    events.append(dict(kind="score", start=t, end=t + 0.5 + d + 2.0, total=total_find))
    total = events[-1]["end"]

    def track(items):
        out = np.zeros(int((total + 2) * SR), np.float32)
        for at, s in items:
            i = int(at * SR)
            out[i:i + len(s)] += s[:len(out) - i]
        return out[:int(total * SR)]
    speech, rest = track(voices), track(audio) * 0.8
    # Ducking (Rahul, 26 Nov 2026: the intro jingle drowned the kid's first words): while anyone
    # speaks, the jingles, ticks and chimes stay at no more than DUCK x the voice's level, with short fades.
    DUCK, fade = 0.35, int(0.15 * SR)
    gain = np.ones(len(rest), np.float32)
    for at, s in voices:
        i0, i1 = max(0, int(at * SR)), min(len(rest), int(at * SR) + len(s))
        if i1 <= i0:
            continue
        orms, vrms = qv.active_rms(rest[i0:i1]), qv.active_rms(s)
        if orms <= 1e-6 or orms <= DUCK * vrms:
            continue
        g = DUCK * vrms / orms
        lo, hi = max(0, i0 - fade), min(len(rest), i1 + fade)
        env = np.full(hi - lo, g, np.float32)
        env[:i0 - lo] = np.linspace(1, g, i0 - lo)
        env[i1 - lo:] = np.linspace(g, 1, hi - i1)
        gain[lo:hi] = np.minimum(gain[lo:hi], env)
    mix = speech + rest * gain
    mix /= max(1.0, np.abs(mix).max() / 0.95)
    return events, mix, total


# ============================== screens ==============================
def init_render(state):
    S.clear()
    S.update(state)
    W, H = S["W"], S["H"]
    L = S["L"] = layout(W, H)
    S["NAMES"] = json.loads((FLAGS_DIR / "countries.json").read_text(encoding="utf-8"))
    # header (logo + badge) on top of each background variant
    head = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    logo = qv.round_logo(qv.TEMPLATE / S["CFG"]["logo"]).resize((L["logo"][2], L["logo"][2]), Image.LANCZOS)
    head.alpha_composite(logo, (L["logo"][0], L["logo"][1]))
    pill(head, S["BADGE"], L["badge_x"], L["header_y"], 36 if L["tall"] else 34, GOLD, INK, "brain")
    spots = {"intro": (W / 2, H * 0.4), "memo": L["flag_c"], "grid": (W / 2, H * 0.55), "score": (W / 2, H * 0.27)}
    S["BG"] = {}
    for i, (k, sp) in enumerate(spots.items()):
        bg = background(W, H, 3 + i, sp, max(W, H) * 0.4)
        bg.alpha_composite(head)
        S["BG"][k] = bg
    opt = S["OPT"]
    cells, tw, th, gbox = grid_cells(opt["grid"], L["grid"])
    S["CELLS"], S["TW"], S["TH"], S["GBOX"] = cells, tw, th, gbox
    S["T_TITLE"] = {}


def title_cached(key, text, cy, size, cx=None, maxw=None):
    c = S.setdefault("T_TITLE", {})
    if key not in c:
        c[key] = title_layer(S["W"], S["H"], text, cy, size, cx, maxw)
    return c[key]


# ---------------- intro ----------------
def intro_static():
    """The intro's layers, drawn once: background+title, then one layer per step."""
    if "INTRO" in S:
        return S["INTRO"]
    W, H, L, opt = S["W"], S["H"], S["L"], S["OPT"]
    rd = S["ROUNDS"][0]
    base = S["BG"]["intro"].copy()
    tall = L["tall"]
    lay = {"base": base}
    lay["t1"] = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    white_text(lay["t1"], "LET'S PLAY", W / 2, 250 if tall else 200, 60 if tall else 56)
    lay["t1"].alpha_composite(title_layer(W, H, "A MEMORY GAME!", 350 if tall else 300, 100 if tall else 96, maxw=W - 80))
    steps = []
    if tall:
        ys = [500, 990, 1490]
        anchors = [(110, y) for y in ys]
    else:
        anchors = [(170, 450), (790, 450), (1410, 450)]
    labels = [f"WATCH {opt['show']} FLAGS", f"FIND {opt['find']} OF THEM", f"IN {opt['search_seconds']} SECONDS!"]
    for i, (bx, by) in enumerate(anchors):
        s = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(s)
        glow(s, lambda dd, c: dd.ellipse([bx - 44, by - 44, bx + 44, by + 44], fill=c), GOLD, 16, 200)
        d.ellipse([bx - 38, by - 38, bx + 38, by + 38], fill=GOLD, outline=WHITE, width=5)
        d.text((bx, by), str(i + 1), font=F("Bold", 44), fill=INK, anchor="mm")
        d.text((bx + 62, by), labels[i], font=F("Bold", 50 if tall else 40), fill=WHITE, anchor="lm", stroke_width=5, stroke_fill=INK)
        steps.append(s)
    lay["steps"] = steps
    lay["anchors"] = anchors
    # step 1: the fan of flags (positions; cards drawn per frame as they fly in)
    fan = rd["show"][:10]
    lay["fan"] = []
    for k, code in enumerate(fan):
        ang = -20 + k * (40 / max(1, len(fan) - 1))
        t_ = tile(code, 170 if tall else 200, 113 if tall else 133).rotate(-ang, resample=Image.BICUBIC, expand=True)
        if tall:
            pos = (380 + k * 52, 700 + abs(k - (len(fan) - 1) / 2) * 8)
        else:
            pos = (210 + k * 40, 660 + abs(k - (len(fan) - 1) / 2) * 7)
        lay["fan"].append((t_, pos))
    # step 2: a mini grid (the hidden flags among some decoys), lit one by one
    sub = list(rd["find"]) + [c for c in rd["grid"] if c not in rd["find"]][: 24 - len(rd["find"])]
    random.Random(5).shuffle(sub)
    box = (150, 1060, 760, 320) if tall else (670, 540, 600, 380)
    cells, mw, mh, gb = grid_cells(len(sub), box, gap=(10, 12))
    g2 = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    glass(g2, [gb[0] - 22, gb[1] - 22, gb[0] + gb[2] + 22, gb[1] + gb[3] + 22], 24, 30)
    lit = []
    for code, (cx, cy) in zip(sub, cells):
        if code in rd["find"]:
            lit.append((code, cx, cy))
            paste_tile(g2, tile(code, mw, mh, border=3), cx, cy)
        else:
            paste_tile(g2, tile(code, mw, mh, border=3, dim=0.3), cx, cy)
    lay["grid2"], lay["lit"], lay["mini"] = g2, lit, (mw, mh)
    S["INTRO"] = lay
    return lay


def draw_ring(img, cx, cy, r, frac, secs, k=1.0):
    if k <= 0:
        return
    d = ImageDraw.Draw(img)
    glow(img, lambda dd, c: dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c), (0, 0, 0), 14, 120)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    w = max(10, int(r * 0.15))
    d.arc([cx - r + 10, cy - r + 10, cx + r - 10, cy + r - 10], 0, 360, fill=(230, 226, 245), width=w)
    col = GREEN if frac > 0.5 else (GOLD2 if frac > 0.2 else RED)
    if frac > 0:
        d.arc([cx - r + 10, cy - r + 10, cx + r - 10, cy + r - 10], -90, -90 + 360 * frac, fill=col, width=w)
    d.text((cx, cy - 4), str(secs), font=F("Bold", int(r * 0.9)), fill=INK, anchor="mm")


def draw_intro(img, seg, tt):
    lay = intro_static()
    W, H, L, opt = S["W"], S["H"], S["L"], S["OPT"]
    tall = L["tall"]
    c = seg["cues"]
    s0 = tt - c[0]
    if s0 > 0:
        t1 = lay["t1"]
        if s0 < 0.5:
            sc = max(0.05, pop(s0 / 0.5))
            t1 = t1.resize((int(W * sc), int(H * sc)), Image.LANCZOS)
            img.alpha_composite(fade(t1, min(1, s0 * 3)), (int((W - t1.width) / 2), int((350 if tall else 300) * (1 - sc))))
        else:
            img.alpha_composite(t1)
    # the dotted step line: fills gold as each step appears
    d = ImageDraw.Draw(img)
    a = lay["anchors"]
    if tall:
        for y in range(a[0][1] + 50, a[2][1] - 40, 26):
            if tt < c[1]:
                break
            on = (y < a[1][1] and tt >= c[2]) or (y >= a[1][1] and tt >= c[3])
            d.ellipse([a[0][0] - 5, y - 5, a[0][0] + 5, y + 5], fill=GOLD if on else (255, 255, 255, 120))
    else:
        for x in range(a[0][0] + 50, a[2][0] - 40, 26):
            if tt < c[1] or x > a[1][0] - 50 and x < a[1][0] + 50:
                continue
            on = (x < a[1][0] and tt >= c[2]) or (x >= a[1][0] and tt >= c[3])
            d.ellipse([x - 5, a[0][1] - 5, x + 5, a[0][1] + 5], fill=GOLD if on else (255, 255, 255, 120))
    # step k appears with its sentence (cue k+1): slides up and fades in
    for k in range(3):
        s = tt - c[k + 1]
        if s <= 0:
            continue
        e = ease(s / 0.45)
        st = fade(lay["steps"][k], e)
        img.alpha_composite(st, (0, int(40 * (1 - e))))
        if k == 0:
            for j, (card, (px, py)) in enumerate(lay["fan"]):
                sj = s - 0.15 - j * 0.07
                if sj <= 0:
                    continue
                ej = ease(sj / 0.35)
                paste_tile(img, card, px - (1 - ej) * 500, py, 1.0, min(1, ej * 1.5))
            pill(img, f"{opt['flag_seconds']:g} second{'s' if opt['flag_seconds'] != 1 else ''} each!", 640 if tall else 390, 850 if tall else 830,
                 36 if tall else 30, PINK, WHITE, k=min(1, max(0, (s - 0.9) / 0.35)))
            paste_icon(img, "eye", 910 if tall else 520, 500 if tall else 450, 120 if tall else 90, min(1, max(0, (s - 0.3) / 0.35)))
            paste_icon(img, "lightning", 420 if tall else 170, 850 if tall else 830, 80 if tall else 64, min(1, max(0, (s - 1.0) / 0.35)))
        elif k == 1:
            img.alpha_composite(fade(lay["grid2"], e))
            mw, mh = lay["mini"]
            for j, (code, cx, cy) in enumerate(lay["lit"]):
                sj = s - 0.6 - j * 0.22
                if sj <= 0:
                    continue
                g = min(1, sj / 0.25)
                glow(img, lambda dd, cc: dd.rectangle([cx - mw / 2 - 8, cy - mh / 2 - 8, cx + mw / 2 + 8, cy + mh / 2 + 8], fill=cc), GREEN, 9, int(255 * g))
                paste_tile(img, tile(code, mw, mh, ring=GREEN, border=3), cx, cy, 1 + 0.12 * math.sin(min(1, sj / 0.3) * math.pi))
            pill(img, f"hidden among {opt['grid']} flags", 520 if tall else 970, 1420 if tall else 960, 34 if tall else 30, WHITE, INK,
                 k=min(1, max(0, (s - 1.4) / 0.35)))
            paste_icon(img, "magnifier", 885 if tall else 1250, 1145 if tall else 520, 170 if tall else 110, min(1, max(0, (s - 0.3) / 0.35)))
        else:
            rx, ry, rr = (330, 1680, 112) if tall else (1560, 690, 150)
            draw_ring(img, rx, ry, rr, min(1, s / 0.6), opt["search_seconds"], e)
            paste_icon(img, "stopwatch", 550 if tall else 1760, 1680 if tall else 700, 140 if tall else 110, min(1, max(0, (s - 0.3) / 0.35)))
    s5 = tt - c[4]
    if s5 > 0:
        kk = min(1, s5 / 0.35)
        if tall:
            pill(img, "How many can", 830, 1640, 38, PINK, WHITE, k=kk)
            pill(img, "YOU find?", 830, 1725, 38, PINK, WHITE, k=kk)
        else:
            pill(img, "How many can YOU find?", 1560, 930, 36, PINK, WHITE, k=kk)


# ---------------- round card / ready / memorise ----------------
def draw_round(img, seg, tt):
    W, H = S["W"], S["H"]
    s = tt - seg["start"]
    e = pop(min(1, s / 0.45))
    lay = title_cached(("round", seg["r"]), f"ROUND {seg['r'] + 1}", H * 0.45, 170 if H > W else 160)
    if e > 0:
        t1 = lay.resize((max(1, int(W * e)), max(1, int(H * e))), Image.LANCZOS)
        img.alpha_composite(t1, (int((W - t1.width) / 2), int((H - t1.height) / 2)))
    pill(img, f"{S['LEVEL'].upper()} · {len(S['ROUNDS'])} ROUNDS", W / 2, H * 0.45 + 170, 40, WHITE, INK, k=min(1, max(0, (s - 0.4) / 0.35)))


def draw_ready(img, seg, tt):
    W, H, L = S["W"], S["H"], S["L"]
    white_text(img, "REMEMBER THESE FLAGS!", W / 2, L["memo_title_y"], 62 if L["tall"] else 66, maxw=W - 80)
    s = tt - seg["cd"]
    if s >= 0:
        n = 3 - int(s / 0.7)
        if n >= 1:
            k = (s % 0.7) / 0.7
            sc = 1.4 - 0.4 * ease(k / 0.4)
            f = F("Bold", int(300 * sc))
            d = ImageDraw.Draw(img)
            glow(img, lambda dd, c: dd.ellipse([W / 2 - 200, H / 2 - 200, W / 2 + 200, H / 2 + 200], fill=c), GOLD, 60, 120)
            d.text((W / 2, H / 2), str(n), font=f, fill=GOLD, anchor="mm", stroke_width=12, stroke_fill=INK)
        else:
            img.alpha_composite(title_cached("go", "GO!", H / 2, 260))
    paste_icon(img, "brain", *L["brain"], 110)


def draw_memo(img, seg, tt):
    W, H, L, opt = S["W"], S["H"], S["L"], S["OPT"]
    rd = S["ROUNDS"][seg["r"]]
    FS = opt["flag_seconds"]
    k = min(opt["show"] - 1, int((tt - seg["start"]) / FS))
    s = tt - seg["start"] - k * FS
    white_text(img, "REMEMBER THIS FLAG!", W / 2, L["memo_title_y"], 62 if L["tall"] else 60, maxw=W - 80)
    bw, bh = L["flag_box"]
    fl = waving(rd["show"][k], bw, bh, tt)
    cx, cy = L["flag_c"]
    e = ease(min(1, s / 0.14))
    sc = 0.86 + 0.14 * e
    if sc != 1:
        fl = fl.resize((max(1, int(fl.width * sc)), max(1, int(fl.height * sc))), Image.LANCZOS)
    glow(img, lambda d, c: d.rectangle([cx - bw / 2 - 10, cy - bh / 2 - 10, cx + bw / 2 + 10, cy + bh / 2 + 10], fill=c), WHITE, 70, int(80 * e))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 150), (int(cx - fl.width / 2 + 10), int(cy - fl.height / 2 + 30)), fl.getchannel("A"))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    img.alpha_composite(fade(fl, min(1, e * 1.4)), (int(cx - fl.width / 2), int(cy - fl.height / 2)))
    # progress segments + counter
    n = opt["show"]
    segw = min(64, (W - 260) / n - 14)
    x0 = W / 2 - (n * (segw + 14) - 14) / 2
    d = ImageDraw.Draw(img)
    for j in range(n):
        x = x0 + j * (segw + 14)
        d.rounded_rectangle([x, L["bar_y"] - 10, x + segw, L["bar_y"] + 10], 10, fill=GOLD if j <= k else (255, 255, 255, 70))
    pill(img, f"FLAG  {k + 1} / {n}", W / 2, L["count_y"], 58 if L["tall"] else 50, GOLD, INK)
    paste_icon(img, "brain", *L["brain"], 110)


# ---------------- grid: search + reveal ----------------
def grid_base(r, dim=0.0, keep=()):
    """The grid (glass panel + flags) of round r, cached. `keep` flags are left out (drawn on top)."""
    key = ("grid", r, dim, tuple(keep))
    c = S.setdefault("GRIDS", {})
    if key not in c:
        if len(c) > 4:
            c.clear()
        img = Image.new("RGBA", (S["W"], S["H"]), (0, 0, 0, 0))
        gx, gy, gw, gh = S["GBOX"]
        glass(img, [gx - 30, gy - 30, gx + gw + 30, gy + gh + 30], 36, 26)
        for i, (code, (cx, cy)) in enumerate(zip(S["ROUNDS"][r]["grid"], S["CELLS"])):
            if code in keep:
                continue
            paste_tile(img, tile(code, S["TW"], S["TH"], dim=dim), cx, cy)
            number_badge(img, code, i + 1, cx, cy, S["TW"], S["TH"])
        c[key] = img
    return c[key]


def draw_search(img, seg, tt):
    W, H, L, opt = S["W"], S["H"], S["L"], S["OPT"]
    r = seg["r"]
    s = tt - seg["start"]
    tall = L["tall"]
    if tall:
        img.alpha_composite(title_cached("find", f"FIND THE {opt['find']} FLAGS!", L["title_y"], 80, maxw=W - 60))
        white_text(img, "You saw them a moment ago", W / 2, L["sub_y"], 38, stroke=4)
    else:
        img.alpha_composite(title_cached("find", "FIND THE", 250, 90, cx=330, maxw=560))
        img.alpha_composite(title_cached("find2", f"{opt['find']} FLAGS!", 360, 110, cx=330, maxw=560))
        white_text(img, "You saw them a moment ago", 330, 450, 34, stroke=4, maxw=560)
    if s < 0.9:  # the flags pop into the grid, one after another
        gx, gy, gw, gh = S["GBOX"]
        glass(img, [gx - 30, gy - 30, gx + gw + 30, gy + gh + 30], 36, int(26 * min(1, s * 3)))
        for i, (code, (cx, cy)) in enumerate(zip(S["ROUNDS"][r]["grid"], S["CELLS"])):
            si = s - i * 0.02
            if si > 0:
                sc = max(0.05, pop(min(1, si / 0.3)))
                paste_tile(img, tile(code, S["TW"], S["TH"]), cx, cy, sc)
                number_badge(img, code, i + 1, cx, cy, S["TW"], S["TH"], sc)
    else:
        img.alpha_composite(grid_base(r))
    SS = opt["search_seconds"]
    left = SS - max(0.0, tt - seg["t0"])
    cx, cy, rr = L["timer"]
    if left > 0:
        frac = left / SS
        pulse = 1 + (0.06 * math.sin((tt - seg["t0"]) * 2 * math.pi) if left <= 5 else 0)
        draw_ring(img, cx, cy, rr * pulse, frac, math.ceil(left) if tt >= seg["t0"] else SS)
        paste_icon(img, "hourglass", L["hour"][0], L["hour"][1], 120)
    else:
        k = min(1, (-left) / 0.3)
        lay = title_cached("timesup", "TIME'S UP!", cy, 100 if tall else 80, cx=cx, maxw=W - 80 if tall else 560)
        sc = max(0.05, pop(k))
        t1 = lay.resize((max(1, int(W * sc)), max(1, int(H * sc))), Image.LANCZOS)
        img.alpha_composite(t1, (int(cx - cx * sc), int(cy - cy * sc)))


def draw_reveal(img, seg, tt):
    W, H, L, opt = S["W"], S["H"], S["L"], S["OPT"]
    r = seg["r"]
    rd = S["ROUNDS"][r]
    s = tt - seg["start"]
    tall = L["tall"]
    if tall:
        img.alpha_composite(title_cached("rev", "DID YOU FIND THEM?", 270, 74, maxw=W - 60))
    else:
        img.alpha_composite(title_cached("rev", "DID YOU", 250, 90, cx=330, maxw=560))
        img.alpha_composite(title_cached("rev2", "FIND THEM?", 360, 90, cx=330, maxw=560))
    found = sum(1 for p in seg["pops"] if tt >= p)
    if s < 0.4:  # the decoys dim
        img.alpha_composite(grid_base(r))
        dimmed = grid_base(r, 0.35)
        img.alpha_composite(fade(dimmed, s / 0.4))
    else:
        img.alpha_composite(grid_base(r, 0.35))
    pill(img, f"{found} / {len(rd['find'])} revealed", W / 2 if tall else 330, L["rev_count_y"], 38 if tall else 34, WHITE, INK)
    # the hidden flags pop out bigger, with a green glow and their name
    for code, at in zip(rd["find"], seg["pops"]):
        if tt < at:
            continue
        cx, cy = S["CELLS"][rd["grid"].index(code)]
        k = min(1, (tt - at) / 0.35)
        sc = 1 + 0.18 * pop(k)
        bw, bh = S["TW"] * sc, S["TH"] * sc
        glow(img, lambda d, c: d.rectangle([cx - bw / 2 - 14, cy - bh / 2 - 14, cx + bw / 2 + 14, cy + bh / 2 + 14], fill=c), GREEN, 22, int(230 * min(1, k * 2)))
        paste_tile(img, tile(code, int(S["TW"] * 1.18), int(S["TH"] * 1.18), ring=GREEN, border=6), cx, cy, sc / 1.18)
        number_badge(img, code, rd["grid"].index(code) + 1, cx, cy, S["TW"], S["TH"], sc)
        name = f"{rd['grid'].index(code) + 1} · {S['NAMES'].get(code, code.upper()).upper()}"
        d = ImageDraw.Draw(img)
        f = F("Bold", 28 if tall else 26)
        while d.textlength(name, font=f) > S["TW"] * 1.9 and f.size > 16:
            f = F("Bold", f.size - 2)
        nw = d.textlength(name, font=f) + 34
        if k > 0.5:
            ny = cy + bh / 2 - 4
            d.rounded_rectangle([cx - nw / 2, ny - 22, cx + nw / 2, ny + 22], 18, fill=GOLD)
            d.text((cx, ny), name, font=f, fill=INK, anchor="mm")
    if tt >= seg["pops"][-1] + 0.8:
        pill(img, "1 point for every flag you found", W / 2 if tall else 330, L["reveal_pill_y"], 40 if tall else 30, WHITE, INK, "star",
             k=min(1, (tt - seg["pops"][-1] - 0.8) / 0.35))


# ---------------- score ----------------
def rank_bands(total):
    """[(label, name)] best first: total, >= 80 %, >= 60 %, 1+, 0."""
    if total <= 1:
        return [(str(total), RANK_NAMES[0]), ("0", RANK_NAMES[4])]
    b2, b3 = max(1, math.ceil(total * 0.8)), max(1, math.ceil(total * 0.6))
    out = [(str(total), RANK_NAMES[0])]
    if b2 <= total - 1:
        out.append((f"{b2}" if b2 == total - 1 else f"{b2}-{total - 1}", RANK_NAMES[1]))
    if b3 <= b2 - 1:
        out.append((f"{b3}" if b3 == b2 - 1 else f"{b3}-{b2 - 1}", RANK_NAMES[2]))
    if b3 - 1 >= 1:
        out.append(("1" if b3 - 1 == 1 else f"1-{b3 - 1}", RANK_NAMES[3]))
    out.append(("0", RANK_NAMES[4]))
    return out


def draw_score(img, seg, tt):
    W, H, L = S["W"], S["H"], S["L"]
    tall = L["tall"]
    s = tt - seg["start"]
    ty = 470 if tall else 230
    if icon("trophy", 290 if tall else 230) is not None:
        glow(img, lambda d, c: d.ellipse([W / 2 - 200, ty - 200, W / 2 + 200, ty + 200], fill=c), GOLD, 70, int(150 * min(1, s * 2)))
    paste_icon(img, "trophy", W / 2, ty, 290 if tall else 230, min(1, s / 0.45))
    paste_icon(img, "confetti", 250 if tall else W / 2 - 330, ty - 60, 110, min(1, max(0, (s - 0.3) / 0.35)))
    paste_icon(img, "confetti", W - 250 if tall else W / 2 + 330, ty - 120, 110, min(1, max(0, (s - 0.4) / 0.35)))
    if tall:
        white_text(img, "HOW MANY DID", W / 2, 720, 64)
        img.alpha_composite(title_cached("youfind", "YOU FIND?", 820, 108))
    else:
        white_text(img, "HOW MANY DID YOU FIND?", W / 2, 420, 64)
    bands = rank_bands(seg["total"])
    d = ImageDraw.Draw(img)
    for k, (sc, nm) in enumerate(bands):
        sk = s - 0.6 - k * 0.3
        if sk <= 0:
            continue
        e = ease(sk / 0.35)
        if tall:
            y, x0, x1 = 1010 + k * 132, 150, W - 150
        else:
            y, x0, x1 = 530 + k * 92, W / 2 - 420, W / 2 + 420
        off = (1 - e) * 120
        glass(img, [x0 + off, y - 54 * (1 if tall else 0.78), x1 + off, y + 54 * (1 if tall else 0.78)], 30, int((44 if k else 70) * e))
        col = RANK_COLORS[min(k, 4)] if k < len(bands) - 1 else RANK_COLORS[4]
        rr = 40 if tall else 32
        medal = ["gold_medal", "silver_medal", "bronze_medal"][k] if k < 3 and k < len(bands) - 1 else None
        if medal and icon(medal, int(rr * 2.4)) is not None:
            paste_icon(img, medal, x0 + 25 + rr + off, y, int(rr * 2.4))
        else:
            d.ellipse([x0 + 25 + off, y - rr * 0.55, x0 + 25 + 2 * rr * 0.55 + off + rr * 0.9, y + rr * 0.55], fill=col)
            d.ellipse([x0 + 25 + rr * 0.45 + off, y - rr * 0.55, x0 + 25 + rr * 1.55 + off, y + rr * 0.55], fill=col)
        d.text((x0 + 40 + 2 * rr + off, y), nm, font=F("Bold", 46 if tall else 38), fill=WHITE, anchor="lm")
        d.text((x1 - 30 + off, y), f"{sc} / {seg['total']}", font=F("Bold", 38 if tall else 30), fill=GOLD if k == 0 else WHITE, anchor="rm")
    pill(img, "Comment your score below!", W / 2, 1720 if tall else 1010, 48 if tall else 40, PINK, WHITE,
         k=min(1, max(0, (s - 0.6 - len(bands) * 0.3) / 0.35)))


DRAW = {"intro": draw_intro, "round": draw_round, "ready": draw_ready, "memo": draw_memo,
        "search": draw_search, "reveal": draw_reveal, "score": draw_score}
BG_OF = {"intro": "intro", "round": "intro", "ready": "memo", "memo": "memo", "search": "grid", "reveal": "grid", "score": "score"}


def _segment(tt):
    for seg in S["events"]:
        if seg["start"] <= tt < seg["end"]:
            return seg
    return S["events"][-1]


def frame(tt):
    seg = _segment(tt)
    img = S["BG"][BG_OF[seg["kind"]]].copy()
    DRAW[seg["kind"]](img, seg, tt)
    # a quick fade from black at the very start
    if tt < 0.25:
        img = Image.blend(Image.new("RGBA", img.size, (0, 0, 0, 255)), img, tt / 0.25)
    return img.convert("RGB")


def render_part(args):
    idx, f0, f1, out, counter = args
    W, H = S["W"], S["H"]
    ff = subprocess.Popen([S["FFMPEG"], "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-threads", "2", str(out)],
                          stdin=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    for i in range(f0, f1):
        ff.stdin.write(frame(i / FPS).tobytes())
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


# ============================== thumbnail ==============================
def design_thumbnail(job_dir, seed=None):
    job_dir = pathlib.Path(job_dir)
    spec = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    rounds = json.loads((job_dir / "rounds.json").read_text(encoding="utf-8"))
    opt = flag_options(spec)
    wide = spec.get("format") == "youtube"
    W, H = (1280, 720) if wide else (1080, 1920)
    S.clear()
    S.update(W=W, H=H)
    img = background(W, H, 9, (W / 2, H * 0.5), max(W, H) * 0.45)
    d = ImageDraw.Draw(img)
    logo = qv.round_logo(qv.TEMPLATE / "assets" / "logo.png").resize((110 if wide else 170,) * 2, Image.LANCZOS)
    img.alpha_composite(logo, (20, H - 132) if wide else (22, 40))
    rng = random.Random(seed if seed is not None else 1)
    codes = list(dict.fromkeys(rounds[0]["show"] + rounds[0]["grid"]))
    if seed is not None:
        rng.shuffle(codes)
    codes = codes[:12]
    if wide:
        pill(img, "FLAG MEMORY CHALLENGE", 330, 90, 30, GOLD, INK, "brain")
        img.alpha_composite(title_layer(W, H, "CAN YOU FIND", 220, 70, cx=330, maxw=600))
        img.alpha_composite(title_layer(W, H, f"{opt['find']} FLAGS?", 320, 100, cx=330, maxw=600))
        pill(img, f"in {opt['search_seconds']} seconds!", 330, 430, 36, PINK, WHITE)
        cells, tw, th, _ = grid_cells(9, (700, 70, 540, 580), gap=(14, 18))
    else:
        pill(img, "FLAG MEMORY CHALLENGE", 600, 110, 40, GOLD, INK, "brain")
        img.alpha_composite(title_layer(W, H, "CAN YOU FIND", 330, 100, maxw=W - 80))
        img.alpha_composite(title_layer(W, H, f"{opt['find']} FLAGS?", 470, 150, maxw=W - 80))
        cells, tw, th, _ = grid_cells(9, (90, 640, W - 180, 860), gap=(26, 34))
        pill(img, f"in {opt['search_seconds']} seconds!", W / 2, 1620, 64, PINK, WHITE)
    for i, (cx, cy) in enumerate(cells):
        t_ = tile(codes[i % len(codes)], tw, th, border=5).rotate(rng.uniform(-6, 6), resample=Image.BICUBIC, expand=True)
        if i == 4:  # one flag found
            glow(img, lambda dd, c: dd.rectangle([cx - tw * 0.7, cy - th * 0.7, cx + tw * 0.7, cy + th * 0.7], fill=c), GREEN, 26, 255)
            t_ = tile(codes[i % len(codes)], int(tw * 1.25), int(th * 1.25), ring=GREEN, border=7)
        paste_tile(img, t_, cx, cy)
    out = img.convert("RGB")
    tmp = job_dir / "thumbnail.tmp.jpg"
    for q in (92, 86, 78, 70):
        out.save(tmp, "JPEG", quality=q, optimize=True, progressive=True)
        if tmp.stat().st_size < 2 * 1024 * 1024 - 50_000:
            break
    tmp.replace(job_dir / "thumbnail.jpg")
    (job_dir / "thumbnail.json").write_text(json.dumps(dict(width=W, height=H, flags=True)), encoding="utf-8")
    return job_dir / "thumbnail.jpg"


# ============================== main ==============================
def flag_options(spec):
    o = spec.get("flags") or {}
    return dict(level=str(o.get("level") or "easy"), show=int(o.get("show") or 10), find=int(o.get("find") or 5),
                grid=int(o.get("grid") or 30), flag_seconds=float(o.get("flag_seconds") or 1),
                search_seconds=int(o.get("search_seconds") or 30))


def setup(job_dir):
    job = qv.Job(job_dir)
    spec = job.spec
    fmt_name = spec.get("format", "shorts")
    if fmt_name not in qv.LAYOUTS:
        raise ValueError(f"Unknown format {fmt_name}")
    cfg = qv.load_cfg(spec)
    rounds = json.loads((job.dir / "rounds.json").read_text(encoding="utf-8"))
    opt = flag_options(spec)
    for i, rd in enumerate(rounds):
        missing = [c for c in rd["show"] + rd["grid"] if not (FLAGS_DIR / f"{c}.png").is_file()]
        if missing:
            raise ValueError(f"Missing flag pictures: {', '.join(missing)}")
        # The game must be fair (Rahul: "people will make fun of a failed game"): every hidden flag was
        # shown AND is in the grid, and no other shown flag is in the grid. Never make a broken video.
        show, find, grid = rd["show"], rd["find"], rd["grid"]
        if (len(find) != opt["find"] or len(show) != opt["show"] or len(grid) != opt["grid"]
                or len(set(grid)) != len(grid) or len(set(show)) != len(show)
                or any(c not in show or c not in grid for c in find)
                or sum(1 for c in grid if c in show) != len(find)):
            raise ValueError(f"Round {i + 1}'s flags don't add up (a hidden flag not shown or not in the grid). "
                             "Press Shuffle in the Flags tab and make the video again.")
    lay = qv.LAYOUTS[fmt_name]
    badge = str((spec.get("settings") or {}).get("quiz_badge") or "FLAG MEMORY CHALLENGE").upper()
    state = dict(W=lay["W"], H=lay["H"], CFG=cfg, OPT=opt, ROUNDS=rounds, BADGE=badge, LEVEL=opt["level"])
    return job, spec, fmt_name, cfg, rounds, opt, state


def main(job_dir):
    job, spec, fmt_name, cfg, rounds, opt, state = setup(job_dir)
    home = pathlib.Path(os.environ.get("CHAOS_HOME") or pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home())) / "RSC Classroom" / "chaos")
    models = pathlib.Path(spec.get("models_dir") or (home / "models"))
    job.progress("voice", 0, len(rounds) + 2, "Loading the narrator voice", force=True)
    t0 = time.time()
    voice = qv.Voice(cfg, models)
    seed = str(cfg.get("seed") or job.dir.name)
    sounds = qv.Sounds(cfg, seed)
    pack = str(cfg.get("voice_pack") or "").strip()
    kid = KidFlags(pack, seed, fmt_name) if pack and pack.lower() != "off" else None
    S.clear()
    S["NAMES"] = json.loads((FLAGS_DIR / "countries.json").read_text(encoding="utf-8"))
    events, mix, total = build_timeline(cfg, opt, rounds, voice, job, sounds, kid)
    if kid:
        sounds.used["voice_pack"] = kid.used
    print(f"[time] narration + sound in {time.time() - t0:.1f}s, video {total:.1f}s", flush=True)
    import soundfile as sf
    wav = job.dir / "audio.wav"
    sf.write(str(wav), mix, SR)
    del mix

    FF = qv.ffmpeg_exe()
    state.update(events=events, FFMPEG=FF)
    nf = int(total * FPS)
    workers = max(1, min(int(spec.get("workers") or 0) or (os.cpu_count() or 2) - 1, 12))
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
    for p in parts:
        pathlib.Path(p).unlink(missing_ok=True)
    parts_dir.rmdir()
    lst.unlink(missing_ok=True)
    wav.unlink(missing_ok=True)
    chapters = []
    for e in events:
        if e["kind"] in ("intro", "score"):
            chapters.append(dict(t=round(e["start"], 1), kind="intro" if e["kind"] == "intro" else "outro", q=None))
        elif e["kind"] in ("round", "ready") and not any(c.get("q") == e["r"] for c in chapters):
            chapters.append(dict(t=round(e["start"], 1), kind="round", q=e["r"]))
    job.progress("finish", nf, nf, "Designing the thumbnail", force=True)
    try:
        design_thumbnail(job.dir)
    except Exception:
        print("[thumbnail] " + traceback.format_exc(), flush=True)
    lay = qv.LAYOUTS[fmt_name]
    meta = dict(duration=round(total, 1), questions=len(rounds), rounds=len(rounds), width=lay["W"], height=lay["H"], format=fmt_name,
                render_seconds=round(time.time() - job.started, 1), chapters=chapters, sounds=sounds.used,
                credits=qv.sound_credits(sounds.used))
    (job.dir / "result.json").write_text(json.dumps(meta), encoding="utf-8")
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


def stills(job_dir, times):
    """Single frames for checking a design without making the whole video (no voice: fixed timings)."""
    job, spec, fmt_name, cfg, rounds, opt, state = setup(job_dir)

    class Quiet:
        def say(self, text):
            return np.zeros(int(SR * (0.5 + 0.065 * len(text))), np.float32)

    class NoJob:
        def progress(self, *a, **k):
            pass
    S.clear()
    S["NAMES"] = json.loads((FLAGS_DIR / "countries.json").read_text(encoding="utf-8"))
    events, _, total = build_timeline(cfg, opt, rounds, Quiet(), NoJob(), None)
    state.update(events=events)
    init_render(state)
    out = job.dir / "stills"
    out.mkdir(exist_ok=True)
    for t in times:
        tt = float(t) if not str(t).startswith("@") else _at(events, str(t)[1:])
        frame(tt).save(out / f"{str(t).replace('@', 'at-').replace(':', '-')}.jpg", quality=90)
    print(json.dumps([dict(kind=e["kind"], start=round(e["start"], 2), end=round(e["end"], 2)) for e in events]))


def _at(events, spec):
    """"memo:0.4" = 0.4 of the way through the first memo segment; "intro:end-0.1" etc."""
    kind, _, frac = spec.partition(":")
    e = next(e for e in events if e["kind"] == kind)
    if frac.startswith("end-"):
        return e["end"] - float(frac[4:])
    return e["start"] + (e["end"] - e["start"]) * float(frac or 0.5)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "thumbnail":
        print(design_thumbnail(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else None))
        sys.exit(0)
    if len(sys.argv) >= 4 and sys.argv[1] == "still":
        stills(pathlib.Path(sys.argv[2]), sys.argv[3:])
        sys.exit(0)
    d = pathlib.Path(sys.argv[1])
    try:
        main(d)
    except Exception as e:
        msg = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
        (d / "error.txt").write_text(msg + "\n\n" + traceback.format_exc(), encoding="utf-8")
        try:
            qv.Job(d).progress("error", 0, 0, msg, force=True)
        except Exception:
            pass
        sys.exit(1)
