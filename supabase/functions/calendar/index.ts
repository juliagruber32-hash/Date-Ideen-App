// @ts-nocheck – bewusst ohne Typen, damit die Funktion auch im Supabase-Editor ohne Zusatzschritte läuft
// Datewell – Server-Funktion „calendar“: eure Dates als Kalender-Abo (iCal/webcal).
//
// Apple Kalender (iPhone, Mac) und Google Kalender können diese Adresse abonnieren und aktualisieren
// eure Dates dann automatisch. Jede Person hat einen eigenen, geheimen Link:
// - Überraschungen, die du planst, siehst du vollständig.
// - Überraschungen für dich erscheinen nur als „Überraschung von …“ mit Uhrzeit und Hinweis.
// Der Link lässt sich in der App jederzeit erneuern; der alte funktioniert dann nicht mehr.

const env = (k, d = '') => (globalThis.Deno?.env.get(k) ?? d);
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const TZ = 'Europe/Berlin';

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`DB ${res.status}`);
  return res.json();
}
const q = encodeURIComponent;

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
const fold = (line) => {
  // Zeilen nach RFC 5545 höchstens 75 Zeichen lang
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};
const stamp = (iso, hhmm) => `${iso.replaceAll('-', '')}T${(hhmm || '19:00').replace(':', '')}00`;
const nextDay = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Kalender-Text aus den Dates bauen (exportiert für Tests). */
export function buildICS({ dates, secrets = {}, role, names = {} }) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Datewell//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Datewell – unsere Dates', `X-WR-TIMEZONE:${TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE', `TZID:${TZ}`,
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:MESZ', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:MEZ', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const d of dates) {
    if (!d?.date || !d.id) continue;
    const hidden = d.surprise && d.plannedBy !== role;
    const plan = d.surprise && !hidden ? { ...(secrets[d.id] ?? {}), ...d } : d;
    const title = hidden
      ? `🎁 Überraschung von ${names[d.plannedBy] ?? 'deinem Schatz'}`
      : `${d.surprise ? '🎁 ' : ''}Date: ${plan.title ?? secrets[d.id]?.title ?? 'Date'}`;
    const stops = hidden ? [] : (plan.steps ?? []).filter((s) => s.place?.name);
    const place = stops[0]?.place;
    const desc = hidden
      ? [d.hint ? `Hinweis: ${d.hint}` : 'Mehr wird nicht verraten.'].join('\n')
      : (plan.steps ?? []).map((s) => `${s.time ?? ''} ${s.title ?? s.t ?? ''}`.trim()).filter(Boolean).join('\n');
    const end = d.end && d.end > d.start ? d.date : nextDay(d.date);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@datewell`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${TZ}:${stamp(d.date, d.start)}`,
      `DTEND;TZID=${TZ}:${stamp(d.end ? end : d.date, d.end || d.start)}`,
      fold(`SUMMARY:${esc(title)}`),
      ...(desc ? [fold(`DESCRIPTION:${esc(desc)}`)] : []),
      ...(place ? [fold(`LOCATION:${esc([place.name, place.street, place.city].filter(Boolean).join(', '))}`)] : []),
      'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', 'DESCRIPTION:It’s date o’clock.', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export async function handle(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return new Response('Nicht gefunden', { status: 404 });
  const hit = (await rest(`docs?path=like.data/users/*/calendar-feed&data->>token=eq.${q(token)}&select=couple_id,owner,path&limit=1`))[0];
  if (!hit) return new Response('Dieser Kalender-Link ist nicht mehr gültig.', { status: 404 });
  const uid = hit.owner ?? hit.path.split('/')[2];
  const coupleId = hit.couple_id;
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const [rows, secretRows] = await Promise.all([
    rest(`docs?couple_id=eq.${q(coupleId)}&or=(path.eq.shared/settings,path.like.dates/*)&select=path,data`),
    rest(`docs?couple_id=eq.${q(coupleId)}&path=like.${q(`data/users/${uid}/`)}*&select=path,data`),
  ]);
  const settings = rows.find((r) => r.path === 'shared/settings')?.data ?? {};
  const members = settings.members ?? {};
  const role = members.a === uid ? 'a' : members.b === uid ? 'b' : null;
  const dates = rows.filter((r) => r.path.startsWith('dates/')).map((r) => r.data).filter((d) => d?.date >= since);
  const secrets = Object.fromEntries(secretRows.map((r) => [r.path.split('/').pop(), r.data]));
  const body = buildICS({ dates, secrets, role, names: { a: settings.nameA, b: settings.nameB, both: 'euch beiden' } });
  return new Response(body, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="datewell.ics"', 'Cache-Control': 'private, max-age=900' },
  });
}

if (globalThis.Deno?.serve) Deno.serve((req) => handle(req).catch(() => new Response('Kalender gerade nicht verfügbar', { status: 503 })));
