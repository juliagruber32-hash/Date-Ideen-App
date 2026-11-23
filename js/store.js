// Datenhaltung. Zwei Betriebsarten:
//  - lokal: alles in localStorage (z. B. auf GitHub Pages oder offline)
//  - gemeinsam: geteilte Datenbank des Claude-Artifacts. Beide Partner sehen dieselben
//    Dates, Listen und Abstimmungen live. Überraschungs-Details liegen im privaten
//    Bereich der planenden Person und sind für die andere Person nicht lesbar.
//
// Der App-Code arbeitet immer mit einem In-Memory-Zustand und `update(fn)`.
// Im gemeinsamen Modus berechnet der Store danach die Änderungen pro Dokument
// und schreibt nur diese (Feld-genau), damit sich gleichzeitige Änderungen nicht überschreiben.

const KEY = 'date-ideen.v1';
const LOCAL_KEY = 'date-ideen.local.v1';
export const COLLECTIONS = ['dates', 'events', 'todos', 'shopping', 'polls', 'requests'];

const defaultSettings = () => ({
  nameA: '',
  nameB: '',
  city: '',
  geo: null,
  anniversary: '',
  valentine: true,
  specialDays: [],
  datesPerMonth: 2,
  fixed: [],
  vegan: false,
  members: { a: null, b: null }, // Nutzer-IDs im gemeinsamen Modus
});

const defaults = () => ({
  settings: defaultSettings(),
  dates: [],
  events: [],
  todos: [],
  shopping: [],
  polls: [],
  requests: [],
  secrets: {}, // dateId -> vollständiger Plan einer eigenen Überraschung (privat)
});

const defaultLocal = () => ({
  role: null, // im lokalen Modus: wer benutzt dieses Gerät ('a' | 'b')
  lastSearch: { when: 'tonight', date: '', daytime: 'abend', budget: 40, reach: 1, planner: 'me' },
});

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar – die App läuft trotzdem für diese Sitzung */
  }
}

function hydrate(saved) {
  const base = defaults();
  if (!saved) return base;
  const out = { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
  out.settings.members = { a: null, b: null, ...(saved.settings?.members ?? {}) };
  for (const c of COLLECTIONS) if (!Array.isArray(out[c])) out[c] = [];
  if (!out.secrets || typeof out.secrets !== 'object') out.secrets = {};
  return out;
}

const state = hydrate(readJSON(KEY));
const local = { ...defaultLocal(), ...(readJSON(LOCAL_KEY) ?? {}) };
local.lastSearch = { ...defaultLocal().lastSearch, ...(local.lastSearch ?? {}) };

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let notifyTimer;
function notify(source) {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => listeners.forEach((fn) => fn(source)), 30);
}

export const get = () => state;
export const getLocal = () => local;
export const saveLocal = () => writeJSON(LOCAL_KEY, local);

/* ------------------------------------------------------------ Sync-Zustand */

const sync = {
  mode: 'local', // 'local' | 'shared'
  db: null,
  uid: null,
  ready: false, // erste bestätigte Daten aus der DB da
  stale: false, // DB antwortet nicht
  canWrite: true,
  writeError: null,
};
export const syncInfo = () => sync;

// Letzter bekannter Serverstand pro Dokument (für die Änderungsberechnung).
const known = { settings: null, secrets: {} };
for (const c of COLLECTIONS) known[c] = {};

const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------ Schreiben */

export function update(fn) {
  const before = sync.mode === 'shared' ? snapshotForDiff() : null;
  fn(state);
  writeJSON(KEY, state);
  if (sync.mode === 'shared') pushChanges(before);
  notify('local');
}

export function reset() {
  update((s) => {
    const fresh = defaults();
    for (const k of Object.keys(fresh)) s[k] = fresh[k];
  });
}

function snapshotForDiff() {
  const snap = { settings: JSON.stringify(state.settings), secrets: {} };
  for (const c of COLLECTIONS) {
    snap[c] = {};
    for (const item of state[c]) snap[c][item.id] = JSON.stringify(item);
  }
  for (const [id, v] of Object.entries(state.secrets)) snap.secrets[id] = JSON.stringify(v);
  return snap;
}

function pushChanges(before) {
  const { db, uid } = sync;
  // Einstellungen
  const s = JSON.stringify(state.settings);
  if (s !== before.settings) queueWrite('shared/settings', known.settings, clone(state.settings), (v) => (known.settings = v));

  for (const c of COLLECTIONS) {
    const now = new Map(state[c].map((x) => [x.id, x]));
    for (const [id, item] of now) {
      const j = JSON.stringify(item);
      if (before[c][id] !== j) queueWrite(`${c}/${id}`, known[c][id] ?? null, clone(item), (v) => (known[c][id] = v));
    }
    for (const id of Object.keys(before[c])) {
      if (!now.has(id)) queueWrite(`${c}/${id}`, known[c][id] ?? null, null, () => delete known[c][id]);
    }
  }

  if (uid) {
    for (const [id, plan] of Object.entries(state.secrets)) {
      if (before.secrets[id] !== JSON.stringify(plan)) {
        queueWrite(`data/users/${uid}/${id}`, known.secrets[id] ?? null, clone(plan), (v) => (known.secrets[id] = v));
      }
    }
    for (const id of Object.keys(before.secrets)) {
      if (!(id in state.secrets)) queueWrite(`data/users/${uid}/${id}`, known.secrets[id] ?? null, null, () => delete known.secrets[id]);
    }
  }
  void db;
}

/**
 * Berechnet die minimalen Änderungen zwischen Serverstand `prev` und neuem Stand `next`.
 * Gibt ein verschachteltes Objekt für `update()` zurück oder `null`, wenn Schlüssel
 * entfernt wurden (dann muss das ganze Dokument per `set()` ersetzt werden).
 */
function deepDiff(prev, next) {
  const out = {};
  for (const k of Object.keys(prev)) if (!(k in next)) return null;
  for (const [k, v] of Object.entries(next)) {
    const p = prev[k];
    if (JSON.stringify(p) === JSON.stringify(v)) continue;
    if (v && p && typeof v === 'object' && typeof p === 'object' && !Array.isArray(v) && !Array.isArray(p)) {
      const sub = deepDiff(p, v);
      if (sub === null) return null;
      out[k] = sub;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Pro Dokument nur ein Schreibvorgang gleichzeitig.
const chains = new Map();
function queueWrite(path, prev, next, onDone) {
  const run = async () => {
    const ref = sync.db.doc(path);
    try {
      if (next === null) await ref.delete();
      else if (!prev) await ref.set(next);
      else {
        const diff = deepDiff(prev, next);
        if (diff === null) await ref.set(next);
        else if (Object.keys(diff).length) await ref.update(diff).catch(() => ref.set(next));
      }
      onDone(next);
    } catch (e) {
      handleWriteError(e);
    }
  };
  const p = (chains.get(path) ?? Promise.resolve()).then(run);
  chains.set(path, p);
}

function handleWriteError(e) {
  if (e?.code === 'invalid_argument' || e?.code === 'not_granted') {
    sync.canWrite = false;
    sync.writeError = 'Du kannst hier nur lesen. Bitte lass dich als Editor einladen.';
  } else if (e?.code === 'quota_exceeded') {
    sync.writeError = 'Der Speicher ist voll. Löscht alte Einträge.';
  } else {
    sync.writeError = 'Speichern hat nicht geklappt. Prüfe deine Verbindung.';
  }
  notify('error');
}

/* ------------------------------------------------------------ Gemeinsamer Modus */

export async function connect() {
  const claude = window.claude;
  if (!claude?.use) return;
  let db, user;
  try {
    [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
  } catch {
    return;
  }
  if (!db) return;
  sync.db = db;
  sync.mode = 'shared';
  sync.uid = user ? await user.id() : null;
  try {
    const can = user ? await user.can('data.write') : null;
    if (can === false) sync.canWrite = false;
  } catch {
    /* unbekannt: Schreiben versuchen und Fehler abfangen */
  }

  const localHadData = state.dates.length || state.todos.length || state.shopping.length || state.events.length || state.settings.city || state.settings.nameA;
  const confirmed = new Set();
  const total = 2 + COLLECTIONS.length;
  const staleTimer = setTimeout(() => {
    if (!sync.ready) {
      sync.stale = true;
      notify('remote');
    }
  }, 10000);
  const markConfirmed = (key, meta) => {
    if (meta.fromCache) return;
    confirmed.add(key);
    if (confirmed.size >= total && !sync.ready) {
      sync.ready = true;
      sync.stale = false;
      clearTimeout(staleTimer);
    }
  };

  let migrated = false;
  db.doc('shared/settings').onSnapshot(
    (snap) => {
      if (snap.exists) {
        const data = clone(snap.data());
        known.settings = clone(data);
        state.settings = { ...defaultSettings(), ...data, members: { a: null, b: null, ...(data.members ?? {}) } };
      } else if (!snap.metadata.fromCache && !migrated) {
        // Erste Nutzung des gemeinsamen Speichers: lokale Daten dieses Geräts übernehmen.
        migrated = true;
        known.settings = null;
        if (localHadData) {
          const before = { settings: '', secrets: {} };
          for (const c of COLLECTIONS) before[c] = {};
          pushChanges(before);
        } else {
          queueWrite('shared/settings', null, clone(state.settings), (v) => (known.settings = v));
        }
      }
      markConfirmed('settings', snap.metadata);
      writeJSON(KEY, state);
      notify('remote');
    },
    onSubError,
  );

  for (const c of COLLECTIONS) {
    db.collection(c).onSnapshot((snap) => {
      // Lokal migrierte Einträge erst ersetzen, wenn der Server bestätigt hat.
      if (snap.metadata.fromCache && snap.empty) return;
      const items = snap.docs.filter((d) => d.exists).map((d) => clone(d.data()));
      known[c] = Object.fromEntries(items.map((x) => [x.id, clone(x)]));
      if (!(snap.empty && !migrated && localHadData)) state[c] = items;
      markConfirmed(c, snap.metadata);
      writeJSON(KEY, state);
      notify('remote');
    }, onSubError);
  }

  if (sync.uid) {
    db.collection(`data/users/${sync.uid}`).onSnapshot((snap) => {
      const secrets = {};
      for (const d of snap.docs) if (d.exists) secrets[d.id] = clone(d.data());
      known.secrets = clone(secrets);
      if (!(snap.empty && snap.metadata.fromCache)) state.secrets = secrets;
      markConfirmed('secrets', snap.metadata);
      notify('remote');
    }, onSubError);
  } else {
    confirmed.add('secrets');
  }
}

function onSubError(e) {
  if (e?.code === 'revoked') sync.writeError = 'Der Zugriff wurde entzogen.';
  else sync.stale = true;
  notify('error');
}

/* ------------------------------------------------------------ Wer bin ich? */

/** Rolle des aktuellen Geräts/Nutzers: 'a', 'b' oder null (noch nicht gewählt). */
export function myRole() {
  const m = state.settings.members;
  if (sync.mode === 'shared' && sync.uid) {
    if (m.a === sync.uid) return 'a';
    if (m.b === sync.uid) return 'b';
    return null;
  }
  return local.role;
}

export function claimRole(role) {
  if (sync.mode === 'shared' && sync.uid) {
    update((s) => {
      const other = role === 'a' ? 'b' : 'a';
      if (s.settings.members[other] === sync.uid) s.settings.members[other] = null;
      s.settings.members[role] = sync.uid;
    });
  } else {
    local.role = role;
    saveLocal();
    notify('local');
  }
}

export const other = (r) => (r === 'a' ? 'b' : r === 'b' ? 'a' : null);

export function nameOf(role) {
  const { nameA, nameB } = state.settings;
  if (role === 'a') return nameA.trim() || 'Person 1';
  if (role === 'b') return nameB.trim() || 'Person 2';
  return 'Ihr beide';
}

/** Die Überraschung ist für mich noch geheim (ich plane sie nicht). */
export function isHiddenFromMe(date) {
  return !!date.surprise && date.plannedBy !== myRole();
}
