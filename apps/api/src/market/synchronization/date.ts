/**
 * 严格验证观察日，禁止日期溢出被 Date 自动归一。
 *
 * Validate dates strictly instead of accepting Date's overflow normalization.
 */
export function isObservationDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10).replaceAll('-', '') === value
  );
}

export function localDate(at: Date, timeZone = 'Asia/Shanghai'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(at)
    .replaceAll('-', '');
}

export function localHour(at: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at),
  );
}

export function calendarDay(date: string, increment: number): string {
  const at = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + increment);

  return at.toISOString().slice(0, 10).replaceAll('-', '');
}
