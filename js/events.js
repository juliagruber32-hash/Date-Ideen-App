// Veranstaltungen in der Nähe (Konzerte, Shows, Theater, Festivals) über die Ticketmaster Discovery API.
// Kostenloser Schlüssel: developer.ticketmaster.com → „Get your API Key“. Ohne Schlüssel bleibt der Bereich aus.

import { distanceKm, fmtKm, travelEstimates } from './places.js';

const memo = new Map();
const GENRE_EMOJI = { Music: '🎶', 'Arts & Theatre': '🎭', Sports: '🏟️', Film: '🎬', Miscellaneous: '✨' };
const GENRE_DE = { Music: 'Konzert', 'Arts & Theatre': 'Bühne', Sports: 'Sport', Film: 'Film', Miscellaneous: 'Veranstaltung' };

const pad = (n) => String(n).padStart(2, '0');
const isoUtc = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Veranstaltungen im Umkreis zwischen zwei Tagen (YYYY-MM-DD). */
export async function fetchEvents({ key, center, radiusKm, from, to }) {
  if (!key) return [];
  const k = `${center.lat.toFixed(2)}|${center.lon.toFixed(2)}|${radiusKm}|${from}|${to}`;
  if (memo.has(k)) return memo.get(k);
  const params = new URLSearchParams({
    apikey: key,
    latlong: `${center.lat},${center.lon}`,
    radius: String(Math.min(200, Math.max(1, Math.round(radiusKm)))),
    unit: 'km',
    locale: '*',
    size: '40',
    sort: 'date,asc',
    startDateTime: isoUtc(new Date(`${from}T00:00:00`)),
    endDateTime: isoUtc(new Date(`${to}T23:59:59`)),
  });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  if (res.status === 401) throw new Error('Ticketmaster-Schlüssel ungültig.');
  if (!res.ok) throw new Error('Veranstaltungen gerade nicht verfügbar.');
  const json = await res.json();
  const seen = new Set();
  const events = (json._embedded?.events ?? [])
    .map((e) => {
      const v = e._embedded?.venues?.[0] ?? {};
      const lat = Number(v.location?.latitude);
      const lon = Number(v.location?.longitude);
      const seg = e.classifications?.[0]?.segment?.name ?? 'Miscellaneous';
      const genre = e.classifications?.[0]?.genre?.name;
      const price = e.priceRanges?.[0];
      const img = [...(e.images ?? [])].filter((i) => i.ratio === '16_9').sort((a, b) => b.width - a.width).find((i) => i.width <= 1200) ?? e.images?.[0];
      return {
        id: `tm${e.id}`,
        name: e.name,
        url: e.url,
        date: e.dates?.start?.localDate,
        time: (e.dates?.start?.localTime ?? '').slice(0, 5),
        genre: genre && genre !== 'Undefined' ? genre : GENRE_DE[seg] ?? 'Veranstaltung',
        segment: seg,
        emoji: GENRE_EMOJI[seg] ?? '✨',
        image: img?.url ?? '',
        price: price ? { min: price.min, max: price.max, text: price.min === price.max ? `ab ${Math.round(price.min)} €` : `${Math.round(price.min)}–${Math.round(price.max)} €` } : null,
        venue: { name: v.name ?? '', street: v.address?.line1 ?? '', city: v.city?.name ?? '', lat, lon },
        km: Number.isFinite(lat) ? distanceKm(center, { lat, lon }) : null,
      };
    })
    .filter((e) => e.date && !seen.has(e.name + e.date) && seen.add(e.name + e.date));
  memo.set(k, events);
  return events;
}

/** Aus einer Veranstaltung ein Date machen (fester Tag und Uhrzeit). */
export function ideaFromEvent(ev) {
  const start = ev.time || '19:30';
  const venue = Number.isFinite(ev.venue.lat) ? { name: ev.venue.name, street: ev.venue.street, city: ev.venue.city, lat: ev.venue.lat, lon: ev.venue.lon, website: ev.url, hours: '', price: ev.price ? { text: ev.price.text, amount: ev.price.min } : null, image: ev.image, category: 'theatre' } : null;
  const [h] = start.split(':').map(Number);
  const before = h >= 17;
  return {
    id: `ev-${ev.id}`,
    title: ev.name,
    emoji: ev.emoji,
    teaser: `${ev.genre} · ${ev.venue.name}${ev.venue.city ? `, ${ev.venue.city}` : ''}`,
    place: 'drinnen',
    moods: ev.segment === 'Music' ? ['kultur', 'lustig'] : ev.segment === 'Arts & Theatre' ? ['kultur', 'romantisch'] : ['aktiv', 'lustig'],
    cost: ev.price ? Math.round(ev.price.min * 2) : 60,
    reach: (ev.km ?? 0) > 15 ? 2 : 1,
    times: [h >= 17 ? 'abend' : 'tag'],
    image: ev.image,
    fixedDate: ev.date,
    fixedStart: before ? `${String(Math.max(0, h - 1)).padStart(2, '0')}:${start.slice(3)}` : start,
    steps: [
      ...(before ? [{ t: 'Drink oder Snack vorher', min: 60, q: 'Bar' }] : []),
      { t: ev.name, min: 150, place: venue ?? undefined, url: venue ? undefined : ev.url, book: true, todo: 'Tickets kaufen', note: ev.price ? `Tickets ${ev.price.text} pro Person` : 'Tickets über den Link' },
    ],
    ticketUrl: ev.url,
    custom: true,
    generated: true,
    event: true,
    km: ev.km,
    travel: ev.km != null ? travelEstimates(ev.km) : null,
    priceText: ev.price ? `Tickets ${ev.price.text}` : '',
  };
}

export const eventWhen = (ev) => {
  const d = new Date(`${ev.date}T00:00:00`);
  return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}${ev.time ? `, ${ev.time} Uhr` : ''}`;
};

export { fmtKm };
void pad;
