-- Date-Ideen-App: gemeinsamer Speicher für Paare.
-- In Supabase: SQL Editor -> New query -> alles einfügen -> Run.

-- Keine Erweiterungen nötig: gen_random_uuid() ist in Postgres eingebaut.

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

-- Alle App-Daten als JSON-Dokumente. owner gesetzt = privat (z. B. Überraschungs-Details).
create table if not exists public.docs (
  couple_id uuid not null references public.couples(id) on delete cascade,
  path text not null,
  data jsonb not null,
  owner uuid,
  updated_at timestamptz not null default now(),
  primary key (couple_id, path)
);

alter table public.couples enable row level security;
alter table public.members enable row level security;
alter table public.docs enable row level security;

create or replace function public.is_member(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where couple_id = c and user_id = auth.uid());
$$;

drop policy if exists "eigene Mitgliedschaft" on public.members;
create policy "eigene Mitgliedschaft" on public.members for select using (public.is_member(couple_id));

drop policy if exists "eigenes Paar" on public.couples;
create policy "eigenes Paar" on public.couples for select using (public.is_member(id));

drop policy if exists "lesen" on public.docs;
create policy "lesen" on public.docs for select
  using (public.is_member(couple_id) and (owner is null or owner = auth.uid()));
drop policy if exists "anlegen" on public.docs;
create policy "anlegen" on public.docs for insert
  with check (public.is_member(couple_id) and (owner is null or owner = auth.uid()));
drop policy if exists "ändern" on public.docs;
create policy "ändern" on public.docs for update
  using (public.is_member(couple_id) and (owner is null or owner = auth.uid()))
  with check (public.is_member(couple_id) and (owner is null or owner = auth.uid()));
drop policy if exists "löschen" on public.docs;
create policy "löschen" on public.docs for delete
  using (public.is_member(couple_id) and (owner is null or owner = auth.uid()));

-- Neues Paar anlegen: gibt {id, code} zurück.
create or replace function public.create_couple()
returns json language plpgsql security definer set search_path = public as $$
declare c uuid; k text;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  k := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into couples(code) values (k) returning couples.id into c;
  insert into members(couple_id, user_id) values (c, auth.uid());
  return json_build_object('id', c, 'code', k);
end $$;

-- Mit Einladungscode beitreten.
create or replace function public.join_couple(invite text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  select couples.id into c from couples where couples.code = upper(trim(invite));
  if c is null then raise exception 'Code nicht gefunden'; end if;
  insert into members(couple_id, user_id) values (c, auth.uid()) on conflict do nothing;
  return c;
end $$;

-- Verschachtelte JSON-Objekte zusammenführen (für gleichzeitige Änderungen, z. B. Abstimmungen).
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; r jsonb;
begin
  if a is null or jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then
    return b;
  end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(r -> k) = 'object' and jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], public.jsonb_deep_merge(r -> k, v));
    else
      r := jsonb_set(r, array[k], v, true);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.merge_doc(c uuid, p text, patch jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update docs set data = public.jsonb_deep_merge(data, patch), updated_at = now()
   where couple_id = c and path = p;
  return found;
end $$;

grant execute on function public.create_couple() to authenticated;
grant execute on function public.join_couple(text) to authenticated;
grant execute on function public.merge_doc(uuid, text, jsonb) to authenticated;

-- Live-Updates
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Community: Date-Ideen mit anderen teilen, übernehmen und bewerten
-- =====================================================================

create table if not exists public.community_ideas (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid(),
  idea jsonb not null,
  city text,
  lat double precision,
  lon double precision,
  moods text[] not null default '{}',
  cost int,
  place text,
  uses int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.community_ratings (
  idea_id uuid not null references public.community_ideas(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  stars int not null check (stars between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 300),
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);

create table if not exists public.community_reports (
  idea_id uuid not null references public.community_ideas(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  reason text,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);

alter table public.community_ideas enable row level security;
alter table public.community_ratings enable row level security;
alter table public.community_reports enable row level security;

drop policy if exists "ideen lesen" on public.community_ideas;
create policy "ideen lesen" on public.community_ideas for select using (not hidden or author = auth.uid());
drop policy if exists "ideen teilen" on public.community_ideas;
create policy "ideen teilen" on public.community_ideas for insert with check (author = auth.uid() and char_length(idea::text) < 20000);
drop policy if exists "ideen ändern" on public.community_ideas;
create policy "ideen ändern" on public.community_ideas for update using (author = auth.uid()) with check (author = auth.uid());
drop policy if exists "ideen löschen" on public.community_ideas;
create policy "ideen löschen" on public.community_ideas for delete using (author = auth.uid());

drop policy if exists "bewertungen lesen" on public.community_ratings;
create policy "bewertungen lesen" on public.community_ratings for select using (true);
drop policy if exists "bewerten" on public.community_ratings;
create policy "bewerten" on public.community_ratings for insert with check (user_id = auth.uid());
drop policy if exists "bewertung ändern" on public.community_ratings;
create policy "bewertung ändern" on public.community_ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "bewertung löschen" on public.community_ratings;
create policy "bewertung löschen" on public.community_ratings for delete using (user_id = auth.uid());

drop policy if exists "melden" on public.community_reports;
create policy "melden" on public.community_reports for insert with check (user_id = auth.uid());

-- Übersicht mit Durchschnittsbewertung
create or replace view public.community_feed with (security_invoker = true) as
  select i.id, i.idea, i.city, i.lat, i.lon, i.moods, i.cost, i.place, i.uses, i.created_at,
         (i.author = auth.uid()) as mine,
         coalesce(round(avg(r.stars)::numeric, 1), 0) as avg_stars,
         count(r.stars)::int as rating_count
    from public.community_ideas i
    left join public.community_ratings r on r.idea_id = i.id
   where not i.hidden
   group by i.id;

-- Wie oft wurde eine Idee übernommen?
create or replace function public.use_idea(i uuid)
returns void language sql security definer set search_path = public as $$
  update community_ideas set uses = uses + 1 where id = i and not hidden;
$$;

-- Nach drei Meldungen automatisch ausblenden (du kannst sie im Table Editor prüfen)
create or replace function public.hide_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from community_reports where idea_id = new.idea_id) >= 3 then
    update community_ideas set hidden = true where id = new.idea_id;
  end if;
  return new;
end $$;
drop trigger if exists hide_reported on public.community_reports;
create trigger hide_reported after insert on public.community_reports for each row execute function public.hide_reported();

grant select on public.community_feed to authenticated;
grant execute on function public.use_idea(uuid) to authenticated;

-- =====================================================================
-- Fotos: privat fürs Paar (couple-photos) oder öffentlich (public-photos)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('couple-photos', 'couple-photos', false, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-photos', 'public-photos', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Pfad beginnt mit der Paar-ID: <couple_id>/<date_id>/<foto>.jpg
create or replace function public.is_member_path(p text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_member(split_part(p, '/', 1)::uuid);
exception when others then
  return false;
end $$;

drop policy if exists "paarfotos lesen" on storage.objects;
create policy "paarfotos lesen" on storage.objects for select to authenticated
  using (bucket_id = 'couple-photos' and public.is_member_path(name));
drop policy if exists "paarfotos hochladen" on storage.objects;
create policy "paarfotos hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'couple-photos' and public.is_member_path(name));
drop policy if exists "paarfotos löschen" on storage.objects;
create policy "paarfotos löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'couple-photos' and public.is_member_path(name));

-- Öffentliche Fotos: jeder liest (öffentlicher Bucket), hochladen/löschen nur im eigenen Ordner <user_id>/…
drop policy if exists "öffentliche fotos hochladen" on storage.objects;
create policy "öffentliche fotos hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-photos' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists "öffentliche fotos löschen" on storage.objects;
create policy "öffentliche fotos löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'public-photos' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists "öffentliche fotos lesen" on storage.objects;
create policy "öffentliche fotos lesen" on storage.objects for select to authenticated
  using (bucket_id = 'public-photos');

-- =====================================================================
-- Konten: Benutzername zu jedem Konto (Anmeldung per E-Mail + Passwort)
-- =====================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,20}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "eigenes profil lesen" on public.profiles;
create policy "eigenes profil lesen" on public.profiles for select
  using (id = auth.uid() or exists (
    select 1 from public.members m1 join public.members m2 on m1.couple_id = m2.couple_id
     where m1.user_id = auth.uid() and m2.user_id = profiles.id));

-- Profil automatisch beim Registrieren anlegen (Benutzername aus den Anmeldedaten)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data->>'username'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ist ein Benutzername noch frei? (verrät nichts außer ja/nein)
create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(name) ~ '^[a-z0-9._-]{3,20}$'
     and not exists (select 1 from profiles where username = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Konto und alle eigenen Daten endgültig löschen
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'nicht angemeldet'; end if;
  delete from docs where owner = me;
  delete from community_ratings where user_id = me;
  delete from community_reports where user_id = me;
  delete from community_ideas where author = me;
  delete from members where user_id = me;
  delete from couples c where not exists (select 1 from members m where m.couple_id = c.id);
  delete from auth.users where id = me;
end $$;
grant execute on function public.delete_my_account() to authenticated;

-- Zugriffsrechte für angemeldete Nutzer (neuere Supabase-Projekte vergeben sie nicht automatisch)
grant usage on schema public to authenticated;
grant select on public.couples to authenticated;
grant select on public.members to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.community_ideas to authenticated;
grant select, insert, update, delete on public.community_ratings to authenticated;
grant insert on public.community_reports to authenticated;
