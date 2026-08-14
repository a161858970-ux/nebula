import { memo, useState } from 'react';
import type { CSSProperties } from 'react';
import { cardScreenPos } from '../lib/layout';
import type { CardSpec, LayoutMetrics } from '../lib/layout';
import { fisheyeBlur, fisheyeBrightness, fisheyeScale, fisheyeZIndex } from '../lib/fisheye';

interface MusicCardProps {
  card: CardSpec;
  metrics: LayoutMetrics;
  buffer: number;
  pan: { x: number; y: number };
  zoom: number;
  hovered: boolean;
  isCurrent: boolean;
  isFailed: boolean;
  onPlay: (songId: number) => void;
  onHoverChange: (id: number, hovered: boolean) => void;
  registerEl: (id: number, el: HTMLElement | null) => void;
}

function MusicCardImpl({
  card,
  metrics,
  buffer,
  pan,
  zoom,
  hovered,
  isCurrent,
  isFailed,
  onPlay,
  onHoverChange,
  registerEl,
}: MusicCardProps) {
  const [coverError, setCoverError] = useState(false);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const pos = cardScreenPos(card, pan, metrics.tileWidth, metrics.tileHeight, vw, vh, buffer, zoom);
  const maxDist = Math.hypot(vw, vh) / 2;

  const style = {
    '--x': `${pos?.x ?? 0}px`,
    '--y': `${pos?.y ?? 0}px`,
    '--rz': `${card.rotateZ}deg`,
    '--scale': pos ? Math.min(3.4, fisheyeScale(pos.dist, maxDist) * zoom) : 1,
    '--blur': pos ? `${fisheyeBlur(pos.dist)}px` : '0px',
    '--brightness': pos ? fisheyeBrightness(pos.dist) : 1,
    zIndex: pos ? fisheyeZIndex(pos.dist, maxDist) : 1,
  } as CSSProperties;

  const { track } = card;

  return (
    <article
      ref={(el) => registerEl(card.id, el)}
      className={`music-card${hovered ? ' is-hovered' : ''}${isCurrent ? ' is-current' : ''}${
        isFailed ? ' is-failed' : ''
      }${pos ? '' : ' is-offscreen'}`}
      style={style}
      data-x={card.x}
      data-y={card.y}
      data-song-id={card.track.id}
      onClick={() => onPlay(card.track.id)}
      onPointerEnter={() => onHoverChange(card.id, true)}
      onPointerLeave={() => onHoverChange(card.id, false)}
    >
      <div
        className="cover"
        style={
          track.cover && !coverError
            ? undefined
            : { background: `linear-gradient(135deg, hsl(${track.hue1} 70% 58%), hsl(${track.hue2} 72% 34%))` }
        }
      >
        {track.cover && !coverError && (
          <img
            className="cover-img"
            src={track.cover}
            alt=""
            loading="lazy"
            onError={() => setCoverError(true)}
          />
        )}
        {(!track.cover || coverError) && (
          <>
            <span className="cover-sheen" />
            <span className="vinyl" style={{ '--vinyl-hue': track.hue2 } as CSSProperties} />
          </>
        )}
        <span className="play-chip" aria-hidden="true">
          ▶
        </span>
      </div>
      <div className="meta">
        <div className="title">{track.title}</div>
        <div className="artist">{track.artist}</div>
      </div>
    </article>
  );
}

export const MusicCard = memo(MusicCardImpl);
