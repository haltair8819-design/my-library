/* 나만의 노트 — 데이터 · 계산 (예전 notes.js) */
import { S, emit, book, uniq, uid, resolveId, splitKw, sText, isThought, hasPage, type Rec } from './core'
import { queue } from './store/local'
import { go } from './nav'
import { keywordCounts } from './graph'

export const NOTE_STATES = ['메모', '초안', '완성', '발행']
export const noteOf = (id: string | null | undefined): Rec | undefined => S.notes.find((n: Rec) => n.ID === resolveId(id))
export function wordStats(t0: unknown) {
  const t = String(t0 || '')
  const all = t.replace(/\n/g, '').length, nows = t.replace(/\s/g, '').length
  return { all, nows, ms: Math.ceil(all / 200), min: Math.max(1, Math.round(nows / 500)) }
}
export function plainText(t: unknown) { return String(t || '').replace(/^#{1,3}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[\[(.+?)\]\]/g, '$1') }
export function queueNote(n: Rec, snapshot: boolean) {
  const data: Rec = {}; ['ID', '제목', '본문', '상태', '묶음', '키워드', '발행링크'].forEach(k => data[k] = n[k] ?? '')
  queue({ fn: 'saveNote', data, local: Object.assign({}, n), args: [!!snapshot] })
}
export function deleteNote(id0: string) { const id = resolveId(id0); S.notes = S.notes.filter((x: Rec) => x.ID !== id); queue({ fn: 'deleteNote', id }); emit() }
// 글감: 기록 탭을 열 때마다 바뀌는 내 필사 하나
export function writingSeed(): Rec | null {
  const pool = S.snips.filter((s: Rec) => !isThought(s) && sText(s).length > 60 && sText(s).length < 600)
  if (!pool.length) return null
  if (S.seedRand == null) S.seedRand = Math.random()
  return pool[Math.floor(S.seedRand * pool.length) % pool.length]
}
export function quoteBlock(s: Rec) {
  const b = book(s['책ID']) || {}
  return sText(s).trim().split('\n').map(l => '> ' + l).join('\n') + `\n> — 『${b['제목'] || ''}』${hasPage(s) ? ', p.' + s['쪽수'] : ''}`
}
export function newNote(seedId?: string) {
  const s = seedId ? S.snips.find((x: Rec) => x.ID === seedId) : null
  const body = s ? quoteBlock(s) + '\n\n' : ''
  const n = { ID: 'T' + uid(), '제목': '', '본문': body, '상태': '초안', '묶음': '', '키워드': s ? s['키워드'] || '' : '', '발행링크': '', '작성일': S.today, '수정일': S.today, '수정시각': Date.now() }
  S.notes.push(n)
  S.noteRead = false; S.noteDirty = false
  go('note', n.ID)
  setTimeout(() => { const t = document.getElementById('ne-title'); if (t) t.focus() }, 60)
}
export function openNote(id: string) { const n = noteOf(id); S.noteRead = !!(n && String(n['본문']).length > 0); go('note', resolveId(id)) }

/* ----- [[링크]] ----- */
export const normT = (t: unknown) => String(t || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^0-9a-z가-힣]/g, '')
export function resolveLink(t: string): { kind: 'book' | 'note'; id: string } | null {
  const k = normT(t)
  const b = S.books.find((x: Rec) => normT(x['제목']) === k) || S.books.find((x: Rec) => k.length >= 3 && normT(x['제목']).startsWith(k))
  if (b) return { kind: 'book', id: b.ID }
  const n = S.notes.find((x: Rec) => normT(x['제목']) === k)
  if (n) return { kind: 'note', id: n.ID }
  return null
}
// 이 글 · 이 책을 [[ ]]로 언급한 글
export function notesLinkingHere(target: Rec): Rec[] {
  const keys = [target['제목']].map(normT).filter(Boolean)
  if (!keys.length) return []
  return S.notes.filter((n: Rec) => n !== target && [...String(n['본문']).matchAll(/\[\[(.+?)\]\]/g)].some(m => keys.includes(normT(m[1]))))
}
/* ----- 연결된 필사: 쓰는 글과 맞는 내 필사 ----- */
export function relatedSnips(n: Rec, limit?: number): Rec[] {
  const text = (String(n['제목']) + ' ' + String(n['본문'])).toLowerCase()
  const kws = splitKw(n['키워드'])
  const linked = [...String(n['본문']).matchAll(/\[\[(.+?)\]\]/g)].map(m => m[1].trim())
  const linkedBooks = new Set(S.books.filter((b: Rec) => linked.some(t => normT(b['제목']) === normT(t))).map((b: Rec) => b.ID))
  const words = uniq((text.match(/[가-힣a-z]{2,}/g) || []).map(w => w.replace(/(은|는|이|가|을|를|에|의|와|과|도|로|으로|에서|에게|까지|부터|처럼|이다|했다|한다|하는|하고)$/, '')).filter(w => w.length >= 2)).slice(0, 80)
  const cnt = keywordCounts()
  const scored = S.snips.map((s: Rec) => {
    const sk = splitKw(s['키워드']); let sc = 0
    kws.forEach(k => { if (sk.includes(k)) sc += 6 })
    sk.forEach(k => { if (text.includes(k.toLowerCase())) sc += 3 })
    if (linkedBooks.has(s['책ID'])) sc += 5
    const body = String(s['내용']).toLowerCase()
    let hit = 0; words.forEach(w => { if (w.length >= 2 && body.includes(w) && !(cnt[w] > 120)) hit++ })
    sc += Math.min(6, hit)
    if (String(n['본문']).includes(String(s['내용']).slice(0, 30))) sc = -1   // 이미 넣은 문장
    return { s, sc }
  }).filter((x: Rec) => x.sc >= 3).sort((a: Rec, b: Rec) => b.sc - a.sc)
  return scored.slice(0, limit || 30).map((x: Rec) => x.s)
}
