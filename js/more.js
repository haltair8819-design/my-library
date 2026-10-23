/* 나의 서재 — 더보기 · 통합 검색 · 내보내기 · 잠금 · 시작
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   더보기 (v2.4): 통계 · AI 비서 · 백업 · 잠금 · 설정
   =================================================================== */
function renderMoreView() {
  const locked = !!LS.get('pin_hash');
  $('v-more').innerHTML = `
    <div class="view-head"><h1>더보기</h1><p>나의 서재 v${APP_VERSION}</p></div>
    <div class="more-list">
      <button onclick="go('stats')"><span class="mi">📊</span><b>독서 통계</b><span>완독 · 분류 · 달별 책 목록, 독서 리포트</span></button>
      <button onclick="go('ai')"><span class="mi">✨</span><b>AI 비서</b><span>내 필사 · 글 · 메모를 근거로 답해요</span></button>
      <button onclick="openSettings()"><span class="mi">⚙️</span><b>설정</b><span>목표 · 화면 · 알림 · 같이 쓰기 · 백업 · 잠금 · 계정</span></button>
    </div>`;
}

/* ===================================================================
   설정 (v2.11.1): 흩어져 있던 설정을 한 화면에
   =================================================================== */
function openSettings() { if (S.view === 'settings') renderSettingsView(); else go('settings'); }
function renderSettingsView() {
  const st = S.settings || {}, locked = !!LS.get('pin_hash'), sb = Store.kind === 'supabase';
  const row = (icon, title, sub, onclick) => `<button onclick="${onclick}"><span class="mi">${icon}</span><b>${title}</b><span>${sub}</span></button>`;
  const y = window.scrollY;
  $('v-settings').innerHTML = `
    <div class="topbar"><button class="iconbtn" onclick="goBack()">← 뒤로</button></div>
    <div class="view-head"><h1>설정</h1><p>나의 서재 v${APP_VERSION}</p></div>
    <div class="set-sec">독서</div>
    <div class="panel2"><h4>${S.today.slice(0, 4)}년 독서 목표 (권)</h4>
      <div class="inline"><input class="field" id="set-goal" inputmode="numeric" value="${esc(st.goal)}" placeholder="예: 60" style="max-width:140px"><button class="btn primary" onclick="saveSettingsUI()">저장</button></div></div>
    <div class="set-sec">화면</div>
    ${themePickerHtml()}
    ${sb ? `<div class="set-sec">알림</div><div class="panel2" id="set-notify"><div class="drill"><span class="spin"></span> 확인하는 중…</div></div>` : ''}
    ${sb ? `<div class="set-sec">같이 쓰기</div>
    <div class="panel2"><label class="tg-check" style="margin-top:0"><input type="checkbox" ${togetherOn() ? 'checked' : ''} onchange="tgSaveOpt('together', this.checked)"> ‘함께’ 탭 쓰기 <span class="small">끄면 탭이 숨겨져요 (보여준 기록은 그대로)</span></label>
      <div class="actions" style="margin-top:8px"><button class="btn" onclick="openShareSettings()">보여줄 것 설정</button><button class="btn" onclick="go('together')">함께 탭으로</button></div></div>` : ''}
    <div class="set-sec">기록 관리</div>
    <div class="more-list" style="margin-top:0">
      ${sb ? row('🗄', '자동 백업', '매주 일요일 · 최근 8주 보관 · 내려받기', 'openBackups()') : ''}
      ${row('⬇️', '전체 내보내기', '책 · 필사 · 글 · 메모를 마크다운 파일로', 'exportMarkdown()')}
      ${row('📥', '노트 파일 가져오기', '삼성노트 txt를 필사로', 'openNoteImport()')}
    </div>
    <div class="set-sec">보안</div>
    <div class="more-list" style="margin-top:0">${row('🔒', '앱 잠금', locked ? '켜짐 · 열 때 비밀번호' : '꺼짐 · 열 때 비밀번호를 물어요', 'openLockSettings()')}</div>
    <div class="set-sec">계정 · 저장</div>
    ${accountPanelHtml()}
    <div class="set-sec">정보</div>
    <div class="more-list" style="margin-top:0">
      ${row('🗒', '업데이트 내역', 'v' + APP_VERSION, 'openPatchNotes()')}
      ${row('📤', '공유 받기 점검', '공유 목록에 안 보일 때', 'openShareCheck()')}
    </div>
    <div style="height:30px"></div>`;
  window.scrollTo(0, y);
  if (sb && typeof drawNotify === 'function') drawNotify();
}

/* ===================================================================
   통합 검색: 책 · 필사 · 글 · 메모 (서재 검색칸)
   =================================================================== */
function otherHitsHtml(q) {
  q = String(q || '').trim().toLowerCase(); if (!q) return '';
  const kw = q.startsWith('#') ? q.slice(1) : '';
  const terms = (kw ? [kw] : q.split(/\s+/)).filter(Boolean);
  const has = t => terms.every(w => t.toLowerCase().includes(w));
  const notes = S.notes.filter(n => kw ? splitKw(n['키워드']).some(k => k.toLowerCase() === kw) : has(n['제목'] + ' ' + n['본문'] + ' ' + n['키워드'])).slice(0, 10);
  const memos = kw ? [] : S.memos.filter(m => has(m['내용'])).slice(0, 10);
  let h = '';
  if (notes.length) h += `<div class="res-head">내 글 ${notes.length}편</div>` + notes.map(n => `<div class="hit" onclick="openNote('${n.ID}')"><div class="ht">✍ ${esc(n['제목'] || '제목 없음')}</div>
    <div class="hx">${highlight(plainText(n['본문']), q)}</div><div class="hm">${esc(n['상태'])} · ${esc(String(n['수정일'] || '').slice(0, 10))}</div></div>`).join('');
  if (memos.length) h += `<div class="res-head">메모 · 할 일 ${memos.length}개</div>` + memos.map(m => `<div class="hit" onclick="go('memo');setTimeout(()=>openMemo('${m.ID}'),60)"><div class="hx">${m['종류'] === '할일' ? '☑ ' : '✎ '}${highlight(String(m['내용']), q)}</div></div>`).join('');
  return h;
}

/* ===================================================================
   전체 내보내기: 마크다운 파일 묶음(zip) — 옵시디언 등에서 그대로 열림
   =================================================================== */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {   // files: [{name, text}] → Blob (압축 없이 묶기)
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)), dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate());
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + data.length;
  });
  const csize = central.reduce((t, p) => t + (p.byteLength || p.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
function safeName(t) { return String(t || '제목 없음').replace(/[\\/:*?"<>|#\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '제목 없음'; }
function exportMarkdown() {
  const files = [], used = {};
  const uniqName = p => { let n = p, i = 2; while (used[n]) n = p.replace(/\.md$/, ` (${i++}).md`); used[n] = 1; return n; };
  S.books.forEach(b => {
    const sn = snipsOf(b.ID);
    const meta = [['저자', b['저자']], ['옮긴이', b['옮긴이']], ['출판사', b['출판사']], ['상태', b['상태']], ['시작일', b['시작일']], ['완독일', b['완독일']], ['분량', b['분량'] ? b['분량'] + '쪽' : ''], ['분류', [b['대분류'], b['중분류'], b['개인분류']].filter(Boolean).join(' > ')], ['별점', b['별점'] ? '★'.repeat(Number(b['별점'])) : ''], ['한줄평', b['한줄평']]].filter(x => x[1]);
    const body = `# ${b['제목']}\n\n${meta.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## 필사 (${sn.length})\n\n` +
      sn.map(s => `### ${s['제목'] || '(제목 없음)'}${s['쪽수'] !== '' && s['쪽수'] != null ? ` · p.${s['쪽수']}` : ''}\n\n${s['유형'] === '인용' ? sText(s).split('\n').map(l => '> ' + l).join('\n') + (sMemo(s) ? '\n\n메모: ' + sMemo(s) : '') : s['내용']}\n${s['키워드'] ? '\n' + splitKw(s['키워드']).map(k => '#' + k.replace(/\s/g, '_')).join(' ') + '\n' : ''}`).join('\n');
    files.push({ name: uniqName(`책/${safeName(b['제목'])}.md`), text: body });
  });
  S.notes.forEach(n => files.push({ name: uniqName(`노트/${safeName(n['제목'])}.md`), text: `---\n상태: ${n['상태']}\n묶음: ${n['묶음'] || ''}\n키워드: ${n['키워드'] || ''}\n작성일: ${n['작성일'] || ''}\n수정일: ${n['수정일'] || ''}\n발행링크: ${n['발행링크'] || ''}\n---\n\n# ${n['제목'] || ''}\n\n${n['본문']}\n` }));
  const todos = S.memos.filter(m => m['종류'] === '할일'), memos = S.memos.filter(m => m['종류'] !== '할일');
  files.push({ name: '메모.md', text: `# 메모\n\n${memos.map(m => `- (${m['작성일'] || ''}) ${String(m['내용']).replace(/\n/g, ' ')}`).join('\n')}\n\n# 할 일\n\n${todos.map(m => `- [${isDone(m) ? 'x' : ' '}] ${m['내용']}${m['마감일'] ? ` (마감 ${String(m['마감일']).slice(0, 10)}${m['마감시간'] ? ' ' + m['마감시간'] : ''})` : ''}`).join('\n')}\n` });
  const blob = makeZip(files);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `나의서재_백업_${S.today}.zip`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`책 ${S.books.length} · 글 ${S.notes.length} · 메모 파일로 내보냈어요`);
}

/* ===================================================================
   앱 잠금 (이 기기에서만, 비밀번호 4~8자리 숫자)
   =================================================================== */
async function pinHash(p) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('my-library:' + p));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function openLockSettings() {
  const on = !!LS.get('pin_hash');
  modal(`<h3>앱 잠금</h3>
    <div class="small" style="line-height:1.6;margin-bottom:8px">앱을 열 때와, 1분 넘게 다른 앱을 쓰다 돌아올 때 비밀번호를 물어요. 이 기기에만 적용돼요.</div>
    ${on ? `<div class="actions"><button class="btn danger" onclick="pinOff()">잠금 끄기</button><button class="btn grow" onclick="pinSetup()">비밀번호 바꾸기</button></div>`
      : `<div class="actions"><button class="btn primary grow" onclick="pinSetup()">잠금 켜기</button></div>`}
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
function pinSetup() {
  modal(`<h3>새 비밀번호</h3><div class="small">숫자 4~8자리</div>
    <input class="field pin-in" id="pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="비밀번호">
    <input class="field pin-in" id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="한 번 더" style="margin-top:8px">
    <div class="small" style="margin-top:8px;color:var(--faint)">잊어버리면 이 기기의 저장 데이터를 지우고 서버 연결 키를 다시 넣어야 해요. 시트의 기록은 그대로예요.</div>
    <div class="actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary grow" onclick="pinSave()">저장</button></div>`);
  setTimeout(() => ($('pin1') && $('pin1').focus()), 50);
}
async function pinSave() {
  const a = $('pin1').value, b = $('pin2').value;
  if (!/^\d{4,8}$/.test(a)) { toast('숫자 4~8자리로 정해 주세요'); return; }
  if (a !== b) { toast('두 번 넣은 비밀번호가 달라요'); return; }
  LS.set('pin_hash', await pinHash(a)); closeModal(); toast('잠금을 켰어요'); if (S.view === 'more') renderMoreView(); else if (S.view === 'settings') renderSettingsView();
}
function pinOff() { LS.del('pin_hash'); closeModal(); toast('잠금을 껐어요'); if (S.view === 'more') renderMoreView(); else if (S.view === 'settings') renderSettingsView(); }
let lockedAt = 0, hiddenAt = 0;
function showLock() {
  if (!LS.get('pin_hash') || $('lock').innerHTML) return;
  lockedAt = Date.now();
  $('lock').innerHTML = `<div class="lock"><div class="lock-box"><div class="lock-ic">🔒</div><b>나의 서재</b>
    <input class="field pin-in" id="pin-try" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="비밀번호">
    <div class="small" id="pin-msg" style="min-height:1.4em;margin-top:6px"></div>
    <button class="btn primary" style="width:100%" onclick="tryPin()">열기</button>
    <button class="iconbtn" style="margin-top:14px;font-size:12.5px" onclick="forgotPin()">비밀번호를 잊었어요</button></div></div>`;
  const i = $('pin-try'); i.oninput = () => { if (i.value.length >= 4) tryPin(true); }; i.onkeydown = e => { if (e.key === 'Enter') tryPin(); };
  setTimeout(() => i.focus(), 50);
}
async function tryPin(quiet) {
  const v = $('pin-try').value;
  if (await pinHash(v) === LS.get('pin_hash')) { $('lock').innerHTML = ''; return; }
  if (!quiet || v.length >= 8) { $('pin-msg').textContent = '비밀번호가 달라요'; $('pin-try').value = ''; }
}
function forgotPin() {
  if (!confirm('이 기기의 저장 데이터와 연결 정보를 지우고 잠금을 풀까요?\n시트의 기록은 그대로이고, 서버 연결 키를 다시 넣으면 돼요.')) return;
  LS.del('pin_hash'); LS.del('api_url'); LS.del('api_key'); LS.del(OUTBOX_KEY); IDB.del(CACHE_KEY).then(() => location.reload());
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60000) showLock();
});

// 책 화면 아래: 이 책을 [[ ]]로 언급한 글
const _renderBook = renderBook;
renderBook = function () {
  _renderBook();
  const b = book(S.bookId); if (!b) return;
  const back = notesLinkingHere(b);
  if (back.length) $('v-book').insertAdjacentHTML('beforeend', `<div class="panel2" style="margin-top:18px"><h4>이 책을 언급한 내 글</h4>${back.map(x => `<button class="mini" onclick="openNote('${x.ID}')"><b>✍ ${esc(x['제목'] || '제목 없음')}</b><span>${esc(plainText(x['본문']).slice(0, 90))}</span></button>`).join('')}</div>`);
};

/* ===== 이벤트 · 시작 ===== */
$('nav').onclick = e => { const b = e.target.closest('[data-v]'); if (b) go(b.dataset.v); };
$('q').addEventListener('input', e => { S.q = e.target.value; S.hitLimit = 30; renderList(); });
$('filters').addEventListener('click', e => {
  const p = e.target.closest('[data-p]'); if (p) { S.plat = S.plat === p.dataset.p ? '' : p.dataset.p; renderFilters(); renderList(); return; }
  const c = e.target.closest('[data-f]'); if (!c) return; S.filter = c.dataset.f; renderFilters(); renderList(); });
$('list').addEventListener('click', e => {
  const c = e.target.closest('.book'); if (!c) return;
  const t = e.target.closest('[data-tab]');
  go('book', c.dataset.id);
  if (t) { S.bookTab = t.dataset.tab; renderBook(); setTimeout(() => { const el = $('book-tabs'); if (el) el.scrollIntoView({ block: 'start' }); }, 30); }
});
// ＋ 버튼: 지금 보고 있는 탭에 맞는 것만 (서재 → 책 추가, 노트 → 새 글, 메모 → 메모 · 할 일, 책 → 문장)
$('fab').onclick = () => {
  if (S.view === 'book' && book(S.bookId)) openSnipForm(null, S.bookTab === '생각' ? '생각' : '인용');
  else if (S.view === 'library') openBookForm(null);
  else if (S.view === 'notes') newNote();
  else if (S.view === 'memo') openMemoAdd();
  else openQuickMenu();
};
// 맨 위로: 아래로 많이 내려가면 나타나요
(() => {
  const up = document.createElement('button'); up.id = 'totop'; up.className = 'totop'; up.setAttribute('aria-label', '맨 위로'); up.textContent = '↑';
  up.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.appendChild(up);
  let tick = false;
  window.addEventListener('scroll', () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false; up.classList.toggle('on', window.scrollY > 700 && !['ai', 'note', 'graph'].includes(S.view)); }); }, { passive: true });
})();
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

applyMode();
boot();
