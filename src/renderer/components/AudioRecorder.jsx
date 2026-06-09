/**
 * TYICC午间悦听 - 录音组件
 * 
 * 使用浏览器MediaRecorder API录制音频
 * 用于录制演讲、转场语、结语等
 */

import React, { useState, useRef, useEffect } from 'react'
import { Button, Space, message } from 'antd'
import { AudioOutlined, StopOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons'

export default function AudioRecorder({ onComplete, onCancel }) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedTime, setRecordedTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  // 清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  /**
   * 开始录音
   */
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      })
      
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType })
        const url = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioUrl(url)

        // 停止所有轨道
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start(100) // 每100ms收集一次数据
      setIsRecording(true)

      // 计时器
      setRecordedTime(0)
      timerRef.current = setInterval(() => {
        setRecordedTime(prev => prev + 1)
      }, 1000)

      message.info('开始录音...')
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message.error('麦克风权限被拒绝，请在系统设置中允许麦克风访问')
      } else {
        message.error('无法启动录音：' + err.message)
      }
    }
  }

  /**
   * 停止录音
   */
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      message.success('录音完成')
    }
  }

  /**
   * 确认使用录音
   */
  const confirmRecording = () => {
    if (audioBlob && audioUrl) {
      onComplete(audioBlob, audioUrl, recordedTime)
    }
  }

  /**
   * 重新录制
   */
  const resetRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setAudioUrl(null)
    setAudioBlob(null)
    setRecordedTime(0)
  }

  // 格式化时间
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
    <div>
      <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 14 }}>
        <AudioOutlined style={{ marginRight: 8 }} />
        录音
      </div>

      {/* 录音状态显示 */}
      <div style={{
        textAlign: 'center',
        padding: 16,
        background: isRecording ? '#FFF3E0' : '#FAFAFE',
        borderRadius: 8,
        marginBottom: 12,
        transition: 'background 0.3s'
      }}>
        {isRecording ? (
          <div>
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#FF4D4F',
              display: 'inline-block',
              marginRight: 8,
              animation: 'pulse 1s infinite'
            }} />
            <span style={{ fontWeight: 600, color: '#FF4D4F' }}>
              录音中... {formatTime(recordedTime)}
            </span>
          </div>
        ) : audioUrl ? (
          <div>
            <span style={{ color: '#52C41A' }}>
              ✅ 录音完成（{formatTime(recordedTime)}）
            </span>
          </div>
        ) : (
          <div>
            <span style={{ color: '#8888AA' }}>
              点击"开始录音"按钮，使用麦克风录制音频
            </span>
          </div>
        )}
      </div>

      {/* 音频预览 */}
      {audioUrl && (
        <div style={{ marginBottom: 12 }}>
          <audio
            src={audioUrl}
            controls
            style={{ width: '100%', borderRadius: 8 }}
          />
        </div>
      )}

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {!isRecording && !audioUrl && (
          <>
            <Button
              type="primary"
              icon={<AudioOutlined />}
              onClick={startRecording}
            >
              开始录音
            </Button>
            <Button
              icon={<CloseOutlined />}
              onClick={onCancel}
            >
              取消
            </Button>
          </>
        )}

        {isRecording && (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={stopRecording}
          >
            停止录音
          </Button>
        )}

        {audioUrl && !isRecording && (
          <>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={confirmRecording}
            >
              使用此录音
            </Button>
            <Button
              onClick={resetRecording}
            >
              重新录制
            </Button>
            <Button
              icon={<CloseOutlined />}
              onClick={onCancel}
            >
              取消
            </Button>
          </>
        )}
      </div>
    </div>
  )
}