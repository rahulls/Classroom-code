"""Edu video narration: <item>/script.json -> one AI-voice clip per scene, scene timings, word
timings, caption chunks and the full sound track (voice + a soft whoosh on each scene change; no
music, Rahul adds his own).

Run with the Chaos engine venv:  python voice.py <item folder>
Writes <item>/timing.json, <item>/audio.wav and <item>/logo_round.png. scenes.py reads timing.json
so every scene lasts exactly as long as its narration, and things appear on the word that names them."""
import json, os, pathlib, re, sys

import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
CHAOS = HERE.parents[1] / "Chaos creators"
sys.path.insert(0, str(CHAOS / "engine"))
import quiz_video as qv  # noqa: E402  (Kokoro voice, sound decoding, logo cut-out)

LEAD, TAIL = 0.30, 0.45          # silence before / after each scene's narration (s)


def weight(w):
    """How long a word takes, roughly: its letters, plus a pause after punctuation."""
    return max(2, len(re.sub(r"[^A-Za-z0-9]", "", w))) + (5 if re.search(r"[.?!:]$", w) else 2.5 if re.search(r"[,;]$", w) else 0)


def chunks(words, most):
    """Caption chunks of up to `most` words, never across a sentence or comma break."""
    out, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= most or re.search(r"[.,?!:;]$", w["w"]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def main(item):
    item = pathlib.Path(item)
    script = json.loads((item / "script.json").read_text(encoding="utf-8"))
    home = pathlib.Path(os.environ.get("CHAOS_HOME") or pathlib.Path(os.environ["LOCALAPPDATA"]) / "RSC Classroom" / "chaos")
    voice = qv.Voice({"voice": script.get("voice", "af_heart")}, home / "models")
    speed = float(script.get("speed", 1.0))
    most = 4 if script.get("format", "short") == "short" else 6

    whoosh_files = sorted(p for p in (qv.SOUNDS_DIR / "whoosh").iterdir() if p.suffix.lower() in qv.SOUND_EXT)
    whoosh = qv.decode_sound(whoosh_files[0]) * 0.3 if whoosh_files else np.zeros(1, np.float32)
    parts, scenes, t = [], [], 0.0
    n = len(script["scenes"])
    for i, sc in enumerate(script["scenes"]):
        say = re.sub(r"\s+", " ", sc["say"]).strip()
        s = voice.say(say, speed=speed)
        talk = len(s) / qv.SR
        dur = LEAD + talk + TAIL
        clip = np.zeros(int(dur * qv.SR), np.float32)
        a = int(LEAD * qv.SR)
        clip[a:a + len(s)] += s
        if i:
            w = whoosh[:len(clip)]
            clip[:len(w)] += w
        parts.append(clip)
        raw = say.split()
        total = sum(weight(w) for w in raw) or 1
        at, words = t + LEAD, []
        for w in raw:
            d = talk * weight(w) / total
            words.append({"w": w, "start": round(at, 3), "end": round(at + d, 3)})
            at += d
        caps = [{"text": " ".join(x["w"] for x in c), "start": c[0]["start"], "end": c[-1]["end"]} for c in chunks(words, most)]
        scenes.append({"index": i, "type": sc.get("type", ""), "start": round(t, 3), "dur": round(dur, 3),
                       "talk": [round(t + LEAD, 3), round(t + LEAD + talk, 3)], "words": words, "captions": caps})
        t += dur
        print(f"[voice] {i + 1}/{n}", flush=True)
    audio = np.clip(np.concatenate(parts), -0.98, 0.98)
    sf.write(str(item / "audio.wav"), audio, qv.SR)
    (item / "timing.json").write_text(json.dumps({"total": round(t, 3), "scenes": scenes}, indent=1), encoding="utf-8")
    make_logo(item)
    print(f"[voice] done: {n} scenes, {t:.1f} s", flush=True)


def make_logo(item):
    """The Edu channel's logo (logo_src.* copied in by the app) as a round badge, logo_round.png.
    A logo that is already a cut-out (transparent corners) is kept as it is; a square/photo logo is
    cut to a circle. No logo uploaded: no logo_round.png, and the video simply has no logo."""
    out = item / "logo_round.png"
    out.unlink(missing_ok=True)
    src = next(iter(sorted(item.glob("logo_src.*"))), None)
    if not src:
        return
    from PIL import Image, ImageDraw
    im = Image.open(src).convert("RGBA")
    bbox = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    corners = [im.getpixel((0, 0))[3], im.getpixel((w - 1, 0))[3], im.getpixel((0, h - 1))[3], im.getpixel((w - 1, h - 1))[3]]
    S = max(w, h)
    if max(corners) < 40:  # already a cut-out: centre it on a transparent square
        sq = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        sq.paste(im, ((S - w) // 2, (S - h) // 2), im)
    else:  # square / photo: centre-crop and cut a circle
        S = min(w, h)
        sq = im.crop(((w - S) // 2, (h - S) // 2, (w - S) // 2 + S, (h - S) // 2 + S))
        m = Image.new("L", (S * 4, S * 4), 0)
        ImageDraw.Draw(m).ellipse([0, 0, S * 4 - 1, S * 4 - 1], fill=255)
        sq.putalpha(Image.composite(sq.getchannel("A"), Image.new("L", (S, S), 0), m.resize((S, S), Image.LANCZOS)))
    if S > 800:
        sq = sq.resize((800, 800), Image.LANCZOS)
    sq.save(out)


if __name__ == "__main__":
    main(sys.argv[1])
