import classNames from 'classnames';
import './monthly-returns.css';

/** 月度收益表 — year × month heatmap (A 股 红涨绿跌), with a compounded 全年 column. */
export function MonthlyReturns({ monthly }: { monthly: { month: string; ret: number }[] }) {
  if (!monthly?.length) {
    return null;
  }

  const byYear = new Map<string, Map<number, number>>(); // year → month(1-12) → return
  for (const { month, ret } of monthly) {
    const year = month.slice(0, 4);
    const m = Number(month.slice(4, 6));
    if (!byYear.has(year)) {
      byYear.set(year, new Map());
    }
    byYear.get(year)!.set(m, ret);
  }
  const years = [...byYear.keys()].sort();
  const yearTotal = (year: string) => {
    let acc = 1;
    for (const r of byYear.get(year)!.values()) {
      acc *= 1 + r;
    }
    return acc - 1;
  };

  return (
    <div className="jx-mret">
      <div className="jx-mret-title">月度收益</div>
      <div className="jx-mret-scroll">
        <table className="jx-mret-table">
          <thead>
            <tr>
              <th className="jx-mret-corner" />
              {MONTHS.map((m) => (
                <th key={m}>{m}月</th>
              ))}
              <th className="jx-mret-totalHead">全年</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year}>
                <td className="jx-mret-year">{year}</td>
                {MONTHS.map((m) => {
                  const r = byYear.get(year)!.get(m);
                  return (
                    <td key={m} style={bg(r)}>
                      {r == null ? '' : fmt(r)}
                    </td>
                  );
                })}
                <td className={classNames('jx-mret-total')} style={bg(yearTotal(year))}>
                  {fmt(yearTotal(year))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// —— helpers ——

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function fmt(r: number): string {
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}`;
}

// Red (+) / green (−) tint, intensity by magnitude (≥10% = full); white text once dark enough.
function bg(r?: number): React.CSSProperties {
  if (r == null) {
    return {};
  }
  const a = Math.min(Math.abs(r) / 0.1, 1) * 0.8;
  return {
    background: r >= 0 ? `rgba(232,70,59,${a})` : `rgba(47,158,91,${a})`,
    color: a > 0.45 ? '#fff' : undefined,
  };
}
