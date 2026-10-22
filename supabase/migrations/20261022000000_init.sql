-- 나의 서재 — 처음 표 만들기
-- 원칙
--  · 모든 기록은 주인(user_id)이 있고, 주인만 읽고 쓸 수 있어요 (행 보안 RLS).
--  · 짝꿍(초대를 수락한 사람)은 주인이 '보여주기'로 켠 것만 읽을 수 있어요. 쓰기는 절대 안 돼요.
--  · 앱은 폰에 먼저 저장하고 뒤에서 올려요. 그래서
--      id    : 앱이 만든 문자열 (예전 시트 ID도 그대로)
--      data  : 앱이 쓰는 한글 칸 그대로 (제목 · 저자 · 내용 …) — 기능이 늘어도 표를 안 고쳐도 돼요
--      mtime : 앱에서 고친 시각(ms). 두 기기가 같은 기록을 고치면 더 늦게 고친 쪽만 남아요
--      deleted: 지워도 바로 없애지 않고 표시만 (다른 기기에서 되살아나지 않게)
--      updated_at: 서버가 받은 시각 — '지난번 이후 바뀐 것만' 받을 때 씀


-- ---------- 공통: 서버 받은 시각 · 늦게 온 옛 수정 막기 ----------
create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- 주인은 못 바꿈
    new.user_id := old.user_id;
    -- 더 예전에 고친 내용이 늦게 도착하면 무시 (최신 것 남기기)
    if new.mtime < old.mtime then
      return old;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- 사람 ----------
create table public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  settings    jsonb not null default '{}'::jsonb,   -- 목표 · 디자인 · 보여줄 것 설정 등
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 로그인하면 자동으로 내 자리 만들기
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 기록 표들 (모양이 같아요) ----------
create table public.books (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  shared     boolean not null default true,          -- 책 목록 · 별점은 기본 공개
  mtime      bigint not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.snippets (                         -- 필사 · 내 생각 · 메모
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  book_id    text,
  kind       text not null default '인용',             -- 인용(필사) · 생각 · 메모
  data       jsonb not null default '{}'::jsonb,       -- 제목 · 내용 · 쪽수 · 키워드 · 덧붙인 메모 …
  shared     boolean not null default false,           -- '고른 것만' 보여주기
  mtime      bigint not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.notes (                            -- 나만의 노트 (항상 비공개)
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  mtime      bigint not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.note_versions (                    -- 노트 고친 내역 (밀려난 수정도 되돌릴 수 있게)
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         bigint generated always as identity primary key,
  note_id    text not null,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create table public.memos (                            -- 메모 · 할 일 (항상 비공개)
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  mtime      bigint not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.read_logs (                        -- 여기까지 읽었어요 (책 · 날짜마다 한 줄)
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  book_id    text not null,
  day        date not null,
  page       integer not null,
  base_page  integer,                                  -- 그 책 첫 기록일 때 어디서부터였는지
  mtime      bigint not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.snippet_orders (                   -- 끌어서 바꾼 필사 순서 (책마다 하나)
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id    text not null,
  ids        text[] not null default '{}',
  mtime      bigint not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- 바뀐 것만 받기 · 책별 찾기
create index on public.books (user_id, updated_at);
create index on public.snippets (user_id, updated_at);
create index on public.snippets (user_id, book_id);
create index on public.notes (user_id, updated_at);
create index on public.memos (user_id, updated_at);
create index on public.read_logs (user_id, updated_at);
create index on public.read_logs (user_id, book_id, day);
create index on public.snippet_orders (user_id, updated_at);
create index on public.note_versions (user_id, note_id, created_at desc);

create trigger touch before insert or update on public.books          for each row execute function public.touch_row();
create trigger touch before insert or update on public.snippets       for each row execute function public.touch_row();
create trigger touch before insert or update on public.notes          for each row execute function public.touch_row();
create trigger touch before insert or update on public.memos          for each row execute function public.touch_row();
create trigger touch before insert or update on public.read_logs      for each row execute function public.touch_row();
create trigger touch before insert or update on public.snippet_orders for each row execute function public.touch_row();

-- ---------- 짝꿍 (초대 · 수락) ----------
create table public.partnerships (
  id            uuid primary key default gen_random_uuid(),
  inviter       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invitee_email text not null,
  invitee       uuid references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'ended')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);
create index on public.partnerships (inviter);
create index on public.partnerships (invitee);
create index on public.partnerships (lower(invitee_email));

-- 나와 이 사람이 짝꿍인가 (보안 규칙 안에서 씀)
create or replace function public.is_partner(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.partnerships p
    where p.status = 'accepted'
      and ((p.inviter = owner and p.invitee = auth.uid()) or (p.invitee = owner and p.inviter = auth.uid()))
  );
$$;

-- 내 이메일로 온 초대 수락
create or replace function public.accept_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me_email text;
begin
  select email into me_email from auth.users where id = auth.uid();
  update public.partnerships
     set invitee = auth.uid(), status = 'accepted', accepted_at = now()
   where id = invite_id and status = 'pending' and lower(invitee_email) = lower(me_email) and inviter <> auth.uid();
  if not found then raise exception '받을 수 있는 초대가 없어요'; end if;
end $$;

-- ---------- 행 보안 (RLS) ----------
alter table public.profiles       enable row level security;
alter table public.books          enable row level security;
alter table public.snippets       enable row level security;
alter table public.notes          enable row level security;
alter table public.note_versions  enable row level security;
alter table public.memos          enable row level security;
alter table public.read_logs      enable row level security;
alter table public.snippet_orders enable row level security;
alter table public.partnerships   enable row level security;

-- 내 것: 전부
create policy own_all on public.books          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on public.snippets       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on public.notes          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on public.note_versions  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on public.memos          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on public.read_logs      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_all on public.snippet_orders for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 짝꿍 것: 보여주기로 한 것만 읽기
create policy partner_read on public.books     for select using (shared and not deleted and public.is_partner(user_id));
create policy partner_read on public.snippets  for select using (shared and not deleted and public.is_partner(user_id));
create policy partner_read on public.read_logs for select using (not deleted and public.is_partner(user_id)
  and exists (select 1 from public.books b where b.user_id = read_logs.user_id and b.id = read_logs.book_id and b.shared and not b.deleted));

-- 사람 정보: 나, 그리고 짝꿍의 이름 · 이메일
create policy own_profile     on public.profiles for all    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy partner_profile on public.profiles for select using (public.is_partner(user_id));

-- 초대: 보낸 사람 · 받는 사람만 보기, 보낸 사람만 만들고 끝내기
create policy invite_read on public.partnerships for select using (
  inviter = auth.uid() or invitee = auth.uid()
  or lower(invitee_email) = lower(auth.jwt()->>'email'));
create policy invite_create on public.partnerships for insert with check (inviter = auth.uid() and status = 'pending');
create policy invite_end on public.partnerships for update using (inviter = auth.uid() or invitee = auth.uid())
  with check (status = 'ended');

grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.is_partner(uuid) to authenticated;
