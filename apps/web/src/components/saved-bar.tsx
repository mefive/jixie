import { useState } from 'react';
import { App, Button, Dropdown, Input, Modal } from 'antd';
import type { MenuProps } from 'antd';
import dayjs from 'dayjs';
import {
  faChevronDown,
  faFloppyDisk,
  faFolderOpen,
  faTrashCan,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { SavedMeta } from '@jixie/shared';
import './saved-bar.css';

interface Props {
  title: string; // dropdown trigger label, e.g. '我的策略' / '我的选股'
  items: SavedMeta[];
  loading: boolean;
  onOpenList: () => void; // refresh the list when the dropdown opens
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  // Manual save (screen only): when present, render a 保存 button + name modal. Strategies omit this
  // because they auto-save on every backtest run.
  save?: { label: string; defaultName: string; onSave: (name: string) => void };
}

/**
 * Saved-items bar: a dropdown that lists the user's saved strategies / screens (click to reopen,
 * trash icon to delete) plus an optional 保存 button (manual save with a name modal). Presentational —
 * the owning page's store provides the data and the load/save/delete callbacks.
 */
export function SavedBar({ title, items, loading, onOpenList, onLoad, onDelete, save }: Props) {
  const { modal, message } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [draftName, setDraftName] = useState('');

  const askDelete = (id: string, name: string) =>
    modal.confirm({
      title: '删除确认',
      content: `确定删除「${name}」吗?删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onDelete(id),
    });

  const menuItems: MenuProps['items'] =
    items.length === 0
      ? [
          {
            key: 'empty',
            disabled: true,
            label: (
              <span className="jx-savedBar-empty">{loading ? '加载中…' : '还没有保存的项目'}</span>
            ),
          },
        ]
      : items.map((it) => ({
          key: it.id,
          label: (
            <div className="jx-savedBar-item">
              <span className="jx-savedBar-itemName">{it.name}</span>
              <span className="jx-savedBar-itemTime">
                {dayjs(it.updatedAt).format('MM-DD HH:mm')}
              </span>
              <span
                className="jx-savedBar-del"
                role="button"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation(); // don't trigger onLoad
                  askDelete(it.id, it.name);
                }}
              >
                <FontAwesomeIcon icon={faTrashCan} />
              </span>
            </div>
          ),
        }));

  const openSave = () => {
    if (!save) {
      return;
    }
    setDraftName(save.defaultName);
    setModalOpen(true);
  };
  const confirmSave = () => {
    const name = draftName.trim();
    if (!name || !save) {
      return;
    }
    save.onSave(name);
    message.success('已保存');
    setModalOpen(false);
  };

  return (
    <div className="jx-savedBar">
      <Dropdown
        trigger={['click']}
        menu={{
          items: menuItems,
          onClick: ({ key, domEvent }) => {
            if (key === 'empty') {
              return;
            }
            // a click landing on the trash icon already stopped propagation; this is a row open
            domEvent.stopPropagation();
            onLoad(key);
          },
        }}
        onOpenChange={(open) => open && onOpenList()}
      >
        <Button icon={<FontAwesomeIcon icon={faFolderOpen} />}>
          {title}
          <FontAwesomeIcon icon={faChevronDown} className="jx-savedBar-caret" />
        </Button>
      </Dropdown>

      {save && (
        <Button icon={<FontAwesomeIcon icon={faFloppyDisk} />} onClick={openSave}>
          {save.label}
        </Button>
      )}

      <Modal
        title={save?.label}
        open={modalOpen}
        onOk={confirmSave}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !draftName.trim() }}
        width={400}
      >
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="给这个查询起个名字"
          onPressEnter={confirmSave}
          maxLength={100}
          autoFocus
        />
      </Modal>
    </div>
  );
}
