import { App, Button } from 'antd';
import classNames from 'classnames';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { StrategyCard } from '@jixie/shared';
import './strategy-picker.css';

/**
 * One saved-strategy card: name + a lightweight SVG sparkline of its last run's equity curve + headline
 * metrics. Shared by My strategies (the picker grid) and the lab hero's Recent visits row, so both render identically.
 * Click opens the strategy; the trash button (when onDelete is given) confirms then deletes.
 */
export function StrategyCardView({
  card,
  active,
  onOpen,
  onDelete,
}: {
  card: StrategyCard;
  active?: boolean;
  onOpen: (id: string) => void;
  onDelete?: (id: string, name: string) => void;
}) {
  const { t } = useTranslation('lab');
  const { modal } = App.useApp();
  const askDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    modal.confirm({
      title: t('deleteConfirmTitle'),
      content: t('deleteConfirmContent', { name: card.name }),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: () => onDelete?.(card.id, card.name),
    });
  };
  return (
    <div
      className={classNames('jx-sp-card', { 'jx-sp-card--active': active })}
      onClick={() => onOpen(card.id)}
    >
      <div className="jx-sp-head">
        <span className="jx-sp-name">{card.name}</span>
        {onDelete && (
          <Button
            type="text"
            size="small"
            className="jx-sp-del"
            icon={<FontAwesomeIcon icon={faTrashCan} />}
            onClick={askDelete}
          />
        )}
      </div>
      {card.snapshot ? (
        <>
          <Sparkline data={card.snapshot.spark} up={card.snapshot.totalReturn >= 0} />
          <div className="jx-sp-metrics">
            <span className={card.snapshot.totalReturn >= 0 ? 'text-up' : 'text-down'}>
              {(card.snapshot.totalReturn * 100).toFixed(1)}%
            </span>
            <span className="jx-sp-muted">SR {card.snapshot.sharpe.toFixed(2)}</span>
            <span className="jx-sp-muted">
              {t('tradesUnit', { count: card.snapshot.trades.toLocaleString() })}
            </span>
          </div>
        </>
      ) : (
        <div className="jx-sp-noRun">{t('notBacktested')}</div>
      )}
      <div className="jx-sp-date">{dayjs(card.updatedAt).format('MM-DD HH:mm')}</div>
    </div>
  );
}

/** A lightweight equity-curve thumbnail (plain SVG polyline, scaled to the card). */
function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) {
    return <div className="jx-sp-spark" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const W = 240;
  const H = 48;
  const range = max - min || 1;
  const pts = data
    .map(
      (v, i) =>
        `${((i / (data.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg className="jx-sp-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? '#e8463b' : '#2f9e5b'}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
