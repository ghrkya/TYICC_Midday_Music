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
  normalizeLoudness: (options) => ipcRenderer.invoke('normalize-loudness', options),
  convertToWav: (options) => ipcRenderer.invoke('convert-to-wav', options),
  concatenateAudio: (options) => ipcRenderer.invoke('concatenate-audio', options),

  // ========== 文件对话框 ==========
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  openSaveDialog: (options) => ipcRenderer.invoke('open-save-dialog', options),

  // ========== 文件管理 ==========
  getFileInfo: (options) => ipcRenderer.invoke('get-file-info', options),
  getTempDir: () => ipcRenderer.invoke('get-temp-dir'),
  getCacheDir: () => ipcRenderer.invoke('get-cache-dir'),
  cleanupCache: () => ipcRenderer.invoke('cleanup-cache'),

  // ========== 预设音频 ==========
  getPresetOpening: () => ipcRenderer.invoke('get-preset-opening'),

  // ========== 录音 ==========
  saveRecordingFile: (options) => ipcRenderer.invoke('save-recording-file', options),
  readAudioBlob: (options) => ipcRenderer.invoke('read-audio-blob', options)
})