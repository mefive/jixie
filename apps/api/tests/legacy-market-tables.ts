import type { Prisma } from '#infra/database/prisma.js';

/**
 * 历史迁移夹具保留旧表形状；不以当前生成客户端冒充旧 schema。
 *
 * Historical migration fixtures use old table shapes independently of the current client.
 */
export function legacyMarketTable(
  database: Pick<Prisma, '$executeRawUnsafe' | '$queryRawUnsafe'>,
  table: 'MarketRecordEvidence' | 'MarketCalculationState' | 'DatasetSyncState',
) {
  return {
    async createMany(input: { data: object[] }) {
      for (const row of input.data) {
        const entries = Object.entries(row);
        const names = entries.map(([field]) => {
          if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
            throw new Error('Invalid legacy fixture field');
          }
          return `"${field}"`;
        });
        await database.$executeRawUnsafe(
          `INSERT INTO "${table}" (${names.join(',')}) VALUES (${entries.map(() => '?').join(',')})`,
          ...entries.map(([, value]) =>
            value instanceof Date
              ? value.getTime()
              : value && typeof value === 'object'
                ? JSON.stringify(value)
                : value,
          ),
        );
      }
    },
    async create(input: { data: object }) {
      await this.createMany({ data: [input.data] });
    },
    async findMany() {
      return database.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "${table}" ORDER BY rowid`,
      );
    },
  };
}
