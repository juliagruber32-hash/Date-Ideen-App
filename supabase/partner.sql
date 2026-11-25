-- Datewell – Partner einladen, verbinden und trennen
-- Einmal im Supabase SQL Editor ausführen (läuft auch mehrfach ohne Schaden).
--
-- Einladungscodes: „DW-“ + 6 gut unterscheidbare Zeichen (ohne 0, O, 1, I, L), 30 Tage gültig,
-- einmalig verwendbar, pro Konto genau eine offene Einladung, höchstens 5 Fehlversuche pro Stunde.

create table if not exists public.invitations (
  code text primary key,
  couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null,
  partner_name text check (partner_name is null or char_length(partner_name) <= 30),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz
);
create index if not exists invitations_by on public.invitations(created_by);
alter table public.invitations enable row level security;
drop policy if exists "eigene einladungen" on public.invitations;
create policy "eigene einladungen" on public.invitations for select using (created_by = auth.uid());

create table if not exists public.join_attempts (
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null default false
);
create index if not exists join_attempts_user on public.join_attempts(user_id, at);
alter table public.join_attempts enable row level security; -- nur über die Funktionen unten

-- Nach dem Trennen: Fotos vergangener Dates bleiben für beide lesbar (Archiv)
create table if not exists public.archive_access (
  user_id uuid not null,
  couple_id uuid not null,
  primary key (user_id, couple_id)
);
alter table public.archive_access enable row level security;

create or replace function public.archive_path(p text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from archive_access where user_id = auth.uid() and couple_id = split_part(p, '/', 1)::uuid);
exception when others then
  return false;
end $$;
drop policy if exists "paarfotos lesen" on storage.objects;
create policy "paarfotos lesen" on storage.objects for select to authenticated
  using (bucket_id = 'couple-photos' and (public.is_member_path(name) or public.archive_path(name)));

-- ------------------------------------------------------------ Hilfsfunktionen
create or replace function public.my_couple() returns uuid language sql stable security definer set search_path = public as $$
  select m.couple_id from members m where m.user_id = auth.uid()
   order by (select count(*) from members x where x.couple_id = m.couple_id) desc, m.joined_at asc limit 1;
$$;

create or replace function public.couple_size(c uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from members where couple_id = c;
$$;

-- Rolle ('a'/'b') einer Person im Paar laut shared/settings
create or replace function public.role_in(c uuid, u uuid) returns text language sql stable security definer set search_path = public as $$
  select case when d.data->'members'->>'a' = u::text then 'a' when d.data->'members'->>'b' = u::text then 'b' else null end
    from docs d where d.couple_id = c and d.path = 'shared/settings';
$$;

create or replace function public.name_in(c uuid, r text) returns text language sql stable security definer set search_path = public as $$
  select nullif(trim(d.data->>(case when r = 'a' then 'nameA' else 'nameB' end)), '')
    from docs d where d.couple_id = c and d.path = 'shared/settings';
$$;

-- Buchstaben in Rollen-Feldern tauschen (wenn jemand mit eigenen Daten als andere Rolle dazukommt)
create or replace function public.swap_roles(j jsonb, from_r text, to_r text) returns jsonb language plpgsql immutable as $$
declare k text; r jsonb := j;
begin
  if from_r is null or to_r is null or from_r = to_r or jsonb_typeof(j) <> 'object' then return j; end if;
  foreach k in array array['plannedBy', 'createdBy', 'by', 'paidBy', 'from', 'to', 'createdByRole'] loop
    if r->>k = from_r then r := jsonb_set(r, array[k], to_jsonb(to_r)); end if;
  end loop;
  if jsonb_typeof(r->'ratings') = 'object' and r->'ratings' ? from_r then
    r := jsonb_set(r, '{ratings}', (r->'ratings') - from_r || jsonb_build_object(to_r, r->'ratings'->from_r));
  end if;
  return r;
end $$;

create or replace function public.new_invite_code() returns text language plpgsql volatile as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; k text; i int;
begin
  loop
    k := 'DW-';
    for i in 1..6 loop k := k || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from invitations where code = k);
  end loop;
  return k;
end $$;

-- Eingabe vereinheitlichen: Groß-/Kleinschreibung, Bindestrich, Leerzeichen und „DW“ egal
create or replace function public.norm_code(x text) returns text language sql immutable as $$
  select 'DW-' || regexp_replace(regexp_replace(upper(coalesce(x, '')), '[^A-Z0-9]', '', 'g'), '^DW', '');
$$;

-- ------------------------------------------------------------ Einladung erstellen / anzeigen / zurückziehen
create or replace function public.create_invitation(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare c uuid := my_couple(); k text; inv invitations;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  if c is null then raise exception 'kein_konto'; end if;
  if couple_size(c) >= 2 then raise exception 'schon_verbunden'; end if;
  update invitations set revoked_at = now() where created_by = auth.uid() and used_at is null and revoked_at is null;
  k := new_invite_code();
  insert into invitations (code, couple_id, created_by, partner_name) values (k, c, auth.uid(), nullif(left(trim(p_name), 30), ''))
  returning * into inv;
  return json_build_object('code', inv.code, 'partner_name', inv.partner_name, 'expires_at', inv.expires_at, 'created_at', inv.created_at);
end $$;

create or replace function public.my_invitation()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('code', code, 'partner_name', partner_name, 'expires_at', expires_at, 'created_at', created_at)
    from invitations where created_by = auth.uid() and used_at is null and revoked_at is null and expires_at > now()
   order by created_at desc limit 1;
$$;

create or replace function public.revoke_invitation()
returns void language sql security definer set search_path = public as $$
  update invitations set revoked_at = now() where created_by = auth.uid() and used_at is null and revoked_at is null;
$$;

-- Für die Einladungs-Seite (auch ohne Konto): wer lädt ein, ist der Code gültig? Verrät nur Vornamen.
create or replace function public.invitation_info(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare inv invitations; r text; nm text;
begin
  select * into inv from invitations where code = norm_code(p_code);
  if inv.code is null then return json_build_object('status', 'unbekannt'); end if;
  r := role_in(inv.couple_id, inv.created_by);
  nm := name_in(inv.couple_id, r);
  return json_build_object(
    'status', case when inv.used_at is not null or inv.revoked_at is not null or couple_size(inv.couple_id) >= 2 then 'ungueltig'
                   when inv.expires_at < now() then 'abgelaufen' else 'ok' end,
    'inviter', nm, 'partner_name', inv.partner_name);
end $$;

-- ------------------------------------------------------------ Einladung annehmen
-- Fehler kommen als {"error": …, "name": …} zurück (nicht als Exception, damit Fehlversuche gezählt bleiben):
-- unbekannt | abgelaufen | ungueltig | eigener | verbunden | zu_viele
create or replace function public.accept_invitation(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); inv invitations; mine uuid; mine_size int; old_settings jsonb; old_role text;
  a_role text; new_role text; partner_name text; s jsonb;
begin
  if me is null then raise exception 'nicht angemeldet'; end if;
  if (select count(*) from join_attempts where user_id = me and not ok and at > now() - interval '1 hour') >= 5 then
    return json_build_object('error', 'zu_viele');
  end if;
  select * into inv from invitations where code = norm_code(p_code) for update;
  if inv.code is null then
    insert into join_attempts (user_id) values (me);
    return json_build_object('error', 'unbekannt');
  end if;
  if inv.created_by = me then return json_build_object('error', 'eigener'); end if;

  -- Bin ich schon mit jemandem verbunden?
  select m.couple_id into mine from members m where m.user_id = me
   order by (select count(*) from members x where x.couple_id = m.couple_id) desc limit 1;
  if mine = inv.couple_id then
    return json_build_object('couple_id', mine, 'role', role_in(mine, me), 'already', true);
  end if;
  mine_size := coalesce(couple_size(mine), 0);
  if mine_size >= 2 then
    return json_build_object('error', 'verbunden', 'name', name_in(mine, case role_in(mine, me) when 'a' then 'b' else 'a' end));
  end if;

  if inv.used_at is not null or inv.revoked_at is not null or couple_size(inv.couple_id) >= 2 then
    insert into join_attempts (user_id) values (me);
    return json_build_object('error', 'ungueltig');
  end if;
  if inv.expires_at < now() then
    return json_build_object('error', 'abgelaufen', 'name', name_in(inv.couple_id, role_in(inv.couple_id, inv.created_by)));
  end if;

  -- Rollen: wer eingeladen hat, behält seine Rolle; ich bekomme die andere
  a_role := coalesce(role_in(inv.couple_id, inv.created_by), 'a');
  new_role := case a_role when 'a' then 'b' else 'a' end;

  -- Eigene Daten aus meinem bisherigen (Allein-)Konto mitnehmen
  if mine is not null then
    select data into old_settings from docs where couple_id = mine and path = 'shared/settings';
    old_role := role_in(mine, me);
    insert into docs (couple_id, path, data, owner, updated_at)
      select inv.couple_id, d.path, swap_roles(d.data, old_role, new_role), d.owner, now()
        from docs d where d.couple_id = mine and d.path <> 'shared/settings'
      on conflict (couple_id, path) do nothing;
    update invitations set revoked_at = now() where created_by = me and used_at is null and revoked_at is null;
    delete from members where couple_id = mine and user_id = me;
    delete from couples c where c.id = mine and not exists (select 1 from members m where m.couple_id = c.id);
  end if;

  insert into members (couple_id, user_id) values (inv.couple_id, me) on conflict do nothing;
  update invitations set used_at = now(), used_by = me where code = inv.code;
  insert into join_attempts (user_id, ok) values (me, true);

  -- Gemeinsame Einstellungen: Mitglied eintragen, Einladung erledigt, Zeitpunkt für die Mitteilung an A
  partner_name := coalesce(nullif(trim(old_settings->>(case old_role when 'a' then 'nameA' when 'b' then 'nameB' end)), ''), inv.partner_name);
  select data into s from docs where couple_id = inv.couple_id and path = 'shared/settings';
  s := coalesce(s, '{}'::jsonb);
  s := jsonb_set(s, '{members}', coalesce(s->'members', '{}'::jsonb) || jsonb_build_object(a_role, inv.created_by::text, new_role, me::text));
  s := s || jsonb_build_object('partnerJoinedAt', (extract(epoch from now()) * 1000)::bigint, 'connectedSince', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'), 'invitee', new_role);
  if partner_name is not null then s := s || jsonb_build_object(case new_role when 'a' then 'nameA' else 'nameB' end, partner_name); end if;
  s := s - 'notice';
  -- Persönliches aus meinem Allein-Konto übernehmen: Vorlieben, Einstieg, Community-Name, eigener Geburtstag
  if old_settings is not null and old_role is not null then
    s := jsonb_set(s, '{prefs}', coalesce(s->'prefs', '{}'::jsonb) || jsonb_build_object(new_role, coalesce(old_settings->'prefs'->old_role, '{}'::jsonb)));
    s := jsonb_set(s, '{onboarded}', coalesce(s->'onboarded', '{}'::jsonb) || jsonb_build_object(new_role, coalesce(old_settings->'onboarded'->old_role, 'false'::jsonb)));
    if old_settings->'community'->old_role is not null then
      s := jsonb_set(s, '{community}', coalesce(s->'community', '{}'::jsonb) || jsonb_build_object(new_role, old_settings->'community'->old_role));
    end if;
    s := jsonb_set(s, '{specialDays}',
      coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(s->'specialDays', '[]'::jsonb)) x where not (x->>'kind' = 'geburtstag' and x->>'who' = new_role)), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_set(x, '{who}', to_jsonb(new_role)) || jsonb_build_object('id', 'sp-geburtstag-' || new_role))
                     from jsonb_array_elements(coalesce(old_settings->'specialDays', '[]'::jsonb)) x where x->>'kind' = 'geburtstag' and x->>'who' = old_role), '[]'::jsonb));
  end if;
  insert into docs (couple_id, path, data, updated_at) values (inv.couple_id, 'shared/settings', s, now())
    on conflict (couple_id, path) do update set data = excluded.data, updated_at = now();

  return json_build_object('couple_id', inv.couple_id, 'role', new_role, 'inviter', name_in(inv.couple_id, a_role),
                           'old_settings', old_settings, 'old_role', old_role);
end $$;

-- ------------------------------------------------------------ Verbindung trennen
-- Vergangene Dates, Erinnerungen, Fotos: beide behalten eine Kopie (Archiv).
-- Geplante Dates, eigene Ideen, Merkliste, versteckte Dates und Ausgaben: bleiben bei der Person, die sie erstellt hat.
-- Kostenausgleich: wird abgeschlossen und archiviert. Paar-Daten (Jahrestag, Status): in beiden Konten gelöscht.
-- Community-Dates unter Paarnamen: wieder unter dem Vornamen der Person, die sie geteilt hat.
create or replace function public.disconnect_partner()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); c uuid; partner uuid; s jsonb; r text; o text; n uuid; today text; my_name text; their_name text;
  ns jsonb; cs jsonb; pair text; nk text;
begin
  if me is null then raise exception 'nicht angemeldet'; end if;
  select m.couple_id into c from members m where m.user_id = me and couple_size(m.couple_id) >= 2 limit 1;
  if c is null then raise exception 'nicht_verbunden'; end if;
  select user_id into partner from members where couple_id = c and user_id <> me limit 1;
  select data into s from docs where couple_id = c and path = 'shared/settings';
  s := coalesce(s, '{}'::jsonb);
  r := coalesce(role_in(c, me), 'a');
  o := case r when 'a' then 'b' else 'a' end;
  today := to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD');
  my_name := nullif(trim(s->>(case r when 'a' then 'nameA' else 'nameB' end)), '');
  their_name := nullif(trim(s->>(case o when 'a' then 'nameA' else 'nameB' end)), '');
  pair := s->'communityPair'->>'name';

  insert into couples (code) values (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))) returning id into n;
  insert into members (couple_id, user_id) values (n, me);

  -- Vergangene Dates: Kopie für mich, beide als Archiv markiert
  update docs set data = data || jsonb_build_object('archived', true, 'archivedWith', my_name)
   where couple_id = c and path like 'dates/%' and data->>'date' < today;
  insert into docs (couple_id, path, data, updated_at)
    select n, path, data - 'archivedWith' || jsonb_build_object('archived', true, 'archivedWith', their_name), now()
      from docs where couple_id = c and path like 'dates/%' and data->>'date' < today;
  -- Geplante Dates, eigene Ideen, Merkliste: zu mir, wenn ich sie erstellt habe
  update docs set couple_id = n where couple_id = c and (
       (path like 'dates/%' and data->>'date' >= today and data->>'plannedBy' = r)
    or (path like 'ideas/%' and data->>'createdBy' = r)
    or (path like 'favorites/%' and data->>'by' = r));
  -- Kostenausgleich abschließen: Kopie für beide, archiviert
  update docs set data = data || jsonb_build_object('archived', true) where couple_id = c and path like 'expenses/%';
  insert into docs (couple_id, path, data, updated_at)
    select n, path, data, now() from docs where couple_id = c and path like 'expenses/%';
  -- Private Daten (Überraschungen, versteckte Ausgaben) gehören mir
  update docs set couple_id = n where couple_id = c and owner = me;

  -- Einstellungen für mich allein (eigene Daten behalten, Paar-Daten weg)
  ns := jsonb_build_object(
    'members', jsonb_build_object(r, me::text, o, null),
    case r when 'a' then 'nameA' else 'nameB' end, coalesce(my_name, ''),
    'prefs', jsonb_build_object(r, coalesce(s->'prefs'->r, '{}'::jsonb)),
    'onboarded', jsonb_build_object(r, true),
    'community', jsonb_build_object(r, coalesce(s->'community'->r, '{}'::jsonb)),
    'specialDays', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(s->'specialDays', '[]'::jsonb)) x where x->>'kind' = 'geburtstag' and x->>'who' = r), '[]'::jsonb),
    'notice', jsonb_build_object('type', 'getrennt-selbst', 'name', their_name, 'at', (extract(epoch from now()) * 1000)::bigint));
  for nk in select unnest(array['city', 'geo', 'datesPerMonth', 'vegan', 'valentine', 'fixed', 'learn']) loop
    if s ? nk then ns := ns || jsonb_build_object(nk, s->nk); end if;
  end loop;
  insert into docs (couple_id, path, data, updated_at) values (n, 'shared/settings', ns, now());

  -- Einstellungen der anderen Person: meine Daten und die Paar-Daten entfernen, neutraler Hinweis
  cs := s - 'anniversary' - 'relationship' - 'communityPair' - 'connectedSince' - 'partnerJoinedAt' - 'nextTurn' - 'invitee' - 'pairNotice' - 'obStep';
  cs := cs || jsonb_build_object(
    'members', jsonb_build_object(o, partner::text, r, null),
    case r when 'a' then 'nameA' else 'nameB' end, '',
    'formerName', my_name,
    'prefs', coalesce(s->'prefs', '{}'::jsonb) - r,
    'onboarded', coalesce(s->'onboarded', '{}'::jsonb) - r,
    'community', coalesce(s->'community', '{}'::jsonb) - r,
    'specialDays', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(s->'specialDays', '[]'::jsonb)) x where x->>'kind' = 'geburtstag' and x->>'who' = o), '[]'::jsonb),
    'notice', jsonb_build_object('type', 'getrennt', 'name', my_name, 'at', (extract(epoch from now()) * 1000)::bigint));
  update docs set data = cs, updated_at = now() where couple_id = c and path = 'shared/settings';

  -- Community: Paarname zurück auf Vornamen
  if pair is not null then
    update community_ideas set display_name = my_name where author = me and display_name = pair;
    update community_ideas set display_name = their_name where author = partner and display_name = pair;
  end if;

  delete from members where couple_id = c and user_id = me;
  insert into archive_access (user_id, couple_id) values (me, c) on conflict do nothing;
  update invitations set revoked_at = now() where created_by in (me, partner) and used_at is null and revoked_at is null;
  return n;
end $$;

-- ------------------------------------------------------------ Konto löschen: erst trennen, dann alles löschen
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'nicht angemeldet'; end if;
  if exists (select 1 from members m where m.user_id = me and couple_size(m.couple_id) >= 2) then
    perform disconnect_partner();
  end if;
  delete from docs where owner = me;
  delete from docs d using members m where m.user_id = me and d.couple_id = m.couple_id and couple_size(m.couple_id) = 1;
  delete from invitations where created_by = me;
  delete from archive_access where user_id = me;
  delete from join_attempts where user_id = me;
  delete from community_ratings where user_id = me;
  delete from community_reports where user_id = me;
  delete from community_ideas where author = me;
  delete from members where user_id = me;
  delete from couples c where not exists (select 1 from members m where m.couple_id = c.id);
  delete from auth.users where id = me;
exception when undefined_table then
  -- ältere Datenbank ohne Community-Tabellen
  delete from docs where owner = me;
  delete from members where user_id = me;
  delete from couples c where not exists (select 1 from members m where m.couple_id = c.id);
  delete from auth.users where id = me;
end $$;

-- ------------------------------------------------------------ Alter Weg (Paar-Code) absichern
-- Früher konnte jeder mit dem Paar-Code beitreten. Jetzt: nur, wer schon Mitglied ist, oder in ein Paar mit
-- genau einer Person (alte Einladungslinks); nie als dritte Person.
create or replace function public.join_couple(invite text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'nicht angemeldet'; end if;
  if norm_code(invite) in (select code from invitations) then
    declare res json := accept_invitation(invite);
    begin
      if res->>'error' is not null then raise exception 'Einladung: %', res->>'error'; end if;
      return (res->>'couple_id')::uuid;
    end;
  end if;
  select couples.id into c from couples where couples.code = upper(trim(invite));
  if c is null then raise exception 'Code nicht gefunden'; end if;
  if exists (select 1 from members where couple_id = c and user_id = me) then return c; end if;
  if couple_size(c) >= 2 then raise exception 'Diese Einladung ist nicht mehr gültig.'; end if;
  if exists (select 1 from members m where m.user_id = me and couple_size(m.couple_id) >= 2) then
    raise exception 'Du bist schon mit jemandem verbunden.';
  end if;
  insert into members(couple_id, user_id) values (c, me) on conflict do nothing;
  return c;
end $$;

-- ------------------------------------------------------------ Rechte
grant select on public.invitations to authenticated;
grant execute on function public.create_invitation(text) to authenticated;
grant execute on function public.my_invitation() to authenticated;
grant execute on function public.revoke_invitation() to authenticated;
grant execute on function public.invitation_info(text) to anon, authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.disconnect_partner() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.join_couple(text) to authenticated;
revoke execute on function public.swap_roles(jsonb, text, text) from public;
revoke execute on function public.new_invite_code() from public;
