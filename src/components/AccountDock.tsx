import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { DesktopLoginPlatform } from '../lib/playlist/ipcClient';
import type { AccountState } from '../lib/accounts';
import type { BackgroundSetting } from '../lib/backgrounds';
import type { CoverBgMode } from './BackgroundLayer';
import type { LyricVisualSettings } from './LyricsLayer';
import { DOCK_PLATFORM_ORDER, platformMeta } from './platforms';

export type DockSettingsPage = 'lyrics' | 'ui' | 'bg' | 'system';

interface AccountDockProps {
  visible: boolean;
  platforms: DesktopLoginPlatform[];
  accounts: Record<string, AccountState>;
  selectedPlatform: string;
  /** 外部「去登录」请求计数：变化时打开登录胶囊并选中对应平台。 */
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

/** 开关：silent-otter-72 复刻（原型原样）。 */
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

/** 单选组：slimy-chipmunk-97 复刻（双栏玻璃滑轨，双银色）。 */
function GlassRadioGroup({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const safe = name.replace(/[^a-z0-9]/gi, '');
  return (
    <div className="glass-radio-group">
      {options.map((o) => (
        <Fragment key={o.value}>
          <input
            type="radio"
            name={safe}
            id={`${safe}-${o.value}`}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          <label htmlFor={`${safe}-${o.value}`}>{o.label}</label>
        </Fragment>
      ))}
      <div className="glass-glider" />
    </div>
  );
}

/** 网易云：官方库二维码登录（主项目既有实现）。 */
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

/** QQ 音乐：官方登录页 + 粘贴 Cookie（主项目既有实现）。 */
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

/**
 * 右侧 Dock（登录 / 设置）—— 原型 dock-prototype-v3.html 的逐行移植。
 * 视觉真源：prototype/dock-prototype-v3.html（用户已验证定稿，勿改结构/类名）。
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
  const [openRow, setOpenRow] = useState<'login' | 'settings' | null>(null);
  const [activePlatform, setActivePlatform] = useState(selectedPlatform);
  const [settingsPage, setSettingsPage] = useState<DockSettingsPage>('system');
  const [bgScheme, setBgScheme] = useState<'custom' | 'wallpaper' | 'cover'>(
    bgSetting.type === 'cover' ? 'cover' : 'custom',
  );
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const flipRef = useRef<{ id: string; from: number } | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const loggedCount = DOCK_PLATFORM_ORDER.filter((p) => accounts[p]?.loggedIn).length;
  const avatarUrl =
    DOCK_PLATFORM_ORDER.map((p) => accounts[p]).find((a) => a?.loggedIn && a.avatarUrl)?.avatarUrl ?? null;

  // 外部「去登录」：打开登录胶囊并选中对应平台
  useEffect(() => {
    if (!loginNonce) return;
    setActivePlatform(selectedPlatform);
    setOpenRow('login');
  }, [loginNonce, selectedPlatform]);

  // 面板收回时复位
  useEffect(() => {
    if (!visible) setOpenRow(null);
  }, [visible]);

  // 原型 flipRow：开/关窗口时该行 FLIP 上移置顶，dock 整体上移
  useLayoutEffect(() => {
    const f = flipRef.current;
    flipRef.current = null;
    if (!f) return;
    const row = rowRefs.current.get(f.id);
    if (!row) return;
    const to = row.getBoundingClientRect().top;
    const dy = f.from - to;
    if (Math.abs(dy) < 1) return;
    row.style.transition = 'none';
    row.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        row.style.transition = 'transform 0.55s var(--jelly-win)';
        row.style.transform = 'translateY(0)';
      });
    });
  }, [openRow]);

  const handleRowClick = (id: 'login' | 'settings') => {
    const row = rowRefs.current.get(id);
    flipRef.current = { id, from: row ? row.getBoundingClientRect().top : 0 };
    setOpenRow((v) => (v === id ? null : id));
  };

  const info = platforms.find((p) => p.platform === activePlatform);
  const activeAccount = accounts[activePlatform];

  const loginDetail = activeAccount?.loggedIn ? (
    <>
      <div className="acct-name">{activeAccount.nickname ?? '已登录'}</div>
      <div className="acct-vip">
        {activeAccount.isSvip ? 'SVIP' : activeAccount.isVip ? 'VIP' : '普通用户'} · {platformMeta(activePlatform).name}
      </div>
      <button
        className="ghost-btn"
        onClick={() => window.nebulaAPI?.clearCookie(activePlatform).then(() => onRefreshAccount(activePlatform))}
      >
        退出登录
      </button>
    </>
  ) : info ? (
    <PlatformLogin
      platform={info.platform}
      info={info}
      account={accounts[info.platform]}
      onRefresh={onRefreshAccount}
    />
  ) : null;

  const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));
  const loginWindow = (
    <>
      <div className="win-title">
        <span>账号登录</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.45)' }}>
          {loggedCount}/{DOCK_PLATFORM_ORDER.length} 已登录
        </span>
      </div>
      <div className="login-cards">
        {DOCK_PLATFORM_ORDER.map((p) => {
          const meta = platformMeta(p);
          const on = !!accounts[p]?.loggedIn;
          return (
            <div
              key={p}
              className={`lc${activePlatform === p ? ' is-active' : ''}${on ? ' is-on' : ''}`}
              style={{ '--brand': meta.brand } as React.CSSProperties}
              onClick={() => {
                setActivePlatform(p);
                onSelectPlatform(p);
              }}
            >
              <div className="lc-inner">
                <span className="lc-head">
                  <img src={meta.logo} alt="" draggable={false} />
                </span>
                <div className="lc-body">
                  <span className="nm">{meta.name}</span>
                  <span className="st">{on ? '已登录' : '未登录'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="login-detail">{loginDetail}</div>
    </>
  );

  const settingsWindow = (
    <>
      <div className="win-title">
        <span>设置</span>
      </div>
      <div className="set-tabs">
        <span className={settingsPage === 'lyrics' ? 'active' : ''} onClick={() => setSettingsPage('lyrics')}>
          歌词设置
        </span>
        <span className={settingsPage === 'ui' ? 'active' : ''} onClick={() => setSettingsPage('ui')}>
          界面设置
        </span>
        <span className={settingsPage === 'bg' ? 'active' : ''} onClick={() => setSettingsPage('bg')}>
          背景设置
        </span>
        <span className={settingsPage === 'system' ? 'active' : ''} onClick={() => setSettingsPage('system')}>
          系统设置
        </span>
      </div>

      <div className={`set-page${settingsPage === 'lyrics' ? ' active' : ''}`}>
        <div className="ls-card">
          <h4>基础文字</h4>
          <div className="ls-row">
            <span>字体大小</span>
            <input
              type="range"
              min={14}
              max={maxFont}
              step={1}
              value={lyricSettings.fontSize}
              onChange={(e) => onFontSize(Number(e.target.value))}
            />
            <span className="val">{lyricSettings.fontSize}px</span>
          </div>
          <div className="ls-row">
            <span>歌词加粗</span>
            <span className="val" style={{ marginLeft: 'auto' }}>
              <Toggle small checked={!!lyricSettings.bold} onChange={onLyricBold} label="歌词加粗" />
            </span>
          </div>
        </div>
        <div className="ls-card">
          <h4>高亮与动效</h4>
          <div className="ls-row">
            <span>高亮风格</span>
            <GlassRadioGroup
              name="highlight"
              options={[
                { value: 'sweep', label: '扫光填充' },
                { value: 'float', label: '上浮发光' },
              ]}
              value={lyricSettings.highlightStyle}
              onChange={(v) => onHighlightStyle(v as LyricVisualSettings['highlightStyle'])}
            />
          </div>
          <div className="ls-row">
            <span>当前句放大</span>
            <input
              type="range"
              min={1}
              max={1.6}
              step={0.02}
              value={lyricSettings.currentScale}
              onChange={(e) => onCurrentScale(Number(e.target.value))}
            />
            <span className="val">{lyricSettings.currentScale.toFixed(2)}×</span>
          </div>
          <div className="ls-row">
            <span>逐字上浮</span>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={lyricSettings.wordRise}
              onChange={(e) => onWordRise(Number(e.target.value))}
            />
            <span className="val">{lyricSettings.wordRise}px</span>
          </div>
        </div>
        <div className="ls-card">
          <h4>布局与层级</h4>
          <div className="ls-row">
            <span>歌词布局</span>
            <GlassRadioGroup
              name="layout"
              options={[
                { value: 'stacked', label: '上下堆叠' },
                { value: 'offset', label: '上下错落' },
              ]}
              value={lyricSettings.lyricLayout}
              onChange={(v) => onLyricLayout(v as LyricVisualSettings['lyricLayout'])}
            />
          </div>
          <div className="ls-row">
            <span>歌词取色</span>
            <GlassRadioGroup
              name="color"
              options={[
                { value: 'cover', label: '封面取色' },
                { value: 'custom', label: <span className="ls-opt">自定义</span> },
              ]}
              value={lyricSettings.lyricColorSource}
              onChange={(v) => onLyricColorSource(v as LyricVisualSettings['lyricColorSource'])}
            />
          </div>
          {lyricSettings.lyricColorSource === 'custom' && (
            <div className="ls-row">
              <span>基色</span>
              <input
                type="color"
                value={lyricSettings.customColor}
                onChange={(e) => onCustomColor(e.target.value)}
                style={{ width: 42, height: 24, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </div>
          )}
          <div className="ls-row">
            <span>悬浮层次</span>
            <GlassRadioGroup
              name="layer"
              options={[
                { value: 'under', label: '卡片之下' },
                { value: 'over', label: '卡片之上' },
              ]}
              value={lyricSettings.layerMode}
              onChange={(v) => onLayerMode(v as LyricVisualSettings['layerMode'])}
            />
          </div>
        </div>
      </div>

      <div className={`set-page${settingsPage === 'ui' ? ' active' : ''}`}>
        <div className="ui-row">
          <div className="txt">
            <span>隐藏主界面歌曲卡片</span>
            <em>沉浸式欣赏壁纸与歌词时隐藏 Z2 卡片云</em>
          </div>
          <Toggle small checked={uiHideCards} onChange={onToggleHideCards} label="隐藏主界面歌曲卡片" />
        </div>
        <div className="ui-row">
          <div className="txt">
            <span>隐藏空域歌词层</span>
            <em>隐藏 Z1 穿梭歌词，仅保留壁纸沉浸效果</em>
          </div>
          <Toggle small checked={uiHideLyrics} onChange={onToggleHideLyrics} label="隐藏空域歌词层" />
        </div>
      </div>

      <div className={`set-page${settingsPage === 'bg' ? ' active' : ''}`}>
        <button
          type="button"
          className={`bg-scheme fx-medium${bgScheme === 'custom' ? ' is-active' : ''}`}
          onClick={() => {
            setBgScheme('custom');
            bgInputRef.current?.click();
          }}
        >
          <span className="bs-title">自定义背景</span>
          <span className="bs-desc">上传图片 / 视频作为背景</span>
        </button>
        <button
          type="button"
          className={`bg-scheme fx-medium${bgScheme === 'wallpaper' ? ' is-active' : ''}`}
          onClick={() => {
            setBgScheme('wallpaper');
            onOpenWallpapers();
          }}
        >
          <span className="bs-title">Wallpaper 壁纸</span>
          <span className="bs-desc">从本机 Wallpaper Engine 库选择</span>
        </button>
        <button
          type="button"
          className={`bg-scheme fx-medium${bgScheme === 'cover' ? ' is-active' : ''}`}
          onClick={() => {
            setBgScheme('cover');
            onSelectBg({ type: 'cover' });
          }}
        >
          <span className="bs-title">跟随当前播放歌曲封面</span>
          <span className="bs-desc">自动加载正在播放歌曲的封面作为背景</span>
        </button>
        <div className="cover-modes">
          {COVER_MODES.map((m) => (
            <span key={m.id} className={coverMode === m.id ? 'active' : ''} onClick={() => onCoverMode(m.id)}>
              {m.name}
            </span>
          ))}
        </div>
        <input
          ref={bgInputRef}
          type="file"
          accept="image/*,video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className={`set-page${settingsPage === 'system' ? ' active' : ''}`}>
        <div className="ui-row">
          <div className="txt">
            <span>界面主题</span>
            <em>材质主题切换；液态玻璃开发中</em>
          </div>
          <GlassRadioGroup
            name="theme"
            options={[
              { value: 'frost', label: '磨砂玻璃' },
              { value: 'liquid', label: '液态玻璃', disabled: true },
            ]}
            value="frost"
            onChange={() => {
              /* 液态开发中，仅磨砂可选 */
            }}
          />
        </div>
        <div className="ui-row">
          <div className="txt">
            <span>会话记忆</span>
            <em>自动恢复上次导入的歌单与播放歌曲</em>
          </div>
          <span className="val" style={{ color: '#6ee7b7' }}>
            已启用
          </span>
        </div>
        <div className="ui-row">
          <div className="txt">
            <span>关于</span>
            <em>Music Nebula v0.1.0 · Electron 桌面音乐播放器</em>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div
      className={`dock dock-right${visible ? ' is-open' : ''}${openRow ? ' has-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div
        ref={(el) => {
          if (el) rowRefs.current.set('login', el);
          else rowRefs.current.delete('login');
        }}
        className={`row${openRow === 'login' ? ' open' : ''}`}
        data-name="login"
        style={{ '--brand': '#8b93b8' } as React.CSSProperties}
      >
        <button type="button" className="pill" onClick={() => handleRowClick('login')}>
          <span
            className="icon"
            style={avatarUrl ? undefined : { background: 'linear-gradient(135deg,#5f6c9e,#2c3352)' }}
          >
            {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} /> : '人'}
          </span>
          <span className="dots">
            {DOCK_PLATFORM_ORDER.map((p) => {
              const meta = platformMeta(p);
              const on = !!accounts[p]?.loggedIn;
              return (
                <span
                  key={p}
                  className={`dot${on ? ' is-on' : ''}`}
                  style={{ '--brand': meta.brand } as React.CSSProperties}
                  title={`${meta.name}${on ? ' · 已登录' : ' · 未登录'}`}
                >
                  <img src={meta.logo} alt="" draggable={false} />
                </span>
              );
            })}
          </span>
          <span className="badge">
            {loggedCount}/{DOCK_PLATFORM_ORDER.length} 已登录
          </span>
          <span className="go">›</span>
        </button>
        <div className="win">
          <div className="win-inner">{loginWindow}</div>
        </div>
      </div>

      <div
        ref={(el) => {
          if (el) rowRefs.current.set('settings', el);
          else rowRefs.current.delete('settings');
        }}
        className={`row${openRow === 'settings' ? ' open' : ''}`}
        data-name="settings"
        style={{ '--brand': '#8b93b8' } as React.CSSProperties}
      >
        <button type="button" className="pill" onClick={() => handleRowClick('settings')}>
          <span className="icon" style={{ fontSize: 13 }}>
            ⚙
          </span>
          <span className="cap-text">自定义歌词 · 布局 · 背景 · 系统</span>
          <span className="go">›</span>
        </button>
        <div className="win">
          <div className="win-inner">{settingsWindow}</div>
        </div>
      </div>
    </div>
  );
}
