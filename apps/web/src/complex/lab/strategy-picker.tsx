import { App, Button, Empty, Modal, Spin } from 'antd';
import dayjs from 'dayjs';
import { faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { StrategyCard } from '@jixie/shared';
import './strategy-picker.css';

/**
 * 我的策略 — a card grid (not a dropdown). Each card shows the strategy name + a lightweight SVG sparkline
 * of its last run's equity curve + headline metrics; click to load that strategy & its历史回测. Trash to
 * delete. The sparkline is plain SVG (no echarts) so the grid stays cheap.
 */
export default function StrategyPicker({
  open,
  cards,
  loading,
  onClose,
  onLoad,
  onDelete,
}: {
  open: boolean;
  cards: StrategyCard[];
  loading: boolean;
  onClose: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { modal } = App.useApp();
  const askDelete = (id: string, name: string) =>
    modal.confirm({
      title: '删除确认',
      content: `确定删除「${name}」吗?删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onDelete(id),
    });
  return (
    <Modal open={open} onCancel={onClose} footer={null} title="我的策略" width={860} destroyOnHidden>
      {loading && cards.length === 0 ? (
        <div className="jx-sp-loading">
          <Spin />
        </div>
      ) : cards.length === 0 ? (
        <Empty description="还没有保存的策略(跑一次回测会自动保存)" />
      ) : (
        <div className="jx-sp-grid">
          {cards.map((c) => (
            <div
              key={c.id}
              className="jx-sp-card"
              onClick={() => {
                onLoad(c.id);
                onClose();
              }}
            >
              <div className="jx-sp-head">
                <span className="jx-sp-name">{c.name}</span>
                <Button
                  type="text"
                  size="small"
                  className="jx-sp-del"
                  icon={<FontAwesomeIcon icon={faTrashCan} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    askDelete(c.id, c.name);
                  }}
                />
              </div>
              {c.snapshot ? (
                <>
                  <Sparkline data={c.snapshot.spark} up={c.snapshot.totalReturn >= 0} />
                  <div className="jx-sp-metrics">
                    <span className={c.snapshot.totalReturn >= 0 ? 'text-up' : 'text-down'}>
                      {(c.snapshot.totalReturn * 100).toFixed(1)}%
                    </span>
                    <span className="jx-sp-muted">SR {c.snapshot.sharpe.toFixed(2)}</span>
                    <span className="jx-sp-muted">{c.snapshot.trades.toLocaleString()} 笔</span>
                  </div>
                </>
              ) : (
                <div className="jx-sp-noRun">未回测</div>
              )}
              <div className="jx-sp-date">{dayjs(c.updatedAt).format('MM-DD HH:mm')}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** A lightweight equity-curve thumbnail (plain SVG polyline, scaled to the card). */
function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <div className="jx-sp-spark" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const W = 240;
  const H = 48;
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
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
