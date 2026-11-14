/* 기기 저장 · 대기 목록 · 동기화 — 예전 앱 store-local.js와 같은 동작
 * 폰에 먼저 저장 → 화면에 바로 반영 → 뒤에서 Supabase로 (끊기면 다시 시도) */
import { S, LS, emit, book, isTemp, uid, type Rec } from '../core'
import { isLogRow } from '../logs'
import { Store } from './server'
import { toast, errMsg } from '../ui'

export const CACHE_KEY = 'lib_cache_v1', OUTBOX_KEY = 'lib_outbox_v1'
// 기기 저장: 큰 데이터는 IndexedDB (용량 넉넉), 작은 설정·대기 목록은 localStorage
export const IDB = (() => {
  let dbp: Promise<IDBDatabase> | null = null
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('my-library', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  }))
  const run = (mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest | void) => open().then(db => new Promise<unknown>((res, rej) => {
    const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'))
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error)
  }))
  return {
    get: (k: string) => run('readonly', st => st.get(k)).catch(() => undefined),
    set: (k: string, v: unknown) => run('readwrite', st => st.put(v, k)).catch(() => false),
    del: (k: string) => run('readwrite', st => st.delete(k)).catch(() => false),
  }
})()
let cacheTimer = 0
export function saveCache() {
  if (!S.loaded) return
  clearTimeout(cacheTimer)
  cacheTimer = window.setTimeout(() => {
    IDB.set(CACHE_KEY, { ver: S.ver || '', books: S.books, snippets: S.snips, memos: S.memos.concat(S.logs || []), notes: S.notes, settings: S.settings, at: Date.now() })
  }, 250)
}
export async function loadCache(): Promise<Rec | null> { return ((await IDB.get(CACHE_KEY)) as Rec) || null }

/* ----- 바로 저장 ----- */
S.outbox = (() => { try { return JSON.parse(LS.get(OUTBOX_KEY) || '[]') } catch { return [] } })()
S.outbox.forEach((o: Rec) => { o.sending = false })
// 바로 저장되는 종류: 저장 함수 → 목록 이름
const OPS: Record<string, { list: string; del: string }> = { saveSnippet: { list: 'snips', del: 'deleteSnippet' }, saveMemo: { list: 'memos', del: 'deleteMemo' }, saveNote: { list: 'notes', del: 'deleteNote' } }
const DEL_OPS: Record<string, string> = { deleteSnippet: 'snips', deleteMemo: 'memos', deleteNote: 'notes' }
export function persistOutbox() { LS.set(OUTBOX_KEY, JSON.stringify(S.outbox.map((o: Rec) => Object.assign({}, o, { sending: false })))); emit() }

export function upsertLocal(list: string, x: Rec) { const arr = S[list]; const i = arr.findIndex((y: Rec) => y.ID === x.ID); if (i >= 0) arr[i] = x; else arr.push(x) }
export type Op = Rec & { fn: string }
export function queue(op: Op) {
  op.cid = op.cid || uid()
  if (OPS[op.fn]) {
    const ex = S.outbox.find((o: Rec) => o.fn === op.fn && o.data.ID === op.data.ID && !o.sending)
    if (ex) { ex.data = op.data; ex.local = op.local; ex.error = ''; if (op.args && op.args[0]) ex.args = op.args; persistOutbox(); saveCache(); flush(); return }
  }
  if (DEL_OPS[op.fn] && isTemp(op.id) && !S.outbox.some((o: Rec) => o.sending && o.data && o.data.ID === op.id)) {
    S.outbox = S.outbox.filter((o: Rec) => !(o.data && o.data.ID === op.id))
    persistOutbox(); saveCache(); return
  }
  if (op.fn === 'updateBookFields') {
    const ex = S.outbox.find((o: Rec) => o.fn === 'updateBookFields' && o.id === op.id && !o.sending)
    if (ex) { Object.assign(ex.patch, op.patch); ex.error = ''; persistOutbox(); saveCache(); flush(); return }
  }
  S.outbox.push(op); persistOutbox(); saveCache(); flush()
}
// 서버에서 새로 받은 데이터 위에, 아직 저장 못 한 변경을 다시 얹기
export function applyPending() {
  S.outbox.forEach((o: Rec) => {
    if (OPS[o.fn]) upsertLocal(o.list || OPS[o.fn].list, Object.assign({}, o.local))
    else if (DEL_OPS[o.fn]) { const L = o.list || DEL_OPS[o.fn]; S[L] = S[L].filter((x: Rec) => x.ID !== o.id) }
    else if (o.fn === 'updateBookFields') { const b = book(o.id); if (b) Object.assign(b, o.patch) }
  })
}
function remapId(from: string, to: string) {
  S.idMap[from] = to
  S.outbox.forEach((o: Rec) => {
    if (o.data && o.data.ID === from) { o.data.ID = to; if (o.local) o.local.ID = to }
    if (o.id === from) o.id = to
  })
}
export function updateBook(saved: Rec) { const i = S.books.findIndex((x: Rec) => x.ID === saved.ID); if (i >= 0) S.books[i] = saved; else S.books.push(saved) }
export function patchBook(id: string, patch: Rec) { const b = book(id); if (b) Object.assign(b, patch); queue({ fn: 'updateBookFields', id, patch: Object.assign({}, patch) }); emit() }

export const F = { flushing: false, timer: 0 }
export async function flush() {
  if (F.flushing || !Store.ready() || !S.outbox.length) { emit(); return }
  F.flushing = true; S.syncState = 'saving'; emit()
  let changedIds = false
  try {
    while (S.outbox.length) {
      const op = S.outbox[0]
      if (op.error) break   // 실패한 건 사용자가 다시 시도할 때까지 멈춤
      op.sending = true
      try {
        if (OPS[op.fn]) {
          const list = op.list || OPS[op.fn].list
          const d = Object.assign({}, op.data, { _cid: op.cid })
          const temp = isTemp(d.ID); if (temp) d.ID = ''
          const saved = await Store.run(op.fn, d, ...(op.args || []))
          S[list] = S[list].filter((x: Rec) => x.ID !== op.data.ID && x.ID !== saved.ID)
          S[list].push(saved)
          if (temp) { remapId(op.data.ID, saved.ID); changedIds = true }
        } else if (DEL_OPS[op.fn]) {
          await Store.run(op.fn, op.id)
        } else if (op.fn === 'updateBookFields') {
          const saved = await Store.run('updateBookFields', op.id, op.patch)
          updateBook(saved)
          S.outbox.slice(1).forEach((o: Rec) => { if (o.fn === 'updateBookFields' && o.id === op.id) Object.assign(saved, o.patch) })
        }
      } catch (e) {
        op.sending = false
        if (!(e as Rec).network) { op.error = errMsg(e); toast('⚠ 저장하지 못한 기록이 있어요: ' + op.error) }
        break
      }
      S.outbox.shift(); persistOutbox(); saveCache()
    }
  } finally {
    F.flushing = false
    S.syncState = S.outbox.length ? (S.outbox[0].error ? 'error' : 'waiting') : ''
    clearTimeout(F.timer)
    if (S.syncState === 'waiting') F.timer = window.setTimeout(flush, 30000)
    if (changedIds && S.noteId && S.idMap[S.noteId]) { S.noteId = S.idMap[S.noteId]; try { history.replaceState(Object.assign({}, history.state, { view: S.view, id: S.noteId }), '') } catch { /* 무시 */ } }
    emit()
  }
}
export function syncLabel(): { t: string; cls: string } {
  const n = S.outbox.length
  if (n && S.outbox.some((o: Rec) => o.error)) return { t: `저장 실패 ${n}`, cls: 'err' }
  if (n && navigator.onLine === false) return { t: `오프라인 · 대기 ${n}`, cls: '' }
  if (n) return { t: F.flushing ? '저장 중…' : `저장 대기 ${n}`, cls: '' }
  if (S.refreshing) return { t: '새로 고치는 중…', cls: 'quiet' }
  return { t: '', cls: '' }
}
export function retrySync() { S.outbox.forEach((o: Rec) => { o.error = '' }); persistOutbox(); flush() }
export function dropOp(i: number) {
  const o = S.outbox.splice(i, 1)[0]
  if (o && OPS[o.fn] && isTemp(o.data.ID)) { const L = o.list || OPS[o.fn].list; S[L] = S[L].filter((x: Rec) => x.ID !== o.data.ID) }
  persistOutbox(); saveCache(); emit()
}

/* ----- 서버와 맞추기 ----- */
export async function refresh(first: boolean): Promise<boolean> {
  S.refreshing = true; emit()
  try {
    const d = await Store.run('sync', first ? '' : (S.ver || ''))
    if (d.settings) S.settings = d.settings
    if (!d.same) { mergeSync(d); S.loaded = true; saveCache() } else { S.ver = d.ver; saveCache() }
    S.lastRefresh = Date.now(); S.loadError = ''
    return true
  } catch (e) {
    if (first) S.loadError = errMsg(e)
    return false
  } finally { S.refreshing = false; emit() }
}
// 전체 또는 바뀐 것만 받은 결과를 합치기
function mergeSync(d: Rec) {
  if (d.full || !S.loaded) {
    const keepTemp = (S.notes || []).filter((n: Rec) => isTemp(n.ID))   // 막 만든, 아직 안 올라간 글은 지키기
    S.books = d.books || []; S.snips = d.snippets || []; S.memos = d.memos || []; S.logs = []; S.notes = (d.notes || []).concat(keepTemp)
  } else {
    // 지운 것 먼저, 그다음 새로 받은 것 (같은 번호가 다시 생겼을 때를 위해)
    const TAB: Record<string, string> = { '책': 'books', '필사': 'snips', '메모': 'memos', '노트': 'notes' }
    ;(d.deleted || []).forEach((x: Rec) => { const k = TAB[x.t]; if (k) S[k] = S[k].filter((r: Rec) => r.ID !== x.id); if (k === 'memos') S.logs = S.logs.filter((r: Rec) => r.ID !== x.id) })
    const merge = (key: string, rows: Rec[]) => {
      const arr = S[key], idx = new Map<string, number>(arr.map((x: Rec, i: number) => [x.ID, i]))
      ;(rows || []).forEach(r => { const i = idx.get(r.ID); if (i != null) arr[i] = r; else { idx.set(r.ID, arr.length); arr.push(r) } })
    }
    merge('books', d.books); merge('snips', d.snippets); merge('memos', d.memos); merge('notes', d.notes)
  }
  S.ver = d.ver
  splitLogs()
  applyPending()
}
// 독서 기록 · 필사 순서는 메모 줄 모양으로 받아서 따로 모아 써요
export function splitLogs() {
  const seen = new Set<string>(), memos: Rec[] = [], logs: Rec[] = []
  S.memos.concat(S.logs || []).forEach((x: Rec) => { if (!x || seen.has(x.ID)) return; seen.add(x.ID); (isLogRow(x) ? logs : memos).push(x) })
  S.memos = memos; S.logs = logs
}
export async function resetLocal() {
  await IDB.del(CACHE_KEY); LS.del(OUTBOX_KEY); S.outbox = []; S.ver = ''; S.loaded = false; emit()
  await refresh(true)
}
