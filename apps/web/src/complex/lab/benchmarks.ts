export const BENCHMARKS = [
  { code: '000300.SH', nameKey: 'benchmarkCsi300', color: '#2563eb' },
  { code: '000905.SH', nameKey: 'benchmarkCsi500', color: '#f59e0b' },
  { code: '000852.SH', nameKey: 'benchmarkCsi1000', color: '#7c3aed' },
  { code: '399006.SZ', nameKey: 'benchmarkChiNext', color: '#0891b2' },
] as const;

export type BenchmarkCode = (typeof BENCHMARKS)[number]['code'];
export type BenchmarkSeries = Partial<Record<BenchmarkCode, { date: string; close: number }[]>>;
