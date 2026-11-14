/* 업데이트 해줘요! (v2.13.2 · v2.14.4) — 바꾸고 싶은 걸 모아 두었다가 한 번에 복사 → Claude에 붙여넣기
 * 앱 쓰는 사람 모두가 같은 목록(update_reqs 표)을 봐요. 보낸 뒤 새 버전이 나오면 자동으로 '반영됨' */
import { useRef } from 'react'
import { S, LS, emit, type Rec } from '../lib/core'
import { sb, sbUid, sbSession } from '../lib/supabase'
import { sbq, Store } from '../lib/store/server'
import { saveCache } from '../lib/store/local'
import { APP_VERSION } from '../lib/patchNotes'
import { go, goBack } from '../lib/nav'
import { modal, closeModal, toast, errMsg } from '../lib/ui'

const REQ_KEY = 'update_reqs_v1', REQ_SH = 'update_reqs_shared_v1'
const COLS = 'id, user_id, who, body, created_at, copied_at, copied_ver, done_at, done_ver, auto'
S.reqRows = (() => { try { return JSON.parse(LS.get(REQ_SH) || 'null') || [] } catch { return [] } })()
// 예전 앱(혼자 쓰던 방식)에 남아 있던 목록
function reqLocal(): Rec {
  const st = (S.settings || {}).updReq
  if (st && Array.isArray(st.items)) return st
  try { return JSON.parse(LS.get(REQ_KEY) || 'null') || { items: [], log: [] } } catch { return { items: [], log: [] } }
}
const reqMyName = () => (S.tg && S.tg.me && S.tg.me.name) || String((sbSession() || { user: {} as Rec }).user.email || '').split('@')[0] || '나'
const reqDay = (t: string) => { const d = new Date(t); return isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` }
const reqTime = (t: string) => { const d = new Date(t); return isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function reqData(): Rec {
  const rows: Rec[] = S.reqRows || [], me = sbUid()
  const toIt = (r: Rec) => ({ id: r.id, text: r.body, at: r.created_at, who: r.who || '', mine: r.user_id === me, copiedAt: r.copied_at || '', copiedVer: r.copied_ver || '' })
  const items = rows.filter(r => !r.done_at).sort((a, b) => a.created_at < b.created_at ? -1 : 1).map(toIt)
  const cp = items.filter(x => x.copiedAt).sort((a, b) => a.copiedAt < b.copiedAt ? 1 : -1)[0]
  const g: Record<string, Rec> = {}
  rows.filter(r => r.done_at).forEach(r => { const k = r.done_ver + '|' + reqDay(r.done_at)
    ;(g[k] = g[k] || { at: r.done_at, ver: r.done_ver, auto: r.auto, items: [] }).items.push(toIt(r))
    if (r.done_at > g[k].at) g[k].at = r.done_at })
  const log = Object.values(g).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 30)
  log.forEach(l => l.items.sort((a: Rec, b: Rec) => a.at < b.at ? -1 : 1))
  return { items, log, copiedAt: cp ? cp.copiedAt : '', copiedVer: cp ? cp.copiedVer : '' }
}
async function reqLoad() {
  try { const rows = await sbq(sb.from('update_reqs').select(COLS).order('created_at', { ascending: false }).limit(500)); S.reqRows = rows || []; LS.set(REQ_SH, JSON.stringify(S.reqRows)) } catch { /* 저장본으로 */ }
}
const reqErr = (e: unknown) => toast('⚠ ' + errMsg(e))
export function openReqView() { go('req'); reqLoad().then(emit) }
export function reqRowSub() { const d = reqData(), n = (d.items || []).length; return n ? `대기 중 ${n}개${d.copiedVer && d.copiedVer !== APP_VERSION ? ' · 새 버전 나옴' : ''}` : '바꾸고 싶은 걸 적어 두고 한 번에 복사' }
const reqVerGt = (a: string, b: string) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q } return false }

export function ReqView() {
  const ref = useRef<HTMLTextAreaElement>(null)
  const d = reqData(), items: Rec[] = d.items || [], last = (d.log || [])[0]
  const newVer = d.copiedVer && d.copiedVer !== APP_VERSION && items.length
  const add = async () => {
    const t = ref.current!, v = t.value.trim(); if (!v) return
    try { const r = await sbq(sb.from('update_reqs').insert({ who: reqMyName(), body: v }).select(COLS).single()); S.reqRows = [r, ...(S.reqRows || [])]; LS.set(REQ_SH, JSON.stringify(S.reqRows)) } catch (e) { reqErr(e); return }
    t.value = ''; emit(); setTimeout(() => ref.current?.focus(), 30)
  }
  const edit = async (it: Rec) => {
    if (!it.mine) return
    const v = prompt('고치기', it.text); if (v == null) return
    if (!v.trim()) { del(it); return }
    try { await sbq(sb.from('update_reqs').update({ body: v.trim() }).eq('id', it.id)); await reqLoad() } catch (e) { reqErr(e) }
    emit()
  }
  const del = async (it: Rec) => {
    if (!it.mine) return
    try { await sbq(sb.from('update_reqs').delete().eq('id', it.id)); S.reqRows = S.reqRows.filter((r: Rec) => r.id !== it.id); LS.set(REQ_SH, JSON.stringify(S.reqRows)) } catch (e) { reqErr(e) }
    emit()
  }
  const copy = async () => {
    await reqLoad()
    const dd = reqData(), many = new Set(dd.items.map((x: Rec) => x.who)).size > 1
    const text = `나의 서재 앱 업데이트 요청 (지금 v${APP_VERSION} · ${S.today})\n${dd.items.map((x: Rec, i: number) => `${i + 1}. ${x.text}${many && x.who ? ` (${x.who})` : ''}`).join('\n')}\n\n업데이트해줘`
    try { await navigator.clipboard.writeText(text); toast('복사했어요 · Claude 대화창에 붙여넣으세요') }
    catch { modal(<><h3>복사해서 쓰세요</h3><textarea className="field" style={{ minHeight: 200 }} defaultValue={text} onFocus={e => e.target.select()} /><div className="actions"><button className="btn primary grow" onClick={closeModal}>닫기</button></div></>) }
    try { await sbq(sb.rpc('req_mark_copied', { ids: dd.items.map((x: Rec) => x.id), ver: APP_VERSION })); await reqLoad() } catch { /* 무시 */ }
    emit()
  }
  const done = async () => {
    if (!items.length) return
    if (!confirm(`${items.length}개가 반영됐나요? 오늘 날짜(v${APP_VERSION})로 기록하고 목록을 비울게요.\n(모두의 목록에서 함께 비워져요)`)) return
    try { await sbq(sb.rpc('req_mark_done', { ids: items.map(x => x.id), ver: APP_VERSION, is_auto: false })); await reqLoad() } catch (e) { reqErr(e); return }
    emit(); toast('기록했어요 · 다음 요청을 적어 보세요')
  }
  return <section id="v-req">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 설정</button></div>
    <div className="view-head"><h1>업데이트 해줘요!</h1><p>바꾸고 싶은 걸 생각날 때마다 적어 두고, 모아서 한 번에 Claude에게 보내요. <b>앱 쓰는 사람 모두가 같이 보는 목록</b>이에요.</p></div>
    <div className="panel2 req-st">{items.length ? <><b>대기 중 {items.length}개</b>{d.copiedAt ? ` · ${reqTime(d.copiedAt)}에 복사함` : ' · 아직 안 보냄'}</> : <b>대기 중인 요청이 없어요</b>}
      {last && <div className="small" style={{ marginTop: 4 }}>마지막 업데이트: {reqDay(last.at)} · v{last.ver} · {last.items.length}개 반영</div>}
      {newVer ? <div className="notice" style={{ marginTop: 8 }}>새 버전 v{APP_VERSION}이 나왔어요. 잠시 뒤 자동으로 반영됨으로 기록해요.</div> : d.copiedAt && items.length ? <div className="small" style={{ marginTop: 4 }}>복사해서 보냈으면, 새 버전이 나올 때 자동으로 ‘반영됨’으로 기록하고 비워요.</div> : null}</div>
    <div className="req-add"><textarea ref={ref} className="field" id="req-in" rows={2} placeholder="예: 메모도 꾹 눌러서 여러 개 고르기" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); add() } }} />
      <button className="btn primary" onClick={add}>추가</button></div>
    <div className="req-list">{items.length ? items.map((it, i) => <div className="req-it" key={it.id}><span className="req-n">{i + 1}</span><div className="grow" onClick={() => edit(it)} style={it.mine ? undefined : { cursor: 'default' }}>{it.text}<div className="small">{it.who && <><b>{it.who}</b> · </>}{reqTime(it.at)}{it.copiedAt ? ' · 보냄' : ''}</div></div>
      {it.mine && <button className="req-x" onClick={() => del(it)} aria-label="지우기">✕</button>}</div>) : <div className="empty" style={{ padding: '24px 0' }}>위 칸에 적어 보세요</div>}</div>
    {items.length > 0 && <><div className="actions" style={{ marginTop: 12 }}><button className="btn primary grow" onClick={copy}>📋 전체 복사 (Claude에 붙여넣기)</button></div>
      <div className="actions"><button className="btn grow" onClick={done}>✅ 지금 반영됨으로 기록하고 비우기</button></div></>}
    {(d.log || []).length > 0 && <><div className="sec-head tight"><h2>지난 업데이트</h2></div>{d.log.map((l: Rec, i: number) => <details className="req-log" key={i}><summary>{reqDay(l.at)} · v{l.ver} · {l.items.length}개{l.auto ? ' · 자동' : ''}</summary>
      <ol>{l.items.map((x: Rec) => <li key={x.id}>{x.text}{x.who && <> <span className="small">— {x.who}</span></>}</li>)}</ol></details>)}</>}
  </section>
}

// 시작할 때: 모두의 목록 받아 오기 · 예전 내 목록 옮기기 · 보낸 뒤 새 버전이 나왔으면 자동으로 '반영됨'
export async function reqStartup() {
  await new Promise(r => setTimeout(r, 2500))   // 서버 설정을 받아 온 뒤에
  await reqLoad()
  const old = reqLocal(), moved = (S.settings || {}).updReqMoved || LS.get('upd_req_moved_v1')
  if (!moved && ((old.items || []).length || (old.log || []).length)) {
    const who = reqMyName(), rows: Rec[] = []
    ;(old.items || []).forEach((x: Rec) => rows.push({ who, body: x.text, created_at: x.at || new Date().toISOString(),
      copied_at: old.copiedAt || null, copied_ver: old.copiedAt && (!x.at || x.at <= old.copiedAt) ? old.copiedVer || null : null }))
    ;(old.log || []).forEach((l: Rec) => (l.items || []).forEach((x: Rec) => rows.push({ who, body: x.text, created_at: x.at || l.at, done_at: l.at, done_ver: l.ver, auto: !!l.auto })))
    try {
      if (rows.length) await sbq(sb.from('update_reqs').insert(rows))
      LS.set('upd_req_moved_v1', '1'); S.settings = Object.assign({}, S.settings, { updReqMoved: true })
      try { await Store.run('saveSettings', { updReqMoved: true }); saveCache() } catch { /* 무시 */ }
      await reqLoad()
    } catch { /* 다음에 */ }
  }
  const sent = reqData().items.filter((x: Rec) => x.copiedVer && reqVerGt(APP_VERSION, x.copiedVer))
  if (sent.length) {
    try { await sbq(sb.rpc('req_mark_done', { ids: sent.map((x: Rec) => x.id), ver: APP_VERSION, is_auto: true })); await reqLoad()
      toast(`업데이트 요청 ${sent.length}개를 v${APP_VERSION} 반영으로 기록했어요`) } catch { /* 무시 */ }
  }
  emit()
}
