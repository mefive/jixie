import { fetchMarketSource, readMarketSourceText } from '../source-fetch.js';
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
 * 等待来源请求限流间隔，供 Tushare 重试与节流使用。
 *
 * Wait for a source-request delay used by Tushare throttling and retries.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Lightweight Tushare HTTP API client.
 *
 * Key design: all requests are queued **serially** onto one promise chain, with at least
 * minIntervalMs between two actually-sent calls. Tushare rate-limits by "calls per minute", so
 * serial + interval is the simplest and least limit-prone approach (factor research is offline
 * batch fetching and doesn't chase concurrent throughput).
 */
export class TushareClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(opts: TushareClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? 'http://api.tushare.pro';
    this.minIntervalMs = opts.minIntervalMs ?? 350;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30000;
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
    const task = this.queue.then(() => this.execute(apiName, params, fields));
    // The .catch swallows errors only to keep a previous failure from breaking the serial chain;
    // the real error is still thrown to the caller via task.
    this.queue = task.catch(() => undefined);
    return task;
  }

  /**
   * 协调请求排队、限流与重试，供 Tushare 调用共享连接策略。
   *
   * Coordinate queuing, throttling and retries for Tushare calls.
   */
  private async execute(
    apiName: string,
    params: Record<string, unknown>,
    fields: string | undefined,
  ): Promise<TushareRow[]> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
      if (wait > 0) {
        await sleep(wait);
      }

      try {
        const rows = await this.doFetch(apiName, params, fields);
        this.lastCallAt = Date.now();
        return rows;
      } catch (e) {
        this.lastCallAt = Date.now();
        // Don't retry business errors (param / permission / credit issues yield the same result)
        if (
          e instanceof TushareError ||
          e instanceof MarketSyncBudgetError ||
          (e instanceof HttpStatusError && e.status < 500 && e.status !== 429)
        ) {
          throw e;
        }
        if (attempt >= this.maxRetries) {
          throw e;
        }
        const backoff = this.minIntervalMs * 2 ** (attempt + 1);
        warn(
          `${apiName} request attempt ${attempt + 1} failed, retrying in ${backoff}ms:`,
          (e as Error).message,
        );
        await sleep(backoff);
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
        throw new HttpStatusError(res.status, `HTTP ${res.status} ${res.statusText}`);
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
