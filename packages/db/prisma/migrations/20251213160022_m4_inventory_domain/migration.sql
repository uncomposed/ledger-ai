-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('pantry', 'fridge', 'freezer', 'counter');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "locationId" TEXT,
    "quantity" DECIMAL(18,6),
    "unit" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_entityId_kind_idx" ON "Location"("entityId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Location_entityId_kind_name_key" ON "Location"("entityId", "kind", "name");

-- CreateIndex
CREATE INDEX "InventoryItem_entityId_locationId_idx" ON "InventoryItem"("entityId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryItem_entityId_resourceId_idx" ON "InventoryItem"("entityId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_entityId_resourceId_locationId_key" ON "InventoryItem"("entityId", "resourceId", "locationId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
