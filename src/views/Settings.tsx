/* 더보기 · 설정 (목표 · 화면 · 알림 · 같이 쓰기 · 백업 · 내보내기 · 잠금 · 계정 · 업데이트) — 예전 more.js · extras.js */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { S, LS, emit, snipsOf, sText, sMemo, pgLabel, hasPage, splitKw, type Rec } from '../lib/core'
import { isDone } from '../lib/memo'
import { sb, sbUid, sbSession } from '../lib/supabase'
import { sbq, sbFn, Store } from '../lib/store/server'
import { saveCache, resetLocal, IDB, CACHE_KEY, OUTBOX_KEY } from '../lib/store/local'
import { togetherOn, call } from '../lib/book'
import { tgSaveOpt } from '../lib/together'
import { pushSupported, pushPrefs, setPushPrefs, pushSub, pushSave, pushOn, pushOff } from '../lib/push'
import { THEMES, ACCENTS, MODES, curTheme, curAccent, curMode, accentVars, saveDesign } from '../lib/theme'
import { APP_VERSION, PATCH_NOTES } from '../lib/patchNotes'
import { go, goBack } from '../lib/nav'
import { modal, closeModal, toast, errMsg } from '../lib/ui'
import { $ } from '../lib/voice'
import { Sub, Spin } from '../components/common'
import { openMyProfile, openShareSettings } from './Together'
import { openNoteImport } from './NoteImport'
import { openReqView, reqRowSub } from './Req'
import appCss from '../styles/app.css?inline'

export function openSettings() { S.dz = null; if (S.view !== 'settings') go('settings'); else emit() }

/* ===== 더보기 ===== */
export function MoreView() {
  return <section id="v-more">
    <div className="view-head"><h1>더보기</h1><p>나의 서재 v{APP_VERSION}</p></div>
    <div className="more-list">
      <button onClick={() => go('stats')}><span className="mi">📊</span><b>독서 통계</b><span>완독 · 분류 · 달별 책 목록, 독서 리포트</span></button>
      <button onClick={() => go('ai')}><span className="mi">✨</span><b>AI 비서</b><span>내 필사 · 글 · 메모를 근거로 답해요</span></button>
      <button onClick={openSettings}><span className="mi">⚙️</span><b>설정</b><span>목표 · 화면 · 알림 · 같이 쓰기 · 백업 · 잠금 · 계정</span></button>
    </div>
  </section>
}

/* ===== 디자인 고르기 (v2.13.1): 고르는 동안은 미리보기만 바뀌고, '저장'을 눌러야 적용돼요 ===== */
function previewDoc(th: string, accent: string, mode: string) {
  return `<!doctype html><html lang="ko" data-theme="${th}" data-mode="${mode}" style="${accentVars(accent, mode === 'dark')}"><head><meta charset="utf-8">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Gowun+Batang:wght@400;700&display=swap">
    <style>${appCss}</style><style>html,body{overflow:hidden}body{pointer-events:none;padding-top:6px}</style></head>
    <body><div class="wrap"><section id="v-book" style="--bc:#5B7A6A">
      <div class="detail-head"><div class="spine" style="background:#5B7A6A">데미안</div><div><div class="dtitle">데미안</div><div class="dauthor">헤르만 헤세</div></div></div>
      <div class="seg book-tabs"><button class="on">필사<span>1</span></button><button>내 생각 · 메모<span>0</span></button></div>
      <div class="sec-head tight"><h2>필사</h2><div><button class="btn primary">+ 문장</button></div></div>
      <div class="snip quote"><div class="stitle">알을 깨는 새</div><div class="txt">새는 알에서 나오려고 투쟁한다. 알은 세계이다.</div><div class="smeta"><span class="pg">p.120</span><span class="kw">#성장</span></div></div>
    </section></div></body></html>`
}
function DesignPanel() {
  const [d, setD] = useState({ theme: curTheme(), accent: curAccent(), mode: curMode() })
  const box = useRef<HTMLDivElement>(null)
  const cur = { theme: curTheme(), accent: curAccent(), mode: curMode() }
  const ch = d.theme !== cur.theme || d.accent !== cur.accent || d.mode !== cur.mode
  const scale = () => box.current?.querySelectorAll<HTMLElement>('.tprev').forEach(p => { const f = p.querySelector('iframe'); if (f) f.style.transform = `scale(${p.clientWidth / 400})` })
  useLayoutEffect(scale)
  useEffect(() => { window.addEventListener('resize', scale); return () => window.removeEventListener('resize', scale) })
  const set = (k: 'theme' | 'accent' | 'mode', v: string) => setD({ ...d, [k]: v })
  return <div id="set-design" ref={box}>
    <div className="panel2" style={{ marginTop: 0 }}><h4>화면 밝기</h4><div className="seg mode-seg" style={{ marginTop: 10 }}>{MODES.map(([k, t]) => <button key={k} className={d.mode === k ? 'on' : ''} onClick={() => set('mode', k)}>{t}</button>)}</div></div>
    <div className="panel2" style={{ marginTop: 12 }}><h4>디자인 <span className="small" style={{ fontWeight: 400 }}>예시 화면에 바로 보여요</span></h4><div className="themes">{THEMES.map(t =>
      <button key={t.id} className={'theme-opt ' + (d.theme === t.id ? 'on' : '')} onClick={() => set('theme', t.id)}>
        <span className="tprev"><iframe tabIndex={-1} aria-hidden="true" loading="lazy" srcDoc={previewDoc(t.id, d.accent, d.mode)} /></span>
        <b>{t.name}</b><span>{t.desc}</span></button>)}</div>
      <h4 style={{ marginTop: 14 }}>포인트 색 <span className="small" style={{ fontWeight: 400 }}>버튼 · 강조 색만 바꿔요</span></h4>
      <div className="acc-row">{ACCENTS.map(([c, n]) => <button key={n} className={'acc ' + (d.accent === c ? 'on' : '')} onClick={() => set('accent', c)} title={n} aria-label={n}>
        <i style={c ? { background: c } : { background: 'linear-gradient(135deg,#ddd 50%,#999 50%)' }} /><span>{n}</span></button>)}</div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn" disabled={!ch} onClick={() => setD(cur)}>되돌리기</button>
        <button className="btn primary grow" disabled={!ch} onClick={() => { saveDesign(d); emit(); toast('디자인을 바꿨어요') }}>{ch ? '저장해서 적용하기' : '지금 적용된 디자인이에요'}</button></div></div>
  </div>
}

/* ===== 알림 ===== */
function NotifyPanel() {
  const [st, setSt] = useState<{ perm: string; sub: PushSubscription | null; saved: boolean | null } | null>(null)
  const [busy, setBusy] = useState(false), [errT, setErr] = useState(''), [p, setP] = useState(pushPrefs())
  const load = async () => {
    const sup = pushSupported(), perm = sup ? Notification.permission : 'unsupported'
    const sub = sup ? await pushSub() : null
    let saved: boolean | null = null
    if (sub) { try { saved = !!(await sbq(sb.from('push_subs').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle())) } catch { saved = null } }
    setSt({ perm, sub, saved })
  }
  useEffect(() => { load() }, [])
  if (!st) return <div className="panel2" id="set-notify"><div className="drill"><Spin /> 확인하는 중…</div></div>
  const sup = pushSupported(), on = !!st.sub && st.perm !== 'denied' && !!LS.get('push_on')
  const toggle = async (want: boolean) => {
    setErr(''); setBusy(true)
    try { if (want) { await pushOn(); toast('알림을 켰어요 · 테스트 알림을 보내 보세요') } else { await pushOff(); toast('이 기기 알림을 껐어요') } } catch (e) { if (!(e as Rec).denied) setErr(errMsg(e)) }
    setBusy(false); load()
  }
  const pref = async (k: string, v: boolean) => {
    const np = Object.assign(pushPrefs(), { [k]: v }); setPushPrefs(np); setP(np)
    const sub = await pushSub(); if (sub) { try { await pushSave(sub); toast('저장했어요') } catch (e) { toast('⚠ ' + errMsg(e)) } }
  }
  const test = async (btn: HTMLButtonElement) => {
    btn.disabled = true; btn.textContent = '보내는 중…'
    try { const r = await sbFn('pushTest', []); toast(`보냈어요 (${r && r.sent != null ? r.sent : r}대). 몇 초 안에 알림이 와요`); if (r && r.errors && r.errors.length) setErr('보내기 실패: ' + r.errors.join(' / ')) }
    catch (e) { setErr(errMsg(e)); toast('⚠ ' + errMsg(e)) } finally { btn.disabled = false; btn.textContent = '테스트 알림 보내기' }
  }
  const permT = ({ granted: '허용', denied: '차단', default: '아직', unsupported: '지원 안 함' } as Rec)[st.perm] || st.perm
  return <div className="panel2" id="set-notify">
    <label className="tg-check" style={{ marginTop: 0 }}><input type="checkbox" id="pn-main" checked={on} disabled={busy || !sup} onChange={e => toggle(e.target.checked)} />
      <b>이 기기에서 알림 받기</b> <span className="small">{busy ? '켜는 중…' : on ? '켜짐' : '꺼짐'}</span></label>
    <div className="small" style={{ lineHeight: 1.7, marginTop: 6 }}>{!sup ? '⚠ 이 브라우저는 알림을 지원하지 않아요. 폰에 설치한 앱에서 켜 주세요.'
      : st.perm === 'denied' ? <>⚠ 폰에서 이 앱의 알림이 막혀 있어요. 앱 안에서는 폰 설정을 바꿀 수 없어서, 아래처럼 한 번만 허용해 주세요.<ol className="set-guide"><li>폰 <b>설정 → 애플리케이션 → 나의 서재 → 알림</b>에서 <b>알림 허용</b>을 켜요</li>
        <li>목록에 ‘나의 서재’ 알림이 없으면 <b>설정 → 애플리케이션 → Chrome → 알림</b>도 켜져 있는지 봐요 (앱이 크롬으로 열려서요)</li><li>앱으로 돌아와서 위 스위치를 다시 켜요</li></ol></>
      : errT ? `⚠ ${errT}` : on ? '알림이 오는 기기예요. 끄면 폰 설정과 상관없이 이 기기로는 알림을 안 보내요.' : '켜면 폰이 알림 허용을 물어봐요. 기기마다 따로 켜요.'}</div>
    <div className={on ? '' : 'dim'}>
      <label className="tg-check"><input type="checkbox" checked={!!p.due} disabled={!on} onChange={e => pref('due', e.target.checked)} /> 📚 반납일 알림 <span className="small">전날 저녁 8시 · 당일 아침 8시</span></label>
      <label className="tg-check"><input type="checkbox" checked={!!p.together} disabled={!on} onChange={e => pref('together', e.target.checked)} /> 💬 짝꿍 소식 <span className="small">내 문장에 ♡ · 한마디, 같이 읽을 책</span></label>
      {on && <div className="actions" style={{ marginTop: 10 }}><button className="btn grow" onClick={e => test(e.currentTarget)}>테스트 알림 보내기</button></div>}
    </div>
    <div className="small" style={{ marginTop: 10, color: 'var(--faint)' }}>권한 {permT} · 기기 등록 {st.sub ? '있음' : '없음'} · 서버 {st.saved === null ? '–' : st.saved ? '저장됨' : '없음'}{st.sub ? ' · ' + new URL(st.sub.endpoint).hostname : ''}</div>
  </div>
}

/* ===== 자동 백업: 매주 일요일 새벽 서버가 계정별로 전체 기록을 파일로 (최근 8개) ===== */
function Backups() {
  const [list, setList] = useState<Rec[] | null>(null), [errT, setErr] = useState(''), [busy, setBusy] = useState(false)
  const load = async () => {
    try { const files = await sbq(sb.storage.from('backups').list(sbUid(), { limit: 50, sortBy: { column: 'name', order: 'desc' } })); setList((files || []).filter((f: Rec) => /\.json\.gz$/.test(f.name)).sort((a: Rec, b: Rec) => b.name.localeCompare(a.name))) }
    catch (e) { setErr(errMsg(e)) }
  }
  useEffect(() => { load() }, [])
  const now = async () => {
    setBusy(true)
    try { const r = await sbFn('backupNow', []); toast(`백업했어요 · 책 ${r.counts.books}권 · 필사 ${r.counts.snippets}개`); load() } catch (e) { toast('⚠ ' + errMsg(e)) } finally { setBusy(false) }
  }
  const download = async (name0: string, btn: HTMLButtonElement) => {
    btn.disabled = true; let name = name0
    try {
      const r: Blob = await sbq(sb.storage.from('backups').download(`${sbUid()}/${name}`))
      let blob: Blob = r
      try { blob = await new Response(r.stream().pipeThrough(new DecompressionStream('gzip'))).blob(); name = name.replace(/\.gz$/, '') } catch { /* 압축 그대로 */ }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([blob], { type: 'application/json' })); a.download = '나의서재-백업-' + name
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 2000)
    } catch (e) { toast('⚠ ' + errMsg(e)) } finally { btn.disabled = false }
  }
  return <>
    <h3>자동 백업</h3><div className="small" style={{ lineHeight: 1.7 }}>매주 일요일 새벽 3시에 책 · 필사 · 노트 · 메모 · 독서 기록 전체를 서버의 내 백업 칸에 파일로 남겨요. 최근 8주치를 보관해요.</div>
    <div id="bk-list">{errT ? <div className="small" style={{ marginTop: 10 }}>⚠ {errT}</div> : !list ? <div className="drill"><Spin /> 불러오는 중…</div>
      : list.length ? <div className="panel2">{list.map(f => <div className="kw-row" key={f.name}><b style={{ fontWeight: 500 }}>{f.name.slice(0, 10).replace(/-/g, '.')}</b>
        <span className="small">{f.metadata && f.metadata.size ? Math.max(1, Math.round(f.metadata.size / 1024)) + 'KB' : ''}</span>
        <button className="btn" onClick={e => download(f.name, e.currentTarget)}>내려받기</button></div>)}</div>
        : <div className="small" style={{ marginTop: 10 }}>아직 백업이 없어요. 이번 주 일요일에 처음 만들어져요. 지금 바로 만들 수도 있어요.</div>}</div>
    <div className="actions"><button className="btn" onClick={closeModal}>닫기</button><button className="btn primary grow" id="bk-now" disabled={busy} onClick={now}>{busy ? '백업하는 중…' : '지금 백업하기'}</button></div>
  </>
}

/* ===== 전체 내보내기: 마크다운 파일 묶음(zip) — 옵시디언 등에서 그대로 열림 ===== */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(u8: Uint8Array) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function makeZip(files: { name: string; text: string }[]) {   // 압축 없이 묶기
  const enc = new TextEncoder(), parts: BlobPart[] = [], central: BlobPart[] = []; let off = 0, csize = 0
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)), dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate())
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true)
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true)
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true)
    parts.push(h.buffer, name, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true)
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true); c.setUint32(42, off, true)
    central.push(c.buffer, name); csize += 46 + name.length
    off += 30 + name.length + data.length
  })
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true)
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' })
}
const safeName = (t: unknown) => String(t || '제목 없음').replace(/[\\/:*?"<>|#[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '제목 없음'
function exportMarkdown() {
  const files: { name: string; text: string }[] = [], used: Record<string, 1> = {}
  const uniqName = (p: string) => { let n = p, i = 2; while (used[n]) n = p.replace(/\.md$/, ` (${i++}).md`); used[n] = 1; return n }
  S.books.forEach((b: Rec) => {
    const sn = snipsOf(b.ID)
    const meta = [['저자', b['저자']], ['옮긴이', b['옮긴이']], ['출판사', b['출판사']], ['상태', b['상태']], ['시작일', b['시작일']], ['완독일', b['완독일']], ['분량', b['분량'] ? b['분량'] + '쪽' : ''], ['분류', [b['대분류'], b['중분류'], b['개인분류']].filter(Boolean).join(' > ')], ['별점', b['별점'] ? '★'.repeat(Number(b['별점'])) : ''], ['한줄평', b['한줄평']]].filter(x => x[1])
    const body = `# ${b['제목']}\n\n${meta.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## 필사 (${sn.length})\n\n` +
      sn.map(s => `### ${s['제목'] || '(제목 없음)'}${hasPage(s) ? ` · ${pgLabel(s['쪽수'])}` : ''}\n\n${s['유형'] === '인용' ? sText(s).split('\n').map(l => '> ' + l).join('\n') + (sMemo(s) ? '\n\n메모: ' + sMemo(s) : '') : s['내용']}\n${s['키워드'] ? '\n' + splitKw(s['키워드']).map(k => '#' + k.replace(/\s/g, '_')).join(' ') + '\n' : ''}`).join('\n')
    files.push({ name: uniqName(`책/${safeName(b['제목'])}.md`), text: body })
  })
  S.notes.forEach((n: Rec) => files.push({ name: uniqName(`노트/${safeName(n['제목'])}.md`), text: `---\n상태: ${n['상태']}\n묶음: ${n['묶음'] || ''}\n키워드: ${n['키워드'] || ''}\n작성일: ${n['작성일'] || ''}\n수정일: ${n['수정일'] || ''}\n발행링크: ${n['발행링크'] || ''}\n---\n\n# ${n['제목'] || ''}\n\n${n['본문']}\n` }))
  const todos = S.memos.filter((m: Rec) => m['종류'] === '할일'), memos = S.memos.filter((m: Rec) => m['종류'] !== '할일')
  files.push({ name: '메모.md', text: `# 메모\n\n${memos.map((m: Rec) => `- (${m['작성일'] || ''}) ${String(m['내용']).replace(/\n/g, ' ')}`).join('\n')}\n\n# 할 일\n\n${todos.map((m: Rec) => `- [${isDone(m) ? 'x' : ' '}] ${m['내용']}${m['마감일'] ? ` (마감 ${String(m['마감일']).slice(0, 10)}${m['마감시간'] ? ' ' + m['마감시간'] : ''})` : ''}`).join('\n')}\n` })
  const blob = makeZip(files)
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `나의서재_백업_${S.today}.zip`
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 2000)
  toast(`책 ${S.books.length} · 글 ${S.notes.length} · 메모 파일로 내보냈어요`)
}

/* ===== 앱 잠금 (이 기기에서만, 비밀번호 4~8자리 숫자) ===== */
export async function pinHash(p: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('my-library:' + p))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function PinSetup() {
  useEffect(() => { setTimeout(() => $('pin1')?.focus(), 50) }, [])
  const save = async () => {
    const a = $('pin1')!.value, b = $('pin2')!.value
    if (!/^\d{4,8}$/.test(a)) { toast('숫자 4~8자리로 정해 주세요'); return }
    if (a !== b) { toast('두 번 넣은 비밀번호가 달라요'); return }
    LS.set('pin_hash', await pinHash(a)); closeModal(); toast('잠금을 켰어요'); emit()
  }
  return <><h3>새 비밀번호</h3><div className="small">숫자 4~8자리</div>
    <input className="field pin-in" id="pin1" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" placeholder="비밀번호" />
    <input className="field pin-in" id="pin2" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" placeholder="한 번 더" style={{ marginTop: 8 }} />
    <div className="small" style={{ marginTop: 8, color: 'var(--faint)' }}>잊어버리면 이 기기의 저장 데이터를 지우고 다시 로그인해야 해요. 서버의 기록은 그대로예요.</div>
    <div className="actions"><button className="btn" onClick={closeModal}>취소</button><button className="btn primary grow" onClick={save}>저장</button></div></>
}
function openLockSettings() {
  const on = !!LS.get('pin_hash')
  modal(<><h3>앱 잠금</h3>
    <div className="small" style={{ lineHeight: 1.6, marginBottom: 8 }}>앱을 열 때와, 1분 넘게 다른 앱을 쓰다 돌아올 때 비밀번호를 물어요. 이 기기에만 적용돼요.</div>
    {on ? <div className="actions"><button className="btn danger" onClick={() => { LS.del('pin_hash'); closeModal(); toast('잠금을 껐어요'); emit() }}>잠금 끄기</button><button className="btn grow" onClick={() => modal(<PinSetup />)}>비밀번호 바꾸기</button></div>
      : <div className="actions"><button className="btn primary grow" onClick={() => modal(<PinSetup />)}>잠금 켜기</button></div>}
    <div className="actions"><button className="btn grow" onClick={closeModal}>닫기</button></div></>)
}
export function LockScreen({ onOpen }: { onOpen: () => void }) {
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 50) }, [])
  const tryPin = async (quiet?: boolean) => {
    const v = ref.current!.value
    if (await pinHash(v) === LS.get('pin_hash')) { onOpen(); return }
    if (!quiet || v.length >= 8) { setMsg('비밀번호가 달라요'); ref.current!.value = '' }
  }
  const forgot = () => {
    if (!confirm('이 기기의 저장 데이터를 지우고 잠금을 풀까요?\n서버의 기록은 그대로이고, 다시 로그인하면 돼요.')) return
    LS.del('pin_hash'); LS.del(OUTBOX_KEY); IDB.del(CACHE_KEY).then(() => location.reload())
  }
  return <div id="lock"><div className="lock"><div className="lock-box"><div className="lock-ic">🔒</div><b>나의 서재</b>
    <input ref={ref} className="field pin-in" id="pin-try" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" placeholder="비밀번호"
      onInput={e => { if ((e.target as HTMLInputElement).value.length >= 4) tryPin(true) }} onKeyDown={e => { if (e.key === 'Enter') tryPin() }} />
    <div className="small" id="pin-msg" style={{ minHeight: '1.4em', marginTop: 6 }}>{msg}</div>
    <button className="btn primary" style={{ width: '100%' }} onClick={() => tryPin()}>열기</button>
    <button className="iconbtn" style={{ marginTop: 14, fontSize: 12.5 }} onClick={forgot}>비밀번호를 잊었어요</button></div></div></div>
}

/* ===== 업데이트 내역 · 공유 받기 점검 ===== */
export function openPatchNotes() {
  modal(<><h3>업데이트 내역 <Sub>지금 v{APP_VERSION}</Sub></h3>
    <div className="notes">{PATCH_NOTES.map((n, i) => <div className={'note ' + (i ? '' : 'now')} key={n.v}>
      <div className="nh"><b>v{n.v}</b><span>{n.t}</span><em>{n.d}</em></div>
      <ul>{n.items.map((x, j) => <li key={j}>{x}</li>)}</ul></div>)}</div>
    <div className="actions"><button className="btn primary grow" onClick={closeModal}>닫기</button></div></>)
}
function ShareCheck() {
  const [rows, setRows] = useState<React.ReactNode>('확인하는 중…')
  useEffect(() => { (async () => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Rec).standalone === true
    let mf = false
    try { const r = await fetch('/manifest.webmanifest', { cache: 'no-store' }); mf = !!(await r.json()).share_target } catch { /* 없음 */ }
    const ua = navigator.userAgent
    const browser = /SamsungBrowser/.test(ua) ? '삼성 인터넷' : /Chrome/.test(ua) ? '크롬' : '기타 브라우저'
    const row = (ok: boolean, t: string, fix: string) => <div className={'chk ' + (ok ? 'ok' : 'no')} key={t}><b>{ok ? '✓' : '✕'}</b><span>{t}{!ok && fix && <><br /><em>{fix}</em></>}</span></div>
    setRows(<>{row(mf, '앱 설정에 공유 받기가 들어 있어요', '앱을 새로 고친 뒤 다시 확인해 주세요')}
      {row(standalone, standalone ? '설치한 앱으로 열려 있어요' : '지금은 브라우저에서 열려 있어요', '홈 화면 아이콘으로 열어 주세요. 아이콘이 없으면 크롬 메뉴(⋮) → 앱 설치')}
      {row(browser === '크롬', '브라우저: ' + browser, '공유 받기는 크롬으로 설치한 앱에서 가장 잘 돼요. 크롬에서 주소를 열고 메뉴(⋮) → 앱 설치')}</>)
  })() }, [])
  return <><h3>공유 받기 점검</h3><div id="chk-box" className="small">{rows}</div>
    <div className="small" style={{ lineHeight: 1.7, marginTop: 12 }}>모두 ✓인데도 공유 목록에 없으면: 홈 화면 아이콘을 지우고 → 크롬에서 앱 주소를 열고 → 메뉴(⋮) → <b>앱 설치</b>로 다시 설치한 뒤, 휴대폰을 한 번 껐다 켜 주세요.<br />
      공유 목록 맨 끝 <b>더보기</b>에 숨어 있을 수도 있어요.<br /><br />
      공유 대신 쓰는 방법: 텍스트 추출에서 <b>복사</b> → 앱에서 책을 열고 <b>+ 문장 추가</b> → 내용 칸에 붙여넣기. 줄바꿈 정리와 AI 제목은 공유와 똑같이 돼요.</div>
    <div className="actions"><button className="btn primary grow" onClick={closeModal}>닫기</button></div></>
}

export async function sbLogout() {
  try { await pushOff() } catch { /* 무시 */ }
  try { await sb.auth.signOut() } catch { /* 무시 */ }
  await IDB.del(CACHE_KEY); LS.del(OUTBOX_KEY); location.replace('/')
}

/* ===== 설정 화면 ===== */
export function SettingsView() {
  const st = S.settings || {}, locked = !!LS.get('pin_hash')
  const goalRef = useRef<HTMLInputElement>(null)
  const Row = ({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }) => <button onClick={onClick}><span className="mi">{icon}</span><b>{title}</b><span>{sub}</span></button>
  const saveGoal = async () => {
    try { const r = await call('saveSettings', { goal: (goalRef.current?.value || '').trim(), libraryName: st.libraryName || '', libraryUrl: st.libraryUrl || '' }); S.settings = r; saveCache(); toast('저장했어요'); emit() } catch { /* call이 알려 줘요 */ }
  }
  return <section id="v-settings">
    <div className="topbar"><button className="iconbtn" onClick={goBack}>← 뒤로</button></div>
    <div className="view-head"><h1>설정</h1><p>나의 서재 v{APP_VERSION}</p></div>
    <div className="set-sec">독서</div>
    <div className="panel2"><h4>{S.today.slice(0, 4)}년 독서 목표 (권)</h4>
      <div className="inline"><input ref={goalRef} className="field" id="set-goal" inputMode="numeric" defaultValue={st.goal} key={'g' + st.goal} placeholder="예: 60" style={{ maxWidth: 140 }} /><button className="btn primary" onClick={saveGoal}>저장</button></div></div>
    <div className="set-sec">화면</div>
    <DesignPanel />
    <div className="set-sec">알림</div><NotifyPanel />
    <div className="set-sec">같이 쓰기</div>
    <div className="panel2"><label className="tg-check" style={{ marginTop: 0 }}><input type="checkbox" checked={togetherOn()} onChange={e => { const v = e.target.checked; tgSaveOpt('together', v); if (!v && ['together', 'pbook', 'plib'].includes(S.view)) go('library') }} /> ‘함께’ 탭 쓰기 <span className="small">끄면 탭이 숨겨져요 (보여준 기록은 그대로)</span></label>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={openMyProfile}>내 프로필</button><button className="btn" onClick={openShareSettings}>보여줄 것 설정</button><button className="btn" onClick={() => go('together')}>함께 탭으로</button></div></div>
    <div className="set-sec">기록 관리</div>
    <div className="more-list" style={{ marginTop: 0 }}>
      <Row icon="🗄" title="자동 백업" sub="매주 일요일 · 최근 8주 보관 · 내려받기" onClick={() => modal(<Backups />)} />
      <Row icon="⬇️" title="전체 내보내기" sub="책 · 필사 · 글 · 메모를 마크다운 파일로" onClick={exportMarkdown} />
      <Row icon="📥" title="노트 파일 가져오기" sub="삼성노트 txt를 필사로" onClick={openNoteImport} />
    </div>
    <div className="set-sec">보안</div>
    <div className="more-list" style={{ marginTop: 0 }}><Row icon="🔒" title="앱 잠금" sub={locked ? '켜짐 · 열 때 비밀번호' : '꺼짐 · 열 때 비밀번호를 물어요'} onClick={openLockSettings} /></div>
    <div className="set-sec">계정 · 저장</div>
    <div className="panel2">
      <div className="small" style={{ lineHeight: 1.6 }}>{(sbSession() || { user: {} as Rec }).user.email || ''} 계정 · Supabase에 저장 중{S.outbox.length ? <><br />올라가길 기다리는 기록 {S.outbox.length}개</> : null}</div>
      <div className="actions" style={{ marginTop: 8 }}><button className="btn" onClick={() => { if (confirm('로그아웃할까요?')) sbLogout() }}>로그아웃</button>
        <button className="btn" onClick={() => { if (S.outbox.length && !confirm(`아직 서버에 안 올라간 기록 ${S.outbox.length}개가 있어요. 그래도 비울까요?`)) return; resetLocal() }}>새로 불러오기</button></div></div>
    <div className="set-sec">정보</div>
    <div className="more-list" style={{ marginTop: 0 }}>
      <Row icon="🙋" title="업데이트 해줘요!" sub={reqRowSub()} onClick={openReqView} />
      <Row icon="🗒" title="업데이트 내역" sub={'v' + APP_VERSION} onClick={openPatchNotes} />
      <Row icon="📤" title="공유 받기 점검" sub="공유 목록에 안 보일 때" onClick={() => modal(<ShareCheck />)} />
    </div>
    <div style={{ height: 30 }} />
  </section>
}
export { Store }
