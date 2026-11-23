"""Explainer narration: script.json -> one AI-voice clip per scene, the scene timings, caption
chunks and the full sound track (voice + a whoosh on each scene change; no music, Rahul adds it).

Run with the engine venv:  python voice.py <explainer folder> <work folder>
Writes <work>/timing.json and <work>/audio.wav. The animation (scenes.py) reads timing.json so
every scene lasts exactly as long as its narration."""
import json, pathlib, re, sys

import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "engine"))
import quiz_video as qv  # noqa: E402

LEAD, TAIL = 0.30, 0.45          # silence before / after each scene's narration (s)


def chunks(text, most=4):
    """Caption chunks of up to `most` words, never across a sentence or comma break."""
    out, cur = [], []
    for w in text.split():
        cur.append(w)
        if len(cur) >= most or re.search(r"[.,?!]$", w):
            out.append(" ".join(cur))
            cur = []
    if cur:
        out.append(" ".join(cur))
    return out


def weight(c):
    return len(re.sub(r"[^A-Za-z0-9]", "", c)) + (4 if re.search(r"[.?!]$", c) else 2 if c.endswith(",") else 0)


def main(src, work):
    src, work = pathlib.Path(src), pathlib.Path(work)
    work.mkdir(parents=True, exist_ok=True)
    script = json.loads((src / "script.json").read_text(encoding="utf-8"))
    import os
    home = pathlib.Path(os.environ["LOCALAPPDATA"]) / "RSC Classroom" / "chaos"
    voice = qv.Voice({"voice": script.get("voice", "af_heart")}, home / "models")
    speed = float(script.get("speed", 1.0))

    whoosh = qv.decode_sound(sorted(p for p in (qv.SOUNDS_DIR / "whoosh").iterdir() if p.suffix.lower() in qv.SOUND_EXT)[0]) * 0.35
    parts, scenes, t = [], [], 0.0
    for i, sc in enumerate(script["scenes"]):
        s = voice.say(sc["say"], speed=speed)
        dur = LEAD + len(s) / qv.SR + TAIL
        clip = np.zeros(int(dur * qv.SR), np.float32)
        a = int(LEAD * qv.SR)
        clip[a:a + len(s)] += s
        if i:
            w = whoosh[:len(clip)]
            clip[:len(w)] += w
        parts.append(clip)
        cs = chunks(sc["say"])
        total = sum(weight(c) for c in cs)
        talk, at, caps = len(s) / qv.SR, t + LEAD, []
        for c in cs:
            d = talk * weight(c) / total
            caps.append({"text": c, "start": round(at, 3), "end": round(at + d, 3)})
            at += d
        scenes.append({"id": sc["id"], "start": round(t, 3), "dur": round(dur, 3), "say": sc["say"], "captions": caps})
        t += dur
    audio = np.concatenate(parts)
    audio = np.clip(audio, -0.98, 0.98)
    sf.write(str(work / "audio.wav"), audio, qv.SR)
    qv.round_logo(HERE.parent / "chaos_creators_logo.png").save(work / "logo_round.png")
    (work / "timing.json").write_text(json.dumps({"total": round(t, 3), "scenes": scenes}, indent=1), encoding="utf-8")
    print(f"[voice] {len(scenes)} scenes, {t:.1f} s")
    for sc in scenes:
        print(f"  {sc['id']:10s} {sc['dur']:5.2f} s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
