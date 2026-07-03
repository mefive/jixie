import { warn } from '../util/log.js';

export type TushareValue = string | number | null;
export type TushareRow = Record<string, TushareValue>;

interface TushareResponse {
  code: number;
  msg: string | null;
  data: { fields: string[]; items: TushareValue[][] } | null;
}

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

/** Thrown when a Tushare API returns code!=0 (bad params / insufficient permission / insufficient
 * credits, etc.); retrying is usually pointless. */
export class TushareError extends Error {
  constructor(
    readonly apiName: string,
    readonly code: number,
    readonly apiMsg: string,
  ) {
    super(`[tushare:${apiName}] code=${code}: ${apiMsg}`);
    this.name = 'TushareError';
  }
}

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
        if (e instanceof TushareError) {
          throw e;
        }
        if (attempt >= this.maxRetries) {
          throw e;
        }
        const backoff = this.minIntervalMs * 2 ** (attempt + 1);
        warn(
          `${apiName} 第 ${attempt + 1} 次请求失败，${backoff}ms 后重试：`,
          (e as Error).message,
        );
        await sleep(backoff);
      }
    }
  }

  private async doFetch(
    apiName: string,
    params: Record<string, unknown>,
    fields: string | undefined,
  ): Promise<TushareRow[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl, {
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
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as TushareResponse;
      if (body.code !== 0) {
        throw new TushareError(apiName, body.code, body.msg ?? 'unknown error');
      }
      return toRows(body.data);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Convert Tushare's columnar response {fields, items} into a more usable array of row objects. */
function toRows(data: TushareResponse['data']): TushareRow[] {
  if (!data || !data.items?.length) {
    return [];
  }
  const { fields, items } = data;
  return items.map((item) => {
    const row: TushareRow = {};
    for (let i = 0; i < fields.length; i++) {
      row[fields[i]] = item[i] ?? null;
    }
    return row;
  });
}
