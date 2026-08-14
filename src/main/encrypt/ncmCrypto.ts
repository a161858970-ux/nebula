import crypto from 'node:crypto';

/**
 * 网易云 weapi / eapi 加密实现（对齐 NeteaseCloudMusicApi util/crypto.js）。
 *
 * - weapi：双层 AES-128-CBC + RSA（无填充），输出 params + encSecKey
 * - eapi ：MD5 签名 + AES-128-ECB，输出大写 Hex params
 * - eapiResDecrypt：解密 e_r=true 的 Hex 响应
 */

const AES_KEY = Buffer.from('0CoJUm6Qyw8W8jud', 'utf8');
const IV = Buffer.from('0102030405060708', 'utf8');
const EAPI_KEY = Buffer.from('e82ckenh8dichen8', 'utf8');
const RSA_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ3' +
  '7BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvakl' +
  'V8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44o' +
  'ncaTWz7OBGLbCiK45wIDAQAB\n' +
  '-----END PUBLIC KEY-----';

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomStr(len: number, charset = BASE62): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += charset[bytes[i] % charset.length];
  return out;
}

function aesCbcEncrypt(text: string, key: Buffer, iv: Buffer): string {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

function aesEcbEncryptHex(text: string, key: Buffer): string {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
}

function aesEcbDecryptHex(hexText: string, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(Buffer.from(hexText, 'hex')), decipher.final()]);
}

/** RSA 无填充（textbook RSA），输出 256 位 Hex。 */
function rsaEncryptNoPadding(text: string): string {
  // 无填充模式要求明文长度 == 模长（1024-bit / 8 = 128 字节），左侧补零
  const plain = Buffer.alloc(128);
  Buffer.from(text, 'utf8').copy(plain, 128 - Buffer.byteLength(text, 'utf8'));
  const encrypted = crypto.publicEncrypt(
    {
      key: RSA_PUBLIC_KEY,
      padding: crypto.constants.RSA_NO_PADDING,
    },
    plain,
  );
  return encrypted.toString('hex');
}

/** weapi：双层 AES-CBC + RSA 随机密钥。 */
export function weapiEncrypt(object: Record<string, unknown>): { params: string; encSecKey: string } {
  const text = JSON.stringify(object);
  const secretKey = randomStr(16);
  const first = aesCbcEncrypt(text, AES_KEY, IV);
  const params = aesCbcEncrypt(first, Buffer.from(secretKey, 'utf8'), IV);
  const encSecKey = rsaEncryptNoPadding(secretKey.split('').reverse().join(''));
  return { params, encSecKey };
}

/** eapi：MD5 签名 + AES-128-ECB，返回大写 Hex params。 */
export function eapiEncrypt(urlPath: string, object: Record<string, unknown>): { params: string } {
  const text = JSON.stringify(object);
  const message = `nobody${urlPath}use${text}md5forencrypt`;
  const digest = crypto.createHash('md5').update(message, 'utf8').digest('hex');
  const data = `${urlPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return { params: aesEcbEncryptHex(data, EAPI_KEY) };
}

/** 解密 eapi 加密响应（Hex -> AES-ECB -> JSON）。 */
export function eapiDecryptResponse(hexText: string): unknown {
  const plain = aesEcbDecryptHex(hexText.replace(/\s+/g, ''), EAPI_KEY).toString('utf8');
  return JSON.parse(plain) as unknown;
}

/** 生成 52 位十六进制设备 ID（与网易云客户端一致的格式）。 */
export function generateDeviceId(): string {
  return randomStr(52, '0123456789ABCDEF');
}

/** 生成 WNMCID：随机小写串 + 毫秒时间戳。 */
export function generateWnmcid(): string {
  const rand = randomStr(6, 'abcdefghijklmnopqrstuvwxyz');
  return `${rand}.${Date.now()}.01.0`;
}

/** 生成随机 16 字节 Hex（用于 _ntes_nuid / NMTID 等字段）。 */
export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * eapi 请求所需的 Cookie 与 Header 构造（对齐 util/request.js 的 eapi 分支）。
 * 返回 { cookieString, headerMap, userAgent }。
 */
export interface NcmEapiContext {
  deviceId: string;
  os: string;
  appver: string;
  osver: string;
  channel: string;
  wnmcid: string;
}

export function createNcmEapiContext(): NcmEapiContext {
  return {
    deviceId: generateDeviceId(),
    os: 'pc',
    appver: '3.1.17.204416',
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    channel: 'netease',
    wnmcid: generateWnmcid(),
  };
}

export interface NcmEapiRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  cookieString: string;
}

/**
 * 构造完整的 eapi POST 请求：加密 params + 设备 Cookie/Header。
 * urlPath 形如 `/api/login/qrcode/unikey`，对象会被加密后 POST 到 `${apiDomain}/eapi/...`。
 */
export function buildEapiRequest(
  urlPath: string,
  object: Record<string, unknown>,
  ctx: NcmEapiContext,
  opts: { apiDomain?: string; eR?: boolean; csrf?: string; cookie?: string } = {},
): NcmEapiRequest {
  const apiDomain = opts.apiDomain ?? 'https://interface.music.163.com';
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const baseCookies: Record<string, string> = {
    __remember_me: 'true',
    ntes_kaola_ad: '1',
    _ntes_nnid: `${randomHex(16)},${nowMs}`,
    _ntes_nuid: randomHex(16),
    WNMCID: ctx.wnmcid,
    WEVNSM: '1.0.0',
    osver: ctx.osver,
    deviceId: ctx.deviceId,
    os: ctx.os,
    channel: ctx.channel,
    appver: ctx.appver,
  };
  const cookieMap: Record<string, string> = { ...baseCookies };
  if (opts.cookie) {
    for (const part of opts.cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k && v) cookieMap[k] = v;
    }
  }

  const headerMap: Record<string, string> = {
    osver: cookieMap.osver ?? '',
    deviceId: cookieMap.deviceId ?? '',
    os: cookieMap.os ?? '',
    appver: cookieMap.appver ?? '',
    versioncode: cookieMap.versioncode ?? '140',
    mobilename: cookieMap.mobilename ?? '',
    buildver: cookieMap.buildver ?? String(nowSec),
    resolution: cookieMap.resolution ?? '1920x1080',
    __csrf: cookieMap.__csrf ?? opts.csrf ?? '',
    channel: cookieMap.channel ?? '',
    requestId: `${nowMs}_${Math.floor(Math.random() * 1000)}`,
  };
  if (cookieMap.MUSIC_U) headerMap.MUSIC_U = cookieMap.MUSIC_U;
  if (cookieMap.MUSIC_A) headerMap.MUSIC_A = cookieMap.MUSIC_A;

  const cookieString = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headerCookie = Object.entries(headerMap)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('; ');

  const payload: Record<string, unknown> = { ...object, header: headerMap, e_r: opts.eR ?? false };
  const { params } = eapiEncrypt(urlPath, payload);

  return {
    url: `${apiDomain}/eapi/${urlPath.replace(/^\/api\//, '')}`,
    headers: {
      Cookie: headerCookie,
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `params=${encodeURIComponent(params)}`,
    cookieString,
  };
}

/** weapi 请求构造（备用通道，当前主用 eapi）。 */
export function buildWeapiRequest(
  urlPath: string,
  object: Record<string, unknown>,
  opts: { csrf?: string; cookie?: string } = {},
): { url: string; headers: Record<string, string>; body: string } {
  const payload: Record<string, unknown> = { ...object, csrf_token: opts.csrf ?? '' };
  const { params, encSecKey } = weapiEncrypt(payload);
  const cookies = opts.cookie ?? '';
  return {
    url: `https://music.163.com/weapi/${urlPath.replace(/^\/api\//, '')}`,
    headers: {
      Cookie: cookies,
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0.0.0',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`,
  };
}
