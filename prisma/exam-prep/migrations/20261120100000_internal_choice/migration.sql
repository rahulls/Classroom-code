-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "orMarkingScheme" JSONB,
ADD COLUMN     "orSolution" TEXT,
ADD COLUMN     "orText" TEXT;

