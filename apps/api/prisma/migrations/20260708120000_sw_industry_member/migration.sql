-- Shenwan (SW2021) level-1 industry membership, point-in-time (factor-to-strategy.md 3.4 neutralization).
-- One row per (stock, industry, spell): member of l1Name from inDate up to (excluding) outDate (null = current).
CREATE TABLE "SwIndustryMember" (
    "tsCode" TEXT NOT NULL,
    "l1Code" TEXT NOT NULL,
    "l1Name" TEXT NOT NULL,
    "inDate" TEXT NOT NULL,
    "outDate" TEXT,
    CONSTRAINT "SwIndustryMember_pkey" PRIMARY KEY ("tsCode", "l1Code", "inDate")
);
CREATE INDEX "SwIndustryMember_tsCode_idx" ON "SwIndustryMember"("tsCode");
