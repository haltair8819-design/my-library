/* 나의 서재 — Supabase 연결 (구글 로그인 · 시트 → Supabase 옮기기)
 * 2단계: 지금은 '옮기기'만 해요. 앱의 저장 담당(Store)은 아직 구글 시트(SheetsStore)예요.
 * 3단계에서 같은 모양의 SupabaseStore를 만들어 Store를 바꿔 끼울 거예요. */

const SB = {
  url: 'https://zpbgssxftwckvjnrsdiw.supabase.co',
  key: 'sb_publishable_sCw5fIn7rEPcHrway4IZ3g_mj8Uq5ir',   // 공개용 키 (앱에 들어가도 되는 키)
  client: null
};
function sbClient() {
  if (SB.client) return SB.client;
  if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요');
  SB.client = window.supabase.createClient(SB.url, SB.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'mylib-auth' }
  });
  return SB.client;
}
async function sbUser() {
  try { const { data } = await sbClient().auth.getSession(); return data && data.session ? data.session.user : null; } catch (e) { return null; }
}
async function sbLogin(next) {
  const back = location.origin + location.pathname + (next ? '?' + next : '');
  const { error } = await sbClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } });
  if (error) toast('⚠ 로그인을 시작하지 못했어요: ' + error.message);
}
async function sbLogout() { try { await sbClient().auth.signOut(); } catch (e) {} if (Store === SupabaseStore) { IDB.del(CACHE_KEY); LS.del(OUTBOX_KEY); location.replace(location.pathname); return; } toast('로그아웃했어요'); openMigrate(); }

/* ----- 시트 기록 → Supabase 표 모양으로 ----- */
function migrationRows(uid) {
  // 고친 시각: 시트의 '수정시각'을 그대로 써요 → 여러 번 옮겨도 Supabase에서 더 나중에 고친 건 덮어쓰지 않아요
  const mt = o => Number(o && o['수정시각']) || 1;
  const strip = o => { const d = Object.assign({}, o); delete d.ID; return d; };
  const books = S.books.map(b => ({ user_id: uid, id: String(b.ID), data: strip(b), shared: true, mtime: mt(b) }));
  const snippets = S.snips.map(s => ({ user_id: uid, id: String(s.ID), book_id: s['책ID'] ? String(s['책ID']) : null,
    kind: s['유형'] === '서평' ? '생각' : (s['유형'] || '인용'), data: strip(s), shared: false, mtime: mt(s) }));
  const notes = (S.notes || []).filter(n => !isTemp(n.ID)).map(n => ({ user_id: uid, id: String(n.ID), data: strip(n), mtime: mt(n) }));
  const memos = (S.memos || []).filter(m => !isLogRow(m)).map(m => ({ user_id: uid, id: String(m.ID), data: strip(m), mtime: mt(m) }));
  const reads = [];
  (S.logs || []).filter(isReadRow).forEach(m => { const l = parseLog(m); if (l && l.bid) reads.push({ user_id: uid, id: String(m.ID), book_id: String(l.bid), day: l.date, page: l.page, base_page: l.base, mtime: mt(m) }); });
  // 필사 순서: 책마다 가장 최근 것 (시트 · 이 기기 중)
  const orders = [];
  uniq(S.books.map(b => b.ID)).forEach(bid => { const ids = snipOrderOf(bid); if (ids && ids.length) { const row = snipOrderRow(bid), lo = localOrders()[bid]; orders.push({ user_id: uid, book_id: String(bid), ids: ids.map(String), mtime: Math.max(row ? parseOrder(row).at : 0, lo ? lo.at || 0 : 0) || 1 }); } });
  // 같은 ID가 두 번 있으면 뒤의 것 하나만 (한 번에 올릴 때 겹치면 오류가 나서)
  const dedupe = (list, key) => [...new Map(list.map(x => [x[key], x])).values()];
  return { books: dedupe(books, 'id'), snippets: dedupe(snippets, 'id'), notes: dedupe(notes, 'id'), memos: dedupe(memos, 'id'),
    read_logs: dedupe(reads, 'id'), snippet_orders: dedupe(orders, 'book_id') };
}
const MIGRATE_TABLES = [['books', '책', 'user_id,id'], ['snippets', '필사 · 내 생각 · 메모', 'user_id,id'], ['notes', '노트', 'user_id,id'],
  ['memos', '메모 · 할 일', 'user_id,id'], ['read_logs', '독서 기록', 'user_id,id'], ['snippet_orders', '필사 순서', 'user_id,book_id']];

async function sbCount(table, uid) {
  const { count, error } = await sbClient().from(table).select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('deleted', false);
  if (error) throw new Error(table + ': ' + error.message);
  return count || 0;
}

/* ----- 옮기기 화면 ----- */
async function openMigrate() {
  modal(`<h3>새 저장소로 옮기기 <span style="font-weight:400;color:var(--faint);font-size:13px">구글 시트 → Supabase</span></h3><div id="mg-body"><div class="drill"><span class="spin"></span> 확인하는 중…</div></div>`);
  let user = null;
  try { user = await sbUser(); } catch (e) {}
  const body = $('mg-body'); if (!body) return;
  const done = (() => { try { return JSON.parse(LS.get('sb_migrated') || 'null'); } catch (e) { return null; } })();
  if (!user) {
    body.innerHTML = `<div class="small" style="line-height:1.7">둘이 함께 쓰는 버전으로 가기 위해, 지금 기록을 새 저장소(Supabase)로 <b>복사</b>해요.<br>
      구글 시트는 그대로 남아 백업이 되고, 지금 앱도 계속 시트로 저장돼요.</div>
      <div class="actions"><button class="btn" onclick="closeModal()">닫기</button><button class="btn primary grow" onclick="sbLogin('migrate=1')">Google로 로그인</button></div>`;
    return;
  }
  const rows = migrationRows(user.id);
  body.innerHTML = `<div class="small" style="line-height:1.7"><b>${esc(user.email || '')}</b> 계정으로 로그인했어요.
    ${done ? `<br>${esc(String(done.at).slice(0, 16).replace('T', ' '))}에 옮긴 적이 있어요. 다시 옮기면 바뀐 것만 덮어써요.` : ''}</div>
    <div class="panel2"><h4>옮길 기록</h4>${MIGRATE_TABLES.map(([t, label]) => `<div class="kw-row"><b style="font-weight:500">${label}</b><span id="mg-${t}">${rows[t].length.toLocaleString()}개</span></div>`).join('')}</div>
    ${S.outbox.length ? `<div class="notice">아직 시트에 안 올라간 기록이 ${S.outbox.length}개 있어요. 옮기기 전에 먼저 올릴게요.</div>` : ''}
    <div id="mg-msg" class="small" style="margin-top:10px"></div>
    <div class="actions"><button class="btn" onclick="sbLogout()">로그아웃</button><button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn primary grow" id="mg-go" onclick="migrateAll()">${done ? '다시 옮기기' : '옮기기 시작'}</button></div>`;
}

async function migrateAll() {
  const go = $('mg-go'), msg = $('mg-msg'); if (!go) return;
  const say = t => { if ($('mg-msg')) $('mg-msg').innerHTML = t; };
  go.disabled = true;
  try {
    const user = await sbUser(); if (!user) throw new Error('로그인이 풀렸어요. 다시 로그인해 주세요');
    // 1) 시트에 남은 것 먼저 올리고, 시트에서 전체를 새로 받아 최신 상태로
    if (S.outbox.length) {
      const total = S.outbox.length;
      const tick = setInterval(() => say(`<span class="spin"></span> 시트에 남은 기록 올리는 중… ${(total - S.outbox.length).toLocaleString()} / ${total.toLocaleString()} (하나에 1~3초)`), 500);
      let last = S.outbox.length, lastAt = Date.now();
      try {
        while (S.outbox.length && !S.outbox[0].error) {
          await flush();
          if (S.outbox.length !== last) { last = S.outbox.length; lastAt = Date.now(); }
          if (Date.now() - lastAt > 60000) break;   // 1분 동안 하나도 못 올리면 멈춤
          await new Promise(r => setTimeout(r, flushing ? 800 : 1500));
        }
      }
      finally { clearInterval(tick); }
      if (S.outbox.length) throw new Error('시트에 못 올린 기록이 있어요. 위쪽 ‘저장 실패’ 표시를 눌러 확인해 주세요');
    }
    say('<span class="spin"></span> 시트에서 전체 기록 받는 중…');
    const ok = await refresh(true); if (!ok) throw new Error('시트에서 기록을 받지 못했어요');
    const rows = migrationRows(user.id);
    // 2) 표마다 200개씩 올리기 (여러 번 눌러도 같은 기록은 덮어써서 겹치지 않아요)
    for (const [t, label, key] of MIGRATE_TABLES) {
      const list = rows[t];
      for (let i = 0; i < list.length; i += 200) {
        say(`<span class="spin"></span> ${label} 올리는 중… ${Math.min(i + 200, list.length).toLocaleString()} / ${list.length.toLocaleString()}`);
        const { error } = await sbClient().from(t).upsert(list.slice(i, i + 200), { onConflict: key });
        if (error) throw new Error(`${label}: ${error.message}`);
      }
    }
    // 3) 설정
    await sbClient().from('profiles').update({ settings: S.settings || {} }).eq('user_id', user.id);
    // 4) 개수 맞춰 보기
    say('<span class="spin"></span> 개수 맞춰 보는 중…');
    const res = []; let allOk = true;
    for (const [t, label] of MIGRATE_TABLES) {
      const n = await sbCount(t, user.id), want = rows[t].length, same = n >= want;
      if (!same) allOk = false;
      res.push({ t, label, n, want });
      const el = $('mg-' + t); if (el) el.innerHTML = `${same ? '✓' : '⚠'} ${n.toLocaleString()} / ${want.toLocaleString()}개`;
    }
    LS.set('sb_migrated', JSON.stringify({ at: new Date().toISOString(), email: user.email, res }));
    say(allOk ? '✓ 다 옮겼어요. 시트와 개수가 같아요. (시트는 백업으로 그대로 있어요)' : '⚠ 개수가 다른 표가 있어요. 위 숫자를 캡처해서 보내 주세요');
    if (allOk && Store !== SupabaseStore && $('mg-body')) $('mg-body').insertAdjacentHTML('beforeend', `<div class="panel2" style="margin-top:12px"><h4>이제 Supabase로 쓰기</h4>
      <div class="small" style="line-height:1.6">이 기기의 앱이 지금부터 Supabase에 저장해요. 시트는 그대로 백업으로 남고, 설정에서 언제든 시트로 돌아갈 수 있어요.</div>
      <div class="actions"><button class="btn primary grow" onclick="useStore('supabase')">Supabase로 바꾸기</button></div></div>`);
    go.textContent = '다시 옮기기';
  } catch (e) {
    say('⚠ ' + esc(e.message || e));
  } finally { if ($('mg-go')) $('mg-go').disabled = false; }
}

/* ----- 로그인하고 돌아왔을 때 옮기기 화면 다시 열기 ----- */
(() => {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('migrate') && !/access_token|error_description/.test(location.hash)) return;
  window.addEventListener('load', async () => {
    try { sbClient(); } catch (e) { return; }
    for (let i = 0; i < 40 && !(await sbUser()); i++) await new Promise(r => setTimeout(r, 250));   // 로그인 마무리 기다리기
    const err = p.get('error_description') || (location.hash.match(/error_description=([^&]+)/) || [])[1];
    try { history.replaceState(history.state, '', location.pathname); } catch (e) {}
    if (err) { toast('⚠ 로그인 실패: ' + decodeURIComponent(err.replace(/\+/g, ' '))); return; }
    if (p.has('migrate')) setTimeout(openMigrate, 600);
  });
})();

/* ===================================================================
   저장 담당: Supabase (SupabaseStore) — SheetsStore와 같은 모양
   앱 쪽 모양은 그대로 두고, 여기서 표 모양으로 바꿔 읽고 써요.
   · 독서 기록 · 필사 순서는 앱에서는 예전처럼 '메모 줄'로 보이고, 여기서 read_logs · snippet_orders 표로 바꿔요
   · 지우기는 '지움' 표시만 (다른 기기에서 되살아나지 않게), 고친 시각(mtime)이 늦은 쪽이 남아요
   =================================================================== */
const sbNewId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function sbSession() { try { const s = JSON.parse(LS.get('mylib-auth') || 'null'); return s && s.user ? s : null; } catch (e) { return null; } }
function sbUid() { const s = sbSession(); return s ? s.user.id : ''; }
function sbErr(e) {
  const msg = (e && (e.message || e.error_description)) || String(e);
  const err = new Error(/fetch|network|load failed/i.test(msg) ? (navigator.onLine === false ? '인터넷에 연결되어 있지 않아요' : '서버에 연결하지 못했어요') : msg);
  if (/fetch|network|load failed/i.test(msg) || navigator.onLine === false) err.network = true;
  return err;
}
async function sbq(p) { let r; try { r = await p; } catch (e) { throw sbErr(e); } if (r.error) throw sbErr(r.error); return r.data; }
const sbOut = r => Object.assign({}, r.data || {}, { ID: r.id });
const sbToday = () => S.today || localToday();
function sbDays(a, b) {
  if (!a || !b) return '';
  const d = Math.round((new Date(String(b).slice(0, 10) + 'T00:00:00') - new Date(String(a).slice(0, 10) + 'T00:00:00')) / 86400000) + 1;
  return d > 0 ? d : '';
}
const sbNormKw = k => uniq(String(k || '').split(/[,#\n]/).map(x => x.trim())).join(', ');
function sbStrip(o) { const d = Object.assign({}, o); delete d.ID; delete d._cid; return d; }

// 한 줄 가져오기 (없으면 null)
async function sbGet(table, id) {
  const r = await sbq(sbClient().from(table).select('id, data, deleted').eq('user_id', sbUid()).eq('id', id).maybeSingle());
  return r && !r.deleted ? r : null;
}
async function sbPut(table, id, data, extra) {
  const row = Object.assign({ user_id: sbUid(), id, data, mtime: Date.now(), deleted: false }, extra || {});
  await sbq(sbClient().from(table).upsert(row, { onConflict: 'user_id,id' }));
  return Object.assign({}, data, { ID: id });
}
async function sbSoftDelete(table, id, key) {
  await sbq(sbClient().from(table).update({ deleted: true, mtime: Date.now() }).eq('user_id', sbUid()).eq(key || 'id', id));
}

/* ----- 독서 기록 · 필사 순서 ↔ 앱의 '메모 줄' ----- */
const sbLogRow = r => ({ ID: r.id, '종류': '독서기록', '내용': logText(r.day, r.page, r.base_page), '책ID': r.book_id, '완료': false, '작성일': String(r.created_at || '').slice(0, 10) });
const sbOrderRow = r => ({ ID: 'O:' + r.book_id, '종류': '필사순서', '내용': `순서@${r.mtime || 0}:${(r.ids || []).join(',')}`, '책ID': r.book_id, '완료': false });

/* ----- 바뀐 것만 받기 ----- */
async function sbPull(table, cols, since) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sbClient().from(table).select(cols).eq('user_id', sbUid()).order('updated_at', { ascending: true }).range(from, from + 999);
    if (since) q = q.gte('updated_at', since);
    const rows = await sbq(q);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function sbSync(ver) {
  if (!sbUid()) { const e = new Error('로그인이 필요해요'); throw e; }
  const full = !ver;
  const since = full ? null : new Date(Number(ver) - 5000).toISOString();   // 저장과 겹칠 때를 위한 여유 5초
  const C = 'id, data, deleted, updated_at';
  const [b, s, m, n, l, o, prof] = await Promise.all([
    sbPull('books', C, since), sbPull('snippets', C, since), sbPull('memos', C, since), sbPull('notes', C, since),
    sbPull('read_logs', 'id, book_id, day, page, base_page, deleted, created_at, updated_at', since),
    sbPull('snippet_orders', 'book_id, ids, mtime, deleted, updated_at', since),
    sbq(sbClient().from('profiles').select('settings').eq('user_id', sbUid()).maybeSingle())
  ]);
  let maxAt = Number(ver) || 0;
  [b, s, m, n, l, o].forEach(list => list.forEach(r => { const t = Date.parse(r.updated_at); if (t > maxAt) maxAt = t; }));
  const live = list => list.filter(r => !r.deleted);
  const deleted = [];
  if (!full) {
    b.filter(r => r.deleted).forEach(r => deleted.push({ t: '책', id: r.id }));
    s.filter(r => r.deleted).forEach(r => deleted.push({ t: '필사', id: r.id }));
    m.filter(r => r.deleted).forEach(r => deleted.push({ t: '메모', id: r.id }));
    n.filter(r => r.deleted).forEach(r => deleted.push({ t: '노트', id: r.id }));
    l.filter(r => r.deleted).forEach(r => deleted.push({ t: '메모', id: r.id }));
    o.filter(r => r.deleted).forEach(r => deleted.push({ t: '메모', id: 'O:' + r.book_id }));
  }
  const settings = Object.assign({ goal: '', libraryUrl: '', libraryName: '' }, (prof && prof.settings) || {});
  const memos = live(m).map(sbOut).concat(live(l).map(sbLogRow), live(o).map(sbOrderRow));
  const base = { ver: String(maxAt || Date.now()), today: localToday(), settings };
  if (!full && !b.length && !s.length && !m.length && !n.length && !l.length && !o.length) return Object.assign(base, { same: true });
  return Object.assign(base, { full, books: live(b).map(sbOut), snippets: live(s).map(sbOut), memos, notes: live(n).map(sbOut), deleted });
}

/* ----- 책 ----- */
async function sbSaveBook(b) {
  b = sbStrip(b || {});
  if (!String(b['제목'] || '').trim()) throw new Error('책 제목을 입력해 주세요.');
  let id = (arguments[0] || {}).ID;
  const cur = id ? await sbGet('books', id) : null;
  const d = Object.assign({}, cur ? cur.data : {}, b);
  if (!id) { id = sbNewId('B'); d['등록일'] = sbToday(); if (!d['상태']) d['상태'] = d['완독일'] ? '완독' : '읽는중'; }
  if (d['완독일'] && d['상태'] !== '완독') d['상태'] = '완독';
  d['완독일수'] = sbDays(d['시작일'], d['완독일']);
  return sbPut('books', id, d);
}
async function sbFinishBook(id) {
  const cur = await sbGet('books', id); if (!cur) throw new Error('책을 찾을 수 없어요.');
  const d = Object.assign({}, cur.data, { '완독일': sbToday(), '상태': '완독' });
  if (!d['시작일']) d['시작일'] = d['완독일'];
  d['완독일수'] = sbDays(d['시작일'], d['완독일']);
  return sbPut('books', id, d);
}
async function sbUpdateBookFields(id, patch) {
  const allowed = ['현재쪽수', '반납일', '별점', '한줄평', '상태', '시작일', '플랫폼', '대분류', '중분류', '개인분류'];
  const cur = await sbGet('books', id); if (!cur) throw new Error('책을 찾을 수 없어요.');
  const d = Object.assign({}, cur.data);
  Object.keys(patch || {}).forEach(k => { if (allowed.includes(k)) d[k] = patch[k]; });
  if (d['현재쪽수'] !== undefined && d['현재쪽수'] !== '') d['현재쪽수'] = Number(d['현재쪽수']) || '';
  if (d['별점'] !== undefined && d['별점'] !== '') d['별점'] = Math.max(1, Math.min(5, Number(d['별점']) || 0)) || '';
  return sbPut('books', id, d);
}
async function sbDeleteBook(id) {
  await sbq(sbClient().from('snippets').update({ deleted: true, mtime: Date.now() }).eq('user_id', sbUid()).eq('book_id', id));
  await sbSoftDelete('books', id);
  return id;
}

/* ----- 필사 ----- */
async function sbSaveSnippet(s) {
  const id0 = (s || {}).ID; s = sbStrip(s || {});
  if (!String(s['내용'] || '').trim()) throw new Error('내용을 입력해 주세요.');
  const bk = book(s['책ID']) || (await sbGet('books', s['책ID']) ? sbOut(await sbGet('books', s['책ID'])) : null);
  if (!bk) throw new Error('연결된 책을 찾을 수 없어요.');
  const cur = id0 ? await sbGet('snippets', id0) : null;
  const d = Object.assign({}, cur ? cur.data : {}, s, { '책제목': bk['제목'], '키워드': sbNormKw(s['키워드'] !== undefined ? s['키워드'] : (cur && cur.data['키워드'])) });
  let id = id0;
  if (!id) { id = sbNewId('S'); d['작성일'] = sbToday(); if (!d['출처']) d['출처'] = '직접입력'; }
  const kind = d['유형'] === '서평' ? '생각' : (d['유형'] || '인용');
  return sbPut('snippets', id, d, { book_id: String(d['책ID']), kind });
}
async function sbDeleteSnippet(id) { await sbSoftDelete('snippets', id); return id; }

/* ----- 메모 · 할 일 (+ 독서 기록 · 필사 순서) ----- */
async function sbSaveMemo(m) {
  const id0 = (m || {}).ID; m = sbStrip(m || {});
  if (m['종류'] === '독서기록') {
    const r = LOG_RE.exec(String(m['내용'] || '')); if (!r || !m['책ID']) throw new Error('독서 기록 모양이 맞지 않아요');
    const id = id0 || sbNewId('L');
    await sbq(sbClient().from('read_logs').upsert({ user_id: sbUid(), id, book_id: String(m['책ID']), day: r[1], page: Number(r[2]), base_page: r[3] != null ? Number(r[3]) : null, mtime: Date.now(), deleted: false }, { onConflict: 'user_id,id' }));
    return Object.assign({ '작성일': sbToday() }, m, { ID: id });
  }
  if (m['종류'] === '필사순서') {
    const o = parseOrder({ '내용': m['내용'] }); const bid = String(m['책ID'] || '');
    if (!bid) throw new Error('필사 순서에 책이 없어요');
    await sbq(sbClient().from('snippet_orders').upsert({ user_id: sbUid(), book_id: bid, ids: o.ids, mtime: o.at || Date.now(), deleted: false }, { onConflict: 'user_id,book_id' }));
    return Object.assign({}, m, { ID: 'O:' + bid });
  }
  if (!String(m['내용'] || '').trim()) throw new Error('내용을 입력해 주세요.');
  const cur = id0 ? await sbGet('memos', id0) : null;
  const d = Object.assign({}, cur ? cur.data : {}, m);
  d['종류'] = d['종류'] === '할일' ? '할일' : '메모';
  const done = d['완료'] === true || d['완료'] === 'TRUE' || d['완료'] === 'true';
  d['완료'] = done;
  let id = id0;
  if (!id) { id = sbNewId('M'); d['작성일'] = sbToday(); }
  if (done && !d['완료일']) d['완료일'] = sbToday();
  if (!done) d['완료일'] = '';
  return sbPut('memos', id, d);
}
async function sbDeleteMemo(id) {
  if (String(id).startsWith('O:')) { await sbSoftDelete('snippet_orders', String(id).slice(2), 'book_id'); return id; }
  await sbSoftDelete('memos', id);
  await sbSoftDelete('read_logs', id);
  return id;
}

/* ----- 노트 ----- */
async function sbSaveNote(n, snapshot) {
  const id0 = (n || {}).ID; n = sbStrip(n || {});
  const body = String(n['본문'] || '');
  if (body.length > 49000) throw new Error('글이 너무 길어요. 한 노트는 4만 9천 자까지라 두 개로 나눠 주세요.');
  if (!String(n['제목'] || '').trim() && !body.trim()) throw new Error('제목이나 내용을 입력해 주세요.');
  const cur = id0 ? await sbGet('notes', id0) : null;
  const d = Object.assign({}, cur ? cur.data : {}, n);
  if (!['메모', '초안', '완성', '발행'].includes(d['상태'])) d['상태'] = '초안';
  d['키워드'] = sbNormKw(d['키워드']);
  d['글자수'] = body.replace(/\s/g, '').length;
  d['수정일'] = sbToday(); d['수정시각'] = Date.now();
  let id = id0;
  if (!id) { id = sbNewId('N'); d['작성일'] = sbToday(); }
  const saved = await sbPut('notes', id, d);
  if (snapshot) {
    const last = await sbq(sbClient().from('note_versions').select('id, data').eq('user_id', sbUid()).eq('note_id', id).order('created_at', { ascending: false }).limit(31));
    const prev = last[0] && last[0].data;
    if (!prev || prev['제목'] !== d['제목'] || prev['본문'] !== d['본문']) {
      await sbq(sbClient().from('note_versions').insert({ user_id: sbUid(), note_id: id, data: { '제목': d['제목'] || '', '본문': body } }));
      const old = last.slice(29).map(x => x.id);   // 최근 30개만 보관
      if (old.length) await sbq(sbClient().from('note_versions').delete().in('id', old));
    }
  }
  return saved;
}
async function sbDeleteNote(id) { await sbSoftDelete('notes', id); return id; }
async function sbNoteVersions(id) {
  const rows = await sbq(sbClient().from('note_versions').select('data, created_at').eq('user_id', sbUid()).eq('note_id', id).order('created_at', { ascending: false }).limit(30));
  return rows.map(r => ({ at: Date.parse(r.created_at), '제목': (r.data || {})['제목'] || '', '본문': (r.data || {})['본문'] || '' }));
}

/* ----- 설정 · 키워드 ----- */
async function sbSaveSettings(s) {
  const cur = await sbq(sbClient().from('profiles').select('settings').eq('user_id', sbUid()).maybeSingle());
  const next = Object.assign({}, (cur && cur.settings) || {});
  ['goal', 'libraryUrl', 'libraryName'].forEach(k => { if (s && s[k] !== undefined) next[k] = k === 'goal' ? (Number(s[k]) || '') : String(s[k] || '').trim(); });
  Object.keys(s || {}).forEach(k => { if (!['goal', 'libraryUrl', 'libraryName'].includes(k)) next[k] = s[k]; });
  await sbq(sbClient().from('profiles').upsert({ user_id: sbUid(), settings: next }, { onConflict: 'user_id' }));
  return Object.assign({ goal: '', libraryUrl: '', libraryName: '' }, next);
}
async function sbRenameKeyword(from, to) {
  from = String(from || '').trim(); to = String(to || '').replace(/^#/, '').trim();
  if (!from) throw new Error('바꿀 키워드를 골라 주세요.');
  const rows = await sbPull('snippets', 'id, data, book_id, kind, deleted, updated_at', null);
  const up = [];
  rows.filter(r => !r.deleted).forEach(r => {
    const ks = String((r.data || {})['키워드'] || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!ks.includes(from)) return;
    const next = []; ks.forEach(k => { const v = k === from ? to : k; if (v && !next.includes(v)) next.push(v); });
    up.push({ user_id: sbUid(), id: r.id, data: Object.assign({}, r.data, { '키워드': next.join(', ') }), mtime: Date.now() });
  });
  for (let i = 0; i < up.length; i += 200) await sbq(sbClient().from('snippets').upsert(up.slice(i, i + 200), { onConflict: 'user_id,id' }));
  return up.length;
}

/* ----- 서버 기능 (AI · 책 검색) ----- */
const SB_LONG = { autoKeywords: 1, askAssistant: 1, scanPage: 1, transcribeAudio: 1 };
async function sbFn(fn, args) {
  let token = '';
  try { const { data } = await sbClient().auth.getSession(); token = data && data.session ? data.session.access_token : ''; } catch (e) {}
  if (!token) throw new Error('로그인이 필요해요');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SB_LONG[fn] ? 160000 : 60000);
  let r;
  try {
    r = await fetch(SB.url + '/functions/v1/api', { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: SB.key }, body: JSON.stringify({ fn, args }) });
  } catch (e) { const err = new Error(navigator.onLine === false ? '인터넷에 연결되어 있지 않아요' : '서버에 연결하지 못했어요'); err.network = true; throw err; }
  finally { clearTimeout(timer); }
  let j; try { j = await r.json(); } catch (e) { const err = new Error('서버 답을 읽지 못했어요 (' + r.status + ')'); err.network = r.status >= 500; throw err; }
  if (!j.ok) throw new Error(j.error || '알 수 없는 오류');
  return j.data;
}

const SB_FNS = {
  ping: async () => ({ ok: true, today: localToday() }),
  sync: sbSync, saveBook: sbSaveBook, finishBook: sbFinishBook, deleteBook: sbDeleteBook, updateBookFields: sbUpdateBookFields,
  saveSnippet: sbSaveSnippet, deleteSnippet: sbDeleteSnippet, saveMemo: sbSaveMemo, deleteMemo: sbDeleteMemo,
  saveNote: sbSaveNote, deleteNote: sbDeleteNote, getNoteVersions: sbNoteVersions,
  saveSettings: sbSaveSettings, getSettings: async () => (await sbSync('')).settings, renameKeyword: sbRenameKeyword
};
['askAssistant', 'suggestKeywords', 'autoKeywords', 'scanPage', 'suggestTitle', 'noteAssist', 'transcribeAudio', 'bookSearch', 'bookDetail']
  .forEach(fn => { SB_FNS[fn] = (...args) => sbFn(fn, args); });

function openSbLogin() {
  modal(`<h3>나의 서재</h3>
    <div class="small" style="line-height:1.7;margin-bottom:6px">구글 계정으로 시작해요. 처음이면 빈 서재가 열리고, 쓰던 기록이 있으면 그대로 불러와요.</div>
    <div class="actions"><button class="btn primary grow" onclick="sbLogin()">Google로 시작하기</button></div>
    ${API.url ? `<button class="note-link" onclick="useStore('sheets')">예전처럼 구글 시트로 쓰기 <span>설정 바꾸기</span></button>` : ''}`);
}
const SupabaseStore = {
  kind: 'supabase',
  label: 'Supabase',
  ready: () => !!sbUid(),
  run: (fn, ...args) => {
    const f = SB_FNS[fn];
    if (!f) return Promise.reject(new Error('알 수 없는 요청이에요: ' + fn));
    if (!sbUid()) { const e = new Error('로그인이 필요해요'); e.network = true; return Promise.reject(e); }
    return f(...args);
  },
  openSetup: () => openSbLogin()
};

// 어느 저장소를 쓸지: 고른 적 있으면 그것, 시트 연결이 없는 새 기기(여자친구 폰 등)는 Supabase
function useStore(kind) {
  if (S.outbox.length && !confirm(`아직 올라가지 않은 기록 ${S.outbox.length}개가 있어요. 그래도 바꿀까요? (그 기록은 이 기기에만 남아요)`)) return;
  LS.set('store_kind', kind);
  IDB.del(CACHE_KEY); LS.del(CACHE_KEY); LS.del(OUTBOX_KEY);
  location.replace(location.pathname);
}
if ((LS.get('store_kind') || (API.url ? 'sheets' : 'supabase')) === 'supabase') Store = SupabaseStore;

// 로그인을 마치고 돌아오면 (또는 로그인 상태가 바뀌면) 서재 열기
window.addEventListener('load', () => {
  if (Store !== SupabaseStore) return;
  let c; try { c = sbClient(); } catch (e) { return; }
  c.auth.onAuthStateChange((ev) => {
    if ((ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') && sbUid() && S.needLogin && !S.loaded) { S.needLogin = false; setTimeout(() => { closeModal(); boot(); }, 50); }
    if (ev === 'SIGNED_OUT') { IDB.del(CACHE_KEY); LS.del(OUTBOX_KEY); location.replace(location.pathname); }
  });
});
