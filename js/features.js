/* 나의 서재 — 검색 · 진행률 · 독서 기록 · 설정 · 키워드 · 리포트
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   추가 기능: 문장 검색 · 오늘의 문장 · 반납일 · 진행률 · 목표 · 별점 ·
             읽고 싶은 책 · 키워드 정리 · 독서 리포트 · 설정
   =================================================================== */
S.settings = { goal: '', libraryUrl: '', libraryName: '' };
S.todayShift = 0; S.hitLimit = 30; S.focusSnip = null;

function dayDiff(dateStr) {
  if (!dateStr) return null;
  const a = new Date(S.today + 'T00:00:00'), b = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + Math.round(n));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function starText(n) { n = Number(n) || 0; return n ? '★'.repeat(n) + '☆'.repeat(5 - n) : ''; }
function dueBadge(b) {
  const d = dayDiff(b['반납일']);
  if (d === null) return '';
  if (d < 0) return `<span class="badge due-late">반납 ${-d}일 지남</span>`;
  if (d === 0) return `<span class="badge due-late">오늘 반납</span>`;
  return `<span class="badge ${d <= 3 ? 'due-soon' : ''}">반납 D-${d}</span>`;
}
function progressOf(b) {
  const total = Number(b['분량']) || 0, cur = Number(b['현재쪽수']) || 0;
  if (!total || !cur) return null;
  const pct = Math.min(100, Math.round(cur / total * 100));
  let eta = '';
  if (b['시작일'] && cur < total) {
    const days = Math.max(1, (dayDiff(b['시작일']) * -1) + 1);
    const pace = cur / days;
    if (pace > 0) eta = addDays(S.today, (total - cur) / pace);
  }
  return { total, cur, pct, eta };
}
function patchBook(id, patch) { const b = book(id); if (b) Object.assign(b, patch); queue({ fn: 'updateBookFields', id, patch: Object.assign({}, patch) }); }
function updateBook(saved) { const i = S.books.findIndex(x => x.ID === saved.ID); if (i >= 0) S.books[i] = saved; else S.books.push(saved); }

/* ---------- 서재: 목표 · 오늘의 문장 · 반납 알림 ---------- */
function libraryTopHtml() {
  let html = readStripHtml();
  // 반납 임박
  const due = S.books.filter(b => { const d = dayDiff(b['반납일']); return d !== null && d <= 3; })
    .sort((a, b) => dayDiff(a['반납일']) - dayDiff(b['반납일']));
  if (due.length) html += `<div class="due">📚 반납 챙기세요: ${due.map(b => {
    const d = dayDiff(b['반납일']);
    return `<a onclick="go('book','${b.ID}')">${esc(b['제목'])}</a> (${d < 0 ? -d + '일 지남' : d === 0 ? '오늘' : 'D-' + d})`;
  }).join(', ')}</div>`;
  // 오늘의 문장
  const pool = S.snips.filter(s => !isThought(s) && s['유형'] !== '메모' && sText(s).length >= 30 && String(s['내용']).length <= 600);
  if (pool.length && !S.q.trim()) {
    if (S.quoteSeed == null) S.quoteSeed = Math.floor(Math.random() * 1e9);   // 앱을 켤 때마다 새로
    const s = pool[(S.quoteSeed + S.todayShift * 7919) % pool.length];
    const b = book(s['책ID']) || {};
    html += `<div class="today">
      <div class="lb"><span>다시 만나는 문장</span><button onclick="S.todayShift++;renderList()">다른 문장 ↻</button></div>
      <div class="tx" onclick="openSnipInBook('${s.ID}')">${esc(sText(s))}</div>
      <div class="mt">${esc(b['제목'] || '')}${s['쪽수'] !== '' && s['쪽수'] != null ? ' · p.' + esc(s['쪽수']) : ''}${s['제목'] ? ' · ' + esc(s['제목']) : ''}</div>
    </div>`;
  }
  return html;
}
function goalHtml() {
  const y = S.today.slice(0, 4);
  const done = S.books.filter(b => b['상태'] === '완독' && String(b['완독일']).startsWith(y)).length;
  const g = Number(S.settings.goal) || 0;
  if (!g) return `<div class="goal small" onclick="openSettings()">＋ ${y}년 독서 목표 정하기</div>`;
  return `<div class="goal" onclick="openSettings()"><div class="gl"><span>${y}년 목표</span><span><b>${done}</b> / ${g}권 · ${Math.min(100, Math.round(done / g * 100))}%</span></div>
    <div class="bar"><i style="width:${Math.min(100, done / g * 100)}%"></i></div></div>`;
}

/* ---------- 문장 검색 ---------- */
function searchSnips(q) {
  q = q.trim();
  if (!q) return [];
  if (q.startsWith('#')) {
    const k = q.slice(1).trim();
    return k ? S.snips.filter(s => splitKw(s['키워드']).some(x => x === k || x.includes(k))) : [];
  }
  if (q.length < 2) return [];
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return S.snips.filter(s => {
    const hay = (s['제목'] + ' ' + s['내용'] + ' ' + s['키워드'] + ' ' + ((book(s['책ID']) || {})['제목'] || '')).toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}
function highlight(text, q) {
  const terms = q.replace(/^#/, '').toLowerCase().split(/\s+/).filter(t => t.length >= 1);
  const src = String(text || '');
  const low = src.toLowerCase();
  let pos = -1;
  terms.forEach(t => { const i = low.indexOf(t); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
  let start = Math.max(0, pos - 40), piece = src.slice(start, start + 160);
  let html = esc(piece);
  terms.forEach(t => { if (!t) return; const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); html = html.replace(re, m => `<mark>${m}</mark>`); });
  return (start > 0 ? '…' : '') + html + (start + 160 < src.length ? '…' : '');
}
function hitsHtml(q) {
  const hits = searchSnips(q);
  if (!hits.length) return q.trim().length >= 2 || q.startsWith('#') ? `<div class="res-head">필사에서 찾은 문장 0개</div>` : '';
  return `<div class="res-head">필사에서 찾은 문장 ${hits.length}개</div>` +
    hits.slice(0, S.hitLimit).map(s => {
      const b = book(s['책ID']) || {};
      return `<div class="hit" onclick="openSnipInBook('${s.ID}')">
        ${s['제목'] ? `<div class="ht">${highlight(s['제목'], q)}</div>` : ''}
        <div class="hx">${highlight(s['내용'], q).replace('[메모]', '✎')}</div>
        <div class="hm">${esc(b['제목'] || '')}${s['쪽수'] !== '' && s['쪽수'] != null ? ' · p.' + esc(s['쪽수']) : ''}${s['키워드'] ? ' · #' + esc(splitKw(s['키워드']).join(' #')) : ''}</div>
      </div>`;
    }).join('') +
    (hits.length > S.hitLimit ? `<button class="btn" style="width:100%" onclick="S.hitLimit+=30;renderList()">더 보기 (${hits.length - S.hitLimit}개 남음)</button>` : '');
}
function openSnipInBook(id) {
  const s = S.snips.find(x => x.ID === id); if (!s) return;
  S.focusSnip = id; S.bookId = s['책ID']; S.bookTab = isThought(s) ? '생각' : '필사'; go('book', s['책ID']);
  setTimeout(() => {
    const el = document.getElementById('s-' + id);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }
    S.focusSnip = null;
  }, 80);
}

/* ---------- 책 상세: 진행률 · 반납 · 별점 · 읽고 싶은 책 ---------- */
function bookExtrasHtml(b) {
  let h = '';
  if (b['상태'] === '읽을예정') {
    h += `<div class="panel2"><h4>읽고 싶은 책</h4><div class="inline">
      <button class="btn primary" onclick="startReading('${b.ID}')">오늘부터 읽기 시작</button></div></div>`;
  }
  const logs = logsOf(b.ID);
  if (b['상태'] === '읽는중') {
    const p = progressOf(b), eb = platOf(b) === 'E북';
    const todayN = dailyOf(b.ID)[S.today] || 0;
    h += `<div class="panel2"><h4>읽는 중</h4>
      ${p ? `<div class="gl small" style="display:flex;justify-content:space-between;margin-bottom:5px"><span>p.${p.cur} / ${p.total}</span><span><b>${p.pct}%</b>${p.eta ? ' · 이 속도면 ' + p.eta.slice(5).replace('-', '.') + ' 완독' : ''}</span></div>
        <div class="bar"><i style="width:${p.pct}%"></i></div>` : `<div class="small">읽은 곳까지 쪽수를 넣으면 진행률 · 예상 완독일 · 매일 읽은 양을 기록해요.</div>`}
      <div class="inline" style="margin-top:10px"><input class="field" id="cur-page" inputmode="${eb ? 'decimal' : 'numeric'}" placeholder="${eb ? '몇 쪽? (45%도 돼요)' : '지금 몇 쪽?'}" value="" onkeydown="if(event.key==='Enter'){event.preventDefault();readHere('${b.ID}')}">
        <button class="btn primary" onclick="readHere('${b.ID}')">여기까지 읽었어요</button></div>
      ${todayN ? `<div class="read-today">오늘 <b>${todayN}쪽</b> 읽었어요${b['현재쪽수'] ? ` · 지금 p.${esc(b['현재쪽수'])}` : ''}</div>` : b['현재쪽수'] ? `<div class="read-today">마지막으로 p.${esc(b['현재쪽수'])}까지 읽었어요</div>` : ''}
      ${logs.length ? readLogHtml(b) : ''}</div>`;
  } else if (logs.length) {
    h += `<div class="panel2"><h4>독서 기록 <span class="small" style="font-weight:400">${logs.length}일 읽음</span></h4>${readLogHtml(b)}</div>`;
  }
  if (b['반납일'] || (b['상태'] === '읽는중' && /도서관|대출|대여/.test(String(b['경로'] || '')))) {
    const d = dayDiff(b['반납일']);
    h += `<div class="panel2"><h4>도서관 반납</h4><div class="inline">
      <input class="field" type="date" id="due-date" value="${esc(b['반납일'] || '')}" onchange="saveDue('${b.ID}', this.value)">
      ${b['반납일'] ? `<span class="small">${d < 0 ? (-d) + '일 지남' : d === 0 ? '오늘 반납' : 'D-' + d}</span>
        <button class="btn" onclick="saveDue('${b.ID}','')">반납했어요</button>` : `<span class="small">빌린 책이면 반납일을 넣어 두세요. 전날 메일로 알려드려요.</span>`}
    </div></div>`;
  }
  if (b['상태'] === '완독') {
    h += `<div class="panel2" onclick="openRating('${b.ID}')" style="cursor:pointer"><h4>별점 · 한줄평</h4>
      ${b['별점'] || b['한줄평'] ? `<div><span class="stars">${starText(b['별점'])}</span></div>${b['한줄평'] ? `<div style="margin-top:4px">${esc(b['한줄평'])}</div>` : ''}`
        : `<div class="small">눌러서 별점과 한 줄 감상을 남겨 보세요.</div>`}</div>`;
  }
  return h;
}
function savePage(id) { readHere(id); }
function readHereQuiet(id, page) {
  const b = book(id); if (!b) return;
  const logs = logsOf(id), todayLog = logs.find(l => l.date === S.today), prevCur = Number(b['현재쪽수']) || 0;
  const base = logs.length ? (todayLog ? todayLog.base : null) : (prevCur && prevCur <= page ? prevCur : (b['시작일'] && String(b['시작일']).slice(0, 10) < S.today ? page : 0));
  saveLog(id, S.today, page, base, todayLog && todayLog.m);
  patchBook(id, { '현재쪽수': page });
}
/* ---------- 독서 기록: 여기까지 읽었어요 · 히스토리 · 매일 읽은 양 ---------- */
// 한 줄 = 그날 그 책을 어디까지 읽었나. 메모 시트에 종류 '독서기록', 내용 "2026-10-21 · p.120 (p.80부터)"
const LOG_RE = /^(\d{4}-\d{2}-\d{2})\s*·\s*p\.(\d+)(?:\s*\(p\.(\d+)부터\))?/;
function parseLog(m) { const r = LOG_RE.exec(String(m['내용'] || '')); return r ? { m, id: m.ID, bid: m['책ID'], date: r[1], page: Number(r[2]), base: r[3] != null ? Number(r[3]) : null } : null; }
function logsOf(bid) { return (S.logs || []).filter(m => m['책ID'] === bid).map(parseLog).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)); }
// 책 하나: 날짜 → 그날 읽은 쪽수
function dailyOf(bid) {
  const out = {}; let prev = null;
  logsOf(bid).forEach(l => { const from = prev != null ? prev : (l.base != null ? l.base : 0); out[l.date] = (out[l.date] || 0) + Math.max(0, l.page - from); prev = l.page; });
  return out;
}
// 모든 책: 날짜 → { n: 쪽수, books: {책ID: 쪽수} }
function dailyAll() {
  const out = {};
  uniq((S.logs || []).map(m => m['책ID'])).forEach(bid => {
    Object.entries(dailyOf(bid)).forEach(([d, n]) => { if (!n) return; const o = out[d] = out[d] || { n: 0, books: {} }; o.n += n; o.books[bid] = (o.books[bid] || 0) + n; });
  });
  return out;
}
function readStreak(all) {
  let n = 0, d = S.today;
  if (!(all[d] && all[d].n)) d = addDays(d, -1);   // 오늘 아직 안 읽었으면 어제부터 셈
  while (all[d] && all[d].n) { n++; d = addDays(d, -1); }
  return n;
}
function logText(date, page, base) { return `${date} · p.${page}${base != null ? ` (p.${base}부터)` : ''}`; }
function saveLog(bid, date, page, base, existing) {
  const fields = { '종류': '독서기록', '내용': logText(date, page, base), '완료': false, '마감일': '', '마감시간': '', '책ID': bid };
  const data = Object.assign({ ID: existing ? existing.ID : 'T' + uid() }, fields);
  const local = Object.assign({ '작성일': S.today }, existing || {}, data);
  upsertLocal('logs', local); queue({ fn: 'saveMemo', list: 'logs', data, local });
}
function readHere(id, val) {
  const b = book(id); if (!b) return;
  let v = String(val != null ? val : ($('cur-page') ? $('cur-page').value : '')).trim().replace(/쪽|p\.?$/gi, '').trim();
  if (!v) { toast('몇 쪽까지 읽었는지 넣어 주세요'); return; }
  let page;
  if (/%$/.test(v)) {
    const pct = Number(v.replace('%', '')), total = Number(b['분량']) || 0;
    if (isNaN(pct) || pct < 0 || pct > 100) { toast('0~100% 사이로 넣어 주세요'); return; }
    if (!total) { toast('%로 넣으려면 책 정보에 분량(쪽수)이 있어야 해요'); return; }
    page = Math.round(total * pct / 100);
  } else { page = Number(v); if (isNaN(page) || page < 0) { toast('숫자로 넣어 주세요'); return; } page = Math.round(page); }
  const total = Number(b['분량']) || 0; if (total && page > total) page = total;
  const logs = logsOf(id), prevCur = Number(b['현재쪽수']) || 0;
  const todayLog = logs.find(l => l.date === S.today);
  const base = logs.length ? (todayLog ? todayLog.base : null) : (prevCur && prevCur <= page ? prevCur : (b['시작일'] && String(b['시작일']).slice(0, 10) < S.today ? page : 0));
  saveLog(id, S.today, page, logs.length && !todayLog ? null : base, todayLog && todayLog.m);
  patchBook(id, { '현재쪽수': page });
  const n = dailyOf(id)[S.today] || 0;
  rerenderBookish(id);
  if (total && page >= total && b['상태'] === '읽는중') { toast('마지막 쪽까지 읽었어요!'); setTimeout(() => { if (confirm('다 읽었네요! 오늘 날짜로 완독 처리할까요?')) finish(id, true); }, 300); }
  else toast(n ? `오늘 ${n}쪽 읽었어요 · p.${page}까지` : `p.${page}까지 기록했어요`);
}
function rerenderBookish(id) { if (S.view === 'book' && S.bookId === id) renderBook(); else if (S.view === 'library') renderList(); else if (S.view === 'stats') renderStatsView(); }
function readLogHtml(b) {
  const logs = logsOf(b.ID), daily = dailyOf(b.ID);
  if (!logs.length) return '';
  const open = !!S.logOpen, rows = logs.slice().reverse(), shown = open ? rows : rows.slice(0, 3);
  return `<div class="readlog">${shown.map(l => `<div class="rl" onclick="openLogEdit('${l.id}')"><b>${l.date.slice(5).replace('-', '.')} (${WD[dateOf(l.date).getDay()]})</b><span>p.${l.page}까지 ${daily[l.date] ? `<em>+${daily[l.date]}쪽</em>` : ''}</span></div>`).join('')}</div>
    ${rows.length > 3 ? `<button class="more-btn" onclick="S.logOpen=!S.logOpen;renderBook()">${open ? '접기' : `기록 ${rows.length}개 모두 보기`}</button>` : ''}`;
}
function openLogEdit(lid) {
  const m = (S.logs || []).find(x => x.ID === resolveId(lid)); const l = m && parseLog(m); if (!l) return;
  const b = book(l.bid) || {};
  modal(`<h3>독서 기록 고치기 <span style="font-weight:400;color:var(--faint);font-size:13px">${esc(b['제목'] || '')}</span></h3>
    <div class="row"><div><label>날짜</label><input class="field" type="date" id="lg-date" value="${l.date}"></div>
      <div><label>여기까지 (쪽)</label><input class="field" id="lg-page" inputmode="numeric" value="${l.page}"></div></div>
    <div class="actions"><button class="btn danger" onclick="removeLog('${m.ID}')">삭제</button><button class="btn" onclick="closeModal()">취소</button>
      <button class="btn primary grow" onclick="saveLogEdit('${m.ID}')">저장</button></div>`);
}
function saveLogEdit(lid) {
  const m = (S.logs || []).find(x => x.ID === resolveId(lid)); const l = m && parseLog(m); if (!l) return;
  const date = $('lg-date').value, page = Number($('lg-page').value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(page)) { toast('날짜와 쪽수를 확인해 주세요'); return; }
  const clash = logsOf(l.bid).find(x => x.date === date && x.id !== l.id);
  if (clash) { S.logs = S.logs.filter(x => x.ID !== clash.id); queue({ fn: 'deleteMemo', list: 'logs', id: clash.id }); }
  saveLog(l.bid, date, Math.round(page), l.base, m);
  const last = logsOf(l.bid).slice(-1)[0]; if (last) patchBook(l.bid, { '현재쪽수': last.page });
  closeModal(); rerenderLogs(); toast('고쳤어요');
}
function removeLog(lid) {
  if (!confirm('이 날의 기록을 지울까요?')) return;
  const id = resolveId(lid), m = (S.logs || []).find(x => x.ID === id); if (!m) return;
  S.logs = S.logs.filter(x => x.ID !== id); queue({ fn: 'deleteMemo', list: 'logs', id });
  closeModal(); rerenderLogs(); toast('지웠어요');
}
function rerenderLogs() { if (S.view === 'book') renderBook(); else if (S.view === 'stats') renderStatsView(); else if (S.view === 'library') renderList(); }
// 서재 위: 오늘 읽은 양 · 연속 기록
function readStripHtml() {
  if (!readLogs().length) return '';
  const all = dailyAll(), t = all[S.today], st = readStreak(all);
  let week = 0; for (let i = 0; i < 7; i++) { const d = all[addDays(S.today, -i)]; if (d) week += d.n; }
  return `<div class="read-strip" onclick="go('stats');setTimeout(()=>{const e=$('daily-panel');if(e)e.scrollIntoView({block:'start'})},80)">
    <div>${t ? `오늘 <b>${t.n}쪽</b> 읽었어요` : '오늘은 아직 기록이 없어요'}${st >= 2 ? ` · 🔥 ${st}일 연속` : ''}</div><span>이번 주 ${week.toLocaleString()}쪽 ›</span></div>`;
}
// 통계: 최근 30일 매일 읽은 양
function dailyPanelHtml() {
  if (!readLogs().length) return `<div class="panel" id="daily-panel"><h3>매일 독서 기록</h3><div class="drill">책 화면의 ‘여기까지 읽었어요’로 읽은 쪽수를 남기면 하루하루 얼마나 읽었는지 여기 쌓여요.</div></div>`;
  const all = dailyAll(), days = Array.from({ length: 30 }, (_, i) => addDays(S.today, i - 29));
  const vals = days.map(d => (all[d] ? all[d].n : 0)), max = Math.max(1, ...vals);
  const sum = vals.reduce((a, b) => a + b, 0), readDays = vals.filter(Boolean).length;
  let week = 0; vals.slice(-7).forEach(v => week += v);
  return `<div class="panel" id="daily-panel"><h3>매일 독서 기록<small>최근 30일 · 막대를 누르면 그날 읽은 책</small></h3>
    <div class="dsum"><div><b>${week.toLocaleString()}</b><span>이번 주 (쪽)</span></div><div><b>${readDays ? Math.round(sum / readDays) : 0}</b><span>읽은 날 평균 (쪽)</span></div><div><b>${readStreak(all)}</b><span>연속 (일)</span></div></div>
    <div class="dbars">${days.map((d, i) => `<div class="dbar ${d === S.today ? 'dtoday' : ''}" data-d="${d}" title="${d} · ${vals[i]}쪽"><span class="fill" style="height:${vals[i] / max * 100}%"></span></div>`).join('')}</div>
    <div class="dlabels"><span>${days[0].slice(5).replace('-', '.')}</span><span>${days[15].slice(5).replace('-', '.')}</span><span>오늘</span></div>
    <div class="drill" id="drill-day"></div></div>`;
}
function openDay(d) {
  const all = dailyAll(), o = all[d], el = $('drill-day'); if (!el) return;
  document.querySelectorAll('.dbar').forEach(x => x.classList.toggle('on', x.dataset.d === d));
  el.innerHTML = o ? `<b>${d.slice(5).replace('-', '.')} (${WD[dateOf(d).getDay()]}) · ${o.n}쪽</b><br>${Object.entries(o.books).map(([bid, n]) => `<a onclick="go('book','${bid}')">${esc((book(bid) || {})['제목'] || '')}</a> ${n}쪽`).join(' · ')}` : `${d.slice(5).replace('-', '.')} · 기록 없음`;
}
async function saveDue(id, v) {
  patchBook(id, { '반납일': v });
  renderBook(); toast(v ? '반납일을 저장했어요' : '반납 완료!');
}
async function startReading(id) {
  patchBook(id, { '상태': '읽는중', '시작일': S.today });
  renderBook(); toast('읽기 시작! 오늘부터 기록해요');
}
let ratingPick = 0;
function openRating(id) {
  const b = book(id); ratingPick = Number(b['별점']) || 0;
  modal(`<h3>별점 · 한줄평 <span style="font-weight:400;color:var(--faint);font-size:13px">${esc(b['제목'])}</span></h3>
    <div class="star-pick" id="star-pick">${[1,2,3,4,5].map(n => `<span data-n="${n}" class="${n <= ratingPick ? 'on' : ''}">★</span>`).join('')}</div>
    <label>한줄평</label><input class="field" id="one-line" value="${esc(b['한줄평'] || '')}" placeholder="이 책을 한 줄로 남긴다면?">
    <div class="actions"><button class="btn" onclick="closeModal()">나중에</button>
      <button class="btn primary grow" onclick="saveRating('${id}')">저장</button></div>`);
  $('star-pick').onclick = e => { const t = e.target.closest('[data-n]'); if (!t) return; ratingPick = Number(t.dataset.n);
    [...$('star-pick').children].forEach(x => x.classList.toggle('on', Number(x.dataset.n) <= ratingPick)); };
}
async function saveRating(id) {
  patchBook(id, { '별점': ratingPick || '', '한줄평': $('one-line').value.trim() });
  closeModal(); renderBook(); toast('저장했어요');
}

/* ---------- 설정 ---------- */
function accountPanelHtml() {
  return `${Store.kind === 'supabase' ? `<div class="panel2">
      <div class="small" style="line-height:1.6">${esc((sbSession() || { user: {} }).user.email || '')} 계정 · Supabase에 저장 중${S.outbox.length ? `<br>올라가길 기다리는 기록 ${S.outbox.length}개` : ''}</div>
      <div class="actions" style="margin-top:8px"><button class="btn" onclick="if(confirm('로그아웃할까요?'))sbLogout()">로그아웃</button>
        <button class="btn" onclick="resetLocal()">새로 불러오기</button>${API.url ? `<button class="btn" onclick="if(confirm('구글 시트 저장으로 돌아갈까요? Supabase의 기록은 그대로 남아요.'))useStore('sheets')">시트로 돌아가기</button>` : ''}</div></div>` : `
    <div class="panel2"><h4>서버 연결</h4>
      <div class="small" style="line-height:1.6">${Store.ready() ? '연결됨 · 마지막으로 받은 데이터는 이 기기에 저장돼 있어 바로 열려요.' : '아직 연결 안 됨'}${S.outbox.length ? `<br>시트에 올라가길 기다리는 기록 ${S.outbox.length}개` : ''}</div>
      <div class="actions" style="margin-top:8px"><button class="btn" onclick="Store.openSetup()">연결 바꾸기</button>
        <button class="btn" onclick="resetLocal()">새로 불러오기</button></div></div>
    <div class="panel2" style="margin-top:12px"><h4>새 저장소 (함께 쓰기 준비)</h4>
      <div class="small" style="line-height:1.6">구글 로그인 후 지금 기록을 Supabase로 복사해요. 시트는 백업으로 그대로 남아요.${(() => { try { const d = JSON.parse(LS.get('sb_migrated') || 'null'); return d ? `<br>마지막으로 옮김: ${esc(String(d.at).slice(0, 16).replace('T', ' '))}` : ''; } catch (e) { return ''; } })()}</div>
      <div class="actions" style="margin-top:8px"><button class="btn primary grow" onclick="openMigrate()">구글 로그인 · 새 저장소로 옮기기</button></div>
      <button class="note-link" onclick="if(confirm('다른 기기에서 이미 옮겼다면, 이 기기는 옮기기 없이 Supabase로 바꿔요. 바꾼 뒤 구글 로그인을 해 주세요.'))useStore('supabase')">이미 옮겼어요 · 이 기기도 Supabase로 <span>다른 기기에서 옮긴 뒤</span></button></div>`}`;
}
async function saveSettingsUI() {
  const r = await call('saveSettings', { goal: $('set-goal').value.trim(), libraryName: S.settings.libraryName || '', libraryUrl: S.settings.libraryUrl || '' });
  S.settings = r; closeModal(); toast('저장했어요');
  if (S.view === 'settings') renderSettingsView(); else if (S.view === 'library') renderLibrary(); else if (S.view === 'stats') renderStatsView(); else if (S.view === 'book') renderBook();
}

/* ---------- 키워드 정리 ---------- */
function openKwManager(filter) {
  const all = keywordStats();
  const draw = f => {
    const el = $('kw-list'); if (!el) return;
    el.innerHTML = all.filter(k => !f || k.kw.includes(f.trim().replace(/^#/, ''))).map(k => `<div class="kw-row" data-k="${esc(k.kw)}"><b>#${esc(k.kw)}</b><span>문장 ${k.n} · 책 ${k.books.size}</span></div>`).join('') || '<div class="small" style="padding:10px">없어요</div>';
    el.querySelectorAll('.kw-row').forEach(r => r.onclick = () => openKwEdit(r.dataset.k));
  };
  modal(`<h3>키워드 정리 <span style="font-weight:400;color:var(--faint);font-size:13px">${all.length}개</span></h3>
    <input class="field" id="kw-filter" type="search" placeholder="키워드 찾기" value="${esc(filter || '')}" autocomplete="off">
    <div class="kw-list" id="kw-list"></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  draw(filter); liveInput('kw-filter', draw);
}
function openKwEdit(k) {
  const others = keywordStats().map(x => x.kw).filter(x => x !== k);
  modal(`<h3>#${esc(k)}</h3>
    <label>바꿀 이름 · 합칠 키워드 <span style="font-weight:400;color:var(--faint)">기존 키워드를 고르면 합쳐져요</span></label>
    <input class="field" id="kw-to" list="kw-all" placeholder="예: 고독">${datalist('kw-all', others)}
    <div class="actions">
      <button class="btn danger" onclick="applyKw('${esc(k)}','')">키워드 지우기</button>
      <button class="btn" onclick="openKwManager()">뒤로</button>
      <button class="btn primary grow" onclick="applyKw('${esc(k)}', $('kw-to').value)">바꾸기</button></div>`);
  setTimeout(() => ($('kw-to') && $('kw-to').focus()), 50);
}
async function applyKw(from, to) {
  to = String(to || '').replace(/^#/, '').trim();
  if (!to && !confirm(`#${from} 키워드를 모든 문장에서 지울까요?`)) return;
  const n = await call('renameKeyword', from, to);
  S.snips.forEach(s => {
    const ks = splitKw(s['키워드']); if (!ks.includes(from)) return;
    const next = []; ks.forEach(x => { const v = x === from ? to : x; if (v && !next.includes(v)) next.push(v); });
    s['키워드'] = next.join(', ');
  });
  toast(to ? `#${from} → #${to} (${n}개 문장)` : `#${from} 삭제 (${n}개 문장)`);
  G.byId = {}; openKwManager();
  if (S.view === 'graph') renderGraphView();
}

/* ---------- 독서 리포트 ---------- */
function openReport(year) {
  year = year && year !== '전체' ? year : S.today.slice(0, 4);
  const done = S.books.filter(b => b['상태'] === '완독' && String(b['완독일']).startsWith(year));
  if (!done.length) { toast(year + '년에 완독한 책이 없어요'); return; }
  const ids = new Set(done.map(b => b.ID));
  const sn = S.snips.filter(s => ids.has(s['책ID']));
  const pages = done.reduce((t, b) => t + (Number(b['분량']) || 0), 0);
  const cnt = (arr, f) => { const m = {}; arr.forEach(x => [].concat(f(x)).forEach(k => { if (k) m[k] = (m[k] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const months = cnt(done, b => String(b['완독일']).slice(5, 7));
  const kws = cnt(sn, s => splitKw(s['키워드'])).slice(0, 6);
  const cats = cnt(done, b => b['대분류']).slice(0, 3);
  const best = done.filter(b => Number(b['별점'])).sort((a, b) => b['별점'] - a['별점'])[0];
  const fast = done.filter(b => Number(b['완독일수'])).sort((a, b) => a['완독일수'] - b['완독일수'])[0];
  const quotePool = sn.filter(s => s['유형'] === '인용' && String(s['내용']).length > 40 && String(s['내용']).length < 400 && (!best || s['책ID'] === best.ID));
  const q = (quotePool.length ? quotePool : sn.filter(s => String(s['내용']).length > 40 && String(s['내용']).length < 400))[0];
  const qb = q ? book(q['책ID']) : null;
  modal(`<div class="report">
    <h3 style="font-family:'Noto Serif KR',serif;font-size:20px;margin:0">${year}년, 나의 독서</h3>
    <div class="big"><div><b>${done.length}</b><span>권 완독</span></div><div><b>${pages.toLocaleString()}</b><span>쪽</span></div><div><b>${sn.length}</b><span>필사 덩어리</span></div></div>
    ${months.length ? `<div class="card"><h4>가장 많이 읽은 달</h4>${Number(months[0][0])}월 · ${months[0][1]}권</div>` : ''}
    ${kws.length ? `<div class="card"><h4>가장 많이 붙든 주제</h4>${kws.map(([k, n]) => `#${esc(k)} <span class="small">${n}</span>`).join(' &nbsp;')}</div>` : ''}
    ${cats.length ? `<div class="card"><h4>많이 읽은 분야</h4>${cats.map(([k, n]) => `${esc(k)} ${n}권`).join(' · ')}</div>` : ''}
    ${best ? `<div class="card"><h4>가장 좋았던 책</h4>${esc(best['제목'])} <span class="stars">${starText(best['별점'])}</span>${best['한줄평'] ? `<div class="small" style="margin-top:4px">“${esc(best['한줄평'])}”</div>` : ''}</div>` : ''}
    ${fast ? `<div class="card"><h4>단숨에 읽은 책</h4>${esc(fast['제목'])} · ${fast['완독일수']}일</div>` : ''}
    ${q ? `<div class="card"><h4>올해의 문장</h4><div class="quote">${esc(sText(q))}</div><div class="small" style="margin-top:6px">${esc(qb ? qb['제목'] : '')}${q['쪽수'] !== '' && q['쪽수'] != null ? ' · p.' + esc(q['쪽수']) : ''}</div></div>` : ''}
    <div class="actions"><button class="btn primary grow" onclick="closeModal()">닫기</button></div>
  </div>`);
}


