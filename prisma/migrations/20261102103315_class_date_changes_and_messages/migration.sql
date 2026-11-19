-- CreateTable
CREATE TABLE "ClassDateChange" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "kind" TEXT NOT NULL,
    "batchSubjectId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "slotId" UUID,
    "slotDate" DATE,
    "date" DATE,
    "startMin" INTEGER,
    "durationMin" INTEGER,
    "room" TEXT,
    "mode" TEXT,
    "meetingUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassDateChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "channel" TEXT NOT NULL,
    "contactId" UUID,
    "toName" TEXT NOT NULL,
    "toHint" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "batchId" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassDateChange_date_idx" ON "ClassDateChange"("date");

-- CreateIndex
CREATE INDEX "ClassDateChange_slotDate_idx" ON "ClassDateChange"("slotDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClassDateChange_slotId_slotDate_key" ON "ClassDateChange"("slotId", "slotDate");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_createdAt_idx" ON "OutboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_createdAt_idx" ON "OutboundMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "ClassDateChange" ADD CONSTRAINT "ClassDateChange_batchSubjectId_fkey" FOREIGN KEY ("batchSubjectId") REFERENCES "BatchSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassDateChange" ADD CONSTRAINT "ClassDateChange_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProgramNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassDateChange" ADD CONSTRAINT "ClassDateChange_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
