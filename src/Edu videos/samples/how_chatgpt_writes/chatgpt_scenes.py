"""Explainer animation (Manim): "How ChatGPT Actually Writes Its Answers", a 1080x1920 Short.

Every scene lasts exactly as long as its narration (timing.json from voice.py), and key moments
are pinned to the caption chunk that mentions them (self.cue). Visuals are animated diagrams
(tokens, number grids, attention links, layers, score bars, the repeat loop), not illustrations.

Run with the animation venv:  python scenes.py <explainer folder> <work folder>"""
import json, pathlib, random, sys

import numpy as np
from manim import *  # noqa: F403

from gtext import GText

HERE = pathlib.Path(__file__).resolve().parent

SRC, WORK = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
if not SRC.is_absolute():
    SRC = HERE / SRC
SCRIPT = json.loads((SRC / "script.json").read_text(encoding="utf-8"))
TIMING = json.loads((WORK / "timing.json").read_text(encoding="utf-8"))

BG, PANEL, INKC, MUTED = "#0B1026", "#182050", "#1C1840", "#9AA3C7"
AMBER, CYAN, PINK, GREEN, PURPLE, REDC = "#FFB300", "#00C2FF", "#FF5C8D", "#7CDC5C", "#A855F7", "#EF4444"
TOKC = [CYAN, AMBER, PINK, GREEN, PURPLE, CYAN]
KEYWORDS = ["tokens", "numbers", "attention", "layers", "next token", "parameters", "human feedback",
            "blue", "sky", "prediction", "magic", "tiny piece", "Chaos Creators", "again"]
CAP_Y, STAGE_TOP = -6.05, 5.6


def T(s, size=48, color=WHITE, weight=BOLD, **kw):
    return GText(s, font_size=size, color=color, weight=weight, **kw)


def fit(m, w):
    if m.width > w:
        m.scale_to_fit_width(w)
    return m


def pill(s, fill, ink=WHITE, size=34, padx=0.38, pady=0.2):
    t = T(s, size, ink)
    h = T("Hg", size).height + 2 * pady
    r = RoundedRectangle(corner_radius=h / 2, width=t.width + 2 * padx, height=h,
                         fill_color=fill, fill_opacity=1, stroke_width=0)
    t.move_to(r)
    return VGroup(r, t)


def chip(tok, color, w=2.5, h=0.84, size=40):
    r = RoundedRectangle(corner_radius=0.22, width=w, height=h, fill_color=color, fill_opacity=0.18,
                         stroke_color=color, stroke_width=4)
    t = T(tok.strip(), size).move_to(r)
    return VGroup(r, t)


def tick(color=GREEN, s=1.0):
    return VMobject(stroke_color=color, stroke_width=10).set_points_as_corners(
        [[-0.22 * s, 0.0, 0], [-0.06 * s, -0.17 * s, 0], [0.26 * s, 0.2 * s, 0]])


def cross(color=REDC, s=1.0):
    a = 0.18 * s
    return VGroup(Line([-a, -a, 0], [a, a, 0]), Line([-a, a, 0], [a, -a, 0])).set_stroke(color, 10)


def word_block(words, size, width, color=WHITE, gap=0.22):
    """Wrapped text whose words can be revealed one by one. Returns (block, [word groups])."""
    lines, cur = [], []
    for w in words:
        if cur and T(" ".join(cur + [w]), size).width > width:
            lines.append(cur)
            cur = []
        cur.append(w)
    lines.append(cur)
    rows, groups = [], []
    for ln in lines:
        t = T(" ".join(ln), size, color)
        rows.append(t)
        i = 0
        for w in ln:
            n = len(w.replace(" ", ""))
            groups.append(VGroup(*t[i:i + n]))
            i += n
    return VGroup(*rows).arrange(DOWN, aligned_edge=LEFT, buff=gap), groups


def glow(color, radius, center, strength=0.05, rings=9):
    return VGroup(*[Circle(radius=radius * (1 - k / rings), fill_color=color, fill_opacity=strength,
                           stroke_width=0).move_to(center) for k in range(rings)])


class Explainer(Scene):
    # ---------- timing ----------
    def now(self):
        return self.renderer.time

    def until(self, t):
        d = t - self.now()
        if d > 1 / 60:
            self.wait(d)

    def cue(self, sc, word, extra=0.0):
        for c in sc["captions"]:
            if word.lower() in c["text"].lower():
                return c["start"] + extra
        print(f"[cue] \"{word}\" not found in {sc['id']}", flush=True)
        return sc["start"] + extra

    def p(self, *anims, rt=0.6, **kw):
        self.play(*anims, run_time=rt, **kw)

    # ---------- frame ----------
    def backdrop(self):
        dots = VGroup(*[Dot([x, y, 0], radius=0.022, color=WHITE, fill_opacity=0.10)
                        for x in np.arange(-4.5, 4.6, 0.75) for y in np.arange(-8, 8.1, 0.75)])
        g1, g2 = glow(CYAN, 4.2, [-3.2, 5.0, 0], 0.018), glow(PINK, 4.6, [3.4, -3.8, 0], 0.016)
        self.add(dots, g1, g2)
        clock = ValueTracker(0)
        g1.add_updater(lambda m, dt: m.move_to([-3.2 + 0.6 * np.sin(self.now() / 5), 5.0 + 0.4 * np.cos(self.now() / 6), 0]))
        g2.add_updater(lambda m, dt: m.move_to([3.4 + 0.5 * np.cos(self.now() / 5.5), -3.8 + 0.5 * np.sin(self.now() / 4.5), 0]))
        logo = ImageMobject(str(WORK / "logo_round.png")).set_height(1.0).move_to([-3.75, 7.2, 0])
        kick = pill(SCRIPT["kicker"], PINK, size=30).move_to([0, 7.2, 0])
        self.add(logo, kick)
        self.add(clock)

    def captions(self):
        caps = []
        for sc in TIMING["scenes"]:
            for c in sc["captions"]:
                text = c["text"]
                t2c = {k: AMBER for k in KEYWORDS if k.lower() in text.lower()}
                t2c = {text[text.lower().index(k.lower()):text.lower().index(k.lower()) + len(k)]: v for k, v in t2c.items()}
                t = fit(T(text, 52, WHITE, t2c=t2c), 7.9)
                box = RoundedRectangle(corner_radius=0.28, width=t.width + 0.7, height=1.05,
                                       fill_color="#000000", fill_opacity=0.6, stroke_width=0)
                t.move_to(box)
                caps.append((c["start"], c["end"], VGroup(box, t).move_to([0, CAP_Y, 0])))
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

    def heading(self, s, fill=AMBER, ink=INKC):
        h = pill(s, fill, ink, size=34).move_to([0, STAGE_TOP, 0])
        self.p(FadeIn(h, shift=DOWN * 0.3), rt=0.35)
        return h

    def clear(self, *keep, rt=0.35):
        gone = [m for m in self.stage if m not in keep]
        if gone:
            self.p(*[FadeOut(m) for m in gone], rt=rt)
        self.stage = list(keep)

    def show(self, *ms):
        self.stage += [m for m in ms if m not in self.stage]

    # ---------- the video ----------
    def construct(self):
        self.stage = []
        self.backdrop()
        self.captions()
        S = {sc["id"]: sc for sc in TIMING["scenes"]}
        for sid in ["hook", "tokens", "numbers", "attention", "layers", "predict", "loop", "training", "outro"]:
            sc = S[sid]
            getattr(self, "s_" + sid)(sc)
            end = sc["start"] + sc["dur"]
            over = self.now() - end
            print(f"[scene] {sid:10s} ends {self.now():6.2f} target {end:6.2f}" + (f"  OVER by {over:.2f}" if over > 0.05 else ""), flush=True)
            self.until(end)

    def s_hook(self, sc):
        t1 = fit(T("How ChatGPT", 80), 8.2)
        t2 = fit(T("Writes Its Answers", 80, AMBER), 8.2)
        title = VGroup(t1, t2).arrange(DOWN, buff=0.12).move_to([0, 4.75, 0])
        q = T(SCRIPT["prompt"], 42, INKC)
        qb = RoundedRectangle(corner_radius=0.35, width=q.width + 0.8, height=1.0, fill_color=CYAN, fill_opacity=1, stroke_width=0)
        q.move_to(qb)
        ask = VGroup(qb, q).move_to([0, 2.45, 0]).align_to([4.0, 0, 0], RIGHT)
        words = (SCRIPT["answer_start"] + "".join(SCRIPT["answer_more"])).split()
        block, groups = word_block(words, 42, 6.9)
        ab = RoundedRectangle(corner_radius=0.35, width=7.7, height=block.height + 0.9, fill_color=PANEL, fill_opacity=1,
                              stroke_color=CYAN, stroke_width=2, stroke_opacity=0.5)
        ab.move_to([-0.2, 0.2, 0]).align_to([-4.0, 0, 0], LEFT)
        block.move_to(ab).align_to(ab.get_left() + RIGHT * 0.4, LEFT)
        self.p(Write(t1), FadeIn(t2, shift=UP * 0.3), rt=0.8)
        self.p(FadeIn(ask, shift=LEFT * 0.5), rt=0.45)
        self.p(FadeIn(ab), rt=0.3)
        self.p(LaggedStart(*[FadeIn(g, shift=UP * 0.12, scale=1.15) for g in groups], lag_ratio=1), rt=2.4)
        self.until(self.cue(sc, "tiny piece"))
        tag = pill("ONE PIECE AT A TIME", PINK, size=40).move_to([0, -2.7, 0])
        self.p(GrowFromCenter(tag), rt=0.4)
        self.p(Indicate(tag, color=AMBER, scale_factor=1.08), rt=0.6)
        arrow = Arrow([0, -3.35, 0], [0, -4.6, 0], color=AMBER, stroke_width=10, buff=0)
        self.until(self.cue(sc, "how"))
        self.p(GrowArrow(arrow), rt=0.35)
        self.show(title, ask, ab, block, tag, arrow)
        self.until(sc["start"] + sc["dur"] - 0.4)
        self.clear()

    def column(self, x=-2.6):
        return [np.array([x, 3.1 - i * 1.05, 0]) for i in range(len(SCRIPT["tokens"]))]

    def s_tokens(self, sc):
        h = self.heading("STEP 1 · TOKENS")
        toks = SCRIPT["tokens"]
        parts = [T(t.strip(), 60) for t in toks]
        row = VGroup(*parts).arrange(RIGHT, buff=0.22)
        parts[-1].next_to(parts[-2], RIGHT, buff=0.05)
        fit(row, 8.0).move_to([0, 3.9, 0])
        self.p(FadeIn(row, shift=UP * 0.2), rt=0.45)
        self.until(self.cue(sc, "chopped"))
        cut = VGroup(*[DashedLine(parts[i].get_right() + RIGHT * 0.08 + UP * 0.45, parts[i].get_right() + RIGHT * 0.08 + DOWN * 0.45,
                                  color=AMBER, stroke_width=4) for i in range(len(parts) - 1)])
        self.p(LaggedStart(*[Create(c) for c in cut], lag_ratio=0.3), rt=0.5)
        pos = self.column()
        self.chips = [chip(t, TOKC[i]).move_to(pos[i]) for i, t in enumerate(toks)]
        self.p(FadeOut(cut), LaggedStart(*[AnimationGroup(ReplacementTransform(parts[i], self.chips[i][1]), FadeIn(self.chips[i][0], scale=0.6))
                                           for i in range(len(toks))], lag_ratio=0.15), rt=1.2)
        br = Brace(VGroup(*self.chips), RIGHT, color=AMBER)
        lab = VGroup(T(str(len(toks)), 72, AMBER), T("tokens", 40)).arrange(DOWN, buff=0.05).next_to(br, RIGHT, buff=0.3)
        self.p(GrowFromCenter(br), FadeIn(lab, shift=LEFT * 0.3), rt=0.45)
        self.show(h, *self.chips, br, lab)
        self.until(sc["start"] + sc["dur"] - 0.35)
        self.clear(*self.chips)

    def s_numbers(self, sc):
        h = self.heading("STEP 2 · NUMBERS")
        rnd = random.Random(7)
        rows = []
        for i, c in enumerate(self.chips):
            y = c.get_center()[1]
            arr = Arrow([-1.25, y, 0], [-0.45, y, 0], color=MUTED, stroke_width=5, buff=0, max_tip_length_to_length_ratio=0.35)
            cells = VGroup()
            for k in range(5):
                v = rnd.uniform(-0.99, 0.99)
                col = interpolate_color(ManimColor(CYAN), ManimColor(PINK), (v + 1) / 2)
                sq = RoundedRectangle(corner_radius=0.08, width=0.82, height=0.7, fill_color=col, fill_opacity=0.25 + 0.6 * abs(v),
                                      stroke_color=col, stroke_width=2)
                num = T(f"{v:+.2f}".replace("+", ""), 19).move_to(sq)
                cells.add(VGroup(sq, num))
            cells.arrange(RIGHT, buff=0.08).move_to([1.85, y, 0])
            dots = T("…", 30, MUTED).next_to(cells, RIGHT, buff=0.08)
            rows.append(VGroup(arr, cells, dots))
        self.p(LaggedStart(*[AnimationGroup(GrowArrow(r[0]), LaggedStart(*[FadeIn(cl, scale=0.5) for cl in r[1]], lag_ratio=0.2), FadeIn(r[2]))
                             for r in rows], lag_ratio=0.18), rt=1.9)
        self.until(self.cue(sc, "stores", 0.1))
        sky = rows[3][1]
        box = SurroundingRectangle(VGroup(self.chips[3], rows[3]), color=AMBER, buff=0.12, corner_radius=0.2, stroke_width=5)
        note = T("“sky” as numbers", 34, AMBER).next_to(box, DOWN, buff=0.2).shift(DOWN * 0)
        note.move_to([0.6, -3.35, 0])
        self.p(Create(box), FadeIn(note, shift=UP * 0.2), rt=0.5)
        self.p(LaggedStart(*[Indicate(cl, color=AMBER, scale_factor=1.12) for cl in sky], lag_ratio=0.15), rt=0.8)
        self.show(h, *rows, box, note)
        self.until(sc["start"] + sc["dur"] - 0.35)
        self.clear(*self.chips)

    def s_attention(self, sc):
        h = self.heading("STEP 3 · ATTENTION")
        x = -1.6
        self.p(*[c.animate.move_to([x, c.get_center()[1], 0]) for c in self.chips], rt=0.45)
        edge = x + 1.3
        rnd = random.Random(3)
        n = len(self.chips)
        weak = VGroup()
        for i in range(n):
            for j in range(i + 1, n):
                if (i, j) in ((3, 4), (0, 4)):
                    continue
                w = rnd.uniform(0.15, 0.45)
                a = ArcBetweenPoints([edge, self.chips[i].get_center()[1], 0], [edge, self.chips[j].get_center()[1], 0], angle=-PI * 0.92)
                weak.add(a.set_stroke(CYAN, 2 + 5 * w, opacity=0.25 + 0.5 * w))
        self.p(LaggedStart(*[Create(a) for a in weak], lag_ratio=0.08), rt=1.6)
        self.until(self.cue(sc, "blue connects"))
        mid = ArcBetweenPoints([edge, self.chips[0].get_center()[1], 0], [edge, self.chips[4].get_center()[1], 0], angle=-PI * 0.92).set_stroke(PINK, 6, opacity=0.8)
        strong = ArcBetweenPoints([edge, self.chips[3].get_center()[1], 0], [edge, self.chips[4].get_center()[1], 0], angle=-PI * 0.95).set_stroke(AMBER, 16)
        self.p(weak.animate.set_stroke(opacity=0.12), Indicate(self.chips[4], color=AMBER, scale_factor=1.12), rt=0.5)
        self.p(Create(strong), Create(mid), rt=0.6)
        self.p(Flash(self.chips[3].get_right() + RIGHT * 0.05, color=AMBER, line_length=0.35, num_lines=12, flash_radius=0.5),
               self.chips[3][0].animate.set_fill(AMBER, 0.5), self.chips[4][0].animate.set_fill(AMBER, 0.5), rt=0.6)
        lab = VGroup(T("strong", 40, AMBER), T("link", 40, AMBER)).arrange(DOWN, buff=0.02).move_to([3.0, (self.chips[3].get_center()[1] + self.chips[4].get_center()[1]) / 2, 0])
        self.p(FadeIn(lab, shift=LEFT * 0.3), rt=0.35)
        self.show(h, weak, mid, strong, lab)
        self.until(sc["start"] + sc["dur"] - 0.35)
        self.clear(*self.chips)
        for c in self.chips:
            c[0].set_fill(opacity=0.18)

    def s_layers(self, sc):
        h = self.heading("STEP 4 · LAYERS")
        n = len(self.chips)
        dots = [Dot([-2.5 + k * 1.0, -3.9, 0], radius=0.17, color=TOKC[k]) for k in range(n)]
        self.p(*[ReplacementTransform(self.chips[k], dots[k]) for k in range(n)], rt=0.6)
        names = ["Layer 1", "Layer 2", "Layer 3", "Layer 4", "· · ·", "Layer N"]
        slabs = []
        for k, nm in enumerate(names):
            y = -2.75 + k * 1.1
            r = RoundedRectangle(corner_radius=0.2, width=6.6, height=0.78, fill_color=CYAN, fill_opacity=0.10, stroke_color=CYAN, stroke_width=3)
            r.move_to([0, y, 0])
            slabs.append(VGroup(r, T(nm, 30, WHITE).move_to(r)))
        top = pill("DOZENS OF LAYERS", AMBER, INKC, size=32).move_to([0, 4.3, 0])
        self.p(LaggedStart(*[FadeIn(s, shift=UP * 0.25) for s in slabs], lag_ratio=0.2), FadeIn(top, scale=0.7), rt=0.8)
        rise = 7.6
        total = max(1.2, sc["start"] + sc["dur"] - self.now() - 1.35)
        flashes = []
        for k, s in enumerate(slabs):
            at = (s.get_center()[1] - (-3.9)) / rise * total
            flashes.append(Succession(Wait(run_time=max(0.01, at - 0.12)),
                                      s[0].animate(run_time=0.25).set_fill(CYAN, 0.55),
                                      s[0].animate(run_time=0.4).set_fill(CYAN, 0.16)))
        dg = VGroup(*dots)
        self.play(dg.animate.shift(UP * rise), *flashes, run_time=total + 0.1, rate_func=linear)
        self.p(Flash(dg.get_center(), color=AMBER, line_length=0.5, num_lines=16, flash_radius=1.0), dg.animate.scale(1.25), rt=0.45)
        self.show(h, dg, top, *slabs)
        self.until(sc["start"] + sc["dur"] - 0.3)
        self.clear()

    def s_predict(self, sc):
        h = self.heading("STEP 5 · PREDICT")
        l1 = T("The sky looks blue", 54)
        l2a = T("because", 54)
        blank = Rectangle(width=2.6, height=0.09, fill_color=AMBER, fill_opacity=1, stroke_width=0)
        l2 = VGroup(l2a, blank).arrange(RIGHT, buff=0.3, aligned_edge=DOWN)
        sent = VGroup(l1, l2).arrange(DOWN, buff=0.2, aligned_edge=LEFT).move_to([0, 3.75, 0])
        self.p(FadeIn(sent, shift=UP * 0.2), rt=0.4)
        rows = []
        for k, (w, pr) in enumerate(SCRIPT["choices"]):
            y = 1.7 - k * 1.1
            lab = T(w, 40).move_to([-2.4, y, 0]).align_to([-1.45, 0, 0], RIGHT)
            bar = Rectangle(width=max(0.15, pr * 9.0), height=0.66, fill_color=TOKC[k], fill_opacity=0.9, stroke_width=0)
            bar.move_to([0, y, 0]).align_to([-1.15, 0, 0], LEFT)
            pct = T(f"{round(pr * 100)}%", 36, TOKC[k]).next_to(bar, RIGHT, buff=0.2)
            rows.append(VGroup(lab, bar, pct))
        note = T("example scores", 26, MUTED, weight=NORMAL).move_to([2.4, 1.7 - 4 * 1.1 + 0.25, 0])
        self.p(LaggedStart(*[AnimationGroup(FadeIn(r[0]), GrowFromEdge(r[1], LEFT), FadeIn(r[2])) for r in rows], lag_ratio=0.25),
               FadeIn(note), rt=1.3)
        self.until(self.cue(sc, "picks"))
        win = SurroundingRectangle(rows[0], color=GREEN, buff=0.15, corner_radius=0.18, stroke_width=6)
        self.p(Create(win), rt=0.3)
        word = T(SCRIPT["choices"][0][0], 54, AMBER).next_to(l2a, RIGHT, buff=0.3).align_to(l2a, DOWN)
        self.p(TransformFromCopy(rows[0][0], word), FadeOut(blank), rt=0.55)
        self.p(Indicate(word, color=GREEN, scale_factor=1.15), rt=0.4)
        self.show(h, sent, word, *rows, note, win)
        self.sentence = None
        self.until(sc["start"] + sc["dur"] - 0.35)
        self.clear()

    def s_loop(self, sc):
        h = self.heading("STEP 6 · REPEAT")
        start = (SCRIPT["answer_start"] + " " + SCRIPT["choices"][0][0]).split()
        more = [w.strip() for w in SCRIPT["answer_more"][1:]]
        block, groups = word_block(start + more, 46, 7.3)
        box = RoundedRectangle(corner_radius=0.35, width=8.1, height=block.height + 0.8, fill_color=PANEL, fill_opacity=1,
                               stroke_color=CYAN, stroke_width=2, stroke_opacity=0.5)
        box.move_to([0, 4.95 - box.height / 2, 0])
        block.move_to(box)
        c = np.array([0, -1.95, 0])
        R = 2.0
        angs = [PI / 2, -PI / 6, PI + PI / 6]
        nodes = []
        for a, (nm, col) in zip(angs, [("READ", CYAN), ("SCORE", AMBER), ("ADD", GREEN)]):
            circ = Circle(radius=0.82, fill_color=PANEL, fill_opacity=1, stroke_color=col, stroke_width=6)
            circ.move_to(c + R * np.array([np.cos(a), np.sin(a), 0]))
            nodes.append(VGroup(circ, T(nm, 30, col).move_to(circ)))
        gap = 0.47
        arcs = VGroup()
        for k in range(3):
            a0 = angs[k]
            arc = Arc(radius=R, start_angle=a0 - gap, angle=-(TAU / 3 - 2 * gap), arc_center=c, stroke_color=MUTED, stroke_width=6)
            arc.add_tip(tip_length=0.28, tip_width=0.28)
            arcs.add(arc)
        self.p(FadeIn(box), FadeIn(VGroup(*groups[:len(start)])), rt=0.4)
        self.p(LaggedStart(*[GrowFromCenter(nd) for nd in nodes], lag_ratio=0.25), Create(arcs), rt=0.7)
        dot = Dot(c + R * UP, radius=0.2, color=AMBER)
        self.add(dot)
        self.bring_to_front(*nodes)          # the dot passes behind the node circles, not over their labels
        path = Arc(radius=R, start_angle=PI / 2, angle=-TAU, arc_center=c)
        left = sc["start"] + sc["dur"] - 0.45 - self.now()
        per = max(0.8, min(1.2, (left - 0.3) / len(more)))
        for g in groups[len(start):]:
            self.play(MoveAlongPath(dot, path), run_time=per - 0.22, rate_func=linear)
            self.p(FadeIn(g, scale=1.4), Flash(nodes[2].get_center(), color=GREEN, flash_radius=0.95, line_length=0.3), rt=0.22)
        self.show(h, box, block, *nodes, arcs, dot)
        self.until(sc["start"] + sc["dur"] - 0.35)
        self.clear()

    def s_training(self, sc):
        h = self.heading("HOW IT LEARNED", PURPLE, WHITE)
        c = np.array([1.5, 0.9, 0])
        box = RoundedRectangle(corner_radius=0.3, width=4.6, height=4.2, fill_color=PANEL, fill_opacity=1, stroke_color=PURPLE, stroke_width=4).move_to(c)
        grid = VGroup(*[Dot(c + np.array([(i - 4) * 0.48, (j - 3.5) * 0.48, 0]), radius=0.09, color=MUTED) for i in range(9) for j in range(8)])
        self.p(FadeIn(box), LaggedStart(*[FadeIn(d, scale=0.3) for d in grid], lag_ratio=0.01), rt=0.7)
        pages = []
        rnd = random.Random(11)
        for k in range(9):
            pg = RoundedRectangle(corner_radius=0.06, width=0.85, height=1.1, fill_color=WHITE, fill_opacity=0.92, stroke_width=0)
            lines = VGroup(*[Line(LEFT * 0.28, RIGHT * (0.28 - 0.12 * (q == 3)), stroke_color=MUTED, stroke_width=4).shift(UP * (0.3 - 0.2 * q)) for q in range(4)])
            pages.append(VGroup(pg, lines.move_to(pg)).move_to([-3.4 + rnd.uniform(-0.3, 0.3), 2.6 - k * 0.55 + rnd.uniform(-0.1, 0.1), 0]).rotate(rnd.uniform(-0.25, 0.25)))
        self.p(LaggedStart(*[FadeIn(pg, shift=RIGHT * 0.6) for pg in pages], lag_ratio=0.12), rt=0.9)
        self.p(LaggedStart(*[pg.animate.move_to(c).scale(0.15).set_opacity(0) for pg in pages], lag_ratio=0.12), rt=1.4)
        self.until(self.cue(sc, "guessing"))
        g1 = T("The cat sat on the", 44)
        blank = Rectangle(width=1.5, height=0.08, fill_color=AMBER, fill_opacity=1, stroke_width=0)
        gl = VGroup(g1, blank).arrange(RIGHT, buff=0.22, aligned_edge=DOWN).move_to([0, 4.25, 0])
        self.p(FadeIn(gl, shift=DOWN * 0.2), rt=0.35)
        bad = T("sofa", 44, REDC).next_to(g1, RIGHT, buff=0.22).align_to(g1, DOWN)
        self.p(FadeIn(bad, shift=DOWN * 0.3), rt=0.3)
        x = cross().scale(0.9).next_to(bad, RIGHT, buff=0.15)
        self.p(Create(x), rt=0.25)
        good = T("mat", 44, GREEN).move_to(bad).align_to(bad, LEFT)
        self.p(FadeOut(bad), FadeOut(x), FadeIn(good, shift=DOWN * 0.3), rt=0.35)
        tk = tick().next_to(good, RIGHT, buff=0.15)
        self.p(Create(tk), FadeOut(blank), rt=0.3)
        self.until(self.cue(sc, "tuning"))
        lab = T("billions of parameters", 38, AMBER).move_to([c[0] - 0.4, c[1] - 2.65, 0])
        fit(lab, 8)
        lab.move_to([0, c[1] - 2.65, 0])
        self.p(FadeIn(lab, shift=UP * 0.2), rt=0.3)
        rnd2 = random.Random(5)
        for _ in range(3):
            self.p(*[d.animate.set_color(rnd2.choice([CYAN, AMBER, PINK, GREEN, PURPLE, MUTED])).scale(rnd2.uniform(0.8, 1.25) / max(d.width / 0.18, 0.5))
                     for d in grid], rt=0.45)
        self.until(self.cue(sc, "human feedback"))
        fb = T("Human feedback", 40, WHITE).move_to([0, -2.85, 0])
        cards = []
        for k, (nm, good_) in enumerate([("Answer A", True), ("Answer B", False)]):
            r = RoundedRectangle(corner_radius=0.22, width=3.6, height=1.05, fill_color=PANEL, fill_opacity=1,
                                 stroke_color=GREEN if good_ else REDC, stroke_width=4)
            t = T(nm, 34).move_to(r).shift(LEFT * 0.35)
            mark = (tick() if good_ else cross()).move_to(r.get_right() + LEFT * 0.5)
            cards.append(VGroup(r, t, mark).move_to([-1.95 + k * 3.9, -4.0, 0]))
        self.p(FadeIn(fb, shift=UP * 0.2), LaggedStart(*[FadeIn(cd, scale=0.8) for cd in cards], lag_ratio=0.3), rt=0.6)
        self.p(Indicate(cards[0], color=GREEN, scale_factor=1.06), rt=0.5)
        self.show(h, box, grid, gl, good, tk, lab, fb, *cards, *pages)
        self.until(sc["start"] + sc["dur"] - 0.35)
        self.clear()

    def s_outro(self, sc):
        m1 = T("Not magic.", 100)
        self.p(Write(m1.move_to([0, 3.6, 0])), rt=0.7)
        self.until(self.cue(sc, "prediction"))
        m2 = fit(T("It's prediction", 66, AMBER), 8.2)
        m3 = fit(T("at a massive scale.", 58), 8.2)
        VGroup(m2, m3).arrange(DOWN, buff=0.15).move_to([0, 1.75, 0])
        self.p(FadeIn(m2, shift=UP * 0.3), rt=0.4)
        self.p(FadeIn(m3, shift=UP * 0.3), rt=0.35)
        self.until(self.cue(sc, "follow"))
        logo = ImageMobject(str(WORK / "logo_round.png")).set_height(2.9).move_to([0, -1.6, 0])
        f = pill("FOLLOW CHAOS CREATORS", PINK, size=38).move_to([0, -3.75, 0])
        self.play(FadeIn(logo, scale=0.6), run_time=0.45)
        self.p(GrowFromCenter(f), rt=0.4)
        self.p(Indicate(f, color=AMBER, scale_factor=1.06), rt=0.6)
        self.show(m1, m2, m3, f)


if __name__ == "__main__":
    cfg = {"pixel_width": 1080, "pixel_height": 1920, "frame_width": 9, "frame_height": 16, "frame_rate": 30,
           "background_color": BG, "media_dir": str(WORK / "media"), "output_file": "animation",
           "disable_caching": True, "verbosity": "WARNING", "progress_bar": "none"}
    if len(sys.argv) > 3 and sys.argv[3] == "preview":
        cfg.update(pixel_width=540, pixel_height=960, frame_rate=15, output_file="preview")
    with tempconfig(cfg):
        Explainer().render()
