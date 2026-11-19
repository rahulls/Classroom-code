-- AlterTable
ALTER TABLE "Paper" ADD COLUMN     "totalMarks" DOUBLE PRECISION,
ADD COLUMN     "uploadOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaperFile" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperFile_paperId_kind_idx" ON "PaperFile"("paperId", "kind");

-- AddForeignKey
ALTER TABLE "PaperFile" ADD CONSTRAINT "PaperFile_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

