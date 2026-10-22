-- 나의 서재 — 예약 작업 (Supabase에서만): 반납 알림 · 매주 백업, 백업 파일 저장소
-- 시각은 UTC 기준이에요 (한국 = UTC + 9)

-- ---------- 백업 파일 저장소 (계정마다 폴더, 본인만 내려받기) ----------
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
drop policy if exists "backups_own_read" on storage.objects;
create policy "backups_own_read" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 예약 작업 ----------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.call_api(fn text, args jsonb default '[]'::jsonb) returns bigint
language sql security definer set search_path = public, private, extensions as $$
  select net.http_post(
    url := 'https://zpbgssxftwckvjnrsdiw.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron', (select v from private.kv where k = 'cron_token')),
    body := jsonb_build_object('fn', fn, 'args', args),
    timeout_milliseconds := 120000);
$$;

-- 반납 전날 저녁 8시, 반납 당일 아침 8시 (한국 시각)
select cron.schedule('mylib-due-eve', '0 11 * * *', $$select private.call_api('cronDue', '["eve"]'::jsonb)$$);
select cron.schedule('mylib-due-am',  '0 23 * * *', $$select private.call_api('cronDue', '["am"]'::jsonb)$$);
-- 매주 일요일 새벽 3시 백업
select cron.schedule('mylib-backup',  '0 18 * * 6', $$select private.call_api('cronBackup')$$);
