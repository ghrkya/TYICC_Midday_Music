import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Button, InputNumber, Alert } from 'antd'

function formatSec(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = r.toFixed(2).padStart(5, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function bytesFromBase64(base64) {
  const bin = window.atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function buildPeaks(channelData, buckets = 1800) {
  if (!channelData || channelData.length === 0) return []
  const step = Math.max(1, Math.floor(channelData.length / buckets))
  const peaks = []
  for (let i = 0; i < channelData.length; i += step) {
    let max = 0
    const end = Math.min(channelData.length, i + step)
    for (let j = i; j < end; j++) {
      const v = Math.abs(channelData[j])
      if (v > max) max = v
    }
    peaks.push(max)
  }
  return peaks
}

export default function BgmSegmentModal({
  open,
  bgm,
  voiceDuration,
  onCancel,
  onConfirm
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [duration, setDuration] = useState(0)
  const [startSec, setStartSec] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [peaks, setPeaks] = useState([])
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playheadSec, setPlayheadSec] = useState(0)
  const previewStartSecRef = useRef(0)
  const decodedBufferRef = useRef(null)
  const audioCtxRef = useRef(null)
  const sourceNodeRef = useRef(null)
  const playStartCtxTimeRef = useRef(0)
  const playStartOffsetRef = useRef(0)
  const playingRef = useRef(false)
  const playRafRef = useRef(0)

  const canvasRef = useRef(null)
  const scrollRef = useRef(null)
  const innerRef = useRef(null)

  const safeVoiceDuration = Math.max(0, Number(voiceDuration) || 0)
  const endSec = startSec + safeVoiceDuration
  const repeatCount = useMemo(() => {
    if (!duration || duration <= 0 || safeVoiceDuration <= 0) return 1
    return Math.max(1, Math.ceil((startSec + safeVoiceDuration) / duration))
  }, [duration, safeVoiceDuration, startSec])

  const contentWidth = useMemo(() => Math.max(800, Math.round(1200 * zoom)), [zoom])

  const leftPx = useMemo(() => {
    if (!duration || duration <= 0) return 0
    return (startSec / duration) * contentWidth
  }, [startSec, duration, contentWidth])

  const canUse = duration > 0 && safeVoiceDuration > 0
  const playheadPx = useMemo(() => {
    if (!duration || duration <= 0) return leftPx
    const sec = clamp(playheadSec, 0, duration)
    return (sec / duration) * contentWidth
  }, [duration, playheadSec, contentWidth, leftPx])

  const setPlayingSafe = (val) => {
    playingRef.current = val
    setPlaying(val)
  }

  const getCurrentPlayhead = () => {
    const ctx = audioCtxRef.current
    if (!ctx || !playingRef.current) {
      return clamp(playheadSec, startSec, endSec)
    }
    const elapsed = Math.max(0, ctx.currentTime - playStartCtxTimeRef.current)
    return clamp(playStartOffsetRef.current + elapsed, startSec, endSec)
  }

  const stopSourceNode = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.onended = null } catch {}
      try { sourceNodeRef.current.stop() } catch {}
      try { sourceNodeRef.current.disconnect() } catch {}
      sourceNodeRef.current = null
    }
  }

  const stopPreview = (resetToStart = false, stickToEnd = false) => {
    if (playRafRef.current) {
      cancelAnimationFrame(playRafRef.current)
      playRafRef.current = 0
    }
    const current = getCurrentPlayhead()
    stopSourceNode()
    setPlayingSafe(false)
    if (resetToStart) {
      setPlayheadSec(Number(previewStartSecRef.current || startSec || 0))
    } else if (stickToEnd) {
      setPlayheadSec(endSec)
    } else {
      setPlayheadSec(current)
    }
  }

  const syncPlayhead = () => {
    if (!playingRef.current) return
    const t = getCurrentPlayhead()
    setPlayheadSec(t)
    if (t < duration - 0.01) {
      playRafRef.current = requestAnimationFrame(syncPlayhead)
      return
    }
    stopPreview(true, false)
  }

  useEffect(() => {
    if (!open || !bgm || !bgm.path) return
    let disposed = false

    async function loadWave() {
      setLoading(true)
      setError('')
      try {
        const blobRes = await window.electronAPI.readAudioBlob({ filePath: bgm.path })
        if (!blobRes || !blobRes.success || !blobRes.dataBase64) {
          throw new Error(blobRes?.message || '读取音频失败')
        }
        const bytes = bytesFromBase64(blobRes.dataBase64)
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

        const ac = new (window.AudioContext || window.webkitAudioContext)()
        const decoded = await ac.decodeAudioData(buf)
        await ac.close()

        const d = decoded.duration || 0
        const src = decoded.numberOfChannels > 1
          ? decoded.getChannelData(0).map((v, i) => (v + decoded.getChannelData(1)[i]) / 2)
          : decoded.getChannelData(0)

        const p = buildPeaks(src, 1800)
        if (disposed) return

        const initStart = clamp(Number(bgm.startTime || 0), 0, Math.max(0, d))
        setDuration(d)
        setStartSec(initStart)
        setPlayheadSec(initStart)
        setPeaks(p)
        decodedBufferRef.current = decoded
      } catch (err) {
        if (!disposed) setError(err.message)
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    loadWave()
    return () => {
      disposed = true
      stopPreview(false)
      decodedBufferRef.current = null
    }
  }, [open, bgm, safeVoiceDuration])

  useEffect(() => {
    if (!open) return
    const onUp = () => setDragging(false)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [open])

  useEffect(() => {
    if (!open) return
    // 打开开始时间选择弹窗时，暂停页面里所有音频预览条，避免叠加播放。
    const audioEls = document.querySelectorAll('audio')
    audioEls.forEach((el) => {
      try { el.pause() } catch {}
    })
  }, [open])

  useEffect(() => {
    return () => {
      stopPreview(false)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
      audioCtxRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const h = 160
    canvas.width = contentWidth
    canvas.height = h

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#20232A'
    ctx.fillRect(0, 0, contentWidth, h)

    if (!peaks.length) return

    const mid = h / 2
    const barW = Math.max(1, contentWidth / peaks.length)

    // 全灰色波形
    ctx.strokeStyle = '#7f7f88'
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW
      const amp = Math.max(1, peaks[i] * (h * 0.42))
      ctx.beginPath()
      ctx.moveTo(x, mid - amp)
      ctx.lineTo(x, mid + amp)
      ctx.stroke()
    }
  }, [peaks, contentWidth])

  const updateStartByPx = (newLeftPx) => {
    if (!duration || duration <= 0) return
    const clamped = clamp(newLeftPx, 0, contentWidth)
    const sec = (clamped / contentWidth) * duration
    const nextStart = clamp(sec, 0, Math.max(0, duration))
    setStartSec(nextStart)
    if (!playing) setPlayheadSec(nextStart)
  }

  const onSelectionMouseDown = (e) => {
    if (!canUse) return
    setDragging(true)
    e.preventDefault()
  }

  const onInnerMouseDown = (e) => {
    if (!canUse) return
    const innerRect = innerRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current ? scrollRef.current.scrollLeft : 0
    const x = e.clientX - innerRect.left + scrollLeft
    updateStartByPx(x)
  }

  const onInnerMouseMove = (e) => {
    if (!dragging || !canUse) return
    const innerRect = innerRef.current.getBoundingClientRect()
    const scrollLeft = scrollRef.current ? scrollRef.current.scrollLeft : 0
    const x = e.clientX - innerRect.left + scrollLeft
    updateStartByPx(x)
  }

  const onChangeStart = (val) => {
    const v = Number(val)
    if (Number.isNaN(v)) return
    if (v < 0 || v + safeVoiceDuration > duration) {
      Modal.warning({ title: '选段超出范围', content: '开始时间超出音频范围，请重新输入。' })
      return
    }
    setStartSec(v)
    if (!playing) setPlayheadSec(v)
  }

  const onTogglePlay = async () => {
    if (!canUse || !decodedBufferRef.current) return
    if (playingRef.current) {
      stopPreview(false)
      return
    }
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume()
      }

      const source = audioCtxRef.current.createBufferSource()
      source.buffer = decodedBufferRef.current
      source.connect(audioCtxRef.current.destination)

      const resumeAt = Number(startSec || 0)
      const playDur = Math.max(0.01, duration - resumeAt)

      playStartCtxTimeRef.current = audioCtxRef.current.currentTime
      playStartOffsetRef.current = resumeAt
      previewStartSecRef.current = resumeAt
      sourceNodeRef.current = source

      source.onended = () => {
        if (!playingRef.current) return
        stopPreview(true, false)
      }

      setPlayheadSec(resumeAt)
      source.start(0, resumeAt, playDur)
      setPlayingSafe(true)
      if (playRafRef.current) cancelAnimationFrame(playRafRef.current)
      playRafRef.current = requestAnimationFrame(syncPlayhead)
    } catch (err) {
      Modal.warning({ title: '播放失败', content: err?.message || '无法播放该音频片段。' })
    }
  }

  const onStopPlay = () => {
    stopPreview(true)
  }

  return (
    <Modal
      width={980}
      open={open}
      onCancel={onCancel}
      title="选择背景音乐开始时间"
      onOk={() => onConfirm({ startTime: startSec, endTime: endSec, duration })}
      okButtonProps={{ disabled: !canUse || !!error || loading }}
      okText="确认开始时间"
      cancelText="取消"
      destroyOnHidden
    >
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
      {!error && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <div>开始时间</div>
            <InputNumber min={0} step={0.1} value={Number(startSec.toFixed(2))} onChange={onChangeStart} />
            <div style={{ marginLeft: 'auto', color: '#888' }}>
              口播时长: {safeVoiceDuration.toFixed(2)}s / 背景音乐: {duration.toFixed(2)}s
            </div>
          </div>

          {repeatCount > 1 && (
            <Alert
              type="info"
              message={`背景音乐较短，将自动重复播放 ${repeatCount} 次以补足口播时长。`}
              style={{ marginBottom: 10 }}
            />
          )}

          <div
            ref={scrollRef}
            style={{ width: '100%', overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8, background: '#20232A' }}
          >
            <div
              ref={innerRef}
              style={{ width: contentWidth, height: 180, position: 'relative', cursor: dragging ? 'grabbing' : 'default' }}
              onMouseDown={onInnerMouseDown}
              onMouseMove={onInnerMouseMove}
            >
              <canvas ref={canvasRef} style={{ width: contentWidth, height: 160, display: 'block' }} />
              {canUse && (
                <div
                  onMouseDown={onSelectionMouseDown}
                  style={{
                    position: 'absolute',
                    left: leftPx,
                    top: 0,
                    width: 2,
                    height: 160,
                    background: 'rgba(255, 102, 102, 0.45)',
                    boxSizing: 'border-box',
                    cursor: 'grab',
                    zIndex: 3
                  }}
                />
              )}
              {canUse && playing && (
                <div
                  style={{
                    position: 'absolute',
                    left: playheadPx,
                    top: 0,
                    width: 2,
                    height: 160,
                    background: '#FF4D4F',
                    pointerEvents: 'none',
                    boxShadow: '0 0 6px rgba(255, 77, 79, 0.55)',
                    zIndex: 4
                  }}
                />
              )}
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
            <Button size="small" type="primary" onClick={onTogglePlay} disabled={!canUse || !decodedBufferRef.current}>
              {playing ? '暂停播放' : '开始播放'}
            </Button>
            <Button size="small" onClick={onStopPlay} disabled={!decodedBufferRef.current}>
              结束播放
            </Button>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>时间轴缩放</span>
            <Button size="small" onClick={() => setZoom(z => Math.max(1, Number((z - 0.5).toFixed(2))))}>-</Button>
            <span>x{zoom.toFixed(1)}</span>
            <Button size="small" onClick={() => setZoom(z => Math.min(8, Number((z + 0.5).toFixed(2))))}>+</Button>
            <span style={{ marginLeft: 'auto', color: '#999' }}>
              当前开始时间: {formatSec(startSec)}（第一遍从此处开始，后续循环从头开始）
            </span>
          </div>
        </>
      )}
      {loading && <div style={{ marginTop: 12, color: '#888' }}>正在加载波形...</div>}
    </Modal>
  )
}
