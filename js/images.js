// Echte Fotos für Orte und Ideen – statt Icons.
// Bildrechte: Wir zeigen nur frei lizenzierte Fotos von Wikimedia Commons (mit Urheber und Lizenz)
// sowie eure eigenen Fotos. Keine Fotos aus Google Maps oder von fremden Webseiten.
// Reihenfolge: Wikipedia-Artikel zum Ort → Wikimedia-Fotos direkt am Ort. Ergebnisse werden auf dem Gerät gemerkt.

const CACHE_KEY = 'datewell.images.v4';
const CREDIT_KEY = 'datewell.credits.v1';
let cache = null;
const pending = new Map();
const session = new Map();

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    cache = {};
  }
  return cache;
}
function save() {
  try {
    const entries = Object.entries(cache).slice(-600);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* egal */
  }
}

// Themenbilder je Kategorie bzw. Idee (deutsche Wikipedia-Artikel)
export const TOPIC = {
  museum: 'Pinakothek der Moderne', gallery: 'Kunstgalerie', cinema: 'Kino', theatre: 'Theater', restaurant: 'Restaurant', cafe: 'Kaffeehaus',
  bar: 'Bar (Gastronomie)', icecream: 'Speiseeis', wine: 'Weinbar', bowling: 'Bowling', escape: 'Escape Room', climbing: 'Bouldern',
  minigolf: 'Minigolf', zoo: 'Zoologischer Garten', park: 'Englischer Garten', viewpoint: 'Aussichtspunkt', spa: 'Therme Erding',
  icerink: 'Eislaufen', xmas: 'Weihnachtsmarkt', openair: 'Freilichtkino', lake: 'Badesee', beergarden: 'Biergarten', boat: 'Tretboot',
  bookshop: 'Buchhandlung', karaoke: 'Karaoke', arcade: 'Lasertag', chocolate: 'Schokolade',
  'picknick-park': 'Picknick', sonnenuntergang: 'Sonnenuntergang', 'schwarzlicht-minigolf': 'Schwarzlicht', 'minigolf-eis': 'Minigolf',
  'pasta-abend': 'Tagliatelle', spieleabend: 'Brettspiel', 'kino-drink': 'Kino', 'museum-cafe': 'Pinakothek der Moderne', 'escape-room': 'Escape Room',
  bouldern: 'Bouldern', 'wanderung-einkehr': 'Wandern', 'radtour-see': 'Radwandern', sternegucken: 'Milchstraße',
  heimkino: 'Popcorn', 'pizza-backen': 'Pizza', 'schoko-tasting': 'Schokolade', kochkurs: 'Kochkurs', 'restaurant-hopping': 'Restaurant',
  'flohmarkt-fruehstueck': 'Flohmarkt', brunch: 'Brunch', toepferkurs: 'Töpferei', 'paint-sip': 'Acrylmalerei', therme: 'Therme Erding',
  'touri-tag': 'Marienplatz', 'foto-challenge': 'Fotografie', tropenhaus: 'Botanischer Garten München-Nymphenburg', 'live-musik': 'Livemusik',
  'theater-comedy': 'Theater', tretboot: 'Tretboot', rooftop: 'Dachterrasse', eislaufen: 'Eislaufen', fotoalbum: 'Fotoalbum',
  'fruehstueck-bett': 'Croissant', fondue: 'Fondue', 'spa-zuhause': 'Massage', buchhandlung: 'Buchhandlung', arcade: 'Lasertag',
  'sushi-rollen': 'Sushi', nachtspaziergang: 'Nachtfotografie', 'candle-light': 'Candle-Light-Dinner', 'ueberraschungs-ausflug': 'Altstadt',
  'wellness-tag': 'Day Spa', 'erstes-date': 'Liebesbrief', weihnachtsmarkt: 'Christkindlmarkt (München)',
};

// --- Lizenzen ----------------------------------------------------------------
let credits = null;
function loadCredits() {
  if (credits) return credits;
  try {
    credits = JSON.parse(localStorage.getItem(CREDIT_KEY)) ?? {};
  } catch {
    credits = {};
  }
  return credits;
}
const COMMONS = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//;
/** Darf dieses Bild angezeigt werden? Eigene Fotos (Speicher, Gerät) und Wikimedia Commons. */
export function allowedImage(url) {
  if (!url) return false;
  if (/^(data:|blob:)/.test(url) || !/^https?:/.test(url)) return true; // eigene Fotos und Bilder der App
  if (/\/storage\/v1\/object\//.test(url)) return true; // eure Fotos in Supabase
  return COMMONS.test(url);
}
const fileOf = (url) => {
  const m = url.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
};
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const FREE = /^(cc0|cc[ -]by|public domain|pd\b|attribution)/i;
/** Urheber und Lizenz eines Commons-Fotos – null, wenn die Lizenz keine freie Nutzung erlaubt. */
export async function imageCredit(url) {
  if (!COMMONS.test(url ?? '')) return '';
  const c = loadCredits();
  const file = fileOf(url);
  if (!file) return null;
  if (file in c) return c[file];
  let credit = null;
  try {
    const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(file)}&prop=imageinfo&iiprop=extmetadata&format=json&origin=*`);
    const page = Object.values((await res.json()).query?.pages ?? {})[0];
    const meta = page?.imageinfo?.[0]?.extmetadata ?? {};
    const lic = strip(meta.LicenseShortName?.value);
    if (FREE.test(lic)) {
      const artist = strip(meta.Artist?.value).slice(0, 60) || 'Wikimedia Commons';
      credit = /public domain|^pd/i.test(lic) ? `Foto: ${artist} · gemeinfrei` : `Foto: ${artist} · ${lic}`;
    }
  } catch {
    return undefined; // offline – später nochmal prüfen
  }
  c[file] = credit;
  try {
    localStorage.setItem(CREDIT_KEY, JSON.stringify(Object.fromEntries(Object.entries(c).slice(-800))));
  } catch {
    /* egal */
  }
  return credit;
}
/** Nur Bilder mit freier Lizenz übernehmen. */
async function licensed(url) {
  if (!url || !COMMONS.test(url)) return '';
  const cr = await imageCredit(url);
  return cr ? url : '';
}

const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const tokens = (x) => norm(x).split(/\s+/).filter((t) => t.length > 3 && !['cafe', 'restaurant', 'museum', 'der', 'und', 'bar'].includes(t));

async function wikiSummary(title, lang = 'de') {
  const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!res.ok) return null;
  const j = await res.json();
  if (j.type === 'disambiguation') return null;
  return { title: j.title, image: j.thumbnail?.source ?? '' };
}

/** Fotos von Wikimedia Commons, die direkt am Ort aufgenommen wurden und den Namen tragen. */
async function commonsNear(place) {
  const want = tokens(place.name);
  if (!want.length) return '';
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${place.lat}%7C${place.lon}&ggsradius=150&ggsnamespace=6&ggslimit=30&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json&origin=*`;
  const res = await fetch(url);
  if (!res.ok) return '';
  const pages = Object.values((await res.json()).query?.pages ?? {});
  const hit = pages.find((p) => /\.(jpe?g|png|webp)$/i.test(p.title) && want.some((t) => norm(p.title).includes(t)));
  return hit?.imageinfo?.[0]?.thumburl ?? '';
}

async function placeImage(place) {
  if (place.wikipedia) {
    const [lang, title] = place.wikipedia.includes(':') ? place.wikipedia.split(/:(.+)/) : ['de', place.wikipedia];
    const s = await wikiSummary(title, lang).catch(() => null);
    const ok = await licensed(s?.image);
    if (ok) return ok;
  }
  const s = await wikiSummary(place.name).catch(() => null);
  // Nur übernehmen, wenn der Artikel wirklich diesen Ort meint
  if (s?.image && norm(s.title) === norm(place.name)) {
    const ok = await licensed(s.image);
    if (ok) return ok;
  }
  return licensed(await commonsNear(place).catch(() => ''));
}

/**
 * Bild für einen Ort oder ein Thema finden.
 * job: { place?: {id,name,lat,lon,wikipedia,category}, topic?: string }
 */
export async function findImage(job) {
  const c = load();
  const key = job.place ? `p:${job.place.id ?? `${job.place.name}@${job.place.lat}`}` : `t:${job.topic}`;
  if (key in c) return c[key];
  if (session.has(key)) return session.get(key);
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    let url = '';
    try {
      if (job.place?.lat != null) url = await placeImage(job.place);
      const fallback = job.place ? job.topic ?? TOPIC[job.place.category] : null;
      if (!url && fallback) url = await findImage({ topic: fallback });
      if (!url && !job.place && job.topic) url = await licensed((await wikiSummary(job.topic).catch(() => null))?.image);
    } catch {
      url = '';
    }
    // Nichts gefunden: nur für diese Sitzung merken, später erneut versuchen
    if (!url) session.set(key, url);
    else {
      c[key] = url;
      save();
    }
    pending.delete(key);
    return url;
  })();
  pending.set(key, p);
  return p;
}

/** Themenbild für eine Idee ohne konkreten Ort. */
// Keine allgemeinen Themenfotos mehr (oft unpassend) – nur echte Fotos des konkreten Orts.
export const topicFor = () => null;
