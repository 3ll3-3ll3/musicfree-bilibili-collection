# MusicFree Bilibili Collection Plugin

一个用于 MusicFree 的 Bilibili 合集/系列/收藏夹批量导入插件。

当前版本：`v0.2.1`

## 功能

- 支持新版 B 站空间合集：

```text
https://space.bilibili.com/<mid>/lists/<season_id>?type=season
```

- 支持 B 站空间系列：

```text
https://space.bilibili.com/<mid>/lists/<series_id>?type=series
```

- 兼容公开收藏夹 URL、`fid=`、`/playlist/pl...`、`/list/ml...` 和数字收藏夹 ID。
- 支持一次粘贴多个歌单链接，每行一个，自动识别后合并导入。
- 自动去重。
- 自动分页读取较大的合集/系列/收藏夹。
- 自动识别多P视频并展开：每个分P作为一首独立歌曲导入。
- 多P展开后保持“外层歌单顺序 + P1/P2/P3...”原始顺序。
- 多P歌曲使用 `bvid + cid` 作为优先唯一标识，避免同一个多P视频里的歌曲互相误删。
- 单个视频的多P检查失败时保留原视频，不影响其他歌单继续导入。
- 支持通过 `srcUrl` 在 MusicFree 插件管理中直接更新后续版本。

## 在线安装 / 更新地址

```text
https://raw.githubusercontent.com/3ll3-3ll3/musicfree-bilibili-collection/main/musicfree_bilibili_collection.js
```

首次安装时使用上面的 Raw 地址。后续版本仍使用同一地址，插件内已设置 `srcUrl`，可在 MusicFree 插件管理中执行更新。

## 批量导入示例

在 MusicFree 的“导入歌单”输入框中可以直接粘贴：

```text
https://space.bilibili.com/33114953/lists/5469118?type=season
https://space.bilibili.com/xxxx/lists/xxxx?type=season
https://space.bilibili.com/xxxx/lists/xxxx?type=series
```

每行一个即可。

## 多P / 嵌套歌曲处理

例如 B 站外层合集包含一个视频：

```text
2026年热门歌曲TOP100
├─ P1 雨过后的风景
├─ P2 交给时间斑驳
├─ P3 一样的月光
└─ ...
```

v0.2.1 会在导入时自动展开为：

```text
雨过后的风景
交给时间斑驳
一样的月光
...
```

每个分P都保留独立 `cid`，因此播放时会定位到正确分P。

## v0.2.1 更新内容

- 新增自动多P检查与展开。
- 新增限并发检查，默认并发数为 3，降低大量视频导入时的请求压力。
- 多P去重键改为 `bvid + cid`。
- 保留原有批量多链接导入能力。
- 多P展开失败采用降级策略：保留原视频继续导入。
- 继续使用固定 Raw `srcUrl`，支持软件内更新。

## 说明

本项目用于方便个人整理公开 Bilibili 内容到 MusicFree。请遵守相关平台规则和版权要求。
