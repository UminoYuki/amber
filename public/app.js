'use strict';
/* 琥珀 · 动漫观影档案 —— 前端逻辑。数据全部来自本机 /api/entries（Obsidian 库只读镜像）。 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------- 常量 ---------- */

const STATUS_ORDER = ['看完', '在看', '搁置', '弃坑'];
const STATUS_UI_COLOR = {
  '看完': 'var(--amber)',
  '在看': 'var(--status-watch)',
  '搁置': 'var(--status-hold)',
  '弃坑': 'var(--status-drop)',
};

const CARD_W = 900;
const CARD_H = 1200;
const CARD_SCALE = 2; // 导出 1800×2400

/* 和历：明治/大正/昭和/平成/令和 —— 年代感的注脚 */
function eraOf(year) {
  if (year == null) return '';
  if (year >= 2019) return `令和${year - 2018}年`;
  if (year >= 1989) return `平成${year - 1988}年`;
  if (year >= 1926) return `昭和${year - 1925}年`;
  if (year >= 1912) return `大正${year - 1911}年`;
  if (year >= 1868) return `明治${year - 1867}年`;
  return '';
}

function fmtStamp(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
}

function dotStyle(status) {
  return `background:${STATUS_UI_COLOR[status] || 'var(--faint)'}`;
}

/* ---------- 全局状态 ---------- */

const state = {
  entries: [],
  stats: null,
  generatedAt: '',
  view: localStorage.getItem('amber.view') || 'grid',
  status: localStorage.getItem('amber.status') || '全部',
  sort: localStorage.getItem('amber.sort') || 'year-desc',
  q: '',
  current: null, // 详情面板当前条目
};

const cardPref = { style: 'amber', fontScale: 1, era: true };
try { Object.assign(cardPref, JSON.parse(localStorage.getItem('amber.card') || '{}')); } catch {}
const saveCardPref = () => localStorage.setItem('amber.card', JSON.stringify(cardPref));

/* ---------- 数据加载 ---------- */

async function loadEntries() {
  const r = await fetch('/api/entries');
  const data = await r.json();
  state.sourceError = data.sourceError || '';
  $('#sourceEmpty').hidden = !state.sourceError;
  $('#sourceEmptyMsg').textContent = state.sourceError;
  state.entries = data.entries || [];
  state.stats = data.stats;
  state.generatedAt = data.generatedAt;
  renderStats();
  renderChips();
  render();
  const s = state.stats;
  $('#colophon').innerHTML =
    `档案只读自 Obsidian · 共 ${s.total} 条记录 · ` +
    `作品年份 ${s.yearMin ?? '—'} – ${s.yearMax ?? '—'} · 本次扫描 ${new Date(state.generatedAt).toLocaleTimeString('zh-CN')}<br>` +
    `对库零写入 · <span class="amber">琥珀 AMBER</span> · ${new Date().getFullYear()}`;
}

function renderStats() {
  const s = state.stats;
  const cell = (label, value) => `<div class="stat"><dd>${value}</dd><dt>${label}</dt></div>`;
  $('#stats').innerHTML = [
    cell('条目', s.total),
    cell('看完', s.byStatus['看完'] ?? 0),
    cell('在看', s.byStatus['在看'] ?? 0),
    cell('平均分', s.avgRating ?? '—'),
    cell('年代跨度', s.yearMin != null ? `${s.yearMin}<small>–</small>${s.yearMax}` : '—'),
  ].join('');
}

function renderChips() {
  const s = state.stats;
  const chips = ['全部', ...STATUS_ORDER.filter((k) => s.byStatus[k])];
  $('#statusChips').innerHTML = chips.map((k) => {
    const n = k === '全部' ? s.total : (s.byStatus[k] || 0);
    return `<button class="chip ${state.status === k ? 'on' : ''}" data-status="${esc(k)}">${esc(k)}<span class="n">${n}</span></button>`;
  }).join('');
}

/* ---------- 过滤与排序 ---------- */

function visibleEntries() {
  let list = state.entries;
  if (state.status !== '全部') list = list.filter((e) => e.status === state.status);
  const q = state.q.trim().toLowerCase();
  if (q) {
    list = list.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q)));
  }
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN');
  const sorters = {
    'year-desc': (a, b) => (b.year ?? -1) - (a.year ?? -1) || byTitle(a, b),
    'year-asc': (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b),
    'rating-desc': (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.year ?? 0) - (a.year ?? 0),
    'created-desc': (a, b) => String(b.created).localeCompare(String(a.created)) || byTitle(a, b),
    'title': byTitle,
  };
  return [...list].sort(sorters[state.sort] || sorters['year-desc']);
}

/* ---------- 海报墙 ---------- */

function coverHTML(e, alt) {
  // 优先本地封面；无本地封面时尝试 Bangumi 原图，加载失败由全局兜底换成占位
  const src = e.cover || e.coverUrl;
  if (src) {
    return `<img loading="lazy" src="${esc(src)}" alt="${esc(alt)}" referrerpolicy="no-referrer">`;
  }
  return `<div class="cover-ph">${esc(e.title.slice(0, 1))}</div>`;
}

// 图片加载失败统一兜底：换成首字占位块
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.phDone) return;
  img.dataset.phDone = '1';
  const ph = document.createElement('div');
  ph.className = img.classList.contains('thumb') ? 'thumb-ph' : 'cover-ph';
  ph.textContent = (img.alt || img.title || '?').slice(0, 1);
  img.replaceWith(ph);
}, true);

function renderGrid(list) {
  $('#gridView').innerHTML = list.map((e) => `
    <article class="card" data-id="${esc(e.id)}">
      <div class="cover">
        ${coverHTML(e, e.title)}
        ${e.rating != null ? `<span class="rate">★ ${esc(e.rating)}</span>` : ''}
      </div>
      <h3 title="${esc(e.title)}">${esc(e.title)}</h3>
      <div class="meta">
        <span class="dot" style="${dotStyle(e.status)}"></span>
        <span>${e.year ?? '—'}${e.episodes ? ` · ${e.episodes}话` : ''}</span>
      </div>
    </article>`).join('');
}

/* ---------- 年代长廊 ---------- */

function renderTimeline(list) {
  const withYear = list.filter((e) => e.year != null);
  const noYear = list.filter((e) => e.year == null);
  const groups = new Map(); // year -> entries（已按年份排好序）
  for (const e of withYear) {
    if (!groups.has(e.year)) groups.set(e.year, []);
    groups.get(e.year).push(e);
  }
  const parts = [];
  let lastDecade = null;
  for (const [year, items] of groups) {
    const decade = `${Math.floor(year / 10) * 10}s`;
    if (decade !== lastDecade) {
      parts.push(`<div class="decade">${decade}</div>`);
      lastDecade = decade;
    }
    const era = eraOf(year);
    parts.push(`<div class="yearblock">
      <div class="yearlabel">${year}${era ? `<small>${esc(era)}</small>` : ''}</div>
      <div class="yearlist">${items.map(timelineRow).join('')}</div>
    </div>`);
  }
  if (noYear.length) {
    parts.push(`<div class="decade">年份未知</div><div class="yearlist">${noYear.map(timelineRow).join('')}</div>`);
  }
  $('#timelineView').innerHTML = parts.join('');
}

function timelineRow(e) {
  const era = eraOf(e.year);
  const thumb = e.cover
    ? `<img class="thumb" loading="lazy" src="${esc(e.cover)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="thumb-ph">${esc(e.title.slice(0, 1))}</span>`;
  const snip = e.review
    ? `<div class="tsnip">${esc(e.review)}</div>`
    : `<div class="tsnip no">未留下短评</div>`;
  return `
    <div class="trow" data-id="${esc(e.id)}">
      ${thumb}
      <div class="tmain">
        <div class="ttitle">${esc(e.title)}</div>
        ${snip}
      </div>
      <div class="tmeta">
        ${e.rating != null ? `<span class="r">★${esc(e.rating)}</span> · ${esc(e.status)}` : esc(e.status)}<br>
        <span class="stamp">${e.year ?? ''}${era ? ' ' + esc(era) : ''} · 记录于 ${esc(e.created)}</span>
      </div>
    </div>`;
}

/* ---------- 渲染调度 ---------- */

function render() {
  const list = visibleEntries();
  $('#emptyState').hidden = list.length > 0 || !!state.sourceError;
  if (state.view === 'grid') {
    $('#timelineView').hidden = true;
    $('#gridView').hidden = false;
    renderGrid(list);
  } else {
    $('#gridView').hidden = true;
    $('#timelineView').hidden = false;
    renderTimeline(list);
  }
}

/* ---------- 详情 ---------- */

function openDetail(e) {
  state.current = e;
  const era = eraOf(e.year);
  const metaItem = (k, v, cls = '') =>
    `<div class="meta-item"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  $('#detailPanel').innerHTML = `
    <button class="dclose" id="dClose" title="关闭">✕</button>
    <div class="dcover">${coverHTML(e, e.title)}</div>
    <div class="dbody">
      <h2>${esc(e.title)}</h2>
      <p class="era-line">${e.year ?? '年份未知'}${era ? ' · ' + esc(era) : ''}${e.favorite ? ' · ♥ 心头好' : ''}</p>
      <div class="meta-grid">
        ${metaItem('状态', esc(e.status || '—'))}
        ${metaItem('我的评分', e.rating != null ? `★ ${esc(e.rating)}` : '未评分', e.rating != null ? 'score' : '')}
        ${e.episodes ? metaItem('集数', `${e.episodes} 话`) : ''}
        ${metaItem('来源', esc(e.source || '—'))}
      </div>
      ${e.tags.length ? `<div class="tagrow">${e.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${e.review ? `<div class="review-h">短 评</div><div class="review-block">${esc(e.review)}</div>` : ''}
      ${e.memory ? `<div class="memory-h">记忆点</div><div class="memory-block">${esc(e.memory)}</div>` : ''}
      <div class="dstamp">
        <span class="amber">记录于 ${esc(fmtStamp(e.created))}</span>${e.updated && e.updated !== e.created ? ` · 更新于 ${esc(fmtStamp(e.updated))}` : ''}<br>
        ${e.externalId ? `Bangumi #${esc(e.externalId)} · ` : ''}${esc(e.link || '')}
      </div>
      <div class="dactions">
        <button class="primary-btn" id="dCard">制 卡</button>
        ${e.link ? `<a class="outline-btn" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">Bangumi 页面 ↗</a>` : ''}
      </div>
    </div>`;
  $('#detailBackdrop').hidden = false;
  document.body.classList.add('locked');
  $('#dClose').addEventListener('click', closeDetail);
  $('#dCard').addEventListener('click', () => openCardDesigner(e));
  $('#detailPanel .dbody').scrollTop = 0;
}

function closeDetail() {
  $('#detailBackdrop').hidden = true;
  if ($('#cardBackdrop').hidden) document.body.classList.remove('locked');
}

/* ---------- 制卡 ---------- */

// 字体栈用单引号：卡片 HTML 会序列化进 SVG 的双引号属性里，双引号会破坏 XML
const CARD_SERIF = `Georgia, 'Songti SC', 'STZhongsong', 'SimSun', serif`;
const CARD_MONO = `'Cascadia Mono', Consolas, 'Courier New', monospace`;

function cardCoverBlock(e, o, style) {
  // 注意：卡片 HTML 会被序列化进 SVG foreignObject 走 XML 解析，img 必须自闭合（<img/>），
  // 否则导出时整张 SVG 加载失败（onerror）。
  const inner = o.coverUrl
    ? `<img src="${o.coverUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" referrerpolicy="no-referrer" />`
    : `<div style="width:100%;height:100%;display:grid;place-items:center;font-family:${CARD_SERIF};font-size:120px;color:rgba(217,164,65,0.3);background:${style === 'light' ? '#e9e2d0' : '#221e17'};">${esc(e.title.slice(0, 1))}</div>`;
  return { inner };
}

function cardReviewHTML(e, o, color, emptyColor) {
  const fs = (18 * o.fontScale).toFixed(1);
  if (!e.review) {
    return `<p data-cardtext="1" style="margin:0;font-size:15px;line-height:2.1;color:${emptyColor};font-style:italic;">—— 未留下短评 ——</p>`;
  }
  return `<p data-cardtext="1" style="margin:0;font-size:${fs}px;line-height:2.05;color:${color};text-align:justify;">${esc(e.review)}</p>`;
}

function cardMetaLine(e) {
  const parts = [e.status || '—'];
  if (e.rating != null) parts.push(`★ ${e.rating}`);
  if (e.episodes) parts.push(`全${e.episodes}话`);
  if (e.source) parts.push(e.source);
  return parts.join(' · ');
}

/* 样式一：琥珀夜 —— 深底金边，作品年份作巨影 */
function renderAmberCard(e, o) {
  const { inner } = cardCoverBlock(e, o, 'dark');
  const era = o.era && e.year ? eraOf(e.year) : '';
  return `
  <div style="width:${CARD_W}px;height:${CARD_H}px;position:relative;background:#161310;overflow:hidden;font-family:${CARD_SERIF};">
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse 940px 520px at 50% -90px, rgba(217,164,65,0.16), transparent 70%);"></div>
    <div style="position:absolute;inset:22px;border:1px solid rgba(217,164,65,0.3);"></div>
    <div style="position:absolute;top:44px;left:44px;right:44px;height:600px;background:#221e17;overflow:hidden;">${inner}
      <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(to top, #161310, rgba(22,19,16,0));"></div>
    </div>
    <div style="position:absolute;top:648px;right:36px;font-size:150px;line-height:1;color:rgba(217,164,65,0.09);font-family:${CARD_SERIF};">${e.year ?? ''}</div>
    <div style="position:absolute;top:668px;left:44px;right:44px;">
      <div style="font-family:${CARD_MONO};font-size:15px;font-weight:600;letter-spacing:0.18em;color:#d9a441;">${e.year ?? '年份未知'}${era ? ' · ' + esc(era) : ''}</div>
      <div style="margin-top:10px;font-size:40px;font-weight:700;line-height:1.4;color:#f2e9d4;max-height:112px;overflow:hidden;">${esc(e.title)}</div>
    </div>
    <div style="position:absolute;top:812px;left:44px;right:44px;font-family:${CARD_MONO};font-size:15.5px;font-weight:600;letter-spacing:0.12em;color:#b3a98f;">${esc(cardMetaLine(e))}</div>
    <div style="position:absolute;top:848px;left:44px;right:44px;bottom:118px;overflow:hidden;">
      ${cardReviewHTML(e, o, '#d8cdb2', '#6b6558')}
    </div>
    <div style="position:absolute;left:44px;right:44px;bottom:76px;border-top:1px solid rgba(217,164,65,0.25);"></div>
    <div style="position:absolute;left:44px;bottom:38px;font-family:${CARD_MONO};font-size:14px;font-weight:600;letter-spacing:0.1em;color:#9a8f73;">记录于 ${esc(fmtStamp(e.created))}</div>
    <div style="position:absolute;right:44px;bottom:38px;font-family:${CARD_MONO};font-size:14px;font-weight:600;letter-spacing:0.22em;color:#d9a441;">琥珀 · AMBER</div>
  </div>`;
}

/* 样式二：胶片帧 —— 纸底片孔，放映室的记忆 */
function renderFilmCard(e, o) {
  const { inner } = cardCoverBlock(e, o, 'light');
  const era = o.era && e.year ? eraOf(e.year) : '';
  const frameNo = String(e.externalId || '').padStart(3, '0') || '——';
  const holes = 'repeating-linear-gradient(to bottom, #f2eee4 0 20px, transparent 20px 44px)';
  return `
  <div style="width:${CARD_W}px;height:${CARD_H}px;position:relative;background:#f2eee4;overflow:hidden;font-family:${CARD_SERIF};">
    <div style="position:absolute;top:0;bottom:0;left:0;width:62px;background:#17150f;">
      <div style="position:absolute;top:16px;bottom:16px;left:15px;width:32px;border-radius:4px;background:${holes};"></div>
    </div>
    <div style="position:absolute;top:0;bottom:0;right:0;width:10px;background:#17150f;"></div>
    <div style="position:absolute;top:56px;left:110px;width:720px;height:560px;background:#17150f;padding:9px;">${inner}</div>
    <div style="position:absolute;top:652px;left:110px;right:60px;text-align:center;">
      <div style="font-family:${CARD_MONO};font-size:15px;font-weight:600;letter-spacing:0.3em;color:#9a6a10;">${e.year ?? '年份未知'}${era ? ' · ' + esc(era) : ''}</div>
      <div style="margin-top:10px;font-size:38px;font-weight:700;line-height:1.45;color:#221f18;max-height:112px;overflow:hidden;">${esc(e.title)}</div>
    </div>
    <div style="position:absolute;top:800px;left:110px;right:60px;text-align:center;font-family:${CARD_MONO};font-size:15px;font-weight:600;letter-spacing:0.1em;color:#5f5849;">${esc(cardMetaLine(e))}</div>
    <div style="position:absolute;top:842px;left:150px;right:100px;bottom:110px;overflow:hidden;">
      ${cardReviewHTML(e, o, '#454032', '#a49b86')}
    </div>
    <div style="position:absolute;left:110px;right:60px;bottom:74px;border-top:1px solid rgba(60,50,30,0.25);"></div>
    <div style="position:absolute;left:110px;bottom:36px;font-family:${CARD_MONO};font-size:13.5px;font-weight:600;letter-spacing:0.14em;color:#6f6754;">FRAME ${esc(frameNo)} · 记录于 ${esc(fmtStamp(e.created))}</div>
    <div style="position:absolute;right:60px;bottom:36px;font-family:${CARD_MONO};font-size:13.5px;font-weight:600;letter-spacing:0.2em;color:#9a6a10;">琥珀 · AMBER</div>
  </div>`;
}

/* 样式三：素笺 —— 大面积留白，一页手记 */
function renderPaperCard(e, o) {
  const { inner } = cardCoverBlock(e, o, 'light');
  const era = o.era && e.year ? eraOf(e.year) : '';
  return `
  <div style="width:${CARD_W}px;height:${CARD_H}px;position:relative;background:#fbfaf6;overflow:hidden;font-family:${CARD_SERIF};">
    <div style="position:absolute;inset:26px;border:1px solid #ddd5c2;"></div>
    <div style="position:absolute;top:70px;left:70px;width:300px;height:450px;overflow:hidden;box-shadow:0 10px 30px rgba(90,75,45,0.18);">${inner}</div>
    <div style="position:absolute;top:104px;left:410px;right:70px;">
      <div style="font-family:${CARD_MONO};font-size:15px;font-weight:600;letter-spacing:0.24em;color:#9a6a10;">${e.year ?? '年份未知'}${era ? ' · ' + esc(era) : ''}</div>
      <div style="margin-top:14px;font-size:38px;font-weight:700;line-height:1.5;color:#262218;max-height:200px;overflow:hidden;">${esc(e.title)}</div>
      <div style="margin-top:16px;font-family:${CARD_MONO};font-size:15px;font-weight:600;letter-spacing:0.1em;color:#5f5849;">${esc(cardMetaLine(e))}</div>
    </div>
    <div style="position:absolute;top:590px;left:70px;right:70px;bottom:130px;overflow:hidden;">
      ${cardReviewHTML(e, o, '#4d4636', '#a49b86')}
    </div>
    <div style="position:absolute;left:70px;right:70px;bottom:86px;border-top:1px solid #ddd5c2;"></div>
    <div style="position:absolute;left:70px;bottom:46px;font-family:${CARD_MONO};font-size:13.5px;font-weight:600;letter-spacing:0.12em;color:#6f6754;">记录于 ${esc(fmtStamp(e.created))}</div>
    <div style="position:absolute;right:70px;bottom:46px;font-family:${CARD_MONO};font-size:13.5px;font-weight:600;letter-spacing:0.2em;color:#9a6a10;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d9a441;margin-right:8px;"></span>琥珀 · AMBER</div>
  </div>`;
}

const CARD_STYLES = [
  { id: 'amber', name: '琥珀夜', render: renderAmberCard },
  { id: 'film', name: '胶片帧', render: renderFilmCard },
  { id: 'paper', name: '素笺', render: renderPaperCard },
];

const coverDataCache = new Map();

async function coverDataUrl(e) {
  if (!e.cover) return '';
  if (coverDataCache.has(e.id)) return coverDataCache.get(e.id);
  try {
    const r = await fetch(e.cover);
    if (!r.ok) throw new Error('no cover');
    const blob = await r.blob();
    const url = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('read fail'));
      fr.readAsDataURL(blob);
    });
    coverDataCache.set(e.id, url);
    return url;
  } catch {
    coverDataCache.set(e.id, '');
    return '';
  }
}

/* 离屏量尺：与卡面完全一致的 900×1200 环境检测文字溢出 */
let cardProbe = null;
function cardTextOverflows(html) {
  if (!cardProbe) {
    cardProbe = document.createElement('div');
    cardProbe.style.cssText =
      'position:fixed;left:-30000px;top:0;width:900px;height:1200px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(cardProbe);
  }
  cardProbe.innerHTML = html;
  const el = cardProbe.querySelector('[data-cardtext]');
  if (!el) return false;
  const box = el.parentElement || el;
  return box.scrollHeight > box.clientHeight + 2 || box.scrollWidth > box.clientWidth + 2;
}

const designer = { entry: null, html: '', autoNote: '' };

async function renderCardDesigner() {
  const e = designer.entry;
  if (!e) return;
  const wrap = $('#cardStageWrap');
  $('#cardStyles').innerHTML = CARD_STYLES.map((c) =>
    `<button class="${cardPref.style === c.id ? 'on' : ''}" data-cstyle="${c.id}">${c.name}</button>`).join('');

  const coverUrl = await coverDataUrl(e);
  const def = CARD_STYLES.find((c) => c.id === cardPref.style) || CARD_STYLES[0];
  const o = { coverUrl, fontScale: cardPref.fontScale, era: cardPref.era };

  let scale = cardPref.fontScale;
  let auto = false;
  designer.html = def.render(e, { ...o, fontScale: scale });
  while (scale > 0.6 && cardTextOverflows(designer.html)) {
    scale = Math.max(0.6, Math.round((scale - 0.05) * 100) / 100);
    designer.html = def.render(e, { ...o, fontScale: scale });
    auto = true;
  }
  designer.autoNote = auto
    ? `短评较长，已自动缩至 ${Math.round(scale * 100)}% 保证完整呈现` : '';
  $('#cdFsHint').textContent = designer.autoNote;

  const fit = Math.max(0.1, Math.min(
    (wrap.clientWidth - 48) / CARD_W,
    (wrap.clientHeight - 48) / CARD_H,
  ));
  const stage = $('#cardStage');
  stage.style.width = CARD_W * fit + 'px';
  stage.style.height = CARD_H * fit + 'px';
  stage.innerHTML = `<div class="cd-fit" style="width:${CARD_W}px;height:${CARD_H}px;transform:scale(${fit});transform-origin:top left;">${designer.html}</div>`;
}

async function openCardDesigner(e) {
  designer.entry = e;
  $('#cdTitle').textContent = e.title;
  // 控件只在打开时初始化一次；之后重渲染不回写滑杆，避免打断拖动
  $('#cdFs').value = Math.round(cardPref.fontScale * 100);
  $('#cdFsOut').textContent = Math.round(cardPref.fontScale * 100) + '%';
  $('#cdEra').checked = !!cardPref.era;
  $('#cardBackdrop').hidden = false;
  document.body.classList.add('locked');
  await renderCardDesigner();
}

function closeCardDesigner() {
  $('#cardBackdrop').hidden = true;
  if ($('#detailBackdrop').hidden) document.body.classList.remove('locked');
}

/* DOM 卡片 → SVG foreignObject → canvas → PNG */
async function buildCardBlob() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W * CARD_SCALE}" height="${CARD_H * CARD_SCALE}" viewBox="0 0 ${CARD_W} ${CARD_H}">
<foreignObject width="${CARD_W}" height="${CARD_H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${CARD_W}px;height:${CARD_H}px;overflow:hidden;margin:0;">${designer.html}</div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('卡片渲染失败'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * CARD_SCALE;
  canvas.height = CARD_H * CARD_SCALE;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((res) => canvas.toBlob(res, 'image/png'));
}

async function downloadCard() {
  const e = designer.entry;
  if (!e) return;
  const btn = $('#cdDownload');
  btn.disabled = true;
  btn.textContent = '正在生成…';
  try {
    const blob = await buildCardBlob();
    const safeName = e.title.replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `琥珀·${safeName}·记录于${e.created}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    alert(`导出失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出 PNG（1800 × 2400）';
  }
}

/* ---------- 事件 ---------- */

function bindEvents() {
  $('#viewSwitch').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    localStorage.setItem('amber.view', state.view);
    $$('#viewSwitch button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });

  $('#statusChips').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-status]');
    if (!b) return;
    state.status = b.dataset.status;
    localStorage.setItem('amber.status', state.status);
    $$('#statusChips .chip').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });

  $('#sortSel').addEventListener('change', (ev) => {
    state.sort = ev.target.value;
    localStorage.setItem('amber.sort', state.sort);
    render();
  });

  let searchTimer = null;
  $('#searchInput').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = ev.target.value; render(); }, 160);
  });

  const main = $('#main');
  main.addEventListener('click', (ev) => {
    const card = ev.target.closest('[data-id]');
    if (!card) return;
    const entry = state.entries.find((x) => x.id === card.dataset.id);
    if (entry) openDetail(entry);
  });

  $('#detailBackdrop').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) closeDetail();
  });

  $('#cardBackdrop').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) closeCardDesigner();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!$('#srcBackdrop').hidden) openSource(false);
      else if (!$('#cardBackdrop').hidden) closeCardDesigner();
      else if (!$('#detailBackdrop').hidden) closeDetail();
    }
  });

  $('#cardStyles').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-cstyle]');
    if (!b) return;
    cardPref.style = b.dataset.cstyle;
    saveCardPref();
    renderCardDesigner();
  });

  $('#cdFs').addEventListener('input', (ev) => {
    cardPref.fontScale = Number(ev.target.value) / 100;
    $('#cdFsOut').textContent = ev.target.value + '%';
    saveCardPref();
    renderCardDesigner();
  });

  $('#cdEra').addEventListener('change', (ev) => {
    cardPref.era = ev.target.checked;
    saveCardPref();
    renderCardDesigner();
  });

  $('#cdDownload').addEventListener('click', downloadCard);
  $('#cdClose').addEventListener('click', closeCardDesigner);

  const savedTheme = localStorage.getItem('amber.theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('amber.theme', next);
  });
}

/* ---------- 数据源 ---------- */

const src = { checked: null, busy: false };

function srcTag(ok, text) {
  return `<span class="src-tag ${ok ? 'ok' : 'no'}">${esc(text)}</span>`;
}
function srcInfoHtml(label, info) {
  if (!info) return '';
  if (info.optional && !info.path) return `<div class="src-row"><b>${label}</b><span class="src-path">（未设置，封面将回退到远程图或占位）</span></div>`;
  const tags = [];
  if (info.readable) {
    if (info.mdCount != null) {
      tags.push(srcTag(info.entryCount > 0, `条目 ${info.entryCount} 篇`));
      tags.push(srcTag(true, `.md 共 ${info.mdCount} 个`));
    }
    if (info.imageCount != null) tags.push(srcTag(info.imageCount > 0, `图片 ${info.imageCount} 张`));
  }
  return `<div class="src-row"><b>${label}</b><span class="src-path">${esc(info.path || '—')}</span></div>
    ${tags.length ? `<div class="src-tags">${tags.join('')}</div>` : ''}
    ${info.error ? `<p class="src-msg err">${esc(info.error)}</p>` : ''}`;
}
function srcSummary(d) {
  return srcInfoHtml('条目', d.entries) + srcInfoHtml('封面', d.covers);
}
function srcMsg(text, kind) {
  const el = $('#srcMsg');
  el.textContent = text || '';
  el.className = 'src-msg' + (kind ? ' ' + kind : '');
}
async function srcApi(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
const srcInputs = () => ({ entriesDir: $('#srcEntries').value.trim(), coversDir: $('#srcCovers').value.trim() });
function srcSync() {
  const v = srcInputs();
  const key = v.entriesDir + '\n' + v.coversDir;
  $('#srcCheck').disabled = src.busy || !v.entriesDir;
  $('#srcSave').disabled = src.busy || !(src.checked && src.checked.valid && src.checked.key === key);
}
async function loadSource() {
  try {
    const d = await srcApi('/api/sources');
    $('#srcCurrent').innerHTML = srcSummary(d);
    if (!$('#srcEntries').value) $('#srcEntries').value = d.entries.path || '';
    if (!$('#srcCovers').value) $('#srcCovers').value = d.covers.path || '';
    srcSync();
  } catch (err) {
    $('#srcCurrent').textContent = '读取失败：' + err.message;
  }
}
function openSource(open) {
  $('#srcBackdrop').hidden = !open;
  if (open) { srcMsg(''); loadSource(); srcSync(); $('#srcEntries').focus(); }
}
async function checkSource() {
  const v = srcInputs();
  if (!v.entriesDir) return;
  src.busy = true; srcSync(); srcMsg('检测中…');
  try {
    const d = await srcApi('/api/sources/check', v);
    d.key = v.entriesDir + '\n' + v.coversDir;
    src.checked = d;
    $('#srcResult').hidden = false;
    $('#srcResult').innerHTML = srcSummary(d);
    srcMsg(d.valid ? '目录可用，点「保存并重新载入」生效' : '这组目录不能用', d.valid ? 'ok' : 'err');
  } catch (err) {
    src.checked = null;
    srcMsg(err.message, 'err');
  } finally {
    src.busy = false; srcSync();
  }
}
async function saveSource() {
  if (!src.checked || !src.checked.valid) return;
  src.busy = true; srcSync(); srcMsg('保存中…');
  try {
    await srcApi('/api/sources', { entriesDir: src.checked.entries.path, coversDir: src.checked.covers.path });
    srcMsg('已保存，正在重新载入…', 'ok');
    setTimeout(() => location.reload(), 500);
  } catch (err) {
    srcMsg(err.message, 'err');
    src.busy = false; srcSync();
  }
}
function setupSource() {
  $('#srcBtn').addEventListener('click', () => openSource(true));
  $('#sourceEmptyBtn').addEventListener('click', () => openSource(true));
  $('#srcClose').addEventListener('click', () => openSource(false));
  $('#srcBackdrop').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) openSource(false); });
  ['#srcEntries', '#srcCovers'].forEach((id) => {
    $(id).addEventListener('input', srcSync);
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') checkSource(); });
  });
  $('#srcCheck').addEventListener('click', checkSource);
  $('#srcSave').addEventListener('click', saveSource);
}

/* ---------- 启动 ---------- */

$$('#viewSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
$('#sortSel').value = state.sort;
bindEvents();
setupSource();
loadEntries().catch((err) => {
  $('#colophon').textContent = `数据加载失败：${err.message}（请确认 server.js 正在运行）`;
});
