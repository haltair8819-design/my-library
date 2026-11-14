/* 책 추가 · 수정 (카카오 · 국립중앙도서관 검색, 바코드, 자동 분류) · 별점 · 독서 기록 창 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { S, emit, book, snipsOf, platOf, PLATS, uniq, addDays, WD, dateOf, type Rec } from '../lib/core'
import { logsOf, parseLog, dailyOf } from '../lib/logs'
import { call, guessCategory, aiCategory, classifyBook, ensureOneDayLog, saveLog, deleteLog, parsePageInput, type Cat } from '../lib/book'
import { patchBook, updateBook } from '../lib/store/local'
import { go } from '../lib/nav'
import { modal, closeModal, toast, errMsg } from '../lib/ui'
import { $ } from '../lib/voice'
import { Faint, Sub, Spin } from '../components/common'

/* ===== 바코드로 책 찾기: 책 뒤 ISBN 바코드를 카메라로 ===== */
const SC: { stop: (() => void) | null; stream: MediaStream | null } = { stop: null, stream: null }
export async function openBarcode(onCode: (isbn: string) => void) {
  if (!('BarcodeDetector' in window)) { toast('이 브라우저는 바코드 인식을 지원하지 않아요. 바코드 아래 숫자(ISBN)를 검색칸에 입력해 주세요'); return }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BD = (window as any).BarcodeDetector
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let det: any
  try { const fm = await BD.getSupportedFormats(); det = new BD({ formats: ['ean_13', 'ean_8', 'upc_a'].filter((f: string) => fm.includes(f)) }) } catch { toast('바코드 인식을 시작하지 못했어요'); return }
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }) } catch { toast('카메라를 쓸 수 없어요. 권한을 허용해 주세요'); return }
  const ov = document.createElement('div'); ov.id = 'scan-ov'; ov.className = 'scan-ov'
  ov.innerHTML = `<video playsinline muted autoplay></video><div class="scan-box"><i></i></div>
    <div class="scan-tip">책 뒤 바코드를 네모 안에 맞춰 주세요</div><button class="btn scan-x" type="button">닫기</button>`
  document.body.appendChild(ov)
  const video = ov.querySelector('video')!; video.srcObject = stream
  let done = false
  const stop = () => { done = true; stream.getTracks().forEach(t => t.stop()); ov.remove(); SC.stop = null }
  SC.stop = stop
  ;(ov.querySelector('.scan-x') as HTMLButtonElement).onclick = stop
  const seen: Record<string, number> = {}
  const tick = async () => {
    if (done) return
    try {
      if (video.readyState >= 2) {
        const codes = await det.detect(video)
        for (const c of codes) {
          const v = String(c.rawValue || '').replace(/\D/g, '')
          if (!/^(97[89]\d{10}|\d{10})$/.test(v)) continue   // 책 ISBN만 (가격 바코드 등은 넘김)
          seen[v] = (seen[v] || 0) + 1
          if (seen[v] >= 2) { try { navigator.vibrate?.(60) } catch { /* 무시 */ } stop(); onCode(v); return }   // 두 번 같은 값이면 확정
        }
      }
    } catch { /* 무시 */ }
    setTimeout(tick, 180)
  }
  tick()
}

/* ===== 책 추가 · 수정 ===== */
const BOOK_FIELDS: [string, string, boolean?][] = [
  ['제목', 'text', true], ['저자', 'text'], ['옮긴이', 'text'], ['출판사', 'text'],
  ['플랫폼', 'plat'], ['경로', 'list'], ['대분류', 'list'], ['중분류', 'list'], ['개인분류', 'list'],
  ['분량', 'number'], ['시작일', 'date'], ['완독일', 'date'], ['상태', 'select'], ['표지URL', 'text'], ['ISBN', 'hidden'],
  ['수령일', 'date'], ['반납일', 'date'], ['별점', 'stars'], ['한줄평', 'text'],
]
const EBOOK_RE = /e\s*북|ebook|전자책|밀리|리디|윌라|크레마|yes24\s*e|예스24\s*e|교보\s*e|킨들|kindle/i
function CoverPick({ url, note }: { url: string; note: string }) { return <div className="cover-pick"><img src={url} alt="" /><span>{note}</span></div> }

function BookForm({ id }: { id: string | null }) {
  // 새 책: 서재에서 보고 있는 칸(읽고 싶은 · 읽는 중 · 완독)으로 바로 들어가게
  const st0 = !id && S.view === 'library' && ['읽을예정', '완독'].includes(S.filter) ? S.filter : '읽는중'
  const b: Rec = id ? book(id) || {} : { '시작일': st0 === '읽는중' ? S.today : '', '완독일': st0 === '완독' ? S.today : '', '상태': st0, '플랫폼': '종이책' }
  const [plat, setPlat] = useState(id ? platOf(b) : (b['플랫폼'] || '종이책'))
  const platTouched = useRef(!!id)
  const [res, setRes] = useState<ReactNode>(null)
  const [cover, setCover] = useState<ReactNode>(b['표지URL'] ? <CoverPick url={b['표지URL']} note="현재 표지" /> : null)
  const [cat, setCat] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!id) setTimeout(() => $('al-q')?.focus(), 50) }, [id])
  const info = () => { const o: Rec = {}; ['제목', '저자', '옮긴이', '출판사'].forEach(k => o[k] = $('b-' + k)?.value || ''); o.ID = id || ''; return o }
  const fillCat = (c: Cat, force: boolean) => {
    (['대분류', '중분류', '개인분류'] as const).forEach(k => { const el = $('b-' + k); if (el && c[k] && (force || !el.value.trim())) el.value = c[k] })
    setCat(<>✓ {[c['대분류'], c['중분류'], c['개인분류']].filter(Boolean).join(' > ')} <span style={{ color: 'var(--faint)' }}>· {c.how}</span> <button type="button" className="kw-ai" onClick={() => autoCat(true)}>다시</button></>)
  }
  const autoCat = async (aiOnly?: boolean) => {
    const inf = info()
    if (!inf['제목'].trim()) { toast('제목을 먼저 넣어 주세요'); return }
    setCat(<><Spin /> 분류를 고르는 중…</>)
    const c = aiOnly ? await aiCategory(inf).catch(() => null) : await classifyBook(inf, true)
    if (c) fillCat(c, true); else setCat(<>분류를 찾지 못했어요. 직접 골라 주세요. <button type="button" className="kw-ai" onClick={() => autoCat()}>다시</button></>)
  }
  const pick = async (item: Rec) => {
    setRes(<div className="al-msg">쪽수 · 분류를 가져오는 중…</div>)
    try {
      const d = await call('bookDetail', item)
      // 검색 정보로 채우기 (개인분류 · 날짜 · 상태 · 플랫폼 · 경로는 그대로)
      ;['제목', '저자', '출판사', '대분류', '중분류', '분량', '표지URL', 'ISBN'].forEach(k => { const el = $('b-' + k); if (el && d[k] !== '' && d[k] != null) el.value = d[k] })
      const tr = $('b-옮긴이'); if (tr) tr.value = d['옮긴이'] || ''   // 고른 책 기준으로 (옮긴이 없는 책이면 비움)
      setRes(null)
      setCover(d['표지URL'] ? <CoverPick url={d['표지URL']} note={'검색 정보로 채웠어요' + (d['분류출처'] ? ' · ' + d['분류출처'] : '') + (d['분량'] ? '' : ' · 쪽수는 직접 입력해 주세요')} /> : null)
      toast('책 정보를 채웠어요. 확인 후 저장하세요')
      if (!$('b-대분류')?.value.trim()) autoCat(); else setCat(<>✓ 검색 정보의 분류예요 <button type="button" className="kw-ai" onClick={() => autoCat(true)}>AI로 다시</button></>)
    } catch (e) { setRes(<div className="al-msg">{errMsg(e)}</div>) }
  }
  const search = async (auto?: boolean) => {
    const q = $('al-q')?.value.trim() || ''
    if (!q) { $('al-q')?.focus(); return }
    setRes(<div className="al-msg">찾는 중…</div>)
    try {
      const list: Rec[] = await call('bookSearch', q)
      if (auto && list.length === 1) { pick(list[0]); return }   // 바코드로 찾은 책은 바로 채우기
      if (auto && !list.length) { setRes(<div className="al-msg">ISBN {q}로 찾은 책이 없어요. 제목으로 검색해 보세요.</div>); return }
      setRes(list.length ? list.map((x, i) => <button className="al-item" key={i} onClick={() => pick(x)}><img src={x.cover} alt="" />
        <div><b>{x.title}</b><span>{x.author}{x.translator ? ' · ' + x.translator + ' 옮김' : ''} · {x.publisher}{x.year ? ' · ' + x.year : ''}</span></div></button>)
        : <div className="al-msg">검색 결과가 없어요. 제목을 조금 줄여서 다시 찾아보세요.</div>)
    } catch (e) { setRes(<div className="al-msg">{errMsg(e)}</div>) }
  }
  // 상태를 바꾸면 날짜도 맞춰요: 읽고 싶은 책은 시작일 · 완독일 없이, 읽는 중으로 바꾸면 오늘 시작
  const stateChanged = (v: string) => {
    const sd = $('b-시작일'), fd = $('b-완독일'); if (!sd) return
    if (v === '읽을예정') { sd.value = ''; if (fd) fd.value = '' } else if (v === '읽는중' && !sd.value) sd.value = S.today
    else if (v === '완독' && fd && !fd.value) fd.value = S.today
  }
  const submit = async () => {
    const data: Rec = { ID: id || '' }
    BOOK_FIELDS.forEach(([k]) => data[k] = k === '플랫폼' ? plat : ($('b-' + k)?.value || '').trim())
    if (data['상태'] === '읽을예정') { data['시작일'] = ''; data['완독일'] = '' }   // 읽고 싶은 책은 아직 시작 전
    if (!data['제목']) { toast('제목을 입력해 주세요'); return }
    if (data['분량'] && isNaN(Number(data['분량']))) { toast('분량은 숫자로 입력해 주세요'); return }
    if (data['분량']) data['분량'] = Number(data['분량'])
    if (!data['대분류']) { const g = guessCategory(data); if (g) (['대분류', '중분류', '개인분류'] as const).forEach(k => { if (!data[k] && g[k]) data[k] = g[k] }) }
    setBusy(true)
    try {
      const saved = await call('saveBook', data)
      updateBook(saved)
      ensureOneDayLog(saved)
      closeModal(); toast('저장했어요')
      if (!String(saved['대분류'] || '').trim()) aiCategory(saved).then(c => {
        if (!c) return; const patch: Rec = {}; (['대분류', '중분류', '개인분류'] as const).forEach(k => { if (c[k] && !String(saved[k] || '').trim()) patch[k] = c[k] })
        if (Object.keys(patch).length) { patchBook(saved.ID, patch); toast('분류를 자동으로 채웠어요: ' + patch['대분류']) }
      }).catch(() => { /* 무시 */ })
      if (id) emit(); else go('book', saved.ID)
    } catch { setBusy(false) }
  }
  const remove = async () => {
    if (!id) return
    const n = snipsOf(id).length
    if (!confirm(`이 책을 삭제할까요?${n ? `\n필사 문장 ${n}개도 함께 삭제됩니다.` : ''}`)) return
    try { await call('deleteBook', id) } catch { return }
    S.books = S.books.filter((x: Rec) => x.ID !== id)
    S.snips = S.snips.filter((x: Rec) => x['책ID'] !== id)
    closeModal(); go('library'); toast('삭제했어요')
  }
  const dl = (k: string) => <datalist id={'dl-' + k}>{uniq<string>(S.books.map((x: Rec) => x[k])).map(v => <option key={v} value={v} />)}</datalist>
  const field = ([k, type, req]: [string, string, boolean?]) => {
    const v = b[k] ?? ''
    if (type === 'hidden') return <input type="hidden" id={'b-' + k} defaultValue={v} />
    if (type === 'plat') return <div><label>{k}</label><div className="seg plat-seg" id="plat-seg">{PLATS.map(p => <button type="button" key={p} className={plat === p ? 'on' : ''} onClick={() => { setPlat(p); platTouched.current = true }}>{p}</button>)}</div></div>
    let input: ReactNode
    if (type === 'stars') input = <select className="field" id={'b-' + k} defaultValue={String(v)}><option value="">–</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select>
    else if (type === 'select') input = <select className="field" id={'b-' + k} defaultValue={v || '읽는중'} onChange={e => stateChanged(e.target.value)}>{['읽는중', '완독', '중단', '읽을예정'].map(o => <option key={o}>{o}</option>)}</select>
    else if (type === 'list') input = <><input className="field" id={'b-' + k} list={'dl-' + k} defaultValue={v}
      onChange={k === '경로' ? e => { if (platTouched.current) return; const r = e.target.value; if (/윌라|오디오/.test(r)) setPlat('오디오북'); else if (EBOOK_RE.test(r)) setPlat('E북') } : undefined} />{dl(k)}
      {k === '대분류' && <div className="cat-auto" id="cat-auto">{cat || <button type="button" className="kw-ai" style={{ padding: 0 }} onClick={() => autoCat()}>🪄 자동 분류</button>}</div>}</>
    else input = <input className="field" id={'b-' + k} type={type === 'number' ? 'text' : type} inputMode={type === 'number' ? 'numeric' : undefined} defaultValue={v} />
    return <div><label>{k}{req ? ' *' : ''}</label>{input}</div>
  }
  const f = Object.fromEntries(BOOK_FIELDS.map(x => [x[0], field(x)]))
  return <>
    <h3>{id ? '책 정보 수정' : '새 책 추가'}{!id && <> <Sub>{({ '읽는중': '읽는 중인 책', '읽을예정': '읽고 싶은 책', '완독': '다 읽은 책' } as Rec)[b['상태']] || ''}으로 담아요</Sub></>}</h3>
    <div className="al-box">
      <input className="field" id="al-q" type="search" placeholder="책 검색: 제목 · 저자 · ISBN" defaultValue={id ? String(b['제목']).replace(/\(.*?\)/g, '').trim() : ''} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
      <button className="btn" onClick={() => openBarcode(isbn => { const q = $('al-q'); if (!q) return; q.value = isbn; search(true) })} title="책 뒤 바코드 찍기" aria-label="바코드로 찾기">📷 바코드</button>
      <button className="btn primary" onClick={() => search()}>검색</button>
    </div>
    <div id="al-res" className="al-res">{res}</div>
    <div id="cover-pick">{cover}</div>
    <div className="divider" />
    {f['제목']}
    <div className="row">{f['저자']}{f['옮긴이']}</div>
    <div className="row">{f['출판사']}{f['분량']}</div>
    {f['플랫폼']}
    {f['경로']}
    <div className="row">{f['대분류']}{f['중분류']}</div>
    <div className="row">{f['개인분류']}{f['상태']}</div>
    <div className="row">{f['시작일']}{f['완독일']}</div>
    <div className="row">{f['수령일']}{f['반납일']}</div>
    <div className="row">{f['별점']}</div>
    {f['한줄평']}
    {f['표지URL']}{f['ISBN']}
    <div className="actions">
      {id && <button className="btn danger" disabled={busy} onClick={remove}>삭제</button>}
      <button className="btn" disabled={busy} onClick={closeModal}>취소</button>
      <button className="btn primary grow" disabled={busy} onClick={submit}>저장</button>
    </div>
  </>
}
export function openBookForm(id: string | null) { modal(<BookForm key={'bf' + Date.now()} id={id} />) }

/* ===== 별점 · 한줄평 ===== */
function Rating({ id }: { id: string }) {
  const b = book(id) || {}
  const [n, setN] = useState(Number(b['별점']) || 0)
  return <>
    <h3>별점 · 한줄평 <Sub>{b['제목']}</Sub></h3>
    <div className="star-pick" id="star-pick">{[1, 2, 3, 4, 5].map(k => <span key={k} className={k <= n ? 'on' : ''} onClick={() => setN(k)}>★</span>)}</div>
    <label>한줄평</label><input className="field" id="one-line" defaultValue={b['한줄평'] || ''} placeholder="이 책을 한 줄로 남긴다면?" />
    <div className="actions"><button className="btn" onClick={closeModal}>나중에</button>
      <button className="btn primary grow" onClick={() => { patchBook(id, { '별점': n || '', '한줄평': ($('one-line')?.value || '').trim() }); closeModal(); toast('저장했어요') }}>저장</button></div>
  </>
}
export function openRating(id: string) { if (book(id)) modal(<Rating id={id} />) }

/* ===== 독서 기록 고치기 · 추가 ===== */
function LogEdit({ lid }: { lid: string }) {
  const m = (S.logs || []).find((x: Rec) => x.ID === lid); const l = m && parseLog(m)
  if (!l) return null
  const b = book(l.bid) || {}
  const save = () => {
    const date = $('lg-date')!.value, page = Number($('lg-page')!.value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(page)) { toast('날짜와 쪽수를 확인해 주세요'); return }
    const clash = logsOf(l.bid).find(x => x.date === date && x.id !== l.id)
    if (clash) deleteLog(clash.id)
    saveLog(l.bid, date, Math.round(page), l.base, m)
    const last = logsOf(l.bid).slice(-1)[0]; if (last) patchBook(l.bid, { '현재쪽수': last.page })
    closeModal(); toast('고쳤어요')
  }
  return <>
    <h3>독서 기록 고치기 <Sub>{b['제목'] || ''}</Sub></h3>
    <div className="row"><div><label>날짜</label><input className="field" type="date" id="lg-date" defaultValue={l.date} /></div>
      <div><label>여기까지 (쪽)</label><input className="field" id="lg-page" inputMode="numeric" defaultValue={l.page} /></div></div>
    <div className="actions"><button className="btn danger" onClick={() => { if (!confirm('이 날의 기록을 지울까요?')) return; deleteLog(m.ID); closeModal(); toast('지웠어요') }}>삭제</button><button className="btn" onClick={closeModal}>취소</button>
      <button className="btn primary grow" onClick={save}>저장</button></div>
  </>
}
export function openLogEdit(lid: string) { modal(<LogEdit lid={lid} />) }

// 날짜를 골라 기록 추가: 완독 · 중단한 책, 지난 날짜 (v2.15.3)
function LogAdd({ bid }: { bid: string }) {
  const b = book(bid) || {}
  const used = new Set(logsOf(bid).map(l => l.date))
  const fin = String(b['완독일'] || '').slice(0, 10), st = String(b['시작일'] || '').slice(0, 10)
  const def = fin && !used.has(fin) ? fin : (b['상태'] === '읽는중' ? addDays(S.today, -1) : (fin || S.today))
  const eb = platOf(b) === 'E북'
  useEffect(() => { setTimeout(() => $('la-page')?.focus(), 60) }, [])
  const save = () => {
    const date = $('la-date')!.value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('날짜를 골라 주세요'); return }
    if (date > S.today) { toast('앞으로의 날짜는 기록할 수 없어요'); return }
    const page = parsePageInput(b, $('la-page')!.value, '%로 기록하려면 책 전체 쪽수(분량)가 필요해요.\n이 책은 모두 몇 쪽인가요?')
    if (page == null) return
    const logs = logsOf(bid), same = logs.find(l => l.date === date)
    const earlier = logs.filter(l => l.date < date)
    // 첫 기록이면 처음부터(0쪽) 읽은 걸로, 아니면 앞 기록에서 이어서
    const base = same ? same.base : (earlier.length ? null : 0)
    saveLog(bid, date, page, base, same && same.m)
    const last = logsOf(bid).slice(-1)[0]
    if (last && b['상태'] !== '완독') patchBook(bid, { '현재쪽수': last.page })
    closeModal()
    const n = dailyOf(bid)[date] || 0
    toast(`${date.slice(5).replace('-', '.')} 기록을 남겼어요${n ? ` · 그날 ${n}쪽` : ''}`)
  }
  return <>
    <h3>독서 기록 추가 <Sub>{b['제목'] || ''}</Sub></h3>
    <div className="row"><div><label>날짜</label><input className="field" type="date" id="la-date" defaultValue={def} min={st || undefined} max={S.today} /></div>
      <div><label>여기까지 (쪽{eb ? ' 또는 %' : ''})</label><div className="inline"><input className="field" id="la-page" inputMode="decimal" style={{ flex: 1 }} placeholder={b['분량'] ? '전체 ' + b['분량'] + '쪽' : ''}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
        <button type="button" className="btn pct-btn" title="%로 넣기" onClick={() => { const f = $('la-page')!; const v = f.value.trim(); f.value = /%$/.test(v) ? v.replace(/%/g, '') : v.replace(/%/g, '') + '%'; f.focus() }}>%</button></div></div></div>
    {b['상태'] === '완독' && b['분량'] ? <button className="more-btn" onClick={() => { $('la-page')!.value = String(Number(b['분량'])) }}>마지막 쪽({Number(b['분량'])})까지</button> : null}
    <div className="small" style={{ marginTop: 6 }}>그날 몇 쪽까지 읽었는지 넣으면, 앞 기록과의 차이로 그날 읽은 양을 계산해요. 같은 날 기록이 있으면 바꿔요.</div>
    <div className="actions"><button className="btn" onClick={closeModal}>취소</button><button className="btn primary grow" onClick={save}>저장</button></div>
  </>
}
export function openLogAdd(bid: string) { if (book(bid)) modal(<LogAdd bid={bid} />) }
export const wdOf = (d: string) => WD[dateOf(d).getDay()]
export { Faint }
