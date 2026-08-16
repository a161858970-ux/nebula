import { useEffect, useState } from 'react';

/** 胶囊/窗口宽度随软件窗口比例变化（约 21vw，220–330px）。 */
export function computeCapW(): number {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
  return Math.round(Math.min(330, Math.max(220, w * 0.21)));
}

/** 球直径随视口高度比例变化（clamp 34–48px，与 CSS --dock-ball 一致）。 */
export function computeBall(): number {
  const h = typeof window !== 'undefined' ? window.innerHeight : 900;
  return Math.round(Math.min(48, Math.max(34, h * 0.044)));
}

/** 监听窗口尺寸变化，返回当前胶囊宽度与球直径。 */
export function useDockMetrics() {
  const [capW, setCapW] = useState(computeCapW);
  const [ball, setBall] = useState(computeBall);
  useEffect(() => {
    const onResize = () => {
      setCapW(computeCapW());
      setBall(computeBall());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { capW, ball };
}
