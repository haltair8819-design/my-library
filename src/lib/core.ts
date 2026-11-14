/* 나의 서재 — 앱 상태(S) · 공통 도우미
 * 예전 앱(legacy/js/core.js)과 같은 이름 · 같은 동작. 화면은 S를 읽고, 바꾼 뒤에는 emit()으로 다시 그려요. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = Record<string, any>

export const LS = {
  get(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); return true } catch { return false } },
  del(k: string) { try { localStorage.removeItem(k) } catch { /* 무시 */ } },
}

export type View = 'library' | 'book' | 'graph' | 'stats' | 'ai' | 'memo' | 'blist' | 'notes' | 'note' | 'more' | 'snips'
  | 'together' | 'pbook' | 'plib' | 'settings' | 'life' | 'share' | 'shared' | 'req'

/* ===== 상태 ===== */
export const S: Rec = {
  books: [] as Rec[], snips: [] as Rec[], memos: [] as Rec[], logs: [] as Rec[], notes: [] as Rec[],
  today: '', filter: '읽는중', q: '', view: 'library' as View, bookId: null as string | null,
  settings: { goal: '', libraryUrl: '', libraryName: '' } as Rec,
  outbox: [] as Rec[], idMap: {} as Record<string, string>, syncState: '',
  todayShift: 0, hitLimit: 30, scrollMem: {} as Record<string, number>,
  allKind: '필사', allQ: '', allLimit: 50, bookTab: '필사',
  loaded: false, ver: '',
}

/* ===== 다시 그리기 ===== */
let version = 0
const listeners = new Set<() => void>()
export function emit() { version++; listeners.forEach(f => f()) }
export function subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } }
export const getVersion = () => version

export const FILTERS = ['읽는중', '읽을예정', '완독', '전체']
export const FILTER_LABEL: Record<string, string> = { '읽는중': '읽는 중', '읽을예정': '읽고 싶은' }

/* ===== 도우미 ===== */
export const PALETTE = ['#5B7A6A', '#8C5E4A', '#4F6684', '#8A7347', '#6E5A80', '#3F7378', '#94604F', '#5E6E45', '#7A4E64', '#55657A']
export const PALETTE_BUNKO = ['#2B5797', '#B23A48', '#2E7D5B', '#C0841A', '#5B4B8A', '#1F7A8C', '#8C3B6E', '#3E4A61', '#A0522D', '#4F7A28']
export function spineColor(b: Rec) {
  const k = String(b['대분류'] || b['제목'] || ''); let h = 0
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const P = document.documentElement.dataset.theme === 'bunko' ? PALETTE_BUNKO : PALETTE
  return P[h % P.length]
}
export const book = (id: string | null | undefined): Rec | undefined => S.books.find((b: Rec) => b.ID === id)
export const snipsOf = (id: string): Rec[] => S.snips.filter((s: Rec) => s['책ID'] === id)
// 칸은 두 개: 필사(책 문장, ＋메모 달기 가능) · 내 생각 / 메모. 예전 '서평'은 내 생각으로
export const isThought = (s: Rec) => s['유형'] === '생각' || s['유형'] === '서평' || s['유형'] === '메모'
export const KIND_LABEL: Record<string, string> = { '필사': '필사', '생각': '내 생각 · 메모' }
// 필사에 단 메모는 내용 끝에 "[메모]" 한 줄로 붙여 저장해요
export const MEMO_SEP = '\n\n[메모] '
export function sText(s: Rec | null | undefined) { const t = String((s && s['내용']) || ''); const i = t.indexOf(MEMO_SEP); return i >= 0 ? t.slice(0, i) : t }
export function sMemo(s: Rec | null | undefined) { const t = String((s && s['내용']) || ''); const i = t.indexOf(MEMO_SEP); return i >= 0 ? t.slice(i + MEMO_SEP.length).trim() : '' }
const EBOOK_RE = /e\s*북|ebook|전자책|밀리|리디|윌라|크레마|yes24\s*e|예스24\s*e|교보\s*e|킨들|kindle/i
export function platOf(b: Rec) {
  const p = String(b['플랫폼'] || '').trim()
  if (/오디오/.test(p)) return '오디오북'
  if (/종이/.test(p)) return '종이책'
  if (EBOOK_RE.test(p)) return 'E북'
  if (!p && /윌라|오디오/.test(String(b['경로'] || ''))) return '오디오북'
  if (!p && EBOOK_RE.test(String(b['경로'] || ''))) return 'E북'
  return '종이책'
}
export const PLATS = ['종이책', 'E북', '오디오북']
export function uniq<T>(arr: T[]): T[] { return [...new Set(arr.filter(Boolean))] }
export function period(b: Rec) {
  if (!b['시작일']) return ''
  const s = String(b['시작일']).slice(5).replace('-', '.')
  if (!b['완독일']) return s + ' ~'
  return s + ' ~ ' + String(b['완독일']).slice(5).replace('-', '.')
}
export function splitKw(k: unknown): string[] { return String(k || '').split(',').map(x => x.trim()).filter(Boolean) }
export function normKw(k: unknown) { return uniq(String(k || '').split(/[,#\n]/).map(x => x.trim())).join(', ') }

/* ===== 날짜 ===== */
export function localToday() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }
export const WD = ['일', '월', '화', '수', '목', '금', '토']
export function ymd(d: Date) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
export function dateOf(s: string) { return new Date(String(s).slice(0, 10) + 'T00:00:00') }
export function dayDiff(dateStr: unknown): number | null {
  if (!dateStr) return null
  const a = new Date(S.today + 'T00:00:00').getTime(), b = new Date(String(dateStr).slice(0, 10) + 'T00:00:00').getTime()
  if (isNaN(b)) return null
  return Math.round((b - a) / 86400000)
}
export function addDays(dateStr: string, n: number) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + Math.round(n)); return ymd(d) }
export function starText(n: unknown) { const k = Number(n) || 0; return k ? '★'.repeat(k) + '☆'.repeat(5 - k) : '' }
export const pickText = (d: number) => d < 0 ? (-d) + '일 지남' : d === 0 ? '오늘 수령' : 'D-' + d

/* ===== 쪽수 ===== */
export function firstPage(v: unknown) { const m = String(v ?? '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null }
// E북 위치: '45%'처럼 적으면 그대로 45%로 보이고, 정렬할 땐 분량(쪽수)으로 바꿔서 쪽수로 적은 필사와 섞어요
export const isPctPage = (v: unknown) => /%\s*$/.test(String(v ?? '').trim())
export function snipPage(s: Rec, bk?: Rec) {
  const v = s && s['쪽수'], n = firstPage(v); if (n == null) return null
  if (!isPctPage(v)) return n
  const b = bk || book(s['책ID']), t = Number(b && b['분량']) || 0
  return t ? Math.round(t * Math.min(100, n) / 100 * 10) / 10 : n
}
export function pgLabel(v: unknown) { const t = String(v ?? '').trim(); return isPctPage(t) ? t.replace(/\s+/g, '') : 'p.' + t }
export const hasPage = (s: Rec) => s['쪽수'] !== '' && s['쪽수'] != null

export function progressOf(b: Rec) {
  const total = Number(b['분량']) || 0, cur = Number(b['현재쪽수']) || 0
  if (!total || !cur) return null
  const pct = Math.min(100, Math.round(cur / total * 100))
  let eta = ''
  if (b['시작일'] && cur < total) {
    const days = Math.max(1, ((dayDiff(b['시작일']) || 0) * -1) + 1)
    const pace = cur / days
    if (pace > 0) eta = addDays(S.today, (total - cur) / pace)
  }
  return { total, cur, pct, eta }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
export const isTemp = (id: unknown) => /^T/.test(String(id || ''))
export const resolveId = (id: string | null | undefined) => (id && S.idMap[id]) || id || ''
