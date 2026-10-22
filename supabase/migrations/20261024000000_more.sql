-- 나의 서재 — v2.11: 폰 알림 · 자동 백업 · 문장 반응 · 같이 읽을 책
-- (매일 · 매주 예약 작업과 파일 저장소는 다음 파일 20261024000100_server.sql)

-- ---------- 서버만 아는 값 (알림 키 · 예약 작업 암호) ----------
create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.kv (k text primary key, v text not null, updated_at timestamptz not null default now());
insert into private.kv (k, v) values ('cron_token', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text))
  on conflict (k) do nothing;

-- 서버 기능(service_role)만 부를 수 있어요
create or replace function public.app_kv_get(key text) returns text
language sql stable security definer set search_path = public, private as $$
  select v from private.kv where k = key;
$$;
create or replace function public.app_kv_set(key text, val text) returns void
language sql security definer set search_path = public, private as $$
  insert into private.kv (k, v) values (key, val) on conflict (k) do update set v = excluded.v, updated_at = now();
$$;
revoke execute on function public.app_kv_get(text) from public;
revoke execute on function public.app_kv_set(text, text) from public;
do $$ begin
  -- Supabase는 public의 새 함수를 anon · authenticated에게 자동으로 열어 줘서 직접 막아요
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.app_kv_get(text) from anon; revoke execute on function public.app_kv_set(text, text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.app_kv_get(text) from authenticated; revoke execute on function public.app_kv_set(text, text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.app_kv_get(text) to service_role;
    grant execute on function public.app_kv_set(text, text) to service_role;
  end if;
end $$;

-- ---------- 폰 알림 받을 기기 ----------
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  prefs      jsonb not null default '{"due": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;
drop policy if exists own_all on public.push_subs;
create policy own_all on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 같은 기기에서 다른 계정으로 로그인해도 알림이 새 계정으로 가게
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  insert into public.push_subs (endpoint, user_id, p256dh, auth, prefs)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(p_prefs, '{"due": true}'::jsonb))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    prefs = coalesce(p_prefs, public.push_subs.prefs), updated_at = now();
end $$;
grant execute on function public.save_push_sub(text, text, text, jsonb) to authenticated;

-- 반납일이 그날인 책 (예약 알림용, 서버 기능만)
create or replace function public.due_books(d date) returns table (user_id uuid, id text, title text)
language sql stable security definer set search_path = public as $$
  select b.user_id, b.id, b.data->>'제목'
    from public.books b
   where not b.deleted and b.data->>'반납일' = to_char(d, 'YYYY-MM-DD');
$$;
revoke execute on function public.due_books(date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke execute on function public.due_books(date) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke execute on function public.due_books(date) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.due_books(date) to service_role; end if;
end $$;

-- ---------- 보여준 문장에 반응 · 한마디 ----------
create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,     -- 문장 주인
  snippet_id text not null,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,   -- 남긴 사람
  kind       text not null check (kind in ('heart', 'comment')),
  body       text check (body is null or char_length(body) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists reactions_owner on public.reactions (owner, snippet_id);
create index if not exists reactions_user on public.reactions (user_id);
create unique index if not exists reactions_one_heart on public.reactions (owner, snippet_id, user_id) where kind = 'heart';
alter table public.reactions enable row level security;

-- 짝꿍이 보여준 문장인가
create or replace function public.snippet_visible(o uuid, sid text) returns boolean
language sql stable security definer set search_path = public as $$
  select o = auth.uid() or (public.is_partner(o) and exists (
    select 1 from public.snippets s where s.user_id = o and s.id = sid and s.shared and not s.deleted));
$$;
grant execute on function public.snippet_visible(uuid, text) to authenticated;

drop policy if exists react_read on public.reactions;
drop policy if exists react_add on public.reactions;
drop policy if exists react_del on public.reactions;
create policy react_read on public.reactions for select using (user_id = auth.uid() or owner = auth.uid() or public.snippet_visible(owner, snippet_id));
create policy react_add on public.reactions for insert with check (user_id = auth.uid() and public.snippet_visible(owner, snippet_id));
create policy react_del on public.reactions for delete using (user_id = auth.uid());

-- ---------- 같이 읽을 책 ----------
create table if not exists public.together_books (
  id         uuid primary key default gen_random_uuid(),
  pship      uuid not null references public.partnerships(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,        -- 제목 · 저자 · 출판사 · 표지URL · ISBN · 분량 · 대분류 · 중분류
  added_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status     text not null default '예정' check (status in ('예정', '읽는중', '끝')),
  joined     uuid[] not null default '{}',              -- 내 서재에 '읽는 중'으로 넣은 사람
  started_at date,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists together_books_pship on public.together_books (pship);
create or replace function public.in_pship(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.partnerships where id = p and status = 'accepted' and (inviter = auth.uid() or invitee = auth.uid()));
$$;
grant execute on function public.in_pship(uuid) to authenticated;
alter table public.together_books enable row level security;
drop policy if exists pair_all on public.together_books;
create policy pair_all on public.together_books for all using (public.in_pship(pship)) with check (public.in_pship(pship));
create or replace function public.touch_updated() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch on public.together_books;
create trigger touch before update on public.together_books for each row execute function public.touch_updated();
