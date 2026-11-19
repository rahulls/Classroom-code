-- Rolls back 20261120000000_paper_files (Exam Prep database only).
DROP TABLE IF EXISTS "PaperFile" CASCADE;
ALTER TABLE "Paper" DROP COLUMN IF EXISTS "uploadOnly";
ALTER TABLE "Paper" DROP COLUMN IF EXISTS "totalMarks";
