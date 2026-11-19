"""Chaos Creators thumbnail designer.

Makes <job>/thumbnail.jpg for a quiz video: big bold title, question count, a hook line and one
of the video's questions on a tilted card, in the channel's style. Every design is different:
the colours, layout, hook, featured question, tilt and sticker all come from a random seed.

  * youtube format -> 1280x720 (the size YouTube asks for)
  * shorts format  -> 1080x1920 (a vertical cover for Shorts / Reels)

Run:  python thumbnail.py <job-dir> [seed]
Also called by quiz_video.py when a video finishes. Always under YouTube's 2 MB limit.
"""
import json, math, pathlib, random, sys, zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from quiz_video import TEMPLATE, clip_lines, fit_font, font, load_cfg, load_questions, round_logo, wrap

# (background dark, background light, headline accent, hook pill, card header)
PALETTES = [
    ((30, 14, 74), (118, 44, 196), (255, 179, 0), (255, 92, 141), (84, 30, 150)),     # channel purple
    ((6, 18, 70), (0, 116, 214), (255, 214, 0), (255, 112, 40), (0, 84, 170)),        # electric blue
    ((72, 6, 32), (214, 32, 74), (255, 220, 0), (0, 200, 255), (160, 20, 60)),        # crimson
    ((0, 44, 58), (0, 160, 150), (255, 204, 40), (255, 80, 140), (0, 110, 120)),      # teal
    ((110, 18, 8), (255, 112, 0), (255, 244, 130), (120, 40, 200), (200, 60, 0)),     # sunset
    ((8, 34, 22), (24, 150, 80), (255, 226, 0), (255, 92, 141), (14, 110, 60)),       # jungle
    ((26, 8, 60), (220, 40, 160), (120, 240, 255), (255, 200, 0), (150, 30, 140)),    # neon
]
HOOKS = ["CAN YOU GET THEM ALL?", "TEST YOUR BRAIN!", "HOW MANY CAN YOU GET?", "BEAT THE TIMER!",
         "ARE YOU SMART ENOUGH?", "{n}/{n} = GENIUS!", "ONLY {s} SECONDS EACH!", "QUIZ TIME!", "CHALLENGE YOUR FRIENDS!"]
INK = (24, 16, 52)
OPT_COLORS = [(255, 179, 0), (0, 194, 255), (255, 92, 141), (124, 220, 92)]


def background(W, H, pal, rnd, focus):
    """Radial gradient + sunburst rays + confetti, all from the palette."""
    fx, fy = focus
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dist = np.sqrt((xx - fx) ** 2 + (yy - fy) ** 2) / math.hypot(W, H)
    k = np.clip(dist * 1.6, 0, 1)[..., None]
    lo, hi = np.array(pal[0], np.float32), np.array(pal[1], np.float32)
    img = Image.fromarray((hi * (1 - k) + lo * k).astype(np.uint8)).convert("RGBA")

    rays = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rays)
    n = rnd.choice([14, 16, 18, 20])
    off = rnd.uniform(0, 2 * math.pi)
    R = math.hypot(W, H)
    for i in range(n):
        if i % 2:
            continue
        a0, a1 = off + i * 2 * math.pi / n, off + (i + 1) * 2 * math.pi / n
        rd.polygon([(fx, fy), (fx + R * math.cos(a0), fy + R * math.sin(a0)), (fx + R * math.cos(a1), fy + R * math.sin(a1))],
                   fill=(255, 255, 255, 22))
    img.alpha_composite(rays)

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = int(min(W, H) * 0.45)
    gd.ellipse([fx - r, fy - r, fx + r, fy + r], fill=pal[2] + (70,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(min(W, H) // 6)))

    d = ImageDraw.Draw(img, "RGBA")
    scale = W / 1280
    for _ in range(int(26 * W * H / (1280 * 720) ** 1)):
        x, y = rnd.uniform(0, W), rnd.uniform(0, H)
        s = rnd.uniform(6, 16) * scale
        c = rnd.choice(OPT_COLORS + [pal[2], (255, 255, 255)]) + (rnd.randint(90, 170),)
        kind = rnd.choice(["sq", "circ", "tri", "plus"])
        a = rnd.uniform(0, math.pi)
        if kind == "circ":
            d.ellipse([x - s, y - s, x + s, y + s], fill=c)
        elif kind == "plus":
            w = s * 0.35
            d.rectangle([x - s, y - w, x + s, y + w], fill=c)
            d.rectangle([x - w, y - s, x + w, y + s], fill=c)
        else:
            k_ = 4 if kind == "sq" else 3
            d.polygon([(x + s * math.cos(a + j * 2 * math.pi / k_), y + s * math.sin(a + j * 2 * math.pi / k_)) for j in range(k_)], fill=c)

    # Darker edges keep the eye in the middle
    vig = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vig).rectangle([0, 0, W, H], outline=255, width=max(W, H) // 14)
    vig = vig.filter(ImageFilter.GaussianBlur(max(W, H) // 12))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    dark.putalpha(vig.point(lambda v: int(v * 0.55)))
    img.alpha_composite(dark)
    return img


def shout(img, xy, text, f, fill, anchor="mm", stroke=None, shadow=None):
    """Thumbnail text: thick dark outline + hard drop shadow so it reads at any size."""
    sw = stroke if stroke is not None else max(3, f.size // 12)
    sh = shadow if shadow is not None else max(4, f.size // 14)
    d = ImageDraw.Draw(img, "RGBA")
    x, y = xy
    d.text((x + sh, y + sh), text, font=f, fill=(0, 0, 0, 150), anchor=anchor, stroke_width=sw, stroke_fill=(0, 0, 0, 150))
    d.text((x, y), text, font=f, fill=fill, anchor=anchor, stroke_width=sw, stroke_fill=INK)


def paste_rotated(img, layer, cx, cy, angle, shadow=True):
    rot = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    x, y = int(cx - rot.width / 2), int(cy - rot.height / 2)
    if shadow:
        sh = Image.new("RGBA", rot.size, (0, 0, 0, 0))
        sh.putalpha(rot.getchannel("A").point(lambda v: int(v * 0.55)))
        sh = sh.filter(ImageFilter.GaussianBlur(14))
        img.paste(sh, (x + 10, y + 16), sh)
    img.paste(rot, (x, y), rot)


def question_card(q, w, pal, rnd, scale):
    """A white quiz card with one of the video's questions. The answer is never shown."""
    pad = int(30 * scale)
    tmp = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    qsize = int(44 * scale)
    while True:
        fq = font("Bold", qsize)
        lines = wrap(tmp, q["q"], fq, w - 2 * pad)
        if len(lines) <= 3 or qsize <= int(28 * scale):
            break
        qsize -= 2
    lines = clip_lines(lines, 3)
    lh = int(fq.size * 1.22)
    head_h = int(58 * scale)
    opt_h, gap = int(62 * scale), int(14 * scale)
    h = head_h + pad + lh * len(lines) + pad + 4 * opt_h + 3 * gap + pad
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card, "RGBA")
    rad = int(30 * scale)
    d.rounded_rectangle([0, 0, w - 1, h - 1], rad, fill=(255, 255, 255, 255))
    d.rounded_rectangle([0, 0, w - 1, head_h + rad], rad, fill=pal[4] + (255,))
    d.rectangle([0, head_h, w - 1, head_h + rad], fill=(255, 255, 255, 255))
    d.text((pad, head_h / 2), "QUESTION", font=font("Bold", int(28 * scale)), fill="white", anchor="lm")
    d.text((w - pad, head_h / 2), "?", font=font("Bold", int(40 * scale)), fill=pal[2], anchor="rm")
    y = head_h + pad
    for ln in lines:
        d.text((pad, y), ln, font=fq, fill=INK)
        y += lh
    y += pad
    fo = font("Medium", int(32 * scale))
    for i, opt in enumerate(q["options"]):
        c = OPT_COLORS[i]
        d.rounded_rectangle([pad, y, w - pad, y + opt_h], opt_h // 2, fill=(244, 240, 252, 255), outline=c + (255,), width=max(2, int(4 * scale)))
        r = opt_h // 2 - int(7 * scale)
        cx, cy = pad + opt_h // 2, y + opt_h // 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c + (255,))
        d.text((cx, cy), "ABCD"[i], font=font("Bold", int(28 * scale)), fill=INK, anchor="mm")
        maxw = w - 2 * pad - opt_h - int(24 * scale)
        f = fit_font(d, opt, "Medium", fo.size, maxw, int(22 * scale))
        t = opt
        while d.textlength(t, font=f) > maxw and len(t) > 3:
            t = t[:-2].rstrip() + "…"
        d.text((pad + opt_h + int(10 * scale), cy), t, font=f, fill=INK, anchor="lm")
        y += opt_h + gap
    return card


def sticker(kind, size, pal, secs):
    """Round sticker that overlaps the card: the countdown timer or a big question mark."""
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(s, "RGBA")
    m = size // 14
    if kind == "timer":
        d.ellipse([m, m, size - m, size - m], fill=INK + (255,), outline=(255, 255, 255, 255), width=max(4, size // 28))
        a = -90 + 360 * 0.72
        d.arc([m * 2, m * 2, size - m * 2, size - m * 2], -90, a, fill=pal[2] + (255,), width=max(6, size // 13))
        d.text((size / 2, size * 0.46), str(secs), font=font("Bold", int(size * 0.42)), fill="white", anchor="mm")
        d.text((size / 2, size * 0.73), "SEC", font=font("Bold", int(size * 0.12)), fill=pal[2], anchor="mm")
    else:
        d.ellipse([m, m, size - m, size - m], fill=pal[3] + (255,), outline=(255, 255, 255, 255), width=max(4, size // 24))
        d.text((size / 2, size * 0.52), "?", font=font("Bold", int(size * 0.66)), fill="white", anchor="mm", stroke_width=max(3, size // 40), stroke_fill=INK)
    return s


def hook_pill(img, text, cx, cy, maxw, size, pal, angle):
    f = fit_font(ImageDraw.Draw(img), text, "Bold", size, maxw - size, int(size * 0.55))
    tw = ImageDraw.Draw(img).textlength(text, font=f)
    w, h = int(tw + f.size * 1.4), int(f.size * 1.7)
    pill = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(pill, "RGBA")
    d.rounded_rectangle([0, 0, w - 1, h - 1], h // 2, fill=pal[3] + (255,), outline=(255, 255, 255, 255), width=max(3, f.size // 12))
    d.text((w / 2, h / 2), text, font=f, fill="white", anchor="mm", stroke_width=max(2, f.size // 16), stroke_fill=INK)
    paste_rotated(img, pill, cx, cy, angle)


def headline(img, cfg, n, cx, top, maxw, big, align_left=None):
    """The quiz title (e.g. GK QUIZ) and the question count, stacked. Returns the bottom y."""
    d = ImageDraw.Draw(img)
    title = (cfg.get("quiz_badge") or "GK QUIZ").upper()
    words = title.split()
    # Long titles go on two lines so they stay big
    lines = [title]
    if len(words) > 1 and d.textlength(title, font=font("Bold", big)) > maxw * 1.25:
        best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))))
        lines = [" ".join(words[:best]), " ".join(words[best:])]
    y = top
    anchor = "lm" if align_left is not None else "mm"
    x = align_left if align_left is not None else cx
    for ln in lines:
        f = fit_font(d, ln, "Bold", big if len(lines) == 1 else int(big * 0.82), maxw, int(big * 0.35))
        y += f.size * 0.55
        shout(img, (x, y), ln, f, "white", anchor)
        y += f.size * 0.62
    count = f"{n} QUESTION{'S' if n != 1 else ''}"
    f = fit_font(d, count, "Bold", int(big * 0.7), maxw, int(big * 0.3))
    y += f.size * 0.6
    shout(img, (x, y), count, f, PALETTE_ACCENT[0], anchor)
    return y + f.size * 0.62


PALETTE_ACCENT = [None]


IMAGES_DIR = pathlib.Path(__file__).resolve().parent.parent / "images"


def topic_photo(cfg):
    """The video's topic photo (settings.thumb_image, a file in images/), or None.
    Returns (RGBA image, is_cutout): a PNG with real transparency is a cut-out."""
    name = str(cfg.get("thumb_image") or "").strip()
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    path = IMAGES_DIR / name
    if not path.is_file():
        print(f"[thumbnail] topic photo not found: {path}", flush=True)
        return None
    try:
        im = Image.open(path)
        im.load()
    except Exception as e:
        print(f"[thumbnail] couldn't open {name}: {e}", flush=True)
        return None
    im = im.convert("RGBA")
    alpha = np.asarray(im.getchannel("A"))
    cutout = (alpha < 16).mean() > 0.08   # a real cut-out has plenty of see-through pixels
    if cutout:
        box = im.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
        if box:
            im = im.crop(box)
    return im, cutout


def cover_crop(im, w, h, focus_y=0.3):
    """Fills w x h, cropping the sides or the bottom; faces are usually in the top third."""
    s = max(w / im.width, h / im.height)
    r = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x = (r.width - w) // 2
    y = int(min(max(0, r.height * focus_y - h * 0.35), r.height - h))
    return r.crop((x, y, x + w, y + h))


def framed_photo(im, w, h, pal, scale):
    """The photo in a rounded white frame with an accent ring: reads well even when small."""
    border, ring = max(8, int(14 * scale)), max(4, int(7 * scale))
    rad = int(36 * scale)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([0, 0, w - 1, h - 1], rad, fill=(255, 255, 255, 255))
    d.rounded_rectangle([border - 1, border - 1, w - border, h - border], rad - border // 2, fill=pal[2] + (255,))
    inner = (w - 2 * (border + ring), h - 2 * (border + ring))
    pic = cover_crop(im, *inner)
    mask = Image.new("L", inner, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, inner[0] - 1, inner[1] - 1], max(4, rad - border - ring), fill=255)
    out.paste(pic, (border + ring, border + ring), mask)
    return out


def cutout_photo(im, max_w, max_h, scale):
    """A cut-out (transparent PNG) with a thick white sticker outline."""
    s = min(max_w / im.width, max_h / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    pad = max(10, int(16 * scale))
    out = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    a = Image.new("L", out.size, 0)
    a.paste(im.getchannel("A"), (pad, pad))
    edge = a.filter(ImageFilter.MaxFilter(2 * (pad // 2) + 1)).filter(ImageFilter.GaussianBlur(1.2))
    white = Image.new("RGBA", out.size, (255, 255, 255, 255))
    white.putalpha(edge)
    out.alpha_composite(white)
    out.alpha_composite(im, (pad, pad))
    return out


def pick_question(qs, rnd):
    short = [q for q in qs if len(q["q"]) <= 80 and max(len(o) for o in q["options"]) <= 22]
    return rnd.choice(short or qs)


def design(job_dir, seed=None):
    job_dir = pathlib.Path(job_dir)
    spec = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    cfg = load_cfg(spec)
    qs = load_questions(job_dir / "questions.csv", cfg.get("timer_seconds", 5))
    if seed is None:
        seed = zlib.crc32(spec.get("id", str(job_dir)).encode()) % 1_000_000
    rnd = random.Random(seed)
    wide = spec.get("format", "shorts") == "youtube"
    W, H = (1280, 720) if wide else (1080, 1920)
    pal = PALETTES[rnd.randrange(len(PALETTES))]
    PALETTE_ACCENT[0] = pal[2]
    n, secs = len(qs), qs[0]["seconds"]
    hook = rnd.choice(HOOKS).replace("{n}", str(n)).replace("{s}", str(secs))
    q = pick_question(qs, rnd)
    stk = rnd.choice(["timer", "question"])
    tilt = rnd.choice([-1, 1]) * rnd.uniform(3, 6)
    logo = round_logo(TEMPLATE / cfg["logo"])
    photo = topic_photo(cfg)

    if photo and wide:
        # The topic photo takes the card's place: the face is the strongest hook there is
        im, cut = photo
        left = rnd.random() < 0.5
        pcx = 345 if left else 935
        text_x0 = 650 if left else 50
        img = background(W, H, pal, rnd, (pcx, H * 0.45))
        if cut:
            layer = cutout_photo(im, 560, 690, 1.0)
            img.alpha_composite(layer, (int(pcx - layer.width / 2), H - layer.height + 12))
            st_xy = (int(pcx + layer.width / 2 - 150), 40)
        else:
            layer = framed_photo(im, 500, 620, pal, 1.0)
            paste_rotated(img, layer, pcx, H / 2 + 5, tilt)
            st_xy = (int(pcx + 250 - 120), int(H / 2 + 310 - 140))
        img.alpha_composite(sticker(stk, 150, pal, secs), st_xy)
        bottom = headline(img, cfg, n, 0, 70, 580, 150, align_left=text_x0)
        hook_pill(img, hook, text_x0 + 290, min(bottom + 70, H - 150), 600, 52, pal, -tilt * 0.6)
        lg = logo.resize((120, 120), Image.LANCZOS)
        img.alpha_composite(lg, (text_x0, H - 140) if not left else (W - 150, H - 140))
    elif photo:
        im, cut = photo
        img = background(W, H, pal, rnd, (W / 2, H * 0.6))
        lg = logo.resize((220, 220), Image.LANCZOS)
        img.alpha_composite(lg, (W // 2 - 110, 60))
        bottom = headline(img, cfg, n, W / 2, 300, 960, 180)
        top, room = bottom + 50, (H - 300) - (bottom + 50)
        if cut:
            layer = cutout_photo(im, 980, room + 120, 1.3)
            img.alpha_composite(layer, (int(W / 2 - layer.width / 2), int(H - 260 - layer.height)))
            st_xy = (int(W / 2 + layer.width / 2 - 210), int(H - 260 - layer.height + 20))
        else:
            ph = int(min(room, 1000))
            pw = int(min(900, ph * 0.86))
            layer = framed_photo(im, pw, ph, pal, 1.3)
            cy = top + room / 2
            paste_rotated(img, layer, W / 2, cy, tilt)
            st_xy = (int(W / 2 + pw / 2 - 150), int(cy + ph / 2 - 170))
        img.alpha_composite(sticker(stk, 200, pal, secs), st_xy)
        hook_pill(img, hook, W / 2, H - 170, 980, 78, pal, -tilt * 0.6)
    elif wide:
        card_left = rnd.random() < 0.5
        card_cx = 360 if card_left else 920
        text_x0 = 650 if card_left else 50
        img = background(W, H, pal, rnd, (card_cx, H * 0.45))
        card = question_card(q, 520, pal, rnd, 0.82)
        cy = H / 2 + 10
        paste_rotated(img, card, card_cx, cy, tilt)
        # Sticker on the card's bottom-right corner: the end of the answer rows is usually empty
        st = sticker(stk, 150, pal, secs)
        img.alpha_composite(st, (int(card_cx + card.width / 2 - 95), int(cy + card.height / 2 - 115)))
        bottom = headline(img, cfg, n, 0, 70, 580, 150, align_left=text_x0)
        hook_pill(img, hook, text_x0 + 290, min(bottom + 70, H - 150), 600, 52, pal, -tilt * 0.6)
        lg = logo.resize((120, 120), Image.LANCZOS)
        img.alpha_composite(lg, (text_x0, H - 140) if not card_left else (W - 150, H - 140))
    else:
        img = background(W, H, pal, rnd, (W / 2, H * 0.62))
        lg = logo.resize((260, 260), Image.LANCZOS)
        img.alpha_composite(lg, (W // 2 - 130, 70))
        bottom = headline(img, cfg, n, W / 2, 360, 960, 190)
        # The card fills the space between the headline and the hook, shrinking if the title is long
        room = (H - 300) - (bottom + 70)
        sc = 1.3
        card = question_card(q, 900, pal, rnd, sc)
        if card.height > room:
            sc *= room / card.height
            card = question_card(q, int(900 * sc / 1.3), pal, rnd, sc)
        cy = bottom + 70 + room / 2
        paste_rotated(img, card, W / 2, cy, tilt)
        st = sticker(stk, 200, pal, secs)
        img.alpha_composite(st, (int(W / 2 + card.width / 2 - 130), int(cy + card.height / 2 - 150)))
        hook_pill(img, hook, W / 2, H - 170, 980, 78, pal, -tilt * 0.6)

    out = img.convert("RGB")
    tmp = job_dir / "thumbnail.tmp.jpg"
    for quality in (92, 86, 78, 70):
        out.save(tmp, "JPEG", quality=quality, optimize=True, progressive=True)
        if tmp.stat().st_size < 2 * 1024 * 1024 - 50_000:
            break
    tmp.replace(job_dir / "thumbnail.jpg")
    (job_dir / "thumbnail.json").write_text(json.dumps(dict(seed=seed, width=W, height=H, hook=hook, question=q["q"])), encoding="utf-8")
    return job_dir / "thumbnail.jpg"


if __name__ == "__main__":
    print(design(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None))
