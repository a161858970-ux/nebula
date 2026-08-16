import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion } from 'motion/react';
import type { DesktopLoginPlatform } from '../lib/playlist/ipcClient';
import type { AccountState } from '../lib/accounts';
import type { BackgroundSetting } from '../lib/backgrounds';
import type { CoverBgMode } from './BackgroundLayer';
import type { LyricVisualSettings } from './LyricsLayer';
import { DOCK_PLATFORM_ORDER, platformMeta } from './platforms';
import { useDockMetrics } from '../lib/dock';

export type DockSettingsPage = 'lyrics' | 'interface' | 'background' | 'system';

interface AccountDockProps {
  visible: boolean;
  platforms: DesktopLoginPlatform[];
  accounts: Record<string, AccountState>;
  selectedPlatform: string;
  /** 外部「去登录」请求计数：变化时打开登录球并选中对应平台。 */
  loginNonce: number;
  bgSetting: BackgroundSetting;
  coverMode: CoverBgMode;
  lyricSettings: LyricVisualSettings;
  uiHideCards: boolean;
  uiHideLyrics: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onSelectPlatform: (platform: string) => void;
  onRefreshAccount: (platform: string) => void;
  onSelectBg: (s: BackgroundSetting) => void;
  onFile: (f: File) => void;
  onCoverMode: (m: CoverBgMode) => void;
  onOpenWallpapers: () => void;
  onFontSize: (n: number) => void;
  onHighlightStyle: (s: LyricVisualSettings['highlightStyle']) => void;
  onLayerMode: (m: LyricVisualSettings['layerMode']) => void;
  onCurrentScale: (n: number) => void;
  onWordRise: (n: number) => void;
  onLyricLayout: (m: LyricVisualSettings['lyricLayout']) => void;
  onLyricColorSource: (s: LyricVisualSettings['lyricColorSource']) => void;
  onCustomColor: (c: string) => void;
  onLyricBold: (b: boolean) => void;
  onToggleHideCards: () => void;
  onToggleHideLyrics: () => void;
}

const ROW_SPRING = { type: 'spring' as const, stiffness: 430, damping: 30 };

const rowVariants = {
  hidden: { opacity: 0, scale: 0.5, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 500, damping: 24, delay: 0.03 + i * 0.06 },
  }),
};

/** 小跳字动画：字符逐个弹性入场。 */
function JumpText({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <span className="jump-text" aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <motion.span
          key={i}
          className="jump-char"
          initial={{ opacity: 0, y: 9, scale: 0.5 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 560, damping: 25, delay: delay + i * 0.016 }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

/** 液态开关（Toggle Switch）：轨道 + 圆点，hover 轻微放大，为未来液态主题铺路。 */
/** 开关：silent-otter-72 复刻（勾号独立滑动 + em 比例缩放）。 */
function Toggle({
  checked,
  onChange,
  label,
  small,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <label className={`switch${small ? ' sm' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="slider">
        <svg className="slider-icon" viewBox="0 0 12 12" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6.4 5.1 8.5 9 4.2" />
        </svg>
      </span>
    </label>
  );
}

/** 设置内容高度动画：切换页面时仅从卡片下部延展/收缩。 */
function AnimatedHeight({ children }: { children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const target = el.offsetHeight;
    setHeight((prev) => {
      if (prev === 'auto' || Math.abs((prev as number) - target) < 2) return target;
      requestAnimationFrame(() => setHeight(target));
      return prev;
    });
  }, [children]);
  return (
    <div className="dock-anim-h">
      <motion.div animate={{ height }} transition={{ type: 'spring', stiffness: 300, damping: 32 }} style={{ overflow: 'hidden' }}>
        <div ref={innerRef}>{children}</div>
      </motion.div>
    </div>
  );
}

/** 歌词设置：字号 / 高亮 / 布局 / 颜色 / 层次 + 加粗开关。 */
function LyricSettings({
  setting,
  onFontSize,
  onHighlightStyle,
  onLayerMode,
  onCurrentScale,
  onWordRise,
  onLyricLayout,
  onLyricColorSource,
  onCustomColor,
  onLyricBold,
}: {
  setting: LyricVisualSettings;
  onFontSize: (n: number) => void;
  onHighlightStyle: (s: LyricVisualSettings['highlightStyle']) => void;
  onLayerMode: (m: LyricVisualSettings['layerMode']) => void;
  onCurrentScale: (n: number) => void;
  onWordRise: (n: number) => void;
  onLyricLayout: (m: LyricVisualSettings['lyricLayout']) => void;
  onLyricColorSource: (s: LyricVisualSettings['lyricColorSource']) => void;
  onCustomColor: (c: string) => void;
  onLyricBold: (b: boolean) => void;
}) {
  const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));
  return (
    <div className="lyric-settings">
      <div className="ls-card">
        <h4 className="ls-card-title">基础文字</h4>
        <label className="ls-row">
          <span>字体大小</span>
          <input
            type="range"
            min={14}
            max={maxFont}
            step={1}
            value={setting.fontSize}
            onChange={(e) => onFontSize(Number(e.target.value))}
          />
          <em>{setting.fontSize}px</em>
        </label>
        <div className="ls-row">
          <span>歌词加粗</span>
          <Toggle small checked={!!setting.bold} onChange={onLyricBold} label="歌词加粗" />
        </div>
      </div>
      <div className="ls-card">
        <h4 className="ls-card-title">高亮与动效</h4>
        <div className="ls-row">
          <span>高亮风格</span>
          <div className="ls-seg">
            <button
              className={setting.highlightStyle === 'sweep' ? 'active' : ''}
              onClick={() => onHighlightStyle('sweep')}
            >
              扫光填充
            </button>
            <button
              className={setting.highlightStyle === 'float' ? 'active' : ''}
              onClick={() => onHighlightStyle('float')}
            >
              上浮发光
            </button>
          </div>
        </div>
        <label className="ls-row">
          <span>当前句放大</span>
          <input
            type="range"
            min={1}
            max={1.6}
            step={0.02}
            value={setting.currentScale}
            onChange={(e) => onCurrentScale(Number(e.target.value))}
          />
          <em>{setting.currentScale.toFixed(2)}×</em>
        </label>
        <label className="ls-row">
          <span>逐字上浮</span>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={setting.wordRise}
            onChange={(e) => onWordRise(Number(e.target.value))}
          />
          <em>{setting.wordRise}px</em>
        </label>
      </div>
      <div className="ls-card">
        <h4 className="ls-card-title">布局与层级</h4>
        <div className="ls-row">
          <span>歌词布局</span>
          <div className="ls-seg">
            <button
              className={setting.lyricLayout === 'stacked' ? 'active' : ''}
              onClick={() => onLyricLayout('stacked')}
            >
              上下堆叠
            </button>
            <button
              className={setting.lyricLayout === 'offset' ? 'active' : ''}
              onClick={() => onLyricLayout('offset')}
            >
              上下错落
            </button>
          </div>
        </div>
        <div className="ls-row">
          <span>歌词取色</span>
          <div className="ls-seg">
            <button
              className={setting.lyricColorSource === 'cover' ? 'active' : ''}
              onClick={() => onLyricColorSource('cover')}
            >
              封面取色
            </button>
            <button
              className={setting.lyricColorSource === 'custom' ? 'active' : ''}
              onClick={() => onLyricColorSource('custom')}
            >
              <span className="ls-opt">自定义</span>
            </button>
          </div>
        </div>
        {setting.lyricColorSource === 'custom' && (
          <label className="ls-row">
            <span>基色</span>
            <input
              type="color"
              value={setting.customColor}
              onChange={(e) => onCustomColor(e.target.value)}
              style={{ width: 42, height: 24, border: 'none', background: 'none', cursor: 'pointer' }}
            />
          </label>
        )}
        <div className="ls-row">
          <span>悬浮层次</span>
          <div className="ls-seg">
            <button
              className={setting.layerMode === 'under' ? 'active' : ''}
              onClick={() => onLayerMode('under')}
            >
              卡片之下
            </button>
            <button
              className={setting.layerMode === 'over' ? 'active' : ''}
              onClick={() => onLayerMode('over')}
            >
              卡片之上
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 网易云：官方库二维码登录。 */
function NeteaseLogin({ onSuccess }: { onSuccess: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const unikeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const failRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    stopPoll();
    setQr(null);
    setStatus('正在生成二维码…');
    const res = await window.nebulaAPI.loginQrFor('netease');
    if (!res.ok) {
      setStatus(`获取二维码失败：${res.error}`);
      return;
    }
    unikeyRef.current = res.data.unikey;
    if (res.data.imageDataUrl) {
      setQr(res.data.imageDataUrl);
    } else {
      try {
        setQr(await QRCode.toDataURL(res.data.payload, { width: 180, margin: 1 }));
      } catch {
        setStatus('二维码生成失败，请刷新重试');
        return;
      }
    }
    setStatus('请使用网易云 App 扫码登录');
    failRef.current = 0;
    pollRef.current = window.setInterval(async () => {
      if (!unikeyRef.current) return;
      try {
        const r = await window.nebulaAPI!.loginPollFor('netease', unikeyRef.current);
        if (!r.ok) {
          failRef.current++;
          if (failRef.current >= 3) {
            setStatus(`轮询失败：${r.error}，请刷新二维码`);
            stopPoll();
          } else {
            setStatus(`连接波动，自动重试（${failRef.current}/3）`);
          }
          return;
        }
        failRef.current = 0;
        if (r.data.ok) {
          stopPoll();
          setStatus(r.data.message);
          onSuccess();
        } else {
          setStatus(r.data.message);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
  }, [onSuccess, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  return (
    <div className="pf-flow">
      <div className="pf-status">{status || '未登录网易云'}</div>
      {qr ? <img className="pf-qr" src={qr} alt="网易云登录二维码" /> : <div className="pf-qr is-empty" />}
      <button className="glass-btn" onClick={start}>
        {qr ? '刷新二维码' : '开始扫码登录'}
      </button>
    </div>
  );
}

/** QQ 音乐：官方登录页 + 粘贴 Cookie。 */
function QqLogin({ onSuccess }: { onSuccess: () => void }) {
  const [cookieMode, setCookieMode] = useState(false);
  const [cookieText, setCookieText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const openWindow = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    setStatus('已打开官方登录页，请在窗口内用手机 QQ 扫码并确认…');
    try {
      const r = await window.nebulaAPI.qqLoginWindow();
      const data = r.ok ? r.data : null;
      if (data?.ok) {
        setStatus(data.message ?? '登录成功');
        onSuccess();
      } else {
        setStatus(data?.error ?? '登录窗口已关闭');
      }
    } finally {
      setBusy(false);
    }
  }, [onSuccess]);

  const importCookie = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setBusy(true);
    try {
      const r = await window.nebulaAPI.setCookie('qq', cookieText.trim());
      if (!r.ok) {
        setStatus(`Cookie 无效：${r.error}`);
        return;
      }
      setCookieText('');
      setCookieMode(false);
      setStatus('Cookie 导入成功');
      onSuccess();
    } finally {
      setBusy(false);
    }
  }, [cookieText, onSuccess]);

  return (
    <div className="pf-flow">
      <div className="pf-status">{status || '未登录 QQ 音乐'}</div>
      <button className="glass-btn" disabled={busy} onClick={openWindow}>
        {busy ? '等待官方页登录…' : '打开官方登录页（扫码）'}
      </button>
      <button
        className="glass-btn"
        onClick={() => {
          setCookieMode((v) => !v);
          setStatus('粘贴 QQ 音乐 Cookie（需含 uin 与 music_key / p_skey / skey）');
        }}
      >
        {cookieMode ? '收起 Cookie 粘贴' : '粘贴 Cookie 登录'}
      </button>
      {cookieMode && (
        <div className="pf-cookie">
          <textarea
            className="pf-cookie-input"
            rows={4}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder="粘贴 Cookie…"
            spellCheck={false}
          />
          <button className="glass-btn" disabled={busy || !cookieText.trim()} onClick={importCookie}>
            导入并验证
          </button>
        </div>
      )}
    </div>
  );
}

function SpotifyLogin({ onSuccess }: { onSuccess: () => void }) {
  const [status, setStatus] = useState('');
  const start = useCallback(async () => {
    if (!window.nebulaAPI) return;
    setStatus('正在打开 Spotify 授权窗口…');
    const r = await window.nebulaAPI.spotifyLoginStart();
    if (!r.ok || !r.data) {
      setStatus('授权未完成（需配置 SPOTIFY_CLIENT_ID）');
      return;
    }
    setStatus('授权成功');
    onSuccess();
  }, [onSuccess]);
  return (
    <div className="pf-flow">
      <div className="pf-status">{status || '未登录 Spotify'}</div>
      <button className="glass-btn" onClick={start}>
        使用 Spotify 授权登录
      </button>
    </div>
  );
}

function PlatformLogin({
  platform,
  info,
  account,
  onRefresh,
}: {
  platform: string;
  info: DesktopLoginPlatform;
  account: AccountState | undefined;
  onRefresh: (platform: string) => void;
}) {
  if (info.kind === 'unavailable') {
    return (
      <div className="pf-flow">
        <div className="pf-status">{info.unavailableReason ?? '暂不支持'}</div>
      </div>
    );
  }
  if (account?.loggedIn) {
    return (
      <div className="acct-card">
        {account.avatarUrl ? (
          <img className="acct-avatar" src={account.avatarUrl} alt="" />
        ) : (
          <span className="acct-avatar is-ph" />
        )}
        <div className="acct-name">{account.nickname ?? '已登录'}</div>
        <div className="acct-vip">
          {account.isSvip ? 'SVIP' : account.isVip ? 'VIP' : '普通用户'}
        </div>
        <div className="acct-actions">
          <button
            className="glass-btn"
            onClick={() => window.nebulaAPI?.clearCookie(platform).then(() => onRefresh(platform))}
          >
            退出登录
          </button>
        </div>
      </div>
    );
  }
  if (platform === 'netease') return <NeteaseLogin onSuccess={() => onRefresh('netease')} />;
  if (platform === 'qq') return <QqLogin onSuccess={() => onRefresh('qq')} />;
  if (platform === 'spotify') return <SpotifyLogin onSuccess={() => onRefresh('spotify')} />;
  return <div className="pf-flow"><div className="pf-status">暂不支持该平台登录</div></div>;
}

const COVER_MODES: Array<{ id: CoverBgMode; name: string }> = [
  { id: 'fill', name: '原图直铺' },
  { id: 'frosted', name: '磨砂暗化' },
  { id: 'blend', name: '混合层' },
  { id: 'color', name: '纯色纹理' },
  { id: 'palette', name: '仅取色' },
];

/** 背景设置：三大玻璃方案卡 + 封面二级模式展开。 */
function BackgroundSettings({
  bgSetting,
  coverMode,
  onSelect,
  onFile,
  onCoverMode,
  onOpenWallpapers,
}: {
  bgSetting: BackgroundSetting;
  coverMode: CoverBgMode;
  onSelect: (s: BackgroundSetting) => void;
  onFile: (f: File) => void;
  onCoverMode: (m: CoverBgMode) => void;
  onOpenWallpapers: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scheme, setScheme] = useState<'custom' | 'wallpaper' | 'cover'>(
    bgSetting.type === 'cover' ? 'cover' : 'custom',
  );
  const isCover = scheme === 'cover';

  return (
    <div className="bg-schemes-wrap">
      <div className={`bg-schemes${isCover ? ' is-cover' : ''}`}>
        <button
          type="button"
          className={`bg-scheme fx-medium${scheme === 'custom' ? ' is-active' : ''}`}
          onClick={() => {
            setScheme('custom');
            inputRef.current?.click();
          }}
        >
          <span className="bs-title">自定义背景</span>
          <span className="bs-desc">上传图片 / 视频作为背景</span>
        </button>
        <button
          type="button"
          className={`bg-scheme fx-medium${scheme === 'wallpaper' ? ' is-active' : ''}`}
          onClick={() => {
            setScheme('wallpaper');
            onOpenWallpapers();
          }}
        >
          <span className="bs-title">Wallpaper 壁纸</span>
          <span className="bs-desc">从本机 Wallpaper Engine 库选择</span>
        </button>
        <button
          type="button"
          className={`bg-scheme fx-medium${isCover ? ' is-active' : ''}`}
          onClick={() => {
            setScheme('cover');
            onSelect({ type: 'cover' });
          }}
        >
          <span className="bs-title">跟随当前播放歌曲封面</span>
          <span className="bs-desc">自动加载正在播放歌曲的封面作为背景</span>
        </button>
      </div>
      {isCover && (
        <motion.div
          className="dock-cover-modes"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {COVER_MODES.map((m) => (
            <button
              key={m.id}
              className={`bg-mode-btn fx-soft${coverMode === m.id ? ' active' : ''}`}
              onClick={() => onCoverMode(m.id)}
            >
              {m.name}
            </button>
          ))}
        </motion.div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <p className="bg-hint">视频与大于 2.5MB 的图片仅在本次会话生效</p>
    </div>
  );
}

/** 界面设置：沉浸模式（隐藏 Z2 卡片 / 隐藏 Z1 歌词）。 */
function InterfaceSettings({
  uiHideCards,
  uiHideLyrics,
  onToggleHideCards,
  onToggleHideLyrics,
}: {
  uiHideCards: boolean;
  uiHideLyrics: boolean;
  onToggleHideCards: () => void;
  onToggleHideLyrics: () => void;
}) {
  return (
    <div className="ui-settings">
      <div className="ui-row">
        <div className="ui-row-text">
          <span>隐藏主界面歌曲卡片</span>
          <em>沉浸式欣赏壁纸与歌词时隐藏 Z2 卡片云</em>
        </div>
        <Toggle small checked={uiHideCards} onChange={onToggleHideCards} label="隐藏主界面歌曲卡片" />
      </div>
      <div className="ui-row">
        <div className="ui-row-text">
          <span>隐藏空域歌词层</span>
          <em>隐藏 Z1 穿梭歌词，仅保留壁纸沉浸效果</em>
        </div>
        <Toggle small checked={uiHideLyrics} onChange={onToggleHideLyrics} label="隐藏空域歌词层" />
      </div>
    </div>
  );
}

/** 系统设置：主题（液态预留）/ 会话记忆 / 关于。 */
function SystemSettings() {
  return (
    <div className="ui-settings">
      <div className="ui-row">
        <div className="ui-row-text">
          <span>界面主题</span>
          <em>材质主题切换；液态玻璃开发中，后续上线</em>
        </div>
        <div className="ls-seg">
          <button className="active" title="当前主题">
            磨砂玻璃
          </button>
          <button disabled title="开发中">
            液态玻璃
          </button>
        </div>
      </div>
      <div className="ui-row">
        <div className="ui-row-text">
          <span>会话记忆</span>
          <em>自动恢复上次导入的歌单与播放歌曲</em>
        </div>
        <b className="ui-row-value">已启用</b>
      </div>
      <div className="ui-row">
        <div className="ui-row-text">
          <span>关于</span>
          <em>Music Nebula v0.1.0 · Electron 桌面音乐播放器</em>
        </div>
      </div>
    </div>
  );
}

/**
 * 右侧 Dock：登录 / 设置 两球 → 胶囊 → 上移展开窗口。
 * 与左侧 Dock 对称，共用小球/胶囊/窗口交互语言。
 */
export function AccountDock({
  visible,
  platforms,
  accounts,
  selectedPlatform,
  loginNonce,
  bgSetting,
  coverMode,
  lyricSettings,
  uiHideCards,
  uiHideLyrics,
  onEnter,
  onLeave,
  onSelectPlatform,
  onRefreshAccount,
  onSelectBg,
  onFile,
  onCoverMode,
  onOpenWallpapers,
  onFontSize,
  onHighlightStyle,
  onLayerMode,
  onCurrentScale,
  onWordRise,
  onLyricLayout,
  onLyricColorSource,
  onCustomColor,
  onLyricBold,
  onToggleHideCards,
  onToggleHideLyrics,
}: AccountDockProps) {
  const { capW, ball } = useDockMetrics();
  const [hoverBall, setHoverBall] = useState<'login' | 'settings' | null>(null);
  const [openBall, setOpenBall] = useState<'login' | 'settings' | null>(null);
  const [activePlatform, setActivePlatform] = useState(selectedPlatform);
  const [settingsPage, setSettingsPage] = useState<DockSettingsPage>('system');

  const loggedCount = DOCK_PLATFORM_ORDER.filter((p) => accounts[p]?.loggedIn).length;
  const avatarUrl =
    DOCK_PLATFORM_ORDER.map((p) => accounts[p]).find((a) => a?.loggedIn && a.avatarUrl)?.avatarUrl ?? null;

  // 外部「去登录」：打开登录球窗口并选中对应平台
  useEffect(() => {
    if (!loginNonce) return;
    setActivePlatform(selectedPlatform);
    setOpenBall('login');
    setHoverBall(null);
  }, [loginNonce, selectedPlatform]);

  // 设置窗口每次打开默认进入系统设置页
  useEffect(() => {
    if (openBall === 'settings') setSettingsPage('system');
  }, [openBall]);

  // 面板收回时复位
  useEffect(() => {
    if (!visible) {
      setHoverBall(null);
      setOpenBall(null);
    }
  }, [visible]);

  const info = platforms.find((p) => p.platform === activePlatform);
  const rows: Array<{ id: 'login' | 'settings'; name: string }> = [
    { id: 'login', name: '账号登录' },
    { id: 'settings', name: '设置' },
  ];

  const loginWindow = (
    <div className="dock-window-body">
      <div className="dock-win-head">
        <span className="dock-win-title">账号登录</span>
        <span className="dock-win-sub">{loggedCount}/{DOCK_PLATFORM_ORDER.length} 已登录</span>
      </div>
      <div className="login-cards">
        {DOCK_PLATFORM_ORDER.map((p, i) => {
          const meta = platformMeta(p);
          const on = !!accounts[p]?.loggedIn;
          return (
            <div
              key={p}
              className={`lc${activePlatform === p ? ' is-active' : ''}${on ? ' is-on' : ''}`}
              style={{ '--brand': meta.brand, transitionDelay: `${i * 0.04}s` } as React.CSSProperties}
              onClick={() => {
                setActivePlatform(p);
                onSelectPlatform(p);
              }}
            >
              <div className="lc-inner">
                <span className="lc-head">
                  <img src={meta.logo} alt="" draggable={false} />
                </span>
                <span className="lc-body">
                  <span className="nm">
                    <JumpText text={meta.name} delay={0.08 + i * 0.05} />
                  </span>
                  <span className="st">{on ? '已登录' : '未登录'}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="dock-login-detail">
        {info && (
          <PlatformLogin
            platform={info.platform}
            info={info}
            account={accounts[info.platform]}
            onRefresh={onRefreshAccount}
          />
        )}
      </div>
    </div>
  );

  const settingsWindow = (
    <div className="dock-window-body">
      <div className="dock-win-head">
        <span className="dock-win-title">设置</span>
      </div>
      <div className="dock-settings-tabs">
        {(
          [
            ['lyrics', '歌词设置'],
            ['interface', '界面设置'],
            ['background', '背景设置'],
            ['system', '系统设置'],
          ] as Array<[DockSettingsPage, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`fx-soft${settingsPage === id ? ' active' : ''}`}
            onClick={() => setSettingsPage(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dock-settings-body">
        <AnimatedHeight>
          {settingsPage === 'lyrics' ? (
            <LyricSettings
              setting={lyricSettings}
              onFontSize={onFontSize}
              onHighlightStyle={onHighlightStyle}
              onLayerMode={onLayerMode}
              onCurrentScale={onCurrentScale}
              onWordRise={onWordRise}
              onLyricLayout={onLyricLayout}
              onLyricColorSource={onLyricColorSource}
              onCustomColor={onCustomColor}
              onLyricBold={onLyricBold}
            />
          ) : settingsPage === 'interface' ? (
            <InterfaceSettings
              uiHideCards={uiHideCards}
              uiHideLyrics={uiHideLyrics}
              onToggleHideCards={onToggleHideCards}
              onToggleHideLyrics={onToggleHideLyrics}
            />
          ) : settingsPage === 'background' ? (
            <BackgroundSettings
              bgSetting={bgSetting}
              coverMode={coverMode}
              onSelect={onSelectBg}
              onFile={onFile}
              onCoverMode={onCoverMode}
              onOpenWallpapers={onOpenWallpapers}
            />
          ) : (
            <SystemSettings />
          )}
        </AnimatedHeight>
      </div>
    </div>
  );

  return (
    <aside
      className={`edge-panel edge-right dock dock-right${visible ? ' is-open' : ''}${openBall ? ' is-window-open' : ''}`}
      style={{ '--dock-cap-w': `${capW}px`, '--dock-ball': `${ball}px` } as React.CSSProperties}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="dock-stack">
        {rows.map((row, i) => {
          const expanded = hoverBall === row.id || openBall === row.id;
          return (
            <motion.div
              layout
              key={row.id}
              custom={i}
              variants={rowVariants}
              initial="hidden"
              animate={visible ? 'show' : 'hidden'}
              className={`dock-row dock-row-${row.id}${openBall === row.id ? ' is-open' : ''}`}
              style={{ zIndex: 20 + i, '--brand': '#8b93b8' } as React.CSSProperties}
              transition={ROW_SPRING}
              onPointerEnter={() => setHoverBall(row.id)}
              onPointerLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverBall(null);
              }}
            >
              <div
                role="button"
                aria-label={row.name}
                className={`dock-pill${expanded ? ' is-expanded' : ''}${openBall === row.id ? ' is-open' : ''}`}
                style={{ width: expanded ? capW : ball } as React.CSSProperties}
                onClick={() => setOpenBall((v) => (v === row.id ? null : row.id))}
              >
                <span className="pill-icon">
                  {row.id === 'login' ? (
                    avatarUrl ? (
                      <img className="dock-avatar" src={avatarUrl} alt="" draggable={false} />
                    ) : (
                      <svg className="dock-user-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21c1.2-3.8 4.2-5.6 8-5.6s6.8 1.8 8 5.6" />
                      </svg>
                    )
                  ) : (
                    <svg className="dock-user-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10" />
                      <path d="M12 2a10 10 0 0 0-10 10 10 10 0 0 0 10 10" />
                    </svg>
                  )}
                  {row.id === 'login' && loggedCount > 0 && <span className="dock-dot" title={`${loggedCount} 个平台已登录`} />}
                </span>
                {row.id === 'login' ? (
                  <>
                    <span className="pill-dots">
                      {DOCK_PLATFORM_ORDER.map((p) => {
                        const meta = platformMeta(p);
                        const on = !!accounts[p]?.loggedIn;
                        return (
                          <span
                            key={p}
                            className={`pill-dot${on ? ' is-on' : ''}`}
                            style={{ '--brand': meta.brand } as React.CSSProperties}
                            title={`${meta.name}${on ? ' · 已登录' : ' · 未登录'}`}
                          >
                            <img src={meta.logo} alt="" draggable={false} />
                          </span>
                        );
                      })}
                    </span>
                    <span className="pill-badge">
                      <JumpText text={loggedCount ? `${loggedCount}/5 已登录` : '未登录'} />
                    </span>
                  </>
                ) : (
                  <span className="pill-cap">
                    <JumpText text="自定义歌词 · 布局 · 背景 · 系统" />
                  </span>
                )}
                <span className="pill-go">›</span>
              </div>
              <div className="dock-window">
                <div className="dock-window-body">{row.id === 'login' ? loginWindow : settingsWindow}</div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </aside>
  );
}
