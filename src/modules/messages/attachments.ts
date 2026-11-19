import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { UserError } from "@/core/action";
import { encryptBytes } from "@/core/crypto";

// Files sent with a broadcast. Only types WhatsApp and email both handle, recognised by their
// first bytes (not by the name or the browser's claim), so nothing else can be passed on.

export const MAX_FILE_MB = 10;
export const MAX_IMAGE_MB = 5; // WhatsApp's limit for pictures

type Kind = "image" | "document";
const TYPES: { ext: string[]; mime: string; kind: Kind; magic: number[] }[] = [
  { ext: ["jpg", "jpeg"], mime: "image/jpeg", kind: "image", magic: [0xff, 0xd8, 0xff] },
  { ext: ["png"], mime: "image/png", kind: "image", magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ["pdf"], mime: "application/pdf", kind: "document", magic: [0x25, 0x50, 0x44, 0x46] },
  { ext: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", magic: [0x50, 0x4b, 0x03, 0x04] },
  { ext: ["xlsx"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document", magic: [0x50, 0x4b, 0x03, 0x04] },
  { ext: ["pptx"], mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document", magic: [0x50, 0x4b, 0x03, 0x04] },
  { ext: ["doc"], mime: "application/msword", kind: "document", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  { ext: ["xls"], mime: "application/vnd.ms-excel", kind: "document", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  { ext: ["ppt"], mime: "application/vnd.ms-powerpoint", kind: "document", magic: [0xd0, 0xcf, 0x11, 0xe0] },
];

/** For the file picker */
export const ACCEPT = TYPES.flatMap((t) => t.ext.map((e) => `.${e}`)).join(",");

/** "Exam timetable.pdf": no folders, control or odd characters, at most 100 characters. */
function cleanName(name: string, ext: string) {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${base || "attachment"}.${ext}`;
}

/** Checks the file and stores it encrypted. Returns the attachment id and what it is. */
export async function saveAttachment(tx: Prisma.TransactionClient, file: File, actorId: string): Promise<{ id: string; kind: Kind; fileName: string }> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const type = TYPES.find((t) => t.ext.includes(ext));
  if (!type) throw new UserError("Attach a picture (JPG, PNG) or a document (PDF, Word, Excel, PowerPoint).");
  const limit = type.kind === "image" ? MAX_IMAGE_MB : MAX_FILE_MB;
  if (file.size > limit * 1024 * 1024) throw new UserError(`That file is too big: ${(file.size / 1024 / 1024).toFixed(1)} MB. ${type.kind === "image" ? "Pictures" : "Documents"} can be up to ${limit} MB.`);
  const data = Buffer.from(await file.arrayBuffer());
  if (!type.magic.every((b, i) => data[i] === b)) throw new UserError(`“${file.name}” isn't really a .${ext} file. Save it again in that format and re-attach it.`);
  const id = randomUUID();
  const fileName = cleanName(file.name, ext);
  await tx.messageAttachment.create({
    data: { id, fileName, mimeType: type.mime, kind: type.kind, size: data.length, dataEnc: new Uint8Array(encryptBytes(data, `attachment:${id}`)), createdById: actorId },
  });
  return { id, kind: type.kind, fileName };
}
