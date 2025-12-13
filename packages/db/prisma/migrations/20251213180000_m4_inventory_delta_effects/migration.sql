-- CreateTable
CREATE TABLE "InventoryMutation" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changeSetId" TEXT NOT NULL,
    "opIndex" INTEGER NOT NULL,
    "resourceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "delta" DECIMAL(18,6) NOT NULL,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMutation_pkey" PRIMARY KEY ("id")
);

-- Tighten TaskSubject uniqueness to include subjectId so tasks can be tagged with multiple resources.
DROP INDEX IF EXISTS "TaskSubject_taskId_subjectType_key";
CREATE UNIQUE INDEX "TaskSubject_taskId_subjectType_subjectId_key" ON "TaskSubject"("taskId", "subjectType", "subjectId");
CREATE INDEX "TaskSubject_taskId_subjectType_idx" ON "TaskSubject"("taskId", "subjectType");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMutation_changeSetId_opIndex_key" ON "InventoryMutation"("changeSetId", "opIndex");
CREATE INDEX "InventoryMutation_entityId_createdAt_idx" ON "InventoryMutation"("entityId", "createdAt");
CREATE INDEX "InventoryMutation_entityId_resourceId_idx" ON "InventoryMutation"("entityId", "resourceId");
CREATE INDEX "InventoryMutation_inventoryItemId_idx" ON "InventoryMutation"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "InventoryMutation" ADD CONSTRAINT "InventoryMutation_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMutation" ADD CONSTRAINT "InventoryMutation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMutation" ADD CONSTRAINT "InventoryMutation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMutation" ADD CONSTRAINT "InventoryMutation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

