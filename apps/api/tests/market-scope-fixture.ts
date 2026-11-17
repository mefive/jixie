import { withDatabase, type Prisma } from '#infra/database/prisma.js';
import { withLegacyMarketBinding, type MarketDatabase } from '#infra/database/market-database.js';

/**
 * 仅将测试提供的市场 delegate 绑定到作用域，不连接工作库。
 *
 * Expose the test's explicit market delegates without opening a workspace database.
 */
export function withMarketFixture<Result>(fixture: Prisma, operation: () => Promise<Result>) {
  return withDatabase(fixture, () =>
    withLegacyMarketBinding({ client: () => fixture as unknown as MarketDatabase }, operation),
  );
}
