"""Chaos Creators "Did you know?" facts video engine (the studio's Facts video type).

Same look, sounds, voices and render pipeline as quiz_video.py (imported from it, never changed by
it), with a fact screen instead of a question: the topic badge and a "Fact 3/10" counter on top, a
"DID YOU KNOW?" pill, a sticker picture (Canva art) and the headline card popping in, the detail
under it, over a Canva background per fact. No timer: each fact stays for its narration + about
1 second (5-10 s).

Run:  python facts_video.py <job-dir>                   make the video
      python facts_video.py thumbnail <job-dir> [seed]  design a new thumbnail (no Canva)
The job dir holds facts.csv (headline, detail, narration, seconds, image, audio) and job.json:
  {"kind": "facts", "format", "settings", "narration": "ai" | "record", "middles": [{"before", "file"}]}
"audio" is the reader's recording (narration/<key>.webm from the studio's recording deck); empty = AI voice.
"middles" are the reader's own middle lines (record mode). In AI mode the middle lines are the
prebuilt kid recordings (sounds/kid voice sounds), when the kid voice is on.
"""
import csv, json, math, os, pathlib, random, subprocess, sys, time, traceback, zlib
from multiprocessing import get_context

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import quiz_video as qv
from quiz_video import G, FPS, SR, INK, ACC, font, ease, pop, wrap, clip_lines, fit_font, composite, paste_logo, badge_pill

IMAGES_DIR = qv.ENGINE.parent / "images"
PINK, GOLD = (255, 92, 141), (255, 179, 0)

# Screen and voice texts for facts videos (the quiz texts in quiz-template/settings.json talk about
# questions and scores). A video's own settings (badge, intro tag, title lines) still win.
FACTS_TEXT = {
    "quiz_badge": "AMAZING FACTS",
    "intro_badge": "DID YOU KNOW?",
    "title_lines": ["Amazing", "Facts"],
    "intro_lines": ["{n} facts you didn't know", "Watch till the end!"],
    "intro_voice": "Did you know? Here are {n} amazing facts {about}that you probably never heard before. Let's go!",
    # Short words: the Shorts ending draws its title at a fixed size (quiz_video.draw_outro_tall)
    "outro_title": ["Mind", "blown?"],
    "outro_lines": ["Which fact surprised you most?", "Tell us in the comments!", "Subscribe for more facts"],
    "outro_voice": "Which fact surprised you the most? Tell us in the comments, and subscribe to {channel} for more amazing facts!",
}
FACTS_TEXT_YOUTUBE = {
    "outro_title": ["Thanks for", "watching!"],
    "outro_lines": ["Which fact surprised you most?", "Comment below, like and subscribe", "for more amazing facts"],
    "outro_voice": "Thank you for watching! Which fact surprised you the most? Tell us in the comments, like this video, "
                   "and subscribe to {channel} for more amazing facts!",
}
# Badge words kept in capitals (badges are all capitals, so word length can't tell). Same list in facts.ts.
ACRONYMS = {"GK", "AI", "DNA", "NASA", "ISRO", "IPL", "GTA", "USA", "UK", "UAE", "FIFA", "NBA", "WWE", "ICC", "BCCI", "F1", "UN"}
FACT_WORDS = {"fact", "facts", "did", "you", "know", "know?", "amazing", "fun", "trivia", "crazy", "mind-blowing"}


def facts_topic(settings):
    """"space" from the badge "SPACE FACTS" (or the intro title lines); "" when there is no topic word."""
    words = str(settings.get("quiz_badge") or "").split() or " ".join(settings.get("title_lines") or []).split()
    keep = [w for w in words if w.lower().strip("?!.,") not in FACT_WORDS]
    out = []
    for w in keep:
        out.append(w.upper() if w.upper() in ACRONYMS else w.lower() if w.isupper() else w)
    return " ".join(out)


def load_cfg(spec):
    cfg = qv.load_cfg(spec)
    own = spec.get("settings") or {}
    texts = dict(FACTS_TEXT)
    if spec.get("format") == "youtube":
        texts.update(FACTS_TEXT_YOUTUBE)
    for k, v in texts.items():
        if own.get(k) in (None, "", []):
            cfg[k] = v
    cfg["facts_topic"] = facts_topic(own)
    return cfg


def spoken_text(headline, detail, narration):
    if narration.strip():
        return narration.strip()
    end = lambda s: s if s[-1:] in ".!?…" else s + "."
    return " ".join(end(s.strip()) for s in (headline, detail) if s.strip())


def load_facts(job_dir, limit=None):
    job_dir = pathlib.Path(job_dir)
    out = []
    with open(job_dir / "facts.csv", newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            if not row.get("headline"):
                continue
            secs = row.get("seconds", "")
            image = row.get("image", "")
            img = IMAGES_DIR / image if image and "/" not in image and "\\" not in image else None
            audio = row.get("audio", "")
            apath = (job_dir / audio) if audio else None
            out.append(dict(headline=row["headline"], detail=row.get("detail", ""),
                            spoken=spoken_text(row["headline"], row.get("detail", ""), row.get("narration", "")),
                            seconds=max(3, min(20, int(secs))) if secs.isdigit() else None,
                            image=str(img) if img and img.is_file() else None,
                            audio=str(apath) if apath and apath.is_file() else None))
    if limit:
        out = out[:limit]
    if not out:
        raise ValueError("No facts found in the CSV.")
    return out


# ============================== voices ==============================
def load_recording(path):
    """A recording from the studio's deck: mono, silence trimmed at both ends, levelled like every voice."""
    s = qv.decode_sound(path)
    if len(s) < int(0.2 * SR):
        raise ValueError("recording too short")
    s = s - np.float32(s.mean())                        # laptop mics can add a DC offset
    loud = np.flatnonzero(np.abs(s) > np.abs(s).max() * 0.04)
    if len(loud):
        s = s[max(0, loud[0] - int(0.03 * SR)):loud[-1] + int(0.12 * SR)]
    n = min(len(s), int(0.01 * SR))
    s[:n] *= np.linspace(0, 1, n, dtype=np.float32)
    s[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
    return qv.level_voice(s)


class KidFacts(qv.KidVoice):
    """The kid recordings, picked for facts videos: no lines about questions, scores or challenges."""
    INTROS = [("intro_01", "intro_02", "intro_04"), ("introalt_01", "introalt_02", "intro_04")]  # hey everyone / welcome / let's begin
    SHORT_ENDING = ("ending_01", "endalt_06", "ending_07_")                 # that's a wrap / keep creating chaos / bye
    LONG_ENDING = ("ending_01", "mix_09", "endalt_06", "ending_07_")        # ... + don't forget to subscribe
    GENERIC, HALFWAY = ("mix_03",), "mix_06"                                # doing great / halfway there
    FACTS_FOLDER = "6_facts_middle"                                         # optional fact-style lines ("wait till you hear this")

    def intro(self):
        return self._join([self._file(p) for p in self.r.choice(self.INTROS)])

    def ending(self):
        return self._join([self._file(p) for p in (self.LONG_ENDING if self.fmt == "youtube" else self.SHORT_ENDING)])

    def middle_plan(self, n):
        """{fact index: clip}: a Short gets one line before fact 3 or 4; long videos get "halfway"
        in the middle and a line about every 5 facts."""
        if n < 4:
            return {}
        d = self.dir / self.FACTS_FOLDER
        extra = sorted(p for p in d.iterdir() if p.suffix.lower() in qv.SOUND_EXT) if d.is_dir() else []
        generic = [p for p in [self._file(x) for x in self.GENERIC] + extra if p]
        halfway = self._file(self.HALFWAY)
        if not generic and not halfway:
            return {}
        if self.fmt != "youtube":
            qi = self.r.choice([2, 3])
            pool = generic + ([halfway] if halfway and qi == n // 2 else [])
            return {qi: self._load(self.r.choice(pool or [halfway]))}
        plan = {}
        if halfway:
            plan[n // 2] = halfway
        self.r.shuffle(generic)
        for qi in range(5, n - 1, 5):
            if generic and all(abs(qi - k) >= 3 for k in plan):
                plan[qi] = generic[len(plan) % len(generic)]
        return {qi: self._load(p) for qi, p in sorted(plan.items()) if 0 < qi < n}


# ============================== timeline ==============================
def _own(path, what):
    """The reader's own intro / ending recording, or None (then the kid voice or the AI voice does it)."""
    if not path:
        return None
    try:
        return load_recording(path)
    except Exception as e:
        print(f"[{what}] recording unusable ({e}): kid voice / AI instead", flush=True)
        return None


def build_timeline(cfg, facts, voice, job, sounds, kid=None, own_middles=None, own_intro=None, own_outro=None):
    """Events (what is on screen when) and the full audio mix, like quiz_video.build_timeline."""
    N = len(facts)
    about = f"about {cfg['facts_topic']} " if cfg.get("facts_topic") else ""
    fmt = lambda s: (s.replace("{n}", str(N)).replace("{channel}", cfg["channel_name"]).replace("{about}", about)
                     .replace("{topic}", cfg.get("facts_topic") or "amazing facts").replace("{seconds}", ""))
    events, audio, voices, spans, human_spans = [], [], [], [], []
    add = lambda at, s: audio.append((at, s))

    def say_at(at, s, human=False):
        voices.append((at, s))
        spans.append((at, at + len(s) / SR))
        if human:
            human_spans.append((at, at + len(s) / SR, qv.active_rms(s)))

    whooshes = sounds.get("whoosh", 0.2, 2.0, count=3) or [qv.whoosh() for _ in range(3)]
    intro_sting = sounds.get("intro", 0.7, 6.0)
    outro_sting = sounds.get("outro", 0.55, 9.0)
    POP = qv.popsnd()

    SLAM = 0.9
    if intro_sting is not None:
        add(0.0, intro_sting)
    else:
        add(0.1, qv.riser(SLAM - 0.1))
        add(SLAM, qv.impact())
    job.progress("voice", 0, N + 2, "Recording the narration", force=True)
    intro_vo = _own(own_intro, "intro")
    if intro_vo is None and kid:
        intro_vo = kid.intro()
    intro_kid = intro_vo is not None
    if intro_vo is None:
        intro_vo = voice.say(fmt(cfg["intro_voice"]))
    # Middle lines: the reader's own (record mode) or the prebuilt kid lines (AI mode)
    middles = {}
    for m in own_middles or []:
        try:
            middles[int(m["before"])] = load_recording(job.dir / m["file"])
        except Exception as e:
            print(f"[middle] skipped {m}: {e}", flush=True)
    if own_middles is None and kid:
        middles = kid.middle_plan(N)
    VO_AT = SLAM + 0.9
    say_at(VO_AT, intro_vo, intro_kid)
    t = max(VO_AT + len(intro_vo) / SR + 1.0, 7.5)
    events.append(dict(kind="intro", start=0, end=t, phase2=VO_AT + 1.6, slam=SLAM))

    for i, f in enumerate(facts):
        job.progress("voice", i + 1, N + 2, "Recording the narration")
        add(t, whooshes[i % len(whooshes)])
        lead = 0.0
        if i in middles:                                # "halfway there!" before the fact comes up
            say_at(t + 0.35, middles[i], True)
            lead = len(middles[i]) / SR + 0.4
        card = t + 0.3 + lead
        add(card, POP)
        rec = None
        if f["audio"]:
            try:
                rec = load_recording(f["audio"])
            except Exception as e:
                print(f"[fact {i + 1}] recording unusable ({e}): AI voice instead", flush=True)
        nar = rec if rec is not None else voice.say(f["spoken"])
        say_at(card + 0.45, nar, rec is not None)
        talk = len(nar) / SR
        hold = f["seconds"] or min(10.0, max(5.0, talk + 1.0))
        hold = max(hold, talk + 0.45 + 0.7)             # never cut the narration
        events.append(dict(kind="fact", idx=i, f=f, start=t, card=card, end=card + hold))
        t = card + hold

    outro_vo = _own(own_outro, "ending")
    if outro_vo is None and kid:
        outro_vo = kid.ending()
    outro_kid = outro_vo is not None
    if outro_vo is None:
        outro_vo = voice.say(fmt(cfg["outro_voice"]))
    add(t + 0.1, whooshes[0])
    if outro_sting is not None:
        add(t + 0.2, outro_sting)
    else:
        add(t + 0.3, qv.impact() * 0.6)
    say_at(t + 0.7, outro_vo, outro_kid)
    events.append(dict(kind="outro", start=t, end=t + 0.7 + len(outro_vo) / SR + 1.8))
    total = events[-1]["end"]

    def track(items):
        out = np.zeros(int((total + 2) * SR), np.float32)
        for at, s in items:
            i = int(at * SR)
            out[i:i + len(s)] += s[:len(out) - i]
        return out[:int(total * SR)]
    rest = track(audio)
    bed = qv.music_bed(sounds, cfg, total, spans)
    if bed is not None:
        rest[:len(bed)] += bed
    speech = track(voices)
    # Same as quiz videos: while a human recording plays, everything else stays at no more than half its level
    ratio = float(cfg.get("kid_bed_ratio", 0.5))
    gain = np.ones(len(rest), np.float32)
    fade = int(0.15 * SR)
    for a, b, hrms in human_spans:
        i0, i1 = max(0, int(a * SR)), min(len(rest), int(b * SR))
        if i1 <= i0:
            continue
        orms = qv.active_rms(rest[i0:i1])
        if orms <= 1e-6 or orms <= ratio * hrms:
            continue
        g = ratio * hrms / orms
        lo, hi = max(0, i0 - fade), min(len(rest), i1 + fade)
        env = np.ones(hi - lo, np.float32)
        env[i0 - lo:i1 - lo] = g
        env[:i0 - lo] = np.linspace(1, g, i0 - lo)
        env[i1 - lo:] = np.linspace(g, 1, hi - i1)
        gain[lo:hi] = np.minimum(gain[lo:hi], env)
    mix = speech + rest * gain
    mix /= max(1.0, np.abs(mix).max() / 0.95)
    return events, mix, total


# ============================== visuals ==============================
def sticker_card(path, size, tilt):
    """A picture as a white-framed, tilted sticker with a soft shadow (RGBA), or None."""
    try:
        src = Image.open(path).convert("RGB")
    except Exception as e:
        print(f"[sticker] {path}: {e}", flush=True)
        return None
    side = min(src.size)
    src = src.crop(((src.width - side) // 2, (src.height - side) // 3, (src.width - side) // 2 + side, (src.height - side) // 3 + side))
    b = max(8, size // 24)
    inner = src.resize((size - 2 * b, size - 2 * b), Image.LANCZOS)
    card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], size // 8, fill=255)
    card.paste((255, 255, 255, 255), (0, 0), m)
    mi = Image.new("L", inner.size, 0)
    ImageDraw.Draw(mi).rounded_rectangle([0, 0, inner.width - 1, inner.height - 1], size // 11, fill=255)
    card.paste(inner, (b, b), mi)
    return _tilt_shadow(card, tilt)


def bulb_card(size, tilt, color):
    """No picture for this fact: a bright "?" badge instead."""
    S = size * 2
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for k in range(12):                                  # rays
        a = k / 12 * 2 * math.pi
        d.line([(S / 2 + math.cos(a) * S * 0.36, S / 2 + math.sin(a) * S * 0.36),
                (S / 2 + math.cos(a) * S * 0.48, S / 2 + math.sin(a) * S * 0.48)], fill=(255, 255, 255, 200), width=S // 40)
    r = S * 0.33
    d.ellipse([S / 2 - r - S * 0.02, S / 2 - r - S * 0.02, S / 2 + r + S * 0.02, S / 2 + r + S * 0.02], fill=(255, 255, 255, 255))
    d.ellipse([S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r], fill=color + (255,))
    d.text((S / 2, S / 2 + S * 0.02), "?", font=font("Bold", S * 0.46), fill=INK, anchor="mm")
    return _tilt_shadow(im.resize((size, size), Image.LANCZOS), tilt)


def _tilt_shadow(card, tilt):
    rot = card.rotate(tilt, resample=Image.BICUBIC, expand=True)
    sh = Image.new("RGBA", rot.size, (0, 0, 0, 0))
    sh.putalpha(rot.getchannel("A").point(lambda v: int(v * 0.5)).filter(ImageFilter.GaussianBlur(12)))
    out = Image.new("RGBA", (rot.width + 20, rot.height + 20), (0, 0, 0, 0))
    out.alpha_composite(sh, (14, 16))
    out.alpha_composite(rot, (0, 0))
    return out


def fact_sticker(idx, size):
    cache = G.setdefault("FST", {})
    if (idx, size) not in cache:
        files = G["CFG"].get("fact_stickers") or []
        f = G["FACTS"][idx]
        path = (files[idx] if idx < len(files) else None) or f.get("image")
        tilt = -6 if idx % 2 else 6
        st = sticker_card(path, size, tilt) if path else None
        cache[(idx, size)] = st if st is not None else bulb_card(size, tilt, ACC[idx % len(ACC)])
    return cache[(idx, size)]


def paste_sticker(img, idx, cx, cy, size, k):
    if k <= 0:
        return
    st = fact_sticker(idx, size)
    if k < 1 or abs(k - 1) > 1e-3:
        s = max(0.05, pop(k) if k < 1 else 1)
        st = st.resize((max(1, int(st.width * s)), max(1, int(st.height * s))), Image.LANCZOS)
        if k < 1:
            st = st.copy()
            st.putalpha(st.getchannel("A").point(lambda v: int(v * min(1, k * 1.6))))
    composite(img, st, int(cx - st.width / 2), int(cy - st.height / 2))


def header(img, d, idx, wide):
    N, W = G["N"], G["W"]
    counter = f"Fact {idx + 1}/{N}"
    if wide:
        paste_logo(img, "mark", 110, 92, 112)
        badge_pill(d, G["CFG"].get("quiz_badge", "AMAZING FACTS"), 186, 64, 120, 34, min(1100, W - 60 - d.textlength(counter, font=font("Bold", 38)) - 40))
        d.text((W - 60, 92), counter, font=font("Bold", 38), fill="white", anchor="rm")
        d.rounded_rectangle([60, 162, W - 60, 174], 6, fill=(255, 255, 255, 40))
        d.rounded_rectangle([60, 162, 60 + (W - 120) * (idx + 1) / N, 174], 6, fill=GOLD)
    else:
        paste_logo(img, "mark", 118, 130, 128)
        badge_pill(d, G["CFG"].get("quiz_badge", "AMAZING FACTS"), 200, 98, 162, 38, 1020 - d.textlength(counter, font=font("Bold", 38)) - 30)
        d.text((1020, 130), counter, font=font("Bold", 38), fill="white", anchor="rm")
        d.rounded_rectangle([60, 222, 1020, 236], 7, fill=(255, 255, 255, 40))
        d.rounded_rectangle([60, 222, 60 + 960 * (idx + 1) / N, 236], 7, fill=GOLD)


def layout(d, idx, wide):
    """Where the pill, headline card, detail and sticker go for fact idx (worked out once)."""
    cache = G.setdefault("FLAY", {})
    if idx in cache:
        return cache[idx]
    f = G["FACTS"][idx]
    if wide:
        x0, x1, size, dsize, top_min, bottom = 60, 1170, 62, 40, 300, 1030
    else:
        x0, x1, size, dsize, top_min, bottom = 60, 1020, 68, 44, 820, 1660
    maxw = x1 - x0 - 100
    F = font("Bold", size)
    lines = wrap(d, f["headline"], F, maxw)
    while len(lines) > 4 and size > 42:
        size -= 4
        F = font("Bold", size)
        lines = wrap(d, f["headline"], F, maxw)
    lines = clip_lines(lines, 5)
    FD = font("Medium", dsize)
    dlines = clip_lines(wrap(d, f["detail"], FD, maxw + 20), 4 if wide else 5) if f["detail"] else []
    ch = int(len(lines) * size * 1.22 + 96)
    dh = int(len(dlines) * dsize * 1.38 + 64) if dlines else 0
    block = ch + (28 + dh if dlines else 0)
    if wide:
        top = max(top_min, (top_min + bottom) / 2 - block / 2 + 20)
        st = dict(cx=1530, cy=620, size=560)
    else:
        top = max(top_min, min(1120, bottom - block))
        room = (top - 40) - 400
        st = dict(cx=540, cy=400 + room / 2, size=int(max(300, min(600, room - 30))))
    L = dict(x0=x0, x1=x1, F=F, lines=lines, FD=FD, dlines=dlines, top=top, ch=ch, dh=dh, st=st,
             pill=(x0, 218, 286) if wide else (540, 292, 362))
    cache[idx] = L
    return L


def draw_fact(img, seg, tt, sticker=True):
    wide = G["FORMAT"] == "youtube"
    d = ImageDraw.Draw(img, "RGBA")
    idx = seg["idx"]
    header(img, d, idx, wide)
    L = layout(d, idx, wide)
    # "DID YOU KNOW?" pill: as soon as the fact comes up (a middle line may play before the card)
    pk = ease((tt - seg["start"] - 0.1) / 0.35)
    if pk > 0:
        text = "DID YOU KNOW?"
        F = font("Bold", 36 if wide else 40)
        w = d.textlength(text, font=F) + 70
        px, y0, y1 = L["pill"]
        x = px if wide else px - w / 2
        yo = 20 * (1 - pk)
        d.rounded_rectangle([x, y0 - yo, x + w, y1 - yo], (y1 - y0) // 2, fill=PINK + (int(255 * pk),))
        d.text((x + w / 2, (y0 + y1) / 2 - yo), text, font=F, fill=(255, 255, 255, int(255 * pk)), anchor="mm")
    c = seg["card"]
    if tt < c + 0.3 and c - seg["start"] > 0.8:
        # A middle line is playing before this fact: a big "FACT 4" teaser that pops in, then makes way for the card
        a = ease((tt - seg["start"] - 0.15) / 0.35) * (1 - ease((tt - c + 0.1) / 0.3))
        if a > 0:
            txt = f"FACT {idx + 1}"
            size = (190 if wide else 200) * pop(min(1, (tt - seg["start"] - 0.15) / 0.45))
            cy = G["H"] * (0.52 if wide else 0.45)
            d.text((G["W"] / 2, cy), txt, font=font("Bold", max(10, size)), fill=GOLD + (int(255 * a),), anchor="mm",
                   stroke_width=10, stroke_fill=(20, 12, 50, int(255 * a)))
            sub = "coming up…"
            d.text((G["W"] / 2, cy + (130 if wide else 150)), sub, font=font("Medium", 54), fill=(255, 255, 255, int(230 * a)), anchor="mm")
    k = ease((tt - c - 0.05) / 0.45)
    if k > 0:
        off = int((1 - k) * 70)
        x0, x1, top, ch = L["x0"], L["x1"], L["top"] + off, L["ch"]
        d.rounded_rectangle([x0, top + 10, x1, top + ch + 10], 44, fill=(0, 0, 0, int(70 * k)))
        d.rounded_rectangle([x0, top, x1, top + ch], 44, fill=(255, 255, 255, int(255 * k)))
        F = L["F"]
        for i, ln in enumerate(L["lines"]):
            d.text(((x0 + x1) / 2, top + 48 + i * F.size * 1.22), ln, font=F, fill=INK + (int(255 * k),), anchor="ma")
        dk = ease((tt - c - 0.55) / 0.4)
        if L["dlines"] and dk > 0:
            y = top + ch + 28 - off + int((1 - dk) * 20)
            d.rounded_rectangle([x0, y, x1, y + L["dh"]], 36, fill=(20, 12, 50, int(215 * dk)), outline=(255, 255, 255, int(60 * dk)), width=3)
            yy = y + 32
            for ln in L["dlines"]:
                d.text(((x0 + x1) / 2, yy), ln, font=L["FD"], fill=(255, 255, 255, int(245 * dk)), anchor="ma")
                yy += L["FD"].size * 1.38
    if sticker:
        st = L["st"]
        sk = (tt - c - 0.15) / 0.5
        bob = 8 * math.sin((tt - c) * 2.1) if sk >= 1 else 0
        paste_sticker(img, idx, st["cx"], st["cy"] + bob, st["size"], min(1.0, sk) if sk < 1 else 1.0)


def _segment(tt):
    for seg in G["events"]:
        if seg["start"] <= tt < seg["end"]:
            return seg
    return None


def frame(tt):
    seg = _segment(tt)
    kind = seg["kind"] if seg else "outro"
    if seg and kind == "fact":
        img = qv.q_background(seg["idx"]).copy()
        draw_fact(img, seg, tt)
        return img
    img = G.get("BG_" + kind, G["BG"]).copy()
    G["DIM"] = G.get("DIM_" + kind, 130)
    G["PARTS"] = "all"
    if seg:
        G["draw"][kind](img, seg, tt)
    return img


def frame_bytes(tt):
    """Once a fact's card has popped in, the picture stands still except the floating sticker:
    that part reuses one cached base image."""
    seg = _segment(tt)
    if not seg or seg["kind"] != "fact" or tt < seg["card"] + 1.1:
        return frame(tt).tobytes()
    key = ("fact", seg["idx"])
    if G.get("cache_key") != key:
        base = qv.q_background(seg["idx"]).copy()
        draw_fact(base, seg, tt, sticker=False)
        G["cache_key"], G["cache_img"] = key, base
    img = G["cache_img"].copy()
    L = G["FLAY"][seg["idx"]]
    st = L["st"]
    paste_sticker(img, seg["idx"], st["cx"], st["cy"] + 8 * math.sin((tt - seg["card"]) * 2.1), st["size"], 1.0)
    return img.tobytes()


def render_part(args):
    idx, f0, f1, out, counter = args
    W, H = G["W"], G["H"]
    ff = subprocess.Popen([G["FFMPEG"], "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-threads", "2", str(out)],
                          stdin=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    for i in range(f0, f1):
        ff.stdin.write(frame_bytes(i / FPS))
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
    qv.init_render(state)
    G["draw"]["fact"] = draw_fact


def _render_part_pooled(args):
    return render_part((*args, _COUNTER))


# ============================== thumbnail ==============================
def _cover(im, W, H):
    s = max(W / im.width, H / im.height)
    im = im.resize((math.ceil(im.width * s), math.ceil(im.height * s)), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def design_thumbnail(job_dir, seed=None):
    """thumbnail.jpg without Canva: a fact's Canva background (or the look's background), the topic
    keyword big, "DID YOU KNOW?", one fact's sticker and a hook. Each seed gives a different pick."""
    job_dir = pathlib.Path(job_dir)
    spec = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))
    cfg = load_cfg(spec)
    facts = load_facts(job_dir)
    if seed is None:
        seed = zlib.crc32(spec.get("id", str(job_dir)).encode()) % 1_000_000
    rnd = random.Random(seed)
    wide = spec.get("format", "shorts") == "youtube"
    W, H = (1280, 720) if wide else (1080, 1920)
    import canva_images
    bgs = [p for i in range(len(facts)) for p in canva_images.pages(job_dir, f"q{i + 1}")[:1]]
    stickers = [(i, p) for i in range(len(facts)) for p in canva_images.pages(job_dir, f"s{i + 1}")[:1]]
    stickers += [(i, f["image"]) for i, f in enumerate(facts) if f["image"]]
    photo = IMAGES_DIR / str(cfg.get("thumb_image") or "_none_")
    if cfg.get("thumb_image") and photo.is_file():
        stickers = [(0, str(photo))]                    # the video's topic photo goes on the thumbnail
    bg = None
    if bgs:
        bg = Image.open(rnd.choice(bgs)).convert("RGB")
    else:
        tpl = qv.pick_templates(cfg, "youtube" if wide else "shorts", str(seed))
        if tpl.get("background"):
            bg = Image.open(tpl["background"]).convert("RGB")
    img = _cover(bg, W, H) if bg else qv.make_bg(W, H)
    img = Image.blend(img.filter(ImageFilter.GaussianBlur(3)), Image.new("RGB", (W, H), (12, 8, 30)), 0.45).convert("RGBA")
    d = ImageDraw.Draw(img, "RGBA")
    keyword = str(cfg.get("quiz_badge") or "AMAZING FACTS").upper()
    hook = rnd.choice(["{n} FACTS YOU DIDN'T KNOW!", "NUMBER {k} IS CRAZY!", "99% DIDN'T KNOW THIS!", "WAIT FOR #{n}!"])
    hook = hook.replace("{n}", str(len(facts))).replace("{k}", str(rnd.randint(2, max(2, len(facts)))))
    pick = rnd.choice(stickers) if stickers else (rnd.randrange(len(facts)), None)
    tilt = rnd.choice([-1, 1]) * rnd.uniform(4, 7)

    def pill(text, cx, cy, size, fill, ink, maxw):
        F = fit_font(d, text, "Bold", size, maxw - 60, 20)
        w = d.textlength(text, font=F) + 60
        h = F.size * 1.6
        d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], int(h / 2), fill=fill)
        d.text((cx, cy), text, font=F, fill=ink, anchor="mm")

    def big(text, cx, y, size, maxw, fill):
        lines, F = [text], fit_font(d, text, "Bold", size, maxw, 40)
        if F.size < size * 0.7 and " " in text:          # long keyword: two lines
            F = font("Bold", size)
            lines = wrap(d, text, F, maxw)
            while (len(lines) > 2 or max(d.textlength(l, font=F) for l in lines) > maxw) and F.size > 36:
                F = font("Bold", F.size - 6)
                lines = wrap(d, text, F, maxw)
        for ln in lines:
            d.text((cx, y), ln, font=F, fill=fill, anchor="ma", stroke_width=max(4, F.size // 14), stroke_fill=(10, 6, 30))
            y += F.size * 1.1
        return y

    if wide:
        pill("DID YOU KNOW?", 340, 110, 44, PINK + (255,), (255, 255, 255), 600)
        y = big(keyword, 340, 170, 120, 620, GOLD)
        pill(hook, 340, min(y + 70, H - 190), 40, (255, 255, 255, 255), INK, 620)
        st = sticker_card(pick[1], 470, tilt) if pick[1] else bulb_card(470, tilt, ACC[pick[0] % len(ACC)])
        composite(img, st, int(960 - st.width / 2), int(H / 2 - st.height / 2))
        logo = qv.round_logo(qv.TEMPLATE / cfg["logo"]).resize((110, 110), Image.LANCZOS)
        img.alpha_composite(logo, (22, H - 132))
    else:
        pill("DID YOU KNOW?", W / 2, 190, 64, PINK + (255,), (255, 255, 255), 900)
        y = big(keyword, W / 2, 290, 170, 960, GOLD)
        st = sticker_card(pick[1], 720, tilt) if pick[1] else bulb_card(720, tilt, ACC[pick[0] % len(ACC)])
        cy = (y + 40 + H - 360) / 2
        composite(img, st, int(W / 2 - st.width / 2), int(cy - st.height / 2))
        pill(hook, W / 2, H - 300, 62, (255, 255, 255, 255), INK, 980)
        logo = qv.round_logo(qv.TEMPLATE / cfg["logo"]).resize((170, 170), Image.LANCZOS)
        img.alpha_composite(logo, (22, 40))
    out = img.convert("RGB")
    tmp = job_dir / "thumbnail.tmp.jpg"
    for quality in (92, 86, 78, 70):
        out.save(tmp, "JPEG", quality=quality, optimize=True, progressive=True)
        if tmp.stat().st_size < 2 * 1024 * 1024 - 50_000:
            break
    tmp.replace(job_dir / "thumbnail.jpg")
    (job_dir / "thumbnail.json").write_text(json.dumps(dict(seed=seed, width=W, height=H, hook=hook, facts=True)), encoding="utf-8")
    return job_dir / "thumbnail.jpg"


# ============================== main ==============================
def main(job_dir):
    job = qv.Job(job_dir)
    spec = job.spec
    fmt_name = spec.get("format", "shorts")
    if fmt_name not in qv.LAYOUTS:
        raise ValueError(f"Unknown format {fmt_name}")
    cfg = load_cfg(spec)
    facts = load_facts(job.dir, spec.get("limit"))
    home = pathlib.Path(os.environ.get("CHAOS_HOME") or pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home())) / "RSC Classroom" / "chaos")
    models = pathlib.Path(spec.get("models_dir") or (home / "models"))
    job.progress("voice", 0, len(facts) + 2, "Loading the narrator voice", force=True)
    t0 = time.time()
    voice = qv.Voice(cfg, models)
    seed = str(cfg.get("seed") or job.dir.name)
    tpl = qv.pick_templates(cfg, fmt_name, seed)
    print(f"[templates] {tpl or 'built-in'}", flush=True)
    sounds = qv.Sounds(cfg, seed)
    pack = str(cfg.get("voice_pack") or "").strip()
    kid = KidFacts(pack, seed, fmt_name) if pack and pack.lower() != "off" else None
    record = spec.get("narration") == "record"
    recorded = sum(1 for f in facts if f["audio"])
    print(f"[narration] {'recorded' if record else 'AI voice'}: {recorded}/{len(facts)} facts recorded", flush=True)
    own = lambda k: str(job.dir / spec[k]) if record and spec.get(k) else None
    events, mix, total = build_timeline(cfg, facts, voice, job, sounds, kid, spec.get("middles") or [] if record else None,
                                        own("intro_file"), own("outro_file"))
    if kid:
        sounds.used["voice_pack"] = kid.used
    print(f"[sounds] {sounds.used or 'built-in'}", flush=True)
    print(f"[time] narration + sound in {time.time() - t0:.1f}s", flush=True)

    import soundfile as sf
    wav = job.dir / "audio.wav"
    sf.write(str(wav), mix, SR)
    del mix

    if cfg.get("canva"):
        import canva_images
        st = canva_images.wait_done(job.dir, tick=lambda s: job.progress("voice", len(facts) + 2, len(facts) + 2, f"Waiting for Canva's pictures ({int(s)} s)"))
        print(f"[canva] status: {st}", flush=True)
        found = canva_images.screens(job.dir, fmt_name) if st else {}
        if found:
            tpl.update(found)
        if st:
            bgs = canva_images.question_files(job.dir, len(facts))
            if any(bgs):
                cfg["question_images"] = {"mode": "background", "files": bgs}
            stickers = [(lambda p: str(p[0]) if p else None)(canva_images.pages(job.dir, f"s{i + 1}")) for i in range(len(facts))]
            cfg["fact_stickers"] = stickers
            print(f"[canva] backgrounds {sum(1 for b in bgs if b)}/{len(facts)}, stickers {sum(1 for s in stickers if s)}/{len(facts)}", flush=True)

    FF = qv.ffmpeg_exe()
    lay = qv.LAYOUTS[fmt_name]
    state = dict(W=lay["W"], H=lay["H"], FORMAT=fmt_name, CFG=cfg, N=len(facts), SECS=0, HOLD=0, events=events,
                 FFMPEG=FF, TPL=tpl, RANKS=[], FACTS=facts)
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
    chapters = [dict(t=round(e["start"], 1), kind=e["kind"], q=e.get("idx")) for e in events]
    job.progress("finish", nf, nf, "Designing the thumbnail", force=True)
    canva_thumb = False
    if any((job.dir / "canva").glob("thumbnail-p*.png")):
        try:
            import canva_images
            canva_thumb = canva_images.make_thumbnail(job.dir)
        except Exception:
            print("[canva] thumbnail: " + traceback.format_exc(), flush=True)
    if not canva_thumb:
        try:
            design_thumbnail(job.dir)
        except Exception:
            print("[thumbnail] " + traceback.format_exc(), flush=True)
    meta = dict(duration=round(total, 1), questions=len(facts), facts=len(facts), width=lay["W"], height=lay["H"], format=fmt_name,
                render_seconds=round(time.time() - job.started, 1), chapters=chapters,
                templates={k: pathlib.Path(v).parent.name for k, v in tpl.items()}, sounds=sounds.used,
                credits=qv.sound_credits(sounds.used), narration="record" if record else "ai")
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


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "thumbnail":
        print(design_thumbnail(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else None))
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
