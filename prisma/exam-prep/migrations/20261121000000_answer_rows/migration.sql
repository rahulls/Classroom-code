-- Marking formats (fixed answer rows per class/board/subject) and row-wise marks for uploaded papers.
CREATE TABLE "MarkingFormat" (
    "id" TEXT NOT NULL,
    "klass" INTEGER NOT NULL,
    "board" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarkingFormat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarkingFormat_klass_board_subject_key" ON "MarkingFormat"("klass", "board", "subject");

ALTER TABLE "Paper" ADD COLUMN "answerRows" JSONB;

CREATE TABLE "RowMark" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "errorTag" TEXT NOT NULL DEFAULT 'none',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RowMark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RowMark_submissionId_label_key" ON "RowMark"("submissionId", "label");
ALTER TABLE "RowMark" ADD CONSTRAINT "RowMark_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
