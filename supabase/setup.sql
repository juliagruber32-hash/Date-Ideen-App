-- Date-Ideen-App: gemeinsamer Speicher für Paare.
-- In Supabase: SQL Editor -> New query -> alles einfügen -> Run.

create extension if not exists pgcrypto;

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
  k := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));
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
