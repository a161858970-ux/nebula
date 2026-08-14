import { useEffect, useMemo, useRef, useState } from 'react';
import { matchSongs, type SearchMatch } from '../lib/search';
import type { Track } from '../lib/catalog';

interface SearchBarProps {
  songs: Track[];
  /** 点击单条结果：定位到该卡片（仍保留当前聚簇布局）。 */
  onPick: (match: SearchMatch) => void;
  /** 直接回车（未选具体项）：把全部匹配聚簇并定位到簇团中心。 */
  onSearchAll: (matches: SearchMatch[]) => void;
  /** 输入变化（含清空）：用于实时重排聚簇。 */
  onQueryChange: (matches: SearchMatch[]) => void;
}

/** 顶部搜索：歌曲名/歌手实时匹配；下拉点击定位；回车聚簇全览。 */
export function SearchBar({ songs, onPick, onSearchAll, onQueryChange }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  const matches = useMemo(
    () => (query.trim() ? matchSongs(query, songs) : []),
    [query, songs],
  );

  // 输入变化实时通知 App 重排聚簇（清空时恢复原布局）
  useEffect(() => {
    onQueryChange(matches);
  }, [matches, onQueryChange]);

  // 点击组件外部关闭下拉
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, []);

  useEffect(
    () => () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    },
    [],
  );

  const commit = (m: SearchMatch) => {
    setOpen(false);
    onPick(m);
  };

  const submit = () => {
    if (!matches.length) return;
    setOpen(false);
    if (matches.length === 1) onPick(matches[0]!);
    else onSearchAll(matches);
  };

  return (
    <div ref={wrapRef} className="search-wrap">
      <div className="search-box">
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // 回车语义：单条命中 -> 定位该卡片；多条命中 -> 聚簇全览（不自动选中第一项）
              submit();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => Math.min(matches.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="搜索歌曲 / 歌手"
          spellCheck={false}
        />
        {query && (
          <button
            className="search-clear"
            aria-label="清空搜索"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && query.trim() && (
        <div className="search-drop">
          {matches.length === 0 ? (
            <div className="search-empty">未找到匹配的歌曲或歌手</div>
          ) : (
            <>
              <div className="search-drop-count">
                共 {matches.length} 首匹配{matchTotalArtist(matches) > 0 ? ` · ${matchTotalArtist(matches)} 位歌手` : ''}
                {matches.length > 1 && ' — 回车聚簇查看'}
              </div>
              <ul className="search-results">
                {matches.slice(0, 10).map((m, i) => (
                  <li key={m.index}>
                    <button
                      className={`search-item${i === activeIndex ? ' is-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => commit(m)}
                    >
                      <span className="search-thumb" style={{ background: m.hue1 != null ? `hsl(${m.hue1} 70% 46%)` : undefined }}>
                        {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : null}
                      </span>
                      <span className="search-info">
                        <span className="search-title">{m.title}</span>
                        <span className="search-artist">
                          {m.artist}
                          <em className={`search-kind is-${m.kind}`}>{m.kind === 'title' ? '歌曲' : '歌手'}</em>
                        </span>
                      </span>
                      <span className="search-go" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function matchTotalArtist(matches: SearchMatch[]): number {
  return new Set(matches.filter((m) => m.kind === 'artist').map((m) => m.artist)).size;
}
