import { useMemo } from 'react';
import { mulberry32 } from '../lib/rng';

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  delay: number;
  duration: number;
}

export function Starfield() {
  const stars = useMemo<Star[]>(() => {
    const rng = mulberry32(777);
    return Array.from({ length: 130 }, () => ({
      x: rng() * 100,
      y: rng() * 100,
      size: 0.8 + rng() * 1.7,
      opacity: 0.25 + rng() * 0.6,
      delay: -rng() * 6,
      duration: 3 + rng() * 5,
    }));
  }, []);

  return (
    <div className="starfield" aria-hidden="true">
      {stars.map((s, i) => (
        <span
          key={i}
          className="star"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
