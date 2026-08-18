import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type EdgeKey = 'top' | 'right' | 'left';

/** 边缘热点宽度。 */
const EDGE_HOTSPOT = 16;
/** 移出面板后的收起延迟（防抖）。 */
const EDGE_HIDE_DELAY = 300;

interface UseEdgePanelsOptions {
  /** 右键菜单打开时暂停边缘隐藏（useOverlays.contextMenuRef）。 */
  contextMenuRef: RefObject<{ x: number; y: number; track: unknown } | null>;
}

/**
 * 边缘面板领域（docs/ARCHITECTURE.md §2）：
 * 顶部/右侧/左侧面板的显示状态、热点触发、移出防抖。
 * 只接收组合层传入的 ref，不依赖其他 hook。
 */
export function useEdgePanels({ contextMenuRef }: UseEdgePanelsOptions) {
  const [edge, setEdge] = useState<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  const edgeHoverRef = useRef<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  const edgeTimerRef = useRef<Record<EdgeKey, number>>({ top: 0, right: 0, left: 0 });

  const showPanel = useCallback((k: EdgeKey) => {
    if (edgeTimerRef.current[k]) {
      window.clearTimeout(edgeTimerRef.current[k]);
      edgeTimerRef.current[k] = 0;
    }
    setEdge((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
  }, []);

  const scheduleHidePanel = useCallback(
    (k: EdgeKey) => {
      if (contextMenuRef.current) return;
      // 搜索框聚焦期间不收回顶部面板（输入法弹出/打字）
      if (k === 'top') {
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest?.('.topbar')) return;
      }
      if (edgeHoverRef.current[k] || edgeTimerRef.current[k]) return;
      edgeTimerRef.current[k] = window.setTimeout(() => {
        edgeTimerRef.current[k] = 0;
        setEdge((prev) => (prev[k] ? { ...prev, [k]: false } : prev));
      }, EDGE_HIDE_DELAY);
    },
    [contextMenuRef],
  );

  const enterPanel = useCallback(
    (k: EdgeKey) => {
      edgeHoverRef.current[k] = true;
      showPanel(k);
    },
    [showPanel],
  );

  const leavePanel = useCallback(
    (k: EdgeKey) => {
      edgeHoverRef.current[k] = false;
      scheduleHidePanel(k);
    },
    [scheduleHidePanel],
  );

  // 热点触发 + 移出防抖（全局 pointermove）
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (contextMenuRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.edge-panel') || t?.closest('.dock')) return;
      const x = e.clientX;
      const y = e.clientY;
      if (y <= EDGE_HOTSPOT) showPanel('top');
      else scheduleHidePanel('top');
      if (x >= window.innerWidth - EDGE_HOTSPOT) showPanel('right');
      else scheduleHidePanel('right');
      if (x <= EDGE_HOTSPOT) showPanel('left');
      else scheduleHidePanel('left');
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [showPanel, scheduleHidePanel, contextMenuRef]);

  const enterTop = useCallback(() => enterPanel('top'), [enterPanel]);
  const leaveTop = useCallback(() => leavePanel('top'), [leavePanel]);
  const enterRight = useCallback(() => enterPanel('right'), [enterPanel]);
  const leaveRight = useCallback(() => leavePanel('right'), [leavePanel]);
  const enterLeft = useCallback(() => enterPanel('left'), [enterPanel]);
  const leaveLeft = useCallback(() => leavePanel('left'), [leavePanel]);

  return { edge, showPanel, enterTop, leaveTop, enterRight, leaveRight, enterLeft, leaveLeft };
}
