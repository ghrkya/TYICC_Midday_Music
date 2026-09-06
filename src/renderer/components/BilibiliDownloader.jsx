/**
 * TYICC午间悦听 - B站下载组件
 * 
 * 输入BV号或B站链接，调用主进程yt-dlp下载音频
 */

import React, { useState } from 'react'
import { Input, Button, Alert, Space, message } from 'antd'
import { DownloadOutlined, LinkOutlined, CloseOutlined } from '@ant-design/icons'

export default function BilibiliDownloader({ onDownload, onCancel, networkOk }) {
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)

  /**
   * 解析用户输入的URL或BV号
   */
  const parseInput = (input) => {
    const trimmed = input.trim()

    // 已经是BV号格式 - 注：BV号大小写敏感，保留原始大小写
    if (/^BV[a-zA-Z0-9]{10,12}$/i.test(trimmed)) {
      return trimmed
    }

    // B站视频链接 - 保留完整链接，让 yt-dlp 使用原始页面上下文。
    const bvMatch = trimmed.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i)
    if (bvMatch) {
      return trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`
    }

    // b23.tv 短链接 - 提取完整 URL（支持中文前缀，如 【标题】 https://b23.tv/xxx）
    const b23Match = trimmed.match(/https?:\/\/b23\.tv\/[a-zA-Z0-9]+/i) || trimmed.match(/b23\.tv\/[a-zA-Z0-9]+/i)
    if (b23Match) {
      return b23Match[0].startsWith('http') ? b23Match[0] : 'https://' + b23Match[0]
    }

    return null
  }

  /**
   * 执行下载
   */
  const handleDownload = async () => {
    const bvId = parseInput(inputValue)
    if (!bvId) {
      message.error('请输入有效的BV号或B站视频链接')
      return
    }

    setLoading(true)
    try {
      if (window.electronAPI) {
        // 通过预加载脚本调用主进程
        const tempDir = await window.electronAPI.getTempDir()
        const result = await window.electronAPI.downloadBilibili({
          url: bvId,
          outputDir: tempDir,
          quality: 'best'
        })

        if (result.success) {
          onDownload(bvId)
        } else {
          message.error(result.message || '下载失败')
        }
      } else {
        // 开发/演示模式 - 模拟下载成功
        message.success(`演示模式：已下载 BV ${bvId} 的音频`)
        onDownload(bvId)
      }
    } catch (err) {
      message.error('下载出错：' + err.message)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 处理回车键
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleDownload()
    }
  }

  return (
    <div style={{
      padding: 16,
      background: '#FAFAFE',
      borderRadius: 12,
      border: '1px solid #E8E8F0'
    }}>
      {/* 网络警告 */}
      {!networkOk && (
        <Alert
          type="warning"
          message="B站网络连接失败，下载可能无法进行"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
        />
      )}

      <Space direction="vertical" style={{ width: '100%' }}>
        <Input
          placeholder="输入BV号、B站链接或 b23.tv 短链接"
          prefix={<LinkOutlined style={{ color: '#8888AA' }} />}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          size="large"
          disabled={loading}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={loading}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
            loading={loading}
          >
            {loading ? '下载中...' : '下载音频'}
          </Button>
        </div>

        {/* 使用说明 */}
        <div style={{ fontSize: 12, color: '#8888AA', marginTop: 4 }}>
          支持格式：BV号、B站视频链接、b23.tv 短链接
        </div>
      </Space>
    </div>
  )
}