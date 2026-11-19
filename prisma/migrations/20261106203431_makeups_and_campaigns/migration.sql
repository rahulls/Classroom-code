-- AlterTable
ALTER TABLE "ClassDateChange" ADD COLUMN     "makeupForId" UUID,
ADD COLUMN     "makeupRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "campaignId" UUID,
ADD COLUMN     "notBefore" TIMESTAMP(3),
ADD COLUMN     "templateName" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "purpose" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "scheduledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt");

-- CreateIndex
CREATE INDEX "ClassDateChange_makeupForId_idx" ON "ClassDateChange"("makeupForId");

-- CreateIndex
CREATE INDEX "OutboundMessage_campaignId_idx" ON "OutboundMessage"("campaignId");

-- AddForeignKey
ALTER TABLE "ClassDateChange" ADD CONSTRAINT "ClassDateChange_makeupForId_fkey" FOREIGN KEY ("makeupForId") REFERENCES "ClassDateChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
