// 历史迁移夹具读取当时存在的列；这些版本还没有市场版本引用。
// Read the columns that existed in historical fixtures before market versions were introduced.
export const historicalOmit = {
  job: { marketVersionId: true },
  factorReport: { marketVersionId: true },
  researchExecution: { marketVersionId: true },
  backtestReport: { marketVersionId: true },
  strategyScanReport: { marketVersionId: true },
};
