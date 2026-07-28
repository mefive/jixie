import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select } from 'antd';
import type { TradeRecord } from '@jixie/shared';
import { fetchNames } from '@src/api/client';
import './trade-detail.css';

type AssetType = NonNullable<TradeRecord['assetType']>;
type Side = TradeRecord['side'];

/**
 * Portfolio-level execution detail. Instrument, side, and asset type are deliberately secondary
 * table filters. Instrument price charts belong to a single-fill drill-down rather than this view.
 */
export default function TradeDetail({ tradeLog }: { tradeLog: TradeRecord[] }) {
  const { t } = useTranslation('lab');
  const [instrument, setInstrument] = useState<string>();
  const [side, setSide] = useState<Side>();
  const [assetType, setAssetType] = useState<AssetType>();
  const [names, setNames] = useState<Record<string, string>>({});

  const instrumentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trade of tradeLog) {
      counts.set(trade.code, (counts.get(trade.code) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      ([leftCode, leftCount], [rightCode, rightCount]) =>
        rightCount - leftCount || leftCode.localeCompare(rightCode),
    );
  }, [tradeLog]);

  useEffect(() => {
    const codes = [...new Set(tradeLog.map((trade) => trade.code))];
    if (!codes.length) {
      return;
    }

    fetchNames(codes)
      .then(setNames)
      .catch(() => {});
  }, [tradeLog]);

  useEffect(() => {
    if (instrument && !instrumentCounts.some(([code]) => code === instrument)) {
      setInstrument(undefined);
    }
  }, [instrument, instrumentCounts]);

  const filteredTrades = useMemo(
    () =>
      tradeLog.filter(
        (trade) =>
          (!instrument || trade.code === instrument) &&
          (!side || trade.side === side) &&
          (!assetType || normalizedAssetType(trade) === assetType),
      ),
    [tradeLog, instrument, side, assetType],
  );

  const metrics = useMemo(() => {
    const instrumentCount = new Set(filteredTrades.map((trade) => trade.code)).size;
    const buyCount = filteredTrades.filter((trade) => trade.side === 'buy').length;
    const sellCount = filteredTrades.length - buyCount;
    const turnover = filteredTrades.reduce((sum, trade) => sum + trade.amount, 0);
    const fees = filteredTrades.reduce((sum, trade) => sum + trade.fee, 0);
    const slippage = filteredTrades.reduce((sum, trade) => sum + (trade.slippageCost ?? 0), 0);

    return [
      { label: t('tdMetricInstruments'), value: instrumentCount.toLocaleString() },
      {
        label: t('tdMetricBuySell'),
        value: t('tdMetricBuySellValue', { buy: buyCount, sell: sellCount }),
      },
      { label: t('tdMetricTurnover'), value: formatCompactMoney(turnover, t('unitWan')) },
      { label: t('tdMetricFees'), value: formatYuan(fees, 0) },
      { label: t('tdMetricSlippage'), value: formatYuan(slippage, 0) },
      {
        label: t('tdMetricAverage'),
        value: formatMoney(turnover / Math.max(filteredTrades.length, 1), t('unitWan')),
      },
    ];
  }, [filteredTrades, t]);

  const filtersActive = instrument != null || side != null || assetType != null;

  return (
    <div className="jx-td">
      <div className="jx-td-metrics">
        {metrics.map((metric) => (
          <div className="jx-td-metric" key={metric.label}>
            <span className="jx-td-metricLabel">{metric.label}</span>
            <span className="jx-td-metricValue">{metric.value}</span>
          </div>
        ))}
      </div>

      <section className="jx-td-ledger">
        <div className="jx-td-toolbar">
          <div className="jx-td-ledgerTitle">
            <span className="jx-td-sectionTitle">{t('tdLedgerTitle')}</span>
            <span className="jx-td-sectionMeta">
              {t('tdFilteredCount', { count: filteredTrades.length })}
            </span>
          </div>
          <div className="jx-td-filters">
            <Select
              className="jx-td-instrumentFilter"
              allowClear
              showSearch
              size="small"
              value={instrument}
              placeholder={t('tdFilterInstrument')}
              optionFilterProp="label"
              onChange={setInstrument}
              options={instrumentCounts.map(([code, count]) => ({
                value: code,
                label: `${names[code] ?? code} · ${code} (${count})`,
              }))}
            />
            <Select
              className="jx-td-compactFilter"
              allowClear
              size="small"
              value={side}
              placeholder={t('tdFilterSide')}
              onChange={setSide}
              options={[
                { value: 'buy', label: t('sideBuy') },
                { value: 'sell', label: t('sideSell') },
              ]}
            />
            <Select
              className="jx-td-compactFilter"
              allowClear
              size="small"
              value={assetType}
              placeholder={t('tdFilterAsset')}
              onChange={setAssetType}
              options={[
                { value: 'stock', label: t('assetStock') },
                { value: 'etf', label: t('assetEtf') },
                { value: 'future', label: t('assetFuture') },
              ]}
            />
            {filtersActive && (
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setInstrument(undefined);
                  setSide(undefined);
                  setAssetType(undefined);
                }}
              >
                {t('tdClearFilters')}
              </Button>
            )}
          </div>
        </div>

        <div className="jx-td-list">
          <div className="jx-td-head">
            <span>{t('tdColInstrument')}</span>
            <span>{t('tdColDate')}</span>
            <span>{t('tdColSide')}</span>
            <span className="jx-td-num">{t('tdColQuantity')}</span>
            <span className="jx-td-num">{t('tdColPrice')}</span>
            <span className="jx-td-num">{t('tdColAmount')}</span>
            <span className="jx-td-num">{t('tdColFee')}</span>
            <span className="jx-td-num">{t('tdColSlippage')}</span>
          </div>
          {filteredTrades.map((trade, index) => {
            const type = normalizedAssetType(trade);
            const quantity =
              type === 'future'
                ? (trade.contracts ?? trade.realShares ?? trade.shares)
                : (trade.realShares ?? trade.shares);

            return (
              <div className="jx-td-row" key={`${trade.date}-${trade.code}-${index}`}>
                <span className="jx-td-inst">
                  <span className="jx-td-instName">{names[trade.code] ?? trade.code}</span>
                  <span className="jx-td-instMeta">
                    <span className="jx-td-instCode">{trade.code}</span>
                    <span className="jx-td-instType">{t(assetTypeKey(type))}</span>
                    {trade.actualCode && trade.actualCode !== trade.code && (
                      <span className="jx-td-instActual">
                        {t('tdActualContract', { code: trade.actualCode })}
                      </span>
                    )}
                  </span>
                </span>
                <span>{formatDate(trade.date)}</span>
                <span className={trade.side === 'buy' ? 'text-up' : 'text-down'}>
                  {trade.side === 'buy' ? t('sideBuy') : t('sideSell')}
                </span>
                <span className="jx-td-num">{Math.round(quantity).toLocaleString()}</span>
                <span className="jx-td-num">{(trade.realPrice ?? trade.price).toFixed(2)}</span>
                <span className="jx-td-num">{formatMoney(trade.amount, t('unitWan'))}</span>
                <span className="jx-td-num">{trade.fee.toFixed(2)}</span>
                <span className="jx-td-num">
                  {trade.slippageCost == null ? '—' : trade.slippageCost.toFixed(2)}
                </span>
              </div>
            );
          })}
          {!filteredTrades.length && <div className="jx-td-empty">{t('tdNoMatchingTrades')}</div>}
        </div>
      </section>
    </div>
  );
}

function normalizedAssetType(trade: TradeRecord): AssetType {
  return trade.assetType ?? 'stock';
}

function assetTypeKey(assetType: AssetType): 'assetStock' | 'assetEtf' | 'assetFuture' {
  switch (assetType) {
    case 'stock':
      return 'assetStock';
    case 'etf':
      return 'assetEtf';
    case 'future':
      return 'assetFuture';
  }
}

function formatDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function formatMoney(value: number, unit: string): string {
  return `${(value / 10000).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}${unit}`;
}

function formatCompactMoney(value: number, unit: string): string {
  const tenThousands = value / 10000;
  const digits = tenThousands >= 100 ? 0 : 1;
  return `${tenThousands.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unit}`;
}

function formatYuan(value: number, digits = 2): string {
  return `¥${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
