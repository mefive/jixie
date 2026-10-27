import { getDatabase } from '#infra/database/prisma.js';

/**
 * 批量读取证券显示名称，供结果及目录展示。
 *
 * Load instrument display names in a batch for results and catalogs.
 */
export async function loadInstrumentNames(codes: string[]) {
  const [stocks, etfs] = await Promise.all([
    getDatabase().stockBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    getDatabase().etfBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const names: Record<string, string> = Object.fromEntries(
    [...stocks, ...etfs].map((row) => [row.tsCode, row.name]),
  );
  return names;
}
