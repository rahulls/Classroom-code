// "Strengths and weaknesses at a glance": a single-series web (radar) chart of a sheet's chapter
// percentages, as inline SVG for the one-page report PDF. Pure (no I/O) so it is unit-tested.

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Short chart labels for common chapter names (the table beside the chart keeps the full name)
const SHORT: Record<string, string> = {
  "real numbers": "Real No.",
  "pair of linear equations in two variables": "Linear Eq.",
  "pair of linear equations": "Linear Eq.",
  "linear equations in two variables": "Linear Eq.",
  "quadratic equations": "Quadratics",
  "arithmetic progressions": "AP",
  "coordinate geometry": "Coord. Geo.",
  "introduction to trigonometry": "Trigonometry",
  "some applications of trigonometry": "Heights & Dist.",
  "applications of trigonometry": "Heights & Dist.",
  "areas related to circles": "Areas (Circles)",
  "surface areas and volumes": "Surface Area & Vol.",
  "number systems": "Number Sys.",
  "heron's formula": "Heron's",
  "lines and angles": "Lines & Angles",
  "chemical reactions and equations": "Chem. Reactions",
  "acids, bases and salts": "Acids & Bases",
  "metals and non-metals": "Metals",
  "carbon and its compounds": "Carbon",
  "life processes": "Life Proc.",
  "control and coordination": "Control & Coord.",
  "how do organisms reproduce?": "Reproduction",
  "heredity": "Heredity",
  "light - reflection and refraction": "Light",
  "the human eye and the colourful world": "Human Eye",
  "magnetic effects of electric current": "Magnetism",
  "our environment": "Environment",
};

export function shortChapter(name: string) {
  const k = name.trim().toLowerCase();
  if (SHORT[k]) return SHORT[k];
  if (name.length <= 16) return name;
  const cut = name.slice(0, 15);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 8 ? cut.lastIndexOf(" ") : 15).trim()}…`;
}

export type RadarRow = { chapter: string; pct: number; weak: boolean };

/** SVG web chart. Null under 3 chapters (no shape to draw). `rings` are the dashed reference rings (e.g. Average and Okay cut-offs). */
export function chapterRadar(rows: RadarRow[], rings: number[], size = 270): string | null {
  const n = rows.length;
  if (n < 3) return null;
  const c = size / 2;
  const R = c - 46;
  const padX = 82;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, r: number) => [c + r * Math.cos(ang(i)), c + r * Math.sin(ang(i))] as const;
  const poly = (f: (i: number) => number) =>
    rows
      .map((_, i) =>
        pt(i, f(i))
          .map((v) => v.toFixed(1))
          .join(","),
      )
      .join(" ");
  const clamp = (p: number) => Math.max(0, Math.min(100, p));
  const marked = [...new Set(rings.filter((p) => p > 0 && p < 100))];
  const grid = [...new Set([20, 40, 60, 80, 100, ...marked])]
    .sort((a, b) => a - b)
    .map((p) => {
      const m = marked.includes(p);
      return `<polygon points="${poly(() => (R * p) / 100)}" fill="none" stroke="${m ? "#9aa6bf" : "#e4e7ef"}" stroke-width="${m ? 1.2 : 1}"${m ? ' stroke-dasharray="4 4"' : ""}/>`;
    })
    .join("");
  const spokes = rows
    .map((_, i) => {
      const [x, y] = pt(i, R);
      return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e4e7ef"/>`;
    })
    .join("");
  const dots = rows
    .map((r, i) => {
      const [x, y] = pt(i, (R * clamp(r.pct)) / 100);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#13213f" stroke="#fff" stroke-width="1.5"/>`;
    })
    .join("");
  const labels = rows
    .map((r, i) => {
      const [x, y] = pt(i, R + 22);
      const a = Math.cos(ang(i));
      const anchor = Math.abs(a) < 0.2 ? "middle" : a > 0 ? "start" : "end";
      const col = r.weak ? "#b3261e" : "#36405a";
      return `<text x="${x.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="11" fill="${col}" font-weight="${r.weak ? 700 : 500}">${esc(shortChapter(r.chapter))}<tspan x="${x.toFixed(1)}" dy="12.5" font-size="10.5" fill="${r.weak ? "#b3261e" : "#6b7591"}">${Math.round(r.pct)}%</tspan></text>`;
    })
    .join("");
  const ringLabels = marked
    .map((p) => {
      const [x, y] = pt(0, (R * p) / 100);
      return `<text x="${(x + 3).toFixed(1)}" y="${(y - 2).toFixed(1)}" font-size="8" fill="#6b7591">${p}</text>`;
    })
    .join("");
  return `<svg viewBox="${-padX} 0 ${size + 2 * padX} ${size}" width="100%" style="max-height:${size}px" role="img" aria-label="Chapter-wise strength web chart">${grid}${spokes}${ringLabels}<polygon points="${poly((i) => (R * clamp(rows[i]!.pct)) / 100)}" fill="rgba(19,33,63,.16)" stroke="#13213f" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
