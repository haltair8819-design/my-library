/* 기록 탭 (v2.14): 노트(글) + 메모 + 할 일을 한 화면에 · 메모 고치기 · 빠른 입력 · ＋ 메뉴 */
import { useEffect, useRef, useState } from 'react'
import { S, emit, book, dayDiff, platOf, progressOf, uid, resolveId, sText, pgLabel, splitKw, type Rec } from '../lib/core'
import { logsOf, dailyOf } from '../lib/logs'
import { isDone, dueLabel, parseQuick, addMemo, patchMemo, deleteMemo, toggleTodo, pickBooks } from '../lib/memo'
import { NOTE_STATES, noteOf, wordStats, plainText, queueNote, writingSeed, newNote, openNote, deleteNote } from '../lib/notes'
import { readHere } from '../lib/book'
import { queue } from '../lib/store/local'
import { go } from '../lib/nav'
import { modal, closeModal, toast } from '../lib/ui'
import { $, toggleDictate, startRecording, VQ, processVoiceQueue } from '../lib/voice'
import { Spine, longPress, Faint } from '../components/common'
import { openSnipInBook, finish } from './Book'
import { openSnipForm } from './SnipForm'
import { openBookForm } from './BookForms'

S.recF = '전체'; S.recQ = ''; S.recLimit = 40; S.recSel = null; S.recDoneOpen = false
const REC_FILTERS = ['전체', '생각', '할 일', '초안', '완성', '발행']
const REC_TAG: Record<string, string> = { memo: '✍ 생각', todo: '☑ 할 일', '메모': '✍ 생각', '초안': '📝 초안', '완성': '✅ 완성', '발행': '📢 발행' }
type Item = { k: string; type: 'note' | 'memo' | 'todo'; st: string; o: Rec; t: number; hay: string; done?: boolean }
function recItems(): Item[] {
  const out: Item[] = []
  S.notes.forEach((n: Rec) => out.push({ k: 'n:' + n.ID, type: 'note', st: n['상태'] || '초안', o: n, t: Number(n['수정시각']) || Date.parse(n['수정일'] || n['작성일'] || '') || 0,
    hay: (String(n['제목']) + ' ' + n['본문'] + ' ' + n['키워드']).toLowerCase() }))
  S.memos.forEach((m: Rec) => { const todo = m['종류'] === '할일'
    out.push({ k: 'm:' + m.ID, type: todo ? 'todo' : 'memo', st: todo ? '할 일' : '메모', o: m, done: todo && isDone(m), t: Date.parse(m['작성일'] || '') || 0, hay: String(m['내용'] || '').toLowerCase() }) })
  return out
}
function recFiltered() {
  const q = S.recQ.trim().toLowerCase(), terms = q.replace(/^#/, '').split(/\s+/).filter(Boolean), f = S.recF
  return recItems().filter(x => {
    if (f === '생각' && !(x.type === 'memo' || (x.type === 'note' && x.st === '메모'))) return false
    if (f === '할 일' && x.type !== 'todo') return false
    if (['초안', '완성', '발행'].includes(f) && !(x.type === 'note' && x.st === f)) return false
    return !terms.length || terms.every((w: string) => x.hay.includes(w))
  })
}
const recSel = (k: string) => !!S.recSel && S.recSel.has(k)
const Check = ({ k }: { k: string }) => S.recSel ? <span className="m-check">{recSel(k) ? '✓' : ''}</span> : null
function recTap(k: string) {
  if (!S.recSel) { const id = k.slice(2); if (k[0] === 'n') openNote(id); else openMemo(id); return }
  if (S.recSel.has(k)) S.recSel.delete(k); else S.recSel.add(k)
  emit()
}
const lpRec = (k: string) => longPress(() => { if (!S.recSel) S.recSel = new Set(); S.recSel.add(k); emit() })
function TodoRow({ m }: { m: Rec }) {
  const k = 'm:' + m.ID, d = m['마감일'] ? dayDiff(m['마감일']) as number : null, fin = isDone(m), b = m['책ID'] ? book(m['책ID']) : null
  const [fx, setFx] = useState<boolean | null>(null)   // 누르자마자 줄 긋기 (저장은 바로, 목록 이동은 조금 뒤)
  const shown = fx ?? fin
  return <div className={`todo ${shown ? 'fin' : ''} ${recSel(k) ? 'msel' : ''}`} data-rk={k} data-id={m.ID} {...lpRec(k)}>
    {S.recSel ? <Check k={k} /> : <button className="tick" aria-label={fin ? '안 끝낸 일로' : '끝냈어요'} onClick={() => { const now = !fin; setFx(now); setTimeout(() => { setFx(null); toggleTodo(m.ID) }, now ? 450 : 0) }}>{shown ? '✓' : ''}</button>}
    <div className="tbody" onClick={() => recTap(k)}><div className="tt">{m['내용']}</div>
      {((m['마감일'] && !fin) || b || fin) && <div className="tm">{fin ? (m['완료일'] ? String(m['완료일']).slice(5).replace('-', '/') + ' 끝냄' : '끝냄') : <span className={d !== null && d < 0 ? 'late' : d === 0 ? 'due-now' : ''}>{dueLabel(m['마감일'], m['마감시간'])}</span>}{b ? ` · 📖 ${b['제목']}` : ''}</div>}</div></div>
}
function RecCard({ x }: { x: Item }) {
  const k = x.k
  if (x.type === 'todo') return <TodoRow m={x.o} />
  if (x.type === 'memo') {
    const m = x.o, t = String(m['내용'] || ''), first = t.split('\n')[0], rest = t.slice(first.length).trim(), b = m['책ID'] ? book(m['책ID']) : null
    const head = first.length > 40 ? '' : first, body = head ? rest : t
    return <div className={'rec ' + (recSel(k) ? 'msel' : '')} data-rk={k} onClick={() => recTap(k)} {...lpRec(k)}>
      <div className="rec-h"><Check k={k} /><b>{head || ''}</b><span className="rec-tag">{REC_TAG.memo}</span></div>
      {body && <div className="rec-x">{body.slice(0, 220)}</div>}
      <div className="rec-m">{m['작성일'] ? String(m['작성일']).slice(0, 10).replace(/-/g, '.') : '방금'}{b ? ' · 📖 ' + b['제목'] : ''}</div></div>
  }
  const n = x.o
  return <div className={'rec ' + (recSel(k) ? 'msel' : '')} data-rk={k} onClick={() => recTap(k)} {...lpRec(k)}>
    <div className="rec-h"><Check k={k} /><b>{n['제목'] || '제목 없음'}</b><span className={'rec-tag st-' + NOTE_STATES.indexOf(x.st)}>{REC_TAG[x.st] || x.st}</span></div>
    <div className="rec-x">{plainText(n['본문']).slice(0, 140)}</div>
    <div className="rec-m">{[String(n['수정일'] || n['작성일'] || '').slice(0, 10).replace(/-/g, '.'), wordStats(n['본문']).nows.toLocaleString() + '자', n['묶음'] || '', n['키워드'] ? splitKw(n['키워드']).slice(0, 3).map(k2 => '#' + k2).join(' ') : ''].filter(Boolean).join(' · ')}</div></div>
}
const TODO_GROUPS: [string, (d: number) => boolean][] = [['지난 할 일', d => d < 0], ['오늘', d => d === 0], ['내일', d => d === 1], ['이번 주', d => d > 1 && d <= 7], ['나중에', d => d > 7]]
function TodoGroups({ todos }: { todos: Rec[] }) {
  const sorted = todos.slice().sort((a, b) => String(a['마감일'] || '9999').localeCompare(String(b['마감일'] || '9999')) || String(a['마감시간'] || '99').localeCompare(String(b['마감시간'] || '99')))
  const out: React.ReactNode[] = []
  TODO_GROUPS.forEach(([name, test]) => { const l = sorted.filter(m => m['마감일'] && test(dayDiff(m['마감일']) as number)); if (l.length) out.push(<div key={name} className={'group-label ' + (name === '지난 할 일' ? 'late' : '')}>{name} <span>{l.length}</span></div>, ...l.map(m => <TodoRow key={m.ID} m={m} />)) })
  const nd = sorted.filter(m => !m['마감일']); if (nd.length) out.push(<div key="nd" className="group-label">날짜 없음 <span>{nd.length}</span></div>, ...nd.map(m => <TodoRow key={m.ID} m={m} />))
  return <>{out}</>
}

/* ----- 여러 개 고르기 ----- */
function RecSelBar({ shown }: { shown: string[] }) {
  if (!S.recSel || S.view !== 'notes') return null
  const n = S.recSel.size, allOn = shown.length && shown.every(k => S.recSel.has(k)), dis = !n
  // 메모 → 초안 · 완성 · 발행이면 글(노트)로 옮겨요. 글 → 생각이면 글의 상태를 '메모'로.
  const bulk = (to: string) => {
    let c = 0, skip = 0
    ;[...S.recSel].forEach((k: string) => {
      const id = resolveId(k.slice(2))
      if (k[0] === 'm') {
        const m = S.memos.find((x: Rec) => x.ID === id); if (!m) return
        if (to === '생각') { if (m['종류'] !== '메모') { patchMemo(m.ID, { '종류': '메모', '완료': false }); c++ } }
        else if (to === '할일') { if (m['종류'] !== '할일') { patchMemo(m.ID, { '종류': '할일' }); c++ } }
        else if (to === '끝냄') { if (!(m['종류'] === '할일' && isDone(m))) { patchMemo(m.ID, { '종류': '할일', '완료': true }); c++ } }
        else if (to === '안끝냄') { if (isDone(m)) { patchMemo(m.ID, { '완료': false }); c++ } }
        else {   // 메모 → 글
          const t = String(m['내용'] || ''), first = t.split('\n')[0].slice(0, 40)
          const nt = { ID: 'T' + uid(), '제목': first, '본문': t, '상태': to, '묶음': '', '키워드': '', '작성일': m['작성일'] || S.today, '수정일': S.today, '수정시각': Date.now() }
          S.notes.push(nt); queueNote(nt, false)
          S.memos = S.memos.filter((x: Rec) => x.ID !== m.ID); queue({ fn: 'deleteMemo', id: m.ID }); c++
        }
      } else {
        const nt = noteOf(id); if (!nt) return
        const st = to === '생각' ? '메모' : ['초안', '완성', '발행'].includes(to) ? to : null
        if (!st) { skip++; return }
        if (nt['상태'] !== st) { nt['상태'] = st; nt['수정일'] = S.today; nt['수정시각'] = Date.now(); queueNote(nt, false); c++ }
      }
    })
    S.recSel = new Set(); emit()
    toast(c ? `${c}개를 바꿨어요${skip ? ` · 글 ${skip}편은 할 일로 바꿀 수 없어 그대로 뒀어요` : ''}` : skip ? '글은 할 일로 바꿀 수 없어요' : '바뀐 게 없어요')
  }
  const bulkDel = () => {
    const ks = [...S.recSel] as string[]; if (!ks.length || !confirm(`${ks.length}개를 지울까요? 되돌릴 수 없어요.`)) return
    ks.forEach(k => { const id = k.slice(2); if (k[0] === 'n') deleteNote(id); else deleteMemo(id) })
    S.recSel = new Set(); emit(); toast(`${ks.length}개를 지웠어요`)
  }
  return <div id="selbar" className="selbar"><div className="in"><div className="top"><b>{n}개 골랐어요</b><span><button onClick={() => { shown.forEach(k => allOn ? S.recSel.delete(k) : S.recSel.add(k)); emit() }}>{allOn ? '모두 풀기' : '보이는 것 모두'}</button> · <button onClick={() => { S.recSel = null; emit() }}>완료</button></span></div>
    <div className="row2"><button className="btn" disabled={dis} onClick={() => bulk('생각')}>→ 생각</button><button className="btn" disabled={dis} onClick={() => bulk('할일')}>→ 할 일</button><button className="btn" disabled={dis} onClick={() => bulk('끝냄')}>✓ 끝냈어요</button><button className="btn" disabled={dis} onClick={() => bulk('안끝냄')}>안 끝냄</button></div>
    <div className="row2"><button className="btn" disabled={dis} onClick={() => bulk('초안')}>→ 초안</button><button className="btn" disabled={dis} onClick={() => bulk('완성')}>→ 완성</button><button className="btn" disabled={dis} onClick={() => bulk('발행')}>→ 발행</button>
      <button className="btn danger" disabled={dis} onClick={bulkDel}>삭제</button></div></div></div>
}

export function RecordsView() {
  useEffect(() => { processVoiceQueue() }, [])
  const seed = writingSeed()
  const todosLeft = S.memos.filter((m: Rec) => m['종류'] === '할일' && !isDone(m)).length
  const list = recFiltered(), f = S.recF
  let body: React.ReactNode, shown: string[] = []
  if (f === '할 일') {
    const todos = list.filter(x => !x.done).map(x => x.o), done = list.filter(x => x.done).map(x => x.o).sort((a, b) => String(b['완료일']).localeCompare(String(a['완료일'])))
    shown = [...todos, ...(S.recDoneOpen ? done.slice(0, 100) : [])].map(m => 'm:' + m.ID)
    body = <>{todos.length ? <div className="todo-list"><TodoGroups todos={todos} /></div> : <div className="empty">할 일이 없어요. ‘새 기록 → 할 일’로 넣어 보세요.</div>}
      {done.length > 0 && <><button className="btn tg-more" onClick={() => { S.recDoneOpen = !S.recDoneOpen; emit() }}>{S.recDoneOpen ? '끝낸 일 접기' : `끝낸 일 ${done.length}개 보기`}</button>{S.recDoneOpen && <div className="todo-list">{done.slice(0, 100).map(m => <TodoRow key={m.ID} m={m} />)}</div>}</>}</>
  } else {
    // 전체: 남은 할 일을 위에 조금, 그 아래 생각 · 글을 최근 순으로
    const todos = f === '전체' ? list.filter(x => x.type === 'todo' && !x.done) : []
    const rest = list.filter(x => x.type !== 'todo').sort((a, b) => b.t - a.t)
    const top = todos.map(x => x.o).sort((a, b) => String(a['마감일'] || '9999').localeCompare(String(b['마감일'] || '9999'))).slice(0, 3)
    shown = [...top.map(m => 'm:' + m.ID), ...rest.slice(0, S.recLimit).map(x => x.k)]
    body = <>{todos.length > 0 && <div className="rec-sec"><div className="group-label">할 일 <span>{todos.length}</span>{todos.length > 3 && <button className="kw-ai" onClick={() => { S.recF = '할 일'; emit() }}>모두 보기 ›</button>}</div><div className="todo-list">{top.map(m => <TodoRow key={m.ID} m={m} />)}</div></div>}
      {rest.length ? <><div className="rec-list">{rest.slice(0, S.recLimit).map(x => <RecCard key={x.k} x={x} />)}</div>{rest.length > S.recLimit && <button className="btn tg-more" onClick={() => { S.recLimit += 40; emit() }}>더보기 ({rest.length - S.recLimit}개 남음)</button>}</>
        : (todos.length ? null : <div className="empty">{S.recQ.trim() || f !== '전체' ? '찾는 기록이 없어요' : '아직 기록이 없어요. ✍ 새 기록으로 시작해 보세요.'}</div>)}</>
  }
  return <section id="v-notes">
    <div className="view-head ai-head"><div><h1>기록</h1><p>생각과 글, 해야 할 일을 모아 두는 곳{todosLeft ? ` · 할 일 ${todosLeft}개 남음` : ''}</p></div>
      <button className="btn primary" style={{ whiteSpace: 'nowrap' }} onClick={openNewRecord}>✍ 새 기록</button></div>
    <input className="field" id="rec-q" type="search" placeholder="제목 · 내용 · #키워드 찾기" value={S.recQ} style={{ margin: '10px 0 8px' }} autoComplete="off" onChange={e => { S.recQ = e.target.value; S.recLimit = 40; emit() }} />
    <div className="chips" id="rec-f">{REC_FILTERS.map(x => <button key={x} className={'chip ' + (S.recF === x ? 'on' : '')} onClick={() => { S.recF = x; S.recLimit = 40; emit() }}>{x}</button>)}</div>
    <div id="voiceq">{VQ.n > 0 && <div className="notice">🎙 정리를 기다리는 녹음 {VQ.n}개 · 인터넷이 연결되면 메모로 정리돼요</div>}</div>
    {seed && <div className={'seed ' + (S.recQ.trim() || S.recSel || f !== '전체' ? 'hidden' : '')} id="seed-box"><div className="lb"><span>떠오르는 글감</span><button onClick={() => { S.seedRand = Math.random(); emit() }}>다른 글감 ↻</button></div>
      <div className="tx tap" onClick={() => openSnipInBook(seed.ID)}>{sText(seed).slice(0, 220)}{sText(seed).length > 220 ? '…' : ''}</div>
      <div className="mt tap" onClick={() => openSnipInBook(seed.ID)}>{(book(seed['책ID']) || {})['제목'] || ''}{seed['쪽수'] ? ' · ' + pgLabel(seed['쪽수']) : ''}</div>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => newNote(seed.ID)}>이 문장으로 글쓰기</button></div>}
    <div id="rec-list">{body}</div>
    <RecSelBar shown={shown} />
  </section>
}

/* ----- 새 기록 ----- */
export function openNewRecord() {
  modal(<><h3>새 기록 만들기</h3>
    <div className="rec-new">
      <button onClick={() => { closeModal(); newNote() }}><i>📝</i><b>글쓰기</b><span>생각, 독서 기록, 글감, 초안</span></button>
      <button onClick={() => openQuickSheet('할일')}><i>☑</i><b>할 일</b><span>일정, 해야 할 일, 완료 체크</span></button>
      <button className="wide" onClick={() => openQuickSheet('')}><i>✍</i><b>빠른 메모</b><span>떠오른 생각을 입력하고 바로 저장</span></button>
      <button className="wide" onClick={() => { closeModal(); startRecording('memo') }}><i>🎙</i><b>음성 메모</b><span>말하면 메모 · 할 일로 정리</span></button>
    </div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>)
}

/* ----- 빠른 입력 칸 ----- */
export function QuickBox({ id, force, after }: { id: string; force: string; after?: () => void }) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const [manual, setManual] = useState(force)
  const [v, setV] = useState('')
  const p = parseQuick(v, manual)
  useEffect(() => { const t = ta.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(220, t.scrollHeight) + 'px' })
  const save = () => {
    if (!v.trim()) return
    const q = parseQuick(v, manual)
    addMemo({ '종류': q.type, '내용': q.text, '마감일': q.type === '할일' ? q.due : '', '마감시간': q.type === '할일' ? q.time : '' })
    setV(''); setManual(force)
    toast(q.type === '할일' ? '할 일에 넣었어요' : '메모했어요')
    if (after) after()
    setTimeout(() => ta.current?.focus(), 30)
  }
  return <div className="quick" id={id + '-box'}>
    <textarea ref={ta} id={id} rows={1} value={v} placeholder={force === '할일' ? '해야 할 일 (예: 금요일까지 책 반납)' : '메모나 할 일 (예: 내일 3시 치과, - 책 반납하기)'}
      onChange={e => setV(e.target.value)} onInput={e => setV((e.target as HTMLTextAreaElement).value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save() } }} />
    <div className="qbar"><button className={'qtype ' + (p.type === '할일' ? 'todo-on' : '')} type="button" onClick={() => { setManual(p.type === '할일' ? '메모' : '할일'); ta.current?.focus() }}>{p.type === '할일' ? '☑ 할 일' : '✎ 메모'}</button>
      <span className="qdue">{p.type === '할일' && p.due ? dueLabel(p.due, p.time) : ''}</span>
      <span className="vbtns"><button type="button" className="vbtn" title="받아쓰기" aria-label="받아쓰기" onClick={e => toggleDictate(e.currentTarget, id)}>🎤</button>
        <button type="button" className="vbtn" title="녹음 후 정리" aria-label="녹음 후 정리" onClick={() => startRecording('memo')}>🎙</button></span>
      <button className="btn primary" type="button" disabled={!v.trim()} onClick={save}>저장</button></div></div>
}
export function openQuickSheet(force: string) {
  modal(<><h3>{force === '할일' ? '할 일' : '빠른 메모'}</h3><QuickBox id="qq" force={force} after={closeModal} />
    <div className="small" style={{ marginTop: 8, color: 'var(--faint)' }}>"내일", "금요일", "10월 20일", "3시" 같은 말은 날짜로 알아들어요.</div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>)
  setTimeout(() => $('qq')?.focus(), 60)
}

/* ----- 메모 · 할 일 고치기 ----- */
function MemoForm({ id }: { id: string }) {
  const m = S.memos.find((x: Rec) => x.ID === id)
  const [type, setType] = useState(m && m['종류'] === '할일' ? '할일' : '메모')
  if (!m) return null
  const opts = S.books.slice().sort((a: Rec, b: Rec) => (a['상태'] === '읽는중' ? 0 : 1) - (b['상태'] === '읽는중' ? 0 : 1) || String(a['제목']).localeCompare(String(b['제목'])))
  const save = () => {
    const txt = ($<HTMLTextAreaElement>('m-txt')?.value || '').trim(); if (!txt) { toast('내용을 입력해 주세요'); return }
    patchMemo(id, { '종류': type, '내용': txt, '마감일': type === '할일' ? $('m-date')!.value : '', '마감시간': type === '할일' ? $('m-time')!.value : '', '책ID': ($<HTMLSelectElement>('m-book')?.value || '') })
    closeModal(); toast('저장했어요')
  }
  const toSnip = () => {
    const text = ($<HTMLTextAreaElement>('m-txt')?.value || '').trim() || m['내용']
    const bid = ($<HTMLSelectElement>('m-book')?.value) || m['책ID']
    const start = (b: string) => { go('book', b); openSnipForm(null, '생각', { text, type: '생각', ai: true, moveMemoId: id }) }
    closeModal()
    if (bid && book(bid)) setTimeout(() => start(bid), 30); else setTimeout(() => openBookPicker('어느 책의 필사로 옮길까요?', start, text.slice(0, 140)), 30)
  }
  return <>
    <h3>{type === '할일' ? '할 일' : '메모'} 고치기</h3>
    <div className="seg" id="mseg">{['메모', '할일'].map(t => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === '할일' ? '할 일' : '메모'}</button>)}</div>
    <label>내용</label><textarea className="field" id="m-txt" style={{ minHeight: 120 }} defaultValue={m['내용']} />
    <div id="m-due" className={type === '할일' ? '' : 'hidden'}><div className="row">
      <div><label>마감일</label><input className="field" type="date" id="m-date" defaultValue={String(m['마감일'] || '').slice(0, 10)} /></div>
      <div><label>시간</label><input className="field" type="time" id="m-time" defaultValue={m['마감시간'] || ''} /></div></div></div>
    <label>책과 잇기 <Faint>고르지 않아도 돼요</Faint></label>
    <select className="field" id="m-book" defaultValue={m['책ID'] || ''}><option value="">없음</option>{opts.map((b: Rec) => <option key={b.ID} value={b.ID}>{b['제목']}</option>)}</select>
    <div className="actions">
      <button className="btn danger" onClick={() => { if (!confirm('지울까요?')) return; deleteMemo(id); closeModal(); toast('지웠어요') }}>삭제</button>
      <button className="btn" onClick={toSnip}>필사로 옮기기</button>
      <button className="btn primary grow" onClick={save}>저장</button></div>
  </>
}
export function openMemo(id0: string) { const id = resolveId(id0); if (S.memos.some((x: Rec) => x.ID === id)) modal(<MemoForm id={id} />) }

/* ----- 책 고르기 (공유 · 빠른 입력 · 메모 옮기기 공통) ----- */
function BookPicker({ title, cb, peek, q0 }: { title: string; cb: (id: string) => void; peek?: string; q0?: string }) {
  const [q, setQ] = useState(q0 || '')
  const list = pickBooks(q)
  return <>
    <h3>{title}</h3>
    {peek && <div className="share-peek">{peek}{peek.length >= 140 ? '…' : ''}</div>}
    <input className="field" id="bp-q" type="search" placeholder="책 제목 · 저자 찾기" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" />
    <div className="share-list" id="bp-list">{list.length ? list.map(b => <button className="al-item" key={b.ID} onClick={() => { closeModal(); setTimeout(() => cb(b.ID), 20) }}><Spine b={b} /><div><b>{b['제목']}</b><span>{b['저자'] || ''}{b['상태'] === '읽는중' ? ' · 읽는 중' : ''}</span></div></button>)
      : <div className="al-msg">찾는 책이 없어요. 먼저 책을 추가해 주세요.</div>}</div>
    <div className="actions"><button className="btn" onClick={() => { S.shared = null; closeModal() }}>취소</button></div>
  </>
}
export function openBookPicker(title: string, cb: (id: string) => void, peek?: string, q?: string) { modal(<BookPicker title={title} cb={cb} peek={peek} q0={q} />) }

/* ----- + 버튼: 어디서든 빠르게 ----- */
export function openQuickMenu() {
  modal(<><h3>무엇을 남길까요?</h3>
    <div className="qmenu">
      <button onClick={openQuickRead}><b>📖 여기까지 읽었어요</b><span>읽는 중인 책에 쪽수 기록</span></button>
      <button onClick={() => openQuickSheet('')}><b>✎ 메모</b><span>떠오른 생각을 바로</span></button>
      <button onClick={() => { closeModal(); startRecording('memo') }}><b>🎙 음성 메모</b><span>말하면 메모 · 할 일로 정리</span></button>
      <button onClick={() => { closeModal(); newNote() }}><b>✍ 새 글</b><span>나만의 노트에 쓰기</span></button>
      <button onClick={() => openQuickSheet('할일')}><b>☑ 할 일</b><span>"금요일까지 반납"처럼 날짜도</span></button>
      <button onClick={quickSnip}><b>❝ 필사 쓰기</b><span>책을 고르고 문장 적기</span></button>
      <button onClick={() => { closeModal(); openBookForm(null) }}><b>📚 책 추가</b><span>새 책 등록</span></button>
    </div>
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>)
}
// 여기까지 읽었어요: 읽는 중인 책들에 바로 쪽수 넣기 (앱 아이콘 길게 눌러도 열려요)
function QuickRead() {
  const list = S.books.filter((b: Rec) => b['상태'] === '읽는중').sort((a: Rec, b: Rec) => String((logsOf(b.ID).slice(-1)[0] || {} as Rec).date || b['시작일'] || '').localeCompare(String((logsOf(a.ID).slice(-1)[0] || {} as Rec).date || a['시작일'] || '')))
  useEffect(() => { setTimeout(() => { const el = list[0] && $('qr-' + list[0].ID); if (el) el.focus() }, 80) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (id: string) => {
    const el = $('qr-' + id); if (!el) return
    const v = el.value.trim(); if (!v) { toast('몇 쪽까지 읽었는지 넣어 주세요'); return }
    closeModal(); readHere(id, v, x => finish(x, true))
  }
  return <>
    <h3>어디까지 읽었어요?</h3>
    {list.map((b: Rec) => { const p = progressOf(b), today = dailyOf(b.ID)[S.today] || 0, eb = platOf(b) === 'E북'
      return <div className="panel2" style={{ marginTop: 10 }} key={b.ID}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Spine b={b} /><div style={{ minWidth: 0, flex: 1 }}><b style={{ display: 'block', fontSize: 14 }}>{b['제목']}</b>
          <span className="small">{p ? `p.${p.cur} / ${p.total} · ${p.pct}%` : b['현재쪽수'] ? `p.${b['현재쪽수']}` : '아직 기록 없음'}{today ? ` · 오늘 +${today}쪽` : ''}</span></div></div>
        <div className="inline" style={{ marginTop: 8 }}><input className="field" id={'qr-' + b.ID} inputMode="decimal" placeholder={eb ? '몇 쪽? 또는 45%' : '몇 쪽까지?'} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(b.ID) } }} />
          <button type="button" className="btn pct-btn" title="%로 넣기" onClick={() => { const f = $('qr-' + b.ID)!; const v = f.value.trim(); f.value = /%$/.test(v) ? v.replace(/%/g, '') : v.replace(/%/g, '') + '%'; f.focus() }}>%</button>
          <button className="btn primary" onClick={() => save(b.ID)}>기록</button></div></div> })}
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div>
  </>
}
export function openQuickRead() {
  if (!S.books.some((b: Rec) => b['상태'] === '읽는중')) { toast('읽는 중인 책이 없어요'); return }
  modal(<QuickRead />)
}
export function quickSnip() { openBookPicker('어느 책의 필사인가요?', id => { go('book', id); openSnipForm(null) }) }
// 앱 아이콘 길게 누르기 → 빠른 메모 · 할 일 · 필사
export function takeQuick(): boolean {
  const sp = new URLSearchParams(location.search)
  const q = sp.get('quick'); if (!q) return false
  history.replaceState(Object.assign({}, history.state, { view: S.view, id: S.bookId || '' }), '', location.pathname)
  if (q === 'read') openQuickRead(); else if (q === 'memo') openQuickSheet(''); else if (q === 'todo') openQuickSheet('할일'); else if (q === 'snip') quickSnip(); else if (q === 'note') newNote(); else if (q === 'voice') startRecording('memo')
  return true
}
