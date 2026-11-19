import "server-only";
import type { Prisma } from "@prisma/client";

// Transactional outbox. Always call inside the same transaction as the change,
// so an event exists if and only if the change committed. The worker (Phase 1:
// communication) drains this table and runs automation rules.

export type DomainEventKey =
  | "student.enrolled"
  | "student.created"
  | "student.status_changed"
  | "enrollment.ended"
  | "timetable.changed";

export async function emit(tx: Prisma.TransactionClient, key: DomainEventKey, payload: Prisma.InputJsonValue) {
  await tx.domainEvent.create({ data: { key, payload } });
}
