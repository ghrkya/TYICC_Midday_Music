/**
 * TYICC午间悦听 - 步骤面板组件
 * 
 * 每个步骤的操作面板：
 * - 选择本地音频
 * - 从B站下载
 * - 使用预设
 * - 显示已选文件信息
 */

import React, { useEffect, useState, useRef } from 'react'
import { Button, message } from 'antd'
import {
  FolderOpenOutlined,
  DownloadOutlined,
  SoundOutlined,
  AudioOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined
} from '@ant-design/icons'
import BilibiliDownloader from './BilibiliDownloader'
import AudioRecorder from './AudioRecorder'

// 音频预览子组件（用于音乐列表每首歌曲）
function MusicFilePreview({ file }) {
  const [url, setUrl] = useState('')
  const urlRef = useRef(null)

  const base64ToUint8 = (base64) => {
    const bin = window.atob(base64)
    const len = bin.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }

  useEffect(() => {
    if (!file || !file.path) return
    let disposed = false
    if (window.electronAPI) {
      window.electronAPI.readAudioBlob({ filePath: file.path })
        .then(result => {
          if (disposed || !result || !result.success) return
          const bytes = result.dataBase64 ? base64ToUint8(result.dataBase64) : null
          if (!bytes || bytes.length === 0) return
          const blob = new Blob([bytes], { type: result.mime || 'audio/mpeg' })
          const u = URL.createObjectURL(blob)
          urlRef.current = u
          setUrl(u)
        })
        .catch(() => {})
    }
    return () => {
      disposed = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [file])

  if (!url) return null
  return (
    <audio
      src={url}
      controls
      style={{ width: '100%', borderRadius: 6, height: 36, marginTop: 6 }}
    />
  )
}


export default function StepPanel({
  step,
  stepIndex,
  file,
  musicFiles,
  loudnessEnabled,
  ffmpegOk,
  networkOk,
  onSetFile,
  onRemoveFile,
  onLocalFile,
  onBilibiliDownload,
  onUsePreset,
  onAddMusicFile,
  onDownloadMusicBilibili,
  onRemoveMusicFile,
  onMoveMusicFile
}) {
  // 显示B站下载面板
  const [showBilibili, setShowBilibili] = React.useState(false)

  // 显示录音面板
  const [showRecorder, setShowRecorder] = React.useState(false)

  // 音频预览 Blob URL
  const [previewUrl, setPreviewUrl] = useState('')
  const blobUrlRef = useRef(null)

  const base64ToUint8Array = (base64) => {
    const binary = window.atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  // 清理旧 Blob URL
  const revokeBlobUrl = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }

  useEffect(() => {
    let disposed = false
    revokeBlobUrl()
    if (!file || !file.path) {
      setPreviewUrl('')
      return
    }
    // 已经是可播放的 URL 格式
    if (file.path.startsWith('data:') || file.path.startsWith('blob:') || file.path.startsWith('http')) {
      setPreviewUrl(file.path)
    } else if (window.electronAPI) {
      // 通过 IPC 读取文件数据，创建 Blob URL（最可靠的播放方式）
      window.electronAPI.readAudioBlob({ filePath: file.path })
        .then(result => {
          if (result && result.success) {
            const bytes = result.dataBase64 ? base64ToUint8Array(result.dataBase64) : null
            if (!bytes || bytes.length === 0) {
              throw new Error('音频数据为空')
            }
            const blob = new Blob([bytes], { type: result.mime || 'audio/wav' })
            const url = URL.createObjectURL(blob)
            blobUrlRef.current = url
            if (!disposed) {
              setPreviewUrl(url)
            }
          } else if (!disposed) {
            message.error((result && result.message) || '读取音频失败')
            setPreviewUrl('')
          }
        })
        .catch((err) => {
          if (!disposed) {
            message.error('音频预览失败：' + err.message)
            setPreviewUrl('')
          }
        })
    }

    return () => {
      disposed = true
      revokeBlobUrl()
    }
  }, [file])

  // 获取步骤对应的描述文本
  const getStepDescription = () => {
    switch (step.key) {
      case 'opening':
        return '选择片头音频，或使用预设片头音效'
      case 'greeting':
        return '录制或选择一段开场问候语'
      case 'speech':
        return '选择一段英文TED演讲音频，可从本地文件选择或从B站视频下载'
      case 'transition':
        return '录制或选择一段转场介绍语，引出接下来的歌曲'
      case 'music':
        return '选择多首歌曲（首尾相接），可从本地文件或从B站视频下载'
      case 'ending':
        return '选择或录制结束语，为今天的节目画上完美的句号'
      default:
        return ''
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // 处理B站下载回调
  const handleBilibiliDownload = (bvId) => {
    if (step.key === 'music') {
      onDownloadMusicBilibili(bvId)
    } else {
      onBilibiliDownload(step.key, bvId)
    }
    setShowBilibili(false)
  }

  // 处理录音完成
  const handleRecordingComplete = (audioBlob, recordingFilePath, duration) => {
    const fileName = recordingFilePath
      ? recordingFilePath.split(/[\\/]/).pop()
      : `录音_${new Date().toLocaleString().replace(/[/:]/g, '-')}.wav`
    onSetFile(step.key, {
      name: fileName,
      path: recordingFilePath || '',
      source: 'record',
      size: 0,
      duration: duration
    })
    setShowRecorder(false)
  }

  // 处理本地文件选择
  const handleLocalFile = () => {
    onLocalFile(step.key)
  }

  return (
    <div className="step-panel">
      {/* 步骤标题 */}
      <div className="step-header">
        <div className="step-number">{stepIndex + 1}</div>
        <div>
          <div className="step-title">{step.title}</div>
          <div className="step-description">{getStepDescription()}</div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="action-group">
        {step.key === 'music' ? (
          <>
            {/* 添加本地文件（音乐列表） */}
            <button className="action-btn" onClick={onAddMusicFile}>
              <FolderOpenOutlined />
              <span>添加本地文件</span>
            </button>
            {/* 从B站下载（音乐列表） */}
            <button className="action-btn" onClick={() => setShowBilibili(true)}>
              <DownloadOutlined />
              <span>从B站下载</span>
            </button>
          </>
        ) : (
          <>
            {/* 选择本地文件 */}
            <button className="action-btn" onClick={handleLocalFile}>
              <FolderOpenOutlined />
              <span>选择本地音频</span>
            </button>

            {/* 从B站下载（片头/开场语/转场/结语不可用） */}
            {step.key !== 'opening' && step.key !== 'greeting' && step.key !== 'transition' && step.key !== 'ending' && (
              <button className="action-btn" onClick={() => setShowBilibili(true)}>
                <DownloadOutlined />
                <span>从B站下载</span>
              </button>
            )}

            {/* 使用预设（仅片头可用） */}
            {step.defaultPreset && step.key !== 'ending' && (
              <button className="action-btn" onClick={() => onUsePreset(step.key)}>
                <SoundOutlined />
                <span>使用预设</span>
              </button>
            )}

            {/* 录制音频（开场语、转场、结语可用） */}
            {(step.key === 'greeting' || step.key === 'transition' || step.key === 'ending') && (
              <button className="action-btn" onClick={() => setShowRecorder(true)}>
                <AudioOutlined />
                <span>录制音频</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* B站下载面板 */}
      {showBilibili && (
        <div className="bilibili-downloader">
          <BilibiliDownloader
            onDownload={handleBilibiliDownload}
            onCancel={() => setShowBilibili(false)}
            networkOk={networkOk}
          />
        </div>
      )}

      {/* 录音面板 */}
      {showRecorder && (
        <div className="recorder-container">
          <AudioRecorder
            onComplete={handleRecordingComplete}
            onCancel={() => setShowRecorder(false)}
          />
        </div>
      )}

      {/* 每日歌曲 — 文件列表 */}
      {step.key === 'music' && musicFiles && musicFiles.length > 0 && (
        <div className="music-file-list">
          <div className="music-file-list-header">
            <AudioOutlined style={{ marginRight: 6 }} />
            歌曲列表（{musicFiles.length}首）
          </div>
          {musicFiles.map((mf, idx) => (
            <div key={idx} className="music-file-item">
              <div className="music-file-info" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="music-file-index">{idx + 1}</span>
                  <span className="music-file-name">{mf.name}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexShrink: 0 }}>
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      disabled={idx === 0}
                      onClick={() => onMoveMusicFile(idx, -1)}
                    />
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      disabled={idx === musicFiles.length - 1}
                      onClick={() => onMoveMusicFile(idx, 1)}
                    />
                    <Button
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => onRemoveMusicFile(idx)}
                      danger
                    />
                  </div>
                </div>
                <div className="music-file-detail" style={{ marginLeft: 30 }}>
                  {mf.source === 'local' && '本地文件'}
                  {mf.source === 'bilibili' && `B站（${mf.bvId || ''}）`}
                  {mf.size ? ` · ${formatFileSize(mf.size)}` : ''}
                </div>
                <MusicFilePreview file={mf} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 已选文件信息 + 音频预览（非音乐步骤） */}
      {step.key !== 'music' && file && (
        <>
          <div className="selected-file">
            <div className="selected-file-icon">
              <AudioOutlined />
            </div>
            <div className="selected-file-info">
              <div className="selected-file-name">{file.name}</div>
              <div className="selected-file-detail">
                {file.source === 'local' && '本地文件'}
                {file.source === 'bilibili' && `来自B站（${file.bvId || ''}）`}
                {file.source === 'record' && '录音文件'}
                {file.source === 'preset' && '预设音频'}
                {file.size ? ` · ${formatFileSize(file.size)}` : ''}
                {file.duration ? ` · ${file.duration}秒` : ''}
                {loudnessEnabled && ffmpegOk && ' · 已启用响度平衡'}
              </div>
            </div>
            <div className="selected-file-actions">
              <Button
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => onRemoveFile(step.key)}
                danger
              />
            </div>
          </div>
          {/* 音频预览播放器 */}
          {previewUrl && (
            <div style={{ marginBottom: 12 }}>
              <audio
                key={previewUrl}
                src={previewUrl}
                controls
                style={{ width: '100%', borderRadius: 8, height: 40 }}
              >
                您的浏览器不支持音频播放
              </audio>
            </div>
          )}
        </>
      )}
    </div>
  )
}