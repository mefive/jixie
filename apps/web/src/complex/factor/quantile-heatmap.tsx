import type { CSSProperties } from 'react';
import type { QuantileHorizon, FactorWeight } from '@jixie/shared';
import './quantile-heatmap.css';

/** 分位 × 前瞻期热力图 —— 行=前瞻期,列=分位 D1..D10,格子=日均前瞻收益(‱ 万分),红涨绿跌。
 * 看哪个前瞻期下分位单调最强(左低→右高),以及信号衰不衰。日度归一化后各前瞻期可直接比。 */
export function QuantileHeatmap({ rows, weight }: { rows: QuantileHorizon[]; weight: FactorWeight }) {
  if (!rows?.length) return null;
  const n = rows[0][weight].length;
  return (
    <div className="jx-qh-scroll">
      <table className="jx-qh-table">
        <thead>
          <tr>
            <th className="jx-qh-corner">前瞻\分位</th>
            {Array.from({ length: n }, (_, i) => (
              <th key={i}>D{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.horizonDays}>
              <td className="jx-qh-h">{row.horizonDays}日</td>
              {row[weight].map((v, i) => (
                <td key={i} style={bg(v)}>
                  {(v * 10000).toFixed(0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Red (+) / green (−) tint (A 股), intensity by |日均收益|; ≥15‱ ≈ full. White text once dark enough.
function bg(v: number): CSSProperties {
  const a = Math.min(Math.abs(v * 10000) / 15, 1) * 0.8;
  return {
    background: v >= 0 ? `rgba(232,70,59,${a})` : `rgba(47,158,91,${a})`,
    color: a > 0.45 ? '#fff' : undefined,
  };
}
