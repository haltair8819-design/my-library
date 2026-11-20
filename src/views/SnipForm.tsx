/* 필사 · 내 생각 · 메모 입력 창 — 예전 openSnipForm (임시저장 · 맞춤법 · AI 제목/키워드 · 받아쓰기 · 붙여넣기) */
import { useEffect, useRef, useState } from 'react'
import { S, LS, emit, book, snipsOf, sText, sMemo, uniq, uid, normKw, platOf, resolveId, pgLabel, MEMO_SEP, type Rec } from '../lib/core'
import { lifeOf, LIFE, togetherOn, isShared, bookSnipShared, call, deleteSnip } from '../lib/book'
import { tgShareNew, tgHasPartner, tgName } from '../lib/together'
import { queue, upsertLocal } from '../lib/store/local'
import { Store } from '../lib/store/server'
import { modal, closeModal, toast, errMsg } from '../lib/ui'
import { $, toggleDictate, startRecording, recSnipDone, stopDictate } from '../lib/voice'
import { deleteMemo } from '../lib/memo'

const SNIP_DRAFT_KEY = 'snip_draft_v1'
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
// 글자 크기 (필사 · 노트 쓰기 화면 같이): 16 · 18 · 20
export const ED_FS = [16, 18, 20]
export const edFont = () => { const n = Number(LS.get('ed_fs')); return ED_FS.includes(n) ? n : 18 }
export function nextEdFont() { const i = ED_FS.indexOf(edFont()); const n = ED_FS[(i + 1) % ED_FS.length]; LS.set('ed_fs', String(n)); return n }
const grow = (el: HTMLTextAreaElement | null, min = 0) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.max(min, el.scrollHeight + 2) + 'px' }
// 키보드가 올라오면 그 위에 도구 줄을 붙이기 (안드로이드 크롬은 키보드가 화면을 덮어요)
export function useKbOffset() {
  const [off, setOff] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return
    const f = () => setOff(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    vv.addEventListener('resize', f); vv.addEventListener('scroll', f); f()
    return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f) }
  }, [])
  return off
}
export const IcBack = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
export const IcDown = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>

/* v3.1: 화면 전체를 쓰는 글쓰기 — 쓰는 대로 저장(저장 버튼 없음) · 제목 아래 속성 한 줄 · 키보드 위 도구 줄 */
function SnipForm({ id0, forceType, prefill }: { id0: string | null; forceType?: string; prefill?: SnipPrefill }) {
  const id = id0 ? resolveId(id0) : null
  const s: Rec | undefined = id ? S.snips.find((x: Rec) => x.ID === id) : undefined
  const b = book(S.bookId) || {}
  const [type, setType] = useState<string>(prefill?.type || (s ? (s['유형'] === '서평' ? '생각' : (s['유형'] || '인용')) : (forceType || (S.bookTab === '생각' ? '생각' : '인용'))))
  const [life, setLife] = useState(lifeOf(s))
  const [memoOpen, setMemoOpen] = useState(!!(s && sMemo(s)))
  const [propsOpen, setPropsOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [fs, setFs] = useState(edFont())
  const [pv, setPv] = useState({ page: s ? String(s['쪽수'] ?? '') : (prefill?.page || ''), kw: s ? String(s['키워드'] || '') : '', share: s ? isShared(s) : (tgShareNew() || bookSnipShared(b)) })
  const [draftNote, setDraftNote] = useState<{ label: string; orig: Vals } | null>(null)
  const [saved, setSaved] = useState<{ t: string; cls?: string }>(s ? { t: '저장됨', cls: 'ok' } : { t: '' })
  const [spell, setSpell] = useState<{ busy?: boolean; err?: string; list?: Rec[] } | null>(null)
  const kb = useKbOffset()
  const st = useRef({ on: true, key: s ? 'id:' + s.ID : 'new:' + S.bookId, base: null as Vals | null, t: 0, type, life, id: id || ('T' + uid()), made: !!s, last: '', dead: false, memoMoved: false })
  st.current.type = type; st.current.life = life
  const allKw = uniq<string>(S.snips.flatMap((x: Rec) => String(x['키워드'] || '').split(',').map(k => k.trim())))
  const bookKw = uniq<string>(snipsOf(b.ID).flatMap(x => String(x['키워드'] || '').split(',').map(k => k.trim())))
  const kwSuggest = uniq([...bookKw, ...allKw]).slice(0, 14)
  const eb = platOf(b) === 'E북'
  const values = (): Vals => ({ type: st.current.type, ttl: val('f-ttl'), txt: val('f-txt'), memo: val('f-memo'), page: val('f-page'), kw: val('f-kw') })
  const readPv = () => setPv({ page: val('f-page'), kw: val('f-kw'), share: !!($<HTMLInputElement>('f-share')?.checked) })
  const fill = (v: Vals) => {
    const set = (k: string, x: string) => { const el = $(k); if (el) el.value = x || '' }
    set('f-ttl', v.ttl); set('f-txt', v.txt); set('f-page', v.page); set('f-kw', v.kw); set('f-memo', v.memo)
    setMemoOpen(!!v.memo); if (v.type) setType(v.type); readPv()
    setTimeout(() => { grow($<HTMLTextAreaElement>('f-ttl')); grow($<HTMLTextAreaElement>('f-txt'), 220); grow($<HTMLTextAreaElement>('f-memo'), 60) }, 0)
  }
  const saveDraft = () => {
    if (!st.current.on || !$('f-txt')) return
    const v = values(), base = st.current.base || ({} as Vals)
    const same = (['type', 'ttl', 'txt', 'memo', 'page', 'kw'] as const).every(k => String(v[k] || '') === String(base[k] || ''))
    if (same || (!v.txt.trim() && !v.ttl.trim())) { LS.del(SNIP_DRAFT_KEY); return }
    LS.set(SNIP_DRAFT_KEY, JSON.stringify(Object.assign({ key: st.current.key, at: Date.now() }, v)))
  }
  // 저장: 내용이 있으면 바로 기기에 저장 → 뒤에서 서버로 (같은 문장은 계속 같은 ID로 덮어써요)
  const buildData = (): Rec | null => {
    const memoV = $('f-memo') && !$('memo-wrap')?.classList.contains('hidden') ? val('f-memo').trim() : ''
    const txt = val('f-txt').trim()
    const t = st.current.type
    if (!txt) return null
    const rid = resolveId(st.current.id)
    const data: Rec = { ID: rid, '책ID': S.bookId, '유형': t, '내용': txt + (memoV ? MEMO_SEP + memoV : ''),
      '쪽수': val('f-page').trim().replace(/\s*p$/i, ''), '제목': val('f-ttl').trim(), '키워드': normKw(val('f-kw')) }
    const share = $<HTMLInputElement>('f-share'); if (share) data['공개'] = share.checked && t !== '메모'
    data['인생'] = st.current.life || ''
    return data
  }
  const commit = (): boolean => {
    if (st.current.dead || !$('f-txt')) return false
    const data = buildData(); if (!data) return false
    const rid = data.ID
    const sig = JSON.stringify(data)
    if (sig === st.current.last) return true
    const prev = S.snips.find((x: Rec) => x.ID === rid)
    const local = Object.assign({ '출처': '직접입력', '작성일': S.today }, prev || {}, data, { '책제목': b['제목'] || '' })
    upsertLocal('snips', local)
    queue({ fn: 'saveSnippet', data, local })
    st.current.last = sig; st.current.made = true; st.current.key = 'id:' + rid
    if (prefill?.moveMemoId && !st.current.memoMoved) { st.current.memoMoved = true; deleteMemo(prefill.moveMemoId); toast('메모를 필사로 옮겼어요') }
    LS.del(SNIP_DRAFT_KEY); st.current.base = values()
    setSaved(navigator.onLine ? { t: '저장됨', cls: 'ok' } : { t: '이 기기에 저장됨', cls: 'ok' })
    emit()
    return true
  }
  const soon = () => {
    setSaved({ t: '쓰는 중…' })
    clearTimeout(st.current.t); st.current.t = window.setTimeout(() => { if (!commit()) { saveDraft(); setSaved({ t: '' }) } }, 1200)
  }
  const onInput = (e: React.FormEvent) => {
    const el = e.target as HTMLElement
    if (el.id === 'f-ttl') grow(el as HTMLTextAreaElement)
    if (el.id === 'f-txt') grow(el as HTMLTextAreaElement, 220)
    if (el.id === 'f-memo') grow(el as HTMLTextAreaElement, 60)
    if (el.id === 'f-page' || el.id === 'f-kw' || el.id === 'f-share') readPv()
    soon()
  }
  useEffect(() => {
    // 창을 닫을 때(뒤로 · 완료 · 바깥) 마지막으로 한 번 더 저장
    S.snipFormClose = () => {
      clearTimeout(st.current.t); stopDictate()
      if (st.current.dead) return
      const hadText = !!val('f-txt').trim()
      if (commit()) { if (!s && st.current.made) flashSnip(resolveId(st.current.id)) }
      else if (!hadText && (s || val('f-ttl').trim())) { saveDraft(); if (s) toast('내용이 비어 있어 저장하지 않았어요') }
    }
    if (prefill?.text != null) { const t = $('f-txt'); if (t) t.value = prefill.text }
    if (prefill?.page) { const p = $('f-page'); if (p) p.value = prefill.page }
    st.current.base = values()
    if (s) st.current.last = JSON.stringify(buildData())   // 열자마자는 저장 안 함 (바뀐 게 있을 때만)
    const d = readDraft()
    if (!prefill && d && d.key === st.current.key && (d.txt || d.ttl)) {
      const orig = st.current.base
      fill(d)
      const when = new Date(d.at); const label = (when.toDateString() === new Date().toDateString() ? '' : (when.getMonth() + 1) + '/' + when.getDate() + ' ') + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')
      setDraftNote({ label, orig })
    }
    setTimeout(() => {
      grow($<HTMLTextAreaElement>('f-ttl')); grow($<HTMLTextAreaElement>('f-txt'), 220); grow($<HTMLTextAreaElement>('f-memo'), 60)
      const el = s ? $('f-txt') : (prefill?.text ? $('f-txt') : $('f-ttl')); if (el) el.focus()
    }, 50)
    if (prefill?.ai && navigator.onLine) { const btn = document.querySelector<HTMLButtonElement>('[data-ai-title]'); if (btn) aiTitle(btn, true, prefill.raw) }
    if (prefill?.text) setTimeout(() => commit(), 60)
    return () => { S.snipFormClose = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } soon() }, [type, life]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = () => {
    setMenu(false)
    if (!st.current.made) { if (!confirm('쓰던 내용을 지울까요?')) return; st.current.dead = true; LS.del(SNIP_DRAFT_KEY); closeModal(); return }
    if (!confirm('이 문장을 삭제할까요?')) return
    st.current.dead = true; clearTimeout(st.current.t); LS.del(SNIP_DRAFT_KEY); deleteSnip(resolveId(st.current.id))
    closeModal(); toast('삭제했어요')
  }
  const nextSnip = () => { setMenu(false); if (!val('f-txt').trim()) { toast('내용을 먼저 적어 주세요'); return } commit(); openSnipForm(null, st.current.type === '메모' ? '메모' : st.current.type) }
  const runSpell = async () => {
    setMenu(false)
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
  const openProps = (focus?: string) => { setPropsOpen(true); if (focus) setTimeout(() => { const el = $(focus); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }) } }, 40) }
  const togglePct = () => { const f = $('f-page'); if (!f) return; const v = f.value.trim(); f.value = /%$/.test(v) ? v.replace(/%/g, '') : v.replace(/%/g, '') + '%'; readPv(); soon(); openProps('f-page') }
  const openMemo = () => { setMemoOpen(true); setTimeout(() => { const m = $<HTMLTextAreaElement>('f-memo'); if (m) { m.focus(); grow(m, 60) } }, 30) }
  const addKw = (k: string) => { const el = $('f-kw')!; const cur = el.value.split(',').map(x => x.trim()).filter(Boolean); if (!cur.includes(k)) cur.push(k); el.value = cur.join(', '); readPv(); soon() }
  const kws = pv.kw.split(',').map(x => x.trim()).filter(Boolean)
  const sharable = togetherOn() && type !== '메모'
  const typeName = (t: string) => t === '인용' ? '필사' : t === '생각' ? '내 생각' : '메모'
  return <div className="ed" onInput={onInput} style={{ ['--ed-fs' as string]: fs + 'px' }}>
    <div className="ed-top">
      <button type="button" className="ed-ic" aria-label="뒤로 (저장돼요)" onClick={closeModal}><IcBack /></button>
      <span className={'ed-saved ' + (saved.cls || '')} id="draft-state">{saved.cls === 'ok' ? '✓ ' : ''}{saved.t}</span>
      <div className="ed-top-r">
        <button type="button" className="ed-ic" aria-label="더 보기" onClick={() => setMenu(!menu)}>⋯</button>
        <button type="button" className="btn primary ed-done" onClick={closeModal}>완료</button>
      </div>
    </div>
    {menu && <div className="ed-menu" role="menu">
      <button type="button" onClick={() => { setMenu(false); pasteClip() }}>📋 붙여넣기</button>
      <button type="button" onClick={() => { setMenu(false); startRecording('snip', recSnipDone) }}>🎙 읽어서 넣기</button>
      <button type="button" disabled={spell?.busy} onClick={runSpell}>✓ 맞춤법</button>
      <button type="button" onClick={() => { setFs(nextEdFont()); setMenu(false) }}>Aa 글자 크기 ({fs})</button>
      <button type="button" onClick={nextSnip}>＋ 저장하고 다음 문장</button>
      <button type="button" className="danger" onClick={remove}>🗑 {s || saved.cls === 'ok' ? '삭제' : '쓰던 내용 지우기'}</button>
    </div>}
    <div className="ed-page" style={{ paddingBottom: 90 + kb }}>
      <div id="draft-note">{draftNote && <div className="draft-note"><span>✎ {draftNote.label}에 쓰던 내용을 불러왔어요</span><button type="button" onClick={() => { fill(draftNote.orig); LS.del(SNIP_DRAFT_KEY); setDraftNote(null); toast(s ? '저장된 내용으로 되돌렸어요' : '임시저장을 지웠어요') }}>{s ? '원래대로' : '지우기'}</button></div>}</div>
      <div className="ed-types" id="seg">{['인용', '생각', '메모'].map(t => <button type="button" key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{typeName(t)}</button>)}</div>
      <textarea className="ed-title" id="f-ttl" rows={1} defaultValue={s ? s['제목'] : ''} placeholder="제목 (비워 두면 AI가 붙여요)"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); $('f-txt')?.focus() } }} />
      <div className="ed-props">
        <button type="button" className="ed-pill" onClick={() => openProps()}>📖 {b['제목'] || '책'}</button>
        <button type="button" className={'ed-pill ' + (pv.page ? '' : 'empty')} onClick={() => openProps('f-page')}>{pv.page ? pgLabel(pv.page) : '＋ 쪽수'}</button>
        <button type="button" className={'ed-pill ' + (kws.length ? '' : 'empty')} onClick={() => openProps('f-kw')}>{kws.length ? kws.slice(0, 2).map(k => '#' + k).join(' ') + (kws.length > 2 ? ` +${kws.length - 2}` : '') : '＋ 키워드'}</button>
        {type !== '메모' && <button type="button" className={'ed-pill ' + (life ? 'life' : 'empty')} onClick={() => openProps()}>{life ? '★'.repeat(life) + ' ' + LIFE[life] : '☆ 인생'}</button>}
        {sharable && <button type="button" className={'ed-pill ' + (pv.share ? '' : 'empty')} onClick={() => openProps()}>{pv.share ? '👀 보여줌' : '나만'}</button>}
      </div>
      <div className={'ed-panel ' + (propsOpen ? '' : 'hidden')}>
        <div className="ed-row"><span className="ed-k">📄 {eb ? '위치' : '쪽수'}</span>
          <div className="ed-v inline"><input className="field" id="f-page" inputMode="decimal" placeholder={eb ? '45% 또는 쪽수' : '여러 쪽이면 36, 37'} defaultValue={s ? s['쪽수'] : (prefill?.page || '')} />
            <button type="button" className="btn pct-btn" title="%로 넣기" onClick={togglePct}>%</button></div></div>
        <div className="ed-row col"><span className="ed-k"># 키워드 <button type="button" className="kw-ai" onClick={e => aiKeywords(e.currentTarget)}>AI 추천</button></span>
          <input className="field" id="f-kw" defaultValue={s ? s['키워드'] : ''} placeholder="쉼표로 구분 · 예: 자유, 사랑" />
          {kwSuggest.length > 0 && <div className="suggest">{kwSuggest.map(k => <button type="button" key={k} className="chip" onClick={() => addKw(k)}>#{k}</button>)}</div>}</div>
        {type !== '메모' && <div className="ed-row"><span className="ed-k">★ 인생</span>
          <div className="ed-v life-pick" id="life-pick">{[1, 2, 3].map(n => <button type="button" key={n} className={life >= n ? 'on' : ''} aria-label={LIFE[n]} onClick={() => setLife(life === n ? 0 : n)}>★</button>)}
            <span id="life-lb">{life ? LIFE[life] : '고르지 않음'}</span></div></div>}
        {togetherOn() && <label className={'ed-row ed-switch ' + (type === '메모' ? 'hidden' : '')} id="f-share-w"><span className="ed-k">👀 공개</span>
          <span className="ed-v">{tgHasPartner() ? tgName() + '에게 ' : '짝꿍에게 '}보여주기</span>
          <input type="checkbox" id="f-share" defaultChecked={s ? isShared(s) : (tgShareNew() || bookSnipShared(b))} /></label>}
        <button type="button" className="ed-fold" onClick={() => setPropsOpen(false)}>▲ 접기</button>
      </div>
      <div className="ed-hr" />
      <div id="spell-out">{spell && <div className="spell-box">
        {spell.busy ? <><span className="spin" /> 맞춤법을 살펴보는 중…</> : spell.err ? <>⚠ {spell.err}</>
          : spell.list && spell.list.length ? <><div className="sp-head"><b>고칠 곳 {spell.list.length}개</b><span><button type="button" onClick={() => applySpell(-1)}>모두 바꾸기</button> · <button type="button" onClick={() => setSpell(null)}>닫기</button></span></div>
            {spell.list.map((f, i) => <div className="fix" key={i}><div><s>{f.from}</s> → <b>{f.to}</b>{f.why && <div className="small">{f.why}</div>}</div><button type="button" className="btn" onClick={() => applySpell(i)}>바꾸기</button></div>)}</>
          : <div className="sp-head"><span>맞춤법에서 눈에 띄는 곳이 없어요 👍</span><button type="button" onClick={() => setSpell(null)}>닫기</button></div>}
      </div>}</div>
      <textarea className={'ed-body ' + (type === '인용' ? 'quote' : '')} id="f-txt" placeholder={type === '인용' ? '책 속 문장을 적어 주세요' : type === '생각' ? '떠오른 생각을 적어 보세요' : '메모를 적어 주세요'} defaultValue={s ? sText(s) : ''}
        onPaste={e => { const txt = e.clipboardData.getData('text'); if (!txt || !/\n/.test(txt)) return; e.preventDefault(); fillPasted(txt) }} />
      <div id="memo-wrap" className={'ed-memo ' + (memoOpen ? '' : 'hidden')}><b>메모</b>
        <textarea id="f-memo" rows={2} placeholder="떠오른 것, 찾아볼 것, 연결되는 생각" defaultValue={s ? sMemo(s) : ''} /></div>
      {type === '인용' && !memoOpen && <button type="button" className="ed-add" id="memo-add" onClick={openMemo}>＋ 메모 달기</button>}
    </div>
    <div className="ed-kb" style={{ bottom: kb }} onMouseDown={e => e.preventDefault()}>
      <button type="button" className="ed-tb" onClick={() => openProps('f-page')}><b>p.</b>쪽수</button>
      <button type="button" className="ed-tb" onClick={togglePct}><b>%</b>위치</button>
      {type !== '메모' && <button type="button" className="ed-tb life" onClick={() => setLife((life + 1) % 4)}><b>{life ? '★'.repeat(life) : '☆'}</b>인생</button>}
      <button type="button" className="ed-tb" onClick={() => openProps('f-kw')}><b>#</b>키워드</button>
      {type === '인용' && <button type="button" className="ed-tb" onClick={openMemo}><b>✎</b>메모</button>}
      <button type="button" className="ed-tb" onClick={e => toggleDictate(e.currentTarget, 'f-txt')}><b>🎤</b>음성</button>
      <button type="button" className="ed-tb ai" data-ai-title onClick={e => aiTitle(e.currentTarget)}>AI 제목</button>
      <button type="button" className="ed-tb end" aria-label="키보드 내리기" onClick={() => (document.activeElement as HTMLElement | null)?.blur()}><IcDown /></button>
    </div>
  </div>
}
export function openSnipForm(id: string | null, forceType?: string, prefill?: SnipPrefill) {
  if (!book(S.bookId)) return
  modal(<SnipForm key={'sf' + Date.now()} id0={id} forceType={forceType} prefill={prefill} />, { full: true, onClose: () => { if (S.snipFormClose) S.snipFormClose() } })
}
export function flashSnip(id: string) {
  setTimeout(() => {
    const el = document.getElementById('s-' + resolveId(id)); if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200)
  }, 80)
}
