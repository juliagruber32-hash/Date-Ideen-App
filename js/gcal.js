// Google Kalender: Termine lesen (um zu sehen, wann ihr schon etwas vorhabt) und Dates eintragen.
// Braucht eine OAuth-Client-ID aus der Google Cloud Console (siehe README).
// Ohne Client-ID funktioniert trotzdem der „Zu Google Kalender“-Link und die .ics-Datei.

const GIS = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TOKEN_KEY = 'date-ideen.gcal.token';

let token = null;
try {
  const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
  if (t && t.exp > Date.now() + 60000) token = t;
} catch {
  /* ignorieren */
}

export const isConnected = () => !!token && token.exp > Date.now() + 30000;
export const expiresAt = () => (token ? new Date(token.exp) : null);
export function disconnect() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignorieren */
  }
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google-Anmeldung kann hier nicht geladen werden.'));
    document.head.append(s);
  });
}

/** Muss direkt aus einem Tipp heraus aufgerufen werden (öffnet das Google-Fenster). */
export async function connect(clientId) {
  if (!clientId) throw new Error('Es ist noch keine Google-Client-ID eingetragen.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error === 'access_denied' ? 'Zugriff abgelehnt.' : `Google: ${resp.error}`));
        token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        try {
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        } catch {
          /* ignorieren */
        }
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Fenster geschlossen.' : 'Google-Anmeldung fehlgeschlagen.')),
    });
    client.requestAccessToken();
  });
}

async function call(url, opts = {}) {
  if (!isConnected()) throw new Error('Google Kalender ist nicht verbunden.');
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  if (res.status === 401) {
    disconnect();
    throw new Error('Google-Verbindung abgelaufen. Bitte neu verbinden.');
  }
  if (!res.ok) throw new Error(`Google Kalender: Fehler ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Termine zwischen zwei Daten (inklusive), vereinfacht für die Anzeige. */
export async function listEvents(fromIso, toIso) {
  const params = new URLSearchParams({
    timeMin: new Date(`${fromIso}T00:00:00`).toISOString(),
    timeMax: new Date(`${toIso}T23:59:59`).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const json = await call(`${API}?${params}`);
  return (json.items ?? [])
    .filter((e) => e.status !== 'cancelled' && e.transparency !== 'transparent')
    .map((e) => {
      if (e.start?.date) return { id: e.id, title: e.summary ?? 'Termin', date: e.start.date, start: '', end: '', allDay: true };
      const s = new Date(e.start.dateTime);
      const en = new Date(e.end.dateTime);
      return { id: e.id, title: e.summary ?? 'Termin', date: localIso(s), start: localTime(s), end: localTime(en), allDay: false };
    });
}

/** Ein Date als Termin eintragen. Gibt die Termin-ID zurück. */
export async function createEvent({ title, description = '', location = '', date, start, end }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let endDate = date;
  if (end <= start) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 1);
    endDate = localIso(d);
  }
  const body = {
    summary: title,
    description,
    location,
    start: { dateTime: `${date}T${start}:00`, timeZone: tz },
    end: { dateTime: `${endDate}T${end}:00`, timeZone: tz },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 180 }] },
  };
  const json = await call(API, { method: 'POST', body: JSON.stringify(body) });
  return json.id;
}

/** Link, der Google Kalender mit vorausgefülltem Termin öffnet – funktioniert ohne Einrichtung. */
export function templateLink({ title, description = '', location = '', date, start, end }) {
  const f = (d, t) => `${d.replaceAll('-', '')}T${t.replace(':', '')}00`;
  let endDate = date;
  if (end <= start) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 1);
    endDate = localIso(d);
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(date, start)}/${f(endDate, end)}`, details: description, location });
  return `https://calendar.google.com/calendar/render?${p}`;
}
