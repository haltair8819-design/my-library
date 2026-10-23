/* 나의 서재 — 책 목록 · 밝기 · 음성 · 필사 사진
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   책 목록 (통계에서 누르면: 줄 · 앨범 보기)
   =================================================================== */
S.blist = null; S.statOpen = {};
const BL_SORTS = {
  '최근 완독': (a, b) => String(b['완독일'] || '').localeCompare(String(a['완독일'] || '')),
  '오래된 완독': (a, b) => String(a['완독일'] || '9999').localeCompare(String(b['완독일'] || '9999')),
  '별점 높은': (a, b) => (Number(b['별점']) || 0) - (Number(a['별점']) || 0) || String(b['완독일'] || '').localeCompare(String(a['완독일'] || '')),
  '두꺼운': (a, b) => (Number(b['분량']) || 0) - (Number(a['분량']) || 0),
  '빨리 읽은': (a, b) => (Number(a['완독일수']) || 99999) - (Number(b['완독일수']) || 99999),
  '필사 많은': (a, b) => snipsOf(b.ID).length - snipsOf(a.ID).length,
  '제목': (a, b) => String(a['제목']).localeCompare(String(b['제목']), 'ko')
};
function openBookList(title, books, sort, sub) {
  S.blist = { title, sub: sub || '', ids: books.map(b => b.ID), sort: sort || '최근 완독' };
  go('blist');
}
function shortDate(d) { d = String(d || ''); return d ? d.slice(2, 4) + '.' + d.slice(5, 7) + '.' + d.slice(8, 10) : ''; }
function periodText(b) {
  const s = b['시작일'], e = b['완독일'];
  if (!s && !e) return '';
  const days = Number(b['완독일수']) || 0;
  const end = e && s && String(e).slice(0, 4) === String(s).slice(0, 4) ? String(e).slice(5, 7) + '.' + String(e).slice(8, 10) : shortDate(e);
  return (s ? shortDate(s) : '') + (e ? ' – ' + end : ' – 읽는 중') + (days ? ` · ${days}일` : '');
}
function renderBookList() {
  const L = S.blist;
  if (!L) { show('stats'); return; }
  const mode = LS.get('blist_mode') === 'album' ? 'album' : 'line';
  const books = L.ids.map(book).filter(Boolean).sort(BL_SORTS[L.sort] || BL_SORTS['최근 완독']);
  const pages = books.reduce((t, b) => t + (Number(b['분량']) || 0), 0);
  const ds = books.map(b => Number(b['완독일수'])).filter(n => n > 0);
  const avg = ds.length ? (ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(1) : '';
  const meta = b => [b['분량'] ? Number(b['분량']).toLocaleString() + '쪽' : '', periodText(b), b['개인분류'] || b['대분류'] || ''].filter(Boolean);
  $('v-blist').innerHTML = `
    <div class="topbar"><button class="iconbtn" onclick="goBack()">← 뒤로</button></div>
    <div class="bl-head"><h1>${esc(L.title)}</h1>
      <p>${books.length}권${pages ? ' · ' + pages.toLocaleString() + '쪽' : ''}${avg ? ' · 한 권 평균 ' + avg + '일' : ''}${L.sub ? ' · ' + esc(L.sub) : ''}</p></div>
    <div class="bl-tools">
      <div class="seg bl-mode"><button class="${mode === 'line' ? 'on' : ''}" onclick="setBlMode('line')" aria-label="한 줄씩 보기">☰ 목록</button><button class="${mode === 'album' ? 'on' : ''}" onclick="setBlMode('album')" aria-label="표지로 보기">▦ 앨범</button></div>
      <select class="field bl-sort" onchange="S.blist.sort=this.value;renderBookList()">${Object.keys(BL_SORTS).map(k => `<option value="${k}" ${k === L.sort ? 'selected' : ''}>${k} 순</option>`).join('')}</select>
    </div>
    ${!books.length ? '<div class="empty">해당하는 책이 없어요.</div>' : mode === 'line'
      ? `<div class="bl-lines">${books.map(b => `<div class="bl-row" onclick="go('book','${b.ID}')">${spine(b)}
          <div class="bl-info"><div class="bl-t">${esc(b['제목'])}</div><div class="bl-a">${esc(b['저자'] || '')}</div>
            <div class="bl-m">${meta(b).map(esc).join('<i>·</i>')}${Number(b['별점']) ? `<i>·</i><span class="stars">${starText(b['별점'])}</span>` : ''}</div></div></div>`).join('')}</div>`
      : `<div class="bl-album">${books.map(b => `<div class="bl-card" onclick="go('book','${b.ID}')">${spine(b)}
          <div class="bl-t">${esc(b['제목'])}</div><div class="bl-m">${esc(periodText(b))}</div>
          <div class="bl-m">${esc([b['분량'] ? b['분량'] + '쪽' : '', b['개인분류'] || ''].filter(Boolean).join(' · '))}</div>
          ${Number(b['별점']) ? `<div class="stars">${starText(b['별점'])}</div>` : ''}</div>`).join('')}</div>`}`;
}
function setBlMode(m) { LS.set('blist_mode', m); renderBookList(); }

/* ===================================================================
   라이트 · 다크 모드 (휴대폰 설정 따라가기 / 늘 밝게 / 늘 어둡게)
   =================================================================== */
const MODES = [['system', '휴대폰 따라'], ['light', '밝게'], ['dark', '어둡게']];
function curMode() { return LS.get('mode') || 'system'; }
function applyMode() {
  const m = curMode();
  const dark = m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(x => { x.setAttribute('content', paper); x.removeAttribute('media'); });
}
function setMode(m) {
  LS.set('mode', m); applyMode();
  if (S.loaded) show(S.view);
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (curMode() === 'system') { applyMode(); if (S.loaded) show(S.view); } }); } catch (e) {}
// 앱을 잠깐 나갔다 오는 사이 폰 밝기가 바뀌었을 때 (앱 안에서는 change가 안 올 때가 있어요)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || curMode() !== 'system') return;
  const was = document.documentElement.dataset.mode; applyMode();
  if (S.loaded && document.documentElement.dataset.mode !== was) show(S.view);
});
function modePickerHtml() {
  const sysDark = (() => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } })();
  return `<div class="seg mode-seg" style="margin-top:10px">${MODES.map(([k, t]) => `<button class="${curMode() === k ? 'on' : ''}" onclick="setMode('${k}');openSettings()">${t}</button>`).join('')}</div>
    ${curMode() === 'system' ? `<div class="small" style="margin-top:8px;line-height:1.6">지금 앱이 받은 폰 설정: <b>${sysDark ? '어둡게' : '밝게'}</b> · 앱을 띄운 브라우저: <b>${/SamsungBrowser/i.test(navigator.userAgent) ? '삼성 인터넷' : /Chrome/i.test(navigator.userAgent) ? '크롬' : '기타'}</b>${sysDark ? '' : ` · 폰은 다크 모드인데 밝게로 나오면 <b>Chrome → 설정 → 테마</b>가 ‘시스템 기본값’인지 확인해 주세요 (이 앱은 크롬으로 열려서 크롬 테마를 따라가요)`}</div>` : ''}`;
}


/* ===================================================================
   음성 (v2.4): 🎤 받아쓰기(말하는 대로 바로) · 🎙 녹음 후 정리(Gemini)
   =================================================================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
LONG_FNS.transcribeAudio = 1; LONG_FNS.noteAssist = 1;
let dict = null;   // 지금 받아쓰는 중인 것

// 🎤 받아쓰기: target 칸의 커서 자리에 넣음. 다시 누르면 멈춤
function toggleDictate(btn, targetId) {
  if (dict) { stopDictate(); return; }
  if (!SR) { toast('이 브라우저는 받아쓰기를 지원하지 않아요. 키보드의 🎤를 써 주세요'); return; }
  const ta = $(targetId); if (!ta) return;
  const rec = new SR();
  rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = true;
  let base = ta.value, at = ta.selectionStart ?? base.length, committed = '';
  const put = interim => {
    const glue = (s) => s && at > 0 && !/\s$/.test(base.slice(0, at)) ? ' ' + s : s;
    const mid = glue((committed + interim).trim());
    ta.value = base.slice(0, at) + mid + base.slice(at);
    ta.dispatchEvent(new Event('input'));
  };
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) committed += (committed && !/\s$/.test(committed) ? ' ' : '') + t.trim();
      else interim += t;
    }
    put(interim ? (committed ? ' ' : '') + interim : '');
  };
  rec.onerror = e => { if (e.error === 'not-allowed') toast('마이크 사용을 허용해 주세요'); else if (e.error === 'network') toast('받아쓰기는 인터넷이 필요해요'); };
  rec.onend = () => { if (dict && dict.rec === rec && dict.keep) { try { rec.start(); } catch (err) { stopDictate(); } } };   // 말을 멈추면 끊기는 것 이어 붙이기
  dict = { rec, btn, keep: true };
  btn.classList.add('rec-on'); btn.setAttribute('aria-pressed', 'true');
  try { rec.start(); toast('말하세요. 다시 누르면 멈춰요'); } catch (e) { stopDictate(); }
}
function stopDictate() {
  if (!dict) return;
  const d = dict; dict = null; d.keep = false;
  try { d.rec.stop(); } catch (e) {}
  d.btn.classList.remove('rec-on'); d.btn.setAttribute('aria-pressed', 'false');
}

/* ----- 🎙 녹음 → WAV(16kHz) → Gemini 정리 ----- */
const REC_MAX_SEC = 300;
let recr = null;
async function startRecording(mode, onDone) {
  stopDictate();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('이 기기에서는 녹음을 할 수 없어요'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
  catch (e) { toast('마이크 사용을 허용해 주세요'); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = []; let level = 0;
  proc.onaudioprocess = e => {
    const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
    let s = 0; for (let i = 0; i < d.length; i += 16) s = Math.max(s, Math.abs(d[i])); level = s;
  };
  src.connect(proc); proc.connect(ctx.destination);
  recr = { stream, ctx, proc, src, chunks, mode, onDone, t0: Date.now(), rate: ctx.sampleRate };
  const label = { memo: '말한 내용을 메모로 정리해요. 할 일이 있으면 따로 뽑아요.', snip: '책 문장을 읽어 주세요. "48쪽"처럼 쪽수도 말하면 쪽수 칸에 넣어요.', note: '말한 그대로 글로 옮겨요.' }[mode] || '';
  $('rec').innerHTML = `<div class="rec-sheet" role="dialog" aria-label="녹음 중">
    <div class="rec-top"><span class="rec-dot"></span><b id="rec-t">0:00</b><span class="small">최대 5분</span></div>
    <div class="rec-bar"><i id="rec-lv"></i></div>
    <div class="small" style="margin:8px 0 14px;line-height:1.55">${label}</div>
    <div class="actions" style="margin:0"><button class="btn" onclick="cancelRecording()">취소</button>
      <button class="btn primary grow" onclick="finishRecording()">녹음 끝 · 정리하기</button></div></div>`;
  recr.timer = setInterval(() => {
    const sec = Math.floor((Date.now() - recr.t0) / 1000);
    const t = $('rec-t'); if (t) t.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const lv = $('rec-lv'); if (lv) lv.style.width = Math.min(100, level * 260) + '%';
    if (sec >= REC_MAX_SEC) finishRecording();
  }, 200);
}
function endRecorder() {
  const r = recr; recr = null; if (!r) return null;
  clearInterval(r.timer);
  try { r.proc.disconnect(); r.src.disconnect(); } catch (e) {}
  r.stream.getTracks().forEach(t => t.stop());
  try { r.ctx.close(); } catch (e) {}
  $('rec').innerHTML = '';
  return r;
}
function cancelRecording() { endRecorder(); toast('녹음을 지웠어요'); }
async function finishRecording() {
  const r = endRecorder(); if (!r) return;
  const wav = encodeWav(r.chunks, r.rate, 16000);
  if ((Date.now() - r.t0) < 800) { toast('녹음이 너무 짧아요'); return; }
  if (!navigator.onLine) {
    await voiceQueueAdd(wav, r.mode);
    toast('인터넷이 연결되면 메모로 정리해 둘게요');
    return;
  }
  await transcribeWav(wav, r.mode, r.onDone);
}
async function transcribeWav(wav, mode, onDone) {
  const b64 = await blobToB64(wav);
  showBusy('녹음을 글로 옮기는 중… (10~40초)');
  try {
    const res = await Store.run('transcribeAudio', { audio: b64, mime: 'audio/wav', mode });
    hideBusy();
    if (onDone) onDone(res); else voiceToMemo(res);
  } catch (e) {
    hideBusy();
    if (e.network) { await voiceQueueAdd(wav, mode); toast('연결이 끊겨 녹음을 보관했어요. 연결되면 메모로 정리해요'); }
    else toast('⚠ ' + (e.message || e));
  }
}
// 녹음 결과 → 메모(+ 할 일)
function voiceToMemo(res) {
  if (res.text) addMemo({ '종류': '메모', '내용': (res.title ? res.title + '\n' : '') + res.text });
  (res.todos || []).forEach(t => { const p = parseQuick(t, '할일'); addMemo({ '종류': '할일', '내용': p.text, '마감일': p.due, '마감시간': p.time }); });
  toast(`메모${res.todos && res.todos.length ? ` + 할 일 ${res.todos.length}개` : ''}로 정리했어요`);
  if (S.view === 'memo') renderMemoView();
}
// 16kHz 모노 16비트 WAV로 (Gemini가 읽을 수 있는 형식)
function encodeWav(chunks, inRate, outRate) {
  let len = chunks.reduce((t, c) => t + c.length, 0);
  const pcm = new Float32Array(len); let o = 0; chunks.forEach(c => { pcm.set(c, o); o += c.length; });
  let data = pcm;
  if (inRate !== outRate) {
    const ratio = inRate / outRate, n = Math.floor(pcm.length / ratio); data = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.floor(i * ratio), b = Math.min(pcm.length, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b; j++) s += pcm[j]; data[i] = s / Math.max(1, b - a); }
  }
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, outRate, true);
  v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
function blobToB64(blob) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); }); }

/* 오프라인 녹음 보관함 → 연결되면 메모로 정리 */
async function voiceQueueAdd(wav, mode) {
  const q = (await IDB.get('voiceq')) || [];
  q.push({ id: uid(), at: Date.now(), mode, wav });
  await IDB.set('voiceq', q); renderVoiceQueue();
}
let voiceBusy = false;
async function processVoiceQueue() {
  if (voiceBusy || !navigator.onLine || !Store.ready()) return;
  const q = (await IDB.get('voiceq')) || []; if (!q.length) return;
  voiceBusy = true;
  try {
    while (q.length) {
      const it = q[0];
      try { voiceToMemo(await Store.run('transcribeAudio', { audio: await blobToB64(it.wav), mime: 'audio/wav', mode: 'memo' })); }
      catch (e) { break; }
      q.shift(); await IDB.set('voiceq', q);
    }
  } finally { voiceBusy = false; renderVoiceQueue(); }
}
async function renderVoiceQueue() {
  const el = $('voiceq'); if (!el) return;
  const q = (await IDB.get('voiceq')) || [];
  el.innerHTML = q.length ? `<div class="notice">🎙 정리를 기다리는 녹음 ${q.length}개 · 인터넷이 연결되면 메모로 정리돼요</div>` : '';
}
window.addEventListener('online', () => setTimeout(processVoiceQueue, 1500));

/* 잠깐 기다리는 표시 */
function showBusy(t) { $('rec').innerHTML = `<div class="rec-sheet busy"><span class="spin"></span> ${esc(t)}</div>`; }
function hideBusy() { $('rec').innerHTML = ''; }

/* 칸 옆에 붙이는 🎤 🎙 버튼 */
function voiceBtns(targetId, mode, after) {
  return `<span class="vbtns"><button type="button" class="vbtn" title="받아쓰기" aria-label="받아쓰기" onclick="toggleDictate(this,'${targetId}')">🎤</button>` +
    `<button type="button" class="vbtn" title="녹음 후 정리" aria-label="녹음 후 정리" onclick="startRecording('${mode}', ${after || 'null'})">🎙</button></span>`;
}

/* ===================================================================
   필사 입력 창: 📷 사진에서 가져오기 · 🎙 읽어서 넣기 (v2.4)
   =================================================================== */
function snipPhoto(input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  if (!navigator.onLine) { toast('사진 읽기는 인터넷이 필요해요'); return; }
  (async () => {
    showBusy('사진에서 글자 읽는 중… (10~30초)');
    try {
      const img = await shrinkImage(f);
      const r = await Store.run('scanPage', { image: img.data, mime: 'image/jpeg', bookId: S.bookId });
      hideBusy();
      const opts = (r.highlights || []).concat(r.page && r.page.text ? [Object.assign({ whole: true }, r.page)] : []);
      if (!opts.length) { toast('글자를 찾지 못했어요'); return; }
      if (opts.length === 1) { fillSnipFrom(opts[0]); return; }
      S.snipOpts = opts;
      $('rec').innerHTML = `<div class="rec-sheet"><b>어느 부분을 넣을까요?</b>
        <div class="pick-list">${opts.map((o, i) => `<button onclick="fillSnipFrom(S.snipOpts[${i}]);$('rec').innerHTML=''"><span class="small">${o.whole ? '페이지 전체' : '하이라이트 ' + (i + 1)}${o.page ? ' · p.' + esc(o.page) : ''}</span>${esc(o.text.slice(0, 120))}${o.text.length > 120 ? '…' : ''}</button>`).join('')}</div>
        <div class="actions" style="margin:8px 0 0"><button class="btn grow" onclick="$('rec').innerHTML=''">취소</button></div></div>`;
    } catch (e) { hideBusy(); toast('⚠ ' + (e.message || e)); }
  })();
}
function fillSnipFrom(o) {
  const ta = $('f-txt'); if (!ta) return;
  const cur = ta.value.trim();
  if (!cur || confirm('지금 내용을 사진에서 읽은 글로 바꿀까요?\n취소를 누르면 뒤에 덧붙여요.')) ta.value = o.text;
  else ta.value = cur + '\n\n' + o.text;
  if (o.page && !$('f-page').value.trim()) $('f-page').value = o.page;
  if (o.title && !$('f-ttl').value.trim()) $('f-ttl').value = o.title;
  if (o.keywords && o.keywords.length) { const kw = $('f-kw'); const c = kw.value.split(',').map(x => x.trim()).filter(Boolean); o.keywords.forEach(k => { if (!c.includes(k)) c.push(k); }); kw.value = c.join(', '); }
  toast('사진에서 읽은 글을 넣었어요. 확인 후 저장하세요');
}
function recSnipDone(res) {
  const ta = $('f-txt'); if (!ta) { voiceToMemo(res); return; }
  ta.value = ta.value.trim() ? ta.value.trim() + '\n' + res.text : res.text;
  if (res.page && !$('f-page').value.trim()) $('f-page').value = res.page;
  if (res.title && !$('f-ttl').value.trim()) $('f-ttl').value = res.title;
  if (res.thought) { addMemo({ '종류': '메모', '내용': res.thought, '책ID': S.bookId || '' }); toast('덧붙인 생각은 메모로 따로 저장했어요'); }
}

