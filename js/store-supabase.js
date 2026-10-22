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
async function sbLogout() { try { await sbClient().auth.signOut(); } catch (e) {} toast('로그아웃했어요'); openMigrate(); }

/* ----- 시트 기록 → Supabase 표 모양으로 ----- */
function migrationRows(uid) {
  const now = Date.now();
  const strip = o => { const d = Object.assign({}, o); delete d.ID; return d; };
  const books = S.books.map(b => ({ user_id: uid, id: String(b.ID), data: strip(b), shared: true, mtime: now }));
  const snippets = S.snips.map(s => ({ user_id: uid, id: String(s.ID), book_id: s['책ID'] ? String(s['책ID']) : null,
    kind: s['유형'] === '서평' ? '생각' : (s['유형'] || '인용'), data: strip(s), shared: false, mtime: now }));
  const notes = (S.notes || []).filter(n => !isTemp(n.ID)).map(n => ({ user_id: uid, id: String(n.ID), data: strip(n), mtime: Number(n['수정시각']) || now }));
  const memos = (S.memos || []).filter(m => !isLogRow(m)).map(m => ({ user_id: uid, id: String(m.ID), data: strip(m), mtime: now }));
  const reads = [];
  (S.logs || []).filter(isReadRow).forEach(m => { const l = parseLog(m); if (l && l.bid) reads.push({ user_id: uid, id: String(m.ID), book_id: String(l.bid), day: l.date, page: l.page, base_page: l.base, mtime: now }); });
  // 필사 순서: 책마다 가장 최근 것 (시트 · 이 기기 중)
  const orders = [];
  uniq(S.books.map(b => b.ID)).forEach(bid => { const ids = snipOrderOf(bid); if (ids && ids.length) orders.push({ user_id: uid, book_id: String(bid), ids: ids.map(String), mtime: now }); });
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
    if (S.outbox.length) { say('<span class="spin"></span> 시트에 남은 기록 올리는 중…'); await flush(); if (S.outbox.length) throw new Error('시트에 아직 못 올린 기록이 있어요. 인터넷을 확인하고 다시 눌러 주세요'); }
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
