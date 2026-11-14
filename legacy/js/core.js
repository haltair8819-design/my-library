/* 나의 서재 — 기본 상태 · 도우미
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===== 상태 ===== */
const S = { books: [], snips: [], today: '', filter: '읽는중', q: '', view: 'library', bookId: null };
const FILTERS = ['읽는중', '읽을예정', '완독', '전체'];
const FILTER_LABEL = { '읽는중': '읽는 중', '읽을예정': '읽고 싶은' };


/* ===== 도우미 ===== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg) { const t = $('toast'); t.style.pointerEvents = ''; t.onclick = null; t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
const PALETTE = ['#5B7A6A','#8C5E4A','#4F6684','#8A7347','#6E5A80','#3F7378','#94604F','#5E6E45','#7A4E64','#55657A'];
const PALETTE_BUNKO = ['#2B5797','#B23A48','#2E7D5B','#C0841A','#5B4B8A','#1F7A8C','#8C3B6E','#3E4A61','#A0522D','#4F7A28'];
function spineColor(b) { const k = b['대분류'] || b['제목'] || ''; let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const P = document.documentElement.dataset.theme === 'bunko' ? PALETTE_BUNKO : PALETTE; return P[h % P.length]; }
function spine(b) {
  if (b['표지URL']) return `<div class="spine" style="background:${spineColor(b)}"><img src="${esc(b['표지URL'])}" alt=""></div>`;
  return `<div class="spine" style="background:${spineColor(b)}">${esc(String(b['제목']).slice(0, 8))}</div>`;
}
const snipsOf = id => S.snips.filter(s => s['책ID'] === id);
// 칸은 두 개: 필사(책 문장, ＋메모 달기 가능) · 내 생각 / 메모(감상 · 독후감 · 따로 쓴 메모). 예전 '서평'은 내 생각으로
const isThought = s => s['유형'] === '생각' || s['유형'] === '서평' || s['유형'] === '메모';
const KIND_LABEL = { '필사': '필사', '생각': '내 생각 · 메모' };
// 필사에 단 메모는 내용 끝에 "[메모]" 한 줄로 붙여 저장해요 (시트 칸을 늘리지 않으려고)
const MEMO_SEP = '\n\n[메모] ';
function sText(s) { const t = String((s && s['내용']) || ''); const i = t.indexOf(MEMO_SEP); return i >= 0 ? t.slice(0, i) : t; }
function sMemo(s) { const t = String((s && s['내용']) || ''); const i = t.indexOf(MEMO_SEP); return i >= 0 ? t.slice(i + MEMO_SEP.length).trim() : ''; }
// 종이책 · E북 · 오디오북 (예전 기록의 'e북', '전자책', 경로가 밀리의 서재 등이면 E북으로 봐요)
const EBOOK_RE = /e\s*북|ebook|전자책|밀리|리디|윌라|크레마|yes24\s*e|예스24\s*e|교보\s*e|킨들|kindle/i;
function platOf(b) {
  const p = String(b['플랫폼'] || '').trim();
  if (/오디오/.test(p)) return '오디오북';
  if (/종이/.test(p)) return '종이책';
  if (EBOOK_RE.test(p)) return 'E북';
  if (!p && /윌라|오디오/.test(String(b['경로'] || ''))) return '오디오북';
  if (!p && EBOOK_RE.test(String(b['경로'] || ''))) return 'E북';
  return '종이책';
}
const PLATS = ['종이책', 'E북', '오디오북'];
function togglePlat(id) {
  const b = book(id); if (!b) return;
  const next = platOf(b) === '종이책' ? 'E북' : '종이책';
  patchBook(id, { '플랫폼': next }); renderBook(); toast(next + '으로 바꿨어요');
}
const book = id => S.books.find(b => b.ID === id);
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function period(b) {
  if (!b['시작일']) return '';
  const s = b['시작일'].slice(5).replace('-', '.');
  if (!b['완독일']) return s + ' ~';
  return s + ' ~ ' + b['완독일'].slice(5).replace('-', '.');
}

