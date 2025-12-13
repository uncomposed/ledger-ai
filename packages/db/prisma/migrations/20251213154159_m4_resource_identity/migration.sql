-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalKey" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resource_entityId_kind_idx" ON "Resource"("entityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_entityId_kind_externalKey_key" ON "Resource"("entityId", "kind", "externalKey");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
