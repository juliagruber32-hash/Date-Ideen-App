// Gemeinsamer Speicher über Supabase (für die eigene Webseite).
// Stellt dieselbe kleine Dokument-Schnittstelle bereit wie die Claude-Datenbank:
// db.doc(path).set/update/delete/onSnapshot und db.collection(path).onSnapshot.

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
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

/** Einladungslink: enthält Adresse, öffentlichen Schlüssel und Paar-Code. */
export function inviteLink(cfg) {
  const payload = btoa(JSON.stringify({ u: cfg.url, k: cfg.key, c: cfg.code })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#einladung=${payload}`;
}
export function readInvite(hash = location.hash) {
  const m = hash.match(/einladung=([\w-]+)/);
  if (!m) return null;
  try {
    const j = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    return j.u && j.k && j.c ? { url: j.u, key: j.k, code: j.c } : null;
  } catch {
    return null;
  }
}

function loadLib() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new Error('Supabase konnte nicht geladen werden')));
    s.onerror = () => reject(new Error('Supabase konnte nicht geladen werden (keine Verbindung?)'));
    document.head.append(s);
  });
}

const errCode = (e) => (e?.code === '42501' || /row-level security/i.test(e?.message ?? '') ? 'invalid_argument' : 'unavailable');

function mergeDeep(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = mergeDeep(a[k], v);
  return out;
}

/* ------------------------------------------------------------ Konten (E-Mail + Passwort) */

const clients = new Map();
export async function getClient(cfg) {
  if (!clients.has(cfg.url)) {
    const lib = await loadLib();
    clients.set(cfg.url, lib.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'dately-auth' } }));
  }
  return clients.get(cfg.url);
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
export async function signUp(cfg, { email, password, username, invite }) {
  const client = await getClient(cfg);
  const name = username.trim().toLowerCase();
  if (!validUsername(name)) throw new Error('Benutzername: 3–20 Zeichen, nur Buchstaben, Zahlen, Punkt, Strich oder Unterstrich.');
  const free = await client.rpc('username_available', { name });
  if (free.error) throw new Error(/function|schema cache/i.test(free.error.message) ? 'Die Datenbank ist noch nicht vollständig eingerichtet (setup.sql erneut ausführen).' : authError(free.error));
  if (!free.data) throw new Error('Dieser Benutzername ist schon vergeben.');
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
  return data.session;
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
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw Object.assign(new Error('Bitte melde dich an.'), { code: 'auth' });
  const uid = session.user.id;
  const um = session.user.user_metadata ?? {};
  const prof = await client.from('profiles').select('username').eq('id', uid).maybeSingle();
  const user = { id: uid, email: session.user.email, username: prof.data?.username ?? um.username ?? '' };

  // Paar: Einladung > gespeichertes Paar > bestehende Mitgliedschaft > neues Paar
  let coupleId = cfg.coupleId;
  let code = cfg.code ?? um.invite ?? null;
  if (code) {
    const { data, error } = await client.rpc('join_couple', { invite: code });
    if (error) throw new Error(/nicht gefunden/.test(error.message) ? 'Einladungscode nicht gefunden.' : `Beitritt fehlgeschlagen: ${error.message}`);
    coupleId = data;
    if (um.invite) client.auth.updateUser({ data: { invite: null } }).catch(() => {});
  } else if (coupleId) {
    const { data } = await client.from('members').select('couple_id').eq('couple_id', coupleId).eq('user_id', uid).maybeSingle();
    if (!data) coupleId = null;
  }
  if (!coupleId) {
    const { data } = await client.from('members').select('couple_id, joined_at').eq('user_id', uid).order('joined_at', { ascending: false }).limit(1);
    coupleId = data?.[0]?.couple_id ?? null;
  }
  if (!coupleId) {
    const { data, error } = await client.rpc('create_couple');
    if (error) throw new Error(/function|does not exist|schema cache/i.test(error.message) ? 'Die Datenbank ist noch nicht eingerichtet. Führe setup.sql im SQL Editor aus.' : `Anlegen fehlgeschlagen: ${error.message}`);
    coupleId = data.id;
  }
  const c = await client.from('couples').select('code').eq('id', coupleId).maybeSingle();
  code = c.data?.code ?? code;
  const saved = { url: cfg.url, key: cfg.key, coupleId, code };
  saveConfig(saved);

  /* ---- Dokument-Cache + Live-Updates ---- */
  const cache = new Map();
  const subs = new Set();
  let loaded = false;
  const emit = () => loaded && subs.forEach((f) => f());

  async function refetch() {
    const { data, error } = await client.from('docs').select('path,data').eq('couple_id', coupleId);
    if (error) return;
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
      if (status === 'SUBSCRIBED') refetch();
    });
  await refetch();
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

  return { db: { doc, collection }, uid, user, cfg: saved, community: communityApi(client, uid), photos: photoApi(client, uid, coupleId) };
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
      const { data, error } = await client.from('community_ratings').select('stars,comment,created_at').eq('idea_id', ideaId).order('created_at', { ascending: false }).limit(20);
      fail(error);
      return data;
    },
    async publish(idea, meta) {
      const { data, error } = await client.from('community_ideas').insert({ idea, city: meta.city ?? null, lat: meta.lat ?? null, lon: meta.lon ?? null, moods: idea.moods ?? [], cost: idea.cost, place: idea.place }).select('id').single();
      fail(error);
      return data.id;
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
    async report(ideaId, reason) {
      const { error } = await client.from('community_reports').insert({ idea_id: ideaId, reason: reason || null });
      if (error && !/duplicate/i.test(error.message)) fail(error);
    },
  };
}
