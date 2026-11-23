// Wetter über Open-Meteo (kostenlos, ohne Anmeldung).

import { daysBetween, parseISO, today } from './util.js';

const WMO = {
  0: ['☀️', 'Klar'],
  1: ['🌤️', 'Überwiegend klar'],
  2: ['⛅', 'Teils bewölkt'],
  3: ['☁️', 'Bewölkt'],
  45: ['🌫️', 'Nebel'],
  48: ['🌫️', 'Nebel'],
  51: ['🌦️', 'Leichter Niesel'],
  53: ['🌦️', 'Niesel'],
  55: ['🌧️', 'Starker Niesel'],
  56: ['🌧️', 'Gefrierender Niesel'],
  57: ['🌧️', 'Gefrierender Niesel'],
  61: ['🌦️', 'Leichter Regen'],
  63: ['🌧️', 'Regen'],
  65: ['🌧️', 'Starker Regen'],
  66: ['🌧️', 'Gefrierender Regen'],
  67: ['🌧️', 'Gefrierender Regen'],
  71: ['🌨️', 'Leichter Schnee'],
  73: ['🌨️', 'Schnee'],
  75: ['❄️', 'Starker Schnee'],
  77: ['🌨️', 'Schneegriesel'],
  80: ['🌦️', 'Regenschauer'],
  81: ['🌧️', 'Regenschauer'],
  82: ['⛈️', 'Heftige Schauer'],
  85: ['🌨️', 'Schneeschauer'],
  86: ['❄️', 'Schneeschauer'],
  95: ['⛈️', 'Gewitter'],
  96: ['⛈️', 'Gewitter mit Hagel'],
  99: ['⛈️', 'Gewitter mit Hagel'],
};

export const wmo = (code) => WMO[code] ?? ['🌡️', 'Wetter'];

export async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=de&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding fehlgeschlagen');
  const json = await res.json();
  const g = json.results?.[0];
  if (!g) return null;
  return { name: g.name, lat: g.latitude, lon: g.longitude, country: g.country ?? '' };
}

const memo = new Map();

async function fetchForecast(geo) {
  const key = `${geo.lat.toFixed(2)},${geo.lon.toFixed(2)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}` +
    '&hourly=temperature_2m,precipitation_probability,weather_code&timezone=auto&forecast_days=16';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wetterdaten nicht verfügbar');
  const data = await res.json();
  memo.set(key, { at: Date.now(), data });
  return data;
}

// Welche Stunden zählen für die Tageszeit?
const WINDOWS = { tag: [10, 18], abend: [18, 23] };

/**
 * Wetter für einen Tag + Tageszeit.
 * Ergebnis: { known, icon, label, temp, prob, wet, cold, clear, reason? }
 */
export async function getWeather(geo, iso, daytime) {
  if (!geo) return { known: false, reason: 'Keine Stadt eingetragen' };
  const ahead = daysBetween(today(), parseISO(iso));
  if (ahead < 0 || ahead > 15) return { known: false, reason: 'Vorhersage erst 16 Tage vorher verfügbar' };

  let data;
  try {
    data = await fetchForecast(geo);
  } catch {
    return { known: false, reason: 'Wetter gerade nicht abrufbar' };
  }

  const [from, to] = WINDOWS[daytime] ?? WINDOWS.abend;
  const h = data.hourly;
  const idx = [];
  h.time.forEach((t, i) => {
    if (!t.startsWith(iso)) return;
    const hour = Number(t.slice(11, 13));
    if (hour >= from && hour < to) idx.push(i);
  });
  if (!idx.length) return { known: false, reason: 'Keine Daten für diesen Tag' };

  const codes = idx.map((i) => h.weather_code[i]);
  const probs = idx.map((i) => h.precipitation_probability[i] ?? 0);
  const temps = idx.map((i) => h.temperature_2m[i]);

  const worst = Math.max(...codes);
  const prob = Math.max(...probs);
  const temp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
  // Häufigster Code als „typisches“ Wetter fürs Symbol, schlechtester entscheidet über Regen.
  const typical = mode(codes);
  const shown = worst >= 51 && prob >= 40 ? worst : typical;

  const wet = (worst >= 51 && prob >= 40) || prob >= 60;
  const [icon, label] = wmo(shown);
  return {
    known: true,
    icon,
    label,
    temp,
    prob,
    wet,
    cold: temp < 6,
    clear: !wet && Math.max(...codes) <= 2,
  };
}

function mode(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
