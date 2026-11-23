"""Original artwork for the Avengers: Doomsday quiz Short (Canva is out of credits).
Writes thumbnail, intro, outro and q1..q5 backgrounds (1080x1920) into <out_dir>.
All drawn from scratch: no logos, film stills or real faces."""
import math, random, sys, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

W, H = 1080, 1920
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(r"C:\Users\rahul\OneDrive\Desktop\RSC Classroom\src\Chaos creators\quiz-template\quiz-template")
FONT = str(ROOT / "fonts" / "Poppins-Bold.ttf")
LOGO = ROOT / "assets" / "logo.png"
GREEN, LIME, GOLD = (40, 255, 120), (170, 255, 90), (255, 200, 60)
f = lambda s: ImageFont.truetype(FONT, s)


def radial(W, H, cx, cy, inner, outer, r):
    y, x = np.ogrid[:H, :W]
    d = np.clip(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r, 0, 1)[..., None]
    a = np.array(inner, np.float32); b = np.array(outer, np.float32)
    return Image.fromarray((a * (1 - d) + b * d).astype(np.uint8), "RGB")


def smoke(W, H, rnd, tint, alpha, scale=24):
    n = np.random.default_rng(rnd.randint(0, 1 << 30)).random((H // scale + 2, W // scale + 2)).astype(np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8), "L").resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(30))
    m = np.asarray(im, np.float32) / 255
    m = np.clip((m - 0.35) * 2.2, 0, 1) * alpha
    layer = Image.new("RGB", (W, H), tint)
    return layer, Image.fromarray((m * 255).astype(np.uint8), "L")


def stars(img, rnd, n=260):
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.choice([1, 1, 1, 2, 2, 3])
        c = rnd.randint(150, 255)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(c, 255, c))


def glow_layer(draw_fn, blur, strength=1.0):
    """Draws on a black layer, returns glow (blurred) + core added together."""
    core = Image.new("RGB", (W, H)); draw_fn(ImageDraw.Draw(core))
    g = core.filter(ImageFilter.GaussianBlur(blur))
    g = Image.eval(g, lambda v: min(255, int(v * strength)))
    return ImageChops.add(g, core)


def add(img, layer):
    return ImageChops.screen(img, layer)


def bolt_points(x0, y0, x1, y1, rnd, depth=6, spread=0.28):
    pts = [(x0, y0), (x1, y1)]
    for _ in range(depth):
        new = [pts[0]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            L = math.hypot(bx - ax, by - ay)
            mx, my = (ax + bx) / 2, (ay + by) / 2
            nx, ny = -(by - ay) / (L or 1), (bx - ax) / (L or 1)
            o = rnd.uniform(-spread, spread) * L
            new += [(mx + nx * o, my + ny * o), (bx, by)]
        pts = new
        spread *= 0.85
    return pts


def lightning(img, rnd, n, color=LIME, area=(0, 0, W, H * 0.45)):
    def draw(d):
        for _ in range(n):
            x0 = rnd.uniform(area[0], area[2]); y0 = area[1]
            x1 = x0 + rnd.uniform(-300, 300); y1 = rnd.uniform(area[3] * 0.6, area[3])
            p = bolt_points(x0, y0, x1, y1, rnd)
            d.line(p, fill=color, width=5)
            for _ in range(2):  # branches
                k = rnd.randrange(len(p) // 3, len(p) - 2)
                bx, by = p[k]
                q = bolt_points(bx, by, bx + rnd.uniform(-220, 220), by + rnd.uniform(80, 260), rnd, 5)
                d.line(q, fill=color, width=2)
    return add(img, glow_layer(draw, 14, 2.2))


def rays(img, cx, cy, n, color, rnd, alpha=70, length=2200):
    layer = Image.new("RGB", (W, H)); d = ImageDraw.Draw(layer)
    for i in range(n):
        a = i / n * math.tau + rnd.uniform(-0.05, 0.05); w = rnd.uniform(0.02, 0.06)
        p = [(cx, cy), (cx + math.cos(a - w) * length, cy + math.sin(a - w) * length), (cx + math.cos(a + w) * length, cy + math.sin(a + w) * length)]
        d.polygon(p, fill=tuple(int(c * alpha / 255) for c in color))
    return add(img, layer.filter(ImageFilter.GaussianBlur(10)))


def skyline(img, rnd, base, color=(4, 10, 8), windows=True):
    d = ImageDraw.Draw(img)
    x = -20
    while x < W:
        bw = rnd.randint(50, 130); bh = rnd.randint(140, 520)
        d.rectangle((x, base - bh, x + bw, H), fill=color)
        if rnd.random() < 0.3:  # spire
            d.polygon([(x + bw / 2 - 6, base - bh), (x + bw / 2, base - bh - rnd.randint(40, 120)), (x + bw / 2 + 6, base - bh)], fill=color)
        if windows:
            for wy in range(base - bh + 16, base, 26):
                for wx in range(x + 10, x + bw - 10, 18):
                    if rnd.random() < 0.18:
                        d.rectangle((wx, wy, wx + 6, wy + 9), fill=(rnd.randint(120, 200), 255, rnd.randint(110, 170)))
        x += bw + rnd.randint(-10, 8)


def portal(img, cx, cy, r, color=GREEN):
    def draw(d):
        for k, w in ((1.0, 10), (0.86, 5), (0.72, 3)):
            d.ellipse((cx - r * k, cy - r * k * 0.36, cx + r * k, cy + r * k * 0.36), outline=color, width=w)
    return add(img, glow_layer(draw, 22, 2.6))


def hooded_figure(img, cx, top, scale, rnd):
    """An original hooded, iron-masked silhouette with glowing eyes and a flowing green cloak."""
    s = scale
    sil = Image.new("L", (W, H)); sdw = ImageDraw.Draw(sil)
    bot = top + 1100 * s
    sdw.polygon([(cx - 400 * s, bot), (cx - 300 * s, top + 520 * s), (cx - 150 * s, top + 360 * s), (cx + 150 * s, top + 360 * s),
                 (cx + 300 * s, top + 520 * s), (cx + 400 * s, bot)], fill=255)
    sdw.ellipse((cx - 175 * s, top, cx + 175 * s, top + 420 * s), fill=255)
    sdw.polygon([(cx - 175 * s, top + 210 * s), (cx - 240 * s, top + 480 * s), (cx + 240 * s, top + 480 * s), (cx + 175 * s, top + 210 * s)], fill=255)
    cloth = radial(W, H, cx - 60 * s, top + 260 * s, (30, 120, 62), (2, 18, 9), 900 * s)
    # vertical folds: alternating light and dark bands
    fold = Image.new("L", (W, H), 0); fd = ImageDraw.Draw(fold)
    for k in range(-5, 6):
        x0 = cx + k * 70 * s
        fd.polygon([(x0, top + 450 * s), (x0 + 30 * s, top + 450 * s), (x0 + k * 22 * s + 50 * s, bot), (x0 + k * 22 * s, bot)], fill=140)
    fold = fold.filter(ImageFilter.GaussianBlur(14 * s))
    cloth = Image.composite(Image.new("RGB", (W, H), (1, 10, 5)), cloth, fold)
    # bottom fades into the dark
    fadem = Image.new("L", (W, H)); fmd = ImageDraw.Draw(fadem)
    for y in range(int(top + 700 * s), int(bot)):
        fmd.line([(0, y), (W, y)], fill=int(255 * (y - (top + 700 * s)) / (bot - (top + 700 * s))))
    cloth = Image.composite(Image.new("RGB", (W, H), (2, 8, 6)), cloth, fadem)
    img.paste(cloth, (0, 0), sil)
    rim = ImageChops.subtract(sil, sil.filter(ImageFilter.MinFilter(9)))
    rim = ImageChops.subtract(rim, fadem)
    rimc = Image.composite(Image.new("RGB", (W, H), (90, 255, 150)), Image.new("RGB", (W, H)), rim)
    img = add(img, ImageChops.add(rimc.filter(ImageFilter.GaussianBlur(10)), rimc))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    # face opening
    d.ellipse((cx - 118 * s, top + 70 * s, cx + 118 * s, top + 400 * s), fill=(3, 8, 6, 255))
    # iron mask plate
    mask = Image.new("L", (W, H)); md = ImageDraw.Draw(mask)
    md.rounded_rectangle((cx - 92 * s, top + 105 * s, cx + 92 * s, top + 385 * s), radius=int(70 * s), fill=255)
    metal = radial(W, H, cx - 30 * s, top + 180 * s, (175, 185, 182), (40, 46, 46), 260 * s).convert("RGBA")
    layer.paste(metal, (0, 0), mask)
    d = ImageDraw.Draw(layer)
    # brow ridge, nose line, mouth grille
    d.line([(cx - 85 * s, top + 190 * s), (cx + 85 * s, top + 190 * s)], fill=(25, 30, 30, 255), width=int(9 * s))
    d.line([(cx, top + 200 * s), (cx, top + 290 * s)], fill=(60, 66, 66, 255), width=int(5 * s))
    for k in range(-3, 4):
        d.line([(cx + k * 16 * s, top + 315 * s), (cx + k * 16 * s, top + 365 * s)], fill=(20, 24, 24, 255), width=int(6 * s))
    # rivets
    for rx, ry in ((-70, 140), (70, 140), (-78, 330), (78, 330)):
        d.ellipse((cx + rx * s - 6 * s, top + ry * s - 6 * s, cx + rx * s + 6 * s, top + ry * s + 6 * s), fill=(90, 96, 96, 255))
    img.paste(layer, (0, 0), layer)
    # glowing eye slits
    def eyes(dd):
        for sx in (-1, 1):
            dd.polygon([(cx + sx * 22 * s, top + 215 * s), (cx + sx * 75 * s, top + 205 * s), (cx + sx * 70 * s, top + 232 * s), (cx + sx * 24 * s, top + 236 * s)], fill=GREEN)
    return add(img, glow_layer(eyes, 26, 3.0))


def sparks(img, rnd, n, color=LIME, area=(0, 0, W, H)):
    def draw(d):
        for _ in range(n):
            x, y = rnd.uniform(area[0], area[2]), rnd.uniform(area[1], area[3]); r = rnd.uniform(1.5, 4.5)
            d.ellipse((x - r, y - r, x + r, y + r), fill=color)
    return add(img, glow_layer(draw, 6, 2.0))


def base(rnd, cy=760, inner=(18, 92, 52), outer=(2, 8, 6)):
    img = radial(W, H, W / 2, cy, inner, outer, 1250)
    layer, m = smoke(W, H, rnd, (30, 140, 80), 0.55)
    img.paste(layer, (0, 0), m)
    stars(img, rnd)
    return img


def vignette(img, k=0.75):
    v = radial(W, H, W / 2, H / 2, (255, 255, 255), (int(255 * (1 - k)),) * 3, 1150)
    return ImageChops.multiply(img, v)

# ---------------------------------------------------------------- scenes

def intro(seed=1):
    rnd = random.Random(seed)
    img = base(rnd, 820)
    img = rays(img, W / 2, 820, 28, GREEN, rnd, 60)
    img = lightning(img, rnd, 4)
    img = portal(img, W / 2, 900, 470)
    skyline(img, rnd, 1720)
    img = sparks(img, rnd, 90)
    return vignette(img, 0.6)


def outro(seed=2):
    rnd = random.Random(seed)
    img = base(rnd, 700, (40, 80, 40), (4, 8, 10))
    def fw(d):
        for _ in range(9):
            cx, cy, R = rnd.uniform(120, W - 120), rnd.uniform(220, 1100), rnd.uniform(120, 230)
            col = rnd.choice([GOLD, GREEN, LIME, (255, 255, 255), (90, 220, 255)])
            for i in range(40):
                a = i / 40 * math.tau
                d.line([(cx + math.cos(a) * R * 0.25, cy + math.sin(a) * R * 0.25), (cx + math.cos(a) * R, cy + math.sin(a) * R)], fill=col, width=3)
                d.ellipse((cx + math.cos(a) * R - 4, cy + math.sin(a) * R - 4, cx + math.cos(a) * R + 4, cy + math.sin(a) * R + 4), fill=col)
    img = add(img, glow_layer(fw, 10, 2.0))
    img = rays(img, W / 2, 1900, 22, GOLD, rnd, 45)
    skyline(img, rnd, 1680)
    img = sparks(img, rnd, 140, GOLD)
    return vignette(img, 0.55)


def q_figure(seed=11):
    rnd = random.Random(seed)
    img = base(rnd, 700)
    img = lightning(img, rnd, 3)
    img = hooded_figure(img, W / 2, 360, 1.15, rnd)
    return vignette(sparks(img, rnd, 60), 0.6)


def q_stage(seed=12):
    rnd = random.Random(seed)
    img = base(rnd, 500, (30, 50, 70), (4, 6, 12))
    def beams(d):
        for x0, x1 in ((120, 380), (540, 540), (960, 700)):
            d.polygon([(x0 - 14, 0), (x0 + 14, 0), (x1 + 200, 1380), (x1 - 200, 1380)], fill=(28, 70, 52))
    img = add(img, glow_layer(beams, 50, 0.9))
    # stage edge and the light spilling off it
    img = add(img, glow_layer(lambda d: d.rectangle((0, 1380, W, 1396), fill=(40, 255, 120)), 30, 2.0))
    spill = radial(W, H, W / 2, 1420, (40, 120, 80), (0, 0, 0), 700)
    img = add(img, spill)
    d = ImageDraw.Draw(img)
    for row, (y0, sz) in enumerate(((1500, 30), (1600, 38), (1720, 48), (1850, 60))):  # crowd silhouettes
        x = rnd.uniform(-40, 0)
        while x < W + 40:
            y = y0 + rnd.uniform(-12, 12)
            d.ellipse((x - sz, y - sz, x + sz, y + sz), fill=(1, 3, 3))
            d.rounded_rectangle((x - sz * 1.5, y + sz * 0.7, x + sz * 1.5, H), radius=int(sz * 0.6), fill=(1, 3, 3))
            if rnd.random() < 0.28:
                hx = x + rnd.choice([-1, 1]) * sz * 0.9
                d.line([(hx, y + sz), (hx + rnd.uniform(-30, 30), y - sz * 3.2)], fill=(1, 3, 3), width=int(sz * 0.45))
            x += sz * rnd.uniform(1.9, 2.6)
    img = sparks(img, rnd, 80, GOLD, (0, 200, W, 1300))
    return vignette(img, 0.55)


def q_film(seed=13):
    rnd = random.Random(seed)
    img = base(rnd, 900, (20, 70, 60), (3, 6, 8))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for k, (y, ang) in enumerate(((420, -12), (1100, 9), (1650, -6))):  # film strips
        strip = Image.new("RGBA", (1700, 220), (8, 12, 12, 255)); sd = ImageDraw.Draw(strip)
        for x in range(10, 1700, 60):
            sd.rectangle((x, 14, x + 34, 40), fill=(200, 255, 220, 255)); sd.rectangle((x, 180, x + 34, 206), fill=(200, 255, 220, 255))
        for x in range(30, 1700, 240):
            sd.rectangle((x, 58, x + 200, 162), fill=(20, 90 + 30 * k, 60, 255))
        strip = strip.rotate(ang, expand=True, resample=Image.BICUBIC)
        layer.alpha_composite(strip, (W // 2 - strip.width // 2, y - strip.height // 2))
    img = img.convert("RGBA"); img.alpha_composite(layer); img = img.convert("RGB")
    img = portal(img, W / 2, 1000, 380, LIME)
    return vignette(sparks(img, rnd, 70), 0.6)


def q_director(seed=14):
    rnd = random.Random(seed)
    img = base(rnd, 800, (25, 75, 45), (3, 7, 6))
    img = rays(img, W / 2, 0, 16, GREEN, rnd, 40)
    d = ImageDraw.Draw(img)
    c = (6, 12, 10); cx, by = W / 2, 1560
    # director's chair
    d.rectangle((cx - 230, by - 620, cx + 230, by - 470), fill=(10, 60, 34))  # backrest canvas
    d.rectangle((cx - 230, by - 300, cx + 230, by - 250), fill=(10, 60, 34))  # seat
    for sx in (-1, 1):
        d.line([(cx + sx * 240, by - 640), (cx + sx * 240, by - 250)], fill=c, width=26)
        d.line([(cx + sx * 240, by - 250), (cx - sx * 240, by)], fill=c, width=26)
        d.line([(cx + sx * 260, by - 420), (cx + sx * 160, by - 420)], fill=c, width=22)
    # clapperboard
    cb = Image.new("RGBA", (420, 330), (0, 0, 0, 0)); cd = ImageDraw.Draw(cb)
    cd.rectangle((0, 90, 420, 330), fill=(10, 14, 14, 255))
    cd.rectangle((0, 20, 420, 88), fill=(230, 240, 235, 255))
    for x in range(-40, 440, 70):
        cd.polygon([(x, 20), (x + 35, 20), (x + 5, 88), (x - 30, 88)], fill=(10, 14, 14, 255))
    for y in (150, 210, 270):
        cd.line([(20, y), (400, y)], fill=(80, 200, 130, 255), width=3)
    cb = cb.rotate(-14, expand=True, resample=Image.BICUBIC)
    img = img.convert("RGBA"); img.alpha_composite(cb, (90, 360)); img = img.convert("RGB")
    return vignette(sparks(img, rnd, 60), 0.6)


def q_script(seed=15):
    rnd = random.Random(seed)
    img = base(rnd, 900, (22, 80, 50), (3, 7, 6))
    img = img.convert("RGBA")
    for _ in range(11):  # floating script pages
        pw, ph = rnd.randint(260, 360), rnd.randint(340, 460)
        pg = Image.new("RGBA", (pw, ph), (225, 240, 230, 235)); pd = ImageDraw.Draw(pg)
        for y in range(40, ph - 30, 26):
            pd.line([(28, y), (pw - rnd.randint(30, 110), y)], fill=(60, 90, 75, 255), width=5)
        pg = pg.rotate(rnd.uniform(-35, 35), expand=True, resample=Image.BICUBIC)
        img.alpha_composite(pg, (rnd.randint(-100, W - 150), rnd.choice([rnd.randint(60, 520), rnd.randint(1250, 1750)])))
    img = img.convert("RGB")
    def quill(d):
        d.line([(300, 1250), (820, 560)], fill=GREEN, width=10)
        d.polygon([(820, 560), (760, 720), (700, 690)], fill=LIME)
    img = add(img, glow_layer(quill, 20, 2.0))
    return vignette(sparks(img, rnd, 70), 0.6)

# ---------------------------------------------------------------- thumbnail

def text(img, xy, s, size, fill, stroke=10, anchor="mm", stroke_fill=(0, 0, 0), shadow=True):
    d = ImageDraw.Draw(img)
    if shadow:
        d.text((xy[0] + 8, xy[1] + 10), s, font=f(size), fill=(0, 0, 0), anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0))
    d.text(xy, s, font=f(size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill)


def fit(s, size, maxw):
    while f(size).getlength(s) > maxw and size > 20:
        size -= 2
    return size


def round_logo(size):
    lg = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size, size)); ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(lg, (0, 0), m)
    ring = ImageDraw.Draw(out); ring.ellipse((2, 2, size - 3, size - 3), outline=(255, 255, 255, 255), width=max(4, size // 40))
    return out


def thumbnail(seed=7):
    rnd = random.Random(seed)
    img = base(rnd, 760)
    img = rays(img, W / 2, 700, 30, GREEN, rnd, 70)
    img = lightning(img, rnd, 5, area=(0, 0, W, 700))
    img = portal(img, W / 2, 900, 500)
    img = hooded_figure(img, W / 2, 400, 0.78, rnd)
    img = vignette(sparks(img, rnd, 90), 0.5)
    # darken the lower part a little so the card reads
    shade = Image.new("L", (W, H)); sd = ImageDraw.Draw(shade)
    for y in range(820, H):
        sd.line([(0, y), (W, y)], fill=int(min(190, (y - 820) * 0.4)))
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), shade)

    # top: channel logo + name, tag pill
    lg = round_logo(210)
    im = img.convert("RGBA"); im.alpha_composite(lg, (40, 46)); img = im.convert("RGB")
    text(img, (272, 118), "CHAOS CREATORS", fit("CHAOS CREATORS", 64, 760), (255, 255, 255), 8, "lm")
    d = ImageDraw.Draw(img)
    pill = "MARVEL TRIVIA • 5 QUESTIONS"; ps = 40; pw = f(ps).getlength(pill) + 60
    d.rounded_rectangle((272, 168, 272 + pw, 234), radius=33, fill=(40, 255, 120), outline=(0, 0, 0), width=5)
    d.text((272 + pw / 2, 201), pill, font=f(ps), fill=(0, 0, 0), anchor="mm")

    # title block (search keyword biggest)
    text(img, (W / 2, 870), "AVENGERS", fit("AVENGERS", 190, 1000), (255, 255, 255), 14)
    text(img, (W / 2, 1035), "DOOMSDAY", fit("DOOMSDAY", 200, 1010), (60, 255, 130), 14)
    text(img, (W / 2, 1185), "QUIZ", 140, GOLD, 14)

    # question card (answer not marked)
    q = "Who plays Doctor Doom?"
    opts = ["A) Chris Evans", "B) Robert Downey Jr.", "C) Pedro Pascal", "D) Tom Hiddleston"]
    cx0, cy0, cw = 70, 1265, W - 140
    card = Image.new("RGBA", (cw, 400), (0, 0, 0, 0)); cd = ImageDraw.Draw(card)
    cd.rounded_rectangle((0, 0, cw - 1, 399), radius=34, fill=(8, 20, 14, 230), outline=(40, 255, 120, 255), width=6)
    cd.text((cw / 2, 58), q, font=f(fit(q, 56, cw - 60)), fill=(255, 255, 255), anchor="mm")
    for i, o in enumerate(opts):
        x = 30 + (i % 2) * (cw - 60) / 2; y = 120 + (i // 2) * 130
        bw = (cw - 60) / 2 - 16
        cd.rounded_rectangle((x, y, x + bw, y + 110), radius=24, fill=(28, 60, 42, 255), outline=(170, 255, 200, 255), width=3)
        cd.text((x + bw / 2, y + 55), o, font=f(fit(o, 40, bw - 30)), fill=(255, 255, 255), anchor="mm")
    im = img.convert("RGBA"); im.alpha_composite(card, (cx0, cy0)); img = im.convert("RGB")
    # hook just above the Shorts title area
    d = ImageDraw.Draw(img)
    hook = "ONLY TRUE FANS SCORE 5/5!"; hs = fit(hook, 58, 900); hw = f(hs).getlength(hook) + 70
    d.rounded_rectangle((W / 2 - hw / 2, 290, W / 2 + hw / 2, 380), radius=45, fill=GOLD, outline=(0, 0, 0), width=6)
    d.text((W / 2, 335), hook, font=f(hs), fill=(0, 0, 0), anchor="mm")
    return img


if __name__ == "__main__":
    which = sys.argv[2:] or ["thumbnail", "intro", "outro", "q1", "q2", "q3", "q4", "q5"]
    scenes = dict(thumbnail=thumbnail, intro=intro, outro=outro, q1=q_figure, q2=q_stage, q3=q_film, q4=q_director, q5=q_script)
    for name in which:
        im = scenes[name]()
        im.save(OUT / f"{name}-p1.png")
        print("saved", name)
