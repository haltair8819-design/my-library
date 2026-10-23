/* 나의 서재 — 사진 필사 · 공유 받기 · 업데이트 내역 · 디자인
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   사진으로 필사 (카메라 · 전자책 캡처 · 하이라이트 자동 인식)
   =================================================================== */
S.scan = null;
LONG_FNS.scanPage = 1;

function openScan() {
  if (!navigator.onLine) { toast('사진 읽기는 인터넷이 연결되어 있을 때 돼요'); return; }
  const b = book(S.bookId);
  modal(`<h3>사진으로 필사 <span style="font-weight:400;color:var(--faint);font-size:13px">${esc(b['제목'])}</span></h3>
    <div class="small" style="line-height:1.6;margin-bottom:12px">형광펜이나 밑줄, 전자책 하이라이트가 있으면 그 부분만 옮겨요. 없으면 본문 전체를 옮겨요. 제목과 쪽수도 자동으로 붙여요.</div>
    <div class="scan-pick">
      <label class="btn primary grow">📷 카메라로 찍기<input type="file" accept="image/*" capture="environment" onchange="scanFiles(this.files)" hidden></label>
      <label class="btn grow">🖼 사진 · 캡처 고르기<input type="file" accept="image/*" multiple onchange="scanFiles(this.files)" hidden></label>
    </div>
    <div class="small" style="margin-top:10px;color:var(--faint)">여러 장을 한 번에 고를 수 있어요. 사진은 저장하지 않고 글자만 읽어요.</div>
    <div class="actions"><button class="btn" onclick="closeModal()">닫기</button></div>`);
}

// 사진을 적당한 크기의 JPEG로 줄이기 (글자는 또렷하게, 전송은 가볍게)
async function shrinkImage(file, max = 2400) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('사진을 열지 못했어요')); i.src = URL.createObjectURL(file); });
  }
  const w = img.width, h = img.height;
  const draw = (m, q) => {
    const s = Math.min(1, m / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  };
  const big = draw(max, 0.85);
  return { data: big.slice(big.indexOf(',') + 1), thumb: draw(360, 0.7) };
}

async function scanFiles(files, append) {
  files = [...(files || [])].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
  if (!files.length) return;
  const bookId = S.bookId;
  const fresh = files.map(f => ({ name: f.name, status: 'wait', thumb: '', mode: 'page', hl: [], full: null, error: '' }));
  if (append && S.scan && S.scan.bookId === bookId) S.scan.pages.push(...fresh);
  else S.scan = { bookId, pages: fresh };
  const mine = S.scan;
  renderScan();
  for (let i = 0; i < files.length; i++) {
    const pg = fresh[i]; if (S.scan !== mine) return;
    pg.status = 'reading'; renderScan();
    try {
      const img = await shrinkImage(files[i]);
      pg.thumb = img.thumb; renderScan();
      const r = await Store.run('scanPage', { image: img.data, mime: 'image/jpeg', bookId });
      if (S.scan !== mine) return;   // 도중에 닫음
      const mk = it => ({ on: true, title: it.title || '', text: it.text || '', page: it.page || '', kw: (it.keywords || []).join(', ') });
      pg.hl = (r.highlights || []).map(mk);
      pg.full = r.page && r.page.text ? mk(r.page) : null;
      pg.kind = r.kind || '';
      pg.mode = pg.hl.length ? 'hl' : 'page';
      pg.status = 'done';
    } catch (e) {
      pg.status = 'error'; pg.error = e.message || String(e);
    }
    renderScan();
  }
}

function scanChunks(pg) { return pg.mode === 'hl' ? pg.hl : (pg.full ? [pg.full] : []); }

function renderScan() {
  if (!S.scan) return;
  const pages = S.scan.pages;
  const busy = pages.some(p => p.status === 'wait' || p.status === 'reading');
  const count = pages.reduce((n, p) => n + (p.status === 'done' ? scanChunks(p).filter(c => c.on && c.text.trim()).length : 0), 0);
  const sh = document.querySelector('#modal .sheet'); const top = sh ? sh.scrollTop : 0;
  const keep = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f
    ? { id: document.activeElement.id, pos: document.activeElement.selectionStart } : null;
  const body = pages.map((p, pi) => {
    const head = `<div class="scan-head">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<div class="scan-ph"></div>'}
      <div><b>${pages.length > 1 ? (pi + 1) + '번째 사진' : '사진'}</b>${p.kind ? ` <span class="small">${esc(p.kind)}</span>` : ''}<br>
      <span class="small">${p.status === 'wait' ? '기다리는 중' : p.status === 'reading' ? '<span class="spin"></span> 글자 읽는 중… (10~30초)' :
        p.status === 'error' ? '⚠ ' + esc(p.error) : p.hl.length ? `하이라이트 ${p.hl.length}곳을 찾았어요` : '하이라이트가 없어 본문 전체를 옮겼어요'}</span></div></div>`;
    if (p.status !== 'done') return `<div class="scan-page">${head}</div>`;
    const seg = p.hl.length && p.full ? `<div class="seg scan-seg">
      <button class="${p.mode === 'hl' ? 'on' : ''}" onclick="scanMode(${pi},'hl')">하이라이트만 (${p.hl.length})</button>
      <button class="${p.mode === 'page' ? 'on' : ''}" onclick="scanMode(${pi},'page')">페이지 전체</button></div>` : '';
    const list = scanChunks(p).map((c, ci) => `<div class="scan-chunk ${c.on ? '' : 'off'}">
      <label class="scan-on"><input type="checkbox" ${c.on ? 'checked' : ''} onchange="scanSet(${pi},${ci},'on',this.checked)"> 저장</label>
      <input class="field scan-title" id="sc-${pi}-${ci}-t" data-f="1" value="${esc(c.title)}" placeholder="제목" oninput="scanSet(${pi},${ci},'title',this.value)">
      <textarea class="field" id="sc-${pi}-${ci}-x" data-f="1" rows="5" oninput="scanSet(${pi},${ci},'text',this.value)">${esc(c.text)}</textarea>
      <div class="scan-row"><input class="field" id="sc-${pi}-${ci}-p" data-f="1" inputmode="decimal" placeholder="쪽수 (없으면 비움)" value="${esc(c.page)}" oninput="scanSet(${pi},${ci},'page',this.value)">
        <input class="field" id="sc-${pi}-${ci}-k" data-f="1" placeholder="키워드" value="${esc(c.kw)}" oninput="scanSet(${pi},${ci},'kw',this.value)"></div>
    </div>`).join('');
    return `<div class="scan-page">${head}${seg}${list}</div>`;
  }).join('');
  modal(`<h3>사진으로 필사 <span style="font-weight:400;color:var(--faint);font-size:13px">${esc((book(S.scan.bookId) || {})['제목'] || '')}</span></h3>
    <div class="small" style="margin-bottom:8px">AI가 읽은 내용이에요. 틀린 글자가 있으면 고친 뒤 저장하세요.</div>
    ${body}
    <div class="actions"><button class="btn" onclick="closeScan()">${busy ? '그만두기' : '취소'}</button>
      ${busy ? '' : `<label class="btn">+ 사진 더<input type="file" accept="image/*" multiple onchange="scanMore(this.files)" hidden></label>`}
      <button class="btn primary grow" ${count && !busy ? '' : 'disabled'} onclick="saveScan()">${busy ? '읽는 중…' : `${count}개 저장`}</button></div>`);
  const bd = document.querySelector('#modal .backdrop'); if (bd) bd.onclick = null;
  const sh2 = document.querySelector('#modal .sheet'); if (sh2) sh2.scrollTop = top;   // 바깥을 눌러도 닫히지 않게
  if (keep && $(keep.id)) { const el = $(keep.id); el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch (e) {} }
}
function scanSet(pi, ci, k, v) {
  const c = scanChunks(S.scan.pages[pi])[ci]; c[k] = v;
  if (k === 'on') renderScan();
  else { const b = document.querySelector('.sheet .btn.primary'); const n = S.scan.pages.reduce((n, p) => n + (p.status === 'done' ? scanChunks(p).filter(c => c.on && c.text.trim()).length : 0), 0); if (b && !b.textContent.includes('읽는')) { b.textContent = n + '개 저장'; b.disabled = !n; } }
}
function scanMode(pi, m) { S.scan.pages[pi].mode = m; renderScan(); }
function closeScan() {
  const n = S.scan ? S.scan.pages.filter(p => p.status === 'done').length : 0;
  if (n && !confirm('읽어 온 내용을 저장하지 않고 닫을까요?')) return;
  S.scan = null; closeModal();
}
function scanMore(files) { scanFiles(files, true); }
function saveScan() {
  const sc = S.scan; if (!sc) return;
  const b = book(sc.bookId); let n = 0;
  sc.pages.forEach(p => {
    if (p.status !== 'done') return;
    scanChunks(p).forEach(c => {
      if (!c.on || !c.text.trim()) return;
      const data = { ID: 'T' + uid(), '책ID': sc.bookId, '유형': '인용', '내용': c.text.trim(), '쪽수': String(c.page || '').trim().replace(/\s*p$/i, ''),
        '제목': c.title.trim(), '키워드': normKw(c.kw), '출처': 'OCR' };
      const local = Object.assign({ '작성일': S.today }, data, { '책제목': b ? b['제목'] : '' });
      upsertSnipLocal(local); queue({ fn: 'saveSnippet', data, local }); n++;
    });
  });
  S.scan = null; closeModal();
  if (S.view === 'book' && S.bookId === sc.bookId) renderBook();
  toast(`${n}개를 필사했어요`);
}


/* ===================================================================
   공유로 받기 · AI 제목 · 업데이트 내역 · 디자인 고르기
   =================================================================== */
function toastAction(msg, fn, ms = 8000) {
  const t = $('toast'); t.innerHTML = msg; t.classList.add('show'); t.style.pointerEvents = 'auto';
  clearTimeout(t._h);
  t.onclick = () => { t.classList.remove('show'); t.style.pointerEvents = ''; t.onclick = null; fn(); };
  t._h = setTimeout(() => { t.classList.remove('show'); t.style.pointerEvents = ''; t.onclick = null; }, ms);
}

/* ----- 공유로 받기 ----- */
// 갤럭시 텍스트 추출 · 메모 앱에서 온 글: 화면 줄바꿈은 잇고, 문단은 살리고, 끝의 "36p"는 쪽수로
function cleanShared(meta) {
  let t = String(meta.text || '').replace(/\r/g, '');
  if (!t.trim()) t = [meta.title, meta.url].filter(Boolean).join('\n');
  let page = '';
  const m = t.match(/\n?\s*(\d{1,4}(?:\s*[,~\-]\s*\d{1,4})?)\s*p\.?\s*$/i);
  if (m) { page = m[1].replace(/\s*[~\-]\s*/, ', ').replace(/\s*,\s*/, ', '); t = t.slice(0, m.index); }
  const raw = t.trim();
  t = t.split(/\n\s*\n/).map(par => par.split('\n').map(x => x.trim()).filter(Boolean)
    .reduce((a, l) => !a ? l : /[A-Za-z]-$/.test(a) ? a.slice(0, -1) + l : a + ' ' + l, '')).filter(Boolean).join('\n\n');
  return { text: t.trim(), page, raw: /\n/.test(raw) ? raw : '' };
}
async function takeShared() {
  if (new URLSearchParams(location.search).get('share') !== '1') return;
  history.replaceState({ view: S.view, id: S.bookId || '' }, '', location.pathname);
  let meta = null; const files = [];
  try {
    const c = await caches.open('share');
    const r = await c.match(new URL('./_share/meta', location.href).href);
    if (r) {
      meta = await r.json();
      for (let i = 0; i < (meta.n || 0); i++) {
        const x = await c.match(new URL('./_share/img/' + i, location.href).href);
        if (x) { const bl = await x.blob(); files.push(new File([bl], decodeURIComponent(x.headers.get('X-Name') || 'image.jpg'), { type: bl.type || 'image/jpeg' })); }
      }
    }
    await caches.delete('share');
  } catch (e) {}
  if (!meta || (!files.length && !String(meta.text || meta.title || meta.url || '').trim())) { toast('공유받은 내용이 없어요'); return; }
  S.shared = Object.assign(cleanShared(meta), { files });
  openSharePicker('');
}
function openSharePicker(q) {
  const sh = S.shared; if (!sh) return;
  const list = pickBooks(q);
  const items = l => l.map(b => `<button class="al-item" onclick="useShared('${b.ID}')">${spine(b)}<div><b>${esc(b['제목'])}</b><span>${esc(b['저자'] || '')}${b['상태'] === '읽는중' ? ' · 읽는 중' : ''}</span></div></button>`).join('') || '<div class="al-msg">찾는 책이 없어요. 먼저 책을 추가해 주세요.</div>';
  const what = sh.files.length ? `사진 ${sh.files.length}장` : `글 ${sh.text.length.toLocaleString()}자`;
  modal(`<h3>어느 책에 넣을까요? <span style="font-weight:400;color:var(--faint);font-size:13px">공유받은 ${what}</span></h3>
    ${sh.text && !sh.files.length ? `<div class="share-peek">${esc(sh.text.slice(0, 140))}${sh.text.length > 140 ? '…' : ''}</div>` : ''}
    <input class="field" id="sp-q" type="search" placeholder="책 제목 · 저자 찾기" value="${esc(q || '')}" autocomplete="off">
    <div class="share-list" id="sp-list">${items(list)}</div>
    <div class="actions"><button class="btn" onclick="S.shared=null;closeModal()">취소</button></div>`);
  liveInput('sp-q', v => { const el = $('sp-list'); if (el) el.innerHTML = items(pickBooks(v)); });
}
function useShared(id) {
  const sh = S.shared; S.shared = null; if (!sh) return;
  closeModal(); go('book', id);
  if (sh.files.length) { scanFiles(sh.files); return; }
  openSnipForm(null);
  $('f-txt').value = sh.text; $('f-page').value = sh.page || '';
  if (navigator.onLine) { const b = document.querySelector('[data-ai-title]'); if (b) aiTitle(b, true, sh.raw); }
}

/* ----- AI 제목 ----- */
async function aiTitle(btn, auto, raw) {
  const text = $('f-txt') && $('f-txt').value.trim();
  if (!text) { toast('내용을 먼저 입력해 주세요'); return; }
  btn.disabled = true; btn.textContent = '짓는 중…';
  try {
    const r = await Store.run('suggestTitle', { '책ID': S.bookId, '내용': text, raw: raw || '' });
    if (!$('f-ttl')) return;
    // 줄바꿈 정리본: 띄어쓰기만 달라졌을 때만 바꿔 넣음 (글자는 절대 안 바뀌게)
    const noWs = x => String(x || '').replace(/\s+/g, '');
    if (raw && r.text && noWs(r.text) === noWs(raw) && $('f-txt').value.trim() === text) $('f-txt').value = r.text.trim();
    if (r.title && (!auto || !$('f-ttl').value.trim())) $('f-ttl').value = r.title;
    const kw = $('f-kw');
    if (kw && r.keywords && r.keywords.length) {
      const cur = kw.value.split(',').map(x => x.trim()).filter(Boolean);
      r.keywords.forEach(k => { if (!cur.includes(k)) cur.push(k); }); kw.value = cur.join(', ');
    }
  } catch (e) { if (!auto) toast('⚠ ' + (e.message || e)); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'AI 제목'; } }
}


/* ----- 복사한 글 붙여넣기 (갤럭시 텍스트 추출 → 복사 → 여기 붙여넣기) ----- */
function fillPasted(txt) {
  const c = cleanShared({ text: txt });
  const ta = $('f-txt'); if (!ta || !c.text) return;
  if (!ta.value.trim()) ta.value = c.text;
  else { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + c.text + ta.value.slice(b); }
  if (c.page && !$('f-page').value.trim()) $('f-page').value = c.page;
  const btn = document.querySelector('[data-ai-title]');
  if (btn && navigator.onLine && !$('f-ttl').value.trim() && ta.value.trim() === c.text) aiTitle(btn, true, c.raw);
}
function onSnipPaste(e) {
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  if (!txt || !/\n/.test(txt)) return;   // 한 줄짜리는 그대로 붙여넣기
  e.preventDefault(); fillPasted(txt);
}
async function pasteClip(btn) {
  try {
    const txt = await navigator.clipboard.readText();
    if (!txt.trim()) { toast('복사한 글이 없어요'); return; }
    fillPasted(txt);
  } catch (e) {
    ($('f-txt') && $('f-txt').focus());
    toast('내용 칸을 길게 눌러 붙여넣기 해 주세요');
  }
}

/* ----- 공유 받기 점검 ----- */
async function shareStatusHtml() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let mf = false;
  try { const r = await fetch('manifest.webmanifest', { cache: 'no-store' }); mf = !!(await r.json()).share_target; } catch (e) {}
  const ua = navigator.userAgent;
  const browser = /SamsungBrowser/.test(ua) ? '삼성 인터넷' : /Chrome/.test(ua) ? '크롬' : '기타 브라우저';
  const row = (ok, t, fix) => `<div class="chk ${ok ? 'ok' : 'no'}"><b>${ok ? '✓' : '✕'}</b><span>${t}${!ok && fix ? `<br><em>${fix}</em>` : ''}</span></div>`;
  return row(mf, '앱 설정에 공유 받기가 들어 있어요', 'GitHub에 manifest.webmanifest 파일을 다시 올려 주세요') +
    row(standalone, standalone ? '설치한 앱으로 열려 있어요' : '지금은 브라우저에서 열려 있어요', '홈 화면 아이콘으로 열어 주세요. 아이콘이 없으면 크롬 메뉴(⋮) → 앱 설치') +
    row(browser === '크롬', '브라우저: ' + browser, '공유 받기는 크롬으로 설치한 앱에서 가장 잘 돼요. 크롬에서 주소를 열고 메뉴(⋮) → 앱 설치');
}
async function openShareCheck() {
  modal(`<h3>공유 받기 점검</h3><div id="chk-box" class="small">확인하는 중…</div>
    <div class="small" style="line-height:1.7;margin-top:12px">모두 ✓인데도 공유 목록에 없으면: 홈 화면 아이콘을 지우고 → 크롬에서 앱 주소를 열고 → 메뉴(⋮) → <b>앱 설치</b>로 다시 설치한 뒤, 휴대폰을 한 번 껐다 켜 주세요.<br>
    공유 목록 맨 끝 <b>더보기</b>에 숨어 있을 수도 있어요.<br><br>
    공유 대신 쓰는 방법: 텍스트 추출에서 <b>복사</b> → 앱에서 책을 열고 <b>+ 문장 추가</b> → 내용 칸에 붙여넣기. 줄바꿈 정리와 AI 제목은 공유와 똑같이 돼요.</div>
    <div class="actions"><button class="btn primary grow" onclick="closeModal()">닫기</button></div>`);
  $('chk-box').innerHTML = await shareStatusHtml();
}

/* ----- 업데이트 내역 ----- */
const APP_VERSION = '2.12.5';   // index.html의 ?v= 값과 같이 올려요
const PATCH_NOTES = [
  { v: '2.12.5', d: '2026.10.23', t: '포인트 색 · 다시 만나는 문장', items: [
    '설정 → 디자인: 디자인 4가지는 그대로, 포인트 색(버튼 · 강조)을 10가지 중에서 고를 수 있어요. ‘처음 디자인’은 ‘숲’으로 이름을 바꿨어요',
    '서재의 ‘오늘의 문장’은 ‘다시 만나는 문장’으로 — 앱을 켤 때마다 다른 문장이 나와요 (노트는 ‘떠오르는 글감’)',
    '같이 읽을 책에 ‘나 읽기 시작’ 버튼: 내 서재에서만 읽는 중으로 바뀌어요'] },
  { v: '2.12.4', d: '2026.10.23', t: '독서 연결망', items: [
    '‘그물망’ 이름을 ‘독서 연결망’으로 바꿨어요 (아래 탭은 ‘연결망’)',
    '기간에 ‘지금 읽는 중’을 따로 두고, 읽는 중인 책은 연도 · 월에서 빼요',
    '지도 아래 목록을 짧게: 문장은 5개씩, 책 · 키워드는 몇 개만 보이고 ‘더보기’로 펼쳐요',
    '같이 읽을 책의 ‘같이 시작하기’를 뺐어요 — 읽기 시작은 각자 서재에서 하고, 목록엔 두 사람 상태가 보여요'] },
  { v: '2.12.3', d: '2026.10.23', t: '그물망 문장 목록 · 기간 보기', items: [
    '그물망: 기간을 고르면 그 기간에 읽은 책의 필사가 아래에 모두 나와요',
    '그물망: 지도 아래 색 묶음을 누르면 그 묶음 키워드가 달린 필사 목록이 나와요',
    '시작일 · 완독일이 없는 책은 기간을 고르면 빠지고, ‘전체’에서만 보여요',
    '짝꿍 · 내 서재 목록에 읽은 기간(시작 ~ 완독 · 며칠)을 함께 보여 줘요',
    '‘같이 쓰기 끝내기’ 버튼을 작은 글씨로 바꿨어요 (잘못 누르지 않게)'] },
  { v: '2.12.2', d: '2026.10.23', t: '책 정보 수정 고침', items: [
    '책 정보 수정을 하면 같은 책이 하나 더 생기던 문제를 고쳤어요 (Supabase)',
    '같이 읽을 책에 내 서재에 없던 책을 담으면 내 읽고 싶은 책에도 들어가요'] },
  { v: '2.12.1', d: '2026.10.23', t: '그물망 기간 · 둘 다 있는 책', items: [
    '그물망: 기간을 전체 · 연도 · 월로 골라 그때 읽은 책의 키워드만 볼 수 있어요',
    '함께 탭: ‘같이 읽는 책’ 대신 ‘둘 다 있는 책’ — 둘의 서재에 모두 있는 책을 전부 보여 주고(같이 읽는 중이 먼저), 두 사람 별점도 같이',
    '짝꿍 책 화면 · 내 책 화면에서 두 사람의 별점과 한줄평을 함께 봐요 (내가 아직 안 읽었으면 한줄평은 가려요)',
    '둘의 이번 달 칸에 서재 전체 권수도 보여 줘요'] },
  { v: '2.12', d: '2026.10.23', t: '프로필 · 소식 정리', items: [
    '함께 탭에서 각자 프로필(사진 · 이름 · 숫자)을 누르면 그 사람 서재 목록이 열려요',
    '프로필 사진: 설정 → 같이 쓰기 → 내 프로필에서 올려요 (나와 짝꿍만 볼 수 있어요)',
    '최근 소식은 한 달치만 보이고, ‘지난 소식 더보기’를 누르면 전체 기록이 연도별로 나와요',
    '읽고 싶은 책은 시작일 없이 담겨요 (이미 시작일이 들어가 있던 읽고 싶은 책도 한 번 정리했어요)'] },
  { v: '2.11.4', d: '2026.10.23', t: '화면 밝기 정리', items: ['화면 밝기는 밝게 · 어둡게 두 가지만 남겼어요 (휴대폰 따라는 뺐어요)'] },
  { v: '2.11.3', d: '2026.10.23', t: '화면 밝기 점검', items: ['설정 → 화면 밝기에 앱을 띄운 브라우저(크롬 · 삼성 인터넷)를 보여 줘요'] },
  { v: '2.11.2', d: '2026.10.23', t: '알림 · 다크 모드 고침', items: [
    '알림을 켰는데 ‘꺼짐’으로 보이던 문제를 고치고, 알림 칸에 상태(권한 · 기기 등록 · 서버 저장)를 보여 줘요',
    '테스트 알림이 실패하면 이유를 그대로 보여 줘요',
    '휴대폰 따라 밝기: 앱으로 돌아올 때 폰 설정을 다시 확인해요'] },
  { v: '2.11.1', d: '2026.10.23', t: '설정 한 화면으로 · 알림 스위치', items: [
    '더보기는 독서 통계 · AI 비서 · 설정만 남기고, 나머지(알림 · 같이 쓰기 · 백업 · 내보내기 · 가져오기 · 잠금 · 계정 · 업데이트 내역)는 설정 한 화면에 모았어요',
    '알림: ‘이 기기에서 알림 받기’ 스위치 — 끄면 폰 설정과 상관없이 이 기기로 알림을 안 보내요',
    '알림이 폰에서 막혀 있으면 어디서 허용하는지 안내하고, 켜다가 막힌 단계를 그대로 보여 줘요'] },
  { v: '2.11', d: '2026.10.23', t: '폰 알림 · 자동 백업 · 바코드 · 한마디 · 같이 읽을 책', items: [
    '더보기 → 폰 알림: 반납 전날 저녁 8시 · 당일 아침 8시에 알려 줘요 (기기마다 한 번 켜기)',
    '더보기 → 자동 백업: 매주 일요일 새벽 전체 기록을 서버에 파일로 남겨요 (최근 8주, 내려받기 가능)',
    '책 추가 → 📷 바코드: 책 뒤 바코드를 비추면 책 정보가 바로 채워져요',
    '짝꿍이 보여준 문장에 ♡ · 한마디, 내 문장에 달린 한마디엔 답글 (알림도 가요)',
    '함께 탭 → 같이 읽을 책: 둘이 담아 두고 ‘같이 시작하기’를 누르면 두 사람 서재에 모두 읽는 중으로'] },
  { v: '2.10.1', d: '2026.10.23', t: '＋ 버튼 정리', items: [
    '＋ 버튼이 보고 있는 탭에 맞는 것만 열어요: 서재 → 책 추가, 노트 → 새 글, 메모 → 메모 · 할 일, 책 화면 → 문장',
    '서재에서 ‘읽고 싶은’ 칸을 보며 책을 추가하면 읽고 싶은 책으로, ‘완독’ 칸이면 완독으로 바로 담겨요',
    '노트의 오늘의 글감을 누르면 그 필사가 있는 책으로 가요'] },
  { v: '2.10', d: '2026.10.22', t: '같이 쓰기 (함께 탭)', items: [
    '‘함께’ 탭: 같이 쓸 사람을 구글 이메일로 초대하고, 상대는 로그인하면 바로 수락할 수 있어요',
    '둘의 이번 달(읽은 쪽수 · 읽은 날 · 완독), 같이 읽는 책 진행률, 최근 소식을 한눈에',
    '짝꿍 서재는 보기만: 책 · 별점 · 한줄평 · 읽은 쪽수, 그리고 보여주기로 고른 필사 · 내 생각',
    '같이 읽는 책은 내가 읽은 곳 뒤 문장을 가려 줘요 (스포일러 가리기)',
    '책 화면 ‘👀 보여주는 중 / 🔒 나만 보기’로 책마다 숨기기, 문장을 꾹 눌러 골라 ‘보여주기’',
    '메모 · 노트 · 할 일은 항상 나만 봐요',
    '짝꿍 책을 ‘내 서재에 담기’로 읽고 싶은 책에 바로 넣기'] },
  { v: '2.9', d: '2026.10.22', t: 'Supabase로 저장 · 노트 파일 가져오기', items: [
    '설정 → 새 저장소에서 옮기기를 마치면 ‘Supabase로 바꾸기’로 이 기기의 저장 위치를 바꿀 수 있어요 (시트로 돌아가기도 돼요)',
    '처음 쓰는 기기는 구글 로그인만 하면 바로 시작해요',
    'AI 비서 · 사진 필사 · 음성 · 책 검색도 Supabase 서버 기능으로 옮겼어요',
    '더보기 → 노트 파일 가져오기: 삼성노트 txt를 골라 필사로 넣어요 (구글 드라이브 폴더 대신)',
    '플랫폼 바꾸기 · 자동 분류가 시트에 저장되지 않던 문제를 고쳤어요 (Supabase에서)'] },
  { v: '2.8', d: '2026.10.22', t: '새 저장소로 옮기기', items: [
    '⚙ 설정 → 새 저장소: 구글 로그인 후 지금 기록(책 · 필사 · 노트 · 메모 · 독서 기록 · 필사 순서)을 Supabase로 복사해요',
    '구글 시트는 백업으로 그대로 남고, 지금 앱은 아직 시트로 저장해요. 옮긴 뒤 개수를 맞춰 보여줘요'] },
  { v: '2.7', d: '2026.10.22', t: '함께 쓰기 준비 · 속 정리', items: [
    '겉모습과 기능은 그대로예요. 둘이 같이 쓰는 버전으로 가기 위해 앱 속을 정리했어요',
    '저장하는 부분을 한곳으로 모아, 나중에 저장소만 바꿔 끼울 수 있게 했어요',
    '앱 파일을 기능별로 나눠, 업데이트할 때 바뀐 부분만 새로 받아요'] },
  { v: '2.6', d: '2026.10.22', t: '내 생각 · 메모 칸, 맞춤법 검사', items: [
    '책 화면 칸이 ‘필사’와 ‘내 생각 · 메모’로 바뀌었어요. 예전 메모는 내 생각 · 메모 칸으로 옮겨 보여요',
    '문장 추가할 때 필사 · 내 생각 · 메모 중에서 골라요. 필사에 ＋ 메모 달기도 그대로 있어요',
    '✓ 맞춤법: 문장 입력 창과 노트 쓰기 도구에서 틀린 곳만 골라 보여주고, 하나씩 또는 모두 바꿔요'] },
  { v: '2.5.6', d: '2026.10.21', t: '예전 메모 → 필사', items: [
    '예전에 ‘메모’로 저장된 문장에 메모 표시가 붙고, 책 목록에도 메모 개수가 따로 보여요',
    '꾹 눌러 고른 뒤 ‘메모만’ 또는 ‘이 칸 모두’로 고르고 → 필사를 누르면 한 번에 필사로 바뀌어요 (전에는 메모가 안 바뀌던 문제 고침)',
    '끌어서 옮긴 뒤 손을 떼도 가끔 끝난 걸 몰라 순서가 저장되지 않던 문제를 고쳤어요'] },
  { v: '2.5.5', d: '2026.10.21', t: '꾹 눌러서 고르기 · 순서', items: [
    '문장을 꾹 누르면(컴퓨터는 마우스를 꾹) 고르기 · 순서 바꾸기가 한 번에 켜져요. 눌러서 더 고르고, ≡ 손잡이로 끌어 옮겨요. 노트 글도 꾹 누르면 골라져요',
    '순서를 바꿔도 저장이 안 되던 문제를 고쳤어요. 이 기기에 먼저 저장하고 시트에도 올려요',
    '‘쪽수 순으로 정렬’은 한 번 정렬만 하고, 그 뒤에도 계속 끌어서 바꿀 수 있어요'] },
  { v: '2.5.4', d: '2026.10.21', t: '끌어서 순서 바꾸기', items: [
    '책 화면 ↕ 순서를 누르고 오른쪽 ≡ 손잡이를 끌면 필사 · 내 생각 순서를 바꿔요. 놓는 순간 저장돼요',
    '화면 끝으로 끌면 저절로 내려가고, ‘쪽수 순으로’를 누르면 원래 순서로 돌아가요',
    '순서를 바꾼 뒤 새로 넣은 문장은 쪽수에 맞는 자리로 들어가요'] },
  { v: '2.5.3', d: '2026.10.21', t: '쪽수 순서 · 어디서든 추가', items: [
    '필사가 쪽수 순서로 정렬돼요. 새로 넣은 문장도 맨 아래가 아니라 쪽수에 맞는 자리로 들어가고, 저장하면 그 자리로 이동해 보여줘요',
    '책 화면에서 오른쪽 아래 ＋ 버튼이 따라다녀요. 목록 중간에서도 바로 문장을 추가해요 (내 생각 칸에서는 내 생각으로)',
    '많이 내려가면 ↑ 맨 위로 버튼이 나타나요'] },
  { v: '2.5.2', d: '2026.10.21', t: '필사 · 내 생각 정리', items: [
    '종류를 ‘필사’와 ‘내 생각(감상 · 독후감)’ 두 가지로 정리했어요. 서평은 내 생각으로 합쳤어요',
    '메모는 따로 쓰지 않고 필사에 ＋ 메모 달기로 덧붙여요. 단 메모만 필사 아래에 보여요',
    '책 목록과 서재 위 숫자가 필사 · 내 생각을 따로 세요. 누르면 그 책의 그 칸, 또는 전체 필사 · 전체 내 생각 모아 보기로 가요',
    '책에 들어갔다가 ← 서재로 돌아오면 보던 자리로 돌아가요'] },
  { v: '2.5.1', d: '2026.10.21', t: '문장 여러 개 고르기 · 서평', items: [
    '책 화면에서 ☑ 선택으로 문장을 여러 개 골라 필사 · 메모 · 내 생각 · 서평으로 한 번에 바꾸거나 지워요',
    '‘서평’ 종류가 생겼어요. 내 생각 · 서평 칸에서 + 서평으로 따로 쓸 수 있어요'] },
  { v: '2.5', d: '2026.10.21', t: '독서 기록 · 내 생각 · 여러 글 고르기', items: [
    '책 화면이 ‘필사 · 메모’와 ‘내 생각 · 서평’ 두 칸으로 나뉘었어요. 한줄평도 서평 칸에 함께 보여요',
    '📖 여기까지 읽었어요: 읽은 쪽수를 남기면 날짜별 기록이 쌓이고, 그날 몇 쪽 읽었는지 보여줘요. E북은 45%처럼 넣어도 돼요',
    '서재 위에 오늘 읽은 양 · 연속 기록, 통계에 최근 30일 매일 읽은 양 막대',
    '＋ 버튼과 앱 아이콘 길게 누르기에 ‘여기까지 읽었어요’ · ‘필사 쓰기’ 바로가기',
    '문장 입력 중간 저장: 창이 닫혀도 쓰던 내용이 남아 있고, ‘중간 저장’으로 창을 닫지 않고 저장해요',
    '노트에서 ☑ 선택으로 여러 글을 골라 상태 · 묶음을 한 번에 바꾸거나 지워요',
    '노트 글감이 노트 탭을 열 때마다 새로 골라져요',
    '필사 넣기 · 책 찾기 · 키워드 찾기 칸에서 한글이 자음 · 모음으로 쪼개지던 문제를 고쳤어요',
    '종이책 · E북 · 오디오북 구분: 책 목록 표시, 서재에서 골라 보기, 통계. 책 화면의 표시를 누르면 바로 바꿔요',
    '🪄 카테고리 자동 분류: 같은 저자 · 시리즈 · 제목으로 찾고, 모르면 AI가 내 분류 이름에 맞춰 골라요. 통계에서 분류 없는 책을 한꺼번에 채울 수도 있어요',
    '쓰지 않는 도서관 찾기 기능을 뺐어요 (반납일은 도서관에서 빌린 책에만 보여요)'] },
  { v: '2.4', d: '2026.10.18', t: '나만의 노트 · 음성 · 링크', items: [
    '노트 탭: 내 글을 모아 두고 써요. 상태(메모 · 초안 · 완성 · 발행), 묶음, 키워드, 발행 링크, 글자 수 · 원고지 매수',
    '쓰는 동안 자동 저장, 저장 버튼을 누를 때마다 고친 내역이 남아 되돌릴 수 있어요',
    '📚 필사 넣기: 쓰는 글과 맞는 내 필사를 찾아 출처(책 · 쪽수)와 함께 인용으로 넣어요',
    '[[책 제목]] · [[글 제목]]으로 잇고, 책 화면과 글에서 "이 글을 언급한 곳"을 보여줘요',
    '✨ AI 제안: 제목 후보 · 맞춤법 · 소개글. 내 문장은 그대로 두고 고르는 건 내가 해요',
    '글감, 블로그용 복사, PDF 저장',
    '🎤 받아쓰기 · 🎙 녹음 후 정리: 메모(할 일도 뽑아 줌) · 필사(쪽수도) · 노트에서. 인터넷이 없을 때 녹음은 보관했다가 메모로 정리',
    '필사 입력 창에 📷 사진에서 가져오기: 고칠 때도 사진으로 읽어 바꾸거나 덧붙여요',
    '서재 검색이 글과 메모까지 찾고, AI 비서도 글과 메모를 근거로 답해요',
    '더보기: 통계 · AI 비서 · 전체 내보내기(마크다운 백업) · 앱 잠금 · 설정',
    '할 일에 날짜 · 시간을 넣으면 글자가 가려지던 문제, 앨범 버튼 글자가 두 줄로 나뉘던 문제를 고쳤어요'] },
  { v: '2.3', d: '2026.10.18', t: '메모 · 할 일 · 새 그물망', items: [
    '아래 메뉴에 메모가 생겼어요. "내일 3시 치과", "- 책 반납하기"처럼 쓰면 할 일로, 그냥 쓰면 메모로 들어가요',
    '할 일은 지난 일 · 오늘 · 내일 · 이번 주 · 나중에로 나눠 보이고, 동그라미를 누르면 끝낸 일로 가요',
    '메모를 필사로 옮기거나 책과 이을 수 있어요',
    '어디서든 ＋ 버튼으로 메모 · 할 일 · 필사 · 사진 필사 · 책 추가. 앱 아이콘을 길게 눌러도 바로 열려요',
    '그물망이 주제 지도로 바뀌었어요: 함께 자주 나온 키워드끼리 잇고 비슷한 주제는 같은 색, 찾기와 "이 주제만 보기"',
    '그물망에서 문장을 누르면 그 책의 그 문장으로 바로 가요',
    '설정에서 화면 밝기를 고를 수 있어요 (휴대폰 설정대로 · 밝게 · 어둡게)',
    '통계의 완독한 책 · 분류 · 달을 누르면 책 목록이 열려요 (목록 · 앨범 보기, 정렬). 분류는 전체 보기도 돼요',
    '바뀐 것만 주고받아 동기화가 가벼워졌고, 기기 저장 공간이 넉넉해졌어요'] },
  { v: '2.2.1', d: '2026.10.17', t: '공유 받기 고침 · 붙여넣기', items: [
    '설치할 때 예전 앱 설정이 쓰여 공유 목록에 안 나오던 문제를 고쳤어요',
    '복사한 글을 내용 칸에 붙여넣으면 줄바꿈 정리 · 쪽수 · AI 제목이 공유와 똑같이 돼요',
    '설정 → 공유 받기 점검에서 무엇이 막혔는지 확인할 수 있어요'] },
  { v: '2.2', d: '2026.10.17', t: '공유로 받기 · 새 디자인', items: [
    '다른 앱에서 공유 → 나의 서재: 갤럭시 텍스트 추출로 고른 글이나 사진을 바로 필사로 보내요',
    '공유받은 글은 화면 줄바꿈을 정리하고, 끝에 적힌 "36p"는 쪽수 칸으로 옮겨요',
    '필사 입력 창에 AI 제목 버튼: 내가 붙여 온 제목 말투로 지어요',
    '디자인 3가지(원고지 · 형광펜 · 문고판)와 예전 디자인 중에서 고를 수 있어요 (⚙ 설정)',
    '업데이트 내역을 설정에서 볼 수 있어요'] },
  { v: '2.1', d: '2026.10.16', t: '사진으로 필사', items: [
    '종이책 사진 · 전자책 캡처를 찍거나 골라서 필사',
    '형광펜 · 밑줄 · 전자책 하이라이트만 골라 옮기고, 없으면 본문 전체',
    '제목은 AI가 짓고, 쪽번호가 보이면 쪽수도 자동으로 (안 보이면 비워 둠)',
    '여러 장을 한 번에, 저장 전에 고치거나 고를 수 있어요'] },
  { v: '2.0', d: '2026.10.16', t: '설치하는 앱으로', items: [
    '홈 화면에 설치하는 앱이 됐어요. 두 번째부터는 바로 열려요',
    '필사 · 쪽수 · 반납일 · 별점은 누르는 즉시 저장, 시트에는 뒤에서 올라가요',
    '인터넷이 끊겨도 쓰고, 연결되면 자동으로 올려요 (제목 옆 저장 표시)',
    '새 버전이 올라오면 알려 줘요'] },
  { v: '1.5', d: '2026.10.16', t: '10가지 새 기능', items: [
    '필사 전체 검색 (#키워드로도), 오늘의 문장',
    '도서관 반납일 D-day와 전날 메일 알림, 매주 자동 백업',
    '읽는 중 진행률과 완독 예상일, 연간 목표',
    '별점 · 한줄평, 읽고 싶은 책과 도서관 찾기',
    '키워드 이름 바꾸기 · 합치기, 연말 독서 리포트'] },
  { v: '1.4', d: '2026.10.15', t: 'AI 비서', items: [
    '내 필사 기록을 근거로 답하는 AI 비서 (구글 Gemini 무료)',
    '답마다 근거 문장을 눌러 원문으로 이동',
    '필사 1,181개에 키워드를 한 번에 채움'] },
  { v: '1.3', d: '2026.10.15', t: '키워드 그물망 · 통계', items: [
    '책 · 키워드 · 저자 · 분야를 잇는 그물망',
    '월별 · 분야별 독서 통계'] },
  { v: '1.2', d: '2026.10.15', t: '책 검색', items: [
    '제목으로 찾아 저자 · 옮긴이 · 출판사 · 쪽수 · 분류 · 표지를 자동으로'] },
  { v: '1.1', d: '2026.10.15', t: '노트 가져오기', items: [
    '삼성노트 txt를 폴더에 넣으면 자동으로 필사로',
    '<제목> 한 덩어리씩, 쪽수는 쪽수 칸으로 (36, 37처럼 여러 쪽도)'] },
  { v: '1.0', d: '2026.10.15', t: '나의 서재 시작', items: [
    '엑셀 독서 기록 61권을 옮겨 서재 · 책 상세 · 필사 입력을 만듦'] }
];
function openPatchNotes() {
  modal(`<h3>업데이트 내역 <span style="font-weight:400;color:var(--faint);font-size:13px">지금 v${APP_VERSION}</span></h3>
    <div class="notes">${PATCH_NOTES.map((n, i) => `<div class="note ${i ? '' : 'now'}">
      <div class="nh"><b>v${n.v}</b><span>${n.t}</span><em>${n.d}</em></div>
      <ul>${n.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>
    <div class="actions"><button class="btn primary grow" onclick="closeModal()">닫기</button></div>`);
}
function checkNewVersion() {
  const seen = LS.get('seen_ver');
  LS.set('seen_ver', APP_VERSION);
  if (seen && seen !== APP_VERSION) setTimeout(() => toastAction(`v${APP_VERSION}로 업데이트됐어요 · <u>바뀐 점 보기</u>`, openPatchNotes), 900);
}

/* ----- 디자인 고르기 ----- */
const THEMES = [
  { id: 'manuscript', name: '원고지', desc: '필사 노트처럼 줄 친 종이 위에 문장이 놓여요', sw: ['#F2F3EF', '#2D4F86', '#E9C8C0'] },
  { id: 'marker', name: '형광펜', desc: '하얀 바탕에 제목마다 형광펜을 그어요', sw: ['#FFFFFF', '#1B1B19', '#FFE66B'] },
  { id: 'bunko', name: '문고판', desc: '책마다 표지 색이 화면을 채워요', sw: ['#ECEEF1', '#23489A', '#B23A48'] },
  { id: 'classic', name: '숲', desc: '크림색 종이에 짙은 초록', sw: ['#F6F2EA', '#3D5A4C', '#FFFDF8'] }
];
// 포인트 색: 디자인은 그대로 두고 버튼 · 강조 색만 바꿔요 ('' = 디자인 기본색)
const ACCENTS = [['', '기본'], ['#2D4F86', '남색'], ['#3D5A4C', '초록'], ['#1F7A8C', '청록'], ['#5B4BA0', '보라'], ['#8C3B6E', '자주'], ['#B23A48', '빨강'], ['#C0661A', '주황'], ['#8C5E4A', '갈색'], ['#2A2A28', '먹색']];
function curAccent() { return LS.get('accent') || ''; }
function applyAccent() {
  const d = document.documentElement.style, c = curAccent(), dark = document.documentElement.dataset.mode === 'dark';
  if (!c) { d.removeProperty('--accent'); d.removeProperty('--accent-soft'); return; }
  d.setProperty('--accent', dark ? `color-mix(in srgb, ${c} 62%, white)` : c);
  d.setProperty('--accent-soft', dark ? `color-mix(in srgb, ${c} 30%, #15161a)` : `color-mix(in srgb, ${c} 13%, white)`);
}
function setAccent(c) { LS.set('accent', c); applyAccent(); if (S.loaded) show(S.view); }
function accentPickerHtml() {
  const cur = curAccent();
  return `<div class="acc-row">${ACCENTS.map(([c, n]) => `<button class="acc ${cur === c ? 'on' : ''}" onclick="setAccent('${c}')" title="${n}" aria-label="${n}">
    <i style="${c ? `background:${c}` : 'background:linear-gradient(135deg,#ddd 50%,#999 50%)'}"></i><span>${n}</span></button>`).join('')}</div>`;
}
function curTheme() { return document.documentElement.dataset.theme || 'manuscript'; }
function setTheme(id) {
  document.documentElement.dataset.theme = id; LS.set('theme', id);
  applyMode();
  if (S.loaded) show(S.view);
}
function themePickerHtml() {
  return `<div class="panel2" style="margin-top:0"><h4>화면 밝기</h4>${modePickerHtml()}</div>
    <div class="panel2" style="margin-top:12px"><h4>디자인</h4><div class="themes">${THEMES.map(t => `
    <button class="theme-opt ${curTheme() === t.id ? 'on' : ''}" onclick="setTheme('${t.id}');openSettings()">
      <span class="tsw">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
      <b>${t.name}</b><span>${t.desc}</span></button>`).join('')}</div>
    <h4 style="margin-top:14px">포인트 색 <span class="small" style="font-weight:400">버튼 · 강조 색만 바꿔요</span></h4>${accentPickerHtml()}</div>`;
}


