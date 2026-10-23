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
// 서버 시각(UTC) → 이 기기 날짜 · 시각
const locDay = t => { const d = new Date(t); return isNaN(d) ? String(t || '').slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const locTime = t => { const d = new Date(t); return isNaN(d) ? '' : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
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
      sbq(sbClient().from('profiles').select('*').eq('user_id', me).maybeSingle())
    ]);
    const acc = ps.find(p => p.status === 'accepted' && (p.inviter === me || p.invitee === me));
    const next = { at: Date.now(), me: { id: me, email, name: (mine && mine.name) || email.split('@')[0], avatar: (mine && mine.avatar) || '' },
      incoming: ps.filter(p => p.status === 'pending' && p.inviter !== me && String(p.invitee_email).toLowerCase() === email),
      sent: ps.filter(p => p.status === 'pending' && p.inviter === me), partner: null, books: [], snips: [], logs: [] };
    if (acc) {
      const pid = acc.inviter === me ? acc.invitee : acc.inviter;
      const [prof, b, s, l] = await Promise.all([
        sbq(sbClient().from('profiles').select('*').eq('user_id', pid).maybeSingle()),
        tgPull('books', 'id, data, updated_at', pid), tgPull('snippets', 'id, book_id, kind, data, updated_at', pid),
        tgPull('read_logs', 'id, book_id, day, page, base_page', pid)
      ]);
      const pemail = (prof && prof.email) || (acc.inviter === me ? acc.invitee_email : acc.inviter_email) || '';
      next.partner = { id: pid, pship: acc.id, since: acc.accepted_at, email: pemail,
        name: (prof && prof.name) || (acc.inviter === pid ? acc.inviter_name : '') || pemail.split('@')[0], avatar: (prof && prof.avatar) || '' };
      next.books = b.map(sbOut); next.snips = s.map(sbOut);
      next.logs = l.map(r => ({ id: r.id, bid: r.book_id, date: String(r.day).slice(0, 10), page: r.page, base: r.base_page }));
    }
    // 문장 반응 (내 문장에 달린 것 · 짝꿍 문장에 단 것) · 같이 읽을 책
    const [rx, tb] = await Promise.all([
      sbq(sbClient().from('reactions').select('id, owner, snippet_id, user_id, kind, body, created_at').order('created_at', { ascending: true })).catch(() => []),
      acc ? sbq(sbClient().from('together_books').select('id, pship, data, added_by, status, joined, started_at, created_at').eq('pship', acc.id).eq('deleted', false).order('created_at', { ascending: true })).catch(() => []) : Promise.resolve([])
    ]);
    next.reacts = rx || []; next.tbooks = tb || [];
    next.av = await tgSignAvatars(next);
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
function avatar(name, cls) {
  const T = S.tg || {}, who = cls && cls.split(' ').includes('p') ? (T.partner || {}).id : (T.me || {}).id, url = who && (T.av || {})[who];
  const ini = esc(String(name || '?').trim().slice(0, 1));
  return url ? `<span class="tg-av ${cls || ''} ph"><img src="${esc(url)}" alt="" onerror="this.parentNode.classList.remove('ph');this.replaceWith('${ini}')"></span>` : `<span class="tg-av ${cls || ''}">${ini}</span>`;
}

function renderTogether() {
  const el = $('v-together'); if (!el) return;
  if (!togetherOn()) { el.innerHTML = `<div class="view-head"><h1>함께</h1><p>설정에서 같이 쓰기를 켜면 보여요.</p></div>`; return; }
  const T = S.tg;
  if (!T.at) { el.innerHTML = `<div class="view-head"><h1>함께</h1></div><div class="drill"><span class="spin"></span> 불러오는 중…</div>`; tgRefresh(); return; }
  if (!T.partner) { el.innerHTML = tgInviteHtml(); return; }
  const me = T.me || {}, pn = tgName();
  const mineS = tgMonthStats(S.books, myLogs()), theirS = tgMonthStats(T.books, T.logs);
  const statCol = (name, s, cls) => `<div class="tg-col" onclick="openProfile('${cls === 'p' ? 'p' : 'me'}')">${avatar(name, cls)}<b>${esc(name)} <span class="small" style="font-weight:400">서재 ›</span></b>
    <div class="tg-num"><span><b>${s.pages.toLocaleString()}</b>쪽 읽음</span><span><b>${s.days}</b>일 기록</span><span><b>${s.done}</b>권 완독</span><span class="tg-tot">서재 ${s.total}권</span></div></div>`;
  mineS.total = S.books.length; theirS.total = T.books.length;
  // 둘 다 서재에 있는 책: 읽는 중 → 다 읽은 책 → 읽고 싶은 책
  const rank = x => (x.pb['상태'] === '읽는중' || x.mb['상태'] === '읽는중') ? 0 : (x.pb['상태'] === '완독' && x.mb['상태'] === '완독') ? 1 : 2;
  const both = T.books.map(pb => ({ pb, mb: tgMine(pb) })).filter(x => x.mb)
    .sort((a, b) => rank(a) - rank(b) || String(bookDayT(b.pb)).localeCompare(String(bookDayT(a.pb))));
  const nRead = both.filter(x => rank(x) === 0).length;
  const reading = T.books.filter(b => b['상태'] === '읽는중');
  const bar = (name, b, cls) => { const p = tgProg(b); return `<div class="tg-prog ${cls}"><span>${esc(name)}</span><div class="bar"><i style="width:${p.pct}%"></i></div><em>${b['상태'] === '완독' ? '완독' : p.cur ? 'p.' + p.cur + (p.total ? ` · ${p.pct}%` : '') : b['상태'] === '읽을예정' ? '읽고 싶은' : '–'}</em></div>`; };
  el.innerHTML = `
    <div class="view-head tg-head"><div><h1>함께</h1><p><button class="tg-pbtn" onclick="openProfile('me')">${avatar(me.name)}</button><button class="tg-pbtn" onclick="openProfile('p')">${avatar(pn, 'p')}</button> ${esc(me.name)} · ${esc(pn)}</p></div>
      <button class="iconbtn" onclick="openShareSettings()">보여줄 것</button></div>
    <div class="panel2"><h4>둘의 ${Number(tgMonth().slice(5))}월</h4><div class="tg-cols">${statCol(me.name, mineS, '')}${statCol(pn, theirS, 'p')}</div></div>
    ${both.length ? `<div class="panel2"><h4>둘 다 있는 책 <span class="small" style="font-weight:400">${both.length}권${nRead ? ` · 같이 읽는 중 ${nRead}` : ''}</span></h4>
      ${(S.bothAll ? both : both.slice(0, 4)).map(({ pb, mb }) => `<div class="tg-both" onclick="openPartnerBook('${pb.ID}')">${spine(mb)}<div class="grow">
      <div class="tg-bt">${esc(mb['제목'])}</div>${bar(me.name, mb, '')}${bar(pn, pb, 'p')}
      ${mb['별점'] || pb['별점'] ? `<div class="tg-stars"><span>${esc(me.name)} <i class="stars">${mb['별점'] ? '★'.repeat(Number(mb['별점']) || 0) : '–'}</i></span><span>${esc(pn)} <i class="stars">${pb['별점'] ? '★'.repeat(Number(pb['별점']) || 0) : '–'}</i></span></div>` : ''}</div></div>`).join('')}
      ${both.length > 4 ? `<button class="btn tg-more" onclick="S.bothAll=!S.bothAll;renderTogether()">${S.bothAll ? '접기' : `모두 보기 (${both.length}권)`}</button>` : ''}</div>` : ''}
    ${tgTbooksHtml()}
    <div class="panel2"><h4>${esc(pn)}의 서재 <button class="kw-ai" onclick="openProfile('p')">전체 ${T.books.length}권 보기 →</button></h4>
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
    if (b['시작일'] && b['시작일'] !== b['완독일'] && b['상태'] !== '읽을예정') add(who, b['시작일'], `${ttlO(b)} 읽기 시작했어요`, open(b), p);
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
  // 문장 반응
  (T.reacts || []).forEach(r => {
    const mineSnip = r.owner === T.me.id, fromMe = r.user_id === T.me.id;
    if (mineSnip && fromMe) return;
    const sn = mineSnip ? S.snips.find(x => x.ID === r.snippet_id) : T.snips.find(x => x.ID === r.snippet_id); if (!sn) return;
    const who = fromMe ? me : pn, t = esc(sText(sn).slice(0, 24)) + (sText(sn).length > 24 ? '…' : '');
    add(who, locDay(r.created_at), r.kind === 'heart' ? `${mineSnip ? '내' : esc(pn) + '의'} 문장에 ♡ <span class="tg-q">“${t}”</span>`
      : `“${esc(String(r.body || '').slice(0, 60))}” <span class="tg-q">— ${mineSnip ? '내' : esc(pn) + '의'} 문장 “${t}”</span>`, `openReacts('${r.snippet_id}','${r.owner}')`, !fromMe);
  });
  (T.tbooks || []).forEach(tb => { const who = tb.added_by === T.me.id ? me : pn;
    add(who, locDay(tb.created_at), `같이 읽을 책에 『${esc(tb.data['제목'] || '')}』를 담았어요`, `go('together')`, who !== me);
    if (tb.started_at) add(who, tb.started_at, `『${esc(tb.data['제목'] || '')}』 같이 읽기 시작!`, `go('together')`, false); });
  return out.sort((a, b) => b.date.localeCompare(a.date) || (b.p ? 1 : 0) - (a.p ? 1 : 0));
}
// 최근 한 달은 바로, 그 전은 '지난 소식 더보기' → 연도별로 접어서
S.feedAll = false;
function tgFeedRows(list) {
  let last = '';
  return list.map(x => { const head = x.date !== last ? `<div class="tg-day">${x.date === S.today ? '오늘' : x.date === addDays(S.today, -1) ? '어제' : x.date.slice(5).replace('-', '.')}</div>` : ''; last = x.date;
    return `${head}<div class="tg-feed" onclick="${x.onclick}">${avatar(x.who, x.p ? 'p' : '')}<div>${x.html}</div></div>`; }).join('');
}
function tgFeedHtml() {
  const f = tgFeed(); if (!f.length) return '<div class="small">아직 소식이 없어요. 책을 읽고 기록하면 여기에 보여요.</div>';
  const cut = addDays(S.today, -30), recent = f.filter(x => x.date >= cut), old = f.filter(x => x.date < cut);
  let h = recent.length ? tgFeedRows(recent) : '<div class="small">최근 한 달 동안의 소식은 없어요.</div>';
  if (!old.length) return h;
  if (!S.feedAll) return h + `<button class="btn tg-more" onclick="S.feedAll=true;renderTogether()">지난 소식 더보기 <span class="small">${old.length}개</span></button>`;
  const years = {}; old.forEach(x => (years[x.date.slice(0, 4)] = years[x.date.slice(0, 4)] || []).push(x));
  const thisY = S.today.slice(0, 4);
  h += Object.keys(years).sort().reverse().map(y => `<details class="tg-year" ${y === thisY ? 'open' : ''}><summary>${y}년 <span class="small">${years[y].length}개</span></summary>${tgFeedRows(years[y])}</details>`).join('');
  return h + `<button class="btn tg-more" onclick="S.feedAll=false;renderTogether()">접기</button>`;
}

/* ----- 짝꿍 서재 전체 ----- */
// 각자 프로필: 사진 · 이름 · 서재 목록 (짝꿍 것은 보기만)
S.plibWho = 'p';
function openProfile(who) { S.plibWho = who === 'me' ? 'me' : 'p'; if (S.plibWho === 'p' && !tgHasPartner()) return; go('plib'); }
function renderPartnerLib() {
  const el = $('v-plib'); if (!el) return;
  const mine = S.plibWho === 'me';
  if (!mine && !tgHasPartner()) { go('together'); return; }
  const name = mine ? (S.tg.me || {}).name || '나' : tgName();
  const all = mine ? S.books : S.tg.books;
  const list = all.filter(b => S.tgFilter === '전체' || b['상태'] === S.tgFilter)
    .sort((a, b) => String(b['완독일'] || b['시작일'] || b['등록일'] || '').localeCompare(String(a['완독일'] || a['시작일'] || a['등록일'] || '')));
  const done = all.filter(b => b['상태'] === '완독').length, reading = all.filter(b => b['상태'] === '읽는중').length;
  const shown = mine ? S.snips.filter(isShared).length : S.tg.snips.length;
  el.innerHTML = `<div class="topbar"><button class="iconbtn" onclick="goBack()">← 함께</button>${mine ? `<button class="iconbtn" onclick="openMyProfile()">프로필 고치기</button>` : ''}</div>
    <div class="tg-prof">${mine ? `<button class="tg-pbtn" onclick="openMyProfile()" aria-label="프로필 사진 바꾸기">${avatar(name, 'big')}</button>` : avatar(name, 'p big')}
      <div><h1>${esc(name)}</h1><p class="small">${mine ? '내 서재' : '보기만 할 수 있어요'} · 전체 ${all.length}권 · 완독 ${done} · 읽는 중 ${reading} · 보여준 문장 ${shown}</p></div></div>
    <div class="chips" id="pl-f">${FILTERS.map(f => `<button class="chip ${S.tgFilter === f ? 'on' : ''}" data-f="${f}">${FILTER_LABEL[f] || f} ${f === '전체' ? all.length : all.filter(b => b['상태'] === f).length}</button>`).join('')}</div>
    <div class="list">${list.map(b => { const p = tgProg(b), other = mine ? tgTheirs(b) : tgMine(b);
      return `<div class="book" onclick="${mine ? `go('book','${b.ID}')` : `openPartnerBook('${b.ID}')`}">${spine(b)}<div class="binfo"><div class="btitle">${esc(b['제목'])}</div>
        <div class="bauthor">${esc(b['저자'] || '')}</div>
        ${tgPeriod(b) ? `<div class="tg-per">${tgPeriod(b)}</div>` : ''}
        <div class="bmeta">${b['별점'] ? `<span class="stars">${starText(b['별점'])}</span>` : ''}${b['상태'] === '읽는중' && p.pct ? `<span class="badge">${p.pct}%</span>` : ''}${mine && !bookShared(b) ? '<span class="badge plat">🔒 나만 보기</span>' : ''}${other ? `<span class="badge plat">${mine ? esc(tgName()) + '도 있음' : '내 서재에도 있음'}</span>` : ''}</div></div></div>`; }).join('') || '<div class="empty">책이 없어요</div>'}</div>`;
  $('pl-f').onclick = e => { const t = e.target.closest('[data-f]'); if (!t) return; S.tgFilter = t.dataset.f; renderPartnerLib(); };
}

// 읽은 기간: 2026.10.09 ~ 10.13 · 5일
function tgPeriod(b) {
  const s = String(b['시작일'] || '').slice(0, 10), f = String(b['완독일'] || '').slice(0, 10), dot = d => d.replace(/-/g, '.');
  if (b['상태'] === '읽을예정') return '';
  if (s && f) return `${dot(s)} ~ ${f.slice(0, 4) === s.slice(0, 4) ? dot(f.slice(5)) : dot(f)}${b['완독일수'] ? ` · ${esc(b['완독일수'])}일` : ''}`;
  if (f) return `${dot(f)} 완독`;
  if (s) return `${dot(s)} ~`;
  return '';
}

/* ----- 프로필 사진 ----- */
const AV_BUCKET = 'avatars';
async function tgSignAvatars(T) {
  const want = [[T.me.id, T.me.avatar], T.partner ? [T.partner.id, T.partner.avatar] : null].filter(x => x && x[1]);
  if (!want.length) return {};
  try {
    const r = await sbClient().storage.from(AV_BUCKET).createSignedUrls(want.map(([u]) => `${u}/avatar.jpg`), 7 * 86400);
    const out = {}; (r.data || []).forEach((x, i) => { if (x && x.signedUrl) out[want[i][0]] = x.signedUrl; });
    return out;
  } catch (e) { return (S.tg && S.tg.av) || {}; }
}
function openMyProfile() {
  const me = S.tg.me || {};
  modal(`<h3>내 프로필 <span style="font-weight:400;color:var(--faint);font-size:13px">${tgHasPartner() ? esc(tgName()) + '에게' : '짝꿍에게'} 이렇게 보여요</span></h3>
    <div class="tg-prof" style="margin:6px 0 4px">${avatar(me.name, 'big')}
      <div class="inline"><label class="btn" style="cursor:pointer">사진 고르기<input type="file" accept="image/*" hidden onchange="tgUploadAvatar(this.files[0])"></label>
        ${me.avatar ? `<button class="btn" onclick="tgRemoveAvatar()">사진 지우기</button>` : ''}</div></div>
    <div id="av-msg" class="small"></div>
    <label>이름</label>
    <div class="inline"><input class="field" id="tg-name" value="${esc(me.name || '')}" maxlength="20" style="flex:1"><button class="btn primary" onclick="tgSaveName()">저장</button></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
// 가운데를 정사각형으로 잘라 320px JPEG로 줄여서 올려요
async function tgUploadAvatar(file) {
  if (!file) return;
  const msg = $('av-msg'); if (msg) msg.innerHTML = '<span class="spin"></span> 사진 올리는 중…';
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas'); c.width = c.height = 320;
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 320, 320);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    const uidv = sbUid(), ver = String(Date.now());
    await sbq(sbClient().storage.from(AV_BUCKET).upload(`${uidv}/avatar.jpg`, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '60' }));
    await sbq(sbClient().from('profiles').update({ avatar: ver }).eq('user_id', uidv));
    S.tg.me.avatar = ver; S.tg.av = await tgSignAvatars(S.tg); LS.set(TG_CACHE, JSON.stringify(S.tg));
    toast('프로필 사진을 바꿨어요'); openMyProfile(); tgRerenderAll();
  } catch (e) { if ($('av-msg')) $('av-msg').textContent = '⚠ ' + (e.message || e); }
}
async function tgRemoveAvatar() {
  if (!confirm('프로필 사진을 지울까요?')) return;
  try {
    await sbq(sbClient().storage.from(AV_BUCKET).remove([`${sbUid()}/avatar.jpg`]));
    await sbq(sbClient().from('profiles').update({ avatar: null }).eq('user_id', sbUid()));
    S.tg.me.avatar = ''; delete (S.tg.av || {})[sbUid()]; LS.set(TG_CACHE, JSON.stringify(S.tg));
    toast('사진을 지웠어요'); openMyProfile(); tgRerenderAll();
  } catch (e) { toast('⚠ ' + (e.message || e)); }
}
function tgRerenderAll() { if (S.view === 'together') renderTogether(); else if (S.view === 'plib') renderPartnerLib(); else if (S.view === 'pbook') renderPartnerBook(); }

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
      ${s['쪽수'] !== '' && s['쪽수'] != null ? `<div class="smeta"><span class="pg">p.${esc(s['쪽수'])}</span></div>` : ''}
      ${reactBarHtml(s.ID, S.tg.partner.id)}</div>`; };
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
    ${b['별점'] || b['한줄평'] || (mine && (mine['별점'] || mine['한줄평'])) ? `<div class="panel2"><h4>별점 · 한줄평</h4>
      ${tgReviewRow(pn, 'p', b, spoilReview)}${mine && (mine['별점'] || mine['한줄평']) ? tgReviewRow('나', '', mine, false, `openRating('${mine.ID}')`) : mine && mine['상태'] === '완독' ? `<div class="tg-rv" onclick="openRating('${mine.ID}')">${avatar((S.tg.me || {}).name)}<div class="small">내 별점 · 한줄평 남기기 ›</div></div>` : ''}</div>` : ''}
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
    ${pb['별점'] || pb['한줄평'] ? (() => { const spoil = pb['한줄평'] && tgSpoilOn() && b['상태'] !== '완독';
      return `<div class="tg-also-rv">${pb['별점'] ? `<span class="stars">${starText(pb['별점'])}</span>` : ''}${pb['한줄평'] ? (spoil ? ' <span class="small">· 한줄평은 다 읽고 보기 🙈</span>' : `<div>“${esc(pb['한줄평'])}”</div>`) : ''}</div>`; })() : ''}
    ${n ? `<div class="small">보여준 문장 ${n}개 →</div>` : '<div class="small">눌러서 보기 →</div>'}</div></div>`;
}
// 별점 · 한줄평 한 줄 (짝꿍 · 나)
function tgReviewRow(name, cls, b, spoil, onclick) {
  if (!b['별점'] && !b['한줄평']) return `<div class="tg-rv">${avatar(name, cls)}<div class="small">아직 별점 · 한줄평이 없어요</div></div>`;
  return `<div class="tg-rv" ${onclick ? `onclick="${onclick}"` : ''}>${avatar(name, cls)}<div class="grow"><div><b>${esc(name)}</b> ${b['별점'] ? `<span class="stars">${starText(b['별점'])}</span>` : ''}</div>
    ${b['한줄평'] ? `<div class="${spoil ? 'spoil' : ''}" ${spoil ? `onclick="event.stopPropagation();this.classList.remove('spoil')"` : ''}>${spoil ? '<div class="spoil-l">🙈 다 읽고 보면 좋아요 · 눌러서 보기</div>' : ''}<div>${esc(b['한줄평'])}</div></div>` : ''}</div></div>`;
}
const bookDayT = b => String(b['완독일'] || b['시작일'] || b['등록일'] || '');
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
    <button class="tg-me-row" onclick="openMyProfile()">${avatar(me.name)}<b>${esc(me.name || '')}</b><span class="small">이름 · 프로필 사진 바꾸기 ›</span></button>
    <div class="panel2" style="margin-top:12px"><h4>👀 책 · 별점 · 한줄평 · 읽은 쪽수 <span class="small" style="font-weight:400">기본 공개</span></h4>
      <div class="small">${nb}권 중 <b>${shown}권</b>을 보여주는 중이에요. 책 화면 위쪽 ‘👀 보여주는 중’을 누르면 그 책만 숨길 수 있어요.</div>
      <div class="actions" style="margin-top:8px"><button class="btn" onclick="tgAllBooks(false)">모두 숨기기</button><button class="btn" onclick="tgAllBooks(true)">모두 보여주기</button></div></div>
    <div class="panel2"><h4>✋ 필사 · 내 생각 <span class="small" style="font-weight:400">고른 것만</span></h4>
      <div class="small" style="line-height:1.6">지금 <b>${ns}개</b>를 보여주는 중이에요. 책 화면에서 문장을 꾹 눌러 고른 뒤 ‘보여주기’를 눌러요. 필사에 달아 둔 메모도 같이 보여요.</div>
      <label class="tg-check"><input type="checkbox" id="tg-new" ${tgShareNew() ? 'checked' : ''} onchange="tgSaveOpt('shareNew', this.checked)"> 새로 쓰는 필사 · 내 생각은 처음부터 보여주기</label></div>
    <div class="panel2"><h4>🔒 메모 · 노트 · 할 일 <span class="small" style="font-weight:400">항상 나만</span></h4><div class="small">이건 바꿀 수 없어요.</div></div>
    <label class="tg-check"><input type="checkbox" ${tgSpoilOn() ? 'checked' : ''} onchange="tgSaveOpt('spoiler', this.checked)"> 같이 읽는 책은 내가 읽은 곳 뒤 문장 가리기 (스포일러)</label>
    ${tgHasPartner() ? `<div style="text-align:right;margin-top:16px"><button class="tg-end" onclick="tgEnd()">같이 쓰기 끝내기</button></div>` : ''}
    <div class="actions"><button class="btn primary grow" onclick="closeModal()">닫기</button></div>`);
}
async function tgSaveName() {
  const name = $('tg-name').value.trim(); if (!name) { toast('이름을 넣어 주세요'); return; }
  try { await sbq(sbClient().from('profiles').update({ name }).eq('user_id', sbUid())); S.tg.me.name = name; LS.set(TG_CACHE, JSON.stringify(S.tg)); toast('저장했어요'); tgRerenderAll(); }
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


/* ===================================================================
   문장 반응 · 한마디 (v2.11): 짝꿍이 보여준 문장에 ♡ · 댓글, 내 문장엔 답글
   =================================================================== */
const reactsOf = (owner, sid) => (S.tg.reacts || []).filter(r => r.owner === owner && r.snippet_id === sid);
function reactBarHtml(sid, owner) {
  const rs = reactsOf(owner, sid), me = (S.tg.me || {}).id;
  const hearts = rs.filter(r => r.kind === 'heart'), mine = hearts.find(r => r.user_id === me), n = rs.filter(r => r.kind === 'comment').length;
  return `<div class="react-bar" onclick="event.stopPropagation()">
    <button class="${mine ? 'on' : ''}" onclick="toggleHeart('${sid}','${owner}')">${mine ? '♥' : '♡'}${hearts.length ? ' ' + hearts.length : ''}</button>
    <button onclick="openReacts('${sid}','${owner}')">💬 ${n ? n : '한마디'}</button></div>`;
}
// 내 문장 아래 작은 줄 (반응이 있을 때만)
function myReactLine(s) {
  if (!togetherOn() || !S.tg || !S.tg.me) return '';
  const rs = reactsOf(S.tg.me.id, s.ID).filter(r => r.user_id !== S.tg.me.id || r.kind === 'comment'); if (!rs.length) return '';
  const h = rs.filter(r => r.kind === 'heart').length, c = rs.filter(r => r.kind === 'comment').length;
  return `<div class="react-line" onclick="event.stopPropagation();openReacts('${s.ID}','${S.tg.me.id}')">${h ? `♥ ${esc(tgName())}` : ''}${h && c ? ' · ' : ''}${c ? `💬 한마디 ${c}` : ''}</div>`;
}
async function toggleHeart(sid, owner) {
  const me = S.tg.me.id, cur = reactsOf(owner, sid).find(r => r.kind === 'heart' && r.user_id === me);
  try {
    if (cur) { await sbq(sbClient().from('reactions').delete().eq('id', cur.id)); S.tg.reacts = S.tg.reacts.filter(r => r.id !== cur.id); }
    else {
      const r = await sbq(sbClient().from('reactions').insert({ owner, snippet_id: sid, kind: 'heart' }).select('id, owner, snippet_id, user_id, kind, body, created_at').single());
      S.tg.reacts.push(r); notifyPartner('reaction', r.id);
    }
    LS.set(TG_CACHE, JSON.stringify(S.tg));
  } catch (e) { toast('⚠ ' + (e.message || e)); return; }
  reactRerender();
}
function reactRerender() {
  if (S.view === 'pbook') { const y = window.scrollY; renderPartnerBook(); window.scrollTo(0, y); }
  else if (S.view === 'book') { const y = window.scrollY; renderBook(); window.scrollTo(0, y); }
  else if (S.view === 'together') renderTogether();
  if ($('rx-list')) drawReacts();
}
let rxCur = null;
function openReacts(sid, owner) {
  const me = (S.tg.me || {}).id;
  const sn = owner === me ? S.snips.find(x => x.ID === sid) : (S.tg.snips || []).find(x => x.ID === sid);
  if (!sn) { toast('그 문장을 찾지 못했어요'); return; }
  rxCur = { sid, owner };
  modal(`<h3>한마디 <span style="font-weight:400;color:var(--faint);font-size:13px">${owner === me ? '내 문장' : esc(tgName()) + '의 문장'}</span></h3>
    <div class="rx-quote">${esc(sText(sn).slice(0, 300))}${sText(sn).length > 300 ? '…' : ''}</div>
    <div id="rx-list"></div>
    <div class="inline" style="margin-top:10px"><textarea class="field" id="rx-in" rows="2" maxlength="1000" placeholder="${owner === me ? '답글 남기기' : '이 문장에 한마디'}" style="flex:1;min-height:44px"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendReact()}"></textarea>
      <button class="btn primary" onclick="sendReact()">보내기</button></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
  drawReacts();
}
function drawReacts() {
  const el = $('rx-list'); if (!el || !rxCur) return;
  const me = S.tg.me.id, rs = reactsOf(rxCur.owner, rxCur.sid);
  const hearts = rs.filter(r => r.kind === 'heart').map(r => r.user_id === me ? '나' : tgName());
  const cs = rs.filter(r => r.kind === 'comment');
  el.innerHTML = (hearts.length ? `<div class="small" style="margin:8px 0">♥ ${hearts.map(esc).join(', ')}</div>` : '') +
    (cs.length ? cs.map(r => `<div class="rx ${r.user_id === me ? 'me' : ''}">${avatar(r.user_id === me ? S.tg.me.name : tgName(), r.user_id === me ? '' : 'p')}
      <div class="rx-b"><div>${esc(r.body)}</div><span>${esc(locTime(r.created_at))}${r.user_id === me ? ` · <a onclick="delReact('${r.id}')">지우기</a>` : ''}</span></div></div>`).join('')
      : '<div class="small" style="margin:10px 0;color:var(--faint)">아직 한마디가 없어요</div>');
}
async function sendReact() {
  const t = $('rx-in'), body = t.value.trim(); if (!body || !rxCur) return;
  t.disabled = true;
  try {
    const r = await sbq(sbClient().from('reactions').insert({ owner: rxCur.owner, snippet_id: rxCur.sid, kind: 'comment', body }).select('id, owner, snippet_id, user_id, kind, body, created_at').single());
    S.tg.reacts.push(r); LS.set(TG_CACHE, JSON.stringify(S.tg)); t.value = ''; notifyPartner('reaction', r.id);
  } catch (e) { toast('⚠ ' + (e.message || e)); }
  t.disabled = false; reactRerender();
}
async function delReact(id) {
  if (!confirm('이 한마디를 지울까요?')) return;
  try { await sbq(sbClient().from('reactions').delete().eq('id', id)); S.tg.reacts = S.tg.reacts.filter(r => r.id !== id); LS.set(TG_CACHE, JSON.stringify(S.tg)); } catch (e) { toast('⚠ ' + (e.message || e)); }
  reactRerender();
}

/* ===================================================================
   같이 읽을 책 (v2.11): 둘이 같이 담고, '같이 시작하기'를 누르면 둘 다 읽는 중으로
   =================================================================== */
// 같이 읽을 책마다 두 사람 상태 (각자 서재 기준)
function tbWhoHtml(d) {
  const st = b => !b ? '서재에 없음' : b['상태'] === '읽는중' ? '읽는 중' : b['상태'] === '완독' ? '다 읽음' : b['상태'] === '읽을예정' ? '읽고 싶은 책' : b['상태'];
  const mb = S.books.find(x => tgSame(x, d)), pb = (S.tg.books || []).find(x => tgSame(x, d));
  return `<div class="tg-stars"><span>${esc((S.tg.me || {}).name || '나')} · ${st(mb)}</span><span>${esc(tgName())} · ${st(pb)}</span></div>`;
}
const TB_FIELDS = ['제목', '저자', '옮긴이', '출판사', '대분류', '중분류', '분량', '표지URL', 'ISBN'];
function tgTbooksHtml() {
  const list = (S.tg.tbooks || []).filter(t => t.status === '예정');
  const me = S.tg.me.id;
  return `<div class="panel2"><h4>같이 읽을 책 <button class="kw-ai" onclick="openTbAdd()">＋ 담기</button></h4>
    ${list.length ? list.map(t => { const d = t.data || {}; return `<div class="tg-both">${spine(d)}<div class="grow">
      <div class="tg-bt">${esc(d['제목'] || '')}</div><div class="small">${esc(d['저자'] || '')} · ${t.added_by === me ? '내가' : esc(jo(tgName(), '이', '가'))} 담음</div>
      ${tbWhoHtml(d)}
      <div class="inline" style="margin-top:6px"><button class="btn" onclick="tbRemove('${t.id}')">빼기</button></div></div></div>`; }).join('')
      : `<div class="small">둘이 다음에 같이 읽고 싶은 책을 담아 두세요. 내 서재에 없던 책은 내 읽고 싶은 책에도 들어가고, 읽기 시작은 각자 서재에서 해요.</div>`}</div>`;
}
let tbCands = [];
function openTbAdd() {
  const T = S.tg; tbCands = [];
  const wish = (list, who) => list.filter(b => b['상태'] === '읽을예정' && !(T.tbooks || []).some(t => t.status === '예정' && tgSame(t.data, b)))
    .map(b => { tbCands.push(Object.fromEntries(TB_FIELDS.filter(k => b[k]).map(k => [k, b[k]])));
      return `<button class="chip" onclick="tbAdd(tbCands[${tbCands.length - 1}])">${esc(who)} · ${esc(b['제목'])}</button>`; });
  const chips = [...wish(S.books, '나'), ...wish(T.books, tgName())];
  modal(`<h3>같이 읽을 책 담기</h3>
    ${chips.length ? `<label>읽고 싶은 책에서 고르기</label><div class="suggest">${chips.join('')}</div>` : ''}
    <label>책 검색</label>
    <div class="al-box"><input class="field" id="tb-q" type="search" placeholder="제목 · 저자 · ISBN" onkeydown="if(event.key==='Enter'){event.preventDefault();tbSearch()}">
      <button class="btn" onclick="openBarcode(v=>{$('tb-q').value=v;tbSearch()})" aria-label="바코드로 찾기">📷</button><button class="btn primary" onclick="tbSearch()">검색</button></div>
    <div id="tb-res" class="al-res"></div>
    <div class="actions"><button class="btn grow" onclick="closeModal()">닫기</button></div>`);
}
let tbList = [];
async function tbSearch() {
  const q = $('tb-q').value.trim(); if (!q) return;
  $('tb-res').innerHTML = '<div class="al-msg">찾는 중…</div>';
  try {
    tbList = await call('bookSearch', q);
    $('tb-res').innerHTML = tbList.length ? tbList.map((x, i) => `<button class="al-item" onclick="tbPick(${i})"><img src="${esc(x.cover)}" alt="">
      <div><b>${esc(x.title)}</b><span>${esc(x.author)} · ${esc(x.publisher)}</span></div></button>`).join('') : '<div class="al-msg">검색 결과가 없어요</div>';
  } catch (e) { $('tb-res').innerHTML = `<div class="al-msg">${esc(e.message || e)}</div>`; }
}
async function tbPick(i) {
  const x = tbList[i]; if (!x) return;
  $('tb-res').innerHTML = '<div class="al-msg">책 정보를 가져오는 중…</div>';
  let d = { '제목': x.title, '저자': x.author, '출판사': x.publisher, '표지URL': x.cover, 'ISBN': x.isbn13 || x.isbn10 || '' };
  try { const det = await call('bookDetail', x); d = Object.fromEntries(TB_FIELDS.filter(k => det[k] !== '' && det[k] != null).map(k => [k, det[k]])); } catch (e) {}
  tbAdd(d);
}
async function tbAdd(data) {
  if ((S.tg.tbooks || []).some(t => t.status === '예정' && tgSame(t.data, data))) { toast('이미 담겨 있어요'); return; }
  try {
    const r = await sbq(sbClient().from('together_books').insert({ pship: S.tg.partner.pship, data }).select('id, pship, data, added_by, status, joined, started_at, created_at').single());
    S.tg.tbooks.push(r); LS.set(TG_CACHE, JSON.stringify(S.tg)); notifyPartner('together', r.id);
    // 내 서재에 없던 책이면 '읽고 싶은 책'으로도 넣어요
    let added = false;
    if (!S.books.some(x => tgSame(x, data))) {
      try { const d = Object.assign({ ID: '', '상태': '읽을예정' }, Object.fromEntries(TB_FIELDS.filter(k => data[k] !== undefined && data[k] !== '').map(k => [k, data[k]])));
        updateBook(await call('saveBook', d)); added = true; } catch (e) {}
    }
    closeModal(); toast(`『${data['제목']}』를 같이 읽을 책에 담았어요${added ? ' · 내 읽고 싶은 책에도 넣었어요' : ''}`); renderTogether();
  } catch (e) { toast('⚠ ' + (e.message || e)); }
}
async function tbRemove(id) {
  const t = S.tg.tbooks.find(x => x.id === id); if (!t || !confirm(`『${t.data['제목']}』를 같이 읽을 책에서 뺄까요?`)) return;
  try { await sbq(sbClient().from('together_books').update({ deleted: true }).eq('id', id)); S.tg.tbooks = S.tg.tbooks.filter(x => x.id !== id); LS.set(TG_CACHE, JSON.stringify(S.tg)); renderTogether(); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
}
// (v2.12.4) '같이 시작하기'는 뺐어요 — 한 사람이 누르면 상대 서재가 강제로 바뀌어서. 읽기 시작은 각자 서재에서.
