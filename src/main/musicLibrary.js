const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.aif', '.aiff'])

function safeReadJson(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallbackValue
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function slugifyTrackId(input) {
  return String(input || 'track')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || `track_${Date.now()}`
}

function normalizeContributors(contributors) {
  if (!Array.isArray(contributors)) return []
  const seen = new Set()
  const out = []
  for (const item of contributors) {
    const name = String(item?.name || '').trim()
    if (!name) continue
    const role = String(item?.role || '').trim()
    const key = `${name}::${role}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, role })
  }
  return out
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((item) => String(item || '').trim()).filter(Boolean)
  }
  if (typeof tags === 'string') {
    return tags.split(/[，,]/).map((item) => String(item || '').trim()).filter(Boolean)
  }
  return []
}

function createDefaultManifest() {
  return {
    schemaVersion: 1,
    libraryId: 'tyicc-bgm-library',
    libraryName: 'TYICC 午间悦听背景音乐库',
    libraryVersion: '0.0.0',
    minAppVersion: '3.0.0',
    description: '独立分发的背景音乐资源库，采用统一单包全量覆盖导入。',
    updatedAt: new Date().toISOString(),
    contributors: [],
    packagesApplied: [],
    tracks: [],
    trackCount: 0,
    packageFormat: {
      schemaVersion: 1,
      packageFile: 'package.json',
      mediaRoot: 'files/'
    }
  }
}

function createMusicLibraryManager({
  dataDir,
  ensureDir,
  dialog,
  getMainWindow,
  getAudioDurationSeconds,
  getAppVersion
}) {
  const libraryRoot = path.join(dataDir, 'music-library')
  const manifestPath = path.join(libraryRoot, 'library.json')
  const tracksDir = path.join(libraryRoot, 'tracks')
  const packagesDir = path.join(libraryRoot, 'packages')
  const stagingDir = path.join(libraryRoot, 'staging')

  function moveOrCopyFile(sourcePath, destPath) {
    try {
      fs.renameSync(sourcePath, destPath)
      return
    } catch {}
    fs.copyFileSync(sourcePath, destPath)
  }

  function parseOptionalNumber(input, fallbackValue = 0) {
    const n = Number(input)
    return Number.isFinite(n) && n >= 0 ? n : fallbackValue
  }

  function normalizeOptionalSha1(input) {
    const sha = String(input || '').trim().toLowerCase()
    return /^[a-f0-9]{40}$/.test(sha) ? sha : ''
  }

  function ensureStructure() {
    ensureDir(libraryRoot)
    ensureDir(tracksDir)
    ensureDir(packagesDir)
    ensureDir(stagingDir)
    if (!fs.existsSync(manifestPath)) {
      writeJson(manifestPath, createDefaultManifest())
    }
  }

  function readManifest() {
    ensureStructure()
    const manifest = safeReadJson(manifestPath, createDefaultManifest())
    if (!Array.isArray(manifest.tracks)) manifest.tracks = []
    if (!Array.isArray(manifest.packagesApplied)) manifest.packagesApplied = []
    if (!Array.isArray(manifest.contributors)) manifest.contributors = []
    manifest.trackCount = manifest.tracks.length
    return manifest
  }

  function writeManifest(manifest) {
    ensureStructure()
    const next = {
      ...manifest,
      trackCount: Array.isArray(manifest.tracks) ? manifest.tracks.length : 0,
      updatedAt: manifest.updatedAt || new Date().toISOString(),
      contributors: normalizeContributors(manifest.contributors)
    }
    writeJson(manifestPath, next)
    return next
  }

  async function listTracks() {
    const manifest = readManifest()
    return manifest.tracks
      .filter(track => track && track.status !== 'removed')
      .sort((a, b) => {
        const sortA = Number(a.sortOrder || 0)
        const sortB = Number(b.sortOrder || 0)
        if (sortA !== sortB) return sortA - sortB
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
      })
      .map(track => ({
        ...track,
        path: path.join(libraryRoot, track.relativePath || '')
      }))
  }

  async function getLibraryInfo() {
    const manifest = readManifest()
    return {
      success: true,
      libraryRoot,
      manifestPath,
      info: {
        libraryId: manifest.libraryId,
        libraryName: manifest.libraryName,
        libraryVersion: manifest.libraryVersion,
        description: manifest.description,
        updatedAt: manifest.updatedAt,
        contributors: manifest.contributors,
        trackCount: manifest.trackCount,
        packagesApplied: manifest.packagesApplied
      }
    }
  }

  async function applyPackage(zipPath) {
    ensureStructure()
    if (!zipPath || !fs.existsSync(zipPath)) {
      throw new Error('音乐库文件不存在')
    }

    const unzipDir = path.join(stagingDir, `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    ensureDir(unzipDir)

    try {
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(unzipDir, true)

      const packageJsonPath = path.join(unzipDir, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        throw new Error('音乐库文件缺少 package.json')
      }

      const pkg = safeReadJson(packageJsonPath, null)
      if (!pkg || Number(pkg.schemaVersion) !== 1) {
        throw new Error('音乐库文件 schemaVersion 不受支持')
      }
      if (!Array.isArray(pkg.operations)) {
        throw new Error('音乐库文件缺少 operations')
      }

      const upsertOperations = pkg.operations.filter((operation) => String(operation?.action || '') === 'upsertTrack')
      if (upsertOperations.length === 0) {
        throw new Error('音乐库文件格式要求 package.json 至少包含一条 upsertTrack 操作')
      }

      // 统一包模式：每次导入前先清空旧曲库与旧包留档，仅保留新导入包
      try { fs.rmSync(tracksDir, { recursive: true, force: true }) } catch {}
      try { fs.rmSync(packagesDir, { recursive: true, force: true }) } catch {}
      ensureDir(tracksDir)
      ensureDir(packagesDir)

      const trackMap = new Map()
      let added = 0

      for (const operation of upsertOperations) {
        const action = String(operation?.action || '')
        if (action !== 'upsertTrack') {
          throw new Error(`不支持的操作：${action}`)
        }

        const sourceRelative = String(operation.file || '').trim()
        const sourcePath = path.resolve(unzipDir, sourceRelative)
        if (!sourceRelative || !sourcePath.startsWith(unzipDir) || !fs.existsSync(sourcePath)) {
          throw new Error(`曲目文件不存在：${sourceRelative || '未提供文件路径'}`)
        }

        const ext = path.extname(sourcePath).toLowerCase()
        if (!AUDIO_EXTS.has(ext)) {
          throw new Error(`不支持的音频格式：${ext || '未知'}`)
        }

        const id = slugifyTrackId(operation.id || operation.title || path.parse(sourcePath).name)
        const destFileName = `${id}${ext}`
        const destPath = path.join(tracksDir, destFileName)
        moveOrCopyFile(sourcePath, destPath)

        const stat = fs.statSync(destPath)
        const duration = parseOptionalNumber(operation.durationSec ?? operation.duration, 0)
        const checksumSha1 = normalizeOptionalSha1(operation.checksumSha1)
        const size = parseOptionalNumber(operation.size, stat.size)
        const record = {
          id,
          title: String(operation.title || path.parse(sourcePath).name),
          artist: String(operation.artist || ''),
          description: String(operation.description || ''),
          tags: Array.isArray(operation.tags) ? operation.tags.map(v => String(v)) : [],
          filename: destFileName,
          originalFileName: path.basename(sourcePath),
          relativePath: `tracks/${destFileName}`,
          sourcePackageId: String(pkg.packageId || path.parse(zipPath).name),
          libraryVersion: String(pkg.libraryVersion || '0.0.0'),
          duration,
          size,
          checksumSha1,
          importedAt: new Date().toISOString(),
          sortOrder: Number(operation.sortOrder || Date.now()),
          contributors: normalizeContributors(operation.contributors || pkg.contributors),
          status: 'active'
        }

        trackMap.set(id, record)
        added++
      }

      const appliedAt = new Date().toISOString()
      const manifest = readManifest()
      const nextManifest = writeManifest({
        ...createDefaultManifest(),
        libraryId: String(pkg.libraryId || manifest.libraryId || 'tyicc-bgm-library'),
        libraryName: String(pkg.libraryName || manifest.libraryName || 'TYICC 午间悦听背景音乐库'),
        libraryVersion: String(pkg.libraryVersion || manifest.libraryVersion || '0.0.0'),
        description: String(pkg.libraryDescription || manifest.description || ''),
        minAppVersion: String(pkg.minAppVersion || manifest.minAppVersion || '3.0.0'),
        updatedAt: appliedAt,
        contributors: normalizeContributors(pkg.contributors || []),
        tracks: Array.from(trackMap.values()),
        packagesApplied: [{
          packageId: String(pkg.packageId || path.parse(zipPath).name),
          packageType: 'full',
          libraryVersion: String(pkg.libraryVersion || manifest.libraryVersion || '0.0.0'),
          baseLibraryVersion: null,
          appliedAt,
          description: String(pkg.description || ''),
          operationCount: upsertOperations.length
        }]
      })

      const packageCopyName = `${String(pkg.packageId || path.parse(zipPath).name)}.zip`
      fs.copyFileSync(zipPath, path.join(packagesDir, packageCopyName))

      return {
        success: true,
        message: '音乐库导入成功，已全量覆盖旧库',
        added,
        updated: 0,
        removed: manifest.trackCount || 0,
        libraryVersion: nextManifest.libraryVersion,
        trackCount: nextManifest.trackCount
      }
    } finally {
      try {
        fs.rmSync(unzipDir, { recursive: true, force: true })
      } catch {}
    }
  }

  async function importPackageFromDialog() {
    ensureStructure()
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '音乐库文件', extensions: ['zip'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths?.length) {
      return { success: false, canceled: true, message: '已取消导入' }
    }

    const selectedPath = result.filePaths[0]
    const confirmResult = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['开始导入', '取消'],
      defaultId: 0,
      cancelId: 1,
      title: '即将开始导入',
      message: '即将开始导入，为最大限度节约电脑资源，导入过程中软件可能被提示为无响应，常规导入时间在1-2分钟内都属正常现象，请耐心等待。'
    })
    if (confirmResult.response !== 0) {
      return { success: false, canceled: true, message: '已取消导入' }
    }
    return await applyPackage(selectedPath)
  }

  async function clearLibrary() {
    ensureStructure()
    const manifest = readManifest()
    try { fs.rmSync(tracksDir, { recursive: true, force: true }) } catch {}
    try { fs.rmSync(packagesDir, { recursive: true, force: true }) } catch {}
    ensureDir(tracksDir)
    ensureDir(packagesDir)

    const nextManifest = writeManifest({
      ...createDefaultManifest(),
      libraryId: manifest.libraryId || 'tyicc-bgm-library',
      libraryName: manifest.libraryName || 'TYICC 午间悦听背景音乐库',
      description: manifest.description || '独立分发的背景音乐资源库，采用统一单包全量覆盖导入。',
      minAppVersion: manifest.minAppVersion || '3.0.0',
      libraryVersion: '0.0.0',
      contributors: [],
      tracks: [],
      packagesApplied: []
    })

    return {
      success: true,
      removed: Number(manifest.trackCount || 0),
      trackCount: Number(nextManifest.trackCount || 0),
      message: '已清空导入的音乐库'
    }
  }

  async function createPackageFromSpec(spec) {
    ensureStructure()

    const packageType = 'full'
    const packageId = String(spec?.packageId || '').trim()
    const libraryVersion = String(spec?.libraryVersion || '').trim()
    const libraryId = String(spec?.libraryId || 'tyicc-bgm-library').trim()
    const libraryName = String(spec?.libraryName || 'TYICC 午间悦听背景音乐库').trim()
    const libraryDescription = String(spec?.libraryDescription || '').trim()
    const description = String(spec?.description || '').trim()
    const minAppVersion = String(spec?.minAppVersion || '').trim()
    const outputPath = String(spec?.outputPath || '').trim()

    if (!packageId) throw new Error('packageId 不能为空')
    if (!libraryVersion) throw new Error('libraryVersion 不能为空')
    if (!outputPath) throw new Error('导出路径不能为空')
    const tracks = Array.isArray(spec?.tracks) ? spec.tracks : []
    const removeTrackIds = []

    if (tracks.length === 0) {
      throw new Error('音乐库文件至少需要一首曲目')
    }

    const contributors = normalizeContributors(spec?.contributors)
    const usedTrackIds = new Set()
    const operations = []
    const zip = new AdmZip()

    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index] || {}
      const filePath = String(track.filePath || '').trim()
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`第 ${index + 1} 首曲目的文件不存在`)
      }
      const ext = path.extname(filePath).toLowerCase()
      if (!AUDIO_EXTS.has(ext)) {
        throw new Error(`第 ${index + 1} 首曲目格式不支持：${ext || '未知'}`)
      }

      const id = slugifyTrackId(track.id || track.title || path.parse(filePath).name)
      if (usedTrackIds.has(id)) {
        throw new Error(`曲目 ID 重复：${id}`)
      }
      usedTrackIds.add(id)

      const packedFileName = `${id}${ext}`
      zip.addLocalFile(filePath, 'files', packedFileName)

      operations.push({
        action: 'upsertTrack',
        id,
        file: `files/${packedFileName}`,
        title: String(track.title || path.parse(filePath).name).trim(),
        artist: String(track.artist || '').trim(),
        description: String(track.description || '').trim(),
        size: fs.statSync(filePath).size,
        durationSec: parseOptionalNumber(track.duration, 0),
        tags: normalizeTags(track.tags),
        sortOrder: Number(track.sortOrder || (index + 1) * 10),
        contributors: normalizeContributors(track.contributors)
      })
    }

    const usedRemoveIds = new Set()

    const packageJson = {
      schemaVersion: 1,
      packageType,
      packageId,
      libraryId,
      libraryName,
      libraryVersion,
      baseLibraryVersion: null,
      libraryDescription,
      description,
      minAppVersion,
      contributors,
      operations
    }

    const appVersion = typeof getAppVersion === 'function' ? getAppVersion() : ''
    if (appVersion) {
      packageJson.generator = {
        name: 'TYICC午间悦听制作器',
        version: appVersion
      }
    }
    packageJson.generatedAt = new Date().toISOString()

    zip.addFile('package.json', Buffer.from(JSON.stringify(packageJson, null, 2), 'utf8'))

    const finalOutputPath = outputPath.toLowerCase().endsWith('.zip') ? outputPath : `${outputPath}.zip`
    ensureDir(path.dirname(finalOutputPath))
    zip.writeZip(finalOutputPath)

    return {
      success: true,
      outputPath: finalOutputPath,
      fileName: path.basename(finalOutputPath),
      packageId,
      packageType,
      libraryVersion,
      operationCount: operations.length,
      trackCount: tracks.length,
      removeCount: usedRemoveIds.size
    }
  }

  return {
    getLibraryInfo,
    listTracks,
    importPackageFromDialog,
    clearLibrary,
    applyPackage,
    createPackageFromSpec,
    getPaths: () => ({ libraryRoot, manifestPath, tracksDir, packagesDir, stagingDir })
  }
}

module.exports = {
  createMusicLibraryManager
}