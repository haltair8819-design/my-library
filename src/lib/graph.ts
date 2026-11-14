/* 독서 연결망: 주제 묶음 계산 · 그물 배치 · 캔버스 그리기 — 예전 graph-stats.js */
import { S, book, uniq, splitKw, type Rec } from './core'
import { splitAuthors } from './book'

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = Rec & { id: string; type: string; label: string; ref: string; w: number; x: number; y: number; r: number; cl?: number; pin?: boolean; fx?: number; fy?: number }
type E = { a: N; b: N; w: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const G: Rec = {
  nodes: [] as N[], edges: [] as E[], byId: {} as Record<string, N>, nb: {} as Record<string, Set<string>>, scale: 1, ox: 0, oy: 0, sel: null as N | null,
  mode: 'topic', top: 40, focus: null as string | null, hl: null as number | null, q: '',
  opt: { au: false, cat: false }, ptr: new Map(), drag: null, moved: 0,
  cfg: { rep: 1200, grav: 0.03, len: 34, k: 0.05, cut: 110 }, period: { y: '', m: '' }, view: 'topic',
}
const CFG: Rec = {
  topic: { rep: 2600, grav: 0.022, len: 58, k: 0.035, cut: 190 },
  book: { rep: 1400, grav: 0.03, len: 36, k: 0.05, cut: 120 },
  focus: { rep: 3200, grav: 0.03, len: 74, k: 0.04, cut: 240 },
}
// 검증한 8색 (밝은 화면 / 어두운 화면). 주제 묶음 크기 순서대로 고정, 9번째부터는 회색
const CLUSTER_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] }

/* 기간 고르기 (v2.12.1): 전체 · 연도 · 월 — 그 책을 읽은 때(완독일, 없으면 시작일) 기준
 * 날짜가 없는 책은 기간을 고르면 빠지고, 지금 읽는 중인 책은 '지금 읽는 중' 칸에 따로 */
export const bookDay = (b: Rec | undefined) => (!b || b['상태'] === '읽는중' || b['상태'] === '읽을예정') ? '' : String(b['완독일'] || b['시작일'] || '').slice(0, 10)
export const snipDay = (s: Rec) => bookDay(book(s['책ID']))
export const gReading = () => G.period.y === 'reading'
const gPrefix = () => G.period.y && !gReading() ? (G.period.m ? `${G.period.y}-${G.period.m}` : G.period.y) : ''
const isReadingBook = (b: Rec | undefined) => !!b && b['상태'] === '읽는중'
export function gSnips(): Rec[] { if (gReading()) return S.snips.filter((s: Rec) => isReadingBook(book(s['책ID']))); const p = gPrefix(); return p ? S.snips.filter((s: Rec) => snipDay(s).startsWith(p)) : S.snips }
export function gBooks(): Rec[] { if (gReading()) return S.books.filter(isReadingBook); const p = gPrefix(); return p ? S.books.filter((b: Rec) => bookDay(b).startsWith(p)) : S.books }
export function gPeriodLabel() { return gReading() ? '지금 읽는 중인' : `${G.period.y}년${G.period.m ? ' ' + Number(G.period.m) + '월' : ''}에 읽은` }
export function gYears() { return uniq(S.snips.map((s: Rec) => snipDay(s).slice(0, 4)).filter((y: string) => /^\d{4}$/.test(y))).sort().reverse() as string[] }

/* 키워드끼리 얼마나 함께 나오나 + 주제 묶음 (데이터가 바뀔 때만 다시 계산) */
export type Topic = { cnt: Record<string, number>; co: Record<string, number>; nb: Record<string, Record<string, number>>; kwBooks: Record<string, Record<string, number>>; bookKw: Record<string, Record<string, number>>; clusters: Rec[]; clusterOf: Record<string, number>; ranked: string[] }
let TOPIC: Topic | null = null, TOPIC_KEY = ''
export function topicData(): Topic {
  const SN = gSnips()
  const key = gPrefix() + (gReading() ? 'R' : '') + '|' + SN.length + ':' + SN.reduce((t: number, s: Rec) => t + String(s['키워드'] || '').length, 0)
  if (TOPIC && TOPIC_KEY === key) return TOPIC
  const cnt: Record<string, number> = {}, co: Record<string, number> = {}, kwBooks: Record<string, Record<string, number>> = {}, bookKw: Record<string, Record<string, number>> = {}
  SN.forEach(s => {
    const ks = uniq(splitKw(s['키워드'])); const bid = s['책ID']
    ks.forEach(k => { cnt[k] = (cnt[k] || 0) + 1; (kwBooks[k] = kwBooks[k] || {})[bid] = (kwBooks[k][bid] || 0) + 1; (bookKw[bid] = bookKw[bid] || {})[k] = (bookKw[bid][k] || 0) + 1 })
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const [a, b] = [ks[i], ks[j]].sort(); const kk = a + '\u0001' + b; co[kk] = (co[kk] || 0) + 1
    }
  })
  // 연관 강도: 함께 나온 횟수를 두 키워드 크기로 나눠서, '사랑'처럼 어디에나 있는 말이 모두를 삼키지 않게
  const nb: Record<string, Record<string, number>> = {}; Object.keys(cnt).forEach(k => nb[k] = {})
  const addW = (a: string, b: string, w: number) => { nb[a][b] = (nb[a][b] || 0) + w; nb[b][a] = (nb[b][a] || 0) + w }
  Object.entries(co).forEach(([kk, w]) => { const [a, b] = kk.split('\u0001'); addW(a, b, w / Math.sqrt(cnt[a] * cnt[b])) })
  Object.values(bookKw).forEach(m => { const ks = Object.keys(m); if (ks.length > 40) return
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) addW(ks[i], ks[j], 0.15 / Math.sqrt(cnt[ks[i]] * cnt[ks[j]])) })
  // 주제 묶기 (모듈성 최대화 한 단계)
  const ks = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b))
  const deg: Record<string, number> = {}; ks.forEach(k => deg[k] = Object.values(nb[k]).reduce((a, b) => a + b, 0))
  const m2 = ks.reduce((t, k) => t + deg[k], 0) || 1
  const com: Record<string, string> = {}, tot: Record<string, number> = {}; ks.forEach(k => { com[k] = k; tot[k] = deg[k] })
  for (let it = 0, moved = true; moved && it < 30; it++) {
    moved = false
    ks.forEach(k => {
      const cur = com[k], links: Record<string, number> = {}
      Object.entries(nb[k]).forEach(([o, w]) => links[com[o]] = (links[com[o]] || 0) + w)
      tot[cur] -= deg[k]
      let best = cur, gain = (links[cur] || 0) - tot[cur] * deg[k] / m2
      Object.entries(links).forEach(([c, w]) => { const g = w - tot[c] * deg[k] / m2; if (g > gain + 1e-9) { gain = g; best = c } })
      tot[best] += deg[k]; if (best !== cur) { com[k] = best; moved = true }
    })
  }
  const groups: Record<string, string[]> = {}; ks.forEach(k => { if (deg[k] > 0) (groups[com[k]] = groups[com[k]] || []).push(k) })
  const cl = Object.values(groups).map(g => ({ kws: g, size: g.reduce((t, k) => t + cnt[k], 0) }))
  // 색은 8개뿐이라, 작은 묶음은 가장 많이 이어진 묶음에 합쳐서 8개 이하로
  while (cl.length > 8) {
    cl.sort((a, b) => a.size - b.size)
    const small = cl.shift()!
    let best = cl[0], bw = -1
    cl.forEach(c => { let w = 0; c.kws.forEach(k => small.kws.forEach(o => { w += (nb[k][o] || 0) })); if (w > bw) { bw = w; best = c } })
    best.kws = best.kws.concat(small.kws); best.size += small.size
  }
  const loners = ks.filter(k => !(deg[k] > 0))   // 다른 키워드와 한 번도 같이 안 나온 것 → 회색
  const clusters: Rec[] = cl.map(c => ({ kws: c.kws.sort((a, b) => cnt[b] - cnt[a]), size: c.size }))
    .sort((a, b) => b.size - a.size || a.kws[0].localeCompare(b.kws[0]))
  if (loners.length) clusters.push({ kws: loners, size: 0, loners: true })
  const clusterOf: Record<string, number> = {}; clusters.forEach((c, i) => { c.i = c.loners ? 99 : i; c.kws.forEach((k: string) => clusterOf[k] = c.i) })
  TOPIC = { cnt, co, nb, kwBooks, bookKw, clusters, clusterOf, ranked: ks }; TOPIC_KEY = key
  return TOPIC
}
// 전체 필사의 키워드 수 (기간과 상관없이, 글쓰기 '필사 넣기'에서 씀)
export function keywordCounts() { const c: Record<string, number> = {}; S.snips.forEach((s: Rec) => uniq(splitKw(s['키워드'])).forEach(k => c[k] = (c[k] || 0) + 1)); return c }
export function coCount(a: string, b: string) { const T = topicData(); const [x, y] = [a, b].sort(); return T.co[x + '\u0001' + y] || 0 }
export function clusterColor(i: number | null | undefined) {
  const pal = CLUSTER_COLORS[document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light']
  return i != null && i < 8 ? pal[i] : cssVar('--faint')
}
export function relatedKw(k: string, n: number) {
  const T = topicData()
  return Object.keys(T.nb[k] || {}).map(o => ({ k: o, c: coCount(k, o), w: T.nb[k][o] }))
    .filter(x => x.c > 0).sort((a, b) => b.c - a.c || b.w - a.w).slice(0, n)
}
export function graphLabel(id: string | null) {
  if (!id) return ''
  if (id.startsWith('k:')) return '#' + id.slice(2)
  if (id.startsWith('b:')) return (book(id.slice(2)) || {})['제목'] || ''
  return id.slice(2)
}

function seeded(str: string) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296 }
export function buildGraph() {
  const T = topicData()
  const nodes: Record<string, N> = {}, edges: { a: string; b: string; w: number }[] = []
  const add = (id: string, type: string, label: string, ref: string, w?: number) => nodes[id] || (nodes[id] = { id, type, label, ref, w: w || 0, x: 0, y: 0, r: 0 })
  const link = (a: string, b: string, w?: number) => { if (!nodes[a] || !nodes[b] || a === b) return; edges.push({ a, b, w: w || 1 }) }
  const kwSet = (n: number) => (n ? T.ranked.slice(0, n) : T.ranked.filter(k => T.cnt[k] >= 1))
  let mode = G.mode
  if (G.focus) {
    mode = 'focus'
    const fid = G.focus as string
    if (fid.startsWith('k:')) {
      const k = fid.slice(2)
      add(fid, 'kw', '#' + k, k, T.cnt[k] || 1)
      const rel = relatedKw(k, 12)
      rel.forEach(r => { add('k:' + r.k, 'kw', '#' + r.k, r.k, T.cnt[r.k]); link(fid, 'k:' + r.k, r.c) })
      const bs = Object.entries(T.kwBooks[k] || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
      bs.forEach(([bid, n]) => { const b = book(bid); if (!b) return; add('b:' + bid, 'book', b['제목'], bid, n); link(fid, 'b:' + bid, n) })
      rel.forEach(r => bs.forEach(([bid]) => { const n = (T.bookKw[bid] || {})[r.k]; if (n) link('k:' + r.k, 'b:' + bid, n) }))
      for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) { const c = coCount(rel[i].k, rel[j].k); if (c >= 2) link('k:' + rel[i].k, 'k:' + rel[j].k, c) }
    } else if (fid.startsWith('b:')) {
      const bid = fid.slice(2), b = book(bid)
      if (b) {
        add(fid, 'book', b['제목'], bid, 10)
        const mine = Object.entries(T.bookKw[bid] || {}).sort((a, c) => c[1] - a[1]).slice(0, 15)
        mine.forEach(([k, n]) => { add('k:' + k, 'kw', '#' + k, k, T.cnt[k]); link(fid, 'k:' + k, n) })
        const share: Record<string, number> = {}
        mine.forEach(([k]) => Object.keys(T.kwBooks[k] || {}).forEach(o => { if (o !== bid) share[o] = (share[o] || 0) + 1 }))
        Object.entries(share).filter(([, n]) => n >= 2).sort((a, c) => c[1] - a[1]).slice(0, 8).forEach(([o]) => {
          const ob = book(o); if (!ob) return; add('b:' + o, 'book', ob['제목'], o, 3)
          mine.forEach(([k]) => { const n = (T.bookKw[o] || {})[k]; if (n) link('b:' + o, 'k:' + k, n) })
        })
      }
    }
  } else if (mode === 'topic') {
    const ks = kwSet(G.top)
    const inSet = new Set(ks)
    ks.forEach(k => add('k:' + k, 'kw', '#' + k, k, T.cnt[k]))
    // 키워드마다 가장 강하게 이어진 4개만 → 실타래가 되지 않게
    const seen = new Set<string>()
    ks.forEach(k => {
      Object.entries(T.nb[k] || {}).filter(([o]) => inSet.has(o) && coCount(k, o) > 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 4)
        .forEach(([o]) => { const kk = [k, o].sort().join('\u0001'); if (seen.has(kk)) return; seen.add(kk); link('k:' + k, 'k:' + o, coCount(k, o)) })
    })
  } else {
    const ks = new Set(kwSet(G.top))
    Object.entries(T.bookKw).forEach(([bid, m]) => {
      const b = book(bid); if (!b) return
      Object.entries(m).forEach(([k, n]) => { if (!ks.has(k)) return; add('b:' + bid, 'book', b['제목'], bid); add('k:' + k, 'kw', '#' + k, k, T.cnt[k]); link('b:' + bid, 'k:' + k, n) })
    })
    if (G.opt.au) {
      const m: Record<string, Rec[]> = {}
      gBooks().forEach(b => splitAuthors(b['저자']).forEach(a => (m[a] = m[a] || []).push(b)))
      Object.entries(m).filter(([, bs]) => bs.length >= 2).forEach(([a, bs]) => bs.forEach(b => { add('b:' + b.ID, 'book', b['제목'], b.ID); add('a:' + a, 'au', a, a, bs.length); link('b:' + b.ID, 'a:' + a, 1) }))
    }
    if (G.opt.cat) {
      const m: Record<string, Rec[]> = {}
      gBooks().forEach(b => { const c = String(b['개인분류'] || '').trim(); if (c) (m[c] = m[c] || []).push(b) })
      Object.entries(m).filter(([, bs]) => bs.length >= 2).forEach(([c, bs]) => bs.forEach(b => { add('b:' + b.ID, 'book', b['제목'], b.ID); add('c:' + c, 'cat', c, c, bs.length); link('b:' + b.ID, 'c:' + c, 1) }))
    }
  }
  G.cfg = CFG[mode] || CFG.book
  G.view = mode
  const old: Record<string, N> = G.byId || {}
  const list = Object.values(nodes)
  const R = Math.sqrt(list.length) * (mode === 'book' ? 40 : 60)
  list.forEach(n => {
    const o = old[n.id]
    if (o && mode !== 'focus') { n.x = o.x; n.y = o.y } else { const r = seeded(n.id); const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R; n.x = Math.cos(a) * d; n.y = Math.sin(a) * d }
    if (n.type === 'kw') { n.cl = T.clusterOf[n.ref]; n.r = 5 + Math.min(17, Math.sqrt(T.cnt[n.ref] || 1) * 1.9) } else if (n.type === 'book') n.r = mode === 'focus' ? 9 : 7
    else n.r = 6 + Math.min(8, Math.sqrt(n.w) * 2)
    if (G.focus === n.id) { n.x = 0; n.y = 0; n.pin = true; n.r += 4 }
  })
  G.nodes = list; G.edges = edges.map(e => ({ a: nodes[e.a], b: nodes[e.b], w: e.w }))
  G.byId = nodes; G.nb = {}
  G.edges.forEach((e: E) => { (G.nb[e.a.id] = G.nb[e.a.id] || new Set()).add(e.b.id); (G.nb[e.b.id] = G.nb[e.b.id] || new Set()).add(e.a.id) })
  if (G.sel && !nodes[G.sel.id]) G.sel = null; else if (G.sel) G.sel = nodes[G.sel.id]
  simulate(list.some(n => !old[n.id]) || mode === 'focus' ? 360 : 60)
}
export function simulate(iters: number) {
  const NN: N[] = G.nodes, EE: E[] = G.edges, n = NN.length
  if (!n) return
  for (let it = 0; it < iters; it++) {
    const alpha = 1 - it / iters
    const C = G.cfg
    NN.forEach(p => { p.fx = -p.x * C.grav; p.fy = -p.y * C.grav })
    for (let i = 0; i < n; i++) {
      const a = NN[i]
      for (let j = i + 1; j < n; j++) {
        const b = NN[j]
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy
        if (d2 > C.cut * C.cut) continue
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
        const f = C.rep / d2
        a.fx! += dx * f; a.fy! += dy * f; b.fx! -= dx * f; b.fy! -= dy * f
      }
    }
    EE.forEach(e => {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1
      const L = C.len + e.a.r + e.b.r, k = C.k * Math.min(3, 1 + Math.log(e.w))
      const f = (d - L) * k / d
      e.a.fx! += dx * f; e.a.fy! += dy * f; e.b.fx! -= dx * f; e.b.fy! -= dy * f
    })
    NN.forEach(p => {
      if (p === G.drag || p.pin) return
      const m = Math.max(1.5, 22 * alpha)
      p.x += Math.max(-m, Math.min(m, p.fx!)); p.y += Math.max(-m, Math.min(m, p.fy!))
    })
  }
}
function nodeR(n: N) { return n.r * Math.max(0.75, Math.min(1.35, Math.sqrt(G.scale / 0.6))) }   // 화면 기준 크기
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
export function drawGraph() {
  const cv = document.getElementById('g-canvas') as HTMLCanvasElement | null; if (!cv) return
  const ctx = cv.getContext('2d')!, dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr)
  const W = cv.width / dpr, H = cv.height / dpr
  const colBook = G.view === 'focus' || G.view === 'book' ? cssVar('--sub') : cssVar('--n-book')
  const col = (n: N) => n.type === 'kw' ? clusterColor(n.cl) : n.type === 'book' ? colBook : n.type === 'au' ? cssVar('--n-au') : cssVar('--n-cat')
  const line = cssVar('--line'), ink = cssVar('--ink'), sub = cssVar('--sub'), card = cssVar('--card')
  const sel: N | null = G.sel, near: Set<string> = sel ? (G.nb[sel.id] || new Set()) : new Set()
  const lit = (n: N) => sel ? (n === sel || near.has(n.id)) : G.hl != null ? (n.type === 'kw' && n.cl === G.hl) : true
  if (!G.nodes.length) { ctx.fillStyle = sub; ctx.font = '14px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('보여줄 연결이 없어요.', W / 2, H / 2); return }
  const sx = (n: N) => n.x * G.scale + G.ox, sy = (n: N) => n.y * G.scale + G.oy
  ;(G.edges as E[]).forEach(e => {
    const on = sel ? (e.a === sel || e.b === sel) : G.hl != null ? (lit(e.a) && lit(e.b)) : false
    const dim = (sel || G.hl != null) && !on
    ctx.globalAlpha = dim ? 0.07 : on ? 0.8 : 0.5
    ctx.strokeStyle = on && sel ? col(sel) : line
    ctx.lineWidth = Math.min(3.2, (on ? 1.4 : 0.8) + Math.log(e.w + 1) * 0.55)
    ctx.beginPath(); ctx.moveTo(sx(e.a), sy(e.a)); ctx.lineTo(sx(e.b), sy(e.b)); ctx.stroke()
  })
  ;(G.nodes as N[]).forEach(n => {
    const x = sx(n), y = sy(n), r = nodeR(n)
    if (x < -30 || y < -30 || x > W + 30 || y > H + 30) return
    ctx.globalAlpha = lit(n) ? 1 : 0.13
    ctx.fillStyle = col(n); ctx.strokeStyle = card; ctx.lineWidth = 2
    ctx.beginPath()
    if (n.type === 'book') roundRect(ctx, x - r * 0.72, y - r, r * 1.44, r * 2, 2)
    else if (n.type === 'kw') ctx.arc(x, y, r, 0, Math.PI * 2)
    else if (n.type === 'au') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath() }
    else { ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.95, y + r * 0.75); ctx.lineTo(x - r * 0.95, y + r * 0.75); ctx.closePath() }
    ctx.fill(); ctx.stroke()
    if (n === sel || (G.focus === n.id && !sel)) { ctx.lineWidth = 2.5; ctx.strokeStyle = ink; ctx.stroke() }
  })
  // 이름표: 선택 > 이어진 것 > 큰 키워드 순. 겹치면 건너뜀 (작은 키워드는 확대하면 보임)
  const cnt = topicData().cnt
  const pri = (n: N) => {
    if (n === sel || G.focus === n.id) return 1e6
    if (sel) return near.has(n.id) ? 1e5 + n.w : -1
    if (G.hl != null) return lit(n) ? 1e5 + n.w : -1
    return (n.type === 'book' ? (G.view === 'book' ? 0 : 500) : 1000) + (n.type === 'kw' ? (cnt[n.ref] || 0) : n.w)
  }
  const order = (G.nodes as N[]).slice().sort((a, b) => pri(b) - pri(a))
  const boxes: number[][] = []
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  order.forEach(n => {
    const p = pri(n); if (p < 0) return
    if (n.type === 'book' && G.view === 'book' && p < 1e5 && G.scale < 0.85) return
    const t = n.label.length > 13 ? n.label.slice(0, 12) + '…' : n.label
    const big = p >= 1e6
    const fsz = big ? 14 : n.type === 'book' ? 11.5 : Math.round(11 + Math.min(3, Math.sqrt(cnt[n.ref] || 1) * 0.35))
    ctx.font = `${n.type === 'book' ? 500 : 650} ${fsz}px Pretendard, -apple-system, sans-serif`
    const w = ctx.measureText(t).width, x = sx(n), y = sy(n) + nodeR(n) + 3
    const box = [x - w / 2 - 2, y - 1, x + w / 2 + 2, y + fsz + 2]
    if (box[2] < 0 || box[0] > W || box[3] < 0 || box[1] > H) return
    if (!big && boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return
    boxes.push(box)
    ctx.globalAlpha = 1
    ctx.lineWidth = 4; ctx.strokeStyle = card; ctx.strokeText(t, x, y)
    ctx.fillStyle = n.type === 'book' ? sub : ink; ctx.fillText(t, x, y)
  })
  ctx.globalAlpha = 1
}
export function zoomAt(p: { x: number; y: number }, k0: number) {
  const s = Math.max(0.2, Math.min(4, G.scale * k0)), k = s / G.scale
  G.ox = p.x - (p.x - G.ox) * k; G.oy = p.y - (p.y - G.oy) * k; G.scale = s
}
export function gZoom(k: number) { const cv = document.getElementById('g-canvas'); if (!cv) return; const r = cv.getBoundingClientRect(); zoomAt({ x: r.width / 2, y: r.height / 2 }, k); drawGraph() }
export function gFit() {
  const cv = document.getElementById('g-canvas'); if (!cv) return
  const r = cv.getBoundingClientRect()
  if (!G.nodes.length) { G.scale = 1; G.ox = r.width / 2; G.oy = r.height / 2; drawGraph(); return }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  ;(G.nodes as N[]).forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y) })
  const pad = 46, w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
  G.scale = Math.max(0.2, Math.min(2, Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)))
  G.ox = r.width / 2 - (x0 + w / 2) * G.scale; G.oy = r.height / 2 - (y0 + h / 2) * G.scale
  drawGraph()
}
/* 캔버스: 끌기 · 두 손가락 확대 · 누르기 */
export function setupCanvas(cv: HTMLCanvasElement, onTap: (n: N | null) => void) {
  const fit = () => { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; drawGraph() }
  G.resize = fit
  fit()
  const pos = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const world = (p: { x: number; y: number }) => ({ x: (p.x - G.ox) / G.scale, y: (p.y - G.oy) / G.scale })
  const hit = (p: { x: number; y: number }) => {
    const w = world(p); let best: N | null = null, bd = Infinity
    ;(G.nodes as N[]).forEach(n => { const d = Math.hypot(n.x - w.x, n.y - w.y) * G.scale; if (d < nodeR(n) + 9 && d < bd) { bd = d; best = n } })
    return best
  }
  const pinchState = () => { const [a, b] = [...G.ptr.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } } }
  cv.onpointerdown = e => {
    cv.setPointerCapture(e.pointerId)
    G.ptr.set(e.pointerId, pos(e)); G.moved = 0
    if (G.ptr.size === 1) { G.drag = hit(pos(e)); G.last = pos(e); cv.classList.add('dragging') } else { G.drag = null; G.pinch = pinchState() }
  }
  cv.onpointermove = e => {
    if (!G.ptr.has(e.pointerId)) return
    const p = pos(e); G.ptr.set(e.pointerId, p)
    if (G.ptr.size >= 2 && G.pinch) {
      const s = pinchState(), k = s.d / G.pinch.d
      zoomAt(s.c, k); G.ox += s.c.x - G.pinch.c.x; G.oy += s.c.y - G.pinch.c.y; G.pinch = s; G.moved = 99; drawGraph(); return
    }
    const dx = p.x - G.last.x, dy = p.y - G.last.y; G.moved += Math.abs(dx) + Math.abs(dy); G.last = p
    if (G.drag && G.moved > 3) { G.drag.x += dx / G.scale; G.drag.y += dy / G.scale; simulate(2) } else if (!G.drag) { G.ox += dx; G.oy += dy }
    drawGraph()
  }
  cv.onpointerup = cv.onpointercancel = e => {
    const wasTap = G.ptr.size === 1 && G.moved < 6
    G.ptr.delete(e.pointerId); cv.classList.remove('dragging')
    if (wasTap) onTap(hit(pos(e)))
    if (G.ptr.size < 2) G.pinch = null
    if (!G.ptr.size) G.drag = null
  }
  cv.onwheel = e => { e.preventDefault(); zoomAt(pos(e), e.deltaY < 0 ? 1.12 : 0.89); drawGraph() }
}
window.addEventListener('resize', () => { if (S.view === 'graph' && G.resize) G.resize() })
