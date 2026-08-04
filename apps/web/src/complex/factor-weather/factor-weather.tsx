import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Empty, Modal, Select, Tag, Tooltip } from 'antd';
import type {
  FactorMeta,
  FactorWeatherDirection,
  FactorWeatherPin,
  FactorWeatherPoint,
} from '@jixie/shared';
import {
  faPlus,
  faRotate,
  faSpinner,
  faThumbtack,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Placeholder } from '@src/components/placeholder';
import i18n from '@src/i18n';
import { complex } from './complex';
import './factor-weather.css';

export const FactorWeather = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factorWeather');
  const { message, modal } = App.useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [factorId, setFactorId] = useState('');
  const [direction, setDirection] = useState<FactorWeatherDirection>('positive');
  const weather = store.weatherLoader.result;
  const catalog = store.catalogLoader.result ?? [];
  const pinnedFactorIds = new Set(weather?.pins.map((pin) => pin.factorId));
  const availableFactors = catalog.filter(
    (factor) => factor.kind !== 'composite' && !pinnedFactorIds.has(factor.key),
  );
  const selectedFactor = availableFactors.find((factor) => factor.key === factorId);

  const chooseFactor = (nextFactorId: string) => {
    const factor = availableFactors.find((candidate) => candidate.key === nextFactorId);
    setFactorId(nextFactorId);
    setDirection(factor?.expectedDirection ?? 'positive');
  };
  const submitPin = async () => {
    if (!selectedFactor) {
      return;
    }
    try {
      await store.pin(selectedFactor.key, direction);
      setPickerOpen(false);
      setFactorId('');
      message.success(t('messages.pinStarted'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('messages.operationFailed'));
    }
  };
  const retryPin = async (pin: FactorWeatherPin) => {
    try {
      await store.refresh(pin.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('messages.operationFailed'));
    }
  };
  const confirmUnpin = (pin: FactorWeatherPin) => {
    modal.confirm({
      title: t('unpin.title', { name: pin.factorName }),
      content: t('unpin.description'),
      okText: t('unpin.confirm'),
      okButtonProps: { danger: true },
      cancelText: t('actions.cancel'),
      onOk: async () => {
        try {
          await store.unpin(pin.id);
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('messages.operationFailed'));
        }
      },
    });
  };

  return (
    <div className="jx-factorWeather">
      <header className="jx-factorWeather-header">
        <div>
          <div className="jx-factorWeather-eyebrow">{t('eyebrow')}</div>
          <h1 className="jx-factorWeather-title">{t('title')}</h1>
          <p className="jx-factorWeather-subtitle">{t('subtitle')}</p>
        </div>
        <Button
          type="primary"
          icon={<FontAwesomeIcon icon={faPlus} />}
          onClick={() => setPickerOpen(true)}
        >
          {t('actions.pin')}
        </Button>
      </header>

      <div className="jx-factorWeather-methodology">
        <span>{t('methodology.monthly')}</span>
        <span>{t('methodology.neutral')}</span>
        <span>{t('methodology.weighting')}</span>
        <span>{t('methodology.completedMonths')}</span>
      </div>

      {store.weatherLoader.error && !weather ? (
        <Placeholder
          icon={faTriangleExclamation}
          error
          text={store.weatherLoader.errorObject?.message ?? t('messages.loadFailed')}
        />
      ) : !weather ? (
        <Placeholder icon={faSpinner} spin text={t('messages.loading')} />
      ) : weather.pins.length === 0 ? (
        <div className="jx-factorWeather-empty">
          <Empty description={t('empty.description')}>
            <Button type="primary" onClick={() => setPickerOpen(true)}>
              {t('empty.action')}
            </Button>
          </Empty>
        </div>
      ) : (
        <FactorGroups
          pins={weather.pins}
          onRefresh={(pin) => void retryPin(pin)}
          onUnpin={confirmUnpin}
        />
      )}

      <Modal
        title={t('picker.title')}
        open={pickerOpen}
        confirmLoading={store.mutationLoader.loading}
        okText={t('picker.confirm')}
        cancelText={t('actions.cancel')}
        okButtonProps={{
          disabled: !selectedFactor || (!selectedFactor.builtin && !selectedFactor.strategyKey),
        }}
        onOk={() => void submitPin()}
        onCancel={() => setPickerOpen(false)}
      >
        <div className="jx-factorWeather-pickerForm">
          <label className="jx-factorWeather-pickerLabel">{t('picker.factor')}</label>
          <Select
            className="jx-factorWeather-pickerControl"
            showSearch
            value={factorId || undefined}
            placeholder={t('picker.factorPlaceholder')}
            optionFilterProp="label"
            onChange={chooseFactor}
            options={availableFactors.map((factor) => ({
              value: factor.key,
              label: factorDisplayName(factor),
              disabled: !factor.builtin && !factor.strategyKey,
            }))}
          />
          {selectedFactor && !selectedFactor.builtin && !selectedFactor.strategyKey && (
            <div className="jx-factorWeather-pickerHint">{t('picker.draftHint')}</div>
          )}
          <label className="jx-factorWeather-pickerLabel">{t('picker.direction')}</label>
          <Select
            className="jx-factorWeather-pickerControl"
            value={direction}
            disabled={selectedFactor?.builtin}
            onChange={setDirection}
            options={[
              { value: 'positive', label: t('direction.positive') },
              { value: 'negative', label: t('direction.negative') },
            ]}
          />
          <div className="jx-factorWeather-pickerHint">{t('picker.directionHint')}</div>
        </div>
      </Modal>
    </div>
  );
}, 'FactorWeather');

// —— Subcomponents / helpers ——

function FactorGroups({
  pins,
  onRefresh,
  onUnpin,
}: {
  pins: FactorWeatherPin[];
  onRefresh: (pin: FactorWeatherPin) => void;
  onUnpin: (pin: FactorWeatherPin) => void;
}) {
  const { t } = useTranslation('factorWeather');
  const groups = [
    { key: 'preset', pins: pins.filter((pin) => pin.builtin) },
    { key: 'custom', pins: pins.filter((pin) => !pin.builtin) },
  ];

  return (
    <div className="jx-factorWeather-groups">
      {groups.map(
        (group) =>
          group.pins.length > 0 && (
            <section className="jx-factorWeather-group" key={group.key}>
              <div className="jx-factorWeather-groupHead">
                <h2>{t(`groups.${group.key}`)}</h2>
                <span>{t('groups.count', { count: group.pins.length })}</span>
              </div>
              <div className="jx-factorWeather-grid">
                {group.pins.map((pin) => (
                  <FactorCard
                    key={pin.id}
                    pin={pin}
                    onRefresh={() => onRefresh(pin)}
                    onUnpin={() => onUnpin(pin)}
                  />
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}

function FactorCard({
  pin,
  onRefresh,
  onUnpin,
}: {
  pin: FactorWeatherPin;
  onRefresh: () => void;
  onUnpin: () => void;
}) {
  const { t } = useTranslation('factorWeather');
  const [selectedDate, setSelectedDate] = useState(pin.points.at(-1)?.periodEndDate ?? '');
  useEffect(() => {
    if (!pin.points.some((point) => point.periodEndDate === selectedDate)) {
      setSelectedDate(pin.points.at(-1)?.periodEndDate ?? '');
    }
  }, [pin.points, selectedDate]);
  const selectedIndex = Math.max(
    0,
    pin.points.findIndex((point) => point.periodEndDate === selectedDate),
  );
  const selected = pin.points[selectedIndex];
  const sign = pin.direction === 'positive' ? 1 : -1;
  const trailingThree = compoundAligned(pin.points, selectedIndex, 3, sign);
  const trailingTwelve = compoundAligned(pin.points, selectedIndex, 12, sign);
  const rollingIc = mean(
    pin.points
      .slice(Math.max(0, selectedIndex - 11), selectedIndex + 1)
      .map((point) => point.rankIc * sign),
  );

  return (
    <article className="jx-factorWeather-card">
      <div className="jx-factorWeather-cardHead">
        <div>
          <div className="jx-factorWeather-cardIdentity">
            <FontAwesomeIcon icon={faThumbtack} />
            <h3>{factorPinName(pin)}</h3>
          </div>
          <div className="jx-factorWeather-cardTags">
            <Tag bordered={false}>{t(pin.builtin ? 'tags.preset' : 'tags.custom')}</Tag>
            <Tag bordered={false} color={pin.direction === 'positive' ? 'red' : 'green'}>
              {t(`direction.${pin.direction}`)}
            </Tag>
          </div>
        </div>
        <div className="jx-factorWeather-cardActions">
          {pin.status === 'error' && (
            <Tooltip title={t('actions.retry')}>
              <Button
                type="text"
                size="small"
                icon={<FontAwesomeIcon icon={faRotate} />}
                onClick={onRefresh}
              />
            </Tooltip>
          )}
          <Tooltip title={t('actions.unpin')}>
            <Button
              type="text"
              size="small"
              danger
              disabled={pin.status === 'pending' || pin.status === 'running'}
              icon={<FontAwesomeIcon icon={faTrash} />}
              onClick={onUnpin}
            />
          </Tooltip>
        </div>
      </div>

      {pin.status === 'pending' || pin.status === 'running' ? (
        <div className="jx-factorWeather-cardState">
          <FontAwesomeIcon icon={faSpinner} spin />
          <strong>{t('status.computing')}</strong>
          <span>{t('status.computingHint')}</span>
        </div>
      ) : pin.status === 'error' ? (
        <div className="jx-factorWeather-cardState jx-factorWeather-cardState--error">
          <strong>{t('status.error')}</strong>
          <span>{pin.error ?? t('status.errorHint')}</span>
        </div>
      ) : !selected ? (
        <div className="jx-factorWeather-cardState">
          <strong>{t('status.noPeriods')}</strong>
        </div>
      ) : (
        <>
          <div className="jx-factorWeather-summary">
            <Metric
              label={t('metrics.selectedMonth', { month: monthLabel(selected.periodEndDate) })}
              value={formatPercent(selected.longShortNetReturn * sign)}
              tone={selected.longShortNetReturn * sign}
            />
            <Metric
              label={t('metrics.trailingThree')}
              value={formatPercent(trailingThree)}
              tone={trailingThree}
            />
            <Metric
              label={t('metrics.trailingTwelve')}
              value={formatPercent(trailingTwelve)}
              tone={trailingTwelve}
            />
            <Metric
              label={t('metrics.rollingIc')}
              value={formatNumber(rollingIc)}
              tone={rollingIc}
            />
          </div>
          <MonthStrip
            points={pin.points}
            direction={pin.direction}
            selectedDate={selected.periodEndDate}
            onSelect={setSelectedDate}
          />
          <div className="jx-factorWeather-detail">
            <span>{t('metrics.rawIc', { value: formatNumber(selected.rankIc) })}</span>
            <span>
              {t('metrics.coverage', { value: formatPercent(selected.sampleCoverage, 0) })}
            </span>
            <span>
              {t('metrics.turnover', {
                value:
                  selected.topTurnover == null
                    ? t('metrics.unavailable')
                    : formatPercent(selected.topTurnover, 0),
              })}
            </span>
            <span>{t('metrics.sample', { count: selected.sampleSize })}</span>
          </div>
        </>
      )}
    </article>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: number }) {
  return (
    <div className="jx-factorWeather-metric">
      <span>{label}</span>
      <strong className={tone > 0 ? 'text-up' : tone < 0 ? 'text-down' : undefined}>{value}</strong>
    </div>
  );
}

function MonthStrip({
  points,
  direction,
  selectedDate,
  onSelect,
}: {
  points: FactorWeatherPoint[];
  direction: FactorWeatherDirection;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const { t } = useTranslation('factorWeather');
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, moved: false });
  useEffect(() => {
    const element = stripRef.current;
    if (element) {
      element.scrollLeft = element.scrollWidth;
    }
  }, [points.length]);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = stripRef.current;
    if (!element) {
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: element.scrollLeft,
      moved: false,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = stripRef.current;
    if (!element || drag.current.pointerId !== event.pointerId) {
      return;
    }
    const distance = event.clientX - drag.current.startX;
    if (Math.abs(distance) > 4 && !element.hasPointerCapture(event.pointerId)) {
      element.setPointerCapture(event.pointerId);
    }
    element.scrollLeft = drag.current.scrollLeft - distance;
    drag.current.moved ||= Math.abs(element.scrollLeft - drag.current.scrollLeft) > 4;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stripRef.current?.hasPointerCapture(event.pointerId)) {
      stripRef.current.releasePointerCapture(event.pointerId);
    }
    drag.current.pointerId = -1;
  };

  return (
    <div
      ref={stripRef}
      className="jx-factorWeather-monthStrip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {points.map((point) => {
        const alignedReturn = point.longShortNetReturn * (direction === 'positive' ? 1 : -1);
        return (
          <Tooltip
            key={point.periodEndDate}
            title={t('monthTooltip', {
              month: monthLabel(point.periodEndDate),
              net: formatPercent(alignedReturn),
              ic: formatNumber(point.rankIc),
            })}
          >
            <button
              type="button"
              className={
                point.periodEndDate === selectedDate
                  ? 'jx-factorWeather-monthCell jx-factorWeather-monthCell--selected'
                  : 'jx-factorWeather-monthCell'
              }
              style={monthCellStyle(alignedReturn)}
              onClick={() => {
                if (!drag.current.moved) {
                  onSelect(point.periodEndDate);
                }
              }}
            >
              <span>{shortMonthLabel(point.periodEndDate)}</span>
              <strong>{formatPercent(alignedReturn, 1)}</strong>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function factorDisplayName(factor: FactorMeta): string {
  return factor.builtin && i18n.exists(`factor:builtin.${factor.key}`)
    ? i18n.t(`factor:builtin.${factor.key}`)
    : factor.label;
}

function factorPinName(pin: FactorWeatherPin): string {
  return pin.builtin && i18n.exists(`factor:builtin.${pin.factorId}`)
    ? i18n.t(`factor:builtin.${pin.factorId}`)
    : pin.factorName;
}

function compoundAligned(
  points: FactorWeatherPoint[],
  selectedIndex: number,
  periods: number,
  sign: number,
): number {
  return (
    points
      .slice(Math.max(0, selectedIndex - periods + 1), selectedIndex + 1)
      .reduce((nav, point) => nav * (1 + point.longShortNetReturn * sign), 1) - 1
  );
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function formatPercent(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function monthLabel(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}`;
}

function shortMonthLabel(date: string): string {
  return `${date.slice(2, 4)}/${date.slice(4, 6)}`;
}

function monthCellStyle(value: number): CSSProperties {
  const intensity = Math.min(0.82, 0.16 + Math.abs(value) * 8);
  if (value > 0.0001) {
    return { backgroundColor: `rgba(220, 38, 38, ${intensity})`, color: '#fff' };
  }
  if (value < -0.0001) {
    return { backgroundColor: `rgba(5, 150, 105, ${intensity})`, color: '#fff' };
  }
  return { backgroundColor: '#e5e7eb', color: '#4b5563' };
}
