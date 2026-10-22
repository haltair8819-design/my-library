/* 나의 서재 — 나만의 노트
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   나만의 노트 (v2.4): 글 보관함 · 쓰기 · 연결된 필사 · [[링크]]
   =================================================================== */
S.notes = []; S.noteFilter = '전체'; S.noteGroup = ''; S.noteQ = ''; S.noteId = null; S.noteRead = false;
const NOTE_STATES = ['메모', '초안', '완성', '발행'];
const noteOf = id => S.notes.find(n => n.ID === resolveId(id));
function wordStats(t) {
  t = String(t || '');
  const all = t.replace(/\n/g, '').length, nows = t.replace(/\s/g, '').length;
  return { all, nows, ms: Math.ceil(all / 200), min: Math.max(1, Math.round(nows / 500)) };
}

function noteMatches() {
  const q = S.noteQ.trim().toLowerCase();
  let list = S.notes.filter(n => (S.noteFilter === '전체' || n['상태'] === S.noteFilter) && (!S.noteGroup || n['묶음'] === S.noteGroup));
  if (q) { const terms = q.replace(/^#/, '').split(/\s+/).filter(Boolean); list = list.filter(n => { const hay = (String(n['제목']) + ' ' + n['본문'] + ' ' + n['키워드']).toLowerCase(); return terms.every(t => hay.includes(t)); }); }
  return list.sort((a, b) => Number(b['수정시각'] || 0) - Number(a['수정시각'] || 0) || String(b['수정일'] || '').localeCompare(String(a['수정일'] || '')));
}
function noteCardsHtml() {
  const list = noteMatches(), sel = S.noteSel;
  return list.map(n => `<div class="note-card ${sel && sel.has(n.ID) ? 'sel' : ''}" data-n="${n.ID}">
        <div class="nc-top">${sel ? '<span class="sel-check">✓</span>' : ''}<span class="nst st-${NOTE_STATES.indexOf(n['상태'])}">${esc(n['상태'] || '초안')}</span>${n['묶음'] ? `<span class="small">${esc(n['묶음'])}</span>` : ''}</div>
        <div class="nc-t">${esc(n['제목'] || '제목 없음')}</div>
        <div class="nc-x">${esc(plainText(n['본문']).slice(0, 140))}</div>
        <div class="nc-m">${esc(String(n['수정일'] || n['작성일'] || '').slice(0, 10))} · ${wordStats(n['본문']).nows.toLocaleString()}자${n['키워드'] ? ' · ' + splitKw(n['키워드']).slice(0, 3).map(k => '#' + esc(k)).join(' ') : ''}</div>
      </div>`).join('') || `<div class="empty">${S.noteQ.trim() || S.noteFilter !== '전체' ? '찾는 글이 없어요' : '아직 쓴 글이 없어요. ✍ 새 글로 시작해 보세요.'}</div>`;
}
function drawNoteCards() {
  const el = $('note-list'); if (!el) return;
  el.innerHTML = noteCardsHtml();
  el.querySelectorAll('[data-n]').forEach(c => bindLongPress(c, () => { if (!S.noteSel) S.noteSel = new Set(); S.noteSel.add(c.dataset.n); renderNoteList(); }));
  const seed = $('seed-box'); if (seed) seed.classList.toggle('hidden', !!S.noteQ.trim() || !!S.noteSel);
  renderSelBar();
}
function renderNoteList() {
  const groups = uniq(S.notes.map(n => String(n['묶음'] || '').trim())).sort();
  const seed = writingSeed();
  $('v-notes').innerHTML = `
    <div class="view-head ai-head"><div><h1>노트</h1><p>${S.notes.length ? `글 ${S.notes.length}편` : '내 글을 모아 두는 곳이에요'}</p></div>
      <div style="display:flex;gap:6px">${S.notes.length ? `<button class="btn" onclick="toggleNoteSel()">${S.noteSel ? '선택 끝' : '☑ 선택'}</button>` : ''}<button class="btn primary" onclick="newNote()">✍ 새 글</button></div></div>
    <input class="field" id="n-q" type="search" placeholder="제목 · 내용 · #키워드 찾기" value="${esc(S.noteQ)}" style="margin:10px 0 8px" autocomplete="off">
    <div class="chips" id="n-f">${['전체', ...NOTE_STATES].map(x => `<button class="chip ${S.noteFilter === x ? 'on' : ''}" data-f="${x}">${x}</button>`).join('')}
      ${groups.length ? `<select class="field n-group" id="n-g"><option value="">모든 묶음</option>${groups.map(g => `<option ${S.noteGroup === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}</div>
    ${seed ? `<div class="seed ${S.noteQ.trim() || S.noteSel ? 'hidden' : ''}" id="seed-box"><div class="lb"><span>오늘의 글감</span><button onclick="S.seedRand=Math.random();renderNoteList()">다른 글감 ↻</button></div>
      <div class="tx tap" onclick="openSnipInBook('${seed.ID}')" title="이 필사로 가기">${esc(sText(seed).slice(0, 220))}${sText(seed).length > 220 ? '…' : ''}</div>
      <div class="mt tap" onclick="openSnipInBook('${seed.ID}')">${esc((book(seed['책ID']) || {})['제목'] || '')}${seed['쪽수'] ? ' · p.' + esc(seed['쪽수']) : ''}</div>
      <button class="btn" style="margin-top:10px" onclick="newNote('${seed.ID}')">이 문장으로 글쓰기</button></div>` : ''}
    <div class="note-list" id="note-list"></div>`;
  drawNoteCards();
  liveInput('n-q', v => { S.noteQ = v; drawNoteCards(); });
  $('n-f').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; S.noteFilter = c.dataset.f; [...$('n-f').querySelectorAll('[data-f]')].forEach(x => x.classList.toggle('on', x === c)); drawNoteCards(); };
  if ($('n-g')) $('n-g').onchange = e => { S.noteGroup = e.target.value; drawNoteCards(); };
  $('note-list').onclick = e => {
    const c = e.target.closest('[data-n]'); if (!c) return;
    if (!S.noteSel) { openNote(c.dataset.n); return; }
    const id = c.dataset.n; if (S.noteSel.has(id)) S.noteSel.delete(id); else S.noteSel.add(id);
    c.classList.toggle('sel', S.noteSel.has(id)); renderSelBar();
  };
}
/* ----- 여러 글 고르기 → 상태 · 묶음 한 번에 ----- */
function toggleNoteSel() { S.noteSel = S.noteSel ? null : new Set(); renderNoteList(); }
function renderSelBar() {
  let bar = $('selbar');
  if (!S.noteSel || S.view !== 'notes') { if (bar) bar.remove(); $('fab').classList.toggle('hidden', !FAB_VIEWS.includes(S.view)); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; bar.className = 'selbar'; document.body.appendChild(bar); }
  $('fab').classList.add('hidden');
  const n = S.noteSel.size, shown = noteMatches();
  const allOn = shown.length && shown.every(x => S.noteSel.has(x.ID));
  bar.innerHTML = `<div class="in"><div class="top"><b>${n}개 골랐어요</b><span><button onclick="selAllNotes(${allOn ? 0 : 1})">${allOn ? '모두 풀기' : '보이는 글 모두'}</button> · <button onclick="toggleNoteSel()">닫기</button></span></div>
    <div class="row2">${NOTE_STATES.map(st => `<button class="btn" ${n ? '' : 'disabled'} onclick="bulkNote({ '상태': '${st}' })">→ ${st}</button>`).join('')}
      <button class="btn" ${n ? '' : 'disabled'} onclick="bulkGroup()">묶음</button>
      <button class="btn danger" ${n ? '' : 'disabled'} onclick="bulkDelete()">삭제</button></div></div>`;
}
function selAllNotes(on) { const shown = noteMatches(); shown.forEach(x => on ? S.noteSel.add(x.ID) : S.noteSel.delete(x.ID)); drawNoteCards(); }
function queueNote(n, snapshot) {
  const data = {}; ['ID', '제목', '본문', '상태', '묶음', '키워드', '발행링크'].forEach(k => data[k] = n[k] ?? '');
  queue({ fn: 'saveNote', data, local: Object.assign({}, n), args: [!!snapshot] });
}
function bulkNote(patch) {
  const ids = [...S.noteSel]; let c = 0;
  ids.forEach(id => { const n = noteOf(id); if (!n) return; Object.assign(n, patch); n['수정일'] = S.today; n['수정시각'] = Date.now(); queueNote(n, false); c++; });
  closeModal(); S.noteSel = new Set(); drawNoteCards();
  toast(`${c}편을 ${patch['상태'] ? '‘' + patch['상태'] + '’로' : '‘' + (patch['묶음'] || '묶음 없음') + '’ 묶음으로'} 바꿨어요`);
}
function bulkGroup() {
  const groups = uniq(S.notes.map(n => String(n['묶음'] || '').trim())).sort();
  modal(`<h3>묶음 바꾸기 <span style="font-weight:400;color:var(--faint);font-size:13px">${S.noteSel.size}편</span></h3>
    <input class="field" id="bg-name" list="bg-groups" placeholder="묶음 이름 (비우면 묶음 없음)">${datalist('bg-groups', groups)}
    <div class="actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary grow" onclick="bulkNote({ '묶음': $('bg-name').value.trim() })">바꾸기</button></div>`);
  setTimeout(() => $('bg-name') && $('bg-name').focus(), 50);
}
function bulkDelete() {
  const ids = [...S.noteSel]; if (!ids.length || !confirm(`글 ${ids.length}편을 지울까요? 되돌릴 수 없어요.`)) return;
  ids.forEach(id => { const rid = resolveId(id); S.notes = S.notes.filter(x => x.ID !== rid); queue({ fn: 'deleteNote', id: rid }); });
  S.noteSel = new Set(); renderNoteList(); toast(`${ids.length}편을 지웠어요`);
}
// 글감: 노트 탭을 열 때마다 바뀌는 내 필사 하나
function writingSeed() {
  const pool = S.snips.filter(s => !isThought(s) && sText(s).length > 60 && sText(s).length < 600);
  if (!pool.length) return null;
  if (S.seedRand == null) S.seedRand = Math.random();
  return pool[Math.floor(S.seedRand * pool.length) % pool.length];
}
function plainText(t) { return String(t || '').replace(/^#{1,3}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[\[(.+?)\]\]/g, '$1'); }

/* ----- 새 글 · 열기 ----- */
function newNote(seedId) {
  const s = seedId ? S.snips.find(x => x.ID === seedId) : null;
  const body = s ? quoteBlock(s) + '\n\n' : '';
  const n = { ID: 'T' + uid(), '제목': '', '본문': body, '상태': '초안', '묶음': '', '키워드': s ? s['키워드'] || '' : '', '발행링크': '', '작성일': S.today, '수정일': S.today, '수정시각': Date.now() };
  S.notes.push(n);
  S.noteRead = false; S.noteDirty = false;
  go('note', n.ID);
  setTimeout(() => { const t = $('ne-title'); if (t) t.focus(); }, 60);
}
function openNote(id) { S.noteRead = !!(noteOf(id) && String(noteOf(id)['본문']).length > 0); go('note', resolveId(id)); }

function renderNoteEditor() {
  const n = noteOf(S.noteId);
  if (!n) { show('notes'); return; }
  const back = notesLinkingHere(n);
  const ws = wordStats(n['본문']);
  $('v-note').innerHTML = `
    <div class="topbar"><button class="iconbtn" onclick="leaveNote()">← 노트</button>
      <div class="ne-top-r"><select class="field ne-state" id="ne-state">${NOTE_STATES.map(x => `<option ${n['상태'] === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button class="iconbtn" onclick="noteMenu()" aria-label="더 보기">⋯</button></div></div>
    <div class="seg ne-mode"><button class="${S.noteRead ? '' : 'on'}" onclick="setNoteRead(false)">✎ 쓰기</button><button class="${S.noteRead ? 'on' : ''}" onclick="setNoteRead(true)">📖 읽기</button></div>
    ${S.noteRead ? `<article class="ne-read" id="ne-read"><h1>${esc(n['제목'] || '제목 없음')}</h1>${renderMd(n['본문'])}</article>` : `
    <input class="ne-title" id="ne-title" placeholder="제목" value="${esc(n['제목'])}">
    <div class="ne-tools" id="ne-tools">
      <button onclick="mdWrap('## ','')" title="소제목">소제목</button><button onclick="mdWrap('> ','')" title="인용">❝ 인용</button>
      <button onclick="mdWrap('**','**')" title="굵게"><b>굵게</b></button><button onclick="mdWrap('- ','')" title="목록">• 목록</button>
      <button onclick="openLinkPicker()" title="책이나 글 잇기">[[ ]] 잇기</button><button onclick="openRelated()" title="연결된 필사">📚 필사 넣기</button><button onclick="openNoteAI();runNoteAI('spell')" title="맞춤법 검사">✓ 맞춤법</button>
      ${voiceBtns('ne-body', 'note', 'recNoteDone')}</div>
    <textarea class="ne-body" id="ne-body" placeholder="쓰고 싶은 이야기를 적어 보세요.&#10;[[책 제목]]처럼 쓰면 책과 이어져요.">${esc(n['본문'])}</textarea>`}
    <div class="ne-count" id="ne-count">${ws.nows.toLocaleString()}자 (공백 포함 ${ws.all.toLocaleString()}) · 원고지 ${ws.ms}매 · 읽는 데 ${ws.min}분</div>
    <div class="panel2"><h4>키워드 <button class="kw-ai" onclick="noteKw(this)">AI 추천</button></h4>
      <input class="field" id="ne-kw" value="${esc(n['키워드'])}" placeholder="예: 사랑, 자유">
      <div class="row" style="margin-top:8px"><div><label style="margin-top:0">묶음</label><input class="field" id="ne-group" list="ne-groups" value="${esc(n['묶음'])}" placeholder="예: 독서 에세이"></div>
        <div><label style="margin-top:0">발행 링크</label><input class="field" id="ne-link" value="${esc(n['발행링크'])}" placeholder="브런치 · 블로그 주소"></div></div>
      <datalist id="ne-groups">${uniq(S.notes.map(x => x['묶음'])).map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      ${n['발행링크'] ? `<a class="small" href="${esc(n['발행링크'])}" target="_blank" rel="noopener">발행한 글 열기 ↗</a>` : ''}</div>
    <div class="actions"><button class="btn" onclick="openNoteAI()">✨ AI 제안</button><button class="btn" onclick="openRelated()">📚 연결된 필사</button>
      <button class="btn primary grow" onclick="saveNoteNow(true)">저장</button></div>
    ${back.length ? `<div class="panel2"><h4>이 글을 언급한 글</h4>${back.map(x => `<button class="mini" onclick="openNote('${x.ID}')"><b>${esc(x['제목'] || '제목 없음')}</b></button>`).join('')}</div>` : ''}
    <div class="small ne-saved" id="ne-saved">${S.noteDirty ? '저장 전' : isTemp(n.ID) ? '' : '저장됨'}</div>`;
  if (!S.noteRead) {
    const body = $('ne-body'), title = $('ne-title');
    const grow = () => { body.style.height = 'auto'; body.style.height = Math.max(260, body.scrollHeight + 4) + 'px'; };
    grow();
    body.oninput = () => { grow(); noteChanged(); };
    title.oninput = noteChanged;
    body.addEventListener('paste', e => { const t = (e.clipboardData || window.clipboardData).getData('text'); if (t && /\n/.test(t) && e.shiftKey) return; });
  }
  ['ne-kw', 'ne-group', 'ne-link'].forEach(id => { $(id).oninput = noteChanged; });
  $('ne-state').onchange = () => { noteChanged(); saveNoteNow(false); };
}
function setNoteRead(r) { if (!r) S.noteRead = false; else { collectNote(); S.noteRead = true; } renderNoteEditor(); window.scrollTo(0, 0); }

/* ----- 저장: 쓰는 동안 자동, 저장 버튼·나갈 때 고친 내역 남김 ----- */
let noteTimer = null;
function collectNote() {
  const n = noteOf(S.noteId); if (!n) return null;
  if ($('ne-title')) n['제목'] = $('ne-title').value;
  if ($('ne-body')) n['본문'] = $('ne-body').value;
  if ($('ne-kw')) n['키워드'] = $('ne-kw').value;
  if ($('ne-group')) n['묶음'] = $('ne-group').value.trim();
  if ($('ne-link')) n['발행링크'] = $('ne-link').value.trim();
  if ($('ne-state')) n['상태'] = $('ne-state').value;
  return n;
}
function noteChanged() {
  S.noteDirty = true;
  const n = collectNote(); if (!n) return;
  const ws = wordStats(n['본문']);
  const c = $('ne-count'); if (c) c.textContent = `${ws.nows.toLocaleString()}자 (공백 포함 ${ws.all.toLocaleString()}) · 원고지 ${ws.ms}매 · 읽는 데 ${ws.min}분`;
  const sv = $('ne-saved'); if (sv) sv.textContent = '쓰는 중…';
  clearTimeout(noteTimer); noteTimer = setTimeout(() => saveNoteNow(false), 1500);
}
function saveNoteNow(snapshot) {
  clearTimeout(noteTimer);
  const n = collectNote(); if (!n) return;
  if (!String(n['제목']).trim() && !String(n['본문']).trim()) return;
  if (String(n['본문']).length > 49000) { toast('글이 너무 길어요 (4만 9천 자까지). 두 편으로 나눠 주세요'); return; }
  n['수정일'] = S.today; n['수정시각'] = Date.now(); n['글자수'] = wordStats(n['본문']).nows;
  const data = {}; ['ID', '제목', '본문', '상태', '묶음', '키워드', '발행링크'].forEach(k => data[k] = n[k] ?? '');
  queue({ fn: 'saveNote', data, local: Object.assign({}, n), args: [!!snapshot] });
  S.noteDirty = false;
  const sv = $('ne-saved'); if (sv) sv.textContent = navigator.onLine ? '저장됨' : '이 기기에 저장됨 · 연결되면 올라가요';
  if (snapshot) toast('저장했어요');
}
function leaveNote() {
  const n = collectNote();
  if (n && (String(n['제목']).trim() || String(n['본문']).trim())) { if (S.noteDirty || isTemp(n.ID)) saveNoteNow(true); }
  else if (n) S.notes = S.notes.filter(x => x !== n);   // 빈 글은 버림
  stopDictate();
  goBack();
}
function noteMenu() {
  const n = collectNote(); if (!n) return;
  modal(`<h3>${esc(n['제목'] || '제목 없음')}</h3><div class="qmenu">
    <button onclick="copyNote('rich')"><b>📋 블로그용 복사</b><span>브런치 · 블로그에 그대로 붙여넣기</span></button>
    <button onclick="copyNote('md')"><b>📝 마크다운 복사</b><span>## · > 표시 그대로</span></button>
    <button onclick="closeModal();printNote()"><b>🖨 PDF로 저장</b><span>인쇄 창에서 PDF로 저장</span></button>
    <button onclick="openVersions()"><b>🕘 고친 내역</b><span>저장할 때마다 남은 예전 모습</span></button>
    <button onclick="removeNote()"><b style="color:var(--warn)">🗑 삭제</b><span>되돌릴 수 없어요</span></button></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
function removeNote() {
  if (!confirm('이 글을 지울까요?')) return;
  const id = resolveId(S.noteId);
  S.notes = S.notes.filter(x => x.ID !== id); queue({ fn: 'deleteNote', id });
  closeModal(); go('notes'); toast('지웠어요');
}

/* ----- 쓰기 도구 ----- */
function mdWrap(pre, post) {
  const ta = $('ne-body'); if (!ta) return;
  const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  if (!post) {   // 줄 앞에 붙이기 (선택한 줄 모두)
    const ls = v.lastIndexOf('\n', a - 1) + 1, le = v.indexOf('\n', b); const end = le < 0 ? v.length : le;
    const block = v.slice(ls, end).split('\n').map(l => l.startsWith(pre) ? l.slice(pre.length) : pre + l).join('\n');
    ta.value = v.slice(0, ls) + block + v.slice(end); ta.setSelectionRange(ls, ls + block.length);
  } else {
    const sel = v.slice(a, b) || '굵게';
    ta.value = v.slice(0, a) + pre + sel + post + v.slice(b); ta.setSelectionRange(a + pre.length, a + pre.length + sel.length);
  }
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function insertAtCursor(text) {
  const ta = $('ne-body'); if (!ta) return;
  const a = ta.selectionStart ?? ta.value.length, v = ta.value;
  const pre = a > 0 && v[a - 1] !== '\n' ? '\n\n' : '';
  ta.value = v.slice(0, a) + pre + text + '\n' + v.slice(a);
  const p = a + pre.length + text.length + 1; ta.setSelectionRange(p, p); ta.focus(); ta.dispatchEvent(new Event('input'));
}
function recNoteDone(res) {
  if ($('ne-body')) { insertAtCursor(res.text); if (res.title && $('ne-title') && !$('ne-title').value.trim()) $('ne-title').value = res.title; noteChanged(); }
  else voiceToMemo(res);
}
function quoteBlock(s) {
  const b = book(s['책ID']) || {};
  return sText(s).trim().split('\n').map(l => '> ' + l).join('\n') + `\n> — 『${b['제목'] || ''}』${s['쪽수'] !== '' && s['쪽수'] != null ? ', p.' + s['쪽수'] : ''}`;
}

/* ----- 연결된 필사: 쓰는 글과 맞는 내 필사 ----- */
function relatedSnips(n, limit) {
  const text = (String(n['제목']) + ' ' + String(n['본문'])).toLowerCase();
  const kws = splitKw(n['키워드']);
  const linked = [...String(n['본문']).matchAll(/\[\[(.+?)\]\]/g)].map(m => m[1].trim());
  const linkedBooks = new Set(S.books.filter(b => linked.some(t => normT(b['제목']) === normT(t))).map(b => b.ID));
  const words = uniq((text.match(/[가-힣a-z]{2,}/g) || []).map(w => w.replace(/(은|는|이|가|을|를|에|의|와|과|도|로|으로|에서|에게|까지|부터|처럼|이다|했다|한다|하는|하고)$/, '')).filter(w => w.length >= 2)).slice(0, 80);
  const T = topicData();
  const scored = S.snips.map(s => {
    const sk = splitKw(s['키워드']); let sc = 0;
    kws.forEach(k => { if (sk.includes(k)) sc += 6; });
    sk.forEach(k => { if (text.includes(k.toLowerCase())) sc += 3; });
    if (linkedBooks.has(s['책ID'])) sc += 5;
    const body = String(s['내용']).toLowerCase();
    let hit = 0; words.forEach(w => { if (w.length >= 2 && body.includes(w) && !(T.cnt[w] > 120)) hit++; });
    sc += Math.min(6, hit);
    if (String(n['본문']).includes(String(s['내용']).slice(0, 30))) sc = -1;   // 이미 넣은 문장
    return { s, sc };
  }).filter(x => x.sc >= 3).sort((a, b) => b.sc - a.sc);
  return scored.slice(0, limit || 30).map(x => x.s);
}
function relListHtml(n, q) {
  const qq = String(q || '').trim().toLowerCase();
  const terms = qq.replace(/^#/, '').split(/\s+/).filter(Boolean);
  const list = qq ? S.snips.filter(s => { const hay = (s['내용'] + ' ' + s['제목'] + ' ' + s['키워드'] + ' ' + ((book(s['책ID']) || {})['제목'] || '')).toLowerCase(); return terms.every(t => hay.includes(t)); }).slice(0, 40) : relatedSnips(n, 30);
  const sub = $('rel-sub'); if (sub) sub.textContent = qq ? `찾은 문장 ${list.length}${list.length >= 40 ? '+' : ''}` : '쓰는 글과 맞는 내 필사';
  return list.map(s => { const b = book(s['책ID']) || {}; return `<button class="mini" onclick="insertSnip('${s.ID}')">
      <b>${esc(s['제목'] || b['제목'] || '')}</b><span>${esc(sText(s).slice(0, 140))}${sText(s).length > 140 ? '…' : ''}</span>
      <em>${esc(b['제목'] || '')}${s['쪽수'] !== '' && s['쪽수'] != null ? ' · p.' + esc(s['쪽수']) : ''} · 누르면 인용으로 넣어요</em></button>`; }).join('') || `<div class="al-msg">${qq ? '찾는 문장이 없어요' : '아직 이어지는 필사가 없어요. 키워드를 달거나 몇 문장 더 쓰면 찾아줘요.'}</div>`;
}
function openRelated(q) {
  const n = collectNote(); if (!n) return;
  modal(`<h3>필사 넣기 <span id="rel-sub" style="font-weight:400;color:var(--faint);font-size:13px"></span></h3>
    <input class="field" id="rel-q" type="search" placeholder="문장 · 책 · #키워드 찾기" value="${esc(q || '')}" autocomplete="off">
    <div class="rel-list" id="rel-list"></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  $('rel-list').innerHTML = relListHtml(n, q);
  liveInput('rel-q', v => { const el = $('rel-list'); if (el) el.innerHTML = relListHtml(n, v); });
}
function insertSnip(id) {
  const s = S.snips.find(x => x.ID === id); if (!s) return;
  closeModal();
  if (S.noteRead) { S.noteRead = false; renderNoteEditor(); }
  insertAtCursor(quoteBlock(s));
  const kw = $('ne-kw'); if (kw && s['키워드']) { const c = splitKw(kw.value); splitKw(s['키워드']).forEach(k => { if (!c.includes(k)) c.push(k); }); kw.value = c.join(', '); noteChanged(); }
  toast('인용으로 넣었어요');
}

/* ----- [[링크]] ----- */
const normT = t => String(t || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^0-9a-z가-힣]/g, '');
function resolveLink(t) {
  const k = normT(t);
  const b = S.books.find(x => normT(x['제목']) === k) || S.books.find(x => k.length >= 3 && normT(x['제목']).startsWith(k));
  if (b) return { kind: 'book', id: b.ID };
  const n = S.notes.find(x => normT(x['제목']) === k);
  if (n) return { kind: 'note', id: n.ID };
  return null;
}
function openLink(t) {
  const r = resolveLink(t);
  if (!r) { toast('이어진 책이나 글을 찾지 못했어요'); return; }
  if (r.kind === 'book') go('book', r.id); else openNote(r.id);
}
function linkListHtml(q) {
  const qq = normT(q);
  const bs = S.books.filter(b => !qq || normT(b['제목'] + b['저자']).includes(qq)).slice(0, 12);
  const ns = S.notes.filter(n => n.ID !== resolveId(S.noteId) && n['제목'] && (!qq || normT(n['제목']).includes(qq))).slice(0, 8);
  return (bs.map(b => `<button class="al-item" onclick="insertLink(${esc(JSON.stringify(b['제목']))})">${spine(b)}<div><b>${esc(b['제목'])}</b><span>책 · ${esc(b['저자'] || '')}</span></div></button>`).join('')
    + ns.map(n => `<button class="al-item" onclick="insertLink(${esc(JSON.stringify(n['제목']))})"><div class="spine nspine">글</div><div><b>${esc(n['제목'])}</b><span>내 글</span></div></button>`).join('')) || '<div class="al-msg">찾는 책이나 글이 없어요</div>';
}
function openLinkPicker(q) {
  modal(`<h3>책이나 글 잇기 <span style="font-weight:400;color:var(--faint);font-size:13px">[[제목]]으로 들어가요</span></h3>
    <input class="field" id="lk-q" type="search" placeholder="책 · 글 제목 찾기" value="${esc(q || '')}" autocomplete="off">
    <div class="share-list" id="lk-list">${linkListHtml(q)}</div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  liveInput('lk-q', v => { const el = $('lk-list'); if (el) el.innerHTML = linkListHtml(v); });
}
function insertLink(title) {
  closeModal();
  const ta = $('ne-body'); if (!ta) return;
  const a = ta.selectionStart ?? ta.value.length, v = ta.value, ins = `[[${title}]]`;
  ta.value = v.slice(0, a) + ins + v.slice(a); ta.setSelectionRange(a + ins.length, a + ins.length); ta.focus(); ta.dispatchEvent(new Event('input'));
}
// 이 글 · 이 책을 [[ ]]로 언급한 글
function notesLinkingHere(target) {
  const names = target['본문'] !== undefined ? [target['제목']] : [target['제목']];
  const keys = names.map(normT).filter(Boolean);
  if (!keys.length) return [];
  return S.notes.filter(n => n !== target && [...String(n['본문']).matchAll(/\[\[(.+?)\]\]/g)].some(m => keys.includes(normT(m[1]))));
}

/* ----- 읽기 화면: 가벼운 마크다운 ----- */
function renderMd(t) {
  const lines = esc(String(t || '')).split('\n');
  let html = '', list = false, quote = [];
  const flushQ = () => { if (quote.length) { html += `<blockquote>${quote.join('<br>')}</blockquote>`; quote = []; } };
  const closeL = () => { if (list) { html += '</ul>'; list = false; } };
  lines.forEach(l => {
    let m;
    if ((m = l.match(/^&gt;\s?(.*)$/))) { closeL(); quote.push(m[1]); return; }
    flushQ();
    if ((m = l.match(/^#{1,3}\s+(.*)$/))) { closeL(); html += `<h2>${m[1]}</h2>`; }
    else if ((m = l.match(/^\s*[-•]\s+(.*)$/))) { if (!list) { html += '<ul>'; list = true; } html += `<li>${m[1]}</li>`; }
    else if (!l.trim()) { closeL(); }
    else { closeL(); html += `<p>${l}</p>`; }
  });
  flushQ(); closeL();
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[\[(.+?)\]\]/g, (all, t) => `<a class="wlink ${resolveLink(t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')) ? '' : 'dead'}" onclick="openLink(this.dataset.t)" data-t="${t}">${t}</a>`);
}

/* ----- AI 제안 (고르는 건 내가) ----- */
function openNoteAI() {
  const n = collectNote(); if (!n || !String(n['본문']).trim()) { toast('본문을 먼저 써 주세요'); return; }
  modal(`<h3>✨ AI 제안 <span style="font-weight:400;color:var(--faint);font-size:13px">내 문장은 그대로, 고르는 건 내가</span></h3>
    <div class="qmenu"><button onclick="runNoteAI('titles')"><b>제목 후보</b><span>글에 어울리는 제목 5개</span></button>
      <button onclick="runNoteAI('spell')"><b>맞춤법 살펴보기</b><span>틀린 곳만 골라 보여줘요</span></button>
      <button onclick="runNoteAI('summary')"><b>소개글 · 태그</b><span>블로그 · 브런치 소개용</span></button></div>
    <div id="ai-out"></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
async function runNoteAI(mode) {
  const n = collectNote(); const out = $('ai-out'); if (!out) return;
  out.innerHTML = '<div class="drill"><span class="spin"></span> 살펴보는 중…</div>';
  try {
    const r = await Store.run('noteAssist', { mode, '제목': n['제목'], '본문': n['본문'] });
    if (!$('ai-out')) return;
    if (mode === 'titles') out.innerHTML = `<div class="ic-lb">눌러서 제목으로 쓰기</div>${(r.titles || []).map(t => `<button class="mini" onclick="useTitle(${esc(JSON.stringify(t))})"><b>${esc(t)}</b></button>`).join('')}`;
    else if (mode === 'spell') { S.fixes = r.fixes || []; out.innerHTML = S.fixes.length ? `<div class="ic-lb">고칠 곳 ${S.fixes.length}개 · 바꿀 것만 누르세요</div>${S.fixes.map((f, i) => `<div class="fix" id="fx-${i}"><div><s>${esc(f.from)}</s> → <b>${esc(f.to)}</b><div class="small">${esc(f.why || '')}</div></div><button class="btn" onclick="applyFix(${i})">바꾸기</button></div>`).join('')}` : '<div class="drill">맞춤법에서 눈에 띄는 곳이 없어요 👍</div>'; }
    else out.innerHTML = `<div class="ic-lb">소개글</div><div class="share-peek">${esc(r.summary || '')}</div>${(r.tags || []).length ? `<div class="kw-chips">${r.tags.map(t => `<span class="chip">#${esc(String(t).replace(/^#/, ''))}</span>`).join('')}</div>` : ''}
      <button class="btn" style="margin-top:8px" onclick="navigator.clipboard.writeText(${esc(JSON.stringify((r.summary || '') + '\n' + (r.tags || []).map(t => '#' + String(t).replace(/^#/, '')).join(' ')))}).then(()=>toast('복사했어요'))">복사</button>`;
  } catch (e) { if ($('ai-out')) out.innerHTML = `<div class="drill">⚠ ${esc(e.message || e)}</div>`; }
}
function useTitle(t) { closeModal(); if (S.noteRead) { S.noteRead = false; renderNoteEditor(); } $('ne-title').value = t; noteChanged(); toast('제목을 바꿨어요'); }
function applyFix(i) {
  const f = S.fixes[i]; const n = noteOf(S.noteId); if (!f || !n) return;
  const body = $('ne-body') ? $('ne-body').value : n['본문'];
  const at = body.indexOf(f.from); if (at < 0) { toast('이미 바뀐 곳이에요'); return; }
  const nb = body.slice(0, at) + f.to + body.slice(at + f.from.length);
  if ($('ne-body')) $('ne-body').value = nb; n['본문'] = nb;
  noteChanged();
  const el = $('fx-' + i); if (el) { el.classList.add('done'); el.querySelector('button').textContent = '바꿈'; el.querySelector('button').disabled = true; }
}

/* ----- 고친 내역 ----- */
async function openVersions() {
  const id = resolveId(S.noteId);
  if (isTemp(id)) { toast('저장한 뒤에 볼 수 있어요'); return; }
  modal('<h3>고친 내역</h3><div class="drill"><span class="spin"></span> 불러오는 중…</div>');
  try {
    S.versions = await Store.run('getNoteVersions', id);
    const fmt = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    modal(`<h3>고친 내역 <span style="font-weight:400;color:var(--faint);font-size:13px">저장 버튼을 누를 때마다 남아요 (최근 30개)</span></h3>
      ${S.versions.length ? S.versions.map((v, i) => `<div class="ver"><div><b>${fmt(v.at)}</b> · ${wordStats(v['본문']).nows.toLocaleString()}자<div class="small">${esc(plainText(v['본문']).slice(0, 90))}</div></div>
        <button class="btn" onclick="restoreVersion(${i})">이걸로 되돌리기</button></div>`).join('') : '<div class="drill">아직 남은 내역이 없어요.</div>'}
      <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  } catch (e) { modal(`<h3>고친 내역</h3><div class="drill">⚠ ${esc(e.message || e)}</div><div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`); }
}
function restoreVersion(i) {
  const v = S.versions[i], n = noteOf(S.noteId); if (!v || !n) return;
  if (!confirm('이 내용으로 되돌릴까요? 지금 내용도 고친 내역에 남아요.')) return;
  saveNoteNow(true);
  n['제목'] = v['제목']; n['본문'] = v['본문'];
  closeModal(); S.noteRead = false; renderNoteEditor(); noteChanged(); saveNoteNow(true);
}

/* ----- 내보내기 ----- */
function noteHtml(n) {
  return `<h1>${esc(n['제목'] || '')}</h1>` + renderMd(n['본문']).replace(/<a class="wlink[^"]*"[^>]*>(.*?)<\/a>/g, '$1');
}
async function copyNote(kind) {
  const n = collectNote(); if (!n) return;
  try {
    if (kind === 'rich' && window.ClipboardItem) {
      const html = noteHtml(n), text = (n['제목'] ? n['제목'] + '\n\n' : '') + plainText(n['본문']);
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText((n['제목'] ? '# ' + n['제목'] + '\n\n' : '') + n['본문']);
    closeModal(); toast('복사했어요. 붙여넣기 하세요');
  } catch (e) { toast('복사하지 못했어요. 읽기 화면에서 길게 눌러 복사해 주세요'); }
}
function printNote() {
  const n = collectNote(); if (!n) return;
  let el = $('print-area'); if (!el) { el = document.createElement('div'); el.id = 'print-area'; document.body.appendChild(el); }
  el.innerHTML = `<article class="ne-read">${noteHtml(n)}</article>`;
  setTimeout(() => window.print(), 50);
}

async function noteKw(btn) {
  const n = collectNote(); if (!n || !String(n['본문']).trim()) { toast('본문을 먼저 써 주세요'); return; }
  btn.disabled = true; btn.textContent = '추천 중…';
  try {
    const ks = await Store.run('suggestKeywords', { '책ID': '', '제목': n['제목'], '내용': String(n['본문']).slice(0, 3000) });
    const kw = $('ne-kw'); const c = splitKw(kw.value); (ks || []).forEach(k => { if (!c.includes(k)) c.push(k); }); kw.value = c.join(', '); noteChanged();
    if (!ks || !ks.length) toast('추천할 키워드를 찾지 못했어요');
  } catch (e) { toast('⚠ ' + (e.message || e)); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'AI 추천'; } }
}

