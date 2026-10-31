export interface CleanupItem {
  table: string;
  code?: string;
  from?: string;
  to?: string;
  count: number;
  reason: string;
  source?: string;
}

export interface CleanupCoverage {
  dataset: string;
  scope?: string;
  from?: string;
  to?: string;
}

/**
 * 领域预检不写数据；执行函数只在调用方的发布事务内使用。
 *
 * Domain inspection is read-only; apply runs only inside the caller's publication transaction.
 */
export interface PreparedCleanup {
  items: CleanupItem[];
  retained: CleanupItem[];
  coverage: CleanupCoverage[];
  apply: () => Promise<number>;
}
