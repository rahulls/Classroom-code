"""Scene visuals for the Edu videos: 3D, scientific, moving with the narration.

make_visual(kind, subject, w, h, short, animate) builds one; every visual is a Group whose
tick(t) places everything for scene time t (an updater calls it each frame), after
.timeline(t_in, cues) told it when to appear and when its main moments happen (the words that
name them in the narration). Kinds:

  molecule  subject = formula ("H2O")            a turning ball-and-stick molecule + its 3D formula
  reaction  subject = equation ("2H2 + O2 -> 2H2O")  molecules collide, atoms regroup into products
  states    subject = solid | liquid | gas | melting | freezing | boiling | evaporation |
                      condensation | sublimation | heating | cooling     ice cube / puddle or drop /
                      vapour, morphing into each other; heat speeds the particles up slow -> fast
  balloon   subject = gas | air | molecules, + "heat" or "inflate"   gas particles inside a 3D balloon
  atom      subject = element symbol ("Na")      Bohr model: nucleus + electrons orbiting in shells
  ions      subject = "Na>Cl"                    electron transfer, the two ions attract
  lattice   subject = "NaCl" | metal symbol      a turning 3D crystal (metals: sea of electrons)
  mixture   subject = "N2*8, O2*2, Ar"           different molecules moving together (gas: in the open; with water: in a drop)
  beaker    subject = "acid", "red->blue", "fizz", "ph:3" (comma separated)   a 3D beaker
  formula   subject = formula or equation        big 3D formula turning
  sticker   subject = sticker name | "a -> b -> c" | "a, b, c"   3D stickers popping in on cue

Stickers: 3D Fluent emoji (MIT) in src/Edu videos/stickers (names in stickers.json).
"""
import json, math, pathlib, random, re

import numpy as np
from manim import (Animation, DOWN, LEFT, ORIGIN, RIGHT, UP, Arrow, Circle, Ellipse, Group, ImageMobject, Line, Polygon, Rectangle,
                   RoundedRectangle, VGroup, VMobject, WHITE, ManimColor, smooth)

import sci3d as S
from gtext import GText

HERE = pathlib.Path(__file__).resolve().parent
STICKER_DIR = HERE.parent / "stickers"
try:
    STICKERS = json.loads((STICKER_DIR / "stickers.json").read_text(encoding="utf-8"))
except OSError:
    STICKERS = {}
STICKER_ALIAS = {
    "water": "droplet", "drop": "droplet", "ice_cube": "ice", "flame": "fire", "burning": "fire", "heat": "fire", "cold": "snowflake",
    "steam": "cloud", "gas": "cloud", "air": "wind_face", "wind": "wind_face", "earth": "globe_showing_asia_australia",
    "globe": "globe_showing_asia_australia", "world": "globe_showing_asia_australia", "apple": "red_apple", "iron": "nut_and_bolt",
    "metal": "nut_and_bolt", "rust": "chains", "body": "anatomical_heart", "human_body": "anatomical_heart", "heart": "anatomical_heart",
    "lab": "test_tube", "chemistry": "test_tube", "experiment": "test_tube", "flask": "alembic", "atom": "atom_symbol",
    "idea": "light_bulb", "electricity": "high_voltage", "lightning": "high_voltage", "energy": "high_voltage", "time": "stopwatch",
    "plant": "potted_plant", "tree": "deciduous_tree", "leaf": "maple_leaf", "food": "cooking", "egg_cooking": "cooking",
    "fried_egg": "cooking", "paper": "page_facing_up", "book": "books", "question": "red_question_mark", "explosion": "collision",
    "bang": "collision", "salt_shaker": "salt", "sugar": "candy", "milk": "glass_of_milk", "car": "automobile", "sun_light": "sun",
    "star": "sparkles", "medicine": "pill", "germ": "microbe", "bacteria": "microbe", "virus": "microbe", "money": "coin",
    "gold": "coin", "diamond": "gem_stone", "crystal": "gem_stone", "stone": "rock", "smoke": "fog", "rain": "cloud_with_rain",
    "snow": "cloud_with_snow", "cloud_rain": "cloud_with_rain", "ocean": "water_wave", "sea": "water_wave", "river": "water_wave",
    "mountain_snow": "mountain", "breathing": "lungs", "lung": "lungs", "scale": "balance_scale", "weight": "balance_scale",
    "mass": "balance_scale", "measure": "straight_ruler", "ruler": "straight_ruler", "volume": "jar", "container": "jar",
    "temperature": "thermometer", "ice_melting": "ice", "soap_bubbles": "bubbles", "candle_flame": "candle", "torch": "flashlight",
    "battery_cell": "battery", "magnetism": "magnet", "gear_wheel": "gear", "dna_helix": "dna", "cell": "microbe",
}
NEUTRAL = "#9AA3C7"


def sticker_path(name):
    if not name:
        return None
    k = re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")
    k = STICKER_ALIAS.get(k, k)
    if k not in STICKERS:
        k2 = k[:-1] if k.endswith("s") else k + "s"
        k = k2 if k2 in STICKERS else STICKER_ALIAS.get(k2, None)
    if k and k in STICKERS:
        p = STICKER_DIR / f"{k}.png"
        return p if p.exists() else None
    return None


def T(s, size=40, color=WHITE, weight="BOLD"):
    return GText(str(s), font_size=size, color=color, weight=weight)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def pill(s, fill, ink=WHITE, size=30):
    t = T(s, size, ink)
    h = T("Hg", size).height + 0.34
    r = RoundedRectangle(corner_radius=h / 2, width=t.width + 0.6, height=h, fill_color=fill, fill_opacity=1, stroke_width=0)
    t.move_to(r)
    return VGroup(r, t)


# ----------------------------------------------------------------------------- base
class FadeVisual(Animation):
    """Fades a visual out as it is (Manim's FadeOut can't pair up a visual whose parts re-order every frame)."""

    def __init__(self, mob, **kw):
        super().__init__(mob, remover=True, **kw)

    def begin(self):
        self.saved = []
        for m in self.mobject.get_family():
            if isinstance(m, ImageMobject):
                self.saved.append((m, m.pixel_array[:, :, 3].astype(np.float32), None))
            elif isinstance(m, VMobject) and len(m.points):
                self.saved.append((m, m.get_fill_opacity(), m.get_stroke_opacity()))
        super().begin()

    def create_starting_mobject(self):
        return self.mobject

    def interpolate_mobject(self, alpha):
        k = 1 - alpha
        for m, a, b in self.saved:
            if b is None:
                m.pixel_array[:, :, 3] = (a * k).astype(np.uint8)
            else:
                m.set_fill(opacity=a * k, family=False)
                m.set_stroke(opacity=b * k, family=False)


class Visual(Group):
    def __init__(self, w, h, short=True, animate=True):
        super().__init__()
        self.w, self.h, self.short, self.live = w, h, short, animate
        self.pivot = VMobject(fill_opacity=0, stroke_width=0).set_points_as_corners([ORIGIN, 1e-4 * RIGHT])
        self.add(self.pivot)
        self.t_in, self.cues, self.t_end = 0.0, [], 1e9
        self.t_last = 0.0

    def o(self):
        return self.pivot.get_center()

    def place(self, x, y):
        self.pivot.move_to([x, y, 0])
        self.tick(self.t_last)
        return self

    def timeline(self, t_in, cues, t_end):
        self.t_in, self.cues, self.t_end = t_in, list(cues), t_end
        self.tick(t_in - 1)

    def cue(self, k, default=None):
        if k < len(self.cues):
            return self.cues[k]
        return default if default is not None else self.t_in + 0.8 + 0.8 * k

    def appear(self, t, at=None, dur=0.4):
        return ease((t - (self.t_in if at is None else at)) / dur)

    def tick(self, t):
        self.t_last = t

    def clock(self, t):
        """Time used for motion: frozen in sticker (still) mode."""
        return t if self.live else self.t_in + 0.6


def fade_vm(m, a, base=1.0):
    for sm in m.family_members_with_points():
        if isinstance(sm, ImageMobject):
            sm.set_opacity(a)
        else:
            fo = getattr(sm, "_base_fill", None)
            if fo is None:
                sm._base_fill = sm.get_fill_opacity()
                sm._base_stroke = sm.get_stroke_opacity()
                fo = sm._base_fill
            sm.set_fill(opacity=fo * a * base)
            sm.set_stroke(opacity=sm._base_stroke * a * base)


class Sprite(ImageMobject):
    def __init__(self, arr_or_path, height=1.0):
        super().__init__(np.array(arr_or_path) if not isinstance(arr_or_path, (str, pathlib.Path)) else str(arr_or_path))
        self.base_h = height
        self.height = height
        self._a = 1.0

    def put(self, x, y, h=None, a=None):
        if h is not None:
            self.height = max(0.01, h)
            self.width = self.height * self.pixel_array.shape[1] / self.pixel_array.shape[0]
        self.move_to([x, y, 0])
        if a is not None and abs(a - self._a) > 1e-3:
            self._a = a
            self.set_opacity(max(0.0, min(1.0, a)))
        return self


# ----------------------------------------------------------------------------- legend
def legend(elements, size=26, max_w=8.0):
    row = Group()
    for e in elements:
        ball = Sprite(S.sphere_array(S.ELEMENTS[e][3], 96), height=0.36)
        lab = T(S.ELEMENTS[e][0], size, WHITE, "MEDIUM")
        g = Group(ball, lab).arrange(RIGHT, buff=0.14)
        row.add(g)
    row.arrange(RIGHT, buff=0.42)
    if row.width > max_w:
        row.scale_to_fit_width(max_w)
    return row


def unique_elements(mols):
    out = []
    for m in mols:
        for e in m.els:
            if e not in out:
                out.append(e)
    # the usual order: C, H first like chemists, then the rest
    return sorted(out, key=lambda e: (0 if e == "C" else 1 if e == "H" else 2, out.index(e)))


# ----------------------------------------------------------------------------- molecule
class MoleculeVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        self.mol = S.molecule(subject)
        _, body, charge = S.parse_species(subject)
        fh = min(1.05, h * 0.17)
        self.view = MolView = S.MolView(self.mol, size=min(w * 0.85, h * 0.7), spin=0.6 if animate else 0, still=not animate)
        self.formula = S.Formula3D(subject.strip(), size=96 if short else 88)
        self.formula.scale_to_fit_height(fh)
        name = S.ELEMENTS[self.mol.els[0]][0] if len(self.mol.els) == 1 else ""
        self.legend = legend(unique_elements([self.mol]), max_w=w * 0.95)
        self.name = T(name, 34, NEUTRAL) if name else None
        self.add(self.view, self.formula, self.legend, *([self.name] if self.name is not None else []))

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        ct = self.clock(t)
        self.view.center_pt = o + np.array([0, self.h * 0.17, 0])
        self.view.at(ct)
        self.view.set_alpha(a)
        fa = self.appear(t, self.t_in + 0.35)
        self.formula.shift(o + np.array([0, -self.h * 0.27, 0]) - self.formula.pivot.get_center())
        if self.live:
            self.formula.turn(ct)
        fade_vm(self.formula, fa)
        self.legend.move_to(o + np.array([0, -self.h * 0.43, 0]))
        fade_vm(self.legend, self.appear(t, self.t_in + 0.6))
        if self.name is not None:
            self.name.next_to(self.formula, RIGHT, buff=0.3)
            fade_vm(self.name, fa)


# ----------------------------------------------------------------------------- reaction
class ReactionVisual(Visual):
    """Reactant molecules drift together, collide in a flash, and their atoms fly apart and
    regroup into the product molecules (same atoms: mass is conserved)."""

    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        eq = S.parse_equation(subject)
        self.left, self.right = eq
        self.inst_l = [(b, S.molecule(b)) for c, b, _ in self.left for _ in range(min(c, 4))]
        self.inst_r = [(b, S.molecule(b)) for c, b, _ in self.right for _ in range(min(c, 4))]
        if any(m is None for _, m in self.inst_l + self.inst_r) or len(self.inst_l) > 8 or len(self.inst_r) > 8:
            raise ValueError("reaction: unknown molecule shape")
        fh = min(0.95, h * 0.14)
        self.vertical = short
        if self.vertical:
            row_w, row_h = w * 0.95, h * 0.34
            self.y_l, self.y_r, self.y_eq = h * 0.29, -h * 0.08, -h * 0.40
        else:
            row_w, row_h = w * 0.44, h * 0.62
            self.y_l = self.y_r = h * 0.1
            self.y_eq = -h * 0.38
        self.row_w = row_w

        def views(inst, n):
            size = min(row_h * 1.25, row_w / max(1, n) * 0.92)
            out = []
            for k, (b, m) in enumerate(inst):
                sz = size * (0.7 + 0.3 * min(1.0, m.radius / 1.6))
                if len(m.els) == 1:   # a lone atom (Fe, Mg): atom-sized, not molecule-sized
                    sz *= 0.6
                out.append(S.MolView(m, size=sz, spin=0.7 if animate else 0, phase=k * 1.3, still=not animate))
            return out

        self.vl = views(self.inst_l, len(self.inst_l))
        self.vr = views(self.inst_r, len(self.inst_r))
        self.eq = S.Formula3D(subject.replace("→", "->"), size=84)
        self.eq.scale_to_fit_height(fh)
        if self.eq.width > w * 0.98:
            self.eq.scale_to_fit_width(w * 0.98)
        self.flash = Sprite(S.glow_array("#FFE08A"), height=1.0)
        self.flash.set_opacity(0)
        self.arrow = S.block_arrow(0.9, 0.13, NEUTRAL, DOWN if self.vertical else RIGHT)
        # atom mapping: each product atom comes from a reactant atom of the same element
        pool = {}
        for vi, v in enumerate(self.vl):
            for ai, e in enumerate(v.mol.els):
                pool.setdefault(e, []).append((vi, ai))
        self.flights = []
        for vj, v in enumerate(self.vr):
            for aj, e in enumerate(v.mol.els):
                src = pool.get(e, [])
                self.flights.append((src.pop(0) if src else None, (vj, aj), e))
        self.fly = [Sprite(S.sphere_array(S.ELEMENTS[e][3]), 0.5) for _, _, e in self.flights]
        for f in self.fly:
            f.set_opacity(0)
        self.add(*self.vl, *self.vr, self.flash, self.arrow, *self.fly, self.eq)

    def row_x(self, n, k, side):
        if self.vertical:
            return (k - (n - 1) / 2) * self.row_w / max(1, n)
        base = -self.w * 0.26 if side == "l" else self.w * 0.26
        return base + (k - (n - 1) / 2) * self.row_w / max(1, n)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        tc = self.cue(0, self.t_in + 1.6)
        tc = max(tc, self.t_in + 1.0)
        ct = self.clock(t)
        a_in = self.appear(t)
        fly_d = 1.1
        # reactants: drift toward the middle just before the collision
        squeeze = ease((t - (tc - 0.7)) / 0.7) if self.live else 0.0
        for k, v in enumerate(self.vl):
            x = self.row_x(len(self.vl), k, "l") * (1 - 0.55 * squeeze)
            v.center_pt = o + np.array([x, self.y_l, 0])
            v.at(ct)
            v.set_alpha(a_in if t < tc else 0.0)
        # products: appear when the flying atoms land
        land = tc + fly_d
        for k, v in enumerate(self.vr):
            v.center_pt = o + np.array([self.row_x(len(self.vr), k, "r"), self.y_r, 0])
            v.at(ct)
            v.set_alpha(ease((t - land) / 0.15) if self.live else (1.0 if t >= tc else 0.0))
        # the flash at the collision
        cx = 0 if self.vertical else -self.w * 0.26
        fl = max(0.0, 1 - abs(t - tc) / 0.35) if self.live else 0
        self.flash.put(o[0] + cx, o[1] + self.y_l, h=self.row_w * 0.25 + 2.2 * fl, a=fl * 0.95)
        # the flying atoms
        if self.live and tc <= t < land + 0.15:
            u = ease((t - tc) / fly_d)
            src_pts = [v.screen(tc) for v in self.vl]
            dst_pts = [v.screen(land) for v in self.vr]
            for f, (src, (vj, aj), e) in zip(self.fly, self.flights):
                xd, yd, _, sd = dst_pts[vj][aj]
                rd = S.ELEMENTS[e][4] * self.vr[vj].k * sd * 2
                if src:
                    vi, ai = src
                    xs, ys, _, ss = src_pts[vi][ai]
                    rs = S.ELEMENTS[e][4] * self.vl[vi].k * ss * 2
                    # pulled apart a little first, then into place
                    burst = math.sin(u * math.pi) * 0.5
                    dx, dy = xs - (o[0] + cx), ys - (o[1] + self.y_l)
                    x = xs + (xd - xs) * u + dx * burst
                    y = ys + (yd - ys) * u + dy * burst
                    f.put(x, y, h=rs + (rd - rs) * u, a=1.0 if t < land else 1 - ease((t - land) / 0.15))
                else:
                    f.put(xd, yd, h=rd, a=u)
        else:
            for f in self.fly:
                f.put(f.get_x(), f.get_y(), a=0.0)
        # arrow and equation
        if self.vertical:
            self.arrow.move_to(o + np.array([0, (self.y_l + self.y_r) / 2 + 0.05, 0]))
        else:
            self.arrow.move_to(o + np.array([0, self.y_l, 0]))
        fade_vm(self.arrow, ease((t - tc) / 0.3) if self.live else 1.0)
        self.eq.shift(o + np.array([0, self.y_eq, 0]) - self.eq.pivot.get_center())
        if self.live:
            self.eq.turn(ct, amp=0.22)
        fade_vm(self.eq, self.appear(t, self.t_in + 0.3))


# ----------------------------------------------------------------------------- container
class Box3D:
    """An oblique 3D glass box: box coords (u, v, w) in [0,1]^3 -> screen."""

    def __init__(self, bw, bh, bd, color="#7FD3FF"):
        self.bw, self.bh, self.bd = bw, bh, bd
        self.dx, self.dy = bd * 0.55, bd * 0.38
        self.color = color
        c = ManimColor(color)

        def quad(pts, fill, op, stroke_op):
            return Polygon(*[[p[0], p[1], 0] for p in pts], fill_color=fill, fill_opacity=op, stroke_color=c, stroke_width=3, stroke_opacity=stroke_op)
        self.back = VGroup(
            quad(self.face(1), c, 0.05, 0.35),        # back wall
            quad([self.p(0, 0, 0), self.p(1, 0, 0), self.p(1, 0, 1), self.p(0, 0, 1)], c, 0.10, 0.35),   # floor
            quad([self.p(0, 0, 0), self.p(0, 1, 0), self.p(0, 1, 1), self.p(0, 0, 1)], c, 0.04, 0.35),   # left wall
        )
        self.front = VGroup(
            quad([self.p(1, 0, 0), self.p(1, 1, 0), self.p(1, 1, 1), self.p(1, 0, 1)], c, 0.04, 0.7),
            quad(self.face(0), c, 0.07, 0.9),
            Line([*self.p(0.04, 0.96, 0)[:2], 0], [*self.p(0.04, 0.6, 0)[:2], 0], stroke_color=WHITE, stroke_width=6, stroke_opacity=0.35),
        )

    def face(self, w):
        return [self.p(0, 0, w), self.p(1, 0, w), self.p(1, 1, w), self.p(0, 1, w)]

    def p(self, u, v, w):
        return np.array([(u - 0.5) * self.bw + w * self.dx - self.dx / 2, (v - 0.5) * self.bh + w * self.dy - self.dy / 2, w])

    def scale_at(self, w):
        return 1 - 0.14 * w


def tri(x):
    """Triangle wave in [0,1] (a ball bouncing between two walls)."""
    x = x % 2.0
    return x if x < 1 else 2 - x


# ----------------------------------------------------------------------------- states of matter
# Each state in its own real shape (no box): SOLID = an ice cube with its particles packed inside,
# LIQUID = a puddle (or a drop when it is liquid on its own), GAS = particles flying apart with
# rising vapour. Changes of state morph one shape into the next (the cube melts into a puddle,
# the puddle boils away into vapour). With heat, the particles speed up gradually, slow -> fast.
PHASES = {"solid": [0], "liquid": [1], "gas": [2], "melting": [0, 1], "freezing": [1, 0], "solidification": [1, 0], "boiling": [1, 2],
          "evaporation": [1, 2], "vaporisation": [1, 2], "vaporization": [1, 2], "condensation": [2, 1], "condensing": [2, 1],
          "sublimation": [0, 2], "deposition": [2, 0], "heating": [0, 1, 2], "all": [0, 1, 2], "cooling": [2, 1, 0], "states": [0, 1, 2]}
WATER_NAMES = ["SOLID: ICE", "LIQUID: WATER", "GAS: WATER VAPOUR"]
PLAIN_NAMES = ["SOLID", "LIQUID", "GAS"]
WATER_BLUE = "#4FC3F7"


def shape(fill, op, stroke=WHITE, sop=0.0, sw=3.0):
    m = VMobject(fill_color=fill, fill_opacity=op, stroke_color=stroke, stroke_opacity=sop, stroke_width=sw)
    m._base_fill, m._base_stroke = op, sop      # fade_vm fades from these
    return m


def set_shape(m, pts):
    if len(pts) < 3:
        pts = [(0, 0), (1e-4, 0), (0, 1e-4)]
    m.set_points_as_corners([[p[0], p[1], 0] for p in pts] + [[pts[0][0], pts[0][1], 0]])


def disk(u, v):
    """Square [-1,1]^2 -> unit disk (smooth, keeps points inside)."""
    return u * math.sqrt(max(0.0, 1 - v * v / 2)), v * math.sqrt(max(0.0, 1 - u * u / 2))


class Heat:
    """Temperature over the scene and the motion clock it drives (faster when hotter)."""

    def __init__(self, vis, mode, base):
        self.vis, self.mode, self.base = vis, mode, base
        self.S, self.last = 0.0, None

    def temp(self, t):
        v = self.vis
        if self.mode in ("up", "down"):
            span = max(1.0, v.t_end - v.t_in - 0.4)
            x = min(1.0, max(0.0, (t - v.t_in) / span))
            return 0.08 + 0.9 * x if self.mode == "up" else 0.98 - 0.9 * x
        return self.base

    def step(self, t):
        if not self.vis.live:
            return self.S
        f = 0.25 + 1.6 * self.temp(t)
        if self.last is not None and t > self.last:
            self.S += (t - self.last) * f
        self.last = t
        return self.S


class Thermometer:
    def __init__(self, height):
        self.h = height
        self.tube = RoundedRectangle(corner_radius=0.12, width=0.26, height=height, fill_color="#FFFFFF", fill_opacity=0.12, stroke_color=WHITE, stroke_width=2.5, stroke_opacity=0.7)
        self.level = Rectangle(width=0.14, height=0.1, fill_color="#FF3B30", fill_opacity=1, stroke_width=0)
        self.bulb = Sprite(S.sphere_array("#FF3B30"), 0.5)

    def mobs(self):
        return [self.tube, self.level, self.bulb]

    def put(self, x, y, temp, a):
        self.tube.move_to([x, y, 0])
        fade_vm(self.tube, a)
        lvl = max(0.08, (0.1 + 0.85 * temp) * self.h)
        self.level.stretch_to_fit_height(lvl)
        self.level.move_to([x, y - self.h / 2 + lvl / 2, 0])
        fade_vm(self.level, a)
        self.bulb.put(x, y - self.h / 2 - 0.12, h=0.5, a=a)


class StatesVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        low = subject.lower()
        key = re.sub(r"[^a-z]", "", low.split(":")[0]) or "all"
        key = next((k for k in PHASES if key.startswith(k[:5])), "all")
        self.seq = PHASES[key]
        self.heating = len(self.seq) > 1 and self.seq[-1] > self.seq[0]
        self.cooling = len(self.seq) > 1 and self.seq[-1] < self.seq[0]
        other = low.split(":", 1)[1].strip() if ":" in low else "water"
        self.names = WATER_NAMES if other in ("water", "ice", "h2o", "") else PLAIN_NAMES
        self.liquid_only = self.seq == [1]
        self.gas_only = self.seq == [2]
        self.heat = Heat(self, "up" if self.heating else "down" if self.cooling else "fixed", [0.12, 0.45, 0.85][self.seq[0]])
        self.s = min(w * 0.40, h * 0.40)                      # ice cube side
        self.dx, self.dy = self.s * 0.34, self.s * 0.24       # cube depth (oblique)
        self.Rx = min(w * 0.40, self.s * 1.35)               # puddle radius
        self.Rd = min(w * 0.30, h * 0.30)                    # drop radius (liquid on its own)
        rng = random.Random(7)
        self.solid, self.liq, self.gas, self.vel, self.ofs, self.layer = [], [], [], [], [], []
        for i in range(4):
            for j in range(4):
                for k in range(3):
                    self.solid.append((0.16 + 0.68 * i / 3, 0.16 + 0.68 * j / 3, 0.15 + 0.7 * k / 2))
        n = len(self.solid)
        for _ in range(n):
            self.liq.append((rng.uniform(-1, 1), rng.uniform(-1, 1)))
            self.gas.append((rng.random(), rng.random(), rng.random()))
            v = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])
            self.vel.append(v / np.linalg.norm(v) * rng.uniform(0.5, 1.0))
            self.ofs.append(rng.uniform(0, 6.28))
            self.layer.append(rng.random())
        self.r = self.s * 0.068
        self.parts = [Sprite(S.sphere_array(WATER_BLUE), self.r * 2) for _ in range(n)]
        # shapes
        self.shadow = Ellipse(width=1, height=0.3, fill_color="#000000", fill_opacity=0.35, stroke_width=0)
        self.rim = shape("#1E78B4", 0.75)
        self.surface = shape("#7FD3FF", 0.42, WHITE, 0.55, 2.5)
        self.cube = [shape("#A8E4FF", 0.34, "#F2FBFF", 0.9, 3), shape("#E8F8FF", 0.62, "#F2FBFF", 0.9, 3), shape("#7CC8EC", 0.48, "#F2FBFF", 0.9, 3)]   # frosty ice: front, top, side
        self.cube_shine = Line(ORIGIN, RIGHT, stroke_color=WHITE, stroke_width=7, stroke_opacity=0.5)
        self.drop = shape("#4FB8F5", 0.30, "#BFE9FF", 0.9, 4)
        self.drop_shine = Sprite(S.glow_array("#FFFFFF", 96, 2.0), 1)
        self.puffs = [Sprite(S.glow_array("#EAF6FF", 96, 1.6), 1) for _ in range(7)]
        self.fire = Sprite(sticker_path("fire"), self.s * 0.5) if sticker_path("fire") else None
        self.snow = Sprite(sticker_path("snowflake"), self.s * 0.45) if sticker_path("snowflake") else None
        self.labels = [pill(nm, c, "#1C1840", 30) for nm, c in zip(self.names, ["#00C2FF", "#7CDC5C", "#FFB300"])]
        self.thermo = Thermometer(min(h * 0.55, 3.2))
        extra = [m for m in (self.fire, self.snow) if m is not None]
        self.add(self.shadow, self.rim, *self.parts, self.surface, *self.cube, self.cube_shine, self.drop, self.drop_shine,
                 *self.puffs, *extra, *self.labels, *self.thermo.mobs())

    def phase_at(self, t):
        seq = self.seq
        if len(seq) == 1:
            return float(seq[0])
        if not self.live:
            return float(seq[-1])
        val = float(seq[0])
        n = len(seq) - 1
        for k in range(1, len(seq)):
            tc = self.cue(k - 1, self.t_in + 1.2 + 1.8 * (k - 1))
            # each change starts just before its word and is always finished before the scene ends
            latest = self.t_end - 0.45 - (n - k) * 0.7
            start = min(tc - 0.5, latest - 0.6)
            dur = max(0.6, min(1.6, latest - start))
            val += (seq[k] - seq[k - 1]) * ease((t - start) / dur)
        return val

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        ph = self.phase_at(t)
        temp = self.heat.temp(t)
        Sc = self.heat.step(t)
        cx = o[0] - (0.35 if self.w > 5 else 0.2)
        gy = o[1] - self.h * 0.16                       # the "table" everything stands on
        s, dx, dy = self.s, self.dx, self.dy
        m = min(1.0, max(0.0, ph))                    # how much has melted (0 = all ice)
        if self.liquid_only:
            pud = 0.0
        elif 0 in self.seq and 1 in self.seq:
            pud = m if ph <= 1 else max(0.0, 1 - (ph - 1) * 0.9)
        elif 1 in self.seq:                            # starts or ends as a liquid, with gas
            pud = max(0.0, 1 - max(0.0, ph - 1) * 0.9)
        else:
            pud = 0.0
        vap = min(1.0, max(0.0, ph - 1)) if 2 in self.seq else 0.0
        if self.gas_only:
            vap = 1.0
        # ---- particles
        Rx = self.Rx * max(0.35, pud) if not self.liquid_only else self.Rd * 0.8
        lcy = gy + self.Rd if self.liquid_only else gy + 0.06
        top = o[1] + self.h * 0.47
        pts = []
        for i, sp in enumerate(self.parts):
            ofs = self.ofs[i]
            amp = 0.012 + 0.045 * temp
            u, v, wv = self.solid[i]
            u += math.sin(Sc * 21 + ofs) * amp
            v += math.sin(Sc * 17 + ofs * 1.7) * amp
            wv += math.sin(Sc * 19 + ofs * 2.3) * amp
            sx, sy = cx - s / 2 + u * s + wv * dx, gy + v * s + wv * dy
            lu, lv = self.liq[i]
            lu = max(-1, min(1, lu + 0.25 * math.sin(Sc * 0.8 + ofs)))
            lv = max(-1, min(1, lv + 0.25 * math.sin(Sc * 1.1 + ofs * 1.3)))
            du, dv = disk(lu, lv)
            if self.liquid_only:
                lx, ly, ld = cx + du * Rx, lcy + dv * Rx * 0.9, self.layer[i]
            else:
                lx, ly, ld = cx + du * Rx * 0.9, lcy + dv * Rx * 0.26 + self.layer[i] * 0.16, (dv + 1) / 2
            g0, vel = self.gas[i], self.vel[i]
            gu = tri(g0[0] + vel[0] * Sc * 0.32)
            gv = tri(g0[1] + vel[1] * Sc * 0.32)
            gw = tri(g0[2] + vel[2] * Sc * 0.32)
            gx, gyy = cx - self.w * 0.40 + gu * self.w * 0.80, gy + 0.3 + gv * (top - gy - 0.3)
            if ph <= 1:
                e = ease(ph)
                x, y, d = sx + (lx - sx) * e, sy + (ly - sy) * e, wv + (ld - wv) * e
            else:
                e = ease(ph - 1)
                x, y, d = lx + (gx - lx) * e, ly + (gyy - ly) * e, ld + (gw - ld) * e
            pts.append((d, sp, x, y))
        pts.sort(key=lambda p: -p[0])
        for d, sp, x, y in pts:
            sp.put(x, y, h=self.r * 2 * (1 - 0.15 * d), a=a)
        # ---- shadow
        sw = (s * 1.25 * (1 - m) + self.Rx * 2.1 * pud) if not self.liquid_only else self.Rd * 1.7
        self.shadow.stretch_to_fit_width(max(0.05, sw))
        self.shadow.stretch_to_fit_height(max(0.02, sw * 0.16))
        self.shadow.move_to([cx + (dx / 2 if pud < 0.5 else 0), gy - 0.05, 0])
        fade_vm(self.shadow, a * (1 - vap * 0.9))
        # ---- ice cube (shrinks and fades as it melts)
        ice = (1 - m) if 0 in self.seq else 0.0
        hc, wc = s * (1 - 0.75 * m), s * (1 - 0.35 * m)
        x0, x1 = cx - wc / 2, cx + wc / 2
        f = [(x0, gy), (x1, gy), (x1, gy + hc), (x0, gy + hc)]
        tp = [(x0, gy + hc), (x1, gy + hc), (x1 + dx, gy + hc + dy), (x0 + dx, gy + hc + dy)]
        rt = [(x1, gy), (x1 + dx, gy + dy), (x1 + dx, gy + hc + dy), (x1, gy + hc)]
        for mob, p in zip(self.cube, (f, tp, rt)):
            set_shape(mob, p)
            fade_vm(mob, a * ice ** 0.6)
        self.cube_shine.put_start_and_end_on([x0 + wc * 0.12, gy + hc * 0.85, 0], [x0 + wc * 0.12, gy + hc * 0.35, 0])
        fade_vm(self.cube_shine, a * ice ** 0.6)
        # ---- puddle (grows from the melting ice, shrinks as it boils away)
        if pud > 0.01:
            N = 44
            R = self.Rx * pud
            surf, rim = [], []
            for k in range(N):
                th = 2 * math.pi * k / N
                rr = R * (1 + 0.04 * math.sin(3 * th + Sc * 2) + 0.03 * math.sin(5 * th - Sc * 1.4))
                px, py = cx + rr * math.cos(th), gy + 0.12 + rr * math.sin(th) * 0.28
                surf.append((px, py))
                rim.append((px, py - 0.12))
            set_shape(self.surface, surf)
            set_shape(self.rim, rim)
        for mob in (self.surface, self.rim):
            fade_vm(mob, a * min(1.0, pud * 3) if pud > 0.01 else 0.0)
        # ---- drop (a liquid on its own)
        if self.liquid_only:
            R = self.Rd
            pts_d = []
            for k in range(60):
                tt = 2 * math.pi * k / 60
                wob = 1 + 0.03 * math.sin(4 * tt + Sc * 2.5)
                pts_d.append((cx + R * 0.95 * math.sin(tt) * abs(math.sin(tt / 2)) ** 0.9 * 1.25 * wob,
                              gy + R + R * 1.25 * math.cos(tt) * (0.85 if math.cos(tt) < 0 else 1.0) - R * 0.25))
            set_shape(self.drop, pts_d)
            fade_vm(self.drop, a)
            self.drop_shine.put(cx - R * 0.35, gy + R * 1.0, h=R * 0.7, a=a * 0.5)
        else:
            fade_vm(self.drop, 0)
            self.drop_shine.put(cx, gy, h=0.1, a=0)
        # ---- vapour puffs rising
        for k, pf in enumerate(self.puffs):
            q = (Sc * 0.12 + k / len(self.puffs)) % 1.0
            px = cx + math.sin(k * 2.1 + q * 3.0) * self.w * 0.22
            py = gy + 0.4 + q * (top - gy - 0.6)
            pf.put(px, py, h=0.7 + 1.5 * q, a=a * vap * 0.55 * math.sin(math.pi * q))
        # ---- labels (the current state)
        low_y = gy - 0.55 - (0.1 if pud > 0.3 else 0)
        if self.fire is not None and self.heating:
            low_y -= self.s * 0.45
        for k, lab in enumerate(self.labels):
            lab.move_to([cx, low_y, 0])
            fade_vm(lab, a * max(0.0, 1 - abs(ph - k) * 2.2))
        # ---- heat / cold
        flick = 1 + 0.07 * math.sin(Sc * 9) if self.live else 1
        if self.fire is not None:
            self.fire.put(cx, gy - 0.12 - self.s * 0.22, h=self.s * 0.42 * flick * (0.7 + 0.5 * temp), a=a * (0.95 if self.heating else 0))
        if self.snow is not None:
            self.snow.put(cx + self.w * 0.30, top - 0.4, h=self.s * 0.4, a=a * (0.95 if self.cooling else 0))
        self.thermo.put(o[0] + self.w / 2 - 0.4, o[1] + 0.2, temp, a)


# ----------------------------------------------------------------------------- balloon
class BalloonVisual(Visual):
    """A 3D balloon with gas particles flying inside it, hitting its skin. subject: "gas" / "air" or
    molecules ("N2*6, O2*2"); add "heat" (particles speed up slow -> fast and the balloon swells)
    or "inflate" (it fills up on the cue)."""

    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        low = subject.lower()
        self.heated = any(k in low for k in ("heat", "hot", "warm"))
        self.inflate = "inflat" in low or "blow" in low
        self.heat = Heat(self, "up" if self.heated else "fixed", 0.55)
        self.a_ = min(w * 0.30, h * 0.30)
        self.b_ = self.a_ * 1.2
        rng = random.Random(9)
        mols = []
        for part in re.split(r"\s*,\s*", subject):
            mm = re.match(r"^(.+?)(?:\s*[*x×]\s*(\d+))?$", part.strip())
            if not mm:
                continue
            mol = S.molecule(mm.group(1).strip()) if re.search(r"[A-Z]", mm.group(1)) else None
            if mol:
                mols += [mol] * min(int(mm.group(2) or 1), 10)
        self.items = []
        if mols:
            for k, mol in enumerate(mols[:14]):
                self.items.append(S.MolView(mol, size=self.a_ * 0.42, spin=rng.uniform(0.6, 1.2) if animate else 0, phase=k, still=not animate))
        else:
            for _ in range(22):
                self.items.append(Sprite(S.sphere_array("#FFE08A"), self.a_ * 0.16))
        self.p0 = [(rng.random(), rng.random(), rng.random()) for _ in self.items]
        self.v = []
        for _ in self.items:
            v = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])
            self.v.append(v / np.linalg.norm(v) * rng.uniform(0.6, 1.0))
        self.body = shape("#FF3D68", 0.55, "#FF8FA3", 0.0, 0)
        self.skin = shape("#FF4D6D", 0.0, "#FF9DB0", 0.95, 4)
        self.knot = shape("#E8365A", 1.0)
        self.string = VMobject(stroke_color="#E8E8F0", stroke_width=3, stroke_opacity=0.8)
        self.shine = Sprite(S.glow_array("#FFFFFF", 96, 1.8), 1)
        self.add(self.body, *self.items, self.skin, self.knot, self.string, self.shine)

    def outline(self, c, sc):
        a, b = self.a_ * sc, self.b_ * sc
        pts = []
        for k in range(64):
            th = 2 * math.pi * k / 64
            x = a * math.sin(th) * (1 + 0.10 * math.cos(th))
            y = b * math.cos(th)
            pts.append((c[0] + x, c[1] + y))
        return pts

    def tick(self, t):
        super().tick(t)
        o = self.o()
        al = self.appear(t)
        temp = self.heat.temp(t)
        Sc = self.heat.step(t)
        tc = self.cue(0, self.t_in + 1.0)
        sc = 1.0
        if self.inflate:
            sc = 0.45 + 0.55 * (ease((t - tc) / 1.4) if self.live else 1.0)
        if self.heated:
            sc *= 1 + 0.12 * temp
        c = np.array([o[0], o[1] + self.h * 0.1, 0])
        out = self.outline(c, sc)
        set_shape(self.body, out)
        set_shape(self.skin, out)
        for mob in (self.body, self.skin):
            fade_vm(mob, al)
        bot = c[1] - self.b_ * sc
        kn = 0.16 * sc + 0.05
        set_shape(self.knot, [(c[0], bot + 0.02), (c[0] - kn, bot - kn * 1.2), (c[0] + kn, bot - kn * 1.2)])
        fade_vm(self.knot, al)
        sway = 0.12 * math.sin(Sc * 1.5) if self.live else 0
        sb = bot - kn * 1.2
        end = o[1] - self.h * 0.47
        self.string.set_points_smoothly([[c[0], sb, 0], [c[0] + 0.18 + sway, (sb + end) * 0.5 + 0.2, 0], [c[0] - 0.1 - sway, (sb + end) * 0.5 - 0.4, 0], [c[0] + sway * 0.5, end, 0]])
        fade_vm(self.string, al)
        self.shine.put(c[0] - self.a_ * sc * 0.38, c[1] + self.b_ * sc * 0.42, h=self.a_ * sc * 0.65, a=al * 0.6)
        order = []
        for it, p0, v in zip(self.items, self.p0, self.v):
            u = -1 + 2 * tri(p0[0] + v[0] * Sc * 0.45)
            w_ = -1 + 2 * tri(p0[1] + v[1] * Sc * 0.45)
            z = tri(p0[2] + v[2] * Sc * 0.45)
            du, dv = disk(u, w_)
            x, y = c[0] + du * self.a_ * sc * 0.82, c[1] + dv * self.b_ * sc * 0.82
            if isinstance(it, S.MolView):
                it.center_pt = np.array([x, y, 0])
                it.at(Sc)
                it.set_alpha(al)
            else:
                it.put(x, y, h=it.base_h * (1 - 0.2 * z), a=al)
            order.append((z, it))
        order.sort(key=lambda q: -q[0])
        mv = [m for _, m in order]
        rest = [m for m in self.submobjects if m not in mv]
        bi = rest.index(self.body)
        self.submobjects = rest[:bi + 1] + mv + rest[bi + 1:]


# ----------------------------------------------------------------------------- atom (Bohr model)
class AtomModel:
    """A Bohr atom: nucleus of protons and neutrons; electrons on tilted orbit rings."""

    def __init__(self, sym, radius, tilt=1.05, show_neutrons=True, seed=3):
        self.sym = sym
        name, z, a, col, _ = S.ELEMENTS[sym]
        self.z, self.n = z, a - z
        self.shells = S.shells(sym)
        nuc_count = min(z + self.n, 60)
        p_share = z / max(1, z + self.n)
        rng = random.Random(seed)
        self.nr = radius * (0.2 + 0.06 * min(1, nuc_count / 40))
        ball = self.nr * (0.95 / max(1, nuc_count) ** (1 / 3)) * 1.25
        self.ball = ball
        self.nuc = []
        golden = math.pi * (3 - math.sqrt(5))
        kinds = [rng.random() < p_share for _ in range(nuc_count)]
        if nuc_count == 1:
            kinds = [True]
        for i in range(nuc_count):
            rr = self.nr * ((i + 0.5) / nuc_count) ** (1 / 3) * 0.85
            yv = 1 - 2 * (i + 0.5) / nuc_count
            rad = math.sqrt(max(0, 1 - yv * yv))
            th = golden * i
            p = np.array([math.cos(th) * rad, yv, math.sin(th) * rad]) * rr
            self.nuc.append((p, Sprite(S.sphere_array("#F0453A" if kinds[i] else "#A9B4C2", 96), ball * 2)))
        self.rings, self.electrons = [], []
        n_sh = len(self.shells)
        gap = (radius - self.nr * 1.4) / max(1, n_sh)
        self.tilt = tilt
        for k, ne in enumerate(self.shells):
            r = self.nr * 1.4 + gap * (k + 0.85)
            ring = Ellipse(width=2 * r, height=2 * r * math.cos(tilt), stroke_color="#7FB8FF", stroke_width=3.5, stroke_opacity=0.6)
            self.rings.append((r, ring))
            for j in range(ne):
                e = Sprite(S.sphere_array("#3FA0FF", 96), max(0.16, radius * 0.095))
                g = Sprite(S.glow_array("#5CC8FF", 96), max(0.16, radius * 0.095) * 2.6)
                self.electrons.append([k, 2 * math.pi * j / ne, e, g])

    def mobjects(self):
        return [r for _, r in self.rings] + [s for _, s in self.nuc] + [m for e in self.electrons for m in (e[3], e[2])]

    def place(self, c, t, spin=True, a=1.0, a_e=None, extra_angle=None, ring_a=None):
        """Places everything around centre c for time t. Returns the draw order (far to near)."""
        a_e = a if a_e is None else a_e
        order = []
        for k, (r, ring) in enumerate(self.rings):
            ring.move_to(c)
            fade_vm(ring, (ring_a[k] if ring_a else 1.0) * a_e)
            order.append((5.0, ring))
        rot = S.rot_matrix(0.3, t * 0.5 if spin else 0.4)
        for p, sp in self.nuc:
            q = rot @ p
            s = 1 / (1 - q[2] / (self.nr * 12))
            sp.put(c[0] + q[0] * s, c[1] + q[1] * s, h=self.ball * 2 * s, a=a)
            order.append((q[2], sp))
        for e in self.electrons:
            k, th0, sp, gl = e
            r = self.rings[k][0]
            w = 1.6 / (k + 1) ** 0.8
            th = th0 + (t * w if spin else 0) + (extra_angle or 0)
            x, yy = r * math.cos(th), r * math.sin(th)
            y = yy * math.cos(self.tilt)
            z = yy * math.sin(self.tilt)
            s = 1 / (1 - z / (r * 9 + 1e-6))
            if e[2]._a <= -1:
                continue
            sp.put(c[0] + x, c[1] + y, h=sp.base_h * s, a=a_e)
            gl.put(c[0] + x, c[1] + y, h=gl.base_h * s, a=a_e * 0.55)
            order.append((z, gl))
            order.append((z - 1e-3, sp))
        order.sort(key=lambda x: -x[0])
        return [m for _, m in order]


class AtomVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        sym = subject.strip()[:2]
        sym = sym if sym in S.ELEMENTS else sym[:1]
        if sym not in S.ELEMENTS:
            raise ValueError("atom: unknown element")
        self.sym = sym
        self.R = min(w * 0.47, h * 0.38)
        self.model = AtomModel(sym, self.R, tilt=0.95)
        name, z, a, _, _ = S.ELEMENTS[sym]
        self.title = S.Formula3D(sym, size=110)
        self.title.scale_to_fit_height(min(1.0, h * 0.15))
        self.info = Group(
            T(name, 40, WHITE),
            Group(*[Group(Sprite(S.sphere_array(c, 96), 0.34), T(f"{n} {lab}", 28, WHITE, "MEDIUM")).arrange(RIGHT, buff=0.12)
                    for c, n, lab in (("#F0453A", z, "protons"), ("#A9B4C2", a - z, "neutrons"), ("#3FA0FF", z, "electrons"))]).arrange(RIGHT, buff=0.35),
            T("Shells: " + ", ".join(str(x) for x in self.model.shells), 30, "#7FB8FF", "MEDIUM"),
        ).arrange(DOWN, buff=0.18)
        if self.info.width > w * 0.98:
            self.info.scale_to_fit_width(w * 0.98)
        self.add(*self.model.mobjects(), self.title, self.info)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        te = self.cue(0, self.t_in + 0.7)
        a_e = self.appear(t, te)
        c = o + np.array([0, self.h * 0.12, 0])
        order = self.model.place(c, self.clock(t), spin=self.live, a=a, a_e=a_e)
        rest = [m for m in self.submobjects if m not in order]
        self.submobjects = order + rest
        self.title.shift(o + np.array([-self.w * 0.38, self.h * 0.42, 0]) - self.title.pivot.get_center())
        if self.live:
            self.title.turn(self.clock(t), amp=0.25)
        fade_vm(self.title, a)
        self.info.move_to(o + np.array([0, -self.h * 0.38, 0]))
        fade_vm(self.info, self.appear(t, self.t_in + 0.4))


# ----------------------------------------------------------------------------- ions (electron transfer)
class IonsVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        parts = re.split(r"\s*(?:>|->|→|,|\+)\s*", subject.strip())
        if len(parts) < 2 or parts[0] not in S.ELEMENTS or parts[1] not in S.ELEMENTS:
            raise ValueError("ions: needs two elements like Na>Cl")
        self.a_sym, self.b_sym = parts[0], parts[1]
        self.R = min(w * 0.23, h * 0.30)
        self.A = AtomModel(self.a_sym, self.R, tilt=0.35, seed=1)
        self.B = AtomModel(self.b_sym, self.R, tilt=0.35, seed=2)
        va = self.A.shells[-1]
        vb = 8 - self.B.shells[-1] if self.B.shells[-1] < 8 else 0
        self.nt = max(1, min(va, vb if vb else va, 3))
        outer = len(self.A.shells) - 1
        self.moving = [e for e in self.A.electrons if e[0] == outer][: self.nt]
        self.fly = [Sprite(S.sphere_array("#FFD54F", 96), max(0.14, self.R * 0.09)) for _ in self.moving]
        self.fly_glow = [Sprite(S.glow_array("#FFE08A", 96), max(0.14, self.R * 0.09) * 3) for _ in self.moving]
        for m in self.moving:
            m[2].set_opacity(0)
        ca = f"{self.a_sym}^{'' if self.nt == 1 else self.nt}+"
        cb = f"{self.b_sym}^{'' if self.nt == 1 else self.nt}-"
        self.ca = S.Formula3D(ca, size=80, side="#C0392B")
        self.cb = S.Formula3D(cb, size=80, side="#2A6BD8")
        for f in (self.ca, self.cb):
            f.scale_to_fit_height(min(0.9, h * 0.13))
        self.bond = pill("IONIC BOND", "#A855F7", WHITE, 30)
        self.add(*self.A.mobjects(), *self.B.mobjects(), *self.fly_glow, *self.fly, self.ca, self.cb, self.bond)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        tc = max(self.cue(0, self.t_in + 1.4), self.t_in + 0.8)
        ct = self.clock(t)
        d = 1.0
        u = ease((t - tc) / d) if self.live else 1.0
        pull = ease((t - tc - d) / 0.8) if self.live else 1.0
        gap = self.w * 0.25 * (1 - 0.18 * pull)
        ca, cb = o + np.array([-gap, 0.15, 0]), o + np.array([gap, 0.15, 0])
        outer = len(self.A.shells) - 1
        ring_a = [1.0] * len(self.A.shells)
        ring_a[outer] = 1 - u if self.A.shells[outer] == self.nt else 1.0
        # hide the moving electrons on A (the flying copies take over)
        for e in self.moving:
            e[2]._a = 0.0
        oa = self.A.place(ca, ct, spin=self.live, a=a, ring_a=ring_a)
        ob = self.B.place(cb, ct, spin=self.live, a=a)
        for e in self.moving:
            e[2].set_opacity(0)
            e[3].set_opacity(0)
        # the flying electrons: from A's outer ring to B's outer ring
        rA = self.A.rings[outer][0]
        rB = self.B.rings[-1][0]
        for k, (f, g) in enumerate(zip(self.fly, self.fly_glow)):
            sa = np.array([ca[0] + rA * 0.9, ca[1] + rA * 0.25 * (k - (self.nt - 1) / 2), 0])
            th = math.pi * (0.85 + 0.3 * k / max(1, self.nt))
            sb = np.array([cb[0] + rB * math.cos(th + (ct - tc - d) * 0.6 * (u >= 1)), cb[1] + rB * math.sin(th) * math.cos(0.35), 0])
            p = sa + (sb - sa) * u + np.array([0, math.sin(u * math.pi) * self.R * 0.7, 0])
            vis = a if self.live else a
            f.put(p[0], p[1], h=f.base_h, a=vis)
            g.put(p[0], p[1], h=g.base_h, a=vis * 0.7)
        rest = [m for m in self.submobjects if m not in oa and m not in ob and m not in self.fly and m not in self.fly_glow]
        self.submobjects = oa + ob + self.fly_glow + self.fly + rest
        top = o[1] + 0.15 + self.R + 0.55
        for f, c in ((self.ca, ca), (self.cb, cb)):
            f.shift(np.array([c[0], top, 0]) - f.pivot.get_center())
            if self.live:
                f.turn(ct, amp=0.2)
            fade_vm(f, ease((t - tc - d * 0.8) / 0.3) if self.live else 1.0)
        self.bond.move_to(o + np.array([0, -self.R - 0.45, 0]))
        fade_vm(self.bond, pull * a)


# ----------------------------------------------------------------------------- lattice
class LatticeVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        s = subject.strip()
        counts = S.atom_counts(S.parse_species(s)[1]) or {}
        self.metal = (len(counts) == 1 and next(iter(counts)) in S.METALS) or s.lower() in ("metal", "metallic")
        n = 3
        size = min(w * 0.62, h * 0.62)
        self.size = size
        self.pts, self.sprites = [], []
        if self.metal:
            el = next(iter(counts)) if counts else "Fe"
            for i in range(n):
                for j in range(n):
                    for k in range(n):
                        self.pts.append(np.array([i - 1, j - 1, k - 1], float))
                        self.sprites.append(Sprite(S.sphere_array(S.ELEMENTS[el][3]), 1))
            self.rad = [0.34] * len(self.pts)
            rng = random.Random(5)
            self.e_seed = [(np.array([rng.uniform(-1.3, 1.3) for _ in range(3)]), np.array([rng.uniform(-1, 1) for _ in range(3)])) for _ in range(30)]
            self.electrons = [Sprite(S.glow_array("#5CC8FF", 64), 0.3) for _ in self.e_seed]
            self.label = S.Formula3D(el if counts else "Fe", size=80)
            self.cap = T("metal ions in a sea of electrons", 30, NEUTRAL, "MEDIUM")
        else:
            els = list(counts)[:2] if len(counts) >= 2 else ["Na", "Cl"]
            a, b = els[0], els[1]
            for i in range(n):
                for j in range(n):
                    for k in range(n):
                        e = a if (i + j + k) % 2 == 0 else b
                        self.pts.append(np.array([i - 1, j - 1, k - 1], float))
                        self.sprites.append(Sprite(S.sphere_array(S.ELEMENTS[e][3]), 1))
            self.rad = [0.26 if (i + j + k) % 2 == 0 else 0.36 for i in range(n) for j in range(n) for k in range(n)]
            self.electrons, self.e_seed = [], []
            self.label = S.Formula3D(s if counts else "NaCl", size=80)
            self.cap = VGroup(T(f"{S.ELEMENTS[a][0]} and {S.ELEMENTS[b][0].lower()} ions", 30, NEUTRAL, "MEDIUM"), T("in a repeating 3D pattern", 30, NEUTRAL, "MEDIUM")).arrange(DOWN, buff=0.1)
        self.edges = []
        for p_i in range(len(self.pts)):
            for p_j in range(p_i + 1, len(self.pts)):
                if abs(np.linalg.norm(self.pts[p_i] - self.pts[p_j]) - 1) < 1e-6:
                    self.edges.append((p_i, p_j, Line(ORIGIN, RIGHT, stroke_color="#9AA3C7", stroke_width=2.5, stroke_opacity=0.5)))
        self.label.scale_to_fit_height(min(0.85, h * 0.13))
        if self.cap.width > w * 0.95:
            self.cap.scale_to_fit_width(w * 0.95)
        self.add(*[e for _, _, e in self.edges], *self.sprites, *self.electrons, self.label, self.cap)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        ct = self.clock(t)
        R = S.rot_matrix(0.45, 0.6 + ct * 0.35)
        k = self.size / 3.4
        c = o + np.array([0, self.h * 0.1, 0])
        scr = []
        for p in self.pts:
            q = R @ p * k
            s = 1 / (1 - q[2] / (k * 9))
            scr.append((c[0] + q[0] * s, c[1] + q[1] * s, q[2], s))
        order = []
        for (x, y, z, s), sp, r in zip(scr, self.sprites, self.rad):
            sp.put(x, y, h=2 * r * k * s, a=a)
            order.append((z, sp))
        for i, j, ln in self.edges:
            ln.put_start_and_end_on([scr[i][0], scr[i][1], 0], [scr[j][0], scr[j][1], 0])
            fade_vm(ln, a)
            order.append(((scr[i][2] + scr[j][2]) / 2 - 0.2, ln))
        for (p0, v), sp in zip(self.e_seed, self.electrons):
            q = np.array([-1.4 + 2.8 * tri((p0[m] + 1.4) / 2.8 + v[m] * ct * 0.35) for m in range(3)])
            q = R @ q * k
            s = 1 / (1 - q[2] / (k * 9))
            sp.put(c[0] + q[0] * s, c[1] + q[1] * s, h=0.32 * s, a=a * 0.9)
            order.append((q[2] - 0.01, sp))
        order.sort(key=lambda x: -x[0])
        ordered = [m for _, m in order]
        rest = [m for m in self.submobjects if m not in ordered]
        self.submobjects = ordered + rest
        self.label.shift(o + np.array([0, -self.h * 0.3, 0]) - self.label.pivot.get_center())
        if self.live:
            self.label.turn(ct, amp=0.2)
        fade_vm(self.label, self.appear(t, self.t_in + 0.3))
        self.cap.move_to(o + np.array([0, -self.h * 0.43, 0]))
        fade_vm(self.cap, self.appear(t, self.t_in + 0.5))


# ----------------------------------------------------------------------------- mixture
class MixtureVisual(Visual):
    """Different molecules moving together, in the shape of what they are: a gas mixture (air)
    flies freely in open space; a liquid mixture (with water) moves inside a liquid drop. No box."""

    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        specs = []
        for part in re.split(r"\s*,\s*", subject.strip()):
            m = re.match(r"^(.+?)(?:\s*[*x×]\s*(\d+))?$", part)
            if not m:
                continue
            f, n = m.group(1).strip(), int(m.group(2) or 1)
            mol = S.molecule(f)
            if mol:
                specs.append((f, mol, min(n, 10)))
        if not specs:
            raise ValueError("mixture: no known molecules")
        total = sum(n for _, _, n in specs)
        if total > 16:
            k = 16 / total
            specs = [(f, m, max(1, round(n * k))) for f, m, n in specs]
        self.liquid = any(S.parse_species(f)[1] == "H2O" for f, _, _ in specs) and total > 6
        self.heat = Heat(self, "fixed", 0.35 if self.liquid else 0.7)
        self.area_w, self.area_h = w * 0.85, h * 0.62
        self.R = min(w * 0.36, h * 0.34)
        rng = random.Random(11)
        self.items = []
        for f, mol, n in specs:
            for _ in range(n):
                v = S.MolView(mol, size=self.R * (0.36 if mol.radius < 1.4 else 0.46), spin=rng.uniform(0.6, 1.3) if animate else 0,
                              phase=rng.uniform(0, 6), still=not animate)
                p0 = np.array([rng.random(), rng.random(), rng.random()])
                vel = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)])
                vel = vel / np.linalg.norm(vel) * (0.12 if self.liquid else 0.3)
                self.items.append((v, p0, vel))
        self.drop = shape("#4FB8F5", 0.26, "#BFE9FF", 0.9, 4) if self.liquid else None
        self.haze = Sprite(S.glow_array("#9FD8FF", 128, 1.4), 1) if not self.liquid else None
        self.legend = Group()
        for f, _, _ in specs:
            g = S.Formula3D(f, size=60, depth=0.1, layers=5)
            g.scale_to_fit_height(0.5)
            self.legend.add(g)
        self.legend.arrange(RIGHT, buff=0.55)
        if self.legend.width > w * 0.95:
            self.legend.scale_to_fit_width(w * 0.95)
        back = [m for m in (self.haze, self.drop) if m is not None]
        self.add(*back, *[v for v, _, _ in self.items], self.legend)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        Sc = self.heat.step(t)
        c = o + np.array([0, self.h * 0.1, 0])
        if self.drop is not None:
            R = self.R
            pts = []
            for k in range(60):
                tt = 2 * math.pi * k / 60
                wob = 1 + 0.03 * math.sin(4 * tt + Sc * 2.5)
                pts.append((c[0] + R * 0.95 * math.sin(tt) * abs(math.sin(tt / 2)) ** 0.9 * 1.25 * wob,
                            c[1] - R * 0.2 + R * 1.25 * math.cos(tt) * (0.85 if math.cos(tt) < 0 else 1.0)))
            set_shape(self.drop, pts)
            fade_vm(self.drop, a)
        if self.haze is not None:
            self.haze.put(c[0], c[1], h=self.area_h * 1.1, a=a * 0.18)
            self.haze.stretch_to_fit_width(self.area_w * 1.1)
        order = []
        for v, p0, vel in self.items:
            u = -1 + 2 * tri(p0[0] + vel[0] * Sc)
            w_ = -1 + 2 * tri(p0[1] + vel[1] * Sc)
            z = tri(p0[2] + vel[2] * Sc)
            if self.liquid:
                du, dv = disk(u, w_)
                x, y = c[0] + du * self.R * 0.8, c[1] - self.R * 0.35 + dv * self.R * 0.75
            else:
                x, y = c[0] + u * self.area_w / 2, c[1] + w_ * self.area_h / 2
            v.center_pt = np.array([x, y, 0])
            v.at(Sc)
            v.set_alpha(a)
            order.append((z, v))
        order.sort(key=lambda q: -q[0])
        mols = [v for _, v in order]
        rest = [m for m in self.submobjects if m not in mols]
        k = max([rest.index(m) for m in (self.haze, self.drop) if m is not None] + [0])
        self.submobjects = rest[:k + 1] + mols + rest[k + 1:]
        self.legend.move_to(o + np.array([0, -self.h * 0.42, 0]))
        for g in self.legend:
            if self.live:
                g.turn(Sc, amp=0.2)
        fade_vm(self.legend, self.appear(t, self.t_in + 0.4))


# ----------------------------------------------------------------------------- beaker
COLOURS = {"acid": "#FF5A3C", "acidic": "#FF5A3C", "base": "#6A5BFF", "basic": "#6A5BFF", "alkaline": "#6A5BFF", "alkali": "#6A5BFF",
           "neutral": "#4CD964", "water": "#7FD3FF", "red": "#FF3B30", "blue": "#2F7BFF", "green": "#34C759", "purple": "#9B59B6",
           "pink": "#FF5C8D", "yellow": "#FFD60A", "orange": "#FF9500", "colourless": "#CFE9FF", "colorless": "#CFE9FF",
           "clear": "#CFE9FF", "milky": "#F2F2F2", "brown": "#A0522D", "turmeric": "#FFB300", "litmus": "#9B59B6"}


class BeakerVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        tokens = [x.strip().lower() for x in subject.split(",") if x.strip()]
        self.c0, self.c1, self.fizz, self.ph, self.drop = "#7FD3FF", None, False, None, False
        for tk in tokens:
            if "->" in tk:
                a, b = [x.strip() for x in tk.split("->", 1)]
                self.c0 = COLOURS.get(a, self.c0)
                self.c1 = COLOURS.get(b)
                self.drop = True
            elif tk in ("fizz", "bubbles", "gas", "effervescence"):
                self.fizz = True
            elif tk.startswith("ph"):
                m = re.search(r"\d+(?:\.\d)?", tk)
                if m:
                    self.ph = m.group()
            elif tk in COLOURS:
                self.c0 = COLOURS[tk]
        bw = min(w * 0.45, h * 0.5)
        bh = bw * 1.2
        self.bw, self.bh = bw, bh
        ry = bw * 0.14
        self.ry = ry
        self.glass_back = Ellipse(width=bw, height=2 * ry, stroke_color=WHITE, stroke_width=2.5, stroke_opacity=0.4, fill_color=WHITE, fill_opacity=0.04)
        self.liquid_body = VMobject(stroke_width=0)
        self.surface = Ellipse(width=bw * 0.96, height=2 * ry * 0.96, stroke_width=0)
        self.glass = VGroup(
            Line(LEFT * bw / 2 + UP * bh / 2, LEFT * bw / 2 + DOWN * bh / 2, stroke_color=WHITE, stroke_width=3.5, stroke_opacity=0.75),
            Line(RIGHT * bw / 2 + UP * bh / 2, RIGHT * bw / 2 + DOWN * bh / 2, stroke_color=WHITE, stroke_width=3.5, stroke_opacity=0.75),
            Ellipse(width=bw, height=2 * ry, stroke_color=WHITE, stroke_width=3.5, stroke_opacity=0.85).shift(UP * bh / 2),
            Ellipse(width=bw, height=2 * ry, stroke_color=WHITE, stroke_width=3.5, stroke_opacity=0.6).shift(DOWN * bh / 2),
            Line(LEFT * bw * 0.36 + UP * bh * 0.38, LEFT * bw * 0.36 + DOWN * bh * 0.3, stroke_color=WHITE, stroke_width=9, stroke_opacity=0.22),
        )
        for k in range(1, 4):  # measuring marks
            y = -bh / 2 + bh * k / 4
            self.glass.add(Line([bw * 0.3, y, 0], [bw * 0.45, y, 0], stroke_color=WHITE, stroke_width=2.5, stroke_opacity=0.5))
        rng = random.Random(4)
        self.bub = [(rng.uniform(-0.38, 0.38), rng.uniform(0, 1), rng.uniform(0.6, 1.2), Sprite(S.sphere_array("#E8F6FF", 64, 1.4), bw * rng.uniform(0.035, 0.06))) for _ in range(18 if self.fizz else 0)]
        self.dropper = Sprite(sticker_path("droplet"), bw * 0.22) if self.drop and sticker_path("droplet") else None
        self.tag = pill(f"pH {self.ph}", "#FFB300", "#1C1840", 34) if self.ph else None
        extra = [m for m in (self.dropper, self.tag) if m is not None]
        self.add(self.glass_back, self.liquid_body, self.surface, *[b[3] for b in self.bub], self.glass, *extra)
        self._placed = np.zeros(3)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t)
        ct = self.clock(t)
        tc = max(self.cue(0, self.t_in + 1.5), self.t_in + 0.8)
        c = o + np.array([0, self.h * 0.06, 0])
        sh = c - self._placed
        if np.linalg.norm(sh) > 1e-9:
            self.glass.shift(sh)
            self._placed = c
        bw, bh, ry = self.bw, self.bh, self.ry
        u = ease((t - tc - 0.5) / 1.0) if (self.c1 and self.live) else (1.0 if self.c1 and not self.live else 0.0)
        col = ManimColor(self.c0).interpolate(ManimColor(self.c1), u) if self.c1 else ManimColor(self.c0)
        level = bh * 0.62
        top_y = c[1] - bh / 2 + level + (0.03 * math.sin(ct * 3) if self.live else 0)
        x0, x1, yb = c[0] - bw / 2 * 0.97, c[0] + bw / 2 * 0.97, c[1] - bh / 2
        self.liquid_body.set_points_as_corners([[x0, top_y, 0], [x0, yb, 0], [x1, yb, 0], [x1, top_y, 0], [x0, top_y, 0]])
        self.liquid_body.set_fill(col, opacity=0.62 * a)
        self.surface.move_to([c[0], top_y, 0])
        self.surface.set_fill(col.interpolate(ManimColor(WHITE), 0.25), opacity=0.8 * a)
        self.glass_back.move_to([c[0], c[1] + bh / 2, 0])
        fade_vm(self.glass_back, a)
        fade_vm(self.glass, a)
        for bx, b0, sp, bs in self.bub:
            yv = (b0 + ct * 0.35 * sp) % 1.0
            bs.put(c[0] + bx * bw + 0.03 * math.sin(ct * 5 + b0 * 9), yb + 0.1 + yv * (level - 0.15), a=a * (0.85 if yv < 0.96 else 0))
        if self.dropper is not None:
            fall = ease((t - tc) / 0.6) if self.live else 1.0
            y = c[1] + bh / 2 + 0.9 - fall * (bh / 2 + 0.9 - (top_y - c[1]))
            self.dropper.put(c[0], y, a=a * (1 - ease((t - tc - 0.6) / 0.2)) if self.live else 0)
        if self.tag is not None:
            self.tag.move_to([c[0] + bw / 2 + 0.2 + self.tag.width / 2, c[1] + bh * 0.1, 0]) if self.w > 5 else self.tag.move_to([c[0], c[1] - bh / 2 - 0.6, 0])
            fade_vm(self.tag, self.appear(t, max(self.t_in + 0.4, tc + 0.8 if self.c1 else self.t_in + 0.4)))


# ----------------------------------------------------------------------------- formula
class FormulaVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        self.f = S.Formula3D(subject, size=120)
        self.f.scale_to_fit_height(min(h * 0.32, 2.0))
        if self.f.width > w * 0.95:
            self.f.scale_to_fit_width(w * 0.95)
        self.glow = Sprite(S.glow_array("#2A6BD8"), max(self.f.width, 2) * 1.1)
        self.add(self.glow, self.f)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        a = self.appear(t, dur=0.5)
        self.glow.put(o[0], o[1], a=0.35 * a)
        self.f.shift(o - self.f.pivot.get_center())
        if self.live:
            self.f.turn(self.clock(t), amp=0.38)
        fade_vm(self.f, a)


# ----------------------------------------------------------------------------- stickers
class StickerVisual(Visual):
    def __init__(self, subject, w, h, short=True, animate=True):
        super().__init__(w, h, short, animate)
        chain = "->" in subject
        names = [x.strip() for x in re.split(r"\s*(?:->|→|,)\s*", subject) if x.strip()]
        self.names = [n for n in names if sticker_path(n)][:4]
        if not self.names:
            raise ValueError("sticker: none found")
        n = len(self.names)
        self.size = min(h * (0.75 if n == 1 else 0.48), (w * 0.9) / n - (0.5 if chain else 0.2), 3.6 if n == 1 else 2.6)
        self.sp = [Sprite(sticker_path(nm), self.size) for nm in self.names]
        self.shadow = [Sprite(S.glow_array("#000000", 96, 1.5), 1) for _ in self.sp]
        self.arrows = [S.block_arrow(0.7, 0.11, NEUTRAL) for _ in range(n - 1)] if chain else []
        self.labels = []   # no file-name captions: the narration says what each sticker is
        self.add(*self.shadow, *self.sp, *self.arrows, *self.labels)

    def tick(self, t):
        super().tick(t)
        o = self.o()
        n = len(self.sp)
        ct = self.clock(t)
        step = self.w * 0.92 / n
        for k, (sp, sh) in enumerate(zip(self.sp, self.shadow)):
            at = self.cue(k, self.t_in + 0.6 * k) if n > 1 else self.t_in
            u = (t - at) / 0.45
            pop = 0 if u <= 0 else (1 + 0.18 * math.sin(min(u, 1) * math.pi)) if u < 1 else 1
            bob = 0.08 * math.sin(ct * 2.2 + k) if self.live else 0
            x = o[0] + (k - (n - 1) / 2) * step
            y = o[1] + bob + 0.15
            sp.put(x, y, h=max(0.01, self.size * pop), a=1.0 if u > 0 else 0)
            sh.put(x, o[1] - self.size * 0.5, h=self.size * 0.25 * pop, a=0.35 if u > 0 else 0)
            sh.stretch_to_fit_width(self.size * 0.8 * max(pop, 0.01))
            if self.labels:
                self.labels[k].move_to([x, o[1] - self.size * 0.5 - 0.35, 0])
                fade_vm(self.labels[k], ease(u))
            if k < len(self.arrows):
                self.arrows[k].move_to([x + step / 2, y, 0])
                fade_vm(self.arrows[k], ease((t - (self.cue(k + 1, at + 0.6) - 0.2)) / 0.3))


KINDS = {"molecule": MoleculeVisual, "reaction": ReactionVisual, "states": StatesVisual, "atom": AtomVisual, "ions": IonsVisual,
         "lattice": LatticeVisual, "mixture": MixtureVisual, "balloon": BalloonVisual, "beaker": BeakerVisual, "formula": FormulaVisual, "sticker": StickerVisual}


def make_visual(kind, subject, w, h, short=True, animate=True):
    """The visual, or None when it can't be drawn (unknown kind / molecule / sticker)."""
    kind = (kind or "").strip().lower()
    subject = (subject or "").strip()
    if not subject or kind not in KINDS:
        return None
    try:
        if kind == "molecule" and not S.molecule(subject):
            kind = "formula" if S.flat_formula_ok(subject) else ""
            if not kind:
                return None
        if kind == "reaction" and not S.parse_equation(subject):
            return None
        return KINDS[kind](subject, w, h, short, animate)
    except Exception as e:  # noqa: BLE001
        print(f"[visual] {kind} '{subject}' can't be drawn: {e}", flush=True)
        if kind == "reaction" and S.parse_equation(subject):
            return FormulaVisual(subject, w, h, short, animate)
        return None


# ----------------------------------------------------------------------------- item icons
class Icon(Visual):
    """A small visual next to a list item: a turning molecule, an atom ball with its symbol,
    or a 3D sticker that bobs. size = its height (units)."""

    def __init__(self, spec, size, animate=True, phase=0.0):
        super().__init__(size, size, True, animate)
        self.kind, self.m = None, None
        spec = (spec or "").strip()
        self.phase = phase
        mol = S.molecule(spec) if re.fullmatch(r"[A-Za-z0-9()\^+\-]+", spec or "_") and re.search(r"[A-Z]", spec) else None
        if mol and len(mol.els) > 1:
            self.kind = "mol"
            self.m = S.MolView(mol, size=size, spin=0.9 if animate else 0, phase=phase, still=not animate)
        elif mol:
            self.kind = "atom"
            el = mol.els[0]
            self.m = Group(Sprite(S.sphere_array(S.ELEMENTS[el][3]), size * 0.9), T(el, 40 * size, "#111111" if el in ("H", "He", "Ne", "S", "Cl", "Ca", "Mg", "Au") else WHITE))
            self.m[1].scale_to_fit_height(size * 0.34)
        elif sticker_path(spec):
            self.kind = "sticker"
            self.m = Sprite(sticker_path(spec), size)
        if self.m is not None:
            self.add(self.m)

    @property
    def ok(self):
        return self.m is not None

    def tick(self, t):
        super().tick(t)
        o = self.o()
        ct = self.clock(t)
        a = self.appear(t, dur=0.35)
        if self.kind == "mol":
            self.m.center_pt = o
            self.m.at(ct)
            self.m.set_alpha(a)
        elif self.kind == "atom":
            self.m[0].move_to(o)
            self.m[1].move_to(o)
            fade_vm(self.m, a)
        elif self.kind == "sticker":
            u = (t - self.t_in) / 0.4
            pop = 0.0 if u <= 0 else (1 + 0.15 * math.sin(min(u, 1) * math.pi)) if u < 1 else 1.0
            bob = 0.05 * math.sin(ct * 2.4 + self.phase) * self.w if self.live else 0
            self.m.put(o[0], o[1] + bob, h=max(0.01, self.w * pop), a=1.0 if u > 0 else 0.0)
