# MusicFree Bilibili Collection Plugin

用于 MusicFree / MusicFree Desktop 的 Bilibili 合集导入插件，并针对 Cotton Music 做音频格式与下载流程优化。

## 当前版本

`v0.5.2`

## 当前核心功能

- 支持新版 B站空间合集：`/lists/<id>?type=season`
- 支持 B站空间系列：`/lists/<id>?type=series`
- 兼容公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID
- 支持一次粘贴多个歌单链接，一行一个，自动识别、合并并去重
- 自动识别多P视频，并将每个分P展开成独立歌曲
- 保持外层合集顺序和多P内部顺序
- 多P去重优先使用 `bvid + cid`
- 可选 B站 Cookie，用于账号本身有权访问的内容/音质
- 支持按分钟设置最大音频时长，自动过滤超长内容

## v0.5.2：可配置时长过滤

插件用户变量新增：

```text
maxDurationMinutes
```

单位为分钟。例如：

```text
30
```

表示只保留 **不超过 30 分钟** 的音频，超过 30 分钟的内容不会进入导入结果，也不会被下载。

```text
60
```

表示过滤超过 60 分钟的音频。

```text
0
```

或者留空，表示不限制时长。

支持小数，例如 `30.5` 表示 30.5 分钟。

### 多P视频的处理

多P视频先拆分，再按照每个分P自己的时长判断。

例如一个总长 90 分钟的视频有 3 个分P：

```text
P1 = 25min
P2 = 35min
P3 = 30min
```

当 `maxDurationMinutes=30` 时，最终保留：

```text
P1
P3
```

P2 会被过滤。不会因为整个视频总长 90 分钟而把全部分P一起删除。

### 双重保护

时长限制不只在导入时执行。

插件在真正获取下载音源前还会再次检查时长，因此即使某首超长歌曲是旧版本插件已经导入到 MusicFree 中的，只要当前设置了时长上限，也会阻止它继续下载。

## 四档音质

插件直接使用 MusicFree 原生的四个质量键：

```text
low      省流 AAC：优先 B站 30216，通常约 64K
standard 标准 AAC：优先 B站 30232，通常约 128/132K
high     高音质 AAC：优先 B站 30280 / 最高普通 AAC，通常约 192K
super    无损优先：存在原生 FLAC 就选 FLAC，否则回退最高 AAC
```

`super` 不会把 AAC 伪装成 FLAC。

普通 AAC 会保存为 Cotton Music 更友好的 `.m4a` 文件名；B站原生 FLAC 仍可能位于 DASH/fMP4 分段容器中，因此交给 `tools/cotton-normalizer.ps1` 使用 FFmpeg `-c:a copy` 无损抽取。

## 每次下载直接选择音质

MusicFreeDesktop 当前官方代码的下载按钮会直接读取全局 `download.defaultQuality`，没有在每次点击下载时询问音质。

本仓库提供补丁：

```text
patches/musicfree-desktop-per-download-quality.patch
```

补丁后的交互：

```text
单曲：点击下载图标
      ↓
      省流 AAC（约 64K）
      标准 AAC（约 128K）
      高音质 AAC（约 192K）
      无损优先（FLAC / 最高 AAC）

批量：选中多首 → 右键 → 下载 ▶ 四档音质
```

## 推荐安装 / 更新地址

推荐直接使用 GitHub Raw，避免 CDN `@main` 缓存造成软件内插件版本滞后：

```text
https://raw.githubusercontent.com/3ll3-3ll3/musicfree-bilibili-collection/main/musicfree_bilibili_collection.js
```

jsDelivr 可作为备用：

```text
https://cdn.jsdelivr.net/gh/3ll3-3ll3/musicfree-bilibili-collection@main/musicfree_bilibili_collection.js
```

插件内部 `srcUrl` 已使用 GitHub Raw，因此安装新版一次后，MusicFreeDesktop 后续“更新插件”也会从 Raw 地址获取。

## 插件用户变量

### `biliCookie`

可选。用于账号本身有权访问的更高音质或受限内容。Cookie 属于敏感信息，不要发到公开 Issue、截图或聊天中。

### `maxDurationMinutes`

最大允许音频时长，单位：分钟。

示例：

```text
30
60
90
```

`0` 或留空表示关闭时长过滤。

判断规则为“超过才过滤”，因此设置 `30` 时，正好 30:00 的音频允许保留，30:01 会被过滤。

### `downloadExtMode`

默认：

```text
auto
```

普通 AAC 会给 MusicFreeDesktop 一个 `.m4a` 文件名。

如果需要完全保留 B站 CDN 原始 URL 后缀：

```text
raw
```

## Cotton Normalizer

脚本：

```text
tools/cotton-normalizer.ps1
```

依赖：`ffmpeg` 与 `ffprobe` 已加入 PATH。

一次性规范化：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cotton-normalizer.ps1 -InputPath "D:\MusicFreeDownloads"
```

实时监听：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cotton-normalizer.ps1 -InputPath "D:\MusicFreeDownloads" -Watch -DeleteSource
```

处理原则：

```text
AAC/fMP4  -> M4A   (-c:a copy)
FLAC/fMP4 -> FLAC  (-c:a copy)
ALAC      -> M4A   (-c:a copy)
MP3       -> MP3   (-c:a copy)
Opus      -> OPUS  (-c:a copy)
```

不会为了“看起来无损”而重新编码。

## 推荐工作流

```text
B站合集 / 系列 / 收藏夹
        ↓
MusicFree Bilibili v0.5.2
        ↓
按 maxDurationMinutes 过滤超长音频
        ↓
选择下载音质
        ↓
AAC -> M4A
FLAC DASH -> Cotton Normalizer
        ↓
M4A / FLAC
        ↓
Cotton Music / AList / WebDAV
```

## 说明

本项目用于个人整理自己有权访问的 Bilibili 内容。请遵守 Bilibili 规则及相关版权要求。
