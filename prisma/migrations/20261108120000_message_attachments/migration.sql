-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "attachmentId" UUID;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "attachmentId" UUID;

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL DEFAULT 'rsc',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "dataEnc" BYTEA NOT NULL,
    "waMediaId" TEXT,
    "waMediaAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "MessageAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "MessageAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

