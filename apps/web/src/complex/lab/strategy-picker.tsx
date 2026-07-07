import { Empty, Modal, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import type { StrategyCard } from '@jixie/shared';
import { StrategyCardView } from './strategy-card';
import './strategy-picker.css';

/**
 * My strategies — a card grid (not a dropdown). Each card (StrategyCardView, shared with the lab hero) shows
 * the strategy name + a lightweight SVG sparkline of its last run's equity curve + headline metrics;
 * click to load that strategy & its backtest history. Trash to delete.
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
  const { t } = useTranslation('lab');
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={t('myStrategies')}
      width={860}
      destroyOnHidden
    >
      {loading && cards.length === 0 ? (
        <div className="jx-sp-loading">
          <Spin />
        </div>
      ) : cards.length === 0 ? (
        <Empty description={t('pickerEmpty')} />
      ) : (
        <div className="jx-sp-grid">
          {cards.map((c) => (
            <StrategyCardView
              key={c.id}
              card={c}
              onOpen={(id) => {
                onLoad(id);
                onClose();
              }}
              onDelete={(id) => onDelete(id)}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
