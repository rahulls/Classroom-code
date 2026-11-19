import "server-only";
import { PrismaClient } from "./generated/client";

// Exam Prep's own database (EXAM_PREP_DATABASE_URL). Never the classroom database.
const g = globalThis as unknown as { examPrepDb?: PrismaClient };

export const epdb = g.examPrepDb ?? new PrismaClient({ log: ["error"] });
if (process.env.NODE_ENV !== "production") g.examPrepDb = epdb;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
