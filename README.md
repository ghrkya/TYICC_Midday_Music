# TYICC_Midday_Music
一个基于electron的TYICC午间悦听栏目制作器

请注意，由于开发者没有Mac电脑且MacOS目前的录音功能有未知错误，MacOS系统上的录音功能暂时不可用。

# Todos

- 创建背景音乐库
- 优化导出文件的元数据
    
    包括但不限于：
    - 增加版权说明信息
- 增加设置页面
- 增加更多说明：
    - b站412说明，可能是IP导致的
    - 音频响度问题说明
    - 创作者说明

# 音乐库模块说明

## 目标

项目内的“背景音乐”支持三类来源：本地文件、B站下载、自带音乐库。

自带音乐库的目标是：

- 允许用户直接从已安装的音乐库中选择背景音乐。
- 允许维护者以 zip 的形式单独分发“音乐库文件”。
- 导入新文件时始终覆盖旧库，降低维护复杂度。

## 运行时目录结构

音乐库不会写进代码目录，也不会耦合在前端静态资源里。运行时统一放在：

- `usrdata/music-library/`

目录结构约定如下：

```text
usrdata/music-library/
├─ library.json              # 音乐库总清单（唯一权威入口）
├─ tracks/                   # 实际音频文件
├─ packages/                 # 已导入的最新文件留档（只保留一个）
└─ staging/                  # 导入 zip 时的临时解包目录
```

其中：

- `library.json` 必须始终存在。
- `tracks/` 只放实际可用的音频文件。
- `packages/` 用于留存最近导入文件，便于排查问题。
- `staging/` 仅用于导入过程，不应被手动编辑。

## library.json 结构设计

`library.json` 是音乐库的中心索引文件，负责记录版本、贡献者、已安装曲目与历史包信息。当前 schema 设计如下：

```json
{
    "schemaVersion": 1,
    "libraryId": "tyicc-bgm-library",
    "libraryName": "TYICC 午间悦听背景音乐库",
    "libraryVersion": "2026.07.27",
    "minAppVersion": "3.0.0",
    "description": "独立分发的背景音乐资源库，采用统一单包全量覆盖导入。",
    "updatedAt": "2026-07-27T12:00:00.000Z",
    "contributors": [
        { "name": "张三", "role": "策划" },
        { "name": "李四", "role": "收集" }
    ],
    "packagesApplied": [
        {
            "packageId": "library-full-2026-07-27",
            "packageType": "full",
            "libraryVersion": "2026.07.27",
            "baseLibraryVersion": null,
            "appliedAt": "2026-07-27T12:00:00.000Z",
            "description": "首发完整包",
            "operationCount": 18
        }
    ],
    "tracks": [
        {
            "id": "sunrise_opening",
            "title": "Sunrise Opening",
            "artist": "TYICC",
            "description": "适合开场语的轻快背景",
            "tags": ["轻快", "开场"],
            "filename": "sunrise_opening.mp3",
            "originalFileName": "sunrise.mp3",
            "relativePath": "tracks/sunrise_opening.mp3",
            "sourcePackageId": "library-full-2026-07-27",
            "libraryVersion": "2026.07.27",
            "duration": 63.8,
            "size": 1234567,
            "checksumSha1": "...",
            "importedAt": "2026-07-27T12:00:00.000Z",
            "sortOrder": 100,
            "contributors": [{ "name": "张三", "role": "整理" }],
            "status": "active"
        }
    ],
    "trackCount": 1,
    "packageFormat": {
        "schemaVersion": 1,
        "packageFile": "package.json",
        "mediaRoot": "files/"
    }
}
```

### 关键设计原则

- `schemaVersion`：以后升级 manifest 结构时的兼容锚点。
- `libraryVersion`：整个库的逻辑版本号，不等于应用版本号。
- `packagesApplied`：在统一包模式下，记录当前生效包及导入时间。
- `tracks[].id`：曲目的稳定主键，后续更新时只依赖它，不依赖文件名。
- `tracks[].relativePath`：只保存相对路径，避免机器间绝对路径不可移植。
- `checksumSha1`：后续若做差异同步、损坏检测、重复文件跳过，可直接利用。

## 音乐库文件格式（zip）

用户拿到的音乐库文件是 zip 文件。zip 根目录约定如下：

```text
music-library.zip
├─ package.json
└─ files/
     ├─ sunrise.mp3
     ├─ bridge_theme.wav
     └─ ending_soft.mp3
```

其中：

- `package.json` 描述这个音乐库文件的元信息和要执行的操作。
- `files/` 存放本次文件里实际带来的音频文件。

### package.json 结构

```json
{
    "schemaVersion": 1,
    "packageType": "full",
    "packageId": "library-full-2026-08-01",
    "libraryId": "tyicc-bgm-library",
    "libraryName": "TYICC 午间悦听背景音乐库",
    "libraryVersion": "2026.08.01",
    "baseLibraryVersion": null,
    "libraryDescription": "适合开场、转场、结语的背景音乐集合",
    "description": "导入后将完整覆盖旧音乐库",
    "minAppVersion": "3.0.0",
    "contributors": [
        { "name": "王五", "role": "维护" }
    ],
    "generator": {
        "name": "TYICC午间悦听制作器",
        "version": "3.0.0"
    },
    "generatedAt": "2026-07-27T12:00:00.000Z",
    "operations": [
        {
            "action": "upsertTrack",
            "id": "bridge_theme_01",
            "file": "files/bridge_theme.wav",
            "title": "Bridge Theme",
            "artist": "TYICC",
            "description": "适合转场口播",
            "tags": ["转场", "稳重"],
            "sortOrder": 210
        }
    ]
}
```

说明：

- `libraryId` / `libraryName` / `libraryDescription`：用于完整描述该文件属于哪一个音乐库。
- `minAppVersion`：用于约束低版本程序不要误导入高版本文件。
- `generator` / `generatedAt`：由程序内置“音乐库管理”功能自动补充，便于追踪来源。

### packageType 字段说明

- `full`：当前唯一支持的类型，导入时会先清空旧曲库，再按该文件重建。

### operations 语义

- `upsertTrack`：新增或覆盖同 `id` 的曲目。

## 当前已实现的音乐库功能

当前版本已经实现：

- 在开场语、转场、结语的背景音乐区域中，提供“从自带音乐库中选择音乐”。
- 打开音乐库列表后，每首音乐按行展示：名称、播放条、右侧“选择”按钮。
- 可搜索名称 / 作者 / 标签。
- 音乐库导入入口位于“设置 > 存储 > 导入音乐库”。
- 导入后自动更新 `library.json`，并写入版本、贡献者、曲目索引、已应用包历史。
- 程序右上角提供三个图标按钮：设置、高级功能、贡献者。
- 高级功能中目前包含“音乐库管理”。
- 音乐库管理页面会以全屏工作界面覆盖原页面，支持填写库信息、贡献者、曲目元信息，并在用户自行选择导出位置后生成音乐库文件。

## 维护者后续打包建议

为了后续支持“自行打包”和标准化分发，建议遵循以下约束：

- 曲目 `id` 一经发布后不要随意改名；如果音乐内容变了，可以保留同一个 `id` 走 `upsertTrack`。
- `libraryVersion` 建议独立于应用版本，例如使用日期版：`2026.08.01`。
- 每次发布都生成完整音乐库文件，避免差分依赖链。
- `files/` 内文件名可读即可，但真正的稳定标识应始终是 `operations[].id`。

## 本仓库中的样例文件

为方便维护，本仓库建议保留这些样例：

- `resources/music-library/library.json`：示例音乐库清单。
- `resources/music-library/package-template.json`：示例音乐库文件描述模板。

它们是维护说明样例，不作为唯一运行时数据源；真正运行时数据位于 `usrdata/music-library/`。