"""Edu video renderer (Manim): draws any topic from its storyboard (<item>/script.json).

The storyboard is a list of scenes; each names one of the scene types below and fills its
fields. Each scene lasts exactly as long as its narration (timing.json from voice.py), and its
parts appear on the word that names them (cue_times). Every layout is scaled to fit its box, so
long words or many items shrink instead of running off screen. Short = 1080x1920, long = 1920x1080.

Scene types: title, bullets, steps, cycle, compare, timeline, stat, bars, diagram, picture,
keyword, demo, quiz, recap, outro. Shared fields: say (narration), heading, big, items
[{label, detail, value, icon, icon2}], left_title, right_title, unit, answer, chapter.

3D visuals (visuals.py / sci3d.py): visual = animation (default) | sticker | none; anim +
anim_subject (+ anim_cue, the narration words its main moments happen on) = the scene's
scientific 3D animation; sticker = its 3D sticker (used in sticker mode, or when the animation
can't be drawn); items[].icon = a formula (turning 3D molecule) or a sticker name next to that item.

Run with the animation venv:  python scenes.py <item folder> [preview]"""
import json, math, pathlib, random, re, sys

import numpy as np
from manim import *  # noqa: F403

from gtext import GText
import sci3d  # noqa: F401  (fast pictures: dozens of 3D atoms per frame)
import visuals as V

ITEM = pathlib.Path(sys.argv[1])
SCRIPT = json.loads((ITEM / "script.json").read_text(encoding="utf-8"))
TIMING = json.loads((ITEM / "timing.json").read_text(encoding="utf-8"))
LOGO = ITEM / "logo_round.png"
SHORT = SCRIPT.get("format", "short") == "short"

BG, PANEL, INKC, MUTED = "#0B1026", "#182050", "#1C1840", "#9AA3C7"
AMBER, CYAN, PINK, GREEN, PURPLE, REDC = "#FFB300", "#00C2FF", "#FF5C8D", "#7CDC5C", "#A855F7", "#EF4444"
ACCENTS = [AMBER, CYAN, PINK, GREEN, PURPLE]

if SHORT:
    FW, FH = 9.0, 16.0
    HEAD_Y, HEADING_Y = 7.2, 5.6
    STAGE = dict(cx=0.0, cy=-0.05, w=8.1, h=9.9)       # between the heading and the captions
    CAP_Y, CAP_SIZE, CAP_W = -6.05, 52, 7.9
    TEXT = 40
else:
    FW, FH = 16.0, 9.0
    HEAD_Y, HEADING_Y = 3.95, 3.0
    STAGE = dict(cx=0.0, cy=-0.25, w=14.4, h=5.0)
    CAP_Y, CAP_SIZE, CAP_W = -3.85, 44, 13.0
    TEXT = 36

STOP = set("a an the of to in on and or is are was were be been it its this that these those for with as at by from into than then so".split())


def T(s, size=48, color=WHITE, weight="BOLD", **kw):
    return GText(str(s), font_size=size, color=color, weight=weight, **kw)


def fit(m, w, h=None):
    if m.width > w:
        m.scale_to_fit_width(w)
    if h is not None and m.height > h:
        m.scale_to_fit_height(h)
    return m


def wrap(text, size, width, color=WHITE, weight="BOLD", align=ORIGIN, gap=0.12, max_lines=4):
    """Text broken into lines no wider than `width` (centred, or LEFT-aligned)."""
    words, lines, cur = str(text).split(), [], []
    for w in words:
        if cur and T(" ".join(cur + [w]), size, weight=weight).width > width:
            lines.append(cur)
            cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    if not lines:
        return VGroup(T("", size))
    if len(lines) > max_lines:          # too long: squeeze into max_lines and let fit() shrink it
        per = math.ceil(len(words) / max_lines)
        lines = [words[i:i + per] for i in range(0, len(words), per)]
    g = VGroup(*[T(" ".join(l), size, color, weight=weight) for l in lines]).arrange(DOWN, buff=gap, aligned_edge=align)
    return fit(g, width)


def pill(s, fill, ink=WHITE, size=34, padx=0.38, pady=0.2):
    t = T(s, size, ink)
    h = T("Hg", size).height + 2 * pady
    r = RoundedRectangle(corner_radius=h / 2, width=t.width + 2 * padx, height=h, fill_color=fill, fill_opacity=1, stroke_width=0)
    t.move_to(r)
    return VGroup(r, t)


def card(content, color, padx=0.35, pady=0.28, fill_opacity=0.16, min_w=0.0):
    r = RoundedRectangle(corner_radius=0.22, width=max(min_w, content.width + 2 * padx), height=content.height + 2 * pady,
                         fill_color=color, fill_opacity=fill_opacity, stroke_color=color, stroke_width=3.5)
    content.move_to(r)
    return VGroup(r, content)


def tick(color=GREEN, s=1.0):
    return VMobject(stroke_color=color, stroke_width=10).set_points_as_corners(
        [[-0.22 * s, 0.0, 0], [-0.06 * s, -0.17 * s, 0], [0.26 * s, 0.2 * s, 0]])


def glow(color, radius, center, strength=0.05, rings=9):
    return VGroup(*[Circle(radius=radius * (1 - k / rings), fill_color=color, fill_opacity=strength, stroke_width=0).move_to(center)
                    for k in range(rings)])


def num_value(s):
    """'300,000 km/s' -> (300000.0, '', ' km/s', decimals); None when it doesn't start with a number."""
    m = re.match(r"^\s*([^\d\-]*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$", str(s))
    if not m:
        return None
    raw = m.group(2)
    dec = len(raw.split(".")[1]) if "." in raw else 0
    return float(raw.replace(",", "")), m.group(1), m.group(3), dec, "," in raw


def fmt_num(v, dec, commas):
    s = f"{v:,.{dec}f}" if commas else f"{v:.{dec}f}"
    return s


class Edu(Scene):
    # ---------------- timing ----------------
    def now(self):
        return self.renderer.time

    def until(self, t):
        d = t - self.now()
        if d > 1.5 / config.frame_rate:
            self.wait(d)

    def p(self, *anims, rt=0.5, **kw):
        anims = [a for a in anims if a is not None]
        if anims:
            self.play(*anims, run_time=max(1 / 30, rt), **kw)

    def cue_times(self, tm, labels):
        """When each label is spoken: the first meaningful word of the label found in the narration
        (in order); labels never named are spread evenly over the narration."""
        words = tm["words"]
        t0, t1 = tm["talk"]
        n = len(labels)
        even = [t0 + 0.5 + (t1 - t0 - 1.0) * (k + 0.5) / max(1, n) for k in range(n)]
        out, pos = [], 0
        for k, lab in enumerate(labels):
            keys = [re.sub(r"[^a-z0-9]", "", w.lower()) for w in str(lab).split()]
            keys = [w for w in keys if w and w not in STOP] or [w for w in keys if w]
            hit = None
            for j in range(pos, len(words)):
                ww = re.sub(r"[^a-z0-9]", "", words[j]["w"].lower())
                if ww and any(ww == key or (len(key) >= 4 and ww.startswith(key[:5])) for key in keys[:3]):
                    hit = j
                    break
            if hit is not None:
                out.append(max(words[hit]["start"] - 0.15, t0))
                pos = hit + 1
            else:
                out.append(even[k])
        # keep them in order, at least 0.4 s apart, and inside the narration
        for k in range(len(out)):
            lo = (out[k - 1] + 0.4) if k else t0
            out[k] = min(max(out[k], lo), t1 - 0.2)
        return out

    def word_time(self, tm, word, default=None):
        for w in tm["words"]:
            if re.sub(r"[^a-z]", "", w["w"].lower()).startswith(word):
                return w["start"]
        return default if default is not None else tm["talk"][0]

    def reveal(self, tm, items, make_anim, end_pad=0.6):
        """Shows items one by one at their cue times. make_anim(k) returns the animations for item k."""
        times = self.cue_times(tm, [it[0] for it in items])
        end = tm["start"] + tm["dur"] - end_pad
        for k in range(len(items)):
            self.until(times[k])
            nxt = times[k + 1] if k + 1 < len(items) else end
            rt = min(0.55, max(1 / 30, (nxt - self.now()) * 0.85))
            self.p(*make_anim(k), rt=rt)

    # ---------------- frame ----------------
    def backdrop(self):
        sx, sy = FW / 2, FH / 2
        dots = VGroup(*[Dot([x, y, 0], radius=0.022, color=WHITE, fill_opacity=0.09)
                        for x in np.arange(-sx, sx + 0.1, 0.75) for y in np.arange(-sy, sy + 0.1, 0.75)])
        g1 = glow(CYAN, 4.2, [-sx * 0.7, sy * 0.6, 0], 0.018)
        g2 = glow(PINK, 4.6, [sx * 0.75, -sy * 0.5, 0], 0.016)
        self.add(dots, g1, g2)
        g1.add_updater(lambda m, dt: m.move_to([-sx * 0.7 + 0.6 * np.sin(self.now() / 5), sy * 0.6 + 0.4 * np.cos(self.now() / 6), 0]))
        g2.add_updater(lambda m, dt: m.move_to([sx * 0.75 + 0.5 * np.cos(self.now() / 5.5), -sy * 0.5 + 0.5 * np.sin(self.now() / 4.5), 0]))
        kick = pill(SCRIPT.get("kicker") or "EXPLAINED", PINK, size=30).move_to([0, HEAD_Y, 0])
        self.add(kick)
        if LOGO.exists():  # the Edu channel's logo; none uploaded -> no logo
            logo = ImageMobject(str(LOGO))
            logo.height = 1.0
            logo.move_to([-sx + 0.75, HEAD_Y, 0])
            self.add(logo)

    def captions(self):
        caps = []
        for sc in TIMING["scenes"]:
            for c in sc["captions"]:
                t = fit(T(c["text"], CAP_SIZE, WHITE), CAP_W)
                box = RoundedRectangle(corner_radius=0.28, width=t.width + 0.7, height=T("Hg", CAP_SIZE).height + 0.5,
                                       fill_color="#000000", fill_opacity=0.6, stroke_width=0)
                t.move_to(box)
                caps.append((c["start"], c["end"], VGroup(box, t).move_to([0, CAP_Y, 0])))
        if not caps:
            return
        hidden = caps[0][2].copy().set_opacity(0)
        holder = hidden.copy()
        state = {"i": None}

        def upd(m, dt):
            t = self.now()
            i = None
            for k, (s, e, _) in enumerate(caps):
                if s <= t and (k + 1 == len(caps) or t < caps[k + 1][0]) and t < e + 0.9:
                    i = k
            if i != state["i"]:
                state["i"] = i
                m.become(caps[i][2] if i is not None else hidden)
        holder.add_updater(upd)
        self.add_foreground_mobject(holder)

    def heading(self, text, color):
        if not text:
            return None
        h = pill(text, color, INKC if color in (AMBER, GREEN, CYAN) else WHITE, size=34 if SHORT else 32)
        fit(h, STAGE["w"])
        h.move_to([0, HEADING_Y, 0])
        self.p(FadeIn(h, shift=DOWN * 0.3), rt=0.35)
        self.stage.append(h)
        return h

    def place(self, m, top_gap=0.0):
        """Scale m into the text area (the stage, or what a visual leaves of it) and centre it there."""
        A = self.area
        fit(m, A["w"], A["h"] - top_gap)
        m.move_to([A["cx"], A["cy"] - top_gap / 2, 0])
        return m

    # ---------------- 3D visuals ----------------
    def vis_mode(self, sc):
        m = str(sc.get("visual") or "animation").lower()
        return m if m in ("animation", "sticker", "none") else "animation"

    def split(self, frac):
        """Gives a visual box (cx, cy, w, h) and shrinks the text area. Short: visual on top; long: on the right."""
        st = STAGE
        if SHORT:
            vh = st["h"] * frac
            self.area = dict(cx=st["cx"], cy=st["cy"] - vh / 2 - 0.1, w=st["w"], h=st["h"] - vh - 0.2)
            return (st["cx"], st["cy"] + st["h"] / 2 - vh / 2, st["w"], vh)
        vw = st["w"] * frac
        self.area = dict(cx=st["cx"] - vw / 2 - 0.15, cy=st["cy"], w=st["w"] - vw - 0.3, h=st["h"])
        return (st["cx"] + st["w"] / 2 - vw / 2, st["cy"], vw, st["h"])

    def scene_visual(self, sc, w, h):
        mode = self.vis_mode(sc)
        if mode == "none":
            return None
        v = None
        if mode == "animation" and sc.get("anim"):
            v = V.make_visual(sc["anim"], sc.get("anim_subject", ""), w, h, SHORT, True)
            if v is None:
                print(f"[visual] scene {self.idx + 1}: animation '{sc.get('anim')}: {sc.get('anim_subject', '')}' can't be drawn", flush=True)
        if v is None and sc.get("sticker"):
            v = V.make_visual("sticker", sc["sticker"], w, h, SHORT, mode == "animation")
        return v

    DEFAULT_CUES = {"reaction": ["react"], "ions": ["electron"], "atom": ["electron"], "beaker": ["turn"],
                    "melting": ["melt"], "freezing": ["freez"], "boiling": ["boil"], "evaporation": ["evapor"],
                    "condensation": ["condens"], "sublimation": ["sublim"], "deposition": ["deposit"],
                    "heating": ["liquid", "gas"], "all": ["liquid", "gas"], "states": ["liquid", "gas"], "cooling": ["liquid", "solid"]}

    def start_visual(self, v, sc, tm, cx, cy):
        labels = [x.strip() for x in re.split(r"[,|;]", sc.get("anim_cue") or "") if x.strip()]
        if not labels:
            kind = str(sc.get("anim") or "").lower()
            subj = str(sc.get("anim_subject") or "").lower()
            if isinstance(v, V.StickerVisual):
                labels = [n.replace("_", " ") for n in v.names] if len(v.names) > 1 else []
            elif kind == "states":
                labels = self.DEFAULT_CUES.get(re.sub(r"[^a-z]", "", subj), [])
            else:
                labels = self.DEFAULT_CUES.get(kind, [])
        cues = self.cue_times(tm, labels) if labels else []
        v.place(cx, cy)
        v.timeline(self.now() + 0.1, cues, tm["start"] + tm["dur"])
        v.add_updater(lambda m, dt: m.tick(self.now()))
        self.add(v)
        self.stage.append(v)
        return v

    def with_visual(self, sc, tm, frac):
        """Adds the scene's visual in its share of the stage (frac); the text then fits in the rest."""
        if self.vis_mode(sc) == "none" or not (sc.get("anim") or sc.get("sticker")):
            return None
        cx, cy, w, h = self.split(frac)
        v = self.scene_visual(sc, w, h)
        if v is None:
            self.area = dict(STAGE)
            return None
        return self.start_visual(v, sc, tm, cx, cy)

    _icon_ok = {}

    def icon_ok(self, spec):
        if not spec:
            return False
        if spec not in self._icon_ok:
            try:
                self._icon_ok[spec] = V.Icon(spec, 1.0).ok
            except Exception as e:  # noqa: BLE001
                print(f"[visual] icon '{spec}' can't be drawn: {e}", flush=True)
                self._icon_ok[spec] = False
        return self._icon_ok[spec]

    def icon_spec(self, sc, it, key="icon"):
        spec = (it.get(key) or "").strip() if self.vis_mode(sc) != "none" else ""
        return spec if self.icon_ok(spec) else ""

    @staticmethod
    def slot(size):
        return Square(side_length=size, stroke_width=0, fill_opacity=0)

    def attach_icons(self, sc, tm, slots, times):
        """slots: [(item index, placeholder square, spec)] -> live icons appearing with their items."""
        live = self.vis_mode(sc) == "animation"
        end = tm["start"] + tm["dur"]
        for k, sl, spec in slots:
            ic = V.Icon(spec, sl.height, live, phase=k * 1.1)
            if not ic.ok:
                continue
            ic.place(sl.get_x(), sl.get_y())
            ic.timeline(times[k] - 0.05 if k < len(times) else self.now(), [], end)
            ic.add_updater(lambda m, dt: m.tick(self.now()))
            self.add(ic)
            self.stage.append(ic)

    def clear(self, rt=0.35):
        if self.stage:
            self.p(*[V.FadeVisual(m) if isinstance(m, V.Visual) else FadeOut(m) for m in self.stage], rt=rt)
        self.stage = []

    # ---------------- the video ----------------
    def construct(self):
        self.stage = []
        self.backdrop()
        self.captions()
        n = len(SCRIPT["scenes"])
        for i, (sc, tm) in enumerate(zip(SCRIPT["scenes"], TIMING["scenes"])):
            self.idx = i
            self.area = dict(STAGE)
            color = ACCENTS[i % len(ACCENTS)]
            kind = sc.get("type", "keyword")
            fn = getattr(self, "s_" + kind, None) or self.s_keyword
            try:
                fn(sc, tm, color)
            except Exception as e:  # a scene that can't be drawn becomes a simple card, never a failed video
                print(f"[scene] {i + 1} ({kind}) fell back to a card: {e}", flush=True)
                import traceback
                traceback.print_exc()
                self.clear(rt=0.2)
                self.area = dict(STAGE)
                self.s_keyword(sc, tm, color)
            end = tm["start"] + tm["dur"]
            if i + 1 < n:
                self.until(end - 0.35)
                self.clear()
            self.until(end)
            print(f"[scene] {i + 1}/{n} {kind} done at {self.now():.1f}s (target {end:.1f})", flush=True)

    # ---------------- scene types ----------------
    def s_title(self, sc, tm, color):
        v = self.with_visual(sc, tm, 0.5)
        title = wrap(sc.get("heading") or SCRIPT.get("title", ""), 84 if SHORT else 92, self.area["w"] * 0.95, max_lines=3)
        for k, line in enumerate(title):
            if k == len(title) - 1 and len(title) > 1:
                line.set_fill(AMBER)
        rings = VGroup(*[Circle(radius=r, stroke_color=color, stroke_width=3, stroke_opacity=0.35 - r * 0.05) for r in (1.6, 2.4, 3.2)])
        sub = None
        if sc.get("big"):
            sub = fit(pill(sc["big"], PINK, size=40 if SHORT else 36), self.area["w"])
        group = VGroup(title, *( [sub] if sub else [])).arrange(DOWN, buff=0.6)
        self.place(group)
        rings.move_to(title)
        if v is not None:
            rings.scale(0.6)
        self.p(LaggedStart(*[Create(r) for r in rings], lag_ratio=0.2), Write(title), rt=1.0)
        self.stage += [rings, title]
        if sub:
            self.until(self.cue_times(tm, [sc["big"]])[0])
            self.p(GrowFromCenter(sub), rt=0.4)
            self.stage.append(sub)
        self.p(Rotate(rings, angle=PI / 6), rt=min(1.5, max(0.1, tm["start"] + tm["dur"] - self.now() - 0.5)))

    def s_bullets(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:5]
        if len(items) <= (3 if SHORT else 4):
            self.with_visual(sc, tm, 0.42)
        isz = 1.25 if SHORT else 0.95
        w = self.area["w"] - 1.2 - (isz - 0.64)
        rows, slots = VGroup(), []
        for k, it in enumerate(items):
            c = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
            spec = self.icon_spec(sc, it)
            if spec:
                dot = self.slot(isz)
                slots.append((k, dot, spec))
            else:
                dot = VGroup(Circle(radius=0.32, fill_color=c, fill_opacity=1, stroke_width=0), T(str(k + 1), 30, INKC))
                dot[1].move_to(dot[0])
            txt = wrap(it.get("label", ""), TEXT + 4, w, align=LEFT, max_lines=2)
            if it.get("detail"):
                txt = VGroup(txt, wrap(it["detail"], TEXT - 10, w, MUTED, "MEDIUM", align=LEFT, max_lines=2)).arrange(DOWN, aligned_edge=LEFT, buff=0.1)
            rows.add(VGroup(dot, txt).arrange(RIGHT, buff=0.35, aligned_edge=UP if not spec else ORIGIN))
        rows.arrange(DOWN, buff=0.45 if SHORT else 0.3, aligned_edge=LEFT)
        self.place(rows, top_gap=0.3)
        self.stage.append(rows)
        self.attach_icons(sc, tm, slots, self.cue_times(tm, [it.get("label", "") for it in items]))
        self.reveal(tm, [(it.get("label", ""),) for it in items], lambda k: [FadeIn(rows[k], shift=RIGHT * 0.4)])

    def s_steps(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:6]
        if len(items) <= 3:
            self.with_visual(sc, tm, 0.4)
        A = self.area
        horizontal = not SHORT and len(items) <= 4
        boxes, slots = [], []
        for k, it in enumerate(items):
            c = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
            spec = self.icon_spec(sc, it)
            if spec:
                num = self.slot(1.2 if SHORT else 0.9)
                slots.append((k, num, spec))
            else:
                num = VGroup(Circle(radius=0.3, fill_color=c, fill_opacity=1, stroke_width=0), T(str(k + 1), 28, INKC))
                num[1].move_to(num[0])
            width = (A["w"] - 1.2 * (len(items) - 1)) / max(1, len(items)) - 0.7 if horizontal else A["w"] - 1.8
            body = wrap(it.get("label", ""), TEXT, max(2.2, width), max_lines=3)
            if it.get("detail"):
                body = VGroup(body, wrap(it["detail"], TEXT - 12, max(2.2, width), MUTED, "MEDIUM", max_lines=3)).arrange(DOWN, buff=0.1)
            inner = VGroup(num, body).arrange(DOWN if horizontal else RIGHT, buff=0.25)
            boxes.append(card(inner, c, min_w=0 if horizontal else A["w"] - 0.4))
        row = VGroup(*boxes).arrange(RIGHT if horizontal else DOWN, buff=1.0 if horizontal else 0.55)
        self.place(row, top_gap=0.3)
        arrows = []
        for a, b in zip(boxes, boxes[1:]):
            if horizontal:
                arrows.append(Arrow(a.get_right(), b.get_left(), buff=0.1, color=MUTED, stroke_width=6, max_tip_length_to_length_ratio=0.4))
            else:
                arrows.append(Arrow(a.get_bottom(), b.get_top(), buff=0.06, color=MUTED, stroke_width=6, max_tip_length_to_length_ratio=0.5))
        self.stage += boxes + arrows
        self.attach_icons(sc, tm, slots, self.cue_times(tm, [it.get("label", "") for it in items]))

        def anim(k):
            out = [FadeIn(boxes[k], scale=0.85)]
            if k:
                out.insert(0, GrowArrow(arrows[k - 1]))
            return out
        self.reveal(tm, [(it.get("label", ""),) for it in items], anim)

    def s_cycle(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:5]
        n = max(3, len(items))
        R = 2.75 if SHORT else 1.95
        c = np.array([STAGE["cx"], STAGE["cy"] - 0.2, 0])
        nodes, cyc_slots = [], []
        node_r = 1.2 if SHORT else 0.9
        for k in range(len(items)):
            a = PI / 2 - k * TAU / n
            col = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
            circ = Circle(radius=node_r, fill_color=PANEL, fill_opacity=1, stroke_color=col, stroke_width=6)
            spec = self.icon_spec(sc, items[k])
            lab = wrap(items[k].get("label", ""), 34 if SHORT else 26, node_r * 1.7, col, max_lines=2 if spec else 3)
            fit(lab, node_r * 1.7, node_r * (0.62 if spec else 1.5))
            if spec:
                sl = self.slot(node_r * 0.95)
                inner = VGroup(sl, lab).arrange(DOWN, buff=0.06)
                cyc_slots.append((k, sl, spec))
            else:
                inner = lab
            g = VGroup(circ, inner.move_to(circ)).move_to(c + R * np.array([np.cos(a), np.sin(a), 0]))
            nodes.append(g)
        gap = math.asin(min(0.95, (node_r + 0.12) / R))
        arcs = VGroup()
        for k in range(len(items)):
            a0 = PI / 2 - k * TAU / n
            span = TAU / n
            arc = Arc(radius=R, start_angle=a0 - gap, angle=-(span - 2 * gap), arc_center=c, stroke_color=MUTED, stroke_width=6)
            if k < len(items) - 1 or len(items) == n:
                arc.add_tip(tip_length=0.26, tip_width=0.26)
            arcs.add(arc)
        self.stage += nodes + [arcs]
        self.attach_icons(sc, tm, cyc_slots, [t + 0.25 for t in self.cue_times(tm, [it.get("label", "") for it in items])])

        def anim(k):
            return [GrowFromCenter(nodes[k]), Create(arcs[k - 1])] if k else [GrowFromCenter(nodes[k])]
        self.reveal(tm, [(it.get("label", ""),) for it in items], anim, end_pad=1.4)
        if len(arcs) == len(items):
            self.p(Create(arcs[-1]), rt=0.3)
        dot = Dot(c + R * UP, radius=0.17, color=AMBER)
        self.add(dot)
        self.bring_to_front(*nodes)
        icons = [m for m in self.stage if isinstance(m, V.Icon)]
        if icons:
            self.bring_to_front(*icons)
        left = tm["start"] + tm["dur"] - 0.5 - self.now()
        if left > 0.5:
            self.play(MoveAlongPath(dot, Arc(radius=R, start_angle=PI / 2, angle=-TAU, arc_center=c)), run_time=min(2.0, left), rate_func=linear)
        self.stage.append(dot)

    def s_compare(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:4]
        colw = (STAGE["w"] - 1.0) / 2
        lt = pill(sc.get("left_title") or "Before", CYAN, INKC, size=34)
        rt_ = pill(sc.get("right_title") or "After", PINK, WHITE, size=34)
        fit(lt, colw)
        fit(rt_, colw)
        rows, cmp_slots = [], []
        isz = 0.95 if SHORT else 0.8
        for k, it in enumerate(items):
            cells = []
            for key, txt_key in (("icon", "label"), ("icon2", "detail")):
                spec = self.icon_spec(sc, it, key)
                txt = wrap(it.get(txt_key, ""), TEXT - 4, colw - 0.6 - ((isz + 0.15) if spec and not SHORT else 0), max_lines=3)
                if spec:
                    sl = self.slot(isz)
                    txt = VGroup(sl, txt).arrange(DOWN if SHORT else RIGHT, buff=0.15)
                    cmp_slots.append((k, sl, spec))
                cells.append(txt)
            l = card(cells[0], CYAN, min_w=colw)
            r = card(cells[1], PINK, min_w=colw)
            h = max(l.height, r.height)
            for cc in (l, r):
                cc[0].stretch_to_fit_height(h)
                cc[1].move_to(cc[0])
            rows.append(VGroup(l, r).arrange(RIGHT, buff=1.0))
        head = VGroup(lt, rt_)
        lt.move_to([-(colw + 1.0) / 2, 0, 0])
        rt_.move_to([(colw + 1.0) / 2, 0, 0])
        body = VGroup(head, *rows).arrange(DOWN, buff=0.35)
        lt.set_x(rows[0][0].get_x() if rows else lt.get_x())
        rt_.set_x(rows[0][1].get_x() if rows else rt_.get_x())
        vs = VGroup(Circle(radius=0.42, fill_color=AMBER, fill_opacity=1, stroke_width=0), T("VS", 30, INKC))
        vs[1].move_to(vs[0])
        allg = VGroup(body, vs)
        self.place(allg, top_gap=0.3)
        vs.move_to([(lt.get_x() + rt_.get_x()) / 2, lt.get_y(), 0])
        self.p(FadeIn(lt, shift=RIGHT * 0.3), FadeIn(rt_, shift=LEFT * 0.3), GrowFromCenter(vs), rt=0.45)
        self.stage += [lt, rt_, vs] + rows
        ctimes = self.cue_times(tm, [it.get("label", "") for it in items])
        self.attach_icons(sc, tm, [(n, sl, sp) for n, (k, sl, sp) in enumerate(cmp_slots)], [ctimes[k] for k, _, _ in cmp_slots])
        self.reveal(tm, [(it.get("label", ""),) for it in items], lambda k: [FadeIn(rows[k][0], shift=RIGHT * 0.3), FadeIn(rows[k][1], shift=LEFT * 0.3)])

    def s_timeline(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:6]
        n = len(items)
        marks, tl_slots = [], []
        if SHORT:
            ys = np.linspace(0, -(n - 1) * 2.0, n)
            for k, it in enumerate(items):
                col = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
                d = Dot([0, ys[k], 0], radius=0.22, color=col)
                date = T(it.get("label", ""), 50, col).next_to(d, RIGHT, buff=0.45).align_to(d, UP).shift(UP * 0.25)
                ev = wrap(it.get("detail", ""), 38, 6.6, WHITE, "MEDIUM", align=LEFT, max_lines=3).next_to(date, DOWN, buff=0.08, aligned_edge=LEFT)
                mk = VGroup(d, date, ev)
                spec = self.icon_spec(sc, it)
                if spec:
                    sl = self.slot(0.85).next_to(date, RIGHT, buff=0.3)
                    mk.add(sl)
                    tl_slots.append((k, sl, spec))
                marks.append(mk)
            line = Line([0, 0.4, 0], [0, ys[-1] - 0.4, 0], stroke_color=MUTED, stroke_width=5)
        else:
            xs = np.linspace(0, (n - 1) * 4.0, n)
            for k, it in enumerate(items):
                col = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
                d = Dot([xs[k], 0, 0], radius=0.17, color=col)
                date = T(it.get("label", ""), 46, col).next_to(d, UP, buff=0.3)
                ev = wrap(it.get("detail", ""), 34, 3.6, WHITE, "MEDIUM", max_lines=3).next_to(d, DOWN, buff=0.3)
                mk = VGroup(d, date, ev)
                spec = self.icon_spec(sc, it)
                if spec:
                    sl = self.slot(0.8).next_to(date, UP, buff=0.15)
                    mk.add(sl)
                    tl_slots.append((k, sl, spec))
                marks.append(mk)
            line = Line([-0.6, 0, 0], [xs[-1] + 0.6, 0, 0], stroke_color=MUTED, stroke_width=5)
        g = VGroup(line, *marks)
        self.place(g, top_gap=0.3)
        self.p(Create(line), rt=0.5)
        self.stage += [line] + marks
        self.attach_icons(sc, tm, tl_slots, self.cue_times(tm, [it.get("label", "") for it in items]))
        self.reveal(tm, [(it.get("label", ""),) for it in items], lambda k: [FadeIn(marks[k], scale=0.8)])

    def s_stat(self, sc, tm, color):
        self.heading(sc.get("heading") if sc.get("items") else None, color)
        self.with_visual(sc, tm, 0.42)
        big = str(sc.get("big") or "")
        label = sc.get("heading") if not sc.get("items") else (sc.get("items") or [{}])[0].get("label", "")
        info = num_value(big)
        size = 150 if SHORT else 140
        target = fit(T(big, size, AMBER), self.area["w"])
        lab = wrap(label or "", TEXT + 4, self.area["w"] - 0.6, max_lines=3) if label else VGroup()
        extra = VGroup(*[wrap(it.get("detail") or it.get("label", ""), TEXT - 6, self.area["w"] - 0.6, MUTED, "MEDIUM", max_lines=2)
                         for it in (sc.get("items") or [])[1 if not sc.get("heading") else 0:3]])
        extra.arrange(DOWN, buff=0.2)
        g = VGroup(target, lab, extra).arrange(DOWN, buff=0.45)
        self.place(g, top_gap=0.3)
        scale = target.height / T(big, size).height if big else 1
        self.until(self.cue_times(tm, [big])[0] - 0.2)
        if info:
            v, pre, suf, dec, commas = info
            tr = ValueTracker(0)
            pos = target.get_center()

            def draw():
                m = T(f"{pre}{fmt_num(tr.get_value(), dec, commas)}{suf}", size, AMBER).scale(scale)
                return m.move_to(pos)
            counter = always_redraw(draw)
            self.add(counter)
            self.play(tr.animate.set_value(v), run_time=1.2, rate_func=rush_from)
            counter.clear_updaters()
            self.remove(counter)
            self.add(target)
        else:
            self.p(GrowFromCenter(target), rt=0.6)
        self.stage.append(target)
        if label:
            self.p(FadeIn(lab, shift=UP * 0.2), rt=0.4)
            self.stage.append(lab)
        if len(extra):
            self.reveal(tm, [(m,) for m in ["x"] * len(extra)], lambda k: [FadeIn(extra[k], shift=UP * 0.2)])
            self.stage.append(extra)
        self.p(Circumscribe(target, color=color, buff=0.2), rt=0.8)

    def s_bars(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:6]
        vals = []
        for it in items:
            nv = num_value(it.get("value", ""))
            vals.append(nv[0] if nv else 0.0)
        top = max(vals) if vals and max(vals) > 0 else 1.0
        labw = 2.6 if SHORT else 3.6
        maxw = STAGE["w"] - labw - 1.8
        rows = []
        for k, it in enumerate(items):
            col = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
            lab = fit(wrap(it.get("label", ""), TEXT + 2, labw, max_lines=2), labw)
            bar = Rectangle(width=max(0.12, maxw * vals[k] / top), height=0.8 if SHORT else 0.62, fill_color=col, fill_opacity=0.9, stroke_width=0)
            val = T(f"{it.get('value', '')}{(' ' + sc['unit']) if sc.get('unit') and not str(it.get('value', '')).endswith(sc['unit']) else ''}", 40 if SHORT else 32, col)
            rows.append((lab, bar, val))
        g = VGroup()
        for k, (lab, bar, val) in enumerate(rows):
            y = -k * (1.35 if SHORT else 1.05)
            lab.move_to([0, y, 0]).align_to([labw, 0, 0], RIGHT)
            bar.move_to([0, y, 0]).align_to([labw + 0.3, 0, 0], LEFT)
            val.next_to(bar, RIGHT, buff=0.2)
            g.add(VGroup(lab, bar, val))
        self.place(g, top_gap=0.3)
        self.stage.append(g)
        self.reveal(tm, [(it.get("label", ""),) for it in items], lambda k: [FadeIn(g[k][0]), GrowFromEdge(g[k][1], LEFT), FadeIn(g[k][2])])

    def s_diagram(self, sc, tm, color):
        self.heading(sc.get("heading"), color)
        items = (sc.get("items") or [])[:6]
        n = max(1, len(items))
        center_txt = wrap(sc.get("big") or sc.get("heading") or "", 40 if SHORT else 36, 2.4, INKC, max_lines=3)
        hub = Circle(radius=max(1.15, center_txt.width / 2 + 0.3), fill_color=color, fill_opacity=1, stroke_width=0)
        fit(center_txt, hub.width * 0.82, hub.height * 0.7)
        hubg = VGroup(hub, center_txt.move_to(hub))
        rx, ry = (2.75, 3.5) if SHORT else (5.2, 1.85)
        parts, lines, dg_slots = [], [], []
        for k, it in enumerate(items):
            a = PI / 2 - k * TAU / n + (PI / n if n % 2 == 0 and SHORT else 0)
            pos = np.array([rx * np.cos(a), ry * np.sin(a), 0])
            col = ACCENTS[(self.idx + k + 1) % len(ACCENTS)]
            inner = wrap(it.get("label", ""), 36 if SHORT else 28, 2.9 if SHORT else 2.5, max_lines=3)
            spec = self.icon_spec(sc, it)
            if spec:
                sl = self.slot(1.5 if SHORT else 1.1)
                inner = VGroup(sl, inner).arrange(DOWN, buff=0.12)
                dg_slots.append((k, sl, spec))
            box = card(inner, col, padx=0.25, pady=0.2)
            box.move_to(pos)
            parts.append(box)
            lines.append(Line(ORIGIN, pos, stroke_color=col, stroke_width=4, stroke_opacity=0.7).set_z_index(-1))
        g = VGroup(*lines, hubg, *parts)
        self.place(g, top_gap=0.3)
        for ln, box in zip(lines, parts):   # lines run from the hub's edge to the box's edge
            ln.put_start_and_end_on(hubg.get_center(), box.get_center())
        self.p(GrowFromCenter(hubg), rt=0.5)
        self.stage += [hubg] + lines + parts
        self.bring_to_front(hubg)
        self.attach_icons(sc, tm, dg_slots, [t + 0.1 for t in self.cue_times(tm, [it.get("label", "") for it in items])])
        self.reveal(tm, [(it.get("label", ""),) for it in items], lambda k: [Create(lines[k]), FadeIn(parts[k], scale=0.8)])

    def s_picture(self, sc, tm, color):
        pic = ITEM / "pics" / f"scene{self.idx + 1}.png"
        cap = sc.get("heading") or ""
        if not pic.exists() and self.vis_mode(sc) != "none" and (sc.get("anim") or sc.get("sticker")):
            return self.s_demo(sc, tm, color)
        if not pic.exists():
            print(f"[picture] scene {self.idx + 1}: no picture, using a plain card", flush=True)
            return self.s_keyword({**sc, "big": sc.get("big") or cap, "heading": "" if sc.get("big") else ""}, tm, color)
        img = ImageMobject(str(pic))
        box_w, box_h = STAGE["w"], STAGE["h"] - (1.3 if cap else 0.2)
        k = min(box_w / img.width, box_h / img.height)
        img.scale(k)
        frame = RoundedRectangle(corner_radius=0.25, width=img.width + 0.12, height=img.height + 0.12, stroke_color=color, stroke_width=6, fill_opacity=0)
        g = Group(img, frame)
        label = fit(pill(cap, color, INKC if color in (AMBER, GREEN, CYAN) else WHITE, size=34), STAGE["w"]) if cap else None
        whole = Group(g, label).arrange(DOWN, buff=0.35) if label else g
        whole.move_to([STAGE["cx"], STAGE["cy"] + 0.3, 0])
        self.p(FadeIn(img, scale=1.05), Create(frame), rt=0.6)
        self.stage += [img, frame]
        if label:
            self.p(FadeIn(label, shift=UP * 0.2), rt=0.35)
            self.stage.append(label)
        left = tm["start"] + tm["dur"] - 0.45 - self.now()
        if left > 0.3:
            self.play(img.animate.scale(1.06), run_time=left, rate_func=linear)

    def s_demo(self, sc, tm, color):
        """The scene is its 3D animation: heading on top, the animation fills the stage."""
        self.heading(sc.get("heading"), color)
        st = STAGE
        v = self.scene_visual(sc, st["w"], st["h"] - 0.4)
        if v is None:
            return self.s_keyword(sc, tm, color)
        self.start_visual(v, sc, tm, st["cx"], st["cy"] - 0.2)
        if sc.get("big"):
            b = fit(pill(sc["big"], color, INKC if color in (AMBER, GREEN, CYAN) else WHITE, size=34), st["w"])
            b.move_to([st["cx"], st["cy"] - st["h"] / 2 + 0.2, 0])
            self.until(self.cue_times(tm, [sc["big"]])[0])
            self.p(FadeIn(b, shift=UP * 0.2), rt=0.35)
            self.stage.append(b)

    def s_keyword(self, sc, tm, color):
        term = sc.get("big") or sc.get("heading") or SCRIPT.get("title") or "?"
        meaning = sc.get("heading") if sc.get("big") else ""
        if not meaning and sc.get("items"):
            meaning = sc["items"][0].get("detail") or sc["items"][0].get("label", "")
        if SHORT:
            if self.vis_mode(sc) != "none" and (sc.get("anim") or sc.get("sticker")):
                # text on top, the visual below it
                st = STAGE
                vh = st["h"] * 0.58
                v = self.scene_visual(sc, st["w"], vh)
                if v is not None:
                    self.area = dict(cx=st["cx"], cy=st["cy"] + st["h"] / 2 - (st["h"] - vh) / 2, w=st["w"], h=st["h"] - vh - 0.2)
                    self.start_visual(v, sc, tm, st["cx"], st["cy"] - st["h"] / 2 + vh / 2)
        else:
            self.with_visual(sc, tm, 0.5)
        A = self.area
        t = wrap(term, 104 if SHORT else 100, A["w"] * 0.95, color, max_lines=3)
        under = Line(LEFT, RIGHT, stroke_color=color, stroke_width=10)
        d = wrap(meaning, TEXT + 4, A["w"] - 0.8, WHITE, "MEDIUM", max_lines=4) if meaning else VGroup()
        g = VGroup(t, under, d).arrange(DOWN, buff=0.4)
        self.place(g)
        under.put_start_and_end_on(t.get_corner(DL) + DOWN * 0.25, t.get_corner(DR) + DOWN * 0.25)
        self.p(Write(t), rt=0.7)
        self.p(Create(under), rt=0.35)
        self.stage += [t, under]
        if meaning:
            self.until(self.cue_times(tm, [meaning])[0])
            self.p(FadeIn(d, shift=UP * 0.2), rt=0.45)
            self.stage.append(d)

    def s_quiz(self, sc, tm, color):
        self.heading("QUICK QUIZ", color)
        q = wrap(sc.get("heading") or "", TEXT + 8, STAGE["w"] - 0.4, max_lines=4)
        opts = (sc.get("items") or [])[:4]
        ans = int(sc.get("answer") or 0) if str(sc.get("answer", "0")).isdigit() else 0
        btns, q_slots = [], []
        for k, o in enumerate(opts):
            spec = self.icon_spec(sc, o)
            lab = wrap(f"{'ABCD'[k]}) {o.get('label', '')}", TEXT - 2, (STAGE["w"] - 1.2 if SHORT else STAGE["w"] / 2 - 1.2) - (1.0 if spec else 0), align=LEFT, max_lines=2)
            if spec:
                sl = self.slot(0.85 if SHORT else 0.75)
                lab = VGroup(sl, lab).arrange(RIGHT, buff=0.25)
                q_slots.append((k, sl, spec))
            btns.append(card(lab, CYAN, min_w=(STAGE["w"] - 0.6) if SHORT else STAGE["w"] / 2 - 0.6, fill_opacity=0.12))
            if spec:  # keep the option left-aligned in its card
                lab.align_to(btns[-1][0], LEFT).shift(RIGHT * 0.35)
        grid = VGroup(*btns).arrange(DOWN, buff=0.3) if SHORT else VGroup(*btns).arrange_in_grid(rows=math.ceil(len(btns) / 2), cols=2, buff=0.3)
        g = VGroup(q, grid).arrange(DOWN, buff=0.6)
        self.place(g, top_gap=0.3)
        self.p(FadeIn(q, shift=UP * 0.2), rt=0.4)
        self.attach_icons(sc, tm, q_slots, [self.now() + 0.15 * k for k in range(len(opts))])
        self.p(LaggedStart(*[FadeIn(b, shift=UP * 0.15) for b in btns], lag_ratio=0.2), rt=0.8)
        self.stage += [q] + btns
        talk_end = tm["talk"][1]
        reveal_at = max(self.now() + 1.0, self.word_time(tm, "answer", talk_end - 1.6) if "answer" in sc.get("say", "").lower() else talk_end - 1.6)
        bar = Rectangle(width=STAGE["w"] - 0.6, height=0.14, fill_color=AMBER, fill_opacity=1, stroke_width=0).next_to(grid, DOWN, buff=0.35)
        self.add(bar)
        self.stage.append(bar)
        wait = reveal_at - self.now()
        if wait > 0.2:
            self.play(bar.animate.stretch_to_fit_width(0.02).align_to(bar, LEFT), run_time=wait, rate_func=linear)
        if 0 <= ans < len(btns):
            right = btns[ans]
            self.p(right[0].animate.set_fill(GREEN, 0.45).set_stroke(GREEN), FadeOut(bar), *[b.animate.set_opacity(0.35) for k, b in enumerate(btns) if k != ans], rt=0.4)
            self.stage.remove(bar)
            mark = tick().next_to(right, RIGHT, buff=-0.6)
            self.p(Create(mark), rt=0.3)
            self.stage.append(mark)

    def s_recap(self, sc, tm, color):
        self.heading(sc.get("heading") or "QUICK RECAP", color)
        items = (sc.get("items") or [])[:5]
        if len(items) <= 3:
            self.with_visual(sc, tm, 0.4)
        rows, r_slots = VGroup(), []
        for k, it in enumerate(items):
            mark = tick(GREEN, 1.1)
            spec = self.icon_spec(sc, it)
            parts = [mark]
            if spec:
                sl = self.slot(0.85 if SHORT else 0.75)
                parts.append(sl)
                r_slots.append((k, sl, spec))
            parts.append(wrap(it.get("label", ""), TEXT + 2, self.area["w"] - 1.4 - (1.0 if spec else 0), align=LEFT, max_lines=2))
            rows.add(VGroup(*parts).arrange(RIGHT, buff=0.3))
        rows.arrange(DOWN, buff=0.5 if SHORT else 0.32, aligned_edge=LEFT)
        self.place(rows, top_gap=0.3)
        self.stage.append(rows)
        self.attach_icons(sc, tm, r_slots, self.cue_times(tm, [it.get("label", "") for it in items]))
        self.reveal(tm, [(it.get("label", ""),) for it in items], lambda k: [Create(rows[k][0]), FadeIn(VGroup(*rows[k][1:]), shift=RIGHT * 0.3)])

    def s_outro(self, sc, tm, color):
        msg = wrap(sc.get("heading") or "Thanks for watching!", 76 if SHORT else 72, STAGE["w"] * 0.95, max_lines=3)
        for k, line in enumerate(msg):
            if k == len(msg) - 1 and len(msg) > 1:
                line.set_fill(AMBER)
        channel = (SCRIPT.get("channel") or "").strip()
        follow = pill(sc.get("big") or (f"FOLLOW {channel.upper()}" if channel else "SUBSCRIBE FOR MORE"), PINK, size=38 if SHORT else 34)
        fit(follow, STAGE["w"])
        logo = None
        if LOGO.exists():
            logo = ImageMobject(str(LOGO))
            logo.height = 2.6 if SHORT else 2.0
        g = Group(*[m for m in (msg, logo, follow) if m is not None]).arrange(DOWN, buff=0.5)
        fit(g, STAGE["w"], STAGE["h"])
        g.move_to([STAGE["cx"], STAGE["cy"], 0])
        self.p(Write(msg), rt=0.8)
        self.until(self.word_time(tm, "follow" if channel else "subscribe", tm["talk"][0] + 1.0) - 0.3)
        if logo is not None:
            self.p(FadeIn(logo, scale=0.6), rt=0.45)
        self.p(GrowFromCenter(follow), rt=0.4)
        self.p(Indicate(follow, color=AMBER, scale_factor=1.06), rt=0.6)
        self.stage += [m for m in (msg, logo, follow) if m is not None]


if __name__ == "__main__":
    out = ITEM / "media"
    cfg = {"pixel_width": 1080 if SHORT else 1920, "pixel_height": 1920 if SHORT else 1080, "frame_width": FW, "frame_height": FH,
           "frame_rate": 30, "background_color": BG, "media_dir": str(out), "output_file": "animation",
           "disable_caching": True, "verbosity": "WARNING", "progress_bar": "none"}
    if len(sys.argv) > 2 and sys.argv[2] == "preview":
        cfg.update(pixel_width=cfg["pixel_width"] // 2, pixel_height=cfg["pixel_height"] // 2, frame_rate=15, output_file="preview")
    with tempconfig(cfg):
        Edu().render()
