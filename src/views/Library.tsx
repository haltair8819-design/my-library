/* 서재 화면 — 예전 library-book.js renderLibrary · features.js libraryTopHtml */
import { S, emit, FILTERS, FILTER_LABEL, PLATS, platOf, snipsOf, isThought, sText, pgLabel, hasPage, dayDiff, period, progressOf, addDays, splitKw, book, type Rec } from '../lib/core'
import { readLogs, dailyAll, readStreak } from '../lib/logs'
import { lifeOf, searchSnips } from '../lib/book'
import { go } from '../lib/nav'
import { Spine, DueBadge, PickBadge, Highlight } from '../components/common'
import { SyncBadge } from '../components/SyncBadge'
import { openSnipInBook, openAllSnips } from './Book'
import { openLife } from './Life'
import { openSettings } from './Settings'
import { openNote, plainText } from '../lib/notes'
import { openMemo } from './Records'

function StatsRow() {
  const y = S.today.slice(0, 4)
  const done = S.books.filter((b: Rec) => b['상태'] === '완독' && String(b['완독일']).startsWith(y)).length
  const reading = S.books.filter((b: Rec) => b['상태'] === '읽는중').length
  const nT = S.snips.filter(isThought).length
  return <div className="stats" id="stats">
    <div className="stat"><b>{done}</b><span>{y}년 완독</span></div>
    <div className="stat"><b>{reading}</b><span>읽는 중</span></div>
    <div className="stat tap" onClick={() => openAllSnips('필사')}><b>{(S.snips.length - nT).toLocaleString()}</b><span>필사 ›</span></div>
    <div className="stat tap" onClick={() => openAllSnips('생각')}><b>{nT.toLocaleString()}</b><span>생각 · 메모 ›</span></div>
    <div className="stat tap" onClick={openLife}><b>{S.snips.filter((s: Rec) => lifeOf(s) > 0).length.toLocaleString()}</b><span>인생 문장 ›</span></div>
  </div>
}
function Goal() {
  const y = S.today.slice(0, 4)
  const done = S.books.filter((b: Rec) => b['상태'] === '완독' && String(b['완독일']).startsWith(y)).length
  const g = Number(S.settings.goal) || 0
  if (!g) return <div id="goal"><div className="goal small" onClick={openSettings}>＋ {y}년 독서 목표 정하기</div></div>
  return <div id="goal"><div className="goal" onClick={openSettings}><div className="gl"><span>{y}년 목표</span><span><b>{done}</b> / {g}권 · {Math.min(100, Math.round(done / g * 100))}%</span></div>
    <div className="bar"><i style={{ width: Math.min(100, done / g * 100) + '%' }} /></div></div></div>
}
// 서재 위: 오늘 읽은 양 · 연속 기록
function ReadStrip() {
  if (!readLogs().length) return null
  const all = dailyAll(), t = all[S.today], st = readStreak(all)
  let week = 0; for (let i = 0; i < 7; i++) { const d = all[addDays(S.today, -i)]; if (d) week += d.n }
  return <div className="read-strip" onClick={() => { go('stats'); setTimeout(() => { const e = document.getElementById('daily-panel'); if (e) e.scrollIntoView({ block: 'start' }) }, 80) }}>
    <div>{t ? <>오늘 <b>{t.n}쪽</b> 읽었어요</> : '오늘은 아직 기록이 없어요'}{st >= 2 ? ` · 🔥 ${st}일 연속` : ''}</div><span>이번 주 {week.toLocaleString()}쪽 ›</span></div>
}
function DueList({ field, icon, label }: { field: string; icon: string; label: string }) {
  const list = S.books.filter((b: Rec) => { const d = dayDiff(b[field]); return d !== null && d <= 3 }).sort((a: Rec, b: Rec) => (dayDiff(a[field]) as number) - (dayDiff(b[field]) as number))
  if (!list.length) return null
  return <div className="due">{icon} {label}: {list.map((b: Rec, i: number) => { const d = dayDiff(b[field]) as number; return <span key={b.ID}>{i ? ', ' : ''}<a onClick={() => go('book', b.ID)}>{b['제목']}</a> ({d < 0 ? -d + '일 지남' : d === 0 ? '오늘' : 'D-' + d})</span> })}</div>
}
// 다시 만나는 문장 (앱을 켤 때마다 다른 문장)
function TodayQuote() {
  const pool = S.snips.filter((s: Rec) => !isThought(s) && s['유형'] !== '메모' && sText(s).length >= 30 && String(s['내용']).length <= 600)
  if (!pool.length) return null
  if (S.quoteSeed == null) S.quoteSeed = Math.floor(Math.random() * 1e9)
  const s = pool[(S.quoteSeed + S.todayShift * 7919) % pool.length]
  const b = book(s['책ID']) || {}
  return <div className="today">
    <div className="lb"><span>다시 만나는 문장</span><button onClick={() => { S.todayShift++; emit() }}>다른 문장 ↻</button></div>
    <div className="tx" onClick={() => openSnipInBook(s.ID)}>{sText(s)}</div>
    <div className="mt">{b['제목'] || ''}{hasPage(s) ? ' · ' + pgLabel(s['쪽수']) : ''}{s['제목'] ? ' · ' + s['제목'] : ''}</div>
  </div>
}

export function BookCard({ b }: { b: Rec }) {
  const mine = snipsOf(b.ID), nM = mine.filter(x => x['유형'] === '메모').length, nT = mine.filter(isThought).length - nM, nQ = mine.length - nT - nM
  const cat = [b['대분류'], b['개인분류']].filter(Boolean).join(' · ')
  const p = b['상태'] === '읽는중' ? progressOf(b) : null
  const open = (tab?: string) => {
    go('book', b.ID)
    if (tab) { S.bookTab = tab; emit(); setTimeout(() => { const el = document.getElementById('book-tabs'); if (el) el.scrollIntoView({ block: 'start' }) }, 30) }
  }
  const tab = (t: string) => (e: React.MouseEvent) => { e.stopPropagation(); open(t) }
  return <div className="book" data-id={b.ID} onClick={() => open()}>
    <Spine b={b} />
    <div className="binfo">
      <div className="btitle">{b['제목']}</div>
      <div className="bauthor">{b['저자']}</div>
      <div className="bmeta">
        {b['상태'] === '읽는중' && <span className="badge reading">읽는 중</span>}
        {b['상태'] === '읽을예정' && <span className="badge">읽고 싶은</span>}
        {platOf(b) !== '종이책' ? <span className="badge plat eb">{platOf(b)}</span> : <span className="badge plat">종이책</span>}
        <PickBadge b={b} /><DueBadge b={b} />
        {b['별점'] ? <span className="stars">{'★'.repeat(Number(b['별점']) || 0)}</span> : null}
        {nQ ? <span className="badge tapb" onClick={tab('필사')}>필사 {nQ}</span> : null}
        {nT ? <span className="badge tapb think" onClick={tab('생각')}>내 생각 {nT}</span> : null}
        {nM ? <span className="badge tapb plat" onClick={tab('생각')}>메모 {nM}</span> : null}
        {cat && <span>{cat}</span>}
        {period(b) && <span>{period(b)}</span>}
      </div>
      {p && <div className="mini-bar" title={p.pct + '%'}><i style={{ width: p.pct + '%' }} /></div>}
    </div></div>
}

function SnipHits({ q }: { q: string }) {
  const hits = searchSnips(q)
  if (!hits.length) return q.trim().length >= 2 || q.startsWith('#') ? <div className="res-head">필사에서 찾은 문장 0개</div> : null
  return <>
    <div className="res-head">필사에서 찾은 문장 {hits.length}개</div>
    {hits.slice(0, S.hitLimit).map(s => { const b = book(s['책ID']) || {}
      return <div className="hit" key={s.ID} onClick={() => openSnipInBook(s.ID)}>
        {s['제목'] && <div className="ht"><Highlight text={s['제목']} q={q} /></div>}
        <div className="hx"><Highlight text={String(s['내용']).replace('[메모]', '✎')} q={q} /></div>
        <div className="hm">{b['제목'] || ''}{hasPage(s) ? ' · ' + pgLabel(s['쪽수']) : ''}{s['키워드'] ? ' · #' + splitKw(s['키워드']).join(' #') : ''}</div>
      </div> })}
    {hits.length > S.hitLimit && <button className="btn" style={{ width: '100%' }} onClick={() => { S.hitLimit += 30; emit() }}>더 보기 ({hits.length - S.hitLimit}개 남음)</button>}
  </>
}
// 통합 검색: 글 · 메모도
function OtherHits({ q0 }: { q0: string }) {
  const q = String(q0 || '').trim().toLowerCase(); if (!q) return null
  const kw = q.startsWith('#') ? q.slice(1) : ''
  const terms = (kw ? [kw] : q.split(/\s+/)).filter(Boolean)
  const has = (t: string) => terms.every(w => t.toLowerCase().includes(w))
  const notes = S.notes.filter((n: Rec) => kw ? splitKw(n['키워드']).some(k => k.toLowerCase() === kw) : has(n['제목'] + ' ' + n['본문'] + ' ' + n['키워드'])).slice(0, 10)
  const memos = kw ? [] : S.memos.filter((m: Rec) => has(String(m['내용']))).slice(0, 10)
  return <>
    {notes.length > 0 && <><div className="res-head">내 글 {notes.length}편</div>{notes.map((n: Rec) => <div className="hit" key={n.ID} onClick={() => openNote(n.ID)}><div className="ht">✍ {n['제목'] || '제목 없음'}</div>
      <div className="hx"><Highlight text={plainText(n['본문'])} q={q} /></div><div className="hm">{n['상태']} · {String(n['수정일'] || '').slice(0, 10)}</div></div>)}</>}
    {memos.length > 0 && <><div className="res-head">메모 · 할 일 {memos.length}개</div>{memos.map((m: Rec) => <div className="hit" key={m.ID} onClick={() => { go('notes'); setTimeout(() => openMemo(m.ID), 60) }}><div className="hx">{m['종류'] === '할일' ? '☑ ' : '✎ '}<Highlight text={String(m['내용'])} q={q} /></div></div>)}</>}
  </>
}

function List() {
  const q = S.q.trim().toLowerCase()
  if (!S.loaded) return <div id="list" className="list">{S.loadError ? <div className="empty">{S.loadError}<br /><br /><button className="btn" onClick={() => location.reload()}>다시 시도</button></div> : <div className="loading">서재를 불러오는 중…</div>}</div>
  let rows: Rec[] = S.books.filter((b: Rec) => q || (S.filter === '전체' ? b['상태'] !== '읽을예정' : b['상태'] === S.filter))   // 검색할 때는 모든 책에서 · 전체는 읽고 싶은 책 빼고
  if (S.plat && !q) rows = rows.filter(b => platOf(b) === S.plat)
  if (q) rows = q.startsWith('#') ? [] : rows.filter(b => ['제목', '저자', '옮긴이', '출판사', '대분류', '중분류', '개인분류', '한줄평'].some(k => String(b[k] || '').toLowerCase().includes(q)))
  rows.sort((a, b) => String(b['완독일'] || b['시작일']).localeCompare(String(a['완독일'] || a['시작일'])))
  if (q) {
    const books = rows.length ? <><div className="res-head">책 {rows.length}권</div>{rows.slice(0, 20).map(b => <BookCard key={b.ID} b={b} />)}</> : null
    const hasAny = rows.length || searchSnips(S.q).length || (q.length >= 2) || q.startsWith('#')
    return <div id="list" className="list">{books}<SnipHits q={S.q} /><OtherHits q0={S.q} />{!hasAny && <div className="empty">검색 결과가 없어요</div>}</div>
  }
  if (!rows.length && S.plat) return <div id="list" className="list"><div className="empty">{S.plat}으로 {FILTER_LABEL[S.filter] || S.filter} 책이 없어요</div></div>
  if (!rows.length) return <div id="list" className="list"><div className="empty">{S.filter === '읽을예정' ? '읽고 싶은 책을 + 책 추가에서 상태 ‘읽을예정’으로 담아 보세요' : '아직 책이 없어요'}</div></div>
  if (S.filter === '완독') {
    // 월별로 묶어 보기
    const out: React.ReactNode[] = []; let cur: string | null = null
    rows.forEach(b => {
      const m = String(b['완독일']).slice(0, 7)
      if (m !== cur) { cur = m; out.push(<div className="group-label" key={'g' + m}>{m ? m.replace('-', '년 ') + '월' : '날짜 없음'}</div>) }
      out.push(<BookCard key={b.ID} b={b} />)
    })
    return <div id="list" className="list">{out}</div>
  }
  return <div id="list" className="list">{rows.map(b => <BookCard key={b.ID} b={b} />)}</div>
}

export function LibraryView() {
  const q = S.q.trim()
  return <section id="v-library">
    <header>
      <div className="brand"><h1>나의 서재</h1><div className="brand-r"><SyncBadge /><button className="iconbtn" onClick={openSettings}>⚙ 설정</button></div></div>
      {S.loaded && <StatsRow />}
      {S.loaded && <Goal />}
    </header>
    <div id="top">{!q && S.loaded && <><ReadStrip /><DueList field="반납일" icon="📚" label="반납 챙기세요" /><DueList field="수령일" icon="📬" label="예약한 책 받으러 가요" /><TodayQuote /></>}</div>
    <div className="toolbar">
      <input id="q" className="search" type="search" placeholder="책 · 저자 · 문장 · #키워드 검색" autoComplete="off" value={S.q} onChange={e => { S.q = e.target.value; S.hitLimit = 30; emit() }} />
      <div className="chips" id="filters">
        {FILTERS.map(f => <button key={f} className={'chip ' + (S.filter === f ? 'on' : '')} onClick={() => { S.filter = f; emit() }}>{FILTER_LABEL[f] || f}</button>)}
        <span className="chip-sep" />
        {PLATS.filter(p => p !== '오디오북' || S.books.some((b: Rec) => platOf(b) === p)).map(p => <button key={p} className={'chip sub ' + (S.plat === p ? 'on' : '')} onClick={() => { S.plat = S.plat === p ? '' : p; emit() }}>{p}</button>)}
      </div>
    </div>
    <List />
  </section>
}
