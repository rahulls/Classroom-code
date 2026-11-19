// Integration-test helpers. Everything runs against rsc_exam_prep_test (checked in setup.ts).
import { PDFDocument } from "pdf-lib";
import { epdb } from "../db";

/** Empties every Exam Prep table in the TEST database (TRUNCATE does not fire the audit trigger). */
export async function resetDb() {
  const url = process.env.EXAM_PREP_DATABASE_URL ?? "";
  if (!/\/rsc_exam_prep_test(\?|$)/.test(url)) throw new Error("resetDb only runs on rsc_exam_prep_test");
  const tables = await epdb.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_ep_migrations'`);
  await epdb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function setSettings(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) await epdb.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

/** A small real PDF standing in for a scanned answer sheet. */
export async function fakeSheet(pages = 2) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]);
  return new Uint8Array(await d.save());
}

/** A minimal valid PNG of the given size (for photo uploads). */
export function fakePng(width: number, height: number) {
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

export const FIXTURE_CHAPTERS = ["Real Numbers", "Polynomials", "Quadratic Equations", "Trigonometry", "Statistics"];
