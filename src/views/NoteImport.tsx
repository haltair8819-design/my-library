/* 삼성노트 txt 가져오기 — <제목> 한 덩어리 = 필사 1개 (제목 · 내용 · 쪽수)
 * 같은 책의 같은 노트를 다시 올리면 예전에 가져온 문장만 새로 바꿔요. 앱에서 직접 쓴 문장은 그대로, 같은 문장의 키워드는 지켜요. */
import { useState } from 'react'
import { S, emit, book, sText, uid, type Rec } from '../lib/core'
import { bookSnipShared } from '../lib/book'
import { queue, upsertLocal } from '../lib/store/local'
import { niNorm } from '../lib/together'
import { modal, closeModal, toast } from '../lib/ui'
import { Sub } from '../components/common'

const NI_QUOTE_START = /^["'“”‘’「『]/
const NI_PG = '(\\d{1,4}(?:\\s*[,~\\-]\\s*\\d{1,4})*)'
const NI_PAGE_ONLY = new RegExp('^\\(?\\s*(?:p\\.?\\s*' + NI_PG + '|' + NI_PG + '\\s*(?:p|P|쪽|페이지))\\s*\\)?\\.?$')
const NI_PAGE_TAIL = new RegExp('\\s*\\(?\\s*(?:p\\.?\\s*' + NI_PG + '|' + NI_PG + '\\s*(?:p|P|쪽|페이지))\\s*\\)?\\.?\\s*$')
const NI_CHAPTER = /^[<〈《]\s*(.+?)\s*[>〉》]$/
const NI_META_SKIP = /^(?:시작일|완독일|독서\s*기간|읽은\s*기간)\s*[:：]/
const NI_ONE_LINE = /^한\s*줄\s*평\s*[:：]\s*(.+)$/
const NI_QUOTE_PAGE = /(["'“”‘’」』])\s*(\d{1,4})\s*\.?$/
function niPageVal(s0: string): string | number { const s = String(s0).trim(); if (/^\d+$/.test(s)) return Number(s); return s.replace(/\s*[~-]\s*/g, '~').replace(/\s*,\s*/g, ', ') }
type Item = { title: string; type: string; text: string; page: string | number }
// 노트 글 → [{title, type, text, page}]
export function parseNoteText(text: string, opt: { essay?: boolean } = {}): Item[] {
  const lines = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n')
  const out: Item[] = []; let title = '', cur: string[] | null = null
  const addPage = (list: string[], v: unknown) => String(v).split(/\s*,\s*/).forEach(x => { if (x && !list.includes(x)) list.push(x) })
  const flush = () => {
    if (!cur) return
    const pages: string[] = [], paras: string[][] = []; let para: string[] = []
    cur.forEach(t0 => {
      let t = t0
      if (!t) { if (para.length) { paras.push(para); para = [] } return }
      let m = t.match(NI_PAGE_ONLY)
      if (m) { addPage(pages, niPageVal(m[1] || m[2])); return }
      m = t.match(NI_PAGE_TAIL)
      if (m && t.length > m[0].length) { addPage(pages, niPageVal(m[1] || m[2])); t = t.slice(0, t.length - m[0].length).trim() }
      else { m = t.match(NI_QUOTE_PAGE); if (m) { addPage(pages, m[2]); t = t.slice(0, t.length - m[0].length + m[1].length).trim() } }
      if (t) para.push(t)
    })
    if (para.length) paras.push(para)
    const body = paras.map(p => p.join('\n')).join('\n\n').trim()
    cur = null
    if (!body) return
    pages.sort((x, y) => parseInt(x, 10) - parseInt(y, 10))
    const page = pages.length === 1 ? niPageVal(pages[0]) : pages.join(', ')
    const type = opt.essay ? '생각' : (pages.length || NI_QUOTE_START.test(body)) ? '인용' : '메모'
    out.push({ title, type, text: body.slice(0, 45000), page })
  }
  lines.forEach(raw => {
    const t = raw.trim()
    const ch = t.match(NI_CHAPTER)
    if (ch) { flush(); title = ch[1].trim(); cur = []; return }
    if (NI_META_SKIP.test(t)) return
    const one = t.match(NI_ONE_LINE)
    if (one) { out.push({ title: '한줄평', type: '메모', text: one[1].trim(), page: '' }); return }
    if (!cur) { if (!t) return; cur = [] }
    cur.push(t)
  })
  flush()
  return out
}
// 파일 이름 → 책
function niLongest(a: string, b: string) { let best = 0; for (let i = 0; i < a.length; i++) for (let j = i + best + 1; j <= a.length; j++) { if (b.includes(a.slice(i, j))) best = j - i; else break } return best }
const niFileKey = (name: string) => String(name).replace(/\.[^.]+$/, '').replace(/_\d{6}_\d{6}$/, '').replace(/\s+/g, ' ').trim()
export function matchBookByFile(fileName: string, books: Rec[]) {
  const base = String(fileName).replace(/\.[^.]+$/, '').replace(/_\d{6}_\d{6}$/, '').replace(/^독서\s*노트/, '')
  const fn = niNorm(base)
  let best: Rec | null = null, bestScore = 0
  books.forEach(b => {
    const full = niNorm(b['제목']); if (!full) return
    const paren = (String(b['제목']).match(/\(([^)]*)\)/) || [])[1] || ''
    const core = niNorm(String(b['제목']).replace(/\([^)]*\)/g, '')), parenN = niNorm(paren)
    const digits = String(b['제목']).match(/\d+/g) || []
    if (digits.some(d => !fn.includes(d))) return
    let score = 0
    if (fn.includes(full)) score = 100 + full.length
    else {
      if (parenN && !fn.includes(parenN) && /편|권|판/.test(paren)) return
      if (core.length >= 2 && fn.includes(core)) score = 50 + core.length
      else {
        const words = String(b['제목']).replace(/\([^)]*\)/g, ' ').split(/\s+/).map(niNorm).filter(Boolean)
        const hit = words.filter(w => fn.includes(w) || (w.length > 2 && /의$/.test(w) && fn.includes(w.slice(0, -1))))
        const cover = hit.join('').length / Math.max(1, words.join('').length)
        const lcs = niLongest(core, fn)
        if (cover >= 0.75) score = hit.join('').length
        else if (lcs >= Math.max(4, Math.ceil(core.length * 0.7))) score = lcs
      }
    }
    if (score > bestScore) { bestScore = score; best = b }
  })
  return bestScore >= 4 ? best as Rec | null : null
}
async function decodeTextFile(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer())
  let enc = 'utf-8'
  if (buf[0] === 0xff && buf[1] === 0xfe) enc = 'utf-16le'; else if (buf[0] === 0xfe && buf[1] === 0xff) enc = 'utf-16be'
  return new TextDecoder(enc).decode(buf).replace(/^﻿/, '')
}
type NF = { name: string; key: string; items: Item[]; bookId: string }
function NoteImport() {
  const [files, setFiles] = useState<NF[]>([])
  const opts = S.books.slice().sort((a: Rec, b: Rec) => String(a['제목']).localeCompare(String(b['제목'])))
  const pick = async (list: FileList | null) => {
    const next = files.slice()
    for (const f of [...(list || [])]) {
      const text = await decodeTextFile(f)
      const b = matchBookByFile(f.name, S.books)
      next.push({ name: f.name, key: niFileKey(f.name), items: parseNoteText(text, { essay: /감상/.test(f.name) }), bookId: b ? (b as Rec).ID : '' })
    }
    setFiles(next)
  }
  const apply = () => {
    let add = 0, del = 0
    files.filter(f => f.bookId && f.items.length).forEach(f => {
      const b = book(f.bookId)
      const old = S.snips.filter((s: Rec) => s['책ID'] === f.bookId && (s['출처'] === '노트파일' || s['출처'] === 'PDF') && niFileKey(s['원본파일'] || '') === f.key)
      const keepKw: Record<string, string> = {}; old.forEach((s: Rec) => { if (s['키워드']) keepKw[sText(s)] = s['키워드'] })
      old.forEach((s: Rec) => { S.snips = S.snips.filter((x: Rec) => x.ID !== s.ID); queue({ fn: 'deleteSnippet', id: s.ID }); del++ })
      f.items.forEach(it => {
        const data: Rec = { ID: 'T' + uid(), '책ID': f.bookId, '유형': it.type, '제목': it.title || '', '내용': it.text, '쪽수': it.page === undefined ? '' : String(it.page), '키워드': keepKw[it.text] || '', '출처': '노트파일', '원본파일': f.key }
        if (bookSnipShared(b) && it.type !== '메모') data['공개'] = true   // 책 전체 보여주기면
        const local = Object.assign({ '작성일': S.today, '책제목': (b || {})['제목'] || '' }, data)
        upsertLocal('snips', local); queue({ fn: 'saveSnippet', data, local }); add++
      })
    })
    closeModal(); emit(); toast(`노트에서 ${add}개를 가져왔어요${del ? ` (예전에 가져온 ${del}개는 새로 바꿈)` : ''}`)
  }
  const ready = files.some(f => f.bookId && f.items.length)
  return <>
    <h3>노트 파일 가져오기 <Sub>삼성노트 → 텍스트(.txt)로 내보낸 파일</Sub></h3>
    <div className="small" style={{ lineHeight: 1.7 }}>파일 이름으로 책을 찾아요. &lt;제목&gt; 아래 글이 필사 하나가 되고, 끝의 "36, 37p"는 쪽수로 들어가요.
      같은 노트를 다시 올리면 예전에 가져온 문장만 새로 바꿔요. 앱에서 직접 쓴 문장은 그대로예요.</div>
    <label className="btn primary" style={{ display: 'block', textAlign: 'center', marginTop: 12, cursor: 'pointer' }}>txt 파일 고르기 (여러 개 가능)
      <input type="file" accept=".txt,text/plain" multiple hidden onChange={e => pick(e.target.files)} /></label>
    <div id="ni-list">{files.map((f, i) => <div className="panel2" style={{ marginTop: 10 }} key={i}>
      <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>{f.name}</div>
      <div className="small" style={{ margin: '4px 0 6px' }}>{f.items.length ? `필사 ${f.items.filter(x => x.type !== '생각').length}개 · 내 생각 ${f.items.filter(x => x.type === '생각').length}개` : '⚠ <제목>이나 내용을 찾지 못했어요'}</div>
      <select className="field" value={f.bookId} onChange={e => setFiles(files.map((x, j) => j === i ? { ...x, bookId: e.target.value } : x))}><option value="">{f.bookId ? '' : '⚠ '}책을 골라 주세요</option>
        {opts.map((b: Rec) => <option key={b.ID} value={b.ID}>{b['제목']}</option>)}</select></div>)}</div>
    <div className="actions"><button className="btn" onClick={closeModal}>닫기</button>{ready && <button className="btn primary grow" id="ni-go" onClick={apply}>가져오기</button>}</div>
  </>
}
export function openNoteImport() { modal(<NoteImport />) }
