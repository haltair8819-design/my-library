-- 나의 서재 — v2.13.3: 보여준 책에 댓글
create table if not exists public.book_comments (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,      -- 책 주인
  book_id    text not null,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,   -- 쓴 사람
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists book_comments_owner on public.book_comments (owner, book_id, created_at);
alter table public.book_comments enable row level security;

-- 내 책이거나, 짝꿍이 보여준 책인가
create or replace function public.book_visible(o uuid, bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select o = auth.uid() or (public.is_partner(o) and exists (
    select 1 from public.books b where b.user_id = o and b.id = bid and b.shared and not b.deleted));
$$;
grant execute on function public.book_visible(uuid, text) to authenticated;

drop policy if exists bc_read on public.book_comments;
drop policy if exists bc_add on public.book_comments;
drop policy if exists bc_del on public.book_comments;
create policy bc_read on public.book_comments for select using (user_id = auth.uid() or owner = auth.uid() or public.book_visible(owner, book_id));
create policy bc_add on public.book_comments for insert with check (user_id = auth.uid() and public.book_visible(owner, book_id) and (owner = auth.uid() or public.is_partner(owner)));
create policy bc_del on public.book_comments for delete using (user_id = auth.uid());
