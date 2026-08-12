"use strict";

/**
 * MusicFree Bilibili 合集导入插件
 * 目标：支持新版 B 站空间合集链接：
 * https://space.bilibili.com/<mid>/lists/<season_id>?type=season
 *
 * 同时兼容：
 * - type=series 的“列表/系列”
 * - 原 Bilibili 插件支持的公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID
 *
 * 基于 maotoumao/MusicFreePlugins 的 bilibili 插件接口风格编写。
 */

const axios = require("axios");

const headers = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function durationToSec(duration) {
  if (typeof duration === "number") return duration;
  if (typeof duration === "string") {
    return duration.split(":").reduce((prev, curr) => 60 * prev + Number(curr), 0);
  }
  return 0;
}

async function getCid(bvid, aid) {
  const params = bvid ? { bvid } : { aid };
  const res = (
    await axios.get("https://api.bilibili.com/x/web-interface/view", {
      headers,
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
        headers: { ...headers, referer: referer || `https://space.bilibili.com/${mid}` },
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
        headers,
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
      await axios.get(
        "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list",
        {
          headers: {
            ...headers,
            referer: sourceUrl,
          },
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
        headers: { ...headers, referer: sourceUrl },
        params: { series_id: seriesId },
      })
    ).data;
    seriesName = info?.data?.meta?.name || seriesName;
  } catch (_) {}

  while (result.length < total) {
    const res = (
      await axios.get("https://api.bilibili.com/x/series/archives", {
        headers: { ...headers, referer: sourceUrl },
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
    artwork: item.pic,
    title: item.title,
    artist: uploader,
    album: seriesName,
    duration: durationToSec(item.duration),
    date: item.pubdate ? new Date(item.pubdate * 1000).toISOString().slice(0, 10) : undefined,
  }));
}

async function importMusicSheet(urlLike) {
  const input = String(urlLike || "").trim();

  // 新版空间“合集和系列”：
  // https://space.bilibili.com/33114953/lists/5469118?type=season
  const listMatch = input.match(
    /space\.bilibili\.com\/(\d+)\/lists\/(\d+)/i
  );

  if (listMatch) {
    const mid = listMatch[1];
    const listId = listMatch[2];
    const isSeries = /[?&]type=series(?:[&#]|$)/i.test(input);

    if (isSeries) {
      return await getSeriesList(mid, listId, input);
    }
    return await getSeasonList(mid, listId, input);
  }

  // 兼容旧收藏夹导入格式
  let id;
  if (!id) id = input.match(/^\s*(\d+)\s*$/)?.[1];
  if (!id) id = input.match(/^(?:.*)fid=(\d+).*$/)?.[1];
  if (!id) id = input.match(/\/playlist\/pl(\d+)/i)?.[1];
  if (!id) id = input.match(/\/list\/ml(\d+)/i)?.[1];

  if (id) {
    return await getFavoriteList(id);
  }

  throw new Error(
    "无法识别链接。请粘贴 B站空间 /lists/<ID>?type=season（或 type=series）链接，或公开收藏夹链接。"
  );
}

async function getMediaSource(musicItem, quality) {
  let cid = musicItem.cid;
  if (!cid) {
    cid = (await getCid(musicItem.bvid, musicItem.aid)).data.cid;
  }

  const videoParams = musicItem.bvid
    ? { bvid: musicItem.bvid }
    : { aid: musicItem.aid };

  const res = (
    await axios.get("https://api.bilibili.com/x/player/playurl", {
      headers,
      params: {
        ...videoParams,
        cid,
        fnval: 16,
      },
    })
  ).data;

  if (res.code !== 0 || !res.data) {
    throw new Error(`Bilibili 音频地址获取失败：${res.message || res.code}`);
  }

  let url;
  const audios = res.data?.dash?.audio;

  if (Array.isArray(audios) && audios.length) {
    const sorted = [...audios].sort(
      (a, b) => (a.bandwidth || 0) - (b.bandwidth || 0)
    );

    const qualityIndex = {
      low: 0,
      standard: 1,
      high: 2,
      super: 3,
    };

    const wanted = qualityIndex[quality] ?? sorted.length - 1;
    const selected = sorted[Math.min(wanted, sorted.length - 1)] || sorted[0];
    url = selected.baseUrl || selected.base_url;
  } else if (res.data?.durl?.length) {
    url = res.data.durl[0].url;
  }

  if (!url) {
    throw new Error("Bilibili 没有返回可播放的音频地址");
  }

  const parsed = new URL(url);
  return {
    url,
    headers: {
      ...headers,
      host: parsed.host,
      connection: "keep-alive",
      referer: `https://www.bilibili.com/video/${musicItem.bvid ?? musicItem.aid ?? ""}`,
    },
  };
}

async function getAlbumInfo(albumItem) {
  const cidRes = await getCid(albumItem.bvid, albumItem.aid);
  const data = cidRes?.data || {};
  const pages = data.pages || [];

  if (pages.length <= 1) {
    return {
      musicList: [
        {
          ...albumItem,
          cid: data.cid,
        },
      ],
    };
  }

  return {
    musicList: pages.map((item) => ({
      ...albumItem,
      cid: item.cid,
      id: item.cid,
      title: item.part,
      duration: durationToSec(item.duration),
    })),
  };
}

module.exports = {
  platform: "bilibili合集",
  appVersion: ">=0.0",
  version: "0.1.0",
  author: "3ll3-3ll3",
  srcUrl: "https://raw.githubusercontent.com/3ll3-3ll3/musicfree-bilibili-collection/main/musicfree_bilibili_collection.js",
  cacheControl: "no-cache",
  primaryKey: ["id", "aid", "bvid", "cid"],

  hints: {
    importMusicSheet: [
      "支持新版 B站空间合集：https://space.bilibili.com/<mid>/lists/<id>?type=season",
      "支持 B站空间系列：https://space.bilibili.com/<mid>/lists/<id>?type=series",
      "同时兼容公开收藏夹 URL / fid / pl / ml / 数字收藏夹 ID",
      "合集较大时会自动分页读取，请稍等。",
    ],
  },

  // 这个插件专门负责“导入 B站合集并播放”，不提供搜索页。
  supportedSearchType: [],

  async search() {
    return { isEnd: true, data: [] };
  },

  importMusicSheet,
  getMediaSource,
  getAlbumInfo,
};
