/* 메모 · 할 일 — 예전 memo.js */
import { S, emit, WD, ymd, dateOf, dayDiff, localToday, uid, resolveId, type Rec } from './core'
import { queue, upsertLocal } from './store/local'
import { toast } from './ui'

// "내일 3시 치과", "- 책 반납하기", "다음주 수요일까지 보고서" → { type, due, time, text }
export function parseQuick(raw: string, forceType?: string) {
  let t = String(raw || '').trim(), type = forceType || '', due = '', time = ''
  const today = dateOf(S.today || localToday())
  const add = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d) }
  const mark = t.match(/^\s*(?:[-*•]|\[\s?\]|☐|□|할\s?일\s*[:：])\s*/)
  if (mark) { type = type || '할일'; t = t.slice(mark[0].length) }
  const cut = (re: RegExp) => { const m = t.match(re); if (m) t = (t.slice(0, m.index) + ' ' + t.slice((m.index || 0) + m[0].length)).trim(); return m }
  let m: RegExpMatchArray | null
  if ((m = cut(/(오늘|내일|모레|글피)(?:\s*까지)?/))) due = add(({ 오늘: 0, 내일: 1, 모레: 2, 글피: 3 } as Record<string, number>)[m[1]])
  else if ((m = cut(/(이번\s?주|다음\s?주|담주)?\s*([월화수목금토일])요일(?:\s*까지)?/))) {
    const want = WD.indexOf(m[2]), cur = today.getDay()
    const mon = (cur + 6) % 7, wantMon = (want + 6) % 7
    let diff: number
    if (!m[1]) diff = (want - cur + 7) % 7
    else if (/이번/.test(m[1])) diff = wantMon - mon
    else diff = 7 - mon + wantMon
    due = add(diff)
  } else if ((m = cut(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s*까지)?/))) due = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  else if ((m = cut(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*까지)?/)) || (m = cut(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s*까지)?(?=\s|$)/))) {
    const y = today.getFullYear(); const mm = Number(m[1]), dd = Number(m[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let d = new Date(y, mm - 1, dd); if (d.getTime() < today.getTime() - 86400000 * 30) d = new Date(y + 1, mm - 1, dd)
      due = ymd(d)
    }
  } else if ((m = cut(/(\d{1,2})\s*일\s*(?:뒤|후)/))) due = add(Number(m[1]))
  else if ((m = cut(/(이번\s?주말|주말)/))) due = add((6 - today.getDay() + 7) % 7)
  else if ((m = cut(/다음\s?주(?:\s*까지)?/))) due = add(7 - ((today.getDay() + 6) % 7))
  if ((m = cut(/(오전|오후|아침|저녁|밤|낮)?\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*(반))?/)) || (m = cut(/(?:^|\s)()(\d{1,2}):(\d{2})(?=\s|$)/))) {
    let h = Number(m[2]); const mi = Number(m[3] || (m[4] ? 30 : 0))
    if (/오후|저녁|밤/.test(m[1] || '') && h < 12) h += 12
    if (!m[1] && h >= 1 && h <= 7) h += 12   // "3시"는 보통 오후
    if (h <= 24 && mi < 60) { time = String(h % 24).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); if (!due) due = add(0) }
  }
  t = t.replace(/\s{2,}/g, ' ').replace(/^\s*(?:에|까지|,)\s*/, '').trim()
  const verbTodo = /(하기|할\s?것|해야\s?(?:함|해|돼)|사기|보내기|챙기기|예약|신청|반납|제출|연락|전화)[.!]?\s*$/.test(t)
  const sentence = /(다|요|네|죠|음|어|야|지)[.!?~]*\s*$/.test(t)   // "오늘 읽은 책이 좋았다" 같은 문장은 메모
  if (!type) type = (verbTodo || ((due || time) && !sentence)) ? '할일' : '메모'
  if (type === '메모') return { type, due: '', time: '', text: String(raw || '').trim().replace(mark ? mark[0] : '', '').trim() || String(raw || '').trim() }
  return { type, due, time, text: t || String(raw || '').trim() }
}
export function dueLabel(due: string, time?: string) {
  if (!due) return ''
  const d = dayDiff(due) as number, wd = WD[dateOf(due).getDay()]
  const md = `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}(${wd})`
  const word = d === 0 ? '오늘' : d === 1 ? '내일' : d === 2 ? '모레' : d < 0 ? `${-d}일 지남` : md
  return word + (d >= 0 && d <= 2 ? ' ' + md : '') + (time ? ' ' + time : '')
}
export const isDone = (m: Rec) => m['완료'] === true || m['완료'] === 'TRUE' || m['완료'] === 'true'

export function addMemo(fields: Rec) {
  const data = Object.assign({ ID: 'T' + uid(), '종류': '메모', '내용': '', '완료': false, '마감일': '', '마감시간': '', '책ID': '' }, fields)
  const local = Object.assign({ '작성일': S.today }, data)
  upsertLocal('memos', local); queue({ fn: 'saveMemo', data, local })
  emit()
  return local
}
export function patchMemo(id0: string, patch: Rec) {
  const id = resolveId(id0)
  const cur = S.memos.find((x: Rec) => x.ID === id); if (!cur) return
  const local = Object.assign({}, cur, patch)
  if ('완료' in patch) local['완료일'] = patch['완료'] ? S.today : ''
  upsertLocal('memos', local)
  const data: Rec = {}; ['ID', '종류', '내용', '완료', '마감일', '마감시간', '책ID'].forEach(k => data[k] = local[k] ?? '')
  queue({ fn: 'saveMemo', data, local })
  emit()
}
export function deleteMemo(id0: string) { const id = resolveId(id0); S.memos = S.memos.filter((x: Rec) => x.ID !== id); queue({ fn: 'deleteMemo', id }); emit() }
export function toggleTodo(id0: string) {
  const id = resolveId(id0)
  const m = S.memos.find((x: Rec) => x.ID === id); if (!m) return
  const now = !isDone(m)
  patchMemo(id, { '완료': now })
  if (now) toast('끝냈어요 ✓')
}
// 책 고르기 (공유 · 빠른 입력 · 메모 옮기기 공통)
export function pickBooks(q: string) {
  const order: Record<string, number> = { '읽는중': 0, '완독': 1, '읽을예정': 2 }
  const nq = String(q || '').toLowerCase().replace(/\s+/g, '')
  return S.books.filter((b: Rec) => !nq || (String(b['제목']) + String(b['저자'])).toLowerCase().replace(/\s+/g, '').includes(nq))
    .sort((a: Rec, b: Rec) => (order[a['상태']] ?? 3) - (order[b['상태']] ?? 3) || String(b['시작일'] || b['등록일'] || '').localeCompare(String(a['시작일'] || a['등록일'] || '')))
    .slice(0, 30) as Rec[]
}
