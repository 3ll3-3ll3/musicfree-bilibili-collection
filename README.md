# MusicFree Bilibili Collection Plugin

一个用于 MusicFree / MusicFree Desktop 的 Bilibili 合集导入插件。

## 当前版本

`v0.2.2`

## 功能

- 支持新版 B 站空间合集：`/lists/<id>?type=season`
- 支持 B 站空间系列：`/lists/<id>?type=series`
- 兼容公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID
- 支持一次粘贴多个歌单链接，一行一个，自动识别、合并并去重
- 自动识别多P视频，并将每个分P展开成独立歌曲
- 保持外层合集顺序和多P内部顺序
- 多P去重优先使用 `bvid + cid`
- 单个视频检查失败时保留原视频，不影响其他内容

## 推荐在线安装 / 更新地址

为避免部分网络环境访问 `raw.githubusercontent.com` 超时，从 v0.2.2 起推荐使用 jsDelivr CDN：

```text
https://cdn.jsdelivr.net/gh/3ll3-3ll3/musicfree-bilibili-collection@main/musicfree_bilibili_collection.js
```

插件内部 `srcUrl` 也已经切换到这个地址，因此通过该版本安装一次后，后续可以直接在 MusicFree 内进行插件更新。

## 旧 GitHub Raw 地址

```text
https://raw.githubusercontent.com/3ll3-3ll3/musicfree-bilibili-collection/main/musicfree_bilibili_collection.js
```

如果当前网络访问 GitHub Raw 较慢，请不要使用这个地址安装或更新。

## 批量导入示例

```text
https://space.bilibili.com/33114953/lists/5469118?type=season
https://space.bilibili.com/xxxx/lists/xxxx?type=season
https://space.bilibili.com/xxxx/lists/xxxx?type=series
```

## 多P处理

例如一个外层合集里存在“2026年热门歌曲TOP100”这种多P视频，插件会自动展开为：

```text
雨过后的风景
交给时间斑驳
一样的月光
人生路漫漫
...
```

每个分P保留自己的 `cid`，因此可以作为独立歌曲播放。

## 说明

本项目用于方便个人整理公开 Bilibili 内容到 MusicFree。请遵守相关平台规则和版权要求。
