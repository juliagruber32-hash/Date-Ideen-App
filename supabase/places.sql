-- Datewell: Zwischenspeicher für Orte und Google-Daten (für die Server-Funktion „places“).
-- Einmal im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

create table if not exists public.place_cache (
  key text primary key,
  data jsonb,
  created_at timestamptz not null default now()
);
-- Nur die Server-Funktion (service_role) darf lesen und schreiben – keine Richtlinien für Nutzer.
alter table public.place_cache enable row level security;

create table if not exists public.google_usage (
  day date primary key,
  calls int not null default 0
);
alter table public.google_usage enable row level security;

-- Zählt eine Google-Abfrage und sagt, ob das Tageslimit noch nicht erreicht ist.
create or replace function public.google_take(lim int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into public.google_usage(day, calls) values (current_date, 1)
  on conflict (day) do update set calls = public.google_usage.calls + 1
  returning calls into n;
  return n <= lim;
end;
$$;
revoke execute on function public.google_take(int) from public, anon, authenticated;

-- Alte Einträge (älter als 30 Tage) aufräumen.
create or replace function public.place_cache_cleanup()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.place_cache where created_at < now() - interval '30 days';
$$;
revoke execute on function public.place_cache_cleanup() from public, anon, authenticated;
