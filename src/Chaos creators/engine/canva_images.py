"""Chaos Creators: using the Canva designs made for a video (src/modules/chaos/canva-jobs.ts).

The web app saves Canva's PNG exports in <job>/canva/ (thumbnail-p1.png, screens-p1.png ... or
intro-p1.png / outro-p1.png for Shorts) and writes canva/status.json. This module:
  * waits for status.json to leave "running" (the engine does this before drawing the intro);
  * picks the real pages (Canva sometimes adds a blank page) and fits them to the video's sizes;
  * makes thumbnail.jpg from the Canva thumbnail (whole design kept, logo bottom-left, < 2 MB).

Run:  python canva_images.py thumbnail <job-dir>     (after the web app saved new thumbnail pages)
"""
import json, pathlib, sys, time

import numpy as np
from PIL import Image, ImageFilter

FINAL = {"youtube": (1280, 720), "shorts": (1080, 1920)}


def status(job_dir):
    try:
        return json.loads((pathlib.Path(job_dir) / "canva" / "status.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def wait_done(job_dir, timeout=None, tick=None):
    """Waits while the web app is still making the designs. Returns the final status (or None).
    Allows 8 minutes plus a minute per question picture asked for."""
    t0 = time.time()
    if timeout is None:
        timeout = 8 * 60 + 60 * int((status(job_dir) or {}).get("questionsPlanned") or 0)
    while True:
        st = status(job_dir)
        if not st or st.get("state") != "running":
            return st
        if time.time() - t0 > timeout:
            print(f"[canva] still not ready after {int(timeout)} s: using what is there", flush=True)
            return None
        if tick:
            tick(time.time() - t0)
        time.sleep(2)


def pages(job_dir, name):
    """The real (not blank) pages Canva exported for one design, in order."""
    out = []
    for p in sorted((pathlib.Path(job_dir) / "canva").glob(f"{name}-p*.png"), key=lambda p: int(p.stem.rsplit("p", 1)[1])):
        try:
            im = Image.open(p).convert("RGB")
        except Exception:
            continue
        small = np.asarray(im.resize((64, 64)), np.float32)
        if small.std() < 6:  # one flat colour: a blank page
            print(f"[canva] {p.name} is blank, skipped", flush=True)
            continue
        out.append(p)
    return out


def screens(job_dir, fmt):
    """{"intro": path, "outro": path} for the engine's templates (only the ones Canva made)."""
    if fmt == "youtube":
        found = pages(job_dir, "screens")
        if not found:
            return {}
        return {"intro": str(found[0]), "outro": str(found[1] if len(found) > 1 else found[0])}
    out = {}
    for kind in ("intro", "outro"):
        found = pages(job_dir, kind)
        if found:
            out[kind] = str(found[0])
    return out


def question_files(job_dir, n):
    """Per question (0-based list of n): the Canva background picture, or None."""
    out = []
    for i in range(n):
        found = pages(job_dir, f"q{i + 1}")
        out.append(str(found[0]) if found else None)
    return out


def fit_contain(im, W, H):
    """The whole design (text included) on a W x H canvas. Almost the right shape: scaled and trimmed a
    few pixels. Otherwise the empty sides get a blurred, darkened copy so no text is ever cut off."""
    if abs(im.width / im.height - W / H) < 0.02:
        s = max(W / im.width, H / im.height)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        x, y = (im.width - W) // 2, (im.height - H) // 2
        return im.crop((x, y, x + W, y + H))
    s = max(W / im.width, H / im.height)
    back = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (back.width - W) // 2, (back.height - H) // 2
    back = back.crop((x, y, x + W, y + H))
    back = Image.blend(back.filter(ImageFilter.GaussianBlur(28)), Image.new("RGB", (W, H), (10, 6, 24)), 0.35)
    s = min(W / im.width, H / im.height)
    front = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    back.paste(front, ((W - front.width) // 2, (H - front.height) // 2))
    return back


def make_thumbnail(job_dir):
    """thumbnail.jpg from Canva's thumbnail design. False when there is none."""
    from quiz_video import TEMPLATE, load_cfg, round_logo
    job_dir = pathlib.Path(job_dir)
    found = pages(job_dir, "thumbnail")
    if not found:
        return False
    spec = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    fmt = spec.get("format", "shorts")
    W, H = FINAL[fmt]
    out = fit_contain(Image.open(found[0]).convert("RGB"), W, H).convert("RGBA")
    try:
        logo = round_logo(TEMPLATE / load_cfg(spec)["logo"])
        size = 110 if fmt == "youtube" else 170
        out.alpha_composite(logo.resize((size, size), Image.LANCZOS), (22, H - size - 22))
    except Exception as e:  # the logo is a nice-to-have
        print(f"[canva] logo skipped: {e}", flush=True)
    out = out.convert("RGB")
    tmp = job_dir / "thumbnail.tmp.jpg"
    for quality in (92, 86, 78, 70):
        out.save(tmp, "JPEG", quality=quality, optimize=True, progressive=True)
        if tmp.stat().st_size < 2 * 1024 * 1024 - 50_000:
            break
    tmp.replace(job_dir / "thumbnail.jpg")
    st = status(job_dir) or {}
    (job_dir / "thumbnail.json").write_text(json.dumps(dict(canva=True, page=found[0].name, width=W, height=H, design=(st.get("designs") or {}).get("thumbnail"))), encoding="utf-8")
    return True


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "thumbnail":
        if not make_thumbnail(sys.argv[2]):
            print("Canva's export had no usable page.", file=sys.stderr)
            sys.exit(2)
        print("ok")
    else:
        print(__doc__)
        sys.exit(1)
