/* 나의 서재 — 같이 쓰기 (4단계)
 * Supabase로 저장할 때만 써요. 짝꿍 기록은 '보여주기'로 고른 것만 서버 보안 규칙(RLS)으로 읽을 수 있어요.
 *  · 책 목록 · 별점 · 한줄평 · 독서 기록: 기본 공개 (책마다 '나만 보기'로 숨길 수 있음)
 *  · 필사 · 내 생각: 고른 것만 공개 (기록의 '공개' 칸 ↔ 표의 shared)
 *  · 메모 · 노트 · 할 일: 항상 나만
 * 짝꿍 기록은 내 기록(S.books 등)과 섞지 않고 S.tg에 따로 둬요. */

const TG_CACHE = 'tg_cache_v1';
S.tg = (() => { try { return JSON.parse(LS.get(TG_CACHE) || 'null'); } catch (e) { return null; } })() || { at: 0 };
S.tgFilter = '읽는중';
const togetherOn = () => Store.kind === 'supabase' && (S.settings || {}).together !== false;
const tgHasPartner = () => !!(S.tg && S.tg.partner);
const tgName = () => (S.tg.partner && S.tg.partner.name) || '짝꿍';
const tgMonth = () => S.today.slice(0, 7);
const tgShareNew = () => !!(S.settings || {}).shareNew;
const tgSpoilOn = () => (S.settings || {}).spoiler !== false;
// 받침에 따라 이/가, 과/와
function jo(w, a, b) { const c = String(w || '').trim().slice(-1).charCodeAt(0); return w + (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? a : b); }
const isShared = s => s && s['공개'] === true;
const bookShared = b => b && b['공개'] !== false;

/* ----- 서버에서 받기 ----- */
async function tgPull(table, cols, uidv) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await sbq(sbClient().from(table).select(cols).eq('user_id', uidv).eq('deleted', false).range(from, from + 999));
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
let tgLoading = null;
function tgLoad() {
  if (!togetherOn() || !sbUid()) return Promise.resolve(null);
  if (tgLoading) return tgLoading;
  tgLoading = (async () => {
    const me = sbUid(), email = String(((sbSession() || {}).user || {}).email || '').toLowerCase();
    const [ps, mine] = await Promise.all([
      sbq(sbClient().from('partnerships').select('id, inviter, invitee, invitee_email, inviter_name, inviter_email, status, created_at, accepted_at').neq('status', 'ended')),
      sbq(sbClient().from('profiles').select('name, email').eq('user_id', me).maybeSingle())
    ]);
    const acc = ps.find(p => p.status === 'accepted' && (p.inviter === me || p.invitee === me));
    const next = { at: Date.now(), me: { id: me, email, name: (mine && mine.name) || email.split('@')[0] },
      incoming: ps.filter(p => p.status === 'pending' && p.inviter !== me && String(p.invitee_email).toLowerCase() === email),
      sent: ps.filter(p => p.status === 'pending' && p.inviter === me), partner: null, books: [], snips: [], logs: [] };
    if (acc) {
      const pid = acc.inviter === me ? acc.invitee : acc.inviter;
      const [prof, b, s, l] = await Promise.all([
        sbq(sbClient().from('profiles').select('name, email').eq('user_id', pid).maybeSingle()),
        tgPull('books', 'id, data, updated_at', pid), tgPull('snippets', 'id, book_id, kind, data, updated_at', pid),
        tgPull('read_logs', 'id, book_id, day, page, base_page', pid)
      ]);
      const pemail = (prof && prof.email) || (acc.inviter === me ? acc.invitee_email : acc.inviter_email) || '';
      next.partner = { id: pid, pship: acc.id, since: acc.accepted_at, email: pemail,
        name: (prof && prof.name) || (acc.inviter === pid ? acc.inviter_name : '') || pemail.split('@')[0] };
      next.books = b.map(sbOut); next.snips = s.map(sbOut);
      next.logs = l.map(r => ({ id: r.id, bid: r.book_id, date: String(r.day).slice(0, 10), page: r.page, base: r.base_page }));
    }
    S.tg = next;
    try { LS.set(TG_CACHE, JSON.stringify(next)); } catch (e) {}
    return next;
  })().finally(() => { tgLoading = null; });
  return tgLoading;
}
async function tgRefresh(quiet) {
  try { await tgLoad(); } catch (e) { if (!quiet) toast('⚠ ' + (e.message || e)); return; }
  tgNav();
  if (S.view === 'together') renderTogether();
  else if (S.view === 'pbook') renderPartnerBook();
  else if (S.view === 'plib') renderPartnerLib();
  else if (S.view === 'book' && tgHasPartner()) renderBook();
  tgInvitePrompt();
}

/* ----- 같은 책 찾기 (ISBN → 제목) ----- */
const tgIsbn = b => { const d = String(b['ISBN'] || '').replace(/[^0-9Xx]/g, ''); return d.length >= 10 ? d : ''; };
const tgTitle = b => niNorm(String(b['제목'] || '').replace(/\([^)]*\)/g, ''));
function tgSame(a, b) { const ia = tgIsbn(a), ib = tgIsbn(b); if (ia && ib && ia === ib) return true; const ta = tgTitle(a); return !!ta && ta === tgTitle(b); }
const tgMine = pb => S.books.find(b => tgSame(b, pb)) || null;
const tgTheirs = b => (S.tg.books || []).find(pb => tgSame(b, pb)) || null;

/* ----- 쪽수 계산 (내 것 · 짝꿍 것 같은 방법) ----- */
function tgDaily(logs) {   // [{bid,date,page,base}] → { 날짜: 쪽수 }
  const by = {}; logs.forEach(l => (by[l.bid] = by[l.bid] || []).push(l));
  const out = {};
  Object.values(by).forEach(list => {
    let prev = null;
    list.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(l => {
      const from = prev != null ? prev : (l.base != null ? l.base : 0);
      out[l.date] = (out[l.date] || 0) + Math.max(0, l.page - from); prev = l.page;
    });
  });
  return out;
}
const myLogs = () => (S.logs || []).map(parseLog).filter(Boolean).map(l => ({ id: l.id, bid: l.bid, date: l.date, page: l.page, base: l.base }));
function tgMonthStats(books, logs) {
  const m = tgMonth(), daily = tgDaily(logs);
  const days = Object.entries(daily).filter(([d, n]) => d.startsWith(m) && n > 0);
  return { pages: days.reduce((a, [, n]) => a + n, 0), days: days.length, done: books.filter(b => String(b['완독일'] || '').startsWith(m)).length };
}
function tgProg(b) {
  const total = Number(b['분량']) || 0, cur = Number(b['현재쪽수']) || 0;
  if (b['상태'] === '완독') return { pct: 100, cur: total || cur, total };
  return { pct: total && cur ? Math.min(100, Math.round(cur / total * 100)) : 0, cur, total };
}

/* ----- 화면: 함께 탭 ----- */
function tgNav() {
  const nav = $('nav'); if (!nav) return;
  let btn = nav.querySelector('[data-v="together"]');
  if (!togetherOn()) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = document.createElement('button'); btn.dataset.v = 'together';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M14.2 14.3c.6-.2 1.2-.3 1.8-.3 2.3 0 4.2 1.5 4.8 4.5"/></svg>함께<i class="tg-dot hidden"></i>';
    nav.insertBefore(btn, nav.querySelector('[data-v="graph"]'));
  }
  const dot = btn.querySelector('.tg-dot'); if (dot) dot.classList.toggle('hidden', !(S.tg.incoming || []).length);
}
function avatar(name, cls) { return `<span class="tg-av ${cls || ''}">${esc(String(name || '?').trim().slice(0, 1))}</span>`; }

function renderTogether() {
  const el = $('v-together'); if (!el) return;
  if (!togetherOn()) { el.innerHTML = `<div class="view-head"><h1>함께</h1><p>설정에서 같이 쓰기를 켜면 보여요.</p></div>`; return; }
  const T = S.tg;
  if (!T.at) { el.innerHTML = `<div class="view-head"><h1>함께</h1></div><div class="drill"><span class="spin"></span> 불러오는 중…</div>`; tgRefresh(); return; }
  if (!T.partner) { el.innerHTML = tgInviteHtml(); return; }
  const me = T.me || {}, pn = tgName();
  const mineS = tgMonthStats(S.books, myLogs()), theirS = tgMonthStats(T.books, T.logs);
  const statCol = (name, s, cls) => `<div class="tg-col">${avatar(name, cls)}<b>${esc(name)}</b>
    <div class="tg-num"><span><b>${s.pages.toLocaleString()}</b>쪽</span><span><b>${s.days}</b>일 읽음</span><span><b>${s.done}</b>권 완독</span></div></div>`;
  // 같이 읽는 책: 둘 다 서재에 있고, 한 명이라도 읽는 중
  const both = T.books.map(pb => ({ pb, mb: tgMine(pb) })).filter(x => x.mb && (x.pb['상태'] === '읽는중' || x.mb['상태'] === '읽는중'));
  const reading = T.books.filter(b => b['상태'] === '읽는중');
  const bar = (name, b, cls) => { const p = tgProg(b); return `<div class="tg-prog ${cls}"><span>${esc(name)}</span><div class="bar"><i style="width:${p.pct}%"></i></div><em>${b['상태'] === '완독' ? '완독' : p.cur ? 'p.' + p.cur + (p.total ? ` · ${p.pct}%` : '') : b['상태'] === '읽을예정' ? '읽고 싶은' : '–'}</em></div>`; };
  el.innerHTML = `
    <div class="view-head tg-head"><div><h1>함께</h1><p>${avatar(me.name)}${avatar(pn, 'p')} ${esc(me.name)} · ${esc(pn)}</p></div>
      <button class="iconbtn" onclick="openShareSettings()">보여줄 것</button></div>
    <div class="panel2"><h4>둘의 ${Number(tgMonth().slice(5))}월</h4><div class="tg-cols">${statCol(me.name, mineS, '')}${statCol(pn, theirS, 'p')}</div></div>
    ${both.length ? `<div class="panel2"><h4>같이 읽는 책</h4>${both.map(({ pb, mb }) => `<div class="tg-both" onclick="openPartnerBook('${pb.ID}')">${spine(mb)}<div class="grow">
      <div class="tg-bt">${esc(mb['제목'])}</div>${bar(me.name, mb, '')}${bar(pn, pb, 'p')}</div></div>`).join('')}</div>` : ''}
    <div class="panel2"><h4>${esc(pn)}의 서재 <button class="kw-ai" onclick="go('plib')">전체 ${T.books.length}권 보기 →</button></h4>
      ${reading.length ? `<div class="tg-shelf">${reading.map(b => `<button onclick="openPartnerBook('${b.ID}')">${spine(b)}<span>${esc(b['제목'])}</span><em>${tgProg(b).pct ? tgProg(b).pct + '%' : '읽는 중'}</em></button>`).join('')}</div>`
        : `<div class="small">지금 읽는 중인 책이 없어요.</div>`}</div>
    <div class="panel2"><h4>최근 소식</h4>${tgFeedHtml()}</div>
    <div class="small" style="text-align:center;margin:14px 0 4px"><button class="note-link" style="display:inline" onclick="tgRefresh()">새로 불러오기</button> · ${hhmmOf(T.at)} 기준</div>`;
}
const hhmmOf = t => { const d = new Date(t); return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function tgFeed() {
  const T = S.tg, out = [], pn = tgName(), me = (T.me || {}).name || '나';
  const add = (who, date, html, onclick, p) => { if (date) out.push({ who, date: String(date).slice(0, 10), html, onclick, p }); };
  const ttl = b => `『${esc(b['제목'])}』`;
  const ttlO = b => { const t = String(b['제목'] || '').replace(/\s*\([^)]*\)\s*$/, ''); return ttl(b) + jo(t, '을', '를').slice(t.length); };
  const books = (list, who, p, open) => list.forEach(b => {
    if (b['완독일']) add(who, b['완독일'], `${ttlO(b)} 다 읽었어요${b['별점'] ? ' <span class="stars">' + '★'.repeat(Number(b['별점']) || 0) + '</span>' : ''}`, open(b), p);
    if (b['시작일'] && b['시작일'] !== b['완독일']) add(who, b['시작일'], `${ttlO(b)} 읽기 시작했어요`, open(b), p);
    else if (!b['시작일'] && b['상태'] === '읽을예정' && b['등록일']) add(who, b['등록일'], `${ttlO(b)} 읽고 싶은 책에 담았어요`, open(b), p);
  });
  books(T.books, pn, true, b => `openPartnerBook('${b.ID}')`);
  books(S.books.filter(bookShared), me, false, b => `go('book','${b.ID}')`);
  // 독서 기록: 하루 · 책마다
  const logLines = (logs, list, who, p, open) => {
    const by = {}; logs.forEach(l => (by[l.bid] = by[l.bid] || []).push(l));
    Object.entries(by).forEach(([bid, ls]) => {
      const b = list.find(x => x.ID === bid); if (!b) return;
      const d = tgDaily(ls);
      Object.entries(d).forEach(([day, n]) => { if (n > 0) add(who, day, `${ttl(b)} <b>${n}쪽</b> 읽었어요`, open(b), p); });
    });
  };
  logLines(T.logs, T.books, pn, true, b => `openPartnerBook('${b.ID}')`);
  logLines(myLogs(), S.books.filter(bookShared), me, false, b => `go('book','${b.ID}')`);
  // 보여준 필사
  T.snips.forEach(s => { const b = T.books.find(x => x.ID === s['책ID']); if (!b) return;
    add(pn, s['작성일'], `${ttl(b)}에서 ${isThought(s) ? '생각을' : '문장을'} 남겼어요`, `openPartnerBook('${b.ID}','${s.ID}')`, true); });
  S.snips.filter(isShared).forEach(s => { const b = book(s['책ID']); if (!b) return;
    add(me, s['작성일'], `${ttl(b)}에서 ${isThought(s) ? '생각을' : '문장을'} 보여줬어요`, `openSnipInBook('${s.ID}')`, false); });
  return out.sort((a, b) => b.date.localeCompare(a.date) || (b.p ? 1 : 0) - (a.p ? 1 : 0)).slice(0, 25);
}
function tgFeedHtml() {
  const f = tgFeed(); if (!f.length) return '<div class="small">아직 소식이 없어요. 책을 읽고 기록하면 여기에 보여요.</div>';
  let last = '';
  return f.map(x => { const head = x.date !== last ? `<div class="tg-day">${x.date === S.today ? '오늘' : x.date === addDays(S.today, -1) ? '어제' : x.date.slice(5).replace('-', '.')}</div>` : ''; last = x.date;
    return `${head}<div class="tg-feed" onclick="${x.onclick}">${avatar(x.who, x.p ? 'p' : '')}<div>${x.html}</div></div>`; }).join('');
}

/* ----- 짝꿍 서재 전체 ----- */
function renderPartnerLib() {
  const el = $('v-plib'); if (!el) return;
  if (!tgHasPartner()) { go('together'); return; }
  const list = S.tg.books.filter(b => S.tgFilter === '전체' || b['상태'] === S.tgFilter)
    .sort((a, b) => String(b['완독일'] || b['시작일'] || b['등록일'] || '').localeCompare(String(a['완독일'] || a['시작일'] || a['등록일'] || '')));
  el.innerHTML = `<div class="topbar"><button class="iconbtn" onclick="goBack()">← 함께</button></div>
    <div class="view-head"><h1>${esc(tgName())}의 서재</h1><p>보기만 할 수 있어요 · ${S.tg.books.length}권</p></div>
    <div class="chips" id="pl-f">${FILTERS.map(f => `<button class="chip ${S.tgFilter === f ? 'on' : ''}" data-f="${f}">${FILTER_LABEL[f] || f} ${f === '전체' ? S.tg.books.length : S.tg.books.filter(b => b['상태'] === f).length}</button>`).join('')}</div>
    <div class="list">${list.map(b => { const p = tgProg(b), mine = tgMine(b);
      return `<div class="book" onclick="openPartnerBook('${b.ID}')">${spine(b)}<div class="binfo"><div class="btitle">${esc(b['제목'])}</div>
        <div class="bauthor">${esc(b['저자'] || '')}</div>
        <div class="bmeta">${b['별점'] ? `<span class="stars">${starText(b['별점'])}</span>` : ''}${b['상태'] === '읽는중' && p.pct ? `<span class="badge">${p.pct}%</span>` : ''}${mine ? '<span class="badge plat">내 서재에도 있음</span>' : ''}</div></div></div>`; }).join('') || '<div class="empty">책이 없어요</div>'}</div>`;
  $('pl-f').onclick = e => { const t = e.target.closest('[data-f]'); if (!t) return; S.tgFilter = t.dataset.f; renderPartnerLib(); };
}

/* ----- 짝꿍 책 하나 ----- */
function openPartnerBook(id, flash) { S.pbookId = id; S.pflash = flash || ''; go('pbook'); }
function renderPartnerBook() {
  const el = $('v-pbook'); if (!el) return;
  const b = (S.tg.books || []).find(x => x.ID === S.pbookId);
  if (!b) { el.innerHTML = `<div class="topbar"><button class="iconbtn" onclick="goBack()">← 함께</button></div><div class="empty">이 책은 이제 볼 수 없어요</div>`; return; }
  const pn = tgName(), mine = tgMine(b), p = tgProg(b);
  // 스포일러 가리기: 내가 이 책을 아직 다 안 읽었으면, 내가 읽은 곳 뒤의 문장 · 생각 · 한줄평은 가려요
  const guard = tgSpoilOn() && mine && mine['상태'] !== '완독';
  const myCur = guard ? (Number(mine['현재쪽수']) || 0) : Infinity;
  const hide = s => { if (!guard) return false; const pg = firstPage(s['쪽수']); return pg != null ? pg > myCur : isThought(s); };
  const snips = sortByPage(S.tg.snips.filter(s => s['책ID'] === b.ID));
  const logs = S.tg.logs.filter(l => l.bid === b.ID), daily = tgDaily(logs);
  const days = Object.entries(daily).filter(([, n]) => n > 0).sort((x, y) => y[0].localeCompare(x[0]));
  const sHtml = s => { const memo = sMemo(s), h = hide(s);
    return `<div class="snip ${isThought(s) ? 'thought' : 'quote'} ${h ? 'spoil' : ''}" id="p-${s.ID}" ${h ? `onclick="this.classList.remove('spoil')"` : ''}>
      ${h ? `<div class="spoil-l">🙈 ${firstPage(s['쪽수']) != null ? `p.${esc(s['쪽수'])} · 아직 안 읽은 부분이에요` : '스포일러가 있을 수 있어요'} · 눌러서 보기</div>` : ''}
      ${s['제목'] ? `<div class="stitle">${esc(s['제목'])}</div>` : ''}<div class="txt">${esc(sText(s))}</div>
      ${memo ? `<div class="smemo">✎ ${esc(memo)}</div>` : ''}
      ${s['쪽수'] !== '' && s['쪽수'] != null ? `<div class="smeta"><span class="pg">p.${esc(s['쪽수'])}</span></div>` : ''}</div>`; };
  const spoilReview = guard && b['한줄평'];
  el.innerHTML = `<div class="topbar"><button class="iconbtn" onclick="goBack()">← 뒤로</button>
      ${mine ? `<button class="iconbtn" onclick="go('book','${mine.ID}')">내 기록 보기</button>` : `<button class="iconbtn" onclick="tgCopyBook('${b.ID}')">＋ 내 서재에 담기</button>`}</div>
    <div class="detail-head">${spine(b)}<div><div class="dtitle">${esc(b['제목'])}</div>
      <div class="dauthor">${esc(b['저자'] || '')}${b['출판사'] ? ' · ' + esc(b['출판사']) : ''}</div>
      <div class="tags"><span class="tag">${avatar(pn, 'p')} ${esc(pn)}의 책</span>${[b['대분류'], b['중분류']].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div></div>
    <div class="panel2"><h4>${b['상태'] === '완독' ? '다 읽었어요' : b['상태'] === '읽는중' ? '읽는 중' : '읽고 싶은 책'}</h4>
      ${b['상태'] !== '읽을예정' ? `<div class="tg-prog p"><span>${esc(pn)}</span><div class="bar"><i style="width:${p.pct}%"></i></div><em>${b['상태'] === '완독' ? esc(String(b['완독일'] || '').slice(5).replace('-', '.')) + ' 완독' : p.cur ? 'p.' + p.cur + (p.total ? ' / ' + p.total : '') : '–'}</em></div>` : ''}
      ${mine && b['상태'] !== '읽을예정' ? (() => { const q = tgProg(mine); return `<div class="tg-prog"><span>나</span><div class="bar"><i style="width:${q.pct}%"></i></div><em>${mine['상태'] === '완독' ? '완독' : q.cur ? 'p.' + q.cur : mine['상태'] === '읽을예정' ? '읽고 싶은' : '–'}</em></div>`; })() : ''}
      ${b['시작일'] ? `<div class="small" style="margin-top:6px">${esc(period(b))}${b['완독일수'] ? ` · ${esc(b['완독일수'])}일` : ''}</div>` : ''}
      ${days.length ? `<div class="small" style="margin-top:6px">최근: ${days.slice(0, 5).map(([d, n]) => `${d.slice(5).replace('-', '.')} ${n}쪽`).join(' · ')}</div>` : ''}</div>
    ${b['별점'] || b['한줄평'] ? `<div class="panel2"><h4>별점 · 한줄평</h4>${b['별점'] ? `<span class="stars">${starText(b['별점'])}</span>` : ''}
      ${b['한줄평'] ? `<div class="${spoilReview ? 'spoil' : ''}" style="margin-top:4px" ${spoilReview ? `onclick="this.classList.remove('spoil')"` : ''}>${spoilReview ? '<div class="spoil-l">🙈 다 읽고 보면 좋아요 · 눌러서 보기</div>' : ''}<div>${esc(b['한줄평'])}</div></div>` : ''}</div>` : ''}
    <div class="sec-head tight"><h2>${esc(jo(pn, '이', '가'))} 보여준 문장 <span class="small" style="font-weight:400">${snips.length}개</span></h2></div>
    ${guard && snips.some(hide) ? `<div class="sec-sub">내가 읽은 p.${myCur || 0} 뒤는 가려 뒀어요</div>` : ''}
    <div>${snips.map(sHtml).join('') || `<div class="empty">아직 보여준 문장이 없어요</div>`}</div>`;
  if (S.pflash) { const id = S.pflash; S.pflash = ''; setTimeout(() => { const x = document.getElementById('p-' + id); if (x) { x.scrollIntoView({ block: 'center' }); x.classList.add('flash'); } }, 80); }
}
async function tgCopyBook(id) {
  const b = (S.tg.books || []).find(x => x.ID === id); if (!b) return;
  if (tgMine(b)) { toast('이미 내 서재에 있어요'); return; }
  const data = { ID: '', '상태': '읽을예정' };
  ['제목', '저자', '옮긴이', '출판사', '대분류', '중분류', '분량', '표지URL', 'ISBN'].forEach(k => { if (b[k] !== undefined && b[k] !== '') data[k] = b[k]; });
  try { const saved = await call('saveBook', data); updateBook(saved); toast('읽고 싶은 책에 담았어요'); renderPartnerBook(); } catch (e) {}
}

/* ----- 내 책 화면: 짝꿍도 이 책이 있으면 ----- */
function tgBookHtml(b) {
  if (!togetherOn() || !tgHasPartner()) return '';
  const pb = tgTheirs(b); if (!pb) return '';
  const p = tgProg(pb), n = S.tg.snips.filter(s => s['책ID'] === pb.ID).length;
  return `<div class="panel2 tg-also" onclick="openPartnerBook('${pb.ID}')">${avatar(tgName(), 'p')}<div class="grow"><b>${esc(tgName())}</b>${pb['상태'] === '완독' ? '도 다 읽었어요' : pb['상태'] === '읽는중' ? `도 읽는 중${p.cur ? ` · p.${p.cur}${p.total ? ` (${p.pct}%)` : ''}` : ''}` : '도 읽고 싶대요'}
    ${n ? `<div class="small">보여준 문장 ${n}개 →</div>` : '<div class="small">눌러서 보기 →</div>'}</div></div>`;
}
function tgShareTag(b) {
  if (!togetherOn()) return '';
  return `<span class="tag tap" onclick="tgToggleBook('${b.ID}')" title="짝꿍에게 이 책 보여주기">${bookShared(b) ? '👀 보여주는 중' : '🔒 나만 보기'}</span>`;
}
function tgToggleBook(id) {
  const b = book(id); if (!b) return;
  const next = !bookShared(b);
  patchBook(id, { '공개': next }); renderBook();
  toast(next ? '이 책을 보여줘요 (책 · 별점 · 독서 기록)' : '이 책은 나만 봐요 · 필사도 같이 숨겨져요');
}
function bulkSnipShare(on) {
  let c = 0, skip = 0;
  [...S.snipSel].forEach(id => {
    const x = S.snips.find(y => y.ID === resolveId(id)); if (!x) return;
    if (on && x['유형'] === '메모') { skip++; return; }
    if (isShared(x) === on) return;
    const data = { ID: x.ID, '책ID': x['책ID'], '유형': x['유형'] || '인용', '내용': x['내용'], '쪽수': x['쪽수'] ?? '', '제목': x['제목'] || '', '키워드': x['키워드'] || '', '공개': on };
    const local = Object.assign({}, x, { '공개': on });
    upsertSnipLocal(local); queue({ fn: 'saveSnippet', data, local }); c++;
  });
  S.snipSel = new Set(); renderBook();
  const b = book(S.bookId);
  toast(c ? `${c}개를 ${on ? `${tgHasPartner() ? tgName() + '에게 ' : ''}보여줘요` : '나만 보게 했어요'}${skip ? ` · 메모 ${skip}개는 항상 나만 봐요` : ''}${on && b && !bookShared(b) ? ' · 이 책이 ‘나만 보기’라 아직 안 보여요' : ''}` : skip ? '메모는 항상 나만 봐요' : '바뀐 게 없어요');
}

/* ----- 초대 ----- */
function tgInviteHtml() {
  const T = S.tg, me = T.me || {};
  const inc = (T.incoming || []).map(p => `<div class="panel2 tg-inv">${avatar(p.inviter_name, 'p')}<div class="grow"><b>${esc(p.inviter_name || p.inviter_email)}</b>님이 나의 서재를 함께 쓰자고 초대했어요
      <div class="small">${esc(p.inviter_email || '')}</div>
      <div class="actions"><button class="btn" onclick="tgDecline('${p.id}')">거절</button><button class="btn primary grow" onclick="tgAccept('${p.id}')">수락하기</button></div></div></div>`).join('');
  const sent = (T.sent || [])[0];
  return `<div class="view-head"><h1>함께</h1><p>둘이 읽는 책 · 진행률 · 고른 문장을 나눠 봐요</p></div>
    ${inc}
    ${sent ? `<div class="panel2"><h4>초대를 보냈어요</h4><div class="small" style="line-height:1.7"><b>${esc(sent.invitee_email)}</b> 계정으로 초대했어요.<br>
      상대가 앱을 열고 이 구글 계정으로 로그인하면 ‘수락하기’가 보여요.</div>
      <div class="actions"><button class="btn" onclick="tgCancel('${sent.id}')">초대 취소</button><button class="btn primary grow" onclick="tgTell('${esc(sent.invitee_email)}')">카톡 등으로 알려주기</button></div></div>` : `
    <div class="panel2"><h4>같이 쓸 사람 초대하기</h4>
      <div class="small" style="line-height:1.7">상대가 로그인할 <b>구글 계정 이메일</b>을 넣어 주세요. 한 사람과만 같이 쓸 수 있어요.</div>
      <div class="inline" style="margin-top:8px"><input class="field" id="tg-email" type="email" inputmode="email" autocomplete="off" placeholder="예: someone@gmail.com" onkeydown="if(event.key==='Enter'){event.preventDefault();tgInvite()}">
        <button class="btn primary" onclick="tgInvite()">초대</button></div></div>`}
    <div class="panel2"><h4>같이 쓰면 이렇게 돼요</h4><div class="small" style="line-height:1.8">
      👀 <b>보여줘요</b>: 책 목록 · 별점 · 한줄평 · 읽은 쪽수 (책마다 ‘나만 보기’로 숨길 수 있어요)<br>
      ✋ <b>고른 것만</b>: 필사 · 내 생각 (문장을 꾹 눌러 골라서 ‘보여주기’)<br>
      🔒 <b>항상 나만</b>: 메모 · 노트 · 할 일<br>
      서로 보기만 할 수 있고, 상대 기록을 고치거나 지울 수는 없어요.</div></div>
    <div class="small" style="text-align:center;margin:10px 0">내 계정: ${esc(me.email || '')} · <button class="note-link" style="display:inline" onclick="tgRefresh()">새로 불러오기</button></div>`;
}
async function tgInvite() {
  const email = String(($('tg-email') || {}).value || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('이메일 주소를 확인해 주세요'); return; }
  try { await sbq(sbClient().from('partnerships').insert({ invitee_email: email })); toast('초대를 보냈어요'); await tgRefresh(); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
}
async function tgCancel(id) {
  if (!confirm('초대를 취소할까요?')) return;
  try { await sbq(sbClient().from('partnerships').update({ status: 'ended' }).eq('id', id)); await tgRefresh(); } catch (e) { toast('⚠ ' + (e.message || e)); }
}
async function tgAccept(id) {
  try { await sbq(sbClient().rpc('accept_invite', { invite_id: id })); closeModal(); toast('이제 함께 써요!'); await tgRefresh(); if (S.view !== 'together') go('together'); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
}
async function tgDecline(id) {
  if (!confirm('초대를 거절할까요?')) return;
  try { await sbq(sbClient().rpc('decline_invite', { invite_id: id })); closeModal(); await tgRefresh(); } catch (e) { toast('⚠ ' + (e.message || e)); }
}
async function tgTell(email) {
  const url = location.origin + location.pathname;
  const text = `나의 서재에 초대했어요 📚\n앱을 열고 ${email} 구글 계정으로 로그인하면 ‘수락하기’가 보여요.`;
  try { if (navigator.share) { await navigator.share({ title: '나의 서재 초대', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + '\n' + url); toast('초대 문구를 복사했어요. 카톡에 붙여넣어 주세요'); } catch (e) { toast(url); }
}
// 받은 초대가 있으면 한 번 물어보기 (세션마다 한 번)
function tgInvitePrompt() {
  const p = (S.tg.incoming || [])[0];
  if (!p || tgHasPartner() || S.tgAsked === p.id || $('modal').innerHTML || S.view === 'together') return;
  S.tgAsked = p.id;
  modal(`<h3>함께 쓰기 초대</h3><div style="display:flex;gap:12px;align-items:center">${avatar(p.inviter_name, 'p')}<div><b>${esc(p.inviter_name || p.inviter_email)}</b>님이 나의 서재를 함께 쓰자고 초대했어요.
      <div class="small">${esc(p.inviter_email || '')}</div></div></div>
    <div class="small" style="line-height:1.7;margin-top:10px">수락하면 서로의 책 목록 · 별점 · 읽은 쪽수, 그리고 고른 필사만 볼 수 있어요. 메모 · 노트 · 할 일은 항상 나만 봐요.</div>
    <div class="actions"><button class="btn" onclick="closeModal()">나중에</button><button class="btn" onclick="tgDecline('${p.id}')">거절</button><button class="btn primary grow" onclick="tgAccept('${p.id}')">수락하기</button></div>`);
}

/* ----- 보여줄 것 설정 ----- */
function openShareSettings() {
  const T = S.tg, me = T.me || {};
  const nb = S.books.length, shown = S.books.filter(bookShared).length, ns = S.snips.filter(isShared).length;
  modal(`<h3>보여줄 것 · 같이 쓰기</h3>
    <label>내 이름 <span style="font-weight:400;color:var(--faint)">${tgHasPartner() ? esc(tgName()) + '에게' : '짝꿍에게'} 이렇게 보여요</span></label>
    <div class="inline"><input class="field" id="tg-name" value="${esc(me.name || '')}" maxlength="20"><button class="btn" onclick="tgSaveName()">저장</button></div>
    <div class="panel2" style="margin-top:12px"><h4>👀 책 · 별점 · 한줄평 · 읽은 쪽수 <span class="small" style="font-weight:400">기본 공개</span></h4>
      <div class="small">${nb}권 중 <b>${shown}권</b>을 보여주는 중이에요. 책 화면 위쪽 ‘👀 보여주는 중’을 누르면 그 책만 숨길 수 있어요.</div>
      <div class="actions" style="margin-top:8px"><button class="btn" onclick="tgAllBooks(false)">모두 숨기기</button><button class="btn" onclick="tgAllBooks(true)">모두 보여주기</button></div></div>
    <div class="panel2"><h4>✋ 필사 · 내 생각 <span class="small" style="font-weight:400">고른 것만</span></h4>
      <div class="small" style="line-height:1.6">지금 <b>${ns}개</b>를 보여주는 중이에요. 책 화면에서 문장을 꾹 눌러 고른 뒤 ‘보여주기’를 눌러요. 필사에 달아 둔 메모도 같이 보여요.</div>
      <label class="tg-check"><input type="checkbox" id="tg-new" ${tgShareNew() ? 'checked' : ''} onchange="tgSaveOpt('shareNew', this.checked)"> 새로 쓰는 필사 · 내 생각은 처음부터 보여주기</label></div>
    <div class="panel2"><h4>🔒 메모 · 노트 · 할 일 <span class="small" style="font-weight:400">항상 나만</span></h4><div class="small">이건 바꿀 수 없어요.</div></div>
    <label class="tg-check"><input type="checkbox" ${tgSpoilOn() ? 'checked' : ''} onchange="tgSaveOpt('spoiler', this.checked)"> 같이 읽는 책은 내가 읽은 곳 뒤 문장 가리기 (스포일러)</label>
    ${tgHasPartner() ? `<button class="note-link" style="color:var(--danger,#b33)" onclick="tgEnd()">${esc(jo(tgName(), '과', '와'))} 같이 쓰기 끝내기 <span>서로 기록이 안 보이게 돼요</span></button>` : ''}
    <div class="actions"><button class="btn primary grow" onclick="closeModal()">닫기</button></div>`);
}
async function tgSaveName() {
  const name = $('tg-name').value.trim(); if (!name) { toast('이름을 넣어 주세요'); return; }
  try { await sbq(sbClient().from('profiles').update({ name }).eq('user_id', sbUid())); S.tg.me.name = name; LS.set(TG_CACHE, JSON.stringify(S.tg)); toast('저장했어요'); if (S.view === 'together') renderTogether(); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
}
async function tgSaveOpt(k, v) {
  S.settings = Object.assign({}, S.settings, { [k]: v });
  try { const r = await Store.run('saveSettings', { [k]: v }); if (r) S.settings = r; saveCache(); toast('저장했어요'); } catch (e) { toast('⚠ ' + (e.message || e)); }
  if (k === 'together') { tgNav(); if (v) tgRefresh(true); else if (['together', 'pbook', 'plib'].includes(S.view)) go('library'); }
}
function tgAllBooks(on) {
  const list = S.books.filter(b => bookShared(b) !== on);
  if (!list.length) { toast('바뀐 게 없어요'); return; }
  if (!confirm(`${list.length}권을 ${on ? '보여줄' : '숨길'}까요?`)) return;
  list.forEach(b => patchBook(b.ID, { '공개': on }));
  toast(`${list.length}권을 ${on ? '보여줘요' : '숨겼어요'}`); openShareSettings();
}
async function tgEnd() {
  if (!confirm(`${jo(tgName(), '과', '와')} 같이 쓰기를 끝낼까요? 서로의 기록이 더 이상 안 보여요. (각자 기록은 그대로 남아요)`)) return;
  try { await sbq(sbClient().from('partnerships').update({ status: 'ended' }).eq('id', S.tg.partner.pship)); closeModal(); toast('같이 쓰기를 끝냈어요'); await tgRefresh(); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
}

/* ----- 시작할 때 · 앱으로 돌아올 때 새로 받기 ----- */
(() => {
  let last = 0;
  const kick = () => { if (!togetherOn() || !S.loaded || !sbUid()) return; if (Date.now() - last < 90000) return; last = Date.now(); tgRefresh(true); };
  const wait = setInterval(() => { if (S.loaded) { clearInterval(wait); tgNav(); kick(); } }, 400);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
})();
