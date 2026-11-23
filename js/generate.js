// Dates aus echten Orten in der Nähe zusammenstellen: Hauptort + passender zweiter Ort gleich daneben.
// Berücksichtigt Vorlieben, Wetter, Tageszeit, Jahreszeit und Öffnungszeiten.

import { categoryById, CATEGORIES, distanceKm, fmtKm, isOpenAt, isXmasSeason, searchMixed, travelEstimates, fmtMin } from './places.js';
import { addMinutes } from './util.js';

// Was passt danach? [Kategorie, Bezeichnung der Station, Minuten]
const PAIRINGS = {
  museum: [['cafe', 'Kaffee & Kuchen', 60], ['wine', 'Ein Glas Wein', 60]],
  gallery: [['cafe', 'Kaffee danach', 45], ['wine', 'Ein Glas Wein', 60]],
  cinema: [['bar', 'Drink danach', 60], ['restaurant', 'Essen danach', 75]],
  theatre: [['wine', 'Ein Glas Wein danach', 60], ['bar', 'Drink danach', 60]],
  bowling: [['restaurant', 'Essen danach', 75], ['bar', 'Drink danach', 60]],
  escape: [['restaurant', 'Essen & Auswertung', 75], ['bar', 'Drink danach', 60]],
  climbing: [['cafe', 'Smoothie & Snack', 40], ['beergarden', 'Biergarten', 75]],
  minigolf: [['icecream', 'Eis danach', 30], ['beergarden', 'Biergarten', 60]],
  zoo: [['cafe', 'Kaffee & Kuchen', 45], ['beergarden', 'Biergarten', 60]],
  park: [['icecream', 'Eis', 30], ['cafe', 'Café', 45]],
  viewpoint: [['bar', 'Sundowner', 60], ['restaurant', 'Abendessen', 75]],
  spa: [['restaurant', 'Leichtes Abendessen', 75]],
  icerink: [['xmas', 'Punsch auf dem Weihnachtsmarkt', 45], ['cafe', 'Heiße Schokolade', 40]],
  xmas: [['restaurant', 'Abendessen', 75], ['wine', 'Ein Glas Wein', 60]],
  restaurant: [['bar', 'Drink danach', 60], ['icecream', 'Dessert', 30]],
  wine: [['restaurant', 'Essen danach', 75]],
  bar: [['restaurant', 'Essen vorher', 75]],
  beergarden: [['park', 'Spaziergang', 45]],
  openair: [['bar', 'Drink davor', 45], ['icecream', 'Eis davor', 30]],
  lake: [['beergarden', 'Biergarten', 75], ['icecream', 'Eis', 30]],
  boat: [['icecream', 'Eis am Ufer', 30], ['beergarden', 'Biergarten', 60]],
  icecream: [['park', 'Spaziergang', 45]],
  cafe: [['park', 'Spaziergang', 45], ['museum', 'Museum', 90]],
};

// Dauer des Hauptorts
const MAIN_MIN = { museum: 120, gallery: 75, cinema: 135, theatre: 150, bowling: 90, escape: 75, climbing: 120, minigolf: 75, zoo: 180, park: 90, viewpoint: 60, spa: 240, icerink: 90, xmas: 90, restaurant: 105, wine: 90, bar: 90, beergarden: 90, openair: 150, lake: 150, boat: 60, icecream: 40, cafe: 75 };
const MAIN_LABEL = { museum: 'Museum', gallery: 'Galerie', cinema: 'Kino', theatre: 'Vorstellung', bowling: 'Bowling', escape: 'Escape Room', climbing: 'Bouldern', minigolf: 'Minigolf', zoo: 'Zoo', park: 'Spaziergang', viewpoint: 'Aussicht', spa: 'Therme', icerink: 'Eislaufen', xmas: 'Weihnachtsmarkt', restaurant: 'Essen', wine: 'Weinbar', bar: 'Bar', beergarden: 'Biergarten', openair: 'Open-Air-Kino', lake: 'Am See', boat: 'Boot fahren', icecream: 'Eis', cafe: 'Café' };

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
  if (isWinter(date) || month(date) === 11) ids = ids.filter((id) => !['minigolf', 'lake', 'boat', 'openair'].includes(id)); // draußen, im Winter meist zu
  if (daytime === 'abend' && (isWinter(date) || month(date) === 11)) ids = ids.filter((id) => !['park', 'viewpoint', 'lake', 'minigolf', 'zoo', 'boat', 'openair'].includes(id));
  if (place) ids = ids.filter((id) => categoryById(id).place === place);
  const affordable = ids.filter((id) => categoryById(id).cost <= budget);
  if (affordable.length >= 2) ids = affordable;
  const score = (id) => {
    const c = categoryById(id);
    let s = Math.random() * 0.6;
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

const placeRef = (p) => ({ id: p.id, wikipedia: p.wikipedia, name: p.name, street: p.street, city: p.city, lat: p.lat, lon: p.lon, website: p.website, hours: p.hours, price: p.price, image: p.image, category: p.category });

/** Ein Date aus Hauptort + Folgeort bauen. */
export function buildGeneratedIdea(main, follow, pairing, { start, date }) {
  const cat = categoryById(main.category);
  const mainMin = MAIN_MIN[main.category] ?? 90;
  const gap = follow ? distanceKm(main, follow) : 0;
  const steps = [{ t: `${MAIN_LABEL[main.category] ?? cat.label}: ${main.name}`, label: MAIN_LABEL[main.category] ?? cat.label, cat: main.category, min: mainMin, place: placeRef(main), food: !!cat.food }];
  if (follow && pairing) {
    const fcat = categoryById(follow.category);
    steps.push({ t: `${pairing[1]}: ${follow.name}`, label: pairing[1], cat: follow.category, min: pairing[2], place: placeRef(follow), food: !!fcat.food, note: gap > 0.05 ? `${fmtKm(gap)} vom ${MAIN_LABEL[main.category] ?? 'ersten Ort'} entfernt` : '' });
  }
  const amount = main.price?.amount;
  const cost = Math.round((amount != null ? amount * 2 : cat.cost) + (follow ? Math.min(categoryById(follow.category).cost, 40) : 0));
  return {
    id: `gen-${main.id}${follow ? `-${follow.id}` : ''}`,
    title: follow ? `${main.name} & ${follow.name}` : main.name,
    emoji: cat.emoji,
    teaser: follow ? `${MAIN_LABEL[main.category] ?? cat.label}, ${/vorher|davor/.test(pairing[1]) ? '' : 'danach '}${pairing[1].replace(/ (danach|vorher|davor)$/, '')} ${/vorher|davor/.test(pairing[1]) ? 'vorher ' : ''}${gap < 0.6 ? 'gleich nebenan' : `in ${fmtKm(gap)}`}` : cat.label,
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
    ...(start ? { start: { [cat.times[0]]: start } } : {}),
    date,
  };
}

/**
 * Dates in der Nähe zusammenstellen.
 * opts: { center, radiusKm, daytime, date, moods, weather, place, onlyCategory, count }
 */
export async function generateLocalDates(opts) {
  const { center, radiusKm = 15, daytime = 'abend', date, moods = [], weather, place = null, onlyCategory = null, count = 4, mainList = null, budget = Infinity, prio = 0 } = opts;
  const pairOf = (catId) => PAIRINGS[catId] ?? [['cafe', 'Kaffee danach', 45], ['restaurant', 'Essen danach', 75]];
  const mains = mainList ? ['suche'] : onlyCategory ? [onlyCategory] : mainCategories({ moods, daytime, date, weather, place, budget }).slice(0, 5);
  const followSrc = mainList ? [...new Set(mainList.map((p) => p.category))] : mains;
  const follows = [...new Set(followSrc.flatMap((id) => pairOf(id).map((p) => p[0])))].filter((id) => id !== 'xmas' || isXmasSeason(date));
  const groups = await searchMixed([...new Set([...(mainList ? [] : mains), ...follows])], center, radiusKm * 1000, prio);
  const startOf = (catId) => {
    const t = categoryById(catId)?.times ?? [daytime];
    return (t.includes(daytime) ? daytime : t[0]) === 'abend' ? '18:30' : '14:00';
  };
  const used = new Set();
  const out = [];
  for (const id of mains) {
    const many = !!(onlyCategory || mainList);
    const all = mainList ?? groups[id] ?? [];
    const openNow = all.filter((p) => isOpenAt(p.hours, new Date(`${date}T${startOf(p.category)}:00`)) !== false);
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
      for (const pairing of pairOf(main.category)) {
        if (mainCost + Math.min(categoryById(pairing[0])?.cost ?? 0, 40) > budget * 1.2) continue; // zu teuer
        const followAt = new Date(`${day}T${addMinutes(startTime, MAIN_MIN[main.category] ?? 90)}:00`);
        const cands = (groups[pairing[0]] ?? [])
          .filter((f) => f.id !== main.id && !used.has(f.id) && isOpenAt(f.hours, followAt) !== false)
          .map((f) => ({ f, d: distanceKm(main, f) }))
          .sort((a, b) => a.d - b.d);
        if (cands[0] && (!best || cands[0].d < best.d)) best = { ...cands[0], pairing };
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
