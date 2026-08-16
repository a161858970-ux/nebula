const { contextBridge, ipcRenderer } = require('electron');

/** 渲染进程唯一入口：所有能力经 IPC 走主进程，Node 能力不暴露给页面。 */
contextBridge.exposeInMainWorld('nebulaAPI', {
  importPlaylist: (url) => ipcRenderer.invoke('nebula:import-playlist', { url }),
  resolveSong: (track, quality) => ipcRenderer.invoke('nebula:resolve-song', { track, quality }),
  songQualities: (track) => ipcRenderer.invoke('nebula:song-qualities', { track }),
  fallbackSong: (track) => ipcRenderer.invoke('nebula:fallback-song', { track }),
  fetchLyric: (track) => ipcRenderer.invoke('nebula:lyric', { track }),
  fetchComments: (track) => ipcRenderer.invoke('nebula:comments', { track }),
  songDetail: (track) => ipcRenderer.invoke('nebula:song-detail', { track }),
  artistInfo: (platform, artistId) => ipcRenderer.invoke('nebula:artist-info', { platform, artistId }),
  artistSongs: (platform, artistId) => ipcRenderer.invoke('nebula:artist-songs', { platform, artistId }),
  artistAlbums: (platform, artistId) => ipcRenderer.invoke('nebula:artist-albums', { platform, artistId }),
  searchSongs: (keyword, pageSize) => ipcRenderer.invoke('nebula:search-songs', { keyword, pageSize }),
  searchArtists: (keyword, pageSize) => ipcRenderer.invoke('nebula:search-artists', { keyword, pageSize }),
  loginQr: () => ipcRenderer.invoke('nebula:login:qr'),
  loginPoll: (unikey) => ipcRenderer.invoke('nebula:login:poll', { unikey }),
  loginPlatforms: () => ipcRenderer.invoke('nebula:login:platforms'),
  loginQrFor: (platform) => ipcRenderer.invoke('nebula:login:qr-platform', { platform }),
  loginPollFor: (platform, unikey) => ipcRenderer.invoke('nebula:login:poll-platform', { platform, unikey }),
  loginAccount: (platform) => ipcRenderer.invoke('nebula:login:account', { platform }),
  loginPlaylists: (platform) => ipcRenderer.invoke('nebula:login:playlists', { platform }),
  importPlaylistId: (platform, id) => ipcRenderer.invoke('nebula:import-playlist-id', { platform, id }),
  spotifyLoginStart: () => ipcRenderer.invoke('nebula:login:spotify:start'),
  spotifyLoginStatus: () => ipcRenderer.invoke('nebula:login:spotify:status'),
  qqLoginWindow: () => ipcRenderer.invoke('nebula:login:qq:window'),
  openLocalDirectory: () => ipcRenderer.invoke('nebula:open-local-directory'),
  openExternal: (url) => ipcRenderer.invoke('nebula:open-external', { url }),
  wallpaperList: () => ipcRenderer.invoke('nebula:wallpaper:list'),
  wallpaperInfo: () => ipcRenderer.invoke('nebula:wallpaper:info'),
  wallpaperSet: (id) => ipcRenderer.invoke('nebula:wallpaper:set', { id }),
  wallpaperOpen: () => ipcRenderer.invoke('nebula:wallpaper:open'),
  wallpaperApplied: (data) => ipcRenderer.send('nebula:wallpaper:applied', data),
  onWallpaperApplied: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('nebula:wallpaper:applied', listener);
    return () => ipcRenderer.removeListener('nebula:wallpaper:applied', listener);
  },
  setCookie: (platform, cookie, token, nickname) =>
    ipcRenderer.invoke('nebula:cookie:set', { platform, cookie, token, nickname }),
  getCookie: (platform) => ipcRenderer.invoke('nebula:cookie:get', { platform }),
  clearCookie: (platform) => ipcRenderer.invoke('nebula:cookie:clear', { platform }),
});
