-- 나의 서재 — v2.12: 프로필 사진 (본인 · 짝꿍만 볼 수 있게)
alter table public.profiles add column if not exists avatar text;   -- 사진 올린 시각 (없으면 사진 없음)

-- 폴더 이름(사용자 ID)이 짝꿍인지 — 이상한 이름이 와도 오류 없이 false
create or replace function public.is_partner_txt(t text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_partner(t::uuid);
exception when others then
  return false;
end $$;
grant execute on function public.is_partner_txt(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
drop policy if exists "avatars_insert" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;
drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_partner_txt((storage.foldername(name))[1])));
create policy "avatars_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
