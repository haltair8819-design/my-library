/* AI 비서 — 내 필사 · 글 · 메모를 근거로 답해요 (예전 ai.js) */
import { useEffect, useRef } from 'react'
import { S, emit, pgLabel, type Rec } from '../lib/core'
import { Store } from '../lib/store/server'
import { call } from '../lib/book'
import { refresh } from '../lib/store/local'
import { go } from '../lib/nav'
import { toast, errMsg } from '../lib/ui'
import { noteOf, openNote } from '../lib/notes'
import { openSnipInBook } from './Book'
import { openMemo } from './Records'

S.chat = []
const AI_SUGGEST = ['올해 내 독서를 한눈에 요약해줘', '내 필사에서 ‘자유’에 대한 문장을 찾아줘', '에리히 프롬 책들에서 공통으로 다루는 주제를 정리해줘', '내 기록을 보고 다음에 읽을 책을 추천해줘']
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
function mdLite(t: unknown) {
  const lines = esc(String(t || '')).split('\n')
  let html = '', list: string | null = null
  const close = () => { if (list) { html += `</${list}>`; list = null } }
  lines.forEach(l => {
    const ul = l.match(/^\s*[-*•]\s+(.*)$/), ol = l.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) { const tag = ul ? 'ul' : 'ol'; if (list !== tag) { close(); html += `<${tag}>`; list = tag } html += `<li>${(ul || ol)![1]}</li>` }
    else if (!l.trim()) close()
    else { close(); html += `<p>${l.replace(/^#+\s*/, '')}</p>` }
  })
  close()
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}
function openCite(id: string) {
  if (id[0] === 'N') { if (noteOf(id)) openNote(id); else toast('그 글을 찾지 못했어요'); return }
  if (id[0] === 'M') { if (S.memos.some((m: Rec) => m.ID === id)) { go('notes'); setTimeout(() => openMemo(id), 60) } return }
  if (S.snips.some((x: Rec) => x.ID === id)) openSnipInBook(id)
}
function Msg({ m }: { m: Rec }) {
  if (m.role === 'user') return <div className="msg user">{m.text}</div>
  if (m.pending) return <div className="msg bot"><span className="thinking">내 기록을 찾아보는 중</span></div>
  if (m.error) return <div className="msg bot err">{m.error}</div>
  const order = (m.cites || []).map((c: Rec) => c.id)
  const body = mdLite(m.text).replace(/\[([SNM][A-Za-z0-9]{5,24})\]/g, (_all, id) => { const i = order.indexOf(id); return i < 0 ? '' : `<span class="cite" data-cite="${id}">${i + 1}</span>` })
  return <div className="msg bot"><div onClick={e => { const c = (e.target as HTMLElement).closest('[data-cite]') as HTMLElement | null; if (c) openCite(c.dataset.cite!) }} dangerouslySetInnerHTML={{ __html: body }} />
    {order.length > 0 && <div className="sources">{m.cites.map((c: Rec, i: number) => <button key={i} onClick={() => openCite(c.id)}><b>{i + 1}</b>{c.book}{c.page !== '' && c.page != null ? ' · ' + pgLabel(c.page) : ''}{c.title ? ' · ' + c.title : ''}</button>)}</div>}</div>
}
async function askAI(q0: string) {
  const q = String(q0 || '').trim()
  if (!q || S.chat.some((m: Rec) => m.pending)) return
  const history = S.chat.filter((m: Rec) => !m.pending && !m.error).map((m: Rec) => ({ role: m.role, text: m.text }))
  S.chat.push({ role: 'user', text: q })
  const bot: Rec = { role: 'assistant', pending: true }
  S.chat.push(bot); emit()
  try { const r = await Store.run('askAssistant', q, history); Object.assign(bot, { pending: false, text: r.answer, cites: r.cites }) } catch (e) { Object.assign(bot, { pending: false, error: '답을 받지 못했어요: ' + errMsg(e) }) }
  emit()
}
export function AIView() {
  const ta = useRef<HTMLTextAreaElement>(null)
  const emptyKw = S.snips.filter((s: Rec) => !String(s['키워드'] || '').trim()).length
  useEffect(() => { if (S.chat.length) setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30) }, [S.chat.length])  // eslint-disable-line react-hooks/exhaustive-deps
  const grow = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(140, el.scrollHeight) + 'px' }
  const send = () => { const el = ta.current; if (!el) return; const v = el.value; el.value = ''; grow(); askAI(v) }
  const runAuto = async (btn: HTMLButtonElement) => {
    btn.disabled = true; btn.textContent = '키워드 다는 중… (몇 분 걸려요)'
    try { const r = await call('autoKeywords'); await refresh(true); toast(r.message) } catch { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'AI로 키워드 달기' } }
  }
  return <section id="v-ai">
    <div className="view-head ai-head"><div><h1>AI 비서</h1><p>내 서재와 필사 노트를 찾아보고 답해요. 근거가 된 필사는 번호로 표시해요.</p></div>
      {S.chat.length > 0 && <button className="btn" onClick={() => { S.chat = []; emit() }}>새 대화</button>}</div>
    {emptyKw > 0 && <div className="tool"><span>키워드가 빈 필사 <b>{emptyKw.toLocaleString()}</b>개</span>
      <button className="btn primary" id="kw-all" onClick={e => runAuto(e.currentTarget)}>AI로 키워드 달기</button></div>}
    <div className="chat" id="chat">{S.chat.length ? S.chat.map((m: Rec, i: number) => <Msg key={i} m={m} />) :
      <div className="suggest-q">{AI_SUGGEST.map(q => <button key={q} onClick={() => askAI(q)}>{q}</button>)}</div>}</div>
    <div className="composer" id="composer"><div className="wrap">
      <textarea ref={ta} id="ai-q" rows={1} placeholder="내 필사 · 글 · 메모에 대해 물어보세요" onInput={grow}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
      <button className="btn primary" onClick={send}>보내기</button>
    </div></div>
  </section>
}
