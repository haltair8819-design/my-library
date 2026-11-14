/* 같이 쓰기 화면 조각: 프로필 사진 · ♡/한마디 · 책 댓글 · 짝꿍도 읽은 책 */
import { useRef, useState } from 'react'
import { S, sText, starText, type Rec } from '../lib/core'
import { tgName, tgHasPartner, tgProg, tgSpoilOn, tgTheirs, reactsOf, toggleHeart, sendReact, delReact, bcOf, bcSend, bcDel, locTime } from '../lib/together'
import { togetherOn } from '../lib/book'
import { notifyPartner } from '../lib/push'
import { modal, closeModal, toast, errMsg } from '../lib/ui'
import { openPartnerBook } from '../views/Together'

export function Avatar({ name, cls }: { name: unknown; cls?: string }) {
  const T = S.tg || {}, who = cls && cls.split(' ').includes('p') ? (T.partner || {}).id : (T.me || {}).id, url = who && (T.av || {})[who]
  const ini = String(name || '?').trim().slice(0, 1)
  const [bad, setBad] = useState(false)
  if (url && !bad) return <span className={`tg-av ${cls || ''} ph`}><img src={url} alt="" onError={() => setBad(true)} /></span>
  return <span className={`tg-av ${cls || ''}`}>{ini}</span>
}

export function ReactBar({ sid, owner }: { sid: string; owner: string }) {
  const rs = reactsOf(owner, sid), me = (S.tg.me || {}).id
  const hearts = rs.filter(r => r.kind === 'heart'), mine = hearts.find(r => r.user_id === me), n = rs.filter(r => r.kind === 'comment').length
  return <div className="react-bar" onClick={e => e.stopPropagation()}>
    <button className={mine ? 'on' : ''} onClick={() => toggleHeart(sid, owner, notifyPartner)}>{mine ? '♥' : '♡'}{hearts.length ? ' ' + hearts.length : ''}</button>
    <button onClick={() => openReacts(sid, owner)}>💬 {n ? n : '한마디'}</button></div>
}
// 내 문장 아래 작은 줄 (반응이 있을 때만)
export function MyReactLine({ s }: { s: Rec }) {
  if (!togetherOn() || !S.tg || !S.tg.me) return null
  const rs = reactsOf(S.tg.me.id, s.ID).filter(r => r.user_id !== S.tg.me.id || r.kind === 'comment'); if (!rs.length) return null
  const h = rs.filter(r => r.kind === 'heart').length, c = rs.filter(r => r.kind === 'comment').length
  return <div className="react-line" onClick={e => { e.stopPropagation(); openReacts(s.ID, S.tg.me.id) }}>{h ? `♥ ${tgName()}` : ''}{h && c ? ' · ' : ''}{c ? `💬 한마디 ${c}` : ''}</div>
}
function ReactsSheet({ sid, owner }: { sid: string; owner: string }) {
  const me = (S.tg.me || {}).id
  const sn = owner === me ? S.snips.find((x: Rec) => x.ID === sid) : (S.tg.snips || []).find((x: Rec) => x.ID === sid)
  const ref = useRef<HTMLTextAreaElement>(null); const [busy, setBusy] = useState(false)
  if (!sn) return null
  const rs = reactsOf(owner, sid)
  const hearts = rs.filter(r => r.kind === 'heart').map(r => r.user_id === me ? '나' : tgName())
  const cs = rs.filter(r => r.kind === 'comment')
  const send = async () => {
    const body = ref.current!.value.trim(); if (!body) return
    setBusy(true)
    try { await sendReact(sid, owner, body, notifyPartner); ref.current!.value = '' } catch (e) { toast('⚠ ' + errMsg(e)) }
    setBusy(false)
  }
  return <>
    <h3>한마디 <span style={{ fontWeight: 400, color: 'var(--faint)', fontSize: 13 }}>{owner === me ? '내 문장' : tgName() + '의 문장'}</span></h3>
    <div className="rx-quote">{sText(sn).slice(0, 300)}{sText(sn).length > 300 ? '…' : ''}</div>
    <div id="rx-list">
      {hearts.length > 0 && <div className="small" style={{ margin: '8px 0' }}>♥ {hearts.join(', ')}</div>}
      {cs.length ? cs.map(r => <div key={r.id} className={'rx ' + (r.user_id === me ? 'me' : '')}><Avatar name={r.user_id === me ? S.tg.me.name : tgName()} cls={r.user_id === me ? '' : 'p'} />
        <div className="rx-b"><b className="rx-n">{r.user_id === me ? S.tg.me.name : tgName()}</b><div>{r.body}</div><span>{locTime(r.created_at)}{r.user_id === me && <> · <a onClick={() => delReact(r.id)}>지우기</a></>}</span></div></div>)
        : <div className="small" style={{ margin: '10px 0', color: 'var(--faint)' }}>아직 한마디가 없어요</div>}
    </div>
    <div className="inline" style={{ marginTop: 10 }}><textarea ref={ref} className="field" id="rx-in" rows={2} maxLength={1000} placeholder={owner === me ? '답글 남기기' : '이 문장에 한마디'} style={{ flex: 1, minHeight: 44 }} disabled={busy}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
      <button className="btn primary" onClick={send}>보내기</button></div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
export function openReacts(sid: string, owner: string) {
  const me = (S.tg.me || {}).id
  const sn = owner === me ? S.snips.find((x: Rec) => x.ID === sid) : (S.tg.snips || []).find((x: Rec) => x.ID === sid)
  if (!sn) { toast('그 문장을 찾지 못했어요'); return }
  modal(<ReactsSheet sid={sid} owner={owner} />)
}

// 보여준 책에 댓글 (책 주인 · 짝꿍 둘이 주고받기)
export function BookComments({ owner, bid }: { owner: string; bid: string }) {
  const ref = useRef<HTMLTextAreaElement>(null); const [busy, setBusy] = useState(false)
  if (!togetherOn() || !tgHasPartner() || !S.tg.me) return null
  const me = S.tg.me.id, list = bcOf(owner, bid)
  const send = async () => {
    const body = ref.current?.value.trim(); if (!body) return
    setBusy(true)
    try { await bcSend(owner, bid, body, notifyPartner); ref.current!.value = '' } catch (e) { toast('⚠ ' + errMsg(e)) }
    setBusy(false)
  }
  return <div className="panel2 bc-box" id={'bc-' + (owner === me ? 'me' : 'p')}><h4>💬 댓글 <span className="small" style={{ fontWeight: 400 }}>{owner === me ? tgName() + '와 이 책 이야기' : '이 책에 대해 한마디'}</span></h4>
    {list.length ? list.map(c => <div key={c.id} className={'rx ' + (c.user_id === me ? 'me' : '')}><Avatar name={c.user_id === me ? S.tg.me.name : tgName()} cls={c.user_id === me ? '' : 'p'} />
      <div className="rx-b"><b className="rx-n">{c.user_id === me ? S.tg.me.name : tgName()}</b><div>{c.body}</div><span>{locTime(c.created_at)}{c.user_id === me && <> · <a onClick={() => bcDel(c.id)}>지우기</a></>}</span></div></div>)
      : <div className="small" style={{ color: 'var(--faint)' }}>아직 댓글이 없어요</div>}
    <div className="inline" style={{ marginTop: 10 }}><textarea ref={ref} className="field" rows={1} maxLength={2000} placeholder="댓글 남기기" style={{ flex: 1, minHeight: 42 }} disabled={busy}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
      <button className="btn primary" onClick={send}>보내기</button></div></div>
}

// 내 책 화면: 짝꿍도 이 책이 있으면
export function TgAlso({ b }: { b: Rec }) {
  if (!togetherOn() || !tgHasPartner()) return null
  const pb = tgTheirs(b); if (!pb) return null
  const p = tgProg(pb), n = S.tg.snips.filter((s: Rec) => s['책ID'] === pb.ID).length
  const spoil = pb['한줄평'] && tgSpoilOn() && b['상태'] !== '완독'
  return <div className="panel2 tg-also" onClick={() => openPartnerBook(pb.ID)}><Avatar name={tgName()} cls="p" /><div className="grow"><b>{tgName()}</b>{pb['상태'] === '완독' ? '도 다 읽었어요' : pb['상태'] === '읽는중' ? `도 읽는 중${p.cur ? ` · p.${p.cur}${p.total ? ` (${p.pct}%)` : ''}` : ''}` : '도 읽고 싶대요'}
    {(pb['별점'] || pb['한줄평']) && <div className="tg-also-rv">{pb['별점'] ? <span className="stars">{starText(pb['별점'])}</span> : null}{pb['한줄평'] ? (spoil ? <> <span className="small">· 한줄평은 다 읽고 보기 🙈</span></> : <div>“{pb['한줄평']}”</div>) : null}</div>}
    {n ? <div className="small">보여준 문장 {n}개 →</div> : <div className="small">눌러서 보기 →</div>}</div></div>
}
// 별점 · 한줄평 한 줄 (짝꿍 · 나)
export function ReviewRow({ name, cls, b, spoil, onClick }: { name: string; cls: string; b: Rec; spoil?: boolean; onClick?: () => void }) {
  const [open, setOpen] = useState(false)
  if (!b['별점'] && !b['한줄평']) return <div className="tg-rv"><Avatar name={name} cls={cls} /><div className="small">아직 별점 · 한줄평이 없어요</div></div>
  const sp = spoil && !open
  return <div className="tg-rv" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}><Avatar name={name} cls={cls} /><div className="grow"><div><b>{name}</b> {b['별점'] ? <span className="stars">{starText(b['별점'])}</span> : null}</div>
    {b['한줄평'] && <div className={sp ? 'spoil' : ''} onClick={sp ? e => { e.stopPropagation(); setOpen(true) } : undefined}>{sp && <div className="spoil-l">🙈 다 읽고 보면 좋아요 · 눌러서 보기</div>}<div>{b['한줄평']}</div></div>}</div></div>
}
