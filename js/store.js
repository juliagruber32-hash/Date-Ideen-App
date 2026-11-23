// Alle Daten liegen lokal im Browser (localStorage) – kein Login nötig.

const KEY = 'date-ideen.v1';

const defaults = () => ({
  settings: {
    nameA: '',
    nameB: '',
    city: '',
    geo: null, // { name, lat, lon, country }
    anniversary: '', // YYYY-MM-DD
    valentine: true,
    specialDays: [], // { id, name, date: YYYY-MM-DD, kind: 'geburtstag' | 'sonstiges' }
    datesPerMonth: 2,
    fixed: [], // { id, title, weekday: 0-6, time: 'HH:MM' }
    vegan: false,
  },
  lastSearch: { when: 'tonight', date: '', daytime: 'abend', budget: 30, reach: 1 },
  dates: [], // gespeicherte Date-Pläne
  events: [], // eigene Termine { id, date, time, title, who }
  todos: [], // { id, text, who, due, done }
  shopping: [], // { id, text, done }
});

function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return {
      ...base,
      ...saved,
      settings: { ...base.settings, ...saved.settings },
      lastSearch: { ...base.lastSearch, ...saved.lastSearch },
    };
  } catch {
    return base;
  }
}

const state = load();

export const get = () => state;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Speicher voll oder privat – App funktioniert trotzdem für diese Sitzung */
  }
}

export function update(fn) {
  fn(state);
  save();
}

export function reset() {
  const fresh = defaults();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  save();
}

export function names() {
  const { nameA, nameB } = state.settings;
  return { a: nameA.trim() || 'Ich', b: nameB.trim() || 'Partner*in' };
}
