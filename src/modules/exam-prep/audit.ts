import "server-only";
import { epdb, type Tx } from "./db";

// Append-only audit log (a database trigger refuses updates and deletes). Values written here must
// never carry a name, phone number or file contents: callers pass ids and the changed fields only.

const PERSONAL = /^(name|whatsapp|phone|email|school|text|body|files|filePath|pdfPath|note|reference)$/i;

/** Drops personal fields from an audited value. */
export function scrub(v: unknown): unknown {
  if (v == null || typeof v !== "object") return v ?? null;
  if (Array.isArray(v)) return v.map(scrub);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !PERSONAL.test(k)).map(([k, x]) => [k, scrub(x)]));
}

export async function audit(e: { action: string; entity: string; entityId: string; old?: unknown; new?: unknown; actor?: string }, tx: Tx = epdb) {
  await tx.auditLog.create({
    data: { actor: e.actor ?? "teacher", action: e.action, entity: e.entity, entityId: e.entityId, old: (scrub(e.old) ?? undefined) as never, new: (scrub(e.new) ?? undefined) as never },
  });
}
