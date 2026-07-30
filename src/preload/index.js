/**
 * TYICC午间悦听 - 预加载脚本
 * 
 * 在渲染进程和主进程之间建立安全的IPC桥梁
 * 只暴露必要的API给渲染进程，保证安全性
 */

const { contextBridge, ipcRenderer } = require('electron')

// 暴露给渲染进程的安全API
contextBridge.exposeInMainWorld('electronAPI', {
  // ========== 网络检测 ==========
  checkNetwork: () => ipcRenderer.invoke('check-network'),

  // ========== yt-dlp管理 ==========
  downloadYtDlp: () => ipcRenderer.invoke('download-yt-dlp'),
  updateYtDlp: () => ipcRenderer.invoke('update-yt-dlp'),
  checkYtDlp: () => ipcRenderer.invoke('check-yt-dlp'),

  // ========== FFmpeg管理 ==========
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),

  // ========== B站下载 ==========
  downloadBilibili: (options) => ipcRenderer.invoke('download-bilibili', options),

  // ========== 音频处理 ==========
  analyzeLoudness: (options) => ipcRenderer.invoke('analyze-loudness', options),
  getAudioDuration: (options) => ipcRenderer.invoke('get-audio-duration', options),
  normalizeLoudness: (options) => ipcRenderer.invoke('normalize-loudness', options),
  mixVoiceWithBgm: (options) => ipcRenderer.invoke('mix-voice-with-bgm', options),
  convertToWav: (options) => ipcRenderer.invoke('convert-to-wav', options),
  concatenateAudio: (options) => ipcRenderer.invoke('concatenate-audio', options),
  onConcatenateProgress: (callback) => {
    const channel = 'concatenate-audio-progress'
    const listener = (_event, payload) => {
      if (typeof callback === 'function') callback(payload)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  // ========== 文件对话框 ==========
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  openSaveDialog: (options) => ipcRenderer.invoke('open-save-dialog', options),

  // ========== 文件管理 ==========
  getFileInfo: (options) => ipcRenderer.invoke('get-file-info', options),
  getTempDir: () => ipcRenderer.invoke('get-temp-dir'),
  getCacheDir: () => ipcRenderer.invoke('get-cache-dir'),
  cleanupCache: () => ipcRenderer.invoke('cleanup-cache'),
  getStorageCacheUsage: () => ipcRenderer.invoke('get-storage-cache-usage'),
  clearStorageCache: () => ipcRenderer.invoke('clear-storage-cache'),
  getMusicLibraryInfo: () => ipcRenderer.invoke('get-music-library-info'),
  listMusicLibraryTracks: () => ipcRenderer.invoke('list-music-library-tracks'),
  importMusicLibraryPackage: () => ipcRenderer.invoke('import-music-library-package'),
  clearMusicLibrary: () => ipcRenderer.invoke('clear-music-library'),
  createMusicLibraryPackage: (options) => ipcRenderer.invoke('create-music-library-package', options),

  // ========== 预设音频 ==========
  getPresetOpening: () => ipcRenderer.invoke('get-preset-opening'),
  getContributorText: () => ipcRenderer.invoke('get-contributor-text'),

  // ========== 录音 ==========
  saveRecordingFile: (options) => ipcRenderer.invoke('save-recording-file', options),
  readAudioBlob: (options) => ipcRenderer.invoke('read-audio-blob', options),

  // ========== 应用信息 ==========
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openFileLocation: (options) => ipcRenderer.invoke('open-file-location', options),
  checkGithubReleaseUpdate: () => ipcRenderer.invoke('check-github-release-update'),
  downloadUpdateInstaller: (options) => ipcRenderer.invoke('download-update-installer', options),
  onUpdateDownloadProgress: (callback) => {
    const channel = 'update-download-progress'
    const listener = (_event, payload) => {
      if (typeof callback === 'function') callback(payload)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  cancelUpdateDownload: () => ipcRenderer.invoke('cancel-update-download'),
  runUpdateInstaller: (options) => ipcRenderer.invoke('run-update-installer', options),
  openExternalUrl: (options) => ipcRenderer.invoke('open-external-url', options)
})