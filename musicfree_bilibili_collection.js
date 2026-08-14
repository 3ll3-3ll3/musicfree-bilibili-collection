"use strict";

/**
 * MusicFree Bilibili 合集批量导入插件 - Cotton Music optimized
 *
 * v0.5.4
 * - 改进多链接导入：即使 MusicFree 单行输入框吞掉换行，也能自动拆分连续 URL
 * - 支持空格 / 换行 / 逗号 / 分号 / 竖线分隔，以及多个裸 BV/av ID 批量导入
 * - 支持直接导入单个 BV/AV 视频；多P/视频选集直接展开为独立歌曲
 * - 支持 b23.tv 短链接自动解析
 * - 支持空间合集 / 系列 / 收藏夹 / 多链接合并 / 多P展开
 * - 支持 maxDurationMinutes：按分钟过滤超长音频；0/留空=不限
 * - 多P按每个分P自身时长过滤，不按整个视频总时长过滤
 * - 导入阶段过滤 + 下载阶段再次校验，旧歌单也不会误下超长音频
 * - low / standard / high / super 映射为 4 个明确音质档位
 * - low      -> 最低可用 AAC（通常约 64K）
 * - standard -> 优先 B站 30232（通常约 128/132K）
 * - high     -> 优先 B站 30280 / 最高普通 AAC（通常约 192K）
 * - super    -> 原生 FLAC 优先；没有 FLAC 时回退最高普通 AAC
 * - 普通 AAC 保存为 Cotton Music 友好的 .m4a 文件名
 * - FLAC DASH 不伪装扩展名，交给 Cotton Normalizer 无损抽取
 * - 自动更新源使用 GitHub Raw
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
  if (typeof duration === "number") {
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }
  if (typeof duration === "string") {
    const text = duration.trim();
    if (!text) return 0;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((prev, curr) => 60 * prev + curr, 0);
  }
  return 0;
}

function getMaxDurationMinutes() {
  const vars = getUserVariables();
  const raw = String(vars.maxDurationMinutes ?? "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isOverDurationLimit(durationSec) {
  const maxMinutes = getMaxDurationMinutes();
  const seconds = durationToSec(durationSec);
  if (maxMinutes <= 0 || seconds <= 0) return false;
  return seconds > maxMinutes * 60;
}

function filterByDuration(items, context) {
  const maxMinutes = getMaxDurationMinutes();
  if (maxMinutes <= 0) return items || [];

  const kept = [];
  const removed = [];
  for (const item of items || []) {
    if (isOverDurationLimit(item?.duration)) removed.push(item);
    else kept.push(item);
  }

  if (removed.length) {
    console.log(
      `[bilibili合集] 时长过滤${context ? `(${context})` : ""}：` +
        `上限=${maxMinutes}min，过滤=${removed.length}，保留=${kept.length}`
    );
    for (const item of removed.slice(0, 20)) {
      console.log(
        `[bilibili合集] 已过滤：${item?.title || item?.bvid || item?.aid || "未知"} | ` +
          `${Math.round((durationToSec(item?.duration) / 60) * 10) / 10}min`
      );
    }
    if (removed.length > 20) {
      console.log(`[bilibili合集] 另有 ${removed.length - 20} 条超长内容未逐条打印`);
    }
  }
  return kept;
}

function cleanInputToken(value) {
  return String(value || "")
    .trim()
    .replace(/[，。；;、）)\]}>》」』]+$/g, "");
}

function extractHttpUrls(text) {
  const source = String(text || "");
  const starts = [];
  const re = /https?:\/\//gi;
  let match;
  while ((match = re.exec(source))) starts.push(match.index);
  if (!starts.length) return [];

  const urls = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = starts[i + 1] ?? source.length;
    let chunk = source.slice(start, end).trim();

    // MusicFreeDesktop 当前使用单行 input；粘贴多行文本时换行可能被吞掉，
    // 导致两个 URL 直接粘在一起。按下一个 http(s):// 起点切片即可恢复。
    const whitespaceIndex = chunk.search(/\s/);
    if (whitespaceIndex >= 0) chunk = chunk.slice(0, whitespaceIndex);

    const cleaned = cleanInputToken(chunk);
    if (cleaned) urls.push(cleaned);
  }
  return urls;
}

function parseImportEntries(urlLike) {
  const text = String(urlLike || "").trim();
  if (!text) return [];

  // 优先提取所有完整 URL。即使宿主输入框把换行删掉，形如
  // "https://...BV1/...https://...BV2/..." 也能正确拆成两条。
  const urls = extractHttpUrls(text);
  if (urls.length) return [...new Set(urls)];

  // 没有完整 URL 时，兼容裸 BV/av ID。即使多行粘贴后连在一起，
  // 仍可通过固定格式逐个提取。
  const videoIds = text.match(/BV[0-9A-Za-z]{10}|av\d+/gi);
  if (videoIds?.length) {
    return [...new Set(videoIds.map(cleanInputToken).filter(Boolean))];
  }

  // 收藏夹数字 ID / 其他旧格式保留分隔符解析；支持空格、换行、逗号、分号、竖线。
  return [
    ...new Set(
      text
        .split(/[\s,，;；|]+/)
        .map(cleanInputToken)
        .filter(Boolean)
    ),
  ];
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

function qualityHints() {
  return { low: {}, standard: {}, high: {}, super: {} };
}

function normalizeArtwork(url) {
  if (!url) return url;
  return String(url).startsWith("//") ? `https:${url}` : url;
}

function parseVideoIdentifier(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const bvidMatch =
    text.match(/(?:\/video\/|^)(BV[0-9A-Za-z]{10})(?:[/?#]|$)/i) ||
    text.match(/\b(BV[0-9A-Za-z]{10})\b/i);
  if (bvidMatch) return { bvid: bvidMatch[1] };

  const aidMatch =
    text.match(/(?:\/video\/|^)av(\d+)(?:[/?#]|$)/i) ||
    text.match(/\bav(\d+)\b/i);
  if (aidMatch) return { aid: Number(aidMatch[1]) };

  return null;
}

function getAxiosFinalUrl(response) {
  return (
    response?.request?.res?.responseUrl ||
    response?.request?.responseURL ||
    response?.request?._currentUrl ||
    null
  );
}

async function resolveB23Url(input) {
  const url = String(input || "").trim();
  if (!/^https?:\/\/(?:www\.)?b23\.tv\//i.test(url)) return url;

  let response;
  try {
    response = await axios.head(url, {
      headers: buildHeaders(),
      maxRedirects: 5,
    });
  } catch (_) {
    response = await axios.get(url, {
      headers: buildHeaders(),
      maxRedirects: 5,
    });
  }

  const finalUrl = getAxiosFinalUrl(response);
  if (
    finalUrl &&
    !/^https?:\/\/(?:www\.)?b23\.tv\//i.test(finalUrl)
  ) {
    console.log(`[bilibili合集] 短链解析：${url} -> ${finalUrl}`);
    return finalUrl;
  }

  throw new Error(
    "B站 b23.tv 短链解析失败，请改用展开后的 bilibili.com 链接"
  );
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

async function getSingleVideoList(identifier, sourceUrl) {
  const view = await getCid(identifier?.bvid, identifier?.aid);
  const data = view?.data || {};
  const bvid = data.bvid || identifier?.bvid;
  const aid = data.aid ?? identifier?.aid;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const videoTitle =
    data.title || bvid || (aid != null ? `av${aid}` : "Bilibili 视频");
  const artist = data.owner?.name || "Bilibili";
  const artwork = normalizeArtwork(data.pic);
  const date = data.pubdate
    ? new Date(data.pubdate * 1000).toISOString().slice(0, 10)
    : undefined;

  const base = {
    id: bvid ?? aid,
    aid,
    bvid,
    artwork,
    title: videoTitle,
    artist,
    album: videoTitle,
    duration: durationToSec(data.duration),
    date,
    sourceUrl,
    qualities: qualityHints(),
  };

  if (pages.length <= 1) {
    const page = pages[0];
    return [
      {
        ...base,
        id: `${bvid ?? aid}:${page?.cid ?? data.cid ?? "main"}`,
        cid: page?.cid ?? data.cid,
        duration:
          durationToSec(page?.duration) || durationToSec(data.duration),
        page: page?.page ?? 1,
        _expandedMultiPage: true,
      },
    ];
  }

  console.log(
    `[bilibili合集] 单视频选集：${videoTitle} | 共 ${pages.length} 个分P`
  );

  return pages.map((page, index) => ({
    ...base,
    id: `${bvid ?? aid}:${page.cid}`,
    cid: page.cid,
    title: page.part || `${videoTitle} P${page.page ?? index + 1}`,
    album: videoTitle,
    duration: durationToSec(page.duration),
    page: page.page ?? index + 1,
    parentTitle: videoTitle,
    _expandedMultiPage: true,
  }));
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
  input = await resolveB23Url(input);

  const videoIdentifier = parseVideoIdentifier(input);
  if (videoIdentifier) {
    return await getSingleVideoList(videoIdentifier, input);
  }

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
  throw new Error("无法识别该 B站视频、合集、系列、收藏夹链接或 ID");
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
  const deduped = dedupeMediaItems(expanded);
  const result = filterByDuration(deduped, "导入");

  if (!result.length) {
    const maxMinutes = getMaxDurationMinutes();
    const limitHint = maxMinutes > 0 ? `；当前时长上限为 ${maxMinutes} 分钟` : "";
    const detail = failed.length ? `\n${failed.join("\n")}` : "";
    throw new Error(`没有成功生成任何歌曲${limitHint}。${detail}`);
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

async function resolveDurationForLimit(musicItem) {
  const known = durationToSec(musicItem?.duration);
  if (known > 0) return known;
  if (getMaxDurationMinutes() <= 0) return 0;
  if (!musicItem?.bvid && musicItem?.aid == null) return 0;

  try {
    const cidRes = await getCid(musicItem.bvid, musicItem.aid);
    const data = cidRes?.data || {};
    const pages = Array.isArray(data.pages) ? data.pages : [];
    if (musicItem?.cid != null) {
      const page = pages.find(
        (p) => String(p?.cid) === String(musicItem.cid)
      );
      const pageDuration = durationToSec(page?.duration);
      if (pageDuration > 0) return pageDuration;
    }
    if (pages.length === 1) {
      const pageDuration = durationToSec(pages[0]?.duration);
      if (pageDuration > 0) return pageDuration;
    }
    return durationToSec(data.duration);
  } catch (_) {
    return 0;
  }
}

async function assertDurationAllowed(musicItem) {
  const maxMinutes = getMaxDurationMinutes();
  if (maxMinutes <= 0) return;
  const duration = await resolveDurationForLimit(musicItem);
  if (duration > maxMinutes * 60) {
    const actualMinutes = Math.round((duration / 60) * 10) / 10;
    throw new Error(
      `时长过滤：${musicItem?.title || "该音频"} 为 ${actualMinutes} 分钟，超过 ${maxMinutes} 分钟上限`
    );
  }
}

async function getMediaSource(musicItem, quality) {
  await assertDurationAllowed(musicItem);

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
    throw new Error(`Bilibili 音频地址获取失败：${res.message || res.code}`);
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

  if (!rawUrl) throw new Error("Bilibili 没有返回可播放的音频地址");

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
    return { musicList: filterByDuration([albumItem], "专辑") };
  }

  const cidRes = await getCid(albumItem.bvid, albumItem.aid);
  const data = cidRes?.data || {};
  const pages = data.pages || [];

  if (pages.length <= 1) {
    const musicList = [
      {
        ...albumItem,
        cid: albumItem.cid ?? data.cid ?? pages[0]?.cid,
        duration:
          durationToSec(albumItem?.duration) ||
          durationToSec(pages[0]?.duration) ||
          durationToSec(data.duration),
        qualities: albumItem.qualities || qualityHints(),
      },
    ];
    return { musicList: filterByDuration(musicList, "专辑") };
  }

  const musicList = pages.map((item, index) => ({
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
  }));

  return { musicList: filterByDuration(musicList, "专辑多P") };
}

module.exports = {
  platform: "bilibili合集",
  appVersion: ">=0.0",
  version: "0.5.4",
  author: "3ll3-3ll3",
  description:
    "Bilibili 合集/系列/单视频选集导入；四档音质 + 可配置分钟级时长过滤",
  srcUrl:
    "https://raw.githubusercontent.com/3ll3-3ll3/musicfree-bilibili-collection/main/musicfree_bilibili_collection.js",
  cacheControl: "no-cache",
  primaryKey: ["id", "aid", "bvid", "cid"],

  userVariables: [
    {
      key: "biliCookie",
      name: "B站 Cookie（可选；用于账号本身可访问的高音质/受限内容）",
      type: "password",
    },
    {
      key: "maxDurationMinutes",
      name: "最大音频时长（分钟）：如 30 / 60；0 或留空表示不限制",
    },
    {
      key: "downloadExtMode",
      name: "下载后缀模式：auto（默认）/ raw（保留 CDN 原始后缀）",
    },
  ],

  hints: {
    importMusicSheet: [
      "v0.5.4 改进多链接导入：可直接多行粘贴；即使输入框把换行显示成一行，也会自动识别多个 URL",
      "支持空格 / 逗号 / 分号 / 竖线分隔多个链接，也支持多个裸 BV/av ID 批量粘贴",
      "支持 b23.tv 短链自动解析，手机分享链接可直接尝试导入",
      "时长过滤：maxDurationMinutes 填分钟数，例如 30 / 60；0 或留空表示不限",
      "超过上限的内容不会进入导入结果；多P视频按每个分P自身时长分别判断",
      "下载时还会再次校验时长，因此旧歌单中的超长条目也会被阻止下载",
      "四档音质：low=省流AAC，standard=标准AAC，high=最高AAC，super=FLAC优先",
      "super 没有原生 FLAC 时自动回退最高 AAC，不会把 AAC 伪装成 FLAC",
      "支持一次粘贴多个链接：推荐一行一个；宿主吞掉换行时插件仍会按每个 http(s):// 自动拆分、合并并去重",
      "支持新版 B站空间合集 /lists/<id>?type=season、空间系列 type=series、公开收藏夹",
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
