ALTER TABLE "EventOutbox" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "EventOutbox" ADD COLUMN "claimedBy" TEXT;
ALTER TABLE "EventOutbox" ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "EventOutbox_leaseUntil_idx" ON "EventOutbox"("leaseUntil");

