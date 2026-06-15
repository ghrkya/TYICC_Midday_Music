/**
 * TYICC午间悦听 - 录音组件（Web Audio API + AudioWorklet）
 * 
 * 使用 AudioWorklet 捕获原始 PCM 数据并手动编码为 WAV 文件。
 * 相比 ScriptProcessorNode，AudioWorklet 在现代浏览器/Electron 中更稳定。
 */

import React, { useState, useRef, useEffect } from 'react'
import { Button, Select, message } from 'antd'
import { AudioOutlined, StopOutlined, CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons'
import pcmRecorderWorkletSource from './pcm-recorder.worklet.js?raw'

const WORKLET_BLOB_TYPE = 'application/javascript'

export default function AudioRecorder({ onComplete, onCancel }) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedTime, setRecordedTime] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [recordingFilePath, setRecordingFilePath] = useState(null)
  const [audioFileSize, setAudioFileSize] = useState(0)
  const [micDevices, setMicDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')

  const audioCtxRef = useRef(null)
  const sourceRef = useRef(null)
  const workletNodeRef = useRef(null)
  const monitorGainRef = useRef(null)
  const streamRef = useRef(null)
  const samplesRef = useRef([])
  const sampleRateRef = useRef(48000)
  const timerRef = useRef(null)
  const workletUrlRef = useRef(null)

  useEffect(() => {
    loadMicDevices()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl)
      if (workletUrlRef.current) {
        URL.revokeObjectURL(workletUrlRef.current)
        workletUrlRef.current = null
      }
      stopRecordingInternal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMicDevices = async () => {
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      testStream.getTracks().forEach(t => t.stop())
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter(d => d.kind === 'audioinput')
      setMicDevices(audioInputs)
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }
    } catch (err) {
      console.warn('无法枚举麦克风设备:', err.message)
    }
  }

  const stopRecordingInternal = () => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (monitorGainRef.current) {
      monitorGainRef.current.disconnect()
      monitorGainRef.current = null
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  const base64ToUint8Array = (base64) => {
    const binary = window.atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  // ====== WAV 编码器 ======
  function encodeWav(samples, sampleRate) {
    const numChannels = 1
    const bitsPerSample = 16
    const byteRate = sampleRate * numChannels * bitsPerSample / 8
    const blockAlign = numChannels * bitsPerSample / 8
    const dataLength = samples.length * bitsPerSample / 8
    const buffer = new ArrayBuffer(44 + dataLength)
    const view = new DataView(buffer)

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + dataLength, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitsPerSample, true)
    writeString(36, 'data')
    view.setUint32(40, dataLength, true)

    // float32 [-1,1] → int16
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }

    return new Uint8Array(buffer)
  }

  const startRecording = async () => {
    try {
      const constraints = {
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const audioCtx = new AudioContext({ latencyHint: 'interactive' })
      audioCtxRef.current = audioCtx
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      sampleRateRef.current = audioCtx.sampleRate

      // Blob URL 方式加载 worklet：Electron 打包后 file:// 协议无法可靠解析 ?url 的相对路径，
      // 而 blob: 协议在所有平台（含 macOS）均受 AudioWorklet.addModule 支持。
      if (!workletUrlRef.current) {
        const workletBlob = new Blob([pcmRecorderWorkletSource], { type: WORKLET_BLOB_TYPE })
        workletUrlRef.current = URL.createObjectURL(workletBlob)
      }
      console.log('[AudioRecorder] worklet blob URL:', workletUrlRef.current)
      await audioCtx.audioWorklet.addModule(workletUrlRef.current)

      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source

      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-recorder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit'
      })
      workletNodeRef.current = workletNode
      samplesRef.current = []

      workletNode.port.onmessage = (event) => {
        const data = event.data
        if (!data || data.type !== 'chunk' || !data.buffer) return
        const chunk = new Float32Array(data.buffer)
        if (chunk.length > 0) {
          samplesRef.current.push(chunk)
        }
      }

      source.connect(workletNode)
      const monitorGain = audioCtx.createGain()
      monitorGain.gain.value = 0
      monitorGainRef.current = monitorGain
      workletNode.connect(monitorGain)
      monitorGain.connect(audioCtx.destination)

      setIsRecording(true)
      setRecordedTime(0)
      timerRef.current = setInterval(() => {
        setRecordedTime(prev => prev + 1)
      }, 1000)

      message.info('开始录音...')
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message.error('麦克风权限被拒绝，请在系统设置中允许麦克风访问')
      } else if (err.name === 'NotFoundError') {
        message.error('未找到选中的麦克风设备，请检查连接')
      } else {
        message.error('无法启动录音：' + err.message)
      }
    }
  }

  const stopRecording = async () => {
    if (!audioCtxRef.current) return

    const collectedSamples = samplesRef.current
    const sampleRate = sampleRateRef.current || 48000

    stopRecordingInternal()
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // 合并所有 Float32Array 片段
    let totalLen = 0
    for (const s of collectedSamples) totalLen += s.length
    const allSamples = new Float32Array(totalLen)
    let offset = 0
    for (const s of collectedSamples) {
      allSamples.set(s, offset)
      offset += s.length
    }

    if (allSamples.length < 100) {
      message.warning('录音时间过短，请重试')
      return
    }

    // 编码为 WAV
    const wavData = encodeWav(allSamples, sampleRate)

    // 通过 IPC 保存
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.saveRecordingFile({
          buffer: wavData.buffer,
          ext: 'wav'
        })
        if (result.success) {
          setRecordingFilePath(result.filePath)
          setAudioFileSize(result.size || wavData.length)

          const blobResult = await window.electronAPI.readAudioBlob({ filePath: result.filePath })
          if (blobResult.success && blobResult.dataBase64) {
            const bytes = base64ToUint8Array(blobResult.dataBase64)
            if (bytes.length > 0) {
              const blob = new Blob([bytes], { type: blobResult.mime || 'audio/wav' })
              setAudioUrl(URL.createObjectURL(blob))
            } else {
              const blob = new Blob([wavData], { type: 'audio/wav' })
              setAudioUrl(URL.createObjectURL(blob))
            }
          } else {
            // 回退：直接用 Blob URL
            const blob = new Blob([wavData], { type: 'audio/wav' })
            setAudioUrl(URL.createObjectURL(blob))
          }
          message.success(`录音完成: ${result.fileName}`)
        }
      } catch (err) {
        console.warn('保存录音失败:', err)
        const blob = new Blob([wavData], { type: 'audio/wav' })
        setAudioUrl(URL.createObjectURL(blob))
      }
    } else {
      const blob = new Blob([wavData], { type: 'audio/wav' })
      setAudioUrl(URL.createObjectURL(blob))
    }
  }

  const confirmRecording = () => {
    if (audioUrl && recordingFilePath) {
      onComplete(null, recordingFilePath, recordedTime)
    } else if (audioUrl) {
      // fallback: 没有保存到文件时传 blob
      onComplete(null, null, recordedTime)
    }
  }

  const resetRecording = () => {
    if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setRecordingFilePath(null)
    setAudioFileSize(0)
    setRecordedTime(0)
  }

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

      {!isRecording && !audioUrl && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#8888AA', marginBottom: 6 }}>选择麦克风：</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select
              style={{ flex: 1 }}
              value={selectedDeviceId}
              onChange={setSelectedDeviceId}
              options={micDevices.map(d => ({
                value: d.deviceId,
                label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}...`
              }))}
              placeholder="选择麦克风"
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={loadMicDevices} title="刷新设备列表" />
          </div>
        </div>
      )}

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
              width: 12, height: 12, borderRadius: '50%', background: '#FF4D4F',
              display: 'inline-block', marginRight: 8, animation: 'pulse 1s infinite'
            }} />
            <span style={{ fontWeight: 600, color: '#FF4D4F' }}>
              录音中... {formatTime(recordedTime)}
            </span>
          </div>
        ) : audioUrl ? (
          <div>
            <span style={{ color: '#52C41A' }}>
              ✅ 录音完成（{formatTime(recordedTime)}，{(audioFileSize / 1024).toFixed(0)}KB）
            </span>
          </div>
        ) : (
          <div><span style={{ color: '#8888AA' }}>选择麦克风后点击"开始录音"</span></div>
        )}
      </div>

      {audioUrl && (
        <div style={{ marginBottom: 12 }}>
          <audio key={audioUrl} src={audioUrl} controls style={{ width: '100%', borderRadius: 8 }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {!isRecording && !audioUrl && (
          <>
            <Button type="primary" icon={<AudioOutlined />} onClick={startRecording} disabled={!selectedDeviceId}>
              开始录音
            </Button>
            <Button icon={<CloseOutlined />} onClick={onCancel}>取消</Button>
          </>
        )}
        {isRecording && (
          <Button danger icon={<StopOutlined />} onClick={stopRecording}>
            停止录音
          </Button>
        )}
        {audioUrl && !isRecording && (
          <>
            <Button type="primary" icon={<CheckOutlined />} onClick={confirmRecording}>
              使用此录音
            </Button>
            <Button onClick={resetRecording}>重新录制</Button>
            <Button icon={<CloseOutlined />} onClick={onCancel}>取消</Button>
          </>
        )}
      </div>
    </div>
  )
}