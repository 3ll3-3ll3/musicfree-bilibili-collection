"use strict";

/**
 * MusicFree Bilibili 合集批量导入插件 - Cotton Music optimized
 *
 * v0.5.0
 * - 支持空间合集 / 系列 / 收藏夹 / 多链接合并 / 多P展开
 * - 将 MusicFree 原生 low / standard / high / super 映射成 4 个明确音质档位
 * - low      -> 最低可用 AAC（通常约 64K）
 * - standard -> 优先 B站 30232（通常约 128/132K）
 * - high     -> 优先 B站 30280 / 最高普通 AAC（通常约 192K）
 * - super    -> 原生 FLAC 优先；没有 FLAC 时回退最高普通 AAC
 * - 普通 AAC 下载保存为 Cotton Music 友好的 .m4a 文件名
 * - FLAC DASH 不伪装扩展名，交给 Cotton Normalizer 无损抽取
 */

const axios = require("axios");

const BASE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const EXPAND_CONCURRENCY = 3;
const AUDIO_IDS = {
  low: 30216,
  standard: 30232,
  high: 30280,
};

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
    return duration
      .split(":")
      .reduce((prev, curr) => 60 * prev + Number(curr), 0);
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
  if (item?.bvid && item?.cid != null) {
    return `bvid:${item.bvid}:cid:${item.cid}`;
  }
  if (item?.aid != null && item?.cid != null) {
    return `aid:${item.aid}:cid:${item.cid}`;
  }
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

function qualityHints() {
  return {
    low: {},
    standard: {},
    high: {},
    super: {},
  };
}

function normalizeArtwork(url) {
  if (!url) return url;
  return String(url).startsWith("//") ? `https:${url}` : url;
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
        headers: buildHeaders({
          referer: referer || `https://space.bilibili.com/${mid}`,
        }),
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
        params: {
          media_id: id,
          platform: "web",
          ps: pageSize,
          pn: page,
        },
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
    artwork: normalizeArtwork(item.cover),
    title: item.title,
    artist: item.upper?.name || "Bilibili",
    album: item.bvid ?? item.aid,
    duration: durationToSec(item.duration),
    qualities: qualityHints(),
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
      await axios.get(
        "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list",
        {
          headers: buildHeaders({ referer: sourceUrl }),
          params: {
            mid,
            season_id: seasonId,
            page_num: page,
            page_size: pageSize,
          },
        }
      )
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
    artwork: normalizeArtwork(item.pic),
    title: item.title,
    artist: uploader,
    album: albumName,
    duration: durationToSec(item.duration),
    date: item.pubdate
      ? new Date(item.pubdate * 1000).toISOString().slice(0, 10)
      : undefined,
    qualities: qualityHints(),
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
        params: {
          mid,
          series_id: seriesId,
          pn: page,
          ps: pageSize,
        },
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
    artwork: normalizeArtwork(item.pic),
    title: item.title,
    artist: uploader,
    album: seriesName,
    duration: durationToSec(item.duration),
    date: item.pubdate
      ? new Date(item.pubdate * 1000).toISOString().slice(0, 10)
      : undefined,
    qualities: qualityHints(),
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
      return [
        {
          ...item,
          cid: item.cid ?? data.cid ?? onlyPage?.cid,
          duration:
            item.duration ||
            durationToSec(onlyPage?.duration) ||
            durationToSec(data.duration),
          qualities: item.qualities || qualityHints(),
        },
      ];
    }

    const expandedAlbum = buildExpandedAlbumName(item);
    return pages.map((page, index) => ({
      ...item,
      id: `${item.bvid ?? item.aid}:${page.cid}`,
      cid: page.cid,
      title:
        page.part || `${item.title || "多P视频"} P${page.page ?? index + 1}`,
      album: expandedAlbum,
      duration: durationToSec(page.duration),
      page: page.page ?? index + 1,
      parentTitle: item.title,
      _expandedMultiPage: true,
      qualities: item.qualities || qualityHints(),
    }));
  } catch (error) {
    console.warn(
      `[bilibili合集] 多P检查失败，保留原视频：${
        item?.title || item?.bvid || item?.aid
      }`,
      error
    );
    return [item];
  }
}

async function expandImportedMediaItems(items) {
  const expandedGroups = await mapWithConcurrency(
    items || [],
    EXPAND_CONCURRENCY,
    expandMediaItem
  );

  const flattened = [];
  for (const group of expandedGroups) {
    if (Array.isArray(group)) flattened.push(...group);
  }
  return flattened;
}

async function importSingleMusicSheet(input) {
  const listMatch = input.match(
    /space\.bilibili\.com\/(\d+)\/lists\/(\d+)/i
  );

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
  if (!entries.length) {
    throw new Error("请输入至少一个 Bilibili 歌单/合集链接");
  }

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
    console.warn(
      `[bilibili合集] ${entries.length} 个输入中有 ${failed.length} 个导入失败：\n${failed.join("\n")}`
    );
  }

  return result;
}

function trackUrl(track) {
  return (
    track?.baseUrl ||
    track?.base_url ||
    track?.url ||
    track?.backupUrl?.[0] ||
    track?.backup_url?.[0]
  );
}

function asTrackList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function sortByBandwidthAscending(tracks) {
  return [...tracks].sort((a, b) => {
    const bw = (a?.bandwidth || 0) - (b?.bandwidth || 0);
    if (bw) return bw;
    return (a?.id || 0) - (b?.id || 0);
  });
}

function findById(tracks, id) {
  return tracks.find((track) => Number(track?.id) === Number(id));
}

function findClosestBandwidth(tracks, target) {
  if (!tracks.length) return null;
  return [...tracks].sort(
    (a, b) =>
      Math.abs((a?.bandwidth || 0) - target) -
      Math.abs((b?.bandwidth || 0) - target)
  )[0];
}

function pickRegularAudio(audios, quality) {
  const usable = sortByBandwidthAscending(
    asTrackList(audios).filter((track) => !!trackUrl(track))
  );
  if (!usable.length) return null;

  if (quality === "low") {
    return findById(usable, AUDIO_IDS.low) || usable[0];
  }

  if (quality === "standard") {
    return (
      findById(usable, AUDIO_IDS.standard) ||
      findClosestBandwidth(usable, 132000) ||
      usable[Math.min(1, usable.length - 1)]
    );
  }

  if (quality === "high") {
    return findById(usable, AUDIO_IDS.high) || usable[usable.length - 1];
  }

  return findById(usable, AUDIO_IDS.high) || usable[usable.length - 1];
}

function pickAudioSource(dash, quality) {
  const regular = asTrackList(dash?.audio).filter((track) => !!trackUrl(track));
  const flac = asTrackList(dash?.flac?.audio).filter((track) => !!trackUrl(track));

  if (quality === "super") {
    const lossless = sortByBandwidthAscending(flac).at(-1);
    if (lossless) return { track: lossless, kind: "flac" };

    const fallback = pickRegularAudio(regular, "high");
    return fallback ? { track: fallback, kind: "aac" } : null;
  }

  const selected = pickRegularAudio(regular, quality || "standard");
  if (selected) return { track: selected, kind: "aac" };

  // 极端情况下没有普通 AAC，super 之外也允许 FLAC 兜底，避免完全无法播放。
  const fallbackFlac = sortByBandwidthAscending(flac).at(-1);
  return fallbackFlac ? { track: fallbackFlac, kind: "flac" } : null;
}

function addDownloadExtensionHint(url, ext) {
  const vars = getUserVariables();
  const mode = String(vars.downloadExtMode || "auto").trim().toLowerCase();
  if (mode === "raw" || mode === "off" || mode === "关闭") return url;
  if (!ext) return url;

  try {
    const parsed = new URL(url);
    // URL fragment 不会发送给 B站 CDN；MusicFreeDesktop 会从完整 URL 猜后缀。
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
        referer: `https://www.bilibili.com/video/${
          musicItem.bvid ?? musicItem.aid ?? ""
        }`,
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
  if (!cid) {
    cid = (await getCid(musicItem.bvid, musicItem.aid)).data.cid;
  }

  const requestedQuality = ["low", "standard", "high", "super"].includes(
    quality
  )
    ? quality
    : "standard";

  const res = await getPlayurlData(musicItem, cid);
  if (res.code !== 0 || !res.data) {
    throw new Error(
      `Bilibili 音频地址获取失败：${res.message || res.code}`
    );
  }

  let rawUrl;
  let kind = "unknown";
  let selectedTrack = null;

  if (res.data?.dash) {
    const selected = pickAudioSource(res.data.dash, requestedQuality);
    if (selected) {
      selectedTrack = selected.track;
      rawUrl = trackUrl(selected.track);
      kind = selected.kind;
    }
  } else if (res.data?.durl?.length) {
    rawUrl = res.data.durl[0].url;
  }

  if (!rawUrl) {
    throw new Error("Bilibili 没有返回可播放的音频地址");
  }

  const kbps = selectedTrack?.bandwidth
    ? Math.round(selectedTrack.bandwidth / 1000)
    : "?";
  const codec = selectedTrack?.codecs || "?";
  console.log(
    `[bilibili合集] ${musicItem.title || musicItem.bvid || "音频"} | ` +
      `quality=${requestedQuality} | kind=${kind} | id=${
        selectedTrack?.id ?? "?"
      } | bitrate≈${kbps}kbps | codec=${codec}`
  );

  const parsed = new URL(rawUrl);
  // AAC 可以安全地给 MusicFree 一个 .m4a 文件名；FLAC 仍是 DASH/fMP4 容器，
  // 不直接伪装成 .flac，后续由 Cotton Normalizer 使用 ffmpeg -c copy 抽取。
  const outputExt = kind === "aac" ? "m4a" : null;
  const finalUrl = addDownloadExtensionHint(rawUrl, outputExt);

  return {
    url: finalUrl,
    headers: {
      ...BASE_HEADERS,
      host: parsed.host,
      connection: "keep-alive",
      referer: `https://www.bilibili.com/video/${
        musicItem.bvid ?? musicItem.aid ?? ""
      }`,
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
      musicList: [
        {
          ...albumItem,
          cid: albumItem.cid ?? data.cid ?? pages[0]?.cid,
          qualities: albumItem.qualities || qualityHints(),
        },
      ],
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
      qualities: albumItem.qualities || qualityHints(),
    })),
  };
}

module.exports = {
  platform: "bilibili合集",
  appVersion: ">=0.0",
  version: "0.5.0",
  author: "3ll3-3ll3",
  description:
    "Bilibili 合集/系列批量导入；四档音质：省流 / 标准 / 高音质 / 无损优先",
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
      key: "downloadExtMode",
      name: "下载后缀模式：auto（默认）/ raw（保留 CDN 原始后缀）",
    },
  ],

  hints: {
    importMusicSheet: [
      "v0.5 四档音质：low=省流AAC，standard=标准AAC，high=最高AAC，super=FLAC优先",
      "super 没有原生 FLAC 时自动回退最高 AAC，不会把 AAC 伪装成 FLAC",
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
