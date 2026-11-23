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
  // Zusätzliche Kategorien nur für Plan-Stationen (nicht in der Entdecken-Liste)
  { id: 'beergarden', hidden: true, moods: [], label: 'Biergärten', emoji: '🍺', filters: ['["amenity"="biergarten"]', '["beer_garden"="yes"]["amenity"]'], place: 'draußen', times: ['tag', 'abend'], cost: 30, food: true, plan: [['Biergarten', 90]] },
  { id: 'bookshop', hidden: true, moods: [], label: 'Buchhandlungen', emoji: '📚', filters: ['["shop"="books"]'], place: 'drinnen', times: ['tag'], cost: 30, plan: [['Buchhandlung', 45]] },
  { id: 'karaoke', hidden: true, moods: [], label: 'Karaoke', emoji: '🎤', filters: ['["amenity"="karaoke_box"]', '["karaoke"="yes"]["amenity"]'], place: 'drinnen', times: ['abend'], cost: 40, plan: [['Karaoke', 120]] },
  { id: 'arcade', hidden: true, moods: [], label: 'Spielhallen', emoji: '🕹️', filters: ['["leisure"="amusement_arcade"]', '["sport"="laser_tag"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 40, plan: [['Arcade', 90]] },
  { id: 'boat', hidden: true, moods: [], label: 'Bootsverleih', emoji: '🚣', filters: ['["amenity"="boat_rental"]', '["shop"="boat"]["rental"]'], place: 'draußen', times: ['tag'], cost: 30, plan: [['Boot', 60]] },
  { id: 'chocolate', hidden: true, moods: [], label: 'Schokolade', emoji: '🍫', filters: ['["shop"="chocolate"]', '["shop"="confectionery"]'], place: 'drinnen', times: ['tag'], cost: 20, plan: [['Schokolade', 30]] },
  { id: 'openair', seasonal: 'summer', moods: ['romantisch', 'kultur'], label: 'Open-Air-Kino', emoji: '🎬', filters: ['["amenity"="cinema"]["open_air"="yes"]', '["cinema:type"="open_air"]', '["amenity"="cinema"]["name"~"(Open.?Air|Freiluft|Sommerkino)",i]'], place: 'draußen', times: ['abend'], cost: 25, plan: [['Open-Air-Kino', 150]] },
  { id: 'lake', seasonal: 'summer', moods: ['entspannt', 'romantisch'], label: 'Badeseen', emoji: '🏖️', filters: ['["leisure"="swimming_area"]["name"]', '["leisure"="bathing_place"]["name"]', '["natural"="beach"]["name"]'], place: 'draußen', times: ['tag'], cost: 5, plan: [['Am See', 150]] },
  // Genauere Ortsarten für bestimmte Stationen. fallback = weicher Wunsch (sonst ähnlicher Ort), ohne = harter Wunsch
  { id: 'rooftop', hidden: true, moods: [], label: 'Rooftop-Bars', emoji: '🍸', filters: ['["amenity"~"^(bar|pub|restaurant|cafe)$"]["rooftop"="yes"]', '["amenity"~"^(bar|pub|restaurant|cafe|nightclub)$"]["name"~"Rooftop|Roof|Dachterrasse|Sky ?Bar|Skybar|Dachgarten",i]'], place: 'draußen', times: ['abend'], cost: 40, plan: [['Rooftop-Bar', 90]] },
  { id: 'livemusic', hidden: true, moods: [], label: 'Live-Musik', emoji: '🎶', filters: ['["amenity"="music_venue"]', '["live_music"="yes"]["amenity"]', '["amenity"~"^(bar|pub|nightclub)$"]["name"~"Jazz|Blues|Live",i]'], place: 'drinnen', times: ['abend'], cost: 40, plan: [['Live-Musik', 120]] },
  { id: 'botanic', hidden: true, moods: [], label: 'Botanische Gärten', emoji: '🌿', filters: ['["leisure"="garden"]["garden:type"="botanical"]', '["name"~"Botanischer Garten|Tropenhaus|Palmengarten|Palmenhaus",i]["leisure"~"garden|park"]', '["name"~"Botanischer Garten|Tropenhaus|Palmengarten",i]["tourism"]'], place: 'drinnen', times: ['tag'], cost: 15, plan: [['Botanischer Garten', 120]] },
  { id: 'burger', hidden: true, fallback: 'restaurant', moods: [], label: 'Burger', emoji: '🍔', filters: ['["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"burger"]', '["amenity"~"^(restaurant|fast_food)$"]["name"~"Burger",i]'], place: 'drinnen', times: ['tag', 'abend'], cost: 35, food: true, plan: [['Burger', 75]] },
  { id: 'tapas', hidden: true, fallback: 'bar', moods: [], label: 'Tapas', emoji: '🫒', filters: ['["amenity"~"^(restaurant|bar)$"]["cuisine"~"tapas|spanish"]', '["amenity"~"^(restaurant|bar)$"]["name"~"Tapas|Bodega",i]'], place: 'drinnen', times: ['abend'], cost: 40, food: true, plan: [['Tapas', 75]] },
  { id: 'cocktail', hidden: true, fallback: 'bar', moods: [], label: 'Cocktailbars', emoji: '🍹', filters: ['["amenity"="bar"]["cocktails"="yes"]', '["amenity"~"^(bar|pub)$"]["name"~"Cocktail|Lounge",i]'], place: 'drinnen', times: ['abend'], cost: 35, plan: [['Cocktailbar', 60]] },
  { id: 'finedining', hidden: true, fallback: 'restaurant', moods: [], label: 'Gourmet-Restaurants', emoji: '🍽️', filters: ['["amenity"="restaurant"]["name"~"Gourmet|Fine Dining|Sterne",i]', '["amenity"="restaurant"]["stars"]'], place: 'drinnen', times: ['abend'], cost: 150, food: true, plan: [['Menü', 150]] },
  { id: 'brunch', hidden: true, fallback: 'cafe', moods: [], label: 'Brunch', emoji: '🥐', filters: ['["amenity"~"^(cafe|restaurant)$"]["brunch"="yes"]', '["amenity"~"^(cafe|restaurant)$"]["name"~"Brunch|Frühstück",i]'], place: 'drinnen', times: ['tag'], cost: 40, food: true, plan: [['Brunch', 105]] },
  { id: 'dessert', hidden: true, fallback: 'icecream', moods: [], label: 'Dessert & Patisserie', emoji: '🍰', filters: ['["shop"="pastry"]["name"]', '["amenity"="cafe"]["cuisine"~"cake|dessert"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 15, food: true, plan: [['Dessert', 30]] },
  { id: 'supermarket', hidden: true, moods: [], label: 'Supermärkte', emoji: '🛒', filters: ['["shop"="supermarket"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 20, plan: [['Einkauf', 20]] },
  { id: 'blacklight', hidden: true, moods: [], label: 'Schwarzlicht-Minigolf', emoji: '⛳', filters: ['["name"~"Schwarzlicht|Blacklight|Glow.?Golf|3D.?Minigolf|Indoor.?Minigolf",i]'], place: 'drinnen', times: ['tag', 'abend'], cost: 30, plan: [['Schwarzlicht-Minigolf', 75]] },
  { id: 'cooking', hidden: true, moods: [], label: 'Kochkurse', emoji: '👩‍🍳', filters: ['["amenity"="cooking_school"]', '["shop"]["name"~"Kochschule|Kochstudio|Kochkurs",i]', '["amenity"]["name"~"Kochschule|Kochstudio",i]'], place: 'drinnen', times: ['tag', 'abend'], cost: 120, food: true, plan: [['Kochkurs', 180]] },
  { id: 'pottery', hidden: true, moods: [], label: 'Töpferkurse', emoji: '🏺', filters: ['["craft"="pottery"]', '["shop"="pottery"]', '["shop"]["name"~"Töpfer|Keramik",i]'], place: 'drinnen', times: ['tag', 'abend'], cost: 80, plan: [['Töpfern', 150]] },
  { id: 'ort', hidden: true, moods: [], label: 'Ort', emoji: '📍', filters: [], place: 'drinnen', times: ['tag', 'abend'], cost: 25, plan: [['Besuch', 90]] },
  { id: 'icerink', moods: ['aktiv','romantisch'], label: 'Eislaufen', emoji: '⛸️', filters: ['["leisure"="ice_rink"]', '["sport"~"ice_skating|ice_hockey|ice_stock"]["leisure"~"^(stadium|sports_centre|sports_hall|pitch|ice_rink)$"]', '["building"="ice_rink"]["name"]'], place: 'drinnen', times: ['tag', 'abend'], cost: 25, plan: [['Eislaufen', 90], ['Punsch', 30]] },
  { id: 'xmas', seasonal: true, moods: ['romantisch', 'gemütlich'], label: 'Weihnachtsmärkte', emoji: '🎄', filters: ['["christmas:event"]', '["christmas:type"~"market"]', '["amenity"="marketplace"]["name"~"(Christkindl|Weihnachts|Advents)",i]'], place: 'draußen', times: ['abend', 'tag'], cost: 25, food: true, plan: [['Weihnachtsmarkt', 90], ['Glühwein & Punsch', 30]] },
];
export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);

const memo = new Map();

/** Orte einer Kategorie im Umkreis (Meter). Sortiert nach Entfernung. */
// Mehrere Overpass-Server: fällt einer aus, wird der nächste gefragt.
let OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Höchstens zwei Anfragen gleichzeitig (mehr lassen die Server pro Gerät nicht zu).
// Wichtige Suchen (z. B. die Orte im geöffneten Plan) kommen vor Hintergrund-Suchen dran.
const MAX_PARALLEL = 2;
let active = 0;
const waiting = [];
let overpassDownUntil = 0; // nach einem Ausfall für ein paar Minuten direkt die Ausweich-Suche nehmen
let health = null;
let healthAt = 0;

/** Kurzer Test (max. 6 s), ob ein Overpass-Server antwortet – sonst gleich die Ausweich-Suche. */
function overpassHealthy() {
  if (health && Date.now() - healthAt < 5 * 60 * 1000) return health;
  healthAt = Date.now();
  health = Promise.any(OVERPASS.map(async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent('[out:json][timeout:5];node(1);out ids;'), signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      return url;
    } finally {
      clearTimeout(timer);
    }
  })).then((url) => {
    // Den Server, der zuerst antwortet, zuerst fragen
    OVERPASS.sort((a, b) => (b === url) - (a === url));
    return true;
  }, () => false);
  return health;
}

async function overpass(query, prio = 0) {
  if (Date.now() < overpassDownUntil || !(await overpassHealthy())) throw new Error('Ortssuche gerade nicht erreichbar.');
  return new Promise((resolve, reject) => {
    waiting.push({ query, prio, resolve, reject });
    waiting.sort((x, y) => y.prio - x.prio);
    pump();
  });
}
function pump() {
  while (active < MAX_PARALLEL && waiting.length) {
    const job = waiting.shift();
    active++;
    overpassNow(job.query)
      .then(job.resolve, (e) => {
        overpassDownUntil = Date.now() + 5 * 60 * 1000;
        job.reject(e);
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

async function overpassNow(query) {
  let last = 'Ortssuche gerade nicht erreichbar.';
  for (let round = 0; round < 2; round++) {
    let busy = false;
    for (const url of OVERPASS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), url === OVERPASS[0] ? 25000 : 15000);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          if (json.remark && /timed out|runtime error/i.test(json.remark) && !json.elements?.length) continue;
          return json;
        }
        if (res.status === 429 || res.status === 504) {
          busy = true;
          last = 'Zu viele Anfragen – bitte kurz warten.';
        }
      } catch {
        /* nächsten Server versuchen */
      }
    }
    if (!busy) break; // nur bei „zu viele Anfragen“ ein zweites Mal versuchen
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(last);
}

export const CUISINES = [
  { id: 'asiatisch', label: 'Asiatisch', tags: ['asian', 'chinese', 'japanese', 'sushi', 'thai', 'vietnamese', 'korean', 'ramen', 'noodle', 'dim_sum'] },
  { id: 'italienisch', label: 'Italienisch', tags: ['italian', 'pizza', 'pasta'] },
  { id: 'indisch', label: 'Indisch', tags: ['indian', 'nepalese', 'pakistani', 'sri_lankan'] },
  { id: 'vegan', label: 'Vegan', diet: ['vegan'] },
  { id: 'vegetarisch', label: 'Vegetarisch', diet: ['vegetarian', 'vegan'] },
  { id: 'griechisch', label: 'Griechisch', tags: ['greek'] },
  { id: 'tuerkisch', label: 'Türkisch', tags: ['turkish', 'kebab'] },
  { id: 'orientalisch', label: 'Orientalisch', tags: ['lebanese', 'arab', 'persian', 'syrian', 'middle_eastern', 'falafel', 'israeli'] },
  { id: 'mexikanisch', label: 'Mexikanisch', tags: ['mexican', 'tex-mex', 'latin_american'] },
  { id: 'spanisch', label: 'Spanisch', tags: ['spanish', 'tapas'] },
  { id: 'franzoesisch', label: 'Französisch', tags: ['french'] },
  { id: 'deutsch', label: 'Deutsch & regional', tags: ['german', 'regional', 'bavarian', 'austrian'] },
  { id: 'burger', label: 'Burger', tags: ['burger', 'american'] },
  { id: 'steak', label: 'Steak', tags: ['steak_house', 'steak', 'grill', 'argentinian'] },
  { id: 'fisch', label: 'Fisch', tags: ['seafood', 'fish'] },
];

/** Zusatzfilter für eine Küche (Overpass), z. B. ["cuisine"~"(^|;)(italian|pizza)(;|$)"]. */
function cuisineFilters(cuisineId) {
  const c = CUISINES.find((x) => x.id === cuisineId);
  if (!c) return [''];
  if (c.diet) return c.diet.map((d) => `["diet:${d}"~"^(yes|only)$"]`);
  return [`["cuisine"~"(^|;)(${c.tags.join('|')})(;|$)",i]`];
}

/** Radien von innen nach außen bis zum gewählten Umkreis – so kommen die nächsten Orte zuerst. */
export function radiusLadder(radius) {
  return [...[3000, 10000, 30000, 70000].filter((r) => r < radius), radius];
}

/* ------------------------------------------------------------ Ausweich-Suche über Nominatim */
// Antwortet der Overpass-Kartendienst nicht, sucht Dately über Nominatim (ebenfalls OpenStreetMap).
// Nominatim erlaubt höchstens eine Anfrage pro Sekunde – deshalb nacheinander mit Pause.
const NOMI = {
  museum: ['[museum]'], gallery: ['Galerie'], cinema: ['[cinema]'], theatre: ['[theatre]'], restaurant: ['[restaurant]'],
  cafe: ['[cafe]', 'Café'], bar: ['[bar]', '[pub]'], cooking: ['Kochschule', 'Kochkurs'], blacklight: ['3D Minigolf', 'Schwarzlicht', 'Indoor Minigolf'],
  rooftop: ['Rooftop', 'Dachterrasse', 'Skybar'], livemusic: ['Jazz', 'Live Music', 'Musikclub', 'Blues'], botanic: ['Botanischer Garten', 'Palmengarten'],
  burger: ['Burger'], tapas: ['Tapas'], cocktail: ['Cocktailbar', 'Cocktail'], finedining: ['Gourmet Restaurant'], brunch: ['Brunch'],
  dessert: ['Patisserie', '[pastry]'], supermarket: ['[supermarket]'], lake: ['Badesee', 'Badestelle'], pottery: ['Töpferei', 'Keramik'], icecream: ['[ice cream]'], wine: ['Weinbar'], bowling: ['Bowling'],
  escape: ['Escape Room'], climbing: ['Boulderhalle', 'Kletterhalle'], minigolf: ['[miniature golf]'], zoo: ['[zoo]', 'Wildpark'],
  park: ['[park]'], viewpoint: ['[viewpoint]'], spa: ['Therme', '[sauna]'], icerink: ['[ice rink]', 'Eishalle', 'Eisstadion'],
  xmas: ['Christkindlmarkt', 'Weihnachtsmarkt'], beergarden: ['[biergarten]'], lake: ['Badesee'], boat: ['Bootsverleih'],
  bookshop: ['Buchhandlung', '[bookshop]'], karaoke: ['Karaoke'], arcade: ['Lasertag'], chocolate: ['Chocolaterie'], openair: ['Open-Air-Kino'],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nomiWaiting = [];
let nomiBusy = false;
// Bei freier Textsuche nur passende Arten von Orten übernehmen (z. B. „Jazz“ → Bar, nicht Hochschule)
const NOMI_TYPES = {
  livemusic: ['bar', 'pub', 'nightclub', 'music_venue', 'arts_centre', 'theatre', 'events_venue'],
  rooftop: ['bar', 'pub', 'restaurant', 'cafe', 'nightclub', 'biergarten'],
  burger: ['restaurant', 'fast_food'], tapas: ['restaurant', 'bar'], cocktail: ['bar', 'pub', 'nightclub'],
  brunch: ['cafe', 'restaurant'], finedining: ['restaurant'], botanic: ['garden', 'park', 'attraction', 'botanical_garden'],
  cooking: ['cooking_school', 'restaurant', 'school', 'shop', 'yes', 'events_venue'], wine: ['bar', 'restaurant', 'pub', 'wine'],
};

/** Eine Nominatim-Anfrage; wichtige Anfragen (prio) kommen zuerst dran. */
function nominatimOnce(q, center, radius, prio = 0) {
  radius = Math.min(radius, 80000);
  return new Promise((resolve, reject) => {
    nomiWaiting.push({ q, center, radius, prio, resolve, reject });
    nomiWaiting.sort((x, y) => y.prio - x.prio);
    nomiPump();
  });
}

async function nomiPump() {
  if (nomiBusy) return;
  nomiBusy = true;
  while (nomiWaiting.length) {
    const { q, center, radius, resolve, reject } = nomiWaiting.shift();
    const r = radius / 1000;
    const dLat = r / 111;
    const dLon = r / (111 * Math.cos((center.lat * Math.PI) / 180));
    const box = [center.lon - dLon, center.lat + dLat, center.lon + dLon, center.lat - dLat].map((x) => x.toFixed(4)).join(',');
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${box}&bounded=1&limit=40&extratags=1&addressdetails=1&accept-language=de`;
    try {
      const res = await fetch(url);
      resolve(res.ok ? await res.json() : []);
    } catch (e) {
      reject(e);
    }
    await sleep(1100); // höchstens eine Anfrage pro Sekunde
  }
  nomiBusy = false;
}

async function nominatimCategory(catId, center, radius, prio = 0, wideOnly = false) {
  const cat = categoryById(catId);
  const out = [];
  const seen = new Set();
  let calls = 0;
  let errors = 0;
  // Erst im engen Umkreis suchen (Nominatim sortiert nicht nach Entfernung), dann weiter
  const steps = wideOnly ? [radius] : [...new Set([Math.min(radius, 8000), Math.min(radius, 20000), radius])];
  for (const r of steps) {
    for (const q of NOMI[catId] ?? [cat.label]) {
      calls++;
      const list = await nominatimOnce(q, center, r, prio).catch(() => {
        errors++;
        return [];
      });
      for (const x of list) {
        const a = x.address ?? {};
        const el = {
          type: x.osm_type, id: x.osm_id, lat: Number(x.lat), lon: Number(x.lon),
          tags: { ...(x.extratags ?? {}), name: x.name, [x.category]: x.type, 'addr:street': a.road, 'addr:housenumber': a.house_number, 'addr:city': a.city || a.town || a.village || '' },
        };
        if (['bus_stop', 'platform', 'station', 'stop_position', 'parking'].includes(x.type)) continue;
        if (!['amenity', 'leisure', 'tourism', 'shop', 'craft', 'club', 'sport', 'natural'].includes(x.category)) continue;
        if (catId === 'zoo' && (x.extratags?.zoo === 'enclosure' || /^(tier|wild|vogel)?gehege$/i.test(x.name ?? ''))) continue; // nur ein Gehege, kein Tierpark
        if (NOMI_TYPES[catId] && !q.startsWith('[') && !NOMI_TYPES[catId].includes(x.type)) continue;
        const p = toPlace(el, cat, center);
        if (!p || seen.has(p.name) || p.km * 1000 > radius) continue;
        p.importance = Number(x.importance) || 0;
        seen.add(p.name);
        out.push(p);
      }
      if (out.length >= 10) break;
    }
    if (out.length >= 8) break; // genug Auswahl – sonst im größeren Umkreis weitersuchen
  }
  const res = (wideOnly ? out.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)) : out.sort((a, b) => a.km - b.km)).slice(0, 15);
  if (calls && errors === calls) Object.defineProperty(res, 'failed', { value: true });
  return res;
}

async function nominatimGroups(catIds, center, radius, prio = 0) {
  const groups = {};
  await Promise.all(catIds.map(async (id) => (groups[id] = await nominatimCategory(id, center, radius, prio))));
  // Nur wenn keine einzige Anfrage durchging, gilt die Suche als fehlgeschlagen (sonst: wirklich nichts in der Nähe)
  Object.defineProperty(groups, 'failed', { value: catIds.every((id) => groups[id].failed) });
  await addWikidataImages(Object.values(groups).flat());
  return groups;
}

/** Bekannteste Orte einer Art im großen Umkreis (Nominatim sortiert nach Bedeutung), z. B. Deutsches Museum. */
export async function searchNotable(categoryId, center, radius) {
  const key = `notable|${categoryId}|${center.lat.toFixed(2)}|${center.lon.toFixed(2)}|${radius}`;
  if (memo.has(key)) return memo.get(key);
  const list = await nominatimCategory(categoryId, center, radius, 2, true);
  memo.set(key, list);
  return list;
}

export async function searchNearby(categoryId, center, radius, cuisineId = '') {
  const key = `${categoryId}|${cuisineId}|${center.lat.toFixed(3)}|${center.lon.toFixed(3)}|${radius}`;
  if (memo.has(key)) return memo.get(key);
  let places = [];
  try {
    for (const r of radiusLadder(radius)) {
      places = await searchOnce(categoryId, center, r, cuisineId);
      if (places.length >= 20) break;
    }
  } catch (e) {
    if (places.length) return places;
    if (cuisineId) throw e;
    places = await nominatimCategory(categoryId, center, radius, 1);
    if (!places.length) throw e;
  }
  memo.set(key, places);
  return places;
}

async function searchOnce(categoryId, center, radius, cuisineId) {
  const cat = categoryById(categoryId);
  const extra = cuisineId ? cuisineFilters(cuisineId) : [''];
  const parts = cat.filters.flatMap((f) => extra.map((x) => `nwr${f}${x}(around:${radius},${center.lat},${center.lon});`)).join('');
  const query = `[out:json][timeout:25];(${parts});out center tags 60;`;
  const json = await overpass(query, 1);
  const seen = new Set();
  const places = json.elements
    .map((el) => toPlace(el, cat, center))
    .filter((p) => p && !seen.has(p.name + p.street) && seen.add(p.name + p.street))
    .sort((a, b) => a.km - b.km)
    .slice(0, 30);
  await addWikidataImages(places);
  return places;
}

function toPlace(el, cat, center) {
  const raw = el.tags ?? {};
  // Weihnachtsmärkte haben eigene Angaben (christmas:name, christmas:opening_hours …)
  const t = cat.id === 'xmas'
    ? { ...raw, name: raw['christmas:name'] || raw.name, opening_hours: raw['christmas:opening_hours'] || raw.opening_hours, website: raw['christmas:website'] || raw.website }
    : raw;
  if (!t.name) return null;
  if (/^(mc ?donald'?s|burger king|kfc|subway|pizza hut|domino'?s|nordsee|kochlöffel)\b/i.test(t.name)) return null; // Fast-Food-Ketten sind kein Date-Ort
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
    wikipedia: t.wikipedia ?? '',
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

const commonsFile = (name, width = 500) =>
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
  out.push({ mode: 'driving', label: 'Auto', icon: 'car', min: Math.round((road / (road > 15 ? 60 : road > 5 ? 42 : 25)) * 60 + 4) });
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
export async function searchMixed(catIds, center, radius, prio = 0) {
  const key = `mix|${catIds.join(',')}|${center.lat.toFixed(3)}|${center.lon.toFixed(3)}|${radius}`;
  if (memo.has(key)) return memo.get(key);
  const count = (g) => Object.values(g).reduce((a, x) => a + x.length, 0);
  const viaOverpass = overpassGroups(catIds, center, radius, prio);
  let groups;
  if (prio >= 2) {
    // Geöffneter Plan: beide Dienste gleichzeitig fragen, das erste brauchbare Ergebnis zählt
    const viaNomi = nominatimGroups(catIds, center, radius, prio);
    groups = await Promise.any([viaOverpass.then((g) => (count(g) ? g : Promise.reject(new Error('leer')))), viaNomi.then((g) => (count(g) ? g : Promise.reject(new Error('leer'))))])
      .catch(() => viaNomi);
  } else {
    groups = await viaOverpass.catch(() => null);
    if (!groups || !count(groups)) groups = await nominatimGroups(catIds, center, radius, prio);
  }
  if (!groups || groups.failed) throw new Error('Ortssuche gerade nicht erreichbar.');
  memo.set(key, groups);
  return groups;
}

async function overpassGroups(catIds, center, radius, prio) {
  const groups = Object.fromEntries(catIds.map((id) => [id, []]));
  for (const r of radiusLadder(radius)) {
    const missing = catIds.filter((id) => groups[id].length < 3);
    if (!missing.length) break;
    let found;
    try {
      found = await mixedOnce(missing, center, r, prio);
    } catch (e) {
      if (!Object.values(groups).some((g) => g.length)) throw e;
      break; // mit dem bisher Gefundenen weitermachen
    }
    for (const id of missing) if (found[id].length >= groups[id].length) groups[id] = found[id];
  }
  return groups;
}

async function mixedOnce(catIds, center, radius, prio = 0) {
  const cats = catIds.map(categoryById).filter(Boolean);
  // Je Kategorie eine eigene Obergrenze – sonst verdrängen z. B. viele Restaurants alle anderen Orte
  const parts = cats.map((c, k) => `(${c.filters.map((f) => `nwr${f}(around:${radius},${center.lat},${center.lon});`).join('')})->.s${k};.s${k} out center tags 40;`).join('');
  const query = `[out:json][timeout:25];${parts}`;
  const json = await overpass(query, prio);
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
  return groups;
}

/* ------------------------------------------------------------ Suche nach Namen (z. B. „Therme“) */

/** Orte, deren Name den Suchbegriff enthält – im Umkreis, nächste zuerst. */
export async function searchByName(term, center, radius) {
  const clean = term.trim().replace(/[\\^$.*+?()[\]{}|"]/g, '');
  if (clean.length < 3) return [];
  const key = `name|${clean.toLowerCase()}|${center.lat.toFixed(3)}|${center.lon.toFixed(3)}|${radius}`;
  if (memo.has(key)) return memo.get(key);
  let places = [];
  for (const r of radiusLadder(Math.min(radius, 60000))) {
    const parts = ['amenity', 'leisure', 'tourism', 'shop'].map((k) => `nwr["name"~"${clean}",i]["${k}"](around:${r},${center.lat},${center.lon});`).join('');
    const json = await overpass(`[out:json][timeout:25];(${parts});out center tags 60;`, 1);
    const seen = new Set();
    places = json.elements
      .map((el) => toPlace(el, CATEGORIES.find((c) => !c.hidden && c.filters.some((f) => matchesFilter(el.tags ?? {}, f))) ?? categoryById('ort'), center))
      .filter((p) => p && !seen.has(p.name + p.street) && seen.add(p.name + p.street))
      .sort((a, b) => a.km - b.km)
      .slice(0, 15);
    if (places.length >= 5) break;
  }
  await addWikidataImages(places);
  memo.set(key, places);
  return places;
}

/* ------------------------------------------------------------ Welche Ortsart passt zu einer Plan-Station? */

const STEP_RULES = [
  [/weihnachtsmarkt|christkindl/, 'xmas'],
  [/schwarzlicht|blacklight|3d.?minigolf/, 'blacklight'],
  [/rooftop|dachterrasse|skybar/, 'rooftop'],
  [/live.?musik|konzert|open stage|jazz/, 'livemusic'],
  [/botanischer garten|gewächsh|tropenhaus|palmengarten/, 'botanic'],
  [/burger/, 'burger'],
  [/tapas/, 'tapas'],
  [/cocktail/, 'cocktail'],
  [/fine dining|mehrgangmenü|gourmet/, 'finedining'],
  [/brunch/, 'brunch'],
  [/dessert|patisserie/, 'dessert'],
  [/supermarkt|picknick-einkauf/, 'supermarket'],
  [/badestelle|badesee|pause am see/, 'lake'],
  [/kochkurs|kochschule/, 'cooking'],
  [/töpfer|keramik/, 'pottery'],
  [/bowling/, 'bowling'],
  [/museum/, 'museum'],
  [/galerie/, 'gallery'],
  [/biergarten|einkehr/, 'beergarden'],
  [/eisdiele|\beis\b|dessert/, 'icecream'],
  [/café|cafe|kaffee|frühstück|brunch|smoothie|heiße schokolade/, 'cafe'],
  [/rooftop|cocktail|bar\b|live musik|drink|aperitif|punsch/, 'bar'],
  [/wein/, 'wine'],
  [/restaurant|dining|burger|tapas|essen|abendessen|mittagessen|hauptgang|vorspeise/, 'restaurant'],
  [/kino/, 'cinema'],
  [/theater|comedy|vorstellung/, 'theatre'],
  [/bowling/, 'bowling'],
  [/escape/, 'escape'],
  [/boulder|kletter/, 'climbing'],
  [/minigolf/, 'minigolf'],
  [/therme|sauna|day spa|spa\b/, 'spa'],
  [/eislauf|eisstadion/, 'icerink'],
  [/zoo|tierpark/, 'zoo'],
  [/botanischer garten|park\b|picknick/, 'park'],
  [/aussicht|sonnenuntergang/, 'viewpoint'],
  [/buchhandlung/, 'bookshop'],
  [/karaoke/, 'karaoke'],
  [/arcade|spielhalle|lasertag/, 'arcade'],
  [/bootsverleih|tretboot|kanu/, 'boat'],
  [/chocolaterie/, 'chocolate'],
];

/** Ortsart für eine Station – nur wenn sie außer Haus stattfindet (Suchbegriff vorhanden). */
/** Advents- und Weihnachtszeit (ca. 20. November bis 31. Dezember)? */
export function isXmasSeason(iso) {
  const md = (iso ?? '').slice(5);
  return md >= '11-20' && md <= '12-31';
}

export function catForStep(step, iso) {
  if (step.place) return null;
  if (/^(anfahrt|rückfahrt|fahrt|zugfahrt)\b/i.test(step.t ?? '')) return null; // Weg dorthin, kein eigener Ort
  // In der Adventszeit: Punsch, Glühwein & Co. auf dem Weihnachtsmarkt
  if (isXmasSeason(iso) && /punsch|glühwein|weihnacht|christkindl/i.test(`${step.t} ${step.q ?? ''}`)) return 'xmas';
  if (!step.q) return null;
  const text = step.q.toLowerCase();
  return STEP_RULES.find(([re]) => re.test(text))?.[1] ?? null;
}
