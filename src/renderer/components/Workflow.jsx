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

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Button, message, Modal, Tooltip, Dropdown, Tabs, Empty, Input } from 'antd'
import {
  PlayCircleOutlined,
  SoundOutlined,
  StepForwardOutlined,
  StepBackwardOutlined,
  DownloadOutlined,
  AudioOutlined,
  SettingOutlined,
  ToolOutlined,
  TeamOutlined,
  InboxOutlined
} from '@ant-design/icons'
import StepPanel from './StepPanel'
import ComposePanel from './ComposePanel'
import MusicLibraryPackageBuilder from './MusicLibraryPackageBuilder'

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
const ADVANCED_PASSWORD_SHA256 = '90ec12f61dd4c3eb0e93948c2a19fefa91523b6406b4b244507fbc62f2abdbe6'
const PREV_BGM_STEP_MAP = {
  transition: 'greeting',
  ending: 'transition'
}
function getBgmRepeatCount(voiceDuration, bgmDuration, startTime = 0) {
  const voice = Math.max(0, Number(voiceDuration) || 0)
  const bgm = Math.max(0, Number(bgmDuration) || 0)
  const start = Math.max(0, Number(startTime) || 0)
  if (voice <= 0 || bgm <= 0) return 1
  return Math.max(1, Math.ceil((voice + start) / bgm))
}

function isSameBgmTrack(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    String(a.name || '') === String(b.name || '') &&
    String(a.path || '') === String(b.path || '') &&
    String(a.source || '') === String(b.source || '') &&
    String(a.linkedFromStepKey || '') === String(b.linkedFromStepKey || '') &&
    String(a.rootLinkedFromStepKey || '') === String(b.rootLinkedFromStepKey || '') &&
    String(a.linkMode || '') === String(b.linkMode || '') &&
    String(a.artist || '') === String(b.artist || '') &&
    Number(a.size || 0) === Number(b.size || 0) &&
    Number(a.startTime || 0) === Number(b.startTime || 0) &&
    Number(a.endTime || 0) === Number(b.endTime || 0) &&
    Number(a.duration || 0) === Number(b.duration || 0) &&
    Number(a.voiceDuration || 0) === Number(b.voiceDuration || 0) &&
    Number(a.volumeDb || 0) === Number(b.volumeDb || 0) &&
    JSON.stringify(Array.isArray(a.tags) ? a.tags : []) === JSON.stringify(Array.isArray(b.tags) ? b.tags : [])
  )
}

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
  const [showPackageBuilder, setShowPackageBuilder] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState('general')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [cacheLoading, setCacheLoading] = useState(false)
  const [cacheBytes, setCacheBytes] = useState(0)
  const [continuePlaybackEnabled, setContinuePlaybackEnabled] = useState(true)
  const [showContributors, setShowContributors] = useState(false)
  const [contributorsLoading, setContributorsLoading] = useState(false)
  const [contributors, setContributors] = useState([])
  const [advancedUnlocked, setAdvancedUnlocked] = useState(false)
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [stepDurationMap, setStepDurationMap] = useState({
    opening: 0,
    greeting: 0,
    speech: 0,
    transition: 0,
    music: 0,
    ending: 0
  })

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

  const buildBgmTrackMeta = useCallback((bgmTrack, voiceDuration, bgmDuration, startTime = 0) => {
    const repeatCount = getBgmRepeatCount(voiceDuration, bgmDuration, startTime)
    return {
      ...bgmTrack,
      duration: Number(bgmDuration || 0),
      voiceDuration: Number(voiceDuration || 0),
      startTime: Math.max(0, Number(startTime) || 0),
      endTime: Math.max(0, Number(startTime) || 0) + Math.max(0, Number(voiceDuration) || 0),
      repeatCount
    }
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

    let nextBgm = currentBgm
    if (voiceDuration > 0 && bgmDuration > 0) {
      const rawStart = Number(currentBgm.startTime || 0)
      const nextStart = bgmDuration > 0 ? ((rawStart % bgmDuration) + bgmDuration) % bgmDuration : 0
      nextBgm = buildBgmTrackMeta(currentBgm, voiceDuration, bgmDuration, nextStart)
    }

    setStepFiles(prev => ({ ...prev, [stepKey]: { ...fileInfo, duration: voiceDuration || fileInfo?.duration } }))
    setBgmTracks(prev => ({ ...prev, [stepKey]: nextBgm }))
    return true
  }, [bgmTracks, buildBgmTrackMeta, getDurationByPath, setStepFile])

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
        [stepKey]: buildBgmTrackMeta({
          name: filePath.split(/[\\/]/).pop(),
          path: filePath,
          source: 'local',
          size: fileInfo.size,
          startTime: 0,
          endTime: voiceDuration,
          duration: bgmDuration,
          voiceDuration,
          volumeDb: DEFAULT_BGM_VOLUME_DB
        }, voiceDuration, bgmDuration, 0)
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
        [stepKey]: buildBgmTrackMeta({
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
        }, voiceDuration, bgmDuration, 0)
      }))
      message.success('背景音乐下载并添加成功')
    } catch (err) {
      message.warning(err.message)
    }
  }, [networkOk, ensureBgmDuration])

  const onSelectBgmFromLibrary = useCallback(async (stepKey, track) => {
    try {
      if (!track?.path) return
      const { voiceDuration, bgmDuration } = await ensureBgmDuration(stepKey, track.path)
      setBgmTracks(prev => ({
        ...prev,
        [stepKey]: buildBgmTrackMeta({
          name: track.title || track.name || track.filename || String(track.path).split(/[\\/]/).pop(),
          path: track.path,
          source: 'library',
          libraryTrackId: track.id,
          artist: track.artist || '',
          tags: Array.isArray(track.tags) ? track.tags : [],
          size: Number(track.size || 0),
          startTime: 0,
          endTime: voiceDuration,
          duration: bgmDuration,
          voiceDuration,
          volumeDb: DEFAULT_BGM_VOLUME_DB
        }, voiceDuration, bgmDuration, 0)
      }))
      message.success(`已从音乐库导入：${track.title || track.name || '未命名音乐'}`)
      return true
    } catch (err) {
      message.warning(err.message)
      return false
    }
  }, [ensureBgmDuration])

  const onRemoveBgm = useCallback((stepKey) => {
    setBgmTracks(prev => ({ ...prev, [stepKey]: null }))
  }, [])

  const onUpdateBgmSegment = useCallback((stepKey, segment) => {
    setBgmTracks(prev => {
      const old = prev[stepKey]
      if (!old) return prev
      const nextStart = Number(segment.startTime || 0)
      const nextDuration = Number(segment.duration || old.duration || 0)
      const nextVoiceDuration = Number(old.voiceDuration || 0)
      const nextRepeatCount = getBgmRepeatCount(nextVoiceDuration, nextDuration, nextStart)
      return {
        ...prev,
        [stepKey]: {
          ...old,
          startTime: nextStart,
          endTime: Number(segment.endTime || 0),
          duration: nextDuration,
          repeatCount: nextRepeatCount
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

  const buildContinuedBgmTrack = useCallback(async ({ stepKey, prevStepKey, prevBgm, prevVoiceDuration }) => {
    if (!prevBgm?.path) return null
    const { voiceDuration, bgmDuration } = await ensureBgmDuration(stepKey, prevBgm.path)
    const rawStart = Number(prevBgm.startTime || 0) + Math.max(0, Number(prevVoiceDuration || 0))
    const wrappedStart = bgmDuration > 0 ? ((rawStart % bgmDuration) + bgmDuration) % bgmDuration : 0
    const greetingVolumeDb = (typeof bgmTracks.greeting?.volumeDb === 'number')
      ? Number(bgmTracks.greeting.volumeDb)
      : DEFAULT_BGM_VOLUME_DB

    return buildBgmTrackMeta({
      name: prevBgm.name,
      path: prevBgm.path,
      source: 'previous',
      linkedFromStepKey: prevStepKey,
      rootLinkedFromStepKey: 'greeting',
      linkMode: 'continueFromPrevious',
      artist: prevBgm.artist || '',
      tags: Array.isArray(prevBgm.tags) ? prevBgm.tags : [],
      size: Number(prevBgm.size || 0),
      volumeDb: greetingVolumeDb
    }, voiceDuration, bgmDuration, wrappedStart)
  }, [buildBgmTrackMeta, ensureBgmDuration, bgmTracks.greeting])

  const syncContinuePlaybackChain = useCallback(async () => {
    const greetingBgm = bgmTracks.greeting
    if (!greetingBgm?.path) return

    let nextTransition = null
    if (stepFiles.transition?.path) {
      const greetingVoiceDuration = Number(greetingBgm.voiceDuration || stepFiles.greeting?.duration || 0)
      nextTransition = await buildContinuedBgmTrack({
        stepKey: 'transition',
        prevStepKey: 'greeting',
        prevBgm: greetingBgm,
        prevVoiceDuration: greetingVoiceDuration
      })
    }

    const transitionForEnding = nextTransition || bgmTracks.transition
    let nextEnding = null
    if (stepFiles.ending?.path && transitionForEnding?.path) {
      const transitionVoiceDuration = Number(transitionForEnding.voiceDuration || stepFiles.transition?.duration || 0)
      nextEnding = await buildContinuedBgmTrack({
        stepKey: 'ending',
        prevStepKey: 'transition',
        prevBgm: transitionForEnding,
        prevVoiceDuration: transitionVoiceDuration
      })
    }

    setBgmTracks((prev) => {
      let changed = false
      const next = { ...prev }
      if (nextTransition && !isSameBgmTrack(prev.transition, nextTransition)) {
        next.transition = nextTransition
        changed = true
      }
      if (nextEnding && !isSameBgmTrack(prev.ending, nextEnding)) {
        next.ending = nextEnding
        changed = true
      }
      return changed ? next : prev
    })
  }, [bgmTracks.greeting, bgmTracks.transition, bgmTracks.ending, stepFiles.transition, stepFiles.ending, stepFiles.greeting, buildContinuedBgmTrack])

  const onUsePreviousBgmSameAudio = useCallback(async (stepKey) => {
    try {
      const prevStepKey = PREV_BGM_STEP_MAP[stepKey]
      if (!prevStepKey) {
        throw new Error('当前步骤不支持该功能')
      }

      const prevBgm = bgmTracks[prevStepKey]
      if (!prevBgm?.path) {
        throw new Error('请先在上一步设置背景音乐')
      }

      const { voiceDuration, bgmDuration } = await ensureBgmDuration(stepKey, prevBgm.path)
      setBgmTracks(prev => {
        const current = prev[stepKey] || null
        const currentStart = Number(current?.startTime || 0)
        const safeStart = bgmDuration > 0 ? ((currentStart % bgmDuration) + bgmDuration) % bgmDuration : 0
        const safeVolume = (typeof current?.volumeDb === 'number')
          ? Number(current.volumeDb)
          : (typeof prevBgm.volumeDb === 'number' ? Number(prevBgm.volumeDb) : DEFAULT_BGM_VOLUME_DB)

        return {
          ...prev,
          [stepKey]: buildBgmTrackMeta({
            name: prevBgm.name,
            path: prevBgm.path,
            source: 'previous',
            linkedFromStepKey: prevStepKey,
            linkMode: 'sameAudio',
            artist: prevBgm.artist || '',
            tags: Array.isArray(prevBgm.tags) ? prevBgm.tags : [],
            size: Number(prevBgm.size || 0),
            volumeDb: safeVolume
          }, voiceDuration, bgmDuration, safeStart)
        }
      })
      message.success('已使用与上一步相同的背景音乐')
    } catch (err) {
      message.warning(err.message)
    }
  }, [bgmTracks, ensureBgmDuration])

  const onUsePreviousBgmContinue = useCallback(async (stepKey) => {
    try {
      if (stepKey !== 'transition' && stepKey !== 'ending') {
        throw new Error('当前步骤不支持该功能')
      }

      const greetingBgm = bgmTracks.greeting
      if (!greetingBgm?.path) {
        throw new Error('请先在第2步设置背景音乐')
      }

      await syncContinuePlaybackChain()
      setContinuePlaybackEnabled(true)
      message.success('已启用延续上步播放（转场与结语已联动）')
    } catch (err) {
      message.warning(err.message)
    }
  }, [bgmTracks.greeting, syncContinuePlaybackChain])

  const onToggleContinuePlayback = useCallback(async (stepKey, enabled) => {
    if (stepKey !== 'transition' && stepKey !== 'ending') return
    if (enabled) {
      await onUsePreviousBgmContinue(stepKey)
      return
    }
    setContinuePlaybackEnabled(false)
    setBgmTracks((prev) => {
      const next = { ...prev }
      for (const key of ['transition', 'ending']) {
        const current = next[key]
        if (!current || current.linkMode !== 'continueFromPrevious') continue
        next[key] = {
          ...current,
          linkMode: 'sameAudio',
          repeatCount: current.repeatCount || 1
        }
      }
      return next
    })
    message.info('已关闭延续上步播放')
  }, [onUsePreviousBgmContinue])

  useEffect(() => {
    if (!continuePlaybackEnabled) return
    syncContinuePlaybackChain().catch(() => {})
  }, [continuePlaybackEnabled, syncContinuePlaybackChain])

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

  const formatProgramDuration = useCallback((seconds) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)))
    const minutes = Math.floor(safeSeconds / 60)
    const remainSeconds = safeSeconds % 60
    return `${minutes}min${remainSeconds}s`
  }, [])

  useEffect(() => {
    let disposed = false

    const resolveDuration = async (fileInfo) => {
      if (!fileInfo) return 0
      const known = Number(fileInfo.duration || 0)
      if (known > 0) return known
      if (!fileInfo.path) return 0
      return await getDurationByPath(fileInfo.path)
    }

    const recalcStepDurations = async () => {
      const next = {
        opening: 0,
        greeting: 0,
        speech: 0,
        transition: 0,
        music: 0,
        ending: 0
      }

      for (const key of ['opening', 'greeting', 'speech', 'transition', 'ending']) {
        if (skippedSteps.has(key)) {
          next[key] = 0
          continue
        }
        next[key] = await resolveDuration(stepFiles[key])
      }

      if (!skippedSteps.has('music')) {
        const musicList = Array.isArray(stepFiles.music) ? stepFiles.music : []
        const durationList = await Promise.all(musicList.map((item) => resolveDuration(item)))
        next.music = durationList.reduce((sum, value) => sum + Number(value || 0), 0)
      }

      if (!disposed) {
        setStepDurationMap(next)
      }
    }

    recalcStepDurations().catch(() => {
      if (!disposed) {
        setStepDurationMap({
          opening: 0,
          greeting: 0,
          speech: 0,
          transition: 0,
          music: 0,
          ending: 0
        })
      }
    })

    return () => {
      disposed = true
    }
  }, [stepFiles, skippedSteps, getDurationByPath])

  const totalProgramDuration = useMemo(() => {
    return STEPS.reduce((sum, step) => sum + Number(stepDurationMap[step.key] || 0), 0)
  }, [stepDurationMap])

  const hashTextSha256 = useCallback(async (text) => {
    const data = new TextEncoder().encode(String(text || ''))
    const digest = await window.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }, [])

  const runProtectedAction = useCallback((target) => {
    if (target === 'music-library-management') {
      setShowPackageBuilder(true)
      return
    }
    if (target === 'settings-advanced') {
      setSettingsTab('advanced')
    }
  }, [])

  const requestProtectedAccess = useCallback((target) => {
    if (advancedUnlocked) {
      runProtectedAction(target)
      return
    }
    setUnlockTarget(target)
    setUnlockPassword('')
    setShowUnlockModal(true)
  }, [advancedUnlocked, runProtectedAction])

  const confirmUnlock = useCallback(async () => {
    const raw = String(unlockPassword || '').trim()
    if (!raw) {
      message.warning('请输入访问密码')
      return
    }

    setUnlockLoading(true)
    try {
      const digest = await hashTextSha256(raw)
      if (digest !== ADVANCED_PASSWORD_SHA256) {
        message.error('密码错误')
        return
      }

      setAdvancedUnlocked(true)
      setShowUnlockModal(false)
      setUnlockPassword('')
      runProtectedAction(unlockTarget)
      message.success('已解锁高级功能')
    } catch (err) {
      message.error(`解锁失败：${err.message}`)
    } finally {
      setUnlockLoading(false)
    }
  }, [unlockPassword, hashTextSha256, runProtectedAction, unlockTarget])

  const advancedMenu = {
    items: [
      {
        key: 'music-library-package-builder',
        icon: <InboxOutlined />,
        label: '音乐库管理'
      }
    ],
    onClick: ({ key }) => {
      if (key === 'music-library-package-builder') {
        requestProtectedAccess('music-library-management')
      }
    }
  }

  const handleImportLibraryPackageFromSettings = useCallback(async () => {
    if (!window.electronAPI) return
    setSettingsLoading(true)
    try {
      const result = await window.electronAPI.importMusicLibraryPackage()
      if (!result || result.canceled) return
      if (!result.success) {
        throw new Error(result.message || '导入失败')
      }
      const infoRes = await window.electronAPI.getMusicLibraryInfo().catch(() => null)
      const libraryName = infoRes?.success && infoRes?.info?.libraryName
        ? String(infoRes.info.libraryName)
        : '当前音乐库'
      message.success(`已经成功导入音乐库${libraryName}，现在您可以手动删除相关的原zip文件了`)
      if (showSettings && settingsTab === 'storage') {
        const usageRes = await window.electronAPI.getStorageCacheUsage().catch(() => null)
        if (usageRes?.success) setCacheBytes(Number(usageRes.totalBytes || 0))
      }
    } catch (err) {
      message.error(`导入音乐库失败：${err.message}`)
    } finally {
      setSettingsLoading(false)
    }
  }, [showSettings, settingsTab])

  const handleClearImportedMusicLibrary = useCallback(() => {
    Modal.confirm({
      title: '确认清除已导入音乐库吗？',
      content: '此操作会删除当前已导入的音乐库曲目和导入记录，且不可撤销。',
      okText: '确认清除',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        if (!window.electronAPI?.clearMusicLibrary) return
        setSettingsLoading(true)
        try {
          const result = await window.electronAPI.clearMusicLibrary()
          if (!result?.success) {
            throw new Error(result?.message || '清除失败')
          }
          message.success(`音乐库已清除，删除 ${Number(result.removed || 0)} 首曲目`) 
        } catch (err) {
          message.error(`清除音乐库失败：${err.message}`)
        } finally {
          setSettingsLoading(false)
        }
      }
    })
  }, [])

  const formatBytes = useCallback((bytes) => {
    const n = Number(bytes || 0)
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  }, [])

  const loadStorageCacheUsage = useCallback(async () => {
    if (!window.electronAPI) return
    setCacheLoading(true)
    try {
      const result = await window.electronAPI.getStorageCacheUsage()
      if (!result?.success) {
        throw new Error(result?.message || '读取缓存大小失败')
      }
      setCacheBytes(Number(result.totalBytes || 0))
    } catch (err) {
      message.error(`读取缓存信息失败：${err.message}`)
    } finally {
      setCacheLoading(false)
    }
  }, [])

  const handleClearStorageCache = useCallback(() => {
    Modal.confirm({
      title: '确认删除缓存吗？',
      content: '软件会定期自动清除缓存，如果强行手动删除可能会导致程序出错。将主要删除临时下载文件和录音文件。',
      okText: '继续删除',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        if (!window.electronAPI) return
        setCacheLoading(true)
        try {
          const result = await window.electronAPI.clearStorageCache()
          if (!result?.success) {
            throw new Error(result?.message || '删除失败')
          }
          setCacheBytes(0)
          message.success(`缓存已删除，释放 ${formatBytes(result.clearedBytes || 0)}`)
        } catch (err) {
          message.error(`删除缓存失败：${err.message}`)
        } finally {
          setCacheLoading(false)
        }
      }
    })
  }, [formatBytes])

  useEffect(() => {
    if (!showSettings || settingsTab !== 'storage') return
    loadStorageCacheUsage()
  }, [showSettings, settingsTab, loadStorageCacheUsage])

  const loadContributors = useCallback(async () => {
    if (!window.electronAPI) return
    setContributorsLoading(true)
    try {
      const result = await window.electronAPI.getContributorText()
      if (!result?.success) {
        throw new Error(result?.message || '读取失败')
      }

      const lines = String(result.text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      const parsed = []
      for (let i = 0; i + 2 < lines.length; i += 3) {
        parsed.push({
          className: lines[i],
          name: lines[i + 1],
          info: lines[i + 2]
        })
      }

      setContributors(parsed)
    } catch (err) {
      setContributors([])
      message.error(`读取贡献者失败：${err.message}`)
    } finally {
      setContributorsLoading(false)
    }
  }, [])

  const openContributorsPage = useCallback(() => {
    setShowContributors(true)
    loadContributors()
  }, [loadContributors])

  return (
    <>
      {/* 顶部栏目 */}
      <div className="app-header">
        <div className="app-header-left">
          <img
            className="app-header-logo"
            src="./static/TYICC午间悦听logo_V1.5_画板 1.png"
            alt="Logo"
            onError={(e) => {
              if (!e.target.dataset.fallbackTried) {
                e.target.dataset.fallbackTried = '1'
                e.target.src = 'static/TYICC午间悦听logo_V1.5_画板 1.png'
              }
            }}
          />
          <span className="app-header-title">TYICC 午间悦听制作器</span>
        </div>
        <div className="app-header-right">
          <Tooltip title="设置">
            <Button className="header-icon-btn" type="text" icon={<SettingOutlined />} aria-label="设置" onClick={() => { setSettingsTab('general'); setShowSettings(true) }} />
          </Tooltip>
          <Dropdown menu={advancedMenu} trigger={['click']} placement="bottomRight">
            <Tooltip title="高级功能">
              <Button className="header-icon-btn" type="text" icon={<ToolOutlined />} aria-label="高级功能" />
            </Tooltip>
          </Dropdown>
          <Tooltip title="贡献者">
            <Button className="header-icon-btn" type="text" icon={<TeamOutlined />} aria-label="贡献者" onClick={openContributorsPage} />
          </Tooltip>
        </div>
      </div>

      <MusicLibraryPackageBuilder open={showPackageBuilder} onClose={() => setShowPackageBuilder(false)} />

      <Modal
        open={showSettings}
        title="设置"
        onCancel={() => setShowSettings(false)}
        footer={null}
        width={760}
        destroyOnHidden
      >
        <Tabs
          activeKey={settingsTab}
          onChange={(key) => {
            if (key === 'advanced') {
              requestProtectedAccess('settings-advanced')
              return
            }
            setSettingsTab(key)
          }}
          items={[
            {
              key: 'general',
              label: '常规',
              children: (
                <section style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 14, background: '#fff' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>常规</div>
                  <div style={{ fontSize: 13, color: '#666' }}>
                    常规设置将在后续版本继续补充。
                  </div>
                </section>
              )
            },
            {
              key: 'storage',
              label: '存储',
              children: (
                <section style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 14, background: '#fff' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>存储</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>1. 导入音乐库</div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                        导入新的音乐库文件后，音乐库会更新为最新内容。
                      </div>
                      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                        <Button type="primary" onClick={handleImportLibraryPackageFromSettings} loading={settingsLoading}>选择文件并导入</Button>
                        <Button danger onClick={handleClearImportedMusicLibrary} loading={settingsLoading}>清除已导入音乐库</Button>
                      </div>
                    </div>
                    <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>2. 清理缓存</div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                        主要清理临时下载文件和录音文件。软件会定期自动清理，通常不需要手动操作。
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <Button danger onClick={handleClearStorageCache} loading={cacheLoading}>删除缓存</Button>
                        <span style={{ fontSize: 12, color: '#666' }}>当前缓存大小：{formatBytes(cacheBytes)}</span>
                        <Button size="small" onClick={loadStorageCacheUsage} loading={cacheLoading}>刷新</Button>
                      </div>
                    </div>
                  </div>
                </section>
              )
            },
            {
              key: 'advanced',
              label: '高级',
              children: (
                <section style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 14, background: '#fff' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>高级</div>
                  <div style={{ fontSize: 13, color: '#666' }}>
                    暂无可用的高级设置。
                  </div>
                </section>
              )
            }
          ]}
        />
      </Modal>

      <Modal
        open={showUnlockModal}
        title="输入密码"
        onCancel={() => {
          setShowUnlockModal(false)
          setUnlockPassword('')
          setUnlockTarget('')
        }}
        onOk={confirmUnlock}
        okText="解锁"
        cancelText="取消"
        confirmLoading={unlockLoading}
        destroyOnHidden
      >
        <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
          为避免误操作，请输入密码后继续。
        </div>
        <Input.Password
          value={unlockPassword}
          onChange={(e) => setUnlockPassword(e.target.value)}
          onPressEnter={confirmUnlock}
          placeholder="请输入密码"
          autoFocus
        />
      </Modal>

      <Modal
        open={showContributors}
        title="贡献者"
        onCancel={() => setShowContributors(false)}
        footer={null}
        width={760}
        destroyOnHidden
      >
        {contributors.length === 0 ? (
          <Empty description={contributorsLoading ? '正在读取贡献者信息...' : '暂无贡献者信息'} />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {contributors.map((item, index) => (
              <div key={`${item.className}-${item.name}-${index}`} style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, background: '#fff' }}>
                <div style={{ fontSize: 14, color: '#555', marginBottom: 4, fontWeight: 600 }}>{item.className}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{item.name}</div>
                <div style={{ fontSize: 13, color: '#444' }}>{item.info}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

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

          <div className="duration-sidebar">
            <div className="duration-sidebar-title">节目时长计算器</div>
            <div className="duration-sidebar-list">
              {STEPS.map((step, index) => (
                <div key={`duration-${step.key}`} className="duration-sidebar-item">
                  <div className="duration-sidebar-label">{index + 1}. {step.title}</div>
                  <div className="duration-sidebar-value">{formatProgramDuration(stepDurationMap[step.key] || 0)}</div>
                </div>
              ))}
            </div>
            <div className="duration-sidebar-footer">
              <span>总时长</span>
              <strong>{formatProgramDuration(totalProgramDuration)}</strong>
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
              previousBgmStepKey={PREV_BGM_STEP_MAP[currentKey] || ''}
              canInheritPreviousBgm={currentKey === 'transition' || currentKey === 'ending'}
              continuePlaybackEnabled={continuePlaybackEnabled}
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
              onSelectBgmFromLibrary={onSelectBgmFromLibrary}
              onRemoveBgm={onRemoveBgm}
              onUpdateBgmSegment={onUpdateBgmSegment}
              onUpdateBgmVolume={onUpdateBgmVolume}
              onUsePreviousBgmContinue={onUsePreviousBgmContinue}
              onUsePreviousBgmSameAudio={onUsePreviousBgmSameAudio}
              onToggleContinuePlayback={onToggleContinuePlayback}
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