// Jahrestag, Valentinstag, Geburtstage & Co.

import { daysBetween, isoDate, nextOccurrence, today } from './util.js';

/** Alle jährlichen besonderen Tage als { name, icon, mmdd, year? }. */
export function specialDefs(settings) {
  const list = [];
  if (settings.anniversary) {
    list.push({ name: 'Jahrestag', icon: '💍', mmdd: settings.anniversary.slice(5), year: Number(settings.anniversary.slice(0, 4)), kind: 'jahrestag' });
  }
  if (settings.valentine) list.push({ name: 'Valentinstag', icon: '💘', mmdd: '02-14', kind: 'valentin' });
  for (const s of settings.specialDays) {
    if (!s.date) continue;
    const person = s.who === 'a' ? settings.nameA : s.who === 'b' ? settings.nameB : s.name;
    const names = { geburtstag: `Geburtstag ${person || ''}`.trim(), standesamt: 'Hochzeitstag (Standesamt)', hochzeit: 'Hochzeitstag' };
    list.push({
      name: names[s.kind] ?? s.name,
      icon: s.kind === 'geburtstag' ? '🎂' : s.kind === 'standesamt' || s.kind === 'hochzeit' ? '💍' : '⭐',
      mmdd: s.date.slice(5),
      year: Number(s.date.slice(0, 4)) || null,
      kind: s.kind,
    });
  }
  return list;
}

function label(def, date) {
  if (def.kind === 'jahrestag' && def.year) {
    const n = date.getFullYear() - def.year;
    if (n > 0) return `${n}. Jahrestag`;
  }
  if ((def.kind === 'standesamt' || def.kind === 'hochzeit') && def.year) {
    const n = date.getFullYear() - def.year;
    if (n > 0) return `${n}. Hochzeitstag${def.kind === 'standesamt' ? ' (Standesamt)' : ''}`;
  }
  return def.name;
}

/** Anstehende besondere Tage innerhalb von `within` Tagen, sortiert. */
export function upcomingSpecials(settings, within = 21) {
  const now = today();
  return specialDefs(settings)
    .map((def) => {
      const date = nextOccurrence(def.mmdd, now);
      return { ...def, label: label(def, date), iso: isoDate(date), days: daysBetween(now, date) };
    })
    .filter((x) => x.days <= within)
    .sort((a, b) => a.days - b.days);
}

/** Besondere Tage an einem bestimmten Datum. */
export function specialsOn(settings, date) {
  const mmdd = isoDate(date).slice(5);
  return specialDefs(settings)
    .filter((d) => d.mmdd === mmdd)
    .map((d) => ({ ...d, label: label(d, date) }));
}

/** Liegt das Datum nahe an einem besonderen Tag (±2 Tage)? */
export function nearSpecial(settings, date) {
  for (let off = -2; off <= 2; off++) {
    const d = new Date(date);
    d.setDate(d.getDate() + off);
    const hit = specialsOn(settings, d)[0];
    if (hit) return hit;
  }
  return null;
}
