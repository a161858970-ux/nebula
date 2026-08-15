/** 桌面后端统一出口：Electron 主进程与 Node 冒烟测试均从这里引入。 */

export * from './types';
export * from './cookieStore';
export * from './http';
export * from './audioProxy';
export * from './audioProbe';
export * from './ncm/ncmApi';
export * from './encrypt/ncmCrypto';
export * from './parsers/lyricParser';
export * from './adapters/mappers';
export * from './adapters/index';
export * from './adapters/neteaseAdapter';
export * from './adapters/qqAdapter';
export * from './adapters/kugouAdapter';
export * from './adapters/spotifyAdapter';
export * from './services/songResolver';
export * from './services/lyricService';
export * from './services/lyricCache';
export * from './services/wallpaperLibrary';
export * from './services/qqRights';
export * from './login/index';
export { registerIpcHandlers } from './ipc';
export type { IpcLike, IpcDeps } from './ipc';
