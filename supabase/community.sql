-- Datewell – Community: Anzeigename, Melden, Blockieren, Moderation (App Store & Digital Services Act)
-- Einmal im Supabase SQL Editor ausführen (läuft auch mehrfach ohne Schaden).
-- Danach dich selbst als Moderatorin eintragen (ganz unten).

-- ------------------------------------------------------------ Neue Spalten
alter table public.community_ideas add column if not exists display_name text check (display_name is null or char_length(display_name) <= 40);
alter table public.community_ideas add column if not exists mod_reason text;          -- Begründung, wenn ausgeblendet (sieht die Person)
alter table public.community_ideas add column if not exists moderated_at timestamptz;
alter table public.community_ideas add column if not exists appeal text check (appeal is null or char_length(appeal) <= 500); -- Einspruch
alter table public.community_ideas add column if not exists appeal_at timestamptz;

alter table public.community_ratings add column if not exists id uuid not null default gen_random_uuid();
alter table public.community_ratings add column if not exists hidden boolean not null default false;
create unique index if not exists community_ratings_id on public.community_ratings(id);

alter table public.community_reports add column if not exists id uuid not null default gen_random_uuid();
alter table public.community_reports add column if not exists note text check (note is null or char_length(note) <= 500);
alter table public.community_reports add column if not exists review_id uuid;
alter table public.community_reports add column if not exists done boolean not null default false;
-- Eine Person kann eine Idee bzw. einen Kommentar je einmal melden
alter table public.community_reports drop constraint if exists community_reports_pkey;
create unique index if not exists community_reports_once on public.community_reports(idea_id, user_id, coalesce(review_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ------------------------------------------------------------ Moderation, Sperren, Blockieren
create table if not exists public.community_moderators (user_id uuid primary key);
create table if not exists public.community_bans (
  user_id uuid primary key,
  reason text,
  created_at timestamptz not null default now()
);
create table if not exists public.community_blocks (
  user_id uuid not null default auth.uid(),  -- wer blockiert
  blocked uuid not null,                     -- wessen Inhalte ausgeblendet werden
  created_at timestamptz not null default now(),
  primary key (user_id, blocked)
);
alter table public.community_moderators enable row level security;
alter table public.community_bans enable row level security;
alter table public.community_blocks enable row level security;

create or replace function public.is_moderator() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_moderators where user_id = auth.uid());
$$;
create or replace function public.user_banned(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_bans where user_id = u);
$$;
create or replace function public.is_banned() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_bans where user_id = auth.uid());
$$;

drop policy if exists "eigene blockierungen" on public.community_blocks;
create policy "eigene blockierungen" on public.community_blocks for select using (user_id = auth.uid());
drop policy if exists "blockierung aufheben" on public.community_blocks;
create policy "blockierung aufheben" on public.community_blocks for delete using (user_id = auth.uid());

-- Gesperrte Personen können nichts mehr teilen oder bewerten
drop policy if exists "ideen teilen" on public.community_ideas;
create policy "ideen teilen" on public.community_ideas for insert
  with check (author = auth.uid() and not public.is_banned() and char_length(idea::text) < 20000);
drop policy if exists "bewerten" on public.community_ratings;
create policy "bewerten" on public.community_ratings for insert with check (user_id = auth.uid() and not public.is_banned());
drop policy if exists "bewertung ändern" on public.community_ratings;
create policy "bewertung ändern" on public.community_ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid() and not hidden);

-- Ausgeblendete Kommentare sieht nur, wer sie geschrieben hat
drop policy if exists "bewertungen lesen" on public.community_ratings;
create policy "bewertungen lesen" on public.community_ratings for select using (not hidden or user_id = auth.uid() or public.is_moderator());

-- Eigene Ideen dürfen nur Inhalt, Anzeigename und Einspruch ändern – nie „ausgeblendet“ oder die Begründung
revoke update on public.community_ideas from authenticated;
grant update (idea, display_name, appeal, appeal_at) on public.community_ideas to authenticated;
revoke update on public.community_ratings from authenticated;
grant update (stars, comment) on public.community_ratings to authenticated;
grant select, insert, delete on public.community_ideas to authenticated;
grant select, insert, delete on public.community_ratings to authenticated;
grant insert on public.community_reports to authenticated;
grant select, delete on public.community_blocks to authenticated;

-- ------------------------------------------------------------ Übersicht ohne Blockierte und Gesperrte
drop view if exists public.community_feed;
create view public.community_feed with (security_invoker = true) as
  select i.id, i.idea, i.city, i.lat, i.lon, i.moods, i.cost, i.place, i.uses, i.created_at, i.display_name,
         (i.author = auth.uid()) as mine,
         coalesce(round(avg(r.stars)::numeric, 1), 0) as avg_stars,
         count(r.stars)::int as rating_count
    from public.community_ideas i
    left join public.community_ratings r on r.idea_id = i.id and not r.hidden
   where not i.hidden
     and i.author not in (select blocked from public.community_blocks where user_id = auth.uid())
     and not public.user_banned(i.author)
   group by i.id;
grant select on public.community_feed to authenticated;

-- Kommentare zu einer Idee (ohne Blockierte), mit Kennung zum Melden – ohne Konto-Daten
create or replace function public.community_reviews(i uuid)
returns table (id uuid, stars int, comment text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.stars, r.comment, r.created_at, r.user_id = auth.uid()
    from community_ratings r
   where r.idea_id = i and (not r.hidden or r.user_id = auth.uid())
     and r.user_id not in (select blocked from community_blocks where user_id = auth.uid())
     and r.user_id not in (select user_id from community_bans)
   order by r.created_at desc limit 30;
$$;
grant execute on function public.community_reviews(uuid) to authenticated;

-- ------------------------------------------------------------ Melden & Blockieren (ohne die Konto-ID preiszugeben)
create or replace function public.report_content(i uuid, review uuid, reason text, note text, block boolean)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  insert into community_reports (idea_id, user_id, reason, note, review_id)
       values (i, auth.uid(), left(reason, 60), left(note, 500), review)
  on conflict do nothing;
  if block then
    select case when review is null then (select author from community_ideas where id = i)
                else (select user_id from community_ratings where id = review) end into who;
    if who is not null and who <> auth.uid() then
      insert into community_blocks (user_id, blocked) values (auth.uid(), who) on conflict do nothing;
    end if;
  end if;
end $$;
grant execute on function public.report_content(uuid, uuid, text, text, boolean) to authenticated;

create or replace function public.block_author(i uuid)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  select author into who from community_ideas where id = i;
  if who is not null and who <> auth.uid() then
    insert into community_blocks (user_id, blocked) values (auth.uid(), who) on conflict do nothing;
  end if;
end $$;
grant execute on function public.block_author(uuid) to authenticated;

create or replace function public.unblock_all()
returns void language sql security definer set search_path = public as $$
  delete from community_blocks where user_id = auth.uid();
$$;
grant execute on function public.unblock_all() to authenticated;

-- Nach drei Meldungen vorläufig ausblenden, bis jemand aus der Moderation entscheidet
create or replace function public.hide_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.review_id is null then
    if (select count(*) from community_reports where idea_id = new.idea_id and review_id is null and not done) >= 3 then
      update community_ideas set hidden = true, mod_reason = coalesce(mod_reason, 'Mehrfach gemeldet – wird geprüft'), moderated_at = now() where id = new.idea_id;
    end if;
  elsif (select count(*) from community_reports where review_id = new.review_id and not done) >= 3 then
    update community_ratings set hidden = true where id = new.review_id;
  end if;
  return new;
end $$;
drop trigger if exists hide_reported on public.community_reports;
create trigger hide_reported after insert on public.community_reports for each row execute function public.hide_reported();

-- ------------------------------------------------------------ Moderation
create or replace function public.moderation_queue()
returns table (idea_id uuid, review_id uuid, title text, content jsonb, comment text, display_name text, city text, hidden boolean,
               mod_reason text, appeal text, reports int, reasons text[], notes text[], last_report timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'keine Berechtigung'; end if;
  return query
    select i.id, rp.review_id, i.idea->>'title', i.idea, rv.comment, i.display_name, i.city,
           coalesce(rv.hidden, i.hidden), i.mod_reason, i.appeal,
           count(rp.*)::int, array_agg(distinct rp.reason), array_remove(array_agg(rp.note), null), max(rp.created_at)
      from community_reports rp
      join community_ideas i on i.id = rp.idea_id
      left join community_ratings rv on rv.id = rp.review_id
     where not rp.done
     group by i.id, rp.review_id, rv.comment, rv.hidden
    union all
    -- Einsprüche gegen Ausblendungen ohne offene Meldung
    select i.id, null::uuid, i.idea->>'title', i.idea, null::text, i.display_name, i.city, i.hidden, i.mod_reason, i.appeal, 0, '{}'::text[], '{}'::text[], i.appeal_at
      from community_ideas i
     where i.hidden and i.appeal is not null
       and not exists (select 1 from community_reports rp where rp.idea_id = i.id and not rp.done)
    order by 14 desc;
end $$;
grant execute on function public.moderation_queue() to authenticated;

-- action: 'hide' (ausblenden mit Begründung) | 'keep' (in Ordnung, Meldungen schließen) | 'delete' | 'ban' (Person sperren + ausblenden)
create or replace function public.moderate(i uuid, review uuid, action text, reason text)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if not is_moderator() then raise exception 'keine Berechtigung'; end if;
  if review is not null then
    select user_id into who from community_ratings where id = review;
    if action in ('hide', 'ban') then update community_ratings set hidden = true where id = review; end if;
    if action = 'keep' then update community_ratings set hidden = false where id = review; end if;
    if action = 'delete' then delete from community_ratings where id = review; end if;
    update community_reports set done = true where review_id = review;
  else
    select author into who from community_ideas where id = i;
    if action in ('hide', 'ban') then
      update community_ideas set hidden = true, mod_reason = coalesce(nullif(reason, ''), 'Verstoß gegen die Community-Regeln'), moderated_at = now(), appeal = null where id = i;
    elsif action = 'keep' then
      update community_ideas set hidden = false, mod_reason = null, moderated_at = now(), appeal = null where id = i;
    elsif action = 'delete' then
      delete from community_ideas where id = i;
    end if;
    update community_reports set done = true where idea_id = i and review_id is null;
  end if;
  if action = 'ban' and who is not null then
    insert into community_bans (user_id, reason) values (who, nullif(reason, '')) on conflict (user_id) do update set reason = excluded.reason;
  end if;
end $$;
grant execute on function public.moderate(uuid, uuid, text, text) to authenticated;
grant execute on function public.is_moderator() to authenticated;
grant execute on function public.is_banned() to authenticated;
grant execute on function public.user_banned(uuid) to authenticated;

-- ------------------------------------------------------------ Aufräumen: erledigte Meldungen nach 6 Monaten löschen
-- (falls pg_cron aktiv ist, z. B. durch notify.sql)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'datewell-reports-cleanup';
  perform cron.schedule('datewell-reports-cleanup', '41 4 * * *',
    'delete from public.community_reports where done and created_at < now() - interval ''6 months''; update public.community_ideas set appeal = null, appeal_at = null where appeal_at < now() - interval ''6 months'' and not hidden');
exception when others then null;
end $$;

-- ------------------------------------------------------------ Dich als Moderatorin eintragen
-- E-Mail-Adresse einsetzen und die Zeile ohne „--“ ausführen:
-- insert into public.community_moderators (user_id) select id from auth.users where email = 'deine@adresse.de' on conflict do nothing;
