/**
 * TYICC午间悦听 - 页脚组件
 * 
 * 显示版权信息与版本号
 */

import React, { useState, useEffect } from 'react'

export default function Footer() {
  const [appVer, setAppVer] = useState('1.0.0')
  const [ytdlpVer, setYtdlpVer] = useState('XX.XX')
  const [ffmpegVer, setFfmpegVer] = useState('XX.XX')

  useEffect(() => {
    async function loadVersions() {
      if (!window.electronAPI) return
      try {
        const v = await window.electronAPI.getAppVersion()
        if (v.success && v.version) setAppVer(v.version)
      } catch {}
      try {
        const yt = await window.electronAPI.checkYtDlp()
        if (yt.available && yt.version) {
          setYtdlpVer(yt.version.split(' ')[0] || yt.version)
        }
      } catch {}
      try {
        const ff = await window.electronAPI.checkFfmpeg()
        if (ff.available && ff.version) {
          setFfmpegVer(ff.version.split(' ')[2] || ff.version.split(' ')[0] || ff.version)
        }
      } catch {}
    }
    loadVersions()
  }, [])

  return (
    <div className="app-footer">
      2027届3班安舒阳 © 2026 | ver{appVer} yt-dlp {ytdlpVer} ffmpeg {ffmpegVer}
    </div>
  )
}