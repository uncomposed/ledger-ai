-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('human', 'ai', 'system');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('admin', 'contributor', 'accountable');

-- AlterTable
ALTER TABLE "ChangeSet" ALTER COLUMN "patch" DROP DEFAULT,
ALTER COLUMN "proposedByActorId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EventLog" ALTER COLUMN "correlationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EventOutbox" ALTER COLUMN "correlationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "createdByActorId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "type" "ActorType" NOT NULL DEFAULT 'human',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "parentEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entity_parentEntityId_idx" ON "Entity"("parentEntityId");

-- CreateIndex
CREATE INDEX "Membership_actorId_idx" ON "Membership"("actorId");

-- CreateIndex
CREATE INDEX "Membership_entityId_role_idx" ON "Membership"("entityId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_entityId_actorId_key" ON "Membership"("entityId", "actorId");

-- AddForeignKey
ALTER TABLE "EventOutbox" ADD CONSTRAINT "EventOutbox_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_parentEntityId_fkey" FOREIGN KEY ("parentEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByActorId_fkey" FOREIGN KEY ("createdByActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_updatedByActorId_fkey" FOREIGN KEY ("updatedByActorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_proposedByActorId_fkey" FOREIGN KEY ("proposedByActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_approvedByActorId_fkey" FOREIGN KEY ("approvedByActorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
