import "server-only";
import zlib from "node:zlib";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { mondayOf, weekTime } from "../domain/programme";
import { getSettings } from "../settings";
import { draft, renderTemplate } from "./messaging";

// R11 privacy: right to delete, data-subject export, retention review. Nothing is deleted without the
// teacher's approval; deletions and approvals are audited (ids only, no personal data).

/** Every stored file path that belongs to a student. */
async function studentFiles(studentId: string) {
  const subs = await epdb.submission.findMany({ where: { studentId } });
  const reports = await epdb.reportCard.findMany({ where: { studentId } });
  const doubts = await epdb.doubt.findMany({ where: { studentId } });
  return [
    ...subs.flatMap((s) => (s.files as { path: string }[]).map((f) => f.path)),
    ...reports.map((r) => r.pdfPath).filter((p): p is string => !!p),
    ...doubts.map((d) => d.filePath).filter((p): p is string => !!p),
  ];
}

/**
 * Deletes a student's files, marks, reports, rank records and everything else, keeps a DeletionRequest
 * (with the student code only) and drafts the written confirmation to the parent.
 */
export async function deleteStudentData(studentId: string) {
  const st = await epdb.student.findUniqueOrThrow({ where: { id: studentId }, include: { parents: true, submissions: true } });
  const req = await epdb.deletionRequest.create({ data: { studentId, studentCode: st.code } });
  const files = await studentFiles(studentId);
  // Earlier versions of each sheet live in <folder>/history/<submissionId>.pdf
  for (const s of st.submissions) {
    const f = (s.files as { path: string }[])[0]?.path;
    if (f) files.push(`${f.slice(0, f.lastIndexOf("/"))}/history/${s.id}.pdf`);
  }
  for (const f of new Set(files)) await storage.remove(f);
  await storage.removeTree(`doubts/${st.code}`);
  const parent = st.parents.find((p) => !p.optedOutAt) ?? st.parents[0];
  const counts = {
    submissions: st.submissions.length,
    reports: await epdb.reportCard.count({ where: { studentId } }),
    ranks: await epdb.rankRecord.count({ where: { studentId } }),
    files: new Set(files).size,
  };
  // The confirmation is drafted before the parent row goes (the message keeps only the text and number)
  let confirmation = null;
  if (parent) {
    const body = await renderTemplate("deletion_confirmation", { student: st.name.split(" ")[0], ref: req.id.slice(-8), date: new Date().toLocaleDateString("en-IN") });
    confirmation = await draft({ dedupeKey: `deletion:${req.id}`, templateKey: "deletion_confirmation", audience: "parent", body, to: parent.whatsapp, allowOptedOut: true });
  }
  await epdb.$transaction([
    epdb.message.updateMany({ where: { studentId, status: "drafted" }, data: { status: "cancelled" } }),
    epdb.message.updateMany({ where: { studentId }, data: { studentId: null, parentId: null } }),
    epdb.aiRequestLog.deleteMany({ where: { submissionId: { in: st.submissions.map((s) => s.id) } } }),
    epdb.correctionNote.deleteMany({ where: { studentId } }),
    epdb.student.delete({ where: { id: studentId } }), // cascades: parents, submissions, marks, reports, ranks, feedback, plans, payments, offers, doubts
  ]);
  await epdb.deletionRequest.update({ where: { id: req.id }, data: { completedAt: new Date(), confirmationSentAt: null, summary: counts } });
  await audit({ action: "student.deleted", entity: "Student", entityId: studentId, new: { code: st.code, ...counts } });
  return { request: req.id, counts, confirmation };
}

// ------------------------------ export (ZIP) ------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A small ZIP writer (deflate), so the export needs no extra dependency. */
export function zip(entries: { name: string; data: Buffer }[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const comp = zlib.deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** One student's data (a data-subject copy): their record, marks, reports and files, as a ZIP. */
export async function exportStudent(studentId: string) {
  const st = await epdb.student.findUniqueOrThrow({
    where: { id: studentId },
    include: { parents: true, submissions: { include: { marks: true, mcq: true, rowMarks: true } }, reports: true, feedback: true, plans: true, payments: true, offers: true, doubts: true, attendances: true },
  });
  const { reports, submissions, ...rest } = st;
  const entries: { name: string; data: Buffer }[] = [
    { name: "student.json", data: Buffer.from(JSON.stringify(rest, null, 2)) },
    { name: "submissions.json", data: Buffer.from(JSON.stringify(submissions, null, 2)) },
    { name: "reports.json", data: Buffer.from(JSON.stringify(reports.map(({ data, ...r }) => ({ ...r, data })), null, 2)) },
  ];
  for (const s of submissions) for (const f of s.files as { path: string; name: string }[]) if (storage.exists(f.path)) entries.push({ name: `sheets/${f.name}`, data: await storage.read(f.path) });
  for (const r of reports) if (r.pdfPath && storage.exists(r.pdfPath)) entries.push({ name: `reports/${r.pdfPath.split("/").pop()}`, data: await storage.read(r.pdfPath) });
  await audit({ action: "student.exported", entity: "Student", entityId: studentId });
  return { fileName: `${st.code}-data.zip`, bytes: zip(entries) };
}

// ------------------------------ retention ------------------------------

/** After the programme year, proposes archiving or deleting (a task for the teacher; never deletes). */
export async function retentionReview(now = new Date()) {
  const s = await getSettings();
  const start = s["programme.startDate"];
  if (!start) return { due: false };
  const end = weekTime(mondayOf(start), s["programme.weeks"] + 1, "Mon 00:00");
  const due = new Date(end.getTime());
  due.setMonth(due.getMonth() + s["retention.months"]);
  if (now < due) return { due: false, dueAt: due.toISOString() };
  await epdb.task.upsert({
    where: { dedupeKey: `retention:${start}` },
    create: { dedupeKey: `retention:${start}`, kind: "retention", title: "Retention review: archive (identifiers removed) or delete last programme's sheets and marks", dueAt: due },
    update: {},
  });
  return { due: true };
}

/**
 * Approved by the teacher: deletes stored sheets and removes names, numbers and emails from the
 * programme's records, keeping only anonymous marks for statistics.
 */
export async function applyRetention(mode: "archive" | "delete") {
  const students = await epdb.student.findMany({ include: { submissions: true } });
  for (const st of students) {
    if (mode === "delete") {
      await deleteStudentData(st.id);
      continue;
    }
    for (const s of st.submissions) for (const f of s.files as { path: string }[]) await storage.remove(f.path);
    await epdb.parent.deleteMany({ where: { studentId: st.id } });
    await epdb.student.update({ where: { id: st.id }, data: { name: `Archived ${st.code}`, school: null, lastExamRange: null } });
    await epdb.submission.updateMany({ where: { studentId: st.id }, data: { files: [] } });
  }
  await epdb.message.updateMany({ where: { audience: { not: "group" } }, data: { body: "(archived)", waLink: null } });
  await audit({ action: `retention.${mode}`, entity: "Programme", entityId: "all", new: { students: students.length } });
  return students.length;
}
