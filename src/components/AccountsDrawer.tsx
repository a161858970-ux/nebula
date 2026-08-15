import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { DesktopLoginPlatform } from '../lib/playlist/ipcClient';
import type { AccountState } from '../lib/accounts';
import type { BackgroundSetting } from '../lib/backgrounds';
import type { CoverBgMode } from './BackgroundLayer';
import { BackgroundPicker } from './BackgroundPicker';
import type { LyricVisualSettings } from './LyricsLayer';

export type DrawerTab = 'accounts' | 'background' | 'lyrics';

interface AccountsDrawerProps {
  visible: boolean;
  tab: DrawerTab;
  selectedPlatform: string;
  platforms: DesktopLoginPlatform[];
  accounts: Record<string, AccountState>;
  bgSetting: BackgroundSetting;
  coverMode: CoverBgMode;
  onEnter: () => void;
  onLeave: () => void;
  onTabChange: (tab: DrawerTab) => void;
  onSelectPlatform: (platform: string) => void;
  onRefreshAccount: (platform: string) => void;
  onSelectBg: (s: BackgroundSetting) => void;
  onFile: (f: File) => void;
  onCoverMode: (m: CoverBgMode) => void;
  lyricSettings: LyricVisualSettings;
  onFontSize: (n: number) => void;
  onHighlightStyle: (s: LyricVisualSettings['highlightStyle']) => void;
  onWordHighlight: (b: boolean) => void;
  onLayerMode: (m: LyricVisualSettings['layerMode']) => void;
  onCurrentScale: (n: number) => void;
  onWordRise: (n: number) => void;
  onLyricLayout: (m: LyricVisualSettings['lyricLayout']) => void;
  onLyricColorSource: (s: LyricVisualSettings['lyricColorSource']) => void;
  onCustomColor: (c: string) => void;
  onOpenWallpapers: () => void;
}

interface LyricSettingsProps {
  setting: LyricVisualSettings;
  onFontSize: (n: number) => void;
  onHighlightStyle: (s: LyricVisualSettings['highlightStyle']) => void;
  onWordHighlight: (b: boolean) => void;
  onLayerMode: (m: LyricVisualSettings['layerMode']) => void;
  onCurrentScale: (n: number) => void;
  onWordRise: (n: number) => void;
  onLyricLayout: (m: LyricVisualSettings['lyricLayout']) => void;
  onLyricColorSource: (s: LyricVisualSettings['lyricColorSource']) => void;
  onCustomColor: (c: string) => void;
}

/** 歌词设置：字号 / 高亮风格 / 逐字开关。 */
function LyricSettings({
  setting,
  onFontSize,
  onHighlightStyle,
  onWordHighlight,
  onLayerMode,
  onCurrentScale,
  onWordRise,
  onLyricLayout,
  onLyricColorSource,
  onCustomColor,
}: LyricSettingsProps) {
  const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));
  return (
    <div className="lyric-settings">
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
        <span>逐字高亮</span>
        <input
          type="checkbox"
          checked={setting.wordHighlight}
          onChange={(e) => onWordHighlight(e.target.checked)}
        />
      </label>
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
      <div className="ls-row">
        <span>三句布局</span>
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
            自定义
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
            style={{ width: 46, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
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

/** QQ 音乐：旧二维码接口已封禁 → 官方登录页 + 粘贴 Cookie。 */
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

function PlatformLogin({ platform, info, account, onRefresh }: {
  platform: string;
  info: DesktopLoginPlatform;
  account: AccountState | undefined;
  onRefresh: (platform: string) => void;
}) {
  if (info.kind === 'unavailable') {
    return <div className="pf-flow"><div className="pf-status">{info.unavailableReason ?? '暂不支持'}</div></div>;
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
          <button className="glass-btn" onClick={() => window.nebulaAPI?.clearCookie(platform).then(() => onRefresh(platform))}>
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

/** 右侧边缘感应抽屉：账号管理（多平台并行） + 背景设置。 */
export function AccountsDrawer({
  visible,
  tab,
  selectedPlatform,
  platforms,
  accounts,
  bgSetting,
  coverMode,
  onEnter,
  onLeave,
  onTabChange,
  onSelectPlatform,
  onRefreshAccount,
  onSelectBg,
  onFile,
  onCoverMode,
  lyricSettings,
  onFontSize,
  onHighlightStyle,
  onWordHighlight,
  onLayerMode,
  onCurrentScale,
  onWordRise,
  onLyricLayout,
  onLyricColorSource,
  onCustomColor,
  onOpenWallpapers,
}: AccountsDrawerProps) {
  const info = platforms.find((p) => p.platform === selectedPlatform);

  return (
    <aside
      className={`edge-panel edge-right drawer${visible ? ' is-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="drawer-tabs">
        <button className={tab === 'accounts' ? 'active' : ''} onClick={() => onTabChange('accounts')}>
          账号
        </button>
        <button className={tab === 'background' ? 'active' : ''} onClick={() => onTabChange('background')}>
          背景
        </button>
        <button className={tab === 'lyrics' ? 'active' : ''} onClick={() => onTabChange('lyrics')}>
          歌词
        </button>
      </div>

      {tab === 'lyrics' ? (
        <LyricSettings
          setting={lyricSettings}
          onFontSize={onFontSize}
          onHighlightStyle={onHighlightStyle}
          onWordHighlight={onWordHighlight}
          onLayerMode={onLayerMode}
          onCurrentScale={onCurrentScale}
          onWordRise={onWordRise}
          onLyricLayout={onLyricLayout}
          onLyricColorSource={onLyricColorSource}
          onCustomColor={onCustomColor}
        />
      ) : tab === 'background' ? (
        <BackgroundPicker
          setting={bgSetting}
          coverMode={coverMode}
          onSelect={onSelectBg}
          onFile={onFile}
          onCoverMode={onCoverMode}
          onOpenWallpapers={onOpenWallpapers}
        />
      ) : (
        <div className="accounts-body">
          <div className="accounts-left">
            {platforms.map((p) => (
              <button
                key={p.platform}
                className={`acct-tab${selectedPlatform === p.platform ? ' active' : ''}`}
                onClick={() => onSelectPlatform(p.platform)}
              >
                <span>{p.name}</span>
                {accounts[p.platform]?.loggedIn && <em className="acct-dot" title="已登录" />}
              </button>
            ))}
          </div>
          <div className="accounts-right">
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
      )}
    </aside>
  );
}
