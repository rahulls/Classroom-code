import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

// PDFs. Reports, papers, keys, receipts and the welcome pack are HTML printed to PDF by the laptop's
// Microsoft Edge (or Chrome) in headless mode: it shapes Hindi (Devanagari) text correctly with the
// Windows Nirmala UI font. Answer-sheet photos are joined into one PDF with pdf-lib.
// Tests use the stub (EXAM_PREP_PDF_ADAPTER=stub), which makes a one-page PDF without a browser.

const BROWSERS = [
  process.env.EXAM_PREP_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter((p): p is string => !!p);

export interface PdfMaker {
  fromHtml(html: string): Promise<Buffer>;
}

const browserPdf: PdfMaker = {
  async fromHtml(html) {
    const exe = BROWSERS.find((p) => fs.existsSync(p));
    if (!exe) throw new Error("No Edge or Chrome found to make PDFs.");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ep-pdf-"));
    const src = path.join(dir, "page.html");
    const out = path.join(dir, "page.pdf");
    fs.writeFileSync(src, html, "utf8");
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(
          exe,
          ["--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", `--user-data-dir=${path.join(dir, "profile")}`, `--print-to-pdf=${out}`, `file:///${src.replace(/\\/g, "/")}`],
          { windowsHide: true, stdio: "ignore" },
        );
        const t = setTimeout(() => {
          p.kill();
          reject(new Error("PDF timed out"));
        }, 60_000);
        p.on("exit", () => {
          clearTimeout(t);
          resolve();
        });
        p.on("error", reject);
      });
      if (!fs.existsSync(out)) throw new Error("The browser made no PDF.");
      return fs.readFileSync(out);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};

/** Test stub: a real one-page PDF holding the page's text (no browser). */
const stubPdf: PdfMaker = {
  async fromHtml(html) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const ascii = text.replace(/[^\x20-\x7e]/g, "?").slice(0, 3000);
    for (let i = 0; i * 90 < ascii.length && i < 60; i++) page.drawText(ascii.slice(i * 90, i * 90 + 90), { x: 30, y: 800 - i * 12, size: 8, font });
    doc.setKeywords([Buffer.from(text).toString("base64").slice(0, 60000)]);
    return Buffer.from(await doc.save());
  },
};

export const pdf: PdfMaker = process.env.EXAM_PREP_PDF_ADAPTER === "stub" ? stubPdf : browserPdf;

export async function pageCount(bytes: Uint8Array) {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return d.getPageCount();
}

/** Joins JPG/PNG photos (in the given order) into one PDF, one photo per page. */
export async function imagesToPdf(images: { bytes: Uint8Array; type: "jpg" | "png" }[]) {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.type === "png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    const w = 595;
    const h = (img.height / img.width) * w;
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await doc.save());
}

/** Image size from the file header (JPEG or PNG), for the basic quality check. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(bytes);
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}
