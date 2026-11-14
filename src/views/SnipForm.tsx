/* 필사 · 내 생각 · 메모 입력 창 — 예전 openSnipForm (임시저장 · 맞춤법 · AI 제목/키워드 · 받아쓰기 · 붙여넣기) */
import { useEffect, useRef, useState } from 'react'
import { S, LS, emit, book, snipsOf, sText, sMemo, isThought, uniq, uid, normKw, platOf, resolveId, MEMO_SEP, type Rec } from '../lib/core'
import { lifeOf, LIFE, togetherOn, isShared, bookSnipShared, call, deleteSnip } from '../lib/book'
import { tgShareNew, tgHasPartner, tgName } from '../lib/together'
import { queue, upsertLocal } from '../lib/store/local'
import { Store } from '../lib/store/server'
import { modal, closeModal, toast, errMsg } from '../lib/ui'
import { $, toggleDictate, startRecording, recSnipDone, stopDictate } from '../lib/voice'
import { deleteMemo } from '../lib/memo'
import { Faint } from '../components/common'

const SNIP_DRAFT_KEY = 'snip_draft_v1'
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
type Vals = { type: string; ttl: string; txt: string; memo: string; page: string; kw: string }
const readDraft = (): (Vals & { key: string; at: number }) | null => { try { return JSON.parse(LS.get(SNIP_DRAFT_KEY) || 'null') } catch { return null } }
const val = (id: string) => ($<HTMLInputElement>(id) || { value: '' }).value

// 갤럭시 텍스트 추출 · 메모 앱에서 온 글: 화면 줄바꿈은 잇고, 문단은 살리고, 끝의 "36p"는 쪽수로
export function cleanShared(meta: Rec) {
  let t = String(meta.text || '').replace(/\r/g, '')
  if (!t.trim()) t = [meta.title, meta.url].filter(Boolean).join('\n')
  let page = ''
  const m = t.match(/\n?\s*(\d{1,4}(?:\s*[,~-]\s*\d{1,4})?)\s*p\.?\s*$/i)
  if (m) { page = m[1].replace(/\s*[~-]\s*/, ', ').replace(/\s*,\s*/, ', '); t = t.slice(0, m.index) }
  const raw = t.trim()
  t = t.split(/\n\s*\n/).map(par => par.split('\n').map(x => x.trim()).filter(Boolean)
    .reduce((a, l) => !a ? l : /[A-Za-z]-$/.test(a) ? a.slice(0, -1) + l : a + ' ' + l, '')).filter(Boolean).join('\n\n')
  return { text: t.trim(), page, raw: /\n/.test(raw) ? raw : '' }
}

/* ----- AI 제목 ----- */
export async function aiTitle(btn: HTMLButtonElement | null, auto?: boolean, raw?: string) {
  const text = val('f-txt').trim()
  if (!text) { if (!auto) toast('내용을 먼저 입력해 주세요'); return }
  if (btn) { btn.disabled = true; btn.textContent = '짓는 중…' }
  try {
    const r = await Store.run('suggestTitle', { '책ID': S.bookId, '내용': text, raw: raw || '' })
    const ttl = $('f-ttl'), txt = $<HTMLTextAreaElement>('f-txt'); if (!ttl || !txt) return
    // 줄바꿈 정리본: 띄어쓰기만 달라졌을 때만 바꿔 넣음 (글자는 절대 안 바뀌게)
    const noWs = (x: unknown) => String(x || '').replace(/\s+/g, '')
    if (raw && r.text && noWs(r.text) === noWs(raw) && txt.value.trim() === text) txt.value = r.text.trim()
    if (r.title && (!auto || !ttl.value.trim())) ttl.value = r.title
    const kw = $('f-kw')
    if (kw && r.keywords && r.keywords.length) {
      const cur = kw.value.split(',').map(x => x.trim()).filter(Boolean)
      r.keywords.forEach((k: string) => { if (!cur.includes(k)) cur.push(k) }); kw.value = cur.join(', ')
    }
    txt.dispatchEvent(new Event('input', { bubbles: true }))
  } catch (e) { if (!auto) toast('⚠ ' + errMsg(e)) } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'AI 제목' } }
}
async function aiKeywords(btn: HTMLButtonElement) {
  const text = val('f-txt').trim()
  if (!text) { toast('내용을 먼저 입력해 주세요'); return }
  btn.disabled = true; btn.textContent = '추천 중…'
  try {
    const ks = await call('suggestKeywords', { '책ID': S.bookId, '제목': val('f-ttl'), '내용': text })
    const kw = $('f-kw'); if (!kw) return
    const cur = kw.value.split(',').map(x => x.trim()).filter(Boolean)
    ks.forEach((k: string) => { if (!cur.includes(k)) cur.push(k) })
    kw.value = cur.join(', ')
    if (!ks.length) toast('추천할 키워드를 찾지 못했어요')
  } catch { /* call이 알려 줘요 */ } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'AI 추천' } }
}
// 복사한 글 붙여넣기 (갤럭시 텍스트 추출 → 복사 → 여기 붙여넣기)
function fillPasted(txt0: string) {
  const c = cleanShared({ text: txt0 })
  const ta = $<HTMLTextAreaElement>('f-txt'); if (!ta || !c.text) return
  if (!ta.value.trim()) ta.value = c.text
  else { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + c.text + ta.value.slice(b) }
  const pg = $('f-page'); if (c.page && pg && !pg.value.trim()) pg.value = c.page
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  const btn = document.querySelector<HTMLButtonElement>('[data-ai-title]')
  if (btn && navigator.onLine && !val('f-ttl').trim() && ta.value.trim() === c.text) aiTitle(btn, true, c.raw)
}
async function pasteClip() {
  try {
    const txt = await navigator.clipboard.readText()
    if (!txt.trim()) { toast('복사한 글이 없어요'); return }
    fillPasted(txt)
  } catch { $('f-txt')?.focus(); toast('내용 칸을 길게 눌러 붙여넣기 해 주세요') }
}

export type SnipPrefill = { text?: string; page?: string; type?: string; raw?: string; ai?: boolean; moveMemoId?: string }
function SnipForm({ id0, forceType, prefill }: { id0: string | null; forceType?: string; prefill?: SnipPrefill }) {
  const id = id0 ? resolveId(id0) : null
  const s: Rec | undefined = id ? S.snips.find((x: Rec) => x.ID === id) : undefined
  const b = book(S.bookId) || {}
  const [type, setType] = useState<string>(prefill?.type || (s ? (s['유형'] === '서평' ? '생각' : (s['유형'] || '인용')) : (forceType || (S.bookTab === '생각' ? '생각' : '인용'))))
  const [life, setLife] = useState(lifeOf(s))
  const [memoOpen, setMemoOpen] = useState(!!(s && sMemo(s)))
  const [draftNote, setDraftNote] = useState<{ label: string; orig: Vals } | null>(null)
  const [draftState, setDraftState] = useState('')
  const [spell, setSpell] = useState<{ busy?: boolean; err?: string; list?: Rec[] } | null>(null)
  const st = useRef({ on: true, key: s ? 'id:' + s.ID : 'new:' + S.bookId, base: null as Vals | null, t: 0, type })
  st.current.type = type
  const allKw = uniq<string>(S.snips.flatMap((x: Rec) => String(x['키워드'] || '').split(',').map(k => k.trim())))
  const bookKw = uniq<string>(snipsOf(b.ID).flatMap(x => String(x['키워드'] || '').split(',').map(k => k.trim())))
  const kwSuggest = uniq([...bookKw, ...allKw]).slice(0, 14)
  const eb = platOf(b) === 'E북'
  const values = (): Vals => ({ type: st.current.type, ttl: val('f-ttl'), txt: val('f-txt'), memo: val('f-memo'), page: val('f-page'), kw: val('f-kw') })
  const fill = (v: Vals) => {
    const set = (k: string, x: string) => { const el = $(k); if (el) el.value = x || '' }
    set('f-ttl', v.ttl); set('f-txt', v.txt); set('f-page', v.page); set('f-kw', v.kw); set('f-memo', v.memo)
    setMemoOpen(!!v.memo); if (v.type) setType(v.type)
  }
  const saveDraft = () => {
    if (!st.current.on || !$('f-txt')) return
    const v = values(), base = st.current.base || ({} as Vals)
    const same = (['type', 'ttl', 'txt', 'memo', 'page', 'kw'] as const).every(k => String(v[k] || '') === String(base[k] || ''))
    if (same || (!v.txt.trim() && !v.ttl.trim())) { LS.del(SNIP_DRAFT_KEY); return }
    LS.set(SNIP_DRAFT_KEY, JSON.stringify(Object.assign({ key: st.current.key, at: Date.now() }, v)))
    setDraftState('임시저장 ' + hhmm())
  }
  const soon = () => { clearTimeout(st.current.t); st.current.t = window.setTimeout(saveDraft, 500) }
  const clearDraft = () => { LS.del(SNIP_DRAFT_KEY); st.current.on = false; clearTimeout(st.current.t) }
  useEffect(() => {
    // 창이 닫혀도 쓰던 내용이 남게
    S.snipFormClose = () => { saveDraft(); stopDictate() }
    if (prefill?.text != null) { const t = $('f-txt'); if (t) t.value = prefill.text }
    if (prefill?.page) { const p = $('f-page'); if (p) p.value = prefill.page }
    st.current.base = values()
    const d = readDraft()
    if (!prefill && d && d.key === st.current.key && (d.txt || d.ttl)) {
      const orig = st.current.base
      fill(d)
      const when = new Date(d.at); const label = (when.toDateString() === new Date().toDateString() ? '' : (when.getMonth() + 1) + '/' + when.getDate() + ' ') + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')
      setDraftNote({ label, orig })
    }
    setTimeout(() => { const el = s ? $('f-txt') : $('f-ttl'); if (el) el.focus() }, 50)
    if (prefill?.ai && navigator.onLine) { const btn = document.querySelector<HTMLButtonElement>('[data-ai-title]'); if (btn) aiTitle(btn, true, prefill.raw) }
    return () => { S.snipFormClose = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { soon() }, [type, life]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (keepOpen: boolean | 'stay') => {
    const stay = keepOpen === 'stay'
    const memoV = memoOpen ? val('f-memo').trim() : ''
    const txt = val('f-txt').trim()
    const data: Rec = { ID: id || ('T' + uid()), '책ID': S.bookId, '유형': type, '내용': txt + (txt && memoV ? MEMO_SEP + memoV : ''),
      '쪽수': val('f-page').trim().replace(/\s*p$/i, ''), '제목': val('f-ttl').trim(), '키워드': normKw(val('f-kw')) }
    const share = $('f-share'); if (share) data['공개'] = (share as HTMLInputElement).checked && type !== '메모'
    data['인생'] = life || ''
    if (!data['내용']) { toast('내용을 입력해 주세요'); return }
    const prev = S.snips.find((x: Rec) => x.ID === data.ID)
    const local = Object.assign({ '출처': '직접입력', '작성일': S.today }, prev || {}, data, { '책제목': b['제목'] || '' })
    upsertLocal('snips', local)
    queue({ fn: 'saveSnippet', data, local })
    if (prefill?.moveMemoId) { deleteMemo(prefill.moveMemoId); toast('메모를 필사로 옮겼어요') } else toast(stay ? '중간 저장했어요 · 계속 쓰세요' : '저장했어요')
    clearDraft()
    emit()
    if (stay) {
      if (!id) {   // 새 문장 → 이제부터는 이 문장을 고치는 창으로
        const pos = ($<HTMLTextAreaElement>('f-txt')?.selectionStart) || 0
        openSnipForm(data.ID)
        setTimeout(() => { const t = $<HTMLTextAreaElement>('f-txt'); if (t) { t.focus(); t.setSelectionRange(pos, pos) } }, 60)
      } else { st.current.on = true; st.current.base = values(); setDraftState('저장됨 ' + hhmm()) }
    } else if (keepOpen) { flashSnip(data.ID); openSnipForm(null) } else { closeModal(); if (!id) flashSnip(data.ID) }
  }
  const remove = () => {
    if (!s || !confirm('이 문장을 삭제할까요?')) return
    clearDraft(); deleteSnip(s.ID)
    closeModal(); toast('삭제했어요')
  }
  const runSpell = async () => {
    const txt = val('f-txt').trim(), memo = val('f-memo').trim(), ttl = val('f-ttl').trim()
    if (!txt && !memo) { toast('내용을 먼저 적어 주세요'); return }
    setSpell({ busy: true })
    try {
      const r = await Store.run('noteAssist', { mode: 'spell', '제목': ttl, '본문': [txt, memo].filter(Boolean).join('\n\n') })
      setSpell({ list: (r.fixes || []).filter((f: Rec) => f && f.from && f.to && f.from !== f.to && ['f-ttl', 'f-txt', 'f-memo'].some(k => val(k).includes(f.from))) })
    } catch (e) { setSpell({ err: errMsg(e) }) }
  }
  const applySpell = (i: number) => {
    const list = spell?.list || [], picks = i < 0 ? list.slice() : [list[i]]
    let n = 0
    picks.forEach(f => { for (const k of ['f-txt', 'f-memo', 'f-ttl']) { const el = $(k); if (el && el.value.includes(f.from)) { el.value = el.value.replace(f.from, f.to); n++; break } } })
    setSpell({ list: i < 0 ? [] : list.filter((_, j) => j !== i) })
    soon(); toast(n ? `${n}곳을 고쳤어요` : '이미 바뀌어 있어요')
  }
  const title = s ? (s['유형'] === '메모' ? '메모 고치기' : isThought(s) ? '내 생각 고치기' : '문장 수정') : type === '생각' ? '내 생각 쓰기' : type === '메모' ? '메모 쓰기' : '필사 추가'
  return <div onInput={soon}>
    <h3>{title} <span style={{ fontWeight: 400, color: 'var(--faint)', fontSize: 13 }}>{b['제목']}</span><span className="draft-state" id="draft-state">{draftState}</span></h3>
    <div id="draft-note">{draftNote && <div className="draft-note"><span>✎ {draftNote.label}에 쓰던 내용을 불러왔어요</span><button type="button" onClick={() => { fill(draftNote.orig); LS.del(SNIP_DRAFT_KEY); setDraftNote(null); toast(s ? '저장된 내용으로 되돌렸어요' : '임시저장을 지웠어요') }}>{s ? '원래대로' : '지우기'}</button></div>}</div>
    <div className="seg" id="seg">{['인용', '생각', '메모'].map(t => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === '인용' ? '필사' : t === '생각' ? '내 생각' : '메모'}</button>)}</div>
    <label>제목 <Faint>내가 붙이는 표제</Faint><button type="button" className="kw-ai" data-ai-title onClick={e => aiTitle(e.currentTarget)}>AI 제목</button></label>
    <input className="field" id="f-ttl" defaultValue={s ? s['제목'] : ''} placeholder="예: 과학은 믿음을 싫어한다" />
    <label>내용</label>
    <div className="ftools"><button type="button" className="ftool" onClick={e => toggleDictate(e.currentTarget, 'f-txt')}>🎤 받아쓰기</button>
      <button type="button" className="ftool" onClick={() => startRecording('snip', recSnipDone)}>🎙 읽어서 넣기</button>
      <button type="button" className="ftool" onClick={pasteClip}>📋 붙여넣기</button>
      <button type="button" className="ftool" disabled={spell?.busy} onClick={runSpell}>✓ 맞춤법</button></div>
    <div id="spell-out">{spell && <div className="spell-box">
      {spell.busy ? <><span className="spin" /> 맞춤법을 살펴보는 중…</> : spell.err ? <>⚠ {spell.err}</>
        : spell.list && spell.list.length ? <><div className="sp-head"><b>고칠 곳 {spell.list.length}개</b><span><button type="button" onClick={() => applySpell(-1)}>모두 바꾸기</button> · <button type="button" onClick={() => setSpell(null)}>닫기</button></span></div>
          {spell.list.map((f, i) => <div className="fix" key={i}><div><s>{f.from}</s> → <b>{f.to}</b>{f.why && <div className="small">{f.why}</div>}</div><button type="button" className="btn" onClick={() => applySpell(i)}>바꾸기</button></div>)}</>
        : <div className="sp-head"><span>맞춤법에서 눈에 띄는 곳이 없어요 👍</span><button type="button" onClick={() => setSpell(null)}>닫기</button></div>}
    </div>}</div>
    <textarea className="field" id="f-txt" placeholder="책 속 문장이나 생각을 적어 주세요" defaultValue={s ? sText(s) : ''}
      onPaste={e => { const txt = e.clipboardData.getData('text'); if (!txt || !/\n/.test(txt)) return; e.preventDefault(); fillPasted(txt) }} />
    <div id="memo-wrap" className={memoOpen ? '' : 'hidden'}><label>메모 <Faint>이 문장에 덧붙이는 내 메모</Faint></label>
      <textarea className="field" id="f-memo" style={{ minHeight: 70 }} placeholder="떠오른 것, 찾아볼 것, 연결되는 생각" defaultValue={s ? sMemo(s) : ''} /></div>
    {/* ＋ 메모 달기는 필사에서만 (내 생각 · 메모는 그 자체가 내 글이라) */}
    <button type="button" className={'kw-ai ' + (type !== '인용' || memoOpen ? 'hidden' : '')} id="memo-add" style={{ padding: '6px 0 0' }} onClick={() => { setMemoOpen(true); setTimeout(() => $('f-memo')?.focus(), 30) }}>＋ 메모 달기</button>
    <label>{eb ? '쪽수 · 위치' : '쪽수'} <Faint>{eb ? 'E북은 45%처럼 % 로 적어도 돼요' : '여러 쪽이면 36, 37'}</Faint></label>
    <div className="inline" style={{ maxWidth: 240 }}><input className="field" id="f-page" inputMode="decimal" style={{ flex: 1 }} placeholder={eb ? '45% 또는 쪽수' : ''} defaultValue={s ? s['쪽수'] : ''} />
      {eb && <button type="button" className="btn pct-btn" title="%로 넣기" onClick={() => { const f = $('f-page'); if (!f) return; const v = f.value.trim(); f.value = /%$/.test(v) ? v.replace(/%/g, '') : v.replace(/%/g, '') + '%'; f.focus() }}>%</button>}</div>
    <label>인생 문장 <Faint>눌러서 단계 고르기 · 한 번 더 누르면 해제</Faint></label>
    <div className="life-pick" id="life-pick">{[1, 2, 3].map(n => <button type="button" key={n} className={life >= n ? 'on' : ''} aria-label={LIFE[n]} onClick={() => setLife(life === n ? 0 : n)}>★</button>)}
      <span id="life-lb">{life ? LIFE[life] : '고르지 않음'}</span></div>
    <label>키워드 <Faint>쉼표로 구분</Faint><button type="button" className="kw-ai" onClick={e => aiKeywords(e.currentTarget)}>AI 추천</button></label>
    <input className="field" id="f-kw" defaultValue={s ? s['키워드'] : ''} placeholder="예: 자유, 사랑" />
    {kwSuggest.length > 0 && <div className="suggest">{kwSuggest.map(k => <button key={k} className="chip" onClick={() => { const el = $('f-kw')!; const cur = el.value.split(',').map(x => x.trim()).filter(Boolean); if (!cur.includes(k)) cur.push(k); el.value = cur.join(', '); soon() }}>#{k}</button>)}</div>}
    {togetherOn() && <label className={'tg-check ' + (type === '메모' ? 'hidden' : '')} id="f-share-w"><input type="checkbox" id="f-share" defaultChecked={s ? isShared(s) : (tgShareNew() || bookSnipShared(b))} /> 👀 {tgHasPartner() ? tgName() + '에게 ' : '짝꿍에게 '}보여주기</label>}
    <div className="actions">
      {s && <button className="btn danger" onClick={remove}>삭제</button>}
      <button className="btn" onClick={closeModal}>취소</button>
      <button className="btn grow" style={{ whiteSpace: 'nowrap' }} onClick={() => submit('stay')} title="창을 닫지 않고 저장">중간 저장</button>
      {!s && <button className="btn grow" style={{ whiteSpace: 'nowrap' }} onClick={() => submit(true)}>저장·다음</button>}
      <button className="btn primary grow" onClick={() => submit(false)}>저장</button>
    </div>
  </div>
}
export function openSnipForm(id: string | null, forceType?: string, prefill?: SnipPrefill) {
  if (!book(S.bookId)) return
  modal(<SnipForm key={'sf' + Date.now()} id0={id} forceType={forceType} prefill={prefill} />, { onClose: () => { if (S.snipFormClose) S.snipFormClose() } })
}
export function flashSnip(id: string) {
  setTimeout(() => {
    const el = document.getElementById('s-' + resolveId(id)); if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200)
  }, 80)
}
