import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { matchSongs, type SearchMatch } from '../lib/search';
import type { Track } from '../lib/catalog';
import { toFrontendTrack, type DesktopArtistHit } from '../lib/playlist/ipcClient';

interface SearchBarProps {
  songs: Track[];
  /** 点击单条结果：定位到该卡片（仍保留当前聚簇布局）。 */
  onPick: (match: SearchMatch) => void;
  /** 直接回车（未选具体项）：把全部匹配聚簇并定位到簇团中心。 */
  onSearchAll: (matches: SearchMatch[]) => void;
  /** 输入变化（含清空）：用于实时重排聚簇。 */
  onQueryChange: (matches: SearchMatch[]) => void;
  /** 点击网络歌曲：仅播放该曲，不影响当前队列（播完自动接回歌单）。 */
  onPlayNetworkSong?: (track: Track) => void;
  /** 点击网络歌手卡片：打开与底部条歌手名同款同逻辑的歌手页。 */
  onOpenArtist?: (platform: string, artistId: string, name: string) => void;
}

/** 果冻弹簧过渡（Aceternity gooey-input 原版参数）。 */
const GOOEY_TRANSITION = {
  duration: 0.4,
  type: 'spring' as const,
  bounce: 0.25,
};

/** 折叠态：纯图标圆形触发钮；展开态：拉宽成输入胶囊。 */
const COLLAPSED_W = 44;
const EXPANDED_W = 252;
const BUBBLE_OFFSET = 48;
const GOOEY_BLUR = 6;

const bubbleVariants = {
  collapsed: { scale: 0, opacity: 0 },
  expanded: { scale: 1, opacity: 1 },
};

/** gooey 滤镜：高斯模糊 + 色阶矩阵，把胶囊与泡泡“融化”粘连。 */
function GooeyFilter({ filterId, blur }: { filterId: string; blur: number }) {
  return (
    <svg className="gooey-filter-svg" aria-hidden="true">
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
}

/** 共享 layoutId 的放大镜：折叠态在胶囊内，展开态“泡泡”浮到左侧。 */
function SearchIcon({ layoutId }: { layoutId: string }) {
  return (
    <motion.svg
      layoutId={layoutId}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      className="gooey-icon"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </motion.svg>
  );
}

/** 顶部搜索：Gooey 果冻展开形态；下拉点击定位；回车聚簇全览。 */
export function SearchBar({
  songs,
  onPick,
  onSearchAll,
  onQueryChange,
  onPlayNetworkSong,
  onOpenArtist,
}: SearchBarProps) {
  const reactId = useId();
  const safeId = reactId.replace(/:/g, '');
  const filterId = `gooey-filter-${safeId}`;
  const iconLayoutId = `gooey-icon-${safeId}`;
  const inputLayoutId = `gooey-input-${safeId}`;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [netSongs, setNetSongs] = useState<Track[]>([]);
  const [netArtists, setNetArtists] = useState<DesktopArtistHit[]>([]);
  const [netSearching, setNetSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevExpandedRef = useRef(false);
  const netSeqRef = useRef(0);

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

  // 展开后自动聚焦；收起时保留上次输入（仅手动清空）
  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    } else if (prevExpandedRef.current) {
      setOpen(false);
    }
    prevExpandedRef.current = isExpanded;
  }, [isExpanded]);

  // 全网搜索（防抖）：歌曲 + 歌手，网络结果展示在本歌单之后、歌手在前
  useEffect(() => {
    const q = query.trim();
    const seq = ++netSeqRef.current;
    if (!q || !window.nebulaAPI?.searchSongs || !window.nebulaAPI?.searchArtists) {
      setNetSongs([]);
      setNetArtists([]);
      setNetSearching(false);
      return;
    }
    setNetSearching(true);
    const timer = window.setTimeout(() => {
      const songsP = window.nebulaAPI!.searchSongs(q, 6).catch(() => ({ ok: false as const, error: '' }));
      const artistsP = window.nebulaAPI!.searchArtists(q, 4).catch(() => ({ ok: false as const, error: '' }));
      void Promise.all([songsP, artistsP]).then(([sr, ar]) => {
        if (netSeqRef.current !== seq) return;
        setNetSongs(sr.ok ? sr.data.map((t, i) => toFrontendTrack(t, 1_000_000 + i)) : []);
        setNetArtists(ar.ok ? ar.data : []);
        setNetSearching(false);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const handleExpand = useCallback(() => setIsExpanded(true), []);

  const commit = useCallback(
    (m: SearchMatch) => {
      setOpen(false);
      onPick(m);
    },
    [onPick],
  );

  const submit = useCallback(() => {
    if (!matches.length) return;
    setOpen(false);
    if (matches.length === 1) onPick(matches[0]!);
    else onSearchAll(matches);
  }, [matches, onPick, onSearchAll]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setActiveIndex(0);
    setOpen(true);
  }, []);

  const handleBlur = useCallback(() => {
    // 无内容时收起（有内容保持展开，方便继续筛选）
    if (!query) setIsExpanded(false);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        e.preventDefault();
        setOpen(false);
        setIsExpanded(false);
      }
    },
    [matches.length, submit],
  );

  const hasNet = netArtists.length > 0 || netSongs.length > 0;

  return (
    <div ref={wrapRef} className="gooey-search">
      <GooeyFilter filterId={filterId} blur={GOOEY_BLUR} />

      <motion.div
        className="gooey-stage"
        animate={{ width: isExpanded ? EXPANDED_W + BUBBLE_OFFSET : COLLAPSED_W }}
        transition={GOOEY_TRANSITION}
      >
        <motion.div
          className="gooey-pill-row"
          animate={{
            width: isExpanded ? EXPANDED_W : COLLAPSED_W,
            marginLeft: isExpanded ? BUBBLE_OFFSET : 0,
          }}
          transition={GOOEY_TRANSITION}
        >
          <button
            type="button"
            className={`gooey-pill glass-btn${isExpanded ? '' : ' is-collapsed'}`}
            onClick={handleExpand}
            title={isExpanded ? undefined : '搜索歌曲 / 歌手'}
          >
            {!isExpanded && <SearchIcon layoutId={iconLayoutId} />}
            <motion.input
              layoutId={inputLayoutId}
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={handleChange}
              onFocus={() => setOpen(true)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              disabled={!isExpanded}
              placeholder="搜索歌曲 / 歌手"
            />
            {isExpanded && query && (
              <button
                type="button"
                className="search-clear gooey-clear"
                aria-label="清空搜索"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setQuery('');
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </button>
        </motion.div>

        <motion.div
          className="gooey-bubble"
          variants={bubbleVariants}
          initial="collapsed"
          animate={isExpanded ? 'expanded' : 'collapsed'}
          transition={GOOEY_TRANSITION}
        >
          <div className="gooey-bubble-surface glass-btn">
            <SearchIcon layoutId={iconLayoutId} />
          </div>
        </motion.div>
      </motion.div>

      {open && query.trim() && (
        <div className="search-drop">
          {matches.length === 0 && !hasNet && !netSearching ? (
            <div className="search-empty">未找到匹配的歌曲或歌手</div>
          ) : (
            <>
              <div className="search-drop-count">
                共 {matches.length} 首匹配{matchTotalArtist(matches) > 0 ? ` · ${matchTotalArtist(matches)} 位歌手` : ''}
                {matches.length > 1 && ' — 回车聚簇查看'}
                {netSearching && <em className="search-net-searching"> · 全网搜索中…</em>}
                {hasNet && (
                  <em className="search-net-count">
                    {' '}
                    · 全网 {netSongs.length} 首{netArtists.length > 0 ? ` · ${netArtists.length} 位歌手` : ''}
                  </em>
                )}
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
                {netArtists.length > 0 && (
                  <li className="search-divider">
                    <span>全网歌手</span>
                  </li>
                )}
                {netArtists.map((a) => (
                  <li key={`artist-${a.platform}-${a.id}`}>
                    <button
                      type="button"
                      className="search-item search-net-item"
                      onClick={() => onOpenArtist?.(a.platform, a.id, a.name)}
                    >
                      <span className="search-thumb">
                        {a.avatar ? <img src={a.avatar} alt="" loading="lazy" /> : null}
                      </span>
                      <span className="search-info">
                        <span className="search-title">{a.name}</span>
                        <span className="search-artist">
                          {platformLabel(a.platform)}
                          <em className="search-kind is-artist">歌手</em>
                        </span>
                      </span>
                      <span className="search-go" aria-hidden="true">
                        →
                      </span>
                    </button>
                  </li>
                ))}
                {netSongs.length > 0 && (
                  <li className="search-divider">
                    <span>全网歌曲</span>
                  </li>
                )}
                {netSongs.map((t) => (
                  <li key={`net-${t.source}-${t.sourceId}`}>
                    <button
                      type="button"
                      className="search-item search-net-item"
                      onClick={() => onPlayNetworkSong?.(t)}
                    >
                      <span
                        className="search-thumb"
                        style={{ background: `hsl(${t.hue1} 70% 46%)` }}
                      >
                        {t.cover ? <img src={t.cover} alt="" loading="lazy" /> : null}
                      </span>
                      <span className="search-info">
                        <span className="search-title">{t.title}</span>
                        <span className="search-artist">
                          {t.artist}
                          <em className="search-kind is-song">点播</em>
                        </span>
                      </span>
                      <span className="search-go" aria-hidden="true">
                        ▶
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

function platformLabel(platform: string): string {
  switch (platform) {
    case 'netease':
      return '网易云音乐';
    case 'qq':
      return 'QQ 音乐';
    case 'kugou':
      return '酷狗音乐';
    default:
      return platform;
  }
}
