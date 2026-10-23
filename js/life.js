/* 나의 서재 — 인생 문장 (v2.13)
 * 필사마다 '인생' 칸에 1 · 2 · 3 단계: 1 마음에 드는 문장 · 2 인생 문장 · 3 찐 인생 문장
 * + 책마다 '필사 모두 보여주기' (책 '필사공개' 칸, 하나씩 고르기도 그대로) */

const LIFE = { 1: '마음에 드는 문장', 2: '인생 문장', 3: '찐 인생 문장' };
const LIFE_S = { 1: '마음에 드는', 2: '인생', 3: '찐 인생' };
const lifeOf = s => Math.max(0, Math.min(3, Number(s && s['인생']) || 0));
const lifeStars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
function lifeBadge(s) { const n = lifeOf(s); return n ? `<span class="life-b l${n}" title="${LIFE[n]}">${'★'.repeat(n)} ${LIFE[n]}</span>` : ''; }

/* ----- 필사 입력 창: 단계 고르기 ----- */
let snipLife = 0;
function lifePickHtml(s) {
  snipLife = lifeOf(s);
  return `<label>인생 문장 <span style="font-weight:400;color:var(--faint)">눌러서 단계 고르기 · 한 번 더 누르면 해제</span></label>
    <div class="life-pick" id="life-pick">${[1, 2, 3].map(n => `<button type="button" data-l="${n}" class="${snipLife >= n ? 'on' : ''}" aria-label="${LIFE[n]}">★</button>`).join('')}
      <span id="life-lb">${snipLife ? LIFE[snipLife] : '고르지 않음'}</span></div>`;
}
function bindLifePick() {
  const box = $('life-pick'); if (!box) return;
  box.onclick = e => {
    const b = e.target.closest('[data-l]'); if (!b) return;
    const n = Number(b.dataset.l); snipLife = snipLife === n ? 0 : n;
    box.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', snipLife >= Number(x.dataset.l)));
    $('life-lb').textContent = snipLife ? LIFE[snipLife] : '고르지 않음';
    if (typeof snipDraftSoon === 'function') snipDraftSoon();
  };
}

/* ----- 여러 개 고르기 → 단계 한 번에 ----- */
function snipFull(x, patch) {   // 서버에 보낼 필사 한 줄 (지금 칸 그대로 + 바꿀 것)
  return Object.assign({ ID: x.ID, '책ID': x['책ID'], '유형': x['유형'] || '인용', '내용': x['내용'], '쪽수': x['쪽수'] ?? '', '제목': x['제목'] || '', '키워드': x['키워드'] || '' },
    x['공개'] !== undefined ? { '공개': x['공개'] } : {}, x['인생'] !== undefined ? { '인생': x['인생'] } : {}, patch);
}
function bulkSnipLife(n) {
  let c = 0;
  [...S.snipSel].forEach(id => {
    const x = S.snips.find(y => y.ID === resolveId(id)); if (!x || lifeOf(x) === n) return;
    const data = snipFull(x, { '인생': n }), local = Object.assign({}, x, { '인생': n });
    upsertSnipLocal(local); queue({ fn: 'saveSnippet', data, local }); c++;
  });
  S.snipSel = new Set(); renderBook();
  toast(c ? (n ? `${c}개를 ‘${LIFE[n]}’으로 담았어요` : `${c}개를 인생 문장에서 뺐어요`) : '바뀐 게 없어요');
}
function lifeSelRowHtml(n) {
  return `<div class="row2"><span class="small" style="align-self:center">인생 문장</span>${[1, 2, 3].map(l => `<button class="btn" ${n ? '' : 'disabled'} onclick="bulkSnipLife(${l})">${'★'.repeat(l)}</button>`).join('')}<button class="btn" ${n ? '' : 'disabled'} onclick="bulkSnipLife(0)">해제</button></div>`;
}

/* ----- 인생 문장 모아 보기 ----- */
S.lifeF = 0; S.lifeLimit = 40;
function openLife() { S.lifeF = 0; S.lifeLimit = 40; go('life'); }
function renderLifeView() {
  const el = $('v-life'); if (!el) return;
  const all = S.snips.filter(s => lifeOf(s) > 0);
  const list = all.filter(s => !S.lifeF || lifeOf(s) === S.lifeF)
    .sort((a, b) => lifeOf(b) - lifeOf(a) || String((book(a['책ID']) || {})['제목'] || '').localeCompare(String((book(b['책ID']) || {})['제목'] || '')) || (firstPage(a['쪽수']) || 0) - (firstPage(b['쪽수']) || 0));
  const cnt = n => all.filter(s => lifeOf(s) === n).length;
  el.innerHTML = `<div class="topbar"><button class="iconbtn" onclick="goBack()">← 뒤로</button></div>
    <div class="view-head"><h1>인생 문장</h1><p>${all.length ? `${all.length}개 · 필사를 열어 ★을 눌러 담아요` : '필사를 열어 ‘인생 문장’ ★을 누르면 여기 모여요. 여러 개는 꾹 눌러 골라서 한 번에.'}</p></div>
    <div class="chips" id="life-f"><button class="chip ${!S.lifeF ? 'on' : ''}" data-f="0">전체 ${all.length}</button>${[3, 2, 1].map(n => `<button class="chip ${S.lifeF === n ? 'on' : ''}" data-f="${n}">${'★'.repeat(n)} ${LIFE_S[n]} ${cnt(n)}</button>`).join('')}</div>
    <div class="life-list">${list.slice(0, S.lifeLimit).map(s => { const b = book(s['책ID']) || {}, n = lifeOf(s);
      return `<div class="life-card l${n}" onclick="openSnipInBook('${s.ID}')"><div class="life-st">${'★'.repeat(n)}<span>${LIFE[n]}</span></div>
        ${s['제목'] ? `<div class="stitle">${esc(s['제목'])}</div>` : ''}<div class="txt">${esc(sText(s))}</div>
        <div class="life-src">${esc(b['제목'] || '')}${b['저자'] ? ' · ' + esc(b['저자']) : ''}${s['쪽수'] !== '' && s['쪽수'] != null ? ' · p.' + esc(s['쪽수']) : ''}</div></div>`; }).join('') || '<div class="empty">아직 없어요</div>'}</div>
    ${list.length > S.lifeLimit ? `<button class="btn tg-more" onclick="S.lifeLimit+=40;renderLifeView()">더보기 (${list.length - S.lifeLimit}개 남음)</button>` : ''}`;
  $('life-f').onclick = e => { const t = e.target.closest('[data-f]'); if (!t) return; S.lifeF = Number(t.dataset.f); S.lifeLimit = 40; renderLifeView(); };
}

/* ----- 책마다 필사 보여주기 ----- */
const bookSnipShared = b => !!(b && b['필사공개']);
function snipShareTag(b) {
  if (!togetherOn()) return '';
  return `<span class="tag tap" onclick="toggleBookSnips('${b.ID}')" title="이 책의 필사 · 내 생각을 한 번에">${bookSnipShared(b) ? '👀 필사 모두 보여줌' : '✋ 필사 고른 것만'}</span>`;
}
function toggleBookSnips(id) {
  const b = book(id); if (!b) return;
  const on = !bookSnipShared(b);
  const list = snipsOf(id).filter(s => s['유형'] !== '메모' && isShared(s) !== on);
  if (!confirm(on ? `이 책의 필사 · 내 생각을 모두 보여줄까요?${list.length ? ` (${list.length}개)` : ''}\n앞으로 이 책에 쓰는 것도 처음부터 보여줘요. 하나씩 다시 숨길 수도 있어요. (메모는 항상 나만)`
    : `이 책의 필사 · 내 생각을 모두 숨길까요?${list.length ? ` (${list.length}개)` : ''}`)) return;
  patchBook(id, { '필사공개': on });
  list.forEach(x => { const data = snipFull(x, { '공개': on }), local = Object.assign({}, x, { '공개': on }); upsertSnipLocal(local); queue({ fn: 'saveSnippet', data, local }); });
  renderBook();
  toast(on ? `필사를 모두 보여줘요${!bookShared(b) ? ' · 이 책이 ‘나만 보기’라 책도 보여줘야 보여요' : ''}` : '이 책 필사를 모두 숨겼어요');
}
