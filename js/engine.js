// Vorschlags-Logik: Ideen filtern, bewerten, auswählen und zu einem Plan mit Uhrzeiten machen.

import { addMinutes, daysBetween, parseISO, today } from './util.js';

let ideasCache = null;

export async function loadIdeas() {
  if (!ideasCache) {
    const res = await fetch('data/ideas.json');
    ideasCache = await res.json();
  }
  return ideasCache;
}

export const ideaDuration = (idea) => idea.steps.reduce((sum, s) => sum + s.min, 0);

export const REACH = ['Zuhause', 'In der Stadt', 'Ausflug'];

/** Passt die Idee grundsätzlich zu den Eingaben? */
function fits(idea, ctx, weather) {
  if (idea.cost > ctx.budget) return false;
  if (idea.reach > ctx.reach) return false;
  if (!idea.times.includes(ctx.daytime)) return false;
  if (weather?.known) {
    if (weather.wet && idea.place === 'draußen') return false; // bei Regen nur drinnen
    if (idea.needsClear && !weather.clear) return false;
  }
  return true;
}

function score(idea, ctx, weather, recent) {
  let s = Math.random();
  if (ctx.special) s += idea.special ? 1.5 : 0;
  else if (idea.special) s -= 0.6; // Besonderes für besondere Tage aufheben
  if (idea.reach === ctx.reach) s += 0.4; // gewählte Entfernung bevorzugen
  if (weather?.known && idea.place === 'draußen') {
    if (weather.cold) s -= 0.7;
    else if (weather.clear && weather.temp >= 15) s += 0.6;
  }
  if (ctx.budget > 0) s += 0.3 * (idea.cost / ctx.budget); // Budget sinnvoll nutzen
  if (recent.has(idea.id)) s -= 1.2; // Wiederholungen vermeiden
  return s;
}

/**
 * Bis zu `count` Vorschläge. `exclude` sind bereits gezeigte Ideen (für „Andere Ideen“).
 * Gibt { ideas, exhausted } zurück; exhausted = alle passenden schon gezeigt.
 */
export async function suggest(ctx, weather, { exclude = new Set(), recentIds = [], count = 3 } = {}) {
  const all = await loadIdeas();
  const recent = new Set(recentIds);
  const pool = all.filter((i) => fits(i, ctx, weather));
  let fresh = pool.filter((i) => !exclude.has(i.id));
  const exhausted = fresh.length === 0 && pool.length > 0;
  if (exhausted) fresh = pool;
  const ideas = fresh
    .map((i) => ({ i, s: score(i, ctx, weather, recent) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.i);
  return { ideas, exhausted, poolSize: pool.length };
}

/** Wann geht’s los? */
export function defaultStart(idea, daytime) {
  return idea.start?.[daytime] ?? (daytime === 'abend' ? '18:30' : '14:00');
}

const mapsSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/** Links für eine Station (Ortssuche und/oder Webseite). */
export function stepLinks(step, idea, { city, vegan }) {
  const links = [];
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
    t = addMinutes(t, s.min);
    return step;
  });
  return {
    ideaId: idea.id,
    title: idea.title,
    emoji: idea.emoji,
    teaser: idea.teaser,
    place: idea.place,
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
    'PRODID:-//Date-Ideen-App//DE',
    'BEGIN:VEVENT',
    `UID:${plan.id || plan.ideaId}-${plan.date}@date-ideen-app`,
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
