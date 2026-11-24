-- Datewell: Zugriffsrechte für angemeldete Nutzer.
-- Neuere Supabase-Projekte vergeben diese Rechte nicht mehr automatisch. Ohne sie kann die App
-- eure Daten im Konto weder lesen noch speichern.
-- Einmal im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.
-- Wer was sehen darf, regeln weiterhin die Sicherheitsregeln (Row Level Security) aus setup.sql:
-- jedes Paar sieht nur seine eigenen Daten.

grant usage on schema public to authenticated;

grant select on public.couples to authenticated;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select, insert, update on public.profiles to authenticated;

grant select, insert, update, delete on public.community_ideas to authenticated;
grant select, insert, update, delete on public.community_ratings to authenticated;
grant insert on public.community_reports to authenticated;
grant select on public.community_feed to authenticated;

-- Damit die Live-Aktualisierung (Realtime) Änderungen an euren Daten sieht
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
exception when others then null;
end $$;

-- Leere Paare aufräumen, die durch den früheren Fehler beim Anmelden entstanden sind.
-- Gelöscht wird nur ein Paar ohne gespeicherte Daten, mit nur einer Person, wenn dieselbe Person
-- schon ein älteres Paar hat. Das älteste Paar jeder Person bleibt immer erhalten.
delete from public.couples c
where not exists (select 1 from public.docs d where d.couple_id = c.id)
  and (select count(*) from public.members m where m.couple_id = c.id) = 1
  and exists (
    select 1
    from public.members m
    join public.members older on older.user_id = m.user_id and older.couple_id <> m.couple_id and older.joined_at < m.joined_at
    where m.couple_id = c.id
  );

-- Fehlerprotokoll der App (ohne Inhalte eurer Dates): Nutzer dürfen nur schreiben, nicht lesen.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  version text,
  screen text,
  message text,
  stack text
);
alter table public.client_errors enable row level security;
drop policy if exists "fehler melden" on public.client_errors;
create policy "fehler melden" on public.client_errors for insert to authenticated
  with check (user_id = auth.uid() and char_length(coalesce(message, '')) <= 600 and char_length(coalesce(stack, '')) <= 2000);
grant insert on public.client_errors to authenticated;

-- Fehlerprotokoll nach 90 Tagen löschen (falls pg_cron aktiv ist, z. B. durch notify.sql)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'datewell-errors-cleanup';
  perform cron.schedule('datewell-errors-cleanup', '23 4 * * *', 'delete from public.client_errors where at < now() - interval ''90 days''');
exception when others then null;
end $$;
