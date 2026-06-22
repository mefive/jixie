import { loadTushareConfig } from '../src/config.js';
import { TushareClient } from '../src/tushare/client.js';
import { stockBasic, tradeCal } from '../src/tushare/api.js';

/** 连通自测：验证 TUSHARE_TOKEN 有效、HTTP 通道正常。跑法：`pnpm smoke`。 */
async function main(): Promise<void> {
  const cfg = loadTushareConfig();
  console.log('✓ 已读取 TUSHARE_TOKEN，API =', cfg.baseUrl);

  const client = new TushareClient({ token: cfg.token, baseUrl: cfg.baseUrl });

  console.log('\n— 交易日历（上交所 2024-01-01 ~ 01-10）—');
  console.table(await tradeCal(client, { start_date: '20240101', end_date: '20240110' }));

  console.log('\n— A 股列表（前 5 只）—');
  const stocks = await stockBasic(client);
  console.log('当前上市 A 股数量：', stocks.length);
  console.table(stocks.slice(0, 5));

  console.log('\n✅ Tushare 连通正常，token 有效。');
}

main().catch((e: unknown) => {
  console.error('\n❌ smoke 失败：', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
