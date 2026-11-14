/* 함께 탭 — 짝꿍 서재 · 둘의 이번 달 · 둘 다 있는 책 · 같이 읽을 책 · 소식 · 프로필 · 보여줄 것 (예전 together.js) */
import { useEffect, useRef, useState } from 'react'
import { S, LS, emit, book, snipsOf, isThought, sText, sMemo, pgLabel, hasPage, firstPage, snipPage, starText, period, addDays, FILTERS, FILTER_LABEL, type Rec } from '../lib/core'
import { parseLog } from '../lib/logs'
import { sb, sbUid } from '../lib/supabase'
import { sbq } from '../lib/store/server'
import { patchBook, updateBook } from '../lib/store/local'
import { togetherOn, isShared, bookShared, bookSnipShared, lifeOf, LIFE, call, sortByPage, deleteLog } from '../lib/book'
import { tgHasPartner, tgName, tgMonth, tgMonthStats, myLogs, shelfCount, tgMine, tgTheirs, tgProg, tgPeriod, tgSame, tgDaily, tgSpoilOn, tgShareNew, tgRefresh, tgSave, tgSaveOpt, tgSignAvatars, jo, locDay, hhmmOf, bookDayT, delReact, bcDel, setSnipShared, sharedSnipsOf, feedHiddenAdd, setInvitePrompt, AV_BUCKET, type TLog } from '../lib/together'
import { notifyPartner } from '../lib/push'
import { go, goBack } from '../lib/nav'
import { modal, closeModal, remodal, toast, errMsg, M } from '../lib/ui'
import { $ } from '../lib/voice'
import { Spine, Sub, Spin } from '../components/common'
import { Avatar, ReactBar, BookComments, ReviewRow, openReacts } from '../components/TogetherParts'
import { LifeBadge, openSnipInBook } from './Book'
import { openRating, openBarcode } from './BookForms'

const err = (e: unknown) => toast('⚠ ' + errMsg(e))
export function openPartnerBook(id: string, flash?: string) { S.pbookId = id; S.pflash = flash || ''; go('pbook') }
S.plibWho = 'p'
export function openProfile(who: string, tab?: string) { S.plibWho = who === 'me' ? 'me' : 'p'; S.plibTab = tab || 'books'; S.shdLimit = 40; if (S.plibWho === 'p' && !tgHasPartner()) return; go('plib') }

/* ===== 최근 소식 ===== */
type Feed = { who: string; date: string; node: React.ReactNode; open: () => void; p: boolean; key: string }
function tgFeed(): Feed[] {
  const T = S.tg, out: Feed[] = [], pn = tgName(), me = (T.me || {}).name || '나'
  const hidMe = new Set((S.settings || {}).feedHidden || []), hidP = new Set((T.partner && T.partner.feedHidden) || [])
  const add = (who: string, date: unknown, node: React.ReactNode, open: () => void, p: boolean, key: string) => { if (!date || (key && (p ? hidP : hidMe).has(key))) return; out.push({ who, date: String(date).slice(0, 10), node, open, p, key: p ? '' : key }) }
  const ttl = (b: Rec) => `『${b['제목']}』`
  const ttlO = (b: Rec) => { const t = String(b['제목'] || '').replace(/\s*\([^)]*\)\s*$/, ''); return ttl(b) + jo(t, '을', '를').slice(t.length) }
  const stars = (b: Rec) => b['별점'] ? <> <span className="stars">{'★'.repeat(Number(b['별점']) || 0)}</span></> : null
  const books = (list: Rec[], who: string, p: boolean, open: (b: Rec) => () => void) => list.forEach(b => {
    if (b['완독일']) add(who, b['완독일'], <>{ttlO(b)} 다 읽었어요{stars(b)}</>, open(b), p, 'done:' + b.ID)
    if (b['시작일'] && b['시작일'] !== b['완독일'] && b['상태'] !== '읽을예정') add(who, b['시작일'], <>{ttlO(b)} 읽기 시작했어요</>, open(b), p, 'start:' + b.ID)
    else if (!b['시작일'] && b['상태'] === '읽을예정' && b['등록일']) add(who, b['등록일'], <>{ttlO(b)} 읽고 싶은 책에 담았어요</>, open(b), p, 'wish:' + b.ID)
  })
  books(T.books, pn, true, b => () => openPartnerBook(b.ID))
  books(S.books.filter(bookShared), me, false, b => () => go('book', b.ID))
  // 독서 기록: 하루 · 책마다
  const logLines = (logs: TLog[], list: Rec[], who: string, p: boolean, open: (b: Rec) => () => void) => {
    const by: Record<string, TLog[]> = {}; logs.forEach(l => (by[l.bid] = by[l.bid] || []).push(l))
    Object.entries(by).forEach(([bid, ls]) => {
      const b = list.find(x => x.ID === bid); if (!b) return
      Object.entries(tgDaily(ls)).forEach(([day, n]) => { if (n > 0) add(who, day, <>{ttl(b)} <b>{n}쪽</b> 읽었어요</>, open(b), p, 'log:' + bid + ':' + day) })
    })
  }
  logLines(T.logs, T.books, pn, true, b => () => openPartnerBook(b.ID))
  logLines(myLogs(), S.books.filter(bookShared), me, false, b => () => go('book', b.ID))
  // 보여준 필사
  T.snips.forEach((s: Rec) => { const b = T.books.find((x: Rec) => x.ID === s['책ID']); if (!b) return
    add(pn, s['작성일'], <>{ttl(b)}에서 {isThought(s) ? '생각을' : '문장을'} 남겼어요</>, () => openPartnerBook(b.ID, s.ID), true, 'snip:' + s.ID) })
  S.snips.filter(isShared).forEach((s: Rec) => { const b = book(s['책ID']); if (!b) return
    add(me, s['작성일'], <>{ttl(b)}에서 {isThought(s) ? '생각을' : '문장을'} 보여줬어요</>, () => openSnipInBook(s.ID), false, 'snip:' + s.ID) })
  // 문장 반응
  ;(T.reacts || []).forEach((r: Rec) => {
    const mineSnip = r.owner === T.me.id, fromMe = r.user_id === T.me.id
    if (mineSnip && fromMe) return
    const sn = mineSnip ? S.snips.find((x: Rec) => x.ID === r.snippet_id) : T.snips.find((x: Rec) => x.ID === r.snippet_id); if (!sn) return
    const who = fromMe ? me : pn, t = sText(sn).slice(0, 24) + (sText(sn).length > 24 ? '…' : '')
    add(who, locDay(r.created_at), r.kind === 'heart' ? <>{mineSnip ? '내' : pn + '의'} 문장에 ♡ <span className="tg-q">“{t}”</span></>
      : <>“{String(r.body || '').slice(0, 60)}” <span className="tg-q">— {mineSnip ? '내' : pn + '의'} 문장 “{t}”</span></>, () => openReacts(r.snippet_id, r.owner), !fromMe, 'rx:' + r.id)
  })
  // 책 댓글
  ;(T.bcom || []).forEach((c: Rec) => {
    const mineBook = c.owner === T.me.id, fromMe = c.user_id === T.me.id
    const b = mineBook ? book(c.book_id) : (T.books || []).find((x: Rec) => x.ID === c.book_id); if (!b) return
    add(fromMe ? me : pn, locDay(c.created_at), <>{ttl(b)}에 댓글 <span className="tg-q">“{String(c.body).slice(0, 60)}”</span></>, mineBook ? () => go('book', b.ID) : () => openPartnerBook(b.ID), !fromMe, 'bc:' + c.id)
  })
  ;(T.tbooks || []).forEach((tb: Rec) => { const who = tb.added_by === T.me.id ? me : pn
    add(who, locDay(tb.created_at), <>같이 읽을 책에 『{tb.data['제목'] || ''}』를 담았어요</>, () => go('together'), who !== me, 'tb:' + tb.id) })
  return out.sort((a, b) => b.date.localeCompare(a.date) || (b.p ? 1 : 0) - (a.p ? 1 : 0))
}
function FeedRows({ list }: { list: Feed[] }) {
  let last = ''
  return <>{list.map((x, i) => { const head = x.date !== last ? <div className="tg-day">{x.date === S.today ? '오늘' : x.date === addDays(S.today, -1) ? '어제' : x.date.slice(5).replace('-', '.')}</div> : null; last = x.date
    return <div key={i}>{head}<div className="tg-feed" onClick={x.open}><Avatar name={x.who} cls={x.p ? 'p' : ''} /><div className="grow"><b className={'tg-who ' + (x.p ? 'p' : '')}>{x.who}</b> {x.node}</div>
      {x.key && <button className="tg-fmenu" onClick={e => { e.stopPropagation(); openFeedMenu(x.key) }} aria-label="소식 고치기">⋯</button>}</div></div> })}</>
}
// 최근 한 달은 바로, 그 전은 '지난 소식 더보기' → 연도별로 접어서
function FeedBox() {
  const f = tgFeed(); if (!f.length) return <div className="small">아직 소식이 없어요. 책을 읽고 기록하면 여기에 보여요.</div>
  const cut = addDays(S.today, -30), recent = f.filter(x => x.date >= cut), old = f.filter(x => x.date < cut)
  const head = recent.length ? <FeedRows list={recent} /> : <div className="small">최근 한 달 동안의 소식은 없어요.</div>
  if (!old.length) return head
  if (!S.feedAll) return <>{head}<button className="btn tg-more" onClick={() => { S.feedAll = true; emit() }}>지난 소식 더보기 <span className="small">{old.length}개</span></button></>
  const years: Record<string, Feed[]> = {}; old.forEach(x => (years[x.date.slice(0, 4)] = years[x.date.slice(0, 4)] || []).push(x))
  const thisY = S.today.slice(0, 4)
  return <>{head}{Object.keys(years).sort().reverse().map(y => <details className="tg-year" key={y} open={y === thisY}><summary>{y}년 <span className="small">{years[y].length}개</span></summary><FeedRows list={years[y]} /></details>)}
    <button className="btn tg-more" onClick={() => { S.feedAll = false; emit() }}>접기</button></>
}
function openFeedMenu(key: string) {
  const [kind, a, b] = key.split(':')
  const hide = async () => { closeModal(); await tgSaveOpt('feedHidden', feedHiddenAdd(key)) }
  const delLog = () => {
    const ids = (S.logs || []).map(parseLog).filter((l: Rec) => l && l.bid === a && l.date === b).map((l: Rec) => l.id)
    if (!ids.length || !confirm('이 날 독서 기록을 지울까요?')) return
    ids.forEach((id: string) => deleteLog(id)); closeModal(); toast('기록을 지웠어요')
  }
  const unshare = () => { const x = S.snips.find((s: Rec) => s.ID === a); if (!x) return; setSnipShared(x, false); emit(); toast('이 문장은 이제 나만 봐요') }
  modal(<><h3>이 소식 고치기</h3><div className="qmenu">
    <button onClick={hide}><b>🙈 소식에서 숨기기</b><span>나와 짝꿍 둘 다 이 소식이 안 보여요 (기록은 그대로)</span></button>
    {kind === 'log' && <button onClick={delLog}><b>🗑 이 날 독서 기록 지우기</b><span>{(book(a) || {})['제목'] || ''} · {b.slice(5).replace('-', '.')} 기록을 지워요 (쪽수 통계에서도 빠져요)</span></button>}
    {kind === 'rx' && <button onClick={() => { closeModal(); delReact(a) }}><b>🗑 반응 · 한마디 지우기</b><span>상대에게도 사라져요</span></button>}
    {kind === 'bc' && <button onClick={() => { closeModal(); bcDel(a) }}><b>🗑 댓글 지우기</b><span>상대에게도 사라져요</span></button>}
    {kind === 'tb' && <button onClick={() => { closeModal(); tbRemove(a) }}><b>🗑 같이 읽을 책에서 빼기</b><span></span></button>}
    {kind === 'snip' && <button onClick={() => { closeModal(); unshare() }}><b>🔒 이 문장 다시 나만 보기</b><span>짝꿍에게 안 보여요</span></button>}</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>)
}

/* ===== 같이 읽을 책 ===== */
const TB_FIELDS = ['제목', '저자', '옮긴이', '출판사', '대분류', '중분류', '분량', '표지URL', 'ISBN']
const pickFields = (d: Rec) => Object.fromEntries(TB_FIELDS.filter(k => d[k] !== undefined && d[k] !== '' && d[k] != null).map(k => [k, d[k]]))
function TbWho({ d }: { d: Rec }) {
  const st = (b: Rec | null | undefined) => !b ? '서재에 없음' : b['상태'] === '읽는중' ? '읽는 중' : b['상태'] === '완독' ? '다 읽음' : b['상태'] === '읽을예정' ? '읽고 싶은 책' : b['상태']
  const mb = S.books.find((x: Rec) => tgSame(x, d)), pb = (S.tg.books || []).find((x: Rec) => tgSame(x, d))
  return <div className="tg-stars"><span>{(S.tg.me || {}).name || '나'} · {st(mb)}</span><span>{tgName()} · {st(pb)}</span></div>
}
function TbBooks() {
  const list = (S.tg.tbooks || []).filter((t: Rec) => t.status === '예정')
  const me = S.tg.me.id
  return <div className="panel2"><h4>같이 읽을 책 <button className="kw-ai" onClick={openTbAdd}>＋ 담기</button></h4>
    {list.length ? list.map((t: Rec) => { const d = t.data || {}; const mb = S.books.find((x: Rec) => tgSame(x, d))
      return <div className="tg-both" key={t.id}><Spine b={d} /><div className="grow">
        <div className="tg-bt">{d['제목'] || ''}</div><div className="small">{d['저자'] || ''} · {t.added_by === me ? '내가' : jo(tgName(), '이', '가')} 담음</div>
        <TbWho d={d} />
        <div className="inline" style={{ marginTop: 6 }}>{mb && (mb['상태'] === '읽는중' || mb['상태'] === '완독') ? null : <button className="btn primary" onClick={() => tbMyStart(t.id)}>나 읽기 시작</button>}<button className="btn" onClick={() => tbRemove(t.id)}>빼기</button></div></div></div> })
      : <div className="small">둘이 다음에 같이 읽고 싶은 책을 담아 두세요. 내 서재에 없던 책은 내 읽고 싶은 책에도 들어가고, 읽기 시작은 각자 서재에서 해요.</div>}</div>
}
async function tbAdd(data: Rec) {
  if ((S.tg.tbooks || []).some((t: Rec) => t.status === '예정' && tgSame(t.data, data))) { toast('이미 담겨 있어요'); return }
  try {
    const r = await sbq(sb.from('together_books').insert({ pship: S.tg.partner.pship, data }).select('id, pship, data, added_by, status, joined, started_at, created_at').single())
    S.tg.tbooks.push(r); tgSave(); notifyPartner('together', r.id)
    // 내 서재에 없던 책이면 '읽고 싶은 책'으로도 넣어요
    let added = false
    if (!S.books.some((x: Rec) => tgSame(x, data))) { try { updateBook(await call('saveBook', Object.assign({ ID: '', '상태': '읽을예정' }, pickFields(data)))); added = true } catch { /* call이 알려 줘요 */ } }
    closeModal(); toast(`『${data['제목']}』를 같이 읽을 책에 담았어요${added ? ' · 내 읽고 싶은 책에도 넣었어요' : ''}`); emit()
  } catch (e) { err(e) }
}
async function tbRemove(id: string) {
  const t = S.tg.tbooks.find((x: Rec) => x.id === id); if (!t || !confirm(`『${t.data['제목']}』를 같이 읽을 책에서 뺄까요?`)) return
  try { await sbq(sb.from('together_books').update({ deleted: true }).eq('id', id)); S.tg.tbooks = S.tg.tbooks.filter((x: Rec) => x.id !== id); tgSave(); emit() } catch (e) { err(e) }
}
// 나만 읽기 시작: 내 서재에서만 '읽는 중'으로 (상대 서재는 그대로)
async function tbMyStart(id: string) {
  const t = (S.tg.tbooks || []).find((x: Rec) => x.id === id); if (!t) return
  try {
    const mine = S.books.find((b: Rec) => tgSame(b, t.data))
    if (mine) patchBook(mine.ID, { '상태': '읽는중', '시작일': S.today })
    else updateBook(await call('saveBook', Object.assign({ ID: '', '상태': '읽는중', '시작일': S.today, '플랫폼': '종이책' }, pickFields(t.data))))
    toast(`『${t.data['제목']}』 읽기 시작! 내 서재에 읽는 중으로 넣었어요`); emit()
  } catch (e) { err(e) }
}
function TbAdd() {
  const T = S.tg
  const [res, setRes] = useState<React.ReactNode>(null)
  const wish = (list: Rec[], who: string) => list.filter(b => b['상태'] === '읽을예정' && !(T.tbooks || []).some((t: Rec) => t.status === '예정' && tgSame(t.data, b)))
    .map(b => <button key={who + b.ID} className="chip" onClick={() => tbAdd(pickFields(b))}>{who} · {b['제목']}</button>)
  const chips = [...wish(S.books, '나'), ...wish(T.books, tgName())]
  const search = async () => {
    const q = $('tb-q')?.value.trim(); if (!q) return
    setRes(<div className="al-msg">찾는 중…</div>)
    try {
      const list: Rec[] = await call('bookSearch', q)
      setRes(list.length ? list.map((x, i) => <button key={i} className="al-item" onClick={async () => {
        setRes(<div className="al-msg">책 정보를 가져오는 중…</div>)
        let d: Rec = { '제목': x.title, '저자': x.author, '출판사': x.publisher, '표지URL': x.cover, 'ISBN': x.isbn13 || x.isbn10 || '' }
        try { d = pickFields(await call('bookDetail', x)) } catch { /* 검색 정보로 */ }
        tbAdd(d)
      }}><img src={x.cover} alt="" /><div><b>{x.title}</b><span>{x.author} · {x.publisher}</span></div></button>) : <div className="al-msg">검색 결과가 없어요</div>)
    } catch (e) { setRes(<div className="al-msg">{errMsg(e)}</div>) }
  }
  return <>
    <h3>같이 읽을 책 담기</h3>
    {chips.length > 0 && <><label>읽고 싶은 책에서 고르기</label><div className="suggest">{chips}</div></>}
    <label>책 검색</label>
    <div className="al-box"><input className="field" id="tb-q" type="search" placeholder="제목 · 저자 · ISBN" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
      <button className="btn" onClick={() => openBarcode(v => { const q = $('tb-q'); if (q) { q.value = v; search() } })} aria-label="바코드로 찾기">📷</button><button className="btn primary" onClick={search}>검색</button></div>
    <div id="tb-res" className="al-res">{res}</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
function openTbAdd() { modal(<TbAdd />) }

/* ===== 초대 ===== */
async function tgInvite() {
  const email = String($('tg-email')?.value || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('이메일 주소를 확인해 주세요'); return }
  try { await sbq(sb.from('partnerships').insert({ invitee_email: email })); toast('초대를 보냈어요'); await tgRefresh() } catch (e) { err(e) }
}
async function tgCancel(id: string) {
  if (!confirm('초대를 취소할까요?')) return
  try { await sbq(sb.from('partnerships').update({ status: 'ended' }).eq('id', id)); await tgRefresh() } catch (e) { err(e) }
}
async function tgAccept(id: string) {
  try { await sbq(sb.rpc('accept_invite', { invite_id: id })); closeModal(); toast('이제 함께 써요!'); await tgRefresh(); if (S.view !== 'together') go('together') } catch (e) { err(e) }
}
async function tgDecline(id: string) {
  if (!confirm('초대를 거절할까요?')) return
  try { await sbq(sb.rpc('decline_invite', { invite_id: id })); closeModal(); await tgRefresh() } catch (e) { err(e) }
}
async function tgTell(email: string) {
  const url = location.origin + '/'
  const text = `나의 서재에 초대했어요 📚\n앱을 열고 ${email} 구글 계정으로 로그인하면 ‘수락하기’가 보여요.`
  try { if (navigator.share) { await navigator.share({ title: '나의 서재 초대', text, url }); return } } catch (e) { if (e && (e as Error).name === 'AbortError') return }
  try { await navigator.clipboard.writeText(text + '\n' + url); toast('초대 문구를 복사했어요. 카톡에 붙여넣어 주세요') } catch { toast(url) }
}
function Invite() {
  const T = S.tg, me = T.me || {}, sent = (T.sent || [])[0]
  return <>
    <div className="view-head"><h1>함께</h1><p>둘이 읽는 책 · 진행률 · 고른 문장을 나눠 봐요</p></div>
    {(T.incoming || []).map((p: Rec) => <div className="panel2 tg-inv" key={p.id}><Avatar name={p.inviter_name} cls="p" /><div className="grow"><b>{p.inviter_name || p.inviter_email}</b>님이 나의 서재를 함께 쓰자고 초대했어요
      <div className="small">{p.inviter_email || ''}</div>
      <div className="actions"><button className="btn" onClick={() => tgDecline(p.id)}>거절</button><button className="btn primary grow" onClick={() => tgAccept(p.id)}>수락하기</button></div></div></div>)}
    {sent ? <div className="panel2"><h4>초대를 보냈어요</h4><div className="small" style={{ lineHeight: 1.7 }}><b>{sent.invitee_email}</b> 계정으로 초대했어요.<br />
      상대가 앱을 열고 이 구글 계정으로 로그인하면 ‘수락하기’가 보여요.</div>
      <div className="actions"><button className="btn" onClick={() => tgCancel(sent.id)}>초대 취소</button><button className="btn primary grow" onClick={() => tgTell(sent.invitee_email)}>카톡 등으로 알려주기</button></div></div>
      : <div className="panel2"><h4>같이 쓸 사람 초대하기</h4>
        <div className="small" style={{ lineHeight: 1.7 }}>상대가 로그인할 <b>구글 계정 이메일</b>을 넣어 주세요. 한 사람과만 같이 쓸 수 있어요.</div>
        <div className="inline" style={{ marginTop: 8 }}><input className="field" id="tg-email" type="email" inputMode="email" autoComplete="off" placeholder="예: someone@gmail.com" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tgInvite() } }} />
          <button className="btn primary" onClick={tgInvite}>초대</button></div></div>}
    <div className="panel2"><h4>같이 쓰면 이렇게 돼요</h4><div className="small" style={{ lineHeight: 1.8 }}>
      👀 <b>보여줘요</b>: 책 목록 · 별점 · 한줄평 · 읽은 쪽수 (책마다 ‘나만 보기’로 숨길 수 있어요)<br />
      ✋ <b>고른 것만</b>: 필사 · 내 생각 (문장을 꾹 눌러 골라서 ‘보여주기’)<br />
      🔒 <b>항상 나만</b>: 메모 · 노트 · 할 일<br />
      서로 보기만 할 수 있고, 상대 기록을 고치거나 지울 수는 없어요.</div></div>
    <div className="small" style={{ textAlign: 'center', margin: '10px 0' }}>내 계정: {me.email || ''} · <button className="note-link" style={{ display: 'inline' }} onClick={() => tgRefresh()}>새로 불러오기</button></div>
  </>
}
// 받은 초대가 있으면 한 번 물어보기 (세션마다 한 번)
setInvitePrompt(() => {
  const p = (S.tg.incoming || [])[0]
  if (!p || tgHasPartner() || S.tgAsked === p.id || M.node || S.view === 'together') return
  S.tgAsked = p.id
  modal(<><h3>함께 쓰기 초대</h3><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar name={p.inviter_name} cls="p" /><div><b>{p.inviter_name || p.inviter_email}</b>님이 나의 서재를 함께 쓰자고 초대했어요.
    <div className="small">{p.inviter_email || ''}</div></div></div>
    <div className="small" style={{ lineHeight: 1.7, marginTop: 10 }}>수락하면 서로의 책 목록 · 별점 · 읽은 쪽수, 그리고 고른 필사만 볼 수 있어요. 메모 · 노트 · 할 일은 항상 나만 봐요.</div>
    <div className="actions"><button className="btn" onClick={closeModal}>나중에</button><button className="btn" onClick={() => tgDecline(p.id)}>거절</button><button className="btn primary grow" onClick={() => tgAccept(p.id)}>수락하기</button></div></>)
})

/* ===== 함께 탭 ===== */
export function TogetherView() {
  const T = S.tg
  useEffect(() => { tgRefresh(true) }, [])
  if (!togetherOn()) return <section id="v-together"><div className="view-head"><h1>함께</h1><p>설정에서 같이 쓰기를 켜면 보여요.</p></div></section>
  if (!T.at) return <section id="v-together"><div className="view-head"><h1>함께</h1></div><div className="drill"><Spin /> 불러오는 중…</div></section>
  if (!T.partner) return <section id="v-together"><Invite /></section>
  const me = T.me || {}, pn = tgName()
  const mineS = tgMonthStats(S.books, myLogs()), theirS = tgMonthStats(T.books, T.logs)
  const StatCol = ({ name, s, cls }: { name: string; s: Rec; cls: string }) => <div className="tg-col" onClick={() => openProfile(cls === 'p' ? 'p' : 'me')}><Avatar name={name} cls={cls} /><b>{name} <span className="small" style={{ fontWeight: 400 }}>서재 ›</span></b>
    <div className="tg-num"><span><b>{s.pages.toLocaleString()}</b>쪽 읽음</span><span><b>{s.days}</b>일 기록</span><span><b>{s.done}</b>권 완독</span><span className="tg-tot">서재 {s.total}권</span></div></div>
  // 둘 다 서재에 있는 책: 읽는 중 → 다 읽은 책 → 읽고 싶은 책
  const rank = (x: Rec) => (x.pb['상태'] === '읽는중' || x.mb['상태'] === '읽는중') ? 0 : (x.pb['상태'] === '완독' && x.mb['상태'] === '완독') ? 1 : 2
  const both = (T.books as Rec[]).map(pb => ({ pb, mb: tgMine(pb) })).filter(x => x.mb).sort((a, b) => rank(a) - rank(b) || String(bookDayT(b.pb)).localeCompare(String(bookDayT(a.pb)))) as { pb: Rec; mb: Rec }[]
  const nRead = both.filter(x => rank(x) === 0).length
  const reading = (T.books as Rec[]).filter(b => b['상태'] === '읽는중')
  const Bar = ({ name, b, cls }: { name: string; b: Rec; cls: string }) => { const p = tgProg(b); return <div className={'tg-prog ' + cls}><span>{name}</span><div className="bar"><i style={{ width: p.pct + '%' }} /></div><em>{b['상태'] === '완독' ? '완독' : p.cur ? 'p.' + p.cur + (p.total ? ` · ${p.pct}%` : '') : b['상태'] === '읽을예정' ? '읽고 싶은' : '–'}</em></div> }
  return <section id="v-together">
    <div className="view-head tg-head"><div><h1>함께</h1><p><button className="tg-pbtn" onClick={() => openProfile('me')}><Avatar name={me.name} /></button><button className="tg-pbtn" onClick={() => openProfile('p')}><Avatar name={pn} cls="p" /></button> {me.name} · {pn}</p></div>
      <button className="iconbtn" onClick={openShareSettings}>보여줄 것</button></div>
    <div className="panel2"><h4>둘의 {Number(tgMonth().slice(5))}월</h4><div className="tg-cols"><StatCol name={me.name} s={mineS} cls="" /><StatCol name={pn} s={theirS} cls="p" /></div></div>
    {both.length > 0 && <div className="panel2"><h4>둘 다 있는 책 <span className="small" style={{ fontWeight: 400 }}>{both.length}권{nRead ? ` · 같이 읽는 중 ${nRead}` : ''}</span></h4>
      {(S.bothAll ? both : both.slice(0, 4)).map(({ pb, mb }) => <div className="tg-both" key={pb.ID} onClick={() => openPartnerBook(pb.ID)}><Spine b={mb} /><div className="grow">
        <div className="tg-bt">{mb['제목']}</div><Bar name={me.name} b={mb} cls="" /><Bar name={pn} b={pb} cls="p" />
        {(mb['별점'] || pb['별점']) && <div className="tg-stars"><span>{me.name} <i className="stars">{mb['별점'] ? '★'.repeat(Number(mb['별점']) || 0) : '–'}</i></span><span>{pn} <i className="stars">{pb['별점'] ? '★'.repeat(Number(pb['별점']) || 0) : '–'}</i></span></div>}</div></div>)}
      {both.length > 4 && <button className="btn tg-more" onClick={() => { S.bothAll = !S.bothAll; emit() }}>{S.bothAll ? '접기' : `모두 보기 (${both.length}권)`}</button>}</div>}
    <TbBooks />
    <div className="panel2"><h4>{pn}의 서재 <button className="kw-ai" onClick={() => openProfile('p')}>서재 {shelfCount(T.books)}권 보기 →</button></h4>
      {reading.length ? <div className="tg-shelf">{reading.map(b => <button key={b.ID} onClick={() => openPartnerBook(b.ID)}><Spine b={b} /><span>{b['제목']}</span><em>{tgProg(b).pct ? tgProg(b).pct + '%' : '읽는 중'}</em></button>)}</div>
        : <div className="small">지금 읽는 중인 책이 없어요.</div>}</div>
    <div className="panel2"><h4>최근 소식</h4><FeedBox /></div>
    <div className="small" style={{ textAlign: 'center', margin: '14px 0 4px' }}><button className="note-link" style={{ display: 'inline' }} onClick={() => tgRefresh()}>새로 불러오기</button> · {hhmmOf(T.at)} 기준</div>
  </section>
}

/* ===== 프로필 · 서재 목록 (짝꿍 것은 보기만) ===== */
function SharedList({ me }: { me: boolean }) {
  const bk = (s: Rec) => me ? book(s['책ID']) : (S.tg.books || []).find((b: Rec) => b.ID === s['책ID'])
  const list = sharedSnipsOf(me).slice().sort((a, b) => lifeOf(b) - lifeOf(a) || String(b['작성일'] || '').localeCompare(String(a['작성일'] || '')))
  return <><div className="life-list">{list.length ? list.slice(0, S.shdLimit).map(s => { const b = bk(s) || {}, n = lifeOf(s)
    return <div className={'life-card ' + (n ? 'l' + n : '')} key={s.ID} onClick={() => me ? openSnipInBook(s.ID) : openPartnerBook(s['책ID'], s.ID)}>{n > 0 && <div className="life-st">{'★'.repeat(n)}<span>{LIFE[n]}</span></div>}
      {s['제목'] && <div className="stitle">{s['제목']}</div>}<div className="txt">{sText(s)}</div>{sMemo(s) && <div className="smemo">✎ {sMemo(s)}</div>}
      <div className="life-src">{b['제목'] || ''}{hasPage(s) ? ' · ' + pgLabel(s['쪽수']) : ''}{isThought(s) ? ' · 내 생각' : ''}</div>
      <ReactBar sid={s.ID} owner={me ? S.tg.me.id : S.tg.partner.id} /></div> }) : <div className="empty">{me ? '아직 보여준 문장이 없어요. 보여줄 것 → 책 목록에서 고르기에서 골라 보세요.' : '아직 보여준 문장이 없어요'}</div>}</div>
    {list.length > S.shdLimit && <button className="btn tg-more" onClick={() => { S.shdLimit += 40; emit() }}>더보기 ({list.length - S.shdLimit}개 남음)</button>}</>
}
export function PartnerLibView() {
  const mine = S.plibWho === 'me'
  useEffect(() => { if (!mine && !tgHasPartner()) go('together') }, [mine])
  if (!mine && !tgHasPartner()) return <section id="v-plib" />
  const name = mine ? (S.tg.me || {}).name || '나' : tgName()
  const all: Rec[] = mine ? S.books : S.tg.books
  const list = all.filter(b => S.tgFilter === '전체' ? b['상태'] !== '읽을예정' : b['상태'] === S.tgFilter)
    .sort((a, b) => String(b['완독일'] || b['시작일'] || b['등록일'] || '').localeCompare(String(a['완독일'] || a['시작일'] || a['등록일'] || '')))
  const done = all.filter(b => b['상태'] === '완독').length, reading = all.filter(b => b['상태'] === '읽는중').length
  const shown = S.tg.me ? sharedSnipsOf(mine).length : 0, tab = S.plibTab === 'snips' ? 'snips' : 'books'
  return <section id="v-plib">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 함께</button>{mine && <button className="iconbtn" onClick={openMyProfile}>프로필 고치기</button>}</div>
    <div className="tg-prof">{mine ? <button className="tg-pbtn" onClick={openMyProfile} aria-label="프로필 사진 바꾸기"><Avatar name={name} cls="big" /></button> : <button className="tg-pbtn" onClick={() => openAvatarZoom('p')} aria-label="프로필 사진 크게 보기"><Avatar name={name} cls="p big" /></button>}
      <div><h1>{name}</h1><p className="small">{mine ? '내 서재' : '보기만 할 수 있어요'} · 서재 {shelfCount(all)}권 · 완독 {done} · 읽는 중 {reading}{all.length - shelfCount(all) ? ` · 읽고 싶은 ${all.length - shelfCount(all)}권` : ''}</p></div></div>
    <div className="seg" id="pl-tab"><button className={tab === 'books' ? 'on' : ''} onClick={() => { S.plibTab = 'books'; S.shdLimit = 40; emit() }}>서재 {shelfCount(all)}권</button><button className={tab === 'snips' ? 'on' : ''} onClick={() => { S.plibTab = 'snips'; S.shdLimit = 40; emit() }}>보여준 문장 {shown}</button></div>
    {tab === 'snips' ? (S.tg.me ? <SharedList me={mine} /> : null) : <>
      <div className="chips" id="pl-f">{FILTERS.map(f => <button key={f} className={'chip ' + (S.tgFilter === f ? 'on' : '')} onClick={() => { S.tgFilter = f; emit() }}>{FILTER_LABEL[f] || f} {f === '전체' ? shelfCount(all) : all.filter(b => b['상태'] === f).length}</button>)}</div>
      <div className="list">{list.length ? list.map(b => { const p = tgProg(b), other = mine ? tgTheirs(b) : tgMine(b)
        return <div className="book" key={b.ID} onClick={() => mine ? go('book', b.ID) : openPartnerBook(b.ID)}><Spine b={b} /><div className="binfo"><div className="btitle">{b['제목']}</div>
          <div className="bauthor">{b['저자'] || ''}</div>
          {tgPeriod(b) && <div className="tg-per">{tgPeriod(b)}</div>}
          <div className="bmeta">{b['별점'] ? <span className="stars">{starText(b['별점'])}</span> : null}{b['상태'] === '읽는중' && p.pct ? <span className="badge">{p.pct}%</span> : null}{mine && !bookShared(b) && <span className="badge plat">🔒 나만 보기</span>}{other && <span className="badge plat">{mine ? tgName() + '도 있음' : '내 서재에도 있음'}</span>}</div></div></div> })
        : <div className="empty">책이 없어요</div>}</div></>}
  </section>
}

/* ===== 짝꿍 책 하나 ===== */
function PSnip({ s, b, hide }: { s: Rec; b: Rec; hide: boolean }) {
  const [open, setOpen] = useState(false)
  const memo = sMemo(s), h = hide && !open
  void b
  return <div className={`snip ${isThought(s) ? 'thought' : 'quote'} ${h ? 'spoil' : ''}`} id={'p-' + s.ID} onClick={h ? () => setOpen(true) : undefined}>
    {h && <div className="spoil-l">🙈 {firstPage(s['쪽수']) != null ? `${pgLabel(s['쪽수'])} · 아직 안 읽은 부분이에요` : '스포일러가 있을 수 있어요'} · 눌러서 보기</div>}
    <LifeBadge s={s} />{s['제목'] && <div className="stitle">{s['제목']}</div>}<div className="txt">{sText(s)}</div>
    {memo && <div className="smemo">✎ {memo}</div>}
    {hasPage(s) && <div className="smeta"><span className="pg">{pgLabel(s['쪽수'])}</span></div>}
    <ReactBar sid={s.ID} owner={S.tg.partner.id} /></div>
}
async function tgCopyBook(id: string) {
  const b = (S.tg.books || []).find((x: Rec) => x.ID === id); if (!b) return
  if (tgMine(b)) { toast('이미 내 서재에 있어요'); return }
  try { const saved = await call('saveBook', Object.assign({ ID: '', '상태': '읽을예정' }, pickFields(b))); updateBook(saved); toast('읽고 싶은 책에 담았어요'); emit() } catch { /* call이 알려 줘요 */ }
}
export function PartnerBookView() {
  const b: Rec | undefined = (S.tg.books || []).find((x: Rec) => x.ID === S.pbookId)
  useEffect(() => { if (S.pflash) { const id = S.pflash; S.pflash = ''; setTimeout(() => { const x = document.getElementById('p-' + id); if (x) { x.scrollIntoView({ block: 'center' }); x.classList.add('flash') } }, 80) } })
  if (!b || !S.tg.partner) return <section id="v-pbook"><div className="topbar"><button className="iconbtn" onClick={goBack}>← 함께</button></div><div className="empty">이 책은 이제 볼 수 없어요</div></section>
  const pn = tgName(), mine = tgMine(b), p = tgProg(b)
  // 스포일러 가리기: 내가 이 책을 아직 다 안 읽었으면, 내가 읽은 곳 뒤의 문장 · 생각 · 한줄평은 가려요
  const guard = tgSpoilOn() && !!mine && mine['상태'] !== '완독'
  const myCur = guard ? (Number(mine!['현재쪽수']) || 0) : Infinity
  const hide = (s: Rec) => { if (!guard) return false; const pg = snipPage(s, b); return pg != null ? pg > myCur : isThought(s) }
  const snips = sortByPage(S.tg.snips.filter((s: Rec) => s['책ID'] === b.ID), b)
  const daily = tgDaily(S.tg.logs.filter((l: TLog) => l.bid === b.ID))
  const days = Object.entries(daily).filter(([, n]) => n > 0).sort((x, y) => y[0].localeCompare(x[0]))
  const spoilReview = guard && !!b['한줄평']
  const q = mine ? tgProg(mine) : null
  return <section id="v-pbook">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 뒤로</button>
      {mine ? <button className="iconbtn" onClick={() => go('book', mine.ID)}>내 기록 보기</button> : <button className="iconbtn" onClick={() => tgCopyBook(b.ID)}>＋ 내 서재에 담기</button>}</div>
    <div className="detail-head"><Spine b={b} /><div><div className="dtitle">{b['제목']}</div>
      <div className="dauthor">{b['저자'] || ''}{b['출판사'] ? ' · ' + b['출판사'] : ''}</div>
      <div className="tags"><span className="tag"><Avatar name={pn} cls="p" /> {pn}의 책</span>{[b['대분류'], b['중분류']].filter(Boolean).map(t => <span className="tag" key={t}>{t}</span>)}</div></div></div>
    <div className="panel2"><h4>{b['상태'] === '완독' ? '다 읽었어요' : b['상태'] === '읽는중' ? '읽는 중' : '읽고 싶은 책'}</h4>
      {b['상태'] !== '읽을예정' && <div className="tg-prog p"><span>{pn}</span><div className="bar"><i style={{ width: p.pct + '%' }} /></div><em>{b['상태'] === '완독' ? String(b['완독일'] || '').slice(5).replace('-', '.') + ' 완독' : p.cur ? 'p.' + p.cur + (p.total ? ' / ' + p.total : '') : '–'}</em></div>}
      {mine && q && b['상태'] !== '읽을예정' && <div className="tg-prog"><span>나</span><div className="bar"><i style={{ width: q.pct + '%' }} /></div><em>{mine['상태'] === '완독' ? '완독' : q.cur ? 'p.' + q.cur : mine['상태'] === '읽을예정' ? '읽고 싶은' : '–'}</em></div>}
      {b['시작일'] && <div className="small" style={{ marginTop: 6 }}>{period(b)}{b['완독일수'] ? ` · ${b['완독일수']}일` : ''}</div>}
      {days.length > 0 && <div className="small" style={{ marginTop: 6 }}>최근: {days.slice(0, 5).map(([d, n]) => `${d.slice(5).replace('-', '.')} ${n}쪽`).join(' · ')}</div>}</div>
    {(b['별점'] || b['한줄평'] || (mine && (mine['별점'] || mine['한줄평']))) && <div className="panel2"><h4>별점 · 한줄평</h4>
      <ReviewRow name={pn} cls="p" b={b} spoil={spoilReview} />
      {mine && (mine['별점'] || mine['한줄평']) ? <ReviewRow name="나" cls="" b={mine} onClick={() => openRating(mine.ID)} /> : mine && mine['상태'] === '완독' ? <div className="tg-rv" style={{ cursor: 'pointer' }} onClick={() => openRating(mine.ID)}><Avatar name={(S.tg.me || {}).name} /><div className="small">내 별점 · 한줄평 남기기 ›</div></div> : null}</div>}
    <div className="sec-head tight"><h2>{jo(pn, '이', '가')} 보여준 문장 <span className="small" style={{ fontWeight: 400 }}>{snips.length}개</span></h2></div>
    {guard && snips.some(hide) && <div className="sec-sub">내가 읽은 p.{myCur || 0} 뒤는 가려 뒀어요</div>}
    <div>{snips.length ? snips.map(s => <PSnip key={s.ID} s={s} b={b} hide={hide(s)} />) : <div className="empty">아직 보여준 문장이 없어요</div>}</div>
    <BookComments owner={S.tg.partner.id} bid={b.ID} />
  </section>
}

/* ===== 내 프로필 · 사진 범위 고르기 ===== */
function MyProfile() {
  const me = S.tg.me || {}
  const save = async () => {
    const name = ($('tg-name')?.value || '').trim(); if (!name) { toast('이름을 넣어 주세요'); return }
    try { await sbq(sb.from('profiles').update({ name }).eq('user_id', sbUid())); S.tg.me.name = name; tgSave(); toast('저장했어요'); emit() } catch (e) { err(e) }
  }
  const remove = async () => {
    if (!confirm('프로필 사진을 지울까요?')) return
    try {
      await sbq(sb.storage.from(AV_BUCKET).remove([`${sbUid()}/avatar.jpg`, `${sbUid()}/avatar-full.jpg`]))
      await sbq(sb.from('profiles').update({ avatar: null }).eq('user_id', sbUid()))
      S.tg.me.avatar = ''; delete (S.tg.av || {})[sbUid()]; tgSave()
      toast('사진을 지웠어요'); remodal(<MyProfile />)
    } catch (e) { err(e) }
  }
  return <>
    <h3>내 프로필 <Sub>{tgHasPartner() ? tgName() + '에게' : '짝꿍에게'} 이렇게 보여요</Sub></h3>
    <div className="tg-prof" style={{ margin: '6px 0 4px' }}><Avatar name={me.name} cls="big" />
      <div className="inline"><label className="btn" style={{ cursor: 'pointer' }}>사진 고르기<input type="file" accept="image/*" hidden onChange={e => uploadAvatar(e.target.files && e.target.files[0])} /></label>
        {me.avatar && <button className="btn" onClick={remove}>사진 지우기</button>}</div></div>
    <div id="av-msg" className="small" />
    <label>이름</label>
    <div className="inline"><input className="field" id="tg-name" defaultValue={me.name || ''} maxLength={20} style={{ flex: 1 }} /><button className="btn primary" onClick={save}>저장</button></div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
export function openMyProfile() { if (!S.tg.me) { toast('잠시 뒤 다시 눌러 주세요 (불러오는 중)'); tgRefresh(true); return } modal(<MyProfile />) }
// 사진을 고르면 먼저 '범위 고르기' 창: 끌어서 옮기고, 막대 · 두 손가락으로 크기 (v2.14.2)
const AVC: { bmp: ImageBitmap | null; scale: number; min: number; x: number; y: number; V: number } = { bmp: null, scale: 1, min: 1, x: 0, y: 0, V: 280 }
async function uploadAvatar(file: File | null) {
  if (!file) return
  if (file.type && !/^image\//.test(file.type)) { toast('사진 파일을 골라 주세요'); return }
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file)) } catch { toast('⚠ 사진을 열지 못했어요'); return }
  AVC.bmp = bmp; AVC.min = AVC.V / Math.min(bmp.width, bmp.height); AVC.scale = AVC.min
  AVC.x = (AVC.V - bmp.width * AVC.scale) / 2; AVC.y = (AVC.V - bmp.height * AVC.scale) / 2
  modal(<AvatarCrop />)
}
function AvatarCrop() {
  const cv = useRef<HTMLCanvasElement>(null), zr = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<React.ReactNode>(null); const [busy, setBusy] = useState(false)
  const clamp = () => { const w = AVC.bmp!.width * AVC.scale, h = AVC.bmp!.height * AVC.scale; AVC.x = Math.min(0, Math.max(AVC.V - w, AVC.x)); AVC.y = Math.min(0, Math.max(AVC.V - h, AVC.y)) }
  const draw = () => { const c = cv.current; if (!c || !AVC.bmp) return; const g = c.getContext('2d')!; g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, AVC.V, AVC.V); g.drawImage(AVC.bmp, AVC.x, AVC.y, AVC.bmp.width * AVC.scale, AVC.bmp.height * AVC.scale) }
  const zoom = (z: number, cx0?: number, cy0?: number) => {   // z: 1 = 꽉 차게, 최대 4배
    const cx = cx0 ?? AVC.V / 2, cy = cy0 ?? AVC.V / 2
    const ns = AVC.min * Math.max(1, Math.min(4, z)), k = ns / AVC.scale
    AVC.x = cx - (cx - AVC.x) * k; AVC.y = cy - (cy - AVC.y) * k; AVC.scale = ns
    clamp(); draw()
    const r = zr.current; if (r && document.activeElement !== r) r.value = String(Math.round(AVC.scale / AVC.min * 100))
  }
  useEffect(() => {
    const c = cv.current; if (!c) return
    draw()
    const pts = new Map<number, { x: number; y: number }>(); let last: { x: number; y: number } | null = null, pinch: { d: number; z: number } | null = null
    const pos = (e: PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * AVC.V / r.width, y: (e.clientY - r.top) * AVC.V / r.height } }
    c.onpointerdown = e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); last = pos(e)
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: AVC.scale / AVC.min } } }
    c.onpointermove = e => {
      if (!pts.has(e.pointerId)) return; const p = pos(e); pts.set(e.pointerId, p)
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; zoom(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); return }
      if (pts.size === 1 && last) { AVC.x += p.x - last.x; AVC.y += p.y - last.y; last = p; clamp(); draw() }
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; last = pts.size ? [...pts.values()][0] : null }
    c.onpointerup = up; c.onpointercancel = up
    c.onwheel = e => { e.preventDefault(); const p = pos(e); zoom(AVC.scale / AVC.min * (e.deltaY < 0 ? 1.1 : 0.9), p.x, p.y) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const bmp = AVC.bmp; if (!bmp) return
    setBusy(true); setMsg(<><Spin /> 사진 올리는 중…</>)
    try {
      const sx = -AVC.x / AVC.scale, sy = -AVC.y / AVC.scale, sw = AVC.V / AVC.scale
      const c = document.createElement('canvas'); c.width = c.height = 320
      c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sw, 0, 0, 320, 320)
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.88))
      // 크게 볼 때: 고른 범위를 크게 (최대 1080px, 1MB 아래로)
      const side = Math.min(1080, Math.round(sw)), c2 = document.createElement('canvas'); c2.width = c2.height = side
      c2.getContext('2d')!.drawImage(bmp, sx, sy, sw, sw, 0, 0, side, side)
      let full: Blob | null = null; for (const q of [0.9, 0.82, 0.72, 0.6]) { full = await new Promise<Blob | null>(r => c2.toBlob(r, 'image/jpeg', q)); if (full && full.size < 950000) break }
      const uidv = sbUid(), ver = String(Date.now())
      await sbq(sb.storage.from(AV_BUCKET).upload(`${uidv}/avatar.jpg`, blob!, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' }))
      if (full && full.size < 1000000) { try { await sbq(sb.storage.from(AV_BUCKET).upload(`${uidv}/avatar-full.jpg`, full, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' })) } catch { /* 작은 사진만이라도 */ } }
      await sbq(sb.from('profiles').update({ avatar: ver }).eq('user_id', uidv))
      S.tg.me.avatar = ver; S.tg.av = await tgSignAvatars(S.tg); tgSave()
      AVC.bmp = null; toast('프로필 사진을 바꿨어요'); modal(<MyProfile />)
    } catch (e) { setMsg('⚠ ' + errMsg(e)); setBusy(false) }
  }
  return <>
    <h3>사진 범위 고르기 <Sub>끌어서 옮기고, 크기를 맞춰요</Sub></h3>
    <div className="avc-wrap"><canvas ref={cv} id="avc" width={AVC.V * 2} height={AVC.V * 2} /><div className="avc-ring" /></div>
    <div className="avc-zoom"><span>－</span><input ref={zr} type="range" id="avc-z" min={100} max={400} defaultValue={100} onInput={e => zoom(Number((e.target as HTMLInputElement).value) / 100)} /><span>＋</span></div>
    <div id="av-msg" className="small">{msg}</div>
    <div className="actions"><button className="btn" onClick={() => modal(<MyProfile />)}>취소</button><button className="btn primary grow" id="avc-go" disabled={busy} onClick={save}>이대로 저장</button></div>
  </>
}
async function openAvatarZoom(who: string) {
  const T = S.tg || {}, id = who === 'p' ? (T.partner || {}).id : (T.me || {}).id, small = id && (T.av || {})[id]
  if (!small) return
  modal(<><div className="av-zoom"><img id="av-big" src={small} alt="프로필 사진" /><div className="small">{who === 'p' ? tgName() : (T.me || {}).name || ''}</div></div>
    <div className="actions"><button className="btn primary grow" onClick={closeModal}>닫기</button></div></>)
  // 원본이 있으면 바꿔 끼우기 (예전에 올린 사진은 작은 것만 있어요)
  try {
    const r = await sb.storage.from(AV_BUCKET).createSignedUrl(`${id}/avatar-full.jpg`, 3600)
    const url = r && r.data && r.data.signedUrl
    if (url) { const im = new Image(); im.onload = () => { const el = document.getElementById('av-big') as HTMLImageElement | null; if (el) { el.src = url; el.classList.add('full') } }; im.src = url }
  } catch { /* 작은 사진 그대로 */ }
}

/* ===== 보여줄 것 설정 ===== */
function ShareSettings() {
  const T = S.tg, me = T.me || {}
  const nb = S.books.length, shown = S.books.filter(bookShared).length, ns = S.snips.filter(isShared).length
  const hidden = ((S.settings || {}).feedHidden || []).length
  const end = async () => {
    if (!confirm(`${jo(tgName(), '과', '와')} 같이 쓰기를 끝낼까요? 서로의 기록이 더 이상 안 보여요. (각자 기록은 그대로 남아요)`)) return
    try { await sbq(sb.from('partnerships').update({ status: 'ended' }).eq('id', S.tg.partner.pship)); closeModal(); toast('같이 쓰기를 끝냈어요'); await tgRefresh() } catch (e) { err(e) }
  }
  return <>
    <h3>보여줄 것 · 같이 쓰기</h3>
    <button className="tg-me-row" onClick={openMyProfile}><Avatar name={me.name} /><b>{me.name || ''}</b><span className="small">이름 · 프로필 사진 바꾸기 ›</span></button>
    <div className="panel2" style={{ marginTop: 12 }}><h4>👀 책 · 별점 · 한줄평 · 읽은 쪽수 <span className="small" style={{ fontWeight: 400 }}>기본 공개</span></h4>
      <div className="small">{nb}권 중 <b>{shown}권</b>을 보여주는 중이에요.</div>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn primary grow" onClick={() => { closeModal(); openShareList() }}>책 목록에서 고르기 ›</button></div></div>
    <div className="panel2"><h4>✋ 필사 · 내 생각 <span className="small" style={{ fontWeight: 400 }}>고른 것만</span></h4>
      <div className="small" style={{ lineHeight: 1.6 }}>지금 <b>{ns}개</b>를 보여주는 중이에요. 위 ‘책 목록에서 고르기’에서 책마다 필사를 모두 보여주거나 문장을 하나씩 골라요. 필사에 달아 둔 메모도 같이 보여요.</div>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn grow" onClick={() => { closeModal(); openProfile('me', 'snips') }}>내가 보여준 문장 보기 ›</button></div>
      <label className="tg-check"><input type="checkbox" id="tg-new" defaultChecked={tgShareNew()} onChange={e => tgSaveOpt('shareNew', e.target.checked)} /> 새로 쓰는 필사 · 내 생각은 처음부터 보여주기</label></div>
    <div className="panel2"><h4>🔒 메모 · 노트 · 할 일 <span className="small" style={{ fontWeight: 400 }}>항상 나만</span></h4><div className="small">이건 바꿀 수 없어요.</div></div>
    <label className="tg-check"><input type="checkbox" defaultChecked={tgSpoilOn()} onChange={e => tgSaveOpt('spoiler', e.target.checked)} /> 같이 읽는 책은 내가 읽은 곳 뒤 문장 가리기 (스포일러)</label>
    {hidden > 0 && <button className="note-link" onClick={async () => { closeModal(); await tgSaveOpt('feedHidden', []) }}>숨긴 소식 {hidden}개 다시 보이기 <span>최근 소식</span></button>}
    {tgHasPartner() && <div style={{ textAlign: 'right', marginTop: 16 }}><button className="tg-end" onClick={end}>같이 쓰기 끝내기</button></div>}
    <div className="actions"><button className="btn primary grow" onClick={closeModal}>닫기</button></div>
  </>
}
export function openShareSettings() { if (!S.tg.me) { toast('잠시 뒤 다시 눌러 주세요 (불러오는 중)'); tgRefresh(true); return } modal(<ShareSettings />) }

/* ===== 보여줄 것: 책 목록에서 고르기 (책 · 필사 모두 · 문장 하나씩) — 저장을 눌러야 바뀌어요 ===== */
S.shF = '전체'; S.shOpen = null; S.shQ = ''
export function openShareList() { S.shDraft = { books: {}, snips: {} }; S.shOpen = null; go('share') }
const shBook = (b: Rec) => Object.assign({ '공개': bookShared(b), '필사공개': bookSnipShared(b) }, (S.shDraft.books[b.ID] || {}))
const shSnip = (s: Rec) => (s.ID in S.shDraft.snips) ? S.shDraft.snips[s.ID] : isShared(s)
function shChanges() {
  let n = 0
  Object.entries(S.shDraft.books as Record<string, Rec>).forEach(([id, d]) => { const b = book(id); if (!b) return; if (d['공개'] !== undefined && d['공개'] !== bookShared(b)) n++; if (d['필사공개'] !== undefined && d['필사공개'] !== bookSnipShared(b)) n++ })
  Object.entries(S.shDraft.snips as Record<string, boolean>).forEach(([id, v]) => { const s = S.snips.find((x: Rec) => x.ID === id); if (s && v !== isShared(s)) n++ })
  return n
}
export function shareLeaveOk() { return !S.shDraft || !shChanges() || confirm('저장하지 않은 변경이 있어요. 그냥 나갈까요?') }
export function ShareListView() {
  if (!S.shDraft) S.shDraft = { books: {}, snips: {} }
  const q = S.shQ.trim().toLowerCase()
  const visible = S.books.filter((b: Rec) => (S.shF === '전체' || b['상태'] === S.shF) && (!q || String(b['제목'] + ' ' + (b['저자'] || '')).toLowerCase().includes(q))) as Rec[]
  const list = visible.slice().sort((a, b) => String(b['완독일'] || b['시작일'] || '').localeCompare(String(a['완독일'] || a['시작일'] || '')))
  const ch = shChanges()
  const set = (id: string, k: string, v: boolean) => {
    S.shDraft.books[id] = Object.assign({}, S.shDraft.books[id], { [k]: v })
    if (k === '필사공개') snipsOf(id).filter(s => s['유형'] !== '메모').forEach(s => S.shDraft.snips[s.ID] = v)   // 필사 모두 ↔ 문장 전부
    emit()
  }
  const snipSet = (id: string, v: boolean) => {
    S.shDraft.snips[id] = v
    const s = S.snips.find((x: Rec) => x.ID === id), b = s && book(s['책ID'])
    if (b && !v && shBook(b)['필사공개']) S.shDraft.books[b.ID] = Object.assign({}, S.shDraft.books[b.ID], { '필사공개': false })   // 하나라도 숨기면 '고른 것만'
    emit()
  }
  const bulk = (k: string, v: boolean) => {
    visible.forEach(b => { if (k === '필사공개' && !snipsOf(b.ID).some(s => s['유형'] !== '메모')) return; S.shDraft.books[b.ID] = Object.assign({}, S.shDraft.books[b.ID], { [k]: v })
      if (k === '필사공개') snipsOf(b.ID).filter(s => s['유형'] !== '메모').forEach(s => S.shDraft.snips[s.ID] = v) })
    emit()
  }
  const save = () => {
    let nb = 0, ns = 0
    Object.entries(S.shDraft.books as Record<string, Rec>).forEach(([id, d]) => {
      const b = book(id); if (!b) return; const patch: Rec = {}
      if (d['공개'] !== undefined && d['공개'] !== bookShared(b)) patch['공개'] = d['공개']
      if (d['필사공개'] !== undefined && d['필사공개'] !== bookSnipShared(b)) patch['필사공개'] = d['필사공개']
      if (Object.keys(patch).length) { patchBook(id, patch); nb++ }
    })
    Object.entries(S.shDraft.snips as Record<string, boolean>).forEach(([id, v]) => {
      const x = S.snips.find((s: Rec) => s.ID === id); if (!x || isShared(x) === v || x['유형'] === '메모') return
      setSnipShared(x, v); ns++
    })
    S.shDraft = { books: {}, snips: {} }; emit()
    toast(`저장했어요 · 책 ${nb}권 · 문장 ${ns}개`)
  }
  return <section id="v-share">
    <div className="topbar"><button className="iconbtn" onClick={() => { if (shareLeaveOk()) { S.shDraft = { books: {}, snips: {} }; goBack() } }}>← 뒤로</button></div>
    <div className="view-head"><h1>보여줄 것 고르기</h1><p>책마다 👀 책 · 필사를 켜고 끄고, 문장은 하나씩 골라요. <b>저장</b>을 눌러야 바뀌어요.</p></div>
    <input className="field" id="sh-q" type="search" placeholder="책 찾기" value={S.shQ} onChange={e => { S.shQ = e.target.value; emit() }} autoComplete="off" />
    <div className="chips" id="sh-f">{FILTERS.map(f => <button key={f} className={'chip ' + (S.shF === f ? 'on' : '')} onClick={() => { S.shF = f; emit() }}>{FILTER_LABEL[f] || f}</button>)}</div>
    <div id="sh-body">
      <div className="sh-bulk"><span className="small">보이는 {list.length}권 한 번에</span>
        <button className="btn" onClick={() => bulk('공개', true)}>책 모두 👀</button><button className="btn" onClick={() => bulk('공개', false)}>책 모두 🔒</button>
        <button className="btn" onClick={() => bulk('필사공개', true)}>필사 모두 👀</button><button className="btn" onClick={() => bulk('필사공개', false)}>필사 모두 🔒</button></div>
      <div id="sh-list">{list.length ? list.map(b => { const d = shBook(b), sn = snipsOf(b.ID).filter(s => s['유형'] !== '메모'), on = sn.filter(shSnip).length
        return <div className={'sh-row ' + (d['공개'] ? '' : 'off')} key={b.ID}>
          <div className="sh-top"><Spine b={b} /><div className="grow"><div className="tg-bt">{b['제목']}</div><div className="small">{sn.length ? `필사 · 생각 ${sn.length}개 중 ${on}개 보여줌` : '필사 없음'}</div></div></div>
          <div className="sh-tg">
            <button className={'sh-sw ' + (d['공개'] ? 'on' : '')} onClick={() => set(b.ID, '공개', !d['공개'])}>{d['공개'] ? '👀 책 보여줌' : '🔒 책 나만'}</button>
            {sn.length > 0 && <><button className={'sh-sw ' + (d['필사공개'] ? 'on' : '')} onClick={() => set(b.ID, '필사공개', !d['필사공개'])}>{d['필사공개'] ? '👀 필사 모두' : '✋ 필사 고른 것만'}</button>
              <button className="sh-more" onClick={() => { S.shOpen = S.shOpen === b.ID ? null : b.ID; emit() }}>{S.shOpen === b.ID ? '접기' : '문장 고르기 ›'}</button></>}
          </div>
          {S.shOpen === b.ID && <div className="sh-snips">{sortByPage(sn).map(s => <label className="sh-snip" key={s.ID}><input type="checkbox" checked={!!shSnip(s)} onChange={e => snipSet(s.ID, e.target.checked)} />
            <span>{lifeOf(s) > 0 && <><i className="life-st">{'★'.repeat(lifeOf(s))}</i> </>}{sText(s).slice(0, 80)}{sText(s).length > 80 ? '…' : ''}{s['쪽수'] ? <> <em>{pgLabel(s['쪽수'])}</em></> : null}</span></label>)}</div>}
        </div> }) : <div className="empty">책이 없어요</div>}</div>
      <div className="sh-save"><span>{ch ? `바뀐 것 ${ch}개` : '바뀐 것 없음'}</span><button className="btn" onClick={() => { S.shDraft = { books: {}, snips: {} }; emit() }} disabled={!ch}>되돌리기</button><button className="btn primary" onClick={save} disabled={!ch}>저장</button></div>
    </div>
  </section>
}
export { LS }
