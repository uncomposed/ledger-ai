/*
  Warnings:

  - You are about to drop the column `mealGoalId` on the `Task` table. All the data in the column will be lost.
  - Changed the type of `kind` on the `Location` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `externalKey` on table `Resource` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "TaskSubject" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskSubject_entityId_subjectType_subjectId_idx" ON "TaskSubject"("entityId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSubject_taskId_subjectType_key" ON "TaskSubject"("taskId", "subjectType");

-- AddForeignKey
ALTER TABLE "TaskSubject" ADD CONSTRAINT "TaskSubject_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSubject" ADD CONSTRAINT "TaskSubject_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve Location.kind data by casting enum -> text.
DROP INDEX IF EXISTS "Location_entityId_kind_idx";
DROP INDEX IF EXISTS "Location_entityId_kind_name_key";
ALTER TABLE "Location" ALTER COLUMN "kind" TYPE TEXT USING ("kind"::text);
UPDATE "Location" SET "kind" = 'kitchen.pantry' WHERE "kind" = 'pantry';
UPDATE "Location" SET "kind" = 'kitchen.fridge' WHERE "kind" = 'fridge';
UPDATE "Location" SET "kind" = 'kitchen.freezer' WHERE "kind" = 'freezer';
UPDATE "Location" SET "kind" = 'kitchen.counter' WHERE "kind" = 'counter';
CREATE INDEX "Location_entityId_kind_idx" ON "Location"("entityId", "kind");
CREATE UNIQUE INDEX "Location_entityId_kind_name_key" ON "Location"("entityId", "kind", "name");

-- Backfill Resource.externalKey before enforcing NOT NULL.
UPDATE "Resource" SET "externalKey" = "id" WHERE "externalKey" IS NULL;
ALTER TABLE "Resource" ALTER COLUMN "externalKey" SET NOT NULL;

-- Backfill task->meal goal linkage into TaskSubject before dropping the FK/column.
INSERT INTO "TaskSubject" ("id", "entityId", "taskId", "subjectType", "subjectId")
SELECT
  ("id" || ':meal.goal') as "id",
  "entityId",
  "id" as "taskId",
  'meal.goal' as "subjectType",
  "mealGoalId" as "subjectId"
FROM "Task"
WHERE "mealGoalId" IS NOT NULL
ON CONFLICT ("taskId", "subjectType") DO UPDATE SET "subjectId" = EXCLUDED."subjectId";

-- Drop meal-goal coupling from Task.
ALTER TABLE "Task" DROP CONSTRAINT "Task_mealGoalId_fkey";
DROP INDEX "Task_entityId_mealGoalId_idx";
ALTER TABLE "Task" DROP COLUMN "mealGoalId";

-- DropEnum
DROP TYPE "LocationKind";
