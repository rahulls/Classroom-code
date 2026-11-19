import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Exam Prep tests only (unit, fixtures, integration against rsc_exam_prep_test, privacy).
// Integration tests use EXAM_PREP_TEST_DATABASE_URL and a scratch storage folder; they never touch the
// classroom database or the real Exam Prep database.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

export default defineConfig({
  root,
  resolve: {
    alias: { "@": path.join(root, "src"), "server-only": path.join(here, "tests/server-only-stub.ts") },
  },
  test: {
    include: ["src/modules/exam-prep/tests/**/*.test.ts"],
    setupFiles: [path.join(here, "tests/setup.ts")],
    fileParallelism: false, // integration tests share one test database
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
