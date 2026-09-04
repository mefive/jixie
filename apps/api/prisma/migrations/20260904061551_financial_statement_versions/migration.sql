-- CreateTable
CREATE TABLE "FinancialIncomeStatement" (
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
