// Optional: Google Places (New) für Bewertungen und Fotos – nur mit eigenem API-Schlüssel.
// Ohne Schlüssel zeigt die App Bilder aus Wikimedia und verlinkt die Google-Bewertungen.

const CACHE_KEY = 'date-ideen.gplaces.v1';
const TTL = 7 * 24 * 3600 * 1000;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    return {};
  }
}
function writeCache(c) {
  try {
    const entries = Object.entries(c).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* ignorieren */
  }
}

/**
 * Sucht den Ort bei Google und liefert Bewertung, Anzahl, Foto-URL und Links.
 * Gibt null zurück, wenn nichts Passendes gefunden wurde.
 */
// Google über die Server-Funktion (Schlüssel bleibt geheim, Tageslimit auf dem Server)
let gProxy = null;
export function setGoogleProxy(fn) {
  gProxy = fn;
}
export const googleViaServer = () => !!gProxy;

export async function googleDetails(place, apiKey) {
  if (apiKey === 'server') apiKey = '';
  if (!apiKey && !gProxy) return null;
  const cache = readCache();
  const hit = cache[place.id];
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  if (gProxy) {
    try {
      const data = await gProxy({ action: 'google_details', place: { name: place.name, street: place.street ?? '', lat: place.lat, lon: place.lon } });
      cache[place.id] = { at: Date.now(), data };
      writeCache(cache);
      return data;
    } catch (e) {
      if (!apiKey) throw e;
    }
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount,places.photos,places.googleMapsUri,places.websiteUri,places.priceLevel,places.location',
    },
    body: JSON.stringify({
      textQuery: `${place.name} ${place.street ?? ''}`.trim(),
      languageCode: 'de',
      maxResultCount: 1,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lon }, radius: 300 } },
    }),
  });
  if (res.status === 403 || res.status === 400) throw new Error('Google-Schlüssel ungültig oder Places API nicht aktiviert.');
  if (!res.ok) throw new Error('Google-Bewertungen gerade nicht verfügbar.');
  const json = await res.json();
  const g = json.places?.[0];
  let data = null;
  if (g) {
    const photo = g.photos?.[0]?.name;
    data = {
      rating: g.rating ?? null,
      count: g.userRatingCount ?? 0,
      photo: photo ? `https://places.googleapis.com/v1/${photo}/media?maxWidthPx=800&key=${encodeURIComponent(apiKey)}` : '',
      mapsUri: g.googleMapsUri ?? '',
      website: g.websiteUri ?? '',
      price: PRICE[g.priceLevel] ?? '',
    };
  }
  cache[place.id] = { at: Date.now(), data };
  writeCache(cache);
  return data;
}

const PRICE = {
  PRICE_LEVEL_FREE: 'kostenlos',
  PRICE_LEVEL_INEXPENSIVE: '€',
  PRICE_LEVEL_MODERATE: '€€',
  PRICE_LEVEL_EXPENSIVE: '€€€',
  PRICE_LEVEL_VERY_EXPENSIVE: '€€€€',
};

/**
 * Orte per Google-Textsuche finden (z. B. „Schwarzlicht Minigolf“, „Weihnachtsmarkt“), wenn die freien
 * Kartendaten nichts haben. Nur mit eigenem Schlüssel. Ergebnis wird 7 Tage gemerkt.
 */
export async function googleSearch(text, center, radiusM, apiKey) {
  if (apiKey === 'server') apiKey = '';
  if (!apiKey && !gProxy) return [];
  const cache = readCache();
  const ck = `s|${text}|${center.lat.toFixed(2)}|${center.lon.toFixed(2)}|${radiusM}`;
  const hit = cache[ck];
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  if (gProxy) {
    try {
      const data = await gProxy({ action: 'google_search', text, lat: center.lat, lon: center.lon, radius: radiusM });
      cache[ck] = { at: Date.now(), data };
      writeCache(cache);
      return data;
    } catch (e) {
      if (!apiKey) return [];
    }
  }
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.photos,places.businessStatus',
    },
    body: JSON.stringify({
      textQuery: text,
      languageCode: 'de',
      maxResultCount: 10,
      locationBias: { circle: { center: { latitude: center.lat, longitude: center.lon }, radius: Math.min(radiusM, 50000) } },
    }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const data = (json.places ?? [])
    .filter((g) => g.location && g.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((g) => ({
      id: `g${g.id}`,
      name: g.displayName?.text ?? '',
      lat: g.location.latitude,
      lon: g.location.longitude,
      street: (g.formattedAddress ?? '').split(',')[0],
      city: ((g.formattedAddress ?? '').split(',')[1] ?? '').replace(/\d{5}/, '').trim(),
      website: g.websiteUri ?? '',
      hours: '',
      price: null,
      image: g.photos?.[0]?.name ? `https://places.googleapis.com/v1/${g.photos[0].name}/media?maxWidthPx=800&key=${encodeURIComponent(apiKey)}` : '',
      google: { rating: g.rating ?? null, count: g.userRatingCount ?? 0 },
    }));
  cache[ck] = { at: Date.now(), data };
  writeCache(cache);
  return data;
}
