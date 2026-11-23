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

/**
 * Verbindet sich mit Supabase. Legt bei Bedarf ein Paar an oder tritt mit Code bei.
 * cfg: { url, key, code?, coupleId? }. Gibt { db, uid, cfg } zurück.
 */
export async function connectSupabase(cfg) {
  const lib = await loadLib();
  const client = lib.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'date-ideen-auth' } });

  let { data: { session } } = await client.auth.getSession();
  if (!session) {
    const r = await client.auth.signInAnonymously();
    if (r.error) {
      throw new Error(/anonymous/i.test(r.error.message)
        ? 'In Supabase ist die anonyme Anmeldung noch aus. Schalte sie unter Authentication → Sign In / Providers → „Allow anonymous sign-ins“ ein.'
        : `Anmeldung fehlgeschlagen: ${r.error.message}`);
    }
    session = r.data.session;
  }
  const uid = session.user.id;

  // Paar anlegen oder beitreten
  let coupleId = cfg.coupleId;
  let code = cfg.code;
  if (coupleId) {
    const { data } = await client.from('members').select('couple_id').eq('couple_id', coupleId).eq('user_id', uid).maybeSingle();
    if (!data) coupleId = null; // z. B. neues Gerät mit anderer Anmeldung
  }
  if (!coupleId && code) {
    const { data, error } = await client.rpc('join_couple', { invite: code });
    if (error) throw new Error(/nicht gefunden/.test(error.message) ? 'Einladungscode nicht gefunden.' : `Beitritt fehlgeschlagen: ${error.message}`);
    coupleId = data;
  }
  if (!coupleId) {
    const { data, error } = await client.rpc('create_couple');
    if (error) throw new Error(/function|does not exist|schema cache/i.test(error.message) ? 'Die Datenbank ist noch nicht eingerichtet. Führe setup.sql im SQL Editor aus.' : `Anlegen fehlgeschlagen: ${error.message}`);
    coupleId = data.id;
    code = data.code;
  }
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

  return { db: { doc, collection }, uid, cfg: saved, community: communityApi(client, uid) };
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
    async use(ideaId) {
      await client.rpc('use_idea', { i: ideaId });
    },
    async report(ideaId, reason) {
      const { error } = await client.from('community_reports').insert({ idea_id: ideaId, reason: reason || null });
      if (error && !/duplicate/i.test(error.message)) fail(error);
    },
  };
}
