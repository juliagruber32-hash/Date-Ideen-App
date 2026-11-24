// @ts-nocheck – bewusst ohne Typen, damit die Funktion auch im Supabase-Editor ohne Zusatzschritte läuft
// Dately – Server-Funktion „places“ (Supabase Edge Function)
//
// Holt Orte (OpenStreetMap über Overpass/Nominatim) und Google-Daten (Bewertungen, Fotos, Öffnungszeiten)
// auf dem Server, merkt sie sich 7 Tage in der Tabelle place_cache und gibt sie an die App weiter.
// Vorteile: schnell für alle (ein Abruf pro Region), keine gesperrten Kartenserver im Handy,
// Google-Schlüssel bleibt geheim, Tageslimit gegen Kostenüberraschungen.
//
// Geheimnisse (Supabase → Edge Functions → Secrets):
//   GOOGLE_PLACES_KEY   – Google-Places-Schlüssel (optional)
//   GOOGLE_DAILY_LIMIT  – max. Google-Abfragen pro Tag (optional, Standard 300)
//   APP_ORIGIN          – Webseite der App (optional, Standard https://juliagruber32-hash.github.io)
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.

const env = (k, d = '') => (globalThis.Deno?.env.get(k) ?? d);
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const GOOGLE_KEY = env('GOOGLE_PLACES_KEY');
const DAILY_LIMIT = Number(env('GOOGLE_DAILY_LIMIT', '300')) || 300;
const APP_ORIGIN = env('APP_ORIGIN', 'https://juliagruber32-hash.github.io');
const TTL_MS = 7 * 24 * 3600 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/* ------------------------------------------------------------ Hilfen */

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rest(path, init = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : true;
}

async function cacheGet(key) {
  const rows = await rest(`place_cache?key=eq.${encodeURIComponent(key)}&select=data,created_at`).catch(() => null);
  const row = rows?.[0];
  if (!row || Date.now() - new Date(row.created_at).getTime() > TTL_MS) return undefined;
  return row.data;
}

async function cachePut(key, data) {
  await rest('place_cache', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, data, created_at: new Date().toISOString() }),
  }).catch(() => null);
}

/** Zählt eine Google-Abfrage; false, wenn das Tageslimit erreicht ist. */
async function googleTake() {
  const ok = await rest('rpc/google_take', { method: 'POST', body: JSON.stringify({ lim: DAILY_LIMIT }) }).catch(() => null);
  return ok === null ? true : ok === true; // ohne Tabelle (noch nicht eingerichtet) nicht blockieren
}

/** Ist die Anfrage von einem angemeldeten Dately-Konto? */
async function signedIn(req) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || !SUPABASE_URL) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY || token, Authorization: `Bearer ${token}` } });
  return res.ok;
}

/* ------------------------------------------------------------ OpenStreetMap */

async function overpass(query) {
  let last = 'Kartendienst nicht erreichbar';
  for (const url of OVERPASS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 40000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Dately/1.0 (Date-Ideen-App)' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data.remark && /timed out|runtime error/i.test(data.remark) && !data.elements?.length) continue;
        return data;
      }
      last = `Kartendienst antwortet mit ${res.status}`;
    } catch {
      /* nächsten Server versuchen */
    }
  }
  throw new Error(last);
}

let nominatimNext = 0;
async function nominatim(params) {
  // Höchstens eine Anfrage pro Sekunde (Nutzungsbedingungen von Nominatim)
  const wait = nominatimNext - Date.now();
  nominatimNext = Math.max(Date.now(), nominatimNext) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const qs = new URLSearchParams({ format: 'jsonv2', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'User-Agent': 'Dately/1.0 (Date-Ideen-App)', 'Accept-Language': 'de' } });
  if (!res.ok) throw new Error(`Nominatim antwortet mit ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------------ Google */

const PRICE = { PRICE_LEVEL_FREE: 'kostenlos', PRICE_LEVEL_INEXPENSIVE: '€', PRICE_LEVEL_MODERATE: '€€', PRICE_LEVEL_EXPENSIVE: '€€€', PRICE_LEVEL_VERY_EXPENSIVE: '€€€€' };
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const hhmm = (h, m) => `${String(h ?? 0).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;

/** Google-Öffnungszeiten in das OpenStreetMap-Format umwandeln (z. B. „Mo off; Tu 10:00-18:00“). */
export function toOsmHours(periods) {
  if (!periods?.length) return '';
  if (periods.length === 1 && !periods[0].close) return '24/7';
  const byDay = Array.from({ length: 7 }, () => []);
  for (const p of periods) {
    if (!p.open || !p.close) continue;
    byDay[p.open.day].push(`${hhmm(p.open.hour, p.open.minute)}-${hhmm(p.close.hour, p.close.minute)}`);
  }
  return [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAYS[d]} ${byDay[d].length ? byDay[d].join(',') : 'off'}`).join('; ');
}

async function google(path, body, fieldMask) {
  if (!GOOGLE_KEY) throw new Error('Kein Google-Schlüssel auf dem Server');
  if (!(await googleTake())) throw new Error('Tageslimit für Google erreicht');
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': fieldMask, Referer: `${APP_ORIGIN}/` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google antwortet mit ${res.status}`);
  return res.json();
}

const photoUrl = (name, self) => (name ? `${self}?photo=${encodeURIComponent(name)}` : '');

async function googleDetails({ name, street = '', lat, lon }, self) {
  const data = await google('places:searchText', {
    textQuery: `${name} ${street}`.trim(),
    languageCode: 'de',
    maxResultCount: 1,
    locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 300 } },
  }, 'places.id,places.displayName,places.rating,places.userRatingCount,places.photos,places.googleMapsUri,places.websiteUri,places.priceLevel,places.regularOpeningHours');
  const g = data.places?.[0];
  if (!g) return null;
  return {
    rating: g.rating ?? null,
    count: g.userRatingCount ?? 0,
    photo: photoUrl(g.photos?.[0]?.name, self),
    mapsUri: g.googleMapsUri ?? '',
    website: g.websiteUri ?? '',
    price: PRICE[g.priceLevel] ?? '',
    hours: toOsmHours(g.regularOpeningHours?.periods),
  };
}

async function googleSearch({ text, lat, lon, radius = 30000 }, self) {
  const data = await google('places:searchText', {
    textQuery: text,
    languageCode: 'de',
    maxResultCount: 10,
    locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(radius, 50000) } },
  }, 'places.id,places.displayName,places.location,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.photos,places.businessStatus,places.regularOpeningHours');
  return (data.places ?? [])
    .filter((g) => g.location && g.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((g) => ({
      id: `g${g.id}`,
      name: g.displayName?.text ?? '',
      lat: g.location.latitude,
      lon: g.location.longitude,
      street: (g.formattedAddress ?? '').split(',')[0],
      city: ((g.formattedAddress ?? '').split(',')[1] ?? '').replace(/\d{5}/, '').trim(),
      website: g.websiteUri ?? '',
      hours: toOsmHours(g.regularOpeningHours?.periods),
      price: null,
      image: photoUrl(g.photos?.[0]?.name, self),
      google: { rating: g.rating ?? null, count: g.userRatingCount ?? 0 },
    }));
}

/** Google-Foto ausliefern (der Schlüssel bleibt auf dem Server). */
async function googlePhoto(name) {
  if (!GOOGLE_KEY || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) return new Response('Nicht gefunden', { status: 404, headers: CORS });
  const key = `photo|${name}`;
  const cached = await cacheGet(key);
  let url = cached?.url;
  if (!url) {
    if (!(await googleTake())) return new Response('Tageslimit', { status: 429, headers: CORS });
    const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true&key=${encodeURIComponent(GOOGLE_KEY)}`, { headers: { Referer: `${APP_ORIGIN}/` } });
    if (!res.ok) return new Response('Foto nicht verfügbar', { status: 404, headers: CORS });
    url = (await res.json()).photoUri;
    if (url) await cachePut(key, { url });
  }
  // Weiterleitung auf das Foto bei Google (ohne Schlüssel in der Adresse)
  return new Response(null, { status: 302, headers: { ...CORS, Location: url, 'Cache-Control': 'public, max-age=604800' } });
}

/* ------------------------------------------------------------ Anfragen */

export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const self = `${SUPABASE_URL || url.origin}/functions/v1/places`;
  if (req.method === 'GET' && url.searchParams.get('photo')) return googlePhoto(url.searchParams.get('photo'));
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  if (!(await signedIn(req))) return json({ error: 'Bitte in Dately anmelden' }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Ungültige Anfrage' }, 400);
  }
  try {
    switch (body.action) {
      case 'status':
        return json({ ok: true, google: !!GOOGLE_KEY });
      case 'overpass': {
        if (typeof body.query !== 'string' || body.query.length > 20000) return json({ error: 'Ungültige Abfrage' }, 400);
        const key = `op|${await sha(body.query)}`;
        const hit = await cacheGet(key);
        if (hit !== undefined) return json(hit);
        const data = await overpass(body.query);
        await cachePut(key, data);
        return json(data);
      }
      case 'nominatim': {
        const p = body.params ?? {};
        const params = Object.fromEntries(['q', 'viewbox', 'bounded', 'limit', 'extratags', 'addressdetails', 'accept-language'].filter((k) => p[k] != null).map((k) => [k, String(p[k])]));
        if (!params.q) return json({ error: 'Suchbegriff fehlt' }, 400);
        const key = `nm|${await sha(JSON.stringify(params))}`;
        const hit = await cacheGet(key);
        if (hit !== undefined) return json(hit);
        const data = await nominatim(params);
        await cachePut(key, data);
        return json(data);
      }
      case 'area_get': {
        // Erkundete Umgebung (für alle Konten gemeinsam, 7 Tage)
        if (typeof body.key !== 'string' || body.key.length > 60) return json({ error: 'Ungültig' }, 400);
        const hit = await cacheGet(`area|${body.key}`);
        return json(hit ?? null);
      }
      case 'area_put': {
        if (typeof body.key !== 'string' || body.key.length > 60 || !body.data?.cats) return json({ error: 'Ungültig' }, 400);
        const text = JSON.stringify(body.data);
        if (text.length > 900000) return json({ error: 'Zu groß' }, 413);
        await cachePut(`area|${body.key}`, body.data);
        return json({ ok: true });
      }
      case 'google_details': {
        const p = body.place ?? {};
        if (!p.name || p.lat == null) return json({ error: 'Ort fehlt' }, 400);
        const key = `gd|${p.name}|${Number(p.lat).toFixed(4)}|${Number(p.lon).toFixed(4)}`;
        const hit = await cacheGet(key);
        if (hit !== undefined) return json(hit);
        const data = await googleDetails(p, self);
        await cachePut(key, data);
        return json(data);
      }
      case 'google_search': {
        if (!body.text || body.lat == null) return json({ error: 'Suchbegriff fehlt' }, 400);
        const key = `gs|${body.text}|${Number(body.lat).toFixed(2)}|${Number(body.lon).toFixed(2)}|${body.radius ?? 30000}`;
        const hit = await cacheGet(key);
        if (hit !== undefined) return json(hit);
        const data = await googleSearch(body, self);
        await cachePut(key, data);
        return json(data);
      }
      default:
        return json({ error: 'Unbekannte Aktion' }, 400);
    }
  } catch (e) {
    return json({ error: e.message ?? String(e) }, 502);
  }
}

if (globalThis.Deno?.serve) Deno.serve(handle);
