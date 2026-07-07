import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuantileHorizon, FactorWeight } from '@jixie/shared';
import './quantile-heatmap.css';

/** Quantile × forward-period heatmap —— rows = forward period, cols = quantile D1..D10, cell = daily
 * average forward return (in ‱, basis-of-ten-thousand), red up / green down. Read off which forward
 * period gives the strongest monotonic quantile spread (low on the left → high on the right) and whether
 * the signal decays. After daily normalization the forward periods are directly comparable. */
export function QuantileHeatmap({
  rows,
  weight,
}: {
  rows: QuantileHorizon[];
  weight: FactorWeight;
}) {
  const { t } = useTranslation('factor');
  if (!rows?.length) {
    return null;
  }
  const n = rows[0][weight].length;
  return (
    <div className="jx-qh-scroll">
      <table className="jx-qh-table">
        <thead>
          <tr>
            <th className="jx-qh-corner">{t('qhCorner')}</th>
            {Array.from({ length: n }, (_, i) => (
              <th key={i}>D{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.horizonDays}>
              <td className="jx-qh-h">{t('days', { days: row.horizonDays })}</td>
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

// Red (+) / green (−) tint (A-share convention), intensity by |daily avg return|; ≥15‱ ≈ full. White text once dark enough.
function bg(v: number): CSSProperties {
  const a = Math.min(Math.abs(v * 10000) / 15, 1) * 0.8;
  return {
    background: v >= 0 ? `rgba(232,70,59,${a})` : `rgba(47,158,91,${a})`,
    color: a > 0.45 ? '#fff' : undefined,
  };
}
