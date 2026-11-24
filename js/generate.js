// Dates aus echten Orten in der Nähe zusammenstellen: Hauptort + passender zweiter Ort gleich daneben.
// Berücksichtigt Vorlieben, Wetter, Tageszeit, Jahreszeit und Öffnungszeiten.

import { categoryById, CATEGORIES, distanceKm, fmtKm, isOpenAt, isXmasSeason, searchMixed, travelEstimates, fmtMin } from './places.js';
import { addMinutes } from './util.js';
import { catBias, visitedRecently } from './taste.js';

// Was passt danach? [Kategorie, Bezeichnung der Station, Minuten]
// Was passt dazu? [Kategorie, Bezeichnung, Minuten, 'vorher' | 'danach']
// Grundsatz: Essen zwischen 18 und 20 Uhr, Aperitif vor dem Essen, Drinks danach.
const PAIRINGS = {
  museum: [['cafe', 'Kaffee & Kuchen', 60, 'danach'], ['wine', 'Ein Glas Wein', 60, 'danach']],
  gallery: [['cafe', 'Kaffee danach', 45, 'danach'], ['wine', 'Ein Glas Wein', 60, 'danach']],
  cinema: [['restaurant', 'Essen vorher', 75, 'vorher'], ['bar', 'Drink danach', 60, 'danach']],
  theatre: [['restaurant', 'Essen vorher', 75, 'vorher'], ['wine', 'Ein Glas Wein danach', 60, 'danach']],
  livemusic: [['restaurant', 'Essen vorher', 75, 'vorher']],
  bowling: [['restaurant', 'Essen vorher', 75, 'vorher'], ['bar', 'Drink danach', 60, 'danach']],
  escape: [['restaurant', 'Essen & Auswertung', 75, 'danach'], ['bar', 'Drink danach', 60, 'danach']],
  climbing: [['cafe', 'Smoothie & Snack', 40, 'danach'], ['restaurant', 'Essen danach', 75, 'danach']],
  minigolf: [['icecream', 'Eis danach', 30, 'danach'], ['beergarden', 'Biergarten', 60, 'danach']],
  zoo: [['cafe', 'Kaffee & Kuchen', 45, 'danach'], ['beergarden', 'Biergarten', 60, 'danach']],
  park: [['icecream', 'Eis', 30, 'danach'], ['cafe', 'Café', 45, 'danach']],
  viewpoint: [['restaurant', 'Abendessen', 90, 'danach'], ['cafe', 'Café', 45, 'danach']],
  spa: [['restaurant', 'Leichtes Abendessen', 75, 'danach']],
  icerink: [['xmas', 'Punsch auf dem Weihnachtsmarkt', 45, 'danach'], ['cafe', 'Heiße Schokolade', 40, 'danach']],
  xmas: [['restaurant', 'Abendessen', 90, 'danach'], ['wine', 'Ein Glas Wein', 60, 'danach']],
  restaurant: [['wine', 'Aperitif', 45, 'vorher'], ['bar', 'Drink danach', 60, 'danach']],
  wine: [['restaurant', 'Abendessen', 105, 'danach']],
  cocktail: [['restaurant', 'Abendessen', 105, 'danach']],
  bar: [['restaurant', 'Essen vorher', 90, 'vorher']],
  beergarden: [['park', 'Spaziergang', 45, 'vorher']],
  openair: [['restaurant', 'Essen vorher', 75, 'vorher'], ['icecream', 'Eis vorher', 30, 'vorher']],
  lake: [['beergarden', 'Biergarten', 75, 'danach'], ['icecream', 'Eis', 30, 'danach']],
  boat: [['icecream', 'Eis am Ufer', 30, 'danach'], ['beergarden', 'Biergarten', 60, 'danach']],
  icecream: [['park', 'Spaziergang', 45, 'danach']],
  cafe: [['park', 'Spaziergang', 45, 'danach'], ['museum', 'Museum', 90, 'danach']],
};

// Schicke Orte – hier passt kein Imbiss und keine schnelle Küche dazu
const CHIC = new Set(['wine', 'cocktail', 'finedining', 'theatre', 'rooftop', 'livemusic', 'spa']);
const CASUAL = /asiat|chines|vietnam|thai|sushi|japan|indisch|türk|döner|kebab|burger|pizza|griech|imbiss|fast|wok\b|asia\b|snack|grill/i;
const STYLISH = /ital|franz|mediterr|regional|deutsch|bayer|österr|spani|steak|fisch|wein|gourmet|bistro|trattoria|osteria|brasserie/i;
const casual = (p) => CASUAL.test(`${p.cuisine ?? ''} ${p.name ?? ''}`);
const stylish = (p) => STYLISH.test(`${p.cuisine ?? ''} ${p.name ?? ''}`);

// Dauer des Hauptorts
const MAIN_MIN = { cocktail: 75, livemusic: 120, museum: 120, gallery: 75, cinema: 135, theatre: 150, bowling: 90, escape: 75, climbing: 120, minigolf: 75, zoo: 180, park: 90, viewpoint: 60, spa: 240, icerink: 90, xmas: 90, restaurant: 105, wine: 90, bar: 90, beergarden: 90, openair: 150, lake: 150, boat: 60, icecream: 40, cafe: 75 };
const MAIN_LABEL = { cocktail: 'Cocktailbar', livemusic: 'Live-Musik', museum: 'Museum', gallery: 'Galerie', cinema: 'Kino', theatre: 'Vorstellung', bowling: 'Bowling', escape: 'Escape Room', climbing: 'Bouldern', minigolf: 'Minigolf', zoo: 'Zoo', park: 'Spaziergang', viewpoint: 'Aussicht', spa: 'Therme', icerink: 'Eislaufen', xmas: 'Weihnachtsmarkt', restaurant: 'Essen', wine: 'Weinbar', bar: 'Bar', beergarden: 'Biergarten', openair: 'Open-Air-Kino', lake: 'Am See', boat: 'Boot fahren', icecream: 'Eis', cafe: 'Café' };

// Kurze Namen für Date-Titel wie „Kino & Jazz“
const SHORT = { cocktail: 'Cocktails', livemusic: 'Live-Musik', museum: 'Museum', gallery: 'Galerie', cinema: 'Kino', theatre: 'Theater', bowling: 'Bowling', escape: 'Escape Room', climbing: 'Bouldern', minigolf: 'Minigolf', zoo: 'Zoo', park: 'Spaziergang', viewpoint: 'Aussicht', spa: 'Therme', icerink: 'Eislaufen', xmas: 'Weihnachtsmarkt', restaurant: 'Dinner', finedining: 'Dinner', wine: 'Wein', bar: 'Drinks', beergarden: 'Biergarten', openair: 'Open-Air-Kino', lake: 'See', boat: 'Boot', icecream: 'Eis', cafe: 'Kaffee' };
const MUSIC = [[/jazz/i, 'Jazz'], [/blues/i, 'Blues'], [/piano/i, 'Piano-Bar'], [/karaoke/i, 'Karaoke']];
export function shortLabel(p, daytime = 'abend') {
  const name = p?.name ?? '';
  const m = MUSIC.find(([re]) => re.test(name));
  if (m) return m[1];
  if (['restaurant', 'finedining'].includes(p?.category) && daytime !== 'abend') return 'Essen';
  return SHORT[p?.category] ?? categoryById(p?.category)?.label ?? name;
}

const month = (iso) => Number(iso.slice(5, 7));
const isSummer = (iso) => month(iso) >= 6 && month(iso) <= 8;
const isWinter = (iso) => month(iso) === 12 || month(iso) <= 2;

/** Welche Arten von Hauptorten kommen in Frage? */
function mainCategories({ moods, daytime, date, weather, place, budget = Infinity }) {
  let ids = Object.keys(PAIRINGS).filter((id) => categoryById(id) && categoryById(id).times.includes(daytime));
  ids = ids.filter((id) => id !== 'xmas' || isXmasSeason(date));
  ids = ids.filter((id) => !['openair', 'lake'].includes(id) || isSummer(date));
  if (weather?.known && weather.wet) ids = ids.filter((id) => categoryById(id).place === 'drinnen');
  // Winterabende: keine Aussichtspunkte, Parks & Co. (Weihnachtsmarkt und Eislaufen bleiben)
  if (isWinter(date) || month(date) === 11) ids = ids.filter((id) => !['minigolf', 'lake', 'boat', 'openair', 'beergarden'].includes(id)); // draußen, im Winter meist zu
  if (daytime === 'abend' && (isWinter(date) || month(date) === 11)) ids = ids.filter((id) => !['park', 'viewpoint', 'lake', 'minigolf', 'zoo', 'boat', 'openair'].includes(id));
  if (place) ids = ids.filter((id) => categoryById(id).place === place);
  const affordable = ids.filter((id) => categoryById(id).cost <= budget);
  if (affordable.length >= 2) ids = affordable;
  const score = (id) => {
    const c = categoryById(id);
    let s = Math.random() * 0.6 + catBias(id);
    s += 0.8 * (c.moods ?? []).filter((m) => moods.includes(m)).length;
    if (id === 'xmas' && isXmasSeason(date)) s += 1.5; // aktueller Anlass
    if (isSummer(date) && ['openair', 'lake', 'beergarden'].includes(id)) s += 1;
    if (isWinter(date) && ['icerink', 'spa'].includes(id)) s += 0.6;
    if (weather?.known && weather.clear && c.place === 'draußen' && !weather.cold) s += 0.5;
    if (['cafe', 'icecream', 'bar', 'restaurant'].includes(id)) s -= 0.4; // eher als zweite Station
    return s;
  };
  return ids.sort((a, b) => score(b) - score(a));
}

const servesFood = (p) => p.servesFood || (p.category === 'wine' && !!p.cuisine);
const placeRef = (p) => ({ id: p.id, wikipedia: p.wikipedia, name: p.name, street: p.street, city: p.city, lat: p.lat, lon: p.lon, website: p.website, hours: p.hours, price: p.price, image: p.image, category: p.category });

/** Ein Date aus Hauptort + zweitem Ort bauen (vorher oder danach), mit stimmigen Uhrzeiten. */
export function buildGeneratedIdea(main, follow, pairing, { start, date }) {
  const cat = categoryById(main.category);
  const before = pairing?.[3] === 'vorher';
  const dinnerAfter = pairing && !before && ['restaurant', 'finedining'].includes(follow?.category);
  // Als Aperitif vor dem Essen reicht eine knappe Stunde
  let mainMin = MAIN_MIN[main.category] ?? 90;
  if (dinnerAfter && ['wine', 'cocktail', 'bar'].includes(main.category)) mainMin = 60;
  const aperitif = dinnerAfter && ['wine', 'cocktail', 'bar'].includes(main.category);
  const withFood = !follow && servesFood(main);
  if (withFood) mainMin = 150;
  const mainLabel = withFood ? 'Wein & kleine Gerichte' : aperitif ? 'Aperitif' : MAIN_LABEL[main.category] ?? cat.label;
  const gap = follow ? distanceKm(main, follow) : 0;
  const mainStep = { t: `${mainLabel}: ${main.name}`, label: mainLabel, cat: main.category, min: mainMin, place: placeRef(main), food: !!cat.food || withFood };
  const steps = [mainStep];
  if (follow && pairing) {
    const fcat = categoryById(follow.category);
    const fStep = { t: `${pairing[1]}: ${follow.name}`, label: pairing[1], cat: follow.category, min: pairing[2], place: placeRef(follow), food: !!fcat.food, note: gap > 0.05 ? `${fmtKm(gap)} entfernt` : 'gleich nebenan' };
    if (before) steps.unshift(fStep);
    else steps.push(fStep);
  }
  // Startzeit so wählen, dass ein Abendessen zwischen 18 und 20 Uhr beginnt
  let st = start;
  const total = steps.reduce((a, x) => a + x.min, 0);
  const dinnerIdx = steps.findIndex((x) => ['restaurant', 'finedining'].includes(x.cat));
  if (dinnerIdx >= 0 && (cat.times.includes('abend') || dinnerAfter)) {
    const offset = steps.slice(0, dinnerIdx).reduce((a, x) => a + x.min, 0);
    const target = 18 * 60 + 45; // Essen um ca. 18:45
    const m = Math.max(16 * 60 + 30, Math.min(19 * 60 + 30, target - offset));
    st = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  const amount = main.price?.amount;
  const cost = Math.round((amount != null ? amount * 2 : cat.cost) + (follow ? Math.min(categoryById(follow.category).cost, 60) : 0));
  const dt = cat.times.includes('abend') && !cat.times.includes('tag') ? 'abend' : st && st >= '17:00' ? 'abend' : 'tag';
  const first = before ? follow : main;
  const second = before ? main : follow;
  return {
    id: `gen-${main.id}${follow ? `-${follow.id}` : ''}`,
    title: follow ? `${shortLabel(first, dt)} & ${shortLabel(second, dt)}` : withFood ? 'Weinabend' : MAIN_LABEL[main.category] ?? main.name,
    subtitle: follow ? `${first.name} · ${second.name}` : main.name,
    emoji: cat.emoji,
    teaser: withFood ? 'Wein und kleine Gerichte an einem Ort – ganz entspannt.'
      : follow ? (before ? `${pairing[1].replace(/ vorher$/, '')}, danach ${mainLabel}` : `${mainLabel}, danach ${pairing[1].replace(/ danach$/, '')}`) + (gap < 0.6 ? ' – gleich nebenan' : ` – ${fmtKm(gap)} entfernt`)
        : cat.label,
    place: cat.place,
    moods: cat.moods ?? [],
    cost,
    reach: main.km > 15 ? 2 : 1,
    times: cat.times,
    image: main.image || follow?.image || '',
    steps,
    custom: true,
    generated: true,
    km: main.km,
    travel: travelEstimates(main.km),
    mainPlace: placeRef(main),
    priceText: main.price?.text ?? '',
    ...(st ? { start: { [cat.times.includes('abend') ? 'abend' : cat.times[0]]: st, tag: st } } : {}),
    date,
  };
}

/**
 * Dates in der Nähe zusammenstellen.
 * opts: { center, radiusKm, daytime, date, moods, weather, place, onlyCategory, count }
 */
export async function generateLocalDates(opts) {
  const { center, radiusKm = 15, daytime = 'abend', date, moods = [], weather, place = null, onlyCategory = null, count = 4, mainList = null, budget = Infinity, prio = 0 } = opts;
  const cold = isWinter(date) || month(date) === 11; // Biergärten & Co. haben im Winter meist zu
  const pairOf = (catId) => {
    const list = (PAIRINGS[catId] ?? [['cafe', 'Kaffee danach', 45, 'danach'], ['restaurant', 'Essen danach', 75, 'danach']]).filter((x) => !cold || !['beergarden', 'park', 'icecream'].includes(x[0]));
    // Im Winter statt Biergarten & Eis: aufwärmen
    return list.length ? list : [['cafe', 'Aufwärmen im Café', 45, 'danach'], ['restaurant', 'Essen danach', 75, 'danach']];
  };
  const mains = mainList ? ['suche'] : onlyCategory ? [onlyCategory] : mainCategories({ moods, daytime, date, weather, place, budget }).slice(0, 5);
  const followSrc = mainList ? [...new Set(mainList.map((p) => p.category))] : mains;
  const follows = [...new Set(followSrc.flatMap((id) => pairOf(id).map((p) => p[0])))].filter((id) => id !== 'xmas' || isXmasSeason(date));
  const need = [...new Set([...(mainList ? [] : mains), ...follows])];
  // Bereits erkundete Umgebung nutzen, sonst suchen
  const groups = opts.groups && need.every((id) => id in opts.groups) ? opts.groups : await searchMixed(need, center, radiusKm * 1000, prio);
  const startOf = (catId) => {
    const t = categoryById(catId)?.times ?? [daytime];
    return (t.includes(daytime) ? daytime : t[0]) === 'abend' ? '18:30' : '14:00';
  };
  const used = new Set();
  const out = [];
  for (const id of mains) {
    const many = !!(onlyCategory || mainList);
    const all = mainList ?? groups[id] ?? [];
    const openNow = all.filter((p) => !visitedRecently(p.name) && isOpenAt(p.hours, new Date(`${date}T${startOf(p.category)}:00`)) !== false);
    const list = (many && !openNow.length ? all : openNow).slice(0, many ? 10 : 2);
    for (const main of list) {
      if (used.has(main.id)) continue;
      const startTime = startOf(main.category);
      // Hat der Ort an dem Tag zu, den nächsten offenen Tag nehmen
      let day = date;
      for (let k = 0; k < 7 && isOpenAt(main.hours, new Date(`${day}T${startTime}:00`)) === false; k++) {
        const nx = new Date(`${day}T12:00:00`);
        nx.setDate(nx.getDate() + 1);
        day = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, '0')}-${String(nx.getDate()).padStart(2, '0')}`;
      }
      // Passenden zweiten Ort möglichst nah am Hauptort suchen
      let best = null;
      const mainCost = main.price?.amount != null ? main.price.amount * 2 : categoryById(main.category)?.cost ?? 0;
      // Weinbar mit Küche: einfach dort bleiben
      if (servesFood(main) && ['wine', 'cocktail'].includes(main.category)) {
        used.add(main.id);
        out.push(buildGeneratedIdea(main, null, null, { date: day, start: '18:30' }));
        if (!many && out.length >= count) return out;
        continue;
      }
      const chic = CHIC.has(main.category);
      for (const pairing of pairOf(main.category)) {
        if (mainCost + Math.min(categoryById(pairing[0])?.cost ?? 0, 40) > budget * 1.2) continue; // zu teuer
        const followAt = new Date(`${day}T${pairing[3] === 'vorher' ? startTime : addMinutes(startTime, MAIN_MIN[main.category] ?? 90)}:00`);
        const cands = (groups[pairing[0]] ?? [])
          .filter((f) => f.id !== main.id && !used.has(f.id) && isOpenAt(f.hours, followAt) !== false)
          // Zum schicken Weinlokal passt kein Imbiss oder Asia-Wok
          .filter((f) => !chic || !['restaurant', 'finedining'].includes(f.category) || !casual(f))
          .map((f) => ({ f, d: distanceKm(main, f), score: distanceKm(main, f) - (chic && stylish(f) ? 0.8 : 0) }))
          .sort((a, b) => a.score - b.score);
        if (cands[0] && (!best || cands[0].score < best.score)) best = { ...cands[0], pairing };
      }
      if (best && best.d > 3) best = null; // zu weit auseinander
      used.add(main.id);
      if (best) used.add(best.f.id);
      out.push(buildGeneratedIdea(main, best?.f ?? null, best?.pairing ?? null, { date: day, start: startTime }));
      if (!many && out.length >= count) return out;
    }
  }
  return out.slice(0, mainList || onlyCategory ? 12 : count);
}

export const travelLine = (idea) => {
  const t = idea.travel?.find((x) => x.mode === (idea.km < 1.5 ? 'walking' : 'driving')) ?? idea.travel?.[0];
  return t ? `${fmtKm(idea.km)} · ca. ${fmtMin(t.min)} ${t.mode === 'walking' ? 'zu Fuß' : 'mit dem Auto'}` : fmtKm(idea.km ?? 0);
};

export { CATEGORIES };
