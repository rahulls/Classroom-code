"""Original Shorts thumbnail for "Avengers Doomsday Facts You Didn't Know" (Canva is out of credits).
Reuses the Doom artwork from avengers_doomsday_art.py and adds die-cut stickers.
All drawn from scratch: no Marvel logos, film stills or real faces.
Usage: python avengers_doomsday_facts_art.py <out_dir>"""
import math, random, sys, pathlib
from PIL import Image, ImageDraw, ImageFilter, ImageChops

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import avengers_doomsday_art as A  # noqa: E402  (reads <out_dir> from argv too)

W, H, f, GREEN, LIME, GOLD = A.W, A.H, A.f, A.GREEN, A.LIME, A.GOLD


def die_cut(art, border=18, shadow=True, angle=0):
    """Turn RGBA art into a sticker: thick white edge, thin dark outline, soft drop shadow, tilted."""
    pad = border * 3
    big = Image.new("RGBA", (art.width + pad * 2, art.height + pad * 2), (0, 0, 0, 0))
    big.alpha_composite(art, (pad, pad))
    a = big.split()[3].point(lambda v: 255 if v > 40 else 0)
    edge = a.filter(ImageFilter.MaxFilter(border * 2 + 1)).filter(ImageFilter.GaussianBlur(1.5))
    line = edge.filter(ImageFilter.MaxFilter(5))
    out = Image.new("RGBA", big.size, (0, 0, 0, 0))
    out.paste((20, 20, 20, 255), (0, 0), line)
    out.paste((255, 255, 255, 255), (0, 0), edge)
    out.alpha_composite(big)
    if angle:
        out = out.rotate(angle, resample=Image.BICUBIC, expand=True)
    if not shadow:
        return out
    sh = Image.new("RGBA", (out.width + 40, out.height + 40), (0, 0, 0, 0))
    blk = Image.new("RGBA", out.size, (0, 0, 0, 170))
    sh.paste(blk, (26, 30), out.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(12))
    sh.alpha_composite(out, (0, 0))
    return sh


def burst(text_lines, r=190, spikes=18, fill=GOLD):
    s = r * 2 + 20
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = s / 2
    pts = []
    for i in range(spikes * 2):
        rr = r if i % 2 == 0 else r * 0.8
        t = math.pi * i / spikes - math.pi / 2
        pts.append((c + rr * math.cos(t), c + rr * math.sin(t)))
    d.polygon(pts, fill=fill, outline=(0, 0, 0), width=6)
    d.ellipse((c - r * 0.66, c - r * 0.66, c + r * 0.66, c + r * 0.66), outline=(0, 0, 0), width=4)
    n = len(text_lines); lh = r * 0.32
    for i, t in enumerate(text_lines):
        size = A.fit(t, int(r * 0.30), r * 1.0)
        d.text((c, c + (i - (n - 1) / 2) * lh), t, font=f(size), fill=(0, 0, 0), anchor="mm")
    return im


def ticket(top, big, bottom, w=470, h=250):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=26, fill=(40, 255, 120), outline=(0, 0, 0), width=6)
    # punched notches on both sides
    for x in (0, w):
        d.ellipse((x - 34, h / 2 - 34, x + 34, h / 2 + 34), fill=(0, 0, 0, 0))
    m = Image.new("L", (w, h), 255); md = ImageDraw.Draw(m)
    for x in (0, w):
        md.ellipse((x - 30, h / 2 - 30, x + 30, h / 2 + 30), fill=0)
    im.putalpha(ImageChops.multiply(im.split()[3], m))
    d = ImageDraw.Draw(im)
    for x in (0, w):
        d.arc((x - 32, h / 2 - 32, x + 32, h / 2 + 32), 0, 360, fill=(0, 0, 0), width=5)
    # perforation
    for y in range(20, h - 18, 22):
        d.line([(w - 112, y), (w - 112, y + 10)], fill=(0, 0, 0), width=4)
    d.text((44 + (w - 156) / 2, 58), top, font=f(A.fit(top, 38, w - 190)), fill=(0, 0, 0), anchor="mm")
    d.text((44 + (w - 156) / 2, h / 2 + 3), big, font=f(A.fit(big, 78, w - 190)), fill=(0, 0, 0), anchor="mm")
    d.text((44 + (w - 156) / 2, h - 52), bottom, font=f(A.fit(bottom, 44, w - 190)), fill=(0, 0, 0), anchor="mm")
    # star on the stub
    cx, cy, r = w - 56, h / 2, 32
    pts = [(cx + (r if i % 2 == 0 else r * 0.42) * math.cos(math.pi * i / 5 - math.pi / 2),
            cy + (r if i % 2 == 0 else r * 0.42) * math.sin(math.pi * i / 5 - math.pi / 2)) for i in range(10)]
    d.polygon(pts, fill=(0, 0, 0))
    return im


def burning_sky(img, rnd):
    """Embers and a red-green glow on the horizon: the end-of-the-world 'doomsday' feel."""
    glow = A.radial(W, H, W / 2, 1180, (140, 60, 20), (0, 0, 0), 700)
    img = ImageChops.add(img, ImageChops.multiply(glow, Image.new("RGB", (W, H), (150, 150, 150))))
    img = A.sparks(img, rnd, 120, color=(255, 150, 60), area=(0, 700, W, 1300))
    return img


def thumbnail(seed=21):
    rnd = random.Random(seed)
    img = A.base(rnd, 720)
    img = A.rays(img, W / 2, 680, 32, GREEN, rnd, 70)
    img = A.lightning(img, rnd, 6, area=(0, 250, W, 760))
    img = A.portal(img, W / 2, 860, 520)
    img = burning_sky(img, rnd)
    A.skyline(img, rnd, 1260)
    img = A.hooded_figure(img, W / 2, 330, 0.84, rnd)
    img = A.vignette(A.sparks(img, rnd, 80), 0.5)
    # darken behind the title, and the bottom (Shorts title area)
    shade = Image.new("L", (W, H)); sd = ImageDraw.Draw(shade)
    for y in range(900, H):
        sd.line([(0, y), (W, y)], fill=int(min(215, (y - 900) * 0.45)))
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), shade)

    # top: channel logo + name, tag pill
    im = img.convert("RGBA"); im.alpha_composite(A.round_logo(210), (40, 46)); img = im.convert("RGB")
    A.text(img, (272, 118), "CHAOS CREATORS", A.fit("CHAOS CREATORS", 64, 760), (255, 255, 255), 8, "lm")
    d = ImageDraw.Draw(img)
    pill = "7 FACTS • DOCTOR DOOM"; ps = 40; pw = f(ps).getlength(pill) + 60
    d.rounded_rectangle((272, 168, 272 + pw, 234), radius=33, fill=GREEN, outline=(0, 0, 0), width=5)
    d.text((272 + pw / 2, 201), pill, font=f(ps), fill=(0, 0, 0), anchor="mm")

    # stickers
    im = img.convert("RGBA")
    s1 = die_cut(burst(["DID", "YOU", "KNOW?"], 150), angle=12)
    im.alpha_composite(s1, (W - s1.width + 10, 300))
    s2 = die_cut(ticket("IN CINEMAS", "18 DEC", "2026", w=430, h=230), angle=-9)
    im.alpha_composite(s2, (-6, 590))
    img = im.convert("RGB")

    # title block (the search phrase, biggest first)
    A.text(img, (W / 2, 1175), "AVENGERS", A.fit("AVENGERS", 180, 980), (255, 255, 255), 14)
    A.text(img, (W / 2, 1335), "DOOMSDAY", A.fit("DOOMSDAY", 196, 1010), (60, 255, 130), 14)
    d = ImageDraw.Draw(img)
    band = "FACTS YOU DIDN'T KNOW"; bs = A.fit(band, 82, 900); bw = f(bs).getlength(band) + 80
    d.rounded_rectangle((W / 2 - bw / 2, 1425, W / 2 + bw / 2, 1540), radius=60, fill=GOLD, outline=(0, 0, 0), width=7)
    d.text((W / 2, 1483), band, font=f(bs), fill=(0, 0, 0), anchor="mm")
    return img


if __name__ == "__main__":
    out = A.OUT / "thumbnail-facts.png"
    thumbnail().save(out)
    print("saved", out)
