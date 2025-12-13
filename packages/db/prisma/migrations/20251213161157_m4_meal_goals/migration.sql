-- CreateEnum
CREATE TYPE "MealGoalStatus" AS ENUM ('open', 'planned', 'cancelled');

-- CreateTable
CREATE TABLE "MealGoal" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "MealGoalStatus" NOT NULL DEFAULT 'open',
    "text" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdByActorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealGoal_entityId_status_idx" ON "MealGoal"("entityId", "status");

-- CreateIndex
CREATE INDEX "MealGoal_entityId_createdAt_idx" ON "MealGoal"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "MealGoal" ADD CONSTRAINT "MealGoal_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealGoal" ADD CONSTRAINT "MealGoal_createdByActorId_fkey" FOREIGN KEY ("createdByActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
