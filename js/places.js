// Standort (GPS), Ortsname und Orte in der Nähe über OpenStreetMap (Overpass API, kostenlos, ohne Schlüssel).

/** GPS-Position des Handys. Wirft mit verständlicher Meldung. */
export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Dieses Gerät kann keinen Standort liefern.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(new Error(e.code === 1
          ? 'Standortzugriff abgelehnt. Erlaube ihn in den Browser-Einstellungen oder gib die Stadt ein.'
          : 'Standort konnte nicht ermittelt werden.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/** Ortsname zu Koordinaten (OpenStreetMap Nominatim). */
export async function placeName(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&accept-language=de`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Ortsname nicht verfügbar');
  const j = await res.json();
  const a = j.address ?? {};
  return a.city || a.town || a.village || a.municipality || a.suburb || a.county || j.name || '';
}

export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000 / 50) * 50} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`);

/* ------------------------------------------------------------ Kategorien */

// Jede Kategorie: OSM-Filter + Vorlage, um daraus ein Date zu machen.
export const CATEGORIES = [
  { id: 'museum', moods: ['kultur','entspannt'], label: 'Museen', emoji: '🖼️', filters: ['["tourism"="museum"]'], place: 'drinnen', times: ['tag'], cost: 25, plan: [['Museum', 120], ['Kaffee & Kuchen', 60, 'Café']] },
  { id: 'gallery', moods: ['kultur','kreativ'], label: 'Galerien', emoji: '🎨', filters: ['["tourism"="gallery"]'], place: 'drinnen', times: ['tag'], cost: 10, plan: [['Galerie', 75], ['Café', 45, 'Café']] },
  { id: 'cinema', moods: ['gemütlich','kultur'], label: 'Kino', emoji: '🎬', filters: ['["amenity"="cinema"]'], place: 'drinnen', times: ['abend', 'tag'], cost: 30, plan: [['Kino', 135], ['Drink danach', 60, 'Bar']] },
  { id: 'theatre', moods: ['kultur','romantisch'], label: 'Theater', emoji: '🎭', filters: ['["amenity"="theatre"]'], place: 'drinnen', times: ['abend'], cost: 60, plan: [['Vorstellung', 150], ['Drink danach', 45, 'Bar']] },
  { id: 'restaurant', moods: ['kulinarisch','romantisch'], label: 'Restaurants', emoji: '🍽️', filters: ['["amenity"="restaurant"]'], place: 'drinnen', times: ['abend', 'tag'], cost: 60, food: true, plan: [['Essen', 105]] },
  { id: 'cafe', moods: ['gemütlich','kulinarisch'], label: 'Cafés', emoji: '☕', filters: ['["amenity"="cafe"]'], place: 'drinnen', times: ['tag'], cost: 20, food: true, plan: [['Café', 75], ['Spaziergang', 45]] },
  { id: 'bar', moods: ['romantisch','lustig'], label: 'Bars', emoji: '🍸', filters: ['["amenity"~"^(bar|pub)$"]'], place: 'drinnen', times: ['abend'], cost: 35, plan: [['Bar', 120]] },
  { id: 'icecream', moods: ['lustig','entspannt'], label: 'Eis & Dessert', emoji: '🍨', filters: ['["amenity"="ice_cream"]', '["shop"="pastry"]["name"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 12, food: true, plan: [['Eis & Dessert', 45], ['Spaziergang', 45]] },
  { id: 'wine', moods: ['romantisch','kulinarisch'], label: 'Weinbars', emoji: '🍷', filters: ['["amenity"="bar"]["drink:wine"="yes"]', '["amenity"="bar"]["bar"="wine"]', '["shop"="wine"]["amenity"]'], place: 'drinnen', times: ['abend'], cost: 45, food: true, plan: [['Weinbar', 120]] },
  { id: 'bowling', moods: ['lustig','aktiv'], label: 'Bowling', emoji: '🎳', filters: ['["leisure"="bowling_alley"]'], place: 'drinnen', times: ['abend', 'tag'], cost: 35, plan: [['Bowling', 90], ['Snack', 30]] },
  { id: 'climbing', moods: ['aktiv','abenteuerlich'], label: 'Bouldern', emoji: '🧗', filters: ['["sport"~"climbing|bouldering"]["leisure"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 35, plan: [['Bouldern', 120], ['Smoothie', 30, 'Café']] },
  { id: 'escape', moods: ['abenteuerlich','lustig'], label: 'Escape Rooms', emoji: '🔐', filters: ['["leisure"="escape_game"]'], place: 'drinnen', times: ['abend', 'tag'], cost: 70, plan: [['Escape Room', 75], ['Essen & Auswertung', 75, 'Restaurant']] },
  { id: 'minigolf', moods: ['lustig'], label: 'Minigolf', emoji: '⛳', filters: ['["leisure"="miniature_golf"]'], place: 'draußen', times: ['tag', 'abend'], cost: 20, plan: [['Minigolf', 75], ['Eis', 30, 'Eisdiele']] },
  { id: 'zoo', moods: ['entspannt','lustig'], label: 'Zoo & Tierpark', emoji: '🦒', filters: ['["tourism"="zoo"]'], place: 'draußen', times: ['tag'], cost: 40, plan: [['Zoo', 180]] },
  { id: 'park', moods: ['entspannt','romantisch'], label: 'Parks & Gärten', emoji: '🌳', filters: ['["leisure"="park"]["name"]', '["leisure"="garden"]["garden:type"="botanical"]'], place: 'draußen', times: ['tag', 'abend'], cost: 0, plan: [['Spaziergang', 90]] },
  { id: 'viewpoint', moods: ['romantisch','abenteuerlich'], label: 'Aussichtspunkte', emoji: '🌅', filters: ['["tourism"="viewpoint"]'], place: 'draußen', times: ['abend', 'tag'], cost: 0, plan: [['Aussicht genießen', 60]] },
  { id: 'spa', moods: ['entspannt','romantisch'], label: 'Therme & Sauna', emoji: '♨️', filters: ['["leisure"~"^(water_park|sauna)$"]', '["amenity"="public_bath"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 70, plan: [['Therme & Sauna', 240]] },
  { id: 'icerink', moods: ['aktiv','romantisch'], label: 'Eislaufen', emoji: '⛸️', filters: ['["leisure"="ice_rink"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 25, plan: [['Eislaufen', 90], ['Punsch', 30]] },
];
export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);

const memo = new Map();

/** Orte einer Kategorie im Umkreis (Meter). Sortiert nach Entfernung. */
export async function searchNearby(categoryId, center, radius) {
  const cat = categoryById(categoryId);
  const key = `${categoryId}|${center.lat.toFixed(3)}|${center.lon.toFixed(3)}|${radius}`;
  if (memo.has(key)) return memo.get(key);
  const parts = cat.filters.map((f) => `nwr${f}(around:${radius},${center.lat},${center.lon});`).join('');
  const query = `[out:json][timeout:25];(${parts});out center tags 60;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'Zu viele Anfragen – bitte kurz warten.' : 'Ortssuche gerade nicht erreichbar.');
  const json = await res.json();
  const seen = new Set();
  const places = json.elements
    .map((el) => toPlace(el, cat, center))
    .filter((p) => p && !seen.has(p.name + p.street) && seen.add(p.name + p.street))
    .sort((a, b) => a.km - b.km)
    .slice(0, 30);
  await addWikidataImages(places);
  memo.set(key, places);
  return places;
}

function toPlace(el, cat, center) {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null) return null;
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  return {
    id: `${el.type}${el.id}`,
    category: cat.id,
    name: t.name,
    lat,
    lon,
    km: distanceKm(center, { lat, lon }),
    street,
    city: t['addr:city'] ?? '',
    hours: t.opening_hours ?? '',
    price: priceInfo(t),
    website: t.website || t['contact:website'] || t.url || '',
    phone: t.phone || t['contact:phone'] || '',
    cuisine: t.cuisine ? t.cuisine.split(';').map((c) => CUISINE[c] ?? c.replace(/_/g, ' ')).slice(0, 2).join(', ') : '',
    vegan: /^(yes|only)$/.test(t['diet:vegan'] ?? ''),
    vegetarian: /^(yes|only)$/.test(t['diet:vegetarian'] ?? ''),
    wheelchair: t.wheelchair === 'yes',
    reservation: t.reservation ?? '',
    reservationUrl: t['reservation:url'] || t['contact:opentable'] || '',
    image: imageFromTags(t),
    wikidata: t.wikidata ?? '',
  };
}

const CUISINE = { italian: 'Italienisch', pizza: 'Pizza', german: 'Deutsch', regional: 'Regional', asian: 'Asiatisch', japanese: 'Japanisch', sushi: 'Sushi', chinese: 'Chinesisch', thai: 'Thailändisch', vietnamese: 'Vietnamesisch', indian: 'Indisch', greek: 'Griechisch', turkish: 'Türkisch', mexican: 'Mexikanisch', french: 'Französisch', spanish: 'Spanisch', burger: 'Burger', steak_house: 'Steakhaus', vegan: 'Vegan', vegetarian: 'Vegetarisch', coffee_shop: 'Kaffee', cake: 'Kuchen', ice_cream: 'Eis', bavarian: 'Bayerisch', austrian: 'Österreichisch', korean: 'Koreanisch', lebanese: 'Libanesisch' };

/** Preisangabe aus OSM: fee / charge. Oft fehlt sie – dann ehrlich „siehe Webseite“. */
function priceInfo(t) {
  const charge = t.charge || t['fee:amount'];
  if (charge) {
    const m = String(charge).match(/(\d+(?:[.,]\d+)?)\s*(EUR|€)?/i);
    return { text: m ? `Eintritt ${m[1].replace('.', ',')} €` : `Eintritt ${charge}`, amount: m ? Number(m[1].replace(',', '.')) : null };
  }
  if (t.fee === 'no') return { text: 'Eintritt frei', amount: 0 };
  if (t.fee === 'yes') return { text: 'Eintritt kostenpflichtig', amount: null };
  return null;
}

/* ------------------------------------------------------------ Öffnungszeiten */

const DAY_IDX = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 0 };
const DAY_DE = { Mo: 'Mo', Tu: 'Di', We: 'Mi', Th: 'Do', Fr: 'Fr', Sa: 'Sa', Su: 'So' };

/** OSM-Öffnungszeiten lesbar auf Deutsch. */
export function formatHours(oh) {
  if (!oh) return '';
  if (oh.trim() === '24/7') return 'Rund um die Uhr';
  return oh
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAY_DE[d])
    .replace(/\bPH\b/g, 'Feiertag')
    .replace(/\boff\b|\bclosed\b/g, 'geschlossen')
    .replace(/\s*;\s*/g, ' · ')
    .replace(/,(?=\S)/g, ', ');
}

/**
 * Einfache Auswertung der häufigsten Formate („Tu-Su 10:00-18:00; Mo off“).
 * Gibt pro Wochentag Zeitspannen in Minuten zurück oder null, wenn das Format zu komplex ist.
 */
export function parseHours(oh) {
  if (!oh) return null;
  const s = oh.trim();
  const week = Array.from({ length: 7 }, () => null);
  if (s === '24/7') return week.map(() => [[0, 1440]]);
  for (let rule of s.split(';')) {
    rule = rule.trim();
    if (!rule) continue;
    if (/^PH\b/.test(rule)) continue; // Feiertage ignorieren
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*(?:,PH)?)?\s*(.*)$/);
    if (!m) return null;
    const days = m[1] ? expandDays(m[1].replace(/,PH$/, '')) : [0, 1, 2, 3, 4, 5, 6];
    const spec = m[2].trim();
    if (spec === 'off' || spec === 'closed') {
      days.forEach((d) => (week[d] = []));
      continue;
    }
    const ranges = [];
    for (const r of spec.split(',')) {
      const t = r.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
      if (!t) return null;
      const a = +t[1] * 60 + +t[2];
      let b = +t[3] * 60 + +t[4];
      if (b <= a) b += 1440; // über Mitternacht
      ranges.push([a, b]);
    }
    days.forEach((d) => (week[d] = ranges));
  }
  return week;
}

function expandDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-');
    const start = DAY_IDX[a];
    const end = b ? DAY_IDX[b] : start;
    for (let d = start, i = 0; i < 7; d = (d + 1) % 7, i++) {
      out.add(d);
      if (d === end) break;
    }
  }
  return [...out];
}

/** Geöffnet zu einem Zeitpunkt? true/false, null = unbekannt. */
export function isOpenAt(oh, date) {
  const week = parseHours(oh);
  if (!week) return null;
  const day = date.getDay();
  const min = date.getHours() * 60 + date.getMinutes();
  const today = week[day];
  const prev = week[(day + 6) % 7];
  if (today === null && prev === null) return null;
  if (today?.some(([a, b]) => min >= a && min < b)) return true;
  if (prev?.some(([, b]) => b > 1440 && min < b - 1440)) return true;
  return today === null ? null : false;
}

/** Öffnungszeiten an einem Wochentag als Text („10:00–18:00“ oder „geschlossen“). */
export function hoursOn(oh, date) {
  const week = parseHours(oh);
  if (!week) return null;
  const r = week[date.getDay()];
  if (r === null) return null;
  if (!r.length) return 'geschlossen';
  if (r.length === 1 && r[0][0] === 0 && r[0][1] >= 1440) return 'rund um die Uhr';
  const f = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return r.map(([a, b]) => `${f(a)}–${f(b)}`).join(', ');
}

export const routeLink = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
export const mapLink = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.street} ${p.city}`.trim())}`;

/* ------------------------------------------------------------ Bilder */

const commonsFile = (name, width = 640) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replace(/^File:/i, '').replace(/ /g, '_'))}?width=${width}`;

function imageFromTags(t) {
  if (t.image && /^https:\/\//.test(t.image)) {
    if (/commons\.wikimedia\.org\/wiki\/File:/.test(t.image)) return commonsFile(decodeURIComponent(t.image.split('File:')[1]));
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(t.image)) return t.image;
  }
  if (t.wikimedia_commons && /^File:/i.test(t.wikimedia_commons)) return commonsFile(t.wikimedia_commons);
  return '';
}

/** Bilder aus Wikidata (Eigenschaft P18) für Orte mit Wikidata-Verweis nachladen. */
async function addWikidataImages(places) {
  const need = places.filter((p) => !p.image && /^Q\d+$/.test(p.wikidata));
  if (!need.length) return;
  try {
    const ids = [...new Set(need.map((p) => p.wikidata))].slice(0, 50).join('|');
    const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims&format=json&origin=*`);
    if (!res.ok) return;
    const json = await res.json();
    for (const p of need) {
      const file = json.entities?.[p.wikidata]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file) p.image = commonsFile(file);
    }
  } catch {
    /* Bilder sind optional */
  }
}

/* ------------------------------------------------------------ Reservieren */

/** Reservierungs-Links: eigene Webseite, OpenTable-Suche, Google. */
export function reservationLinks(p, { date, time, city = '' } = {}) {
  const links = [];
  if (p.reservationUrl) links.push({ label: 'Tisch reservieren', href: p.reservationUrl, primary: true });
  else if (p.website) links.push({ label: 'Webseite', href: p.website, primary: !p.reservationUrl });
  const dt = date && time ? `&dateTime=${encodeURIComponent(`${date}T${time}`)}` : '';
  links.push({ label: 'Bei OpenTable suchen', href: `https://www.opentable.de/s?covers=2${dt}&term=${encodeURIComponent(`${p.name} ${p.city || city}`.trim())}` });
  links.push({ label: 'Google-Bewertungen', href: mapLink(p) });
  return links;
}

/* ------------------------------------------------------------ Anfahrt */

/** Geschätzte Fahrzeiten aus der Entfernung (Luftlinie × Umweg-Faktor). Grobe Richtwerte. */
export function travelEstimates(km) {
  const road = km * 1.3;
  const out = [];
  if (road <= 6) out.push({ mode: 'walking', label: 'Zu Fuß', icon: 'walk', min: Math.round((road / 4.8) * 60) });
  if (road <= 25) out.push({ mode: 'bicycling', label: 'Rad', icon: 'bike', min: Math.round((road / 15) * 60) });
  out.push({ mode: 'transit', label: 'Bahn & Bus', icon: 'train', min: Math.round((road / 22) * 60 + 8) });
  out.push({ mode: 'driving', label: 'Auto', icon: 'car', min: Math.round((road / (road > 15 ? 55 : 24)) * 60 + 4) });
  return out;
}

export const fmtMin = (m) => (m < 60 ? `${Math.max(1, m)} Min.` : `${Math.floor(m / 60)} Std. ${m % 60 ? `${m % 60} Min.` : ''}`.trim());

export const directionsLink = (p, mode) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=${mode}`;
export const appleMapsLink = (p, mode = 'd') => `https://maps.apple.com/?daddr=${p.lat},${p.lon}&dirflg=${mode}&q=${encodeURIComponent(p.name)}`;

/* ------------------------------------------------------------ Gemischte Suche für „Für euch“ */

const FILTER_RE = /\["([^"]+)"(?:(=|~)"([^"]+)")?\]/g;
function matchesFilter(tags, filter) {
  for (const [, key, op, val] of filter.matchAll(FILTER_RE)) {
    const v = tags[key];
    if (v == null) return false;
    if (op === '=' && v !== val) return false;
    if (op === '~' && !new RegExp(val).test(v)) return false;
  }
  return true;
}

/** Mehrere Kategorien in einer Abfrage. Gibt Orte gruppiert nach Kategorie zurück. */
export async function searchMixed(catIds, center, radius) {
  const cats = catIds.map(categoryById).filter(Boolean);
  const key = `mix|${catIds.join(',')}|${center.lat.toFixed(3)}|${center.lon.toFixed(3)}|${radius}`;
  if (memo.has(key)) return memo.get(key);
  const parts = cats.flatMap((c) => c.filters.map((f) => `nwr${f}(around:${radius},${center.lat},${center.lon});`)).join('');
  const query = `[out:json][timeout:25];(${parts});out center tags 150;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'Zu viele Anfragen – bitte kurz warten.' : 'Ortssuche gerade nicht erreichbar.');
  const json = await res.json();
  const groups = Object.fromEntries(cats.map((c) => [c.id, []]));
  const seen = new Set();
  for (const el of json.elements) {
    const cat = cats.find((c) => c.filters.some((f) => matchesFilter(el.tags ?? {}, f)));
    if (!cat) continue;
    const p = toPlace(el, cat, center);
    if (!p || seen.has(p.name + p.street)) continue;
    seen.add(p.name + p.street);
    groups[cat.id].push(p);
  }
  for (const id of Object.keys(groups)) groups[id] = groups[id].sort((a, b) => a.km - b.km).slice(0, 12);
  await addWikidataImages(Object.values(groups).flat());
  memo.set(key, groups);
  return groups;
}
