/* 나의 서재 — AI 독서 비서
 * 화면 · 기능 파일은 서버를 직접 부르지 않고 Store.run(…)만 써요. 저장소를 바꿀 때는 store-*.js만 갈아 끼우면 돼요. */

/* ===================================================================
   7단계: AI 독서 비서
   =================================================================== */
S.chat = [];
const AI_SUGGEST = [
  '올해 내 독서를 한눈에 요약해줘',
  '내 필사에서 ‘자유’에 대한 문장을 찾아줘',
  '에리히 프롬 책들에서 공통으로 다루는 주제를 정리해줘',
  '내 기록을 보고 다음에 읽을 책을 추천해줘'
];
function renderAIView() {
  const emptyKw = S.snips.filter(s => !String(s['키워드'] || '').trim()).length;
  $('v-ai').innerHTML = `
    <div class="view-head ai-head"><div><h1>AI 비서</h1><p>내 서재와 필사 노트를 찾아보고 답해요. 근거가 된 필사는 번호로 표시해요.</p></div>
      ${S.chat.length ? `<button class="btn" onclick="S.chat=[];renderAIView()">새 대화</button>` : ''}</div>
    ${emptyKw ? `<div class="tool"><span>키워드가 빈 필사 <b>${emptyKw.toLocaleString()}</b>개</span>
      <button class="btn primary" id="kw-all" onclick="runAutoKeywords()">AI로 키워드 달기</button></div>` : ''}
    <div class="chat" id="chat">${S.chat.length ? S.chat.map(chatHtml).join('') :
      `<div class="suggest-q">${AI_SUGGEST.map(q => `<button onclick="askAI(this.textContent)">${esc(q)}</button>`).join('')}</div>`}</div>`;
  scrollChat();
}
function chatHtml(m) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  if (m.pending) return `<div class="msg bot"><span class="thinking">내 기록을 찾아보는 중</span></div>`;
  if (m.error) return `<div class="msg bot err">${esc(m.error)}</div>`;
  const order = (m.cites || []).map(c => c.id);
  const body = mdLite(m.text).replace(/\[([SNM][A-Za-z0-9]{5,24})\]/g, (all, id) => {
    const i = order.indexOf(id);
    return i < 0 ? '' : `<span class="cite" onclick="openCite('${id}')">${i + 1}</span>`;
  });
  return `<div class="msg bot">${body}
    ${order.length ? `<div class="sources">${m.cites.map((c, i) => `<button onclick="openCite('${c.id}')"><b>${i + 1}</b>${esc(c.book)}${c.page !== '' && c.page != null ? ' · p.' + esc(c.page) : ''}${c.title ? ' · ' + esc(c.title) : ''}</button>`).join('')}</div>` : ''}</div>`;
}
function mdLite(t) {
  const lines = esc(String(t || '')).split('\n');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  lines.forEach(l => {
    const ul = l.match(/^\s*[-*•]\s+(.*)$/), ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list !== tag) { close(); html += `<${tag}>`; list = tag; }
      html += `<li>${(ul || ol)[1]}</li>`;
    } else if (!l.trim()) close();
    else { close(); html += `<p>${l.replace(/^#+\s*/, '')}</p>`; }
  });
  close();
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
function scrollChat() { if (S.view === 'ai' && S.chat.length) setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30); }
function openCite(id) {
  if (id[0] === 'N') { if (noteOf(id)) openNote(id); else toast('그 글을 찾지 못했어요'); return; }
  if (id[0] === 'M') { if (S.memos.some(m => m.ID === id)) { go('memo'); setTimeout(() => openMemo(id), 60); } return; }
  if (S.snips.some(x => x.ID === id)) openSnipInBook(id);
}

async function askAI(q) {
  q = String(q || $('ai-q').value).trim();
  if (!q || S.chat.some(m => m.pending)) return;
  $('ai-q').value = ''; autoGrow($('ai-q'));
  const history = S.chat.filter(m => !m.pending && !m.error).map(m => ({ role: m.role, text: m.text }));
  S.chat.push({ role: 'user', text: q });
  const bot = { role: 'assistant', pending: true };
  S.chat.push(bot);
  renderAIView();
  try {
    const r = await Store.run('askAssistant', q, history);
    Object.assign(bot, { pending: false, text: r.answer, cites: r.cites });
  } catch (e) {
    Object.assign(bot, { pending: false, error: '답을 받지 못했어요: ' + (e.message || e) });
  }
  if (S.view === 'ai') renderAIView();
}
function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(140, el.scrollHeight) + 'px'; }

async function runAutoKeywords() {
  const b = $('kw-all'); if (b) { b.disabled = true; b.textContent = '키워드 다는 중… (몇 분 걸려요)'; }
  try {
    const r = await call('autoKeywords');
    await refresh(true);
    toast(r.message);
    if (S.view === 'ai') renderAIView();
  } catch (e) { if (b) { b.disabled = false; b.textContent = 'AI로 키워드 달기'; } }
}

// 문장 입력 창: AI 키워드 추천
async function aiKeywords(btn) {
  const text = $('f-txt').value.trim();
  if (!text) { toast('내용을 먼저 입력해 주세요'); return; }
  btn.disabled = true; btn.textContent = '추천 중…';
  try {
    const ks = await call('suggestKeywords', { '책ID': S.bookId, '제목': $('f-ttl').value, '내용': text });
    const cur = $('f-kw').value.split(',').map(x => x.trim()).filter(Boolean);
    ks.forEach(k => { if (!cur.includes(k)) cur.push(k); });
    $('f-kw').value = cur.join(', ');
    if (!ks.length) toast('추천할 키워드를 찾지 못했어요');
  } finally { btn.disabled = false; btn.textContent = 'AI 추천'; }
}

