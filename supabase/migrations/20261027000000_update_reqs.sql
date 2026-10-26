-- 나의 서재 — v2.14.4: '업데이트 해줘요!'를 앱 쓰는 사람 모두가 같이 보는 목록으로
create table if not exists public.update_reqs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,   -- 적은 사람
  who        text not null default '',                                                    -- 적을 때 이름
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  copied_at  timestamptz,          -- Claude에 보낸(복사한) 때
  copied_ver text,
  done_at    timestamptz,          -- 반영된 때
  done_ver   text,
  auto       boolean not null default false
);
create index if not exists update_reqs_created on public.update_reqs (created_at);
alter table public.update_reqs enable row level security;

drop policy if exists ur_read on public.update_reqs;
drop policy if exists ur_add on public.update_reqs;
drop policy if exists ur_edit on public.update_reqs;
drop policy if exists ur_del on public.update_reqs;
create policy ur_read on public.update_reqs for select to authenticated using (true);
create policy ur_add  on public.update_reqs for insert to authenticated with check (user_id = auth.uid());
create policy ur_edit on public.update_reqs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ur_del  on public.update_reqs for delete to authenticated using (user_id = auth.uid());

-- 복사함 · 반영됨 표시는 누구나 (모두의 목록이니까)
create or replace function public.req_mark_copied(ids uuid[], ver text) returns void
language sql security definer set search_path = public as $$
  update public.update_reqs set copied_at = now(), copied_ver = ver
   where id = any(ids) and done_at is null and auth.uid() is not null;
$$;
create or replace function public.req_mark_done(ids uuid[], ver text, is_auto boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.update_reqs set done_at = now(), done_ver = ver, auto = is_auto
   where id = any(ids) and done_at is null and auth.uid() is not null;
$$;
revoke execute on function public.req_mark_copied(uuid[], text) from public;
revoke execute on function public.req_mark_done(uuid[], text, boolean) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.req_mark_copied(uuid[], text) from anon;
    revoke execute on function public.req_mark_done(uuid[], text, boolean) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.req_mark_copied(uuid[], text) to authenticated;
    grant execute on function public.req_mark_done(uuid[], text, boolean) to authenticated; end if;
end $$;
