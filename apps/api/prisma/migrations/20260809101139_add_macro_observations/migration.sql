-- CreateTable
CREATE TABLE "MacroSeries" (
    "seriesKey" TEXT NOT NULL PRIMARY KEY,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceApi" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "defaultTransform" TEXT NOT NULL,
    "revisionPolicy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MacroObservation" (
    "seriesKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "vintageDate" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "releaseDate" TEXT,
    "availableDate" TEXT NOT NULL,
    "availabilityKind" TEXT NOT NULL,
    "vintageKind" TEXT NOT NULL,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("seriesKey", "period", "vintageDate"),
    CONSTRAINT "MacroObservation_seriesKey_fkey" FOREIGN KEY ("seriesKey") REFERENCES "MacroSeries" ("seriesKey") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MacroReleaseSchedule" (
    "publishDate" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishMonth" TEXT NOT NULL,
    "issuingOrg" TEXT NOT NULL,
    "dataApi" TEXT,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("publishDate", "title")
);

-- CreateIndex
CREATE INDEX "MacroObservation_seriesKey_availableDate_idx" ON "MacroObservation"("seriesKey", "availableDate");

-- CreateIndex
CREATE INDEX "MacroObservation_period_idx" ON "MacroObservation"("period");

-- CreateIndex
CREATE INDEX "MacroReleaseSchedule_dataApi_publishDate_idx" ON "MacroReleaseSchedule"("dataApi", "publishDate");
