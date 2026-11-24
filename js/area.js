// Umgebung erkunden: Datewell schaut zuerst, was es im gewählten Umkreis alles gibt (Museen, Kinos, Bars,
// Thermen …) und bildet daraus die Dates. Das Ergebnis wird 7 Tage auf dem Gerät gemerkt.

import { CATEGORIES, isXmasSeason, placesServer, searchMixed } from './places.js';

const STORE = 'dately.area.v1';
const TTL = 7 * 24 * 3600 * 1000;
let area = null; // { key, at, radiusKm, center, cats: { id: [orte] }, done: bool }
let scanning = null;
let fetching = null; // gerade laufende Abfrage der gemeinsamen Umgebung
const listeners = new Set();

const keyOf = (center, radiusKm) => `${center.lat.toFixed(2)}|${center.lon.toFixed(2)}|${radiusKm}`;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE));
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(area));
  } catch {
    /* Speicher voll – egal */
  }
}

// Nur das Nötigste speichern
const slim = (p) => ({
  id: p.id, name: p.name, lat: p.lat, lon: p.lon, km: p.km, street: p.street, city: p.city, hours: p.hours, price: p.price,
  website: p.website, image: p.image, wikidata: p.wikidata, wikipedia: p.wikipedia, importance: p.importance, category: p.category,
  cuisine: p.cuisine, servesFood: p.servesFood, vegan: p.vegan, vegetarian: p.vegetarian, reservationUrl: p.reservationUrl, phone: p.phone,
});

/** Welche Ortsarten erkundet werden – wichtige zuerst, saisonale nur zur passenden Zeit. */
function scanOrder(iso) {
  const m = Number(iso.slice(5, 7));
  const first = ['restaurant', 'cafe', 'bar', 'wine', 'cinema', 'museum', 'spa', 'icerink', 'bowling', 'escape', 'climbing', 'theatre', 'zoo'];
  // Nicht erkundet: Arten, die nur als Nebenstation vorkommen (werden im Plan direkt gesucht)
  const ids = CATEGORIES.filter((c) => !['ort', 'supermarket', 'chocolate', 'dessert', 'brunch', 'tapas', 'cocktail', 'finedining', 'burger'].includes(c.id))
    .filter((c) => !c.seasonal || (c.seasonal === 'summer' ? m >= 5 && m <= 9 : isXmasSeason(iso)))
    .map((c) => c.id);
  return [...first.filter((id) => ids.includes(id)), ...ids.filter((id) => !first.includes(id))];
}

/** Bekannte Umgebung für diesen Ort und Umkreis (oder null, wenn noch nicht erkundet). */
export function getArea(center, radiusKm) {
  if (!center || !radiusKm) return null;
  area ??= load();
  if (!area || area.key !== keyOf(center, radiusKm) || Date.now() - area.at > TTL) return null;
  return area;
}

export function onAreaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const areaProgress = () => (scanning ? { ...scanning } : null);

/** Umgebung im Hintergrund erkunden (falls noch nicht geschehen). Gibt die Umgebung zurück. */
export async function ensureArea(center, radiusKm, iso) {
  if (!center || !radiusKm) return null;
  const have = getArea(center, radiusKm);
  if (have?.done) return have;
  const key = keyOf(center, radiusKm);
  if (scanning?.key === key) return scanning.promise;
  const order = scanOrder(iso);
  // Hat schon jemand diese Gegend erkundet? Dann vom Server holen (für alle Konten gemeinsam)
  if (!have) {
    if (fetching === key) return null;
    fetching = key;
    try {
      const shared = await placesServer({ action: 'area_get', key });
      if (shared?.cats && Date.now() - (shared.at ?? 0) < TTL && order.every((id) => id in shared.cats)) {
        area = { ...shared, key, done: true };
        save();
        listeners.forEach((fn) => fn(area, true));
        return area;
      }
    } catch {
      /* Server ohne gemeinsame Umgebung – selbst erkunden */
    } finally {
      fetching = null;
    }
  }
  area = have ?? { key, at: Date.now(), radiusKm, center: { lat: center.lat, lon: center.lon }, cats: {}, done: false };
  const todo = order.filter((id) => !(id in area.cats));
  scanning = { key, done: order.length - todo.length, total: order.length };
  scanning.promise = (async () => {
    // In kleinen Gruppen suchen, damit Pläne (höhere Priorität) zwischendurch drankommen
    for (let i = 0; i < todo.length; i += 3) {
      const batch = todo.slice(i, i + 3);
      let groups = {};
      try {
        groups = await searchMixed(batch, center, radiusKm * 1000, 0, { fast: true });
      } catch {
        groups = null; // Kartendienst gerade nicht erreichbar – später erneut versuchen
      }
      if (!groups) break;
      for (const id of batch) area.cats[id] = (groups[id] ?? []).map(slim);
      scanning.done += batch.length;
      save();
      listeners.forEach((fn) => fn(area, false));
    }
    area.done = order.every((id) => id in area.cats);
    area.at = Date.now();
    save();
    if (area.done) placesServer({ action: 'area_put', key, data: area }).catch(() => {});
    const result = area;
    scanning = null;
    listeners.forEach((fn) => fn(result, true));
    return result;
  })();
  return scanning.promise;
}
