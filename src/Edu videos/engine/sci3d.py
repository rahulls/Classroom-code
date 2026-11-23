"""3D science building blocks for the Edu videos (Manim, Cairo renderer).

- Shaded 3D spheres (atoms, particles, electrons) as small anti-aliased sprites, lit from the top left.
- Element data (CPK colours, protons, the most common isotope's neutrons, electron shells).
- Molecules: real 3D ball-and-stick shapes (VSEPR geometry: water bent, ammonia pyramidal, methane
  tetrahedral, carbon dioxide linear ...), two-tone bonds, single/double/triple bonds.
- MolView: a molecule that turns in 3D with perspective and depth sorting.
- Formula3D: a chemical formula / equation with real subscripts and charges, extruded in 3D.
- A faster ImageMobject drawer (Manim composites every picture over the whole frame; this only
  touches the picture's own rectangle), so dozens of atoms per frame stay quick.
"""
import math, re
from functools import lru_cache

import numpy as np
from PIL import Image
from manim import (DOWN, LEFT, ORIGIN, RIGHT, UP, Arrow, Group, ImageMobject, Line, VGroup, VMobject, WHITE, ManimColor, config)
from manim.camera.camera import Camera

from gtext import GText


# ----------------------------------------------------------------------------- fast pictures
def _fast_display_image_mobject(self, image_mobject, pixel_array):
    sub = Image.fromarray(image_mobject.get_pixel_array(), mode="RGBA")
    tc = self.points_to_subpixel_coords(image_mobject, image_mobject.points).astype(np.float64)
    x0, y0 = tc[:, 0].min(), tc[:, 1].min()
    w = int(round(tc[:, 0].max() - x0))
    h = int(round(tc[:, 1].max() - y0))
    if w < 1 or h < 1 or w > 6000 or h > 6000:
        return
    aligned = abs(tc[0][1] - tc[1][1]) < 0.75 and abs(tc[0][0] - tc[2][0]) < 0.75 and tc[1][0] > tc[0][0] and tc[2][1] > tc[0][1]
    if aligned:
        sub = sub.resize((w, h), Image.LANCZOS if (w < sub.width or h < sub.height) else Image.BICUBIC)
    else:
        orig = np.array([[0, 0], [sub.width, 0], [0, sub.height], [sub.width, sub.height]], dtype=np.float64)
        rel = tc - np.array([x0, y0])
        A, b = [], []
        for (x, y), (X, Y) in zip(rel, orig):
            A += [[x, y, 1, 0, 0, 0, -X * x, -X * y], [0, 0, 0, x, y, 1, -Y * x, -Y * y]]
            b += [X, Y]
        try:
            coef = np.linalg.solve(np.array(A), np.array(b))
        except np.linalg.LinAlgError:
            return
        sub = sub.transform((w, h), Image.Transform.PERSPECTIVE, coef, Image.BICUBIC)
    ix, iy = int(round(x0)), int(round(y0))
    H, W = pixel_array.shape[:2]
    ax, ay, bx, by = max(0, ix), max(0, iy), min(W, ix + w), min(H, iy + h)
    if ax >= bx or ay >= by:
        return
    src = np.asarray(sub, dtype=np.float32)[ay - iy:by - iy, ax - ix:bx - ix]
    a = src[:, :, 3:4] / 255.0
    if not a.any():
        return
    dst = pixel_array[ay:by, ax:bx].astype(np.float32)
    out = np.empty_like(dst)
    out[:, :, :3] = src[:, :, :3] * a + dst[:, :, :3] * (1 - a)
    out[:, :, 3:4] = a * 255 + dst[:, :, 3:4] * (1 - a)
    pixel_array[ay:by, ax:bx] = np.clip(out, 0, 255).astype(np.uint8)


Camera.display_image_mobject = _fast_display_image_mobject


# ----------------------------------------------------------------------------- sprites
def _rgb(c):
    c = ManimColor(c).to_rgb()
    return np.array(c, dtype=np.float32)


@lru_cache(maxsize=None)
def sphere_array(color, px=160, gloss=1.0):
    """A lit 3D ball, RGBA uint8 (px x px), light from the upper left."""
    base = _rgb(color)
    n = px
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    x = (x + 0.5) / n * 2 - 1
    y = 1 - (y + 0.5) / n * 2
    r2 = x * x + y * y
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    L = np.array([-0.45, 0.6, 0.66], dtype=np.float32)
    L /= np.linalg.norm(L)
    diff = np.clip(x * L[0] + y * L[1] + z * L[2], 0, 1)
    # Blinn-Phong highlight
    Hh = L + np.array([0, 0, 1], dtype=np.float32)
    Hh /= np.linalg.norm(Hh)
    spec = np.clip(x * Hh[0] + y * Hh[1] + z * Hh[2], 0, 1) ** 38 * 0.75 * gloss
    rim = np.clip(1 - z, 0, 1) ** 3 * 0.25            # soft back-light on the edge
    lum = 0.22 + 0.88 * diff
    col = base[None, None, :] * lum[:, :, None] + spec[:, :, None] + rim[:, :, None] * np.array([0.55, 0.65, 1.0])[None, None, :] * 0.5
    col = np.clip(col, 0, 1)
    edge = 1.5 / n * 2
    alpha = np.clip((1 - np.sqrt(r2)) / edge, 0, 1)
    out = np.dstack([col * 255, alpha * 255]).astype(np.uint8)
    out.setflags(write=False)
    return out


@lru_cache(maxsize=None)
def glow_array(color, px=128, power=2.2):
    """A soft round glow (for flashes, electrons, heat)."""
    base = _rgb(color)
    y, x = np.mgrid[0:px, 0:px].astype(np.float32)
    r = np.sqrt(((x + 0.5) / px * 2 - 1) ** 2 + ((y + 0.5) / px * 2 - 1) ** 2)
    a = np.clip(1 - r, 0, 1) ** power
    col = np.clip(base[None, None, :] * 0.7 + 0.3 * (a[:, :, None] ** 2), 0, 1)
    out = np.dstack([col * 255, a * 255]).astype(np.uint8)
    out.setflags(write=False)
    return out


def sprite(arr):
    m = ImageMobject(np.array(arr))
    return m


# ----------------------------------------------------------------------------- elements
# symbol: (name, Z, mass number of the most common isotope, CPK colour, ball radius)
ELEMENTS = {
    "H": ("Hydrogen", 1, 1, "#F2F2F2", 0.30), "He": ("Helium", 2, 4, "#D9FFFF", 0.32),
    "Li": ("Lithium", 3, 7, "#CC80FF", 0.52), "Be": ("Beryllium", 4, 9, "#C2FF00", 0.46),
    "B": ("Boron", 5, 11, "#FFB5B5", 0.44), "C": ("Carbon", 6, 12, "#6B6F78", 0.44),
    "N": ("Nitrogen", 7, 14, "#3D6BFF", 0.42), "O": ("Oxygen", 8, 16, "#FF2A2A", 0.42),
    "F": ("Fluorine", 9, 19, "#90E050", 0.38), "Ne": ("Neon", 10, 20, "#B3E3F5", 0.38),
    "Na": ("Sodium", 11, 23, "#AB5CF2", 0.60), "Mg": ("Magnesium", 12, 24, "#8AFF00", 0.56),
    "Al": ("Aluminium", 13, 27, "#BFA6A6", 0.54), "Si": ("Silicon", 14, 28, "#F0C8A0", 0.52),
    "P": ("Phosphorus", 15, 31, "#FF8000", 0.50), "S": ("Sulfur", 16, 32, "#FFE330", 0.50),
    "Cl": ("Chlorine", 17, 35, "#1FF01F", 0.50), "Ar": ("Argon", 18, 40, "#80D1E3", 0.48),
    "K": ("Potassium", 19, 39, "#8F40D4", 0.66), "Ca": ("Calcium", 20, 40, "#3DFF00", 0.62),
    "Ti": ("Titanium", 22, 48, "#BFC2C7", 0.56), "Cr": ("Chromium", 24, 52, "#8A99C7", 0.54),
    "Mn": ("Manganese", 25, 55, "#9C7AC7", 0.54), "Fe": ("Iron", 26, 56, "#E06633", 0.54),
    "Co": ("Cobalt", 27, 59, "#F090A0", 0.53), "Ni": ("Nickel", 28, 58, "#50D050", 0.53),
    "Cu": ("Copper", 29, 63, "#C88033", 0.53), "Zn": ("Zinc", 30, 64, "#7D80B0", 0.53),
    "Br": ("Bromine", 35, 79, "#A62929", 0.54), "Kr": ("Krypton", 36, 84, "#5CB8D1", 0.52),
    "Ag": ("Silver", 47, 107, "#C0C0C0", 0.58), "Sn": ("Tin", 50, 120, "#668080", 0.58),
    "I": ("Iodine", 53, 127, "#940094", 0.58), "Xe": ("Xenon", 54, 132, "#429EB0", 0.56),
    "Pt": ("Platinum", 78, 195, "#D0D0E0", 0.58), "Au": ("Gold", 79, 197, "#FFD123", 0.58),
    "Hg": ("Mercury", 80, 202, "#B8B8D0", 0.58), "Pb": ("Lead", 82, 208, "#575961", 0.60),
    "U": ("Uranium", 92, 238, "#008FFF", 0.62),
}
VALENCE = {"H": 1, "He": 2, "Li": 1, "Be": 2, "B": 3, "C": 4, "N": 5, "O": 6, "F": 7, "Ne": 8, "Na": 1, "Mg": 2, "Al": 3, "Si": 4,
           "P": 5, "S": 6, "Cl": 7, "Ar": 8, "K": 1, "Ca": 2, "Br": 7, "I": 7, "Kr": 8, "Xe": 8}
METALS = {"Li", "Be", "Na", "Mg", "Al", "K", "Ca", "Ti", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ag", "Sn", "Pt", "Au", "Hg", "Pb", "U"}


def shells(sym):
    z = ELEMENTS[sym][1]
    special = {24: [2, 8, 13, 1], 29: [2, 8, 18, 1], 47: [2, 8, 18, 18, 1], 50: [2, 8, 18, 18, 4], 53: [2, 8, 18, 18, 7],
               54: [2, 8, 18, 18, 8], 78: [2, 8, 18, 32, 17, 1], 79: [2, 8, 18, 32, 18, 1], 80: [2, 8, 18, 32, 18, 2],
               82: [2, 8, 18, 32, 18, 4], 92: [2, 8, 18, 32, 21, 9, 2]}
    if z in special:
        return special[z]
    if z <= 2:
        return [z]
    if z <= 10:
        return [2, z - 2]
    if z <= 18:
        return [2, 8, z - 10]
    if z <= 20:
        return [2, 8, 8, z - 18]
    if z <= 30:
        return [2, 8, z - 20 + 8 - 2, 2] if z < 30 else [2, 8, 18, 2]
    if z <= 36:
        return [2, 8, 18, z - 28]
    return [2, 8, 18, z - 28] if z - 28 <= 8 else [2, 8, 18, 18, z - 46]


# ----------------------------------------------------------------------------- formulas
_TOKEN = re.compile(r"([A-Z][a-z]?)|(\d+)|(\()|(\))|(\[)|(\])")


def parse_species(s):
    """'2H2O' -> (2, 'H2O', charge str); 'SO4^2-' -> (1, 'SO4', '2-'); 'Na^+' / 'Na+' -> (1, 'Na', '+')."""
    s = s.strip()
    m = re.match(r"^(\d+)\s*(?=[A-Z(\[])", s)
    coef = int(m.group(1)) if m else 1
    body = s[m.end():] if m else s
    charge = ""
    m2 = re.search(r"\^?\(?(\d*[+\-−])\)?$", body)
    if m2 and (body[m2.start()] == "^" or not body[:m2.start()].endswith(tuple("0123456789")) or m2.group(1) in "+-−"):
        charge = m2.group(1).replace("−", "-")
        body = body[:m2.start()]
    body = body.replace("^", "")
    return coef, body, charge


def atom_counts(body):
    """'Ca(OH)2' -> {'Ca': 1, 'O': 2, 'H': 2}; None when it isn't a formula."""
    stack = [{}]
    i = 0
    if not body or not re.fullmatch(r"[A-Za-z0-9()\[\]]+", body):
        return None
    while i < len(body):
        m = _TOKEN.match(body, i)
        if not m:
            return None
        el, num, op, cl, ob, cb = m.groups()
        i = m.end()
        if el:
            if el not in ELEMENTS:
                return None
            n = 1
            m2 = re.match(r"\d+", body[i:])
            if m2:
                n = int(m2.group())
                i += m2.end()
            stack[-1][el] = stack[-1].get(el, 0) + n
        elif op or ob:
            stack.append({})
        elif cl or cb:
            if len(stack) < 2:
                return None
            grp = stack.pop()
            n = 1
            m2 = re.match(r"\d+", body[i:])
            if m2:
                n = int(m2.group())
                i += m2.end()
            for k, v in grp.items():
                stack[-1][k] = stack[-1].get(k, 0) + v * n
        elif num:
            return None
    return stack[0] if len(stack) == 1 and stack[0] else None


def parse_equation(s):
    """'2H2 + O2 -> 2H2O' -> ([(2,'H2',''), (1,'O2','')], [(2,'H2O','')]); None if it isn't one."""
    s = s.replace("→", "->").replace("⟶", "->").replace("=>", "->")
    if "->" not in s:
        return None
    left, right = s.split("->", 1)
    sides = []
    for side in (left, right):
        parts = [p for p in re.split(r"\s+\+\s+|\s*\+\s*(?=\d*[A-Z(])", side.strip()) if p.strip()]
        sp = [parse_species(p) for p in parts]
        if not sp or any(atom_counts(b) is None for _, b, _ in sp):
            return None
        sides.append(sp)
    return sides[0], sides[1]


# ----------------------------------------------------------------------------- molecule shapes
def _unit(v):
    v = np.array(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n else v


def _dirs(n):
    """Ideal VSEPR directions for n electron domains (first one points down -y... arbitrary frame)."""
    if n <= 1:
        return [np.array([1.0, 0, 0])]
    if n == 2:
        return [np.array([1.0, 0, 0]), np.array([-1.0, 0, 0])]
    if n == 3:
        return [np.array([math.cos(a), math.sin(a), 0]) for a in (0, 2 * math.pi / 3, 4 * math.pi / 3)]
    if n == 4:
        return [_unit(v) for v in ([1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1])]
    if n == 5:
        return [np.array([0, 0, 1.0]), np.array([0, 0, -1.0])] + [np.array([math.cos(a), math.sin(a), 0]) for a in (0, 2 * math.pi / 3, 4 * math.pi / 3)]
    return [np.array(v, dtype=float) for v in ([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1])]


def _rot_to(a, b):
    """Rotation matrix taking unit vector a onto unit vector b."""
    a, b = _unit(a), _unit(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        if c > 0:
            return np.eye(3)
        p = _unit(np.cross(a, [1, 0, 0] if abs(a[0]) < 0.9 else [0, 1, 0]))
        return 2 * np.outer(p, p) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


class Mol:
    """Atoms (element symbols), 3D coordinates and bonds (i, j, order)."""

    def __init__(self, els, xyz, bonds, name=""):
        self.els, self.xyz, self.bonds, self.name = list(els), np.array(xyz, dtype=float).reshape(-1, 3), list(bonds), name
        if len(self.xyz):
            self.xyz -= self.xyz.mean(axis=0)

    @property
    def radius(self):
        if not len(self.xyz):
            return 0.5
        return float(max(np.linalg.norm(p) + ELEMENTS[e][4] for p, e in zip(self.xyz, self.els)))


def build(els, bonds, charge_lp=None):
    """3D coordinates for a molecule graph by VSEPR: each atom's neighbours (and lone pairs) spread
    out ideally; the tree is laid out from atom 0. Ring-free molecules only."""
    n = len(els)
    nb = [[] for _ in range(n)]
    order = {}
    for i, j, o in bonds:
        nb[i].append(j)
        nb[j].append(i)
        order[(i, j)] = order[(j, i)] = o
    lp = []
    for i, e in enumerate(els):
        if charge_lp and i in charge_lp:
            lp.append(charge_lp[i])
            continue
        v = VALENCE.get(e, 0)
        used = sum(order[(i, j)] for j in nb[i])
        lp.append(max(0, (v - used) // 2) if e != "H" and v and e not in METALS else 0)
    xyz = [None] * n
    xyz[0] = np.zeros(3)
    seen = {0}
    queue = [(0, None)]
    while queue:
        i, parent = queue.pop(0)
        dom = len(nb[i]) + lp[i]
        dirs = _dirs(max(dom, 1))
        if parent is not None:
            back = _unit(xyz[parent] - xyz[i])
            R = _rot_to(dirs[0], back)
            dirs = [R @ d for d in dirs][1:]
            # twist so chains zig-zag instead of curling
            dirs = sorted(dirs, key=lambda d: -abs(d[2]))
        children = [j for j in nb[i] if j not in seen]
        # lone pairs take the last directions; bonded neighbours the first
        for k, j in enumerate(children):
            d = dirs[k % len(dirs)]
            L = (ELEMENTS[els[i]][4] + ELEMENTS[els[j]][4]) * 1.55 * (0.92 if order[(i, j)] >= 2 else 1.0)
            xyz[j] = xyz[i] + d * L
            seen.add(j)
            queue.append((j, i))
    return xyz


def _chain(spec):
    """Tiny molecule language: list of (element, parent index, bond order); index 0 has parent None."""
    els = [e for e, _, _ in spec]
    bonds = [(p, k, o) for k, (_, p, o) in enumerate(spec) if p is not None]
    return els, bonds


LIB_SPECS = {
    "H2O": [("O", None, 0), ("H", 0, 1), ("H", 0, 1)],
    "CO2": [("C", None, 0), ("O", 0, 2), ("O", 0, 2)],
    "NH3": [("N", None, 0), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1)],
    "CH4": [("C", None, 0), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1)],
    "O3": [("O", None, 0), ("O", 0, 2), ("O", 0, 1)],
    "SO2": [("S", None, 0), ("O", 0, 2), ("O", 0, 2)],
    "NO2": [("N", None, 0), ("O", 0, 2), ("O", 0, 1)],
    "H2S": [("S", None, 0), ("H", 0, 1), ("H", 0, 1)],
    "H2O2": [("O", None, 0), ("O", 0, 1), ("H", 0, 1), ("H", 1, 1)],
    "C2H6": [("C", None, 0), ("C", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 1, 1), ("H", 1, 1), ("H", 1, 1)],
    "C2H4": [("C", None, 0), ("C", 0, 2), ("H", 0, 1), ("H", 0, 1), ("H", 1, 1), ("H", 1, 1)],
    "C2H2": [("C", None, 0), ("C", 0, 3), ("H", 0, 1), ("H", 1, 1)],
    "CH3OH": [("C", None, 0), ("O", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 1, 1)],
    "C2H5OH": [("C", None, 0), ("C", 0, 1), ("O", 1, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 1, 1), ("H", 1, 1), ("H", 2, 1)],
    "CH3COOH": [("C", None, 0), ("C", 0, 1), ("O", 1, 2), ("O", 1, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 3, 1)],
    "H2SO4": [("S", None, 0), ("O", 0, 2), ("O", 0, 2), ("O", 0, 1), ("O", 0, 1), ("H", 3, 1), ("H", 4, 1)],
    "HNO3": [("N", None, 0), ("O", 0, 2), ("O", 0, 1), ("O", 0, 1), ("H", 3, 1)],
    "H2CO3": [("C", None, 0), ("O", 0, 2), ("O", 0, 1), ("O", 0, 1), ("H", 2, 1), ("H", 3, 1)],
    "HCN": [("C", None, 0), ("H", 0, 1), ("N", 0, 3)],
    "C3H8": [("C", None, 0), ("C", 0, 1), ("C", 1, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 1, 1), ("H", 1, 1), ("H", 2, 1), ("H", 2, 1), ("H", 2, 1)],
    "CO": [("C", None, 0), ("O", 0, 3)],
    "O2": [("O", None, 0), ("O", 0, 2)],
    "N2": [("N", None, 0), ("N", 0, 3)],
    "NaOH": [("O", None, 0), ("Na", 0, 1), ("H", 0, 1)],
    "KOH": [("O", None, 0), ("K", 0, 1), ("H", 0, 1)],
    "CO3": [("C", None, 0), ("O", 0, 2), ("O", 0, 1), ("O", 0, 1)],
    "SO4": [("S", None, 0), ("O", 0, 2), ("O", 0, 2), ("O", 0, 1), ("O", 0, 1)],
    "NO3": [("N", None, 0), ("O", 0, 2), ("O", 0, 1), ("O", 0, 1)],
    "OH": [("O", None, 0), ("H", 0, 1)],
    "NH4": [("N", None, 0), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1)],
    "H3O": [("O", None, 0), ("H", 0, 1), ("H", 0, 1), ("H", 0, 1)],
}
ALIASES = {"C2H5OH": ["C2H6O", "CH3CH2OH", "ETHANOL"], "CH3COOH": ["C2H4O2", "ACETICACID"], "CH3OH": ["CH4O"], "H2O": ["WATER"],
           "CO2": ["CARBONDIOXIDE"], "NH3": ["AMMONIA"], "CH4": ["METHANE"], "C3H8": ["PROPANE"]}
# lone pairs on charged / special centres (so ions get the right shape)
LP_FIX = {"NH4": {0: 0}, "H3O": {0: 1}, "CO3": {0: 0}, "NO3": {0: 0}, "SO4": {0: 0}, "NO2": {0: 1}, "O3": {0: 1}}


def benzene():
    els, xyz, bonds = [], [], []
    R, Rh = 1.40 * 0.98, 2.45
    for k in range(6):
        a = k * math.pi / 3
        els.append("C")
        xyz.append([R * math.cos(a), R * math.sin(a), 0])
    for k in range(6):
        a = k * math.pi / 3
        els.append("H")
        xyz.append([Rh * math.cos(a), Rh * math.sin(a), 0])
        bonds.append((k, (k + 1) % 6, 2 if k % 2 == 0 else 1))
        bonds.append((k, k + 6, 1))
    return Mol(els, xyz, bonds, "C6H6")


@lru_cache(maxsize=None)
def molecule(formula):
    """A Mol for a formula ('H2O', 'CO2', 'Cl2', 'CCl4', 'Na', ...), or None when no shape is known."""
    f = re.sub(r"\s", "", formula)
    _, body, _ = parse_species(f)
    key = body.upper().replace("(", "").replace(")", "")
    for k, al in ALIASES.items():
        if key in al:
            body = k
    if body == "C6H6":
        return benzene()
    if body in LIB_SPECS:
        els, bonds = _chain(LIB_SPECS[body])
        return Mol(els, build(els, bonds, LP_FIX.get(body)), bonds, body)
    counts = atom_counts(body)
    if not counts:
        return None
    total = sum(counts.values())
    if total == 1:                                      # a single atom (He, Na, Fe ...)
        el = next(iter(counts))
        return Mol([el], [[0, 0, 0]], [], body)
    if len(counts) == 1 and total == 2:                 # diatomic element
        el = next(iter(counts))
        o = {"N": 3, "O": 2}.get(el, 1)
        els, bonds = [el, el], [(0, 1, o)]
        return Mol(els, build(els, bonds), bonds, body)
    if len(counts) == 2 and total == 2:                 # HCl, HF, NaCl (ion pair), CO
        a, b = list(counts)
        if a in METALS or b in METALS:                  # an ion pair: no covalent bond drawn
            ra, rb = ELEMENTS[a][4], ELEMENTS[b][4]
            return Mol([a, b], [[0, 0, 0], [ra + rb + 0.08, 0, 0]], [], body)
        els, bonds = [a, b], [(0, 1, 1)]
        return Mol(els, build(els, bonds), bonds, body)
    # an ionic compound (a metal with non-metals, e.g. Fe2O3, MgCl2, CaO): one formula unit as a
    # compact cluster of ions touching each other (ionic solids have no separate molecules or bonds)
    if any(e in METALS for e in counts) and total <= 14 and not any(e == "H" for e in counts):
        metals = [e for e, c in counts.items() if e in METALS for _ in range(c)]
        others = [e for e, c in counts.items() if e not in METALS for _ in range(c)]
        els = []
        while metals or others:   # alternate cations and anions
            if metals:
                els.append(metals.pop(0))
            if others:
                els.append(others.pop(0))
        n = len(els)
        golden = math.pi * (3 - math.sqrt(5))
        rad = max(ELEMENTS[e][4] for e in els) * (0.55 + 0.62 * n ** (1 / 3))
        xyz = []
        for i in range(n):
            y = 1 - 2 * (i + 0.5) / n
            r = math.sqrt(max(0, 1 - y * y))
            xyz.append([math.cos(golden * i) * r * rad, y * rad, math.sin(golden * i) * r * rad])
        return Mol(els, xyz, [], body)
    # AXn: one central atom (count 1, not H) with n identical or mixed outer atoms
    centre = next((e for e, c in counts.items() if c == 1 and e != "H"), None)
    if centre and total <= 7 and centre not in METALS:
        outer = [e for e, c in counts.items() if e != centre for _ in range(c)]
        els = [centre] + outer
        v = VALENCE.get(centre, 4)
        bonds = [(0, k + 1, 1) for k in range(len(outer))]
        # use double bonds to oxygen while the centre still has electrons to spare (CO2-like)
        spare = v - len(outer)
        for k, e in enumerate(outer):
            if e in ("O", "S") and spare > 0 and centre not in ("H",):
                bonds[k] = (0, k + 1, 2)
                spare -= 1
        return Mol(els, build(els, bonds), bonds, body)
    return None


# ----------------------------------------------------------------------------- MolView
def rot_matrix(ax, ay, az=0.0):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


class MolView(Group):
    """A molecule drawn ball-and-stick that turns in 3D. size = its on-screen diameter (units).
    Call .at(t) every frame (an updater does it) to place every atom and bond for scene time t."""

    def __init__(self, mol, size=3.0, spin=0.55, tilt=0.35, phase=0.0, bond_px=None, still=False):
        super().__init__()
        self.mol, self.spin, self.tilt, self.phase, self.still = mol, spin, tilt, phase, still
        self.k = size / (2 * max(mol.radius, 0.6))     # molecule units -> scene units
        self.center_pt = np.zeros(3)
        self.alpha = 1.0
        self.extra_rot = np.eye(3)
        self.atoms = [sprite(sphere_array(ELEMENTS[e][3])) for e in mol.els]
        self.bw = (bond_px or 0.16) * self.k           # bond thickness (units)
        self.bonds = []
        for i, j, o in mol.bonds:
            parts = []
            for _ in range(max(1, o)):
                for el in (mol.els[i], mol.els[j]):
                    c = ManimColor(ELEMENTS[el][3])
                    body = Line(ORIGIN, RIGHT, stroke_color=c.interpolate(ManimColor("#000000"), 0.35), stroke_width=self.bw * 100 / max(1, o) ** 0.35)
                    shine = Line(ORIGIN, RIGHT, stroke_color=c.interpolate(ManimColor("#FFFFFF"), 0.45), stroke_width=self.bw * 30 / max(1, o) ** 0.35)
                    parts.append((body, shine))
            self.bonds.append((i, j, o, parts))
        self.drawables = []
        for a in self.atoms:
            self.drawables.append(a)
        for _, _, _, parts in self.bonds:
            for b, s in parts:
                self.drawables += [b, s]
        self.add(*self.drawables)
        self.at(0.0)

    def rotation(self, t):
        if self.still:
            return self.extra_rot @ rot_matrix(self.tilt, 0.7 + self.phase)
        return self.extra_rot @ rot_matrix(self.tilt + 0.18 * math.sin(t * 0.7 + self.phase), t * self.spin + self.phase)

    def screen(self, t):
        """(x, y, depth, scale) per atom in scene units."""
        R = self.rotation(t)
        P = (R @ self.mol.xyz.T).T * self.k
        out = []
        for p in P:
            s = 1.0 / (1 - p[2] / (self.k * 14))
            out.append((self.center_pt[0] + p[0] * s, self.center_pt[1] + p[1] * s, p[2], s))
        return out

    def set_alpha(self, a):
        a = float(np.clip(a, 0, 1))
        if abs(a - self.alpha) < 1e-3:
            return
        self.alpha = a
        for m in self.atoms:
            m.set_opacity(a)
        for _, _, _, parts in self.bonds:
            for b, s in parts:
                b.set_stroke(opacity=a)
                s.set_stroke(opacity=a * 0.85)

    def at(self, t, hidden=False):
        pts = self.screen(t)
        order = []
        for k, (x, y, z, s) in enumerate(pts):
            r = ELEMENTS[self.mol.els[k]][4] * self.k * s
            a = self.atoms[k]
            if hidden:
                a.set_opacity(0)
            a.height = max(0.01, 2 * r)
            a.width = a.height
            a.move_to([x, y, 0])
            order.append((z, [a]))
        for i, j, o, parts in self.bonds:
            xi, yi, zi, si = pts[i]
            xj, yj, zj, sj = pts[j]
            d = np.array([xj - xi, yj - yi])
            L = np.linalg.norm(d)
            u = d / L if L > 1e-6 else np.array([1.0, 0])
            nrm = np.array([-u[1], u[0]])
            ri = ELEMENTS[self.mol.els[i]][4] * self.k * si * 0.6
            rj = ELEMENTS[self.mol.els[j]][4] * self.k * sj * 0.6
            a_ = np.array([xi, yi]) + u * ri
            b_ = np.array([xj, yj]) - u * rj
            mid = (a_ + b_) / 2
            off = self.bw * 1.25
            group = []
            for k in range(o):
                shift = nrm * off * (k - (o - 1) / 2)
                for half, (body, shine) in enumerate(parts[2 * k:2 * k + 2]):
                    p0, p1 = (a_, mid) if half == 0 else (mid, b_)
                    p0, p1 = p0 + shift, p1 + shift
                    if np.linalg.norm(p1 - p0) < 1e-3:
                        p1 = p0 + u * 1e-3
                    body.put_start_and_end_on([p0[0], p0[1], 0], [p1[0], p1[1], 0])
                    hs = nrm * self.bw * 0.22
                    shine.put_start_and_end_on([p0[0] + hs[0], p0[1] + hs[1], 0], [p1[0] + hs[0], p1[1] + hs[1], 0])
                    group += [body, shine]
            order.append(((zi + zj) / 2 - 0.05 * self.k, group))
        order.sort(key=lambda x: x[0])
        self.submobjects = [m for _, g in order for m in g]
        return pts


# ----------------------------------------------------------------------------- 3D formula text
def block_arrow(length=1.0, thick=0.12, color=WHITE, direction=RIGHT):
    """A solid filled arrow (one polygon: fades, extrudes and turns like the letters)."""
    hl, hw = min(length * 0.45, thick * 2.6), thick * 2.6
    L = length / 2
    pts = [[-L, thick / 2, 0], [L - hl, thick / 2, 0], [L - hl, hw / 2, 0], [L, 0, 0], [L - hl, -hw / 2, 0], [L - hl, -thick / 2, 0], [-L, -thick / 2, 0]]
    m = VMobject(fill_color=color, fill_opacity=1, stroke_width=0).set_points_as_corners(pts + [pts[0]])
    ang = math.atan2(direction[1], direction[0])
    if ang:
        m.rotate(ang, about_point=ORIGIN)
    return m


SUB_SCALE = 0.62


def formula_glyphs(text, size=72, color=WHITE):
    """A formula / equation as flat glyphs with real subscripts, coefficients and charges.
    Handles '2H2 + O2 -> 2H2O', 'Na^+', 'SO4^2-', 'Ca(OH)2', 'H2O'. Returns a VGroup."""
    text = text.replace("→", "->")
    out = VGroup()
    x = 0.0
    hgt = GText("H", size).height

    def put(m, dy=0.0, gap=0.03):
        nonlocal x
        m.move_to([x + m.width / 2, dy, 0], aligned_edge=ORIGIN)
        m.align_to([x, 0, 0], LEFT)
        out.add(m)
        x = m.get_right()[0] + gap

    i = 0
    s = text.strip()
    while i < len(s):
        ch = s[i]
        if s.startswith("->", i):
            a = block_arrow(hgt * 1.7, hgt * 0.16, color)
            x += hgt * 0.35
            a.move_to([x + a.width / 2, 0, 0])
            out.add(a)
            x = a.get_right()[0] + hgt * 0.35
            i += 2
            continue
        if ch == "^":                                   # charge: ^2-  ^+
            m = re.match(r"\^\(?(\d*[+\-−])\)?", s[i:])
            if m:
                g = GText(m.group(1).replace("-", "–").replace("−", "–"), size * SUB_SCALE, color)
                put(g, dy=hgt * 0.62)
                i += m.end()
                continue
            i += 1
            continue
        if ch.isdigit():
            j = i
            while j < len(s) and s[j].isdigit():
                j += 1
            num = s[i:j]
            prev = s[i - 1] if i else " "
            is_sub = prev.isalpha() or prev in ")]"
            nxt = s[j] if j < len(s) else ""
            if is_sub and nxt and nxt in "+-−" and (j + 1 >= len(s) or s[j + 1] == " "):   # Mg2+ written without ^
                g = GText(num + nxt.replace("-", "–"), size * SUB_SCALE, color)
                put(g, dy=hgt * 0.62)
                i = j + 1
                continue
            g = GText(num, size * SUB_SCALE if is_sub else size, color)
            put(g, dy=-hgt * 0.32 if is_sub else 0)
            i = j
            continue
        if ch in "+-−" and i and s[i - 1].isalpha() and (i + 1 >= len(s) or s[i + 1] == " "):   # Na+ / Cl-
            g = GText(ch.replace("-", "–").replace("−", "–"), size * SUB_SCALE, color)
            put(g, dy=hgt * 0.62)
            i += 1
            continue
        if ch == " ":
            x += hgt * 0.32
            i += 1
            continue
        g = GText(ch, size, color)
        if ch == "+":
            x += hgt * 0.05
        put(g, gap=0.03 if ch.isalpha() else hgt * 0.08)
        i += 1
    out.center()
    return out


class Formula3D(VGroup):
    """A formula drawn as solid 3D letters: extruded layers behind a lit face. turn(t) swings it."""

    def __init__(self, text, size=72, face="#FFFFFF", side="#2A6BD8", depth=0.16, layers=9, outline=None):
        super().__init__()
        self.layers = VGroup()
        side_c = ManimColor(side)
        for k in range(layers, 0, -1):
            g = formula_glyphs(text, size, side_c.interpolate(ManimColor("#000000"), 0.15 + 0.45 * k / layers))
            g.shift(np.array([0, 0, -depth * k / layers]))
            self.layers.add(g)
        self.face = formula_glyphs(text, size, face)
        top = ManimColor(face)
        for gl in self.face:
            if isinstance(gl, VMobject):
                gl.set_fill(color=[top, top.interpolate(ManimColor(side), 0.35)], opacity=1)
                gl.set_sheen_direction(DOWN)
            for sub in gl.family_members_with_points():
                sub.set_stroke(color=outline or side_c.interpolate(ManimColor("#000000"), 0.5), width=1.2)
        # an invisible pivot: moves and scales with the formula, so turning never drifts
        self.pivot = VMobject(fill_opacity=0, stroke_width=0).set_points_as_corners([ORIGIN, ORIGIN + 1e-4 * RIGHT])
        self.pivot.move_to(self.face.get_center())
        self.add(self.layers, self.face, self.pivot)
        self.R = np.eye(3)
        self.pose(-0.32, 0.2)

    def pose(self, ay, ax):
        """Turn it to yaw ay / pitch ax (radians) about its pivot."""
        Rn = rot_matrix(ax, ay)
        D = Rn @ self.R.T
        c = self.pivot.get_center()
        for m in self.family_members_with_points():
            if m is not self.pivot and len(m.points):
                m.points = (D @ (m.points - c).T).T + c
        self.R = Rn
        return self

    def turn(self, t, amp=0.32, speed=0.55):
        self.pose(-amp * math.cos(t * speed), 0.18 + 0.05 * math.sin(t * speed * 1.3))


def flat_formula_ok(text):
    """True when the text parses as a formula or equation (not plain words)."""
    t = text.strip()
    if parse_equation(t):
        return True
    _, body, _ = parse_species(t)
    return atom_counts(body) is not None
