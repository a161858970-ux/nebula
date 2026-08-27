import { useEffect, useState } from 'react';
import type { Track } from '../lib/catalog';
import { hasDesktopAPI, toBackendTrack } from '../lib/playlist/ipcClient';
import type {
  DesktopAlbumDetail,
  DesktopAlbumSummary,
  DesktopArtistInfo,
  DesktopSongDetail,
  DesktopTrack,
} from '../lib/playlist/ipcClient';

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="info-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="info-modal glass" onPointerDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Loading() {
  return <div className="info-hint">加载中…</div>;
}

function ErrorLine({ text }: { text: string }) {
  return <div className="info-hint is-error">{text}</div>;
}

/* ---------- 评论 ---------- */

interface CommentItem {
  nickname: string;
  avatarUrl: string;
  content: string;
  likedCount: number;
}

function CommentsPanel({ track, onClose }: { track: Track; onClose: () => void }) {
  const [hot, setHot] = useState<CommentItem[]>([]);
  const [latest, setLatest] = useState<CommentItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    window.nebulaAPI!
      .fetchComments(toBackendTrack(track))
      .then((res) => {
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const d = res.data as { hot?: CommentItem[]; latest?: CommentItem[] } | null;
        setHot(d?.hot ?? []);
        setLatest(d?.latest ?? []);
      })
      .catch(() => setError('评论加载失败'));
  }, [track]);

  const Row = ({ c }: { c: CommentItem }) => (
    <div className="cmt-row">
      {c.avatarUrl ? <img className="cmt-avatar" src={c.avatarUrl} alt="" loading="lazy" /> : <span className="cmt-avatar is-ph" />}
      <div className="cmt-body">
        <div className="cmt-nick">{c.nickname}</div>
        <div className="cmt-content">{c.content}</div>
        <div className="cmt-like">♥ {c.likedCount}</div>
      </div>
    </div>
  );

  return (
    <ModalShell onClose={onClose}>
      <div className="info-head">评论</div>
      <div className="info-scroll">
        {error && <ErrorLine text={error} />}
        {!error && !hot.length && !latest.length && <Loading />}
        {!!hot.length && <div className="cmt-section">热门评论</div>}
        {hot.map((c, i) => <Row key={`h${i}`} c={c} />)}
        {!!latest.length && <div className="cmt-section">最新评论</div>}
        {latest.map((c, i) => <Row key={`l${i}`} c={c} />)}
      </div>
    </ModalShell>
  );
}

/* ---------- 歌曲详情 ---------- */

function SongDetailPanel({
  track,
  onOpenArtist,
  onClose,
}: {
  track: Track;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DesktopSongDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    window.nebulaAPI!
      .songDetail(toBackendTrack(track))
      .then((res) => {
        if (res.ok) setDetail(res.data);
        else setError(res.error);
      })
      .catch(() => setError('详情加载失败'));
  }, [track]);

  return (
    <ModalShell onClose={onClose}>
      <div className="info-head">歌曲详情</div>
      <div className="info-scroll">
        {error && <ErrorLine text={error} />}
        {!error && !detail && <Loading />}
        {detail && (
          <div className="sd-wrap">
            <div className="sd-cover-row">
              {detail.album.cover ? (
                <img className="sd-cover" src={detail.album.cover} alt="" />
              ) : (
                <span className="sd-cover is-ph" />
              )}
              <div className="sd-info">
                <div className="sd-title">{detail.title}</div>
                <div className="sd-artists">
                  {detail.artists.map((a) => (
                    <button key={a.id || a.name} className="sd-chip" onClick={() => onOpenArtist(detail.platform, a.id, a.name)}>
                      {a.name}
                    </button>
                  ))}
                </div>
                <div className="sd-album">专辑：{detail.album.name || '未知'}</div>
                {detail.album.publishDate && <div className="sd-album">发行：{detail.album.publishDate}</div>}
                {detail.duration != null && <div className="sd-album">时长：{Math.floor(detail.duration / 60)}:{String(detail.duration % 60).padStart(2, '0')}</div>}
              </div>
            </div>
            {!!detail.credits?.length && (
              <div className="sd-credits">
                <div className="cmt-section">制作团队</div>
                {detail.credits.map((c, i) => (
                  <div key={i} className="sd-credit">
                    <span className="sd-credit-role">{c.role}</span>
                    <span className="sd-credit-name">{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/* ---------- 歌手主页 ---------- */

function ArtistPanel({
  platform,
  artistId,
  artistName,
  onPlayTrack,
  onOpenAlbum,
  onClose,
}: {
  platform: string;
  artistId: string;
  artistName: string;
  onPlayTrack: (track: DesktopTrack) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<DesktopArtistInfo | null>(null);
  const [songs, setSongs] = useState<DesktopTrack[]>([]);
  const [albums, setAlbums] = useState<DesktopAlbumSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    const api = window.nebulaAPI!;
    Promise.all([
      api.artistInfo(platform, artistId),
      api.artistSongs(platform, artistId),
      api.artistAlbums(platform, artistId),
    ])
      .then(([i, s, a]) => {
        if (i.ok) setInfo(i.data);
        if (s.ok) setSongs(s.data);
        if (a.ok) setAlbums(a.data);
      })
      .catch(() => setError('歌手信息加载失败'));
  }, [platform, artistId]);

  return (
    <ModalShell onClose={onClose}>
      <div className="info-head">歌手主页</div>
      <div className="info-scroll">
        {error && <ErrorLine text={error} />}
        {!error && !info && <Loading />}
        {info && (
          <div className="ar-head">
            {info.avatar ? <img className="ar-avatar" src={info.avatar} alt="" /> : <span className="ar-avatar is-ph" />}
            <div className="ar-meta">
              <div className="ar-name">{info.name || artistName}</div>
              {info.description && <div className="ar-desc">{info.description}</div>}
            </div>
          </div>
        )}
        <div className="cmt-section">歌曲（{songs.length}）</div>
        {songs.map((s, i) => (
          <button key={s.sourceId + i} className="ar-song" onDoubleClick={() => onPlayTrack(s)}>
            <span className="ar-song-idx">{i + 1}</span>
            <span className="ar-song-name">{s.title}</span>
            <span className="ar-song-album">{s.album}</span>
          </button>
        ))}
        <div className="cmt-section">专辑（{albums.length}）</div>
        <div className="ar-albums">
          {albums.map((a) => (
            <button
              key={a.id}
              className="ar-album"
              onClick={() => onOpenAlbum(platform, a.id, a.name)}
              title={`查看专辑《${a.name}》`}
            >
              {a.cover ? <img className="ar-album-cover" src={a.cover} alt="" loading="lazy" /> : <span className="ar-album-cover is-ph" />}
              <div className="ar-album-meta">
                <span className="ar-album-name">{a.name}</span>
                <span className="ar-album-year">{a.year ?? ''}{a.songCount ? ` · ${a.songCount} 首` : ''}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

/** 专辑详情弹层：信息 + 专辑歌曲列表（点播走歌手页同款链路）。 */
function AlbumPanel({
  platform,
  albumId,
  albumName,
  onPlayTrack,
  onClose,
}: {
  platform: string;
  albumId: string;
  albumName: string;
  onPlayTrack: (track: DesktopTrack) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DesktopAlbumDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    let cancelled = false;
    window.nebulaAPI!
      .albumDetail(platform, albumId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) setDetail(res.data);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [platform, albumId]);

  return (
    <ModalShell onClose={onClose}>
      <div className="cmt-section">专辑</div>
      <div className="ar-head">
        {detail?.cover ? (
          <img className="ar-avatar" src={detail.cover} alt="" />
        ) : (
          <span className="ar-avatar is-ph" />
        )}
        <div className="ar-meta">
          <div className="ar-name">{detail?.name || albumName}</div>
          {detail?.artist && <div className="ar-desc">歌手：{detail.artist}</div>}
          {detail?.year != null && <div className="ar-desc">发行年份：{detail.year}</div>}
        </div>
      </div>
      <div className="cmt-section">歌曲（{detail?.tracks.length ?? 0}）</div>
      {failed && <div className="ar-desc">该平台专辑歌曲暂不可用（QQ 专辑接口受限）</div>}
      {detail?.tracks.map((t) => (
        <button
          key={`${t.platform}:${t.sourceId}`}
          className="ar-song"
          onClick={() => {
            onPlayTrack(t);
            onClose();
          }}
        >
          <span className="ar-song-name">{t.title}</span>
          <span className="ar-song-album">{t.artist}</span>
        </button>
      ))}
    </ModalShell>
  );
}

export function InfoModals({
  modal,
  onClose,
  onOpenArtist,
  onOpenAlbum,
  onPlayArtistTrack,
}: {
  modal: {
    kind: 'comments' | 'song' | 'artist' | 'album';
    track?: Track;
    platform?: string;
    artistId?: string;
    artistName?: string;
    albumId?: string;
    albumName?: string;
  } | null;
  onClose: () => void;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onOpenAlbum: (platform: string, albumId: string, albumName: string) => void;
  onPlayArtistTrack: (track: DesktopTrack) => void;
}) {
  if (!modal) return null;
  if (modal.kind === 'comments' && modal.track) {
    return <CommentsPanel track={modal.track} onClose={onClose} />;
  }
  if (modal.kind === 'song' && modal.track) {
    return <SongDetailPanel track={modal.track} onOpenArtist={onOpenArtist} onClose={onClose} />;
  }
  if (modal.kind === 'artist' && modal.platform && modal.artistId) {
    return (
      <ArtistPanel
        platform={modal.platform}
        artistId={modal.artistId}
        artistName={modal.artistName ?? ''}
        onOpenAlbum={onOpenAlbum}
        onPlayTrack={(t) => {
          onPlayArtistTrack(t);
          onClose();
        }}
        onClose={onClose}
      />
    );
  }
  if (modal.kind === 'album' && modal.platform && modal.albumId) {
    return (
      <AlbumPanel
        platform={modal.platform}
        albumId={modal.albumId}
        albumName={modal.albumName ?? ''}
        onPlayTrack={(t) => {
          onPlayArtistTrack(t);
          onClose();
        }}
        onClose={onClose}
      />
    );
  }
  return null;
}
