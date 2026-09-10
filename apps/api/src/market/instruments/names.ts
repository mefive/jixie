import { prisma } from '#infra/database/prisma.js';

export async function loadInstrumentNames(codes: string[]) {
  const [stocks, etfs, futures] = await Promise.all([
    prisma.stockBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    prisma.etfBasic.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
    prisma.futureContract.findMany({
      where: { tsCode: { in: codes } },
      select: { tsCode: true, name: true },
    }),
  ]);
  const names: Record<string, string> = Object.fromEntries(
    [...stocks, ...etfs, ...futures].map((row) => [row.tsCode, row.name]),
  );
  const continuousNames: Record<string, string> = {
    'IF.CFX': '沪深300股指期货主力',
    'IH.CFX': '上证50股指期货主力',
    'IC.CFX': '中证500股指期货主力',
    'IM.CFX': '中证1000股指期货主力',
  };
  for (const code of codes) {
    if (continuousNames[code]) {
      names[code] = continuousNames[code];
    }
  }
  return names;
}
