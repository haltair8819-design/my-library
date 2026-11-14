/* 책 화면 — 예전 renderBook · bookExtrasHtml · 고르기 · 끌어서 순서 바꾸기 · 전체 필사 */
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { S, LS, emit, book, spineColor, isThought, sText, sMemo, platOf, pgLabel, hasPage, dayDiff, pickText, progressOf, splitKw, starText, resolveId, KIND_LABEL, type Rec } from '../lib/core'
import { logsOf, dailyOf } from '../lib/logs'
import { orderedSnips, snipView, saveSnipOrder, resetOrder, lifeOf, LIFE, togetherOn, isShared, bookShared, bookSnipShared, togglePlat, finishBook, readHere, patchSnip, deleteSnip } from '../lib/book'
import { patchBook } from '../lib/store/local'
import { tgHasPartner, tgName, setSnipShared } from '../lib/together'
import { go, bookBack, goBack } from '../lib/nav'
import { toast } from '../lib/ui'
import { $ } from '../lib/voice'
import { Spine, Highlight, longPress } from '../components/common'
import { TgAlso, BookComments, MyReactLine } from '../components/TogetherParts'
import { openSnipForm } from './SnipForm'
import { openBookForm, openRating, openLogEdit, openLogAdd, wdOf } from './BookForms'
import { notesLinkingHere, openNote, plainText } from '../lib/notes'

export function openSnipInBook(id: string) {
  const s = S.snips.find((x: Rec) => x.ID === id); if (!s) return
  S.bookTab = isThought(s) ? '생각' : '필사'; go('book', s['책ID']); S.bookTab = isThought(s) ? '생각' : '필사'; emit()
  setTimeout(() => {
    const el = document.getElementById('s-' + id)
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200) }
  }, 80)
}
export async function finish(id: string, sure?: boolean) {
  if (!sure && !confirm('오늘 날짜로 완독 처리할까요?')) return
  try { await finishBook(id) } catch { return }
  setTimeout(() => openRating(id), 400)
}

/* ----- 읽는 중 · 독서 기록 · 반납 · 수령 · 별점 ----- */
function ReadLog({ b }: { b: Rec }) {
  const logs = logsOf(b.ID), daily = dailyOf(b.ID)
  if (!logs.length) return null
  const open = !!S.logOpen, rows = logs.slice().reverse(), shown = open ? rows : rows.slice(0, 3)
  return <><div className="readlog">{shown.map(l => <div className="rl" key={l.id} onClick={() => openLogEdit(l.id)}><b>{l.date.slice(5).replace('-', '.')} ({wdOf(l.date)})</b><span>p.{l.page}까지 {daily[l.date] ? <em>+{daily[l.date]}쪽</em> : null}</span></div>)}</div>
    {rows.length > 3 && <button className="more-btn" onClick={() => { S.logOpen = !S.logOpen; emit() }}>{open ? '접기' : `기록 ${rows.length}개 모두 보기`}</button>}</>
}
function BookExtras({ b }: { b: Rec }) {
  const pageRef = useRef<HTMLInputElement>(null)
  const logs = logsOf(b.ID)
  const out: React.ReactNode[] = []
  if (b['상태'] === '읽을예정') out.push(<div className="panel2" key="wish"><h4>읽고 싶은 책</h4><div className="inline">
    <button className="btn primary" onClick={() => { patchBook(b.ID, { '상태': '읽는중', '시작일': S.today }); toast('읽기 시작! 오늘부터 기록해요') }}>오늘부터 읽기 시작</button></div></div>)
  if (b['상태'] === '읽는중') {
    const p = progressOf(b), eb = platOf(b) === 'E북'
    const todayN = dailyOf(b.ID)[S.today] || 0
    const go2 = () => { if (readHere(b.ID, pageRef.current?.value || '', id => finish(id, true)) && pageRef.current) pageRef.current.value = '' }
    out.push(<div className="panel2" key="reading"><h4>읽는 중</h4>
      {p ? <><div className="gl small" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}><span>p.{p.cur} / {p.total}</span><span><b>{p.pct}%</b>{p.eta ? ' · 이 속도면 ' + p.eta.slice(5).replace('-', '.') + ' 완독' : ''}</span></div>
        <div className="bar"><i style={{ width: p.pct + '%' }} /></div></> : <div className="small">읽은 곳까지 쪽수를 넣으면 진행률 · 예상 완독일 · 매일 읽은 양을 기록해요.</div>}
      <div className="inline" style={{ marginTop: 10 }}><input ref={pageRef} className="field" id="cur-page" inputMode="decimal" placeholder={eb ? '몇 쪽? 또는 45%' : '지금 몇 쪽?'} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go2() } }} />
        <button type="button" className="btn pct-btn" title="%로 넣기" onClick={() => { const f = pageRef.current!; const v = f.value.trim(); f.value = /%$/.test(v) ? v.replace(/%/g, '') : v.replace(/%/g, '') + '%'; f.focus() }}>%</button>
        <button className="btn primary" onClick={go2}>여기까지 읽었어요</button></div>
      {todayN ? <div className="read-today">오늘 <b>{todayN}쪽</b> 읽었어요{b['현재쪽수'] ? ` · 지금 p.${b['현재쪽수']}` : ''}</div> : b['현재쪽수'] ? <div className="read-today">마지막으로 p.{b['현재쪽수']}까지 읽었어요</div> : null}
      <ReadLog b={b} />
      <button className="more-btn" onClick={() => openLogAdd(b.ID)}>＋ 지난 날짜 기록 추가</button></div>)
  } else if (logs.length || b['상태'] === '완독' || b['상태'] === '중단') {
    out.push(<div className="panel2" key="log"><h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>독서 기록 <span className="small" style={{ fontWeight: 400 }}>{logs.length ? logs.length + '일 읽음' : ''}</span></h4>
      {logs.length ? <ReadLog b={b} /> : <div className="small">읽은 날과 쪽수를 남기면 매일 읽은 양 · 통계에 들어가요.</div>}
      <button className="more-btn" onClick={() => openLogAdd(b.ID)}>＋ 날짜별 기록 추가</button></div>)
  }
  if (b['수령일'] || (b['상태'] !== '완독' && !b['반납일'] && (b['상태'] === '읽을예정' || /도서관|대출|대여|예약/.test(String(b['경로'] || ''))))) {
    const d = dayDiff(b['수령일']) as number
    out.push(<div className="panel2" key="pick"><h4>도서관 예약 수령</h4><div className="inline">
      <input className="field" type="date" id="pick-date" key={'pk' + (b['수령일'] || '')} defaultValue={b['수령일'] || ''} onChange={e => { patchBook(b.ID, { '수령일': e.target.value }); toast(e.target.value ? '수령일을 저장했어요' : '수령일을 지웠어요') }} />
      {b['수령일'] ? <><span className="small">{pickText(d)}</span>
        <button className="btn" onClick={() => {
          const patch: Rec = { '수령일': '' }
          if (!String(b['경로'] || '').trim()) patch['경로'] = '도서관'
          if (b['상태'] === '읽을예정' && confirm('받았어요! 오늘부터 읽기 시작할까요?\n(반납일은 책 화면에서 넣을 수 있어요)')) Object.assign(patch, { '상태': '읽는중', '시작일': S.today })
          patchBook(b.ID, patch); toast('수령 완료! 반납일도 넣어 두세요')
        }}>받았어요</button></> : <span className="small">예약한 책이면 받으러 갈 날을 넣어 두세요.</span>}
    </div></div>)
  }
  if (b['반납일'] || (b['상태'] === '읽는중' && /도서관|대출|대여/.test(String(b['경로'] || '')))) {
    const d = dayDiff(b['반납일']) as number
    out.push(<div className="panel2" key="due"><h4>도서관 반납</h4><div className="inline">
      <input className="field" type="date" id="due-date" key={'dd' + (b['반납일'] || '')} defaultValue={b['반납일'] || ''} onChange={e => { patchBook(b.ID, { '반납일': e.target.value }); toast(e.target.value ? '반납일을 저장했어요' : '반납 완료!') }} />
      {b['반납일'] ? <><span className="small">{d < 0 ? (-d) + '일 지남' : d === 0 ? '오늘 반납' : 'D-' + d}</span>
        <button className="btn" onClick={() => { patchBook(b.ID, { '반납일': '' }); toast('반납 완료!') }}>반납했어요</button></> : <span className="small">빌린 책이면 반납일을 넣어 두세요. 전날 알림으로 알려드려요.</span>}
    </div></div>)
  }
  if (b['상태'] === '완독') out.push(<div className="panel2" key="rate" onClick={() => openRating(b.ID)} style={{ cursor: 'pointer' }}><h4>별점 · 한줄평</h4>
    {b['별점'] || b['한줄평'] ? <><div><span className="stars">{starText(b['별점'])}</span></div>{b['한줄평'] && <div style={{ marginTop: 4 }}>{b['한줄평']}</div>}</>
      : <div className="small">눌러서 별점과 한 줄 감상을 남겨 보세요.</div>}</div>)
  return <>{out}</>
}

/* ----- 문장 한 개 ----- */
export function LifeBadge({ s }: { s: Rec }) { const n = lifeOf(s); return n ? <span className={'life-b l' + n} title={LIFE[n]}>{'★'.repeat(n)} {LIFE[n]}</span> : null }
function SnipCard({ s, onDrag }: { s: Rec; onDrag?: (e: React.PointerEvent, id: string) => void }) {
  const cls = isThought(s) ? 'thought' : s['유형'] === '메모' ? 'memo' : 'quote'
  const memo = sMemo(s), sel = !!S.snipSel && S.view === 'book', on = sel && S.snipSel.has(s.ID)
  const kws = splitKw(s['키워드'])
  const lp = longPress(() => { LS.set('lp_hint', '1'); if (!S.snipSel) S.snipSel = new Set(); S.snipSel.add(resolveId(s.ID)); emit() })
  const tap = () => {
    if (!S.snipSel) { openSnipForm(s.ID); return }
    if (S.snipSel.has(s.ID)) S.snipSel.delete(s.ID); else S.snipSel.add(s.ID)
    emit()
  }
  return <div className={`snip ${cls} ${on ? 'sel' : ''} ${S.dragId === s.ID ? 'dragging' : ''}`} id={'s-' + s.ID} data-id={s.ID} onClick={tap} {...lp}>
    {sel && <span className="sel-check snip-check">✓</span>}{sel && onDrag && <span className="drag-h" aria-label="끌어서 옮기기" onPointerDown={e => onDrag(e, s.ID)}>≡</span>}
    {s['유형'] === '메모' && <span className="badge plat" style={{ display: 'inline-block', marginBottom: 6 }}>메모</span>}
    <LifeBadge s={s} />
    {s['제목'] && <div className="stitle">{s['제목']}</div>}
    <div className="txt">{sText(s)}</div>
    {memo && <div className="smemo">✎ {memo}</div>}
    {(hasPage(s) || kws.length || (togetherOn() && isShared(s) && s['유형'] !== '메모')) && <div className="smeta">
      {hasPage(s) && <span className="pg">{pgLabel(s['쪽수'])}</span>}{kws.map(k => <span className="kw" key={k}>#{k}</span>)}
      {togetherOn() && isShared(s) && s['유형'] !== '메모' && <span className="kw shared" title="짝꿍에게 보여주는 중">👀 보여주는 중</span>}</div>}
    <MyReactLine s={s} />
  </div>
}

/* ----- 여러 개 고르기 → 한 번에 바꾸기 ----- */
const SNIP_TYPES = [['인용', '필사'], ['메모', '메모'], ['생각', '내 생각']]
function SelBar() {
  if (!S.snipSel || S.view !== 'book') return null
  const n = S.snipSel.size, shown: string[] = S.snipShown || [], allOn = shown.length && shown.every(id => S.snipSel.has(id))
  const memos = shown.filter(id => (S.snips.find((x: Rec) => x.ID === id) || {})['유형'] === '메모')
  const picked = () => [...S.snipSel].map((id: string) => S.snips.find((y: Rec) => y.ID === resolveId(id))).filter(Boolean) as Rec[]
  const bulkType = (type: string) => {
    let c = 0
    picked().forEach(x => { if (x['유형'] === type) return; patchSnip(x, { '유형': type }); c++ })
    const label = (SNIP_TYPES.find(t => t[0] === type) || [])[1]
    S.snipSel = new Set(); emit()
    toast(c ? `${c}개를 ‘${label}’(으)로 바꿨어요${(type !== '인용') !== (S.bookTab === '생각') ? ' · 옆 칸으로 옮겨졌어요' : ''}` : '바뀐 게 없어요')
  }
  const bulkDelete = () => {
    const ids = [...S.snipSel].map((x: string) => resolveId(x)); if (!ids.length || !confirm(`${ids.length}개를 지울까요? 되돌릴 수 없어요.`)) return
    ids.forEach(id => deleteSnip(id))
    S.snipSel = new Set(); emit(); toast(`${ids.length}개를 지웠어요`)
  }
  const bulkLife = (l: number) => {
    let c = 0
    picked().forEach(x => { if (lifeOf(x) === l) return; patchSnip(x, { '인생': l }); c++ })
    S.snipSel = new Set(); emit()
    toast(c ? (l ? `${c}개를 ‘${LIFE[l]}’으로 담았어요` : `${c}개를 인생 문장에서 뺐어요`) : '바뀐 게 없어요')
  }
  const bulkShare = (on: boolean) => {
    let c = 0, skip = 0
    picked().forEach(x => { if (on && x['유형'] === '메모') { skip++; return } if (isShared(x) === on) return; setSnipShared(x, on); c++ })
    S.snipSel = new Set(); emit()
    const b = book(S.bookId)
    toast(c ? `${c}개를 ${on ? `${tgHasPartner() ? tgName() + '에게 ' : ''}보여줘요` : '나만 보게 했어요'}${skip ? ` · 메모 ${skip}개는 항상 나만 봐요` : ''}${on && b && !bookShared(b) ? ' · 이 책이 ‘나만 보기’라 아직 안 보여요' : ''}` : skip ? '메모는 항상 나만 봐요' : '바뀐 게 없어요')
  }
  return <div id="selbar" className="selbar"><div className="in"><div className="top"><b>{n}개 골랐어요</b><span>{memos.length > 0 && <><button onClick={() => { S.snipSel = new Set(memos); emit() }}>메모만 ({memos.length})</button> · </>}<button onClick={() => { shown.forEach(id => allOn ? S.snipSel.delete(id) : S.snipSel.add(id)); emit() }}>{allOn ? '모두 풀기' : '이 칸 모두'}</button> · <button onClick={() => { S.snipSel = null; emit() }}>완료</button></span></div>
    <div className="row2">{SNIP_TYPES.map(([t, label]) => <button key={t} className="btn" disabled={!n} onClick={() => bulkType(t)}>→ {label}</button>)}
      <button className="btn danger" disabled={!n} onClick={bulkDelete}>삭제</button></div>
    <div className="row2"><span className="small" style={{ alignSelf: 'center' }}>인생 문장</span>{[1, 2, 3].map(l => <button key={l} className="btn" disabled={!n} onClick={() => bulkLife(l)}>{'★'.repeat(l)}</button>)}<button className="btn" disabled={!n} onClick={() => bulkLife(0)}>해제</button></div>
    {togetherOn() && <div className="row2"><button className="btn" disabled={!n} onClick={() => bulkShare(true)}>👀 보여주기</button><button className="btn" disabled={!n} onClick={() => bulkShare(false)}>🔒 나만 보기</button></div>}</div></div>
}

/* ----- 끌어서 순서 바꾸기 (≡ 손잡이) ----- */
function useDrag(list: React.RefObject<HTMLDivElement | null>) {
  return (e: React.PointerEvent, id: string) => {
    const el = (e.currentTarget as HTMLElement).closest('.snip') as HTMLElement, box = list.current; if (!el || !box) return
    e.preventDefault(); e.stopPropagation()
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    const grab = e.clientY - el.getBoundingClientRect().top
    let y = e.clientY, raf = 0, moved = false; const y0 = e.clientY
    S.dragIds = [...box.querySelectorAll<HTMLElement>(':scope > .snip')].map(x => x.dataset.id!)
    S.dragId = id
    document.body.classList.add('no-select')
    flushSync(emit)
    const me = () => document.getElementById('s-' + id)
    const place = () => {
      const node = me(); if (!node) return
      const sibs = [...box.querySelectorAll<HTMLElement>(':scope > .snip')].filter(x => x !== node)
      let before: string | null = null
      for (const s of sibs) { const r = s.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = s.dataset.id!; break } }
      const ids = (S.dragIds as string[]).filter(x => x !== id)
      const at = before ? ids.indexOf(before) : ids.length
      ids.splice(at, 0, id)
      if (ids.join() !== (S.dragIds as string[]).join()) { S.dragIds = ids; moved = true; flushSync(emit) }
      const n2 = me(); if (!n2) return
      n2.style.transform = ''; const nat = n2.getBoundingClientRect().top; n2.style.transform = `translateY(${y - grab - nat}px)`
    }
    const loop = () => {   // 화면 끝에 가까우면 저절로 내려가요
      const edge = 90; let d = 0
      if (y < edge) d = -Math.ceil((edge - y) / 6); else if (y > innerHeight - edge - 60) d = Math.ceil((y - (innerHeight - edge - 60)) / 6)
      if (d && Math.abs(y - y0) > 12) { window.scrollBy(0, d); place() }
      raf = requestAnimationFrame(loop)
    }
    const move = (ev: PointerEvent) => { y = ev.clientY; place() }
    const up = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      const n2 = me(); if (n2) n2.style.transform = ''
      document.body.classList.remove('no-select')
      const ids = S.dragIds as string[]
      S.dragIds = null; S.dragId = null
      if (moved) { saveSnipOrder(S.bookId, ids); setTimeout(() => { const x = me(); if (x) { x.classList.add('flash'); setTimeout(() => x.classList.remove('flash'), 900) } }, 30) }
      emit()
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    raf = requestAnimationFrame(loop)
  }
}

export function BookView() {
  const b = book(S.bookId)
  const listRef = useRef<HTMLDivElement>(null)
  const onDrag = useDrag(listRef)
  const [, setHint] = useState(0)
  if (!b) return <section id="v-book"><div className="empty">책을 찾을 수 없어요</div></section>
  // 노트 파일에서 가져온 문장 → 노트에 적힌 순서, 직접 입력한 문장 → 그 뒤에 쪽수 순서
  const snips = orderedSnips(b.ID)
  const reo = !!S.snipSel
  const tags = [b['대분류'], b['중분류'], b['개인분류'], b['경로']].filter(Boolean)
  const plat = platOf(b)
  let quotes = snips.filter(s => !isThought(s)); const thoughts = snips.filter(isThought)
  // 인생 문장 먼저 · 인생 문장만 (보기만 바꾸고, 저장한 순서는 그대로) — v2.15.5
  const lifeN = quotes.filter(s => lifeOf(s) > 0).length, allQ = quotes.length
  const sv = !reo && lifeN ? snipView() : ''
  const byLife = (arr: Rec[]) => arr.map((x, i) => [x, i] as [Rec, number]).sort((a, c) => lifeOf(c[0]) - lifeOf(a[0]) || a[1] - c[1]).map(a => a[0])
  if (sv === 'life') quotes = byLife(quotes)
  else if (sv === 'only') quotes = byLife(quotes.filter(s => lifeOf(s) > 0))
  const tab = S.bookTab === '생각' ? '생각' : '필사'
  let shownList = tab === '생각' ? thoughts : quotes
  if (S.dragIds) { const by = new Map(shownList.map(x => [x.ID, x])); shownList = (S.dragIds as string[]).map(id => by.get(id)).filter(Boolean) as Rec[] }
  S.snipShown = shownList.map(x => x.ID)
  const reoNote = reo ? <div className="draft-note"><span>눌러서 고르기 · ≡ 끌어서 순서 바꾸기</span><button type="button" style={{ whiteSpace: 'nowrap' }} onClick={() => resetOrder(b.ID)}>쪽수 순으로 정렬</button></div>
    : (quotes.length + thoughts.length > 1 && !LS.get('lp_hint') ? <div className="sec-sub">💡 문장을 꾹 누르면 여러 개 고르기 · 순서 바꾸기</div> : null)
  const doneBtn = reo ? <button className="btn primary" onClick={() => { S.snipSel = null; emit() }}>완료</button> : null
  const back = notesLinkingHere(b)
  const tagBook = () => { const next = !bookShared(b); patchBook(b.ID, { '공개': next }); toast(next ? '이 책을 보여줘요 (책 · 별점 · 독서 기록)' : '이 책은 나만 봐요 · 필사도 같이 숨겨져요') }
  const tagSnips = () => {
    const on = !bookSnipShared(b)
    const list = S.snips.filter((s: Rec) => s['책ID'] === b.ID && s['유형'] !== '메모' && isShared(s) !== on) as Rec[]
    if (!confirm(on ? `이 책의 필사 · 내 생각을 모두 보여줄까요?${list.length ? ` (${list.length}개)` : ''}\n앞으로 이 책에 쓰는 것도 처음부터 보여줘요. 하나씩 다시 숨길 수도 있어요. (메모는 항상 나만)`
      : `이 책의 필사 · 내 생각을 모두 숨길까요?${list.length ? ` (${list.length}개)` : ''}`)) return
    patchBook(b.ID, { '필사공개': on })
    list.forEach((x: Rec) => setSnipShared(x, on))
    emit()
    toast(on ? `필사를 모두 보여줘요${!bookShared(b) ? ' · 이 책이 ‘나만 보기’라 책도 보여줘야 보여요' : ''}` : '이 책 필사를 모두 숨겼어요')
  }
  return <section id="v-book" style={{ ['--bc' as string]: spineColor(b) } as React.CSSProperties}>
    <div className="topbar">
      <button className="iconbtn" onClick={bookBack}>← 서재</button>
      <button className="iconbtn" onClick={() => openBookForm(b.ID)}>정보 수정</button>
    </div>
    <div className="detail-head">
      <Spine b={b} />
      <div>
        <div className="dtitle">{b['제목']}</div>
        <div className="dauthor">{b['저자']}{b['옮긴이'] ? ' 지음 · ' + b['옮긴이'] + ' 옮김' : ''}{b['출판사'] ? ' · ' + b['출판사'] : ''}</div>
        <div className="tags"><span className="tag tap" onClick={() => togglePlat(b.ID)} title="눌러서 종이책 · E북 바꾸기">{plat === 'E북' ? '📱 E북' : plat === '오디오북' ? '🎧 오디오북' : '📕 종이책'}</span>
          {togetherOn() && <span className="tag tap" onClick={tagBook} title="짝꿍에게 이 책 보여주기">{bookShared(b) ? '👀 보여주는 중' : '🔒 나만 보기'}</span>}
          {togetherOn() && <span className="tag tap" onClick={tagSnips} title="이 책의 필사 · 내 생각을 한 번에">{bookSnipShared(b) ? '👀 필사 모두 보여줌' : '✋ 필사 고른 것만'}</span>}
          {tags.map(t => <span className="tag" key={t}>{t}</span>)}</div>
      </div>
    </div>
    <div className="grid">
      <div><b>{b['분량'] ? b['분량'] + '쪽' : '–'}</b><span>분량</span></div>
      <div><b>{b['시작일'] || '–'}</b><span>시작</span></div>
      <div><b>{b['완독일'] || '–'}</b><span>완독</span></div>
      <div><b>{b['완독일수'] ? b['완독일수'] + '일' : (b['상태'] === '읽는중' ? '읽는 중' : '–')}</b><span>기간</span></div>
    </div>
    {(b['상태'] === '읽는중' || b['상태'] === '중단') && <div className="actions"><button className="btn primary grow" onClick={() => finish(b.ID)}>오늘 완독했어요</button></div>}
    <TgAlso b={b} />
    <BookExtras b={b} />
    {togetherOn() && bookShared(b) && S.tg.me && <BookComments owner={S.tg.me.id} bid={b.ID} />}
    <div className="seg book-tabs" id="book-tabs">
      <button className={tab === '필사' ? 'on' : ''} onClick={() => { S.bookTab = '필사'; if (S.snipSel) S.snipSel = new Set(); emit() }}>필사<span>{quotes.length}</span></button>
      <button className={tab === '생각' ? 'on' : ''} onClick={() => { S.bookTab = '생각'; if (S.snipSel) S.snipSel = new Set(); emit() }}>내 생각 · 메모<span>{thoughts.length}</span></button></div>
    {tab === '필사' ? <>
      <div className="sec-head tight"><h2>필사</h2>
        <div style={{ display: 'flex', gap: 6 }}>{doneBtn}{!reo && <button className="btn" onClick={() => openSnipForm(null, '인용')}>+ 문장</button>}</div></div>
      {reoNote}
      {lifeN > 0 && !reo && <div className="chips snip-view" id="snip-view">
        <button className={'chip ' + (!sv ? 'on' : '')} onClick={() => { LS.set('snip_view', ''); setHint(x => x + 1) }}>기본 순서</button>
        <button className={'chip ' + (sv === 'life' ? 'on' : '')} onClick={() => { LS.set('snip_view', 'life'); setHint(x => x + 1) }}>★ 인생 문장 먼저</button>
        <button className={'chip ' + (sv === 'only' ? 'on' : '')} onClick={() => { LS.set('snip_view', 'only'); setHint(x => x + 1) }}>★만 {lifeN}</button></div>}
      {shownList.length ? <div id="snip-list" ref={listRef}>{sv === 'life' && lifeN < allQ
        ? <>{shownList.slice(0, lifeN).map(s => <SnipCard key={s.ID} s={s} />)}<div className="snip-divider"><span>나머지 문장 {allQ - lifeN}</span></div>{shownList.slice(lifeN).map(s => <SnipCard key={s.ID} s={s} />)}</>
        : shownList.map(s => <SnipCard key={s.ID} s={s} onDrag={reo ? onDrag : undefined} />)}</div>
        : <div className="empty">아직 필사한 문장이 없어요.<br />‘+ 문장 추가’로 시작해 보세요.</div>}
    </> : <>
      <div className="sec-head tight"><h2>내 생각 · 메모</h2>
        <div style={{ display: 'flex', gap: 6 }}>{doneBtn}{!reo && <><button className="btn" onClick={() => openSnipForm(null, '생각')}>+ 내 생각</button><button className="btn" onClick={() => openSnipForm(null, '메모')}>+ 메모</button></>}</div></div>
      {reoNote}
      <div className="sec-sub">읽으며 든 생각, 감상문 · 독후감, 따로 적어 둔 메모를 모아 둬요.</div>
      {(b['별점'] || b['한줄평']) && <div className="snip thought" onClick={() => openRating(b.ID)}><div className="stitle">한줄평 {b['별점'] ? <span className="stars">{starText(b['별점'])}</span> : null}</div><div className="txt">{b['한줄평'] || ''}</div></div>}
      {shownList.length ? <div id="snip-list" ref={listRef}>{shownList.map(s => <SnipCard key={s.ID} s={s} onDrag={reo ? onDrag : undefined} />)}</div>
        : <div className="empty">아직 남긴 생각이나 메모가 없어요.<br />‘+ 내 생각’, ‘+ 메모’로 남겨 보세요.</div>}
    </>}
    {back.length > 0 && <div className="panel2" style={{ marginTop: 18 }}><h4>이 책을 언급한 내 글</h4>{back.map((x: Rec) => <button className="mini" key={x.ID} onClick={() => openNote(x.ID)}><b>✍ {x['제목'] || '제목 없음'}</b><span>{plainText(x['본문']).slice(0, 90)}</span></button>)}</div>}
    <SelBar />
  </section>
}

/* ===== 전체 필사 · 전체 내 생각 ===== */
export function openAllSnips(kind: string) { S.allKind = kind; S.allQ = ''; S.allLimit = 50; go('snips') }
export function AllSnipsView() {
  const nT = S.snips.filter(isThought).length, nQ = S.snips.length - nT
  const q: string = S.allQ.trim().toLowerCase(), terms: string[] = q.replace(/^#/, '').split(/\s+/).filter(Boolean)
  let list: Rec[] = S.snips.filter((s: Rec) => (S.allKind === '생각') === isThought(s))
  if (terms.length) list = list.filter(s => { const hay = (s['제목'] + ' ' + s['내용'] + ' ' + s['키워드'] + ' ' + ((book(s['책ID']) || {})['제목'] || '')).toLowerCase(); return terms.every(t => hay.includes(t)) })
  // 최근에 읽은 책부터, 책 안에서는 원래 순서
  const order: Record<string, string> = {}; S.books.forEach((b: Rec) => order[b.ID] = String(b['완독일'] || b['시작일'] || ''))
  list.sort((a, b) => String(order[b['책ID']] || '').localeCompare(String(order[a['책ID']] || '')) || String(a.ID).localeCompare(String(b.ID)))
  const out: React.ReactNode[] = []; let cur: string | null = null
  list.slice(0, S.allLimit).forEach(s => {
    if (s['책ID'] !== cur) { const bid = s['책ID']; cur = bid; const b = book(bid) || {}; out.push(<div key={'g' + bid + out.length} className="group-label tapl" onClick={() => { go('book', bid); S.bookTab = S.allKind; emit() }}>{b['제목'] || '책 없음'} ›</div>) }
    const memo = sMemo(s)
    out.push(<div className="hit" key={s.ID} onClick={() => openSnipInBook(s.ID)}>{s['제목'] && <div className="ht">{q ? <Highlight text={s['제목']} q={q} /> : s['제목']}</div>}
      <div className="hx">{q ? <Highlight text={sText(s)} q={q} /> : sText(s).slice(0, 200) + (sText(s).length > 200 ? '…' : '')}</div>
      {memo && <div className="smemo">✎ {memo.slice(0, 120)}</div>}
      <div className="hm">{[hasPage(s) ? pgLabel(s['쪽수']) : '', s['키워드'] ? '#' + splitKw(s['키워드']).join(' #') : ''].filter(Boolean).join(' · ')}</div></div>)
  })
  return <section id="v-snips">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 서재</button></div>
    <div className="view-head"><h1>{S.allKind === '생각' ? '내 생각 모아 보기' : '필사 모아 보기'}</h1><p>책 이름을 누르면 그 책으로, 문장을 누르면 그 문장으로 가요</p></div>
    <div className="seg" id="all-kind" style={{ marginTop: 10 }}><button className={S.allKind === '필사' ? 'on' : ''} onClick={() => { S.allKind = '필사'; S.allLimit = 50; emit() }}>필사 {nQ.toLocaleString()}</button><button className={S.allKind === '생각' ? 'on' : ''} onClick={() => { S.allKind = '생각'; S.allLimit = 50; emit() }}>내 생각 {nT.toLocaleString()}</button></div>
    <input className="field" id="all-q" type="search" placeholder="문장 · 책 · #키워드 찾기" value={S.allQ} style={{ margin: '10px 0 4px' }} autoComplete="off" onChange={e => { S.allQ = e.target.value; S.allLimit = 50; emit() }} />
    <div id="all-list">{q && <div className="res-head">찾은 {KIND_LABEL[S.allKind]} {list.length.toLocaleString()}개</div>}{out.length ? out : <div className="empty">{q ? '찾는 문장이 없어요' : '아직 없어요'}</div>}
      {list.length > S.allLimit && <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={() => { S.allLimit += 100; emit() }}>더 보기 ({(list.length - S.allLimit).toLocaleString()}개 남음)</button>}</div>
  </section>
}
export { $ }
