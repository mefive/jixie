export type AuditStatus = 'pass' | 'warn' | 'error';

export interface AuditFinding {
  id: string;
  title: string;
  status: AuditStatus;
  summary: string;
  details: string[];
}

export interface ExternalMarketPitAuditRow {
  seriesKey: string;
  tradeDate: string;
  availableDate: string;
  validValue: boolean;
}

export interface ExternalMarketPitAuditSummary {
  missingSeries: string[];
  invalidAvailabilityRows: number;
  nonTradingAvailabilityRows: number;
  invalidValueRows: number;
  latestAvailableDate: string | null;
}
