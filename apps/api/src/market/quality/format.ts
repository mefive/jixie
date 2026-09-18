export function appendDateList(details: string[], label: string, dates: string[]): void {
  if (dates.length === 0) {
    return;
  }
  details.push(
    `${label}: ${dates.length} (${dates.slice(0, 10).join(', ')}${dates.length > 10 ? ', …' : ''}).`,
  );
}

export function toNumber(value: bigint | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  return typeof value === 'bigint' ? Number(value) : value;
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
