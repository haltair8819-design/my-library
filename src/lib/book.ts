/* 책 · 필사 기록 바꾸기 (화면에 바로 반영 → 대기 목록으로 저장) — 예전 library-book.js · features.js · life.js */
import { S, emit, book, snipsOf, isThought, uid, uniq, resolveId, snipPage, addDays, platOf, LS, splitKw, type Rec } from './core'
import { logsOf, dailyOf, logText, snipOrderOf, snipOrderRow, localOrders, isOrderRow, ORDER_KEY } from './logs'
import { queue, upsertLocal, patchBook, updateBook, saveCache } from './store/local'
import { Store } from './store/server'
import { toast, errMsg } from './ui'

export const togetherOn = () => (S.settings || {}).together !== false
export const isShared = (s: Rec) => !!s && s['공개'] === true
export const bookShared = (b: Rec | undefined) => !!b && b['공개'] !== false
export const bookSnipShared = (b: Rec | undefined) => !!(b && b['필사공개'])
export const splitAuthors = (v: unknown) => String(v || '').split(/\s*,\s*/).map(a => a.replace(/\(.*?\)/g, '').trim()).filter(Boolean)

// 서버를 부르고, 실패하면 알려 주기
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WRITE_FNS: Record<string, 1> = { saveBook: 1, finishBook: 1, deleteBook: 1, saveSettings: 1, renameKeyword: 1, autoKeywords: 1 }
export async function call(fn: string, ...args: any[]): Promise<any> {
  try { const r = await Store.run(fn, ...args); if (WRITE_FNS[fn]) setTimeout(saveCache, 30); return r } catch (e) { toast('⚠ ' + errMsg(e)); throw e }
}

/* ----- 인생 문장 (★1~3) ----- */
export const LIFE: Record<number, string> = { 1: '마음에 드는 문장', 2: '인생 문장', 3: '찐 인생 문장' }
export const LIFE_S: Record<number, string> = { 1: '마음에 드는', 2: '인생', 3: '찐 인생' }
export const lifeOf = (s: Rec | null | undefined) => Math.max(0, Math.min(3, Number(s && s['인생']) || 0))

/* ----- 필사 저장 ----- */
// 서버에 보낼 필사 한 줄 (지금 칸 그대로 + 바꿀 것)
export function snipFull(x: Rec, patch: Rec) {
  return Object.assign({ ID: x.ID, '책ID': x['책ID'], '유형': x['유형'] || '인용', '내용': x['내용'], '쪽수': x['쪽수'] ?? '', '제목': x['제목'] || '', '키워드': x['키워드'] || '' },
    x['공개'] !== undefined ? { '공개': x['공개'] } : {}, x['인생'] !== undefined ? { '인생': x['인생'] } : {}, patch)
}
export function patchSnip(x: Rec, patch: Rec) {
  const data = snipFull(x, patch), local = Object.assign({}, x, patch)
  upsertLocal('snips', local); queue({ fn: 'saveSnippet', data, local })
}
export function deleteSnip(id: string) { const rid = resolveId(id); S.snips = S.snips.filter((x: Rec) => x.ID !== rid); queue({ fn: 'deleteSnippet', id: rid }); emit() }
export function newSnipLocal(bookId: string, fields: Rec) {
  const b = book(bookId)
  const data = Object.assign({ ID: 'T' + uid(), '책ID': bookId }, fields)
  const local = Object.assign({ '출처': '직접입력', '작성일': S.today }, data, { '책제목': b ? b['제목'] : '' })
  upsertLocal('snips', local); queue({ fn: 'saveSnippet', data, local })
  return data.ID as string
}

/* ----- 쪽수 순서 · 직접 정한 순서 ----- */
// 노트 파일 문장: 쪽수 없는 것은 바로 앞 문장 자리에 붙어 있고, 쪽수 없는 새 문장은 맨 뒤
export function sortByPage(list: Rec[], bk?: Rec) {
  const fromFile = (s: Rec) => s['출처'] === '노트파일' || s['출처'] === 'PDF'
  const base = list.slice().sort((x, y) => (fromFile(x) ? 0 : 1) - (fromFile(y) ? 0 : 1) || String(x.ID).localeCompare(String(y.ID)))
  let carry = 0
  const keyed = base.map((s, i) => {
    const p = snipPage(s, bk)
    let k: number
    if (p != null) { k = p; if (fromFile(s)) carry = p } else k = fromFile(s) ? carry : Infinity
    return { s, k, i }
  })
  return keyed.sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.s)
}
export function orderedSnips(bid: string) {
  const byPage = sortByPage(snipsOf(bid)), ids = snipOrderOf(bid)
  if (!ids) return byPage
  const pos = new Map(ids.map((id, i) => [id, i]))
  const out = ids.map(id => byPage.find(s => s.ID === id)).filter(Boolean) as Rec[]
  // 순서를 정한 뒤에 새로 넣은 문장: 쪽수가 맞는 자리 (자기보다 쪽수가 작거나 같은 마지막 문장 뒤)
  byPage.filter(s => !pos.has(s.ID)).forEach(s => {
    const p = snipPage(s)
    if (p == null) { out.push(s); return }
    let at = 0; out.forEach((x, i) => { const q = snipPage(x); if (q != null && q <= p) at = i + 1 })
    out.splice(at, 0, s)
  })
  return out
}
export function snipView() { const v = LS.get('snip_view') || ''; return v === 'life' || v === 'only' ? v : '' }
export function saveSnipOrder(bid: string, tabIds: string[]) {
  // 지금 칸의 새 순서를 책 전체 순서에 끼워 넣기 (다른 칸 문장 자리는 그대로)
  const all = orderedSnips(bid).map(s => s.ID), set = new Set(tabIds); let k = 0
  const full = all.map(id => set.has(id) ? tabIds[k++] : id).map(resolveId)
  writeOrder(bid, full)
}
function writeOrder(bid: string, full: string[]) {
  const at = Date.now()
  const lo = localOrders(); lo[bid] = { at, ids: full }; LS.set(ORDER_KEY, JSON.stringify(lo))   // 이 기기에 먼저
  const ex = snipOrderRow(bid)
  // 예전에 여러 줄이 생겼으면 하나만 남기기
  ;(S.logs || []).filter((m: Rec) => isOrderRow(m) && m['책ID'] === bid && (!ex || m.ID !== ex.ID)).forEach((m: Rec) => { S.logs = S.logs.filter((x: Rec) => x.ID !== m.ID); queue({ fn: 'deleteMemo', list: 'logs', id: m.ID }) })
  const data = { ID: ex ? ex.ID : 'T' + uid(), '종류': '필사순서', '내용': `순서@${at}:` + full.join(','), '완료': false, '마감일': '', '마감시간': '', '책ID': bid }
  const local = Object.assign({ '작성일': S.today }, ex || {}, data)
  upsertLocal('logs', local); queue({ fn: 'saveMemo', list: 'logs', data, local })
  emit()
}
// 쪽수 순으로 정렬: 지금 칸만 쪽수대로 다시 놓고 그 순서를 저장 (이후에도 끌어서 바꿀 수 있어요)
export function resetOrder(bid: string) {
  const tabIds = sortByPage(snipsOf(bid).filter(s => (S.bookTab === '생각') === isThought(s))).map(s => s.ID)
  saveSnipOrder(bid, tabIds)
  toast('쪽수 순으로 정렬했어요')
}

/* ----- 독서 기록 ----- */
export function saveLog(bid: string, date: string, page: number, base: number | null | undefined, existing?: Rec) {
  const fields = { '종류': '독서기록', '내용': logText(date, page, base), '완료': false, '마감일': '', '마감시간': '', '책ID': bid }
  const data = Object.assign({ ID: existing ? existing.ID : 'T' + uid() }, fields)
  const local = Object.assign({ '작성일': S.today }, existing || {}, data)
  upsertLocal('logs', local); queue({ fn: 'saveMemo', list: 'logs', data, local })
  emit()
}
export function deleteLog(id: string) { S.logs = S.logs.filter((x: Rec) => x.ID !== id); queue({ fn: 'deleteMemo', list: 'logs', id }); emit() }
// '36쪽' · '45%' · '45퍼센트' → 쪽수 (분량이 없으면 물어봐요)
export function parsePageInput(b: Rec, raw: string, ask: string): number | null {
  const v = String(raw || '').trim().replace(/\s*(퍼센트|프로)$/, '%').replace(/쪽|p\.?$/gi, '').trim()
  if (!v) { toast('몇 쪽까지 읽었는지 넣어 주세요'); return null }
  let page: number
  if (/%$/.test(v)) {
    const pct = Number(v.replace('%', ''))
    if (isNaN(pct) || pct < 0 || pct > 100) { toast('0~100% 사이로 넣어 주세요'); return null }
    let tot = Number(b['분량']) || 0
    if (!tot) {
      const a = prompt(ask, '')
      tot = Math.round(Number(String(a || '').replace(/[^\d.]/g, ''))) || 0
      if (!tot) { toast('분량을 넣어야 %로 기록할 수 있어요'); return null }
      patchBook(b.ID, { '분량': tot })
    }
    page = Math.round(tot * pct / 100)
  } else { page = Number(v); if (isNaN(page) || page < 0) { toast('숫자로 넣어 주세요'); return null } page = Math.round(page) }
  const total = Number(b['분량']) || 0; if (total && page > total) page = total
  return page
}
export function readHereQuiet(id: string, page: number) {
  const b = book(id); if (!b) return
  const logs = logsOf(id), todayLog = logs.find(l => l.date === S.today), prevCur = Number(b['현재쪽수']) || 0
  const base = logs.length ? (todayLog ? todayLog.base : null) : (prevCur && prevCur <= page ? prevCur : (b['시작일'] && String(b['시작일']).slice(0, 10) < S.today ? page : 0))
  saveLog(id, S.today, page, base, todayLog && todayLog.m)
  patchBook(id, { '현재쪽수': page })
}
// 여기까지 읽었어요 → 끝까지 읽었으면 완독할지 물어봐요
export function readHere(id: string, val: string, onFinish: (id: string) => void) {
  const b = book(id); if (!b) return false
  const page = parsePageInput(b, val, '%로 기록하려면 책 전체 쪽수(분량)가 필요해요.\n이 책은 모두 몇 쪽인가요? (E북은 종이책 쪽수를 넣어도 돼요)')
  if (page == null) return false
  const total = Number(b['분량']) || 0
  const logs = logsOf(id), prevCur = Number(b['현재쪽수']) || 0
  const todayLog = logs.find(l => l.date === S.today)
  const base = logs.length ? (todayLog ? todayLog.base : null) : (prevCur && prevCur <= page ? prevCur : (b['시작일'] && String(b['시작일']).slice(0, 10) < S.today ? page : 0))
  saveLog(id, S.today, page, logs.length && !todayLog ? null : base, todayLog && todayLog.m)
  patchBook(id, { '현재쪽수': page })
  const n = dailyOf(id)[S.today] || 0
  if (total && page >= total && b['상태'] === '읽는중') { toast('마지막 쪽까지 읽었어요!'); setTimeout(() => { if (confirm('다 읽었네요! 오늘 날짜로 완독 처리할까요?')) onFinish(id) }, 300) }
  else toast(n ? `오늘 ${n}쪽 읽었어요 · p.${page}까지` : `p.${page}까지 기록했어요`)
  return true
}
// 하루 만에 다 읽은 책 (시작일 = 완독일): 독서 기록이 없으면 그날 처음부터 끝까지 읽은 걸로 (v2.15.4)
export function ensureOneDayLog(b: Rec | undefined) {
  if (!b || b['상태'] !== '완독') return false
  const st = String(b['시작일'] || '').slice(0, 10), fin = String(b['완독일'] || '').slice(0, 10), total = Number(b['분량']) || 0
  if (!st || st !== fin || !total || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) return false
  const logs = logsOf(b.ID)
  if (logs.length > 1) return false
  const one = logs[0]
  if (one && (one.date !== fin || (dailyOf(b.ID)[fin] || 0) >= total)) return false
  saveLog(b.ID, fin, total, 0, one && one.m)
  return true
}
export function fixOneDayLogsOnce() {
  if (LS.get('fix_oneday_log_v1')) return
  let n = 0; S.books.forEach((b: Rec) => { if (ensureOneDayLog(b)) n++ })
  LS.set('fix_oneday_log_v1', '1')
  if (n) toast(`하루 만에 다 읽은 책 ${n}권의 독서 기록을 채웠어요`)
}
export async function finishBook(id: string) {
  const b0 = book(id), total = Number(b0 && b0['분량']) || 0
  if (b0 && total && (Number(b0['현재쪽수']) || 0) < total) readHereQuiet(id, total)   // 마지막 쪽까지 읽은 걸로 기록
  const saved = await call('finishBook', id)
  updateBook(saved)
  ensureOneDayLog(saved)
  emit()
  toast(`완독! ${saved['완독일수'] ? saved['완독일수'] + '일 걸렸어요' : ''}`)
  return saved
}
export function togglePlat(id: string) {
  const b = book(id); if (!b) return
  const next = platOf(b) === '종이책' ? 'E북' : '종이책'
  patchBook(id, { '플랫폼': next }); toast(next + '으로 바꿨어요')
}

/* ----- 카테고리 자동 분류: 같은 저자 → 제목 낱말 → AI 순서로, 내 서재 분류 이름에 맞춰요 ----- */
const CAT_RULES: [RegExp, string, string, string][] = [
  [/부동산|아파트|청약|경매/, '경제/경영', '재테크/투자', '부동산'],
  [/주식|월가|투자|가치투자|배당|ETF|펀드/i, '경제/경영', '재테크/투자', '주식'],
  [/비트코인|코인|가상자산|암호화폐|블록체인/, '경제/경영', '재테크/투자', '가상자산'],
  [/부자|돈의|머니|재테크|금융|금의|자산|연금|월급/, '경제/경영', '재테크/투자', '금융'],
  [/트렌드|전망/, '경제/경영', '경제전망', '경제'],
  [/\bAI\b|인공지능|챗GPT|GPT|디지털|테크/i, '경제/경영', '경제전망', 'AI'],
  [/넛지|행동경제|경제학|경제|마케팅|경영|브랜드|비즈니스|창업|리더십/, '경제/경영', '경제일반', '경제'],
  [/습관|레버리지|원씽|성공|시간관리|생산성|자기계발|목표|부의|멘탈|동기/, '자기계발', '성공', '자기계발'],
  [/글쓰기|문장|작가 수업|에디터/, '인문학', '책읽기/글쓰기', '글쓰기'],
  [/독서|책읽기|읽는 법|서재|책 읽/, '인문학', '책읽기/글쓰기', '독서법'],
  [/니체|프롬|칸트|쇼펜하우어|스피노자|철학|소유냐|사유|실존/, '인문학', '서양철학', '철학'],
  [/심리|마음|감정|불안|우울|트라우마|정신/, '인문학', '인문교양', '심리'],
  [/사피엔스|인류|문명|인문/, '인문학', '인문교양', '인문'],
  [/수학|미적분|확률|숫자/, '과학', '교양과학', '수학'],
  [/과학|물리|우주|양자|진화|생물|화학|뇌과학|유전자|빅뱅|코스모스/, '과학', '교양과학', '과학'],
  [/역사|세계사|한국사|전쟁|제국|왕조|문화사/, '역사/문화', '세계사', '역사'],
  [/지리|정치|민주주의|국가|사회|불평등|계급|외교/, '정치/사회', '사회학', '사회'],
  [/클래식|교향곡|오페라|작곡가|음악/, '예술/대중문화', '클래식', '음악'],
  [/각본|시나리오|영화|감독/, '예술/대중문화', '영화', '각본'],
  [/미술|그림|화가|미술관|건축|디자인/, '예술/대중문화', '미술', '예술'],
  [/건강|운동|식단|다이어트|수면|달리기/, '인문학', '인문교양', '건강'],
  [/에세이|산문/, '', '', '에세이'],
]
export type Cat = { '대분류': string; '중분류': string; '개인분류': string; how: string }
const normAuthor = (a: string) => String(a || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase()
export function guessCategory(info: Rec): Cat | null {
  const others = S.books.filter((b: Rec) => b['대분류'] && b.ID !== info.ID)
  const au = splitAuthors(info['저자']).map(normAuthor).filter(Boolean)
  for (const a of au) {
    const same = others.filter((b: Rec) => splitAuthors(b['저자']).map(normAuthor).includes(a))
    if (same.length) { const pick = same[same.length - 1]; return { '대분류': pick['대분류'], '중분류': pick['중분류'] || '', '개인분류': pick['개인분류'] || '', how: '같은 저자 책 기준' } }
  }
  const t = String(info['제목'] || '').replace(/\(.*?\)/g, '').trim()
  const stem = t.replace(/\s*\d+\s*(권|부|편)?$/, '').trim()
  if (stem.length >= 3) { const ser = others.find((b: Rec) => String(b['제목']).replace(/\(.*?\)/g, '').trim().startsWith(stem)); if (ser) return { '대분류': ser['대분류'], '중분류': ser['중분류'] || '', '개인분류': ser['개인분류'] || '', how: '같은 시리즈 기준' } }
  for (const [re, big, mid, mine] of CAT_RULES) if (re.test(t) && big) return { '대분류': big, '중분류': mid, '개인분류': mine, how: '제목 낱말 기준' }
  return null
}
export async function aiCategory(info: Rec): Promise<Cat | null> {
  const bigs = uniq(S.books.map((b: Rec) => b['대분류'])), mids = uniq(S.books.map((b: Rec) => b['중분류'])), mine = uniq(S.books.map((b: Rec) => b['개인분류']))
  const q = `[분류 요청] 아래 책 한 권의 분류만 골라 줘. 내 기록이나 필사는 참고하지 말고, 이 책 자체가 어떤 책인지로 판단해.
책: 제목 "${info['제목']}" / 저자 ${info['저자'] || '모름'}${info['옮긴이'] ? ' / 옮긴이 ' + info['옮긴이'] : ''}${info['출판사'] ? ' / 출판사 ' + info['출판사'] : ''}
대분류 후보: ${bigs.join(', ')}
중분류 예시: ${mids.join(', ')}
개인분류 예시: ${mine.join(', ')}
규칙: 소설·시·에세이는 작가 국적에 따라 '한국 문학' 또는 '해외 문학'. 중분류는 예시에 맞는 게 있으면 그대로, 없으면 비슷한 형식으로 새로 지어도 돼.
다른 말 없이 JSON 한 줄로만 답해: {"대분류":"…","중분류":"…","개인분류":"…"}`
  const r = await Store.run('askAssistant', q, [])
  const m = String((r && r.answer) || '').match(/\{[\s\S]*?\}/)
  if (!m) return null
  try { const j = JSON.parse(m[0]); if (!j['대분류']) return null; return { '대분류': String(j['대분류']).trim(), '중분류': String(j['중분류'] || '').trim(), '개인분류': String(j['개인분류'] || '').trim(), how: 'AI 추천' } } catch { return null }
}
export async function classifyBook(info: Rec, useAI: boolean) { return guessCategory(info) || (useAI ? await aiCategory(info).catch(() => null) : null) }
export async function autoCatAll() {
  const list = S.books.filter((b: Rec) => !String(b['대분류'] || '').trim())
  if (!list.length) { toast('분류 없는 책이 없어요'); return }
  if (!confirm(`분류가 빈 책 ${list.length}권을 자동으로 채울까요?\n같은 저자 · 제목으로 먼저 찾고, 모르면 AI에게 물어요.`)) return
  toast(`${list.length}권 분류하는 중…`); let n = 0
  for (const b of list) {
    const c = await classifyBook(b, true)
    if (c) { const patch: Rec = {}; (['대분류', '중분류', '개인분류'] as const).forEach(k => { if (c[k] && !String(b[k] || '').trim()) patch[k] = c[k] }); if (Object.keys(patch).length) { patchBook(b.ID, patch); n++ } }
  }
  toast(`${n}권 분류했어요`)
}

/* ----- 검색 ----- */
export function searchSnips(q0: string): Rec[] {
  const q = q0.trim()
  if (!q) return []
  if (q.startsWith('#')) {
    const k = q.slice(1).trim()
    return k ? S.snips.filter((s: Rec) => splitKw(s['키워드']).some(x => x === k || x.includes(k))) : []
  }
  if (q.length < 2) return []
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  return S.snips.filter((s: Rec) => {
    const hay = (s['제목'] + ' ' + s['내용'] + ' ' + s['키워드'] + ' ' + ((book(s['책ID']) || {})['제목'] || '')).toLowerCase()
    return terms.every(t => hay.includes(t))
  }) as Rec[]
}
export function keywordStats() {
  const m: Record<string, { kw: string; n: number; books: Set<string> }> = {}
  S.snips.forEach((s: Rec) => splitKw(s['키워드']).forEach(k => {
    m[k] = m[k] || { kw: k, n: 0, books: new Set() }
    m[k].n++; m[k].books.add(s['책ID'])
  }))
  return Object.values(m).sort((a, b) => b.n - a.n || b.books.size - a.books.size)
}
export { addDays }
