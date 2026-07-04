import { App, Button } from 'antd';
import dayjs from 'dayjs';
import { faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { StrategyCard } from '@jixie/shared';
import './strategy-picker.css';

/**
 * One saved-strategy card: name + a lightweight SVG sparkline of its last run's equity curve + headline
 * metrics. Shared by 我的策略 (the picker grid) and the lab hero's 最近访问 row, so both render identically.
 * Click opens the strategy; the trash button (when onDelete is given) confirms then deletes.
 */
export function StrategyCardView({
  card,
  onOpen,
  onDelete,
}: {
  card: StrategyCard;
  onOpen: (id: string) => void;
  onDelete?: (id: string, name: string) => void;
}) {
  const { modal } = App.useApp();
  const askDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    modal.confirm({
      title: '删除确认',
      content: `确定删除「${card.name}」吗?删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onDelete?.(card.id, card.name),
    });
  };
  return (
    <div className="jx-sp-card" onClick={() => onOpen(card.id)}>
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
            <span className="jx-sp-muted">{card.snapshot.trades.toLocaleString()} 笔</span>
          </div>
        </>
      ) : (
        <div className="jx-sp-noRun">未回测</div>
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
