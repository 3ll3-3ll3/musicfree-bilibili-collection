from pathlib import Path

plugin = Path('musicfree_bilibili_collection.js')
s = plugin.read_text(encoding='utf-8')

if 'version: "0.5.4"' in s:
    raise SystemExit(0)

old_parse = '''function parseImportEntries(urlLike) {
  const lines = String(urlLike || "")
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const line of lines) {
    const urls = line.match(/https?:\\/\\/[^\\s]+/gi);
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
'''

new_parse = '''function extractHttpUrls(text) {
  const source = String(text || "");
  const starts = [];
  const re = /https?:\\/\\//gi;
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
    const whitespaceIndex = chunk.search(/\\s/);
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
  const videoIds = text.match(/BV[0-9A-Za-z]{10}|av\\d+/gi);
  if (videoIds?.length) {
    return [...new Set(videoIds.map(cleanInputToken).filter(Boolean))];
  }

  // 收藏夹数字 ID / 其他旧格式保留分隔符解析；支持空格、换行、逗号、分号、竖线。
  return [
    ...new Set(
      text
        .split(/[\\s,，;；|]+/)
        .map(cleanInputToken)
        .filter(Boolean)
    ),
  ];
}
'''

if old_parse not in s:
    raise SystemExit('parseImportEntries anchor not found')
s = s.replace(old_parse, new_parse, 1)

s = s.replace(' * v0.5.3\n', ' * v0.5.4\n * - 改进多链接导入：即使 MusicFree 单行输入框吞掉换行，也能自动拆分连续 URL\n * - 支持空格 / 换行 / 逗号 / 分号 / 竖线分隔，以及多个裸 BV/av ID 批量导入\n', 1)
s = s.replace('  version: "0.5.3",', '  version: "0.5.4",', 1)
s = s.replace(
    '      "v0.5.3 支持直接粘贴 BV/AV 视频链接、裸 BV/av ID；多P/视频选集会自动拆成独立歌曲",',
    '      "v0.5.4 改进多链接导入：可直接多行粘贴；即使输入框把换行显示成一行，也会自动识别多个 URL",\n      "支持空格 / 逗号 / 分号 / 竖线分隔多个链接，也支持多个裸 BV/av ID 批量粘贴",',
    1,
)
s = s.replace(
    '      "支持一次粘贴多个链接：每行一个，自动识别、合并并去重",',
    '      "支持一次粘贴多个链接：推荐一行一个；宿主吞掉换行时插件仍会按每个 http(s):// 自动拆分、合并并去重",',
    1,
)
plugin.write_text(s, encoding='utf-8')

readme = Path('README.md')
r = readme.read_text(encoding='utf-8')
r = r.replace('`v0.5.3`', '`v0.5.4`', 1)
r = r.replace(
    '- 支持一次粘贴多个歌单链接，一行一个，自动识别、合并并去重',
    '- 支持一次粘贴多个歌单/视频链接；推荐一行一个，即使 MusicFree 单行输入框吞掉换行也能自动恢复多个 URL；同时支持空格、逗号、分号、竖线分隔',
    1,
)
anchor = '## v0.5.3：单视频 / 视频选集直接导入\n'
section = '''## v0.5.4：多链接粘贴兼容\n\nMusicFreeDesktop 当前导入窗口使用单行 `<input>`，不是 `<textarea>`。因此你从文本里粘贴：\n\n```text\nhttps://www.bilibili.com/video/BVxxxxxxxxxx/\nhttps://www.bilibili.com/video/BVyyyyyyyyyy/\n```\n\n界面上可能会被压成一行，甚至变成两个 URL 紧挨着。v0.5.4 不再依赖换行本身，而是扫描每一个 `http://` / `https://` 起点，因此即使变成：\n\n```text\nhttps://...BVxxxxxxxxxx/https://...BVyyyyyyyyyy/\n```\n\n也会恢复成两条独立导入任务。\n\n同时支持空格、逗号、中文逗号、分号、中文分号、竖线分隔，以及批量裸 `BV...` / `av...` ID。\n\n> 注意：MusicFreeDesktop 当前导入框本身限制最大 1000 字符。一次导入很多带 `spm_id_from` / `vd_source` 的长链接时，建议去掉追踪参数或直接粘贴 BV 号，以免宿主在插件收到内容前就截断。\n\n'''
if anchor not in r:
    raise SystemExit('README anchor not found')
r = r.replace(anchor, section + anchor, 1)
readme.write_text(r, encoding='utf-8')
