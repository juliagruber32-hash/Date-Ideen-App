// Dately lernt mit: Aus euren Dates, Bewertungen, Favoriten und dem, was ihr überspringt, entsteht ein
// Geschmacksprofil. Es sorgt für passende Vorschläge mit Begründung – und für Abwechslung.

import { catForStep, categoryById, isXmasSeason } from './places.js';

const DAY = 24 * 3600 * 1000;
const ACT = { museum: 'im Museum', gallery: 'in einer Galerie', cinema: 'im Kino', theatre: 'im Theater', spa: 'in der Therme', icerink: 'Eislaufen', bowling: 'beim Bowling', escape: 'im Escape Room', climbing: 'Bouldern', zoo: 'im Zoo', restaurant: 'schön essen', bar: 'in einer Bar', cafe: 'im Café', wine: 'in einer Weinbar', minigolf: 'Minigolf', xmas: 'auf dem Weihnachtsmarkt', livemusic: 'bei Live-Musik', rooftop: 'über den Dächern', botanic: 'im Botanischen Garten', cooking: 'beim Kochkurs', pottery: 'Töpfern' };
let profile = null;

/** Hauptort-Art einer Idee oder eines Dates (z. B. museum, cinema). */
export function mainCat(x) {
  for (const s of x?.steps ?? []) {
    const c = s.cat ?? s.place?.category ?? catForStep(s, x.date ?? '2026-06-01');
    if (c) return c;
  }
  return null;
}

const avgRating = (d) => {
  const v = Object.values(d.ratings ?? {}).filter((x) => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Profil aufbauen.
 * dates: gespeicherte Dates (mit Plan), favorites: gemerkte Ideen, learn: { skip: { ideaId: [anzahl, zeit] } }
 */
export function buildProfile({ dates = [], favorites = [], learn = {}, ideaById = () => null }) {
  const now = Date.now();
  const cat = {}; // Vorliebe je Ortsart
  const catLast = {}; // wann zuletzt
  const ideaLast = {}; // Idee → letztes Datum
  const ideaRating = {};
  const places = {}; // Ort → { at, rating }
  let costSum = 0;
  let costN = 0;
  for (const d of dates) {
    const at = new Date(`${d.date}T12:00:00`).getTime();
    if (at > now + DAY) continue; // noch nicht stattgefunden
    const c = mainCat(d) ?? mainCat(ideaById(d.ideaId));
    const r = avgRating(d);
    const w = 0.3 + (r ? (r - 3) * 0.45 : 0);
    if (c) {
      cat[c] = (cat[c] ?? 0) + w;
      catLast[c] = Math.max(catLast[c] ?? 0, at);
    }
    if (d.ideaId) {
      ideaLast[d.ideaId] = Math.max(ideaLast[d.ideaId] ?? 0, at);
      if (r) ideaRating[d.ideaId] = r;
    }
    for (const s of d.steps ?? []) {
      if (s.place?.name) places[s.place.name.toLowerCase()] = { at, rating: r };
    }
    if (d.cost) {
      costSum += d.cost;
      costN++;
    }
  }
  const fav = new Set();
  for (const f of favorites) {
    fav.add(f.ideaId);
    const c = mainCat(f.idea ?? ideaById(f.ideaId));
    if (c) cat[c] = (cat[c] ?? 0) + 0.35;
  }
  const skip = {};
  for (const [id, [n, at]] of Object.entries(learn.skip ?? {})) {
    if (now - at < 45 * DAY) skip[id] = n; // ältere Ablehnungen vergessen
  }
  for (const [c, [n, at]] of Object.entries(learn.catSkip ?? {})) {
    if (now - at < 45 * DAY) cat[c] = (cat[c] ?? 0) - Math.min(n, 4) * 0.12;
  }
  profile = { cat, catLast, ideaLast, ideaRating, places, fav, skip, avgCost: costN ? costSum / costN : null, count: dates.length };
  return profile;
}

export const getProfile = () => profile;

/** Zusatzpunkte für eine Idee + kurze Begründung. */
export function learnScore(idea, { date = new Date().toISOString().slice(0, 10), weather = null } = {}) {
  if (!profile) return { score: 0, reason: '' };
  const now = Date.now();
  const c = mainCat(idea);
  const reasons = [];
  let s = 0;
  const like = c ? profile.cat[c] ?? 0 : 0;
  s += Math.max(-1, Math.min(1.2, like)) * 0.8;

  const last = profile.ideaLast[idea.id];
  if (last) {
    const days = (now - last) / DAY;
    const loved = (profile.ideaRating[idea.id] ?? 0) >= 4.5;
    if (days < 30) s -= 1.6;
    else if (days < 90) s -= loved ? 0.2 : 0.7;
    else if (loved) {
      s += 0.5;
      reasons.push([0.5, 'Euer Lieblings-Date – mal wieder?']);
    }
  }
  if (c && !last) {
    const cl = profile.catLast[c];
    const days = cl ? (now - cl) / DAY : null;
    if (days != null && days < 14) s -= 0.6; // Abwechslung: gleiche Art kürzlich gehabt
    else if (days != null && days > 45 && like > 0.3) {
      s += 0.45;
      reasons.push([0.45 + like, `Lange nicht mehr ${ACT[c] ?? 'so ein Date gehabt'} – das mögt ihr`]);
    } else if (days == null && profile.count >= 3) {
      s += 0.25;
      reasons.push([0.25, 'Mal etwas Neues für euch']);
    }
  }
  if (like > 0.5 && !reasons.length) reasons.push([like, 'Passt zu dem, was euch gefällt']);
  if (profile.fav.has(idea.id)) {
    s += 0.6;
    reasons.push([2, 'Von euch gemerkt']);
  }
  const sk = profile.skip[idea.id];
  if (sk) s -= Math.min(sk, 3) * 0.45;
  if (isXmasSeason(date) && (c === 'xmas' || /weihnacht|punsch|advent/i.test(idea.title ?? ''))) reasons.push([1.5, 'Passend zur Adventszeit']);
  if (weather?.known && weather.wet && idea.place === 'drinnen') reasons.push([0.3, 'Bei Regen gemütlich drinnen']);
  if (weather?.known && weather.cold && /therme|spa|sauna|fondue|punsch/i.test(`${idea.title} ${c}`)) reasons.push([0.6, 'Perfekt für einen kalten Tag']);
  if (idea.rating?.count >= 3 && idea.rating.avg >= 4.3) reasons.push([0.4, 'Bei anderen Paaren beliebt']);
  // Waren wir an diesem Ort schon? Gut bewertet → „Lieblingsort“, sonst lieber etwas anderes
  const placeNames = (idea.steps ?? []).map((x) => x.place?.name?.toLowerCase()).filter(Boolean);
  for (const n of placeNames) {
    const v = profile.places[n];
    if (!v) continue;
    if ((v.rating ?? 0) >= 4.5) reasons.push([1, 'Mit eurem Lieblingsort']);
    else if (now - v.at < 60 * DAY) s -= 0.8;
  }
  reasons.sort((a, b) => b[0] - a[0]);
  return { score: s, reason: reasons[0]?.[1] ?? '' };
}

/** Für den Generator: Vorliebe je Ortsart (+) bzw. kürzlich gehabt (−). */
export function catBias(c) {
  if (!profile || !c) return 0;
  const like = profile.cat[c] ?? 0;
  const cl = profile.catLast[c];
  const days = cl ? (Date.now() - cl) / DAY : null;
  return Math.max(-1, Math.min(1.2, like)) * 0.7 - (days != null && days < 14 ? 0.8 : 0) + (days == null ? 0.15 : 0);
}

/** Schon besuchter Ort, der nicht begeistert hat (in den letzten 60 Tagen)? */
export function visitedRecently(name) {
  const v = profile?.places[name?.toLowerCase()];
  return !!v && (v.rating ?? 0) < 4.5 && Date.now() - v.at < 60 * DAY;
}
