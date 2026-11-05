/*
  Warnings:

  - A unique constraint covering the columns `[activeReplica]` on the table `IngestionRun` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "IngestionRun" ADD COLUMN "activeReplica" INTEGER;
ALTER TABLE "IngestionRun" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "IngestionRun" ADD COLUMN "publishedRevision" INTEGER;
ALTER TABLE "IngestionRun" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "IngestionRun" ADD COLUMN "replicaBaseline" TEXT;
ALTER TABLE "IngestionRun" ADD COLUMN "replicaOperation" TEXT;
ALTER TABLE "IngestionRun" ADD COLUMN "replicaPhase" TEXT;
ALTER TABLE "IngestionRun" ADD COLUMN "replicaReadyAt" DATETIME;

-- CreateTable
CREATE TABLE "IngestionReplicaChange" (
    "model" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    PRIMARY KEY ("model", "key")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestionRun_activeReplica_key" ON "IngestionRun"("activeReplica");
