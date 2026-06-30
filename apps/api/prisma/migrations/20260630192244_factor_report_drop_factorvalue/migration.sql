-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "FactorValue";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "FactorReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payload" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL
);
