import type { Prisma } from '@prisma/client';

export type MarketValue = string | number | boolean | Date | null;
export type MarketRow = Record<string, MarketValue>;

/**
 * 分区边界始终固定；重试不随新目标移动。
 *
 * Partition boundaries stay fixed when a later target is requested.
 */
export interface MarketPartition {
  dataset: string;
  scope: string;
  startDate: string;
  endDate: string;
}

/**
 * 行的字段证据随响应保存，未知字段与权威 null 分开。
 *
 * Carry field evidence, distinguishing unknown values from authoritative null corrections.
 */
export interface SourceRecord {
  values: MarketRow;
  authoritativeNulls?: readonly string[];
  firstObservedAt?: Date;
  publicationDate?: string | null;
  availableDate?: string | null;
  availabilityQuality?: 'source_contract' | 'captured' | 'latest_only' | 'unknown';
}

export interface PreparedTable {
  table: string;
  records: SourceRecord[];
  atomic?: boolean;
  /**
   * 来源提出精确范围请求；公共资格核验完成前不具有删除权限。
   *
   * A source proposes an exact extent; deletion is unauthorized until qualification completes.
   */
  replacementRequest?: { where: Record<string, unknown>; basis: string; independent?: true };
  /**
   * 只有完整权威范围才允许删除；where 由领域函数限定。
   *
   * Only a complete authoritative extent permits deletion; the domain bounds its where clause.
   */
  replacement?: {
    where: Record<string, unknown>;
    authoritative: true;
    basis: string;
    independent?: true;
  };
}

export interface PreparedMarketPartition {
  tables: PreparedTable[];
  status: 'complete' | 'partial' | 'waiting' | 'not_applicable' | 'error';
  evidence: Record<string, string | number | boolean>;
  gaps: string[];
  errors: string[];
  observedDates: string[];
}

export interface AcceptedMarketChange {
  table: string;
  before: MarketRow | null;
  after: MarketRow | null;
}

export interface AcceptedMarketPartition {
  inserted: number;
  updated: number;
  deleted: number;
  rejected: number;
  observedDates: string[];
  changes: AcceptedMarketChange[];
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
  startDate: string;
  period: 'day' | 'month' | 'year' | 'quarter' | 'catalog';
  calendar: string;
  timeZone: string;
  closeHour: number;
  revisionDays: number;
  refreshDays: number;
  version: string;
}
