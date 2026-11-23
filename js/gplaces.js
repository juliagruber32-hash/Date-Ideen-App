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
export async function googleDetails(place, apiKey) {
  if (!apiKey) return null;
  const cache = readCache();
  const hit = cache[place.id];
  if (hit && Date.now() - hit.at < TTL) return hit.data;

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
