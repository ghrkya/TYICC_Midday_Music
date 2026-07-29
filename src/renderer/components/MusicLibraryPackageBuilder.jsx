import React, { useEffect, useMemo, useState } from 'react'
import { Button, Input, message, Empty, Tag, Alert, Modal } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
  InfoCircleOutlined
} from '@ant-design/icons'

const { TextArea } = Input

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

function todayStamp() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${y}${m}${d}-${hh}${mm}`
}

function createContributor() {
  return { name: '', role: '' }
}

export default function MusicLibraryPackageBuilder({ open, onClose }) {
  const [loading, setLoading] = useState(false)
  const [packageType] = useState('full')
  const [libraryId, setLibraryId] = useState('tyicc-bgm-library')
  const [libraryName, setLibraryName] = useState('TYICC 午间悦听背景音乐库')
  const [libraryVersion, setLibraryVersion] = useState('')
  const [minAppVersion, setMinAppVersion] = useState('3.0.0')
  const [packageId, setPackageId] = useState('')
  const [libraryDescription, setLibraryDescription] = useState('')
  const [description, setDescription] = useState('')
  const [contributors, setContributors] = useState([createContributor()])
  const [tracks, setTracks] = useState([])
  const [showPackageInfoAdvanced, setShowPackageInfoAdvanced] = useState(false)
  const [expandedTrackKeys, setExpandedTrackKeys] = useState({})
  const [bulkTagInput, setBulkTagInput] = useState('')

  useEffect(() => {
    if (!open || !window.electronAPI) return
    let disposed = false
    window.electronAPI.getMusicLibraryInfo()
      .then((res) => {
        if (disposed || !res?.success || !res.info) return
        const info = res.info
        setLibraryId(info.libraryId || 'tyicc-bgm-library')
        setLibraryName(info.libraryName || 'TYICC 午间悦听背景音乐库')
        setLibraryDescription(info.description || '')
      })
      .catch(() => {})
    return () => { disposed = true }
  }, [open])

  useEffect(() => {
    if (!open) return
    const stamp = todayStamp()
    if (!libraryVersion) setLibraryVersion(stamp.replace('-', '.'))
    setPackageId((prev) => prev || `library-full-${stamp}`)
  }, [open])

  const contributorCount = useMemo(
    () => contributors.filter((item) => String(item.name || '').trim()).length,
    [contributors]
  )

  if (!open) return null

  const toggleTrackDetail = (trackKey) => {
    setExpandedTrackKeys((prev) => ({
      ...prev,
      [trackKey]: !prev[trackKey]
    }))
  }

  const applyBulkTag = () => {
    const tag = String(bulkTagInput || '').trim()
    if (!tag) {
      message.warning('请先输入要批量添加的标签')
      return
    }
    if (!tracks.length) {
      message.warning('请先添加至少一首曲目')
      return
    }

    setTracks((prev) => prev.map((track) => {
      const currentTags = String(track.tags || '').split(/[，,]/).map((item) => item.trim()).filter(Boolean)
      if (currentTags.includes(tag)) return track
      return { ...track, tags: [...currentTags, tag].join(', ') }
    }))
    message.success(`已为全部曲目添加标签：${tag}`)
  }

  const addContributor = () => setContributors((prev) => [...prev, createContributor()])
  const updateContributor = (index, key, value) => {
    setContributors((prev) => prev.map((item, idx) => idx === index ? { ...item, [key]: value } : item))
  }
  const removeContributor = (index) => setContributors((prev) => prev.filter((_, idx) => idx !== index))

  const pickAudioFiles = async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.openFileDialog({
      title: '选择要打包进音乐库的音频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'aif', 'aiff'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths?.length) return

    const nextTracks = await Promise.all(result.filePaths.map(async (filePath, idx) => {
      const fileName = String(filePath).split(/[\\/]/).pop()
      const stem = fileName.replace(/\.[^.]+$/, '')
      const infoRes = await window.electronAPI.getFileInfo({ filePath }).catch(() => null)
      const durationRes = await window.electronAPI.getAudioDuration({ filePath }).catch(() => null)
      const sortOrder = (tracks.length + idx + 1) * 10
      return {
        uiKey: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        filePath,
        fileName,
        id: slugify(stem),
        title: stem,
        artist: '',
        description: '',
        tags: '',
        sortOrder,
        size: Number(infoRes?.size || 0),
        duration: Number(durationRes?.duration || 0)
      }
    }))

    setTracks((prev) => [...prev, ...nextTracks])
  }

  const updateTrack = (index, key, value) => {
    setTracks((prev) => prev.map((item, idx) => idx === index ? { ...item, [key]: value } : item))
  }
  const removeTrack = (index) => setTracks((prev) => prev.filter((_, idx) => idx !== index))

  const buildSpec = () => {
    const cleanPackageId = String(packageId || '').trim()
    const cleanLibraryVersion = String(libraryVersion || '').trim()
    const cleanLibraryId = String(libraryId || '').trim()
    const cleanLibraryName = String(libraryName || '').trim()

    if (!cleanPackageId) throw new Error('请填写包 ID')
    if (!cleanLibraryVersion) throw new Error('请填写库版本号')
    if (!cleanLibraryId) throw new Error('请填写库 ID')
    if (!cleanLibraryName) throw new Error('请填写库名称')
    const normalizedTracks = tracks.map((track, index) => ({
      filePath: track.filePath,
      id: slugify(track.id || track.title || track.fileName || `track_${index + 1}`),
      title: String(track.title || '').trim() || track.fileName,
      artist: String(track.artist || '').trim(),
      description: String(track.description || '').trim(),
      tags: String(track.tags || '').trim(),
      sortOrder: Number(track.sortOrder || (index + 1) * 10)
    }))

    const contributorList = contributors
      .map((item) => ({ name: String(item.name || '').trim(), role: String(item.role || '').trim() }))
      .filter((item) => item.name)

    return {
      packageType,
      packageId: cleanPackageId,
      libraryId: cleanLibraryId,
      libraryName: cleanLibraryName,
      libraryVersion: cleanLibraryVersion,
      baseLibraryVersion: null,
      minAppVersion: String(minAppVersion || '').trim(),
      libraryDescription: String(libraryDescription || '').trim(),
      description: String(description || '').trim(),
      contributors: contributorList,
      tracks: normalizedTracks,
      removeTrackIds: []
    }
  }

  const handleGenerate = async () => {
    try {
      if (!window.electronAPI) return
      const spec = buildSpec()
      const saveResult = await window.electronAPI.openSaveDialog({
        defaultName: `${spec.packageId}.zip`,
        filters: [{ name: 'ZIP 包', extensions: ['zip'] }]
      })
      if (saveResult.canceled || !saveResult.filePath) return

      const confirmed = await new Promise((resolve) => {
        Modal.confirm({
          title: '即将开始导出',
          content: '为最大限度节约电脑资源，导出过程中软件可能被提示为无响应，请耐心等待。',
          okText: '开始导出',
          cancelText: '取消',
          centered: true,
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      })
      if (!confirmed) return

      setLoading(true)
      const result = await window.electronAPI.createMusicLibraryPackage({
        ...spec,
        outputPath: saveResult.filePath
      })
      if (!result?.success) {
        throw new Error(result?.message || '生成失败')
      }
      message.success(`音乐库文件已生成：${result.fileName}`)
      window.electronAPI.openFileLocation({ filePath: result.outputPath }).catch(() => {})
    } catch (err) {
      message.error(`生成音乐库文件失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="package-builder-overlay">
      <div className="package-builder-topbar">
        <div className="package-builder-title-group">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onClose}>返回</Button>
          <div>
            <div className="package-builder-title">音乐库管理</div>
            <div className="package-builder-subtitle">整理音乐库并生成发布文件</div>
          </div>
        </div>
      </div>

      <div className="package-builder-shell">
        <div className="package-builder-summary">
          <Tag color="blue">音乐库</Tag>
          <Tag>{tracks.length} 首待打包</Tag>
          <Tag>{contributorCount} 位贡献者</Tag>
        </div>

        <div className="package-builder-grid">
          <section className="package-builder-card">
            <div className="package-builder-card-header">
              <h3>库基础信息</h3>
              <Button size="small" icon={<InfoCircleOutlined />} onClick={() => setShowPackageInfoAdvanced((v) => !v)}>
                {showPackageInfoAdvanced ? '简洁模式' : '详细模式'}
              </Button>
            </div>

            <div className="package-builder-form-grid">
              <label>
                <span>库文件模式</span>
                <Input value="标准模式" disabled />
              </label>
              <label>
                <span>库名称</span>
                <Input value={libraryName} onChange={(e) => setLibraryName(e.target.value)} />
              </label>
            </div>

            {showPackageInfoAdvanced && (
              <div className="package-builder-form-grid" style={{ marginTop: 12 }}>
                <label>
                  <span>库文件 ID</span>
                  <Input value={packageId} onChange={(e) => setPackageId(e.target.value)} />
                </label>
                <label>
                  <span>库版本号</span>
                  <Input value={libraryVersion} onChange={(e) => setLibraryVersion(e.target.value)} placeholder="例如 2026.08.01" />
                </label>
                <label>
                  <span>库 ID</span>
                  <Input value={libraryId} onChange={(e) => setLibraryId(e.target.value)} />
                </label>
                <label>
                  <span>最低应用版本</span>
                  <Input value={minAppVersion} onChange={(e) => setMinAppVersion(e.target.value)} placeholder="例如 3.0.0" />
                </label>
              </div>
            )}

            <label className="package-builder-block-field">
              <span>库描述</span>
              <TextArea value={libraryDescription} onChange={(e) => setLibraryDescription(e.target.value)} rows={3} />
            </label>
            <label className="package-builder-block-field">
              <span>发布说明</span>
              <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="说明本次音乐库包含了哪些音乐与更新" />
            </label>

            <Alert
              type="info"
              showIcon
              message="库描述与发布说明"
              description="库描述用于长期介绍音乐库；发布说明用于说明本次发布内容。"
              style={{ marginTop: 10 }}
            />
          </section>

          <section className="package-builder-card">
            <div className="package-builder-card-header">
              <h3>贡献者</h3>
              <Button size="small" icon={<PlusOutlined />} onClick={addContributor}>添加</Button>
            </div>
            <div className="package-builder-stack">
              {contributors.map((item, index) => (
                <div key={`contributor-${index}`} className="package-builder-inline-row">
                  <Input value={item.name} onChange={(e) => updateContributor(index, 'name', e.target.value)} placeholder="姓名" />
                  <Input value={item.role} onChange={(e) => updateContributor(index, 'role', e.target.value)} placeholder="角色，如 维护/整理" />
                  <Button size="small" icon={<DeleteOutlined />} onClick={() => removeContributor(index)} />
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="package-builder-card">
          <div className="package-builder-card-header">
            <h3>新增 / 更新曲目</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Input
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
                placeholder="输入统一标签"
                style={{ width: 160 }}
              />
              <Button onClick={applyBulkTag}>一键添加标签</Button>
              <Button icon={<FolderOpenOutlined />} onClick={pickAudioFiles}>选择音频文件</Button>
            </div>
          </div>
          {tracks.length === 0 ? (
            <Empty description="尚未加入任何曲目" />
          ) : (
            <div className="package-builder-track-list">
              {tracks.map((track, index) => {
                const trackKey = track.uiKey || `${track.filePath}-${index}`
                const expanded = !!expandedTrackKeys[trackKey]
                return (
                  <div key={trackKey} className="package-builder-track-card">
                    <div className="package-builder-track-top">
                      <div>
                        <div className="package-builder-track-name">{track.title || track.fileName}</div>
                        <div className="package-builder-track-meta">
                          {track.artist ? `作者：${track.artist}` : '作者：未填写'}
                          {track.tags ? ` · 标签：${track.tags}` : ' · 标签：无'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button size="small" onClick={() => toggleTrackDetail(trackKey)}>
                          {expanded ? '收起详情' : '详细信息'}
                        </Button>
                        <Button size="small" icon={<DeleteOutlined />} onClick={() => removeTrack(index)}>移除</Button>
                      </div>
                    </div>

                    {expanded && (
                      <>
                        <div className="package-builder-form-grid">
                          <label>
                            <span>曲目 ID</span>
                            <Input value={track.id} onChange={(e) => updateTrack(index, 'id', e.target.value)} />
                          </label>
                          <label>
                            <span>标题（默认取文件名去后缀）</span>
                            <Input value={track.title} onChange={(e) => updateTrack(index, 'title', e.target.value)} />
                          </label>
                          <label>
                            <span>作者</span>
                            <Input value={track.artist} onChange={(e) => updateTrack(index, 'artist', e.target.value)} />
                          </label>
                          <label>
                            <span>排序值</span>
                            <Input value={String(track.sortOrder)} onChange={(e) => updateTrack(index, 'sortOrder', e.target.value)} />
                          </label>
                        </div>
                        <label className="package-builder-block-field">
                          <span>标签（用逗号分隔）</span>
                          <Input value={track.tags} onChange={(e) => updateTrack(index, 'tags', e.target.value)} placeholder="如 开场, 轻快" />
                        </label>
                        <label className="package-builder-block-field">
                          <span>描述</span>
                          <TextArea value={track.description} onChange={(e) => updateTrack(index, 'description', e.target.value)} rows={2} />
                        </label>
                        <div className="package-builder-track-meta">
                          文件：{track.fileName} · {track.duration ? `${track.duration.toFixed(1)} 秒` : '时长未知'}
                          {track.size ? ` · ${(track.size / 1024 / 1024).toFixed(2)} MB` : ''}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <div className="package-builder-footer">
          <Button icon={<SaveOutlined />} type="primary" size="large" loading={loading} onClick={handleGenerate}>
            选择导出位置并生成库文件
          </Button>
        </div>
      </div>
    </div>
  )
}
