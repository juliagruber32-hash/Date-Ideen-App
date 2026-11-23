// Vorschlags-Logik: Ideen filtern, bewerten, auswählen und zu einem Plan mit Uhrzeiten machen.

import { addMinutes, daysBetween, parseISO, today } from './util.js';

let ideasCache = null;
let extraIdeas = [];

/** Eingebaute Ideen aus data/ideas.json. */
export async function loadIdeas() {
  if (!ideasCache) {
    const res = await fetch('data/ideas.json');
    ideasCache = await res.json();
  }
  return ideasCache;
}

/** Eigene Ideen des Paares, die bei Vorschlägen mitzählen. */
export function setExtraIdeas(list) {
  extraIdeas = list.filter((i) => i && i.id && Array.isArray(i.steps) && i.steps.length);
}
export const allIdeas = () => [...(ideasCache ?? []), ...extraIdeas];

export const ideaDuration = (idea) => idea.steps.reduce((sum, s) => sum + s.min, 0);

export const REACH = ['Zuhause', 'In der Stadt', 'Ausflug'];

export const MOODS = [
  ['romantisch', 'Romantisch', '💞'],
  ['gemütlich', 'Gemütlich', '🛋️'],
  ['abenteuerlich', 'Abenteuerlich', '🧭'],
  ['aktiv', 'Aktiv', '⚡'],
  ['entspannt', 'Entspannt', '🌿'],
  ['lustig', 'Lustig', '😄'],
  ['kulinarisch', 'Kulinarisch', '🍽️'],
  ['kultur', 'Kultur', '🎭'],
  ['kreativ', 'Kreativ', '🎨'],
];
export const moodLabel = (m) => MOODS.find((x) => x[0] === m)?.[1] ?? m;

/**
 * Geschmacksprofil aus euren Bewertungen: Stimmungen, Orte und Ideen,
 * die euch gefallen (positiv) oder nicht (negativ). Bewertung 1–5, neutral = 3.
 */
export function tasteProfile(dates) {
  const moods = {};
  const ideas = {};
  const place = { drinnen: 0, draußen: 0 };
  let count = 0;
  for (const d of dates) {
    const vals = Object.values(d.ratings ?? {}).filter((v) => v > 0);
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const w = (avg - 3) / 2; // -1 … +1
    const idea = allIdeas().find((i) => i.id === d.ideaId);
    const ms = d.moods ?? idea?.moods ?? [];
    for (const m of ms) moods[m] = (moods[m] ?? 0) + w;
    const pl = d.place ?? idea?.place;
    if (pl in place) place[pl] += w * 0.5;
    if (d.ideaId) ideas[d.ideaId] = avg;
    count++;
  }
  return { moods, ideas, place, count };
}

function tasteScore(idea, profile) {
  if (!profile?.count) return 0;
  let s = 0;
  for (const m of idea.moods ?? []) s += (profile.moods[m] ?? 0) * 0.45;
  s += (profile.place[idea.place] ?? 0) * 0.3;
  return s;
}

/** Empfehlungen, die euch nach euren Bewertungen gefallen könnten – mit Begründung. */
export function recommend(dates, count = 3) {
  const profile = tasteProfile(dates);
  if (!profile.count) return [];
  const done = new Set(dates.map((d) => d.ideaId));
  const liked = Object.entries(profile.moods).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  return allIdeas()
    .filter((i) => !done.has(i.id))
    .map((i) => ({ idea: i, score: tasteScore(i, profile) + Math.random() * 0.15 }))
    .filter((x) => x.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ idea }) => {
      const shared = (idea.moods ?? []).filter((m) => liked.includes(m));
      const best = dates
        .filter((d) => Object.values(d.ratings ?? {}).some((v) => v >= 4))
        .find((d) => (d.moods ?? allIdeas().find((i) => i.id === d.ideaId)?.moods ?? []).some((m) => shared.includes(m)));
      const reason = best?.title ? `Weil euch „${best.title}“ gefallen hat` : shared.length ? `Ihr mögt es ${shared.map(moodLabel).join(' und ').toLowerCase()}` : 'Passt zu euren Bewertungen';
      return { idea, reason };
    });
}

/** Passt die Idee grundsätzlich zu den Eingaben? */
function fits(idea, ctx, weather, useMood = true) {
  if (useMood && ctx.mood && !(idea.moods ?? []).includes(ctx.mood)) return false;
  if (useMood && ctx.moods?.length && !(idea.moods ?? []).some((m) => ctx.moods.includes(m))) return false;
  if (ctx.placePref && idea.place !== ctx.placePref) return false;
  if (idea.cost > ctx.budget) return false;
  if (idea.reach > ctx.reach) return false;
  if (!idea.times.includes(ctx.daytime)) return false;
  if (weather?.known) {
    if (weather.wet && idea.place === 'draußen') return false; // bei Regen nur drinnen
    if (idea.needsClear && !weather.clear) return false;
  }
  return true;
}

/**
 * Wünsche aus der Paar-Umfrage zusammenführen: gemeinsamer Tag, Tageszeit, Budget, Entfernung, Stimmung.
 * answers: { a: {...}, b: {...} } mit days[], daytime ('tag'|'abend'|'beides'), moods[], place ('drinnen'|'draußen'|'egal'), budget, reach.
 */
export function combineWishes(answers) {
  const A = answers.a ?? {};
  const B = answers.b ?? {};
  const both = (A.days ?? []).filter((d) => (B.days ?? []).includes(d)).sort();
  const dt = (x, y) => (x === y ? (x === 'beides' ? 'abend' : x) : x === 'beides' ? y : y === 'beides' ? x : null);
  const daytime = dt(A.daytime ?? 'beides', B.daytime ?? 'beides');
  const moodsBoth = (A.moods ?? []).filter((m) => (B.moods ?? []).includes(m));
  const moods = [...new Set([...(A.moods ?? []), ...(B.moods ?? [])])];
  const placePref = A.place && A.place === B.place && A.place !== 'egal' ? A.place : null;
  return {
    date: both[0] ?? null,
    commonDays: both,
    daytime: daytime ?? 'abend',
    daytimeConflict: !daytime,
    budget: Math.min(A.budget ?? 200, B.budget ?? 200),
    reach: Math.min(A.reach ?? 2, B.reach ?? 2),
    moods: moodsBoth.length ? moodsBoth : moods,
    moodsBoth,
    placePref,
  };
}

function score(idea, ctx, weather, recent, profile) {
  let s = Math.random() + tasteScore(idea, profile);
  if (ctx.moods?.length) s += 0.35 * (idea.moods ?? []).filter((m) => ctx.moods.includes(m)).length;
  if (ctx.moodsBoth?.length) s += 0.4 * (idea.moods ?? []).filter((m) => ctx.moodsBoth.includes(m)).length;
  if (idea.rating?.avg) s += (idea.rating.avg - 3) * 0.15; // Community-Bewertung
  if (ctx.special) s += idea.special ? 1.5 : 0;
  else if (idea.special) s -= 0.6; // Besonderes für besondere Tage aufheben
  if (idea.reach === ctx.reach) s += 0.4; // gewählte Entfernung bevorzugen
  if (weather?.known && idea.place === 'draußen') {
    if (weather.cold) s -= 0.7;
    else if (weather.clear && weather.temp >= 15) s += 0.6;
  }
  if (ctx.budget > 0) s += 0.3 * (idea.cost / ctx.budget); // Budget sinnvoll nutzen
  if (recent.has(idea.id)) s -= 1.2; // Wiederholungen vermeiden
  if (idea.custom) s += 0.35; // eigene Ideen etwas bevorzugen
  return s;
}

/**
 * Bis zu `count` Vorschläge. `exclude` sind bereits gezeigte Ideen (für „Andere Ideen“).
 * Gibt { ideas, exhausted } zurück; exhausted = alle passenden schon gezeigt.
 */
export async function suggest(ctx, weather, { exclude = new Set(), recentIds = [], count = 3, dates = [] } = {}) {
  await loadIdeas();
  const all = allIdeas();
  const recent = new Set(recentIds);
  const profile = tasteProfile(dates);
  let pool = all.filter((i) => fits(i, ctx, weather));
  let moodRelaxed = false;
  if (!pool.length && (ctx.mood || ctx.moods?.length || ctx.placePref)) {
    ctx = { ...ctx, placePref: null };
    pool = all.filter((i) => fits(i, ctx, weather, false));
    moodRelaxed = pool.length > 0;
  }
  let fresh = pool.filter((i) => !exclude.has(i.id));
  const exhausted = fresh.length === 0 && pool.length > 0;
  if (exhausted) fresh = pool;
  const ideas = fresh
    .map((i) => ({ i, s: score(i, ctx, weather, recent, profile) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.i);
  return { ideas, exhausted, poolSize: pool.length, moodRelaxed };
}

/** Wann geht’s los? */
export function defaultStart(idea, daytime) {
  return idea.start?.[daytime] ?? (daytime === 'abend' ? '18:30' : '14:00');
}

const mapsSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/** Links für eine Station (Ortssuche und/oder Webseite). */
export function stepLinks(step, idea, opts) {
  const { city, vegan } = opts;
  const links = [];
  if (step.place) {
    links.push({ href: step.place.website || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(step.place.name + ' ' + (step.place.street ?? ''))}`, label: step.place.website ? 'Webseite' : 'Auf der Karte' });
    links.push({ href: `https://www.google.com/maps/dir/?api=1&destination=${step.place.lat},${step.place.lon}`, label: 'Route' });
    const q = encodeURIComponent(`${step.place.name} ${step.place.street ?? ''} ${step.place.city ?? opts.city ?? ''}`.trim());
    links.push({ href: `https://www.google.com/maps/search/?api=1&query=${q}`, label: 'Google-Bewertungen' });
    if (step.food) links.push({ href: `https://www.opentable.de/s?covers=2&term=${encodeURIComponent(`${step.place.name} ${step.place.city ?? opts.city ?? ''}`.trim())}`, label: 'Reservieren' });
    return links;
  }
  if (step.q) {
    const q = `${vegan && step.food ? 'vegan ' : ''}${step.q}${city ? ' ' + city : ''}`;
    links.push({ href: mapsSearch(q), label: step.book ? 'Orte & buchen' : 'Orte finden' });
  }
  if (step.url) links.push({ href: step.url, label: step.q ? 'Webseite' : step.book ? 'Buchen' : 'Webseite' });
  if (step.recipe && idea.recipe) links.push({ href: idea.recipe.url, label: 'Rezept' });
  return links;
}

export function ingredientsFor(idea, vegan) {
  if (!idea.recipe) return [];
  return idea.recipe.ingredients.map((x) => (typeof x === 'string' ? x : vegan ? x.vegan : x.std));
}

/** Fertiger Plan, wie er gespeichert und angezeigt wird. */
export function buildPlan(idea, { date, daytime, start }, settings, weather) {
  const opts = { city: settings.city, vegan: settings.vegan };
  let t = start || defaultStart(idea, daytime);
  const steps = idea.steps.map((s) => {
    const step = { time: t, title: s.t, min: s.min, note: s.note ?? '', links: stepLinks(s, idea, opts) };
    if (s.place) step.place = { name: s.place.name, hours: s.place.hours ?? '', price: s.place.price?.text ?? '', street: s.place.street ?? '', lat: s.place.lat, lon: s.place.lon, website: s.place.website ?? '', image: s.place.image ?? '', category: s.place.category ?? '' };
    t = addMinutes(t, s.min);
    return step;
  });
  return {
    ideaId: idea.id,
    title: idea.title,
    emoji: idea.emoji,
    teaser: idea.teaser,
    place: idea.place,
    moods: idea.moods ?? [],
    communityId: idea.communityId ?? null,
    cost: idea.cost,
    duration: ideaDuration(idea),
    date,
    daytime,
    start: steps[0].time,
    end: t,
    steps,
    recipe: idea.recipe ? { name: idea.recipe.name, url: idea.recipe.url, ingredients: ingredientsFor(idea, settings.vegan) } : null,
    todos: idea.steps.filter((s) => s.todo).map((s) => s.todo),
    weather: weather?.known ? { icon: weather.icon, label: weather.label, temp: weather.temp } : null,
  };
}

/** Kalenderdatei (.ics) für Handy-Kalender. */
export function toICS(plan) {
  const dt = (iso, hhmm) => `${iso.replaceAll('-', '')}T${hhmm.replace(':', '')}00`;
  const escTxt = (s) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
  // Endet das Date nach Mitternacht, liegt das Ende am Folgetag.
  let endDate = plan.date;
  if (plan.end < plan.start) {
    const d = parseISO(plan.date);
    d.setDate(d.getDate() + 1);
    endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const desc = plan.steps
    .map((s) => `${s.time} ${s.title}${s.links[0] ? ' – ' + s.links[0].href : ''}`)
    .join('\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dately//DE',
    'BEGIN:VEVENT',
    `UID:${plan.id || plan.ideaId}-${plan.date}@dately`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dt(plan.date, plan.start)}`,
    `DTEND:${dt(endDate, plan.end)}`,
    `SUMMARY:${escTxt(`${plan.emoji} Date: ${plan.title}`)}`,
    `DESCRIPTION:${escTxt(desc)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT3H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escTxt('Gleich ist Date-Zeit!')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Ist ein Date „fällig“? (Rhythmus-Erinnerung) */
export function rhythmStatus(dates, perMonth) {
  const now = today();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = dates.filter((d) => d.date.startsWith(ym)).length;
  const hasUpcoming = dates.some((d) => parseISO(d.date) >= now);
  const past = dates.filter((d) => parseISO(d.date) < now).map((d) => parseISO(d.date));
  const last = past.length ? new Date(Math.max(...past)) : null;
  const interval = Math.floor(30 / Math.max(1, perMonth));
  const sinceLast = last ? daysBetween(last, now) : null;
  const due = thisMonth < perMonth && !hasUpcoming && (sinceLast === null || sinceLast >= interval);
  return { thisMonth, goal: perMonth, due, sinceLast };
}
