-- Dately: Mitteilungen aufs Handy (für die Server-Funktion „notify“).
-- Einmal im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

-- Schlüssel und Geheimnisse der Server-Funktionen (nur für den Server lesbar)
create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

-- Welche Handys Mitteilungen bekommen
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  sub jsonb not null,
  user_id uuid not null,
  couple_id uuid not null references public.couples(id) on delete cascade,
  role text,
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- Bereits verschickte Mitteilungen (gegen doppelte Nachrichten)
create table if not exists public.push_log (
  key text primary key,
  at timestamptz not null default now()
);
alter table public.push_log enable row level security;

-- Geheimnis für den zeitgesteuerten Aufruf
insert into public.app_secrets(name, value)
values ('cron', replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- Alle 10 Minuten nach fälligen Erinnerungen schauen
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'dately-notify';
select cron.schedule(
  'dately-notify',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://ybkrnoigcnprymhuylrz.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_secrets where name = 'cron')),
    body := '{"action":"cron"}'::jsonb
  );
  $$
);

-- Alte Einträge aufräumen (einmal täglich)
select cron.unschedule(jobid) from cron.job where jobname = 'dately-push-log-cleanup';
select cron.schedule('dately-push-log-cleanup', '17 3 * * *', $$ delete from public.push_log where at < now() - interval '30 days' $$);
