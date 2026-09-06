/**
 * TYICC午间悦听 - 主应用组件
 * 
 * 管理应用状态：启动加载 → 工作流界面
 */

import React, { useState, useEffect, useRef } from 'react'
import { message, Modal } from 'antd'
import SplashScreen from './components/SplashScreen'
import Workflow from './components/Workflow'
import Footer from './components/Footer'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingStatus, setLoadingStatus] = useState('正在初始化...')
  const [networkOk, setNetworkOk] = useState(true)
  const [ffmpegOk, setFfmpegOk] = useState(false)
  const [ytdlpOk, setYtdlpOk] = useState(false)
  const loadingRef = useRef(null)

  async function checkReleaseUpdateOnStartup() {
    if (!window.electronAPI?.checkGithubReleaseUpdate) return
    try {
      const result = await window.electronAPI.checkGithubReleaseUpdate()
      if (!result?.success || !result.hasUpdate) return

      const latestVersion = result.latestVersion || result.latestVersionRaw || '未知版本'
      const downloadUrl = result.downloadUrl || ''
      const downloadName = result.downloadName || ''
      const totalSizeMb = result.downloadSize > 0
        ? (result.downloadSize / 1024 / 1024).toFixed(1)
        : ''

      if (!downloadUrl) {
        Modal.confirm({
          title: '检测到新版本',
          content: `检测到新的更新：版本${latestVersion}，未找到自动下载安装包，是否前往下载页面？`,
          okText: '去下载',
          cancelText: '稍后再说',
          centered: true,
          onOk: async () => {
            if (window.electronAPI?.openExternalUrl) {
              await window.electronAPI.openExternalUrl({
                url: result.releaseUrl || 'https://github.com/ghrkya/TYICC_Midday_Music/releases/latest'
              })
            }
          }
        })
        return
      }

      let progressUnsub = null
      let downloadCancelled = false

      const modal = Modal.confirm({
        title: '下载更新安装包',
        icon: null,
        width: 500,
        centered: true,
        okText: '关闭',
        cancelText: '取消下载',
        cancelButtonProps: { danger: true },
        onCancel: async () => {
          downloadCancelled = true
          if (progressUnsub) progressUnsub()
          if (window.electronAPI?.cancelUpdateDownload) {
            await window.electronAPI.cancelUpdateDownload()
          }
          modal.destroy()
        },
        content: (() => {
          // 用函数返回动态内容，在回调里通过 DOM 操作更新
          const container = document.createElement('div')
          container.innerHTML = `
            <div style="margin-bottom:12px;font-size:13px;color:#666">
              版本 ${latestVersion}${totalSizeMb ? ` · ${totalSizeMb} MB` : ''}
            </div>
            <div style="margin-bottom:8px">
              <div class="ant-progress ant-progress-line ant-progress-status-active" style="width:100%">
                <div class="ant-progress-outer" style="width:100%">
                  <div class="ant-progress-inner">
                    <div class="ant-progress-bg" style="width:0%;height:8px;background:#6C63FF;border-radius:4px;transition:width 0.3s"></div>
                  </div>
                </div>
              </div>
            </div>
            <div style="font-size:13px;color:#999" class="update-progress-text">正在连接 GitHub...</div>
            <div style="margin-top:12px;padding:8px 10px;background:#FFFBE6;border:1px solid #FFE58F;border-radius:6px;font-size:12px;color:#AD6800">
              ⚠️ 正在通过 GitHub 下载，可能需要特定网络环境。若长时间无进度请取消后检查网络。
            </div>
          `
          return container
        })()
      })

      // 更新弹窗内容的辅助函数
      const updateModalContent = (htmlContent) => {
        const bodyEl = document.querySelector('.ant-modal-confirm-body .ant-modal-confirm-content')
        if (bodyEl) {
          const inner = bodyEl.querySelector('div')
          if (inner) {
            inner.innerHTML = htmlContent
          }
        }
      }

      const formatSpeed = (bytesPerSec) => {
        if (!bytesPerSec || bytesPerSec < 1024) return `${Math.round(bytesPerSec || 0)} B/s`
        if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
        return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
      }

      const formatBytes = (bytes) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
      }

      try {
        progressUnsub = window.electronAPI.onUpdateDownloadProgress((payload) => {
          if (downloadCancelled) return

          const phase = payload?.phase || ''
          const percent = Math.max(0, Math.min(100, Number(payload?.percent || 0)))
          const speed = Number(payload?.speed || 0)
          const received = Number(payload?.receivedBytes || 0)
          const total = Number(payload?.totalBytes || 0)

          let statusText = ''
          if (phase === 'connecting') {
            statusText = '正在连接 GitHub...'
          } else if (phase === 'writing') {
            statusText = '下载完成，正在保存文件...'
          } else {
            const recvStr = formatBytes(received)
            const totalStr = total > 0 ? ` / ${formatBytes(total)}` : ''
            const speedStr = formatSpeed(speed)
            statusText = `已下载 ${recvStr}${totalStr} · ${speedStr}`
          }

          const progressColor = percent === 100 ? '#52C41A' : '#6C63FF'

          updateModalContent(`
            <div style="margin-bottom:12px;font-size:13px;color:#666">
              版本 ${latestVersion}${totalSizeMb ? ` · ${totalSizeMb} MB` : ''}
            </div>
            <div style="margin-bottom:8px">
              <div style="width:100%;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden">
                <div style="width:${percent}%;height:100%;background:${progressColor};border-radius:4px;transition:width 0.3s"></div>
              </div>
            </div>
            <div style="font-size:13px;color:#999">${statusText}</div>
            <div style="margin-top:12px;padding:8px 10px;background:#FFFBE6;border:1px solid #FFE58F;border-radius:6px;font-size:12px;color:#AD6800">
              ⚠️ 正在通过 GitHub 下载，可能需要特定网络环境。若长时间无进度请取消后检查网络。
            </div>
          `)
        })

        // 启动下载
        const dlResult = await window.electronAPI.downloadUpdateInstaller({
          downloadUrl,
          downloadName
        })

        if (progressUnsub) progressUnsub()

        if (downloadCancelled) return

        if (!dlResult?.success) {
          message.error(`下载失败：${dlResult?.message || '未知错误'}`)
          modal.destroy()
          return
        }

        // 更新弹窗为"即将安装"
        updateModalContent(`
          <div style="text-align:center;padding:20px 0">
            <div style="font-size:32px;margin-bottom:12px">✅</div>
            <div style="font-size:15px;font-weight:600;color:#333;margin-bottom:8px">下载完成</div>
            <div style="font-size:13px;color:#666;margin-bottom:16px">即将打开安装程序，请按照安装向导完成更新。</div>
          </div>
        `)

        // 短暂延迟后更新按钮文字并打开安装包
        setTimeout(async () => {
          modal.update({
            okText: '好的',
            cancelText: null,
            cancelButtonProps: { style: { display: 'none' } },
            onOk: () => modal.destroy()
          })

          if (window.electronAPI?.runUpdateInstaller) {
            await window.electronAPI.runUpdateInstaller({
              filePath: dlResult.filePath
            })
          }
        }, 800)

      } catch (err) {
        if (progressUnsub) progressUnsub()
        if (!downloadCancelled) {
          message.error(`下载出错：${err?.message || '未知错误'}`)
          modal.destroy()
        }
      }
    } catch {}
  }

  // 启动加载流程
  useEffect(() => {
    const initSequence = async () => {
      try {
        // 阶段1: 初始化基础环境
        setLoadingStatus('正在初始化应用...')
        await updateProgress(15)
        await sleep(300)

        // 阶段2: 检查ffmpeg
        setLoadingStatus('正在检测 FFmpeg...')
        await updateProgress(30)
        if (window.electronAPI) {
          const ffmpegResult = await window.electronAPI.checkFfmpeg()
          if (ffmpegResult.available) {
            setFfmpegOk(true)
            setLoadingStatus(`FFmpeg 已就绪 (${ffmpegResult.version || '可用'})`)
          } else {
            setLoadingStatus('⚠️ FFmpeg 未找到，音频处理功能将受限')
          }
        }
        await sleep(200)
        await updateProgress(50)

        // 阶段3: 检查网络连接
        setLoadingStatus('正在检测网络连接...')
        await updateProgress(65)
        if (window.electronAPI) {
          const netResult = await window.electronAPI.checkNetwork()
          if (netResult.success) {
            setNetworkOk(true)
            setLoadingStatus('Bilibili 网络连接正常')
          } else {
            setNetworkOk(false)
            setLoadingStatus('⚠️ Bilibili 网络连接失败，下载功能将受限')
          }
        }
        await sleep(200)
        await updateProgress(80)

        // 阶段4: 下载/更新yt-dlp
        setLoadingStatus('正在检测本地 yt-dlp...')
        await updateProgress(84)
        if (window.electronAPI) {
          const ytdlpReady = await prepareYtDlpWithRetry()
          setYtdlpOk(ytdlpReady)
        }
        await sleep(300)

        // 阶段5: 清理缓存
        setLoadingStatus('正在清理临时文件...')
        await updateProgress(95)
        if (window.electronAPI) {
          await window.electronAPI.cleanupCache()
        }
        await sleep(200)

        // 完成加载
        setLoadingStatus('准备就绪！')
        await updateProgress(100)
        await sleep(500)

        setLoading(false)
        setTimeout(() => {
          checkReleaseUpdateOnStartup().catch(() => {})
        }, 250)
      } catch (err) {
        console.error('初始化失败:', err)
        setLoadingStatus('加载出错，请重启应用')
        // 即使出错也允许进入主界面
        await sleep(1000)
        setLoading(false)
        setTimeout(() => {
          checkReleaseUpdateOnStartup().catch(() => {})
        }, 250)
      }
    }

    initSequence()
  }, [])

  async function prepareYtDlpWithRetry() {
    let checkResult = { available: false }
    try {
      checkResult = await window.electronAPI.checkYtDlp()
    } catch {}

    if (checkResult && checkResult.available) {
      const ver = checkResult.version ? ` (${checkResult.version})` : ''
      setLoadingStatus(`已检测到 yt-dlp${ver}，正在检查并执行更新...`)
    } else {
      setLoadingStatus('未检测到 yt-dlp，正在下载核心组件...')
    }

    await updateProgress(90)

    while (true) {
      const dlResult = await window.electronAPI.downloadYtDlp()

      if (dlResult.success) {
        setLoadingStatus(dlResult.message || 'yt-dlp 已就绪')
        return true
      }

      if (dlResult.timedOut) {
        const action = await new Promise((resolve) => {
          Modal.confirm({
            title: '重要组件更新遇到网络问题',
            content: 'yt-dlp 更新/下载耗时过长，可能是网络不稳定或访问 GitHub 受限。是否重试？',
            okText: '重试',
            cancelText: '跳过',
            centered: true,
            onOk: () => resolve('retry'),
            onCancel: () => resolve('skip')
          })
        })

        if (action === 'retry') {
          setLoadingStatus('正在重新尝试更新 yt-dlp...')
          await sleep(300)
          continue
        }

        if (checkResult && checkResult.available) {
          setLoadingStatus('⚠️ yt-dlp 更新超时，已保留当前可用版本')
          return true
        }

        setLoadingStatus('⚠️ yt-dlp 下载/更新被跳过，B站下载功能将不可用')
        return false
      }

      setLoadingStatus('⚠️ yt-dlp 下载失败，B站下载功能将不可用')
      return !!(checkResult && checkResult.available)
    }
  }

  // 更新进度条的辅助函数
  async function updateProgress(target) {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= target) {
            clearInterval(interval)
            resolve()
            return prev
          }
          return Math.min(prev + 1, target)
        })
      }, 20)
    })
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
  }

  // 如果还在加载，显示启动画面
  if (loading) {
    return (
      <SplashScreen
        progress={loadingProgress}
        status={loadingStatus}
        networkOk={networkOk}
      />
    )
  }

  // 主界面
  return (
    <div className="app-layout">
      <Workflow
        networkOk={networkOk}
        ffmpegOk={ffmpegOk}
      />
      <Footer />
    </div>
  )
}

// React Antd 全局 message 配置
message.config({
  top: 60,
  duration: 3,
  maxCount: 3
})