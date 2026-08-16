import { useEffect, useState } from 'react';

/** 胶囊/窗口宽度随软件窗口比例变化（约 21vw，220–330px）。 */
export function computeCapW(): number {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  return Math.round(Math.min(330, Math.max(220, w * 0.21)));
}

/** 监听窗口尺寸变化，返回当前胶囊宽度。 */
export function useDockMetrics() {
  const [capW, setCapW] = useState(computeCapW);
  useEffect(() => {
    const onResize = () => setCapW(computeCapW());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return capW;
}
