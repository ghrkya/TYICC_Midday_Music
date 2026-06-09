/**
 * TYICC午间悦听 - 合成面板组件
 * 
 * 最后一步：将5个步骤的音频按顺序拼接合成完整节目
 * 可选响度平衡后处理
 */

import React, { useState, useCallback } from 'react'
import { Button, Progress, Space, message, Modal, Alert } from 'antd'
import {
  PlayCircleOutlined,
  SaveOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons'

// 工作流步骤顺序
const COMPOSE_ORDER = [
  { key: 'opening', label: '开场 - TYICC午间悦听' },
  { key: 'speech', label: '演讲 - TED演讲内容' },
  { key: 'transition', label: '转场 - 介绍语' },
  { key: 'music', label: '每日歌曲' },
  { key: 'ending', label: '结语' }
]

export default function ComposePanel({ stepFiles, loudnessEnabled, ffmpegOk }) {
  const [composing, setComposing] = useState(false)
  const [composeProgress, setComposeProgress] = useState(0)
  const [composeStatus, setComposeStatus] = useState('idle') // idle | processing | done | error
  const [outputPath, setOutputPath] = useState('')

  /**
   * 检查所有步骤是否已准备就绪
   */
  const allStepsReady = () => {
    return COMPOSE_ORDER.every(item => stepFiles[item.key] !== null)
  }

  /**
   * 处理合成
   */
  const handleCompose = async () => {
    if (!allStepsReady()) {
      message.warning('请先完成所有步骤的音频选择')
      return
    }

    try {
      // 选择保存路径
      if (!window.electronAPI) {
        message.error('合成功能仅在桌面应用中可用')
        return
      }

      const saveResult = await window.electronAPI.openSaveDialog({
        defaultName: `午间悦听_${new Date().toLocaleDateString()}.mp3`,
        filters: [
          { name: '音频文件', extensions: ['mp3', 'wav'] }
        ]
      })

      if (saveResult.canceled) {
        return
      }

      setOutputPath(saveResult.filePath || '')
      setComposing(true)
      setComposeStatus('processing')
      setComposeProgress(0)

      // 阶段1: 收集文件
      setComposeProgress(5)
      const orderKeys = COMPOSE_ORDER.map(item => item.key)
      const filePath = stepFiles[orderKeys[0]]?.path
      
      if (!filePath) {
        throw new Error('未找到音频文件')
      }

      // 获取临时目录
      const tempDir = await window.electronAPI.getTempDir()

      // 阶段2: 如果开启响度平衡，对每个音频进行处理
      setComposeProgress(15)
      let processedFiles = []

      if (loudnessEnabled && ffmpegOk) {
        setComposeStatus('正在对各个音频进行响度平衡...')

        for (let i = 0; i < orderKeys.length; i++) {
          const key = orderKeys[i]
          const file = stepFiles[key]
          if (!file || !file.path) continue

          setComposeProgress(15 + (i / orderKeys.length) * 50)

          // 标准化文件路径
          const normalizedPath = file.path.replace(/\\/g, '/')

          // 执行响度标准化
          const normalizeResult = await window.electronAPI.normalizeLoudness({
            inputPath: normalizedPath,
            outputPath: `${tempDir}/normalized_${i}.wav`,
            targetLUFS: -23
          })

          if (normalizeResult.success) {
            processedFiles.push(`${tempDir}/normalized_${i}.wav`)
          } else {
            // 如果响度平衡失败，使用原始文件
            message.warning(`"${COMPOSE_ORDER[i].label}" 响度平衡失败，使用原始文件`)
            processedFiles.push(normalizedPath)
          }
        }
      } else {
        // 不使用响度平衡，直接拼接
        processedFiles = orderKeys
          .filter(key => stepFiles[key] && stepFiles[key].path)
          .map(key => stepFiles[key].path.replace(/\\/g, '/'))
      }

      // 阶段3: 拼接音频
      setComposeProgress(70)
      setComposeStatus('正在拼接各段落...')

      const concatResult = await window.electronAPI.concatenateAudio({
        fileList: processedFiles,
        outputPath: saveResult.filePath
      })

      if (concatResult.success) {
        setComposeProgress(100)
        setComposeStatus('done')
        message.success('合成完成！')
      } else {
        throw new Error(concatResult.message || '合成失败')
      }

    } catch (err) {
      setComposeStatus('error')
      message.error('合成出错：' + err.message)
    } finally {
      setComposing(false)
    }
  }

  /**
   * 弹出合成结果消息
   */
  const showResult = () => {
    Modal.success({
      title: '合成完成',
      content: (
        <div>
          <p>节目已成功合成！</p>
          {outputPath && (
            <p style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>
              保存路径：{outputPath}
            </p>
          )}
        </div>
      ),
      okText: '确定'
    })
  }

  // 检查哪些步骤缺少文件
  const missingSteps = COMPOSE_ORDER.filter(item => !stepFiles[item.key])

  return (
    <div className="compose-section">
      <div className="compose-title">
        <PlayCircleOutlined style={{ marginRight: 8 }} />
        合成完整节目
      </div>

      {/* 合成预览 - 显示各段落的准备情况 */}
      <div className="compose-preview">
        {COMPOSE_ORDER.map((item, index) => {
          const hasFile = stepFiles[item.key] !== null
          return (
            <div
              key={item.key}
              className={`compose-item ${hasFile ? 'active' : ''}`}
              style={{
                opacity: hasFile ? 1 : 0.5,
                borderLeft: `3px solid ${hasFile ? '#6C63FF' : '#E8E8F0'}`
              }}
            >
              <span>{index + 1}.</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {hasFile ? (
                <span style={{ color: '#52C41A', fontSize: 12 }}>
                  ✅ 已准备
                </span>
              ) : (
                <span style={{ color: '#FF4D4F', fontSize: 12 }}>
                  ⚠️ 未选择
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* 警告信息 */}
      {missingSteps.length > 0 && (
        <Alert
          type="warning"
          message={`还有 ${missingSteps.length} 个段落未选择音频`}
          description={missingSteps.map(s => s.label).join('、')}
          showIcon
          style={{ marginBottom: 16, fontSize: 12 }}
        />
      )}

      {/* 进度条 */}
      {composeStatus === 'processing' && (
        <div className="compose-progress">
          <Progress
            percent={composeProgress}
            status="active"
            strokeColor={{
              from: '#6C63FF',
              to: '#00D9A6'
            }}
          />
          <div style={{
            textAlign: 'center',
            fontSize: 13,
            color: '#555577',
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}>
            <LoadingOutlined />
            正在合成...
          </div>
        </div>
      )}

      {/* 合成结果展示 */}
      {composeStatus === 'done' && (
        <div className="compose-progress">
          <Progress percent={100} status="success" />
          <div style={{
            textAlign: 'center',
            fontSize: 13,
            color: '#52C41A',
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}>
            <CheckCircleOutlined />
            合成完成！
            {outputPath && (
              <span style={{ color: '#888', fontSize: 11, marginLeft: 8 }}>
                {outputPath.split(/[\\/]/).pop()}
              </span>
            )}
          </div>
        </div>
      )}

      {composeStatus === 'error' && (
        <div className="compose-progress">
          <Progress percent={composeProgress} status="exception" />
          <div style={{
            textAlign: 'center',
            fontSize: 13,
            color: '#FF4D4F',
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}>
            <CloseCircleOutlined />
            合成失败，请重试
          </div>
        </div>
      )}

      {/* 合成按钮 */}
      <Space>
        <Button
          type="primary"
          size="large"
          icon={<SaveOutlined />}
          onClick={handleCompose}
          loading={composing}
          disabled={!allStepsReady()}
        >
          {composing ? '正在合成...' : '合成并导出完整节目'}
        </Button>

        {composeStatus === 'done' && (
          <Button onClick={showResult}>
            查看结果
          </Button>
        )}
      </Space>
    </div>
  )
}