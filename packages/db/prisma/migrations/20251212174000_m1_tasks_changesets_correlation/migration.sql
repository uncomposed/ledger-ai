-- Correlation envelope for outbox + log
ALTER TABLE "EventOutbox" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX "EventOutbox_correlationId_idx" ON "EventOutbox"("correlationId");

ALTER TABLE "EventLog" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX "EventLog_correlationId_idx" ON "EventLog"("correlationId");

-- Task state machine + optimistic concurrency
DO $$ BEGIN
  CREATE TYPE "TaskState" AS ENUM ('proposed', 'ready', 'in_progress', 'completed', 'blocked', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

UPDATE "Task" SET "state" = 'proposed' WHERE "state" = 'open';

ALTER TABLE "Task" ALTER COLUMN "state" TYPE "TaskState" USING "state"::text::"TaskState";
ALTER TABLE "Task" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "createdByActorId" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "Task" ADD COLUMN "updatedByActorId" TEXT;
ALTER TABLE "Task" ADD COLUMN "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ChangeSet lifecycle + relationship to Task
DO $$ BEGIN
  CREATE TYPE "ChangeSetState" AS ENUM ('draft', 'pending_approval', 'applied', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

UPDATE "ChangeSet" SET "state" = 'pending_approval' WHERE "state" = 'proposed';

ALTER TABLE "ChangeSet" ADD COLUMN "taskId" TEXT;
ALTER TABLE "ChangeSet" ALTER COLUMN "state" TYPE "ChangeSetState" USING "state"::text::"ChangeSetState";
ALTER TABLE "ChangeSet" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChangeSet" ADD COLUMN "patch" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "ChangeSet" ADD COLUMN "proposedByActorId" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "ChangeSet" ADD COLUMN "approvedByActorId" TEXT;
ALTER TABLE "ChangeSet" ADD COLUMN "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ChangeSet" ADD COLUMN "appliedAt" TIMESTAMP(3);

-- Backfill taskId for existing rows (best effort); if none exist, link to newest task in entity
UPDATE "ChangeSet" cs
SET "taskId" = t.id
FROM (
  SELECT DISTINCT ON ("entityId") id, "entityId"
  FROM "Task"
  ORDER BY "entityId", "createdAt" DESC
) t
WHERE cs."taskId" IS NULL AND cs."entityId" = t."entityId";

ALTER TABLE "ChangeSet" ALTER COLUMN "taskId" SET NOT NULL;
ALTER TABLE "ChangeSet"
  ADD CONSTRAINT "ChangeSet_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ChangeSet_taskId_state_idx" ON "ChangeSet"("taskId", "state");
