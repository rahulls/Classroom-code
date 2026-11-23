"""Fast vector text for Manim, drawn straight from the Poppins .ttf outlines with fontTools.

Manim's Text goes through Pango, which takes 1-20 s per string on this PC (font lookups), so a
video with ~150 strings never got past building its text. GText makes the same kind of object
(one VMobject per non-space character, same size scale as Text(font_size=...)) in milliseconds.
No kerning (Poppins reads fine without it)."""
import pathlib
from functools import lru_cache

import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from manim import VGroup, VMobject, WHITE, ManimColor

FONTS = pathlib.Path(__file__).resolve().parents[2] / "Chaos creators" / "quiz-template" / "quiz-template" / "fonts"
WEIGHTS = {"BOLD": "Bold", "MEDIUM": "Medium", "NORMAL": "Regular"}
UNIT = 1 / 72000          # Manim units per font unit at font_size 1 (matches Text: "H" at 48 = 0.468 tall)


@lru_cache(maxsize=None)
def _font(weight):
    f = TTFont(str(FONTS / f"Poppins-{WEIGHTS.get(str(weight).upper(), 'Bold')}.ttf"))
    return f, f.getGlyphSet(), f.getBestCmap(), f["hmtx"]


class _Pen(BasePen):
    def __init__(self, gs, vm, dx, k):
        super().__init__(gs)
        self.vm, self.dx, self.k = vm, dx, k

    def _p(self, p):
        return np.array([(p[0] + self.dx) * self.k, p[1] * self.k, 0.0])

    def _moveTo(self, p):
        self.vm.start_new_path(self._p(p))

    def _lineTo(self, p):
        self.vm.add_line_to(self._p(p))

    def _curveToOne(self, a, b, c):
        self.vm.add_cubic_bezier_curve_to(self._p(a), self._p(b), self._p(c))

    def _qCurveToOne(self, a, b):
        self.vm.add_quadratic_bezier_curve_to(self._p(a), self._p(b))

    def _closePath(self):
        self.vm.close_path()

    _endPath = _closePath


class GText(VGroup):
    def __init__(self, text, font_size=48, color=WHITE, weight="BOLD", t2c=None, **_):
        super().__init__()
        f, gs, cmap, hmtx = _font(weight)
        k = font_size * UNIT
        x = 0.0
        self.text = text
        for ch in text:
            name = cmap.get(ord(ch)) or cmap.get(ord("?"))
            adv = hmtx[name][0]
            if not ch.isspace():
                vm = VMobject(fill_color=color, fill_opacity=1.0, stroke_width=0, stroke_color=color)
                gs[name].draw(_Pen(gs, vm, x, 1.0))
                if len(vm.points):
                    vm.points *= k
                else:                       # a glyph with no outline: keep an empty slot so indexes match
                    vm.set_points_as_corners([[x * k, 0, 0], [x * k, 0, 0]])
                self.add(vm)
            x += adv
        # baseline at y=0 like a line of text; centre it as Manim does
        if not self.submobjects:            # empty text: a zero-size placeholder, so layouts still work
            vm = VMobject(fill_opacity=0, stroke_width=0)
            vm.set_points_as_corners([[0, 0, 0], [0, 0, 0]])
            self.add(vm)
        self.center()
        if t2c:
            low = text.lower()
            for sub, col in t2c.items():
                start = 0
                while True:
                    i = low.find(sub.lower(), start)
                    if i < 0:
                        break
                    a = len(text[:i].replace(" ", ""))
                    n = len(sub.replace(" ", ""))
                    for m in self.submobjects[a:a + n]:
                        m.set_fill(ManimColor(col))
                    start = i + len(sub)
