/**
 * 提供来源访问令牌及请求设置，供 Tushare 客户端初始化。
 *
 * Supply provider credentials and request settings for client initialization.
 */
export interface TushareConfig {
  token: string;
  baseUrl: string;
  /** Minimum interval between two requests (ms). The low-frequency quote quota is 200 calls/min;
   * 400ms ≈ 150/min leaves some headroom. */
  minIntervalMs: number;
}

/**
 * 读取 Tushare 配置，令牌缺失时立即返回带修复提示的错误。
 *
 * Load Tushare config. Throws immediately with a fix hint if the token is missing.
 * (The database connection is handled by Prisma via DATABASE_URL, not here.)
 */
export function loadTushareConfig(env: NodeJS.ProcessEnv = process.env): TushareConfig {
  const token = env.TUSHARE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'TUSHARE_TOKEN is not set. Put your token in apps/api/.env (see .env.example).',
    );
  }
  const interval = Number(env.TUSHARE_MIN_INTERVAL_MS);
  return {
    token,
    baseUrl: env.TUSHARE_BASE_URL?.trim() || 'http://api.tushare.pro',
    minIntervalMs: Number.isFinite(interval) && interval > 0 ? interval : 400,
  };
}
