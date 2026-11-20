-- Rolls back 20261121000000_answer_rows (Exam Prep database only).
DROP TABLE IF EXISTS "RowMark";
ALTER TABLE "Paper" DROP COLUMN IF EXISTS "answerRows";
DROP TABLE IF EXISTS "MarkingFormat";
