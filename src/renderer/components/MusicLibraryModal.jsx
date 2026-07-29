import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Button, Input, Alert, Tag, Empty, message, Progress } from 'antd'

function LibraryAudioPreview({ filePath, title }) {
  const [url, setUrl] = useState('')
  const urlRef = useRef('')

  useEffect(() => {
    let disposed = false
    if (!filePath || !window.electronAPI) return
    window.electronAPI.readAudioBlob({ filePath })
      .then((result) => {
        if (disposed || !result?.success || !result?.dataBase64) return
        const bin = window.atob(result.dataBase64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const blob = new Blob([bytes], { type: result.mime || 'audio/mpeg' })
        const nextUrl = URL.createObjectURL(blob)
        urlRef.current = nextUrl
        setUrl(nextUrl)
      })
      .catch(() => {})
    return () => {
      disposed = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = ''
    }
  }, [filePath])

  if (!url) return <div style={{ color: '#999', fontSize: 12 }}>正在加载音频预览...</div>

  return (
    <audio
      aria-label={title}
      src={url}
      controls
      style={{ width: '100%', height: 34 }}
    />
  )
}

function LazyAudioPreview({ filePath, title }) {
  const hostRef = useRef(null)
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    const node = hostRef.current
    if (!node) return

    if (typeof window.IntersectionObserver !== 'function') {
      setActivated(true)
      return
    }

    let disposed = false
    const observer = new window.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!disposed) setActivated(true)
          observer.disconnect()
          break
        }
      }
    }, {
      root: null,
      rootMargin: '120px 0px',
      threshold: 0.01
    })

    observer.observe(node)

    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [filePath])

  return (
    <div ref={hostRef}>
      {activated
        ? <LibraryAudioPreview filePath={filePath} title={title} />
        : <div style={{ color: '#999', fontSize: 12, height: 34, display: 'flex', alignItems: 'center' }}>滚动到可见区域后加载预览</div>}
    </div>
  )
}

export default function MusicLibraryModal({ open, voiceFileReady, onCancel, onSelectTrack }) {
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [selecting, setSelecting] = useState(false)
  const [selectProgress, setSelectProgress] = useState(0)
  const [info, setInfo] = useState(null)
  const [tracks, setTracks] = useState([])
  const [keyword, setKeyword] = useState('')

  const loadLibrary = async () => {
    if (!window.electronAPI) return
    setLoading(true)
    setLoadProgress(10)
    try {
      const [infoRes, tracksRes] = await Promise.all([
        window.electronAPI.getMusicLibraryInfo(),
        window.electronAPI.listMusicLibraryTracks()
      ])
      setLoadProgress(70)
      if (!infoRes?.success) {
        throw new Error(infoRes?.message || '无法读取音乐库信息')
      }
      if (!tracksRes?.success) {
        throw new Error(tracksRes?.message || '无法读取音乐库曲目')
      }
      setInfo(infoRes.info)
      setTracks(tracksRes.tracks || [])
      setLoadProgress(100)
    } catch (err) {
      message.error(`音乐库加载失败：${err.message}`)
    } finally {
      setTimeout(() => setLoadProgress(0), 180)
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    loadLibrary()
  }, [open])

  const filteredTracks = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return tracks
    return tracks.filter((track) => {
      const haystack = [track.title, track.artist, ...(track.tags || [])].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [tracks, keyword])

  const handleSelectTrack = async (track) => {
    if (selecting) return
    setSelecting(true)
    setSelectProgress(15)
    try {
      const ok = await Promise.resolve(onSelectTrack ? onSelectTrack(track) : false)
      setSelectProgress(100)
      if (!ok) {
        setSelectProgress(0)
      }
    } finally {
      setTimeout(() => {
        setSelecting(false)
        setSelectProgress(0)
      }, 180)
    }
  }

  const handleSelectRandomTrack = async () => {
    if (loading || selecting) return
    const candidateTracks = filteredTracks.length > 0 ? filteredTracks : tracks
    if (!candidateTracks.length) {
      message.warning('音乐库暂无可用曲目，请先导入音乐库')
      return
    }
    const index = Math.floor(Math.random() * candidateTracks.length)
    const randomTrack = candidateTracks[index]
    await handleSelectTrack(randomTrack)
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={980}
      title="从自带音乐库中选择音乐"
      destroyOnHidden
    >
      {!voiceFileReady && (
        <Alert
          type="warning"
          showIcon
          message="请先准备口播音频，再从音乐库选择背景音乐。"
          style={{ marginBottom: 12 }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Input
          placeholder="按名称、作者、标签搜索音乐库"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          disabled={loading || selecting}
        />
        <Button onClick={handleSelectRandomTrack} disabled={!voiceFileReady || loading || selecting}>添加随机背景音乐</Button>
        <Button onClick={loadLibrary} loading={loading} disabled={selecting}>刷新</Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="如需更新音乐库，请前往 设置 > 存储 > 导入音乐库。"
      />

      {loading && (
        <div style={{ marginBottom: 12 }}>
          <Progress percent={loadProgress} status="active" size="small" />
        </div>
      )}

      {selecting && (
        <div style={{ marginBottom: 12 }}>
          <Progress percent={selectProgress} status="active" size="small" />
        </div>
      )}

      {info && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          background: '#fafafa',
          border: '1px solid #f0f0f0'
        }}>
          <div style={{ fontWeight: 600 }}>{info.libraryName}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            版本 {info.libraryVersion} · {info.trackCount} 首 · 最近更新 {info.updatedAt || '未知'}
          </div>
          {Array.isArray(info.contributors) && info.contributors.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {info.contributors.map((item, index) => (
                <Tag key={`${item.name}-${index}`}>{item.name}{item.role ? ` / ${item.role}` : ''}</Tag>
              ))}
            </div>
          )}
        </div>
      )}

      {filteredTracks.length === 0 ? (
        <Empty description={tracks.length === 0 ? '音乐库为空，请先到 设置 > 存储 导入音乐库。' : '没有匹配的音乐。'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
          {filteredTracks.map((track) => (
            <div key={track.id} style={{
              display: 'grid',
              gridTemplateColumns: '220px 1fr 80px',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              border: '1px solid #f0f0f0',
              borderRadius: 10,
              background: '#fff'
            }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{track.title}</div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {track.artist || '未署名'}
                  {track.duration ? ` · ${track.duration.toFixed(1)}秒` : ''}
                </div>
                {Array.isArray(track.tags) && track.tags.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {track.tags.slice(0, 4).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                  </div>
                )}
              </div>

              <LazyAudioPreview filePath={track.path} title={track.title} />

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="primary" onClick={() => handleSelectTrack(track)} disabled={!voiceFileReady || selecting} loading={selecting}>选择</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}