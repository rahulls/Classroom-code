"""Original artwork for the "Human Body Facts" facts Short (Canva was out of credits).
Writes into <out_dir>, named like Canva's exports so the engine uses them:
  intro-p1.png, outro-p1.png, q1..q7-p1.png (backgrounds, 1080x1920),
  s1..s7-p1.png (cartoon stickers, square), thumbnail-p1.png (1080x1920 full design).
Everything is drawn from scratch: no photos, logos or real people.
Run:  python human_body_facts_art.py <out_dir> [names...]"""
import math, random, sys, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parent.parent / "quiz-template" / "quiz-template"
FONT = str(ROOT / "fonts" / "Poppins-Bold.ttf")
LOGO = ROOT / "assets" / "logo.png"
INK = (34, 22, 58)
GOLD, PINK, WHITE = (255, 196, 40), (255, 92, 141), (255, 255, 255)
f = lambda s: ImageFont.truetype(FONT, int(s))


# ------------------------------ helpers ------------------------------
def gradient(w, h, top, bottom, mid=None):
    y = np.linspace(0, 1, h)[:, None, None]
    a, b = np.array(top, np.float32), np.array(bottom, np.float32)
    if mid is not None:
        m = np.array(mid, np.float32)
        g = np.where(y < 0.5, a * (1 - y * 2) + m * (y * 2), m * (1 - (y - 0.5) * 2) + b * ((y - 0.5) * 2))
    else:
        g = a * (1 - y) + b * y
    return Image.fromarray(np.broadcast_to(g, (h, w, 3)).astype(np.uint8), "RGB")


def glow(img, draw_fn, blur, strength=1.0):
    """Draw on a black layer, blur it and add it as light (plus the sharp drawing on top)."""
    layer = Image.new("RGB", img.size, (0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    soft = layer.filter(ImageFilter.GaussianBlur(blur))
    out = np.asarray(img, np.float32) + np.asarray(soft, np.float32) * strength + np.asarray(layer, np.float32) * 0.8
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def bokeh(img, rnd, n, colors, rmin=8, rmax=60, alpha=(30, 90)):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        x, y, r = rnd.randrange(img.width), rnd.randrange(img.height), rnd.randint(rmin, rmax)
        d.ellipse((x - r, y - r, x + r, y + r), fill=rnd.choice(colors) + (rnd.randint(*alpha),))
    layer = layer.filter(ImageFilter.GaussianBlur(3))
    im = img.convert("RGBA"); im.alpha_composite(layer); return im.convert("RGB")


def calm_middle(img, k=0.45):
    """Darken the middle band where the fact card sits, keep the edges bright."""
    y = np.linspace(-1, 1, img.height)[:, None]
    x = np.linspace(-1, 1, img.width)[None, :]
    m = np.clip(1 - (x ** 2 * 0.6 + y ** 2 * 1.4), 0, 1) * k
    a = np.asarray(img, np.float32) * (1 - m[..., None]) + np.array((14, 8, 34), np.float32) * m[..., None]
    return Image.fromarray(a.astype(np.uint8))


def vignette(img, k=0.6):
    y = np.linspace(-1, 1, img.height)[:, None]
    x = np.linspace(-1, 1, img.width)[None, :]
    m = np.clip((x ** 2 + y ** 2) / 2, 0, 1) * k
    return Image.fromarray((np.asarray(img, np.float32) * (1 - m[..., None])).astype(np.uint8))


def helix(d, cx, top, bottom, amp, phase, c1, c2, width=10, rungs=True):
    pts1, pts2 = [], []
    for y in range(int(top), int(bottom), 6):
        t = (y - top) / 90 + phase
        pts1.append((cx + math.sin(t) * amp, y)); pts2.append((cx - math.sin(t) * amp, y))
    if rungs:
        for i in range(0, len(pts1), 7):
            d.line([pts1[i], pts2[i]], fill=(200, 200, 255), width=width // 2)
    d.line(pts1, fill=c1, width=width, joint="curve"); d.line(pts2, fill=c2, width=width, joint="curve")


def ecg(d, y, x0, x1, color, width=10, scale=1.0):
    pts, x = [], x0
    while x < x1:
        pts += [(x, y), (x + 60 * scale, y), (x + 80 * scale, y - 40 * scale), (x + 100 * scale, y + 30 * scale),
                (x + 120 * scale, y - 140 * scale), (x + 145 * scale, y + 90 * scale), (x + 165 * scale, y), (x + 260 * scale, y)]
        x += 260 * scale
    d.line(pts, fill=color, width=width, joint="curve")


# ------------------------------ stickers (cartoon, thick outlines) ------------------------------
S = 2000  # drawn at 2x, saved at 1000x1000


def sticker_canvas(bg):
    im = Image.new("RGB", (S, S), bg)
    rad = Image.new("L", (S, S), 0)
    ImageDraw.Draw(rad).ellipse((200, 200, S - 200, S - 200), fill=255)
    light = Image.new("RGB", (S, S), tuple(min(255, c + 22) for c in bg))
    im.paste(light, (0, 0), rad.filter(ImageFilter.GaussianBlur(220)))
    return im


def shape(img, mask, fill, ink=INK, ow=26, shine=None):
    """A filled shape with a uniform cartoon outline (the mask grown by ow) and an optional highlight."""
    grown = mask.filter(ImageFilter.GaussianBlur(ow * 0.55)).point(lambda v: 255 if v > 18 else 0)
    img.paste(ink, (0, 0), grown)
    img.paste(fill, (0, 0), mask)
    if shine:
        hl = Image.new("L", img.size, 0)
        ImageDraw.Draw(hl).ellipse(shine, fill=110)
        hl = Image.fromarray(np.minimum(np.asarray(hl), np.asarray(mask)))
        img.paste(WHITE, (0, 0), hl.filter(ImageFilter.GaussianBlur(18)))


class _Solid:
    """ImageDraw for masks: every shape is filled white unless told otherwise."""
    def __init__(self, d):
        self.d = d

    def __getattr__(self, name):
        fn = getattr(self.d, name)
        return lambda *a, **k: fn(*a, **{"fill": 255, **k})


def mask_of(fn):
    m = Image.new("L", (S, S), 0); fn(_Solid(ImageDraw.Draw(m))); return m


def save_sticker(img, name):
    img.resize((1000, 1000), Image.LANCZOS).save(OUT / f"{name}-p1.png")


def sparkle(d, cx, cy, r, color=GOLD):
    d.polygon([(cx, cy - r), (cx + r * 0.22, cy - r * 0.22), (cx + r, cy), (cx + r * 0.22, cy + r * 0.22),
               (cx, cy + r), (cx - r * 0.22, cy + r * 0.22), (cx - r, cy), (cx - r * 0.22, cy - r * 0.22)], fill=color, outline=INK, width=10)


def heart_poly(cx, cy, s):
    pts = []
    for k in range(200):
        t = k / 200 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * s, cy - y * s))
    return pts


def s_spine():
    img = sticker_canvas((255, 236, 200))
    d = ImageDraw.Draw(img)
    # sun
    shape(img, mask_of(lambda m: m.ellipse((150, 150, 520, 520))), (255, 190, 40), shine=(200, 190, 360, 330))
    for k in range(10):
        a = k / 10 * 2 * math.pi
        d.line([(335 + math.cos(a) * 230, 335 + math.sin(a) * 230), (335 + math.cos(a) * 300, 335 + math.sin(a) * 300)], fill=(255, 170, 30), width=26)
    # ruler
    shape(img, mask_of(lambda m: m.rounded_rectangle((1380, 300, 1640, 1800), 30)), (255, 214, 70))
    for i, y in enumerate(range(360, 1760, 70)):
        d.line([(1380, y), (1380 + (120 if i % 2 == 0 else 70), y)], fill=INK, width=12)
    # vertebrae with blue discs
    y = 520
    for i in range(7):
        h = 150
        if i:
            shape(img, mask_of(lambda m, y=y: m.rounded_rectangle((760, y - 46, 1160, y - 4), 20)), (90, 180, 255), ow=18)
        shape(img, mask_of(lambda m, y=y: (m.rounded_rectangle((700, y, 1220, y + h), 60), m.polygon([(1200, y + 30), (1330, y + 75), (1200, y + 120)]))),
              (255, 246, 230), shine=(740, y + 15, 1000, y + 70))
        y += h + 50
    # up arrow
    shape(img, mask_of(lambda m: m.polygon([(420, 900), (620, 650), (820, 900), (700, 900), (700, 1500), (540, 1500), (540, 900)])), (60, 210, 110))
    sparkle(d, 500, 1650, 70); sparkle(d, 1250, 260, 55, WHITE)
    save_sticker(img, "s1")


def s_heart():
    img = sticker_canvas((255, 228, 232))
    d = ImageDraw.Draw(img)
    shape(img, mask_of(lambda m: m.rounded_rectangle((860, 220, 1010, 700), 70)), (80, 140, 255))
    shape(img, mask_of(lambda m: m.rounded_rectangle((1060, 260, 1210, 700), 70)), (240, 60, 70))
    shape(img, mask_of(lambda m: m.polygon(heart_poly(1000, 1060, 46))), (235, 40, 70), shine=(520, 640, 860, 900))
    d.arc((700, 800, 1150, 1400), 200, 300, fill=(150, 15, 45), width=22)
    # heartbeat line
    layer = Image.new("RGBA", (S, S)); ld = ImageDraw.Draw(layer)
    ecg(ld, 1720, 80, 1950, INK + (255,), 52, 1.4); ecg(ld, 1720, 80, 1950, (60, 220, 120, 255), 26, 1.4)
    img.paste(layer, (0, 0), layer)
    sparkle(d, 330, 380, 80); sparkle(d, 1680, 470, 60, WHITE)
    save_sticker(img, "s2")


def s_ear():
    img = sticker_canvas((214, 240, 255))
    d = ImageDraw.Draw(img)
    def ear(m):
        m.ellipse((330, 260, 1130, 1500), fill=255)
        m.ellipse((560, 1250, 900, 1640), fill=255)
    shape(img, mask_of(ear), (255, 196, 160), shine=(420, 330, 760, 700))
    d.arc((470, 420, 1000, 1250), 250, 100, fill=(205, 120, 100), width=40)
    d.arc((600, 640, 880, 1050), 260, 80, fill=(205, 120, 100), width=30)
    # magnifier with the tiny stirrup bone
    shape(img, mask_of(lambda m: m.ellipse((1080, 780, 1720, 1420))), (245, 252, 255))
    d.ellipse((1080, 780, 1720, 1420), outline=(70, 110, 160), width=34)
    shape(img, mask_of(lambda m: m.polygon([(1640, 1360), (1880, 1600), (1800, 1680), (1560, 1440)])), (110, 70, 50), ow=18)
    stir = mask_of(lambda m: (m.rounded_rectangle((1250, 1170, 1560, 1230), 24), m.line([(1290, 1180), (1370, 950), (1440, 950), (1520, 1180)], fill=255, width=46),
                              m.ellipse((1335, 900, 1475, 1000))))
    shape(img, stir, (255, 250, 236), ow=18)
    # grain of rice for size
    shape(img, mask_of(lambda m: m.ellipse((1300, 1290, 1520, 1370))), (255, 255, 250), ow=16)
    for (x, y, r) in ((260, 300, 70), (1750, 400, 55), (1650, 1800, 60)):
        for k in range(3):
            d.arc((x - r - k * 50, y - r - k * 50, x + r + k * 50, y + r + k * 50), 300, 60, fill=(70, 150, 230), width=16)
    save_sticker(img, "s3")


def bone_mask(m, cx, cy, length, thick, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    hx, hy = ca * length / 2, sa * length / 2
    px, py = -sa * thick / 2, ca * thick / 2
    m.polygon([(cx - hx + px, cy - hy + py), (cx + hx + px, cy + hy + py), (cx + hx - px, cy + hy - py), (cx - hx - px, cy - hy - py)], fill=255)
    for ex, ey in ((cx - hx, cy - hy), (cx + hx, cy + hy)):
        for s in (1, -1):
            r = thick * 0.62
            m.ellipse((ex + px * s * 0.9 - r, ey + py * s * 0.9 - r, ex + px * s * 0.9 + r, ey + py * s * 0.9 + r), fill=255)


def s_bones():
    img = sticker_canvas((232, 222, 255))
    d = ImageDraw.Draw(img)
    rnd = random.Random(4)
    for _ in range(9):
        x, y = rnd.randint(250, 1750), rnd.randint(250, 1750)
        if 650 < x < 1350 and 650 < y < 1350:
            continue
        shape(img, mask_of(lambda m, x=x, y=y: bone_mask(m, x, y, 260, 70, rnd.uniform(0, 3.14))), (255, 250, 238), ow=16)
    shape(img, mask_of(lambda m: bone_mask(m, 1000, 1000, 1000, 240, -0.6)), (255, 250, 238), shine=(640, 900, 1000, 1080))
    # baby rattle
    shape(img, mask_of(lambda m: m.rounded_rectangle((1350, 1350, 1440, 1800), 40)), (120, 200, 255))
    shape(img, mask_of(lambda m: m.ellipse((1220, 1050, 1570, 1400))), (255, 120, 170), shine=(1260, 1090, 1420, 1210))
    for k in range(4):
        d.ellipse((1300 + k * 60, 1200, 1340 + k * 60, 1240), fill=WHITE)
    sparkle(d, 350, 330, 80); sparkle(d, 1700, 330, 60, (120, 200, 255))
    save_sticker(img, "s4")


def s_brain():
    img = sticker_canvas((225, 245, 255))
    d = ImageDraw.Draw(img)
    def brain(m):
        for (x, y, r) in ((700, 780, 330), (1060, 640, 360), (1360, 820, 320), (820, 1120, 330), (1250, 1120, 340), (1000, 950, 380)):
            m.ellipse((x - r, y - r, x + r, y + r), fill=255)
    shape(img, mask_of(brain), (255, 150, 185), shine=(560, 420, 980, 720))
    d.line([(1000, 330), (990, 600), (1010, 900), (990, 1300)], fill=(200, 70, 120), width=26, joint="curve")
    rnd = random.Random(3)
    for (x, y) in ((680, 800), (760, 1100), (1250, 760), (1300, 1110), (1060, 620), (880, 560), (1160, 1000)):
        a0 = rnd.randint(0, 360)
        d.arc((x - 150, y - 110, x + 150, y + 110), a0, a0 + 160, fill=(200, 70, 120), width=24)
    # spinal stem
    shape(img, mask_of(lambda m: m.rounded_rectangle((900, 1350, 1060, 1720), 60)), (255, 170, 195))
    # energy bolt
    shape(img, mask_of(lambda m: m.polygon([(1560, 1080), (1330, 1500), (1500, 1500), (1400, 1880), (1760, 1380), (1580, 1380), (1720, 1080)])), (255, 210, 40))
    sparkle(d, 330, 330, 80); sparkle(d, 1720, 330, 70, WHITE); sparkle(d, 400, 1600, 60)
    save_sticker(img, "s5")


def s_skin():
    img = sticker_canvas((255, 236, 222))
    d = ImageDraw.Draw(img)
    def wave_poly(top, bottom, amp, phase):
        pts = [(260 + k * 15, top + math.sin(k / 12 + phase) * amp) for k in range(0, 101)]
        return pts + [(1760, bottom), (260, bottom)]
    shape(img, mask_of(lambda m: m.rounded_rectangle((260, 600, 1760, 1650), 80)), (255, 226, 120))
    shape(img, mask_of(lambda m: m.polygon(wave_poly(860, 1300, 30, 1.0))), (255, 150, 150), ow=0)
    shape(img, mask_of(lambda m: m.polygon(wave_poly(620, 900, 40, 0.0))), (250, 190, 150), ow=0)
    d.rounded_rectangle((260, 600, 1760, 1650), 80, outline=INK, width=26)
    for k in range(3):
        y = (620, 880, 1290)[k]
        d.line([(260 + i * 15, y + math.sin(i / 12 + (0.0, 1.0, 2.0)[k]) * (40, 30, 20)[k]) for i in range(101)], fill=INK, width=14)
    for x in range(420, 1700, 210):
        d.line([(x, 640), (x + 30, 380)], fill=(90, 50, 30), width=18)
        d.ellipse((x - 30, 720, x + 30, 800), fill=(200, 110, 90))
    for x in range(360, 1700, 160):
        d.ellipse((x, 1400, x + 70, 1470), fill=(255, 245, 190), outline=INK, width=8)
    # little weight
    shape(img, mask_of(lambda m: (m.polygon([(1460, 1620), (1880, 1620), (1820, 1900), (1520, 1900)]), m.ellipse((1590, 1500, 1750, 1660)))), (90, 90, 120))
    d.ellipse((1630, 1540, 1710, 1620), fill=(255, 236, 222))
    sparkle(d, 330, 330, 80); sparkle(d, 1700, 330, 60, WHITE)
    save_sticker(img, "s6")


def s_stomach():
    img = sticker_canvas((220, 250, 230))
    d = ImageDraw.Draw(img)
    def stomach(m):
        pts = []
        for k in range(60):                              # a J-shaped bean
            t = k / 59
            x = 900 + 380 * math.cos(math.pi * (0.15 + 1.25 * t)) + 200 * t
            y = 820 + 520 * math.sin(math.pi * (0.15 + 1.25 * t)) * 0.9 + 260 * t
            pts.append((x, y))
        for i, (x, y) in enumerate(pts):
            r = 150 + 170 * math.sin(math.pi * i / 59)
            m.ellipse((x - r, y - r, x + r, y + r), fill=255)
        m.rounded_rectangle((1150, 300, 1290, 760), 60, fill=255)
        m.rounded_rectangle((1250, 1250, 1640, 1380), 60, fill=255)
    shape(img, mask_of(stomach), (255, 140, 160), shine=(620, 640, 1000, 900))
    for (x, y, r) in ((880, 1000, 60), (1040, 1150, 45), (760, 1220, 38), (1150, 980, 30), (950, 1320, 52)):
        d.ellipse((x - r, y - r, x + r, y + r), fill=(200, 255, 140), outline=INK, width=10)
    sparkle(d, 380, 380, 90); sparkle(d, 1650, 650, 70, WHITE); sparkle(d, 1600, 1650, 80); sparkle(d, 420, 1600, 60, WHITE)
    save_sticker(img, "s7")


# ------------------------------ backgrounds (1080x1920) ------------------------------
def bg_morning():
    rnd = random.Random(11)
    img = gradient(W, H, (255, 150, 90), (60, 30, 120), mid=(220, 90, 140))
    img = glow(img, lambda d: d.ellipse((W / 2 - 170, 120, W / 2 + 170, 460), fill=(255, 220, 120)), 80, 0.9)
    d = ImageDraw.Draw(img, "RGBA")
    for (x, y, s) in ((160, 600, 1.0), (880, 520, 0.8), (300, 1600, 1.2), (850, 1750, 0.9)):
        for dx, dy, r in ((0, 0, 90), (90, -30, 110), (190, 0, 85)):
            d.ellipse((x + dx * s - r * s, y + dy * s - r * s, x + dx * s + r * s, y + dy * s + r * s), fill=(255, 235, 245, 110))
    for i, y in enumerate(range(200, H - 100, 60)):
        d.line([(0, y), (70 if i % 2 == 0 else 40, y)], fill=(255, 255, 255, 150), width=6)
        d.line([(W, y), (W - (70 if i % 2 == 0 else 40), y)], fill=(255, 255, 255, 150), width=6)
    img = bokeh(img, rnd, 40, [(255, 230, 180), (255, 180, 220)])
    return vignette(calm_middle(img, 0.4), 0.4)


def bg_heart():
    rnd = random.Random(12)
    img = gradient(W, H, (120, 10, 40), (40, 6, 30), mid=(180, 20, 60))
    img = glow(img, lambda d: (ecg(d, 330, -40, W + 40, (255, 120, 150), 10, 1.2), ecg(d, 1640, -40, W + 40, (255, 120, 150), 10, 1.2)), 22, 1.0)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(26):
        x, y, s = rnd.randrange(W), rnd.randrange(H), rnd.uniform(1.5, 4.5)
        if 250 < y < 1500 and 150 < x < 930:
            continue
        d.polygon(heart_poly(x, y, s), fill=(255, 110, 140, rnd.randint(60, 150)))
    img = img.convert("RGBA"); img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1)))
    return vignette(calm_middle(img.convert("RGB"), 0.35), 0.5)


def bg_ear():
    rnd = random.Random(13)
    img = gradient(W, H, (10, 120, 160), (10, 30, 80), mid=(20, 80, 140))
    def waves(d):
        for side in (-1, 1):
            cx = W / 2 + side * 760
            for k in range(9):
                r = 260 + k * 90
                d.arc((cx - r, H / 2 - r, cx + r, H / 2 + r), 0 if side < 0 else 180, 360 if side > 0 else 180, fill=(120, 230, 255), width=6)
    img = glow(img, waves, 14, 0.7)
    img = bokeh(img, rnd, 50, [(150, 240, 255), (255, 255, 255)], 4, 30)
    return vignette(calm_middle(img, 0.4), 0.45)


def bg_bones():
    rnd = random.Random(14)
    img = gradient(W, H, (150, 120, 255), (60, 40, 140), mid=(230, 140, 220))
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(40):
        x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.randint(10, 30)
        d.polygon([(x, y - r), (x + r * 0.3, y - r * 0.3), (x + r, y), (x + r * 0.3, y + r * 0.3), (x, y + r), (x - r * 0.3, y + r * 0.3), (x - r, y), (x - r * 0.3, y - r * 0.3)], fill=(255, 255, 255, 140))
    img = bokeh(img, rnd, 45, [(255, 220, 250), (200, 230, 255)], 20, 80, (20, 60))
    return vignette(calm_middle(img, 0.45), 0.4)


def bg_brain():
    rnd = random.Random(15)
    img = gradient(W, H, (40, 10, 90), (10, 6, 40), mid=(70, 20, 130))
    nodes = [(rnd.randrange(W), rnd.randrange(H)) for _ in range(70)]
    nodes = [(x, y) for x, y in nodes if not (200 < x < 880 and 400 < y < 1500)]
    def net(d):
        for i, a in enumerate(nodes):
            for b in nodes[i + 1:]:
                if math.dist(a, b) < 260:
                    d.line([a, b], fill=(140, 90, 255), width=3)
        for x, y in nodes:
            d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(255, 140, 220))
    img = glow(img, net, 10, 1.1)
    return vignette(calm_middle(img, 0.3), 0.5)


def bg_skin():
    rnd = random.Random(16)
    img = gradient(W, H, (255, 170, 120), (140, 50, 70), mid=(240, 120, 110))
    d = ImageDraw.Draw(img, "RGBA")
    R = 70
    for row in range(-1, int(H / (R * 1.5)) + 2):
        for col in range(-1, int(W / (R * 1.73)) + 2):
            cx = col * R * 1.73 + (R * 0.87 if row % 2 else 0)
            cy = row * R * 1.5
            pts = [(cx + R * 0.95 * math.cos(math.pi / 3 * k + math.pi / 6), cy + R * 0.95 * math.sin(math.pi / 3 * k + math.pi / 6)) for k in range(6)]
            d.polygon(pts, outline=(255, 230, 210, 90), width=4)
            if rnd.random() < 0.15:
                d.ellipse((cx - 14, cy - 14, cx + 14, cy + 14), fill=(255, 240, 220, 120))
    return vignette(calm_middle(img, 0.5), 0.45)


def bg_stomach():
    rnd = random.Random(17)
    img = gradient(W, H, (20, 140, 110), (10, 40, 50), mid=(30, 100, 90))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(90):
        x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.randint(6, 46)
        if 180 < x < 900 and 450 < y < 1450 and r > 14:
            continue
        d.ellipse((x - r, y - r, x + r, y + r), outline=(190, 255, 170, 170), width=max(3, r // 6))
        d.ellipse((x - r * 0.5, y - r * 0.6, x - r * 0.1, y - r * 0.2), fill=(255, 255, 255, 140))
    img = img.convert("RGBA"); img.alpha_composite(layer)
    return vignette(calm_middle(img.convert("RGB"), 0.35), 0.45)


def bg_intro(seed=1):
    rnd = random.Random(seed)
    img = gradient(W, H, (50, 20, 120), (12, 6, 40), mid=(90, 30, 150))
    img = glow(img, lambda d: (helix(d, 120, -50, H + 50, 90, 0.0, (255, 92, 141), (90, 200, 255)),
                               helix(d, W - 120, -50, H + 50, 90, 1.5, (255, 196, 40), (120, 255, 170))), 16, 0.9)
    img = bokeh(img, rnd, 60, [(255, 120, 200), (120, 200, 255), (255, 220, 120)], 6, 40)
    return vignette(calm_middle(img, 0.5), 0.5)


def bg_outro():
    rnd = random.Random(2)
    img = bg_intro(5)
    d = ImageDraw.Draw(img, "RGBA")
    for k in range(24):
        a = k / 24 * 2 * math.pi
        d.polygon([(W / 2, H / 2), (W / 2 + math.cos(a) * 2200, H / 2 + math.sin(a) * 2200), (W / 2 + math.cos(a + 0.09) * 2200, H / 2 + math.sin(a + 0.09) * 2200)], fill=(255, 255, 255, 14))
    for _ in range(160):
        x, y, s = rnd.randrange(W), rnd.randrange(H), rnd.randint(8, 18)
        d.rectangle((x, y, x + s, y + s * 0.5), fill=rnd.choice([(255, 196, 40), (255, 92, 141), (90, 200, 255), (120, 255, 170)]) + (200,))
    return vignette(img, 0.4)


# ------------------------------ thumbnail ------------------------------
def text(img, xy, s, size, fill, stroke=10, anchor="mm"):
    d = ImageDraw.Draw(img)
    d.text((xy[0] + 8, xy[1] + 10), s, font=f(size), fill=(0, 0, 0), anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0))
    d.text(xy, s, font=f(size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=INK)


def fit(s, size, maxw):
    while f(size).getlength(s) > maxw and size > 20:
        size -= 2
    return size


def round_logo(size):
    lg = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size, size)); ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(lg, (0, 0), m)
    ImageDraw.Draw(out).ellipse((2, 2, size - 3, size - 3), outline=(255, 255, 255, 255), width=max(4, size // 40))
    return out


def framed(path, size, tilt):
    src = Image.open(path).convert("RGB").resize((size - 30, size - 30), Image.LANCZOS)
    card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = Image.new("L", (size, size)); ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), size // 8, fill=255)
    card.paste((255, 255, 255, 255), (0, 0), m)
    mi = Image.new("L", src.size); ImageDraw.Draw(mi).rounded_rectangle((0, 0, src.width - 1, src.height - 1), size // 10, fill=255)
    card.paste(src, (15, 15), mi)
    return card.rotate(tilt, resample=Image.BICUBIC, expand=True)


def thumbnail():
    img = bg_intro(9)
    img = glow(img, lambda d: d.ellipse((W / 2 - 420, 820, W / 2 + 420, 1640), fill=(120, 60, 200)), 160, 0.8)
    im = img.convert("RGBA")
    for path, size, tilt, x, y in ((OUT / "s5-p1.png", 470, 8, 560, 820), (OUT / "s2-p1.png", 500, -7, 70, 900)):
        c = framed(path, size, tilt); im.alpha_composite(c, (x, y))
    im.alpha_composite(round_logo(190), (40, 46))
    img = im.convert("RGB")
    text(img, (262, 110), "CHAOS CREATORS", fit("CHAOS CREATORS", 62, 760), WHITE, 8, "lm")
    d = ImageDraw.Draw(img)
    pill = "DID YOU KNOW?"; ps = 46; pw = f(ps).getlength(pill) + 70
    d.rounded_rectangle((262, 160, 262 + pw, 232), radius=36, fill=PINK, outline=INK, width=6)
    d.text((262 + pw / 2, 196), pill, font=f(ps), fill=WHITE, anchor="mm")
    text(img, (W / 2, 400), "HUMAN BODY", fit("HUMAN BODY", 190, 1000), WHITE, 14)
    text(img, (W / 2, 590), "FACTS", 220, GOLD, 16)
    hook = "YOU WON'T BELIEVE #4!"; hs = fit(hook, 64, 920); hw = f(hs).getlength(hook) + 80
    d.rounded_rectangle((W / 2 - hw / 2, 1420, W / 2 + hw / 2, 1520), radius=50, fill=WHITE, outline=INK, width=7)
    d.text((W / 2, 1470), hook, font=f(hs), fill=INK, anchor="mm")
    return img


if __name__ == "__main__":
    stickers = dict(s1=s_spine, s2=s_heart, s3=s_ear, s4=s_bones, s5=s_brain, s6=s_skin, s7=s_stomach)
    scenes = dict(intro=bg_intro, outro=bg_outro, q1=bg_morning, q2=bg_heart, q3=bg_ear, q4=bg_bones, q5=bg_brain, q6=bg_skin, q7=bg_stomach)
    which = sys.argv[2:] or [*stickers, *scenes, "thumbnail"]
    for name in which:
        if name in stickers:
            stickers[name]()
        elif name == "thumbnail":
            thumbnail().save(OUT / "thumbnail-p1.png")
        else:
            scenes[name]().save(OUT / f"{name}-p1.png")
        print("saved", name, flush=True)
