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
  { key: 'opening', label: '片头' },
  { key: 'greeting', label: '开场语' },
  { key: 'speech', label: '演讲 - TED演讲内容' },
  { key: 'transition', label: '转场 - 介绍语' },
  { key: 'music', label: '每日歌曲' },
  { key: 'ending', label: '结语' }
]

const SPEECH_KEYS = new Set(['greeting', 'transition', 'ending'])
const DEFAULT_BGM_VOLUME_DB = -12
const EXPORT_NAME_STORAGE_KEY = 'tyicc.export.studentName'

function sanitizeFilePart(text) {
  return String(text || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
}

function dbToLinear(db) {
  const d = Number(db)
  if (Number.isNaN(d)) return Math.pow(10, DEFAULT_BGM_VOLUME_DB / 20)
  return Math.pow(10, d / 20)
}

export default function ComposePanel({ stepFiles, bgmTracks, skippedSteps, loudnessEnabled, ffmpegOk }) {
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [studentName, setStudentName] = useState(() => {
    try {
      return localStorage.getItem(EXPORT_NAME_STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })
  const [dateMode, setDateMode] = useState('known') // known | unknown
  const [programDate, setProgramDate] = useState(() => new Date().toISOString().slice(0, 10))

  const [composing, setComposing] = useState(false)
  const [composeProgress, setComposeProgress] = useState(0)
  const [composeStatus, setComposeStatus] = useState('idle') // idle | processing | done | error
  const [composeMessage, setComposeMessage] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const roundedProgress = Math.round(Number(composeProgress) || 0)

  /**
   * 检查所有步骤是否已准备就绪（被跳过的也算就绪）
   */
  const allStepsReady = () => {
    return COMPOSE_ORDER.every(item => {
      if (skippedSteps && skippedSteps.has(item.key)) return true
      const val = stepFiles[item.key]
      if (item.key === 'music') return Array.isArray(val) && val.length > 0
      return val !== null && val !== undefined
    })
  }

  /**
   * 处理合成
   */
  const handleCompose = async ({ studentName: name, programDate: dateLabel, defaultName }) => {
    if (!allStepsReady()) {
      message.warning('请先完成所有步骤的音频选择')
      return
    }

    let unsubscribeConcatProgress = null

    try {
      // 选择保存路径
      if (!window.electronAPI) {
        message.error('合成功能仅在桌面应用中可用')
        return
      }

      const saveResult = await window.electronAPI.openSaveDialog({
        defaultName: defaultName || `TYICC午间悦听_${new Date().toISOString().slice(0, 10)}.mp3`,
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
      setComposeMessage('正在准备合成任务...')
      setComposeProgress(0)

      // 阶段1: 收集文件
      setComposeProgress(5)
      const orderKeys = COMPOSE_ORDER.map(item => item.key)

      // 获取临时目录
      const tempDir = await window.electronAPI.getTempDir()

      // 阶段2: 如果开启响度平衡，对每个音频进行处理
      setComposeProgress(15)
      let processedEntries = []

      // 展平所有待合成的文件（跳过被跳过的步骤）
      const collectEntries = () => {
        const entries = []
        for (const key of orderKeys) {
          if (skippedSteps && skippedSteps.has(key)) continue
          const val = stepFiles[key]
          if (key === 'music' && Array.isArray(val)) {
            for (const mf of val) {
              if (mf && mf.path) {
                entries.push({ key, path: mf.path.replace(/\\/g, '/'), label: mf.name || 'music' })
              }
            }
          } else if (val && val.path) {
            entries.push({ key, path: val.path.replace(/\\/g, '/'), label: val.name || key })
          }
        }
        return entries
      }

      const allEntries = collectEntries()

      if (loudnessEnabled && ffmpegOk) {
        setComposeMessage('正在对各个音频进行响度平衡...')
        for (let i = 0; i < allEntries.length; i++) {
          const entry = allEntries[i]
          const normalizedPath = entry.path
          setComposeProgress(15 + (i / Math.max(1, allEntries.length)) * 45)

          const normalizeResult = await window.electronAPI.normalizeLoudness({
            inputPath: normalizedPath,
            outputPath: `${tempDir}/normalized_${i}.wav`,
            targetLUFS: -23
          })

          if (normalizeResult.success) {
            processedEntries.push({ ...entry, path: `${tempDir}/normalized_${i}.wav` })
          } else {
            message.warning(`第 ${i + 1} 段响度平衡失败，使用原始文件`) 
            processedEntries.push(entry)
          }
        }
      } else {
        // 不使用响度平衡，直接拼接
        processedEntries = allEntries
      }

      // 阶段3: 口播叠加背景音乐（在响度平衡之后）
      setComposeMessage('正在为口播段叠加背景音乐...')
      for (let i = 0; i < processedEntries.length; i++) {
        const entry = processedEntries[i]
        setComposeProgress(60 + (i / Math.max(1, processedEntries.length)) * 20)
        if (!SPEECH_KEYS.has(entry.key)) continue

        const bgm = bgmTracks && bgmTracks[entry.key]
        if (!bgm || !bgm.path) continue

        const durRes = await window.electronAPI.getAudioDuration({ filePath: entry.path })
        if (!durRes.success) {
          throw new Error(`无法读取${entry.label}时长：${durRes.message || '未知错误'}`)
        }
        const voiceDuration = Number(durRes.duration || 0)
        const startSec = Number(bgm.startTime || 0)
        const volumeDb = (typeof bgm.volumeDb === 'number') ? bgm.volumeDb : DEFAULT_BGM_VOLUME_DB
        const bgmVolume = dbToLinear(volumeDb)

        const mixOut = `${tempDir}/bgm_mix_${entry.key}_${i}.wav`
        const mixRes = await window.electronAPI.mixVoiceWithBgm({
          voicePath: entry.path,
          bgmPath: bgm.path,
          startSec,
          durationSec: voiceDuration,
          bgmVolume,
          outputPath: mixOut
        })

        if (!mixRes.success) {
          throw new Error(`口播背景音乐混音失败（${entry.label}）：${mixRes.message || '未知错误'}`)
        }
        entry.path = mixOut
      }

      // 阶段4: 拼接音频
      setComposeProgress(85)
      setComposeMessage('正在拼接各段落...')

      const concatJobId = `concat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      if (window.electronAPI?.onConcatenateProgress) {
        unsubscribeConcatProgress = window.electronAPI.onConcatenateProgress((payload) => {
          if (!payload || payload.jobId !== concatJobId) return
          const pct = Math.max(0, Math.min(100, Number(payload.percent) || 0))
          const mapped = 85 + pct * 0.14
          setComposeProgress((prev) => Math.round(Math.max(prev, mapped)))
          setComposeMessage(`正在拼接各段落... ${Math.round(pct)}%`)
        })
      }

      const concatResult = await window.electronAPI.concatenateAudio({
        fileList: processedEntries.map(e => e.path),
        outputPath: saveResult.filePath,
        jobId: concatJobId,
        metadata: {
          studentName: name,
          programDate: dateLabel
        }
      })

      if (concatResult.success) {
        setComposeProgress(100)
        setComposeStatus('done')
        setComposeMessage('合成完成')
        // 自动打开输出文件所在文件夹
        if (window.electronAPI && saveResult.filePath) {
          window.electronAPI.openFileLocation({ filePath: saveResult.filePath }).catch(() => {})
        }
        message.success('合成完成！')
      } else {
        throw new Error(concatResult.message || '合成失败')
      }

    } catch (err) {
      setComposeStatus('error')
      setComposeMessage('合成失败，请重试')
      message.error('合成出错：' + err.message)
    } finally {
      if (unsubscribeConcatProgress) {
        unsubscribeConcatProgress()
      }
      setComposing(false)
    }
  }

  const openExportModal = () => {
    if (!allStepsReady()) {
      message.warning('请先完成所有步骤的音频选择')
      return
    }
    setExportModalOpen(true)
  }

  const confirmExportMeta = async () => {
    const cleanName = sanitizeFilePart(studentName)
    if (!cleanName) {
      message.warning('请填写姓名')
      return
    }

    const knownDate = dateMode === 'known'
    const cleanDate = knownDate ? sanitizeFilePart(programDate) : ''
    if (knownDate && !cleanDate) {
      message.warning('请填写预计播出日期，或将日期设为“未知”')
      return
    }

    const dateLabel = knownDate ? cleanDate : '未知'
    const defaultName = `TYICC午间悦听_${cleanName}${knownDate ? `_${cleanDate}` : ''}.mp3`

    try {
      localStorage.setItem(EXPORT_NAME_STORAGE_KEY, cleanName)
    } catch {}

    setExportModalOpen(false)
    await handleCompose({
      studentName: cleanName,
      programDate: dateLabel,
      defaultName
    })
  }

  /**
   * 弹出合成结果消息
   */
  const showResult = () => {
    if (window.electronAPI && outputPath) {
      window.electronAPI.openFileLocation({ filePath: outputPath }).catch(() => {})
    }
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

  // 检查哪些步骤缺少文件（排除已跳过的）
  const missingSteps = COMPOSE_ORDER.filter(item => {
    if (skippedSteps && skippedSteps.has(item.key)) return false
    const val = stepFiles[item.key]
    if (item.key === 'music') return !Array.isArray(val) || val.length === 0
    return !val
  })

  return (
    <div className="compose-section">
      <div className="compose-title">
        <PlayCircleOutlined style={{ marginRight: 8 }} />
        工作进度
      </div>

      {/* 合成预览 - 显示各段落的准备情况 */}
      <div className="compose-preview">
        {COMPOSE_ORDER.map((item, index) => {
          const val = stepFiles[item.key]
          const isSkippedVal = skippedSteps && skippedSteps.has(item.key)
          const hasFile = isSkippedVal || (item.key === 'music' ? (Array.isArray(val) && val.length > 0) : !!val)
          return (
            <div
              key={item.key}
              className={`compose-item ${hasFile ? 'active' : ''}`}
              style={{
                opacity: hasFile ? 1 : 0.5,
                borderLeft: `3px solid ${isSkippedVal ? '#FAAD14' : hasFile ? '#6C63FF' : '#E8E8F0'}`
              }}
            >
              <span>{index + 1}.</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {isSkippedVal ? (
                <span style={{ color: '#FAAD14', fontSize: 12 }}>⏭️ 已跳过</span>
              ) : hasFile ? (
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
            percent={roundedProgress}
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
            {composeMessage || '正在合成...'}
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
          <Progress percent={roundedProgress} status="exception" />
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
          onClick={openExportModal}
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

      <Modal
        title="导出信息"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={confirmExportMeta}
        okText="继续导出"
        cancelText="取消"
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 6, fontSize: 13 }}>姓名</div>
            <input
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="请输入姓名"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid #d9d9d9', borderRadius: 6 }}
            />
          </div>

          <div>
            <div style={{ marginBottom: 6, fontSize: 13 }}>预计播出日期</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Button size="small" type={dateMode === 'known' ? 'primary' : 'default'} onClick={() => setDateMode('known')}>
                已知
              </Button>
              <Button size="small" type={dateMode === 'unknown' ? 'primary' : 'default'} onClick={() => setDateMode('unknown')}>
                未知
              </Button>
            </div>
            {dateMode === 'known' && (
              <input
                type="date"
                value={programDate}
                onChange={(e) => setProgramDate(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #d9d9d9', borderRadius: 6 }}
              />
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}