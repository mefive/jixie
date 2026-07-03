-- CreateTable
CREATE TABLE "Factor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Factor_userId_name_key" ON "Factor"("userId", "name");
CREATE INDEX "Factor_userId_updatedAt_idx" ON "Factor"("userId", "updatedAt");
