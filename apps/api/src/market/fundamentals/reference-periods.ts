export function quarterlyReportPeriods(startDate: string, endDate: string): string[] {
  const periods: string[] = [];
  const quarterEnds = ['0331', '0630', '0930', '1231'];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    for (const suffix of quarterEnds) {
      const period = `${year}${suffix}`;
      if (period >= startDate && period <= endDate) {
        periods.push(period);
      }
    }
  }
  return periods;
}

export function financialHistoryStart(earliestMarketDate: string): string {
  return `${Number(earliestMarketDate.slice(0, 4)) - 1}1231`;
}
