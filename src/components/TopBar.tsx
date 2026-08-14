import type { ReactNode } from 'react';

interface TopBarProps {
  visible: boolean;
  total: number;
  localBusy: boolean;
  searchSlot: ReactNode;
  onEnter: () => void;
  onLeave: () => void;
  onOpenLocal: () => void;
}

/** 顶部边缘感应搜索栏：默认隐藏在视口上方，鼠标触顶滑入。 */
export function TopBar({ visible, total, localBusy, searchSlot, onEnter, onLeave, onOpenLocal }: TopBarProps) {
  return (
    <header
      className={`edge-panel edge-top${visible ? ' is-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="top-bar">
        {searchSlot}
        <button
          className="local-btn"
          title="导入本地音乐（选择文件夹，自动解析 ID3 标签）"
          disabled={localBusy}
          onClick={onOpenLocal}
        >
          {localBusy ? '…' : '♪'}
        </button>
        <span className="chip">{total.toLocaleString('en-US')} 首</span>
      </div>
    </header>
  );
}
