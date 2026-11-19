-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_dedupeKey_key" ON "OutboundMessage"("dedupeKey");

