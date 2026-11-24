// @ts-nocheck – bewusst ohne Typen, damit die Funktion auch im Supabase-Editor ohne Zusatzschritte läuft
// Datewell – Server-Funktion „notify“ (Supabase Edge Function): Mitteilungen aufs Handy (Web Push).
//
// - Erinnerungen: am Vorabend (ab 18 Uhr) und 2 Stunden vor dem Date, „Wie war’s?“ am Tag danach
// - Sofort: neues Date bzw. Überraschung, Date-Wunsch, Date-Match gestartet, neues Match
// - Überraschungen bleiben geheim: die andere Person erfährt nur Tag, Uhrzeit und den Hinweis
//
// Wird alle 10 Minuten von pg_cron aufgerufen (siehe supabase/notify.sql) und zusätzlich direkt von der App,
// wenn sich etwas ändert. Die Schlüssel für Web Push erzeugt die Funktion beim ersten Aufruf selbst.

import webpush from 'npm:web-push@3.6.7';

const env = (k, d = '') => (globalThis.Deno?.env.get(k) ?? d);
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = env('APP_URL', 'https://juliagruber32-hash.github.io/Date-Ideen-App/');
const TZ = 'Europe/Berlin';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ------------------------------------------------------------ Datenbank (REST mit Service-Schlüssel) */

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`DB ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const q = encodeURIComponent;

async function secret(name) {
  const rows = await rest(`app_secrets?name=eq.${q(name)}&select=value`);
  return rows?.[0]?.value ?? null;
}

/** VAPID-Schlüssel (einmalig erzeugt und in app_secrets gespeichert). */
async function vapid() {
  let pub = await secret('vapid_public');
  let priv = await secret('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await rest('app_secrets', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify([{ name: 'vapid_public', value: k.publicKey }, { name: 'vapid_private', value: k.privateKey }]) });
    pub = (await secret('vapid_public')) ?? k.publicKey;
    priv = (await secret('vapid_private')) ?? k.privateKey;
  }
  webpush.setVapidDetails(APP_URL.replace(/\/[^/]*$/, '') || 'https://example.com', pub, priv);
  return pub;
}

async function userFromToken(req) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  return res.ok ? (await res.json()).id : null;
}

async function coupleOf(userId) {
  const rows = await rest(`members?user_id=eq.${q(userId)}&select=couple_id`);
  return rows?.[0]?.couple_id ?? null;
}

/* ------------------------------------------------------------ Zeit (deutsche Ortszeit) */

function berlinNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}
const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'long', timeZone: 'UTC' });

/* ------------------------------------------------------------ Mitteilungen bestimmen */

/**
 * Welche Mitteilungen sind für dieses Paar jetzt fällig?
 * Gibt [{ key, role, title, body, url }] zurück (role = 'a' | 'b').
 */
export function dueNotifications({ docs, now, secrets = {}, wx = {} }) {
  const settings = docs['shared/settings'] ?? {};
  const name = (r) => (r === 'a' ? settings.nameA : settings.nameB) || (r === 'a' ? 'Person 1' : 'Person 2');
  const other = (r) => (r === 'a' ? 'b' : 'a');
  const out = [];
  const push = (key, role, title, body, url = '') => out.push({ key, role, title, body, url });
  const list = (prefix) => Object.entries(docs).filter(([p]) => p.startsWith(prefix)).map(([, v]) => v).filter(Boolean);
  const nowMin = minutes(now.time);
  const tomorrow = addDaysIso(now.date, 1);
  const yesterday = addDaysIso(now.date, -1);
  const recent = (ms) => typeof ms === 'number' && Date.now() - ms < 6 * 3600 * 1000;

  for (const d of list('dates/')) {
    if (!d.id || !d.date) continue;
    const planner = d.plannedBy === 'a' || d.plannedBy === 'b' ? d.plannedBy : null;
    const title = d.surprise ? secrets[d.id]?.title ?? 'Eure Überraschung' : d.title ?? 'Euer Date';
    const forRole = (r) => (d.surprise && planner && r !== planner ? `Überraschung von ${name(planner)}` : title);
    const hint = d.surprise && d.hint ? ` Hinweis: „${d.hint}“` : '';

    // Neu eingetragen → die andere Person erfährt es sofort
    if (planner && recent(d.createdAt)) {
      const r = other(planner);
      push(`new:${d.id}`, r, d.surprise ? `${name(planner)} hat eine Überraschung für dich geplant 🤫` : `${name(planner)} hat ein Date eingetragen`,
        `${weekday(d.date)}, ${d.start} Uhr${d.surprise ? '.' + hint : ` · ${title}`}`, `#date/${d.id}`);
    }
    // Vorabend-Erinnerung ab 18 Uhr
    if (d.date === tomorrow && nowMin >= 18 * 60) {
      for (const r of ['a', 'b']) {
        const mine = !d.surprise || r === planner;
        push(`eve:${d.id}:${r}`, r, 'It’s almost date o’clock', mine ? `Morgen um ${d.start}: ${title}${d.emoji ? ` ${d.emoji}` : ''}` : `Morgen um ${d.start}: Überraschung von ${name(planner)} 🤫${hint}`, `#date/${d.id}`);
      }
    }
    // Wetterwechsel: Regen bei einem Date draußen → Plan B vorschlagen (nur wer den Plan kennt)
    const w = wx[d.id];
    if (w && d.place === 'draußen' && (d.date === now.date || d.date === tomorrow) && w.rain >= 60) {
      for (const r of ['a', 'b']) {
        if (d.surprise && r !== planner) continue;
        push(`rain:${d.id}:${r}`, r, 'It’s date o’clock – mit Planänderung 🌧️', 'Es soll regnen. Wie wär’s mit Plan B: Kino um die Ecke?', `#date/${d.id}`);
      }
    }
    // 2 Stunden vorher
    if (d.date === now.date && d.start) {
      const diff = minutes(d.start) - nowMin;
      if (diff <= 120 && diff > 0) {
        const h = Math.max(1, Math.round(diff / 60));
        const lead = h === 1 ? 'In einer Stunde geht’s los.' : `In ${h} Stunden geht’s los.`;
        const outside = d.place === 'draußen';
        const tip = !w ? '' : w.rain >= 50 ? `${w.temp} °C und Regen – Schirm nicht vergessen.` : w.temp <= 5 ? `${w.temp} °C – zieht euch warm an.` : outside && w.temp >= 15 ? `${w.temp} °C, perfekt für draußen.` : `${w.temp} °C.`;
        const sym = !w ? '✨' : w.rain >= 50 ? '🌧️' : w.temp <= 2 ? '❄️' : w.clear ? '☀️' : '✨';
        for (const r of ['a', 'b']) push(`soon:${d.id}:${r}`, r, `It’s date o’clock ${sym}`, `${lead} ${tip}${d.surprise && r !== planner ? hint : ''}`.trim(), `#date/${d.id}`);
      }
    }
    // Am Tag danach: bewerten
    if (d.date === yesterday && nowMin >= 10 * 60) {
      for (const r of ['a', 'b']) {
        if (d.ratings?.[r]) continue;
        push(`rate:${d.id}:${r}`, r, `Wie war „${d.surprise && r !== planner ? `die Überraschung` : title}“?`, 'Bewertet euer Date – so lernt Datewell, was euch gefällt.', `#date/${d.id}`);
      }
    }
  }

  // Lange kein Date mehr (ab 3 Wochen, höchstens einmal pro Woche, abends)
  const all = list('dates/').filter((x) => x.date);
  const past = all.filter((x) => x.date < now.date).map((x) => x.date).sort();
  const upcoming = all.some((x) => x.date >= now.date);
  const busy = list('requests/').some((x) => x.status === 'open') || list('polls/').some((x) => x.status === 'open');
  if (past.length && !upcoming && !busy && nowMin >= 18 * 60) {
    const days = Math.round((new Date(`${now.date}T12:00:00Z`) - new Date(`${past[past.length - 1]}T12:00:00Z`)) / 86400000);
    if (days >= 21) {
      const weeks = Math.floor(days / 7);
      for (const r of ['a', 'b']) push(`idle:${weeks}:${r}`, r, 'Ist es nicht mal wieder date o’clock?', `Euer letztes Date ist ${weeks} Wochen her. Wir hätten da eine Idee …`, '#entdecken');
    }
  }

  for (const r of list('requests/')) {
    if (r.status !== 'open' || !recent(r.createdAt) || !r.to) continue;
    push(`req:${r.id}`, r.to, `${name(r.from)} wünscht sich ein Date von dir 💌`, r.note ? `„${r.note}“` : 'Schau in Datewell, was du planen kannst.', '#start');
  }

  for (const p of list('polls/')) {
    if (p.kind !== 'swipe' || p.status !== 'open') continue;
    if (recent(p.createdAt) && p.createdBy) push(`swipe:${p.id}`, other(p.createdBy), `${name(p.createdBy)} hat ein Date-Match gestartet`, 'Wisch mit – Datewell findet, worauf ihr beide Lust habt.', `#match/${p.id}`);
    const v = p.votes ?? {};
    for (const id of p.deck ?? []) {
      if (v.a?.[id] === 1 && v.b?.[id] === 1) {
        const t = p.titles?.[id] ?? p.snap?.[id]?.title ?? 'ein Date';
        for (const r of ['a', 'b']) push(`match:${p.id}:${id}:${r}`, r, 'Ihr habt ein Match ❤️', `Ihr habt beide Lust auf „${t}“. Jetzt planen?`, `#match/${p.id}`);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ Wetter (Open-Meteo) */

async function weatherAt(lat, lon, date, start = '18:00', end = '22:00') {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Europe%2FBerlin&start_date=${date}&end_date=${date}`);
  if (!res.ok) return null;
  const h = (await res.json()).hourly ?? {};
  const from = Number(String(start).slice(0, 2));
  const to = Math.max(from, Number(String(end || start).slice(0, 2)));
  const idx = (h.time ?? []).map((t, i) => [Number(t.slice(11, 13)), i]).filter(([hr]) => hr >= from && hr <= to).map(([, i]) => i);
  if (!idx.length) return null;
  const temp = Math.round(idx.reduce((a, i) => a + h.temperature_2m[i], 0) / idx.length);
  const rain = Math.max(...idx.map((i) => h.precipitation_probability?.[i] ?? 0));
  const code = h.weather_code?.[idx[0]] ?? 3;
  return { temp, rain, clear: code <= 2 };
}

/* ------------------------------------------------------------ Versand */

async function processCouple(coupleId) {
  const subs = await rest(`push_subscriptions?couple_id=eq.${q(coupleId)}&select=endpoint,sub,role,user_id`);
  if (!subs?.length) return 0;
  const rows = await rest(`docs?couple_id=eq.${q(coupleId)}&or=(path.eq.shared/settings,path.like.dates/*,path.like.requests/*,path.like.polls/*)&select=path,data`);
  const docs = Object.fromEntries(rows.map((r) => [r.path, r.data]));
  // Titel von Überraschungen (nur für die planende Person)
  const secretRows = await rest(`docs?couple_id=eq.${q(coupleId)}&path=like.data/users/*&select=path,data`);
  const secrets = Object.fromEntries(secretRows.map((r) => [r.path.split('/').pop(), r.data]));
  const members = docs['shared/settings']?.members ?? {};
  const roleOf = (s) => s.role ?? (members.a === s.user_id ? 'a' : members.b === s.user_id ? 'b' : null);

  // Wetter für Dates heute/morgen (für „It’s date o’clock ☀️“ und Plan B bei Regen)
  const now = berlinNow();
  const wx = {};
  const geo = docs['shared/settings']?.geo;
  for (const [path, d] of Object.entries(docs)) {
    if (!path.startsWith('dates/') || !d?.date || (d.date !== now.date && d.date !== addDaysIso(now.date, 1))) continue;
    const plan = d.surprise ? secrets[d.id] : d;
    const pl = plan?.steps?.find((x) => x.place?.lat != null)?.place ?? geo;
    if (pl?.lat == null) continue;
    wx[d.id] = await weatherAt(pl.lat, pl.lon, d.date, d.start, d.end).catch(() => null);
    if (d.surprise && secrets[d.id]?.place) d.place = secrets[d.id].place;
  }
  const due = dueNotifications({ docs, now, secrets, wx });
  if (!due.length) return 0;
  const keys = due.map((n) => `${coupleId}:${n.key}`);
  const sentRows = await rest(`push_log?key=in.(${keys.map((k) => `"${k.replace(/"/g, '')}"`).join(',')})&select=key`);
  const sent = new Set(sentRows.map((r) => r.key));
  let count = 0;
  for (const n of due) {
    const key = `${coupleId}:${n.key}`;
    if (sent.has(key)) continue;
    // Erst vermerken (verhindert doppelte Mitteilungen bei gleichzeitigen Aufrufen)
    try {
      await rest('push_log', { method: 'POST', body: JSON.stringify({ key }) });
    } catch {
      continue; // schon von einem anderen Aufruf verschickt
    }
    for (const s of subs.filter((x) => roleOf(x) === n.role)) {
      try {
        await webpush.sendNotification(s.sub, JSON.stringify({ title: n.title, body: n.body, url: `${APP_URL}${n.url}`, tag: n.key.split(':').slice(0, 2).join(':') }), { TTL: 6 * 3600 });
        count++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await rest(`push_subscriptions?endpoint=eq.${q(s.endpoint)}`, { method: 'DELETE' }).catch(() => null);
      }
    }
  }
  return count;
}

/* ------------------------------------------------------------ Anfragen */

export async function handle(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  let body = {};
  try {
    body = await req.json();
  } catch {
    /* leer */
  }
  try {
    // Zeitgesteuerter Aufruf (pg_cron) – mit eigenem Geheimnis statt Anmeldung
    if (body.action === 'cron') {
      const cronSecret = await secret('cron');
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Nicht erlaubt' }, 401);
      await vapid();
      const couples = await rest('push_subscriptions?select=couple_id');
      let sent = 0;
      for (const c of [...new Set(couples.map((x) => x.couple_id))]) sent += await processCouple(c).catch(() => 0);
      return json({ ok: true, sent });
    }

    const userId = await userFromToken(req);
    if (!userId) return json({ error: 'Bitte in Datewell anmelden' }, 401);
    const coupleId = await coupleOf(userId);
    if (!coupleId) return json({ error: 'Kein gemeinsames Konto' }, 400);

    switch (body.action) {
      case 'vapid':
        return json({ publicKey: await vapid() });
      case 'subscribe': {
        const sub = body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh) return json({ error: 'Ungültiges Abo' }, 400);
        await rest('push_subscriptions', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ endpoint: sub.endpoint, sub, user_id: userId, couple_id: coupleId, role: body.role === 'a' || body.role === 'b' ? body.role : null, updated_at: new Date().toISOString() }),
        });
        return json({ ok: true });
      }
      case 'unsubscribe':
        if (body.endpoint) await rest(`push_subscriptions?endpoint=eq.${q(body.endpoint)}&user_id=eq.${q(userId)}`, { method: 'DELETE' });
        return json({ ok: true });
      case 'test': {
        await vapid();
        const subs = await rest(`push_subscriptions?user_id=eq.${q(userId)}&select=sub`);
        for (const s of subs) await webpush.sendNotification(s.sub, JSON.stringify({ title: 'Datewell', body: 'Mitteilungen sind eingerichtet ✨', url: APP_URL, tag: 'test' })).catch(() => null);
        return json({ ok: true, devices: subs.length });
      }
      case 'nudge': {
        // Nach einer Änderung in der App sofort prüfen (z. B. neue Überraschung, neues Match)
        await vapid();
        return json({ ok: true, sent: await processCouple(coupleId) });
      }
      default:
        return json({ error: 'Unbekannte Aktion' }, 400);
    }
  } catch (e) {
    return json({ error: e.message ?? String(e) }, 500);
  }
}

if (globalThis.Deno?.serve) Deno.serve(handle);
