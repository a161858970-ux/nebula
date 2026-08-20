import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Platform, PlatformAdapter } from '../types';
import { NeteaseAdapter } from './neteaseAdapter';
import { QqAdapter } from './qqAdapter';
import { KugouAdapter } from './kugouAdapter';
import { SpotifyAdapter } from './spotifyAdapter';
import { QishuiAdapter } from './qishuiAdapter';

export type AdapterMap = Record<Platform, PlatformAdapter>;

export function createAdapters(http: HttpClient, cookies: CookieStore): AdapterMap {
  return {
    netease: new NeteaseAdapter(http, cookies),
    qq: new QqAdapter(http, cookies),
    kugou: new KugouAdapter(http),
    spotify: new SpotifyAdapter(http, cookies),
    qishui: new QishuiAdapter(http),
  };
}

export interface UrlTarget {
  platform: Platform;
  id: string;
}

/** 解析歌单链接/ID → 平台 + ID；无法识别返回 null。 */
export function resolveAdapterByUrl(input: string): UrlTarget | null {
  const url = input.trim();
  if (/music\.163\.com/.test(url)) {
    const id =
      url.match(/(?:playlist|songlist)[^0-9]*(\d+)/i)?.[1] ?? url.match(/[?&]id=(\d+)/i)?.[1];
    if (id) return { platform: 'netease', id };
  }
  if (/(y\.qq\.com|music\.qq\.com|c\.y\.qq\.com)/.test(url)) {
    const id =
      url.match(/playlist\/(\d+)/i)?.[1] ?? url.match(/[?&](?:disstid|id)=(\d+)/i)?.[1];
    if (id) return { platform: 'qq', id };
  }
  if (/kugou\.com/.test(url)) {
    const id = url.match(/playlist\/(\d+)/i)?.[1] ?? url.match(/[?&]id=(\d+)/i)?.[1];
    if (id) return { platform: 'kugou', id };
  }
  if (/open\.spotify\.com/.test(url)) {
    const id = url.match(/playlist\/([A-Za-z0-9]+)/i)?.[1];
    if (id) return { platform: 'spotify', id };
  }
  if (/qishui\.com/.test(url) || /douyin\.com/.test(url)) {
    const id = url.match(/id=([\d]+)/i)?.[1] ?? url.match(/playlist\/([\d]+)/i)?.[1];
    if (id) return { platform: 'qishui', id };
  }
  return null;
}
