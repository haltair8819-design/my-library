/* 나의 서재 — 메모 · 할 일 · + 버튼
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   메모 · 할 일 (v2.3)
   =================================================================== */
S.memoFilter = '전체';
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function ymd(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
function dateOf(str) { return new Date(String(str).slice(0, 10) + 'T00:00:00'); }

// "내일 3시 치과", "- 책 반납하기", "다음주 수요일까지 보고서" → { type, due, time, text }
function parseQuick(raw, forceType) {
  let t = String(raw || '').trim(), type = forceType || '', due = '', time = '';
  const today = dateOf(S.today || localToday());
  const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d); };
  const mark = t.match(/^\s*(?:[-*•]|\[\s?\]|☐|□|할\s?일\s*[:：])\s*/);
  if (mark) { type = type || '할일'; t = t.slice(mark[0].length); }
  const cut = re => { const m = t.match(re); if (m) t = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).trim(); return m; };
  let m;
  if ((m = cut(/(오늘|내일|모레|글피)(?:\s*까지)?/))) due = add({ 오늘: 0, 내일: 1, 모레: 2, 글피: 3 }[m[1]]);
  else if ((m = cut(/(이번\s?주|다음\s?주|담주)?\s*([월화수목금토일])요일(?:\s*까지)?/))) {
    const want = WD.indexOf(m[2]), cur = today.getDay();
    const mon = (cur + 6) % 7;   // 월요일 기준 오늘이 몇 번째 날
    const wantMon = (want + 6) % 7;
    let diff;
    if (!m[1]) diff = (want - cur + 7) % 7;
    else if (/이번/.test(m[1])) diff = wantMon - mon;
    else diff = 7 - mon + wantMon;
    due = add(diff);
  } else if ((m = cut(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s*까지)?/))) due = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  else if ((m = cut(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*까지)?/)) || (m = cut(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s*까지)?(?=\s|$)/))) {
    let y = today.getFullYear(); const mm = Number(m[1]), dd = Number(m[2]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let d = new Date(y, mm - 1, dd); if (d < today - 86400000 * 30) d = new Date(y + 1, mm - 1, dd);
      due = ymd(d);
    }
  } else if ((m = cut(/(\d{1,2})\s*일\s*(?:뒤|후)/))) due = add(Number(m[1]));
  else if ((m = cut(/(이번\s?주말|주말)/))) due = add((6 - today.getDay() + 7) % 7);
  else if ((m = cut(/다음\s?주(?:\s*까지)?/))) due = add(7 - ((today.getDay() + 6) % 7));
  if ((m = cut(/(오전|오후|아침|저녁|밤|낮)?\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*(반))?/)) || (m = cut(/(?:^|\s)()(\d{1,2}):(\d{2})(?=\s|$)/))) {
    let h = Number(m[2]), mi = Number(m[3] || (m[4] ? 30 : 0));
    if (/오후|저녁|밤/.test(m[1] || '') && h < 12) h += 12;
    if (!m[1] && h >= 1 && h <= 7) h += 12;   // "3시"는 보통 오후
    if (h <= 24 && mi < 60) { time = String(h % 24).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); if (!due) due = add(0); }
  }
  t = t.replace(/\s{2,}/g, ' ').replace(/^\s*(?:에|까지|,)\s*/, '').trim();
  const verbTodo = /(하기|할\s?것|해야\s?(?:함|해|돼)|사기|보내기|챙기기|예약|신청|반납|제출|연락|전화)[.!]?\s*$/.test(t);
  const sentence = /(다|요|네|죠|음|어|야|지)[.!?~]*\s*$/.test(t);   // "오늘 읽은 책이 좋았다" 같은 문장은 메모
  if (!type) type = (verbTodo || ((due || time) && !sentence)) ? '할일' : '메모';
  if (type === '메모') {   // 메모는 쓴 그대로 (날짜 말도 지우지 않음)
    return { type, due: '', time: '', text: String(raw || '').trim().replace(mark ? mark[0] : '', '').trim() || String(raw || '').trim() };
  }
  return { type, due, time, text: t || String(raw || '').trim() };
}
function dueLabel(due, time) {
  if (!due) return '';
  const d = dayDiff(due), wd = WD[dateOf(due).getDay()];
  const md = `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}(${wd})`;
  const word = d === 0 ? '오늘' : d === 1 ? '내일' : d === 2 ? '모레' : d < 0 ? `${-d}일 지남` : md;
  return word + (d >= 0 && d <= 2 ? ' ' + md : '') + (time ? ' ' + time : '');
}

/* ----- 화면 ----- */
function renderMemoView() {
  const all = S.memos.slice();
  const todos = all.filter(m => m['종류'] === '할일' && !isDone(m));
  const done = all.filter(m => m['종류'] === '할일' && isDone(m)).sort((a, b) => String(b['완료일']).localeCompare(String(a['완료일'])));
  const memos = all.filter(m => m['종류'] !== '할일').sort((a, b) => String(b['작성일'] || '').localeCompare(String(a['작성일'] || '')) || String(b.ID).localeCompare(String(a.ID)));
  const f = S.memoFilter;
  const groups = [['지난 할 일', d => d < 0], ['오늘', d => d === 0], ['내일', d => d === 1], ['이번 주', d => d > 1 && d <= 7], ['나중에', d => d > 7]];
  const sorted = todos.slice().sort((a, b) => String(a['마감일'] || '9999').localeCompare(String(b['마감일'] || '9999')) || String(a['마감시간'] || '99').localeCompare(String(b['마감시간'] || '99')));
  let todoHtml = '';
  groups.forEach(([name, test]) => {
    const list = sorted.filter(m => m['마감일'] && test(dayDiff(m['마감일'])));
    if (list.length) todoHtml += `<div class="group-label ${name === '지난 할 일' ? 'late' : ''}">${name} <span>${list.length}</span></div>${list.map(todoRow).join('')}`;
  });
  const nodue = sorted.filter(m => !m['마감일']);
  if (nodue.length) todoHtml += `<div class="group-label">날짜 없음 <span>${nodue.length}</span></div>${nodue.map(todoRow).join('')}`;
  $('v-memo').innerHTML = `
    <div class="view-head"><h1>메모</h1><p>${todos.length ? `할 일 ${todos.length}개 남았어요` : '할 일을 다 끝냈어요'}${memos.length ? ` · 메모 ${memos.length}개` : ''}</p></div>
    ${quickBox('mq', '')}<div id="voiceq"></div>
    <div class="chips" id="memo-f">${['전체', '할 일', '메모', '끝낸 일'].map(x => `<button class="chip ${f === x ? 'on' : ''}" data-f="${x}">${x}</button>`).join('')}</div>
    ${f === '전체' || f === '할 일' ? (todoHtml ? `<div class="todo-list">${todoHtml}</div>` : (f === '할 일' ? '<div class="empty">할 일이 없어요. 위 칸에 "- 책 반납하기"처럼 적어 보세요.</div>' : '')) : ''}
    ${f === '전체' || f === '메모' ? (memos.length ? `${f === '전체' ? '<div class="group-label">메모</div>' : ''}<div class="memo-grid">${memos.map(memoCard).join('')}</div>` : (f === '메모' ? '<div class="empty">메모가 없어요.</div>' : '')) : ''}
    ${f === '끝낸 일' ? (done.length ? `<div class="todo-list">${done.map(todoRow).join('')}</div>` : '<div class="empty">아직 끝낸 일이 없어요.</div>') : ''}
    ${f === '전체' && !todos.length && !memos.length ? '<div class="empty">떠오른 생각이나 해야 할 일을 위 칸에 적어 보세요.<br>"내일 3시 치과", "- 책 반납하기"처럼 쓰면 할 일로 들어가요.</div>' : ''}`;
  $('memo-f').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; S.memoFilter = c.dataset.f; renderMemoView(); };
  bindQuick('mq');
  // 꾹 누르면 여러 개 고르기 (v2.13.2)
  document.querySelectorAll('#v-memo [data-mid]').forEach(el => bindLongPress(el, () => { if (!S.memoSel) S.memoSel = new Set(); S.memoSel.add(el.dataset.mid); renderMemoView(); }));
  renderMemoSelBar();
}
/* ----- 메모 · 할 일 여러 개 고르기 ----- */
function memoTap(id) {
  if (!S.memoSel) { openMemo(id); return; }
  if (S.memoSel.has(id)) S.memoSel.delete(id); else S.memoSel.add(id);
  const y = window.scrollY; renderMemoView(); window.scrollTo(0, y);
}
function memoShownIds() { return [...document.querySelectorAll('#v-memo [data-mid]')].map(e => e.dataset.mid); }
function renderMemoSelBar() {
  let bar = $('selbar');
  if (!S.memoSel || S.view !== 'notes') { if (bar && S.view === 'notes') bar.remove(); if (S.view === 'notes') $('fab').classList.remove('hidden'); return; }
  $('fab').classList.add('hidden');
  if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; bar.className = 'selbar'; document.body.appendChild(bar); }
  const n = S.memoSel.size, shown = memoShownIds(), allOn = shown.length && shown.every(id => S.memoSel.has(id)), dis = n ? '' : 'disabled';
  bar.innerHTML = `<div class="in"><div class="top"><b>${n}개 골랐어요</b><span><button onclick="memoSelAll(${allOn ? 0 : 1})">${allOn ? '모두 풀기' : '보이는 것 모두'}</button> · <button onclick="S.memoSel=null;renderMemoView()">완료</button></span></div>
    <div class="row2"><button class="btn" ${dis} onclick="memoBulk({'종류':'메모'})">→ 메모</button><button class="btn" ${dis} onclick="memoBulk({'종류':'할일'})">→ 할 일</button>
      <button class="btn" ${dis} onclick="memoBulk({'종류':'할일','완료':true})">✓ 끝냈어요</button><button class="btn" ${dis} onclick="memoBulk({'완료':false})">안 끝냄</button>
      <button class="btn danger" ${dis} onclick="memoBulkDel()">삭제</button></div></div>`;
}
function memoSelAll(on) { memoShownIds().forEach(id => on ? S.memoSel.add(id) : S.memoSel.delete(id)); renderMemoView(); }
function memoBulk(patch) {
  let c = 0;
  [...S.memoSel].forEach(id => { const m = S.memos.find(x => x.ID === resolveId(id)); if (!m) return;
    if (Object.keys(patch).every(k => k === '완료' ? isDone(m) === patch[k] : m[k] === patch[k])) return;
    patchMemo(m.ID, patch); c++; });
  S.memoSel = new Set(); renderMemoView(); toast(c ? `${c}개를 바꿨어요` : '바뀐 게 없어요');
}
function memoBulkDel() {
  const ids = [...S.memoSel].map(resolveId); if (!ids.length || !confirm(`${ids.length}개를 지울까요?`)) return;
  ids.forEach(id => { S.memos = S.memos.filter(x => x.ID !== id); queue({ fn: 'deleteMemo', id }); });
  S.memoSel = new Set(); renderMemoView(); toast(`${ids.length}개를 지웠어요`);
}
const isDone = m => m['완료'] === true || m['완료'] === 'TRUE' || m['완료'] === 'true';
function todoRow(m) {
  const d = m['마감일'] ? dayDiff(m['마감일']) : null, fin = isDone(m);
  const b = m['책ID'] ? book(m['책ID']) : null;
  const sel = S.memoSel && S.memoSel.has(m.ID);
  return `<div class="todo ${fin ? 'fin' : ''} ${sel ? 'msel' : ''}" data-id="${m.ID}" data-mid="${m.ID}">
    ${S.memoSel ? `<span class="m-check">${sel ? '✓' : ''}</span>` : `<button class="tick" onclick="toggleTodo('${m.ID}')" aria-label="${fin ? '안 끝낸 일로' : '끝냈어요'}">${fin ? '✓' : ''}</button>`}
    <div class="tbody" onclick="memoTap('${m.ID}')"><div class="tt">${esc(m['내용'])}</div>
      ${(m['마감일'] && !fin) || b || fin ? `<div class="tm">${fin ? (m['완료일'] ? String(m['완료일']).slice(5).replace('-', '/') + ' 끝냄' : '끝냄') : `<span class="${d < 0 ? 'late' : d === 0 ? 'due-now' : ''}">${dueLabel(m['마감일'], m['마감시간'])}</span>`}${b ? ` · 📖 ${esc(b['제목'])}` : ''}</div>` : ''}</div>
  </div>`;
}
function memoCard(m) {
  const b = m['책ID'] ? book(m['책ID']) : null;
  const sel = S.memoSel && S.memoSel.has(m.ID);
  return `<div class="memo ${sel ? 'msel' : ''}" data-mid="${m.ID}" onclick="memoTap('${m.ID}')">${S.memoSel ? `<span class="m-check">${sel ? '✓' : ''}</span>` : ''}<div class="mx">${esc(m['내용'])}</div>
    <div class="mm">${m['작성일'] ? String(m['작성일']).slice(5).replace('-', '/') : '방금'}${b ? ' · 📖 ' + esc(b['제목']) : ''}</div></div>`;
}

/* ----- 빠른 입력 칸 (메모 화면 · + 버튼 공통) ----- */
function quickBox(id, force) {
  return `<div class="quick" id="${id}-box" data-force="${force}">
    <textarea id="${id}" rows="1" placeholder="${force === '할일' ? '해야 할 일 (예: 금요일까지 책 반납)' : '메모나 할 일 (예: 내일 3시 치과, - 책 반납하기)'}"></textarea>
    <div class="qbar"><button class="qtype" id="${id}-type" type="button"></button><span id="${id}-due" class="qdue"></span>${voiceBtns(id, 'memo')}
      <button class="btn primary" id="${id}-go" type="button">저장</button></div></div>`;
}
function bindQuick(id, after) {
  const ta = $(id), box = $(id + '-box'); if (!ta) return;
  let manual = box.dataset.force || '';
  const update = () => {
    ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight) + 'px';
    const p = parseQuick(ta.value, manual);
    $(id + '-type').textContent = p.type === '할일' ? '☑ 할 일' : '✎ 메모';
    $(id + '-type').classList.toggle('todo-on', p.type === '할일');
    $(id + '-due').textContent = p.type === '할일' && p.due ? dueLabel(p.due, p.time) : '';
    $(id + '-go').disabled = !ta.value.trim();
  };
  $(id + '-type').onclick = () => { const p = parseQuick(ta.value, manual); manual = p.type === '할일' ? '메모' : '할일'; update(); ta.focus(); };
  ta.oninput = update;
  ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } };
  const go = () => {
    if (!ta.value.trim()) return;
    const p = parseQuick(ta.value, manual);
    addMemo({ '종류': p.type, '내용': p.text, '마감일': p.type === '할일' ? p.due : '', '마감시간': p.type === '할일' ? p.time : '' });
    ta.value = ''; manual = box.dataset.force || ''; update();
    toast(p.type === '할일' ? '할 일에 넣었어요' : '메모했어요');
    if (after) after(); else renderMemoView();
    setTimeout(() => { const t = $(id); if (t) t.focus(); }, 30);
  };
  $(id + '-go').onclick = go;
  update();
}

/* ----- 저장 · 고치기 ----- */
function addMemo(fields) {
  const data = Object.assign({ ID: 'T' + uid(), '종류': '메모', '내용': '', '완료': false, '마감일': '', '마감시간': '', '책ID': '' }, fields);
  const local = Object.assign({ '작성일': S.today }, data);
  upsertLocal('memos', local); queue({ fn: 'saveMemo', data, local });
  return local;
}
function patchMemo(id, patch) {
  id = resolveId(id);
  const cur = S.memos.find(x => x.ID === id); if (!cur) return;
  const local = Object.assign({}, cur, patch);
  if ('완료' in patch) local['완료일'] = patch['완료'] ? S.today : '';
  upsertLocal('memos', local);
  const data = {}; ['ID', '종류', '내용', '완료', '마감일', '마감시간', '책ID'].forEach(k => data[k] = local[k] ?? '');
  queue({ fn: 'saveMemo', data, local });
}
function toggleTodo(id) {
  id = resolveId(id);
  const m = S.memos.find(x => x.ID === id); if (!m) return;
  const now = !isDone(m);
  const row = document.querySelector(`.todo[data-id="${id}"]`); if (row) row.classList.toggle('fin', now);
  patchMemo(id, { '완료': now });
  setTimeout(() => { if (S.view === 'notes' && !$('modal').innerHTML) renderMemoView(); }, now ? 450 : 0);
  if (now) toast('끝냈어요 ✓');
}
function removeMemo(id) {
  if (!confirm('지울까요?')) return;
  id = resolveId(id);
  S.memos = S.memos.filter(x => x.ID !== id); queue({ fn: 'deleteMemo', id });
  closeModal(); if (S.view === 'notes') renderMemoView(); toast('지웠어요');
}
let memoType = '메모';
function openMemo(id) {
  id = resolveId(id);
  const m = S.memos.find(x => x.ID === id); if (!m) return;
  memoType = m['종류'] === '할일' ? '할일' : '메모';
  const opts = S.books.slice().sort((a, b) => (a['상태'] === '읽는중' ? 0 : 1) - (b['상태'] === '읽는중' ? 0 : 1) || String(a['제목']).localeCompare(String(b['제목'])));
  modal(`<h3>${memoType === '할일' ? '할 일' : '메모'} 고치기</h3>
    <div class="seg" id="mseg">${['메모', '할일'].map(t => `<button data-t="${t}" class="${memoType === t ? 'on' : ''}">${t === '할일' ? '할 일' : '메모'}</button>`).join('')}</div>
    <label>내용</label><textarea class="field" id="m-txt" style="min-height:120px">${esc(m['내용'])}</textarea>
    <div id="m-due" class="${memoType === '할일' ? '' : 'hidden'}"><div class="row">
      <div><label>마감일</label><input class="field" type="date" id="m-date" value="${esc(String(m['마감일'] || '').slice(0, 10))}"></div>
      <div><label>시간</label><input class="field" type="time" id="m-time" value="${esc(m['마감시간'] || '')}"></div></div></div>
    <label>책과 잇기 <span style="font-weight:400;color:var(--faint)">고르지 않아도 돼요</span></label>
    <select class="field" id="m-book"><option value="">없음</option>${opts.map(b => `<option value="${b.ID}" ${m['책ID'] === b.ID ? 'selected' : ''}>${esc(b['제목'])}</option>`).join('')}</select>
    <div class="actions">
      <button class="btn danger" onclick="removeMemo('${m.ID}')">삭제</button>
      <button class="btn" onclick="memoToSnip('${m.ID}')">필사로 옮기기</button>
      <button class="btn primary grow" onclick="saveMemoForm('${m.ID}')">저장</button></div>`);
  $('mseg').onclick = e => { const t = e.target.closest('button'); if (!t) return; memoType = t.dataset.t;
    [...$('mseg').children].forEach(x => x.classList.toggle('on', x === t)); $('m-due').classList.toggle('hidden', memoType !== '할일'); };
}
function saveMemoForm(id) {
  const txt = $('m-txt').value.trim(); if (!txt) { toast('내용을 입력해 주세요'); return; }
  patchMemo(id, { '종류': memoType, '내용': txt, '마감일': memoType === '할일' ? $('m-date').value : '', '마감시간': memoType === '할일' ? $('m-time').value : '', '책ID': $('m-book').value });
  closeModal(); if (S.view === 'notes') renderMemoView(); toast('저장했어요');
}
function memoToSnip(id) {
  id = resolveId(id);
  const m = S.memos.find(x => x.ID === id); if (!m) return;
  const text = $('m-txt') ? $('m-txt').value.trim() : m['내용'];
  const bid = ($('m-book') && $('m-book').value) || m['책ID'];
  const start = b => { S.moveMemoId = id; go('book', b); openSnipForm(null); $('f-txt').value = text; snipType = '생각';
    [...$('seg').children].forEach(x => x.classList.toggle('on', x.dataset.t === '생각'));
    const btn = document.querySelector('[data-ai-title]'); if (btn && navigator.onLine) aiTitle(btn, true); };
  closeModal();
  if (bid && book(bid)) start(bid); else openBookPicker('어느 책의 필사로 옮길까요?', start, text.slice(0, 140));
}

/* ----- 책 고르기 (공유 · 빠른 입력 · 메모 옮기기 공통) ----- */
function pickBooks(q) {
  const order = { '읽는중': 0, '완독': 1, '읽을예정': 2 };
  const nq = String(q || '').toLowerCase().replace(/\s+/g, '');
  return S.books.filter(b => !nq || (String(b['제목']) + String(b['저자'])).toLowerCase().replace(/\s+/g, '').includes(nq))
    .sort((a, b) => (order[a['상태']] ?? 3) - (order[b['상태']] ?? 3) || String(b['시작일'] || b['등록일'] || '').localeCompare(String(a['시작일'] || a['등록일'] || '')))
    .slice(0, 30);
}
function openBookPicker(title, cb, peek, q) {
  S.pickCb = cb;
  const draw = v => {
    const el = $('bp-list'); if (!el) return;
    el.innerHTML = pickBooks(v).map(b => `<button class="al-item" data-b="${b.ID}">${spine(b)}<div><b>${esc(b['제목'])}</b><span>${esc(b['저자'] || '')}${b['상태'] === '읽는중' ? ' · 읽는 중' : ''}</span></div></button>`).join('') || '<div class="al-msg">찾는 책이 없어요.</div>';
    el.querySelectorAll('[data-b]').forEach(x => x.onclick = () => { const f = S.pickCb; S.pickCb = null; closeModal(); if (f) f(x.dataset.b); });
  };
  modal(`<h3>${esc(title)}</h3>
    ${peek ? `<div class="share-peek">${esc(peek)}${peek.length >= 140 ? '…' : ''}</div>` : ''}
    <input class="field" id="bp-q" type="search" placeholder="책 제목 · 저자 찾기" value="${esc(q || '')}" autocomplete="off">
    <div class="share-list" id="bp-list"></div>
    <div class="actions"><button class="btn" onclick="S.pickCb=null;S.shared=null;closeModal()">취소</button></div>`);
  draw(q); liveInput('bp-q', draw);
}

/* ----- + 버튼: 어디서든 빠르게 ----- */
function openQuickMenu() {
  modal(`<h3>무엇을 남길까요?</h3>
    <div class="qmenu">
      <button onclick="openQuickRead()"><b>📖 여기까지 읽었어요</b><span>읽는 중인 책에 쪽수 기록</span></button>
      <button onclick="openQuickSheet('')"><b>✎ 메모</b><span>떠오른 생각을 바로</span></button>
      <button onclick="closeModal();startRecording('memo')"><b>🎙 음성 메모</b><span>말하면 메모 · 할 일로 정리</span></button>
      <button onclick="closeModal();newNote()"><b>✍ 새 글</b><span>나만의 노트에 쓰기</span></button>
      <button onclick="openQuickSheet('할일')"><b>☑ 할 일</b><span>"금요일까지 반납"처럼 날짜도</span></button>
      <button onclick="quickSnip(false)"><b>❝ 필사 쓰기</b><span>책을 고르고 문장 적기</span></button>
      <button onclick="closeModal();openBookForm(null)"><b>📚 책 추가</b><span>새 책 등록</span></button>
    </div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
// 메모 탭의 ＋: 보고 있는 칸이 할 일이면 바로 할 일, 메모면 바로 메모
function openMemoAdd() {
  if (S.memoFilter === '할 일') { openQuickSheet('할일'); return; }
  if (S.memoFilter === '메모') { openQuickSheet(''); return; }
  modal(`<h3>무엇을 남길까요?</h3>
    <div class="qmenu">
      <button onclick="openQuickSheet('')"><b>✎ 메모</b><span>떠오른 생각을 바로</span></button>
      <button onclick="openQuickSheet('할일')"><b>☑ 할 일</b><span>"금요일까지 반납"처럼 날짜도</span></button>
      <button onclick="closeModal();startRecording('memo')"><b>🎙 음성 메모</b><span>말하면 메모 · 할 일로 정리</span></button>
    </div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
function openQuickSheet(force) {
  modal(`<h3>${force === '할일' ? '할 일' : '빠른 메모'}</h3>${quickBox('qq', force)}
    <div class="small" style="margin-top:8px;color:var(--faint)">"내일", "금요일", "10월 20일", "3시" 같은 말은 날짜로 알아들어요.</div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  bindQuick('qq', () => { closeModal(); if (S.view === 'notes') renderMemoView(); });
  setTimeout(() => { const t = $('qq'); if (t) t.focus(); }, 60);
}
// 여기까지 읽었어요: 읽는 중인 책들에 바로 쪽수 넣기 (앱 아이콘 길게 눌러도 열려요)
function openQuickRead() {
  const list = S.books.filter(b => b['상태'] === '읽는중').sort((a, b) => String((logsOf(b.ID).slice(-1)[0] || {}).date || b['시작일'] || '').localeCompare(String((logsOf(a.ID).slice(-1)[0] || {}).date || a['시작일'] || '')));
  if (!list.length) { toast('읽는 중인 책이 없어요'); return; }
  modal(`<h3>어디까지 읽었어요?</h3>
    ${list.map(b => { const p = progressOf(b), today = dailyOf(b.ID)[S.today] || 0, eb = platOf(b) === 'E북'; return `<div class="panel2" style="margin-top:10px">
      <div style="display:flex;gap:10px;align-items:center">${spine(b)}<div style="min-width:0;flex:1"><b style="display:block;font-size:14px">${esc(b['제목'])}</b>
        <span class="small">${p ? `p.${p.cur} / ${p.total} · ${p.pct}%` : b['현재쪽수'] ? `p.${esc(b['현재쪽수'])}` : '아직 기록 없음'}${today ? ` · 오늘 +${today}쪽` : ''}</span></div></div>
      <div class="inline" style="margin-top:8px"><input class="field" id="qr-${b.ID}" inputmode="decimal" placeholder="${eb ? '몇 쪽? 또는 45%' : '몇 쪽까지?'}" onkeydown="if(event.key==='Enter'){event.preventDefault();quickReadSave('${b.ID}')}">${pctBtn('qr-' + b.ID)}
        <button class="btn primary" onclick="quickReadSave('${b.ID}')">기록</button></div></div>`; }).join('')}
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  setTimeout(() => { const el = $('qr-' + list[0].ID); if (el) el.focus(); }, 80);
}
function quickReadSave(id) {
  const el = $('qr-' + id); if (!el) return;
  const v = el.value.trim(); if (!v) { toast('몇 쪽까지 읽었는지 넣어 주세요'); return; }
  closeModal(); readHere(id, v);
}
function quickSnip(photo) {
  openBookPicker(photo ? '어느 책을 찍을까요?' : '어느 책의 필사인가요?', id => { go('book', id); if (photo) openScan(); else openSnipForm(null); });
}
// 앱 아이콘 길게 누르기 → 빠른 메모 · 할 일 · 필사
function takeQuick() {
  const sp = new URLSearchParams(location.search);
  if ((sp.get('snip') || sp.get('view')) && typeof openAppUrl === 'function') { openAppUrl(location.href); return; }
  const q = sp.get('quick'); if (!q) return;
  history.replaceState(Object.assign({}, history.state, { view: S.view, id: S.bookId || '' }), '', location.pathname);
  if (q === 'read') openQuickRead(); else if (q === 'memo') openQuickSheet(''); else if (q === 'todo') openQuickSheet('할일'); else if (q === 'snip') quickSnip(false); else if (q === 'note') newNote(); else if (q === 'voice') startRecording('memo');
}

