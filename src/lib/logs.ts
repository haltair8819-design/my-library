/* 독서 기록 · 필사 순서 (앱에서는 예전처럼 '메모 줄' 모양, 서버에서는 read_logs · snippet_orders 표) */
import { S, LS, uniq, addDays, resolveId, type Rec } from './core'

// 한 줄 = 그날 그 책을 어디까지 읽었나. 내용 "2026-10-21 · p.120 (p.80부터)"
export const LOG_RE = /^(\d{4}-\d{2}-\d{2})\s*·\s*p\.(\d+)(?:\s*\(p\.(\d+)부터\))?/
export type Log = { m: Rec; id: string; bid: string; date: string; page: number; base: number | null }
export function parseLog(m: Rec): Log | null {
  const r = LOG_RE.exec(String(m['내용'] || ''))
  return r ? { m, id: m.ID, bid: m['책ID'], date: r[1], page: Number(r[2]), base: r[3] != null ? Number(r[3]) : null } : null
}
export function logText(date: string, page: number, base: number | null | undefined) { return `${date} · p.${page}${base != null ? ` (p.${base}부터)` : ''}` }

// 앱이 쓰는 기록 줄 (메모 화면엔 안 보임). 종류 칸이 바뀌어도 알아보도록 내용 모양으로도 확인해요
export const isOrderRow = (m: Rec) => !!m && (m['종류'] === '필사순서' || /^순서[@:]/.test(String(m['내용'] || '')))
export const isReadRow = (m: Rec) => !!m && (m['종류'] === '독서기록' || (!!m['책ID'] && /^\d{4}-\d{2}-\d{2}\s*·\s*p\.\d+/.test(String(m['내용'] || ''))))
export const isLogRow = (m: Rec) => isOrderRow(m) || isReadRow(m)
export const readLogs = () => (S.logs || []).filter(isReadRow)

export function logsOf(bid: string): Log[] {
  return (S.logs || []).filter((m: Rec) => m['책ID'] === bid).map(parseLog).filter(Boolean).sort((a: Log, b: Log) => a.date.localeCompare(b.date)) as Log[]
}
// 책 하나: 날짜 → 그날 읽은 쪽수
export function dailyOf(bid: string): Record<string, number> {
  const out: Record<string, number> = {}; let prev: number | null = null
  logsOf(bid).forEach(l => { const from = prev != null ? prev : (l.base != null ? l.base : 0); out[l.date] = (out[l.date] || 0) + Math.max(0, l.page - from); prev = l.page })
  return out
}
export type DayAll = Record<string, { n: number; books: Record<string, number> }>
// 모든 책: 날짜 → { n: 쪽수, books: {책ID: 쪽수} }
export function dailyAll(): DayAll {
  const out: DayAll = {}
  uniq<string>((S.logs || []).map((m: Rec) => m['책ID'])).forEach(bid => {
    Object.entries(dailyOf(bid)).forEach(([d, n]) => { if (!n) return; const o = out[d] = out[d] || { n: 0, books: {} }; o.n += n; o.books[bid] = (o.books[bid] || 0) + n })
  })
  return out
}
export function readStreak(all: DayAll) {
  let n = 0, d = S.today
  if (!(all[d] && all[d].n)) d = addDays(d, -1)   // 오늘 아직 안 읽었으면 어제부터 셈
  while (all[d] && all[d].n) { n++; d = addDays(d, -1) }
  return n
}

/* ----- 필사 순서 ----- */
export const ORDER_KEY = 'snip_order_v1'
export function localOrders(): Record<string, { at: number; ids: string[] }> { try { return JSON.parse(LS.get(ORDER_KEY) || '{}') || {} } catch { return {} } }
export function parseOrder(m: Rec | null | undefined) {
  const t = String((m && m['내용']) || ''); const r = /^순서(?:@(\d+))?:(.*)$/s.exec(t)
  return r ? { at: Number(r[1] || 0), ids: r[2].split(',').map(x => x.trim()).filter(Boolean) } : { at: 0, ids: [] as string[] }
}
export function snipOrderRow(bid: string): Rec | undefined {
  return (S.logs || []).filter((m: Rec) => isOrderRow(m) && m['책ID'] === bid).sort((a: Rec, b: Rec) => parseOrder(b).at - parseOrder(a).at)[0]
}
export function snipOrderOf(bid: string): string[] | null {
  const row = snipOrderRow(bid), sv = row ? parseOrder(row) : null, lo = localOrders()[bid]
  const pick = lo && (!sv || (lo.at || 0) >= sv.at) ? lo : sv
  const ids = pick && pick.ids ? pick.ids.map(resolveId).filter(Boolean) : []
  return ids.length ? ids : null
}
