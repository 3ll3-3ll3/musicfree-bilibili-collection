"use strict";

/**
 * MusicFree Bilibili 合集批量导入插件 - Cotton Music optimized
 *
 * v0.4.0
 * - 新版空间合集 / 系列 / 收藏夹 / 多链接合并 / 多P展开
 * - playurl 请求升级到 fnval=4048，读取 regular / FLAC / Dolby 音轨
 * - 默认 best 策略：原生 FLAC > 最高码率 AAC；不把 AAC 伪装成 FLAC
 * - AAC 下载保持 Cotton 友好的 .m4a 文件名
 * - FLAC / Dolby 保留分段容器后缀，交给仓库内 Cotton Normalizer 无损抽取/封装
 * - 可选 B 站 Cookie
 */

const axios = require("axios");

const BASE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const EXPAND_CONCURRENCY = 3;

function getUserVariables() {
  try {
    if (typeof env !== "undefined" && env?.getUserVariables) {
      return env.getUserVariables() || {};
    }
  } catch (_) {}
  return {};
}

function buildHeaders(extra) {
  const vars = getUserVariables();
  const cookie = String(vars.biliCookie || "").trim();
  return {
    ...BASE_HEADERS,
    ...(cookie ? { cookie } : {}),
    ...(extra || {}),
  };
}

function durationToSec(duration) {
  if (typeof duration === "number") return duration;
  if (typeof duration === "string") {
    return duration.split(":").reduce((prev, curr) => 60 * prev + Number(curr), 0);
  }
  return 0;
}

function cleanInputToken(value) {
  return String(value || "")
    .trim()
    .replace(/[，。；;、）)\]}>》」』]+$/g, "");
}

function parseImportEntries(urlLike) {
  const lines = String(urlLike || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const urls = line.match(/https?:\/\/[^\s]+/gi);
    if (urls?.length) {
      for (const url of urls) {
        const cleaned = cleanInputToken(url);
        if (cleaned) entries.push(cleaned);
      }
    } else {
      const cleaned = cleanInputToken(line);
      if (cleaned) entries.push(cleaned);
    }
  }
  return [...new Set(entries)];
}

function getMediaDedupeKey(item) {
  if (item?.bvid && item?.cid != null) return `bvid:${item.bvid}:cid:${item.cid}`;
  if (item?.aid != null && item?.cid != null) return `aid:${item.aid}:cid:${item.cid}`;
  if (item?.bvid) return `bvid:${item.bvid}`;
  if (item?.aid != null) return `aid:${item.aid}`;
  if (item?.cid != null) return `cid:${item.cid}`;
  if (item?.id != null) return `id:${item.id}`;
  return `${item?.title || ""}|${item?.artist || ""}|${item?.duration || ""}`;
}

function dedupeMediaItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = getMediaDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }
  const runnerCount = Math.min(
    Math.max(1, concurrency || 1),
    Math.max(1, items.length)
  );
  await Promise.all(Array.from({ length: runnerCount }, () => runner()));
  return results;
}

async function getCid(bvid, aid) {
  const params = bvid ? { bvid } : { aid };
  const res = (
    await axios.get("https://api.bilibili.com/x/web-interface/view", {
      headers: buildHeaders(),
      params,
    })
  ).data;
  if (res.code !== 0 || !res.data) {
    throw new Error(`Bilibili 获取视频信息失败：${res.message || res.code}`);
  }
  return res;
}

async function getUploaderName(mid, referer) {
  try {
    const res = (
      await axios.get("https://api.bilibili.com/x/web-interface/card", {
        headers: buildHeaders({ referer: referer || `https://space.bilibili.com/${mid}` }),
        params: { mid },
      })
    ).data;
    return res?.data?.card?.name || "Bilibili";
  } catch (_) {
    return "Bilibili";
  }
}

async function getFavoriteList(id) {
  const result = [];
  const pageSize = 20;
  let page = 1;
  while (true) {
    const res = (
      await axios.get("https://api.bilibili.com/x/v3/fav/resource/list", {
        headers: buildHeaders(),
        params: { media_id: id, platform: "web", ps: pageSize, pn: page },
      })
    ).data;
    if (res.code !== 0 || !res.data) {
      throw new Error(`Bilibili 收藏夹读取失败：${res.message || res.code}`);
    }
    const medias = res.data.medias || [];
    result.push(...medias);
    if (!res.data.has_more) break;
    page += 1;
  }
  return result.map((item) => ({
    id: item.id ?? item.bvid ?? item.aid,
    aid: item.aid,
    bvid: item.bvid,
    artwork: item.cover,
    title: item.title,
    artist: item.upper?.name || "Bilibili",
    album: item.bvid ?? item.aid,
    duration: durationToSec(item.duration),
  }));
}

async function getSeasonList(mid, seasonId, sourceUrl) {
  const result = [];
  const pageSize = 30;
  let page = 1;
  let total = Infinity;
  let meta = null;
  while (result.length < total) {
    const res = (
      await axios.get("https://api.bilibili.com/x/polymer/web-space/seasons_archives_list", {
        headers: buildHeaders({ referer: sourceUrl }),
        params: { mid, season_id: seasonId, page_num: page, page_size: pageSize },
      })
    ).data;
    if (res.code !== 0 || !res.data) {
      throw new Error(`Bilibili 合集读取失败：${res.message || res.code}`);
    }
    const data = res.data;
    meta = meta || data.meta || {};
    const archives = data.archives || [];
    result.push(...archives);
    total = data.page?.total ?? meta.total ?? result.length;
    if (!archives.length || result.length >= total) break;
    page += 1;
  }
  const uploader = await getUploaderName(mid, sourceUrl);
  const albumName = meta?.name || `Bilibili 合集 ${seasonId}`;
  return result.map((item) => ({
    id: item.bvid ?? item.aid,
    aid: item.aid,
    bvid: item.bvid,
    artwork: item.pic,
    title: item.title,
    artist: uploader,
    album: albumName,
    duration: durationToSec(item.duration),
    date: item.pubdate ? new Date(item.pubdate * 1000).toISOString().slice(0, 10) : undefined,
  }));
}

async function getSeriesList(mid, seriesId, sourceUrl) {
  const result = [];
  const pageSize = 30;
  let page = 1;
  let total = Infinity;
  let seriesName = `Bilibili 列表 ${seriesId}`;
  try {
    const info = (
      await axios.get("https://api.bilibili.com/x/series/series", {
        headers: buildHeaders({ referer: sourceUrl }),
        params: { series_id: seriesId },
      })
    ).data;
    seriesName = info?.data?.meta?.name || seriesName;
  } catch (_) {}
  while (result.length < total) {
    const res = (
      await axios.get("https://api.bilibili.com/x/series/archives", {
        headers: buildHeaders({ referer: sourceUrl }),
        params: { mid, series_id: seriesId, pn: page, ps: pageSize },
      })
    ).data;
    if (res.code !== 0 || !res.data) {
      throw new Error(`Bilibili 列表读取失败：${res.message || res.code}`);
    }
    const archives = res.data.archives || [];
    result.push(...archives);
    total = res.data.page?.total ?? result.length;
    if (!archives.length || result.length >= total) break;
    page += 1;
  }
  const uploader = await getUploaderName(mid, sourceUrl);
  return result.map((item) => ({
    id: item.bvid ?? item.aid,
    aid: item.aid,
    bvid: item.bvid,
    artwork: item.pic,
    title: item.title,
    artist: uploader,
    album: seriesName,
    duration: durationToSec(item.duration),
    date: item.pubdate ? new Date(item.pubdate * 1000).toISOString().slice(0, 10) : undefined,
  }));
}

function buildExpandedAlbumName(item) {
  const parentAlbum = item?.album;
  const parentTitle = item?.title || "多P视频";
  if (
    parentAlbum &&
    parentAlbum !== item?.bvid &&
    String(parentAlbum) !== String(item?.aid)
  ) {
    return `${parentAlbum} / ${parentTitle}`;
  }
  return parentTitle;
}

async function expandMediaItem(item) {
  if (!item?.bvid && item?.aid == null) return [item];
  if (item?.cid != null && item?._expandedMultiPage) return [item];
  try {
    const cidRes = await getCid(item.bvid, item.aid);
    const data = cidRes?.data || {};
    const pages = Array.isArray(data.pages) ? data.pages : [];
    if (pages.length <= 1) {
      const onlyPage = pages[0];
      return [{
        ...item,
        cid: item.cid ?? data.cid ?? onlyPage?.cid,
        duration: item.duration || durationToSec(onlyPage?.duration) || durationToSec(data.duration),
      }];
    }
    const expandedAlbum = buildExpandedAlbumName(item);
    return pages.map((page, index) => ({
      ...item,
      id: `${item.bvid ?? item.aid}:${page.cid}`,
      cid: page.cid,
      title: page.part || `${item.title || "多P视频"} P${page.page ?? index + 1}`,
      album: expandedAlbum,
      duration: durationToSec(page.duration),
      page: page.page ?? index + 1,
      parentTitle: item.title,
      _expandedMultiPage: true,
    }));
  } catch (error) {
    console.warn(`[bilibili合集] 多P检查失败，保留原视频：${item?.title || item?.bvid || item?.aid}`, error);
    return [item];
  }
}

async function expandImportedMediaItems(items) {
  const expandedGroups = await mapWithConcurrency(items || [], EXPAND_CONCURRENCY, expandMediaItem);
  const flattened = [];
  for (const group of expandedGroups) {
    if (Array.isArray(group)) flattened.push(...group);
  }
  return flattened;
}

async function importSingleMusicSheet(input) {
  const listMatch = input.match(/space\.bilibili\.com\/(\d+)\/lists\/(\d+)/i);
  if (listMatch) {
    const mid = listMatch[1];
    const listId = listMatch[2];
    const isSeries = /[?&]type=series(?:[&#]|$)/i.test(input);
    return isSeries
      ? await getSeriesList(mid, listId, input)
      : await getSeasonList(mid, listId, input);
  }
  let id;
  if (!id) id = input.match(/^\s*(\d+)\s*$/)?.[1];
  if (!id) id = input.match(/^(?:.*)fid=(\d+).*$/)?.[1];
  if (!id) id = input.match(/\/playlist\/pl(\d+)/i)?.[1];
  if (!id) id = input.match(/\/list\/ml(\d+)/i)?.[1];
  if (id) return await getFavoriteList(id);
  throw new Error("无法识别该链接或歌单 ID");
}

async function importMusicSheet(urlLike) {
  const entries = parseImportEntries(urlLike);
  if (!entries.length) throw new Error("请输入至少一个 Bilibili 歌单/合集链接");
  const merged = [];
  const failed = [];
  for (const entry of entries) {
    try {
      const items = await importSingleMusicSheet(entry);
      if (Array.isArray(items)) merged.push(...items);
    } catch (error) {
      const message = error?.message || String(error);
      failed.push(`${entry} -> ${message}`);
      console.warn(`[bilibili合集] 导入失败：${entry}`, error);
    }
  }
  if (!merged.length) {
    const detail = failed.length ? `\n${failed.join("\n")}` : "";
    throw new Error(`没有成功导入任何歌单。${detail}`);
  }
  const expanded = await expandImportedMediaItems(merged);
  const result = dedupeMediaItems(expanded);
  if (!result.length) {
    const detail = failed.length ? `\n${failed.join("\n")}` : "";
    throw new Error(`没有成功生成任何歌曲。${detail}`);
  }
  if (failed.length) {
    console.warn(`[bilibili合集] ${entries.length} 个输入中有 ${failed.length} 个导入失败：\n${failed.join("\n")}`);
  }
  return result;
}

function trackUrl(track) {
  return track?.baseUrl || track?.base_url || track?.url || track?.backupUrl?.[0] || track?.backup_url?.[0];
}

function asTrackList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function sortHighestFirst(tracks) {
  return [...tracks].sort((a, b) => {
    const bw = (b?.bandwidth || 0) - (a?.bandwidth || 0);
    if (bw) return bw;
    return (b?.id || 0) - (a?.id || 0);
  });
}

function getAudioPolicy() {
  const vars = getUserVariables();
  const value = String(vars.audioPolicy || "best").trim().toLowerCase();
  if (["best", "aac", "follow", "dolby"].includes(value)) return value;
  return "best";
}

function pickRegularAudio(audios, quality, followMusicFree) {
  const usable = sortHighestFirst(
    asTrackList(audios).filter((track) => !!trackUrl(track))
  );
  if (!usable.length) return null;
  if (!followMusicFree) return usable[0];

  // 只有显式 audioPolicy=follow 时才沿用 MusicFree low/standard/high/super 分档。
  // 默认 best 不再受 MusicFreeDesktop 的 standard 默认值限制。
  const ascending = [...usable].reverse();
  const qualityIndex = { low: 0, standard: 1, high: 2, super: 3 };
  const wanted = qualityIndex[quality] ?? ascending.length - 1;
  return ascending[Math.min(wanted, ascending.length - 1)] || ascending[0];
}

function pickAudioSource(dash, quality) {
  const policy = getAudioPolicy();
  const flac = asTrackList(dash?.flac?.audio).filter((track) => !!trackUrl(track));
  const dolby = asTrackList(dash?.dolby?.audio).filter((track) => !!trackUrl(track));
  const regular = asTrackList(dash?.audio).filter((track) => !!trackUrl(track));

  if (policy === "dolby") {
    const track = sortHighestFirst(dolby)[0] || sortHighestFirst(flac)[0] || pickRegularAudio(regular, quality, false);
    if (!track) return null;
    const kind = dolby.includes(track) ? "dolby" : flac.includes(track) ? "flac" : "aac";
    return { track, kind };
  }

  if (policy === "best") {
    // Cotton Music 场景优先真正无损 FLAC；Dolby 不默认选择，避免多声道/编码兼容问题。
    const lossless = sortHighestFirst(flac)[0];
    if (lossless) return { track: lossless, kind: "flac" };
    const aac = pickRegularAudio(regular, quality, false);
    if (aac) return { track: aac, kind: "aac" };
    const fallbackDolby = sortHighestFirst(dolby)[0];
    return fallbackDolby ? { track: fallbackDolby, kind: "dolby" } : null;
  }

  if (policy === "aac") {
    const aac = pickRegularAudio(regular, quality, false);
    return aac ? { track: aac, kind: "aac" } : null;
  }

  const followed = pickRegularAudio(regular, quality, true);
  if (followed) return { track: followed, kind: "aac" };
  const lossless = sortHighestFirst(flac)[0];
  return lossless ? { track: lossless, kind: "flac" } : null;
}

function addDownloadExtensionHint(url, ext) {
  const vars = getUserVariables();
  const mode = String(vars.downloadExtMode || "auto").trim().toLowerCase();
  if (mode === "raw" || mode === "off" || mode === "关闭") return url;
  if (!ext) return url;
  try {
    const parsed = new URL(url);
    // fragment 不会发送给 CDN，但 MusicFreeDesktop 会从完整 URL 猜下载扩展名。
    parsed.hash = `.${ext}`;
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

async function getPlayurlData(musicItem, cid) {
  const videoParams = musicItem.bvid
    ? { bvid: musicItem.bvid }
    : { aid: musicItem.aid };

  return (
    await axios.get("https://api.bilibili.com/x/player/playurl", {
      headers: buildHeaders({
        referer: `https://www.bilibili.com/video/${musicItem.bvid ?? musicItem.aid ?? ""}`,
      }),
      params: {
        ...videoParams,
        cid,
        qn: 127,
        fnval: 4048,
        fnver: 0,
        fourk: 1,
      },
    })
  ).data;
}

async function getMediaSource(musicItem, quality) {
  let cid = musicItem.cid;
  if (!cid) cid = (await getCid(musicItem.bvid, musicItem.aid)).data.cid;

  const res = await getPlayurlData(musicItem, cid);
  if (res.code !== 0 || !res.data) {
    throw new Error(`Bilibili 音频地址获取失败：${res.message || res.code}`);
  }

  let rawUrl;
  let kind = "unknown";
  if (res.data?.dash) {
    const selected = pickAudioSource(res.data.dash, quality);
    if (selected) {
      rawUrl = trackUrl(selected.track);
      kind = selected.kind;
    }
  } else if (res.data?.durl?.length) {
    rawUrl = res.data.durl[0].url;
  }
  if (!rawUrl) throw new Error("Bilibili 没有返回可播放的音频地址");

  const parsed = new URL(rawUrl);
  // AAC 可以直接给 MusicFree 一个 m4a 文件名；FLAC/Dolby 仍是 DASH 分段容器，
  // 不伪装成 .flac，交给 tools/cotton-normalizer.ps1 用 ffmpeg -c copy 真正抽取。
  const outputExt = kind === "aac" ? "m4a" : null;
  const finalUrl = addDownloadExtensionHint(rawUrl, outputExt);

  return {
    url: finalUrl,
    headers: {
      ...BASE_HEADERS,
      host: parsed.host,
      connection: "keep-alive",
      referer: `https://www.bilibili.com/video/${musicItem.bvid ?? musicItem.aid ?? ""}`,
    },
  };
}

async function getAlbumInfo(albumItem) {
  if (albumItem?.cid != null && albumItem?._expandedMultiPage) {
    return { musicList: [albumItem] };
  }
  const cidRes = await getCid(albumItem.bvid, albumItem.aid);
  const data = cidRes?.data || {};
  const pages = data.pages || [];
  if (pages.length <= 1) {
    return {
      musicList: [{ ...albumItem, cid: albumItem.cid ?? data.cid ?? pages[0]?.cid }],
    };
  }
  return {
    musicList: pages.map((item, index) => ({
      ...albumItem,
      cid: item.cid,
      id: `${albumItem.bvid ?? albumItem.aid}:${item.cid}`,
      title: item.part,
      album: buildExpandedAlbumName(albumItem),
      duration: durationToSec(item.duration),
      page: item.page ?? index + 1,
      parentTitle: albumItem.title,
      _expandedMultiPage: true,
    })),
  };
}

module.exports = {
  platform: "bilibili合集",
  appVersion: ">=0.0",
  version: "0.4.0",
  author: "3ll3-3ll3",
  description: "Bilibili 合集/系列批量导入；默认原生 FLAC > 最高 AAC，并为 Cotton Music 提供无损规范化流程",
  srcUrl:
    "https://cdn.jsdelivr.net/gh/3ll3-3ll3/musicfree-bilibili-collection@main/musicfree_bilibili_collection.js",
  cacheControl: "no-cache",
  primaryKey: ["id", "aid", "bvid", "cid"],
  userVariables: [
    {
      key: "biliCookie",
      name: "B站 Cookie（可选；用于账号本身可访问的高音质/受限内容）",
      type: "password",
    },
    {
      key: "audioPolicy",
      name: "音质策略：best（默认 FLAC>最高AAC）/ aac / follow / dolby",
    },
    {
      key: "downloadExtMode",
      name: "下载后缀模式：auto（默认）/ raw（完全保留 CDN 后缀）",
    },
  ],
  hints: {
    importMusicSheet: [
      "v0.4 默认 best：存在原生 FLAC 时优先 FLAC，否则选普通 DASH 中最高码率 AAC",
      "MusicFreeDesktop 默认 standard 不再限制 best/aac 策略；只有 audioPolicy=follow 才跟随其音质分档",
      "AAC 下载会保存为 .m4a；FLAC/Dolby 不会伪装扩展名，请用仓库 tools/cotton-normalizer.ps1 无损规范化",
      "支持一次粘贴多个链接：每行一个，自动识别、合并并去重",
      "自动展开多P视频：每个分P作为独立歌曲导入，并保持原顺序",
      "支持新版 B站空间合集 /lists/<id>?type=season 和空间系列 type=series",
      "兼容公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID",
    ],
  },
  supportedSearchType: [],
  async search() {
    return { isEnd: true, data: [] };
  },
  importMusicSheet,
  getMediaSource,
  getAlbumInfo,
};
