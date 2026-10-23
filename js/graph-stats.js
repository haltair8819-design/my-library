/* 나의 서재 — 키워드 그물망 · 통계
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   6단계: 키워드 그물망 · 통계
   =================================================================== */
const splitKw = v => String(v || '').split(',').map(k => k.trim()).filter(Boolean);
const splitAuthors = v => String(v || '').split(/\s*,\s*/).map(a => a.replace(/\(.*?\)/g, '').trim()).filter(Boolean);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- 그물망 ---------- */
const G = { nodes: [], edges: [], byId: {}, nb: {}, scale: 1, ox: 0, oy: 0, sel: null,
  mode: 'topic', top: 40, focus: null, hl: null, q: '',
  opt: { au: false, cat: false }, ptr: new Map(), drag: null, moved: 0,
  cfg: { rep: 1200, grav: 0.03, len: 34, k: 0.05, cut: 110 } };
const CFG = {
  topic: { rep: 2600, grav: 0.022, len: 58, k: 0.035, cut: 190 },
  book: { rep: 1400, grav: 0.03, len: 36, k: 0.05, cut: 120 },
  focus: { rep: 3200, grav: 0.03, len: 74, k: 0.04, cut: 240 }
};
// 검증한 8색 (밝은 화면 / 어두운 화면). 주제 묶음 크기 순서대로 고정, 9번째부터는 회색
const CLUSTER_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] };

function keywordStats() {
  const m = {};
  S.snips.forEach(s => splitKw(s['키워드']).forEach(k => {
    m[k] = m[k] || { kw: k, n: 0, books: new Set() };
    m[k].n++; m[k].books.add(s['책ID']);
  }));
  return Object.values(m).sort((a, b) => b.n - a.n || b.books.size - a.books.size);
}

/* 기간 고르기 (v2.12.1): 전체 · 연도 · 월 — 그 책을 읽은 때(완독일, 없으면 시작일) 기준 */
G.period = { y: '', m: '' };
// 날짜가 없는 책(시작일 · 완독일 둘 다 없음)은 기간을 고르면 빠지고, '전체'에서만 보여요
const bookDay = b => String((b && (b['완독일'] || b['시작일'])) || '').slice(0, 10);
const snipDay = s => bookDay(book(s['책ID']));
const gPrefix = () => G.period.y ? (G.period.m ? `${G.period.y}-${G.period.m}` : G.period.y) : '';
function gSnips() { const p = gPrefix(); return p ? S.snips.filter(s => snipDay(s).startsWith(p)) : S.snips; }
function gBooks() { const p = gPrefix(); return p ? S.books.filter(b => bookDay(b).startsWith(p)) : S.books; }
function gYears() { return uniq(S.snips.map(s => snipDay(s).slice(0, 4)).filter(y => /^\d{4}$/.test(y))).sort().reverse(); }
function gPeriodHtml() {
  const ys = gYears(), y = G.period.y;
  const months = y ? uniq(S.snips.map(snipDay).filter(d => d.startsWith(y)).map(d => d.slice(5, 7)).filter(Boolean)).sort() : [];
  return `<div class="g-period"><span>기간</span>
    <select class="field" onchange="gSetPeriod(this.value, '')"><option value="">전체</option>${ys.map(x => `<option value="${x}" ${x === y ? 'selected' : ''}>${x}년</option>`).join('')}</select>
    <select class="field" ${y ? '' : 'disabled'} onchange="gSetPeriod('${y}', this.value)"><option value="">${y ? '1년 전체' : '월'}</option>${months.map(m => `<option value="${m}" ${m === G.period.m ? 'selected' : ''}>${Number(m)}월</option>`).join('')}</select>
    <em>${y ? `문장 ${gSnips().length.toLocaleString()}개` : ''}</em></div>`;
}
function gSetPeriod(y, m) { G.period = { y, m }; G.focus = null; G.sel = null; G.hl = null; S.gLimit = 30; renderGraphView(); }

/* 키워드끼리 얼마나 함께 나오나 + 주제 묶음 (데이터가 바뀔 때만 다시 계산) */
let TOPIC = null, TOPIC_KEY = '';
function topicData() {
  const SN = gSnips();
  const key = gPrefix() + '|' + SN.length + ':' + SN.reduce((t, s) => t + String(s['키워드'] || '').length, 0);
  if (TOPIC && TOPIC_KEY === key) return TOPIC;
  const cnt = {}, co = {}, kwBooks = {}, bookKw = {};
  SN.forEach(s => {
    const ks = uniq(splitKw(s['키워드'])); const bid = s['책ID'];
    ks.forEach(k => { cnt[k] = (cnt[k] || 0) + 1; (kwBooks[k] = kwBooks[k] || {})[bid] = (kwBooks[k][bid] || 0) + 1; (bookKw[bid] = bookKw[bid] || {})[k] = (bookKw[bid][k] || 0) + 1; });
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const [a, b] = [ks[i], ks[j]].sort(); const kk = a + '\u0001' + b; co[kk] = (co[kk] || 0) + 1;
    }
  });
  // 연관 강도: 함께 나온 횟수를 두 키워드 크기로 나눠서, '사랑'처럼 어디에나 있는 말이 모두를 삼키지 않게
  const nb = {}; Object.keys(cnt).forEach(k => nb[k] = {});
  const addW = (a, b, w) => { nb[a][b] = (nb[a][b] || 0) + w; nb[b][a] = (nb[b][a] || 0) + w; };
  Object.entries(co).forEach(([kk, w]) => { const [a, b] = kk.split('\u0001'); addW(a, b, w / Math.sqrt(cnt[a] * cnt[b])); });
  Object.values(bookKw).forEach(m => { const ks = Object.keys(m); if (ks.length > 40) return;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) addW(ks[i], ks[j], 0.15 / Math.sqrt(cnt[ks[i]] * cnt[ks[j]])); });
  // 주제 묶기 (모듈성 최대화 한 단계)
  const ks = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b));
  const deg = {}; ks.forEach(k => deg[k] = Object.values(nb[k]).reduce((a, b) => a + b, 0));
  const m2 = ks.reduce((t, k) => t + deg[k], 0) || 1;
  const com = {}, tot = {}; ks.forEach(k => { com[k] = k; tot[k] = deg[k]; });
  for (let it = 0, moved = true; moved && it < 30; it++) {
    moved = false;
    ks.forEach(k => {
      const cur = com[k], links = {};
      Object.entries(nb[k]).forEach(([o, w]) => links[com[o]] = (links[com[o]] || 0) + w);
      tot[cur] -= deg[k];
      let best = cur, gain = (links[cur] || 0) - tot[cur] * deg[k] / m2;
      Object.entries(links).forEach(([c, w]) => { const g = w - tot[c] * deg[k] / m2; if (g > gain + 1e-9) { gain = g; best = c; } });
      tot[best] += deg[k]; if (best !== cur) { com[k] = best; moved = true; }
    });
  }
  const groups = {}; ks.forEach(k => { if (deg[k] > 0) (groups[com[k]] = groups[com[k]] || []).push(k); });
  let cl = Object.values(groups).map(g => ({ kws: g, size: g.reduce((t, k) => t + cnt[k], 0) }));
  // 색은 8개뿐이라, 작은 묶음은 가장 많이 이어진 묶음에 합쳐서 8개 이하로
  while (cl.length > 8) {
    cl.sort((a, b) => a.size - b.size);
    const small = cl.shift(), inSmall = new Set(small.kws);
    let best = null, bw = -1;
    cl.forEach(c => { let w = 0; c.kws.forEach(k => small.kws.forEach(o => { w += (nb[k][o] || 0); })); if (w > bw) { bw = w; best = c; } });
    best.kws = best.kws.concat(small.kws); best.size += small.size;
  }
  const loners = ks.filter(k => !(deg[k] > 0));   // 다른 키워드와 한 번도 같이 안 나온 것 → 회색
  const clusters = cl.map(c => ({ kws: c.kws.sort((a, b) => cnt[b] - cnt[a]), size: c.size }))
    .sort((a, b) => b.size - a.size || a.kws[0].localeCompare(b.kws[0]));
  if (loners.length) clusters.push({ kws: loners, size: 0, loners: true });
  const clusterOf = {}; clusters.forEach((c, i) => { c.i = c.loners ? 99 : i; c.kws.forEach(k => clusterOf[k] = c.i); });
  TOPIC = { cnt, co, nb, kwBooks, bookKw, clusters, clusterOf, ranked: ks }; TOPIC_KEY = key;
  return TOPIC;
}
function coCount(a, b) { const T = topicData(); const [x, y] = [a, b].sort(); return T.co[x + '\u0001' + y] || 0; }
function clusterColor(i) {
  const pal = CLUSTER_COLORS[document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'];
  return i != null && i < 8 ? pal[i] : cssVar('--faint');
}
function relatedKw(k, n) {
  const T = topicData();
  return Object.keys(T.nb[k] || {}).map(o => ({ k: o, c: coCount(k, o), w: T.nb[k][o] }))
    .filter(x => x.c > 0).sort((a, b) => b.c - a.c || b.w - a.w).slice(0, n);
}

function renderGraphView() {
  const T = topicData();
  const hasKw = T.ranked.length > 0;
  if (!hasKw && G.mode === 'topic') G.mode = 'book';
  const tops = [[30, '30개'], [60, '60개'], [0, '전체']];
  const focusNode = G.focus ? graphLabel(G.focus) : '';
  $('v-graph').innerHTML = `
    <div class="view-head ai-head"><div><h1>그물망</h1><p>${G.period.y ? `<b>${G.period.y}년${G.period.m ? ' ' + Number(G.period.m) + '월' : ''}</b>에 읽은 책만 · ` : ''}${G.focus ? `<b>${esc(focusNode)}</b>과 이어진 것만 보고 있어요.` : G.mode === 'topic' ? '함께 자주 나오는 키워드끼리 이어지고, 비슷한 주제는 같은 색이에요.' : '책과 키워드가 어떻게 이어지는지 보여줘요.'}</p></div>
      <button class="btn" onclick="openKwManager()">키워드 정리</button></div>
    <div class="g-search"><input class="field" id="g-q" placeholder="키워드 · 책 찾기" value="${esc(G.q)}" autocomplete="off"><div id="g-sug" class="g-sug"></div></div>
    ${G.focus ? `<div class="chips"><button class="chip on" onclick="gUnfocus()">← 전체 지도로</button></div>` : `
    <div class="chips" id="g-modes">
      <button class="chip ${G.mode === 'topic' ? 'on' : ''}" data-m="topic">주제 지도</button>
      <button class="chip ${G.mode === 'book' ? 'on' : ''}" data-m="book">책과 주제</button>
      <span class="g-sep"></span>
      ${tops.map(([n, t]) => `<button class="chip ${G.top === n ? 'on' : ''}" data-top="${n}">${t}</button>`).join('')}
      ${G.mode === 'book' ? `<span class="g-sep"></span>${[['au', '저자'], ['cat', '개인분류']].map(([k, t]) => `<button class="chip ${G.opt[k] ? 'on' : ''}" data-o="${k}">${t}</button>`).join('')}` : ''}
    </div>`}
    ${G.focus ? '' : gPeriodHtml()}
    ${hasKw ? '' : G.period.y ? `<div class="notice">이 기간에 읽은 책에는 키워드가 달린 문장이 없어요.</div>` : `<div class="notice">아직 키워드가 달린 문장이 없어요. 필사 문장에 키워드를 달면 주제 지도가 채워져요.</div>`}
    <div class="g-wrap">
      <canvas id="g-canvas" aria-label="키워드 그물망"></canvas>
      <div class="g-tools">
        <button onclick="gZoom(1.25)" aria-label="확대">＋</button>
        <button onclick="gZoom(0.8)" aria-label="축소">－</button>
        <button onclick="gFit()" aria-label="전체 보기">⤢</button>
      </div>
    </div>
    <div class="legend" id="g-legend"></div>
    <div id="g-info"></div>`;
  if ($('g-modes')) $('g-modes').onclick = e => {
    const m = e.target.closest('[data-m]'), t = e.target.closest('[data-top]'), o = e.target.closest('[data-o]');
    if (m) { G.mode = m.dataset.m; G.sel = null; G.hl = null; }
    else if (t) { G.top = Number(t.dataset.top); }
    else if (o) { G.opt[o.dataset.o] = !G.opt[o.dataset.o]; }
    else return;
    renderGraphView();
  };
  const q = $('g-q');
  q.oninput = () => { G.q = q.value; graphSuggest(); };
  q.onkeydown = e => { if (e.key === 'Enter') { const f = document.querySelector('#g-sug [data-n]'); if (f) f.click(); } };
  graphSuggest();
  setupCanvas();
  buildGraph(); gFit(); renderLegend(); gInfo(G.sel);
}
function graphLabel(id) {
  if (!id) return '';
  if (id.startsWith('k:')) return '#' + id.slice(2);
  if (id.startsWith('b:')) return (book(id.slice(2)) || {})['제목'] || '';
  return id.slice(2);
}
function graphSuggest() {
  const box = $('g-sug'); if (!box) return;
  const q = G.q.trim().replace(/^#/, '').toLowerCase();
  if (!q) { box.innerHTML = ''; return; }
  const T = topicData();
  const kws = T.ranked.filter(k => k.toLowerCase().includes(q)).slice(0, 8).map(k => ({ id: 'k:' + k, t: '#' + k, s: T.cnt[k] + '문장' }));
  const bs = S.books.filter(b => (String(b['제목']) + String(b['저자'])).toLowerCase().includes(q)).slice(0, 5).map(b => ({ id: 'b:' + b.ID, t: b['제목'], s: '책' }));
  const all = kws.concat(bs);
  box.innerHTML = all.length ? all.map(x => `<button class="chip" data-n="${esc(x.id)}">${esc(x.t)} <span class="small">${esc(x.s)}</span></button>`).join('') : '<span class="small">찾는 키워드나 책이 없어요</span>';
  box.querySelectorAll('[data-n]').forEach(c => c.onclick = () => { G.q = ''; gFocus(c.dataset.n); });
}

function buildGraph() {
  const T = topicData();
  const nodes = {}, edges = [];
  const add = (id, type, label, ref, w) => nodes[id] || (nodes[id] = { id, type, label, ref, w: w || 0 });
  const link = (a, b, w) => { if (!nodes[a] || !nodes[b] || a === b) return; edges.push({ a, b, w: w || 1 }); };
  const kwSet = (n) => (n ? T.ranked.slice(0, n) : T.ranked.filter(k => T.cnt[k] >= 1));
  let mode = G.mode;

  if (G.focus) {
    mode = 'focus';
    const fid = G.focus;
    if (fid.startsWith('k:')) {
      const k = fid.slice(2);
      add(fid, 'kw', '#' + k, k, T.cnt[k] || 1);
      const rel = relatedKw(k, 12);
      rel.forEach(r => { add('k:' + r.k, 'kw', '#' + r.k, r.k, T.cnt[r.k]); link(fid, 'k:' + r.k, r.c); });
      const bs = Object.entries(T.kwBooks[k] || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
      bs.forEach(([bid, n]) => { const b = book(bid); if (!b) return; add('b:' + bid, 'book', b['제목'], bid, n); link(fid, 'b:' + bid, n); });
      rel.forEach(r => bs.forEach(([bid]) => { const n = (T.bookKw[bid] || {})[r.k]; if (n) link('k:' + r.k, 'b:' + bid, n); }));
      for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) { const c = coCount(rel[i].k, rel[j].k); if (c >= 2) link('k:' + rel[i].k, 'k:' + rel[j].k, c); }
    } else if (fid.startsWith('b:')) {
      const bid = fid.slice(2), b = book(bid);
      if (b) {
        add(fid, 'book', b['제목'], bid, 10);
        const mine = Object.entries(T.bookKw[bid] || {}).sort((a, c) => c[1] - a[1]).slice(0, 15);
        mine.forEach(([k, n]) => { add('k:' + k, 'kw', '#' + k, k, T.cnt[k]); link(fid, 'k:' + k, n); });
        const share = {};
        mine.forEach(([k]) => Object.keys(T.kwBooks[k] || {}).forEach(o => { if (o !== bid) share[o] = (share[o] || 0) + 1; }));
        Object.entries(share).filter(([, n]) => n >= 2).sort((a, c) => c[1] - a[1]).slice(0, 8).forEach(([o]) => {
          const ob = book(o); if (!ob) return; add('b:' + o, 'book', ob['제목'], o, 3);
          mine.forEach(([k]) => { const n = (T.bookKw[o] || {})[k]; if (n) link('b:' + o, 'k:' + k, n); });
        });
      }
    }
  } else if (mode === 'topic') {
    const ks = kwSet(G.top);
    const inSet = new Set(ks);
    ks.forEach(k => add('k:' + k, 'kw', '#' + k, k, T.cnt[k]));
    // 키워드마다 가장 강하게 이어진 4개만 → 실타래가 되지 않게
    const seen = new Set();
    ks.forEach(k => {
      Object.entries(T.nb[k] || {}).filter(([o]) => inSet.has(o) && coCount(k, o) > 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 4)
        .forEach(([o]) => { const kk = [k, o].sort().join('\u0001'); if (seen.has(kk)) return; seen.add(kk); link('k:' + k, 'k:' + o, coCount(k, o)); });
    });
  } else {
    const ks = new Set(kwSet(G.top));
    Object.entries(T.bookKw).forEach(([bid, m]) => {
      const b = book(bid); if (!b) return;
      Object.entries(m).forEach(([k, n]) => { if (!ks.has(k)) return; add('b:' + bid, 'book', b['제목'], bid); add('k:' + k, 'kw', '#' + k, k, T.cnt[k]); link('b:' + bid, 'k:' + k, n); });
    });
    if (G.opt.au) {
      const m = {};
      gBooks().forEach(b => splitAuthors(b['저자']).forEach(a => (m[a] = m[a] || []).push(b)));
      Object.entries(m).filter(([, bs]) => bs.length >= 2).forEach(([a, bs]) => bs.forEach(b => {
        add('b:' + b.ID, 'book', b['제목'], b.ID); add('a:' + a, 'au', a, a, bs.length); link('b:' + b.ID, 'a:' + a, 1);
      }));
    }
    if (G.opt.cat) {
      const m = {};
      gBooks().forEach(b => { const c = String(b['개인분류'] || '').trim(); if (c) (m[c] = m[c] || []).push(b); });
      Object.entries(m).filter(([, bs]) => bs.length >= 2).forEach(([c, bs]) => bs.forEach(b => {
        add('b:' + b.ID, 'book', b['제목'], b.ID); add('c:' + c, 'cat', c, c, bs.length); link('b:' + b.ID, 'c:' + c, 1);
      }));
    }
  }
  G.cfg = CFG[mode] || CFG.book;
  G.view = mode;

  const old = G.byId || {};
  const list = Object.values(nodes);
  const R = Math.sqrt(list.length) * (mode === 'book' ? 40 : 60);
  list.forEach(n => {
    const o = old[n.id];
    if (o && mode !== 'focus') { n.x = o.x; n.y = o.y; }
    else { const r = seeded(n.id); const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R; n.x = Math.cos(a) * d; n.y = Math.sin(a) * d; }
    if (n.type === 'kw') { n.cl = T.clusterOf[n.ref]; n.r = 5 + Math.min(17, Math.sqrt(T.cnt[n.ref] || 1) * 1.9); }
    else if (n.type === 'book') n.r = mode === 'focus' ? 9 : 7;
    else n.r = 6 + Math.min(8, Math.sqrt(n.w) * 2);
    if (G.focus === n.id) { n.x = 0; n.y = 0; n.pin = true; n.r += 4; }
  });
  G.nodes = list; G.edges = edges.map(e => ({ a: nodes[e.a], b: nodes[e.b], w: e.w }));
  G.byId = nodes; G.nb = {};
  G.edges.forEach(e => { (G.nb[e.a.id] = G.nb[e.a.id] || new Set()).add(e.b.id); (G.nb[e.b.id] = G.nb[e.b.id] || new Set()).add(e.a.id); });
  if (G.sel && !nodes[G.sel.id]) G.sel = null; else if (G.sel) G.sel = nodes[G.sel.id];
  simulate(list.some(n => !old[n.id]) || mode === 'focus' ? 360 : 60);
}

function simulate(iters) {
  const N = G.nodes, E = G.edges, n = N.length;
  if (!n) return;
  for (let it = 0; it < iters; it++) {
    const alpha = 1 - it / iters;
    const C = G.cfg;
    N.forEach(p => { p.fx = -p.x * C.grav; p.fy = -p.y * C.grav; });
    for (let i = 0; i < n; i++) {
      const a = N[i];
      for (let j = i + 1; j < n; j++) {
        const b = N[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > C.cut * C.cut) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = C.rep / d2;
        a.fx += dx * f; a.fy += dy * f; b.fx -= dx * f; b.fy -= dy * f;
      }
    }
    E.forEach(e => {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const L = C.len + e.a.r + e.b.r, k = C.k * Math.min(3, 1 + Math.log(e.w));
      const f = (d - L) * k / d;
      e.a.fx += dx * f; e.a.fy += dy * f; e.b.fx -= dx * f; e.b.fy -= dy * f;
    });
    N.forEach(p => {
      if (p === G.drag || p.pin) return;
      const m = Math.max(1.5, 22 * alpha);
      p.x += Math.max(-m, Math.min(m, p.fx)); p.y += Math.max(-m, Math.min(m, p.fy));
    });
  }
}

function renderLegend() {
  const box = $('g-legend'); if (!box) return;
  const T = topicData();
  const shown = new Set(G.nodes.filter(n => n.type === 'kw').map(n => n.cl));
  const cl = T.clusters.filter(c => !c.loners && shown.has(c.i));
  const kinds = [];
  if (G.nodes.some(n => n.type === 'book')) kinds.push('<span><i class="lg-book"></i>책</span>');
  if (G.nodes.some(n => n.type === 'au')) kinds.push('<span><i class="lg-au"></i>저자 (2권 이상)</span>');
  if (G.nodes.some(n => n.type === 'cat')) kinds.push('<span><i class="lg-cat"></i>개인분류</span>');
  box.innerHTML = (cl.length ? `<div class="g-clusters">${cl.map(c => `<button class="g-cl ${G.hl === c.i ? 'on' : ''}" data-c="${c.i}">
      <i style="background:${clusterColor(c.i)}"></i>${c.kws.slice(0, 3).map(esc).join(' · ')}</button>`).join('')}
      ${shown.has(99) ? `<span class="g-cl muted"><i style="background:${clusterColor(99)}"></i>혼자 쓰인 키워드</span>` : ''}</div>` : '')
    + (kinds.length ? `<div class="g-kinds">${kinds.join('')}<span class="small">● 키워드 (크기 = 문장 수)</span></div>` : '');
  box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const c = Number(b.dataset.c); G.hl = G.hl === c ? null : c; G.sel = null; S.gLimit = 30; renderLegend(); drawGraph(); gInfo(null);
    if (G.hl != null) setTimeout(() => { const el = $('g-info'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 50); });
}

function drawGraph() {
  const cv = $('g-canvas'); if (!cv) return;
  const ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
  const W = cv.width / dpr, H = cv.height / dpr;
  const colBook = G.view === 'focus' || G.view === 'book' ? cssVar('--sub') : cssVar('--n-book');
  const col = n => n.type === 'kw' ? clusterColor(n.cl) : n.type === 'book' ? colBook : n.type === 'au' ? cssVar('--n-au') : cssVar('--n-cat');
  const line = cssVar('--line'), ink = cssVar('--ink'), sub = cssVar('--sub'), card = cssVar('--card');
  const sel = G.sel, near = sel ? (G.nb[sel.id] || new Set()) : null;
  const lit = n => sel ? (n === sel || near.has(n.id)) : G.hl != null ? (n.type === 'kw' && n.cl === G.hl) : true;
  if (!G.nodes.length) {
    ctx.fillStyle = sub; ctx.font = '14px Pretendard, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('보여줄 연결이 없어요.', W / 2, H / 2); return;
  }
  const sx = n => n.x * G.scale + G.ox, sy = n => n.y * G.scale + G.oy;
  G.edges.forEach(e => {
    const on = sel ? (e.a === sel || e.b === sel) : G.hl != null ? (lit(e.a) && lit(e.b)) : false;
    const dim = (sel || G.hl != null) && !on;
    ctx.globalAlpha = dim ? 0.07 : on ? 0.8 : 0.5;
    ctx.strokeStyle = on && sel ? col(sel) : line;
    ctx.lineWidth = Math.min(3.2, (on ? 1.4 : 0.8) + Math.log(e.w + 1) * 0.55);
    ctx.beginPath(); ctx.moveTo(sx(e.a), sy(e.a)); ctx.lineTo(sx(e.b), sy(e.b)); ctx.stroke();
  });
  G.nodes.forEach(n => {
    const x = sx(n), y = sy(n), r = nodeR(n);
    if (x < -30 || y < -30 || x > W + 30 || y > H + 30) return;
    ctx.globalAlpha = lit(n) ? 1 : 0.13;
    ctx.fillStyle = col(n); ctx.strokeStyle = card; ctx.lineWidth = 2;
    ctx.beginPath();
    if (n.type === 'book') roundRect(ctx, x - r * 0.72, y - r, r * 1.44, r * 2, 2);
    else if (n.type === 'kw') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (n.type === 'au') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
    else { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.95, y + r * 0.75); ctx.lineTo(x - r * 0.95, y + r * 0.75); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    if (n === sel || (G.focus === n.id && !sel)) { ctx.lineWidth = 2.5; ctx.strokeStyle = ink; ctx.stroke(); }
  });
  // 이름표: 선택 > 이어진 것 > 큰 키워드 순. 겹치면 건너뜀 (작은 키워드는 확대하면 보임)
  function pri(n) {
    if (n === sel || G.focus === n.id) return 1e6;
    if (sel) return near.has(n.id) ? 1e5 + n.w : -1;
    if (G.hl != null) return lit(n) ? 1e5 + n.w : -1;
    return (n.type === 'book' ? (G.view === 'book' ? 0 : 500) : 1000) + (n.type === 'kw' ? (topicData().cnt[n.ref] || 0) : n.w);
  }
  const order = G.nodes.slice().sort((a, b) => pri(b) - pri(a));
  const boxes = [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  order.forEach(n => {
    const p = pri(n); if (p < 0) return;
    if (n.type === 'book' && G.view === 'book' && p < 1e5 && G.scale < 0.85) return;
    const t = n.label.length > 13 ? n.label.slice(0, 12) + '…' : n.label;
    const big = p >= 1e6;
    const fsz = big ? 14 : n.type === 'book' ? 11.5 : Math.round(11 + Math.min(3, Math.sqrt(topicData().cnt[n.ref] || 1) * 0.35));
    ctx.font = `${n.type === 'book' ? 500 : 650} ${fsz}px Pretendard, -apple-system, sans-serif`;
    const w = ctx.measureText(t).width, x = sx(n), y = sy(n) + nodeR(n) + 3;
    const box = [x - w / 2 - 2, y - 1, x + w / 2 + 2, y + fsz + 2];
    if (box[2] < 0 || box[0] > W || box[3] < 0 || box[1] > H) return;
    if (!big && boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
    boxes.push(box);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4; ctx.strokeStyle = card; ctx.strokeText(t, x, y);
    ctx.fillStyle = n.type === 'book' ? sub : ink; ctx.fillText(t, x, y);
  });
  ctx.globalAlpha = 1;
}

function gSelect(n, center) {
  G.sel = n && G.sel === n && !center ? null : n;
  if (G.sel) G.hl = null;
  if (G.sel && center) {
    const r = $('g-canvas').getBoundingClientRect();
    G.ox = r.width / 2 - G.sel.x * G.scale; G.oy = r.height / 2 - G.sel.y * G.scale;
  }
  drawGraph(); renderLegend(); gInfo(G.sel);
}
function gFocus(id) {
  G.focus = id; G.sel = null; G.hl = null;
  renderGraphView();
  G.sel = G.byId[id] || null; drawGraph(); gInfo(G.sel);
  const wrap = document.querySelector('.g-wrap'); if (wrap) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function gUnfocus() { const was = G.focus; G.focus = null; G.sel = null; renderGraphView(); if (was && G.byId[was]) gSelect(G.byId[was], true); }

function gInfo(n) {
  const box = $('g-info'); if (!box) return;
  const T = topicData();
  if (!n && G.hl != null && !G.focus) {   // 색 묶음을 눌렀을 때: 그 묶음 키워드가 달린 문장 전부
    const c = T.clusters.find(x => x.i === G.hl);
    if (c) {
      const set = new Set(c.kws), list = gSnips().filter(s => splitKw(s['키워드']).some(k => set.has(k)));
      box.innerHTML = `<div class="info-card"><div class="ic-head"><h3><i class="dot" style="background:${clusterColor(c.i)}"></i>${c.kws.slice(0, 3).map(esc).join(' · ')}${c.kws.length > 3 ? ' …' : ''}</h3>
          <button class="btn" onclick="G.hl=null;renderLegend();drawGraph();gInfo(null)">묶음 풀기</button></div>
        <div class="sub">키워드 ${c.kws.length}개 · 문장 ${list.length}개 · 책 ${new Set(list.map(s => s['책ID'])).size}권</div>
        <div class="kw-chips" style="margin:0 0 6px">${c.kws.slice(0, 24).map(k => `<button class="chip" onclick="gFocus('k:${esc(k)}')">#${esc(k)}<b>${T.cnt[k] || 0}</b></button>`).join('')}</div>
        ${gSnipListHtml(list)}</div>`;
      return;
    }
  }
  if (!n && G.period.y && !G.focus) {   // 기간을 골랐을 때: 그 기간에 읽은 책의 필사 전부
    const list = gSnips().slice().sort((a, b) => snipDay(b).localeCompare(snipDay(a)) || String(a['책ID']).localeCompare(String(b['책ID'])));
    const bc = {}; list.forEach(s => bc[s['책ID']] = (bc[s['책ID']] || 0) + 1);
    box.innerHTML = `<div class="info-card"><div class="ic-head"><h3>${G.period.y}년${G.period.m ? ' ' + Number(G.period.m) + '월' : ''}에 읽은 책의 필사</h3></div>
      <div class="sub">문장 ${list.length}개 · 책 ${Object.keys(bc).length}권 · 키워드 ${T.ranked.length}개</div>
      <div class="ic-lb">책</div><div class="kw-chips" style="margin:0 0 6px">${Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([bid, c]) => { const b = book(bid); return b ? `<button class="chip" onclick="go('book','${bid}')">${esc(b['제목'])}<b>${c}</b></button>` : ''; }).join('')}</div>
      ${T.ranked.length ? `<div class="ic-lb">많이 나온 키워드</div><div class="kw-chips" style="margin:0 0 6px">${T.ranked.slice(0, 16).map(k => `<button class="chip" onclick="gFocus('k:${esc(k)}')">#${esc(k)}<b>${T.cnt[k]}</b></button>`).join('')}</div>` : ''}
      ${gSnipListHtml(list)}</div>`;
    return;
  }
  if (!n) {
    box.innerHTML = `<div class="drill">점을 누르면 이어진 키워드와 책, 문장을 보여줘요. 색 이름표를 누르면 그 주제만 밝게 보여요. 두 손가락으로 확대, 끌어서 이동할 수 있어요.</div>
      ${G.focus ? '' : `<div class="kw-chips">${T.ranked.slice(0, 20).map(k => `<button class="chip" onclick="gFocus('k:${esc(k)}')">#${esc(k)}<b>${T.cnt[k]}</b></button>`).join('')}</div>`}`;
    return;
  }
  if (n.type === 'kw') {
    const k = n.ref;
    const list = gSnips().filter(s => splitKw(s['키워드']).includes(k));
    const nb = new Set(list.map(s => s['책ID']));
    const rel = relatedKw(k, 10);
    const books = Object.entries(T.kwBooks[k] || {}).sort((a, b) => b[1] - a[1]).map(([bid, c]) => [book(bid), c]).filter(x => x[0]);
    const lim = S.gLimit || 30;
    box.innerHTML = `<div class="info-card">
      <div class="ic-head"><h3><i class="dot" style="background:${clusterColor(T.clusterOf[k])}"></i>#${esc(k)}</h3>
        ${G.focus === n.id ? '' : `<button class="btn" onclick="gFocus('k:${esc(k)}')">이 주제만 보기</button>`}</div>
      <div class="sub">문장 ${list.length}개 · 책 ${nb.size}권</div>
      ${rel.length ? `<div class="ic-lb">함께 자주 나온 키워드</div><div class="kw-chips" style="margin:0 0 6px">${rel.map(r => `<button class="chip" onclick="gFocus('k:${esc(r.k)}')">#${esc(r.k)}<b>${r.c}</b></button>`).join('')}</div>` : ''}
      <div class="ic-lb">이 키워드가 나온 책</div><div class="kw-chips" style="margin:0 0 6px">${books.slice(0, 12).map(([b, c]) => `<button class="chip" onclick="go('book','${b.ID}')">${esc(b['제목'])}<b>${c}</b></button>`).join('')}</div>
      <div class="ic-lb">문장 <span class="small">누르면 그 문장으로 가요</span></div>
      ${list.slice(0, lim).map(s => snipMini(s)).join('')}
      ${list.length > lim ? `<button class="btn" style="width:100%;margin-top:8px" onclick="S.gLimit=${lim + 30};gInfo(G.sel)">${list.length - lim}개 더 보기</button>` : ''}</div>`;
  } else if (n.type === 'book') {
    const b = book(n.ref);
    const kws = Object.entries(T.bookKw[b.ID] || {}).sort((a, c) => c[1] - a[1]);
    box.innerHTML = `<div class="info-card"><div class="ic-head"><h3>${esc(b['제목'])}</h3></div>
      <div class="sub">${esc(b['저자'])}${b['개인분류'] ? ' · ' + esc(b['개인분류']) : ''} · 필사 ${snipsOf(b.ID).length}개</div>
      ${kws.length ? `<div class="kw-chips" style="margin:0 0 10px">${kws.slice(0, 16).map(([k, c]) => `<button class="chip" onclick="gFocus('k:${esc(k)}')">#${esc(k)}<b>${c}</b></button>`).join('')}</div>` : ''}
      <div class="actions" style="margin:0"><button class="btn primary" onclick="go('book','${b.ID}')">책 열기</button>
        ${G.focus === n.id ? '' : `<button class="btn" onclick="gFocus('b:${b.ID}')">이 책 중심으로 보기</button>`}</div></div>`;
  } else {
    const books = [...(G.nb[n.id] || [])].map(id => G.byId[id]).filter(x => x && x.type === 'book').map(x => book(x.ref));
    box.innerHTML = `<div class="info-card"><h3>${esc(n.label)}</h3><div class="sub">${n.type === 'au' ? '저자' : '개인분류'} · 책 ${books.length}권</div>
      ${books.map(b => `<button class="mini" onclick="go('book','${b.ID}')"><b>${esc(b['제목'])}</b><span>${esc(b['저자'])}</span></button>`).join('')}</div>`;
  }
}
function gSnipListHtml(list) {
  const lim = S.gLimit || 30;
  return `<div class="ic-lb">문장 <span class="small">누르면 그 문장으로 가요</span></div>
    ${list.slice(0, lim).map(s => snipMini(s)).join('') || '<div class="small">문장이 없어요</div>'}
    ${list.length > lim ? `<button class="btn" style="width:100%;margin-top:8px" onclick="S.gLimit=${lim + 30};gInfo(G.sel)">${list.length - lim}개 더 보기</button>` : ''}`;
}
function snipMini(s) {
  const b = book(s['책ID']) || {};
  return `<button class="mini" onclick="openSnipInBook('${s.ID}')">
    <b>${esc(s['제목'] || b['제목'] || '')}</b>
    <span>${esc(sText(s).slice(0, 110))}${sText(s).length > 110 ? '…' : ''}</span>
    <em>${esc(b['제목'] || '')}${s['쪽수'] !== '' && s['쪽수'] != null ? ' · p.' + esc(s['쪽수']) : ''}</em></button>`;
}




function seeded(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }



/* 캔버스 · 그리기 */
function setupCanvas() {
  const cv = $('g-canvas');
  const fit = () => { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; drawGraph(); };
  G.resize = fit;
  fit();
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const world = p => ({ x: (p.x - G.ox) / G.scale, y: (p.y - G.oy) / G.scale });
  const hit = p => {
    const w = world(p); let best = null, bd = Infinity;
    G.nodes.forEach(n => { const d = Math.hypot(n.x - w.x, n.y - w.y) * G.scale; if (d < nodeR(n) + 9 && d < bd) { bd = d; best = n; } });
    return best;
  };
  cv.onpointerdown = e => {
    cv.setPointerCapture(e.pointerId);
    G.ptr.set(e.pointerId, pos(e)); G.moved = 0;
    if (G.ptr.size === 1) { G.drag = hit(pos(e)); G.last = pos(e); cv.classList.add('dragging'); }
    else { G.drag = null; G.pinch = pinchState(); }
  };
  cv.onpointermove = e => {
    if (!G.ptr.has(e.pointerId)) return;
    const p = pos(e); G.ptr.set(e.pointerId, p);
    if (G.ptr.size >= 2 && G.pinch) {
      const s = pinchState(), k = s.d / G.pinch.d;
      zoomAt(s.c, k); G.ox += s.c.x - G.pinch.c.x; G.oy += s.c.y - G.pinch.c.y; G.pinch = s; G.moved = 99; drawGraph(); return;
    }
    const dx = p.x - G.last.x, dy = p.y - G.last.y; G.moved += Math.abs(dx) + Math.abs(dy); G.last = p;
    if (G.drag && G.moved > 3) { G.drag.x += dx / G.scale; G.drag.y += dy / G.scale; simulate(2); }
    else if (!G.drag) { G.ox += dx; G.oy += dy; }
    drawGraph();
  };
  cv.onpointerup = cv.onpointercancel = e => {
    const wasTap = G.ptr.size === 1 && G.moved < 6;
    G.ptr.delete(e.pointerId); cv.classList.remove('dragging');
    if (wasTap) gSelect(hit(pos(e)), false);
    if (G.ptr.size < 2) G.pinch = null;
    if (!G.ptr.size) G.drag = null;
  };
  cv.onwheel = e => { e.preventDefault(); zoomAt(pos(e), e.deltaY < 0 ? 1.12 : 0.89); drawGraph(); };
  function pinchState() {
    const [a, b] = [...G.ptr.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
}
function zoomAt(p, k) {
  const s = Math.max(0.2, Math.min(4, G.scale * k)); k = s / G.scale;
  G.ox = p.x - (p.x - G.ox) * k; G.oy = p.y - (p.y - G.oy) * k; G.scale = s;
}
function gZoom(k) { const cv = $('g-canvas'), r = cv.getBoundingClientRect(); zoomAt({ x: r.width / 2, y: r.height / 2 }, k); drawGraph(); }
function gFit() {
  const cv = $('g-canvas'); if (!cv) return;
  const r = cv.getBoundingClientRect();
  if (!G.nodes.length) { G.scale = 1; G.ox = r.width / 2; G.oy = r.height / 2; drawGraph(); return; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  G.nodes.forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); });
  const pad = 46, w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  G.scale = Math.max(0.2, Math.min(2, Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)));
  G.ox = r.width / 2 - (x0 + w / 2) * G.scale; G.oy = r.height / 2 - (y0 + h / 2) * G.scale;
  drawGraph();
}

function nodeR(n) { return n.r * Math.max(0.75, Math.min(1.35, Math.sqrt(G.scale / 0.6))); }   // 화면 기준 크기
function roundRect(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }


window.addEventListener('resize', () => { if (S.view === 'graph' && G.resize) G.resize(); });

/* ---------- 통계 ---------- */
let statYear = null;
function renderStatsView() {
  const years = [...new Set(S.books.map(b => String(b['완독일']).slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
  if (statYear === null) statYear = years.includes(S.today.slice(0, 4)) ? S.today.slice(0, 4) : (years[0] || '전체');
  const all = statYear === '전체';
  const done = S.books.filter(b => b['상태'] === '완독' && b['완독일'] && (all || String(b['완독일']).startsWith(statYear)));
  const pages = done.reduce((t, b) => t + (Number(b['분량']) || 0), 0);
  const daysList = done.map(b => Number(b['완독일수'])).filter(n => n > 0);
  const avgDays = daysList.length ? (daysList.reduce((a, b) => a + b, 0) / daysList.length) : 0;
  const ids = new Set(done.map(b => b.ID));
  const snipN = S.snips.filter(s => ids.has(s['책ID'])).length;

  // 월별 (또는 연도별)
  const buckets = all
    ? years.slice().reverse().map(y => ({ label: y.slice(2) + '년', key: y, books: done.filter(b => String(b['완독일']).startsWith(y)) }))
    : Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return { label: (i + 1) + '월', key: statYear + '-' + m, books: done.filter(b => String(b['완독일']).slice(0, 7) === statYear + '-' + m) }; });
  const maxB = Math.max(1, ...buckets.map(x => x.books.length));

  const groupBy = (key, split) => {
    const m = {};
    done.forEach(b => (split ? split(b[key]) : [String(b[key] || '').trim() || '미분류']).forEach(v => (m[v] = m[v] || []).push(b)));
    return Object.entries(m).map(([k, bs]) => ({ k, bs })).sort((a, b) => b.bs.length - a.bs.length || a.k.localeCompare(b.k));
  };
  const hbars = (id, rows, limit) => {
    const max = Math.max(1, ...rows.map(r => r.bs.length));
    const open = !!S.statOpen[id];
    const more = rows.length > limit ? `<button class="more-btn" data-more="${id}">${open ? '접기' : `전체 ${rows.length}개 보기`}</button>` : '';
    return (open ? rows : rows.slice(0, limit)).map((r, i) => `<div class="hbar" data-g="${id}" data-i="${i}" title="${esc(r.k)} · ${r.bs.length}권">
      <span class="name">${esc(r.k)}</span><span class="track"><span class="fill" style="display:block;width:${r.bs.length / max * 100}%"></span></span><span class="n">${r.bs.length}</span></div>`).join('') + more;
  };
  const G2 = { cat: groupBy('대분류'), my: groupBy('개인분류'), route: groupBy('경로'), au: groupBy('저자', splitAuthors).filter(r => r.bs.length >= 2),
    plat: Object.entries(done.reduce((m, b) => { (m[platOf(b)] = m[platOf(b)] || []).push(b); return m; }, {})).map(([k, bs]) => ({ k, bs })).sort((a, b) => b.bs.length - a.bs.length) };
  statGroups = { ...G2, month: buckets.map(x => ({ k: x.label, bs: x.books })) };

  const by = (arr, f, dir) => arr.filter(b => Number(f(b)) > 0).sort((a, b) => dir * (Number(f(b)) - Number(f(a))))[0];
  const fast = by(done, b => b['완독일수'], -1), slow = by(done, b => b['완독일수'], 1), thick = by(done, b => b['분량'], 1);
  const snipCount = {}; S.snips.forEach(s => { if (ids.has(s['책ID'])) snipCount[s['책ID']] = (snipCount[s['책ID']] || 0) + 1; });
  const mostSnip = Object.entries(snipCount).sort((a, b) => b[1] - a[1])[0];

  $('v-stats').innerHTML = `
    <div class="view-head ai-head"><div><h1>독서 통계</h1><p>완독일 기준이에요.</p></div><button class="btn" onclick="openReport(statYear)">📖 독서 리포트</button></div>
    <div class="chips" id="st-years">${[...years, '전체'].map(y => `<button class="chip ${statYear === y ? 'on' : ''}" data-y="${y}">${y === '전체' ? '전체' : y + '년'}</button>`).join('')}</div>
    <div class="tiles">
      <button class="tile tap" data-list="최근 완독"><b>${done.length}</b><span>완독한 책 (권) ›</span></button>
      <button class="tile tap" data-list="두꺼운"><b>${pages.toLocaleString()}</b><span>읽은 쪽수 ›</span></button>
      <button class="tile tap" data-list="빨리 읽은"><b>${avgDays ? avgDays.toFixed(1) : '–'}</b><span>한 권 평균 (일) ›</span></button>
      <button class="tile tap" data-list="필사 많은"><b>${snipN.toLocaleString()}</b><span>필사 덩어리 ›</span></button>
    </div>
    ${dailyPanelHtml()}
    ${(() => { const g = Number(S.settings.goal) || 0, y = S.today.slice(0, 4); if (all || statYear !== y) return '';
      return `<div class="panel" onclick="openSettings()" style="cursor:pointer"><h3>${y}년 목표<small>${g ? '' : '눌러서 정하기'}</small></h3>${g ? `<div class="gl small" style="display:flex;justify-content:space-between;margin-bottom:6px"><span>${done.length} / ${g}권</span><span>${Math.min(100, Math.round(done.length / g * 100))}% · ${done.length >= g ? '달성! 🎉' : '남은 ' + (g - done.length) + '권'}</span></div><div class="bar"><i style="width:${Math.min(100, done.length / g * 100)}%"></i></div>` : ''}</div>`; })()}
    <div class="panel"><h3>${all ? '연도별 완독' : '월별 완독'}<small>막대를 누르면 그 달에 읽은 책</small></h3>
      <div class="vbars">${buckets.map((x, i) => `<div class="vbar" data-g="month" data-i="${i}" title="${x.label} · ${x.books.length}권">
        <span class="val">${x.books.length || ''}</span><span class="fill" style="height:${x.books.length / maxB * 100}%"></span></div>`).join('')}</div>
      <div class="vlabels">${buckets.map(x => `<span>${x.label}</span>`).join('')}</div>
      <div class="drill" id="drill-month"></div>
    </div>
    <div class="two">
      <div class="panel"><h3>대분류<small>${G2.cat.length}개 · 누르면 책 목록</small></h3>${hbars('cat', G2.cat, 10)}<div class="drill" id="drill-cat"></div>
        ${(() => { const n = S.books.filter(b => !String(b['대분류'] || '').trim()).length; return n ? `<button class="more-btn" onclick="autoCatAll()">🪄 분류 없는 책 ${n}권 자동 분류</button>` : ''; })()}</div>
      <div class="panel"><h3>개인분류<small>${G2.my.length}개 · 누르면 책 목록</small></h3>${hbars('my', G2.my, 10)}<div class="drill" id="drill-my"></div></div>
      <div class="panel"><h3>종이책 · E북</h3>${hbars('plat', G2.plat, 3)}<div class="drill" id="drill-plat"></div></div>
      <div class="panel"><h3>어디서 읽었나</h3>${hbars('route', G2.route, 8)}<div class="drill" id="drill-route"></div></div>
      <div class="panel"><h3>여러 권 읽은 저자</h3>${G2.au.length ? hbars('au', G2.au, 10) : '<div class="drill">아직 없어요</div>'}<div class="drill" id="drill-au"></div></div>
    </div>
    ${(() => { const rated = done.filter(b => Number(b['별점'])).sort((a, b) => b['별점'] - a['별점'] || String(b['완독일']).localeCompare(String(a['완독일']))).slice(0, 5);
      return rated.length ? `<div class="panel"><h3>별점 높은 책</h3><div class="facts">${rated.map(b => `<div class="fact" onclick="go('book','${b.ID}')"><span class="stars">${starText(b['별점'])}</span><b>${esc(b['제목'])}</b></div>`).join('')}</div></div>` : ''; })()}
    <div class="panel"><h3>기록</h3><div class="facts">
      ${fast ? `<div class="fact" onclick="go('book','${fast.ID}')"><span>가장 빨리 읽은 책</span><b>${esc(fast['제목'])} · ${fast['완독일수']}일</b></div>` : ''}
      ${slow ? `<div class="fact" onclick="go('book','${slow.ID}')"><span>가장 오래 읽은 책</span><b>${esc(slow['제목'])} · ${slow['완독일수']}일</b></div>` : ''}
      ${thick ? `<div class="fact" onclick="go('book','${thick.ID}')"><span>가장 두꺼운 책</span><b>${esc(thick['제목'])} · ${thick['분량']}쪽</b></div>` : ''}
      ${mostSnip ? `<div class="fact" onclick="go('book','${mostSnip[0]}')"><span>필사를 가장 많이 한 책</span><b>${esc((book(mostSnip[0]) || {})['제목'] || '')} · ${mostSnip[1]}개</b></div>` : ''}
    </div></div>`;
  $('st-years').onclick = e => { const c = e.target.closest('[data-y]'); if (!c) return; statYear = c.dataset.y; renderStatsView(); };
  $('v-stats').querySelectorAll('[data-g]').forEach(el => el.onclick = () => openStatGroup(el));
  $('v-stats').querySelectorAll('.dbar').forEach(el => el.onclick = () => openDay(el.dataset.d));
  $('v-stats').querySelectorAll('[data-more]').forEach(el => el.onclick = () => { const k = el.dataset.more; S.statOpen[k] = !S.statOpen[k]; renderStatsView(); });
  const yLabel = all ? '전체 기간' : statYear + '년';
  $('v-stats').querySelectorAll('[data-list]').forEach(el => el.onclick = () => openBookList(`${yLabel} 완독한 책`, done, el.dataset.list));
}
let statGroups = {};
function openStatGroup(el) {
  const g = el.dataset.g, row = (statGroups[g] || [])[Number(el.dataset.i)]; if (!row) return;
  const names = { cat: '대분류', my: '개인분류', route: '어디서 읽었나', au: '저자', plat: '종이책 · E북' };
  const span = statYear === '전체' ? '전체 기간' : statYear + '년 완독';
  if (g === 'month') openBookList(`${statYear === '전체' ? '' : statYear + '년 '}${row.k} 완독`, row.bs, '최근 완독');
  else openBookList(`${names[g]} · ${row.k}`, row.bs, '최근 완독', span);
}

