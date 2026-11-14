/* 음성: 🎤 받아쓰기(말하는 대로 바로) · 🎙 녹음 후 정리(서버 AI) — 예전 lists-voice.js */
import { S, emit, uid, type Rec } from './core'
import { IDB } from './store/local'
import { Store } from './store/server'
import { toast, errMsg } from './ui'
import { addMemo, parseQuick } from './memo'

export const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T | null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dict: { rec: any; btn: HTMLElement; keep: boolean } | null = null

// 🎤 받아쓰기: target 칸의 커서 자리에 넣음. 다시 누르면 멈춤
export function toggleDictate(btn: HTMLElement, targetId: string) {
  if (dict) { stopDictate(); return }
  if (!SR) { toast('이 브라우저는 받아쓰기를 지원하지 않아요. 키보드의 🎤를 써 주세요'); return }
  const ta = $<HTMLTextAreaElement>(targetId); if (!ta) return
  const rec = new SR()
  rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = true
  const base = ta.value, at = ta.selectionStart ?? base.length; let committed = ''
  const put = (interim: string) => {
    const glue = (s: string) => s && at > 0 && !/\s$/.test(base.slice(0, at)) ? ' ' + s : s
    const mid = glue((committed + interim).trim())
    ta.value = base.slice(0, at) + mid + base.slice(at)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) committed += (committed && !/\s$/.test(committed) ? ' ' : '') + t.trim()
      else interim += t
    }
    put(interim ? (committed ? ' ' : '') + interim : '')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onerror = (e: any) => { if (e.error === 'not-allowed') toast('마이크 사용을 허용해 주세요'); else if (e.error === 'network') toast('받아쓰기는 인터넷이 필요해요') }
  rec.onend = () => { if (dict && dict.rec === rec && dict.keep) { try { rec.start() } catch { stopDictate() } } }   // 말을 멈추면 끊기는 것 이어 붙이기
  dict = { rec, btn, keep: true }
  btn.classList.add('rec-on'); btn.setAttribute('aria-pressed', 'true')
  try { rec.start(); toast('말하세요. 다시 누르면 멈춰요') } catch { stopDictate() }
}
export function stopDictate() {
  if (!dict) return
  const d = dict; dict = null; d.keep = false
  try { d.rec.stop() } catch { /* 무시 */ }
  d.btn.classList.remove('rec-on'); d.btn.setAttribute('aria-pressed', 'false')
}

/* ----- 🎙 녹음 → WAV(16kHz) → 정리 ----- */
const REC_MAX_SEC = 300
export type RecMode = 'memo' | 'snip' | 'note'
// 녹음 창 상태 (components/RecOverlay가 그려요)
export const R: { on: boolean; mode: RecMode | ''; sec: number; level: number; busy: string; pick: Rec[] | null } = { on: false, mode: '', sec: 0, level: 0, busy: '', pick: null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recr: any = null
export async function startRecording(mode: RecMode, onDone?: (res: Rec) => void) {
  stopDictate()
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('이 기기에서는 녹음을 할 수 없어요'); return }
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }) } catch { toast('마이크 사용을 허용해 주세요'); return }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AC = window.AudioContext || (window as any).webkitAudioContext
  let ctx: AudioContext; try { ctx = new AC({ sampleRate: 16000 }) } catch { ctx = new AC() }
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  proc.onaudioprocess = e => {
    const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d))
    let s = 0; for (let i = 0; i < d.length; i += 16) s = Math.max(s, Math.abs(d[i])); R.level = s
  }
  src.connect(proc); proc.connect(ctx.destination)
  recr = { stream, ctx, proc, src, chunks, mode, onDone, t0: Date.now(), rate: ctx.sampleRate }
  R.on = true; R.mode = mode; R.sec = 0; emit()
  recr.timer = setInterval(() => {
    if (!recr) return
    R.sec = Math.floor((Date.now() - recr.t0) / 1000); emit()
    if (R.sec >= REC_MAX_SEC) finishRecording()
  }, 200)
}
function endRecorder() {
  const r = recr; recr = null; if (!r) return null
  clearInterval(r.timer)
  try { r.proc.disconnect(); r.src.disconnect() } catch { /* 무시 */ }
  r.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
  try { r.ctx.close() } catch { /* 무시 */ }
  R.on = false; emit()
  return r
}
export function cancelRecording() { endRecorder(); toast('녹음을 지웠어요') }
export async function finishRecording() {
  const r = endRecorder(); if (!r) return
  const wav = encodeWav(r.chunks, r.rate, 16000)
  if ((Date.now() - r.t0) < 800) { toast('녹음이 너무 짧아요'); return }
  if (!navigator.onLine) { await voiceQueueAdd(wav, r.mode); toast('인터넷이 연결되면 메모로 정리해 둘게요'); return }
  await transcribeWav(wav, r.mode, r.onDone)
}
export function showBusy(t: string) { R.busy = t; emit() }
export function hideBusy() { R.busy = ''; emit() }
async function transcribeWav(wav: Blob, mode: RecMode, onDone?: (res: Rec) => void) {
  const b64 = await blobToB64(wav)
  showBusy('녹음을 글로 옮기는 중… (10~40초)')
  try {
    const res = await Store.run('transcribeAudio', { audio: b64, mime: 'audio/wav', mode })
    hideBusy()
    if (onDone) onDone(res); else voiceToMemo(res)
  } catch (e) {
    hideBusy()
    if ((e as Rec).network) { await voiceQueueAdd(wav, mode); toast('연결이 끊겨 녹음을 보관했어요. 연결되면 메모로 정리해요') } else toast('⚠ ' + errMsg(e))
  }
}
// 녹음 결과 → 메모(+ 할 일)
export function voiceToMemo(res: Rec) {
  if (res.text) addMemo({ '종류': '메모', '내용': (res.title ? res.title + '\n' : '') + res.text })
  ;(res.todos || []).forEach((t: string) => { const p = parseQuick(t, '할일'); addMemo({ '종류': '할일', '내용': p.text, '마감일': p.due, '마감시간': p.time }) })
  toast(`메모${res.todos && res.todos.length ? ` + 할 일 ${res.todos.length}개` : ''}로 정리했어요`)
}
// 16kHz 모노 16비트 WAV로 (AI가 읽을 수 있는 형식)
function encodeWav(chunks: Float32Array[], inRate: number, outRate: number) {
  const len = chunks.reduce((t, c) => t + c.length, 0)
  const pcm = new Float32Array(len); let o = 0; chunks.forEach(c => { pcm.set(c, o); o += c.length })
  let data = pcm
  if (inRate !== outRate) {
    const ratio = inRate / outRate, n = Math.floor(pcm.length / ratio); data = new Float32Array(n)
    for (let i = 0; i < n; i++) { const a = Math.floor(i * ratio), b = Math.min(pcm.length, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b; j++) s += pcm[j]; data[i] = s / Math.max(1, b - a) }
  }
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf)
  const w = (p: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, outRate, true)
  v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true) }
  return new Blob([buf], { type: 'audio/wav' })
}
export function blobToB64(blob: Blob): Promise<string> { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob) }) }

/* 오프라인 녹음 보관함 → 연결되면 메모로 정리 */
export const VQ = { n: 0 }
async function voiceQueueAdd(wav: Blob, mode: RecMode) {
  const q = ((await IDB.get('voiceq')) as Rec[]) || []
  q.push({ id: uid(), at: Date.now(), mode, wav })
  await IDB.set('voiceq', q); VQ.n = q.length; emit()
}
let voiceBusy = false
export async function processVoiceQueue() {
  if (voiceBusy || !navigator.onLine || !Store.ready()) return
  const q = ((await IDB.get('voiceq')) as Rec[]) || []; VQ.n = q.length; emit(); if (!q.length) return
  voiceBusy = true
  try {
    while (q.length) {
      const it = q[0]
      try { voiceToMemo(await Store.run('transcribeAudio', { audio: await blobToB64(it.wav), mime: 'audio/wav', mode: 'memo' })) } catch { break }
      q.shift(); await IDB.set('voiceq', q)
    }
  } finally { voiceBusy = false; VQ.n = q.length; emit() }
}
window.addEventListener('online', () => setTimeout(processVoiceQueue, 1500))

/* 필사 입력 창: 🎙 읽어서 넣기 결과 */
export function recSnipDone(res: Rec) {
  const ta = $<HTMLTextAreaElement>('f-txt'); if (!ta) { voiceToMemo(res); return }
  ta.value = ta.value.trim() ? ta.value.trim() + '\n' + res.text : res.text
  const pg = $('f-page'), tt = $('f-ttl')
  if (res.page && pg && !pg.value.trim()) pg.value = res.page
  if (res.title && tt && !tt.value.trim()) tt.value = res.title
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  if (res.thought) { addMemo({ '종류': '메모', '내용': res.thought, '책ID': S.bookId || '' }); toast('덧붙인 생각은 메모로 따로 저장했어요') }
}
