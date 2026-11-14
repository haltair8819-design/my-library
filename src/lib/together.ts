/* 같이 쓰기 — 데이터 · 계산 · 서버 일 (예전 together.js)
 *  · 책 목록 · 별점 · 한줄평 · 독서 기록: 기본 공개 (책마다 '나만 보기'로 숨길 수 있음)
 *  · 필사 · 내 생각: 고른 것만 공개 (기록의 '공개' 칸 ↔ 표의 shared)
 *  · 메모 · 노트 · 할 일: 항상 나만
 * 짝꿍 기록은 내 기록(S.books 등)과 섞지 않고 S.tg에 따로 둬요. */
import { S, LS, emit, book, uniq, type Rec } from './core'
import { sb, sbUid, sbSession } from './supabase'
import { sbq, Store } from './store/server'
import { parseLog } from './logs'
import { saveCache } from './store/local'
import { togetherOn, isShared, bookShared, snipFull } from './book'
import { toast, errMsg } from './ui'
import { queue, upsertLocal } from './store/local'

export const TG_CACHE = 'tg_cache_v1'
S.tg = (() => { try { return JSON.parse(LS.get(TG_CACHE) || 'null') } catch { return null } })() || { at: 0 }
S.tgFilter = '읽는중'
export const tgHasPartner = () => !!(S.tg && S.tg.partner)
export const shelfCount = (list: Rec[]) => list.filter(b => b['상태'] !== '읽을예정').length   // 서재 권수 = 읽고 싶은 책 빼고
export const tgName = () => (S.tg.partner && S.tg.partner.name) || '짝꿍'
export const tgMonth = () => S.today.slice(0, 7)
export const tgShareNew = () => !!(S.settings || {}).shareNew
export const tgSpoilOn = () => (S.settings || {}).spoiler !== false
export const tgSave = () => { try { LS.set(TG_CACHE, JSON.stringify(S.tg)) } catch { /* 무시 */ } }
// 받침에 따라 이/가, 과/와
export function jo(w: string, a: string, b: string) { const c = String(w || '').trim().slice(-1).charCodeAt(0); return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b) }
// 서버 시각(UTC) → 이 기기 날짜 · 시각
export const locDay = (t: string) => { const d = new Date(t); return isNaN(d.getTime()) ? String(t || '').slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const locTime = (t: string) => { const d = new Date(t); return isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export const hhmmOf = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export const niNorm = (s: unknown) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '')

/* ----- 서버에서 받기 ----- */
async function tgPull(table: string, cols: string, uidv: string) {
  const out: Rec[] = []
  for (let from = 0; ; from += 1000) {
    const rows = await sbq(sb.from(table).select(cols).eq('user_id', uidv).eq('deleted', false).range(from, from + 999))
    out.push(...rows); if (rows.length < 1000) break
  }
  return out
}
const sbOut = (r: Rec) => Object.assign({}, r.data || {}, { ID: r.id })
export const AV_BUCKET = 'avatars'
export async function tgSignAvatars(T: Rec) {
  const want = [[T.me.id, T.me.avatar], T.partner ? [T.partner.id, T.partner.avatar] : null].filter(x => x && x[1]) as string[][]
  if (!want.length) return {}
  try {
    const r = await sb.storage.from(AV_BUCKET).createSignedUrls(want.map(([u]) => `${u}/avatar.jpg`), 7 * 86400)
    const out: Record<string, string> = {}; (r.data || []).forEach((x, i) => { if (x && x.signedUrl) out[want[i][0]] = x.signedUrl })
    return out
  } catch { return (S.tg && S.tg.av) || {} }
}
let tgLoading: Promise<Rec | null> | null = null
export function tgLoad(): Promise<Rec | null> {
  if (!togetherOn() || !sbUid()) return Promise.resolve(null)
  if (tgLoading) return tgLoading
  tgLoading = (async () => {
    const me = sbUid(), email = String(((sbSession() || { user: {} }).user as Rec).email || '').toLowerCase()
    const [ps, mine] = await Promise.all([
      sbq(sb.from('partnerships').select('id, inviter, invitee, invitee_email, inviter_name, inviter_email, status, created_at, accepted_at').neq('status', 'ended')),
      sbq(sb.from('profiles').select('*').eq('user_id', me).maybeSingle()),
    ])
    const acc = ps.find((p: Rec) => p.status === 'accepted' && (p.inviter === me || p.invitee === me))
    const next: Rec = {
      at: Date.now(), me: { id: me, email, name: (mine && mine.name) || email.split('@')[0], avatar: (mine && mine.avatar) || '' },
      incoming: ps.filter((p: Rec) => p.status === 'pending' && p.inviter !== me && String(p.invitee_email).toLowerCase() === email),
      sent: ps.filter((p: Rec) => p.status === 'pending' && p.inviter === me), partner: null, books: [], snips: [], logs: [],
    }
    if (acc) {
      const pid = acc.inviter === me ? acc.invitee : acc.inviter
      const [prof, b, s, l] = await Promise.all([
        sbq(sb.from('profiles').select('*').eq('user_id', pid).maybeSingle()),
        tgPull('books', 'id, data, updated_at', pid), tgPull('snippets', 'id, book_id, kind, data, updated_at', pid),
        tgPull('read_logs', 'id, book_id, day, page, base_page', pid),
      ])
      const pemail = (prof && prof.email) || (acc.inviter === me ? acc.invitee_email : acc.inviter_email) || ''
      next.partner = {
        id: pid, pship: acc.id, since: acc.accepted_at, email: pemail,
        name: (prof && prof.name) || (acc.inviter === pid ? acc.inviter_name : '') || pemail.split('@')[0], avatar: (prof && prof.avatar) || '',
        feedHidden: ((prof && prof.settings) || {}).feedHidden || [],
      }
      next.books = b.map(sbOut); next.snips = s.map(sbOut)
      next.logs = l.map(r => ({ id: r.id, bid: r.book_id, date: String(r.day).slice(0, 10), page: r.page, base: r.base_page }))
    }
    // 문장 반응 (내 문장에 달린 것 · 짝꿍 문장에 단 것) · 같이 읽을 책
    const [rx, tb] = await Promise.all([
      sbq(sb.from('reactions').select('id, owner, snippet_id, user_id, kind, body, created_at').order('created_at', { ascending: true })).catch(() => []),
      acc ? sbq(sb.from('together_books').select('id, pship, data, added_by, status, joined, started_at, created_at').eq('pship', acc.id).eq('deleted', false).order('created_at', { ascending: true })).catch(() => []) : Promise.resolve([]),
    ])
    next.reacts = rx || []; next.tbooks = tb || []
    next.bcom = (await sbq(sb.from('book_comments').select('id, owner, book_id, user_id, body, created_at').order('created_at', { ascending: true })).catch(() => [])) || []
    next.av = await tgSignAvatars(next)
    S.tg = next
    tgSave()
    return next
  })().finally(() => { tgLoading = null })
  return tgLoading
}
export async function tgRefresh(quiet?: boolean) {
  try { await tgLoad() } catch (e) { if (!quiet) toast('⚠ ' + errMsg(e)); return }
  emit()
  tgInvitePromptHook()
}
// 받은 초대가 있으면 한 번 물어보기 (화면 쪽에서 채워 넣어요)
export let tgInvitePromptHook = () => { /* Together.tsx에서 바꿔 끼워요 */ }
export function setInvitePrompt(f: () => void) { tgInvitePromptHook = f }

/* ----- 같은 책 찾기 (ISBN → 제목) ----- */
const tgIsbn = (b: Rec) => { const d = String(b['ISBN'] || '').replace(/[^0-9Xx]/g, ''); return d.length >= 10 ? d : '' }
const tgTitle = (b: Rec) => niNorm(String(b['제목'] || '').replace(/\([^)]*\)/g, ''))
export function tgSame(a: Rec, b: Rec) { const ia = tgIsbn(a), ib = tgIsbn(b); if (ia && ib && ia === ib) return true; const ta = tgTitle(a); return !!ta && ta === tgTitle(b) }
export const tgMine = (pb: Rec) => S.books.find((b: Rec) => tgSame(b, pb)) || null
export const tgTheirs = (b: Rec) => (S.tg.books || []).find((pb: Rec) => tgSame(b, pb)) || null

/* ----- 쪽수 계산 (내 것 · 짝꿍 것 같은 방법) ----- */
export type TLog = { id: string; bid: string; date: string; page: number; base: number | null }
export function tgDaily(logs: TLog[]) {   // → { 날짜: 쪽수 }
  const by: Record<string, TLog[]> = {}; logs.forEach(l => (by[l.bid] = by[l.bid] || []).push(l))
  const out: Record<string, number> = {}
  Object.values(by).forEach(list => {
    let prev: number | null = null
    list.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(l => {
      const from = prev != null ? prev : (l.base != null ? l.base : 0)
      out[l.date] = (out[l.date] || 0) + Math.max(0, l.page - from); prev = l.page
    })
  })
  return out
}
export const myLogs = (): TLog[] => (S.logs || []).map(parseLog).filter(Boolean).map((l: Rec) => ({ id: l.id, bid: l.bid, date: l.date, page: l.page, base: l.base }))
export function tgMonthStats(books: Rec[], logs: TLog[]) {
  const m = tgMonth(), daily = tgDaily(logs)
  const days = Object.entries(daily).filter(([d, n]) => d.startsWith(m) && n > 0)
  return { pages: days.reduce((a, [, n]) => a + n, 0), days: days.length, done: books.filter(b => String(b['완독일'] || '').startsWith(m)).length, total: shelfCount(books) }
}
export function tgProg(b: Rec) {
  const total = Number(b['분량']) || 0, cur = Number(b['현재쪽수']) || 0
  if (b['상태'] === '완독') return { pct: 100, cur: total || cur, total }
  return { pct: total && cur ? Math.min(100, Math.round(cur / total * 100)) : 0, cur, total }
}
// 읽은 기간: 2026.10.09 ~ 10.13 · 5일
export function tgPeriod(b: Rec) {
  const s = String(b['시작일'] || '').slice(0, 10), f = String(b['완독일'] || '').slice(0, 10), dot = (d: string) => d.replace(/-/g, '.')
  if (b['상태'] === '읽을예정') return ''
  if (s && f) return `${dot(s)} ~ ${f.slice(0, 4) === s.slice(0, 4) ? dot(f.slice(5)) : dot(f)}${b['완독일수'] ? ` · ${b['완독일수']}일` : ''}`
  if (f) return `${dot(f)} 완독`
  if (s) return `${dot(s)} ~`
  return ''
}
export const bookDayT = (b: Rec) => String(b['완독일'] || b['시작일'] || b['등록일'] || '')

/* ----- 설정 ----- */
export async function tgSaveOpt(k: string, v: unknown) {
  S.settings = Object.assign({}, S.settings, { [k]: v }); emit()
  try { const r = await Store.run('saveSettings', { [k]: v }); if (r) S.settings = r; saveCache(); toast('저장했어요') } catch (e) { toast('⚠ ' + errMsg(e)) }
  emit()
  if (k === 'together' && v) tgRefresh(true)
}

/* ----- 반응 · 한마디 ----- */
export const reactsOf = (owner: string, sid: string) => (S.tg.reacts || []).filter((r: Rec) => r.owner === owner && r.snippet_id === sid) as Rec[]
const RX_COLS = 'id, owner, snippet_id, user_id, kind, body, created_at'
export async function toggleHeart(sid: string, owner: string, notify: (kind: string, id: string) => void) {
  const me = S.tg.me.id, cur = reactsOf(owner, sid).find(r => r.kind === 'heart' && r.user_id === me)
  try {
    if (cur) { await sbq(sb.from('reactions').delete().eq('id', cur.id)); S.tg.reacts = S.tg.reacts.filter((r: Rec) => r.id !== cur.id) }
    else {
      const r = await sbq(sb.from('reactions').insert({ owner, snippet_id: sid, kind: 'heart' }).select(RX_COLS).single())
      S.tg.reacts.push(r); notify('reaction', r.id)
    }
    tgSave()
  } catch (e) { toast('⚠ ' + errMsg(e)); return }
  emit()
}
export async function sendReact(sid: string, owner: string, body: string, notify: (kind: string, id: string) => void) {
  const r = await sbq(sb.from('reactions').insert({ owner, snippet_id: sid, kind: 'comment', body }).select(RX_COLS).single())
  S.tg.reacts.push(r); tgSave(); notify('reaction', r.id); emit()
}
export async function delReact(id: string) {
  if (!confirm('이 한마디를 지울까요?')) return
  try { await sbq(sb.from('reactions').delete().eq('id', id)); S.tg.reacts = S.tg.reacts.filter((r: Rec) => r.id !== id); tgSave() } catch (e) { toast('⚠ ' + errMsg(e)) }
  emit()
}
/* ----- 책 댓글 ----- */
export const bcOf = (owner: string, bid: string) => (S.tg.bcom || []).filter((c: Rec) => c.owner === owner && c.book_id === bid) as Rec[]
export async function bcSend(owner: string, bid: string, body: string, notify: (kind: string, id: string) => void) {
  const r = await sbq(sb.from('book_comments').insert({ owner, book_id: bid, body }).select('id, owner, book_id, user_id, body, created_at').single())
  S.tg.bcom = [...(S.tg.bcom || []), r]; tgSave(); notify('bookc', r.id); emit()
}
export async function bcDel(id: string) {
  if (!confirm('이 댓글을 지울까요?')) return
  try { await sbq(sb.from('book_comments').delete().eq('id', id)); S.tg.bcom = (S.tg.bcom || []).filter((c: Rec) => c.id !== id); tgSave() } catch (e) { toast('⚠ ' + errMsg(e)) }
  emit()
}

/* ----- 보여주기 바꾸기 ----- */
export function setSnipShared(x: Rec, on: boolean) {
  const data = snipFull(x, { '공개': on }), local = Object.assign({}, x, { '공개': on })
  upsertLocal('snips', local); queue({ fn: 'saveSnippet', data, local })
}
export function sharedSnipsOf(me: boolean): Rec[] { return me ? S.snips.filter((s: Rec) => isShared(s) && s['유형'] !== '메모' && bookShared(book(s['책ID']))) : (tgHasPartner() ? S.tg.snips : []) }
export function feedHiddenAdd(key: string) { return uniq([...((S.settings || {}).feedHidden || []), key]).slice(-500) }
