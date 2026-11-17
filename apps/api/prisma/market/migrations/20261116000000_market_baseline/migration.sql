-- CreateTable
CREATE TABLE "StockBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "market" TEXT,
    "exchange" TEXT,
    "listDate" TEXT,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StockCodeChange" (
    "oldTsCode" TEXT NOT NULL PRIMARY KEY,
    "newTsCode" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StockNameHistory" (
    "sourceTsCode" TEXT,
    "tsCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "announcementDate" TEXT,
    "changeReason" TEXT,

    PRIMARY KEY ("tsCode", "startDate")
);

-- CreateTable
CREATE TABLE "TradeCal" (
    "exchange" TEXT NOT NULL,
    "calDate" TEXT NOT NULL,
    "isOpen" INTEGER NOT NULL,
    "pretradeDate" TEXT,

    PRIMARY KEY ("exchange", "calDate")
);

-- CreateTable
CREATE TABLE "Daily" (
    "sourceTsCode" TEXT,
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL,
    "preClose" REAL,
    "pctChg" REAL,
    "vol" REAL,
    "amount" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "AdjFactor" (
    "sourceTsCode" TEXT,
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "adjFactor" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "EtfBasic" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "indexCode" TEXT,
    "indexName" TEXT,
    "setupDate" TEXT,
    "listDate" TEXT,
    "delistDate" TEXT,
    "listStatus" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "managerName" TEXT,
    "custodianName" TEXT,
    "managementFee" REAL,
    "fundType" TEXT,
    "etfType" TEXT,
    "sameDayTurnover" BOOLEAN NOT NULL,
    "lotSize" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "EtfDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL,
    "preClose" REAL,
    "pctChg" REAL,
    "vol" REAL,
    "amount" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "EtfAdjFactor" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "adjFactor" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "StkLimit" (
    "sourceTsCode" TEXT,
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "upLimit" REAL NOT NULL,
    "downLimit" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "DailyBasic" (
    "sourceTsCode" TEXT,
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "pe" REAL,
    "peTtm" REAL,
    "pb" REAL,
    "ps" REAL,
    "psTtm" REAL,
    "dvRatio" REAL,
    "dvTtm" REAL,
    "totalMv" REAL,
    "circMv" REAL,
    "turnoverRate" REAL,
    "turnoverRateF" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "FinaIndicator" (
    "tsCode" TEXT NOT NULL,
    "sourceTsCode" TEXT,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "roe" REAL,
    "roeWaa" REAL,
    "roa" REAL,
    "grossprofitMargin" REAL,
    "netprofitMargin" REAL,
    "debtToAssets" REAL,
    "orYoy" REAL,
    "netprofitYoy" REAL,
    "ocfToProfit" REAL,

    PRIMARY KEY ("tsCode", "endDate")
);

-- CreateTable
CREATE TABLE "FinancialIncomeStatement" (
    "sourceTsCode" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "tsCode" TEXT NOT NULL,
    "annDate" TEXT,
    "fAnnDate" TEXT,
    "endDate" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "compType" TEXT NOT NULL,
    "updateFlag" TEXT,
    "observedAt" DATETIME NOT NULL,
    "sourceRowFingerprint" TEXT NOT NULL,
    "announcementDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "availabilityQuality" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "evidenceId" TEXT,
    "totalRevenue" REAL,
    "revenue" REAL,
    "operCost" REAL,
    "operateProfit" REAL,
    "totalProfit" REAL,
    "incomeTax" REAL,
    "nIncome" REAL,
    "nIncomeAttrP" REAL,
    "ebit" REAL,
    "rdExp" REAL,
    "finExpIntExp" REAL
);

-- CreateTable
CREATE TABLE "FinancialBalanceSheet" (
    "sourceTsCode" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "tsCode" TEXT NOT NULL,
    "annDate" TEXT,
    "fAnnDate" TEXT,
    "endDate" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "compType" TEXT NOT NULL,
    "updateFlag" TEXT,
    "observedAt" DATETIME NOT NULL,
    "sourceRowFingerprint" TEXT NOT NULL,
    "announcementDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "availabilityQuality" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "evidenceId" TEXT,
    "moneyCap" REAL,
    "tradAsset" REAL,
    "notesReceiv" REAL,
    "accountsReceiv" REAL,
    "accountsReceivBill" REAL,
    "othReceiv" REAL,
    "othRcvTotal" REAL,
    "inventories" REAL,
    "prepayment" REAL,
    "contractAssets" REAL,
    "othCurAssets" REAL,
    "totalCurAssets" REAL,
    "fixAssets" REAL,
    "fixAssetsTotal" REAL,
    "cip" REAL,
    "cipTotal" REAL,
    "intanAssets" REAL,
    "goodwill" REAL,
    "deferTaxAssets" REAL,
    "othNca" REAL,
    "totalNca" REAL,
    "totalAssets" REAL,
    "notesPayable" REAL,
    "acctPayable" REAL,
    "accountsPay" REAL,
    "advReceipts" REAL,
    "contractLiab" REAL,
    "payrollPayable" REAL,
    "taxesPayable" REAL,
    "othPayable" REAL,
    "othPayTotal" REAL,
    "stBorr" REAL,
    "nonCurLiabDue1y" REAL,
    "ltBorr" REAL,
    "bondPayable" REAL,
    "othCurLiab" REAL,
    "totalCurLiab" REAL,
    "othNcl" REAL,
    "totalNcl" REAL,
    "totalLiab" REAL,
    "minorityInt" REAL,
    "totalHldrEqyExcMinInt" REAL,
    "totalShare" REAL
);

-- CreateTable
CREATE TABLE "FinancialCashFlowStatement" (
    "sourceTsCode" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "tsCode" TEXT NOT NULL,
    "annDate" TEXT,
    "fAnnDate" TEXT,
    "endDate" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "compType" TEXT NOT NULL,
    "updateFlag" TEXT,
    "observedAt" DATETIME NOT NULL,
    "sourceRowFingerprint" TEXT NOT NULL,
    "announcementDate" TEXT NOT NULL,
    "availableDate" TEXT NOT NULL,
    "availabilityQuality" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "evidenceId" TEXT,
    "nCashflowAct" REAL,
    "cPayAcqConstFiolta" REAL,
    "nCashflowInvAct" REAL,
    "nCashFlowsFncAct" REAL,
    "cPayDistDpcpIntExp" REAL,
    "nIncrCashCashEqu" REAL,
    "cCashEquBegPeriod" REAL,
    "cCashEquEndPeriod" REAL,
    "netProfit" REAL,
    "deprFaCogaDpba" REAL,
    "amortIntangAssets" REAL,
    "freeCashflow" REAL
);

-- CreateTable
CREATE TABLE "FinancialCorrectionEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "tsCode" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "publishedDate" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "affectedPeriods" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Dividend" (
    "sourceTsCode" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "tsCode" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "exDate" TEXT,
    "divProc" TEXT,
    "cashDiv" REAL,
    "cashDivTax" REAL,
    "baseDate" TEXT,
    "baseShare" REAL,
    "observedAt" DATETIME,
    "availabilityQuality" TEXT NOT NULL DEFAULT 'unknown',
    "distributionKind" TEXT,
    "stockDividend" REAL,
    "stockBonusRate" REAL,
    "stockCapitalizationRate" REAL,
    "recordDate" TEXT,
    "payDate" TEXT,
    "implementationAnnouncementDate" TEXT,
    "shareListingDate" TEXT
);

-- CreateTable
CREATE TABLE "IndexWeight" (
    "sourceTsCode" TEXT,
    "indexCode" TEXT NOT NULL,
    "conCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "weight" REAL,

    PRIMARY KEY ("indexCode", "conCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "IndexDaily" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "close" REAL NOT NULL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "IndexDailyBasic" (
    "tsCode" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "totalMv" REAL,
    "floatMv" REAL,
    "totalShare" REAL,
    "floatShare" REAL,
    "freeShare" REAL,
    "turnoverRate" REAL,
    "turnoverRateF" REAL,
    "pe" REAL,
    "peTtm" REAL,
    "pb" REAL,

    PRIMARY KEY ("tsCode", "tradeDate")
);

-- CreateTable
CREATE TABLE "IndexBenchmark" (
    "tsCode" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "bmkLevel" TEXT,
    "bmkType" TEXT,
    "bmkSource" TEXT,
    "indexType" TEXT
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "targetDate" TEXT NOT NULL,
    "scopeSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "IngestionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "api" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "rangeStart" TEXT,
    "rangeEnd" TEXT,
    "sourceStart" TEXT,
    "status" TEXT NOT NULL,
    "responseComplete" BOOLEAN NOT NULL DEFAULT false,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "filteredCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "IngestionBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "batchId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "reasonCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "businessKey" JSONB,
    "field" TEXT,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestionIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IngestionIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IngestionBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionIssueResolution" (
    "issueId" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "evidence" JSONB,
    "before" JSONB,
    "after" JSONB,
    "marketRevision" INTEGER,
    "history" JSONB NOT NULL DEFAULT [],
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IngestionIssueResolution_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IngestionIssue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionSelection" (
    "assetType" TEXT NOT NULL PRIMARY KEY,
    "codes" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketDataState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FinaIndicatorVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tsCode" TEXT NOT NULL,
    "sourceTsCode" TEXT,
    "updateFlag" TEXT,
    "endDate" TEXT NOT NULL,
    "annDate" TEXT,
    "availableDate" TEXT NOT NULL,
    "availabilityQuality" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "roe" REAL,
    "roeWaa" REAL,
    "roa" REAL,
    "grossprofitMargin" REAL,
    "netprofitMargin" REAL,
    "debtToAssets" REAL,
    "orYoy" REAL,
    "netprofitYoy" REAL,
    "ocfToProfit" REAL
);

-- CreateIndex
CREATE INDEX "StockCodeChange_newTsCode_idx" ON "StockCodeChange"("newTsCode");

-- CreateIndex
CREATE INDEX "StockNameHistory_tsCode_endDate_idx" ON "StockNameHistory"("tsCode", "endDate");

-- CreateIndex
CREATE INDEX "StockNameHistory_announcementDate_idx" ON "StockNameHistory"("announcementDate");

-- CreateIndex
CREATE INDEX "Daily_tradeDate_idx" ON "Daily"("tradeDate");

-- CreateIndex
CREATE INDEX "AdjFactor_tradeDate_idx" ON "AdjFactor"("tradeDate");

-- CreateIndex
CREATE INDEX "EtfDaily_tradeDate_idx" ON "EtfDaily"("tradeDate");

-- CreateIndex
CREATE INDEX "EtfAdjFactor_tradeDate_idx" ON "EtfAdjFactor"("tradeDate");

-- CreateIndex
CREATE INDEX "StkLimit_tradeDate_idx" ON "StkLimit"("tradeDate");

-- CreateIndex
CREATE INDEX "DailyBasic_tradeDate_idx" ON "DailyBasic"("tradeDate");

-- CreateIndex
CREATE INDEX "FinaIndicator_annDate_idx" ON "FinaIndicator"("annDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialIncomeStatement_sourceRowFingerprint_key" ON "FinancialIncomeStatement"("sourceRowFingerprint");

-- CreateIndex
CREATE INDEX "FinancialIncomeStatement_tsCode_endDate_availableDate_idx" ON "FinancialIncomeStatement"("tsCode", "endDate", "availableDate");

-- CreateIndex
CREATE INDEX "FinancialIncomeStatement_endDate_reportType_compType_idx" ON "FinancialIncomeStatement"("endDate", "reportType", "compType");

-- CreateIndex
CREATE INDEX "FinancialIncomeStatement_availableDate_idx" ON "FinancialIncomeStatement"("availableDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialBalanceSheet_sourceRowFingerprint_key" ON "FinancialBalanceSheet"("sourceRowFingerprint");

-- CreateIndex
CREATE INDEX "FinancialBalanceSheet_tsCode_endDate_availableDate_idx" ON "FinancialBalanceSheet"("tsCode", "endDate", "availableDate");

-- CreateIndex
CREATE INDEX "FinancialBalanceSheet_endDate_reportType_compType_idx" ON "FinancialBalanceSheet"("endDate", "reportType", "compType");

-- CreateIndex
CREATE INDEX "FinancialBalanceSheet_availableDate_idx" ON "FinancialBalanceSheet"("availableDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCashFlowStatement_sourceRowFingerprint_key" ON "FinancialCashFlowStatement"("sourceRowFingerprint");

-- CreateIndex
CREATE INDEX "FinancialCashFlowStatement_tsCode_endDate_availableDate_idx" ON "FinancialCashFlowStatement"("tsCode", "endDate", "availableDate");

-- CreateIndex
CREATE INDEX "FinancialCashFlowStatement_endDate_reportType_compType_idx" ON "FinancialCashFlowStatement"("endDate", "reportType", "compType");

-- CreateIndex
CREATE INDEX "FinancialCashFlowStatement_availableDate_idx" ON "FinancialCashFlowStatement"("availableDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCorrectionEvidence_sourceFingerprint_key" ON "FinancialCorrectionEvidence"("sourceFingerprint");

-- CreateIndex
CREATE INDEX "FinancialCorrectionEvidence_tsCode_publishedDate_idx" ON "FinancialCorrectionEvidence"("tsCode", "publishedDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCorrectionEvidence_source_sourceId_key" ON "FinancialCorrectionEvidence"("source", "sourceId");

-- CreateIndex
CREATE INDEX "Dividend_tsCode_idx" ON "Dividend"("tsCode");

-- CreateIndex
CREATE INDEX "IndexWeight_indexCode_tradeDate_idx" ON "IndexWeight"("indexCode", "tradeDate");

-- CreateIndex
CREATE INDEX "IndexDailyBasic_tradeDate_idx" ON "IndexDailyBasic"("tradeDate");

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE INDEX "IngestionBatch_runId_dataset_scope_period_startedAt_idx" ON "IngestionBatch"("runId", "dataset", "scope", "period", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionBatch_dataset_scope_period_startedAt_idx" ON "IngestionBatch"("dataset", "scope", "period", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionBatch_status_idx" ON "IngestionBatch"("status");

-- CreateIndex
CREATE INDEX "IngestionIssue_runId_createdAt_idx" ON "IngestionIssue"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "IngestionIssue_batchId_idx" ON "IngestionIssue"("batchId");

-- CreateIndex
CREATE INDEX "IngestionIssueResolution_status_updatedAt_idx" ON "IngestionIssueResolution"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinaIndicatorVersion_sourceFingerprint_key" ON "FinaIndicatorVersion"("sourceFingerprint");

-- CreateIndex
CREATE INDEX "FinaIndicatorVersion_tsCode_availableDate_idx" ON "FinaIndicatorVersion"("tsCode", "availableDate");
