import { AsyncLocalStorage } from 'node:async_hooks';
import { MarketSyncBudgetError, MarketSourceDownloadError } from '../errors.js';

export interface SourceRequestBudget {
  remaining: number;
  deadline: number;
  signal?: AbortSignal;
  failures?: number;
  lastFailure?: string;
}
const sourceBudgets = new AsyncLocalStorage<SourceRequestBudget>();

/**
 * 所有来源及内部重试共享实际 HTTP 请求预算。
 *
 * All sources and internal retries share an actual HTTP-request budget.
 */
export function withSourceRequestBudget<Result>(
  budget: SourceRequestBudget,
  operation: () => Promise<Result>,
): Promise<Result> {
  return sourceBudgets.run(budget, operation);
}

/**
 * 只包装网络请求失败，响应解析和业务映射保留自己的错误。
 *
 * Wrap request failures only; parsing and mapping keep their own errors.
 */
export async function fetchMarketSource(
  fetcher: typeof fetch,
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  const budget = sourceBudgets.getStore();
  if (budget) {
    if (budget.remaining <= 0 || Date.now() >= budget.deadline || budget.signal?.aborted) {
      throw new MarketSyncBudgetError();
    }
    budget.remaining--;
    const [resource, options] = args;
    const remaining = AbortSignal.timeout(
      Math.max(1, Math.min(30_000, budget.deadline - Date.now())),
    );
    const signals = [
      remaining,
      ...(options?.signal ? [options.signal] : []),
      ...(budget.signal ? [budget.signal] : []),
    ];

    try {
      const response = await sourceTransport(() =>
        fetcher(resource, { ...options, signal: AbortSignal.any(signals) }),
      );
      if (!response.ok) {
        budget.failures = (budget.failures ?? 0) + 1;
        budget.lastFailure = `Source HTTP ${response.status}`;
      }

      return response;
    } catch (error) {
      if (!budget.signal?.aborted) {
        budget.failures = (budget.failures ?? 0) + 1;
        budget.lastFailure = error instanceof Error ? error.message : String(error);
      }
      throw error;
    }
  }

  return sourceTransport(() => fetcher(...args));
}

/**
 * 读取完整文本后再由调用方解析，区分传输中断和格式错误。
 *
 * Read complete text before caller-side parsing to distinguish transport and format failures.
 */
export function readMarketSourceText(response: Response): Promise<string> {
  return sourceTransport(() => response.text());
}

/**
 * 二进制响应传输中断保留下载身份，工作簿解析在调用方进行。
 *
 * Preserve binary transport failure identity; callers parse the workbook separately.
 */
export function readMarketSourceBytes(response: Response): Promise<ArrayBuffer> {
  return sourceTransport(() => response.arrayBuffer());
}

async function sourceTransport<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw new MarketSourceDownloadError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}
