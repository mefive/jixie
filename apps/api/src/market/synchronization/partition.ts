import type { Prisma } from '@prisma/client';

export type MarketValue = string | number | boolean | Date | null;
export type MarketRow = Record<string, MarketValue>;

/**
 * 分区边界始终固定；重试不随新目标移动。
 *
 * Partition boundaries stay fixed when a later target is requested.
 */
export interface MarketPartition {
  fullHistory?: boolean;
  /**
   * 批量财务查询的标的准入截止日，与报告期边界分开。
   *
   * Listing cutoff for bulk financial queries, separate from the report-period boundary.
   */
  catalogThrough?: string;
  exchanges?: readonly string[];
  dataset: string;
  scope: string;
  startDate: string;
  endDate: string;
}

/**
 * 未知 null 与来源明确清空分开处理。
 *
 * Distinguish unknown nulls from explicit clearing.
 */
export interface SourceRecord {
  raw?: unknown;
  values: MarketRow;
  authoritativeNulls?: readonly string[];
  /**
   * 来源明确标为修订的当前版本。
   *
   * A current version explicitly marked revised by the source.
   */
  authoritativeRevision?: boolean;
}

export interface PreparedTable {
  table: string;
  records: SourceRecord[];
  atomic?: boolean;
  replace?: boolean;
}

export interface PreparedMarketPartition {
  tables: PreparedTable[];
  /**
   * 完整来源响应中的无记录等说明；保存为窗口注记，不作为同步失败缺口。
   *
   * Notes such as source-confirmed absence; persist with the window without failing acquisition.
   */
  notes?: string[];
  /**
   * 完整来源查询证实的历史起点。
   *
   * History start established by a complete source query.
   */
  sourceStartDate?: string;
  status: 'complete' | 'partial' | 'waiting' | 'not_applicable' | 'error';
  checks: {
    terminalPage: boolean;
    sourceFailed: boolean;
    invalidRows: number;
    emptyResponse: boolean;
    pages: number;
    sourceRows: number;
    excludedRows?: number;
    suspensionsVerified?: boolean;
    fullDaySuspended?: string[];
    sourceAbsences?: boolean;
  };
  gaps: string[];
  errors: string[];
  observedDates: string[];
}

export interface CoverageChange {
  dataset: string;
  scope: string;
  startDate: string;
  endDate?: string;
}

export interface AcceptedMarketPartition {
  /**
   * 删除记录后重新确认的实际最大日期；省略时沿用正常观察日累积。
   *
   * Actual maximum date after deletions; omission retains normal observation accumulation.
   */
  maxObservedDate?: string | null;
  /**
   * 目录变化实际影响的下游日期；未列出的历史凭证保持有效。
   *
   * Dependent dates affected by catalog changes; unlisted historical proofs remain valid.
   */
  coverageChanges?: CoverageChange[];
  inserted: number;
  updated: number;
  deleted: number;
  rejected: number;
  observedDates: string[];
  changed: boolean;
  errors: string[];
}

export type MarketTransaction = Prisma.TransactionClient;

/**
 * 只描述数据集自身时间和请求规则，不调度其他领域。
 *
 * Describe source time and partition rules without scheduling other domains.
 */
export interface DatasetPolicy {
  dataset: string;
  completion: 'sessions' | 'calendar' | 'catalog' | 'snapshot' | 'reports' | 'events';
  startDate: string;
  period: 'day' | 'month' | 'year' | 'quarter' | 'catalog';
  calendar: string;
  timeZone: string;
  closeHour: number;
  revisionDays: number;
  refreshDays: number;
}
