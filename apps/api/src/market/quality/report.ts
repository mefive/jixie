export type AuditStatus = 'pass' | 'warn' | 'error';

/**
 * 统一审计状态、范围和诊断，供各数据域质量汇总。
 * Describe audit status, scope and diagnostics shared by data domains.
 */
export interface AuditFinding {
  id: string;
  title: string;
  status: AuditStatus;
  summary: string;
  details: string[];
}

/**
 * 提供外部观测来源与可得日期证据，供 PIT 审计。
 * Supply external observation dates and evidence for PIT audits.
 */
export interface ExternalMarketPitAuditRow {
  seriesKey: string;
  tradeDate: string;
  availableDate: string;
  validValue: boolean;
}

/**
 * 汇总外部市场可得性覆盖与问题。
 * Summarize external-market availability coverage and findings.
 */
export interface ExternalMarketPitAuditSummary {
  missingSeries: string[];
  invalidAvailabilityRows: number;
  nonTradingAvailabilityRows: number;
  invalidValueRows: number;
  latestAvailableDate: string | null;
}
