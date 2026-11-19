-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "batchSubjectId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "room" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'offline',
    "meetingUrl" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableSlot_batchId_weekday_idx" ON "TimetableSlot"("batchId", "weekday");

-- CreateIndex
CREATE INDEX "TimetableSlot_weekday_room_idx" ON "TimetableSlot"("weekday", "room");

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_batchSubjectId_fkey" FOREIGN KEY ("batchSubjectId") REFERENCES "BatchSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
