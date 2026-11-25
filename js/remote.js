// Gemeinsamer Speicher über Supabase (für die eigene Webseite).
// Stellt dieselbe kleine Dokument-Schnittstelle bereit wie die Claude-Datenbank:
// db.doc(path).set/update/delete/onSnapshot und db.collection(path).onSnapshot.

// Bibliothek liegt in der App (wird offline zwischengespeichert); nur falls sie fehlt, vom CDN laden
const LIB = new URL('./vendor/supabase.js', import.meta.url).href;
const LIB_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const CFG_KEY = 'date-ideen.remote.v1';

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) ?? null;
  } catch {
    return null;
  }
}
export function saveConfig(cfg) {
  try {
    if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CFG_KEY);
  } catch {
    /* ignorieren */
  }
}

/** Einladungslink zu einem Einladungscode, z. B. …/#i/DW-4K7R2M */
export const inviteLinkFor = (code) => `${location.origin}${location.pathname}#i/${encodeURIComponent(code)}`;
/** Einladungscode vereinheitlichen: Groß-/Kleinschreibung, Leerzeichen und Bindestrich egal. */
export const normCode = (x) => `DW-${String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^DW/, '')}`;
export const looksLikeCode = (x) => /^DW-[A-Z0-9]{4,8}$/.test(normCode(x));

/** Einladung aus der Adresse lesen: neues Format #i/DW-…, ältere Links #einladung=… */
export function readInvite(hash = location.hash) {
  const n = hash.match(/#i[/=]([\w-]+)/);
  if (n) return { invite: normCode(decodeURIComponent(n[1])) };
  const m = hash.match(/einladung=([\w-]+)/);
  if (!m) return null;
  try {
    const j = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    return j.u && j.k && j.c ? { url: j.u, key: j.k, code: j.c } : null;
  } catch {
    return null;
  }
}

// Texte zu den Fehlern beim Verbinden (wie in der Spezifikation)
export function inviteErrorText(err, name = '') {
  const n = name || 'die andere Person';
  return {
    unbekannt: 'Diesen Code kennen wir nicht. Prüf ihn noch einmal.',
    abgelaufen: `Dieser Code ist abgelaufen. Bitte ${n} um einen neuen.`,
    eigener: 'Das ist dein eigener Code. Schick ihn an deinen Partner.',
    verbunden: `Du bist schon mit ${n} verbunden. Trenn zuerst die Verbindung unter Einstellungen → Partner.`,
    ungueltig: 'Diese Einladung ist nicht mehr gültig.',
    zu_viele: 'Zu viele Versuche. Probier es in einer Stunde noch mal.',
    netz: 'Gerade keine Verbindung. Wir versuchen es gleich noch mal.',
  }[err] ?? 'Das hat nicht geklappt. Probier es gleich noch mal.';
}

/** Infos zu einer Einladung – auch ohne Konto (Vorname der einladenden Person, gültig?). */
export async function invitationInfo(cfg, code) {
  const client = await getClient(cfg);
  const { data, error } = await client.rpc('invitation_info', { p_code: normCode(code) });
  if (error) throw unavailable();
  return data;
}

function loadLib() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('Supabase konnte nicht geladen werden')));
    s.onerror = () => {
      // Ersatz: vom CDN laden
      const t = document.createElement('script');
      t.src = LIB_CDN;
      t.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(unavailable('Supabase konnte nicht geladen werden')));
      t.onerror = () => reject(unavailable('Supabase konnte nicht geladen werden (keine Verbindung?)'));
      document.head.append(t);
    };
    document.head.append(s);
  });
}

const unavailable = (msg = 'Verbindung zu eurem Konto gerade nicht möglich.') => Object.assign(new Error(msg), { code: 'unavailable' });
// Fehlende Datenbank-Rechte (Supabase-Einrichtung unvollständig) klar benennen statt endlos neu zu versuchen
const dbError = (error) => (error?.code === '42501' || /permission denied/i.test(error?.message ?? '')
  ? Object.assign(new Error('In der Datenbank fehlen noch Zugriffsrechte. Bitte supabase/grants.sql im Supabase SQL Editor ausführen.'), { code: 'setup' })
  : unavailable());
const errCode = (e) => (e?.code === '42501' || /row-level security/i.test(e?.message ?? '') ? 'invalid_argument' : 'unavailable');

function mergeDeep(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = mergeDeep(a[k], v);
  return out;
}

/* ------------------------------------------------------------ Konten (E-Mail + Passwort) */

const clients = new Map();
const REMEMBER_KEY = 'dately-remember';

/** „Angemeldet bleiben“: an = Anmeldung bleibt nach dem Schließen gespeichert, aus = nur bis zum Schließen. */
export function getRemember() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setRemember(on) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? '1' : '0');
  } catch {
    /* ignorieren */
  }
  clients.clear(); // Client mit passendem Speicher neu erstellen
}

function authStorage() {
  // Anmeldung, die schon im dauerhaften Speicher liegt, immer weiterverwenden.
  try {
    return getRemember() ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export async function getClient(cfg) {
  if (!clients.has(cfg.url)) {
    const lib = await loadLib();
    clients.set(cfg.url, lib.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'dately-auth', storage: authStorage() } }));
  }
  return clients.get(cfg.url);
}

export function lastEmail() {
  try {
    return localStorage.getItem('dately-last-email') ?? '';
  } catch {
    return '';
  }
}
function rememberEmail(email) {
  try {
    localStorage.setItem('dately-last-email', email);
  } catch {
    /* ignorieren */
  }
}

const appUrl = () => `${location.origin}${location.pathname}`;

function authError(error) {
  const m = error?.message ?? '';
  if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/email not confirmed/i.test(m)) return 'Bitte bestätige zuerst deine E-Mail-Adresse – der Link ist in deinem Postfach.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'Für diese E-Mail-Adresse gibt es schon ein Konto. Melde dich an.';
  if (/password should be|weak password|at least/i.test(m)) return 'Das Passwort ist zu schwach – bitte mindestens 8 Zeichen.';
  if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche. Bitte warte ein paar Minuten.';
  if (/invalid.*email|unable to validate email/i.test(m)) return 'Diese E-Mail-Adresse ist ungültig.';
  if (/signups not allowed|signup.*disabled/i.test(m)) return 'Registrieren ist in Supabase ausgeschaltet (Authentication → Sign In / Providers → Email).';
  return m || 'Das hat nicht geklappt. Bitte versuche es noch einmal.';
}

export async function currentSession(cfg) {
  const client = await getClient(cfg);
  const { data } = await client.auth.getSession();
  return data.session ?? null;
}

export async function onAuthChange(cfg, cb) {
  const client = await getClient(cfg);
  client.auth.onAuthStateChange((event, session) => cb(event, session));
}

export const validUsername = (u) => /^[a-z0-9._-]{3,20}$/.test(u);

/** Registrieren. Gibt { session } zurück; session ist null, wenn die E-Mail erst bestätigt werden muss. */
export async function signUp(cfg, { email, password, invite }) {
  const client = await getClient(cfg);
  // Interne Kennung (niemand sieht sie) – die Namen legt ihr in der App selbst fest.
  const name = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 20);
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { username: name, ...(invite ? { invite } : {}) }, emailRedirectTo: appUrl() },
  });
  if (error) throw new Error(authError(error));
  // Supabase verrät bei schon bestehender E-Mail aus Sicherheitsgründen nichts – dann fehlen Identitäten.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('Für diese E-Mail-Adresse gibt es schon ein Konto. Melde dich an.');
  }
  return { session: data.session };
}

export async function signIn(cfg, { email, password }) {
  const client = await getClient(cfg);
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(authError(error));
  rememberEmail(email.trim());
  return data.session;
}

/** Mit Apple anmelden (nur wenn in config.js eingeschaltet und in Supabase eingerichtet). */
export async function signInWithApple(cfg) {
  const client = await getClient(cfg);
  const { error } = await client.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: location.href.split('#')[0] } });
  if (error) throw new Error(authError(error));
}

export async function resetPassword(cfg, email) {
  const client = await getClient(cfg);
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
  if (error) throw new Error(authError(error));
}

export async function updatePassword(cfg, password) {
  const client = await getClient(cfg);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(authError(error));
}

export async function signOut(cfg) {
  const client = await getClient(cfg);
  await client.auth.signOut();
}

export async function deleteAccount(cfg) {
  const client = await getClient(cfg);
  const { error } = await client.rpc('delete_my_account');
  if (error) throw new Error(`Löschen fehlgeschlagen: ${error.message}`);
  await client.auth.signOut();
}

/**
 * Mit dem angemeldeten Konto verbinden: Paar finden, beitreten oder anlegen.
 * cfg: { url, key, code?, coupleId? }. Gibt { db, uid, user, cfg, community, photos } zurück.
 */
export async function connectSupabase(cfg) {
  const client = await getClient(cfg);
  const { data: sess, error: sessErr } = await client.auth.getSession();
  const session = sess?.session;
  if (!session) {
    // Liegt eine Anmeldung auf dem Gerät, die nur wegen fehlendem Netz nicht erneuert werden konnte? Dann später erneut versuchen.
    let stored = false;
    try {
      stored = !!(window.localStorage.getItem('dately-auth') || window.sessionStorage.getItem('dately-auth'));
    } catch {
      /* egal */
    }
    if (stored && (navigator.onLine === false || /fetch|network|timeout/i.test(sessErr?.message ?? ''))) throw unavailable();
    throw Object.assign(new Error('Bitte melde dich an.'), { code: 'auth' });
  }
  const uid = session.user.id;
  const um = session.user.user_metadata ?? {};
  const prof = await client.from('profiles').select('username').eq('id', uid).maybeSingle();
  const user = { id: uid, email: session.user.email, username: prof.data?.username ?? um.username ?? '' };

  // Paar: Einladung > gespeichertes Paar > bestehende Mitgliedschaft > neues Paar
  let coupleId = cfg.coupleId;
  let code = cfg.code ?? null; // älteres Format: Paar-Code im Link
  const invite = cfg.invite ?? (looksLikeCode(um.invite) ? um.invite : null);
  if (!invite && !code && um.invite) code = um.invite;
  let joined = null;
  let inviteError = null;
  if (invite) {
    // Erst das eigene Konto sicherstellen (sonst gäbe es nichts mitzunehmen), dann der Einladung folgen
    const { data, error } = await client.rpc('accept_invitation', { p_code: normCode(invite) });
    if (error) {
      if (/accept_invitation|schema cache|could not find/i.test(error.message)) inviteError = 'Einladungen sind in der Datenbank noch nicht eingerichtet (partner.sql ausführen).';
      else if (/fetch|network/i.test(error.message)) throw unavailable();
      else inviteError = error.message;
    } else if (data?.error) {
      inviteError = inviteErrorText(data.error, data.name);
    } else if (data?.couple_id) {
      coupleId = data.couple_id;
      if (!data.already) joined = { inviter: data.inviter, role: data.role, oldSettings: data.old_settings, oldRole: data.old_role };
    }
    if (um.invite) client.auth.updateUser({ data: { invite: null } }).catch(() => {});
  }
  if (code) {
    const { data, error } = await client.rpc('join_couple', { invite: code });
    if (error) throw new Error(/nicht gefunden/.test(error.message) ? 'Einladungscode nicht gefunden.' : `Beitritt fehlgeschlagen: ${error.message}`);
    coupleId = data;
    if (um.invite) client.auth.updateUser({ data: { invite: null } }).catch(() => {});
  } else if (coupleId) {
    const { data, error } = await client.from('members').select('couple_id').eq('couple_id', coupleId).eq('user_id', uid).maybeSingle();
    if (error) throw dbError(error);
    if (!data) coupleId = null;
  }
  if (!coupleId) {
    const { data, error } = await client.from('members').select('couple_id, joined_at').eq('user_id', uid).order('joined_at', { ascending: true });
    if (error) throw dbError(error); // nie wegen eines Fehlers ein neues, leeres Paar anlegen
    coupleId = data?.[0]?.couple_id ?? null;
    if ((data?.length ?? 0) > 1) {
      // Mehrere Paare (z. B. durch einen früheren Verbindungsfehler): das Paar mit Partner bzw. mit Daten nehmen
      const ids = data.map((x) => x.couple_id);
      const [mem, docs] = await Promise.all([
        client.from('members').select('couple_id').in('couple_id', ids),
        client.from('docs').select('couple_id').in('couple_id', ids),
      ]);
      const score = (id) => (mem.data ?? []).filter((x) => x.couple_id === id).length * 1000 + (docs.data ?? []).filter((x) => x.couple_id === id).length;
      coupleId = [...ids].sort((a, b) => score(b) - score(a))[0];
    }
  }
  if (!coupleId) {
    const { data, error } = await client.rpc('create_couple');
    if (error) throw new Error(/create_couple|schema cache|could not find the function/i.test(error.message) ? 'Die Datenbank ist noch nicht eingerichtet. Führe setup.sql im SQL Editor aus.' : `Anlegen fehlgeschlagen. Die Datenbank meldet: ${error.message}`);
    coupleId = data.id;
  }
  const saved = { url: cfg.url, key: cfg.key, coupleId };
  saveConfig(saved);

  /* ---- Dokument-Cache + Live-Updates ---- */
  const cache = new Map();
  const subs = new Set();
  let loaded = false;
  const emit = () => loaded && subs.forEach((f) => f());

  let retryTimer = null;
  async function refetch() {
    clearTimeout(retryTimer);
    const { data, error } = await client.from('docs').select('path,data').eq('couple_id', coupleId).then((r) => r, (e) => ({ error: e }));
    if (error) {
      // Kurz warten und erneut versuchen (schwaches Netz, App gerade aufgewacht …)
      retryTimer = setTimeout(refetch, loaded ? 15000 : 3000);
      return;
    }
    cache.clear();
    for (const row of data) cache.set(row.path, row.data);
    loaded = true;
    emit();
  }

  client
    .channel(`docs-${coupleId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: `couple_id=eq.${coupleId}` }, (p) => {
      if (p.eventType === 'DELETE') {
        if (p.old?.couple_id && p.old.couple_id !== coupleId) return;
        if (p.old?.path) cache.delete(p.old.path);
      } else if (p.new?.path) {
        cache.set(p.new.path, p.new.data);
      }
      emit();
    })
    .subscribe((status) => {
      live = status === 'SUBSCRIBED';
      if (live) refetch();
    });
  let live = false;
  await refetch();
  // Fällt die Live-Verbindung aus, regelmäßig nachladen
  setInterval(() => !live && document.visibilityState === 'visible' && refetch(), 30000);
  window.addEventListener('online', () => refetch());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refetch());
  setInterval(refetch, 45000);

  const privatePrefix = `data/users/${uid}/`;
  const meta = { fromCache: false, hasPendingWrites: false };
  const snap = (path, d) => ({ id: path.split('/').pop(), exists: d !== undefined, data: () => d, metadata: meta });

  const doc = (path) => ({
    path,
    id: path.split('/').pop(),
    async set(data) {
      const owner = path.startsWith(privatePrefix) ? uid : null;
      cache.set(path, data);
      emit();
      const { error } = await client.from('docs').upsert({ couple_id: coupleId, path, data, owner, updated_at: new Date().toISOString() });
      if (error) throw { code: errCode(error), message: error.message };
    },
    async update(patch) {
      const { data, error } = await client.rpc('merge_doc', { c: coupleId, p: path, patch });
      if (error) throw { code: errCode(error), message: error.message };
      if (!data) throw { code: 'invalid_argument', message: 'Dokument fehlt' };
      cache.set(path, mergeDeep(cache.get(path), patch));
      emit();
    },
    async delete() {
      cache.delete(path);
      emit();
      const { error } = await client.from('docs').delete().eq('couple_id', coupleId).eq('path', path);
      if (error) throw { code: errCode(error), message: error.message };
    },
    onSnapshot(next) {
      const f = () => next(snap(path, cache.get(path)));
      subs.add(f);
      if (loaded) f();
      return () => subs.delete(f);
    },
  });

  const collection = (path) => {
    const depth = path.split('/').length + 1;
    return {
      path,
      doc: (id) => doc(`${path}/${id}`),
      onSnapshot(next) {
        const f = () => {
          const docs = [...cache.keys()]
            .filter((k) => k.startsWith(path + '/') && k.split('/').length === depth)
            .sort()
            .map((k) => snap(k, cache.get(k)));
          next({ docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => [] });
        };
        subs.add(f);
        if (loaded) f();
        return () => subs.delete(f);
      },
    };
  };

  return { db: { doc, collection }, uid, user, cfg: saved, community: communityApi(client, uid), photos: photoApi(client, uid, coupleId), partner: partnerApi(client), joined, inviteError };
}

/* ------------------------------------------------------------ Fotos */

function photoApi(client, uid, coupleId) {
  const signed = new Map(); // Pfad -> { url, exp }
  return {
    /** Lädt ein (bereits verkleinertes) Bild hoch. Gibt { bucket, path } zurück. */
    async upload(blob, { dateId, isPublic }) {
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bucket = isPublic ? 'public-photos' : 'couple-photos';
      const path = isPublic ? `${uid}/${dateId}/${name}` : `${coupleId}/${dateId}/${name}`;
      const { error } = await client.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Der Foto-Speicher ist noch nicht eingerichtet (setup.sql erneut ausführen).' : `Upload fehlgeschlagen: ${error.message}`);
      return { bucket, path };
    },
    /** Anzeige-URL: öffentlich direkt, privat als zeitlich begrenzter Link. */
    async url(photo) {
      if (photo.bucket === 'public-photos') return client.storage.from('public-photos').getPublicUrl(photo.path).data.publicUrl;
      const hit = signed.get(photo.path);
      if (hit && hit.exp > Date.now() + 60000) return hit.url;
      const { data, error } = await client.storage.from('couple-photos').createSignedUrl(photo.path, 3600);
      if (error) throw new Error('Foto nicht verfügbar');
      signed.set(photo.path, { url: data.signedUrl, exp: Date.now() + 3600 * 1000 });
      return data.signedUrl;
    },
    publicUrl(path) {
      return client.storage.from('public-photos').getPublicUrl(path).data.publicUrl;
    },
    async remove(photo) {
      const { error } = await client.storage.from(photo.bucket).remove([photo.path]);
      if (error) throw new Error('Löschen fehlgeschlagen');
    },
  };
}

/* ------------------------------------------------------------ Partner einladen, verbinden, trennen */

function partnerApi(client) {
  const fail = (error) => {
    if (!error) return;
    if (/schema cache|could not find the function/i.test(error.message)) throw new Error('Einladungen sind in der Datenbank noch nicht eingerichtet (partner.sql ausführen).');
    if (/fetch|network/i.test(error.message)) throw new Error(inviteErrorText('netz'));
    throw new Error(error.message === 'schon_verbunden' ? 'Ihr seid schon verbunden.' : error.message);
  };
  return {
    async create(partnerName) {
      const { data, error } = await client.rpc('create_invitation', { p_name: partnerName ?? '' });
      fail(error);
      return data;
    },
    async mine() {
      const { data, error } = await client.rpc('my_invitation');
      fail(error);
      return data ?? null;
    },
    async revoke() {
      const { error } = await client.rpc('revoke_invitation');
      fail(error);
    },
    /** Code annehmen, wenn man schon ein Konto hat. Gibt { ok } oder { error } (Text) zurück. */
    async accept(code) {
      const { data, error } = await client.rpc('accept_invitation', { p_code: normCode(code) });
      fail(error);
      if (data?.error) return { error: inviteErrorText(data.error, data.name) };
      return { ok: true, ...data };
    },
    async disconnect() {
      const { data, error } = await client.rpc('disconnect_partner');
      fail(error);
      return data;
    },
  };
}

/* ------------------------------------------------------------ Community */

function communityApi(client, uid) {
  const fail = (error) => {
    if (error) throw new Error(/community|relation|schema cache/i.test(error.message) ? 'Die Community ist in der Datenbank noch nicht eingerichtet (setup.sql erneut ausführen).' : error.message);
  };
  return {
    uid,
    async list() {
      const { data, error } = await client.from('community_feed').select('*').order('created_at', { ascending: false }).limit(300);
      fail(error);
      return data;
    },
    async myRatings() {
      const { data, error } = await client.from('community_ratings').select('idea_id,stars,comment').eq('user_id', uid);
      fail(error);
      return Object.fromEntries(data.map((r) => [r.idea_id, r]));
    },
    async reviews(ideaId) {
      const r = await client.rpc('community_reviews', { i: ideaId });
      if (!r.error) return r.data;
      // ältere Datenbank ohne community.sql
      const { data, error } = await client.from('community_ratings').select('stars,comment,created_at').eq('idea_id', ideaId).order('created_at', { ascending: false }).limit(20);
      fail(error);
      return data;
    },
    async publish(idea, meta) {
      const row = { idea, city: meta.city ?? null, lat: meta.lat ?? null, lon: meta.lon ?? null, moods: idea.moods ?? [], cost: idea.cost, place: idea.place, display_name: meta.displayName ?? null };
      let { data, error } = await client.from('community_ideas').insert(row).select('id').single();
      if (error && /display_name/.test(error.message)) {
        delete row.display_name;
        ({ data, error } = await client.from('community_ideas').insert(row).select('id').single());
      }
      if (error && /row-level security/i.test(error.message)) throw new Error('Teilen ist für dein Konto gerade nicht möglich. Bei Fragen schreib uns (Kontakt im Impressum).');
      fail(error);
      return data.id;
    },
    /** Eigene geteilte Ideen – auch ausgeblendete, mit Begründung. */
    async mine() {
      const { data, error } = await client.from('community_ideas').select('id,idea,city,display_name,hidden,mod_reason,appeal,created_at').eq('author', uid).order('created_at', { ascending: false });
      if (error && /column/.test(error.message)) {
        const r = await client.from('community_ideas').select('id,idea,city,hidden,created_at').eq('author', uid);
        fail(r.error);
        return r.data;
      }
      fail(error);
      return data;
    },
    async setDisplayName(ids, name) {
      if (!ids.length) return;
      const { error } = await client.from('community_ideas').update({ display_name: name }).in('id', ids);
      fail(error);
    },
    async appeal(id, text) {
      const { error } = await client.from('community_ideas').update({ appeal: text, appeal_at: new Date().toISOString() }).eq('id', id);
      fail(error);
    },
    async block(ideaId) {
      const { error } = await client.rpc('block_author', { i: ideaId });
      fail(error);
    },
    async blockedCount() {
      const { count, error } = await client.from('community_blocks').select('blocked', { count: 'exact', head: true });
      return error ? 0 : count ?? 0;
    },
    async unblockAll() {
      const { error } = await client.rpc('unblock_all');
      fail(error);
    },
    /** Meine Meldungen, über die entschieden wurde (für die Rückmeldung in der App). */
    async reportUpdates() {
      const { data, error } = await client.rpc('my_report_updates');
      return error ? [] : data ?? [];
    },
    async reportSeen(id) {
      await client.rpc('report_seen', { r: id });
    },
    async isModerator() {
      const { data, error } = await client.rpc('is_moderator');
      return !error && data === true;
    },
    async queue() {
      const { data, error } = await client.rpc('moderation_queue');
      fail(error);
      return data;
    },
    async moderate(ideaId, reviewId, action, reason) {
      const { error } = await client.rpc('moderate', { i: ideaId, review: reviewId ?? null, action, reason: reason ?? '' });
      fail(error);
    },
    async remove(id) {
      const { error } = await client.from('community_ideas').delete().eq('id', id);
      fail(error);
    },
    async rate(ideaId, stars, comment) {
      const { error } = await client.from('community_ratings').upsert({ idea_id: ideaId, user_id: uid, stars, comment: comment || null });
      fail(error);
    },
    async addPhoto(ideaId, url) {
      const { data, error } = await client.from('community_ideas').select('idea').eq('id', ideaId).single();
      fail(error);
      const idea = { ...data.idea, photos: [...(data.idea.photos ?? []), url].slice(0, 12) };
      const res = await client.from('community_ideas').update({ idea }).eq('id', ideaId);
      fail(res.error);
    },
    async use(ideaId) {
      await client.rpc('use_idea', { i: ideaId });
    },
    async report(ideaId, { reviewId = null, reason = '', note = '', block = false } = {}) {
      const r = await client.rpc('report_content', { i: ideaId, review: reviewId, reason, note, block });
      if (!r.error) return;
      const { error } = await client.from('community_reports').insert({ idea_id: ideaId, reason: reason || null });
      if (error && !/duplicate/i.test(error.message)) fail(error);
    },
  };
}

/** Server-Funktion „places“ aufrufen (Orte & Google-Daten über Supabase). */
export async function callPlaces(cfg, body) {
  const c = await getClient(cfg);
  const { data, error } = await c.functions.invoke('places', { body });
  if (error) throw new Error(error.message || 'Server-Funktion nicht erreichbar');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Server-Funktion „notify“ aufrufen (Mitteilungen). */
export async function callNotify(cfg, body) {
  const c = await getClient(cfg);
  const { data, error } = await c.functions.invoke('notify', { body });
  if (error) throw new Error(error.message || 'Mitteilungen sind auf dem Server noch nicht eingerichtet');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Technische Fehlermeldung speichern (ohne Inhalte), damit Fehler behoben werden können. */
export async function logClientError(cfg, entry) {
  const c = await getClient(cfg);
  await c.from('client_errors').insert(entry);
}
