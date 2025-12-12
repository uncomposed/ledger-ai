-- Add outboxId to support idempotent outbox publishing
ALTER TABLE "EventLog" ADD COLUMN "outboxId" TEXT NOT NULL;

-- Unique constraint ensures retries do not duplicate events
CREATE UNIQUE INDEX "EventLog_outboxId_key" ON "EventLog"("outboxId");

