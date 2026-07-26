/**
 * TYICC午间悦听 - 工作流主组件
 * 
 * 六步工作流：
 * 1. 片头
 * 2. 开场语
 * 3. 演讲（TED演讲）
 * 4. 转场（转场语）
 * 5. 每日歌曲
 * 6. 结语
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Button, message, Modal } from 'antd'
import {
  PlayCircleOutlined,
  SoundOutlined,
  StepForwardOutlined,
  StepBackwardOutlined,
  DownloadOutlined,
  AudioOutlined
} from '@ant-design/icons'
import StepPanel from './StepPanel'
import ComposePanel from './ComposePanel'

// 工作流步骤定义
const STEPS = [
  {
    title: '片头',
    description: '统一的片头音频',
    key: 'opening',
    icon: <PlayCircleOutlined />,
    defaultPreset: true // 可使用预设片头
  },
  {
    title: '开场语',
    description: '开场问候与介绍',
    key: 'greeting',
    icon: <SoundOutlined />,
    defaultPreset: false
  },
  {
    title: '演讲',
    description: 'TED演讲内容',
    key: 'speech',
    icon: <SoundOutlined />,
    defaultPreset: false
  },
  {
    title: '转场',
    description: '转场语和介绍',
    key: 'transition',
    icon: <StepForwardOutlined />,
    defaultPreset: false
  },
  {
    title: '每日歌曲',
    description: '首尾相接的多首歌曲',
    key: 'music',
    icon: <DownloadOutlined />,
    defaultPreset: false
  },
  {
    title: '结语',
    description: '结束语和问候',
    key: 'ending',
    icon: <AudioOutlined />,
    defaultPreset: true
  }
]

// 预设音频文件路径
const PRESET_FILES = {
  opening: null,
  ending: null
}

const VOICE_STEP_KEYS = ['greeting', 'transition', 'ending']
const DEFAULT_BGM_VOLUME_DB = -12

function isVoiceStep(stepKey) {
  return VOICE_STEP_KEYS.includes(stepKey)
}

export default function Workflow({ networkOk, ffmpegOk }) {
  // 当前步骤索引 (0-4)
  const [currentStep, setCurrentStep] = useState(0)

  // 每个步骤的音频文件信息
  const [stepFiles, setStepFiles] = useState({
    opening: null,
    greeting: null,
    speech: null,
    transition: null,
    music: [],        // 每日歌曲为文件列表
    ending: null
  })

  const [bgmTracks, setBgmTracks] = useState({
    greeting: null,
    transition: null,
    ending: null
  })

  // 被跳过的步骤（跳过时该步骤不参与合成）
  const [skippedSteps, setSkippedSteps] = useState(new Set())

  // 响度平衡开关
  const [loudnessEnabled, setLoudnessEnabled] = useState(true)

  // 获取当前步骤的key
  const currentKey = STEPS[currentStep].key

  /**
   * 设置步骤文件
   */
  const setStepFile = useCallback((stepKey, fileInfo) => {
    setStepFiles(prev => ({
      ...prev,
      [stepKey]: fileInfo
    }))
  }, [])

  /**
   * 移除步骤文件
   */
  const removeStepFile = useCallback((stepKey) => {
    setStepFiles(prev => ({
      ...prev,
      [stepKey]: null
    }))
  }, [])

  const askConfirmRemoveShortBgm = useCallback(() => {
    return new Promise((resolve) => {
      Modal.confirm({
        title: '背景音乐时长不足',
        content: '当前背景音乐时间不符（较口播过短），导入后将删除原背景音乐，是否继续？',
        okText: '继续导入',
        cancelText: '取消',
        centered: true,
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }, [])

  const getDurationByPath = useCallback(async (filePath) => {
    if (!filePath || !window.electronAPI) return 0
    const res = await window.electronAPI.getAudioDuration({ filePath })
    if (!res || !res.success) return 0
    return Number(res.duration || 0)
  }, [])

  const setStepFileWithBgmCheck = useCallback(async (stepKey, fileInfo) => {
    if (!isVoiceStep(stepKey)) {
      setStepFile(stepKey, fileInfo)
      return true
    }

    const currentBgm = bgmTracks[stepKey]
    let voiceDuration = Number(fileInfo?.duration || 0)
    if (!voiceDuration && fileInfo?.path) {
      voiceDuration = await getDurationByPath(fileInfo.path)
    }

    if (!currentBgm) {
      setStepFiles(prev => ({ ...prev, [stepKey]: { ...fileInfo, duration: voiceDuration || fileInfo?.duration } }))
      return true
    }

    let bgmDuration = Number(currentBgm.duration || 0)
    if (!bgmDuration && currentBgm.path) {
      bgmDuration = await getDurationByPath(currentBgm.path)
    }

    if (voiceDuration > 0 && bgmDuration > 0 && bgmDuration + 0.01 < voiceDuration) {
      const confirmed = await askConfirmRemoveShortBgm()
      if (!confirmed) {
        return false
      }
      setStepFiles(prev => ({ ...prev, [stepKey]: { ...fileInfo, duration: voiceDuration || fileInfo?.duration } }))
      setBgmTracks(prev => ({ ...prev, [stepKey]: null }))
      return true
    }

    let nextBgm = currentBgm
    if (voiceDuration > 0 && bgmDuration > 0) {
      const maxStart = Math.max(0, bgmDuration - voiceDuration)
      const rawStart = Number(currentBgm.startTime || 0)
      const nextStart = (rawStart <= maxStart + 0.01) ? rawStart : 0
      const nextEnd = Math.min(bgmDuration, nextStart + voiceDuration)
      nextBgm = {
        ...currentBgm,
        duration: bgmDuration,
        voiceDuration,
        startTime: nextStart,
        endTime: nextEnd
      }
    }

    setStepFiles(prev => ({ ...prev, [stepKey]: { ...fileInfo, duration: voiceDuration || fileInfo?.duration } }))
    setBgmTracks(prev => ({ ...prev, [stepKey]: nextBgm }))
    return true
  }, [bgmTracks, askConfirmRemoveShortBgm, getDurationByPath, setStepFile])

  const ensureBgmDuration = useCallback(async (stepKey, bgmPath) => {
    const voiceFile = stepFiles[stepKey]
    if (!voiceFile || !voiceFile.path) {
      throw new Error('请先准备口播音频，再添加背景音乐')
    }
    if (!window.electronAPI) {
      throw new Error('该功能仅在桌面应用可用')
    }
    const voiceDurRes = await window.electronAPI.getAudioDuration({ filePath: voiceFile.path })
    const bgmDurRes = await window.electronAPI.getAudioDuration({ filePath: bgmPath })
    if (!voiceDurRes.success || !bgmDurRes.success) {
      throw new Error((voiceDurRes.message || bgmDurRes.message || '无法读取音频时长'))
    }
    const voiceDuration = Number(voiceDurRes.duration || 0)
    const bgmDuration = Number(bgmDurRes.duration || 0)
    if (bgmDuration + 0.01 < voiceDuration) {
      throw new Error(`背景音乐时长不足：背景 ${bgmDuration.toFixed(1)}s，口播 ${voiceDuration.toFixed(1)}s`)
    }
    return { voiceDuration, bgmDuration }
  }, [stepFiles])

  const onSelectBgmLocal = useCallback(async (stepKey) => {
    try {
      if (!window.electronAPI) return
      const result = await window.electronAPI.openFileDialog()
      if (result.canceled || !result.filePaths?.length) return
      const filePath = result.filePaths[0]
      const fileInfo = await window.electronAPI.getFileInfo({ filePath })
      const { voiceDuration, bgmDuration } = await ensureBgmDuration(stepKey, filePath)
      setBgmTracks(prev => ({
        ...prev,
        [stepKey]: {
          name: filePath.split(/[\\/]/).pop(),
          path: filePath,
          source: 'local',
          size: fileInfo.size,
          startTime: 0,
          endTime: voiceDuration,
          duration: bgmDuration,
          voiceDuration,
          volumeDb: DEFAULT_BGM_VOLUME_DB
        }
      }))
      message.success('背景音乐已添加')
    } catch (err) {
      message.warning(err.message)
    }
  }, [ensureBgmDuration])

  const onSelectBgmBilibili = useCallback(async (stepKey, input) => {
    try {
      if (!window.electronAPI) return
      if (!networkOk) {
        message.warning('B站网络连接失败，下载可能无法进行')
      }
      const tempDir = await window.electronAPI.getTempDir()
      const result = await window.electronAPI.downloadBilibili({
        url: input,
        outputDir: tempDir,
        quality: 'best'
      })
      if (!result.success) {
        message.error(result.message || '背景音乐下载失败')
        return
      }
      const fileInfo = await window.electronAPI.getFileInfo({ filePath: result.filePath })
      const { voiceDuration, bgmDuration } = await ensureBgmDuration(stepKey, result.filePath)
      setBgmTracks(prev => ({
        ...prev,
        [stepKey]: {
          name: result.fileName,
          path: result.filePath,
          source: 'bilibili',
          bvId: input,
          size: fileInfo.size,
          startTime: 0,
          endTime: voiceDuration,
          duration: bgmDuration,
          voiceDuration,
          volumeDb: DEFAULT_BGM_VOLUME_DB
        }
      }))
      message.success('背景音乐下载并添加成功')
    } catch (err) {
      message.warning(err.message)
    }
  }, [networkOk, ensureBgmDuration])

  const onRemoveBgm = useCallback((stepKey) => {
    setBgmTracks(prev => ({ ...prev, [stepKey]: null }))
  }, [])

  const onUpdateBgmSegment = useCallback((stepKey, segment) => {
    setBgmTracks(prev => {
      const old = prev[stepKey]
      if (!old) return prev
      return {
        ...prev,
        [stepKey]: {
          ...old,
          startTime: Number(segment.startTime || 0),
          endTime: Number(segment.endTime || 0),
          duration: Number(segment.duration || old.duration || 0)
        }
      }
    })
  }, [])

  const onUpdateBgmVolume = useCallback((stepKey, volumeDb) => {
    setBgmTracks(prev => {
      const old = prev[stepKey]
      if (!old) return prev
      return {
        ...prev,
        [stepKey]: {
          ...old,
          volumeDb: Number(volumeDb)
        }
      }
    })
  }, [])

  /**
   * 使用预设音频
   */
  const handleUsePreset = useCallback(async (stepKey) => {
    if (stepKey === 'opening') {
      if (!window.electronAPI) {
        message.info('预设音频在浏览器预览中不可用')
        return
      }
      try {
        const result = await window.electronAPI.getPresetOpening()
        if (result.success) {
          setStepFile('opening', {
            name: '广播站开头音频.MP3',
            path: result.filePath,
            source: 'preset',
            size: result.size
          })
          message.success('已使用预设开场音频')
        } else {
          message.error('预设音频加载失败：' + (result.message || '文件不存在'))
        }
      } catch (err) {
        message.error('加载预设音频出错：' + err.message)
      }
      return
    }
    const preset = PRESET_FILES[stepKey]
    if (preset) {
      message.success('已使用预设音频')
    } else {
      message.info('暂无可用的预设音频，请选择本地文件或从B站下载')
    }
  }, [setStepFile])

  /**
   * 处理B站下载
   */
  const handleBilibiliDownload = useCallback(async (stepKey, bvId) => {
    try {
      if (!window.electronAPI) {
        message.error('下载功能仅在桌面应用中可用')
        return
      }

      if (!networkOk) {
        message.warning('B站网络连接失败，下载可能无法进行')
      }

      // 获取临时目录
      const tempDir = await window.electronAPI.getTempDir()

      // 执行下载
      const result = await window.electronAPI.downloadBilibili({
        url: bvId,
        outputDir: tempDir,
        quality: 'best'
      })

      if (result.success) {
        const applied = await setStepFileWithBgmCheck(stepKey, {
          name: result.fileName,
          path: result.filePath,
          source: 'bilibili',
          bvId: bvId
        })
        if (applied) {
          message.success(`下载成功：${result.fileName}`)
        }
      } else {
        message.error(result.message || '下载失败')
      }
    } catch (err) {
      message.error('下载出错：' + err.message)
    }
  }, [networkOk, setStepFileWithBgmCheck])

  /**
   * 向音乐列表添加本地文件
   */
  const handleAddMusicFile = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        message.error('文件选择仅在桌面应用中可用')
        return
      }
      const result = await window.electronAPI.openFileDialog()
      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const fileName = filePath.split(/[\\/]/).pop()
        const fileInfo = await window.electronAPI.getFileInfo({ filePath })
        setStepFiles(prev => ({
          ...prev,
          music: [...(prev.music || []), { name: fileName, path: filePath, source: 'local', size: fileInfo.size }]
        }))
        message.success(`已添加：${fileName}`)
      }
    } catch (err) {
      message.error('添加文件出错：' + err.message)
    }
  }, [])

  /**
   * 为音乐列表从B站下载
   */
  const handleDownloadMusicBilibili = useCallback(async (bvId) => {
    try {
      if (!window.electronAPI) {
        message.error('下载功能仅在桌面应用中可用')
        return
      }
      if (!networkOk) {
        message.warning('B站网络连接失败，下载可能无法进行')
      }
      const tempDir = await window.electronAPI.getTempDir()
      const result = await window.electronAPI.downloadBilibili({
        url: bvId,
        outputDir: tempDir,
        quality: 'best'
      })
      if (result.success) {
        setStepFiles(prev => ({
          ...prev,
          music: [...(prev.music || []), { name: result.fileName, path: result.filePath, source: 'bilibili', bvId: bvId }]
        }))
        message.success(`下载成功：${result.fileName}`)
      } else {
        message.error(result.message || '下载失败')
      }
    } catch (err) {
      message.error('下载出错：' + err.message)
    }
  }, [networkOk])

  /**
   * 从音乐列表移除文件
   */
  const handleRemoveMusicFile = useCallback((index) => {
    setStepFiles(prev => ({
      ...prev,
      music: prev.music.filter((_, i) => i !== index)
    }))
  }, [])

  /**
   * 移动音乐列表中的歌曲位置
   */
  const handleMoveMusicFile = useCallback((index, direction) => {
    setStepFiles(prev => {
      const arr = [...(prev.music || [])]
      const target = index + direction
      if (target < 0 || target >= arr.length) return prev
      ;[arr[index], arr[target]] = [arr[target], arr[index]]
      return { ...prev, music: arr }
    })
  }, [])

  // 片头自动加载预设（仅首次进入时）
  const autoPresetTriggered = useRef(false)
  useEffect(() => {
    if (currentStep === 0 && !stepFiles.opening && !autoPresetTriggered.current) {
      autoPresetTriggered.current = true
      handleUsePreset('opening')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, stepFiles.opening])

  /**
   * 处理本地文件选择
   */
  const handleLocalFile = useCallback(async (stepKey) => {
    try {
      if (!window.electronAPI) {
        message.error('文件选择仅在桌面应用中可用')
        return
      }

      const result = await window.electronAPI.openFileDialog()

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const fileName = filePath.split(/[\\/]/).pop()

        // 获取文件信息
        const fileInfo = await window.electronAPI.getFileInfo({ filePath })

        const applied = await setStepFileWithBgmCheck(stepKey, {
          name: fileName,
          path: filePath,
          source: 'local',
          size: fileInfo.size
        })
        if (applied) {
          message.success(`已选择：${fileName}`)
        }
      }
    } catch (err) {
      message.error('选择文件出错：' + err.message)
    }
  }, [setStepFileWithBgmCheck])

  // 判断某步骤是否已完成（有文件或被跳过）
  const isStepDone = (key) => {
    if (skippedSteps.has(key)) return true
    const val = stepFiles[key]
    if (key === 'music') return Array.isArray(val) && val.length > 0
    return val !== null && val !== undefined
  }

  /**
   * 检查是否可以进入下一步
   */
  const canGoNext = () => {
    return isStepDone(currentKey)
  }

  /**
   * 跳过当前步骤
   */
  const handleSkipStep = useCallback((stepKey) => {
    setSkippedSteps(prev => new Set([...prev, stepKey]))
    if (stepKey === currentKey && currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1)
    }
  }, [currentKey, currentStep])

  /**
   * 取消跳过某步骤
   */
  const handleUnskipStep = useCallback((stepKey) => {
    setSkippedSteps(prev => {
      const next = new Set(prev)
      next.delete(stepKey)
      return next
    })
  }, [])

  /**
   * 下一步
   */
  const goNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1)
    }
  }

  /**
   * 上一步
   */
  const goPrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1)
    }
  }

  return (
    <>
      {/* 顶部栏目 */}
      <div className="app-header">
        <div className="app-header-left">
          <img
            className="app-header-logo"
            src="./static/TYICC午间悦听logo_V1.0_画板 1.png"
            alt="Logo"
            onError={(e) => {
              if (!e.target.dataset.fallbackTried) {
                e.target.dataset.fallbackTried = '1'
                e.target.src = 'static/TYICC午间悦听logo_V1.0_画板 1.png'
              }
            }}
          />
          <span className="app-header-title">TYICC 午间悦听制作器</span>
        </div>
        <div className="app-header-right">
          {/* 可在此添加设置按钮等 */}
        </div>
      </div>

      {/* 主内容区 — 左面板(进度) + 右面板(工作流) */}
      <div className="app-content">
        <div className="app-content-layout">
          {/* 左侧工作进度面板 */}
          <div className="progress-sidebar">
            <div className="progress-sidebar-title">工作进度</div>
            <div className="progress-sidebar-list">
              {STEPS.map((step, index) => {
                const hasFile = isStepDone(step.key)
                const isCurrent = index === currentStep
                return (
                  <div
                    key={step.key}
                    className={`progress-sidebar-item ${isCurrent ? 'current' : ''} ${hasFile ? 'done' : ''}`}
                    onClick={() => setCurrentStep(index)}
                  >
                    <div className="progress-sidebar-num">{index + 1}</div>
                    <div className="progress-sidebar-info">
                      <div className="progress-sidebar-label">{step.title}</div>
                      <div className="progress-sidebar-status">
                        {skippedSteps.has(step.key) ? '⏭️ 已跳过' : hasFile ? '✅ 已准备' : isCurrent ? '◀ 进行中' : '⏳ 待完成'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="progress-sidebar-footer">
              {STEPS.filter(s => isStepDone(s.key)).length} / {STEPS.length} 已完成
            </div>
          </div>

          {/* 右侧工作流面板 */}
          <div className="workflow-container">
          {/* 章节指示器 — 可点击跳转 */}
          <div className="workflow-steps-bar">
            <div className="step-indicator">
              {STEPS.map((step, index) => (
                <React.Fragment key={step.key}>
                  {index > 0 && <span className="step-indicator-arrow">→</span>}
                  <span
                    className={`step-indicator-item ${index === currentStep ? 'active' : ''} ${isStepDone(step.key) ? 'done' : ''} ${skippedSteps.has(step.key) ? 'skipped' : ''}`}
                    onClick={() => setCurrentStep(index)}
                    title={`跳转到${step.title}`}
                  >
                    <span className="step-indicator-num">{index + 1}</span>
                    <span className="step-indicator-label">{step.title}</span>
                    {isStepDone(step.key) && !skippedSteps.has(step.key) && <span className="step-indicator-check">✓</span>}
                    {skippedSteps.has(step.key) && <span className="step-indicator-check" style={{ color: '#FAAD14' }}>⏭</span>}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* 当前步骤面板 — key 确保切换步骤时重新挂载，重置面板状态 */}
          <div className="workflow-content">
            <StepPanel
              key={currentStep}
              step={STEPS[currentStep]}
              stepIndex={currentStep}
              file={currentKey === 'music' ? null : stepFiles[currentKey]}
              bgm={bgmTracks[currentKey] || null}
              musicFiles={currentKey === 'music' ? (stepFiles.music || []) : []}
              isSkipped={skippedSteps.has(currentKey)}
              loudnessEnabled={loudnessEnabled}
              ffmpegOk={ffmpegOk}
              networkOk={networkOk}
              onSetFile={setStepFileWithBgmCheck}
              onRemoveFile={removeStepFile}
              onLocalFile={handleLocalFile}
              onBilibiliDownload={handleBilibiliDownload}
              onUsePreset={handleUsePreset}
              onSelectBgmLocal={onSelectBgmLocal}
              onSelectBgmBilibili={onSelectBgmBilibili}
              onRemoveBgm={onRemoveBgm}
              onUpdateBgmSegment={onUpdateBgmSegment}
              onUpdateBgmVolume={onUpdateBgmVolume}
              onAddMusicFile={handleAddMusicFile}
              onDownloadMusicBilibili={handleDownloadMusicBilibili}
              onRemoveMusicFile={handleRemoveMusicFile}
              onMoveMusicFile={handleMoveMusicFile}
              onUnskipStep={handleUnskipStep}
            />

            {/* 全局选项 */}
            <div className="step-options">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={loudnessEnabled}
                  onChange={(e) => setLoudnessEnabled(e.target.checked)}
                />
                <span>自动响度平衡（{ffmpegOk ? '可用' : '不可用 - 缺少FFmpeg'}）</span>
              </label>
            </div>

            {/* 导航按钮 */}
            <div className="step-navigation">
              <div>
                {currentStep > 0 && (
                  <Button
                    onClick={goPrev}
                    icon={<StepBackwardOutlined />}
                  >
                    上一步
                  </Button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!skippedSteps.has(currentKey) && !(currentKey !== 'music' && stepFiles[currentKey]) && !(currentKey === 'music' && stepFiles.music?.length > 0) && (
                  <Button
                    onClick={() => handleSkipStep(currentKey)}
                  >
                    跳过
                  </Button>
                )}
                {currentStep < STEPS.length - 1 ? (
                  <Button
                    type="primary"
                    onClick={goNext}
                    icon={<StepForwardOutlined />}
                    disabled={!canGoNext()}
                  >
                    下一步
                  </Button>
                ) : (
                  <ComposePanel
                    stepFiles={stepFiles}
                    bgmTracks={bgmTracks}
                    skippedSteps={skippedSteps}
                    loudnessEnabled={loudnessEnabled}
                    ffmpegOk={ffmpegOk}
                  />
                )}
              </div>
            </div>  {/* step-navigation */}
          </div>  {/* workflow-content */}
        </div>  {/* workflow-container */}
        </div>  {/* app-content-layout */}
      </div>  {/* app-content */}
    </>
  )
}