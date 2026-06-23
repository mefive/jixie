export interface TushareConfig {
  token: string;
  baseUrl: string;
  /** Minimum interval between two requests (ms). The low-frequency quote quota is 200 calls/min;
   * 400ms ≈ 150/min leaves some headroom. */
  minIntervalMs: number;
}

/**
 * Load Tushare config. Throws immediately with a fix hint if the token is missing.
 * (The database connection is handled by Prisma via DATABASE_URL, not here.)
 */
export function loadTushareConfig(env: NodeJS.ProcessEnv = process.env): TushareConfig {
  const token = env.TUSHARE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'TUSHARE_TOKEN 未设置。请在 apps/api/.env 里填入你的 token（参考 .env.example）。',
    );
  }
  const interval = Number(env.TUSHARE_MIN_INTERVAL_MS);
  return {
    token,
    baseUrl: env.TUSHARE_BASE_URL?.trim() || 'http://api.tushare.pro',
    minIntervalMs: Number.isFinite(interval) && interval > 0 ? interval : 400,
  };
}
