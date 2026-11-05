'use strict';
// 解析 Obsidian「12媒体档案/动漫/entries」下的媒体条目笔记。
// 本模块对笔记文件只做读取（字符串处理），不存在任何写入操作。

const fs = require('fs');
const path = require('path');

function unquote(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// 只有这些字段把 [a, b] 当行内数组（避免把「[推子]」这类标题误拆）
const LIST_KEYS = new Set(['tags', 'aliases']);

// 极简 frontmatter 解析：key: value、行内数组 key: [a, b] 与 key: 下的块式数组（  - item）
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  let currentKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const listItem = /^\s+-\s?(.*)$/.exec(line);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(unquote(listItem[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_\u4e00-\u9fff-]+):\s?(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      const raw = kv[2].trim();
      const inline = LIST_KEYS.has(currentKey) && /^\[(.*)\]$/.exec(raw);
      data[currentKey] = inline
        ? inline[1].split(',').map((x) => unquote(x)).filter((x) => x !== '')
        : raw ? unquote(raw) : [];
      if (kv[2]) currentKey = null;
    }
  }
  return { data, body: text.slice(match[0].length) };
}

// 提取指定 ## 小节的正文纯文本（跳过图片嵌入行），遇到下一个标题即止
function extractSection(body, sectionName) {
  let inSection = false;
  const out = [];
  for (const raw of body.split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(raw.trim());
    if (h) {
      inSection = h[1].trim() === sectionName;
      continue;
    }
    if (!inSection) continue;
    const t = raw.trim();
    if (!t) continue;
    if (/^!\[/.test(t)) continue;
    out.push(t);
  }
  return out.join('\n').trim();
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseEntry(filePath, text, coversDir) {
  const { data, body } = parseFrontmatter(text);
  if (!data.title) return null;
  const fileName = filePath.replace(/^.*[\\/]/, '');
  const id = fileName.replace(/\.md$/i, '');
  const ratingNum = data.rating === '' || data.rating == null ? NaN : Number(data.rating);

  // 本地封面（库内 assets/covers，路径由前端经 /covers/<basename> 只读访问）
  const coverBase = data.cover_file ? String(data.cover_file).replace(/^.*[\\/]/, '') : '';
  let cover = '';
  if (coverBase && coversDir) {
    try {
      if (fs.existsSync(path.join(coversDir, coverBase))) {
        cover = '/covers/' + encodeURIComponent(coverBase);
      }
    } catch { /* 封面探测失败不影响条目 */ }
  }

  return {
    id,
    title: String(data.title),
    mediaType: String(data.media_type || '动漫'),
    status: String(data.status || ''),
    rating: Number.isFinite(ratingNum) ? ratingNum : null,
    year: toInt(data.year),
    episodes: toInt(data.episodes),
    favorite: /^(true|yes)$/i.test(String(data.favorite || '').trim()),
    source: String(data.source || ''),
    externalId: String(data.external_id || ''),
    link: String(data.link || ''),
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [],
    created: String(data.created || ''),
    updated: String(data.updated || ''),
    cover,
    coverUrl: String(data.cover || ''),
    review: extractSection(body, '短评'),
    memory: extractSection(body, '记忆点'),
  };
}

function computeStats(entries) {
  const byStatus = {};
  let rated = 0;
  let ratingSum = 0;
  let yearMin = null;
  let yearMax = null;
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    if (e.rating != null) { rated++; ratingSum += e.rating; }
    if (e.year != null) {
      if (yearMin == null || e.year < yearMin) yearMin = e.year;
      if (yearMax == null || e.year > yearMax) yearMax = e.year;
    }
  }
  return {
    total: entries.length,
    byStatus,
    ratedCount: rated,
    avgRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
    yearMin,
    yearMax,
  };
}

// 扫描条目目录（只读）。fileStats 可传入上次扫描的 mtime 签名用于增量缓存判断。
function scanLibrary(entriesDir, coversDir) {
  const entries = [];
  for (const name of fs.readdirSync(entriesDir)) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const full = path.join(entriesDir, name);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch { continue; }
    const entry = parseEntry(full, text, coversDir);
    if (entry) entries.push(entry);
  }
  return { entries, stats: computeStats(entries) };
}

// 目录签名：任一文件 mtime/size 变化或增删文件都会改变签名
function dirSignature(entriesDir) {
  const parts = [];
  for (const name of fs.readdirSync(entriesDir)) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const st = fs.statSync(path.join(entriesDir, name));
    parts.push(`${name}:${st.mtimeMs}:${st.size}`);
  }
  return parts.sort().join('|');
}

module.exports = { parseFrontmatter, parseEntry, scanLibrary, dirSignature, computeStats };
