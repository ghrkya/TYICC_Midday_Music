/**
 * TYICC午间悦听 - 步骤面板组件
 * 
 * 每个步骤的操作面板：
 * - 选择本地音频
 * - 从B站下载
 * - 使用预设
 * - 显示已选文件信息
 */

import React from 'react'
import { Button, message } from 'antd'
import {
  FolderOpenOutlined,
  DownloadOutlined,
  SoundOutlined,
  AudioOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import BilibiliDownloader from './BilibiliDownloader'
import AudioRecorder from './AudioRecorder'

export default function StepPanel({
  step,
  stepIndex,
  file,
  loudnessEnabled,
  ffmpegOk,
  networkOk,
  onSetFile,
  onRemoveFile,
  onLocalFile,
  onBilibiliDownload,
  onUsePreset
}) {
  // 显示B站下载面板
  const [showBilibili, setShowBilibili] = React.useState(false)

  // 显示录音面板
  const [showRecorder, setShowRecorder] = React.useState(false)

  // 获取步骤对应的描述文本
  const getStepDescription = () => {
    switch (step.key) {
      case 'opening':
        return '选择"TYICC午间悦听，聆听世界的旋律"开场音频，或使用预设开场音效'
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
    onBilibiliDownload(step.key, bvId)
    setShowBilibili(false)
  }

  // 处理录音完成
  const handleRecordingComplete = (audioBlob, audioUrl, duration) => {
    onSetFile(step.key, {
      name: `录音_${new Date().toLocaleString().replace(/[/:]/g, '-')}.wav`,
      path: audioUrl,
      source: 'record',
      size: audioBlob.size,
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
        {/* 选择本地文件 */}
        <button className="action-btn" onClick={handleLocalFile}>
          <FolderOpenOutlined />
          <span>选择本地音频</span>
        </button>

        {/* 从B站下载 */}
        <button
          className="action-btn"
          onClick={() => setShowBilibili(true)}
        >
          <DownloadOutlined />
          <span>从B站下载</span>
        </button>

        {/* 使用预设（仅开场和结尾可用） */}
        {step.defaultPreset && (
          <button
            className="action-btn"
            onClick={() => onUsePreset(step.key)}
          >
            <SoundOutlined />
            <span>使用预设</span>
          </button>
        )}

        {/* 录制音频（演讲、转场、结语可用） */}
        {(step.key === 'speech' || step.key === 'transition' || step.key === 'ending') && (
          <button
            className="action-btn"
            onClick={() => setShowRecorder(true)}
          >
            <AudioOutlined />
            <span>录制音频</span>
          </button>
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

      {/* 已选文件信息 */}
      {file && (
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
      )}
    </div>
  )
}