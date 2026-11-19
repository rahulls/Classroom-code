-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "params" JSONB,
ADD COLUMN     "providerRef" TEXT;
