-- CreateEnum
CREATE TYPE "TrackKind" AS ENUM ('text', 'image');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('ingested', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "LensRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('open', 'answered', 'cancelled');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "TrackKind" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "text" TEXT,
    "status" "TrackStatus" NOT NULL DEFAULT 'ingested',
    "createdByActorId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackAttachment" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LensRun" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lensKey" TEXT NOT NULL,
    "status" "LensRunStatus" NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LensRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "trackId" TEXT,
    "taskId" TEXT,
    "status" "QuestionStatus" NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answeredByActorId" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Track_entityId_createdAt_idx" ON "Track"("entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Track_entityId_status_idx" ON "Track"("entityId", "status");

-- CreateIndex
CREATE INDEX "Track_correlationId_idx" ON "Track"("correlationId");

-- CreateIndex
CREATE INDEX "TrackAttachment_trackId_idx" ON "TrackAttachment"("trackId");

-- CreateIndex
CREATE INDEX "LensRun_entityId_status_idx" ON "LensRun"("entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LensRun_trackId_lensKey_key" ON "LensRun"("trackId", "lensKey");

-- CreateIndex
CREATE INDEX "Question_entityId_status_idx" ON "Question"("entityId", "status");

-- CreateIndex
CREATE INDEX "Question_trackId_idx" ON "Question"("trackId");

-- CreateIndex
CREATE INDEX "Question_taskId_idx" ON "Question"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_questionId_key" ON "Answer"("questionId");

-- CreateIndex
CREATE INDEX "Answer_entityId_createdAt_idx" ON "Answer"("entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_createdByActorId_fkey" FOREIGN KEY ("createdByActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackAttachment" ADD CONSTRAINT "TrackAttachment_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensRun" ADD CONSTRAINT "LensRun_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LensRun" ADD CONSTRAINT "LensRun_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_answeredByActorId_fkey" FOREIGN KEY ("answeredByActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
