-- Rolls back 20261120100000_internal_choice (Exam Prep database only).
ALTER TABLE "Question" DROP COLUMN IF EXISTS "orText";
ALTER TABLE "Question" DROP COLUMN IF EXISTS "orMarkingScheme";
ALTER TABLE "Question" DROP COLUMN IF EXISTS "orSolution";
