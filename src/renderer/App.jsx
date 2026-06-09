/**
 * TYICC午间悦听 - 主应用组件
 * 
 * 管理应用状态：启动加载 → 工作流界面
 */

import React, { useState, useEffect, useRef } from 'react'
import { message } from 'antd'
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

        // 阶段4: 下载yt-dlp（首次运行）
        setLoadingStatus('正在准备 yt-dlp 下载工具...')
        await updateProgress(88)
        if (window.electronAPI) {
          const dlResult = await window.electronAPI.downloadYtDlp()
          if (dlResult.success) {
            setLoadingStatus(dlResult.message || 'yt-dlp 已就绪')
            // 尝试更新到最新版本
            setTimeout(async () => {
              try {
                await window.electronAPI.updateYtDlp()
              } catch {}
            }, 100)
          } else {
            setLoadingStatus('⚠️ yt-dlp 下载失败，B站下载功能将不可用')
          }
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
      } catch (err) {
        console.error('初始化失败:', err)
        setLoadingStatus('加载出错，请重启应用')
        // 即使出错也允许进入主界面
        await sleep(1000)
        setLoading(false)
      }
    }

    initSequence()
  }, [])

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