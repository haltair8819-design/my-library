// 나의 서재 — 서버 기능 (Supabase Edge Function)
// 예전 Apps Script의 AI · 책 검색을 옮긴 것. 로그인한 사람의 기록만 읽어요 (행 보안 그대로).
// 비밀값 (Supabase → Edge Functions → Secrets): GEMINI_API_KEY, KAKAO_REST_KEY, (선택) NL_CERT_KEY, GEMINI_MODEL
// 폰 알림 키(VAPID)는 처음 쓸 때 서버가 스스로 만들어 private.kv에 보관해요. 예약 작업은 x-cron 암호(private.kv)로 확인
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const env = (k: string) => (Deno.env.get(k) || '').trim();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Row = Record<string, any>;
type Ctx = { sb: any; uid: string; cache: Record<string, Row[]> };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 예약 작업 (Supabase 안의 pg_cron이 불러요): 암호가 맞을 때만
    const cronTok = req.headers.get('x-cron');
    if (cronTok) {
      const admin = adminClient();
      const { data: tok } = await admin.rpc('app_kv_get', { key: 'cron_token' });
      if (!tok || tok !== cronTok) return json({ ok: false, error: 'forbidden' }, 403);
      const { fn, args } = await req.json();
      const f = CRON_FNS[fn]; if (!f) return json({ ok: false, error: 'unknown cron ' + fn });
      return json({ ok: true, data: await f(admin, ...(args || [])) });
    }
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return json({ ok: false, error: '로그인이 필요해요' }, 401);
    const { fn, args } = await req.json();
    const ctx: Ctx = { sb, uid: u.user.id, cache: {} };
    const f = FNS[fn];
    if (!f) return json({ ok: false, error: '알 수 없는 요청이에요: ' + fn });
    const data = await f(ctx, ...(args || []));
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: String((e && (e as Error).message) || e) });
  }
});

/* ---------- 내 기록 읽기 ---------- */
async function rows(ctx: Ctx, table: string): Promise<Row[]> {
  if (ctx.cache[table]) return ctx.cache[table];
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb.from(table).select('id, data').eq('user_id', ctx.uid).eq('deleted', false).range(from, from + 999);
    if (error) throw new Error(error.message);
    (data || []).forEach((r: Row) => out.push({ ...(r.data || {}), ID: r.id }));
    if (!data || data.length < 1000) break;
  }
  return (ctx.cache[table] = out);
}
const books = (c: Ctx) => rows(c, 'books');
const snips = (c: Ctx) => rows(c, 'snippets');

/* ---------- 작은 도우미 ---------- */
const clip = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const uniq = <T>(a: T[]) => a.filter((x, i) => x && a.indexOf(x) === i);
function keywordVocab(list: Row[], limit = 50) {
  const m: Record<string, number> = {};
  list.forEach(s => String(s['키워드'] || '').split(',').forEach(k => { k = k.trim(); if (k) m[k] = (m[k] || 0) + 1; }));
  return Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, limit);
}
function parseJson(out: string) {
  let s = String(out || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  const a = s.indexOf('{'), z = s.lastIndexOf('}');
  if (a >= 0 && z > a) s = s.slice(a, z + 1);
  try { return JSON.parse(s); } catch { throw new Error('AI 답을 읽지 못했어요. 한 번만 다시 해보세요.'); }
}
const cleanText = (t: unknown) => String(t || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
function pageNum(p: unknown) {
  if (/%|위치|loc/i.test(String(p || ''))) return '';
  const nums = String(p || '').split(/\/|\bof\b/)[0].match(/\d{1,4}/g);
  if (!nums) return '';
  let list = nums.map(Number).filter(n => n > 0);
  if (list.length === 2 && /[-~–]/.test(String(p)) && list[1] > list[0] && list[1] - list[0] <= 3) { const r = []; for (let n = list[0]; n <= list[1]; n++) r.push(n); list = r; }
  list = list.filter((n, i) => list.indexOf(n) === i).sort((a, b) => a - b).slice(0, 4);
  return list.join(', ');
}
const kwClean = (ks: unknown[]) => uniq((ks || []).map(k => String(k).replace(/^#/, '').replace(/\s+/g, '').trim()).filter(k => k && k.length <= 12)).slice(0, 3);

/* ---------- Gemini ---------- */
const AI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
let lastOk = '';
async function llm(system: string, messages: Row[], maxTokens = 1024, asJson = false): Promise<string> {
  const key = env('GEMINI_API_KEY');
  if (!key) throw new Error('Gemini API 키가 아직 없어요. Supabase → Edge Functions → Secrets에 GEMINI_API_KEY를 넣어 주세요.');
  const payload: Row = {
    contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: m.parts || [{ text: String(m.content) }] })),
    generationConfig: { maxOutputTokens: maxTokens }
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (asJson) payload.generationConfig.responseMimeType = 'application/json';
  const models = uniq([env('GEMINI_MODEL'), lastOk, ...FALLBACK_MODELS].filter(Boolean));
  const tried: string[] = []; let quota = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(AI_URL + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (res.status === 200) {
        const data = JSON.parse(text);
        const cand = (data.candidates || [])[0];
        if (!cand || !cand.content) {
          const why = (data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || '알 수 없음';
          throw new Error('답을 받지 못했어요 (' + why + '). 질문을 조금 바꿔 다시 해보세요.');
        }
        lastOk = model;
        return (cand.content.parts || []).filter((p: Row) => p.text && !p.thought).map((p: Row) => p.text).join('').trim();
      }
      let msg = ''; try { msg = JSON.parse(text).error.message; } catch { msg = text.slice(0, 200); }
      if (res.status === 400 && /API key/i.test(msg)) throw new Error('Gemini API 키가 맞지 않아요. 키를 다시 확인해 주세요.');
      if (res.status === 403) throw new Error('Gemini API 사용 권한이 없어요 (403): ' + msg);
      if (res.status >= 500) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); tried.push(model + ' ' + res.status); continue; }
      tried.push(model + ' ' + res.status + (msg ? ' ' + msg.slice(0, 80) : ''));
      if (res.status === 429) quota++;
      break;
    }
  }
  if (quota && quota === models.length) throw new Error('무료 사용량 한도에 걸렸어요. 1분쯤 뒤 다시 해보고, 계속되면 오늘 한도를 다 쓴 거예요 (한국 시간 오후 4~5시쯤 초기화).');
  throw new Error('Gemini 응답을 받지 못했어요. 시도 결과: ' + tried.join(' / '));
}

/* ---------- AI 비서 ---------- */
const STOP = ['내가', '나의', '내', '책', '책에서', '문장', '필사', '찾아줘', '알려줘', '정리해줘', '추천해줘', '뭐야', '무엇', '어떤', '관련', '대해', '대한', '있어', '있는', '해줘', '좀', '그리고', '에서', '중에', '것', '수'];
function localTerms(q: string) {
  return uniq(String(q).replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/)
    .map(w => w.replace(/(은|는|이|가|을|를|에|의|로|으로|과|와|도|만|에서|에게|이랑|랑|하고|까지|부터|처럼|보다|이란|란)$/, '').replace(/(했던|하는|해서|했어|해줘|한)$/, ''))
    .filter(w => w.length >= 2 && STOP.indexOf(w) < 0));
}
function localPlan(question: string, bs: Row[], ss: Row[]) {
  const q = String(question).toLowerCase().replace(/\s+/g, '');
  const terms = localTerms(question);
  keywordVocab(ss, 300).forEach(k => { if (k.length >= 2 && q.indexOf(k.toLowerCase()) >= 0) terms.push(k); });
  const hit: string[] = [];
  bs.forEach(b => {
    const t = String(b['제목']).replace(/\(.*?\)/g, '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
    const a = String(b['저자'] || '').split(/[,(]/)[0].toLowerCase().replace(/\s+/g, '');
    if ((t.length >= 2 && q.indexOf(t) >= 0) || (a.length >= 2 && q.indexOf(a) >= 0)) hit.push(b['제목']);
  });
  return { terms: uniq(terms), books: hit };
}
function retrieve(plan: Row, list: Row[], bs: Row[]) {
  const norm = (s: unknown) => String(s || '').toLowerCase();
  const terms = plan.terms.map(norm).filter(Boolean);
  const want: Record<string, boolean> = {};
  (plan.books || []).forEach((t: string) => {
    const nt = norm(t).replace(/\s/g, '');
    bs.forEach(b => { const bt = norm(b['제목']).replace(/\s/g, ''); if (nt && (bt.indexOf(nt) >= 0 || nt.indexOf(bt) >= 0 || norm(b['저자']).replace(/\s/g, '').indexOf(nt) >= 0)) want[b.ID] = true; });
  });
  const title: Record<string, string> = {}; bs.forEach(b => title[b.ID] = norm(b['제목'] + ' ' + b['저자']));
  const scored = list.map(s => {
    const body = norm(s['내용']), head = norm(s['제목']), kw = norm(s['키워드']), bt = title[s['책ID']] || '';
    let sc = 0;
    terms.forEach((t: string) => {
      if (kw.indexOf(t) >= 0) sc += 6; if (head.indexOf(t) >= 0) sc += 4; if (bt.indexOf(t) >= 0) sc += 2;
      const c = body.split(t).length - 1; if (c) sc += 2 + Math.min(c, 4);
    });
    if (want[s['책ID']]) sc += 5;
    return { s, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
  const out: Row[] = []; let chars = 0;
  for (let i = 0; i < scored.length && out.length < 40; i++) {
    const len = Math.min(1500, String(scored[i].s['내용']).length);
    if (chars + len > 60000) break;
    out.push(scored[i].s); chars += len;
  }
  return out;
}
function catalog(bs: Row[], ss: Row[]) {
  const n: Record<string, number> = {}; ss.forEach(s => n[s['책ID']] = (n[s['책ID']] || 0) + 1);
  return bs.map(b => [b.ID, b['제목'], (b['저자'] || '') + (b['옮긴이'] ? ' (옮긴이 ' + b['옮긴이'] + ')' : ''), [b['대분류'], b['중분류']].filter(Boolean).join('>'),
    '개인분류:' + (b['개인분류'] || '-'), b['상태'], '완독:' + (b['완독일'] || '-'), (b['분량'] ? b['분량'] + '쪽' : ''),
    (b['완독일수'] ? b['완독일수'] + '일' : ''), '필사 ' + (n[b.ID] || 0)].join(' | ')).join('\n');
}
function statsText(bs: Row[], ss: Row[]) {
  const done = bs.filter(b => b['상태'] === '완독' && b['완독일']);
  const count = (arr: Row[], f: (b: Row) => string) => { const m: Record<string, number> = {}; arr.forEach(b => { const k = f(b) || '미분류'; m[k] = (m[k] || 0) + 1; }); return Object.keys(m).sort((a, b) => m[b] - m[a]).map(k => k + ' ' + m[k]).join(', '); };
  return ['완독 ' + done.length + '권 · 읽는 중 ' + bs.filter(b => b['상태'] === '읽는중').length + '권 · 필사 ' + ss.length + '개',
    '연도별 완독: ' + count(done, b => String(b['완독일']).slice(0, 4)), '월별 완독: ' + count(done, b => String(b['완독일']).slice(0, 7)),
    '대분류: ' + count(done, b => b['대분류']), '개인분류: ' + count(done, b => b['개인분류']), '경로: ' + count(done, b => b['경로']),
    '자주 쓴 키워드: ' + keywordVocab(ss, 25).join(', ')].join('\n');
}

async function askAssistant(ctx: Ctx, question: string, history: Row[]) {
  question = String(question || '').trim();
  if (!question) throw new Error('질문을 입력해 주세요.');
  const [bs, ss, notes, memos] = await Promise.all([books(ctx), snips(ctx), rows(ctx, 'notes'), rows(ctx, 'memos')]);
  const plan = localPlan(question, bs, ss);
  const picked = retrieve(plan, ss, bs);
  const asItems = (rs: Row[], t: string, body: string) => rs.map(r => ({ ID: r.ID, '제목': r[t] || '', '내용': r[body] || '', '키워드': r['키워드'] || '', '책ID': r['책ID'] || '', src: r }));
  const pickedNotes = retrieve(plan, asItems(notes, '제목', '본문'), bs).slice(0, 6);
  const pickedMemos = retrieve(plan, asItems(memos, '', '내용'), bs).slice(0, 12);
  const bookTitle: Record<string, string> = {}; bs.forEach(b => bookTitle[b.ID] = b['제목']);
  const context = '## 내 서재 (책 ' + bs.length + '권)\n' + catalog(bs, ss) + '\n\n## 독서 통계\n' + statsText(bs, ss) + '\n\n' +
    '## 질문과 관련해 찾은 내 필사 (' + picked.length + '개)\n' +
    (picked.length ? picked.map(s => '[' + s.ID + '] 책: ' + bookTitle[s['책ID']] + (s['쪽수'] !== '' && s['쪽수'] != null ? ' (p.' + s['쪽수'] + ')' : '') +
      (s['제목'] ? ' / 제목: ' + s['제목'] : '') + (s['키워드'] ? ' / 키워드: ' + s['키워드'] : '') + '\n' + clip(s['내용'], 1500)).join('\n\n') : '(관련 필사를 찾지 못함)') +
    (pickedNotes.length ? '\n\n## 질문과 관련해 찾은 내가 쓴 글 (' + pickedNotes.length + '개)\n' + pickedNotes.map(n => '[' + n.ID + '] 글: ' + n['제목'] + (n['키워드'] ? ' / 키워드: ' + n['키워드'] : '') + '\n' + clip(n['내용'], 2500)).join('\n\n') : '') +
    (pickedMemos.length ? '\n\n## 질문과 관련해 찾은 내 메모 · 할 일 (' + pickedMemos.length + '개)\n' + pickedMemos.map(m => '[' + m.ID + '] ' + (m.src['종류'] === '할일' ? '할 일' + (m.src['마감일'] ? '(' + m.src['마감일'] + ')' : '') + (m.src['완료'] === true ? ' 끝냄' : '') : '메모') + ': ' + clip(m['내용'], 400)).join('\n') : '');
  const system = ['너는 이 사용자의 개인 독서 비서다. 사용자가 직접 기록한 서재 · 통계 · 필사 노트를 바탕으로 한국어로 답한다.', '규칙:',
    '1. 사용자의 필사 · 글 · 메모를 인용하거나 근거로 쓸 때는 그 문장 바로 뒤에 출처 ID를 대괄호로 붙인다 (예: [S000123] [N000012] [M000003]). 제공된 기록에 없는 문장을 지어내지 않는다.',
    '2. 인용할 때는 필사 원문을 그대로 쓰되 필요한 부분만 짧게 쓴다.',
    '3. 찾은 필사에 답이 없으면 없다고 솔직히 말하고, 어떤 키워드로 다시 물으면 좋을지 제안한다.',
    '4. 통계 질문은 제공된 서재 목록과 통계 숫자로만 답한다. 계산이 필요하면 목록에서 직접 센다.',
    '5. 책 추천은 서재에 없는 책 3~5권을, 사용자의 기록(분류 · 저자 · 필사 주제) 중 무엇과 이어지는지 이유를 붙여 제안한다. 확실하지 않은 서지 정보는 단정하지 않는다.',
    '6. 짧은 문단과 필요한 만큼의 목록으로 읽기 쉽게 쓴다. 제목은 쓰지 않는다.'].join('\n');
  const msgs: Row[] = [];
  (history || []).slice(-6).forEach(h => { if (h && h.text) msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text).slice(0, 4000) }); });
  msgs.push({ role: 'user', content: context + '\n\n---\n질문: ' + question });
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const answer = await llm(system, msgs, 2500, false);
  const allIds = new Set([...ss.map(s => s.ID), ...notes.map(n => n.ID), ...memos.map(m => m.ID)]);
  const ids = uniq((answer.match(/\[([A-Za-z0-9_-]{2,40})\]/g) || []).map(x => x.slice(1, -1))).filter(id => allIds.has(id));
  const byId: Record<string, Row> = {};
  ss.forEach(s => byId[s.ID] = { id: s.ID, kind: 'snip', bookId: s['책ID'], book: bookTitle[s['책ID']] || '', page: s['쪽수'], title: s['제목'] || '' });
  notes.forEach(n => byId[n.ID] = { id: n.ID, kind: 'note', book: '내 글', page: '', title: n['제목'] || '' });
  memos.forEach(m => byId[m.ID] = { id: m.ID, kind: 'memo', book: m['종류'] === '할일' ? '할 일' : '메모', page: '', title: clip(m['내용'], 30) });
  return { answer, cites: ids.map(id => byId[id]).filter(Boolean), found: picked.length + pickedNotes.length + pickedMemos.length };
}

/* ---------- 키워드 ---------- */
async function keywordBatch(items: Row[], vocab: string[]) {
  const sys = ['너는 독서 노트에 키워드를 다는 도우미다. 각 필사 덩어리의 핵심 주제를 한국어 키워드 2~3개로 뽑는다.',
    '규칙: 책 제목 · 인물 이름 · 지명 같은 고유명사가 아니라 주제어를 쓴다 (예: 사랑, 자유, 고독, 죽음, 시간, 돈, 투자, 습관, 기억).',
    '서로 다른 책끼리 이어지도록, 뜻이 맞으면 [기존 키워드]에 있는 단어를 그대로 다시 쓴다.',
    '키워드는 띄어쓰기 없는 짧은 명사. 출력은 JSON 배열 하나만: [{"id":"S000001","k":["사랑","고독"]}, …]'].join('\n');
  const body = '[기존 키워드] ' + (vocab.length ? vocab.join(', ') : '(아직 없음)') + '\n\n' +
    items.map(t => '[' + t.ID + '] 책: ' + t['책제목'] + (t['제목'] ? ' / 제목: ' + t['제목'] : '') + '\n' + clip(t['내용'], 900)).join('\n\n');
  const out = await llm(sys, [{ role: 'user', content: body }], 400 + items.length * 60, true);
  const res: Record<string, string[]> = {};
  try {
    const arr = JSON.parse(String(out).slice(String(out).indexOf('['), String(out).lastIndexOf(']') + 1));
    arr.forEach((x: Row) => { if (x && x.id) res[x.id] = kwClean(x.k || []); });
  } catch { /* 빈 결과 */ }
  return res;
}
async function suggestKeywords(ctx: Ctx, item: Row) {
  item = item || {};
  const [bs, ss] = await Promise.all([books(ctx), snips(ctx)]);
  const b = bs.find(x => x.ID === item['책ID']) || {};
  const res = await keywordBatch([{ ID: 'S000000', '책제목': b['제목'] || '', '제목': item['제목'] || '', '내용': item['내용'] || '' }], keywordVocab(ss, 60));
  return res['S000000'] || [];
}
async function autoKeywords(ctx: Ctx) {
  const started = Date.now();
  const [bs, ss] = await Promise.all([books(ctx), snips(ctx)]);
  const title: Record<string, string> = {}; bs.forEach(b => title[b.ID] = b['제목']);
  const todo = ss.filter(s => !String(s['키워드'] || '').trim() && String(s['내용'] || '').trim());
  if (!todo.length) return { message: '키워드가 빈 덩어리가 없어요.', remaining: 0, done: 0 };
  const vocab = keywordVocab(ss, 80);
  let done = 0, i = 0;
  while (i < todo.length && Date.now() - started < 90000) {
    const batch: Row[] = todo.slice(i, i + 15).map(s => ({ ...s, '책제목': title[s['책ID']] || '' }));
    const res = await keywordBatch(batch, vocab);
    const up: Row[] = [];
    batch.forEach(t => {
      const ks = res[t.ID];
      if (ks && ks.length) {
        const d = { ...ss.find(s => s.ID === t.ID) }; delete d.ID; d['키워드'] = ks.join(', ');
        up.push({ user_id: ctx.uid, id: t.ID, data: d, mtime: Date.now() });
        ks.forEach(k => { if (vocab.indexOf(k) < 0 && vocab.length < 150) vocab.push(k); });
        done++;
      }
    });
    if (up.length) { const { error } = await ctx.sb.from('snippets').upsert(up, { onConflict: 'user_id,id' }); if (error) throw new Error(error.message); }
    i += 15;
  }
  const remaining = todo.length - i;
  return remaining > 0
    ? { message: '키워드 ' + done + '개 덩어리에 달았어요. 남은 ' + remaining + '개는 한 번 더 누르면 이어서 달아요.', remaining, done }
    : { message: '키워드를 ' + done + '개 덩어리에 달았어요.', remaining: 0, done };
}

/* ---------- 사진 필사 · 제목 · 글쓰기 도우미 · 녹음 ---------- */
const SCAN_SYSTEM = ['너는 책 사진에서 문장을 정확하게 옮겨 적는 필사 도우미다.', '보이는 글자를 그대로 옮긴다. 요약하거나 다듬거나 맞춤법을 고치지 않는다.', '출력은 JSON 하나만 쓴다.'].join('\n');
function titleExamples(ss: Row[], bookId: string) {
  const titled = ss.filter(s => s['제목']);
  return uniq(titled.filter(s => s['책ID'] === bookId).slice(-8).concat(titled.filter(s => s['책ID'] !== bookId).slice(-40)).map(s => String(s['제목']).trim()))
    .filter(t => t.length <= 30).slice(-14);
}
async function scanPage(ctx: Ctx, r: Row) {
  r = r || {};
  if (!r.image) throw new Error('사진이 없어요.');
  if (String(r.image).length > 12000000) throw new Error('사진이 너무 커요. 조금 작게 찍어 주세요.');
  const [bs, ss] = await Promise.all([books(ctx), snips(ctx)]);
  const b = bs.find(x => x.ID === r.bookId);
  const examples = titleExamples(ss, r.bookId), vocab = keywordVocab(ss, 80);
  const prompt = [
    '이 사진은 종이책을 찍은 사진이거나 전자책(이북) 화면 캡처다.' + (b ? ' 책: 『' + b['제목'] + '』' + (b['저자'] ? ' ' + b['저자'] : '') : ''), '',
    '[1] highlights: 형광펜 · 색연필 · 밑줄 · 괄호 표시 · 전자책 앱의 하이라이트(색 배경이나 밑줄)로 표시된 부분만 옮긴다.',
    '  - 이어지는 표시는 한 덩어리, 떨어져 있는 표시는 각각 다른 덩어리. 표시가 문장 중간에서 시작해도 표시된 부분만.',
    '  - 표시된 곳이 하나도 없으면 빈 배열 [].', '[2] page: 표시와 상관없이 본문 전체를 한 덩어리로 옮긴다.', '', '옮겨 적는 규칙',
    '  - 머리말 · 꼬리말 · 쪽번호 · 책 제목 줄 · 장 제목 줄, 전자책 앱의 메뉴 · 시계 · 배터리 · 진행률 같은 화면 요소는 빼고 본문만.',
    '  - 줄 끝에서 끊긴 단어와 문장은 이어 붙이고, 문단이 바뀌는 곳에서만 줄을 바꾼다(\\n). 하이픈으로 나뉜 영어 단어도 합친다.',
    '  - 사진 가장자리에서 잘리거나 흐려서 안 보이는 글자는 지어내지 말고 … 로 둔다.', '쪽수(page)',
    '  - 사진에 인쇄된 쪽번호(보통 위나 아래 구석의 숫자)를 읽어 그 덩어리가 실제로 있는 쪽을 쓴다. 펼친 두 쪽에 걸치면 "36, 37".',
    '  - 전자책의 위치 번호, 퍼센트(예: 45%), "남은 시간"은 쪽수가 아니다. 쪽번호가 안 보이면 "".', '제목(title)',
    '  - 덩어리마다 내가 붙이는 짧은 표제를 짓는다. 내용의 핵심을 담은 한 구절, 2~16자 정도.',
    examples.length ? '  - 내가 예전에 붙인 표제들 (이 말투를 따라 한다): ' + examples.join(' / ') : '  - 예: 과학은 믿음을 싫어한다 / 사랑은 능동적인 힘',
    '키워드(keywords)', '  - 덩어리마다 주제어 1~3개. 뜻이 맞으면 이 목록의 단어를 그대로 쓴다: ' + (vocab.length ? vocab.join(', ') : '(아직 없음)'), '',
    '출력 형식(JSON만):', '{"kind":"종이책 또는 전자책","highlights":[{"title":"","text":"","page":"","keywords":[]}],"page":{"title":"","text":"","page":"","keywords":[]}}'].join('\n');
  const j = parseJson(await llm(SCAN_SYSTEM, [{ role: 'user', parts: [{ inlineData: { mimeType: r.mime || 'image/jpeg', data: String(r.image) } }, { text: prompt }] }], 8192, true));
  const fix = (it: Row) => { it = it || {}; return { title: String(it.title || '').replace(/^[<\s]+|[>\s]+$/g, '').slice(0, 40), text: cleanText(it.text), page: pageNum(it.page), keywords: kwClean(it.keywords || []) }; };
  const highlights = (j.highlights || []).map(fix).filter((x: Row) => x.text);
  const page = fix(j.page);
  if (!highlights.length && !page.text) throw new Error('사진에서 글자를 찾지 못했어요. 더 밝고 반듯하게 다시 찍어 보세요.');
  return { kind: String(j.kind || ''), highlights, page };
}
async function suggestTitle(ctx: Ctx, item: Row) {
  item = item || {};
  const text = String(item['내용'] || '').trim(), raw = String(item.raw || '').trim();
  if (!text) throw new Error('내용을 먼저 넣어 주세요.');
  const [bs, ss] = await Promise.all([books(ctx), snips(ctx)]);
  const b = bs.find(x => x.ID === item['책ID']);
  const examples = titleExamples(ss, item['책ID']), vocab = keywordVocab(ss, 80);
  const prompt = [(b ? '책: 『' + b['제목'] + '』\n' : '') + '아래 필사 덩어리에 내가 붙이는 짧은 표제(2~16자, 핵심을 담은 한 구절)와 주제어 1~3개를 붙여줘.',
    examples.length ? '내가 예전에 붙인 표제들 (이 말투를 따라 한다): ' + examples.join(' / ') : '',
    '주제어는 뜻이 맞으면 이 목록의 단어를 그대로: ' + (vocab.length ? vocab.join(', ') : '(아직 없음)'),
    raw ? '그리고 [필사]는 휴대폰 화면 줄바꿈 그대로라 줄 끝에서 끊겨 있다. 줄바꿈을 정리한 본문을 text에 넣어줘: 단어 중간에서 끊긴 곳은 붙이고, 띄어 써야 할 곳만 한 칸 띄우고, 빈 줄로 나뉜 문단은 유지. 글자는 하나도 바꾸거나 빼거나 더하지 않는다.' : '',
    raw ? 'JSON만: {"title":"","keywords":[],"text":""}' : 'JSON만: {"title":"","keywords":[]}', '', '[필사]', raw ? clip(raw, 4000) : clip(text, 2500)].join('\n');
  const j = parseJson(await llm('너는 독서 노트에 표제를 붙이는 도우미다. 출력은 JSON 하나만.', [{ role: 'user', content: prompt }], raw ? 4096 : 1024, true));
  return { text: raw ? String(j.text || '') : '', title: String(j.title || '').replace(/^[<\s]+|[>\s]+$/g, '').slice(0, 40), keywords: kwClean(j.keywords || []) };
}
async function noteAssist(_ctx: Ctx, r: Row) {
  r = r || {};
  const title = String(r['제목'] || ''), body = String(r['본문'] || '');
  if (!body.trim()) throw new Error('본문을 먼저 써 주세요.');
  const text = '[제목] ' + title + '\n[본문]\n' + clip(body, 12000);
  let sys, ask, max = 1500;
  if (r.mode === 'titles') { sys = '너는 글쓴이의 말투를 존중하는 편집자다. 출력은 JSON 하나만.'; ask = '이 글에 어울리는 제목 후보 5개를 지어줘. 글쓴이의 문체를 따르고, 낚시성 표현은 쓰지 않는다. JSON: {"titles":["",""]}'; }
  else if (r.mode === 'spell') {
    sys = '너는 한국어 교정자다. 맞춤법 · 띄어쓰기 · 오타처럼 분명히 틀린 것만 고른다. 문체나 표현은 바꾸지 않는다. 출력은 JSON 하나만.';
    ask = '틀린 곳을 최대 30개까지 찾아줘. from은 본문에 있는 그대로(앞뒤 몇 글자 포함해 본문에서 한 번만 나오게), to는 고친 것, why는 짧은 이유. 틀린 곳이 없으면 빈 배열. JSON: {"fixes":[{"from":"","to":"","why":""}]}';
    max = 4000;
  } else { sys = '너는 글쓴이의 글을 소개하는 편집자다. 출력은 JSON 하나만.'; ask = '블로그나 브런치에 올릴 때 쓸 소개글을 2~3문장으로, 글쓴이 말투로 써줘. 태그 5개도. JSON: {"summary":"","tags":[]}'; }
  const j = parseJson(await llm(sys, [{ role: 'user', content: text + '\n\n' + ask }], max, true));
  if (r.mode === 'spell') j.fixes = (j.fixes || []).filter((f: Row) => f && f.from && f.to && f.from !== f.to && (body.indexOf(f.from) >= 0 || title.indexOf(f.from) >= 0));
  return j;
}
async function transcribeAudio(ctx: Ctx, r: Row) {
  r = r || {};
  if (!r.audio) throw new Error('녹음이 없어요.');
  if (String(r.audio).length > 15000000) throw new Error('녹음이 너무 길어요. 5분 안으로 나눠 주세요.');
  const vocab = keywordVocab(await snips(ctx), 60);
  const rules: Record<string, string> = {
    memo: '말한 내용을 메모로 정리한다. "음", "어" 같은 말버릇과 되풀이만 빼고 뜻은 바꾸지 않는다. 문단을 나눈다. 해야 할 일이 들어 있으면 todos에 하나씩 넣는다. 날짜 · 시간 말은 들은 그대로 앞에 둔다 (예: "내일 3시 치과", "금요일까지 서평 쓰기"). 없으면 빈 배열.',
    snip: '책 문장을 소리 내어 읽은 것이다. 읽은 문장을 맞춤법에 맞게 그대로 받아 적는다. 요약하거나 다듬지 않는다. "48쪽"처럼 쪽수를 말했으면 page에 숫자만 넣고 본문에서는 뺀다. 문장 뒤에 덧붙인 생각이 있으면 thought에 따로 넣는다.',
    note: '글을 말로 쓴 것이다. 말버릇과 되풀이만 빼고 말한 표현을 살려 받아 적는다. 문단을 나눈다. 내용을 보태거나 줄이지 않는다.'
  };
  const mode = rules[r.mode] ? r.mode : 'memo';
  const prompt = ['첨부한 한국어 녹음을 글로 옮겨줘.', rules[mode],
    'title은 내용의 핵심을 담은 2~16자 표제, keywords는 주제어 1~3개 (뜻이 맞으면 이 목록의 단어를 그대로: ' + (vocab.join(', ') || '없음') + ').',
    '알아들을 수 없는 부분은 지어내지 말고 (…)로 둔다.', 'JSON만: {"text":"","title":"","keywords":[],"todos":[],"page":"","thought":""}'].join('\n');
  const j = parseJson(await llm('너는 녹음을 정확하게 받아 적는 도우미다. 출력은 JSON 하나만.', [{ role: 'user', parts: [{ inlineData: { mimeType: r.mime || 'audio/wav', data: String(r.audio) } }, { text: prompt }] }], 8192, true));
  return { text: cleanText(j.text), title: String(j.title || '').slice(0, 40), keywords: kwClean(j.keywords || []),
    todos: (j.todos || []).map(String).filter((t: string) => t.trim()).slice(0, 10), page: pageNum(j.page), thought: cleanText(j.thought) };
}

/* ---------- 책 검색 (카카오 + 국립중앙도서관 + 구글 북스) ---------- */
async function kakaoGet(params: Record<string, string | number>) {
  const key = env('KAKAO_REST_KEY');
  if (!key) throw new Error('카카오 REST API 키가 아직 없어요. Supabase → Edge Functions → Secrets에 KAKAO_REST_KEY를 넣어 주세요.');
  const url = 'https://dapi.kakao.com/v3/search/book?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(String(params[k]))).join('&');
  const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key } });
  if (res.status === 401) throw new Error('카카오 키가 맞지 않아요. REST API 키를 복사했는지 확인해 주세요.');
  if (res.status !== 200) { let msg = ''; try { msg = (await res.json()).message || ''; } catch { /* */ } throw new Error('카카오 검색 오류 (' + res.status + ') ' + msg); }
  return await res.json();
}
function bigCover(thumb: string) {
  const m = String(thumb).match(/[?&]fname=([^&]+)/);
  if (!m) return thumb;
  try { return decodeURIComponent(m[1]).replace(/^http:\/\//, 'https://'); } catch { return thumb; }
}
function kakaoItem(d: Row) {
  const isbns = String(d.isbn || '').split(/\s+/);
  return { title: String(d.title || '').trim(), author: (d.authors || []).join(', '), translator: (d.translators || []).join(', '), publisher: d.publisher || '',
    year: String(d.datetime || '').slice(0, 4), isbn13: isbns.find(x => x.length === 13) || '', isbn10: isbns.find(x => x.length === 10) || '', cover: bigCover(d.thumbnail || '') };
}
async function bookSearch(_ctx: Ctx, query: string) {
  query = String(query || '').trim();
  if (!query) return [];
  const isbn = query.replace(/[-\s]/g, '');
  const params: Record<string, string | number> = /^\d{10}(\d{3})?$/.test(isbn) ? { query: isbn, target: 'isbn' } : { query };
  params.size = 15;
  const data = await kakaoGet(params);
  return (data.documents || []).map(kakaoItem).filter((x: Row) => x.title);
}
async function nlLookup(isbn: string) {
  const key = env('NL_CERT_KEY'); if (!key) return null;
  try {
    const res = await fetch('https://www.nl.go.kr/seoji/SearchApi.do?cert_key=' + encodeURIComponent(key) + '&result_style=json&page_no=1&page_size=1&isbn=' + encodeURIComponent(isbn));
    if (res.status !== 200) return null;
    const d = ((await res.json()).docs || [])[0]; if (!d) return null;
    const page = parseInt(String(d.PAGE || '').replace(/[^0-9]/g, ''), 10);
    const add = String(d.EA_ADD_CODE || '').replace(/\D/g, '');
    const kdc = String(d.KDC || '').match(/^\d{3}/) ? String(d.KDC).slice(0, 3) : (add.length === 5 ? add.slice(2) : '');
    return { page: page > 0 ? page : '', kdc, cover: d.TITLE_URL || '' };
  } catch { return null; }
}
async function googlePages(isbn: string) {
  try {
    const res = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + encodeURIComponent(isbn));
    if (res.status !== 200) return '';
    const it = ((await res.json()).items || [])[0];
    return it && it.volumeInfo && it.volumeInfo.pageCount ? Number(it.volumeInfo.pageCount) : '';
  } catch { return ''; }
}
function kdcToCategory(code: string) {
  const n = parseInt(String(code).slice(0, 3), 10);
  if (isNaN(n)) return { main: '', sub: '' };
  const d2 = Math.floor(n / 10), last = n % 10;
  if (n >= 800 && n < 900) {
    const region = ({ 81: '한국', 82: '중국', 83: '일본', 84: '영미', 85: '독일', 86: '프랑스', 87: '스페인', 88: '이탈리아', 89: '기타' } as Record<number, string>)[d2] || '';
    const form = ({ 1: '시', 2: '희곡', 3: '소설', 4: '에세이' } as Record<number, string>)[last] || '문학';
    return { main: d2 === 81 ? '한국 문학' : '해외 문학', sub: region && region !== '기타' ? region + form : form };
  }
  if (n >= 160 && n < 170) return { main: '인문학', sub: '서양철학' };
  if (n >= 150 && n < 160) return { main: '인문학', sub: '동양철학' };
  if (n >= 180 && n < 190) return { main: '인문학', sub: '심리' };
  if (n >= 190 && n < 200) return { main: '자기계발', sub: '' };
  if (n < 200) return { main: '인문학', sub: n < 100 ? '인문교양' : '철학' };
  if (n < 300) return { main: '종교', sub: '' };
  if (n >= 320 && n < 330) return { main: '경제/경영', sub: n === 325 ? '경영' : (n === 327 ? '재테크/투자' : '경제일반') };
  if (n >= 330 && n < 340) return { main: '정치/사회', sub: '사회학' };
  if (n >= 340 && n < 350) return { main: '정치/사회', sub: '정치' };
  if (n < 400) return { main: '정치/사회', sub: '' };
  if (n < 500) return { main: '과학', sub: n >= 410 && n < 420 ? '수학' : '교양과학' };
  if (n >= 510 && n < 520) return { main: '건강', sub: '' };
  if (n < 600) return { main: '과학', sub: '기술' };
  if (n >= 670 && n < 680) return { main: '예술/대중문화', sub: '음악' };
  if (n >= 680 && n < 690) return { main: '예술/대중문화', sub: '영화' };
  if (n < 700) return { main: '예술/대중문화', sub: '' };
  if (n < 800) return { main: '인문학', sub: '언어' };
  return { main: '역사/문화', sub: n >= 910 && n < 920 ? '한국사·아시아사' : '세계사' };
}
async function bookDetail(_ctx: Ctx, item: Row) {
  item = item || {};
  const out: Row = { '제목': item.title || '', '저자': item.author || '', '옮긴이': item.translator || '', '출판사': item.publisher || '',
    '대분류': '', '중분류': '', '분량': '', 'ISBN': item.isbn13 || '', '표지URL': item.cover || '', '분류출처': '' };
  const isbn = item.isbn13 || item.isbn10;
  if (!isbn) return out;
  const nl = await nlLookup(isbn);
  if (nl) {
    if (nl.page) out['분량'] = nl.page;
    if (nl.kdc) { const c = kdcToCategory(nl.kdc); out['대분류'] = c.main; out['중분류'] = c.sub; out['분류출처'] = 'KDC ' + nl.kdc; }
    if (!out['표지URL'] && nl.cover) out['표지URL'] = nl.cover;
  }
  if (!out['분량']) { const g = await googlePages(isbn); if (g) out['분량'] = g; }
  return out;
}

/* ---------- 폰 알림 (웹 푸시) ---------- */
const adminClient = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const kstDay = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);
let vapid: { pub: string; priv: string } | null = null;
async function vapidKeys(admin: any) {
  if (vapid) return vapid;
  const get = async (k: string) => (await admin.rpc('app_kv_get', { key: k })).data as string | null;
  let pub = await get('vapid_pub'), priv = await get('vapid_priv');
  if (!pub || !priv) {   // 처음 한 번 만들어 서버에만 보관
    const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey;
    await admin.rpc('app_kv_set', { key: 'vapid_priv', val: priv });
    await admin.rpc('app_kv_set', { key: 'vapid_pub', val: pub });
  }
  return (vapid = { pub: String(pub), priv: String(priv) });
}
type Push = { title: string; body: string; url?: string; tag?: string };
// 한 사람의 모든 기기에 보내기. pref: 'due' | 'together' (기기 설정에서 끈 건 건너뜀)
async function pushTo(admin: any, uid: string, msg: Push, pref?: string, errors?: string[]) {
  const keys = await vapidKeys(admin);
  const { data: subs } = await admin.from('push_subs').select('endpoint, p256dh, auth, prefs').eq('user_id', uid);
  let sent = 0;
  for (const s of subs || []) {
    if (pref && s.prefs && s.prefs[pref] === false) continue;
    try {
      const d = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg),
        { TTL: 12 * 3600, urgency: 'normal', vapidDetails: { subject: 'mailto:haltair8819@gmail.com', publicKey: keys.pub, privateKey: keys.priv } });
      const res = await fetch(d.endpoint, { method: 'POST', headers: d.headers as Record<string, string>, body: d.body });
      if (res.status === 404 || res.status === 410) { await admin.from('push_subs').delete().eq('endpoint', s.endpoint); errors?.push(`${new URL(s.endpoint).hostname} ${res.status} (만료돼서 지웠어요)`); }   // 앱을 지운 기기
      else if (res.ok) sent++;
      else errors?.push(`${new URL(s.endpoint).hostname} ${res.status} ${clip(await res.text(), 120)}`);
    } catch (e) { errors?.push(String((e as Error).message || e)); }   // 한 기기 실패는 넘어가요
  }
  return sent;
}
async function pushKey(_ctx: Ctx) { return (await vapidKeys(adminClient())).pub; }
async function pushTest(ctx: Ctx) {
  const admin = adminClient(), errors: string[] = [];
  const { count } = await admin.from('push_subs').select('endpoint', { count: 'exact', head: true }).eq('user_id', ctx.uid);
  if (!count) throw new Error('서버에 알림 받을 기기가 없어요. 스위치를 껐다가 다시 켜 주세요');
  const sent = await pushTo(admin, ctx.uid, { title: '나의 서재', body: '알림이 잘 와요 📚', url: './', tag: 'test' }, undefined, errors);
  if (!sent) throw new Error('보내기 실패: ' + (errors.join(' / ') || '알 수 없는 이유'));
  return { sent, errors };
}
// 짝꿍에게 알리기: 내가 남긴 반응 · 같이 읽기를 짝꿍 폰에
async function notify(ctx: Ctx, kind: string, id: string) {
  const admin = adminClient();
  const { data: me } = await ctx.sb.from('profiles').select('name').eq('user_id', ctx.uid).maybeSingle();
  const name = (me && me.name) || '짝꿍';
  if (kind === 'reaction') {
    const { data: r } = await ctx.sb.from('reactions').select('owner, snippet_id, kind, body, user_id').eq('id', id).maybeSingle();
    if (!r || r.user_id !== ctx.uid || r.owner === ctx.uid) return 0;
    const { data: sn } = await ctx.sb.from('snippets').select('data').eq('user_id', r.owner).eq('id', r.snippet_id).maybeSingle();
    const t = clip(String((sn && sn.data && sn.data['내용']) || '').split('\n\n[메모]')[0], 40);
    return pushTo(admin, r.owner, { title: r.kind === 'heart' ? `${name}님이 문장에 ♡` : `${name}님의 한마디`,
      body: r.kind === 'heart' ? `“${t}”` : `${clip(r.body, 80)} — “${t}”`, url: './?snip=' + encodeURIComponent(r.snippet_id), tag: 'react-' + r.snippet_id }, 'together');
  }
  if (kind === 'together') {
    const { data: tb } = await ctx.sb.from('together_books').select('pship, data, status').eq('id', id).maybeSingle();
    if (!tb) return 0;
    const { data: p } = await ctx.sb.from('partnerships').select('inviter, invitee').eq('id', tb.pship).maybeSingle();
    if (!p) return 0;
    const other = p.inviter === ctx.uid ? p.invitee : p.inviter;
    const title = (tb.data && tb.data['제목']) || '책';
    return pushTo(admin, other, tb.status === '읽는중'
      ? { title: `${name}님과 같이 읽기 시작!`, body: `『${title}』를 같이 읽어요. 내 서재에도 읽는 중으로 넣었어요`, url: './?view=together', tag: 'tb-' + id }
      : { title: `${name}님이 같이 읽을 책을 담았어요`, body: `『${title}』`, url: './?view=together', tag: 'tb-' + id }, 'together');
  }
  return 0;
}

/* ---------- 자동 백업: 계정마다 전체 기록을 파일로 (최근 8개 보관) ---------- */
const BACKUP_TABLES = ['books', 'snippets', 'notes', 'memos', 'read_logs', 'snippet_orders', 'note_versions'];
async function backupUser(admin: any, uid: string) {
  const out: Row = { app: '나의 서재', made: new Date().toISOString(), user_id: uid, tables: {} };
  for (const t of BACKUP_TABLES) {
    const list: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(t).select('*').eq('user_id', uid).range(from, from + 999);
      if (error) throw new Error(t + ': ' + error.message);
      list.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    out.tables[t] = list;
  }
  const { data: prof } = await admin.from('profiles').select('name, email, settings').eq('user_id', uid).maybeSingle();
  out.profile = prof || {};
  const gz = await new Response(new Blob([JSON.stringify(out)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const path = `${uid}/${kstDay()}.json.gz`;
  const { error } = await admin.storage.from('backups').upload(path, new Uint8Array(gz), { contentType: 'application/gzip', upsert: true });
  if (error) throw new Error('백업 저장 실패: ' + error.message);
  const { data: files } = await admin.storage.from('backups').list(uid, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  const old = (files || []).map((f: Row) => f.name).filter((n: string) => /\.json\.gz$/.test(n)).sort().reverse().slice(8);
  if (old.length) await admin.storage.from('backups').remove(old.map((n: string) => `${uid}/${n}`));
  const counts: Row = {}; BACKUP_TABLES.forEach(t => counts[t] = out.tables[t].length);
  return { path, bytes: gz.byteLength, counts };
}
async function backupNow(ctx: Ctx) { return backupUser(adminClient(), ctx.uid); }

const CRON_FNS: Record<string, (admin: any, ...a: any[]) => Promise<unknown>> = {
  // 반납 알림: eve = 내일 반납 (전날 저녁), am = 오늘 반납 (아침)
  cronDue: async (admin: any, when: string) => {
    const day = when === 'am' ? kstDay() : kstDay(1);
    const { data, error } = await admin.rpc('due_books', { d: day });
    if (error) throw new Error(error.message);
    const by: Record<string, Row[]> = {};
    (data || []).forEach((b: Row) => (by[b.user_id] = by[b.user_id] || []).push(b));
    let sent = 0;
    for (const [uid, list] of Object.entries(by)) {
      const first = `『${list[0].title}』${list.length > 1 ? ` 외 ${list.length - 1}권` : ''}`;
      sent += await pushTo(admin, uid, when === 'am'
        ? { title: '📚 오늘 반납하는 날이에요', body: first, url: './?book=' + encodeURIComponent(list[0].id), tag: 'due-' + day }
        : { title: '📚 내일 반납이에요', body: `${first} · 오늘 챙겨 두세요`, url: './?book=' + encodeURIComponent(list[0].id), tag: 'due-' + day }, 'due');
    }
    return { day, users: Object.keys(by).length, sent };
  },
  cronBackup: async (admin: any) => {
    const { data: users } = await admin.from('profiles').select('user_id');
    const res: Row[] = [];
    for (const u of users || []) { try { res.push(await backupUser(admin, u.user_id)); } catch (e) { res.push({ user: u.user_id, error: String(e) }); } }
    return res;
  }
};

const FNS: Record<string, (ctx: Ctx, ...a: any[]) => Promise<unknown>> = {
  ping: async () => ({ ok: true }),
  askAssistant, suggestKeywords, autoKeywords, scanPage, suggestTitle, noteAssist, transcribeAudio, bookSearch, bookDetail,
  pushKey, pushTest, notify, backupNow
};
