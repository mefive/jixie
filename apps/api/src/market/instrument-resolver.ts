import { prisma } from '../lib/prisma.js';

const CODE_RE = /^(\d{6})(\.(SH|SZ|BJ))?$/i;
const NAME_TOKEN_RE = /^[一-龥A-Za-z]{2,8}$/;
const MAX_HITS = 50;

/** Resolve a verified stock/ETF code from local metadata; never accept model-invented identity. */
export async function resolveInstruments(text: string): Promise<string[]> {
  const value = text.trim();
  if (!value) {
    return [];
  }

  const codeMatch = value.match(CODE_RE);
  if (codeMatch) {
    const symbol = codeMatch[1];
    const normalizedCode = codeMatch[2] ? `${symbol}.${codeMatch[3].toUpperCase()}` : undefined;
    const [stocks, etfs] = await Promise.all([
      prisma.stockBasic.findMany({ where: { symbol }, select: { tsCode: true } }),
      prisma.etfBasic.findMany({
        where: normalizedCode
          ? { tsCode: normalizedCode }
          : { tsCode: { startsWith: `${symbol}.` } },
        select: { tsCode: true },
      }),
    ]);
    return [...stocks, ...etfs].map((row) => row.tsCode);
  }

  const [exactStocks, exactEtfs] = await Promise.all([
    prisma.stockBasic.findMany({ where: { name: value }, select: { tsCode: true } }),
    prisma.etfBasic.findMany({
      where: { OR: [{ name: value }, { fullName: value }] },
      select: { tsCode: true },
    }),
  ]);
  if (exactStocks.length + exactEtfs.length > 0) {
    return [...exactStocks, ...exactEtfs].map((row) => row.tsCode);
  }

  if (!NAME_TOKEN_RE.test(value)) {
    return [];
  }
  const [stocks, etfs] = await Promise.all([
    prisma.stockBasic.findMany({
      where: { name: { contains: value } },
      select: { tsCode: true },
      orderBy: { tsCode: 'asc' },
      take: MAX_HITS,
    }),
    prisma.etfBasic.findMany({
      where: { OR: [{ name: { contains: value } }, { fullName: { contains: value } }] },
      select: { tsCode: true },
      orderBy: { tsCode: 'asc' },
      take: MAX_HITS,
    }),
  ]);
  return [...stocks, ...etfs]
    .map((row) => row.tsCode)
    .sort()
    .slice(0, MAX_HITS);
}
