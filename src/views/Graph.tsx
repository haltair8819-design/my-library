/* 독서 연결망 화면 + 키워드 정리 창 */
import { useEffect, useRef, useState } from 'react'
import { S, emit, book, snipsOf, sText, pgLabel, hasPage, splitKw, uniq, type Rec } from '../lib/core'
import { G, topicData, gSnips, gPeriodLabel, gYears, gReading, snipDay, relatedKw, clusterColor, graphLabel, buildGraph, drawGraph, gFit, gZoom, setupCanvas } from '../lib/graph'
import { keywordStats, call } from '../lib/book'
import { go } from '../lib/nav'
import { modal, closeModal, toast } from '../lib/ui'
import { $ } from '../lib/voice'
import { Sub } from '../components/common'
import { openSnipInBook } from './Book'

S.gOpen = {}; S.gLimit = 5
const rerender = () => { drawGraph(); emit() }
function gSelect(n: Rec | null, center: boolean) {
  if (n !== G.sel) { S.gLimit = 5; S.gOpen = {} }
  G.sel = n && G.sel === n && !center ? null : n
  if (G.sel) G.hl = null
  if (G.sel && center) {
    const r = document.getElementById('g-canvas')!.getBoundingClientRect()
    G.ox = r.width / 2 - G.sel.x * G.scale; G.oy = r.height / 2 - G.sel.y * G.scale
  }
  rerender()
}
function gFocus(id: string) {
  G.focus = id; G.sel = null; G.hl = null; G.q = ''
  S.gRebuild = (S.gRebuild || 0) + 1; emit()
  setTimeout(() => { G.sel = G.byId[id] || null; rerender(); const wrap = document.querySelector('.g-wrap'); if (wrap) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, 30)
}
function gUnfocus() {
  const was = G.focus; G.focus = null; G.sel = null; S.gRebuild = (S.gRebuild || 0) + 1; emit()
  setTimeout(() => { if (was && G.byId[was]) gSelect(G.byId[was], true) }, 30)
}
function gSetPeriod(y: string, m: string) { G.period = { y, m }; G.focus = null; G.sel = null; G.hl = null; S.gLimit = 5; S.gOpen = {}; S.gRebuild = (S.gRebuild || 0) + 1; emit() }

// 칩 묶음: 처음엔 몇 개만, '+ n개 더'로 펼치기
function Chips({ id, items, n }: { id: string; items: React.ReactNode[]; n: number }) {
  if (!items.length) return null
  const open = S.gOpen[id], shown = open ? items : items.slice(0, n)
  return <div className="kw-chips" style={{ margin: '0 0 6px' }}>{shown}{items.length > n && <button className="chip more-chip" onClick={() => { S.gOpen[id] = !open; emit() }}>{open ? '접기' : `+ ${items.length - n}개 더`}</button>}</div>
}
function SnipMini({ s }: { s: Rec }) {
  const b = book(s['책ID']) || {}
  return <button className="mini" onClick={() => openSnipInBook(s.ID)}><b>{s['제목'] || b['제목'] || ''}</b>
    <span>{sText(s).slice(0, 110)}{sText(s).length > 110 ? '…' : ''}</span><em>{b['제목'] || ''}{hasPage(s) ? ' · ' + pgLabel(s['쪽수']) : ''}</em></button>
}
function SnipList({ list }: { list: Rec[] }) {
  const lim = S.gLimit || 5
  return <><div className="ic-lb">문장 <span className="small">누르면 그 문장으로 가요</span></div>
    {list.length ? list.slice(0, lim).map(s => <SnipMini key={s.ID} s={s} />) : <div className="small">문장이 없어요</div>}
    {list.length > lim && <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => { S.gLimit = lim + 20; emit() }}>더보기 ({list.length - lim}개 남음)</button>}</>
}
const kwChip = (k: string, n: number) => <button key={k} className="chip" onClick={() => gFocus('k:' + k)}>#{k}<b>{n}</b></button>
function Info() {
  const T = topicData(), n = G.sel
  if (!n && G.hl != null && !G.focus) {   // 색 묶음을 눌렀을 때: 그 묶음 키워드가 달린 문장 전부
    const c = T.clusters.find(x => x.i === G.hl)
    if (c) {
      const set = new Set(c.kws), list = gSnips().filter(s => splitKw(s['키워드']).some(k => set.has(k)))
      return <div className="info-card"><div className="ic-head"><h3><i className="dot" style={{ background: clusterColor(c.i) }} />{c.kws.slice(0, 3).join(' · ')}{c.kws.length > 3 ? ' …' : ''}</h3>
        <button className="btn" onClick={() => { G.hl = null; rerender() }}>묶음 풀기</button></div>
        <div className="sub">키워드 {c.kws.length}개 · 문장 {list.length}개 · 책 {new Set(list.map(s => s['책ID'])).size}권</div>
        <Chips id="ck" items={c.kws.map((k: string) => kwChip(k, T.cnt[k] || 0))} n={6} />
        <SnipList list={list} /></div>
    }
  }
  if (!n && G.period.y && !G.focus) {   // 기간을 골랐을 때: 그 기간에 읽은 책의 필사 전부
    const list = gSnips().slice().sort((a, b) => snipDay(b).localeCompare(snipDay(a)) || String(a['책ID']).localeCompare(String(b['책ID'])))
    const bc: Record<string, number> = {}; list.forEach(s => bc[s['책ID']] = (bc[s['책ID']] || 0) + 1)
    return <div className="info-card"><div className="ic-head"><h3>{gPeriodLabel()} 책의 필사</h3></div>
      <div className="sub">문장 {list.length}개 · 책 {Object.keys(bc).length}권 · 키워드 {T.ranked.length}개</div>
      <div className="ic-lb">책</div><Chips id="pb" items={Object.entries(bc).sort((a, b) => b[1] - a[1]).map(([bid, c]) => { const b = book(bid); return b ? <button key={bid} className="chip" onClick={() => go('book', bid)}>{b['제목']}<b>{c}</b></button> : null }).filter(Boolean)} n={4} />
      {T.ranked.length > 0 && <><div className="ic-lb">많이 나온 키워드</div><Chips id="pk" items={T.ranked.map(k => kwChip(k, T.cnt[k]))} n={6} /></>}
      <SnipList list={list} /></div>
  }
  if (!n) return <><div className="drill">점을 누르면 이어진 키워드와 책, 문장을 보여줘요. 색 이름표를 누르면 그 주제만 밝게 보여요. 두 손가락으로 확대, 끌어서 이동할 수 있어요.</div>
    {!G.focus && <Chips id="dk" items={T.ranked.slice(0, 40).map(k => kwChip(k, T.cnt[k]))} n={8} />}</>
  if (n.type === 'kw') {
    const k = n.ref
    const list = gSnips().filter(s => splitKw(s['키워드']).includes(k))
    const nb = new Set(list.map(s => s['책ID']))
    const rel = relatedKw(k, 10)
    const books = Object.entries(T.kwBooks[k] || {}).sort((a, b) => b[1] - a[1]).map(([bid, c]) => [book(bid), c] as [Rec | undefined, number]).filter(x => x[0]) as [Rec, number][]
    return <div className="info-card">
      <div className="ic-head"><h3><i className="dot" style={{ background: clusterColor(T.clusterOf[k]) }} />#{k}</h3>
        {G.focus !== n.id && <button className="btn" onClick={() => gFocus('k:' + k)}>이 주제만 보기</button>}</div>
      <div className="sub">문장 {list.length}개 · 책 {nb.size}권</div>
      {rel.length > 0 && <><div className="ic-lb">함께 자주 나온 키워드</div><Chips id="kr" items={rel.map(r => kwChip(r.k, r.c))} n={5} /></>}
      <div className="ic-lb">이 키워드가 나온 책</div><Chips id="kb" items={books.map(([b, c]) => <button key={b.ID} className="chip" onClick={() => go('book', b.ID)}>{b['제목']}<b>{c}</b></button>)} n={4} />
      <SnipList list={list} /></div>
  }
  if (n.type === 'book') {
    const b = book(n.ref); if (!b) return null
    const kws = Object.entries(T.bookKw[b.ID] || {}).sort((a, c) => c[1] - a[1])
    return <div className="info-card"><div className="ic-head"><h3>{b['제목']}</h3></div>
      <div className="sub">{b['저자']}{b['개인분류'] ? ' · ' + b['개인분류'] : ''} · 필사 {snipsOf(b.ID).length}개</div>
      {kws.length > 0 && <div className="kw-chips" style={{ margin: '0 0 10px' }}>{kws.slice(0, 16).map(([k, c]) => kwChip(k, c))}</div>}
      <div className="actions" style={{ margin: 0 }}><button className="btn primary" onClick={() => go('book', b.ID)}>책 열기</button>
        {G.focus !== n.id && <button className="btn" onClick={() => gFocus('b:' + b.ID)}>이 책 중심으로 보기</button>}</div></div>
  }
  const books = [...(G.nb[n.id] || [])].map((id: string) => G.byId[id]).filter((x: Rec) => x && x.type === 'book').map((x: Rec) => book(x.ref)).filter(Boolean) as Rec[]
  return <div className="info-card"><h3>{n.label}</h3><div className="sub">{n.type === 'au' ? '저자' : '개인분류'} · 책 {books.length}권</div>
    {books.map(b => <button key={b.ID} className="mini" onClick={() => go('book', b.ID)}><b>{b['제목']}</b><span>{b['저자']}</span></button>)}</div>
}
function Legend() {
  const T = topicData()
  const shown = new Set((G.nodes as Rec[]).filter(n => n.type === 'kw').map(n => n.cl))
  const cl = T.clusters.filter(c => !c.loners && shown.has(c.i))
  const kinds: React.ReactNode[] = []
  if ((G.nodes as Rec[]).some(n => n.type === 'book')) kinds.push(<span key="b"><i className="lg-book" />책</span>)
  if ((G.nodes as Rec[]).some(n => n.type === 'au')) kinds.push(<span key="a"><i className="lg-au" />저자 (2권 이상)</span>)
  if ((G.nodes as Rec[]).some(n => n.type === 'cat')) kinds.push(<span key="c"><i className="lg-cat" />개인분류</span>)
  return <div className="legend" id="g-legend">
    {cl.length > 0 && <div className="g-clusters">{cl.map(c => <button key={c.i} className={'g-cl ' + (G.hl === c.i ? 'on' : '')} onClick={() => {
      G.hl = G.hl === c.i ? null : c.i; G.sel = null; S.gLimit = 5; S.gOpen = {}; rerender()
      if (G.hl != null) setTimeout(() => { const el = document.getElementById('g-info'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, 50)
    }}><i style={{ background: clusterColor(c.i) }} />{c.kws.slice(0, 3).join(' · ')}</button>)}
      {shown.has(99) && <span className="g-cl muted"><i style={{ background: clusterColor(99) }} />혼자 쓰인 키워드</span>}</div>}
    {kinds.length > 0 && <div className="g-kinds">{kinds}<span className="small">● 키워드 (크기 = 문장 수)</span></div>}</div>
}
function Suggest() {
  const q = G.q.trim().replace(/^#/, '').toLowerCase()
  if (!q) return <div id="g-sug" className="g-sug" />
  const T = topicData()
  const kws = T.ranked.filter(k => k.toLowerCase().includes(q)).slice(0, 8).map(k => ({ id: 'k:' + k, t: '#' + k, s: T.cnt[k] + '문장' }))
  const bs = S.books.filter((b: Rec) => (String(b['제목']) + String(b['저자'])).toLowerCase().includes(q)).slice(0, 5).map((b: Rec) => ({ id: 'b:' + b.ID, t: b['제목'], s: '책' }))
  const all = kws.concat(bs)
  return <div id="g-sug" className="g-sug">{all.length ? all.map(x => <button key={x.id} className="chip" data-n={x.id} onClick={() => gFocus(x.id)}>{x.t} <span className="small">{x.s}</span></button>) : <span className="small">찾는 키워드나 책이 없어요</span>}</div>
}
export function GraphView() {
  const cv = useRef<HTMLCanvasElement>(null)
  const T = topicData()
  const hasKw = T.ranked.length > 0
  if (!hasKw && G.mode === 'topic') G.mode = 'book'
  const key = [G.mode, G.top, G.opt.au, G.opt.cat, G.period.y, G.period.m, G.focus, S.gRebuild || 0, S.snips.length].join('|')
  useEffect(() => { if (cv.current) setupCanvas(cv.current, n => gSelect(n, false)) }, [])
  useEffect(() => { buildGraph(); gFit(); emit() }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  const tops: [number, string][] = [[30, '30개'], [60, '60개'], [0, '전체']]
  const set = (f: () => void) => { f(); S.gRebuild = (S.gRebuild || 0) + 1; emit() }
  const ys = gYears(), y = G.period.y, rd = gReading()
  const months = y && !rd ? uniq(S.snips.map(snipDay).filter((d: string) => d.startsWith(y)).map((d: string) => d.slice(5, 7)).filter(Boolean)).sort() as string[] : []
  return <section id="v-graph">
    <div className="view-head ai-head"><div><h1>독서 연결망</h1><p>{G.period.y ? <><b>{gPeriodLabel()}</b> 책만 · </> : null}{G.focus ? <><b>{graphLabel(G.focus)}</b>과 이어진 것만 보고 있어요.</> : G.mode === 'topic' ? '함께 자주 나오는 키워드끼리 이어지고, 비슷한 주제는 같은 색이에요.' : '책과 키워드가 어떻게 이어지는지 보여줘요.'}</p></div>
      <button className="btn" onClick={() => openKwManager()}>키워드 정리</button></div>
    <div className="g-search"><input className="field" id="g-q" placeholder="키워드 · 책 찾기" value={G.q} autoComplete="off" onChange={e => { G.q = e.target.value; emit() }}
      onKeyDown={e => { if (e.key === 'Enter') { const f = document.querySelector<HTMLButtonElement>('#g-sug [data-n]'); if (f) f.click() } }} /><Suggest /></div>
    {G.focus ? <div className="chips"><button className="chip on" onClick={gUnfocus}>← 전체 지도로</button></div> : <div className="chips" id="g-modes">
      <button className={'chip ' + (G.mode === 'topic' ? 'on' : '')} onClick={() => set(() => { G.mode = 'topic'; G.sel = null; G.hl = null })}>주제 지도</button>
      <button className={'chip ' + (G.mode === 'book' ? 'on' : '')} onClick={() => set(() => { G.mode = 'book'; G.sel = null; G.hl = null })}>책과 주제</button>
      <span className="g-sep" />
      {tops.map(([n, t]) => <button key={n} className={'chip ' + (G.top === n ? 'on' : '')} onClick={() => set(() => { G.top = n })}>{t}</button>)}
      {G.mode === 'book' && <><span className="g-sep" />{([['au', '저자'], ['cat', '개인분류']] as const).map(([k, t]) => <button key={k} className={'chip ' + (G.opt[k] ? 'on' : '')} onClick={() => set(() => { G.opt[k] = !G.opt[k] })}>{t}</button>)}</>}
    </div>}
    {!G.focus && <div className="g-period"><span>기간</span>
      <select className="field" value={rd ? 'reading' : y} onChange={e => gSetPeriod(e.target.value, '')}><option value="">전체</option><option value="reading">지금 읽는 중</option>{ys.map(x => <option key={x} value={x}>{x}년</option>)}</select>
      <select className="field" disabled={!(y && !rd)} value={G.period.m} onChange={e => gSetPeriod(y, e.target.value)}><option value="">{y && !rd ? '1년 전체' : '월'}</option>{months.map(m => <option key={m} value={m}>{Number(m)}월</option>)}</select>
      <em>{y ? `문장 ${gSnips().length.toLocaleString()}개` : ''}</em></div>}
    {!hasKw && <div className="notice">{G.period.y ? '이 기간에 읽은 책에는 키워드가 달린 문장이 없어요.' : '아직 키워드가 달린 문장이 없어요. 필사 문장에 키워드를 달면 주제 지도가 채워져요.'}</div>}
    <div className="g-wrap">
      <canvas id="g-canvas" ref={cv} aria-label="독서 연결망" />
      <div className="g-tools">
        <button onClick={() => gZoom(1.25)} aria-label="확대">＋</button>
        <button onClick={() => gZoom(0.8)} aria-label="축소">－</button>
        <button onClick={gFit} aria-label="전체 보기">⤢</button>
      </div>
    </div>
    <Legend />
    <div id="g-info"><Info /></div>
  </section>
}

/* ---------- 키워드 정리 ---------- */
function KwManager({ filter }: { filter?: string }) {
  const [f, setF] = useState(filter || '')
  const all = keywordStats()
  return <>
    <h3>키워드 정리 <Sub>{all.length}개</Sub></h3>
    <input className="field" id="kw-filter" type="search" placeholder="키워드 찾기" value={f} onChange={e => setF(e.target.value)} autoComplete="off" />
    <div className="kw-list" id="kw-list">{all.filter(k => !f || k.kw.includes(f.trim().replace(/^#/, ''))).map(k => <div className="kw-row" key={k.kw} onClick={() => modal(<KwEdit k={k.kw} />)}><b>#{k.kw}</b><span>문장 {k.n} · 책 {k.books.size}</span></div>)}</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
function KwEdit({ k }: { k: string }) {
  const others = keywordStats().map(x => x.kw).filter(x => x !== k)
  useEffect(() => { setTimeout(() => $('kw-to')?.focus(), 50) }, [])
  const apply = async (to0: string) => {
    const to = String(to0 || '').replace(/^#/, '').trim()
    if (!to && !confirm(`#${k} 키워드를 모든 문장에서 지울까요?`)) return
    let n: number; try { n = await call('renameKeyword', k, to) } catch { return }
    S.snips.forEach((s: Rec) => {
      const ks = splitKw(s['키워드']); if (!ks.includes(k)) return
      const next: string[] = []; ks.forEach(x => { const v = x === k ? to : x; if (v && !next.includes(v)) next.push(v) })
      s['키워드'] = next.join(', ')
    })
    toast(to ? `#${k} → #${to} (${n}개 문장)` : `#${k} 삭제 (${n}개 문장)`)
    G.byId = {}; S.gRebuild = (S.gRebuild || 0) + 1; openKwManager()
  }
  return <>
    <h3>#{k}</h3>
    <label>바꿀 이름 · 합칠 키워드 <span style={{ fontWeight: 400, color: 'var(--faint)' }}>기존 키워드를 고르면 합쳐져요</span></label>
    <input className="field" id="kw-to" list="kw-all" placeholder="예: 고독" /><datalist id="kw-all">{others.map(v => <option key={v} value={v} />)}</datalist>
    <div className="actions">
      <button className="btn danger" onClick={() => apply('')}>키워드 지우기</button>
      <button className="btn" onClick={() => openKwManager()}>뒤로</button>
      <button className="btn primary grow" onClick={() => apply($('kw-to')?.value || '')}>바꾸기</button></div>
  </>
}
export function openKwManager(filter?: string) { modal(<KwManager filter={filter} />) }
