/* 나의 서재 — 삼성노트 txt 가져오기 (앱에서 파일 고르기)
 * 예전 Apps Script의 '노트 PDF 폴더 자동 가져오기'를 앱 안으로 옮긴 것.
 * <제목> 한 덩어리 = 필사 1개 (제목 · 내용 · 쪽수). 같은 책의 같은 노트를 다시 올리면 예전에 가져온 문장만 새로 바꿔요.
 * 앱에서 직접 쓴 문장은 그대로 두고, 같은 문장에 달았던 키워드는 지켜요. */

const NI_QUOTE_START = /^["'“”‘’「『]/;
const NI_PG = '(\\d{1,4}(?:\\s*[,~\\-]\\s*\\d{1,4})*)';
const NI_PAGE_ONLY = new RegExp('^\\(?\\s*(?:p\\.?\\s*' + NI_PG + '|' + NI_PG + '\\s*(?:p|P|쪽|페이지))\\s*\\)?\\.?$');
const NI_PAGE_TAIL = new RegExp('\\s*\\(?\\s*(?:p\\.?\\s*' + NI_PG + '|' + NI_PG + '\\s*(?:p|P|쪽|페이지))\\s*\\)?\\.?\\s*$');
const NI_CHAPTER = /^[<〈《]\s*(.+?)\s*[>〉》]$/;
const NI_META_SKIP = /^(?:시작일|완독일|독서\s*기간|읽은\s*기간)\s*[:：]/;
const NI_ONE_LINE = /^한\s*줄\s*평\s*[:：]\s*(.+)$/;
const NI_QUOTE_PAGE = /(["'“”‘’」』])\s*(\d{1,4})\s*\.?$/;
function niPageVal(s) { s = String(s).trim(); if (/^\d+$/.test(s)) return Number(s); return s.replace(/\s*[~\-]\s*/g, '~').replace(/\s*,\s*/g, ', '); }

// 노트 글 → [{title, type, text, page}]
function parseNoteText(text, opt) {
  opt = opt || {};
  const lines = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  const out = []; let title = '', cur = null;
  const addPage = (list, v) => String(v).split(/\s*,\s*/).forEach(x => { if (x && !list.includes(x)) list.push(x); });
  const flush = () => {
    if (!cur) return;
    const pages = [], paras = []; let para = [];
    cur.forEach(t => {
      if (!t) { if (para.length) { paras.push(para); para = []; } return; }
      let m = t.match(NI_PAGE_ONLY);
      if (m) { addPage(pages, niPageVal(m[1] || m[2])); return; }
      m = t.match(NI_PAGE_TAIL);
      if (m && t.length > m[0].length) { addPage(pages, niPageVal(m[1] || m[2])); t = t.slice(0, t.length - m[0].length).trim(); }
      else { m = t.match(NI_QUOTE_PAGE); if (m) { addPage(pages, m[2]); t = t.slice(0, t.length - m[0].length + m[1].length).trim(); } }
      if (t) para.push(t);
    });
    if (para.length) paras.push(para);
    const body = paras.map(p => p.join('\n')).join('\n\n').trim();
    cur = null;
    if (!body) return;
    pages.sort((x, y) => parseInt(x, 10) - parseInt(y, 10));
    const page = pages.length === 1 ? niPageVal(pages[0]) : pages.join(', ');
    const type = opt.essay ? '생각' : (pages.length || NI_QUOTE_START.test(body)) ? '인용' : '메모';
    out.push({ title, type, text: body.slice(0, 45000), page });
  };
  lines.forEach(raw => {
    const t = raw.trim();
    const ch = t.match(NI_CHAPTER);
    if (ch) { flush(); title = ch[1].trim(); cur = []; return; }
    if (NI_META_SKIP.test(t)) return;
    const one = t.match(NI_ONE_LINE);
    if (one) { out.push({ title: '한줄평', type: '메모', text: one[1].trim(), page: '' }); return; }
    if (!cur) { if (!t) return; cur = []; }
    cur.push(t);
  });
  flush();
  return out;
}

// 파일 이름 → 책
const niNorm = s => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
function niLongest(a, b) { let best = 0; for (let i = 0; i < a.length; i++) for (let j = i + best + 1; j <= a.length; j++) { if (b.includes(a.slice(i, j))) best = j - i; else break; } return best; }
function niFileKey(name) { return String(name).replace(/\.[^.]+$/, '').replace(/_\d{6}_\d{6}$/, '').replace(/\s+/g, ' ').trim(); }
function matchBookByFile(fileName, books) {
  const base = String(fileName).replace(/\.[^.]+$/, '').replace(/_\d{6}_\d{6}$/, '').replace(/^독서\s*노트/, '');
  const fn = niNorm(base);
  let best = null, bestScore = 0;
  books.forEach(b => {
    const full = niNorm(b['제목']); if (!full) return;
    const paren = (String(b['제목']).match(/\(([^)]*)\)/) || [])[1] || '';
    const core = niNorm(String(b['제목']).replace(/\([^)]*\)/g, '')), parenN = niNorm(paren);
    const digits = String(b['제목']).match(/\d+/g) || [];
    if (digits.some(d => !fn.includes(d))) return;
    let score = 0;
    if (fn.includes(full)) score = 100 + full.length;
    else {
      if (parenN && !fn.includes(parenN) && /편|권|판/.test(paren)) return;
      if (core.length >= 2 && fn.includes(core)) score = 50 + core.length;
      else {
        const words = String(b['제목']).replace(/\([^)]*\)/g, ' ').split(/\s+/).map(niNorm).filter(Boolean);
        const hit = words.filter(w => fn.includes(w) || (w.length > 2 && /의$/.test(w) && fn.includes(w.slice(0, -1))));
        const cover = hit.join('').length / Math.max(1, words.join('').length);
        const lcs = niLongest(core, fn);
        if (cover >= 0.75) score = hit.join('').length;
        else if (lcs >= Math.max(4, Math.ceil(core.length * 0.7))) score = lcs;
      }
    }
    if (score > bestScore) { bestScore = score; best = b; }
  });
  return bestScore >= 4 ? best : null;
}
async function decodeTextFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let enc = 'utf-8';
  if (buf[0] === 0xff && buf[1] === 0xfe) enc = 'utf-16le'; else if (buf[0] === 0xfe && buf[1] === 0xff) enc = 'utf-16be';
  return new TextDecoder(enc).decode(buf).replace(/^﻿/, '');
}

/* ----- 화면 ----- */
S.niFiles = [];
function openNoteImport() {
  S.niFiles = [];
  modal(`<h3>노트 파일 가져오기 <span style="font-weight:400;color:var(--faint);font-size:13px">삼성노트 → 텍스트(.txt)로 내보낸 파일</span></h3>
    <div class="small" style="line-height:1.7">파일 이름으로 책을 찾아요. &lt;제목&gt; 아래 글이 필사 하나가 되고, 끝의 "36, 37p"는 쪽수로 들어가요.
      같은 노트를 다시 올리면 예전에 가져온 문장만 새로 바꿔요. 앱에서 직접 쓴 문장은 그대로예요.</div>
    <label class="btn primary" style="display:block;text-align:center;margin-top:12px;cursor:pointer">txt 파일 고르기 (여러 개 가능)
      <input type="file" accept=".txt,text/plain" multiple hidden onchange="niPick(this.files)"></label>
    <div id="ni-list"></div>
    <div class="actions"><button class="btn" onclick="closeModal()">닫기</button><button class="btn primary grow hidden" id="ni-go" onclick="niApply()">가져오기</button></div>`);
}
async function niPick(files) {
  for (const f of files) {
    const text = await decodeTextFile(f);
    const items = parseNoteText(text, { essay: /감상/.test(f.name) });
    const b = matchBookByFile(f.name, S.books);
    S.niFiles.push({ name: f.name, key: niFileKey(f.name), items, bookId: b ? b.ID : '' });
  }
  niRender();
}
function niRender() {
  const el = $('ni-list'); if (!el) return;
  const opts = S.books.slice().sort((a, b) => String(a['제목']).localeCompare(String(b['제목'])));
  el.innerHTML = S.niFiles.map((f, i) => `<div class="panel2" style="margin-top:10px">
    <div style="font-size:13px;font-weight:600;word-break:break-all">${esc(f.name)}</div>
    <div class="small" style="margin:4px 0 6px">${f.items.length ? `필사 ${f.items.filter(x => x.type !== '생각').length}개 · 내 생각 ${f.items.filter(x => x.type === '생각').length}개` : '⚠ &lt;제목&gt;이나 내용을 찾지 못했어요'}</div>
    <select class="field" onchange="S.niFiles[${i}].bookId=this.value;niRender()"><option value="">${f.bookId ? '' : '⚠ '}책을 골라 주세요</option>
      ${opts.map(b => `<option value="${b.ID}" ${b.ID === f.bookId ? 'selected' : ''}>${esc(b['제목'])}</option>`).join('')}</select></div>`).join('');
  const ready = S.niFiles.some(f => f.bookId && f.items.length);
  $('ni-go').classList.toggle('hidden', !ready);
}
function niApply() {
  let add = 0, del = 0;
  S.niFiles.filter(f => f.bookId && f.items.length).forEach(f => {
    const b = book(f.bookId);
    const old = S.snips.filter(s => s['책ID'] === f.bookId && (s['출처'] === '노트파일' || s['출처'] === 'PDF') && niFileKey(s['원본파일'] || '') === f.key);
    const keepKw = {}; old.forEach(s => { if (s['키워드']) keepKw[sText(s)] = s['키워드']; });
    old.forEach(s => { S.snips = S.snips.filter(x => x.ID !== s.ID); queue({ fn: 'deleteSnippet', id: s.ID }); del++; });
    f.items.forEach(it => {
      const data = { ID: 'T' + uid(), '책ID': f.bookId, '유형': it.type, '제목': it.title || '', '내용': it.text, '쪽수': it.page === undefined ? '' : String(it.page),
        '키워드': keepKw[it.text] || '', '출처': '노트파일', '원본파일': f.key };
      const local = Object.assign({ '작성일': S.today, '책제목': (b || {})['제목'] || '' }, data);
      upsertSnipLocal(local); queue({ fn: 'saveSnippet', data, local }); add++;
    });
  });
  closeModal(); toast(`노트에서 ${add}개를 가져왔어요${del ? ` (예전에 가져온 ${del}개는 새로 바꿈)` : ''}`);
  if (S.view === 'book') renderBook(); else if (S.view === 'library') renderLibrary();
}
