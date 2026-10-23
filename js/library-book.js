/* 나의 서재 — 서재 · 책 상세 · 필사 입력 · 화면 전환
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===== 서재 화면 ===== */
function renderStats() {
  const y = S.today.slice(0, 4);
  const done = S.books.filter(b => b['상태'] === '완독' && String(b['완독일']).startsWith(y)).length;
  const reading = S.books.filter(b => b['상태'] === '읽는중').length;
  $('stats').innerHTML =
    `<div class="stat"><b>${done}</b><span>${y}년 완독</span></div>` +
    `<div class="stat"><b>${reading}</b><span>읽는 중</span></div>` +
    (() => { const nT = S.snips.filter(isThought).length; return `<div class="stat tap" onclick="openAllSnips('필사')"><b>${(S.snips.length - nT).toLocaleString()}</b><span>필사 ›</span></div>` +
      `<div class="stat tap" onclick="openAllSnips('생각')"><b>${nT.toLocaleString()}</b><span>생각 · 메모 ›</span></div>` +
      `<div class="stat tap" onclick="openLife()"><b>${S.snips.filter(s => lifeOf(s) > 0).length.toLocaleString()}</b><span>인생 문장 ›</span></div>`; })();
  $('goal').innerHTML = goalHtml();
}
function renderFilters() {
  $('filters').innerHTML = FILTERS.map(f => `<button class="chip ${S.filter === f ? 'on' : ''}" data-f="${f}">${FILTER_LABEL[f] || f}</button>`).join('')
    + '<span class="chip-sep"></span>' + PLATS.filter(p => p !== '오디오북' || S.books.some(b => platOf(b) === p)).map(p => `<button class="chip sub ${S.plat === p ? 'on' : ''}" data-p="${p}">${p}</button>`).join('');
}
function bookCard(b) {
  const mine = snipsOf(b.ID), nM = mine.filter(x => x['유형'] === '메모').length, nT = mine.filter(isThought).length - nM, nQ = mine.length - nT - nM;
  const cat = [b['대분류'], b['개인분류']].filter(Boolean).join(' · ');
  return `<div class="book" data-id="${b.ID}">
    ${spine(b)}
    <div class="binfo">
      <div class="btitle">${esc(b['제목'])}</div>
      <div class="bauthor">${esc(b['저자'])}</div>
      <div class="bmeta">
        ${b['상태'] === '읽는중' ? '<span class="badge reading">읽는 중</span>' : ''}
        ${b['상태'] === '읽을예정' ? '<span class="badge">읽고 싶은</span>' : ''}
        ${platOf(b) !== '종이책' ? `<span class="badge plat eb">${platOf(b)}</span>` : '<span class="badge plat">종이책</span>'}
        ${dueBadge(b)}
        ${b['별점'] ? `<span class="stars">${'★'.repeat(Number(b['별점']) || 0)}</span>` : ''}
        ${nQ ? `<span class="badge tapb" data-tab="필사">필사 ${nQ}</span>` : ''}
        ${nT ? `<span class="badge tapb think" data-tab="생각">내 생각 ${nT}</span>` : ''}
        ${nM ? `<span class="badge tapb plat" data-tab="생각">메모 ${nM}</span>` : ''}
        ${cat ? `<span>${esc(cat)}</span>` : ''}
        ${period(b) ? `<span>${period(b)}</span>` : ''}
      </div>
      ${(() => { const p = b['상태'] === '읽는중' ? progressOf(b) : null; return p ? `<div class="mini-bar" title="${p.pct}%"><i style="width:${p.pct}%"></i></div>` : ''; })()}
    </div></div>`;
}
function renderList() {
  const q = S.q.trim().toLowerCase();
  $('top').innerHTML = q ? '' : libraryTopHtml();
  let rows = S.books.filter(b => q || S.filter === '전체' || b['상태'] === S.filter);   // 검색할 때는 모든 책에서
  if (S.plat && !q) rows = rows.filter(b => platOf(b) === S.plat);
  if (q) rows = q.startsWith('#') ? [] : rows.filter(b => ['제목','저자','옮긴이','출판사','대분류','중분류','개인분류','한줄평'].some(k => String(b[k] || '').toLowerCase().includes(q)));
  rows.sort((a, b) => String(b['완독일'] || b['시작일']).localeCompare(String(a['완독일'] || a['시작일'])));
  if (q) {
    $('list').innerHTML = (rows.length ? `<div class="res-head">책 ${rows.length}권</div>` + rows.slice(0, 20).map(bookCard).join('') : '') + hitsHtml(S.q) + otherHitsHtml(S.q)
      || '<div class="empty">검색 결과가 없어요</div>';
    return;
  }
  if (!rows.length && S.plat) { $('list').innerHTML = `<div class="empty">${esc(S.plat)}으로 ${FILTER_LABEL[S.filter] || S.filter} 책이 없어요</div>`; return; }
  if (!rows.length) { $('list').innerHTML = `<div class="empty">${S.filter === '읽을예정' ? '읽고 싶은 책을 + 책 추가에서 상태 ‘읽을예정’으로 담아 보세요' : '아직 책이 없어요'}</div>`; return; }
  if (S.filter === '완독' && !q) {
    // 월별로 묶어 보기
    let html = '', cur = '';
    rows.forEach(b => {
      const m = String(b['완독일']).slice(0, 7);
      if (m !== cur) { cur = m; html += `<div class="group-label">${m ? m.replace('-', '년 ') + '월' : '날짜 없음'}</div>`; }
      html += bookCard(b);
    });
    $('list').innerHTML = html;
  } else {
    $('list').innerHTML = rows.map(bookCard).join('');
  }
}
function renderLibrary() { renderStats(); renderFilters(); renderList(); }

/* ===== 책 상세 화면 ===== */
function renderBook() {
  const b = book(S.bookId);
  if (!b) { go('library'); return; }
  // 노트 파일에서 가져온 문장 → 노트에 적힌 순서, 직접 입력한 문장 → 그 뒤에 쪽수 순서
  const snips = orderedSnips(b.ID);
  const reo = !!S.snipSel;
  const tags = [b['대분류'], b['중분류'], b['개인분류'], b['경로']].filter(Boolean);
  const plat = platOf(b);
  const quotes = snips.filter(s => !isThought(s)), thoughts = snips.filter(isThought);
  S.snipShown = (S.bookTab === '생각' ? thoughts : quotes).map(x => x.ID);
  const selBtn = list => reo ? `<button class="btn primary" onclick="toggleSnipSel()">완료</button>` : '';
  const reoNote = reo ? `<div class="draft-note"><span>눌러서 고르기 · ≡ 끌어서 순서 바꾸기</span><button type="button" style="white-space:nowrap" onclick="resetOrder('${b.ID}')">쪽수 순으로 정렬</button></div>`
    : (quotes.length + thoughts.length > 1 && !LS.get('lp_hint') ? `<div class="sec-sub">💡 문장을 꾹 누르면 여러 개 고르기 · 순서 바꾸기</div>` : '');
  const tab = S.bookTab === '생각' ? '생각' : '필사';
  $('v-book').style.setProperty('--bc', spineColor(b));
  $('v-book').innerHTML = `
    <div class="topbar">
      <button class="iconbtn" onclick="bookBack()">← 서재</button>
      <button class="iconbtn" onclick="openBookForm('${b.ID}')">정보 수정</button>
    </div>
    <div class="detail-head">
      ${spine(b)}
      <div>
        <div class="dtitle">${esc(b['제목'])}</div>
        <div class="dauthor">${esc(b['저자'])}${b['옮긴이'] ? ' 지음 · ' + esc(b['옮긴이']) + ' 옮김' : ''}${b['출판사'] ? ' · ' + esc(b['출판사']) : ''}</div>
        <div class="tags"><span class="tag tap" onclick="togglePlat('${b.ID}')" title="눌러서 종이책 · E북 바꾸기">${plat === 'E북' ? '📱 E북' : plat === '오디오북' ? '🎧 오디오북' : '📕 종이책'}</span>${tgShareTag(b)}${snipShareTag(b)}${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>
    <div class="grid">
      <div><b>${b['분량'] ? esc(b['분량']) + '쪽' : '–'}</b><span>분량</span></div>
      <div><b>${esc(b['시작일'] || '–')}</b><span>시작</span></div>
      <div><b>${esc(b['완독일'] || '–')}</b><span>완독</span></div>
      <div><b>${b['완독일수'] ? esc(b['완독일수']) + '일' : (b['상태'] === '읽는중' ? '읽는 중' : '–')}</b><span>기간</span></div>
    </div>
    ${b['상태'] === '읽는중' || b['상태'] === '중단' ? `<div class="actions"><button class="btn primary grow" onclick="finish('${b.ID}')">오늘 완독했어요</button></div>` : ''}
    ${tgBookHtml(b)}
    ${bookExtrasHtml(b)}
    <div class="seg book-tabs" id="book-tabs">
      <button data-t="필사" class="${tab === '필사' ? 'on' : ''}">필사<span>${quotes.length}</span></button>
      <button data-t="생각" class="${tab === '생각' ? 'on' : ''}">내 생각 · 메모<span>${thoughts.length}</span></button></div>
    ${tab === '필사' ? `
    <div class="sec-head tight"><h2>필사</h2>
      <div style="display:flex;gap:6px">${selBtn(quotes)}${S.snipSel || reo ? '' : `<button class="btn" onclick="openScan()">📷 사진</button><button class="btn" onclick="openSnipForm(null,'인용')">+ 문장</button>`}</div></div>
    ${reoNote}
    ${quotes.length ? `<div id="snip-list">${quotes.map(snipHtml).join('')}</div>`
    : '<div class="empty">아직 필사한 문장이 없어요.<br>‘+ 문장 추가’로 시작해 보세요.</div>'}` : `
    <div class="sec-head tight"><h2>내 생각 · 메모</h2>
      <div style="display:flex;gap:6px">${selBtn(thoughts)}${S.snipSel || reo ? '' : `<button class="btn" onclick="openSnipForm(null,'생각')">+ 내 생각</button><button class="btn" onclick="openSnipForm(null,'메모')">+ 메모</button>`}</div></div>
    ${reoNote}
    <div class="sec-sub">읽으며 든 생각, 감상문 · 독후감, 따로 적어 둔 메모를 모아 둬요.</div>
    ${b['별점'] || b['한줄평'] ? `<div class="snip thought" onclick="openRating('${b.ID}')"><div class="stitle">한줄평 ${b['별점'] ? `<span class="stars">${starText(b['별점'])}</span>` : ''}</div><div class="txt">${esc(b['한줄평'] || '')}</div></div>` : ''}
    ${thoughts.length ? `<div id="snip-list">${thoughts.map(snipHtml).join('')}</div>`
    : '<div class="empty">아직 남긴 생각이나 메모가 없어요.<br>‘+ 내 생각’, ‘+ 메모’로 남겨 보세요.</div>'}`}
  `;
  $('book-tabs').onclick = e => { const t = e.target.closest('[data-t]'); if (!t) return; S.bookTab = t.dataset.t; if (S.snipSel) S.snipSel = new Set(); renderBook(); };
  renderSnipSelBar();
  if (reo) { $('fab').classList.add('hidden'); document.querySelectorAll('#snip-list .drag-h').forEach(h => h.addEventListener('pointerdown', startSnipDrag)); }
  document.querySelectorAll('#snip-list .snip').forEach(el => bindLongPress(el, () => enterSnipMode(el.id.replace(/^s-/, ''))));
}
/* ----- 끌어서 순서 바꾸기: 책마다 순서를 메모 시트에 '필사순서' 한 줄로 저장 ----- */
const ORDER_KEY = 'snip_order_v1';
function localOrders() { try { return JSON.parse(LS.get(ORDER_KEY) || '{}') || {}; } catch (e) { return {}; } }
function snipOrderRow(bid) { return (S.logs || []).filter(m => isOrderRow(m) && m['책ID'] === bid).sort((a, b) => parseOrder(b).at - parseOrder(a).at)[0]; }
function parseOrder(m) {
  const t = String((m && m['내용']) || ''); const r = /^순서(?:@(\d+))?:(.*)$/s.exec(t);
  return r ? { at: Number(r[1] || 0), ids: r[2].split(',').map(x => x.trim()).filter(Boolean) } : { at: 0, ids: [] };
}
function snipOrderOf(bid) {
  const row = snipOrderRow(bid), sv = row ? parseOrder(row) : null, lo = localOrders()[bid];
  const pick = lo && (!sv || (lo.at || 0) >= sv.at) ? lo : sv;
  const ids = pick && pick.ids ? pick.ids.map(resolveId).filter(Boolean) : [];
  return ids.length ? ids : null;
}
function orderedSnips(bid) {
  const byPage = sortByPage(snipsOf(bid)), ids = snipOrderOf(bid);
  if (!ids) return byPage;
  const pos = new Map(ids.map((id, i) => [id, i]));
  const out = ids.map(id => byPage.find(s => s.ID === id)).filter(Boolean);
  // 순서를 정한 뒤에 새로 넣은 문장: 쪽수가 맞는 자리 (자기보다 쪽수가 작거나 같은 마지막 문장 뒤)
  byPage.filter(s => !pos.has(s.ID)).forEach(s => {
    const p = firstPage(s['쪽수']);
    if (p == null) { out.push(s); return; }
    let at = 0; out.forEach((x, i) => { const q = firstPage(x['쪽수']); if (q != null && q <= p) at = i + 1; });
    out.splice(at, 0, s);
  });
  return out;
}
function saveSnipOrder(bid, tabIds) {
  // 지금 칸의 새 순서를 책 전체 순서에 끼워 넣기 (다른 칸 문장 자리는 그대로)
  const all = orderedSnips(bid).map(s => s.ID), set = new Set(tabIds); let k = 0;
  const full = all.map(id => set.has(id) ? tabIds[k++] : id).map(resolveId);
  writeOrder(bid, full);
}
function writeOrder(bid, full) {
  const at = Date.now();
  const lo = localOrders(); lo[bid] = { at, ids: full }; LS.set(ORDER_KEY, JSON.stringify(lo));   // 이 기기에 먼저 (시트 저장이 늦거나 실패해도 그대로)
  const ex = snipOrderRow(bid);
  // 예전에 여러 줄이 생겼으면 하나만 남기기
  (S.logs || []).filter(m => isOrderRow(m) && m['책ID'] === bid && (!ex || m.ID !== ex.ID)).forEach(m => { S.logs = S.logs.filter(x => x.ID !== m.ID); queue({ fn: 'deleteMemo', list: 'logs', id: m.ID }); });
  const data = { ID: ex ? ex.ID : 'T' + uid(), '종류': '필사순서', '내용': `순서@${at}:` + full.join(','), '완료': false, '마감일': '', '마감시간': '', '책ID': bid };
  const local = Object.assign({ '작성일': S.today }, ex || {}, data);
  upsertLocal('logs', local); queue({ fn: 'saveMemo', list: 'logs', data, local });
}
// 쪽수 순으로 정렬: 지금 칸만 쪽수대로 다시 놓고 그 순서를 저장 (이후에도 끌어서 바꿀 수 있어요)
function resetOrder(bid) {
  const tabIds = sortByPage(snipsOf(bid).filter(s => (S.bookTab === '생각') === isThought(s))).map(s => s.ID);
  saveSnipOrder(bid, tabIds);
  renderBook(); toast('쪽수 순으로 정렬했어요');
}
/* ----- 꾹 누르기 (손가락 · 마우스 모두) ----- */
function bindLongPress(el, fn, ms = 450) {
  let t = null, sx = 0, sy = 0;
  const clear = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('.drag-h')) return;
    sx = e.clientX; sy = e.clientY; clear();
    t = setTimeout(() => { t = null; S.lpFired = Date.now(); el._lp = Date.now(); if (navigator.vibrate) try { navigator.vibrate(25); } catch (err) {} fn(); }, ms);
  });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => el.addEventListener(k, clear));
  el.addEventListener('contextmenu', e => { if (S.lpFired && Date.now() - S.lpFired < 1500) e.preventDefault(); });
  el.addEventListener('click', e => { if (el._lp && Date.now() - el._lp < 800) { el._lp = 0; e.stopPropagation(); e.preventDefault(); } }, true);   // 꾹 누른 뒤 손 뗄 때의 누름은 무시
}
function enterSnipMode(id) {
  LS.set('lp_hint', '1');
  if (!S.snipSel) S.snipSel = new Set();
  S.snipSel.add(resolveId(id));
  renderBook();
}
function startSnipDrag(e) {
  const el = e.currentTarget.closest('.snip'), list = $('snip-list'); if (!el || !list) return;
  e.preventDefault();
  const h = e.currentTarget; try { h.setPointerCapture(e.pointerId); } catch (err) {}
  const grab = e.clientY - el.getBoundingClientRect().top;
  let y = e.clientY, raf = 0, moved = false; const y0 = e.clientY;
  el.classList.add('dragging'); document.body.classList.add('no-select');
  const place = () => {
    const sibs = [...list.children].filter(x => x !== el);
    let before = null;
    for (const s of sibs) { const r = s.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = s; break; } }
    if (before !== el.nextElementSibling && !(before === null && el === list.lastElementChild)) { list.insertBefore(el, before); moved = true; }
    el.style.transform = ''; const nat = el.getBoundingClientRect().top; el.style.transform = `translateY(${y - grab - nat}px)`;
  };
  const loop = () => {   // 화면 끝에 가까우면 저절로 내려가요
    const edge = 90; let d = 0;
    if (y < edge) d = -Math.ceil((edge - y) / 6); else if (y > innerHeight - edge - 60) d = Math.ceil((y - (innerHeight - edge - 60)) / 6);
    if (d && Math.abs(y - y0) > 12) { window.scrollBy(0, d); place(); }
    raf = requestAnimationFrame(loop);
  };
  const move = ev => { y = ev.clientY; place(); };
  const up = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (S.dragEnd === up) S.dragEnd = null;
    el.style.transform = ''; el.classList.remove('dragging'); document.body.classList.remove('no-select');
    if (moved) { saveSnipOrder(S.bookId, [...list.children].map(x => x.id.replace(/^s-/, ''))); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); }
  };
  if (S.dragEnd) S.dragEnd();   // 혹시 끝나지 않은 끌기가 있으면 먼저 마무리
  S.dragEnd = up;
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  raf = requestAnimationFrame(loop);
}
/* ----- 책 안의 문장 여러 개 고르기 → 종류 한 번에 바꾸기 · 지우기 ----- */
const SNIP_TYPES = [['인용', '필사'], ['메모', '메모'], ['생각', '내 생각']];
function snipTap(id) {
  if (!S.snipSel) { openSnipForm(id); return; }
  if (S.snipSel.has(id)) S.snipSel.delete(id); else S.snipSel.add(id);
  const el = document.getElementById('s-' + id); if (el) el.classList.toggle('sel', S.snipSel.has(id));
  renderSnipSelBar();
}
function toggleSnipSel() { S.snipSel = S.snipSel ? null : new Set(); renderBook(); }
function renderSnipSelBar() {
  let bar = $('selbar');
  if (!S.snipSel || S.view !== 'book') { if (bar && !(S.view === 'notes' && S.noteSel)) bar.remove(); if (S.view === 'book') $('fab').classList.remove('hidden'); return; }
  $('fab').classList.add('hidden');
  if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; bar.className = 'selbar'; document.body.appendChild(bar); }
  const n = S.snipSel.size, shown = S.snipShown || [], allOn = shown.length && shown.every(id => S.snipSel.has(id));
  const memos = shown.filter(id => (S.snips.find(x => x.ID === id) || {})['유형'] === '메모');
  bar.innerHTML = `<div class="in"><div class="top"><b>${n}개 골랐어요</b><span>${memos.length ? `<button onclick="selMemoSnips()">메모만 (${memos.length})</button> · ` : ''}<button onclick="selAllSnips(${allOn ? 0 : 1})">${allOn ? '모두 풀기' : '이 칸 모두'}</button> · <button onclick="toggleSnipSel()">완료</button></span></div>
    <div class="row2">${SNIP_TYPES.map(([t, label]) => `<button class="btn" ${n ? '' : 'disabled'} onclick="bulkSnipType('${t}')">→ ${label}</button>`).join('')}
      <button class="btn danger" ${n ? '' : 'disabled'} onclick="bulkSnipDelete()">삭제</button></div>
    ${lifeSelRowHtml(n)}
    ${togetherOn() ? `<div class="row2"><button class="btn" ${n ? '' : 'disabled'} onclick="bulkSnipShare(true)">👀 보여주기</button><button class="btn" ${n ? '' : 'disabled'} onclick="bulkSnipShare(false)">🔒 나만 보기</button></div>` : ''}</div>`;
}
function selMemoSnips() { S.snipSel = new Set((S.snipShown || []).filter(id => (S.snips.find(x => x.ID === id) || {})['유형'] === '메모')); renderBook(); }
function selAllSnips(on) { (S.snipShown || []).forEach(id => on ? S.snipSel.add(id) : S.snipSel.delete(id)); renderBook(); }
function bulkSnipType(type) {
  let c = 0;
  [...S.snipSel].forEach(id => {
    const x = S.snips.find(y => y.ID === resolveId(id)); if (!x || x['유형'] === type) return;
    const data = { ID: x.ID, '책ID': x['책ID'], '유형': type, '내용': x['내용'], '쪽수': x['쪽수'] ?? '', '제목': x['제목'] || '', '키워드': x['키워드'] || '' };
    const local = Object.assign({}, x, { '유형': type });
    upsertSnipLocal(local); queue({ fn: 'saveSnippet', data, local }); c++;
  });
  const label = (SNIP_TYPES.find(t => t[0] === type) || [])[1];
  S.snipSel = new Set(); renderBook();
  toast(c ? `${c}개를 ‘${label}’(으)로 바꿨어요${(type !== '인용') !== (S.bookTab === '생각') ? ' · 옆 칸으로 옮겨졌어요' : ''}` : '바뀐 게 없어요');
}
function bulkSnipDelete() {
  const ids = [...S.snipSel].map(resolveId); if (!ids.length || !confirm(`${ids.length}개를 지울까요? 되돌릴 수 없어요.`)) return;
  ids.forEach(id => { S.snips = S.snips.filter(x => x.ID !== id); queue({ fn: 'deleteSnippet', id }); });
  S.snipSel = new Set(); renderBook(); toast(`${ids.length}개를 지웠어요`);
}
// 쪽수 순서로 정렬: "36, 37"은 36쪽. 쪽수 없는 노트 문장은 바로 앞 문장 자리에 붙어 있고, 쪽수 없는 새 문장은 맨 뒤
function firstPage(v) { const m = String(v ?? '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; }
function sortByPage(list) {
  const fromFile = s => s['출처'] === '노트파일' || s['출처'] === 'PDF';
  const base = list.slice().sort((x, y) => (fromFile(x) ? 0 : 1) - (fromFile(y) ? 0 : 1) || String(x.ID).localeCompare(String(y.ID)));
  let carry = 0;
  const keyed = base.map((s, i) => {
    const p = firstPage(s['쪽수']);
    let k;
    if (p != null) { k = p; if (fromFile(s)) carry = p; }
    else k = fromFile(s) ? carry : Infinity;
    return { s, k, i };
  });
  return keyed.sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.s);
}
function flashSnip(id) {
  setTimeout(() => { const el = document.getElementById('s-' + resolveId(id)); if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }, 80);
}
function snipHtml(s) {
  const cls = isThought(s) ? 'thought' : s['유형'] === '메모' ? 'memo' : 'quote';
  const memo = sMemo(s);
  const sel = S.snipSel && S.view === 'book';
  const kws = String(s['키워드'] || '').split(',').map(k => k.trim()).filter(Boolean);
  const meta = [s['쪽수'] !== '' && s['쪽수'] != null ? `<span class="pg">p.${esc(s['쪽수'])}</span>` : '', ...kws.map(k => `<span class="kw">#${esc(k)}</span>`),
    togetherOn() && isShared(s) && s['유형'] !== '메모' ? '<span class="kw shared" title="짝꿍에게 보여주는 중">👀 보여주는 중</span>' : ''].filter(Boolean);
  return `<div class="snip ${cls} ${sel && S.snipSel.has(s.ID) ? 'sel' : ''}" id="s-${s.ID}" onclick="snipTap('${s.ID}')">
    ${sel ? '<span class="sel-check snip-check">✓</span>' : ''}${sel ? '<span class="drag-h" aria-label="끌어서 옮기기">≡</span>' : ''}${s['유형'] === '메모' ? '<span class="badge plat" style="display:inline-block;margin-bottom:6px">메모</span>' : ''}
    ${lifeBadge(s)}
    ${s['제목'] ? `<div class="stitle">${esc(s['제목'])}</div>` : ''}
    <div class="txt">${esc(sText(s))}</div>
    ${memo ? `<div class="smemo">✎ ${esc(memo)}</div>` : ''}
    ${meta.length ? `<div class="smeta">${meta.join('')}</div>` : ''}
    ${typeof myReactLine === 'function' ? myReactLine(s) : ''}
  </div>`;
}

/* ===== 전체 필사 · 전체 내 생각 ===== */
S.allKind = '필사'; S.allQ = ''; S.allLimit = 50;
function openAllSnips(kind) { S.allKind = kind; S.allQ = ''; S.allLimit = 50; go('snips'); }
function allSnipList() {
  const q = S.allQ.trim().toLowerCase(), terms = q.replace(/^#/, '').split(/\s+/).filter(Boolean);
  let list = S.snips.filter(s => (S.allKind === '생각') === isThought(s));
  if (terms.length) list = list.filter(s => { const hay = (s['제목'] + ' ' + s['내용'] + ' ' + s['키워드'] + ' ' + ((book(s['책ID']) || {})['제목'] || '')).toLowerCase(); return terms.every(t => hay.includes(t)); });
  // 최근에 읽은 책부터, 책 안에서는 원래 순서
  const order = {}; S.books.forEach(b => order[b.ID] = String(b['완독일'] || b['시작일'] || ''));
  return list.sort((a, b) => String(order[b['책ID']] || '').localeCompare(String(order[a['책ID']] || '')) || String(a.ID).localeCompare(String(b.ID)));
}
function drawAllSnips() {
  const el = $('all-list'); if (!el) return;
  const list = allSnipList(), q = S.allQ.trim();
  let html = '', cur = null;
  list.slice(0, S.allLimit).forEach(s => {
    if (s['책ID'] !== cur) { cur = s['책ID']; const b = book(cur) || {}; html += `<div class="group-label tapl" onclick="S.bookTab='${S.allKind}';go('book','${cur}')">${esc(b['제목'] || '책 없음')} ›</div>`; }
    const memo = sMemo(s);
    html += `<div class="hit" onclick="openSnipInBook('${s.ID}')">${s['제목'] ? `<div class="ht">${q ? highlight(s['제목'], q) : esc(s['제목'])}</div>` : ''}
      <div class="hx">${q ? highlight(sText(s), q) : esc(sText(s).slice(0, 200)) + (sText(s).length > 200 ? '…' : '')}</div>
      ${memo ? `<div class="smemo">✎ ${esc(memo.slice(0, 120))}</div>` : ''}
      <div class="hm">${[s['쪽수'] !== '' && s['쪽수'] != null ? 'p.' + esc(s['쪽수']) : '', s['키워드'] ? '#' + esc(splitKw(s['키워드']).join(' #')) : ''].filter(Boolean).join(' · ')}</div></div>`;
  });
  el.innerHTML = (q ? `<div class="res-head">찾은 ${KIND_LABEL[S.allKind]} ${list.length.toLocaleString()}개</div>` : '') + (html || `<div class="empty">${q ? '찾는 문장이 없어요' : '아직 없어요'}</div>`)
    + (list.length > S.allLimit ? `<button class="btn" style="width:100%;margin-top:10px" onclick="S.allLimit+=100;drawAllSnips()">더 보기 (${(list.length - S.allLimit).toLocaleString()}개 남음)</button>` : '');
}
function renderAllSnips() {
  const nT = S.snips.filter(isThought).length, nQ = S.snips.length - nT;
  $('v-snips').innerHTML = `
    <div class="topbar"><button class="iconbtn" onclick="goBack()">← 서재</button></div>
    <div class="view-head"><h1>${S.allKind === '생각' ? '내 생각 모아 보기' : '필사 모아 보기'}</h1><p>책 이름을 누르면 그 책으로, 문장을 누르면 그 문장으로 가요</p></div>
    <div class="seg" id="all-kind" style="margin-top:10px"><button data-k="필사" class="${S.allKind === '필사' ? 'on' : ''}">필사 ${nQ.toLocaleString()}</button><button data-k="생각" class="${S.allKind === '생각' ? 'on' : ''}">내 생각 ${nT.toLocaleString()}</button></div>
    <input class="field" id="all-q" type="search" placeholder="문장 · 책 · #키워드 찾기" value="${esc(S.allQ)}" style="margin:10px 0 4px" autocomplete="off">
    <div id="all-list"></div>`;
  drawAllSnips();
  liveInput('all-q', v => { S.allQ = v; S.allLimit = 50; drawAllSnips(); });
  $('all-kind').onclick = e => { const t = e.target.closest('[data-k]'); if (!t) return; S.allKind = t.dataset.k; S.allLimit = 50; renderAllSnips(); };
}

const FAB_VIEWS = ['library', 'memo', 'notes', 'book'];
const FAB_LABEL = { library: '책 추가', notes: '새 글', memo: '메모 · 할 일 추가', book: '이 책에 문장 추가' };
/* ===== 화면 전환 ===== */
function show(view) {
  if (view === 'notes' && S.view !== 'notes' && S.view !== 'note') S.seedRand = Math.random();   // 노트 탭에 들어올 때마다 새 글감
  if (view !== 'notes' && S.noteSel) S.noteSel = null;
  if (view !== 'book' && S.snipSel) S.snipSel = null;
  if (view !== 'memo' && S.memoSel) S.memoSel = null;
  if (S.view === 'note' && view !== 'note' && typeof collectNote === 'function') { const n = collectNote(); if (n && S.noteDirty) saveNoteNow(true); stopDictate(); }
  S.view = view;
  ['library', 'book', 'graph', 'stats', 'ai', 'memo', 'blist', 'notes', 'note', 'more', 'snips', 'together', 'pbook', 'plib', 'settings', 'life', 'share', 'shared', 'req'].forEach(v => $('v-' + v).classList.toggle('hidden', view !== v));
  $('composer').classList.toggle('hidden', view !== 'ai');
  document.body.classList.toggle('ai-mode', view === 'ai');
  $('fab').classList.toggle('hidden', !FAB_VIEWS.includes(view));
  $('fab').setAttribute('aria-label', FAB_LABEL[view] || '빠르게 남기기');
  const tab = { book: 'library', snips: 'library', note: 'notes', blist: 'more', stats: 'more', ai: 'more', settings: 'more', life: 'library', share: 'together', shared: 'together', req: 'more', pbook: 'together', plib: 'together' }[view] || view;
  document.querySelectorAll('#nav [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
  if (view === 'library') renderLibrary();
  else if (view === 'book') renderBook();
  else if (view === 'graph') renderGraphView();
  else if (view === 'ai') renderAIView();
  else if (view === 'memo') { renderMemoView(); renderVoiceQueue(); processVoiceQueue(); }
  else if (view === 'notes') renderNoteList();
  else if (view === 'together') { renderTogether(); tgRefresh(true); }
  else if (view === 'pbook') renderPartnerBook();
  else if (view === 'plib') renderPartnerLib();
  else if (view === 'settings') renderSettingsView();
  else if (view === 'life') renderLifeView();
  else if (view === 'share') renderShareList();
  else if (view === 'shared') renderSharedView();
  else if (view === 'req') renderReqView();
  else if (view === 'note') renderNoteEditor();
  else if (view === 'more') renderMoreView();
  else if (view === 'blist') renderBookList();
  else if (view === 'snips') renderAllSnips();
  else renderStatsView();
  if (!(view === 'notes' && S.noteSel) && !(view === 'book' && S.snipSel) && !(view === 'memo' && S.memoSel) && $('selbar')) $('selbar').remove();
}
S.scrollMem = {};
function go(view, id) {
  if (S.view === 'library' || S.view === 'snips') S.scrollMem[S.view] = window.scrollY;
  if (view === 'book') { if (S.bookId !== id) { S.bookTab = '필사'; S.snipSel = null; } S.bookId = id; if (S.view !== 'book') S.prevView = S.view; }
  if (view === 'note') S.noteId = id;
  if (view === 'pbook') id = S.pbookId;
  try { history.pushState({ view, id: id || '' }, '', view === 'book' ? '?book=' + encodeURIComponent(id) : location.pathname); } catch (e) {}
  show(view); restoreScroll(view);
}
function restoreScroll(view) {
  const y = (view === 'library' || view === 'snips') ? (S.scrollMem[view] || 0) : 0;
  window.scrollTo(0, y);
  if (y) requestAnimationFrame(() => window.scrollTo(0, y));   // 그림이 늦게 그려질 때 한 번 더
}
function bookBack() {
  const prev = S.prevView;
  if (prev === 'library' || prev === 'snips' || prev === 'blist') goBack(); else go('library');
}
function goBack() { try { history.back(); } catch (e) { go('library'); } }
window.addEventListener('popstate', e => {
  if ($('modal').innerHTML) closeModal();
  if (S.view === 'library' || S.view === 'snips') S.scrollMem[S.view] = window.scrollY;
  setTimeout(() => { if (S.view === 'library' || S.view === 'snips') restoreScroll(S.view); }, 0);
  const st = e.state || {};
  if (st.view === 'book' && st.id && book(st.id)) { S.bookId = st.id; show('book'); }
  else if (st.view === 'blist' && S.blist) show('blist');
  else if (st.view === 'snips') show('snips');
  else if (st.view === 'settings') show('settings');
  else if (st.view === 'life') show('life');
  else if (st.view === 'share') show(togetherOn() ? 'share' : 'library');
  else if (st.view === 'shared') show(togetherOn() ? 'shared' : 'library');
  else if (st.view === 'req') show('req');
  else if (st.view === 'pbook' && st.id) { S.pbookId = st.id; show(togetherOn() ? 'pbook' : 'library'); }
  else if (['together', 'plib'].includes(st.view)) show(togetherOn() ? st.view : 'library');
  else if (st.view === 'note' && st.id && noteOf(st.id)) { S.noteId = resolveId(st.id); show('note'); }
  else show(['graph', 'stats', 'ai', 'memo', 'notes', 'more'].includes(st.view) ? st.view : 'library');
});

/* ===== 입력 창 ===== */
function closeModal() { if (S.snipDraftOn) { saveSnipDraft(); S.snipDraftOn = false; } $('modal').innerHTML = ''; S.moveMemoId = null; if (typeof stopDictate === 'function') stopDictate(); }
function modal(html) {
  $('modal').innerHTML = `<div class="backdrop" onclick="if(event.target===this)closeModal()"><div class="sheet">${html}</div></div>`;
}
// 검색칸: 글자를 칠 때 결과 목록만 바꿔요 (칸을 다시 그리면 한글이 ㄱㅏ처럼 쪼개져서)
function liveInput(id, fn) {
  const el = $(id); if (!el) return;
  let t = null;
  const run = () => { clearTimeout(t); t = setTimeout(() => fn(el.value), 60); };
  el.addEventListener('input', run);
  el.addEventListener('compositionend', run);
}
function datalist(id, values) { return `<datalist id="${id}">${uniq(values).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`; }

/* 필사 입력 */
let snipType = '인용';
function openSnipForm(id, forceType) {
  id = resolveId(id);
  const s = id ? S.snips.find(x => x.ID === id) : null;
  const b = book(S.bookId);
  snipType = s ? (s['유형'] === '서평' ? '생각' : (s['유형'] || '인용')) : (forceType || (S.bookTab === '생각' ? '생각' : '인용'));
  const allKw = uniq(S.snips.flatMap(x => String(x['키워드'] || '').split(',').map(k => k.trim())));
  const bookKw = uniq(snipsOf(b.ID).flatMap(x => String(x['키워드'] || '').split(',').map(k => k.trim())));
  const kwSuggest = uniq([...bookKw, ...allKw]).slice(0, 14);
  modal(`
    <h3>${s ? (s['유형'] === '메모' ? '메모 고치기' : isThought(s) ? '내 생각 고치기' : '문장 수정') : snipType === '생각' ? '내 생각 쓰기' : snipType === '메모' ? '메모 쓰기' : '필사 추가'} <span style="font-weight:400;color:var(--faint);font-size:13px">${esc(b['제목'])}</span><span class="draft-state" id="draft-state"></span></h3>
    <div id="draft-note"></div>
    <div class="seg" id="seg">${['인용','생각','메모'].map(t => `<button data-t="${t}" class="${snipType === t ? 'on' : ''}">${t === '인용' ? '필사' : t === '생각' ? '내 생각' : '메모'}</button>`).join('')}</div>
    <label>제목 <span style="font-weight:400;color:var(--faint)">내가 붙이는 표제</span><button type="button" class="kw-ai" data-ai-title onclick="aiTitle(this)">AI 제목</button></label>
    <input class="field" id="f-ttl" value="${esc(s ? s['제목'] : '')}" placeholder="예: 과학은 믿음을 싫어한다">
    <label>내용</label>
    <div class="ftools"><label class="ftool">📷 사진에서<input type="file" accept="image/*" hidden onchange="snipPhoto(this)"></label>
      <button type="button" class="ftool" onclick="toggleDictate(this,'f-txt')">🎤 받아쓰기</button>
      <button type="button" class="ftool" onclick="startRecording('snip', recSnipDone)">🎙 읽어서 넣기</button>
      <button type="button" class="ftool" onclick="pasteClip(this)">📋 붙여넣기</button>
      <button type="button" class="ftool" onclick="snipSpell(this)">✓ 맞춤법</button></div>
    <div id="spell-out"></div>
    <textarea class="field" id="f-txt" placeholder="책 속 문장이나 생각을 적어 주세요">${esc(s ? sText(s) : '')}</textarea>
    <div id="memo-wrap" class="${s && sMemo(s) ? '' : 'hidden'}"><label>메모 <span style="font-weight:400;color:var(--faint)">이 문장에 덧붙이는 내 메모</span></label>
      <textarea class="field" id="f-memo" style="min-height:70px" placeholder="떠오른 것, 찾아볼 것, 연결되는 생각">${esc(s ? sMemo(s) : '')}</textarea></div>
    <button type="button" class="kw-ai ${s && sMemo(s) ? 'hidden' : ''}" id="memo-add" style="padding:6px 0 0" onclick="showMemoField()">＋ 메모 달기</button>
    <label>쪽수 <span style="font-weight:400;color:var(--faint)">여러 쪽이면 36, 37</span></label>
    <input class="field" id="f-page" inputmode="decimal" style="max-width:160px" value="${esc(s ? s['쪽수'] : '')}">
    ${lifePickHtml(s)}
    <label>키워드 <span style="font-weight:400;color:var(--faint)">쉼표로 구분</span><button type="button" class="kw-ai" onclick="aiKeywords(this)">AI 추천</button></label>
    <input class="field" id="f-kw" value="${esc(s ? s['키워드'] : '')}" placeholder="예: 자유, 사랑">
    ${kwSuggest.length ? `<div class="suggest">${kwSuggest.map(k => `<button class="chip" data-kw="${esc(k)}">#${esc(k)}</button>`).join('')}</div>` : ''}
    ${togetherOn() ? `<label class="tg-check" id="f-share-w"><input type="checkbox" id="f-share" ${(s ? isShared(s) : (tgShareNew() || bookSnipShared(b))) ? 'checked' : ''}> 👀 ${tgHasPartner() ? esc(tgName()) + '에게 ' : '짝꿍에게 '}보여주기</label>` : ''}
    <div class="actions">
      ${s ? `<button class="btn danger" onclick="removeSnip('${s.ID}')">삭제</button>` : ''}
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn grow" style="white-space:nowrap" onclick="submitSnip(${s ? `'${s.ID}'` : 'null'},'stay')" title="창을 닫지 않고 저장">중간 저장</button>
      ${s ? '' : `<button class="btn grow" style="white-space:nowrap" onclick="submitSnip(null,true)">저장·다음</button>`}
      <button class="btn primary grow" onclick="submitSnip(${s ? `'${s.ID}'` : 'null'},false)">저장</button>
    </div>`);
  bindSnipDraft(s);
  $('seg').onclick = e => { const t = e.target.closest('button'); if (!t) return; snipType = t.dataset.t; [...$('seg').children].forEach(x => x.classList.toggle('on', x === t)); snipDraftSoon(); memoAddVis(); };
  memoAddVis(); bindLifePick();
  document.querySelectorAll('[data-kw]').forEach(c => c.onclick = () => {
    const cur = $('f-kw').value.split(',').map(x => x.trim()).filter(Boolean);
    if (!cur.includes(c.dataset.kw)) cur.push(c.dataset.kw);
    $('f-kw').value = cur.join(', '); snipDraftSoon();
  });
  $('f-txt').addEventListener('paste', onSnipPaste);
  setTimeout(() => { const el = s ? $('f-txt') : $('f-ttl'); if (el) el.focus(); }, 50);
}
/* ----- 맞춤법 검사 (문장 입력 창 · 노트) ----- */
async function snipSpell(btn) {
  const txt = $('f-txt').value.trim(), memo = $('f-memo') ? $('f-memo').value.trim() : '', ttl = $('f-ttl').value.trim();
  if (!txt && !memo) { toast('내용을 먼저 적어 주세요'); return; }
  const out = $('spell-out'); btn.disabled = true;
  out.innerHTML = '<div class="spell-box"><span class="spin"></span> 맞춤법을 살펴보는 중…</div>';
  try {
    const r = await Store.run('noteAssist', { mode: 'spell', '제목': ttl, '본문': [txt, memo].filter(Boolean).join('\n\n') });
    if (!$('spell-out')) return;
    S.spellFix = (r.fixes || []).filter(f => f && f.from && f.to && f.from !== f.to && ['f-ttl', 'f-txt', 'f-memo'].some(k => $(k) && $(k).value.includes(f.from)));
    renderSpell();
  } catch (e) { if ($('spell-out')) out.innerHTML = `<div class="spell-box">⚠ ${esc(e.message || e)}</div>`; }
  finally { if (btn.isConnected) btn.disabled = false; }
}
function renderSpell() {
  const out = $('spell-out'); if (!out) return;
  const list = S.spellFix || [];
  out.innerHTML = `<div class="spell-box">${list.length ? `<div class="sp-head"><b>고칠 곳 ${list.length}개</b><span><button type="button" onclick="applySpell(-1)">모두 바꾸기</button> · <button type="button" onclick="$('spell-out').innerHTML=''">닫기</button></span></div>
    ${list.map((f, i) => `<div class="fix"><div><s>${esc(f.from)}</s> → <b>${esc(f.to)}</b>${f.why ? `<div class="small">${esc(f.why)}</div>` : ''}</div><button type="button" class="btn" onclick="applySpell(${i})">바꾸기</button></div>`).join('')}`
    : `<div class="sp-head"><span>맞춤법에서 눈에 띄는 곳이 없어요 👍</span><button type="button" onclick="$('spell-out').innerHTML=''">닫기</button></div>`}</div>`;
}
function applySpell(i) {
  const list = S.spellFix || [], picks = i < 0 ? list.slice() : [list[i]];
  let n = 0;
  picks.forEach(f => { for (const k of ['f-txt', 'f-memo', 'f-ttl']) { const el = $(k); if (el && el.value.includes(f.from)) { el.value = el.value.replace(f.from, f.to); n++; break; } } });
  S.spellFix = i < 0 ? [] : list.filter((_, j) => j !== i);
  snipDraftSoon(); renderSpell(); toast(n ? `${n}곳을 고쳤어요` : '이미 바뀌어 있어요');
}
function submitSnip(id, keepOpen) {
  id = resolveId(id);
  const stay = keepOpen === 'stay';
  const memoV = $('f-memo') ? $('f-memo').value.trim() : '';
  const data = { ID: id || ('T' + uid()), '책ID': S.bookId, '유형': snipType, '내용': $('f-txt').value.trim() + ($('f-txt').value.trim() && memoV ? MEMO_SEP + memoV : ''),
    '쪽수': $('f-page').value.trim().replace(/\s*p$/i, ''), '제목': $('f-ttl').value.trim(), '키워드': normKw($('f-kw').value) };
  if ($('f-share')) data['공개'] = $('f-share').checked && snipType !== '메모';
  data['인생'] = snipLife || '';
  if (!data['내용']) { toast('내용을 입력해 주세요'); return; }
  const prev = S.snips.find(x => x.ID === data.ID);
  const local = Object.assign({ '출처': '직접입력', '작성일': S.today }, prev || {}, data, { '책제목': (book(S.bookId) || {})['제목'] || '' });
  upsertSnipLocal(local);
  queue({ fn: 'saveSnippet', data, local });
  if (S.moveMemoId) {
    const mid = resolveId(S.moveMemoId); S.moveMemoId = null;
    S.memos = S.memos.filter(x => x.ID !== mid); queue({ fn: 'deleteMemo', id: mid });
    toast('메모를 필사로 옮겼어요');
  } else toast(stay ? '중간 저장했어요 · 계속 쓰세요' : '저장했어요');
  clearSnipDraft();
  renderBook();
  if (stay) {
    if (!id) {   // 새 문장 → 이제부터는 이 문장을 고치는 창으로
      const pos = $('f-txt').selectionStart;
      S.snipDraftOn = false; openSnipForm(data.ID);
      setTimeout(() => { const t = $('f-txt'); if (t) { t.focus(); t.setSelectionRange(pos, pos); } }, 60);
    } else { S.snipDraft0 = snipFormValues(); const st = $('draft-state'); if (st) st.textContent = '저장됨 ' + hhmm(); }
  } else if (keepOpen) { flashSnip(data.ID); openSnipForm(null); } else { closeModal(); if (!id) flashSnip(data.ID); }
}
/* ----- 문장 입력 임시저장: 쓰다가 창이 닫혀도 다시 열면 그대로 ----- */
const SNIP_DRAFT_KEY = 'snip_draft_v1';
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function snipDraftKey(s) { return s ? 'id:' + s.ID : 'new:' + S.bookId; }
function snipFormValues() {
  return { type: snipType, ttl: $('f-ttl') ? $('f-ttl').value : '', txt: $('f-txt') ? $('f-txt').value : '', memo: $('f-memo') ? $('f-memo').value : '', page: $('f-page') ? $('f-page').value : '', kw: $('f-kw') ? $('f-kw').value : '' };
}
function memoAddVis() {   // ＋ 메모 달기는 필사에서만 (내 생각 · 메모는 그 자체가 내 글이라)
  const add = $('memo-add'), wrap = $('memo-wrap'); if (!add || !wrap) return;
  const hasMemo = !!($('f-memo') && $('f-memo').value.trim());
  add.classList.toggle('hidden', snipType !== '인용' || !wrap.classList.contains('hidden'));
  if (snipType !== '인용' && !hasMemo) wrap.classList.add('hidden');
  const sw = $('f-share-w'); if (sw) sw.classList.toggle('hidden', snipType === '메모');   // 메모는 항상 나만
}
function showMemoField() { $('memo-wrap').classList.remove('hidden'); $('memo-add').classList.add('hidden'); setTimeout(() => $('f-memo').focus(), 30);
}
function readSnipDraft() { try { return JSON.parse(LS.get(SNIP_DRAFT_KEY) || 'null'); } catch (e) { return null; } }
function clearSnipDraft() { LS.del(SNIP_DRAFT_KEY); S.snipDraftOn = false; clearTimeout(S.snipDraftT); }
function saveSnipDraft() {
  if (!S.snipDraftOn || !$('f-txt')) return;
  const v = snipFormValues(), base = S.snipDraft0 || {};
  const same = ['type', 'ttl', 'txt', 'memo', 'page', 'kw'].every(k => String(v[k] || '') === String(base[k] || ''));
  if (same || (!v.txt.trim() && !v.ttl.trim())) { LS.del(SNIP_DRAFT_KEY); return; }
  LS.set(SNIP_DRAFT_KEY, JSON.stringify(Object.assign({ key: S.snipDraftKey, at: Date.now() }, v)));
  const st = $('draft-state'); if (st) st.textContent = '임시저장 ' + hhmm();
}
function snipDraftSoon() { clearTimeout(S.snipDraftT); S.snipDraftT = setTimeout(saveSnipDraft, 500); }
function bindSnipDraft(s) {
  S.snipDraftKey = snipDraftKey(s); S.snipDraftOn = true;
  S.snipDraft0 = snipFormValues();
  const d = readSnipDraft();
  if (d && d.key === S.snipDraftKey && (d.txt || d.ttl)) {
    const fill = v => { $('f-ttl').value = v.ttl || ''; $('f-txt').value = v.txt || ''; $('f-page').value = v.page || ''; $('f-kw').value = v.kw || '';
      $('f-memo').value = v.memo || ''; $('memo-wrap').classList.toggle('hidden', !v.memo); $('memo-add').classList.toggle('hidden', !!v.memo);
      snipType = v.type || snipType; [...$('seg').children].forEach(x => x.classList.toggle('on', x.dataset.t === snipType)); };
    const orig = S.snipDraft0;
    fill(d);
    const when = new Date(d.at); const label = (when.toDateString() === new Date().toDateString() ? '' : (when.getMonth() + 1) + '/' + when.getDate() + ' ') + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
    $('draft-note').innerHTML = `<div class="draft-note"><span>✎ ${label}에 쓰던 내용을 불러왔어요</span><button type="button" id="draft-drop">${s ? '원래대로' : '지우기'}</button></div>`;
    $('draft-drop').onclick = () => { fill(orig); LS.del(SNIP_DRAFT_KEY); $('draft-note').innerHTML = ''; toast(s ? '저장된 내용으로 되돌렸어요' : '임시저장을 지웠어요'); };
  }
  ['f-ttl', 'f-txt', 'f-memo', 'f-page', 'f-kw'].forEach(k => { const el = $(k); if (el) el.addEventListener('input', snipDraftSoon); });
}
function removeSnip(id) {
  if (!confirm('이 문장을 삭제할까요?')) return;
  id = resolveId(id); clearSnipDraft();
  S.snips = S.snips.filter(x => x.ID !== id);
  queue({ fn: 'deleteSnippet', id });
  closeModal(); renderBook(); toast('삭제했어요');
}

/* 책 추가 · 수정 */
const BOOK_FIELDS = [
  ['제목', 'text', true], ['저자', 'text'], ['옮긴이', 'text'], ['출판사', 'text'],
  ['플랫폼', 'plat'], ['경로', 'list'], ['대분류', 'list'], ['중분류', 'list'], ['개인분류', 'list'],
  ['분량', 'number'], ['시작일', 'date'], ['완독일', 'date'], ['상태', 'select'], ['표지URL', 'text'], ['ISBN', 'hidden'],
  ['반납일', 'date'], ['별점', 'stars'], ['한줄평', 'text']
];
function openBookForm(id) {
  S.formBookId = id || '';
  // 새 책: 서재에서 보고 있는 칸(읽고 싶은 · 읽는 중 · 완독)으로 바로 들어가게
  const st = !id && S.view === 'library' && ['읽을예정', '완독'].includes(S.filter) ? S.filter : '읽는중';
  const b = id ? book(id) : { '시작일': st === '읽는중' ? S.today : '', '완독일': st === '완독' ? S.today : '', '상태': st, '플랫폼': '종이책' };
  const field = ([k, type, req]) => {
    const v = esc(b[k] ?? '');
    let input;
    if (type === 'hidden') return `<input type="hidden" id="b-${k}" value="${v}">`;
    if (type === 'plat') { const cur = id ? platOf(b) : (b[k] || '종이책'); return `<div><label>${k}</label><input type="hidden" id="b-${k}" value="${esc(cur)}"><div class="seg plat-seg" id="plat-seg">${PLATS.map(p => `<button type="button" data-p="${p}" class="${cur === p ? 'on' : ''}">${p}</button>`).join('')}</div></div>`; }
    if (type === 'stars') input = `<select class="field" id="b-${k}"><option value="">–</option>${[5,4,3,2,1].map(n => `<option value="${n}" ${String(b[k]) === String(n) ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select>`;
    else if (type === 'select') input = `<select class="field" id="b-${k}" onchange="bookStateChanged(this.value)">${['읽는중','완독','중단','읽을예정'].map(o => `<option ${b[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (type === 'list') input = `<input class="field" id="b-${k}" list="dl-${k}" value="${v}">` + datalist('dl-' + k, S.books.map(x => x[k]));
    else input = `<input class="field" id="b-${k}" type="${type === 'number' ? 'text' : type}" ${type === 'number' ? 'inputmode="numeric"' : ''} value="${v}">`;
    return `<div><label>${k}${req ? ' *' : ''}</label>${input}</div>`;
  };
  const f = Object.fromEntries(BOOK_FIELDS.map(x => [x[0], field(x)]));
  modal(`
    <h3>${id ? '책 정보 수정' : '새 책 추가'}${id ? '' : ` <span style="font-weight:400;color:var(--faint);font-size:13px">${({ '읽는중': '읽는 중인 책', '읽을예정': '읽고 싶은 책', '완독': '다 읽은 책' })[b['상태']] || ''}으로 담아요</span>`}</h3>
    <div class="al-box">
      <input class="field" id="al-q" type="search" placeholder="책 검색: 제목 · 저자 · ISBN" value="${id ? esc(String(b['제목']).replace(/\(.*?\)/g, '').trim()) : ''}" onkeydown="if(event.key==='Enter'){event.preventDefault();alSearch()}">
      <button class="btn" onclick="alScan()" title="책 뒤 바코드 찍기" aria-label="바코드로 찾기">📷 바코드</button>
      <button class="btn primary" onclick="alSearch()">검색</button>
    </div>
    <div id="al-res" class="al-res"></div>
    <div id="cover-pick">${b['표지URL'] ? coverPick(b['표지URL'], '현재 표지') : ''}</div>
    <div class="divider"></div>
    ${f['제목']}
    <div class="row">${f['저자']}${f['옮긴이']}</div>
    <div class="row">${f['출판사']}${f['분량']}</div>
    ${f['플랫폼']}
    ${f['경로']}
    <div class="row">${f['대분류']}${f['중분류']}</div>
    <div class="row">${f['개인분류']}${f['상태']}</div>
    <div class="row">${f['시작일']}${f['완독일']}</div>
    <div class="row">${f['반납일']}${f['별점']}</div>
    ${f['한줄평']}
    ${f['표지URL']}${f['ISBN']}
    <div class="actions">
      ${id ? `<button class="btn danger" onclick="removeBook('${id}')">삭제</button>` : ''}
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn primary grow" onclick="submitBook(${id ? `'${id}'` : 'null'})">저장</button>
    </div>`);
  const setPlat = p => { $('b-플랫폼').value = p; [...$('plat-seg').children].forEach(x => x.classList.toggle('on', x.dataset.p === p)); };
  $('plat-seg').onclick = e => { const t = e.target.closest('[data-p]'); if (t) { setPlat(t.dataset.p); S.platTouched = true; } };
  S.platTouched = !!id;
  $('b-경로').addEventListener('change', () => { if (S.platTouched) return; const r = $('b-경로').value; if (/윌라|오디오/.test(r)) setPlat('오디오북'); else if (EBOOK_RE.test(r)) setPlat('E북'); });
  $('b-대분류').insertAdjacentHTML('afterend', `<div class="cat-auto" id="cat-auto"><button type="button" class="kw-ai" style="padding:0" onclick="autoCatForm(this)">🪄 자동 분류</button></div>`);
  if (!id) setTimeout(() => ($('al-q') && $('al-q').focus()), 50);
}
/* 책 검색 (카카오 + 국립중앙도서관) */
let alList = [];
function coverPick(url, note) { return `<div class="cover-pick"><img src="${esc(url)}" alt=""><span>${esc(note)}</span></div>`; }
function alScan() { openBarcode(isbn => { if (!$('al-q')) return; $('al-q').value = isbn; alSearch(true); }); }
async function alSearch(auto) {
  const q = $('al-q').value.trim();
  if (!q) { ($('al-q') && $('al-q').focus()); return; }
  $('al-res').innerHTML = '<div class="al-msg">찾는 중…</div>';
  try {
    const list = await call('bookSearch', q);
    alList = list;
    $('al-res').innerHTML = list.length ? list.map((x, i) => `
      <button class="al-item" data-i="${i}">
        <img src="${esc(x.cover)}" alt="">
        <div><b>${esc(x.title)}</b><span>${esc(x.author)}${x.translator ? ' · ' + esc(x.translator) + ' 옮김' : ''} · ${esc(x.publisher)}${x.year ? ' · ' + esc(x.year) : ''}</span></div>
      </button>`).join('') : '<div class="al-msg">검색 결과가 없어요. 제목을 조금 줄여서 다시 찾아보세요.</div>';
    $('al-res').querySelectorAll('.al-item').forEach(el => el.onclick = () => alPick(alList[Number(el.dataset.i)]));
    if (auto === true && list.length === 1) alPick(list[0]);   // 바코드로 찾은 책은 바로 채우기
    else if (auto === true && !list.length) $('al-res').innerHTML = `<div class="al-msg">ISBN ${esc(q)}로 찾은 책이 없어요. 제목으로 검색해 보세요.</div>`;
  } catch (e) { $('al-res').innerHTML = `<div class="al-msg">${esc(e.message || e)}</div>`; }
}
async function alPick(item) {
  $('al-res').innerHTML = '<div class="al-msg">쪽수 · 분류를 가져오는 중…</div>';
  try {
    const d = await call('bookDetail', item);
    // 검색 정보로 채우기 (개인분류 · 날짜 · 상태 · 플랫폼 · 경로는 그대로)
    ['제목','저자','출판사','대분류','중분류','분량','표지URL','ISBN'].forEach(k => { if (d[k] !== '' && d[k] != null) $('b-' + k).value = d[k]; });
    $('b-옮긴이').value = d['옮긴이'] || '';   // 고른 책 기준으로 (옮긴이 없는 책이면 비움)
    $('al-res').innerHTML = '';
    $('cover-pick').innerHTML = d['표지URL'] ? coverPick(d['표지URL'], '검색 정보로 채웠어요' + (d['분류출처'] ? ' · ' + d['분류출처'] : '') + (d['분량'] ? '' : ' · 쪽수는 직접 입력해 주세요')) : '';
    toast('책 정보를 채웠어요. 확인 후 저장하세요');
    if (!$('b-대분류').value.trim()) autoCatForm(); else { const box = $('cat-auto'); if (box) box.innerHTML = `✓ 검색 정보의 분류예요 <button type="button" class="kw-ai" onclick="autoCatForm(this, true)">AI로 다시</button>`; }
  } catch (e) { $('al-res').innerHTML = `<div class="al-msg">${esc(e.message || e)}</div>`; }
}

/* ----- 카테고리 자동 분류: 같은 저자 → 제목 낱말 → AI 순서로, 내 서재 분류 이름에 맞춰요 ----- */
const CAT_RULES = [
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
  [/에세이|산문/, '', '', '에세이']
];
function normAuthor(a) { return String(a || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase(); }
function guessCategory(info) {
  const others = S.books.filter(b => b['대분류'] && b.ID !== info.ID);
  // 1) 같은 저자의 책이 있으면 그 분류
  const au = splitAuthors(info['저자']).map(normAuthor).filter(Boolean);
  for (const a of au) {
    const same = others.filter(b => splitAuthors(b['저자']).map(normAuthor).includes(a));
    if (same.length) { const pick = same[same.length - 1]; return { '대분류': pick['대분류'], '중분류': pick['중분류'] || '', '개인분류': pick['개인분류'] || '', how: '같은 저자 책 기준' }; }
  }
  // 2) 같은 시리즈 (제목 앞부분이 같은 책)
  const t = String(info['제목'] || '').replace(/\(.*?\)/g, '').trim();
  const stem = t.replace(/\s*\d+\s*(권|부|편)?$/, '').trim();
  if (stem.length >= 3) { const ser = others.find(b => String(b['제목']).replace(/\(.*?\)/g, '').trim().startsWith(stem)); if (ser) return { '대분류': ser['대분류'], '중분류': ser['중분류'] || '', '개인분류': ser['개인분류'] || '', how: '같은 시리즈 기준' }; }
  // 3) 제목 낱말
  for (const [re, big, mid, mine] of CAT_RULES) {
    if (re.test(t) && big) return { '대분류': big, '중분류': mid, '개인분류': mine, how: '제목 낱말 기준' };
  }
  return null;
}
async function aiCategory(info) {
  const bigs = uniq(S.books.map(b => b['대분류'])), mids = uniq(S.books.map(b => b['중분류'])), mine = uniq(S.books.map(b => b['개인분류']));
  const q = `[분류 요청] 아래 책 한 권의 분류만 골라 줘. 내 기록이나 필사는 참고하지 말고, 이 책 자체가 어떤 책인지로 판단해.
책: 제목 "${info['제목']}" / 저자 ${info['저자'] || '모름'}${info['옮긴이'] ? ' / 옮긴이 ' + info['옮긴이'] : ''}${info['출판사'] ? ' / 출판사 ' + info['출판사'] : ''}
대분류 후보: ${bigs.join(', ')}
중분류 예시: ${mids.join(', ')}
개인분류 예시: ${mine.join(', ')}
규칙: 소설·시·에세이는 작가 국적에 따라 '한국 문학' 또는 '해외 문학'. 중분류는 예시에 맞는 게 있으면 그대로, 없으면 비슷한 형식으로 새로 지어도 돼.
다른 말 없이 JSON 한 줄로만 답해: {"대분류":"…","중분류":"…","개인분류":"…"}`;
  const r = await Store.run('askAssistant', q, []);
  const m = String(r && r.answer || '').match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); if (!j['대분류']) return null; return { '대분류': String(j['대분류']).trim(), '중분류': String(j['중분류'] || '').trim(), '개인분류': String(j['개인분류'] || '').trim(), how: 'AI 추천' }; } catch (e) { return null; }
}
async function classifyBook(info, useAI) {
  return guessCategory(info) || (useAI ? await aiCategory(info).catch(() => null) : null);
}
function formBookInfo() { const o = {}; ['제목', '저자', '옮긴이', '출판사'].forEach(k => o[k] = ($('b-' + k) || {}).value || ''); o.ID = S.formBookId || ''; return o; }
function fillCat(c, force) {
  ['대분류', '중분류', '개인분류'].forEach(k => { const el = $('b-' + k); if (el && c[k] && (force || !el.value.trim())) el.value = c[k]; });
  const box = $('cat-auto'); if (box) box.innerHTML = `✓ ${esc([c['대분류'], c['중분류'], c['개인분류']].filter(Boolean).join(' > '))} <span style="color:var(--faint)">· ${esc(c.how)}</span> <button type="button" class="kw-ai" onclick="autoCatForm(this, true)">다시</button>`;
}
async function autoCatForm(btn, aiOnly) {
  const info = formBookInfo();
  if (!info['제목'].trim()) { toast('제목을 먼저 넣어 주세요'); return; }
  const box = $('cat-auto'); if (box) box.innerHTML = '<span class="spin"></span> 분류를 고르는 중…';
  const c = aiOnly ? await aiCategory(info).catch(() => null) : await classifyBook(info, true);
  if (!$('cat-auto')) return;
  if (c) fillCat(c, true); else $('cat-auto').innerHTML = `분류를 찾지 못했어요. 직접 골라 주세요. <button type="button" class="kw-ai" onclick="autoCatForm(this)">다시</button>`;
}
// 분류 없는 책 한꺼번에
async function autoCatAll() {
  const list = S.books.filter(b => !String(b['대분류'] || '').trim());
  if (!list.length) { toast('분류 없는 책이 없어요'); return; }
  if (!confirm(`분류가 빈 책 ${list.length}권을 자동으로 채울까요?\n같은 저자 · 제목으로 먼저 찾고, 모르면 AI에게 물어요.`)) return;
  toast(`${list.length}권 분류하는 중…`); let n = 0;
  for (const b of list) {
    const c = await classifyBook(b, true);
    if (c) { const patch = {}; ['대분류', '중분류', '개인분류'].forEach(k => { if (c[k] && !String(b[k] || '').trim()) patch[k] = c[k]; }); if (Object.keys(patch).length) { patchBook(b.ID, patch); n++; } }
  }
  toast(`${n}권 분류했어요`); if (S.view === 'stats') renderStatsView(); else if (S.view === 'library') renderList();
}
// 상태를 바꾸면 날짜도 맞춰요: 읽고 싶은 책은 시작일 · 완독일 없이, 읽는 중으로 바꾸면 오늘 시작
function bookStateChanged(v) {
  const sd = $('b-시작일'), fd = $('b-완독일'); if (!sd) return;
  if (v === '읽을예정') { sd.value = ''; if (fd) fd.value = ''; }
  else if (v === '읽는중' && !sd.value) sd.value = S.today;
  else if (v === '완독' && fd && !fd.value) fd.value = S.today;
}
async function submitBook(id) {
  const data = { ID: id || '' };
  BOOK_FIELDS.forEach(([k]) => data[k] = $('b-' + k).value.trim());
  if (data['상태'] === '읽을예정') { data['시작일'] = ''; data['완독일'] = ''; }   // 읽고 싶은 책은 아직 시작 전
  if (!data['제목']) { toast('제목을 입력해 주세요'); return; }
  if (data['분량'] && isNaN(Number(data['분량']))) { toast('분량은 숫자로 입력해 주세요'); return; }
  if (data['분량']) data['분량'] = Number(data['분량']);
  if (!data['대분류']) { const g = guessCategory(data); if (g) ['대분류', '중분류', '개인분류'].forEach(k => { if (!data[k] && g[k]) data[k] = g[k]; }); }
  document.querySelectorAll('.sheet .btn').forEach(b => b.disabled = true);
  try {
    const saved = await call('saveBook', data);
    const i = S.books.findIndex(x => x.ID === saved.ID);
    if (i >= 0) S.books[i] = saved; else S.books.push(saved);
    closeModal(); toast('저장했어요');
    if (!String(saved['대분류'] || '').trim()) aiCategory(saved).then(c => { if (!c) return; const patch = {}; ['대분류', '중분류', '개인분류'].forEach(k => { if (c[k] && !String(saved[k] || '').trim()) patch[k] = c[k]; });
      if (Object.keys(patch).length) { patchBook(saved.ID, patch); toast('분류를 자동으로 채웠어요: ' + patch['대분류']); if (S.view === 'book' && S.bookId === saved.ID) renderBook(); } }).catch(() => {});
    if (id) renderBook(); else go('book', saved.ID);
  } catch (e) { document.querySelectorAll('.sheet .btn').forEach(b => b.disabled = false); }
}
async function removeBook(id) {
  const n = snipsOf(id).length;
  if (!confirm(`이 책을 삭제할까요?${n ? `\n필사 문장 ${n}개도 함께 삭제됩니다.` : ''}`)) return;
  await call('deleteBook', id);
  S.books = S.books.filter(x => x.ID !== id);
  S.snips = S.snips.filter(x => x['책ID'] !== id);
  closeModal(); go('library'); toast('삭제했어요');
}
async function finish(id, sure) {
  if (!sure && !confirm('오늘 날짜로 완독 처리할까요?')) return;
  const b0 = book(id), total = Number(b0 && b0['분량']) || 0;
  if (total && (Number(b0['현재쪽수']) || 0) < total) readHereQuiet(id, total);   // 마지막 쪽까지 읽은 걸로 기록
  const saved = await call('finishBook', id);
  S.books[S.books.findIndex(x => x.ID === id)] = saved;
  rerenderBookish(id); toast(`완독! ${saved['완독일수'] ? saved['완독일수'] + '일 걸렸어요' : ''}`);
  setTimeout(() => openRating(id), 400);
}

