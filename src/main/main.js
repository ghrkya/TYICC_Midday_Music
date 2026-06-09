/**
 * TYICC午间悦听 - Electron主进程
 * 
 * 负责窗口管理、IPC通信、音频处理（FFmpeg调用）、B站下载（yt-dlp调用）
 * 
 * 依赖说明：
 * - FFmpeg: 通过 npm 包 @ffmpeg-installer/ffmpeg 自动提供，跨平台兼容
 * - yt-dlp: 首次启动时自动从 GitHub 下载到用户数据目录
 */

// 重要：Electron 42+ 中顶层 destructure require("electron") 会返回 undefined
// 必须使用单个 require 然后通过属性访问
const electron = require('electron')
const app = electron.app
const BrowserWindow = electron.BrowserWindow
const ipcMain = electron.ipcMain
const dialog = electron.dialog
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')
const http = require('http')
const https = require('https')

// ============================================================
// FFmpeg自动安装器 - npm包提供，跨平台兼容
// ============================================================
let ffmpegPath = null
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
  ffmpegPath = ffmpegInstaller.path
  console.log('FFmpeg路径:', ffmpegPath)
} catch (e) {
  console.warn('FFmpeg包未找到:', e.message)
}

// ============================================================
// 平台与路径常量
// ============================================================
const isDev = !app.isPackaged
const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

// 用户数据目录结构（自动跨平台）
const USER_DATA_DIR = app.getPath('userData')
const USER_BIN_DIR = path.join(USER_DATA_DIR, 'bin')     // 存放yt-dlp
const TEMP_DIR = path.join(USER_DATA_DIR, 'temp')        // 临时处理文件
const DOWNLOAD_DIR = path.join(app.getAppPath(), 'ttmpdownload')  // 下载输出目录
const CACHE_DIR = path.join(USER_DATA_DIR, 'cache')      // B站下载缓存

let mainWindow = null

/**
 * 获取FFmpeg路径
 * 由 npm 包 @ffmpeg-installer/ffmpeg 自动提供对应平台的二进制
 */
function getFfmpegPath() {
  return ffmpegPath
}

/**
 * 获取yt-dlp路径
 * 优先使用项目内打包的版本 (bin/)，回退到用户数据目录
 */
function getYtDlpPath() {
  // app.getAppPath() 始终返回项目根目录
  const bundledPath = path.join(app.getAppPath(), 'bin', isWin ? 'win/yt-dlp.exe' : 'mac/yt-dlp_macos')
  // 检查打包的yt-dlp是否存在且有效
  try {
    if (fs.existsSync(bundledPath)) {
      const stat = fs.statSync(bundledPath)
      if (stat.size > 1000) return bundledPath
    }
  } catch {}
  // 回退到用户数据目录
  return path.join(USER_BIN_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp')
}

/**
 * 获取静态资源路径（如logo图片）
 */
function getStaticPath(filename) {
  return path.join(__dirname, '../../static', filename)
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    title: 'TYICC午间悦听',
    webPreferences: {
      // app.getAppPath() 始终返回项目根目录，不受插件重启/__dirname变化影响
      // 指向源码 preload，在 dev 模式下与编译版本等效
      preload: path.join(app.getAppPath(), 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(url)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============================================================
// IPC 处理器
// ============================================================

/**
 * 检测网络连通性 - 用 DNS 解析 bilibili.com，走系统层级比 HTTP 更可靠
 */
const dns = require('dns')
ipcMain.handle('check-network', async () => {
  return new Promise((resolve) => {
    dns.resolve('www.bilibili.com', (err) => {
      resolve({ success: !err, statusCode: err ? 0 : 200 })
    })
  })
})

/**
 * 自动下载yt-dlp到用户数据目录
 * 只在第一次运行时下载，后续启动时只做更新检查
 */
ipcMain.handle('download-yt-dlp', async () => {
  const ytDlpPath = getYtDlpPath()
  ensureDir(USER_BIN_DIR)

  // 如果已存在且文件大小>0，直接返回成功
  if (fs.existsSync(ytDlpPath)) {
    const stat = fs.statSync(ytDlpPath)
    if (stat.size > 0) {
      return { success: true, message: 'yt-dlp 已存在', alreadyExists: true }
    }
    // 0字节文件，删除重下
    try { fs.unlinkSync(ytDlpPath) } catch {}
  }

  // 下载URL列表 - GitHub官方 + 国内镜像（按顺序尝试）
  const filename = isWin ? 'yt-dlp.exe' : (isMac ? 'yt-dlp_macos' : 'yt-dlp')
  const downloadUrls = [
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`,
    `https://github.moeyy.xyz/https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`,
    `https://ghproxy.net/https://github.com/yt-dlp/yt-dlp/releases/latest/download/${filename}`
  ]

  function attemptDownload(urlIndex) {
    if (urlIndex >= downloadUrls.length) {
      return Promise.resolve({ success: false, message: '所有下载源均失败，请手动下载 yt-dlp.exe 放入 ' + USER_BIN_DIR })
    }

    return new Promise((resolve) => {
      const file = fs.createWriteStream(ytDlpPath)
      let receivedBytes = 0
      let downloadFailed = false

      function finishDownload(success, message) {
        try { file.close() } catch {}
        if (!success && fs.existsSync(ytDlpPath)) {
          try { fs.unlinkSync(ytDlpPath) } catch {}
          // 尝试下一个镜像源
          attemptDownload(urlIndex + 1).then(resolve)
        } else {
          if (!isWin && success) {
            try { fs.chmodSync(ytDlpPath, '755') } catch {}
          }
          resolve({ success, message })
        }
      }

      const req = https.get(downloadUrls[urlIndex], (response) => {
        // 处理GitHub重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          https.get(response.headers.location, (res) => {
            res.pipe(file)
            res.on('data', (chunk) => { receivedBytes += chunk.length })
            res.on('end', () => {
              if (receivedBytes < 1000 && !downloadFailed) {
                finishDownload(false, `文件大小异常 (${receivedBytes} bytes)`)
              } else {
                finishDownload(true, `yt-dlp 下载完成 (${(receivedBytes / 1024 / 1024).toFixed(1)}MB)`)
              }
            })
          }).on('error', () => {
            downloadFailed = true
            finishDownload(false, '镜像下载失败')
          })
          return
        }

        response.pipe(file)
        response.on('data', (chunk) => { receivedBytes += chunk.length })
        response.on('end', () => {
          if (receivedBytes < 1000 && !downloadFailed) {
            finishDownload(false, `文件大小异常 (${receivedBytes} bytes)`)
          } else {
            finishDownload(true, `yt-dlp 下载完成 (${(receivedBytes / 1024 / 1024).toFixed(1)}MB)`)
          }
        })
      })

      req.on('error', () => {
        downloadFailed = true
        finishDownload(false, '连接失败')
      })

      req.setTimeout(15000, () => {
        req.destroy()
        downloadFailed = true
        finishDownload(false, '连接超时')
      })
    })
  }

  return attemptDownload(0)
})

/**
 * 更新yt-dlp到最新版本
 */
ipcMain.handle('update-yt-dlp', async () => {
  const ytDlpPath = getYtDlpPath()

  if (!fs.existsSync(ytDlpPath)) {
    return { success: false, message: 'yt-dlp未下载，请先执行下载' }
  }

  return new Promise((resolve) => {
    // 不使用 shell: true 避免 DEP0190 警告和安全风险
    // 直接传递参数数组，由 Node.js 处理转义
    const proc = spawn(ytDlpPath, ['-U'], { shell: false })
    let output = ''
    proc.stdout.on('data', (data) => { output += data.toString() })
    proc.stderr.on('data', (data) => { output += data.toString() })
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        message: output.trim() || 'yt-dlp 已是最新版本',
        code
      })
    })
    proc.on('error', (err) => {
      resolve({ success: false, message: err.message })
    })
  })
})

/**
 * 检查FFmpeg是否可用
 */
ipcMain.handle('check-ffmpeg', async () => {
  const ffPath = getFfmpegPath()
  if (!ffPath || !fs.existsSync(ffPath)) {
    return { available: false, message: 'FFmpeg不可用（npm包缺失）' }
  }
  return new Promise((resolve) => {
    const proc = spawn(ffPath, ['-version'])
    let output = ''
    proc.stdout.on('data', (data) => { output += data.toString() })
    proc.on('close', (code) => {
      resolve({
        available: code === 0,
        version: output.split('\n')[0] || '',
        message: code === 0 ? 'FFmpeg可用' : 'FFmpeg执行失败'
      })
    })
    proc.on('error', (err) => {
      resolve({ available: false, message: err.message })
    })
  })
})

function extractBvId(input) {
  if (!input) return null
  const text = String(input).trim()
  // BV号大小写敏感，保留原始大小写
  if (/^BV[0-9A-Za-z]{10}$/i.test(text)) return text
  const match = text.match(/BV[0-9A-Za-z]{10}/i)
  return match ? match[0] : null
}

function sanitizeFilename(name) {
  return String(name || 'bilibili_audio')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function httpGetBuffer(url, headers = {}, timeout = 20000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('重定向过多'))
      return
    }

    const urlObj = new URL(url)
    const lib = urlObj.protocol === 'http:' ? http : https
    const req = lib.get(urlObj, { headers }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, urlObj).toString()
        res.resume()
        httpGetBuffer(nextUrl, headers, timeout, redirectCount + 1).then(resolve).catch(reject)
        return
      }

      if (status < 200 || status >= 300) {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => reject(new Error(`HTTP ${status}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`)))
        return
      }

      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error('请求超时'))
    })
  })
}

async function downloadFile(url, filePath, headers = {}) {
  const data = await httpGetBuffer(url, headers, 45000)
  fs.writeFileSync(filePath, data)
}

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]

function getMixinKey(orig) {
  let s = ''
  for (const idx of WBI_MIXIN_KEY_ENC_TAB) {
    if (idx < orig.length) s += orig[idx]
  }
  return s.slice(0, 32)
}

function sanitizeWbiValue(value) {
  return String(value).replace(/[!'()*]/g, '')
}

function buildSignedWbiQuery(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey)
  const p = { ...params, wts: String(Math.floor(Date.now() / 1000)) }
  const keys = Object.keys(p).sort()
  const qs = new URLSearchParams()
  for (const k of keys) qs.set(k, sanitizeWbiValue(p[k]))
  const query = qs.toString()
  const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex')
  qs.set('w_rid', wRid)
  return qs.toString()
}

async function getBilibiliAudioStreamByBv(bvId, randomUA) {
  const commonHeaders = {
    'User-Agent': randomUA,
    'Referer': 'https://www.bilibili.com',
    'Origin': 'https://www.bilibili.com'
  }

  const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvId)}`
  const viewJson = JSON.parse((await httpGetBuffer(viewUrl, commonHeaders)).toString('utf8'))
  if (viewJson.code !== 0 || !viewJson.data) {
    throw new Error(`view API失败: ${viewJson.message || viewJson.code || '未知错误'}`)
  }

  const cid = String(viewJson.data.cid || (viewJson.data.pages && viewJson.data.pages[0] && viewJson.data.pages[0].cid) || '')
  if (!cid) throw new Error('未获取到 CID')
  const title = sanitizeFilename(viewJson.data.title || bvId)

  const navJson = JSON.parse((await httpGetBuffer('https://api.bilibili.com/x/web-interface/nav', commonHeaders)).toString('utf8'))
  const imgUrl = navJson?.data?.wbi_img?.img_url || ''
  const subUrl = navJson?.data?.wbi_img?.sub_url || ''
  const imgKey = imgUrl.split('/').pop()?.split('.')[0] || ''
  const subKey = subUrl.split('/').pop()?.split('.')[0] || ''
  if (!imgKey || !subKey) throw new Error('无法获取 WBI 签名密钥')

  function extractAudioUrlFromPlayJson(playJson) {
    const audio = playJson?.data?.dash?.audio?.[0]
    const fromDash = audio?.base_url || audio?.baseUrl || audio?.backup_url?.[0] || audio?.backupUrl?.[0]
    if (fromDash) return fromDash
    const fromDurl = playJson?.data?.durl?.[0]?.url || playJson?.result?.durl?.[0]?.url
    if (fromDurl) return fromDurl
    return ''
  }

  // 方案A：WBI playurl（优先）
  let streamUrl = ''
  try {
    const signedQuery = buildSignedWbiQuery({ bvid: bvId, cid, fnval: '16', try_look: '1', fourk: '1' }, imgKey, subKey)
    const playUrl = `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`
    const playJson = JSON.parse((await httpGetBuffer(playUrl, commonHeaders)).toString('utf8'))
    if (playJson.code === 0 && playJson.data) {
      streamUrl = extractAudioUrlFromPlayJson(playJson)
    }
  } catch {}

  // 方案B：旧接口 playurl（不走WBI）
  if (!streamUrl) {
    const oldQuery = new URLSearchParams({
      bvid: bvId,
      cid,
      fnval: '16',
      fnver: '0',
      qn: '64',
      fourk: '1',
      platform: 'html5',
      high_quality: '1',
      try_look: '1'
    }).toString()
    const oldUrl = `https://api.bilibili.com/x/player/playurl?${oldQuery}`
    const oldJson = JSON.parse((await httpGetBuffer(oldUrl, commonHeaders)).toString('utf8'))
    if (oldJson.code === 0 && (oldJson.data || oldJson.result)) {
      streamUrl = extractAudioUrlFromPlayJson(oldJson)
    }
  }

  if (!streamUrl) throw new Error('未获取到可用音频流地址（WBI与旧接口均失败）')

  return { streamUrl, title }
}

async function fallbackDownloadByVideoThenExtract({ input, outputDir, quality = 'best' }) {
  const ytDlpPath = getYtDlpPath()
  const ffPath = getFfmpegPath()
  if (!fs.existsSync(ytDlpPath)) throw new Error('yt-dlp 不可用，无法执行视频兜底')
  if (!ffPath || !fs.existsSync(ffPath)) throw new Error('FFmpeg不可用，无法从视频提取音频')

  let videoUrl = input
  if (!String(videoUrl).startsWith('http')) {
    videoUrl = `https://www.bilibili.com/video/${input}`
  }

  ensureDir(TEMP_DIR)
  const before = new Set(fs.readdirSync(TEMP_DIR))
  const videoTemplate = path.join(TEMP_DIR, `bili_fallback_${Date.now()}_%(id)s.%(ext)s`)
  const args = [
    '-f', 'b/w',
    '--no-playlist',
    '--geo-bypass',
    '--xff', 'CN',
    '--impersonate', 'chrome',
    '--extractor-retries', '5',
    '--add-header', 'Referer:https://www.bilibili.com',
    '--add-header', 'Origin:https://www.bilibili.com',
    '--no-check-certificates',
    '-o', videoTemplate,
    videoUrl
  ]

  const runRes = await new Promise((resolve) => {
    const proc = spawn(ytDlpPath, args)
    let err = ''
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('close', (code) => resolve({ code, err }))
    proc.on('error', (e) => resolve({ code: -1, err: e.message }))
  })

  if (runRes.code !== 0) {
    throw new Error(`视频兜底下载失败: ${(runRes.err || '').slice(0, 300)}`)
  }

  const after = fs.readdirSync(TEMP_DIR)
  const candidates = after.filter(f => !before.has(f)).filter(f => /\.(mp4|flv|mkv|webm|m4s|ts)$/i.test(f))
  const videoFile = candidates[0]
  if (!videoFile) throw new Error('视频兜底下载后未找到视频文件')

  const inputVideoPath = path.join(TEMP_DIR, videoFile)
  const baseName = sanitizeFilename(path.parse(videoFile).name)
  const targetPath = path.join(outputDir, `${baseName}_${quality === 'best' ? 'audio' : 'audio_low'}.mp3`)

  await new Promise((resolve, reject) => {
    const proc = spawn(ffPath, ['-i', inputVideoPath, '-vn', '-c:a', 'libmp3lame', '-q:a', '6', '-y', targetPath])
    let ffErr = ''
    proc.stderr.on('data', (d) => { ffErr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(ffErr || 'FFmpeg 提取音频失败'))
    })
    proc.on('error', reject)
  })

  try { fs.unlinkSync(inputVideoPath) } catch {}

  return {
    success: true,
    message: '通过视频兜底提取音频成功',
    filePath: targetPath,
    fileName: path.basename(targetPath)
  }
}

async function fallbackDownloadByApi({ input, outputDir, randomUA }) {
  const bvId = extractBvId(input)
  if (!bvId) {
    throw new Error('无法从输入中解析 BV 号，无法执行 API 兜底')
  }

  const ffPath = getFfmpegPath()
  if (!ffPath || !fs.existsSync(ffPath)) {
    throw new Error('FFmpeg不可用，无法执行 API 兜底转码')
  }

  const { streamUrl, title } = await getBilibiliAudioStreamByBv(bvId, randomUA)
  ensureDir(TEMP_DIR)
  const tempInput = path.join(TEMP_DIR, `bili_${Date.now()}_${Math.floor(Math.random() * 1000)}.m4s`)
  let targetName = `${title}.mp3`
  let targetPath = path.join(outputDir, targetName)
  if (fs.existsSync(targetPath)) {
    targetName = `${title}_${Date.now()}.mp3`
    targetPath = path.join(outputDir, targetName)
  }

  await downloadFile(streamUrl, tempInput, {
    'User-Agent': randomUA,
    'Referer': 'https://www.bilibili.com',
    'Origin': 'https://www.bilibili.com'
  })

  await new Promise((resolve, reject) => {
    const proc = spawn(ffPath, ['-i', tempInput, '-vn', '-c:a', 'libmp3lame', '-q:a', '0', '-y', targetPath])
    let ffErr = ''
    proc.stderr.on('data', (d) => { ffErr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(ffErr || 'FFmpeg 转码失败'))
    })
    proc.on('error', reject)
  })

  try { fs.unlinkSync(tempInput) } catch {}

  return {
    success: true,
    message: '通过API兜底下载成功',
    filePath: targetPath,
    fileName: path.basename(targetPath)
  }
}

/**
 * 提取B站下载错误信息 - 将yt-dlp的冗长错误输出转为简洁中文提示
 */
function extractBilibiliError(errorMsg) {
  if (!errorMsg) return null
  const msg = errorMsg.toLowerCase()
  // 常见错误模式匹配
  if (msg.includes('this video may be deleted or geo-restricted') || msg.includes('geo-restricted')) {
    return 'B站返回了“下架或地区限制”提示，这通常是风控误判；已尝试增强模式仍失败，请稍后重试或更换网络'
  }
  if (errorMsg.includes('HTTP Error 403') || errorMsg.includes('403 Forbidden')) {
    return 'B站拒绝访问，可能是请求被拦截，请稍后重试'
  }
  if (errorMsg.includes('HTTP Error 404') || errorMsg.includes('404 Not Found')) {
    return '视频不存在或BV号错误，请检查链接'
  }
  if (errorMsg.includes('HTTP Error 412')) {
    return 'B站触发反爬机制（412），请稍后重试'
  }
  if (errorMsg.includes('Video unavailable') || errorMsg.includes('This video is not available')) {
    return '该视频不可用（可能已删除或仅限特定区域）'
  }
  if (errorMsg.includes('unable to extract') || errorMsg.includes('ExtractorError')) {
    return 'B站页面结构有变，请更新yt-dlp后重试'
  }
  if (errorMsg.includes('unable to download webpage')) {
    return '无法访问B站页面，请检查网络连接'
  }
  if (errorMsg.includes('certificate') || errorMsg.includes('cert')) {
    return 'SSL证书验证失败（校园网络可能拦截），建议检查网络环境'
  }
  if (errorMsg.includes('connection') || errorMsg.includes('timeout') || errorMsg.includes('Name or service not known')) {
    return '网络连接失败，请检查网络后重试'
  }
  if (errorMsg.includes('sign in') || errorMsg.includes('login') || errorMsg.includes('这是private视频')) {
    return '该视频需要登录才能访问，建议使用公开视频'
  }
  if (errorMsg.includes('no video') || errorMsg.includes('No video')) {
    return '该BV号未找到有效视频，请检查输入'
  }
  return null
}

/**
 * 下载B站视频音频 - 通过yt-dlp提取为MP3
 */
ipcMain.handle('download-bilibili', async (event, { url, outputDir, quality = 'best' }) => {
  try {
    ensureDir(outputDir)
    const ytDlpPath = getYtDlpPath()

    if (!fs.existsSync(ytDlpPath)) {
      return { success: false, message: 'yt-dlp未下载，请在启动页等待下载完成' }
    }

    let videoUrl = url
    if (!url.startsWith('http')) {
      videoUrl = `https://www.bilibili.com/video/${url}`
    }

    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s')

    // 随机UA列表，模拟真实浏览器
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    ]
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)]

    const ffPath = getFfmpegPath()

    const baseArgs = [
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', quality === 'best' ? '0' : quality,
      '--no-playlist',
      '--geo-bypass',
      '--no-check-certificates',
      '--extractor-retries', '5',
      ...(ffPath ? ['--ffmpeg-location', ffPath] : []),
      '--add-header', `User-Agent:${randomUA}`,
      '--add-header', 'Referer:https://www.bilibili.com',
      '--add-header', 'Origin:https://www.bilibili.com',
      '-o', outputTemplate,
      videoUrl
    ]

    console.log('[yt-dlp] 开始下载:', videoUrl, '→', outputDir)

    function runYtDlpAttempt(extraArgs = [], attemptName = '默认策略') {
      const args = [...baseArgs.slice(0, -1), ...extraArgs, videoUrl]
      return new Promise((resolve) => {
        const proc = spawn(ytDlpPath, args)
        let errorMsg = ''

        proc.stdout.on('data', (data) => {
          const text = data.toString().trim()
          if (text) console.log(`[yt-dlp stdout][${attemptName}]`, text)
        })

        proc.stderr.on('data', (data) => {
          errorMsg += data.toString()
        })

        proc.on('close', (code) => {
          if (errorMsg) {
            console.error(`[yt-dlp stderr][${attemptName}]`, errorMsg.slice(0, 2000))
          }
          resolve({ code, errorMsg })
        })

        proc.on('error', (err) => {
          resolve({ code: -1, errorMsg: err.message })
        })
      })
    }

    return new Promise((resolve) => {
      ;(async () => {
        let attempt = await runYtDlpAttempt([], '默认策略')

        // 针对 B站常见“geo-restricted”误判，自动进行一次增强重试
        if (attempt.code !== 0) {
          const lowerMsg = (attempt.errorMsg || '').toLowerCase()
          if (lowerMsg.includes('geo-restricted') || lowerMsg.includes('may be deleted')) {
            console.warn('[yt-dlp] 触发 geo/deleted 误判，启用增强重试策略')
            attempt = await runYtDlpAttempt(
              ['--impersonate', 'chrome', '--xff', 'CN'],
              '增强策略'
            )

            if (attempt.code !== 0) {
              console.warn('[yt-dlp] 增强策略仍失败，启动 API 直连兜底下载')
              try {
                const fallbackResult = await fallbackDownloadByApi({
                  input: url,
                  outputDir,
                  randomUA
                })
                resolve(fallbackResult)
                return
              } catch (fallbackErr) {
                console.error('[bilibili-api fallback error]', fallbackErr.message)
                try {
                  console.warn('[yt-dlp] API 兜底失败，启动 视频下载后提取音频 方案')
                  const videoFallbackResult = await fallbackDownloadByVideoThenExtract({
                    input: url,
                    outputDir,
                    quality
                  })
                  resolve(videoFallbackResult)
                  return
                } catch (videoFallbackErr) {
                  console.error('[bilibili-video fallback error]', videoFallbackErr.message)
                  attempt.errorMsg = `${attempt.errorMsg || ''}\nAPI兜底失败: ${fallbackErr.message}\n视频兜底失败: ${videoFallbackErr.message}`
                }
              }
            }
          }
        }

        if (attempt.code !== 0) {
          const friendlyMsg = extractBilibiliError(attempt.errorMsg)
          resolve({
            success: false,
            message: friendlyMsg || (attempt.errorMsg || '').slice(0, 300) || '下载失败，请检查BV号是否正确'
          })
          return
        }

        // 扫描 outputDir 中的 mp3 文件（yt-dlp 成功后直接查找）
        let files = []
        try { files = fs.readdirSync(outputDir) } catch {}
        const mp3File = files.find(f => f.toLowerCase().endsWith('.mp3'))

        if (mp3File) {
          const fullPath = path.join(outputDir, mp3File)
          resolve({
            success: true,
            message: '下载成功',
            filePath: fullPath,
            fileName: mp3File
          })
          return
        }

        resolve({
          success: false,
          message: '下载已完成但未找到MP3文件。输出目录文件: ' +
                   (files.length ? files.join(', ') : '（空）')
        })
      })().catch((err) => {
        resolve({ success: false, message: err.message })
      })
    })
  } catch (err) {
    return { success: false, message: err.message }
  }
})

/**
 * 响度标准化 - loudnorm滤镜
 */
ipcMain.handle('normalize-loudness', async (event, { inputPath, outputPath, targetLUFS = -23 }) => {
  const ffPath = getFfmpegPath()
  if (!ffPath) return { success: false, message: 'FFmpeg不可用' }

  return new Promise((resolve) => {
    const proc = spawn(ffPath, [
      '-i', inputPath,
      '-af', `loudnorm=I=${targetLUFS}:TP=-1:LRA=7`,
      '-ar', '48000',
      '-sample_fmt', 's16',
      '-y',
      outputPath
    ])

    let errorMsg = ''
    proc.stderr.on('data', (data) => { errorMsg += data.toString() })
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        message: code === 0 ? '响度标准化完成' : '处理失败'
      })
    })
    proc.on('error', (err) => {
      resolve({ success: false, message: err.message })
    })
  })
})

/**
 * 转换为统一WAV格式（PCM 16bit 48kHz）
 */
ipcMain.handle('convert-to-wav', async (event, { inputPath, outputPath }) => {
  const ffPath = getFfmpegPath()
  if (!ffPath) return { success: false, message: 'FFmpeg不可用' }

  return new Promise((resolve) => {
    const proc = spawn(ffPath, [
      '-i', inputPath, '-ar', '48000', '-sample_fmt', 's16',
      '-ac', '2', '-y', outputPath
    ])
    let errorMsg = ''
    proc.stderr.on('data', (data) => { errorMsg += data.toString() })
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        message: code === 0 ? '转换完成' : errorMsg || '转换失败'
      })
    })
    proc.on('error', (err) => {
      resolve({ success: false, message: err.message })
    })
  })
})

/**
 * 拼接音频文件 - concat demuxer
 */
ipcMain.handle('concatenate-audio', async (event, { fileList, outputPath }) => {
  const ffPath = getFfmpegPath()
  if (!ffPath) return { success: false, message: 'FFmpeg不可用' }

  ensureDir(TEMP_DIR)
  const concatFile = path.join(TEMP_DIR, `concat_${Date.now()}.txt`)

  try {
    const fileContent = fileList.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
    fs.writeFileSync(concatFile, fileContent, 'utf-8')

    return new Promise((resolve) => {
      const proc = spawn(ffPath, [
        '-f', 'concat', '-safe', '0', '-i', concatFile,
        '-c', 'copy', '-y', outputPath
      ])

      let errorMsg = ''
      proc.stderr.on('data', (data) => { errorMsg += data.toString() })
      proc.on('close', (code) => {
        try { fs.unlinkSync(concatFile) } catch {}
        resolve({
          success: code === 0,
          message: code === 0 ? '拼接完成' : errorMsg || '拼接失败'
        })
      })
      proc.on('error', (err) => {
        try { fs.unlinkSync(concatFile) } catch {}
        resolve({ success: false, message: err.message })
      })
    })
  } catch (err) {
    try { fs.unlinkSync(concatFile) } catch {}
    return { success: false, message: err.message }
  }
})

/**
 * 打开文件选择对话框
 * 防止编译后解构报错，直接使用 options 对象安全访问
 */
ipcMain.handle('open-file-dialog', async (event, options) => {
  const filters = options && options.filters ? options.filters : [
    { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
    { name: '所有文件', extensions: ['*'] }
  ]
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters
  })
  return result
})

/**
 * 打开保存对话框
 * 防止编译后解构报错，直接使用 options 对象安全访问
 */
ipcMain.handle('open-save-dialog', async (event, options) => {
  const defaultName = options && options.defaultName ? options.defaultName : 'output.mp3'
  const filters = options && options.filters ? options.filters : [{ name: '音频文件', extensions: ['mp3', 'wav'] }]
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters
  })
  return result
})

/**
 * 获取文件信息
 */
ipcMain.handle('get-file-info', async (event, { filePath }) => {
  try {
    if (!fs.existsSync(filePath)) return { exists: false }
    const stat = fs.statSync(filePath)
    return {
      exists: true, size: stat.size,
      name: path.basename(filePath), path: filePath
    }
  } catch {
    return { exists: false }
  }
})

/**
 * 清理过期缓存（1天前）
 */
ipcMain.handle('cleanup-cache', async () => {
  try {
    ensureDir(CACHE_DIR)
    const files = fs.readdirSync(CACHE_DIR)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    let cleaned = 0
    files.forEach(file => {
      const filePath = path.join(CACHE_DIR, file)
      try {
        if (fs.statSync(filePath).isFile() && fs.statSync(filePath).mtimeMs < oneDayAgo) {
          fs.unlinkSync(filePath)
          cleaned++
        }
      } catch {}
    })
    return { success: true, cleaned }
  } catch (err) {
    return { success: false, message: err.message }
  }
})

/**
 * 获取下载输出目录（ttmpdownload）
 */
ipcMain.handle('get-temp-dir', async () => {
  ensureDir(DOWNLOAD_DIR)
  return DOWNLOAD_DIR
})

/**
 * 获取缓存目录
 */
ipcMain.handle('get-cache-dir', async () => {
  ensureDir(CACHE_DIR)
  return CACHE_DIR
})

// ============================================================
// 应用生命周期
// ============================================================

app.whenReady().then(async () => {
  ensureDir(TEMP_DIR)
  ensureDir(DOWNLOAD_DIR)
  ensureDir(CACHE_DIR)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

app.on('before-quit', () => {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.readdirSync(TEMP_DIR).forEach(file => {
        try { fs.unlinkSync(path.join(TEMP_DIR, file)) } catch {}
      })
    }
  } catch {}
})