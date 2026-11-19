import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { requestMeta } from "./request";

type Tx = Prisma.TransactionClient;

export type AuditEntry = {
  action: string;
  actor?: { id: string; name: string } | null;
  entity?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

/**
 * Append-only audit trail. Callers must pass only non-sensitive values in before/after:
 * never passwords, tokens or decrypted PII (log *which* fields changed instead).
 */
export async function audit(entry: AuditEntry, tx: Tx = db) {
  const { ip, userAgent } = await requestMeta();
  await tx.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.name ?? null,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before,
      after: entry.after,
      ip,
      userAgent,
    },
  });
}
