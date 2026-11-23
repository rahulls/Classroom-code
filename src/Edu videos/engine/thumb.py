"""Edu video thumbnail -> <item>/thumbnail.jpg.

1. Canva's design (<item>/canva/thumbnail.png, made by the web app) fitted to size, with the round
   channel logo in the bottom-left corner.
2. Otherwise a minimal fallback: the video's own title on the channel's dark background (a Canva
   picture from the video behind it when there is one). The web app alerts Rahul when this happens.

Run with the Chaos engine venv:  python thumb.py <item folder>   (prints "canva" or "fallback")"""
import json, pathlib, sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
CHAOS = HERE.parents[1] / "Chaos creators"
FONTS = CHAOS / "quiz-template" / "quiz-template" / "fonts"
NAVY, AMBER, PINK, WHITE, INK = (11, 16, 38), (255, 179, 0), (255, 92, 141), (255, 255, 255), (28, 24, 64)


def font(size, weight="Bold"):
    return ImageFont.truetype(str(FONTS / f"Poppins-{weight}.ttf"), size)


def cover(im, w, h):
    k = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def logo(item, size):
    p = item / "logo_round.png"
    if not p.exists():
        return None
    return Image.open(p).convert("RGBA").resize((size, size), Image.LANCZOS)


def lines_for(text, f, width, draw):
    words, lines, cur = text.split(), [], []
    for w in words:
        if cur and draw.textlength(" ".join(cur + [w]), font=f) > width:
            lines.append(" ".join(cur))
            cur = []
        cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines


def fallback(item, script, W, H):
    img = Image.new("RGB", (W, H), NAVY)
    pics = sorted((item / "pics").glob("scene*.png")) if (item / "pics").is_dir() else []
    if pics:  # a Canva picture from the video, darkened, behind the title
        bg = cover(Image.open(pics[0]).convert("RGB"), W, H).filter(ImageFilter.GaussianBlur(2))
        img = Image.blend(img, bg, 0.55)
    else:     # soft glows on the channel's dark background
        glow = Image.new("RGB", (W, H), NAVY)
        g = ImageDraw.Draw(glow)
        g.ellipse([-W * 0.3, -H * 0.15, W * 0.6, H * 0.45], fill=(0, 70, 120))
        g.ellipse([W * 0.45, H * 0.55, W * 1.3, H * 1.2], fill=(110, 30, 70))
        img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(W // 6)), 0.6)
    d = ImageDraw.Draw(img)
    short = H > W
    text = (script.get("thumbnail_text") or script.get("title") or "").upper()
    size = int(W * (0.13 if short else 0.095))
    margin = int(W * 0.07)
    while True:
        f = font(size)
        ls = lines_for(text, f, W - 2 * margin, d)
        block = len(ls) * size * 1.12
        if (len(ls) <= 4 and block < H * (0.5 if short else 0.62)) or size < 40:
            break
        size = int(size * 0.9)
    y = (H - block) / 2 - (H * 0.04 if short else 0)
    for k, line in enumerate(ls):
        col = AMBER if k == len(ls) - 1 and len(ls) > 1 else WHITE
        tw = d.textlength(line, font=f)
        d.text(((W - tw) / 2, y), line, font=f, fill=col, stroke_width=max(4, size // 14), stroke_fill=INK)
        y += size * 1.12
    kick = (script.get("kicker") or "EXPLAINED").upper()
    kf = font(int(size * 0.38))
    kw = d.textlength(kick, font=kf)
    ph = int(size * 0.62)
    ky = int((H - block) / 2 - ph * 1.6 - (H * 0.04 if short else 0))
    d.rounded_rectangle([(W - kw) / 2 - ph * 0.6, ky, (W + kw) / 2 + ph * 0.6, ky + ph], radius=ph // 2, fill=PINK)
    d.text(((W - kw) / 2, ky + ph * 0.12), kick, font=kf, fill=WHITE)
    return img


def make(item):
    item = pathlib.Path(item)
    script = json.loads((item / "script.json").read_text(encoding="utf-8"))
    short = script.get("format", "short") == "short"
    W, H = (1080, 1920) if short else (1280, 720)
    src = item / "canva" / "thumbnail.png"
    kind = "canva" if src.exists() else "fallback"
    img = cover(Image.open(src).convert("RGB"), W, H) if kind == "canva" else fallback(item, script, W, H)
    size = 170 if short else 120
    lg = logo(item, size)
    if lg:
        img.paste(lg, (22, H - size - 22), lg)
    img.save(item / "thumbnail.jpg", quality=92)
    return kind


if __name__ == "__main__":
    print(make(sys.argv[1]))
