/**
 * TYICC午间悦听 - 工作流主组件
 * 
 * 五步工作流：
 * 1. 开头（开场白）
 * 2. 演讲（TED演讲）
 * 3. 转场（转场语）
 * 4. 每日歌曲
 * 5. 结语
 */

import React, { useState, useCallback } from 'react'
import { Steps, Button, message } from 'antd'
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
    title: '开场',
    description: '统一录制的开场白',
    key: 'opening',
    icon: <PlayCircleOutlined />,
    defaultPreset: true // 可使用预设开场
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
  opening: null,    // 暂无预设开场文件
  ending: null      // 暂无预设结语文件
}

export default function Workflow({ networkOk, ffmpegOk }) {
  // 当前步骤索引 (0-4)
  const [currentStep, setCurrentStep] = useState(0)

  // 每个步骤的音频文件信息
  const [stepFiles, setStepFiles] = useState({
    opening: null,
    speech: null,
    transition: null,
    music: null,      // 每日歌曲支持多个文件
    ending: null
  })

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

  /**
   * 使用预设音频
   */
  const handleUsePreset = useCallback((stepKey) => {
    const preset = PRESET_FILES[stepKey]
    if (preset) {
      message.success('已使用预设音频')
    } else {
      message.info('暂无可用的预设音频，请选择本地文件或从B站下载')
    }
  }, [])

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
        setStepFile(stepKey, {
          name: result.fileName,
          path: result.filePath,
          source: 'bilibili',
          bvId: bvId
        })
        message.success(`下载成功：${result.fileName}`)

        // 如果开启了响度平衡，自动处理
        if (loudnessEnabled && ffmpegOk) {
          message.info('正在对下载的音频进行响度平衡...')
        }
      } else {
        message.error(result.message || '下载失败')
      }
    } catch (err) {
      message.error('下载出错：' + err.message)
    }
  }, [networkOk, loudnessEnabled, ffmpegOk, setStepFile])

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

        setStepFile(stepKey, {
          name: fileName,
          path: filePath,
          source: 'local',
          size: fileInfo.size
        })
        message.success(`已选择：${fileName}`)
      }
    } catch (err) {
      message.error('选择文件出错：' + err.message)
    }
  }, [setStepFile])

  /**
   * 检查是否可以进入下一步
   */
  const canGoNext = () => {
    const file = stepFiles[currentKey]
    return file !== null && file !== undefined
  }

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
            src="../static/国际课程中心logo2.png"
            alt="Logo"
            onError={(e) => { e.target.src = '/static/国际课程中心logo2.png' }}
          />
          <span className="app-header-title">TYICC 午间悦听</span>
        </div>
        <div className="app-header-right">
          {/* 可在此添加设置按钮等 */}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="app-content">
        <div className="workflow-container">
          {/* 步骤导航条 */}
          <div className="workflow-steps-bar">
            <Steps
              current={currentStep}
              onChange={setCurrentStep}
              size="small"
            >
              {STEPS.map((step, index) => (
                <Steps.Step
                  key={step.key}
                  title={step.title}
                  description={step.description}
                  icon={step.icon}
                  status={
                    stepFiles[step.key]
                      ? 'finish'
                      : index < currentStep
                        ? 'finish'
                        : index === currentStep
                          ? 'process'
                          : 'wait'
                  }
                />
              ))}
            </Steps>
          </div>

          {/* 当前步骤面板 */}
          <div className="workflow-content">
            <StepPanel
              step={STEPS[currentStep]}
              stepIndex={currentStep}
              file={stepFiles[currentKey]}
              loudnessEnabled={loudnessEnabled}
              ffmpegOk={ffmpegOk}
              networkOk={networkOk}
              onSetFile={setStepFile}
              onRemoveFile={removeStepFile}
              onLocalFile={handleLocalFile}
              onBilibiliDownload={handleBilibiliDownload}
              onUsePreset={handleUsePreset}
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
                    loudnessEnabled={loudnessEnabled}
                    ffmpegOk={ffmpegOk}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}