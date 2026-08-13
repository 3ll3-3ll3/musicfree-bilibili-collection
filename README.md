# MusicFree Bilibili Collection Plugin

用于 MusicFree / MusicFree Desktop 的 Bilibili 合集导入插件，并针对 Cotton Music 做音频格式与下载流程优化。

## 当前版本

`v0.5.0`

## 当前核心功能

- 支持新版 B站空间合集：`/lists/<id>?type=season`
- 支持 B站空间系列：`/lists/<id>?type=series`
- 兼容公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID
- 支持一次粘贴多个歌单链接，一行一个，自动识别、合并并去重
- 自动识别多P视频，并将每个分P展开成独立歌曲
- 保持外层合集顺序和多P内部顺序
- 多P去重优先使用 `bvid + cid`
- 可选 B站 Cookie，用于账号本身有权访问的内容/音质

## v0.5.0：四档音质

插件直接使用 MusicFree 原生的四个质量键，不再依赖额外 `audioPolicy` 设置：

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

不需要进入设置切换默认音质，也不需要独立的“音质检查”步骤。

## 推荐安装 / 更新地址

```text
https://cdn.jsdelivr.net/gh/3ll3-3ll3/musicfree-bilibili-collection@main/musicfree_bilibili_collection.js
```

备用 GitHub Raw：

```text
https://raw.githubusercontent.com/3ll3-3ll3/musicfree-bilibili-collection/main/musicfree_bilibili_collection.js
```

## 插件用户变量

### `biliCookie`

可选。用于账号本身有权访问的更高音质或受限内容。Cookie 属于敏感信息，不要发到公开 Issue、截图或聊天中。

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
MusicFree Bilibili v0.5
        ↓
每次下载直接选择 4 档音质
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
