'use strict';
// Amber · 琥珀 —— 动漫观影档案放映室，零依赖 Node HTTP 服务。
// 对 Obsidian 库严格只读；本项目唯一的写入是在「数据源」面板保存时更新自身的 config.json。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { scanLibrary, dirSignature, computeStats, parseFrontmatter } = require('./lib/parser');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
// 首次运行时从示例配置生成本地 config.json（config.json 含个人路径，不入库）
if (!fs.existsSync(CONFIG_FILE)) {
  fs.copyFileSync(path.join(ROOT, 'config.example.json'), CONFIG_FILE);
  console.log('已根据 config.example.json 生成 config.json，请在页面右上角的「数据源」中改成你自己的条目目录。');
}
let config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
let configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
const PUBLIC_DIR = path.join(ROOT, 'public');
// 可用环境变量 AMBER_PORT 临时覆盖端口（不写回 config.json）
const PORT = Number(process.env.AMBER_PORT) || Number(config.port) || 8790;
const HOST = config.host || '127.0.0.1';
const IS_WIN = process.platform === 'win32';

// ---------- 数据源（config.json → entriesDir / coversDir，运行时可改，无需重启） ----------
let cache = null;
function clearCache() { cache = null; }

// 手动编辑 config.json 后也能即时生效：mtime 变化时重读
function currentSources() {
  try {
    const m = fs.statSync(CONFIG_FILE).mtimeMs;
    if (m !== configMtime) {
      const next = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      configMtime = m;
      config = { ...config, ...next };
      clearCache();
      console.log('[sources] 检测到 config.json 变更，已重新加载数据源');
    }
  } catch (err) {
    console.error(`[sources] 重读 config.json 失败，继续使用内存配置：${err.message}`);
  }
  const res = (p) => (p ? path.resolve(String(p)) : '');
  return { entriesDir: res(config.entriesDir), coversDir: res(config.coversDir) };
}

function isAbsoluteDir(p) {
  return IS_WIN ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(p) : path.isAbsolute(p);
}
const cleanPath = (raw) => (typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1').trim() : '');
const normPath = (p) => path.resolve(p).replace(/(?<=.)[\\/]+$/, '');

function inspectDir(dir) {
  const info = { path: dir, exists: false, isDirectory: false, readable: false, valid: false, error: '' };
  let st;
  try { st = fs.statSync(dir); } catch { info.error = '目录不存在'; return { info }; }
  info.exists = true;
  if (!st.isDirectory()) { info.error = '不是文件夹'; return { info }; }
  info.isDirectory = true;
  let names;
  try { names = fs.readdirSync(dir); } catch (err) { info.error = `无法读取（${err.code || err.message}）`; return { info }; }
  info.readable = true;
  return { info, names };
}

// 条目目录：至少一篇带 title frontmatter 的 .md
function inspectEntries(dir) {
  const { info, names } = inspectDir(dir);
  if (!names) return info;
  const mds = names.filter((n) => n.toLowerCase().endsWith('.md'));
  info.mdCount = mds.length;
  let titled = 0;
  for (const n of mds) {
    try {
      if (parseFrontmatter(fs.readFileSync(path.join(dir, n), 'utf8')).data.title) titled++;
    } catch { /* 单篇读取失败忽略 */ }
  }
  info.entryCount = titled;
  info.valid = titled > 0;
  if (!info.valid) info.error = mds.length ? '没有任何 .md 带 title frontmatter' : '没有 .md 笔记';
  return info;
}

// 封面目录：可选；填了就必须存在
function inspectCovers(dir) {
  if (!dir) return { path: '', exists: false, valid: true, optional: true, error: '' };
  const { info, names } = inspectDir(dir);
  if (!names) return info;
  info.imageCount = names.filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n)).length;
  info.valid = true;
  return info;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, '请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const parseBody = (body) => {
  try { return JSON.parse(body || '{}') || {}; } catch { throw httpError(400, '请求体不是合法的 JSON'); }
};

// 原子写入 config.json：先写临时文件再重命名，保留其他字段
function writeConfig(next) {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
  configMtime = fs.statSync(CONFIG_FILE).mtimeMs;
}

function notAbs(raw) {
  return { path: raw, exists: false, isDirectory: false, readable: false, valid: false, error: '不是绝对路径' };
}
function checkSources(body) {
  const b = parseBody(body);
  const e = cleanPath(b.entriesDir);
  const c = cleanPath(b.coversDir);
  if (!e) throw httpError(400, '请填写条目目录');
  const entries = isAbsoluteDir(e) ? inspectEntries(normPath(e)) : notAbs(e);
  const covers = !c ? inspectCovers('') : isAbsoluteDir(c) ? inspectCovers(normPath(c)) : notAbs(c);
  return { entries, covers, valid: entries.valid && covers.valid };
}

function saveSources(body) {
  const r = checkSources(body);
  if (!r.entries.valid) throw httpError(400, `条目目录「${r.entries.path}」${r.entries.error}`);
  if (!r.covers.valid) throw httpError(400, `封面目录「${r.covers.path}」${r.covers.error}`);
  let onDisk = {};
  try { onDisk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* 用内存配置兜底 */ }
  const next = { ...config, ...onDisk, entriesDir: r.entries.path, coversDir: r.covers.path };
  writeConfig(next);
  config = next;
  clearCache();
  console.log(`[sources] 数据源已更新：${r.entries.path} / ${r.covers.path || '（无封面目录）'}`);
  return r;
}

function sourcesInfo() {
  const s = currentSources();
  const entries = s.entriesDir ? inspectEntries(s.entriesDir) : { path: '', valid: false, error: '未配置条目目录' };
  const covers = inspectCovers(s.coversDir);
  return { entries, covers, valid: entries.valid && covers.valid };
}

// ---------- 条目库（笔记变化即自动重扫，缓存仅存内存） ----------
function getLibrary() {
  const { entriesDir, coversDir } = currentSources();
  const sig = dirSignature(entriesDir);
  if (cache && cache.sig === sig && cache.coversDir === coversDir) return cache.data;
  const data = scanLibrary(entriesDir, coversDir);
  cache = { sig, coversDir, data };
  return data;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));

// ---------- 封面（只读自库内 assets/covers） ----------
function serveCover(req, res, name) {
  const COVERS_DIR = currentSources().coversDir;
  if (!COVERS_DIR) return send(res, 404, 'no cover', 'text/plain');
  let decoded;
  try { decoded = decodeURIComponent(name); } catch { return send(res, 400, 'bad name', 'text/plain'); }
  if (!decoded || /[\\/:*?"<>|]/.test(decoded) || decoded.includes('..')) {
    return send(res, 400, 'bad name', 'text/plain');
  }
  const file = path.normalize(path.join(COVERS_DIR, decoded));
  if (!file.startsWith(COVERS_DIR + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'no cover', 'text/plain');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'image/jpeg',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- 静态文件 ----------
function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return send(res, 400, 'bad path', 'text/plain'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const p = u.pathname;
  try {
    if (p === '/api/entries') {
      const s = currentSources();
      let lib;
      try {
        lib = getLibrary();
      } catch (err) {
        // 条目目录缺失或不可读：返回空列表 + 错误标记，由前端显示空状态
        clearCache();
        return json(res, 200, {
          generatedAt: new Date().toISOString(),
          stats: computeStats([]),
          entries: [],
          sourceError: `条目目录不可用：${s.entriesDir || '（未配置）'}（${err.code || err.message}）`,
        });
      }
      return json(res, 200, { generatedAt: new Date().toISOString(), stats: lib.stats, entries: lib.entries });
    }
    if (p === '/api/sources') {
      if (req.method === 'POST') {
        saveSources(await readBody(req));
        return json(res, 200, { ok: true, ...sourcesInfo() });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      return json(res, 200, sourcesInfo());
    }
    if (p === '/api/sources/check') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
      return json(res, 200, checkSources(await readBody(req)));
    }
    if (p === '/api/ping') return json(res, 200, { ok: true, time: new Date().toISOString() });
    if (p.startsWith('/covers/')) return serveCover(req, res, p.slice('/covers/'.length));
    if (p.startsWith('/api/')) return send(res, 404, 'unknown api', 'text/plain');
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    return serveStatic(req, res, p);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[server] ${req.method} ${p}: ${err.message}`);
    return json(res, status, { error: String((err && err.message) || err) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请在 config.json 中更换 port，或用环境变量 AMBER_PORT 临时指定。`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const s = currentSources();
  console.log(`Amber · 琥珀已开馆  →  http://${HOST}:${PORT}`);
  console.log(`条目目录（只读）：${s.entriesDir || '（未配置）'}`);
  console.log(`封面目录（只读）：${s.coversDir || '（未配置）'}`);
  // start.bat 设置 AMBER_OPEN=1：服务真正开始监听后再打开浏览器，避免首次打开时连接被拒
  if (process.env.AMBER_OPEN === '1') {
    const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
    const cmd = IS_WIN ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    require('child_process').exec(cmd, (err) => { if (err) console.log(`请手动打开 ${url}`); });
  }
});
