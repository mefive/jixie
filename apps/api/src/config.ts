export interface TushareConfig {
  token: string;
  baseUrl: string;
}

/**
 * 读取 Tushare 配置。token 缺失直接抛错并给修复指引。
 * （数据库连接由 Prisma 通过 DATABASE_URL 处理，不在这里。）
 */
export function loadTushareConfig(env: NodeJS.ProcessEnv = process.env): TushareConfig {
  const token = env.TUSHARE_TOKEN?.trim();
  if (!token) {
    throw new Error('TUSHARE_TOKEN 未设置。请在 apps/api/.env 里填入你的 token（参考 .env.example）。');
  }
  return {
    token,
    baseUrl: env.TUSHARE_BASE_URL?.trim() || 'http://api.tushare.pro',
  };
}
