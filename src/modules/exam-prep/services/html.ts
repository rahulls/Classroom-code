// HTML shell for every generated PDF (reports, papers, keys, receipts, welcome pack). A4, one page
// where the spec asks for one. Hindi uses the Windows Devanagari font (Nirmala UI) with fallbacks.

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function pageHtml(o: { title: string; body: string; lang?: "en" | "hi"; footer?: string; onePage?: boolean }) {
  const font = o.lang === "hi" ? `"Nirmala UI", "Mangal", "Noto Sans Devanagari", "Segoe UI", sans-serif` : `"Segoe UI", "Nirmala UI", Arial, sans-serif`;
  return `<!doctype html><html lang="${o.lang ?? "en"}"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>
@page { size: A4; margin: 12mm 12mm 14mm; }
* { box-sizing: border-box; }
body { font-family: ${font}; color: #1d1838; font-size: ${o.onePage ? "10.5pt" : "11pt"}; line-height: 1.35; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 2mm; color: #2a1260; }
h2 { font-size: 12pt; margin: 4mm 0 1.5mm; color: #2a1260; }
.muted { color: #6b6585; font-size: 9pt; }
.row { display: flex; gap: 6mm; }
.box { border: 1px solid #ddd6f3; border-radius: 3mm; padding: 3mm 4mm; flex: 1; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 1.2mm 2mm; border-bottom: 1px solid #ece8f8; font-size: 9.5pt; vertical-align: top; }
th { background: #f4f1fc; }
.pill { display: inline-block; padding: 0.3mm 2.5mm; border-radius: 3mm; font-size: 8.5pt; font-weight: 600; }
.Strong { background: #dcf5e3; color: #11643a; } .Okay { background: #fff3cf; color: #7a5600; } .Needs { background: #fde2e2; color: #8c1d1d; }
.bar { height: 2.2mm; background: #ece8f8; border-radius: 1mm; overflow: hidden; } .bar > i { display: block; height: 100%; background: #7a2fc0; }
.q { margin: 0 0 3mm; page-break-inside: avoid; } .opts { margin: 1mm 0 0 6mm; }
.footer { position: fixed; bottom: -8mm; left: 0; right: 0; font-size: 8pt; color: #6b6585; border-top: 1px solid #ece8f8; padding-top: 1mm; }
</style></head><body>${o.body}${o.footer ? `<div class="footer">${o.footer}</div>` : ""}</body></html>`;
}
