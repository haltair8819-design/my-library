/* 독서 통계 · 책 목록(통계에서 누르면) · 독서 리포트 */
import { useState } from 'react'
import { S, LS, emit, book, snipsOf, platOf, starText, addDays, sText, pgLabel, hasPage, splitKw, WD, dateOf, type Rec } from '../lib/core'
import { readLogs, dailyAll, readStreak } from '../lib/logs'
import { splitAuthors, autoCatAll } from '../lib/book'
import { go, goBack, show } from '../lib/nav'
import { modal, closeModal, toast } from '../lib/ui'
import { Spine } from '../components/common'
import { openSettings } from './Settings'

/* ===== 책 목록 (통계에서 누르면: 줄 · 앨범 보기) ===== */
S.blist = null; S.statOpen = {}
const BL_SORTS: Record<string, (a: Rec, b: Rec) => number> = {
  '최근 완독': (a, b) => String(b['완독일'] || '').localeCompare(String(a['완독일'] || '')),
  '오래된 완독': (a, b) => String(a['완독일'] || '9999').localeCompare(String(b['완독일'] || '9999')),
  '별점 높은': (a, b) => (Number(b['별점']) || 0) - (Number(a['별점']) || 0) || String(b['완독일'] || '').localeCompare(String(a['완독일'] || '')),
  '두꺼운': (a, b) => (Number(b['분량']) || 0) - (Number(a['분량']) || 0),
  '빨리 읽은': (a, b) => (Number(a['완독일수']) || 99999) - (Number(b['완독일수']) || 99999),
  '필사 많은': (a, b) => snipsOf(b.ID).length - snipsOf(a.ID).length,
  '제목': (a, b) => String(a['제목']).localeCompare(String(b['제목']), 'ko'),
}
export function openBookList(title: string, books: Rec[], sort?: string, sub?: string) { S.blist = { title, sub: sub || '', ids: books.map(b => b.ID), sort: sort || '최근 완독' }; go('blist') }
function shortDate(d0: unknown) { const d = String(d0 || ''); return d ? d.slice(2, 4) + '.' + d.slice(5, 7) + '.' + d.slice(8, 10) : '' }
function periodText(b: Rec) {
  const s = b['시작일'], e = b['완독일']
  if (!s && !e) return ''
  const days = Number(b['완독일수']) || 0
  const end = e && s && String(e).slice(0, 4) === String(s).slice(0, 4) ? String(e).slice(5, 7) + '.' + String(e).slice(8, 10) : shortDate(e)
  return (s ? shortDate(s) : '') + (e ? ' – ' + end : ' – 읽는 중') + (days ? ` · ${days}일` : '')
}
export function BookListView() {
  const L = S.blist
  if (!L) { setTimeout(() => show('stats'), 0); return <section id="v-blist" /> }
  const mode = LS.get('blist_mode') === 'album' ? 'album' : 'line'
  const books = ((L.ids as string[]).map(book).filter(Boolean) as Rec[]).sort(BL_SORTS[L.sort] || BL_SORTS['최근 완독'])
  const pages = books.reduce((t, b) => t + (Number(b['분량']) || 0), 0)
  const ds = books.map(b => Number(b['완독일수'])).filter(n => n > 0)
  const avg = ds.length ? (ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(1) : ''
  const meta = (b: Rec) => [b['분량'] ? Number(b['분량']).toLocaleString() + '쪽' : '', periodText(b), b['개인분류'] || b['대분류'] || ''].filter(Boolean)
  const setMode = (m: string) => { LS.set('blist_mode', m); emit() }
  return <section id="v-blist">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 뒤로</button></div>
    <div className="bl-head"><h1>{L.title}</h1>
      <p>{books.length}권{pages ? ' · ' + pages.toLocaleString() + '쪽' : ''}{avg ? ' · 한 권 평균 ' + avg + '일' : ''}{L.sub ? ' · ' + L.sub : ''}</p></div>
    <div className="bl-tools">
      <div className="seg bl-mode"><button className={mode === 'line' ? 'on' : ''} onClick={() => setMode('line')} aria-label="한 줄씩 보기">☰ 목록</button><button className={mode === 'album' ? 'on' : ''} onClick={() => setMode('album')} aria-label="표지로 보기">▦ 앨범</button></div>
      <select className="field bl-sort" value={L.sort} onChange={e => { S.blist.sort = e.target.value; emit() }}>{Object.keys(BL_SORTS).map(k => <option key={k} value={k}>{k} 순</option>)}</select>
    </div>
    {!books.length ? <div className="empty">해당하는 책이 없어요.</div> : mode === 'line'
      ? <div className="bl-lines">{books.map(b => <div className="bl-row" key={b.ID} onClick={() => go('book', b.ID)}><Spine b={b} />
        <div className="bl-info"><div className="bl-t">{b['제목']}</div><div className="bl-a">{b['저자'] || ''}</div>
          <div className="bl-m">{meta(b).map((x, i) => <span key={i}>{i ? <i>·</i> : null}{x}</span>)}{Number(b['별점']) ? <><i>·</i><span className="stars">{starText(b['별점'])}</span></> : null}</div></div></div>)}</div>
      : <div className="bl-album">{books.map(b => <div className="bl-card" key={b.ID} onClick={() => go('book', b.ID)}><Spine b={b} />
        <div className="bl-t">{b['제목']}</div><div className="bl-m">{periodText(b)}</div>
        <div className="bl-m">{[b['분량'] ? b['분량'] + '쪽' : '', b['개인분류'] || ''].filter(Boolean).join(' · ')}</div>
        {Number(b['별점']) ? <div className="stars">{starText(b['별점'])}</div> : null}</div>)}</div>}
  </section>
}

/* ===== 매일 독서 기록 (최근 30일) ===== */
function DailyPanel() {
  const [day, setDay] = useState('')
  if (!readLogs().length) return <div className="panel" id="daily-panel"><h3>매일 독서 기록</h3><div className="drill">책 화면의 ‘여기까지 읽었어요’로 읽은 쪽수를 남기면 하루하루 얼마나 읽었는지 여기 쌓여요.</div></div>
  const all = dailyAll(), days = Array.from({ length: 30 }, (_, i) => addDays(S.today, i - 29))
  const vals = days.map(d => (all[d] ? all[d].n : 0)), max = Math.max(1, ...vals)
  const sum = vals.reduce((a, b) => a + b, 0), readDays = vals.filter(Boolean).length
  let week = 0; vals.slice(-7).forEach(v => week += v)
  const o = day ? all[day] : null
  return <div className="panel" id="daily-panel"><h3>매일 독서 기록<small>최근 30일 · 막대를 누르면 그날 읽은 책</small></h3>
    <div className="dsum"><div><b>{week.toLocaleString()}</b><span>이번 주 (쪽)</span></div><div><b>{readDays ? Math.round(sum / readDays) : 0}</b><span>읽은 날 평균 (쪽)</span></div><div><b>{readStreak(all)}</b><span>연속 (일)</span></div></div>
    <div className="dbars">{days.map((d, i) => <div key={d} className={`dbar ${d === S.today ? 'dtoday' : ''} ${day === d ? 'on' : ''}`} title={`${d} · ${vals[i]}쪽`} onClick={() => setDay(d)}><span className="fill" style={{ height: vals[i] / max * 100 + '%' }} /></div>)}</div>
    <div className="dlabels"><span>{days[0].slice(5).replace('-', '.')}</span><span>{days[15].slice(5).replace('-', '.')}</span><span>오늘</span></div>
    <div className="drill" id="drill-day">{day && (o ? <><b>{day.slice(5).replace('-', '.')} ({WD[dateOf(day).getDay()]}) · {o.n}쪽</b><br />{Object.entries(o.books).map(([bid, n], i) => <span key={bid}>{i ? ' · ' : ''}<a onClick={() => go('book', bid)}>{(book(bid) || {})['제목'] || ''}</a> {n}쪽</span>)}</> : `${day.slice(5).replace('-', '.')} · 기록 없음`)}</div></div>
}

/* ===== 통계 ===== */
const names: Record<string, string> = { cat: '대분류', my: '개인분류', route: '어디서 읽었나', au: '저자', plat: '종이책 · E북', pub: '출판사' }
type Row = { k: string; bs: Rec[] }
export function StatsView() {
  const years = [...new Set(S.books.map((b: Rec) => String(b['완독일']).slice(0, 4)).filter((y: string) => /^\d{4}$/.test(y)))].sort().reverse() as string[]
  if (S.statYear == null) S.statYear = years.includes(S.today.slice(0, 4)) ? S.today.slice(0, 4) : (years[0] || '전체')
  const statYear: string = S.statYear
  const all = statYear === '전체'
  const done: Rec[] = S.books.filter((b: Rec) => b['상태'] === '완독' && b['완독일'] && (all || String(b['완독일']).startsWith(statYear)))
  const pages = done.reduce((t, b) => t + (Number(b['분량']) || 0), 0)
  const daysList = done.map(b => Number(b['완독일수'])).filter(n => n > 0)
  const avgDays = daysList.length ? (daysList.reduce((a, b) => a + b, 0) / daysList.length) : 0
  const ids = new Set(done.map(b => b.ID))
  const snipN = S.snips.filter((s: Rec) => ids.has(s['책ID'])).length
  // 월별 (또는 연도별)
  const buckets = all
    ? years.slice().reverse().map(y => ({ label: y.slice(2) + '년', key: y, books: done.filter(b => String(b['완독일']).startsWith(y)) }))
    : Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return { label: (i + 1) + '월', key: statYear + '-' + m, books: done.filter(b => String(b['완독일']).slice(0, 7) === statYear + '-' + m) } })
  const maxB = Math.max(1, ...buckets.map(x => x.books.length))
  const groupBy = (key: string, split?: (v: unknown) => string[]): Row[] => {
    const m: Record<string, Rec[]> = {}
    done.forEach(b => (split ? split(b[key]) : [String(b[key] || '').trim() || '미분류']).forEach(v => (m[v] = m[v] || []).push(b)))
    return Object.entries(m).map(([k, bs]) => ({ k, bs })).sort((a, b) => b.bs.length - a.bs.length || a.k.localeCompare(b.k))
  }
  const pubName = (v: unknown) => String(v || '').replace(/\(주\)|㈜|주식회사|\(株\)/g, '').replace(/\s+/g, ' ').trim()
  const pubM: Record<string, Rec[]> = {}; done.forEach(b => { const k = pubName(b['출판사']); if (k) (pubM[k] = pubM[k] || []).push(b) })
  const pubRows = Object.entries(pubM).map(([k, bs]) => ({ k, bs })).sort((a, b) => b.bs.length - a.bs.length || a.k.localeCompare(b.k))
  const noPub = done.filter(b => !pubName(b['출판사'])).length
  const G2: Record<string, Row[]> = { pub: pubRows, cat: groupBy('대분류'), my: groupBy('개인분류'), route: groupBy('경로'), au: groupBy('저자', splitAuthors).filter(r => r.bs.length >= 2),
    plat: Object.entries(done.reduce((m: Record<string, Rec[]>, b) => { (m[platOf(b)] = m[platOf(b)] || []).push(b); return m }, {})).map(([k, bs]) => ({ k, bs })).sort((a, b) => b.bs.length - a.bs.length) }
  const span = all ? '전체 기간' : statYear + '년 완독'
  const openGroup = (g: string, r: Row) => openBookList(`${names[g]} · ${r.k}`, r.bs, '최근 완독', span)
  const HBars = ({ id, rows, limit }: { id: string; rows: Row[]; limit: number }) => {
    const max = Math.max(1, ...rows.map(r => r.bs.length))
    const open = !!S.statOpen[id]
    return <>{(open ? rows : rows.slice(0, limit)).map(r => <div className="hbar" key={r.k} title={`${r.k} · ${r.bs.length}권`} onClick={() => openGroup(id, r)}>
      <span className="name">{r.k}</span><span className="track"><span className="fill" style={{ display: 'block', width: r.bs.length / max * 100 + '%' }} /></span><span className="n">{r.bs.length}</span></div>)}
      {rows.length > limit && <button className="more-btn" onClick={() => { S.statOpen[id] = !open; emit() }}>{open ? '접기' : `전체 ${rows.length}개 보기`}</button>}</>
  }
  const by = (arr: Rec[], f: (b: Rec) => unknown, dir: number) => arr.filter(b => Number(f(b)) > 0).sort((a, b) => dir * (Number(f(b)) - Number(f(a))))[0]
  const fast = by(done, b => b['완독일수'], -1), slow = by(done, b => b['완독일수'], 1), thick = by(done, b => b['분량'], 1)
  const snipCount: Record<string, number> = {}; S.snips.forEach((s: Rec) => { if (ids.has(s['책ID'])) snipCount[s['책ID']] = (snipCount[s['책ID']] || 0) + 1 })
  const mostSnip = Object.entries(snipCount).sort((a, b) => b[1] - a[1])[0]
  const yLabel = all ? '전체 기간' : statYear + '년'
  const g = Number(S.settings.goal) || 0, yNow = S.today.slice(0, 4)
  const noCat = S.books.filter((b: Rec) => !String(b['대분류'] || '').trim()).length
  const rated = done.filter(b => Number(b['별점'])).sort((a, b) => b['별점'] - a['별점'] || String(b['완독일']).localeCompare(String(a['완독일']))).slice(0, 5)
  return <section id="v-stats">
    <div className="view-head ai-head"><div><h1>독서 통계</h1><p>완독일 기준이에요.</p></div><button className="btn" onClick={() => openReport(statYear)}>📖 독서 리포트</button></div>
    <div className="chips" id="st-years">{[...years, '전체'].map(y => <button key={y} className={'chip ' + (statYear === y ? 'on' : '')} onClick={() => { S.statYear = y; emit() }}>{y === '전체' ? '전체' : y + '년'}</button>)}</div>
    <div className="tiles">
      <button className="tile tap" onClick={() => openBookList(`${yLabel} 완독한 책`, done, '최근 완독')}><b>{done.length}</b><span>완독한 책 (권) ›</span></button>
      <button className="tile tap" onClick={() => openBookList(`${yLabel} 완독한 책`, done, '두꺼운')}><b>{pages.toLocaleString()}</b><span>읽은 쪽수 ›</span></button>
      <button className="tile tap" onClick={() => openBookList(`${yLabel} 완독한 책`, done, '빨리 읽은')}><b>{avgDays ? avgDays.toFixed(1) : '–'}</b><span>한 권 평균 (일) ›</span></button>
      <button className="tile tap" onClick={() => openBookList(`${yLabel} 완독한 책`, done, '필사 많은')}><b>{snipN.toLocaleString()}</b><span>필사 덩어리 ›</span></button>
    </div>
    <DailyPanel />
    {!all && statYear === yNow && <div className="panel" onClick={openSettings} style={{ cursor: 'pointer' }}><h3>{yNow}년 목표<small>{g ? '' : '눌러서 정하기'}</small></h3>{g ? <><div className="gl small" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>{done.length} / {g}권</span><span>{Math.min(100, Math.round(done.length / g * 100))}% · {done.length >= g ? '달성! 🎉' : '남은 ' + (g - done.length) + '권'}</span></div><div className="bar"><i style={{ width: Math.min(100, done.length / g * 100) + '%' }} /></div></> : null}</div>}
    <div className="panel"><h3>{all ? '연도별 완독' : '월별 완독'}<small>막대를 누르면 그 달에 읽은 책</small></h3>
      <div className="vbars">{buckets.map(x => <div className="vbar" key={x.key} title={`${x.label} · ${x.books.length}권`} onClick={() => openBookList(`${all ? '' : statYear + '년 '}${x.label} 완독`, x.books, '최근 완독')}>
        <span className="val">{x.books.length || ''}</span><span className="fill" style={{ height: x.books.length / maxB * 100 + '%' }} /></div>)}</div>
      <div className="vlabels">{buckets.map(x => <span key={x.key}>{x.label}</span>)}</div>
      <div className="drill" id="drill-month" />
    </div>
    <div className="two">
      <div className="panel"><h3>대분류<small>{G2.cat.length}개 · 누르면 책 목록</small></h3><HBars id="cat" rows={G2.cat} limit={10} /><div className="drill" />
        {noCat > 0 && <button className="more-btn" onClick={() => autoCatAll()}>🪄 분류 없는 책 {noCat}권 자동 분류</button>}</div>
      <div className="panel"><h3>개인분류<small>{G2.my.length}개 · 누르면 책 목록</small></h3><HBars id="my" rows={G2.my} limit={10} /><div className="drill" /></div>
      <div className="panel"><h3>종이책 · E북</h3><HBars id="plat" rows={G2.plat} limit={3} /><div className="drill" /></div>
      <div className="panel"><h3>어디서 읽었나</h3><HBars id="route" rows={G2.route} limit={8} /><div className="drill" /></div>
      <div className="panel"><h3>출판사<small>{G2.pub.length}곳{noPub ? ` · 출판사 없는 책 ${noPub}권` : ''} · 누르면 책 목록</small></h3>{G2.pub.length ? <HBars id="pub" rows={G2.pub} limit={8} /> : <div className="drill">아직 없어요</div>}<div className="drill" /></div>
      <div className="panel"><h3>여러 권 읽은 저자</h3>{G2.au.length ? <HBars id="au" rows={G2.au} limit={10} /> : <div className="drill">아직 없어요</div>}<div className="drill" /></div>
    </div>
    {rated.length > 0 && <div className="panel"><h3>별점 높은 책</h3><div className="facts">{rated.map(b => <div className="fact" key={b.ID} onClick={() => go('book', b.ID)}><span className="stars">{starText(b['별점'])}</span><b>{b['제목']}</b></div>)}</div></div>}
    <div className="panel"><h3>기록</h3><div className="facts">
      {fast && <div className="fact" onClick={() => go('book', fast.ID)}><span>가장 빨리 읽은 책</span><b>{fast['제목']} · {fast['완독일수']}일</b></div>}
      {slow && <div className="fact" onClick={() => go('book', slow.ID)}><span>가장 오래 읽은 책</span><b>{slow['제목']} · {slow['완독일수']}일</b></div>}
      {thick && <div className="fact" onClick={() => go('book', thick.ID)}><span>가장 두꺼운 책</span><b>{thick['제목']} · {thick['분량']}쪽</b></div>}
      {mostSnip && <div className="fact" onClick={() => go('book', mostSnip[0])}><span>필사를 가장 많이 한 책</span><b>{(book(mostSnip[0]) || {})['제목'] || ''} · {mostSnip[1]}개</b></div>}
    </div></div>
  </section>
}

/* ===== 독서 리포트 ===== */
export function openReport(year0?: string) {
  const year = year0 && year0 !== '전체' ? year0 : S.today.slice(0, 4)
  const done: Rec[] = S.books.filter((b: Rec) => b['상태'] === '완독' && String(b['완독일']).startsWith(year))
  if (!done.length) { toast(year + '년에 완독한 책이 없어요'); return }
  const ids = new Set(done.map(b => b.ID))
  const sn: Rec[] = S.snips.filter((s: Rec) => ids.has(s['책ID']))
  const pages = done.reduce((t, b) => t + (Number(b['분량']) || 0), 0)
  const cnt = (arr: Rec[], f: (x: Rec) => unknown) => { const m: Record<string, number> = {}; arr.forEach(x => ([] as unknown[]).concat(f(x)).forEach(k => { if (k) m[String(k)] = (m[String(k)] || 0) + 1 })); return Object.entries(m).sort((a, b) => b[1] - a[1]) }
  const months = cnt(done, b => String(b['완독일']).slice(5, 7))
  const kws = cnt(sn, s => splitKw(s['키워드'])).slice(0, 6)
  const cats = cnt(done, b => b['대분류']).slice(0, 3)
  const best = done.filter(b => Number(b['별점'])).sort((a, b) => b['별점'] - a['별점'])[0]
  const fast = done.filter(b => Number(b['완독일수'])).sort((a, b) => a['완독일수'] - b['완독일수'])[0]
  const quotePool = sn.filter(s => s['유형'] === '인용' && String(s['내용']).length > 40 && String(s['내용']).length < 400 && (!best || s['책ID'] === best.ID))
  const q = (quotePool.length ? quotePool : sn.filter(s => String(s['내용']).length > 40 && String(s['내용']).length < 400))[0]
  const qb = q ? book(q['책ID']) : null
  modal(<div className="report">
    <h3 style={{ fontFamily: "'Noto Serif KR',serif", fontSize: 20, margin: 0 }}>{year}년, 나의 독서</h3>
    <div className="big"><div><b>{done.length}</b><span>권 완독</span></div><div><b>{pages.toLocaleString()}</b><span>쪽</span></div><div><b>{sn.length}</b><span>필사 덩어리</span></div></div>
    {months.length > 0 && <div className="card"><h4>가장 많이 읽은 달</h4>{Number(months[0][0])}월 · {months[0][1]}권</div>}
    {kws.length > 0 && <div className="card"><h4>가장 많이 붙든 주제</h4>{kws.map(([k, n], i) => <span key={k}>{i ? '  ' : ''}#{k} <span className="small">{n}</span></span>)}</div>}
    {cats.length > 0 && <div className="card"><h4>많이 읽은 분야</h4>{cats.map(([k, n]) => `${k} ${n}권`).join(' · ')}</div>}
    {best && <div className="card"><h4>가장 좋았던 책</h4>{best['제목']} <span className="stars">{starText(best['별점'])}</span>{best['한줄평'] && <div className="small" style={{ marginTop: 4 }}>“{best['한줄평']}”</div>}</div>}
    {fast && <div className="card"><h4>단숨에 읽은 책</h4>{fast['제목']} · {fast['완독일수']}일</div>}
    {q && <div className="card"><h4>올해의 문장</h4><div className="quote">{sText(q)}</div><div className="small" style={{ marginTop: 6 }}>{qb ? qb['제목'] : ''}{hasPage(q) ? ' · ' + pgLabel(q['쪽수']) : ''}</div></div>}
    <div className="actions"><button className="btn primary grow" onClick={closeModal}>닫기</button></div>
  </div>)
}
