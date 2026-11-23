"""Original artwork for the "Stone Age Facts You Didn't Know" Short (Canva is out of credits).
Writes thumbnail, intro, outro, q1..q5 backgrounds (1080x1920) and s1..s5 stickers (800x800) into <out_dir>.
All drawn from scratch with PIL.
Usage: python stone_age_facts_art.py <out_dir> [names...]"""
import math, random, sys, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import avengers_doomsday_art as A  # noqa: E402  shared helpers (radial, glow, text, logo...)
from avengers_doomsday_facts_art import die_cut, burst  # noqa: E402

W, H, f = A.W, A.H, A.f
FIRE, EMBER, OCHRE, BONE, GOLD = (255, 150, 40), (255, 90, 20), (190, 70, 30), (236, 222, 190), (255, 200, 60)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(w, h, stops):
    """Vertical gradient through [(pos 0..1, colour), ...]."""
    col = np.zeros((h, 3), np.float32)
    ys = np.linspace(0, 1, h)
    for c in range(3):
        col[:, c] = np.interp(ys, [p for p, _ in stops], [k[c] for _, k in stops])
    return Image.fromarray(np.repeat(col[:, None, :], w, 1).astype(np.uint8))


def noise(w, h, rnd, scale=6, octaves=4):
    acc = np.zeros((h, w), np.float32)
    amp = 1.0
    for o in range(octaves):
        s = max(2, scale * 2 ** o)
        small = np.array([[rnd.random() for _ in range(s)] for _ in range(max(2, int(s * h / w)))], np.float32)
        acc += amp * np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
        amp *= 0.5
    acc -= acc.min(); acc /= acc.max() + 1e-6
    return acc


def rock(w, h, rnd, dark=(40, 24, 14), light=(150, 100, 62)):
    n = noise(w, h, rnd, 5, 5)
    grain = np.asarray([[rnd.random() for _ in range(w // 4)] for _ in range(h // 4)], np.float32)
    grain = np.asarray(Image.fromarray((grain * 255).astype(np.uint8)).resize((w, h)), np.float32) / 255
    t = np.clip(n * 0.85 + grain * 0.15, 0, 1)[..., None]
    arr = np.array(dark, np.float32) * (1 - t) + np.array(light, np.float32) * t
    return Image.fromarray(arr.astype(np.uint8))


def firelight(img, cx, cy, r, strength=0.9, color=(255, 140, 50)):
    g = A.radial(img.width, img.height, cx, cy, color, (0, 0, 0), r)
    return ImageChops.add(img, ImageChops.multiply(g, Image.new("RGB", img.size, (int(255 * strength),) * 3)))


def hills(img, rnd, base, amp, color, step=40):
    d = ImageDraw.Draw(img)
    pts, y = [(0, img.height)], base
    for x in range(0, img.width + step, step):
        y = max(base - amp, min(base + amp * 0.4, y + rnd.uniform(-amp, amp) * 0.35))
        pts.append((x, y))
    pts.append((img.width, img.height))
    d.polygon(pts, fill=color)


def flames(img, cx, cy, s, rnd):
    """A campfire: logs, layered flames, glow and embers."""
    d = ImageDraw.Draw(img)
    for a in (-0.35, 0.35, 0):
        dx, dy = math.cos(a) * 120 * s, math.sin(a) * 30 * s
        d.line([(cx - dx, cy + 20 * s - dy), (cx + dx, cy + 20 * s + dy)], fill=(60, 34, 20), width=int(26 * s))
    def draw(dd):
        for col, k in (((255, 80, 20), 1.0), ((255, 160, 40), 0.72), ((255, 235, 140), 0.42)):
            for j in range(-2, 3):
                x0 = cx + j * 34 * s * k
                hgt = (150 + rnd.uniform(-30, 40) - abs(j) * 30) * s * k
                dd.polygon([(x0 - 40 * s * k, cy + 10 * s), (x0 + rnd.uniform(-12, 12) * s, cy - hgt), (x0 + 40 * s * k, cy + 10 * s)], fill=col)
            dd.ellipse((cx - 95 * s * k, cy - 50 * s * k, cx + 95 * s * k, cy + 22 * s), fill=col)
    img = A.add(img, A.glow_layer(draw, 18 * s, 1.6))
    lay = Image.new("RGB", img.size); draw(ImageDraw.Draw(lay))
    m = lay.convert("L").point(lambda v: 255 if v > 20 else 0)
    img.paste(lay, (0, 0), m)
    img = firelight(img, cx, cy - 60 * s, 520 * s, 0.55)
    return A.sparks(img, rnd, int(40 * s) + 10, color=(255, 170, 60), area=(cx - 160 * s, cy - 420 * s, cx + 160 * s, cy - 120 * s))


def acacia(d, x, base, s, color):
    d.polygon([(x - 8 * s, base), (x - 3 * s, base - 150 * s), (x + 3 * s, base - 150 * s), (x + 9 * s, base)], fill=color)
    d.line([(x, base - 120 * s), (x - 60 * s, base - 185 * s)], fill=color, width=int(8 * s))
    d.line([(x, base - 130 * s), (x + 70 * s, base - 190 * s)], fill=color, width=int(8 * s))
    for dx, w_, h_ in ((-80, 110, 26), (0, 170, 34), (75, 120, 26)):
        d.ellipse((x + dx * s - w_ * s, base - 215 * s - h_ * s, x + dx * s + w_ * s, base - 190 * s + h_ * s * 0.4), fill=color)


def hand_mask(size, cx, cy, s, spread=1.0):
    m = Image.new("L", size); d = ImageDraw.Draw(m)
    d.rounded_rectangle((cx - 95 * s, cy - 70 * s, cx + 95 * s, cy + 110 * s), radius=int(60 * s), fill=255)
    d.rounded_rectangle((cx - 70 * s, cy + 60 * s, cx + 70 * s, cy + 230 * s), radius=int(30 * s), fill=255)   # wrist
    fingers = [(-72, -150, 14), (-25, -185, 5), (22, -178, -4), (66, -140, -14)]
    for fx, top, ang in fingers:
        fl = Image.new("L", size); fd = ImageDraw.Draw(fl)
        fd.rounded_rectangle((cx + fx * s - 21 * s, cy + top * s, cx + fx * s + 21 * s, cy - 20 * s), radius=int(21 * s), fill=255)
        fl = fl.rotate(ang * spread, center=(cx + fx * s, cy - 20 * s), resample=Image.BICUBIC)
        m = ImageChops.lighter(m, fl)
    th = Image.new("L", size); td = ImageDraw.Draw(th)
    td.rounded_rectangle((cx + 62 * s, cy - 40 * s, cx + 106 * s, cy + 80 * s), radius=int(22 * s), fill=255)
    th = th.rotate(-38 * spread, center=(cx + 75 * s, cy + 70 * s), resample=Image.BICUBIC)
    return ImageChops.lighter(m, th)


def stencil(img, cx, cy, s, rnd, color=OCHRE, alpha=1.0):
    """A blown-paint hand stencil: speckled ochre spray around a bare hand shape."""
    size = img.size
    hm = hand_mask(size, cx, cy, s)
    halo = hm.filter(ImageFilter.MaxFilter(int(40 * s) | 1)).filter(ImageFilter.GaussianBlur(55 * s))
    spray = np.asarray(halo, np.float32) / 255
    speck = np.random.default_rng(rnd.randint(0, 9999)).random(spray.shape) ** 2.2
    spray = np.clip(spray * 1.6 * (0.55 + speck * 0.7), 0, 1) * alpha
    spray *= 1 - np.asarray(hm, np.float32) / 255
    m = Image.fromarray((spray * 255).astype(np.uint8))
    img.paste(Image.new("RGB", img.size, color), (0, 0), m)
    return img


def hand_axe(img, cx, cy, s, rnd):
    """A knapped flint hand axe: teardrop with facets and a light edge."""
    right = [(cx + 165 * s * math.sin(u * math.pi / 2) ** 0.85, cy - 290 * s + u * 420 * s) for u in np.linspace(0, 1, 30)]
    base = [(cx + 165 * s * math.cos(t), cy + 130 * s + 150 * s * math.sin(t)) for t in np.linspace(0, math.pi, 30)]
    pts = right + base + [(2 * cx - x, y) for x, y in reversed(right)]
    m = Image.new("L", img.size); ImageDraw.Draw(m).polygon(pts, fill=255)
    body = A.radial(img.width, img.height, cx - 60 * s, cy - 70 * s, (205, 190, 165), (70, 62, 54), 330 * s)
    img.paste(body, (0, 0), m)
    fac = Image.new("RGB", img.size, (128, 128, 128)); fd = ImageDraw.Draw(fac)
    for _ in range(34):                                   # knapping facets: light/dark flake scars
        a = rnd.uniform(0, 2 * math.pi); rr = rnd.uniform(0.2, 1.0)
        x, y = cx + 160 * s * rr * math.cos(a), cy + 230 * s * rr * math.sin(a)
        r_ = rnd.uniform(35, 70) * s; k = rnd.randint(95, 165)
        fd.polygon([(x + r_ * math.cos(t), y + r_ * 0.75 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 7)[:-1] + rnd.uniform(0, 1)], fill=(k, k, k), outline=(70, 70, 70))
    fac = fac.filter(ImageFilter.GaussianBlur(1.2))
    shaded = ImageChops.multiply(img, fac.point(lambda v: min(255, v * 2)))
    img.paste(shaded, (0, 0), m)
    edge = ImageChops.subtract(m, m.filter(ImageFilter.MinFilter(int(10 * s) | 1)))
    img.paste(Image.new("RGB", img.size, (250, 240, 215)), (0, 0), edge.filter(ImageFilter.GaussianBlur(1)))
    return img


def dog(d, x, base, s, color):
    """A sitting dog in profile, facing right (silhouette)."""
    d.polygon([(x - 70 * s, base), (x - 90 * s, base - 120 * s), (x - 40 * s, base - 210 * s), (x + 40 * s, base - 260 * s),
               (x + 70 * s, base - 190 * s), (x + 55 * s, base)], fill=color)                     # body + chest
    d.ellipse((x + 10 * s, base - 345 * s, x + 110 * s, base - 245 * s), fill=color)              # head
    d.polygon([(x + 90 * s, base - 320 * s), (x + 165 * s, base - 290 * s), (x + 160 * s, base - 270 * s), (x + 90 * s, base - 262 * s)], fill=color)  # snout
    d.polygon([(x + 25 * s, base - 320 * s), (x + 30 * s, base - 400 * s), (x + 70 * s, base - 335 * s)], fill=color)   # ear
    d.polygon([(x - 85 * s, base - 20 * s), (x - 170 * s, base - 30 * s), (x - 190 * s, base - 70 * s), (x - 80 * s, base - 60 * s)], fill=color)  # tail
    d.rectangle((x + 30 * s, base - 120 * s, x + 55 * s, base), fill=color)                       # front leg


def person(d, x, base, s, color, spear=True):
    d.ellipse((x - 22 * s, base - 300 * s, x + 22 * s, base - 254 * s), fill=color)
    d.polygon([(x - 34 * s, base - 250 * s), (x + 34 * s, base - 250 * s), (x + 44 * s, base - 120 * s), (x - 44 * s, base - 120 * s)], fill=color)
    d.polygon([(x - 36 * s, base - 125 * s), (x - 8 * s, base - 125 * s), (x - 14 * s, base), (x - 38 * s, base)], fill=color)
    d.polygon([(x + 8 * s, base - 125 * s), (x + 36 * s, base - 125 * s), (x + 40 * s, base), (x + 16 * s, base)], fill=color)
    if spear:
        d.line([(x + 50 * s, base + 10 * s), (x + 90 * s, base - 390 * s)], fill=color, width=int(8 * s))
        d.polygon([(x + 84 * s, base - 380 * s), (x + 104 * s, base - 440 * s), (x + 98 * s, base - 376 * s)], fill=color)


def t_pillar(img, cx, base, s, rnd, carve=True):
    """A Göbekli Tepe style T-shaped stone pillar (optionally with a carved fox)."""
    m = Image.new("L", img.size); md = ImageDraw.Draw(m)
    md.rectangle((cx - 70 * s, base - 520 * s, cx + 70 * s, base), fill=255)
    md.rounded_rectangle((cx - 180 * s, base - 640 * s, cx + 180 * s, base - 500 * s), radius=int(14 * s), fill=255)
    stone = rock(img.width, img.height, rnd, (95, 78, 58), (210, 186, 148))
    img.paste(stone, (0, 0), m)
    shade = A.radial(img.width, img.height, cx - 120 * s, base - 600 * s, (255, 255, 255), (110, 110, 110), 700 * s)
    img.paste(ImageChops.multiply(img, shade), (0, 0), m)
    if carve:
        cv = img.copy(); d = ImageDraw.Draw(cv); c = (70, 54, 38); w = max(3, int(7 * s))
        cave_animal(d, cx - 20 * s, base - 300 * s, 0.45 * s, c, w)
        for k in range(2):
            y = base - 600 * s + k * 34 * s
            d.line([(cx - 150 * s, y), (cx + 150 * s, y)], fill=c, width=max(2, int(4 * s)))
        img.paste(cv, (0, 0), m)
    edge = ImageChops.subtract(m, m.filter(ImageFilter.MinFilter(9)))
    img.paste(Image.new("RGB", img.size, (40, 30, 22)), (0, 0), edge)
    return img


def notes(img, rnd, area, color=GOLD, n=5, s=1.0):
    def draw(d):
        for _ in range(n):
            x, y = rnd.uniform(area[0], area[2]), rnd.uniform(area[1], area[3]); k = rnd.uniform(0.8, 1.2) * s
            d.ellipse((x - 26 * k, y - 18 * k, x + 26 * k, y + 18 * k), fill=color)
            d.line([(x + 22 * k, y), (x + 22 * k, y - 110 * k)], fill=color, width=int(9 * k))
            d.line([(x + 22 * k, y - 110 * k), (x + 62 * k, y - 80 * k)], fill=color, width=int(12 * k))
    return A.add(img, A.glow_layer(draw, 8, 1.4))


def flute(img, cx, cy, s, angle=-28):
    L, R = 620 * s, 46 * s
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    d.rounded_rectangle((cx - L / 2, cy - R, cx + L / 2, cy + R), radius=int(R), fill=BONE + (255,), outline=(120, 100, 70, 255), width=max(3, int(5 * s)))
    for e in (-1, 1):
        d.ellipse((cx + e * L / 2 - 50 * s, cy - R * 1.35, cx + e * L / 2 + 30 * s * e - 20 * s * (e < 0), cy + R * 1.35), fill=(225, 205, 168, 255), outline=(120, 100, 70, 255), width=max(3, int(5 * s)))
    for k in range(5):
        x = cx - L * 0.3 + k * L * 0.14
        d.ellipse((x - 14 * s, cy - 18 * s, x + 14 * s, cy + 18 * s), fill=(55, 40, 28, 255))
    d.line([(cx - L / 2 + 40 * s, cy + R * 0.45), (cx + L / 2 - 40 * s, cy + R * 0.45)], fill=(200, 182, 150, 255), width=max(2, int(4 * s)))
    lay = lay.rotate(angle, center=(cx, cy), resample=Image.BICUBIC)
    im = img.convert("RGBA"); im.alpha_composite(lay); return im.convert("RGB")


def cave_animal(d, x, y, s, color, w=6):
    """A simple Stone Age style bison/deer outline like cave paintings."""
    d.ellipse((x - 110 * s, y - 55 * s, x + 90 * s, y + 50 * s), outline=color, width=w)
    d.ellipse((x + 70 * s, y - 70 * s, x + 140 * s, y - 10 * s), outline=color, width=w)
    d.arc((x + 90 * s, y - 120 * s, x + 150 * s, y - 50 * s), 180, 320, fill=color, width=w)
    for lx in (-80, -45, 30, 65):
        d.line([(x + lx * s, y + 40 * s), (x + lx * s + 6 * s, y + 120 * s)], fill=color, width=w)
    d.line([(x - 110 * s, y - 10 * s), (x - 150 * s, y + 30 * s)], fill=color, width=w)


def finish(img, k=0.55):
    return A.vignette(img, k)

# ------------------------------------------------------------------ scenes (1080x1920)

def intro(seed=1):
    rnd = random.Random(seed)
    img = sky(W, H, [(0, (40, 20, 60)), (0.35, (190, 80, 50)), (0.55, (255, 170, 80)), (0.62, (120, 60, 30)), (1, (20, 10, 6))])
    d = ImageDraw.Draw(img); d.ellipse((W / 2 - 170, 900, W / 2 + 170, 1240), fill=(255, 215, 130))
    img = firelight(img, W / 2, 1070, 700, 0.5, (255, 160, 70))
    hills(img, rnd, 1180, 70, (70, 34, 24)); hills(img, rnd, 1280, 50, (36, 18, 12))
    d = ImageDraw.Draw(img); acacia(d, 230, 1300, 1.4, (24, 12, 8)); acacia(d, 880, 1320, 1.0, (24, 12, 8))
    # cave mouth framing the view
    cave = rock(W, H, rnd, (18, 10, 6), (78, 50, 32))
    hole = Image.new("L", (W, H), 255); hd = ImageDraw.Draw(hole)
    pts = [(W / 2 + 470 * math.cos(t) * (1 + 0.08 * math.sin(5 * t)), 1050 + 900 * math.sin(t) * (1 + 0.06 * math.cos(7 * t))) for t in np.linspace(0, 2 * math.pi, 80)]
    hd.polygon(pts, fill=0); hole = hole.filter(ImageFilter.GaussianBlur(6))
    img.paste(cave, (0, 0), hole)
    img = flames(img, W / 2, 1660, 1.3, rnd)
    d = ImageDraw.Draw(img); person(d, 250, 1800, 1.1, (14, 8, 5)); dog(d, 800, 1800, 0.9, (14, 8, 5))
    return finish(img, 0.5)


def outro(seed=2):
    rnd = random.Random(seed)
    img = sky(W, H, [(0, (6, 8, 26)), (0.6, (28, 24, 60)), (0.75, (90, 50, 50)), (1, (20, 10, 8))])
    A.stars(img, rnd, 420)
    d = ImageDraw.Draw(img); d.ellipse((760, 260, 920, 420), fill=(250, 245, 220))
    img = A.add(img, A.glow_layer(lambda dd: dd.ellipse((760, 260, 920, 420), fill=(200, 200, 180)), 40, 1.2))
    hills(img, rnd, 1350, 90, (34, 22, 30)); hills(img, rnd, 1500, 60, (16, 10, 10))
    img = flames(img, W / 2, 1620, 1.5, rnd)
    d = ImageDraw.Draw(img)
    person(d, 230, 1760, 1.0, (10, 6, 4)); person(d, 880, 1770, 1.05, (10, 6, 4), spear=False); dog(d, 700, 1770, 0.75, (10, 6, 4))
    return finish(img, 0.45)


def q1(seed=11):   # savanna sunset: where the oldest tools were found
    rnd = random.Random(seed)
    img = sky(W, H, [(0, (50, 22, 40)), (0.4, (200, 90, 40)), (0.62, (250, 170, 70)), (0.7, (110, 55, 25)), (1, (30, 14, 8))])
    d = ImageDraw.Draw(img); d.ellipse((W / 2 - 210, 1050, W / 2 + 210, 1470), fill=(255, 210, 120))
    img = firelight(img, W / 2, 1260, 800, 0.45, (255, 150, 60))
    hills(img, rnd, 1330, 60, (90, 45, 25)); hills(img, rnd, 1420, 40, (40, 20, 12))
    d = ImageDraw.Draw(img); acacia(d, 210, 1440, 1.6, (22, 10, 6)); acacia(d, 870, 1460, 1.2, (22, 10, 6))
    return finish(img)


def q2(seed=12):   # night camp with a dog
    rnd = random.Random(seed)
    img = sky(W, H, [(0, (8, 10, 30)), (0.6, (30, 30, 70)), (0.78, (70, 40, 50)), (1, (16, 10, 8))])
    A.stars(img, rnd, 380)
    d = ImageDraw.Draw(img); d.ellipse((150, 230, 330, 410), fill=(245, 240, 215))
    hills(img, rnd, 1420, 80, (30, 22, 30)); hills(img, rnd, 1560, 50, (14, 10, 10))
    img = flames(img, 640, 1700, 1.2, rnd)
    d = ImageDraw.Draw(img); person(d, 300, 1840, 1.0, (10, 6, 4)); dog(d, 860, 1840, 0.8, (10, 6, 4))
    return finish(img)


def q3(seed=13):   # cave interior by firelight
    rnd = random.Random(seed)
    img = rock(W, H, rnd, (20, 12, 8), (110, 72, 44))
    img = ImageChops.multiply(img, A.radial(W, H, W / 2, 1500, (255, 255, 255), (60, 60, 60), 1300))
    img = flames(img, W / 2, 1720, 1.3, rnd)
    img = notes(img, rnd, (120, 300, 960, 700), (255, 210, 120), 6, 0.8)
    return finish(img, 0.5)


def q4(seed=14):   # painted cave wall
    rnd = random.Random(seed)
    img = rock(W, H, rnd, (60, 38, 24), (170, 120, 80))
    for (x, y, s, a) in ((230, 380, 0.9, 0.55), (850, 520, 0.8, 0.5), (180, 1500, 0.8, 0.45), (900, 1650, 0.9, 0.5)):
        img = stencil(img, x, y, s, rnd, OCHRE, a)
    d = ImageDraw.Draw(img)
    cave_animal(d, 760, 1250, 1.1, (120, 40, 22), 8); cave_animal(d, 300, 900, 0.8, (60, 30, 20), 7)
    img = ImageChops.multiply(img, A.radial(W, H, W / 2, 1100, (255, 230, 200), (70, 50, 40), 1200))
    return finish(img, 0.5)


def q5(seed=15):   # T-pillars on a hill at dawn
    rnd = random.Random(seed)
    img = sky(W, H, [(0, (30, 40, 90)), (0.45, (230, 130, 90)), (0.6, (255, 200, 120)), (0.66, (120, 80, 50)), (1, (30, 18, 10))])
    d = ImageDraw.Draw(img); d.ellipse((W / 2 - 150, 1100, W / 2 + 150, 1400), fill=(255, 230, 160))
    hills(img, rnd, 1300, 40, (100, 70, 45))
    for x, s in ((170, 0.75), (430, 0.95), (700, 0.85), (930, 0.7)):
        img = t_pillar(img, x, 1520, s, rnd, carve=False)
    d = ImageDraw.Draw(img); d.rectangle((0, 1500, W, H), fill=(40, 26, 16))
    hills(img, rnd, 1530, 30, (30, 20, 12))
    return finish(img)

# ------------------------------------------------------------------ stickers (square pictures)
S = 800


def s1(seed=21):   # hand axe
    rnd = random.Random(seed)
    img = sky(S, S, [(0, (250, 200, 120)), (1, (190, 120, 60))])
    img = ImageChops.multiply(img, rock(S, S, rnd, (170, 150, 130), (255, 245, 230)))
    img = hand_axe(img, S / 2, S / 2 + 20, 1.25, rnd)
    return img


def s2(seed=22):   # dog by the fire under the moon
    rnd = random.Random(seed)
    img = sky(S, S, [(0, (14, 16, 48)), (0.7, (60, 40, 70)), (1, (30, 16, 12))])
    A_st = Image.new("RGB", (S, S)); img = ImageChops.add(img, A_st)
    d = ImageDraw.Draw(img)
    for _ in range(90):
        x, y = rnd.uniform(0, S), rnd.uniform(0, S * 0.6); r = rnd.uniform(1, 2.6)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(230, 230, 255))
    d.ellipse((560, 80, 700, 220), fill=(250, 245, 220))
    img = flames(img, 230, 690, 0.8, rnd)
    d = ImageDraw.Draw(img); d.rectangle((0, 720, S, S), fill=(18, 10, 8))
    dog(d, 520, 730, 1.15, (12, 7, 5))
    return img


def s3(seed=23):   # bone flute
    rnd = random.Random(seed)
    img = rock(S, S, rnd, (30, 18, 12), (100, 64, 40))
    img = firelight(img, S / 2, S / 2, 520, 0.6)
    img = flute(img, S / 2, S / 2 + 60, 1.0)
    img = notes(img, rnd, (110, 120, 700, 300), GOLD, 3, 0.9)
    return img


def s4(seed=24):   # hand stencil
    rnd = random.Random(seed)
    img = rock(S, S, rnd, (110, 74, 48), (215, 170, 120))
    img = stencil(img, S / 2, S / 2 + 10, 1.45, rnd, (170, 50, 25), 1.0)
    return img


def s5(seed=25):   # carved T-pillar
    rnd = random.Random(seed)
    img = sky(S, S, [(0, (90, 120, 190)), (0.6, (250, 170, 110)), (1, (120, 80, 50))])
    img = t_pillar(img, S / 2, S + 40, 1.15, rnd)
    return img

# ------------------------------------------------------------------ thumbnail


def thumbnail(seed=7):
    rnd = random.Random(seed)
    img = rock(W, H, rnd, (34, 20, 12), (130, 86, 54))
    for (x, y, s, a) in ((200, 560, 0.9, 0.5), (900, 760, 0.85, 0.45), (170, 1050, 0.7, 0.35)):
        img = stencil(img, x, y, s, rnd, OCHRE, a)
    d = ImageDraw.Draw(img); cave_animal(d, 760, 470, 1.0, (130, 45, 24), 8)
    img = flames(img, W / 2, 1060, 1.5, rnd)
    shade = Image.new("L", (W, H)); sd = ImageDraw.Draw(shade)
    for y in range(980, H):
        sd.line([(0, y), (W, y)], fill=int(min(215, (y - 980) * 0.5)))
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), shade)
    img = A.vignette(img, 0.45)

    im = img.convert("RGBA"); im.alpha_composite(A.round_logo(210), (40, 46)); img = im.convert("RGB")
    A.text(img, (272, 118), "CHAOS CREATORS", A.fit("CHAOS CREATORS", 64, 760), (255, 255, 255), 8, "lm")
    d = ImageDraw.Draw(img)
    pill = "5 FACTS • ANCIENT HISTORY"; ps = 40; pw = f(ps).getlength(pill) + 60
    d.rounded_rectangle((272, 168, 272 + pw, 234), radius=33, fill=FIRE, outline=(0, 0, 0), width=5)
    d.text((272 + pw / 2, 201), pill, font=f(ps), fill=(0, 0, 0), anchor="mm")

    im = img.convert("RGBA")
    st_hand = die_cut(s4().resize((430, 430), Image.LANCZOS).convert("RGBA"), border=16, angle=-8)
    im.alpha_composite(st_hand, (30, 330))
    st_axe = die_cut(s1().resize((380, 380), Image.LANCZOS).convert("RGBA"), border=16, angle=10)
    im.alpha_composite(st_axe, (W - st_axe.width - 20, 420))
    b = die_cut(burst(["DID", "YOU", "KNOW?"], 120), angle=-10)
    im.alpha_composite(b, (W // 2 - b.width // 2 + 20, 290))
    img = im.convert("RGB")

    A.text(img, (W / 2, 1185), "STONE AGE", A.fit("STONE AGE", 190, 1010), (255, 255, 255), 14)
    A.text(img, (W / 2, 1345), "FACTS", 170, (255, 170, 60), 14)
    d = ImageDraw.Draw(img)
    band = "YOU DIDN'T KNOW"; bs = A.fit(band, 86, 900); bw = f(bs).getlength(band) + 90
    d.rounded_rectangle((W / 2 - bw / 2, 1435, W / 2 + bw / 2, 1545), radius=55, fill=GOLD, outline=(0, 0, 0), width=7)
    d.text((W / 2, 1490), band, font=f(bs), fill=(0, 0, 0), anchor="mm")
    return img


if __name__ == "__main__":
    scenes = dict(thumbnail=thumbnail, intro=intro, outro=outro, q1=q1, q2=q2, q3=q3, q4=q4, q5=q5, s1=s1, s2=s2, s3=s3, s4=s4, s5=s5)
    for name in sys.argv[2:] or list(scenes):
        scenes[name]().save(A.OUT / f"{name}-p1.png")
        print("saved", name, flush=True)
