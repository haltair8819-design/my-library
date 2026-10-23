/* 나의 서재 — 기록 (v2.14): 노트(글) + 메모 + 할 일을 한 화면에
 * 저장은 그대로 따로(notes · memos 표). 화면만 하나로 합쳐요.
 * 화면 이름은 예전 'notes'를 그대로 써요 ('memo'로 가면 여기로 와요). */

S.recF = '전체'; S.recQ = ''; S.recLimit = 40; S.recSel = null; S.recDoneOpen = false;
const REC_FILTERS = ['전체', '생각', '할 일', '초안', '완성', '발행'];
const REC_TAG = { memo: '✍ 생각', todo: '☑ 할 일', '메모': '✍ 생각', '초안': '📝 초안', '완성': '✅ 완성', '발행': '📢 발행' };

// 하나의 목록으로: { k: 'n:ID' | 'm:ID', type: 'note'|'memo'|'todo', t: 정렬 시각, ... }
function recItems() {
  const out = [];
  S.notes.forEach(n => out.push({ k: 'n:' + n.ID, type: 'note', st: n['상태'] || '초안', o: n, t: Number(n['수정시각']) || Date.parse(n['수정일'] || n['작성일'] || '') || 0,
    hay: (String(n['제목']) + ' ' + n['본문'] + ' ' + n['키워드']).toLowerCase() }));
  S.memos.forEach(m => { const todo = m['종류'] === '할일';
    out.push({ k: 'm:' + m.ID, type: todo ? 'todo' : 'memo', st: todo ? '할 일' : '메모', o: m, done: todo && isDone(m),
      t: Date.parse(m['작성일'] || '') || 0, hay: String(m['내용'] || '').toLowerCase() }); });
  return out;
}
function recFiltered() {
  const q = S.recQ.trim().toLowerCase(), terms = q.replace(/^#/, '').split(/\s+/).filter(Boolean), f = S.recF;
  return recItems().filter(x => {
    if (f === '생각' && !(x.type === 'memo' || (x.type === 'note' && x.st === '메모'))) return false;
    if (f === '할 일' && x.type !== 'todo') return false;
    if (['초안', '완성', '발행'].includes(f) && !(x.type === 'note' && x.st === f)) return false;
    return !terms.length || terms.every(w => x.hay.includes(w));
  });
}
const recSel = k => S.recSel && S.recSel.has(k);
function recCheck(k) { return S.recSel ? `<span class="m-check">${recSel(k) ? '✓' : ''}</span>` : ''; }
function recTodoHtml(m) {
  const k = 'm:' + m.ID, d = m['마감일'] ? dayDiff(m['마감일']) : null, fin = isDone(m), b = m['책ID'] ? book(m['책ID']) : null;
  return `<div class="todo ${fin ? 'fin' : ''} ${recSel(k) ? 'msel' : ''}" data-rk="${k}" data-id="${m.ID}">
    ${S.recSel ? recCheck(k) : `<button class="tick" onclick="toggleTodo('${m.ID}')" aria-label="${fin ? '안 끝낸 일로' : '끝냈어요'}">${fin ? '✓' : ''}</button>`}
    <div class="tbody" onclick="recTap('${k}')"><div class="tt">${esc(m['내용'])}</div>
      ${(m['마감일'] && !fin) || b || fin ? `<div class="tm">${fin ? (m['완료일'] ? String(m['완료일']).slice(5).replace('-', '/') + ' 끝냄' : '끝냄') : `<span class="${d < 0 ? 'late' : d === 0 ? 'due-now' : ''}">${dueLabel(m['마감일'], m['마감시간'])}</span>`}${b ? ` · 📖 ${esc(b['제목'])}` : ''}</div>` : ''}</div></div>`;
}
function recCardHtml(x) {
  const k = x.k;
  if (x.type === 'todo') return recTodoHtml(x.o);
  if (x.type === 'memo') {
    const m = x.o, t = String(m['내용'] || ''), first = t.split('\n')[0], rest = t.slice(first.length).trim(), b = m['책ID'] ? book(m['책ID']) : null;
    const head = first.length > 40 ? '' : first, body = head ? rest : t;
    return `<div class="rec ${recSel(k) ? 'msel' : ''}" data-rk="${k}" onclick="recTap('${k}')">
      <div class="rec-h">${recCheck(k)}<b>${esc(head || '')}</b><span class="rec-tag">${REC_TAG.memo}</span></div>
      ${body ? `<div class="rec-x">${esc(body.slice(0, 220))}</div>` : ''}
      <div class="rec-m">${m['작성일'] ? esc(String(m['작성일']).slice(0, 10).replace(/-/g, '.')) : '방금'}${b ? ' · 📖 ' + esc(b['제목']) : ''}</div></div>`;
  }
  const n = x.o;
  return `<div class="rec ${recSel(k) ? 'msel' : ''}" data-rk="${k}" onclick="recTap('${k}')">
    <div class="rec-h">${recCheck(k)}<b>${esc(n['제목'] || '제목 없음')}</b><span class="rec-tag st-${NOTE_STATES.indexOf(x.st)}">${REC_TAG[x.st] || x.st}</span></div>
    <div class="rec-x">${esc(plainText(n['본문']).slice(0, 140))}</div>
    <div class="rec-m">${[esc(String(n['수정일'] || n['작성일'] || '').slice(0, 10).replace(/-/g, '.')), wordStats(n['본문']).nows.toLocaleString() + '자', n['묶음'] ? esc(n['묶음']) : '', n['키워드'] ? splitKw(n['키워드']).slice(0, 3).map(k2 => '#' + esc(k2)).join(' ') : ''].filter(Boolean).join(' · ')}</div></div>`;
}
const TODO_GROUPS = [['지난 할 일', d => d < 0], ['오늘', d => d === 0], ['내일', d => d === 1], ['이번 주', d => d > 1 && d <= 7], ['나중에', d => d > 7]];
function recTodoGroupsHtml(todos) {
  const sorted = todos.slice().sort((a, b) => String(a['마감일'] || '9999').localeCompare(String(b['마감일'] || '9999')) || String(a['마감시간'] || '99').localeCompare(String(b['마감시간'] || '99')));
  let h = '';
  TODO_GROUPS.forEach(([name, test]) => { const l = sorted.filter(m => m['마감일'] && test(dayDiff(m['마감일']))); if (l.length) h += `<div class="group-label ${name === '지난 할 일' ? 'late' : ''}">${name} <span>${l.length}</span></div>${l.map(recTodoHtml).join('')}`; });
  const nd = sorted.filter(m => !m['마감일']); if (nd.length) h += `<div class="group-label">날짜 없음 <span>${nd.length}</span></div>${nd.map(recTodoHtml).join('')}`;
  return h;
}

/* ----- 화면 ----- */
function renderRecords() {
  const el = $('v-notes'); if (!el) return;
  const seed = writingSeed();
  const todosLeft = S.memos.filter(m => m['종류'] === '할일' && !isDone(m)).length;
  el.innerHTML = `
    <div class="view-head ai-head"><div><h1>기록</h1><p>생각과 글, 해야 할 일을 모아 두는 곳${todosLeft ? ` · 할 일 ${todosLeft}개 남음` : ''}</p></div>
      <button class="btn primary" style="white-space:nowrap" onclick="openNewRecord()">✍ 새 기록</button></div>
    <input class="field" id="rec-q" type="search" placeholder="제목 · 내용 · #키워드 찾기" value="${esc(S.recQ)}" style="margin:10px 0 8px" autocomplete="off">
    <div class="chips" id="rec-f">${REC_FILTERS.map(x => `<button class="chip ${S.recF === x ? 'on' : ''}" data-f="${x}">${x}</button>`).join('')}</div>
    <div id="voiceq"></div>
    ${seed ? `<div class="seed ${S.recQ.trim() || S.recSel || S.recF !== '전체' ? 'hidden' : ''}" id="seed-box"><div class="lb"><span>떠오르는 글감</span><button onclick="S.seedRand=Math.random();renderRecords()">다른 글감 ↻</button></div>
      <div class="tx tap" onclick="openSnipInBook('${seed.ID}')">${esc(sText(seed).slice(0, 220))}${sText(seed).length > 220 ? '…' : ''}</div>
      <div class="mt tap" onclick="openSnipInBook('${seed.ID}')">${esc((book(seed['책ID']) || {})['제목'] || '')}${seed['쪽수'] ? ' · p.' + esc(seed['쪽수']) : ''}</div>
      <button class="btn" style="margin-top:10px" onclick="newNote('${seed.ID}')">이 문장으로 글쓰기</button></div>` : ''}
    <div id="rec-list"></div>`;
  recDraw();
  liveInput('rec-q', v => { S.recQ = v; S.recLimit = 40; recDraw(); });
  $('rec-f').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; S.recF = c.dataset.f; S.recLimit = 40; [...$('rec-f').children].forEach(x => x.classList.toggle('on', x === c)); recDraw(); };
  if (typeof renderVoiceQueue === 'function') { renderVoiceQueue(); processVoiceQueue(); }
}
function recDraw() {
  const el = $('rec-list'); if (!el) return;
  const list = recFiltered(), f = S.recF;
  const seed = $('seed-box'); if (seed) seed.classList.toggle('hidden', !!S.recQ.trim() || !!S.recSel || f !== '전체');
  let h = '';
  if (f === '할 일') {
    const todos = list.filter(x => !x.done).map(x => x.o), done = list.filter(x => x.done).map(x => x.o).sort((a, b) => String(b['완료일']).localeCompare(String(a['완료일'])));
    h = (todos.length ? `<div class="todo-list">${recTodoGroupsHtml(todos)}</div>` : '<div class="empty">할 일이 없어요. ‘새 기록 → 할 일’로 넣어 보세요.</div>')
      + (done.length ? `<button class="btn tg-more" onclick="S.recDoneOpen=!S.recDoneOpen;recDraw()">${S.recDoneOpen ? '끝낸 일 접기' : `끝낸 일 ${done.length}개 보기`}</button>${S.recDoneOpen ? `<div class="todo-list">${done.slice(0, 100).map(recTodoHtml).join('')}</div>` : ''}` : '');
  } else {
    // 전체: 남은 할 일을 위에 조금, 그 아래 생각 · 글을 최근 순으로
    const todos = f === '전체' ? list.filter(x => x.type === 'todo' && !x.done) : [];
    const rest = list.filter(x => x.type !== 'todo').sort((a, b) => b.t - a.t);
    if (todos.length) {
      const sorted = todos.map(x => x.o).sort((a, b) => String(a['마감일'] || '9999').localeCompare(String(b['마감일'] || '9999')));
      h += `<div class="rec-sec"><div class="group-label">할 일 <span>${todos.length}</span>${todos.length > 3 ? `<button class="kw-ai" onclick="S.recF='할 일';renderRecords()">모두 보기 ›</button>` : ''}</div><div class="todo-list">${sorted.slice(0, 3).map(recTodoHtml).join('')}</div></div>`;
    }
    h += rest.length ? `<div class="rec-list">${rest.slice(0, S.recLimit).map(recCardHtml).join('')}</div>${rest.length > S.recLimit ? `<button class="btn tg-more" onclick="S.recLimit+=40;recDraw()">더보기 (${rest.length - S.recLimit}개 남음)</button>` : ''}`
      : (todos.length ? '' : `<div class="empty">${S.recQ.trim() || f !== '전체' ? '찾는 기록이 없어요' : '아직 기록이 없어요. ✍ 새 기록으로 시작해 보세요.'}</div>`);
  }
  el.innerHTML = h;
  el.querySelectorAll('[data-rk]').forEach(c => bindLongPress(c, () => { if (!S.recSel) S.recSel = new Set(); S.recSel.add(c.dataset.rk); recDraw(); }));
  recSelBar();
}
function recTap(k) {
  if (!S.recSel) { const id = k.slice(2); if (k[0] === 'n') openNote(id); else openMemo(id); return; }
  if (S.recSel.has(k)) S.recSel.delete(k); else S.recSel.add(k);
  const y = window.scrollY; recDraw(); window.scrollTo(0, y);
}

/* ----- 새 기록 ----- */
function openNewRecord() {
  modal(`<h3>새 기록 만들기</h3>
    <div class="rec-new">
      <button onclick="closeModal();newNote()"><i>📝</i><b>글쓰기</b><span>생각, 독서 기록, 글감, 초안</span></button>
      <button onclick="openQuickSheet('할일')"><i>☑</i><b>할 일</b><span>일정, 해야 할 일, 완료 체크</span></button>
      <button class="wide" onclick="openQuickSheet('')"><i>✍</i><b>빠른 메모</b><span>떠오른 생각을 입력하고 바로 저장</span></button>
      <button class="wide" onclick="closeModal();startRecording('memo')"><i>🎙</i><b>음성 메모</b><span>말하면 메모 · 할 일로 정리</span></button>
    </div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}

/* ----- 여러 개 고르기 ----- */
function recSelBar() {
  let bar = $('selbar');
  if (!S.recSel || S.view !== 'notes') { if (bar && S.view === 'notes') bar.remove(); if (S.view === 'notes') $('fab').classList.remove('hidden'); return; }
  $('fab').classList.add('hidden');
  if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; bar.className = 'selbar'; document.body.appendChild(bar); }
  const n = S.recSel.size, shown = [...document.querySelectorAll('#rec-list [data-rk]')].map(e => e.dataset.rk), allOn = shown.length && shown.every(k => S.recSel.has(k)), dis = n ? '' : 'disabled';
  bar.innerHTML = `<div class="in"><div class="top"><b>${n}개 골랐어요</b><span><button onclick="recSelAll(${allOn ? 0 : 1})">${allOn ? '모두 풀기' : '보이는 것 모두'}</button> · <button onclick="S.recSel=null;recDraw()">완료</button></span></div>
    <div class="row2"><button class="btn" ${dis} onclick="recBulk('생각')">→ 생각</button><button class="btn" ${dis} onclick="recBulk('할일')">→ 할 일</button><button class="btn" ${dis} onclick="recBulk('끝냄')">✓ 끝냈어요</button><button class="btn" ${dis} onclick="recBulk('안끝냄')">안 끝냄</button></div>
    <div class="row2"><button class="btn" ${dis} onclick="recBulk('초안')">→ 초안</button><button class="btn" ${dis} onclick="recBulk('완성')">→ 완성</button><button class="btn" ${dis} onclick="recBulk('발행')">→ 발행</button>
      <button class="btn danger" ${dis} onclick="recBulkDel()">삭제</button></div></div>`;
}
function recSelAll(on) { document.querySelectorAll('#rec-list [data-rk]').forEach(e => on ? S.recSel.add(e.dataset.rk) : S.recSel.delete(e.dataset.rk)); recDraw(); }
// 메모 → 초안 · 완성 · 발행이면 글(노트)로 옮겨요. 글 → 생각이면 글의 상태를 '메모'로.
function recBulk(to) {
  let c = 0, skip = 0;
  [...S.recSel].forEach(k => {
    const id = resolveId(k.slice(2));
    if (k[0] === 'm') {
      const m = S.memos.find(x => x.ID === id); if (!m) return;
      if (to === '생각') { if (m['종류'] !== '메모') { patchMemo(m.ID, { '종류': '메모', '완료': false }); c++; } }
      else if (to === '할일') { if (m['종류'] !== '할일') { patchMemo(m.ID, { '종류': '할일' }); c++; } }
      else if (to === '끝냄') { if (!(m['종류'] === '할일' && isDone(m))) { patchMemo(m.ID, { '종류': '할일', '완료': true }); c++; } }
      else if (to === '안끝냄') { if (isDone(m)) { patchMemo(m.ID, { '완료': false }); c++; } }
      else {   // 메모 → 글
        const t = String(m['내용'] || ''), first = t.split('\n')[0].slice(0, 40);
        const n = { ID: 'T' + uid(), '제목': first, '본문': t, '상태': to, '묶음': '', '키워드': '', '작성일': m['작성일'] || S.today, '수정일': S.today, '수정시각': Date.now() };
        S.notes.push(n); queueNote(n, false);
        S.memos = S.memos.filter(x => x.ID !== m.ID); queue({ fn: 'deleteMemo', id: m.ID }); c++;
      }
    } else {
      const n = noteOf(id); if (!n) return;
      const st = to === '생각' ? '메모' : ['초안', '완성', '발행'].includes(to) ? to : null;
      if (!st) { skip++; return; }
      if (n['상태'] !== st) { n['상태'] = st; n['수정일'] = S.today; n['수정시각'] = Date.now(); queueNote(n, false); c++; }
    }
  });
  S.recSel = new Set(); recDraw();
  toast(c ? `${c}개를 바꿨어요${skip ? ` · 글 ${skip}편은 할 일로 바꿀 수 없어 그대로 뒀어요` : ''}` : skip ? '글은 할 일로 바꿀 수 없어요' : '바뀐 게 없어요');
}
function recBulkDel() {
  const ks = [...S.recSel]; if (!ks.length || !confirm(`${ks.length}개를 지울까요? 되돌릴 수 없어요.`)) return;
  ks.forEach(k => { const id = resolveId(k.slice(2));
    if (k[0] === 'n') { S.notes = S.notes.filter(x => x.ID !== id); queue({ fn: 'deleteNote', id }); }
    else { S.memos = S.memos.filter(x => x.ID !== id); queue({ fn: 'deleteMemo', id }); } });
  S.recSel = new Set(); recDraw(); toast(`${ks.length}개를 지웠어요`);
}

// 예전 화면 이름으로 부르던 곳들도 이 화면으로
renderNoteList = function () { renderRecords(); };
drawNoteCards = function () { recDraw(); };
renderMemoView = function () { if (S.view === 'notes') renderRecords(); };
