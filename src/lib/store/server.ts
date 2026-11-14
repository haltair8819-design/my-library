/* 저장 담당: Supabase — 예전 앱 store-supabase.js와 같은 동작
 * · 독서 기록 · 필사 순서는 앱에서는 '메모 줄'로 보이고, 여기서 read_logs · snippet_orders 표로 바꿔요
 * · 지우기는 '지움' 표시만 (다른 기기에서 되살아나지 않게), 고친 시각(mtime)이 늦은 쪽이 남아요 */
import { sb, sbUid, SB_URL, SB_KEY } from '../supabase'
import { S, book, uniq, localToday, type Rec } from '../core'
import { LOG_RE, logText, parseOrder } from '../logs'

export class NetError extends Error { network = true }
const sbNewId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
function sbErr(e: unknown) {
  const msg = (e && ((e as Rec).message || (e as Rec).error_description)) || String(e)
  const net = /fetch|network|load failed/i.test(msg) || navigator.onLine === false
  const text = /fetch|network|load failed/i.test(msg) ? (navigator.onLine === false ? '인터넷에 연결되어 있지 않아요' : '서버에 연결하지 못했어요') : msg
  return net ? new NetError(text) : new Error(text)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sbq(p: PromiseLike<any>): Promise<any> { let r; try { r = await p } catch (e) { throw sbErr(e) } if (r.error) throw sbErr(r.error); return r.data }
const sbOut = (r: Rec) => Object.assign({}, r.data || {}, { ID: r.id })
const sbToday = () => S.today || localToday()
function sbDays(a: unknown, b: unknown) {
  if (!a || !b) return ''
  const d = Math.round((new Date(String(b).slice(0, 10) + 'T00:00:00').getTime() - new Date(String(a).slice(0, 10) + 'T00:00:00').getTime()) / 86400000) + 1
  return d > 0 ? d : ''
}
const sbNormKw = (k: unknown) => uniq(String(k || '').split(/[,#\n]/).map(x => x.trim())).join(', ')
function sbStrip(o: Rec) { const d = Object.assign({}, o); delete d.ID; delete d._cid; return d }

async function sbGet(table: string, id: string) {
  const r = await sbq(sb.from(table).select('id, data, deleted').eq('user_id', sbUid()).eq('id', id).maybeSingle())
  return r && !r.deleted ? r : null
}
async function sbPut(table: string, id: string, data: Rec, extra?: Rec) {
  const row = Object.assign({ user_id: sbUid(), id, data, mtime: Date.now(), deleted: false }, extra || {})
  await sbq(sb.from(table).upsert(row, { onConflict: 'user_id,id' }))
  return Object.assign({}, data, { ID: id })
}
async function sbSoftDelete(table: string, id: string, key?: string) {
  await sbq(sb.from(table).update({ deleted: true, mtime: Date.now() }).eq('user_id', sbUid()).eq(key || 'id', id))
}

/* ----- 독서 기록 · 필사 순서 ↔ 앱의 '메모 줄' ----- */
const sbLogRow = (r: Rec) => ({ ID: r.id, '종류': '독서기록', '내용': logText(r.day, r.page, r.base_page), '책ID': r.book_id, '완료': false, '작성일': String(r.created_at || '').slice(0, 10) })
const sbOrderRow = (r: Rec) => ({ ID: 'O:' + r.book_id, '종류': '필사순서', '내용': `순서@${r.mtime || 0}:${(r.ids || []).join(',')}`, '책ID': r.book_id, '완료': false })

/* ----- 바뀐 것만 받기 ----- */
async function sbPull(table: string, cols: string, since: string | null) {
  const out: Rec[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).eq('user_id', sbUid()).order('updated_at', { ascending: true }).range(from, from + 999)
    if (since) q = q.gte('updated_at', since)
    const rows = await sbq(q)
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}
export type SyncResult = Rec
async function sbSync(ver: string): Promise<SyncResult> {
  if (!sbUid()) throw new Error('로그인이 필요해요')
  const full = !ver
  const since = full ? null : new Date(Number(ver) - 5000).toISOString()   // 저장과 겹칠 때를 위한 여유 5초
  const C = 'id, data, deleted, updated_at'
  const [b, s, m, n, l, o, prof] = await Promise.all([
    sbPull('books', C, since), sbPull('snippets', C, since), sbPull('memos', C, since), sbPull('notes', C, since),
    sbPull('read_logs', 'id, book_id, day, page, base_page, deleted, created_at, updated_at', since),
    sbPull('snippet_orders', 'book_id, ids, mtime, deleted, updated_at', since),
    sbq(sb.from('profiles').select('settings').eq('user_id', sbUid()).maybeSingle()),
  ])
  let maxAt = Number(ver) || 0
  ;[b, s, m, n, l, o].forEach(list => list.forEach(r => { const t = Date.parse(r.updated_at); if (t > maxAt) maxAt = t }))
  const live = (list: Rec[]) => list.filter(r => !r.deleted)
  const deleted: Rec[] = []
  if (!full) {
    b.filter(r => r.deleted).forEach(r => deleted.push({ t: '책', id: r.id }))
    s.filter(r => r.deleted).forEach(r => deleted.push({ t: '필사', id: r.id }))
    m.filter(r => r.deleted).forEach(r => deleted.push({ t: '메모', id: r.id }))
    n.filter(r => r.deleted).forEach(r => deleted.push({ t: '노트', id: r.id }))
    l.filter(r => r.deleted).forEach(r => deleted.push({ t: '메모', id: r.id }))
    o.filter(r => r.deleted).forEach(r => deleted.push({ t: '메모', id: 'O:' + r.book_id }))
  }
  const settings = Object.assign({ goal: '', libraryUrl: '', libraryName: '' }, (prof && prof.settings) || {})
  const memos = live(m).map(sbOut).concat(live(l).map(sbLogRow), live(o).map(sbOrderRow))
  const base = { ver: String(maxAt || Date.now()), today: localToday(), settings }
  if (!full && !b.length && !s.length && !m.length && !n.length && !l.length && !o.length) return Object.assign(base, { same: true })
  return Object.assign(base, { full, books: live(b).map(sbOut), snippets: live(s).map(sbOut), memos, notes: live(n).map(sbOut), deleted })
}

/* ----- 책 ----- */
async function sbSaveBook(input: Rec) {
  let id = (input || {}).ID   // 지우기 전에 ID부터 (예전엔 ID가 지워져서 '정보 수정'이 새 책을 만들었어요)
  const b = sbStrip(input || {})
  if (!String(b['제목'] || '').trim()) throw new Error('책 제목을 입력해 주세요.')
  const cur = id ? await sbGet('books', id) : null
  const d = Object.assign({}, cur ? cur.data : {}, b)
  if (!id) { id = sbNewId('B'); d['등록일'] = sbToday(); if (!d['상태']) d['상태'] = d['완독일'] ? '완독' : '읽는중' }
  if (d['완독일'] && d['상태'] !== '완독') d['상태'] = '완독'
  d['완독일수'] = sbDays(d['시작일'], d['완독일'])
  return sbPut('books', id, d, { shared: d['공개'] !== false })
}
async function sbFinishBook(id: string) {
  const cur = await sbGet('books', id); if (!cur) throw new Error('책을 찾을 수 없어요.')
  const d = Object.assign({}, cur.data, { '완독일': sbToday(), '상태': '완독' })
  if (!d['시작일']) d['시작일'] = d['완독일']
  d['완독일수'] = sbDays(d['시작일'], d['완독일'])
  return sbPut('books', id, d)
}
async function sbUpdateBookFields(id: string, patch: Rec) {
  const allowed = ['현재쪽수', '분량', '반납일', '수령일', '경로', '별점', '한줄평', '상태', '시작일', '플랫폼', '대분류', '중분류', '개인분류', '공개', '필사공개']
  const cur = await sbGet('books', id); if (!cur) throw new Error('책을 찾을 수 없어요.')
  const d = Object.assign({}, cur.data)
  Object.keys(patch || {}).forEach(k => { if (allowed.includes(k)) d[k] = patch[k] })
  if (d['현재쪽수'] !== undefined && d['현재쪽수'] !== '') d['현재쪽수'] = Number(d['현재쪽수']) || ''
  if (d['별점'] !== undefined && d['별점'] !== '') d['별점'] = Math.max(1, Math.min(5, Number(d['별점']) || 0)) || ''
  return sbPut('books', id, d, { shared: d['공개'] !== false })
}
async function sbDeleteBook(id: string) {
  await sbq(sb.from('snippets').update({ deleted: true, mtime: Date.now() }).eq('user_id', sbUid()).eq('book_id', id))
  await sbSoftDelete('books', id)
  return id
}

/* ----- 필사 ----- */
async function sbSaveSnippet(s0: Rec) {
  const id0 = (s0 || {}).ID; const s = sbStrip(s0 || {})
  if (!String(s['내용'] || '').trim()) throw new Error('내용을 입력해 주세요.')
  let bk = book(s['책ID'])
  if (!bk) { const r = await sbGet('books', s['책ID']); bk = r ? sbOut(r) : undefined }
  if (!bk) throw new Error('연결된 책을 찾을 수 없어요.')
  const cur = id0 ? await sbGet('snippets', id0) : null
  const d = Object.assign({}, cur ? cur.data : {}, s, { '책제목': bk['제목'], '키워드': sbNormKw(s['키워드'] !== undefined ? s['키워드'] : (cur && cur.data['키워드'])) })
  let id = id0
  if (!id) { id = sbNewId('S'); d['작성일'] = sbToday(); if (!d['출처']) d['출처'] = '직접입력' }
  const kind = d['유형'] === '서평' ? '생각' : (d['유형'] || '인용')
  // 짝꿍에게 보여주기: 필사 · 내 생각 중 '공개'로 고른 것만 (메모는 항상 나만)
  return sbPut('snippets', id, d, { book_id: String(d['책ID']), kind, shared: d['공개'] === true && kind !== '메모' })
}
async function sbDeleteSnippet(id: string) { await sbSoftDelete('snippets', id); return id }

/* ----- 메모 · 할 일 (+ 독서 기록 · 필사 순서) ----- */
async function sbSaveMemo(m0: Rec) {
  const id0 = (m0 || {}).ID; const m = sbStrip(m0 || {})
  if (m['종류'] === '독서기록') {
    const r = LOG_RE.exec(String(m['내용'] || '')); if (!r || !m['책ID']) throw new Error('독서 기록 모양이 맞지 않아요')
    const id = id0 || sbNewId('L')
    await sbq(sb.from('read_logs').upsert({ user_id: sbUid(), id, book_id: String(m['책ID']), day: r[1], page: Number(r[2]), base_page: r[3] != null ? Number(r[3]) : null, mtime: Date.now(), deleted: false }, { onConflict: 'user_id,id' }))
    return Object.assign({ '작성일': sbToday() }, m, { ID: id })
  }
  if (m['종류'] === '필사순서') {
    const o = parseOrder({ '내용': m['내용'] }); const bid = String(m['책ID'] || '')
    if (!bid) throw new Error('필사 순서에 책이 없어요')
    await sbq(sb.from('snippet_orders').upsert({ user_id: sbUid(), book_id: bid, ids: o.ids, mtime: o.at || Date.now(), deleted: false }, { onConflict: 'user_id,book_id' }))
    return Object.assign({}, m, { ID: 'O:' + bid })
  }
  if (!String(m['내용'] || '').trim()) throw new Error('내용을 입력해 주세요.')
  const cur = id0 ? await sbGet('memos', id0) : null
  const d = Object.assign({}, cur ? cur.data : {}, m)
  d['종류'] = d['종류'] === '할일' ? '할일' : '메모'
  const done = d['완료'] === true || d['완료'] === 'TRUE' || d['완료'] === 'true'
  d['완료'] = done
  let id = id0
  if (!id) { id = sbNewId('M'); d['작성일'] = sbToday() }
  if (done && !d['완료일']) d['완료일'] = sbToday()
  if (!done) d['완료일'] = ''
  return sbPut('memos', id, d)
}
async function sbDeleteMemo(id: string) {
  if (String(id).startsWith('O:')) { await sbSoftDelete('snippet_orders', String(id).slice(2), 'book_id'); return id }
  await sbSoftDelete('memos', id)
  await sbSoftDelete('read_logs', id)
  return id
}

/* ----- 노트 ----- */
async function sbSaveNote(n0: Rec, snapshot?: boolean) {
  const id0 = (n0 || {}).ID; const n = sbStrip(n0 || {})
  const body = String(n['본문'] || '')
  if (body.length > 49000) throw new Error('글이 너무 길어요. 한 노트는 4만 9천 자까지라 두 개로 나눠 주세요.')
  if (!String(n['제목'] || '').trim() && !body.trim()) throw new Error('제목이나 내용을 입력해 주세요.')
  const cur = id0 ? await sbGet('notes', id0) : null
  const d = Object.assign({}, cur ? cur.data : {}, n)
  if (!['메모', '초안', '완성', '발행'].includes(d['상태'])) d['상태'] = '초안'
  d['키워드'] = sbNormKw(d['키워드'])
  d['글자수'] = body.replace(/\s/g, '').length
  d['수정일'] = sbToday(); d['수정시각'] = Date.now()
  let id = id0
  if (!id) { id = sbNewId('N'); d['작성일'] = sbToday() }
  const saved = await sbPut('notes', id, d)
  if (snapshot) {
    const last = await sbq(sb.from('note_versions').select('id, data').eq('user_id', sbUid()).eq('note_id', id).order('created_at', { ascending: false }).limit(31))
    const prev = last[0] && last[0].data
    if (!prev || prev['제목'] !== d['제목'] || prev['본문'] !== d['본문']) {
      await sbq(sb.from('note_versions').insert({ user_id: sbUid(), note_id: id, data: { '제목': d['제목'] || '', '본문': body } }))
      const old = last.slice(29).map((x: Rec) => x.id)   // 최근 30개만 보관
      if (old.length) await sbq(sb.from('note_versions').delete().in('id', old))
    }
  }
  return saved
}
async function sbDeleteNote(id: string) { await sbSoftDelete('notes', id); return id }
async function sbNoteVersions(id: string) {
  const rows = await sbq(sb.from('note_versions').select('data, created_at').eq('user_id', sbUid()).eq('note_id', id).order('created_at', { ascending: false }).limit(30))
  return rows.map((r: Rec) => ({ at: Date.parse(r.created_at), '제목': (r.data || {})['제목'] || '', '본문': (r.data || {})['본문'] || '' }))
}

/* ----- 설정 · 키워드 ----- */
async function sbSaveSettings(s: Rec) {
  const cur = await sbq(sb.from('profiles').select('settings').eq('user_id', sbUid()).maybeSingle())
  const next = Object.assign({}, (cur && cur.settings) || {})
  ;['goal', 'libraryUrl', 'libraryName'].forEach(k => { if (s && s[k] !== undefined) next[k] = k === 'goal' ? (Number(s[k]) || '') : String(s[k] || '').trim() })
  Object.keys(s || {}).forEach(k => { if (!['goal', 'libraryUrl', 'libraryName'].includes(k)) next[k] = s[k] })
  await sbq(sb.from('profiles').upsert({ user_id: sbUid(), settings: next }, { onConflict: 'user_id' }))
  return Object.assign({ goal: '', libraryUrl: '', libraryName: '' }, next)
}
async function sbRenameKeyword(from0: string, to0: string) {
  const from = String(from0 || '').trim(), to = String(to0 || '').replace(/^#/, '').trim()
  if (!from) throw new Error('바꿀 키워드를 골라 주세요.')
  const rows = await sbPull('snippets', 'id, data, book_id, kind, deleted, updated_at', null)
  const up: Rec[] = []
  rows.filter(r => !r.deleted).forEach(r => {
    const ks = String((r.data || {})['키워드'] || '').split(',').map(k => k.trim()).filter(Boolean)
    if (!ks.includes(from)) return
    const next: string[] = []; ks.forEach(k => { const v = k === from ? to : k; if (v && !next.includes(v)) next.push(v) })
    up.push({ user_id: sbUid(), id: r.id, data: Object.assign({}, r.data, { '키워드': next.join(', ') }), mtime: Date.now() })
  })
  for (let i = 0; i < up.length; i += 200) await sbq(sb.from('snippets').upsert(up.slice(i, i + 200), { onConflict: 'user_id,id' }))
  return up.length
}

/* ----- 서버 기능 (AI · 책 검색 · 알림 · 백업): Edge Function 'api' 하나, fn 이름으로 나눔 ----- */
const SB_LONG: Record<string, 1> = { autoKeywords: 1, askAssistant: 1, scanPage: 1, transcribeAudio: 1 }
export async function sbFn(fn: string, args: unknown[]) {
  let token = ''
  try { const { data } = await sb.auth.getSession(); token = data && data.session ? data.session.access_token : '' } catch { /* 무시 */ }
  if (!token) throw new Error('로그인이 필요해요')
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SB_LONG[fn] ? 160000 : 60000)
  let r: Response
  try {
    r = await fetch(SB_URL + '/functions/v1/api', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: SB_KEY }, body: JSON.stringify({ fn, args }),
    })
  } catch { throw new NetError(navigator.onLine === false ? '인터넷에 연결되어 있지 않아요' : '서버에 연결하지 못했어요') } finally { clearTimeout(timer) }
  let j: Rec
  try { j = await r.json() } catch { const e = r.status >= 500 ? new NetError('서버 답을 읽지 못했어요 (' + r.status + ')') : new Error('서버 답을 읽지 못했어요 (' + r.status + ')'); throw e }
  if (!j.ok) throw new Error(j.error || '알 수 없는 오류')
  return j.data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SB_FNS: Record<string, (...a: any[]) => Promise<any>> = {
  ping: async () => ({ ok: true, today: localToday() }),
  sync: sbSync, saveBook: sbSaveBook, finishBook: sbFinishBook, deleteBook: sbDeleteBook, updateBookFields: sbUpdateBookFields,
  saveSnippet: sbSaveSnippet, deleteSnippet: sbDeleteSnippet, saveMemo: sbSaveMemo, deleteMemo: sbDeleteMemo,
  saveNote: sbSaveNote, deleteNote: sbDeleteNote, getNoteVersions: sbNoteVersions,
  saveSettings: sbSaveSettings, getSettings: async () => (await sbSync('')).settings, renameKeyword: sbRenameKeyword,
}
;['askAssistant', 'suggestKeywords', 'autoKeywords', 'scanPage', 'suggestTitle', 'noteAssist', 'transcribeAudio', 'bookSearch', 'bookDetail',
  'pushTest', 'backupNow', 'listBackups', 'getBackup']
  .forEach(fn => { SB_FNS[fn] = (...args: unknown[]) => sbFn(fn, args) })

export const Store = {
  kind: 'supabase',
  ready: () => !!sbUid(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (fn: string, ...args: any[]): Promise<any> => {
    const f = SB_FNS[fn]
    if (!f) return Promise.reject(new Error('알 수 없는 요청이에요: ' + fn))
    if (!sbUid()) return Promise.reject(new NetError('로그인이 필요해요'))
    return f(...args)
  },
}
export { sbq }
