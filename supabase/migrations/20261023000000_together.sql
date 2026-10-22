-- 나의 서재 — 4단계: 같이 쓰기 (초대 · 수락 다듬기)
--  · 초대에 보낸 사람 이름 · 이메일을 같이 적어 둬요 (수락 전에는 상대 프로필을 못 읽어서)
--  · 한 사람은 한 명하고만 같이 쓸 수 있어요
--  · 받은 초대는 거절할 수 있어요

alter table public.partnerships add column if not exists inviter_name text;
alter table public.partnerships add column if not exists inviter_email text;

-- 초대 만들 때: 보낸 사람 정보 채우기 · 내 이메일 막기 · 예전 대기 초대 정리
create or replace function public.prep_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare p_email text; p_name text;
begin
  new.inviter := auth.uid();
  new.status := 'pending';
  new.invitee := null;
  new.invitee_email := lower(trim(new.invitee_email));
  if new.invitee_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '이메일 주소를 확인해 주세요'; end if;
  select email, name into p_email, p_name from public.profiles where user_id = auth.uid();
  new.inviter_email := lower(coalesce(p_email, auth.jwt()->>'email', ''));
  new.inviter_name := coalesce(nullif(trim(p_name), ''), split_part(new.inviter_email, '@', 1));
  if new.invitee_email = new.inviter_email then raise exception '내 이메일로는 초대할 수 없어요'; end if;
  if exists (select 1 from public.partnerships where status = 'accepted' and (inviter = auth.uid() or invitee = auth.uid())) then
    raise exception '이미 함께 쓰는 사람이 있어요';
  end if;
  update public.partnerships set status = 'ended' where inviter = auth.uid() and status = 'pending';
  return new;
end $$;
drop trigger if exists prep_invite on public.partnerships;
create trigger prep_invite before insert on public.partnerships
  for each row execute function public.prep_invite();

-- 수락: 내 이메일로 온 초대만, 둘 다 아직 짝꿍이 없을 때만
create or replace function public.accept_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me_email text; inv uuid;
begin
  select lower(email) into me_email from auth.users where id = auth.uid();
  select inviter into inv from public.partnerships
   where id = invite_id and status = 'pending' and lower(invitee_email) = me_email and inviter <> auth.uid();
  if inv is null then raise exception '받을 수 있는 초대가 없어요'; end if;
  if exists (select 1 from public.partnerships where status = 'accepted'
             and (inviter in (auth.uid(), inv) or invitee in (auth.uid(), inv))) then
    raise exception '이미 함께 쓰는 사람이 있어요';
  end if;
  update public.partnerships set invitee = auth.uid(), status = 'accepted', accepted_at = now() where id = invite_id;
  -- 남은 대기 초대 정리 (나에게 온 것 · 내가 보낸 것)
  update public.partnerships set status = 'ended'
   where status = 'pending' and id <> invite_id and (lower(invitee_email) = me_email or inviter = auth.uid());
end $$;

-- 거절
create or replace function public.decline_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me_email text;
begin
  select lower(email) into me_email from auth.users where id = auth.uid();
  update public.partnerships set status = 'ended'
   where id = invite_id and status = 'pending' and lower(invitee_email) = me_email;
  if not found then raise exception '거절할 초대가 없어요'; end if;
end $$;

grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;

-- 짝꿍 기록 빨리 찾기
create index if not exists books_user_shared on public.books (user_id) where shared and not deleted;
create index if not exists snippets_user_shared on public.snippets (user_id) where shared and not deleted;
