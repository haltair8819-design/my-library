/* 글 쓰기 · 읽기 — 예전 renderNoteEditor (자동 저장 · 고친 내역 · [[링크]] · 필사 넣기 · AI 제안 · 복사 · PDF) */
import { useEffect, useRef, useState } from 'react'
import { S, emit, book, uniq, sText, pgLabel, hasPage, splitKw, isTemp, resolveId, type Rec } from '../lib/core'
import { NOTE_STATES, noteOf, wordStats, plainText, queueNote, deleteNote, quoteBlock, relatedSnips, resolveLink, normT, notesLinkingHere, openNote } from '../lib/notes'
import { Store } from '../lib/store/server'
import { go, goBack, show, leaveHooks } from '../lib/nav'
import { modal, closeModal, remodal, toast, errMsg } from '../lib/ui'
import { $, toggleDictate, startRecording, stopDictate, voiceToMemo } from '../lib/voice'
import { Spine, Sub, Spin } from '../components/common'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
/* ----- 읽기 화면: 가벼운 마크다운 ----- */
export function renderMd(t: unknown) {
  const lines = esc(String(t || '')).split('\n')
  let html = '', list = false, quote: string[] = []
  const flushQ = () => { if (quote.length) { html += `<blockquote>${quote.join('<br>')}</blockquote>`; quote = [] } }
  const closeL = () => { if (list) { html += '</ul>'; list = false } }
  lines.forEach(l => {
    let m
    if ((m = l.match(/^&gt;\s?(.*)$/))) { closeL(); quote.push(m[1]); return }
    flushQ()
    if ((m = l.match(/^#{1,3}\s+(.*)$/))) { closeL(); html += `<h2>${m[1]}</h2>` }
    else if ((m = l.match(/^\s*[-•]\s+(.*)$/))) { if (!list) { html += '<ul>'; list = true } html += `<li>${m[1]}</li>` }
    else if (!l.trim()) closeL()
    else { closeL(); html += `<p>${l}</p>` }
  })
  flushQ(); closeL()
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[\[(.+?)\]\]/g, (_all, t2) => `<a class="wlink ${resolveLink(t2.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')) ? '' : 'dead'}" data-t="${t2}">${t2}</a>`)
}
function openLink(t: string) {
  const r = resolveLink(t)
  if (!r) { toast('이어진 책이나 글을 찾지 못했어요'); return }
  if (r.kind === 'book') go('book', r.id); else openNote(r.id)
}
const unesc = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/* ----- 저장: 쓰는 동안 자동, 저장 버튼 · 나갈 때 고친 내역 남김 ----- */
let noteTimer = 0
export function collectNote(): Rec | null {
  const n = noteOf(S.noteId); if (!n) return null
  const v = (id: string) => $(id)
  if (v('ne-title')) n['제목'] = v('ne-title')!.value
  if (v('ne-body')) n['본문'] = (v('ne-body') as unknown as HTMLTextAreaElement).value
  if (v('ne-kw')) n['키워드'] = v('ne-kw')!.value
  if (v('ne-group')) n['묶음'] = v('ne-group')!.value.trim()
  if (v('ne-link')) n['발행링크'] = v('ne-link')!.value.trim()
  if (v('ne-state')) n['상태'] = (v('ne-state') as unknown as HTMLSelectElement).value
  return n
}
function setSaved(t: string) { const sv = $('ne-saved'); if (sv) sv.textContent = t }
function countText(n: Rec) { const ws = wordStats(n['본문']); return `${ws.nows.toLocaleString()}자 (공백 포함 ${ws.all.toLocaleString()}) · 원고지 ${ws.ms}매 · 읽는 데 ${ws.min}분` }
export function noteChanged() {
  S.noteDirty = true
  const n = collectNote(); if (!n) return
  const c = $('ne-count'); if (c) c.textContent = countText(n)
  setSaved('쓰는 중…')
  clearTimeout(noteTimer); noteTimer = window.setTimeout(() => saveNoteNow(false), 1500)
}
export function saveNoteNow(snapshot: boolean) {
  clearTimeout(noteTimer)
  const n = collectNote(); if (!n) return
  if (!String(n['제목']).trim() && !String(n['본문']).trim()) return
  if (String(n['본문']).length > 49000) { toast('글이 너무 길어요 (4만 9천 자까지). 두 편으로 나눠 주세요'); return }
  n['수정일'] = S.today; n['수정시각'] = Date.now(); n['글자수'] = wordStats(n['본문']).nows
  queueNote(n, snapshot)
  S.noteDirty = false
  setSaved(navigator.onLine ? '저장됨' : '이 기기에 저장됨 · 연결되면 올라가요')
  if (snapshot) toast('저장했어요')
}
// 글 화면을 떠날 때 (뒤로 · 탭 이동): 쓰던 글 저장, 빈 글은 버림
leaveHooks.note = () => {
  const n = collectNote()
  if (n && (String(n['제목']).trim() || String(n['본문']).trim())) { if (S.noteDirty || isTemp(n.ID)) saveNoteNow(true) }
  else if (n) S.notes = S.notes.filter((x: Rec) => x !== n)
  stopDictate()
}
function leaveNote() { goBack() }

/* ----- 쓰기 도구 ----- */
const body = () => $<HTMLTextAreaElement>('ne-body')
function mdWrap(pre: string, post: string) {
  const ta = body(); if (!ta) return
  const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value
  if (!post) {   // 줄 앞에 붙이기 (선택한 줄 모두)
    const ls = v.lastIndexOf('\n', a - 1) + 1, le = v.indexOf('\n', b); const end = le < 0 ? v.length : le
    const block = v.slice(ls, end).split('\n').map(l => l.startsWith(pre) ? l.slice(pre.length) : pre + l).join('\n')
    ta.value = v.slice(0, ls) + block + v.slice(end); ta.setSelectionRange(ls, ls + block.length)
  } else {
    const sel = v.slice(a, b) || '굵게'
    ta.value = v.slice(0, a) + pre + sel + post + v.slice(b); ta.setSelectionRange(a + pre.length, a + pre.length + sel.length)
  }
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}
function insertAtCursor(text: string) {
  const ta = body(); if (!ta) return
  const a = ta.selectionStart ?? ta.value.length, v = ta.value
  const pre = a > 0 && v[a - 1] !== '\n' ? '\n\n' : ''
  ta.value = v.slice(0, a) + pre + text + '\n' + v.slice(a)
  const p = a + pre.length + text.length + 1; ta.setSelectionRange(p, p); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}
function recNoteDone(res: Rec) {
  if (body()) { insertAtCursor(res.text); const t = $('ne-title'); if (res.title && t && !t.value.trim()) t.value = res.title; noteChanged() } else voiceToMemo(res)
}
const toWrite = () => { if (S.noteRead) { S.noteRead = false; emit() } }

/* ----- 필사 넣기 ----- */
function Related({ n }: { n: Rec }) {
  const [q, setQ] = useState('')
  const qq = q.trim().toLowerCase(), terms = qq.replace(/^#/, '').split(/\s+/).filter(Boolean)
  const list: Rec[] = qq ? S.snips.filter((s: Rec) => { const hay = (s['내용'] + ' ' + s['제목'] + ' ' + s['키워드'] + ' ' + ((book(s['책ID']) || {})['제목'] || '')).toLowerCase(); return terms.every(t => hay.includes(t)) }).slice(0, 40) : relatedSnips(n, 30)
  const insert = (s: Rec) => {
    closeModal(); toWrite()
    setTimeout(() => {
      insertAtCursor(quoteBlock(s))
      const kw = $('ne-kw'); if (kw && s['키워드']) { const c = splitKw(kw.value); splitKw(s['키워드']).forEach(k => { if (!c.includes(k)) c.push(k) }); kw.value = c.join(', '); noteChanged() }
      toast('인용으로 넣었어요')
    }, 30)
  }
  return <>
    <h3>필사 넣기 <Sub>{qq ? `찾은 문장 ${list.length}${list.length >= 40 ? '+' : ''}` : '쓰는 글과 맞는 내 필사'}</Sub></h3>
    <input className="field" id="rel-q" type="search" placeholder="문장 · 책 · #키워드 찾기" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
    <div className="rel-list" id="rel-list">{list.length ? list.map(s => { const b = book(s['책ID']) || {}; return <button className="mini" key={s.ID} onClick={() => insert(s)}>
      <b>{s['제목'] || b['제목'] || ''}</b><span>{sText(s).slice(0, 140)}{sText(s).length > 140 ? '…' : ''}</span>
      <em>{b['제목'] || ''}{hasPage(s) ? ' · ' + pgLabel(s['쪽수']) : ''} · 누르면 인용으로 넣어요</em></button> })
      : <div className="al-msg">{qq ? '찾는 문장이 없어요' : '아직 이어지는 필사가 없어요. 키워드를 달거나 몇 문장 더 쓰면 찾아줘요.'}</div>}</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
function openRelated() { const n = collectNote(); if (n) modal(<Related n={n} />) }

/* ----- [[링크]] 잇기 ----- */
function LinkPicker() {
  const [q, setQ] = useState('')
  const qq = normT(q)
  const bs = S.books.filter((b: Rec) => !qq || normT(b['제목'] + b['저자']).includes(qq)).slice(0, 12)
  const ns = S.notes.filter((n: Rec) => n.ID !== resolveId(S.noteId) && n['제목'] && (!qq || normT(n['제목']).includes(qq))).slice(0, 8)
  const insert = (title: string) => {
    closeModal()
    setTimeout(() => {
      const ta = body(); if (!ta) return
      const a = ta.selectionStart ?? ta.value.length, v = ta.value, ins = `[[${title}]]`
      ta.value = v.slice(0, a) + ins + v.slice(a); ta.setSelectionRange(a + ins.length, a + ins.length); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
    }, 30)
  }
  return <>
    <h3>책이나 글 잇기 <Sub>[[제목]]으로 들어가요</Sub></h3>
    <input className="field" id="lk-q" type="search" placeholder="책 · 글 제목 찾기" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
    <div className="share-list" id="lk-list">{bs.length + ns.length ? <>
      {bs.map((b: Rec) => <button className="al-item" key={b.ID} onClick={() => insert(b['제목'])}><Spine b={b} /><div><b>{b['제목']}</b><span>책 · {b['저자'] || ''}</span></div></button>)}
      {ns.map((n: Rec) => <button className="al-item" key={n.ID} onClick={() => insert(n['제목'])}><div className="spine nspine">글</div><div><b>{n['제목']}</b><span>내 글</span></div></button>)}
    </> : <div className="al-msg">찾는 책이나 글이 없어요</div>}</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}

/* ----- AI 제안 (고르는 건 내가) ----- */
function NoteAI({ start }: { start?: string }) {
  const [out, setOut] = useState<React.ReactNode>(null)
  const [fixes, setFixes] = useState<Rec[]>([]); const [done, setDone] = useState<Set<number>>(new Set())
  const run = async (mode: string) => {
    const n = collectNote(); if (!n) return
    setOut(<div className="drill"><Spin /> 살펴보는 중…</div>)
    try {
      const r = await Store.run('noteAssist', { mode, '제목': n['제목'], '본문': n['본문'] })
      if (mode === 'titles') setOut(<><div className="ic-lb">눌러서 제목으로 쓰기</div>{(r.titles || []).map((t: string) => <button className="mini" key={t} onClick={() => { closeModal(); toWrite(); setTimeout(() => { const el = $('ne-title'); if (el) el.value = t; noteChanged(); toast('제목을 바꿨어요') }, 30) }}><b>{t}</b></button>)}</>)
      else if (mode === 'spell') { setFixes(r.fixes || []); setDone(new Set()); setOut('spell') }
      else {
        const tags: string[] = r.tags || []
        const txt = (r.summary || '') + '\n' + tags.map(t => '#' + String(t).replace(/^#/, '')).join(' ')
        setOut(<><div className="ic-lb">소개글</div><div className="share-peek">{r.summary || ''}</div>{tags.length > 0 && <div className="kw-chips">{tags.map(t => <span className="chip" key={t}>#{String(t).replace(/^#/, '')}</span>)}</div>}
          <button className="btn" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(txt).then(() => toast('복사했어요'))}>복사</button></>)
      }
    } catch (e) { setOut(<div className="drill">⚠ {errMsg(e)}</div>) }
  }
  useEffect(() => { if (start) run(start) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const applyFix = (i: number) => {
    const f = fixes[i]; const n = noteOf(S.noteId); if (!f || !n) return
    const ta = body(); const txt = ta ? ta.value : n['본문']
    const at = txt.indexOf(f.from); if (at < 0) { toast('이미 바뀐 곳이에요'); return }
    const nb = txt.slice(0, at) + f.to + txt.slice(at + f.from.length)
    if (ta) ta.value = nb; n['본문'] = nb
    noteChanged(); setDone(new Set([...done, i]))
  }
  return <>
    <h3>✨ AI 제안 <Sub>내 문장은 그대로, 고르는 건 내가</Sub></h3>
    <div className="qmenu"><button onClick={() => run('titles')}><b>제목 후보</b><span>글에 어울리는 제목 5개</span></button>
      <button onClick={() => run('spell')}><b>맞춤법 살펴보기</b><span>틀린 곳만 골라 보여줘요</span></button>
      <button onClick={() => run('summary')}><b>소개글 · 태그</b><span>블로그 · 브런치 소개용</span></button></div>
    <div id="ai-out">{out === 'spell' ? (fixes.length ? <><div className="ic-lb">고칠 곳 {fixes.length}개 · 바꿀 것만 누르세요</div>{fixes.map((f, i) => <div className={'fix ' + (done.has(i) ? 'done' : '')} key={i}><div><s>{f.from}</s> → <b>{f.to}</b><div className="small">{f.why || ''}</div></div><button className="btn" disabled={done.has(i)} onClick={() => applyFix(i)}>{done.has(i) ? '바꿈' : '바꾸기'}</button></div>)}</> : <div className="drill">맞춤법에서 눈에 띄는 곳이 없어요 👍</div>) : out}</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
function openNoteAI(start?: string) {
  const n = collectNote(); if (!n || !String(n['본문']).trim()) { toast('본문을 먼저 써 주세요'); return }
  modal(<NoteAI start={start} />)
}

/* ----- 고친 내역 ----- */
function Versions({ list }: { list: Rec[] }) {
  const fmt = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const restore = (v: Rec) => {
    const n = noteOf(S.noteId); if (!n) return
    if (!confirm('이 내용으로 되돌릴까요? 지금 내용도 고친 내역에 남아요.')) return
    saveNoteNow(true)
    n['제목'] = v['제목']; n['본문'] = v['본문']
    closeModal(); S.noteRead = false; S.noteKey = (S.noteKey || 0) + 1; emit()
    setTimeout(() => { noteChanged(); saveNoteNow(true) }, 30)
  }
  return <>
    <h3>고친 내역 <Sub>저장 버튼을 누를 때마다 남아요 (최근 30개)</Sub></h3>
    {list.length ? list.map((v, i) => <div className="ver" key={i}><div><b>{fmt(v.at)}</b> · {wordStats(v['본문']).nows.toLocaleString()}자<div className="small">{plainText(v['본문']).slice(0, 90)}</div></div>
      <button className="btn" onClick={() => restore(v)}>이걸로 되돌리기</button></div>) : <div className="drill">아직 남은 내역이 없어요.</div>}
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
async function openVersions() {
  const id = resolveId(S.noteId)
  if (isTemp(id)) { toast('저장한 뒤에 볼 수 있어요'); return }
  modal(<><h3>고친 내역</h3><div className="drill"><Spin /> 불러오는 중…</div></>)
  try { const list = await Store.run('getNoteVersions', id); remodal(<Versions list={list} />) }
  catch (e) { remodal(<><h3>고친 내역</h3><div className="drill">⚠ {errMsg(e)}</div><div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>) }
}

/* ----- 내보내기 ----- */
const noteHtml = (n: Rec) => `<h1>${esc(n['제목'] || '')}</h1>` + renderMd(n['본문']).replace(/<a class="wlink[^"]*"[^>]*>(.*?)<\/a>/g, '$1')
async function copyNote(kind: string) {
  const n = collectNote(); if (!n) return
  try {
    if (kind === 'rich' && window.ClipboardItem) {
      const html = noteHtml(n), text = (n['제목'] ? n['제목'] + '\n\n' : '') + plainText(n['본문'])
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    } else await navigator.clipboard.writeText((n['제목'] ? '# ' + n['제목'] + '\n\n' : '') + n['본문'])
    closeModal(); toast('복사했어요. 붙여넣기 하세요')
  } catch { toast('복사하지 못했어요. 읽기 화면에서 길게 눌러 복사해 주세요') }
}
function printNote() {
  const n = collectNote(); if (!n) return
  let el = document.getElementById('print-area'); if (!el) { el = document.createElement('div'); el.id = 'print-area'; document.body.appendChild(el) }
  el.innerHTML = `<article class="ne-read">${noteHtml(n)}</article>`
  setTimeout(() => window.print(), 50)
}
function noteMenu() {
  const n = collectNote(); if (!n) return
  modal(<><h3>{n['제목'] || '제목 없음'}</h3><div className="qmenu">
    <button onClick={() => copyNote('rich')}><b>📋 블로그용 복사</b><span>브런치 · 블로그에 그대로 붙여넣기</span></button>
    <button onClick={() => copyNote('md')}><b>📝 마크다운 복사</b><span>## · &gt; 표시 그대로</span></button>
    <button onClick={() => { closeModal(); printNote() }}><b>🖨 PDF로 저장</b><span>인쇄 창에서 PDF로 저장</span></button>
    <button onClick={openVersions}><b>🕘 고친 내역</b><span>저장할 때마다 남은 예전 모습</span></button>
    <button onClick={() => { if (!confirm('이 글을 지울까요?')) return; deleteNote(S.noteId); S.noteDirty = false; closeModal(); go('notes'); toast('지웠어요') }}><b style={{ color: 'var(--warn)' }}>🗑 삭제</b><span>되돌릴 수 없어요</span></button></div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>)
}
async function noteKw(btn: HTMLButtonElement) {
  const n = collectNote(); if (!n || !String(n['본문']).trim()) { toast('본문을 먼저 써 주세요'); return }
  btn.disabled = true; btn.textContent = '추천 중…'
  try {
    const ks = await Store.run('suggestKeywords', { '책ID': '', '제목': n['제목'], '내용': String(n['본문']).slice(0, 3000) })
    const kw = $('ne-kw')!; const c = splitKw(kw.value); (ks || []).forEach((k: string) => { if (!c.includes(k)) c.push(k) }); kw.value = c.join(', '); noteChanged()
    if (!ks || !ks.length) toast('추천할 키워드를 찾지 못했어요')
  } catch (e) { toast('⚠ ' + errMsg(e)) } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'AI 추천' } }
}

export function NoteView() {
  const n = noteOf(S.noteId)
  const ref = useRef<HTMLTextAreaElement>(null)
  const grow = () => { const b = ref.current; if (!b) return; b.style.height = 'auto'; b.style.height = Math.max(260, b.scrollHeight + 4) + 'px' }
  useEffect(() => { grow() })
  useEffect(() => { if (!n) show('notes') }, [n])
  if (!n) return <section id="v-note" />
  const back = notesLinkingHere(n)
  const setRead = (r: boolean) => { if (r) collectNote(); S.noteRead = r; emit(); window.scrollTo(0, 0) }
  const k = (S.noteKey || 0) + ':' + (S.noteRead ? 'r' : 'w')
  return <section id="v-note" key={k}>
    <div className="topbar"><button className="iconbtn" onClick={leaveNote}>← 기록</button>
      <div className="ne-top-r"><select className="field ne-state" id="ne-state" defaultValue={n['상태'] || '초안'} onChange={() => { noteChanged(); saveNoteNow(false) }}>{NOTE_STATES.map(x => <option key={x}>{x}</option>)}</select>
        <button className="iconbtn" onClick={noteMenu} aria-label="더 보기">⋯</button></div></div>
    <div className="seg ne-mode"><button className={S.noteRead ? '' : 'on'} onClick={() => setRead(false)}>✎ 쓰기</button><button className={S.noteRead ? 'on' : ''} onClick={() => setRead(true)}>📖 읽기</button></div>
    {S.noteRead ? <article className="ne-read" id="ne-read" onClick={e => { const a = (e.target as HTMLElement).closest('a.wlink') as HTMLElement | null; if (a) openLink(unesc(a.dataset.t || '')) }}
      dangerouslySetInnerHTML={{ __html: `<h1>${esc(n['제목'] || '제목 없음')}</h1>${renderMd(n['본문'])}` }} /> : <>
      <input className="ne-title" id="ne-title" placeholder="제목" defaultValue={n['제목']} onInput={noteChanged} />
      <div className="ne-tools" id="ne-tools">
        <button onClick={() => mdWrap('## ', '')} title="소제목">소제목</button><button onClick={() => mdWrap('> ', '')} title="인용">❝ 인용</button>
        <button onClick={() => mdWrap('**', '**')} title="굵게"><b>굵게</b></button><button onClick={() => mdWrap('- ', '')} title="목록">• 목록</button>
        <button onClick={() => modal(<LinkPicker />)} title="책이나 글 잇기">[[ ]] 잇기</button><button onClick={openRelated} title="연결된 필사">📚 필사 넣기</button><button onClick={() => openNoteAI('spell')} title="맞춤법 검사">✓ 맞춤법</button>
        <span className="vbtns"><button type="button" className="vbtn" title="받아쓰기" aria-label="받아쓰기" onClick={e => toggleDictate(e.currentTarget, 'ne-body')}>🎤</button>
          <button type="button" className="vbtn" title="녹음 후 정리" aria-label="녹음 후 정리" onClick={() => startRecording('note', recNoteDone)}>🎙</button></span></div>
      <textarea ref={ref} className="ne-body" id="ne-body" placeholder={'쓰고 싶은 이야기를 적어 보세요.\n[[책 제목]]처럼 쓰면 책과 이어져요.'} defaultValue={n['본문']} onInput={() => { grow(); noteChanged() }} />
    </>}
    <div className="ne-count" id="ne-count" ref={el => { if (el && !el.textContent) el.textContent = countText(n) }} />
    <div className="panel2"><h4>키워드 <button className="kw-ai" onClick={e => noteKw(e.currentTarget)}>AI 추천</button></h4>
      <input className="field" id="ne-kw" defaultValue={n['키워드']} placeholder="예: 사랑, 자유" onInput={noteChanged} />
      <div className="row" style={{ marginTop: 8 }}><div><label style={{ marginTop: 0 }}>묶음</label><input className="field" id="ne-group" list="ne-groups" defaultValue={n['묶음']} placeholder="예: 독서 에세이" onInput={noteChanged} /></div>
        <div><label style={{ marginTop: 0 }}>발행 링크</label><input className="field" id="ne-link" defaultValue={n['발행링크']} placeholder="브런치 · 블로그 주소" onInput={noteChanged} /></div></div>
      <datalist id="ne-groups">{uniq<string>(S.notes.map((x: Rec) => x['묶음'])).map(g => <option key={g} value={g} />)}</datalist>
      {n['발행링크'] && <a className="small" href={n['발행링크']} target="_blank" rel="noopener">발행한 글 열기 ↗</a>}</div>
    <div className="actions"><button className="btn" onClick={() => openNoteAI()}>✨ AI 제안</button><button className="btn" onClick={openRelated}>📚 연결된 필사</button>
      <button className="btn primary grow" onClick={() => saveNoteNow(true)}>저장</button></div>
    {back.length > 0 && <div className="panel2"><h4>이 글을 언급한 글</h4>{back.map(x => <button className="mini" key={x.ID} onClick={() => openNote(x.ID)}><b>{x['제목'] || '제목 없음'}</b></button>)}</div>}
    <div className="small ne-saved" id="ne-saved" ref={el => { if (el && !el.dataset.init) { el.dataset.init = '1'; el.textContent = S.noteDirty ? '저장 전' : isTemp(n.ID) ? '' : '저장됨' } }} />
  </section>
}
