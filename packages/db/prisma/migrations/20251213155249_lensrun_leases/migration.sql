-- AlterTable
ALTER TABLE "LensRun" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LensRun_leaseUntil_idx" ON "LensRun"("leaseUntil");
