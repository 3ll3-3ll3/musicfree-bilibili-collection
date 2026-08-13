# MusicFree Bilibili Collection Plugin

用于 MusicFree / MusicFree Desktop 的 Bilibili 合集导入插件，并提供面向 Cotton Music 的音频规范化工具。

## 当前版本

`v0.4.0`

## v0.4.0 核心变化

- 默认音质策略改为 `best`：**原生 FLAC > 普通 DASH 中最高码率 AAC**。
- 不再因为 MusicFreeDesktop 默认 `standard` 而自动选中间码率；只有 `audioPolicy=follow` 才跟随 MusicFree 的 low / standard / high / super。
- playurl 请求使用 `qn=127 + fnval=4048 + fourk=1`，读取普通音轨、`dash.flac.audio` 与 `dash.dolby.audio`。
- 普通 AAC 继续保存为 Cotton Music 友好的 `.m4a` 文件名。
- FLAC / Dolby 不会通过“改扩展名”伪装成 `.flac`，仓库新增 `tools/cotton-normalizer.ps1`，使用 FFmpeg `-c:a copy` 真正无损抽取/封装。
- 可选填写 B站 Cookie，使插件能够使用账号本身有权访问的音质/内容。

## 原有功能

- 支持新版 B站空间合集：`/lists/<id>?type=season`
- 支持 B站空间系列：`/lists/<id>?type=series`
- 兼容公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID
- 一次粘贴多个歌单链接，一行一个，自动识别、合并并去重
- 自动识别多P视频，并把每个分P展开为独立歌曲
- 保持外层合集顺序和多P内部顺序
- 多P去重优先使用 `bvid + cid`
- 单个视频检查失败时保留原视频，不影响其他内容

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

可选。粘贴浏览器当前 B站 Cookie。Cookie 属于敏感信息，不要发到 Issue、截图或公开聊天中。

### `audioPolicy`

默认：

```text
best
```

可选值：

```text
best    原生 FLAC > 最高 AAC（推荐）
aac     永远选普通 DASH 中最高 AAC
follow  跟随 MusicFree 的 low / standard / high / super
dolby   Dolby 优先，失败后回退 FLAC / AAC
```

对于 Cotton Music，建议使用 `best` 或 `aac`。Dolby 不作为默认值，因为多声道/编码兼容性通常不如 AAC / FLAC 稳定。

### `downloadExtMode`

默认：

```text
auto
```

`auto` 时 AAC 会给 MusicFreeDesktop 一个 `.m4a` 文件名；FLAC / Dolby 保留其实际 DASH 分段容器，随后由 Cotton Normalizer 处理。

如需完全保留 B站 CDN 原始 URL 后缀：

```text
raw
```

## 为什么之前下载只有 2～3 MB

MusicFreeDesktop 默认下载音质是 `standard`。旧版插件把 B站普通 `dash.audio` 按码率排序后直接对应 low / standard / high / super，因此默认经常只拿到约 96～128 kbps 的 AAC。

v0.4.0 的 `best` / `aac` 不再受这个默认值限制，会直接选普通 AAC 的最高可用码率；若账号和视频提供原生 FLAC，`best` 会优先 FLAC。

注意：B站普通 DASH 的最高 AAC 本身常常仍低于一些音乐平台提供的 320 kbps MP3/AAC，因此文件大小不一定达到 10 MB。文件大小不是音质等级本身，真正应查看 codec、bitrate、sample rate 等信息。

## Cotton Normalizer

脚本：

```text
tools/cotton-normalizer.ps1
```

依赖：`ffmpeg` 与 `ffprobe` 已加入 PATH。

### 只检查下载文件真实音质

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cotton-normalizer.ps1 -InputPath "D:\MusicFreeDownloads" -ReportOnly
```

输出示例：

```text
歌曲.m4a | codec=aac | bitrate=192 kbps | 48 kHz | ch=2 | container=mov,mp4,m4a,3gp,3g2,mj2
```

### 一次性规范化

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cotton-normalizer.ps1 -InputPath "D:\MusicFreeDownloads"
```

处理逻辑：

```text
AAC/fMP4  -> M4A   (-c:a copy)
FLAC/fMP4 -> FLAC  (-c:a copy)
ALAC      -> M4A   (-c:a copy)
MP3       -> MP3   (-c:a copy)
Opus      -> OPUS  (-c:a copy)
```

不会把 AAC 转成 FLAC，也不会为了“看起来无损”重新编码。

默认不删除源文件；确认结果正常后，如需删除源文件：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cotton-normalizer.ps1 -InputPath "D:\MusicFreeDownloads" -DeleteSource
```

### 实时监听 MusicFree 下载目录

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\cotton-normalizer.ps1 -InputPath "D:\MusicFreeDownloads" -Watch -DeleteSource
```

这样 MusicFree 下载完新的 `.m4s` / `.mp4` / `.aac` 后，脚本会等待文件大小稳定，再通过 ffprobe 判断真实 codec，并使用 FFmpeg 无损封装为 Cotton Music 更适合扫描的格式。

按 `Ctrl+C` 停止监听。

## 推荐工作流

```text
B站合集 / 系列 / 收藏夹
        ↓
MusicFree Bilibili v0.4
        ↓
默认 best：FLAC > 最高 AAC
        ↓
MusicFreeDesktop 下载
        ↓
Cotton Normalizer（FLAC/分段容器需要）
        ↓
M4A / FLAC
        ↓
Cotton Music / AList / WebDAV
```

如果只想最省事、最稳定：设置 `audioPolicy=aac`，得到最高普通 AAC + `.m4a`，通常无需额外处理。

如果优先音质：保持默认 `audioPolicy=best`，并运行 Cotton Normalizer。

## 批量导入示例

```text
https://space.bilibili.com/33114953/lists/5469118?type=season
https://space.bilibili.com/xxxx/lists/xxxx?type=season
https://space.bilibili.com/xxxx/lists/xxxx?type=series
```

## 说明

本项目用于个人整理自己有权访问的 Bilibili 内容。请遵守 Bilibili 规则及相关版权要求。
