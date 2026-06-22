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
  /** API 地址，默认 http://api.tushare.pro */
  baseUrl?: string;
  /** 两次请求之间的最小间隔（ms），用于规避 Tushare 按分钟的频率限制。默认 350。 */
  minIntervalMs?: number;
  /** 网络 / 5xx 失败的重试次数（接口业务错误 code!=0 不重试）。默认 3。 */
  maxRetries?: number;
  /** 单次请求超时（ms）。默认 30000。 */
  timeoutMs?: number;
}

/** Tushare 接口返回 code!=0 时抛出（参数错 / 权限不足 / 积分不够等），通常重试无用。 */
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
 * Tushare HTTP API 轻量客户端。
 *
 * 关键设计：所有请求**串行**排进一条 promise 链，并保证两次真正发出之间至少间隔
 * minIntervalMs。Tushare 按「每分钟调用次数」限频，串行 + 间隔是最省心、最不容易被限的做法
 * （因子研究是离线批量拉数，不追求并发吞吐）。
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
   * 调用任意 Tushare 接口，返回「行对象数组」（已把列式 {fields, items} 转成 Record）。
   *
   * @param apiName 接口名，如 'stock_basic' / 'daily'
   * @param params  接口参数，如 { ts_code: '000001.SZ', start_date: '20240101' }
   * @param fields  需要的字段（逗号分隔）；省略则用接口默认字段
   */
  call(
    apiName: string,
    params: Record<string, unknown> = {},
    fields?: string,
  ): Promise<TushareRow[]> {
    const task = this.queue.then(() => this.execute(apiName, params, fields));
    // .catch 吞掉错误只是为了不让前一次失败打断整条串行链；真正的错误仍由 task 抛给调用方。
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
      if (wait > 0) await sleep(wait);

      try {
        const rows = await this.doFetch(apiName, params, fields);
        this.lastCallAt = Date.now();
        return rows;
      } catch (e) {
        this.lastCallAt = Date.now();
        // 业务错误不重试（参数 / 权限 / 积分问题，重试也是一样的结果）
        if (e instanceof TushareError) throw e;
        if (attempt >= this.maxRetries) throw e;
        const backoff = this.minIntervalMs * 2 ** (attempt + 1);
        warn(`${apiName} 第 ${attempt + 1} 次请求失败，${backoff}ms 后重试：`, (e as Error).message);
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
        body: JSON.stringify({ api_name: apiName, token: this.token, params, fields: fields ?? '' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const body = (await res.json()) as TushareResponse;
      if (body.code !== 0) throw new TushareError(apiName, body.code, body.msg ?? 'unknown error');
      return toRows(body.data);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 把 Tushare 的列式响应 {fields, items} 转成更好用的行对象数组。 */
function toRows(data: TushareResponse['data']): TushareRow[] {
  if (!data || !data.items?.length) return [];
  const { fields, items } = data;
  return items.map((item) => {
    const row: TushareRow = {};
    for (let i = 0; i < fields.length; i++) row[fields[i]] = item[i] ?? null;
    return row;
  });
}
