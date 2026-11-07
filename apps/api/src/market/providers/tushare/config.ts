import { dirname, join } from 'node:path';
import { databaseFilename } from '#infra/coordination/market-access.js';
import { z } from 'zod';
import type { TushareRateLimit } from './tushare-request-limiter.js';

/**
 * 提供来源访问令牌及请求设置，供 Tushare 客户端初始化。
 *
 * Supply provider credentials and request settings for client initialization.
 */
export interface TushareConfig {
  token: string;
  baseUrl: string;
  /** 发送间隔与分钟预算共同生效。 / Apply both send spacing and the rolling minute budget. */
  minIntervalMs: number;
  concurrency: number;
  perMinute: number;
  apiLimits: Record<string, TushareRateLimit>;
  quotaDirectory?: string;
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
  const perMinute = z.coerce
    .number()
    .int()
    .positive()
    .parse(env.TUSHARE_REQUESTS_PER_MINUTE ?? 75);
  const concurrency = z.coerce
    .number()
    .int()
    .min(1)
    .max(4)
    .parse(env.JIXIE_INGESTION_CONCURRENCY ?? 4);
  const apiLimits = z
    .record(
      z.string(),
      z.object({
        perMinute: z.number().int().positive(),
        perDay: z.number().int().positive().optional(),
      }),
    )
    .parse(JSON.parse(env.TUSHARE_API_LIMITS_JSON ?? '{}'));
  return {
    token,
    baseUrl: env.TUSHARE_BASE_URL?.trim() || 'http://api.tushare.pro',
    minIntervalMs: Math.max(
      Number.isFinite(interval) && interval > 0 ? interval : 0,
      Math.ceil(60_000 / perMinute),
    ),
    perMinute,
    concurrency,
    apiLimits,
    quotaDirectory:
      env.TUSHARE_QUOTA_DIRECTORY ||
      (env.DATABASE_URL
        ? join(dirname(databaseFilename(env.DATABASE_URL)), 'source-quotas')
        : undefined),
  };
}
