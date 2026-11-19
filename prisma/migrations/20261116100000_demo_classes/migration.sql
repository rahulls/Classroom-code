-- CreateTable
CREATE TABLE "DemoClass" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "subject" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startMin" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "room" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'offline',
    "meetingUrl" TEXT,
    "notes" TEXT,
    "personName" TEXT NOT NULL,
    "contactId" UUID,
    "remind" BOOLEAN NOT NULL DEFAULT true,
    "cancelledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoClass_date_idx" ON "DemoClass"("date");

-- AddForeignKey
ALTER TABLE "DemoClass" ADD CONSTRAINT "DemoClass_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
