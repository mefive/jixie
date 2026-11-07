import {
  fetchMarketSource,
  readMarketSourceText,
  sourceMeasurements,
  sourceRequestSignal,
} from '../source-fetch.js';
import { setTimeout as delay } from 'node:timers/promises';
import { TushareRequestLimiter, type TushareRateLimit } from './tushare-request-limiter.js';
import { HttpStatusError } from '../../errors.js';
import { warn } from '#infra/logging.js';
import { MarketSyncBudgetError, TushareError } from '../../errors.js';

/**
 * 限定列式来源单元值，供响应解码。
 *
 * Define scalar cells accepted in columnar provider responses.
 */
export type TushareValue = string | number | null;
export type TushareRow = Record<string, TushareValue>;

/**
 * 描述 Tushare 列式响应及错误状态，供客户端统一校验。
 *
 * Describe columnar Tushare responses and provider status for validation.
 */
interface TushareResponse {
  code: number;
  msg: string | null;
  data: { fields: string[]; items: TushareValue[][] } | null;
}

/**
 * 配置 Tushare 连接、限流与重试，供来源调用复用。
 *
 * Configure Tushare connection, throttling and retries.
 */
export interface TushareClientOptions {
  token: string;
  concurrency?: number;
  perMinute?: number;
  apiLimits?: Readonly<Record<string, TushareRateLimit>>;
  quotaDirectory?: string;
  /** API address, defaults to http://api.tushare.pro */
  baseUrl?: string;
  /** Minimum interval between two requests (ms), to avoid Tushare's per-minute rate limit.
   * Default 350. */
  minIntervalMs?: number;
  /** Retry count for network / 5xx failures (API business errors with code!=0 are not retried).
   * Default 3. */
  maxRetries?: number;
  /** Per-request timeout (ms). Default 30000. */
  timeoutMs?: number;
}

/**
 * HTTP 连接可重叠，所有分页与重试共享同一个发送限流器。
 *
 * Overlap HTTP connections while sharing admission across pages and retries.
 */
export class TushareClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  private readonly limiter: TushareRequestLimiter;

  constructor(opts: TushareClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? 'http://api.tushare.pro';
    this.minIntervalMs = opts.minIntervalMs ?? 350;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.limiter = new TushareRequestLimiter({
      token: opts.token,
      concurrency: opts.concurrency ?? 1,
      minIntervalMs: this.minIntervalMs,
      perMinute: opts.perMinute ?? Math.max(1, Math.floor(60_000 / this.minIntervalMs)),
      apiLimits: opts.apiLimits,
      quotaDirectory: opts.quotaDirectory,
    });
  }

  /**
   * 调用 Tushare 并将列式响应转换为行对象，按实现处理限流和重试。
   *
   * Call any Tushare API and return an array of row objects (the columnar {fields, items} is
   * already converted to Records).
   *
   * @param apiName API name, e.g. 'stock_basic' / 'daily'
   * @param params  API params, e.g. { ts_code: '000001.SZ', start_date: '20240101' }
   * @param fields  desired fields (comma-separated); omit to use the API's default fields
   */
  call(
    apiName: string,
    params: Record<string, unknown> = {},
    fields?: string,
  ): Promise<TushareRow[]> {
    return this.execute(apiName, params, fields);
  }

  /** 等待所有请求退出后释放账号锁。 / Release account ownership after all requests settle. */
  ready() {
    return this.limiter.ready();
  }

  close() {
    return this.limiter.close();
  }

  private async execute(
    apiName: string,
    params: Record<string, unknown>,
    fields: string | undefined,
  ): Promise<TushareRow[]> {
    const signal = sourceRequestSignal();
    const measurements = sourceMeasurements();
    for (let attempt = 0; ; attempt++) {
      const queuedAt = performance.now();
      const release = await this.limiter.acquire(apiName, signal);
      if (measurements) {
        measurements.rateLimitMs += performance.now() - queuedAt;
      }
      let error: unknown;
      try {
        if (signal?.aborted) {
          throw new MarketSyncBudgetError();
        }
        if (measurements && attempt) {
          measurements.retries++;
        }

        return await this.doFetch(apiName, params, fields);
      } catch (failure) {
        error = failure;
        if (signal?.aborted) {
          throw new MarketSyncBudgetError();
        }
        if (failure instanceof HttpStatusError && failure.status === 429) {
          await this.limiter.cooldown(failure.retryAfterMs ?? 60_000);
        }
      } finally {
        if (measurements) {
          measurements.sourceFinishedAt = new Date().toISOString();
        }
        release();
      }
      if (
        error instanceof TushareError ||
        error instanceof MarketSyncBudgetError ||
        (error instanceof HttpStatusError && error.status < 500 && error.status !== 429) ||
        attempt >= this.maxRetries
      ) {
        throw error;
      }
      const backoff = Math.max(1, this.minIntervalMs * 2 ** (attempt + 1)) + Math.random() * 250;
      warn(
        `${apiName} request attempt ${attempt + 1} failed, retrying in ${Math.round(backoff)}ms:`,
        (error as Error).message,
      );
      try {
        await delay(backoff, undefined, { signal });
      } catch {
        throw new MarketSyncBudgetError();
      }
    }
  }

  /**
   * 发送单次 Tushare HTTP 请求并检查响应及供应商错误码。
   *
   * Send one Tushare HTTP request and validate transport and provider status.
   */
  private async doFetch(
    apiName: string,
    params: Record<string, unknown>,
    fields: string | undefined,
  ): Promise<TushareRow[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetchMarketSource(fetch, this.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_name: apiName,
          token: this.token,
          params,
          fields: fields ?? '',
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const retryAfter = res.headers.get('retry-after');
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const milliseconds = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1000)
          : retryAfter
            ? Math.max(0, Date.parse(retryAfter) - Date.now())
            : NaN;
        throw new HttpStatusError(
          res.status,
          `HTTP ${res.status} ${res.statusText}`,
          Number.isFinite(milliseconds) ? milliseconds : undefined,
        );
      }
      const body = JSON.parse(await readMarketSourceText(res)) as TushareResponse;
      if (!body || !Number.isInteger(body.code)) {
        throw new Error('Malformed Tushare response status');
      }
      if (body.code !== 0) {
        throw new TushareError(apiName, body.code, body.msg ?? 'unknown error');
      }
      return toRows(body.data, fields);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 将 fields/items 列式响应转换为对象行，供业务来源映射使用。
 *
 * Convert Tushare's columnar response {fields, items} into a more usable array of row objects.
 */
function toRows(data: TushareResponse['data'], expectedFields?: string): TushareRow[] {
  if (
    !data ||
    !Array.isArray(data.fields) ||
    !Array.isArray(data.items) ||
    data.fields.some((field) => typeof field !== 'string' || !field) ||
    new Set(data.fields).size !== data.fields.length ||
    (data.items.length > 0 && data.fields.length === 0)
  ) {
    throw new Error('Malformed Tushare fields/items response');
  }

  if (
    data.items.length > 0 &&
    expectedFields
      ?.split(',')
      .filter(Boolean)
      .some((field) => !data.fields.includes(field))
  ) {
    throw new Error('Tushare omitted requested response fields');
  }

  return data.items.map((item) => {
    if (
      !Array.isArray(item) ||
      item.length !== data.fields.length ||
      item.some(
        (value) =>
          value !== null &&
          typeof value !== 'string' &&
          (typeof value !== 'number' || !Number.isFinite(value)),
      )
    ) {
      throw new Error('Malformed Tushare response row');
    }

    return Object.fromEntries(data.fields.map((field, index) => [field, item[index]]));
  });
}
