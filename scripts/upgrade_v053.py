from pathlib import Path

plugin_path = Path("musicfree_bilibili_collection.js")
s = plugin_path.read_text(encoding="utf-8")

if 'version: "0.5.3"' in s:
    print("v0.5.3 already applied")
    raise SystemExit(0)


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing replacement anchor: {label}")
    return text.replace(old, new, 1)


s = replace_once(
    s,
    " * v0.5.2\n * - 支持空间合集 / 系列 / 收藏夹 / 多链接合并 / 多P展开",
    " * v0.5.3\n * - 支持直接导入单个 BV/AV 视频；多P/视频选集直接展开为独立歌曲\n * - 支持 b23.tv 短链接自动解析\n * - 支持空间合集 / 系列 / 收藏夹 / 多链接合并 / 多P展开",
    "header version",
)

artwork_anchor = '''function normalizeArtwork(url) {
  if (!url) return url;
  return String(url).startsWith("//") ? `https:${url}` : url;
}
'''

artwork_new = artwork_anchor + '''
function parseVideoIdentifier(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const bvidMatch =
    text.match(/(?:\\/video\\/|^)(BV[0-9A-Za-z]{10})(?:[/?#]|$)/i) ||
    text.match(/\\b(BV[0-9A-Za-z]{10})\\b/i);
  if (bvidMatch) return { bvid: bvidMatch[1] };

  const aidMatch =
    text.match(/(?:\\/video\\/|^)av(\\d+)(?:[/?#]|$)/i) ||
    text.match(/\\bav(\\d+)\\b/i);
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
  if (!/^https?:\\/\\/(?:www\\.)?b23\\.tv\\//i.test(url)) return url;

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
    !/^https?:\\/\\/(?:www\\.)?b23\\.tv\\//i.test(finalUrl)
  ) {
    console.log(`[bilibili合集] 短链解析：${url} -> ${finalUrl}`);
    return finalUrl;
  }

  throw new Error(
    "B站 b23.tv 短链解析失败，请改用展开后的 bilibili.com 链接"
  );
}
'''

s = replace_once(s, artwork_anchor, artwork_new, "video identifier helpers")

getcid_anchor = '''async function getCid(bvid, aid) {
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
'''

getcid_new = getcid_anchor + '''
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
'''

s = replace_once(s, getcid_anchor, getcid_new, "single video list resolver")

import_anchor = '''async function importSingleMusicSheet(input) {
  const listMatch = input.match(/space\\.bilibili\\.com\\/(\\d+)\\/lists\\/(\\d+)/i);
'''

import_new = '''async function importSingleMusicSheet(input) {
  input = await resolveB23Url(input);

  const videoIdentifier = parseVideoIdentifier(input);
  if (videoIdentifier) {
    return await getSingleVideoList(videoIdentifier, input);
  }

  const listMatch = input.match(/space\\.bilibili\\.com\\/(\\d+)\\/lists\\/(\\d+)/i);
'''

s = replace_once(s, import_anchor, import_new, "single video import route")

s = replace_once(
    s,
    '  throw new Error("无法识别该链接或歌单 ID");',
    '  throw new Error("无法识别该 B站视频、合集、系列、收藏夹链接或 ID");',
    "recognition error",
)

s = replace_once(
    s,
    '  version: "0.5.2",',
    '  version: "0.5.3",',
    "module version",
)

s = replace_once(
    s,
    '    "Bilibili 合集/系列批量导入；四档音质 + 可配置分钟级时长过滤",',
    '    "Bilibili 合集/系列/单视频选集导入；四档音质 + 可配置分钟级时长过滤",',
    "description",
)

s = replace_once(
    s,
    '''    importMusicSheet: [
      "v0.5.2 新增时长过滤：maxDurationMinutes 填分钟数，例如 30 / 60；0 或留空表示不限",
''',
    '''    importMusicSheet: [
      "v0.5.3 支持直接粘贴 BV/AV 视频链接、裸 BV/av ID；多P/视频选集会自动拆成独立歌曲",
      "支持 b23.tv 短链自动解析，手机分享链接可直接尝试导入",
      "时长过滤：maxDurationMinutes 填分钟数，例如 30 / 60；0 或留空表示不限",
''',
    "hints",
)

plugin_path.write_text(s, encoding="utf-8")

readme_path = Path("README.md")
r = readme_path.read_text(encoding="utf-8")
r = replace_once(r, "`v0.5.2`", "`v0.5.3`", "readme current version")
r = replace_once(
    r,
    "- 自动识别多P视频，并将每个分P展开成独立歌曲\n",
    "- 自动识别多P视频，并将每个分P展开成独立歌曲\n"
    "- 支持直接粘贴单个 BV/AV 视频链接或裸 BV/av ID，将视频选集直接当作歌单导入\n"
    "- 支持 `b23.tv` 短链接自动解析\n",
    "readme feature bullets",
)

section_anchor = "## v0.5.2：可配置时长过滤\n"
section_new = '''## v0.5.3：单视频 / 视频选集直接导入

现在可以把普通 B站视频直接作为歌单导入，无需先找到它所属的收藏夹或空间合集。

支持：

```text
https://www.bilibili.com/video/BVxxxxxxxxxx/
BVxxxxxxxxxx
https://www.bilibili.com/video/av123456/
av123456
https://b23.tv/xxxxxx
```

如果视频本身有多个分P/“视频选集”，插件会读取每个 `page` 的独立 `cid`、标题和时长，并直接展开为独立歌曲。导入 MusicFree 后，每个选集都是独立条目；`maxDurationMinutes` 仍按每个分P自己的时长过滤，下载也按每个分P自己的 `cid` 获取音频。

例如这类链接可以直接导入：

```text
https://www.bilibili.com/video/BV1GStwexEXB/
```

'''

if section_anchor not in r:
    raise SystemExit("missing replacement anchor: readme v0.5.2 section")
r = r.replace(section_anchor, section_new + section_anchor, 1)
readme_path.write_text(r, encoding="utf-8")

print("v0.5.3 migration prepared successfully")
