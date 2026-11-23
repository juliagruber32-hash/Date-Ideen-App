import * as store from './store.js';
import { isHiddenFromMe, myRole, nameOf, other } from './store.js';
import { geocode, getWeather, manualWeather } from './weather.js';
import { setAvailability } from './engine.js';
import { allIdeas, buildPlan, combineWishes, setPreferences, defaultStart, ideaDuration, loadIdeas, MOODS, moodLabel, REACH, recommend, rhythmStatus, setExtraIdeas, suggest, toICS } from './engine.js';
import { searchNotable } from './places.js';
import { appleMapsLink, CATEGORIES, CUISINES, catForStep, isXmasSeason, categoryById, directionsLink, distanceKm, fmtKm, fmtMin, formatHours, hoursOn, isOpenAt, locate, mapLink, placeName, reservationLinks, searchByName, searchMixed, searchNearby, travelEstimates } from './places.js';
import { googleDetails, googleSearch, googleViaServer, setGoogleProxy } from './gplaces.js';
import { setPlacesProxy } from './places.js';
import { generateLocalDates, travelLine } from './generate.js';
import { eventWhen, fetchEvents, ideaFromEvent } from './events.js';
import { findImage, topicFor } from './images.js';
import { areaProgress, ensureArea, getArea, onAreaChange } from './area.js';
import * as photos from './photos.js';
import { SUPABASE } from './config.js';
import * as gcal from './gcal.js';
import { callPlaces, connectSupabase, currentSession, deleteAccount, getConfig, getRemember, lastEmail, setRemember, inviteLink, onAuthChange, readInvite, resetPassword, saveConfig, signIn, signOut, signUp, updatePassword } from './remote.js';
import { nearSpecial, specialsOn, upcomingSpecials } from './special.js';
import { glyph, icon } from './icons.js';
import {
  $, $$, addDays, addMinutes, daysBetween, esc, fmtDate, fmtDuration, fmtEuro, fmtShort, isoDate, MONTHS,
  parseISO, relDay, toast, today, uid, WD_SHORT, WEEKDAYS,
} from './util.js';

const S = () => store.get();
const L = () => store.getLocal();
const root = $('#view');
const tempIdeas = new Map(); // Ideen aus der Ortssuche, die noch nicht gespeichert sind
const ideaById = (id) => tempIdeas.get(id) ?? allIdeas().find((i) => i.id === id);
let remoteError = null;
// Konto-Zustand (nur mit Supabase): needed = Anmeldung erforderlich
const auth = { cfg: null, user: null, needed: false, mode: null, info: '', error: '' };

// Sitzungszustand des aktuellen Planungsablaufs (wird nicht gespeichert).
const session = { ctx: null, weather: null, shown: new Set(), current: [], exhausted: false, requestId: null, pollId: null };
const drafts = {}; // ungespeicherte Eingaben auf dem Plan-Bildschirm, pro Idee

/* ================================================================ Navigation */

const TAB_OF = { start: 'start', suggest: 'start', plan: 'start', poll: 'start', entdecken: 'entdecken', idee: 'entdecken', ort: 'entdecken', teilen: 'entdecken', kosten: 'dates', rueckblick: 'dates', kalender: 'kalender', listen: 'listen', dates: 'dates', date: 'dates', mehr: 'mehr' };
const RENDER = {};
let current = { name: 'start', param: null };

function go(name, param = null) {
  if (auth.needed && name !== 'konto') name = 'konto';
  current = { name, param };
  render(true);
}

function render(scrollTop = false) {
  if (auth.needed && current.name !== 'konto') current = { name: 'konto', param: null };
  document.body.classList.toggle('auth-screen', current.name === 'konto');
  formDirty = false;
  pendingRender = false;
  setPreferences(S().settings.prefs);
  setAvailability(ideaAvailable);
  setExtraIdeas([...S().ideas, ...S().favorites.filter((f) => f.idea).map((f) => ({ ...f.idea, id: f.ideaId }))]);
  $$('.tabbar button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === TAB_OF[current.name]));
  if (!scrollTop) {
    root.classList.remove('enter');
    clearTimeout(enterTimer);
  }
  (RENDER[current.name] ?? RENDER.start)(current.param);
  hydrateMedia();
  if (scrollTop) {
    window.scrollTo(0, 0);
    // Sanftes Einblenden nur beim Bildschirmwechsel, nicht bei Live-Aktualisierungen
    root.classList.remove('enter');
    void root.offsetWidth;
    root.classList.add('enter');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => root.classList.remove('enter'), 700);
  }
}

$$('.tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

// Änderungen der anderen Person live übernehmen, aber nicht mitten im Tippen neu zeichnen.
let pendingRender = false;
let enterTimer;
let formDirty = false; // ungespeicherte Eingaben im aktuellen Formular
root.addEventListener('input', (e) => e.target.closest('form') && (formDirty = true));
root.addEventListener('change', (e) => e.target.closest('form') && (formDirty = true));
root.addEventListener('click', (e) => e.target.closest('form .chip') && (formDirty = true));
const isTyping = () => {
  const a = document.activeElement;
  if (!a || !root.contains(a)) return false;
  if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
  return a.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(a.type);
};
store.onChange((source) => {
  if (source === 'error' && store.syncInfo().writeError) toast(store.syncInfo().writeError);
  if (source === 'local') return;
  autoClaim();
  cleanDuplicateSurveys();
  autoReveal();
  if (isTyping() || formDirty) pendingRender = true;
  else render();
});
root.addEventListener('focusout', () => {
  if (!pendingRender) return;
  setTimeout(() => {
    if (!isTyping() && !formDirty && pendingRender) {
      pendingRender = false;
      render();
    }
  }, 120);
});

/* ================================================================ Bausteine */

const chips = (group, options, value, cls = '') => `
  <div class="chips ${cls}" role="group" data-group="${group}">
    ${options.map(([v, label, ic]) => `<button type="button" class="chip" data-value="${esc(v)}" aria-pressed="${String(v) === String(value)}">${ic ? icon(ic) : ''}<span>${label}</span></button>`).join('')}
  </div>`;

function bindChips(scope, group, onChange) {
  const wrap = $(`[data-group="${group}"]`, scope);
  wrap?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $$('.chip', wrap).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    onChange(btn.dataset.value);
  });
}

/* --- Umkreis in Kilometern --------------------------------------------------- */

const RADIUS_STEPS = [5, 15, 40, 60, 100];
const kmToReach = (km) => (km === 0 ? 0 : km <= 15 ? 1 : 2);
const reachToKm = (reach) => (reach === 0 ? 0 : reach === 2 ? 60 : 15);

/** Chips: (Zuhause) · 5 · 15 · 40 · 60 · 100 km · Eigener, plus Eingabefeld für den eigenen Wert. */
function radiusChips(group, km, { home = false } = {}) {
  const custom = km > 0 && !RADIUS_STEPS.includes(km);
  const opts = [...(home ? [[0, 'Zuhause', 'home']] : []), ...RADIUS_STEPS.map((k) => [k, `${k} km`]), ['eigen', custom ? `${km} km` : 'Eigener']];
  return `
    ${chips(group, opts, custom ? 'eigen' : km, 'radius-chips')}
    <div class="row gap radius-custom" data-custom-for="${group}" ${custom ? '' : 'hidden'}>
      <input class="input narrow" type="number" min="1" max="200" inputmode="numeric" data-km-input="${group}" value="${custom ? km : ''}" placeholder="z. B. 25" aria-label="Eigener Umkreis in km">
      <span class="muted">km Umkreis</span>
    </div>`;
}

function bindRadius(scope, group, onChange) {
  const box = $(`[data-custom-for="${group}"]`, scope);
  const input = $(`[data-km-input="${group}"]`, scope);
  bindChips(scope, group, (v) => {
    if (v === 'eigen') {
      box.hidden = false;
      input.focus();
      return;
    }
    box.hidden = true;
    onChange(Number(v));
  });
  input?.addEventListener('change', () => {
    const km = Math.max(1, Math.min(200, Math.round(Number(input.value) || 0)));
    if (km) onChange(km);
  });
}

const on = (sel, ev, fn) => $$(sel, root).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));

function topbar({ title, sub = '', back = null, eyebrow = '' }) {
  return `
    <header class="topbar">
      ${back ? `<button class="back" data-back="${esc(back.join('|'))}">${icon('left')}<span>${esc(back[2] ?? 'Zurück')}</span></button>` : ''}
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      ${title ? `<h1>${title}</h1>` : ''}
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </header>`;
}
function bindBack() {
  on('[data-back]', 'click', (_, el) => {
    const [name, param] = el.dataset.back.split('|');
    go(name, param || null);
  });
}

/** Zweistufiges Löschen ohne Browser-Dialog: erster Tipp scharf schalten, zweiter bestätigt. */
function armed(btn, onConfirm, label = 'Nochmal tippen zum Löschen') {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) return onConfirm();
    btn.dataset.armed = '1';
    const old = btn.innerHTML;
    btn.classList.add('armed');
    btn.textContent = label;
    setTimeout(() => {
      delete btn.dataset.armed;
      btn.classList.remove('armed');
      btn.innerHTML = old;
    }, 3500);
  });
}

async function saveFile(filename, data, type) {
  try {
    const dl = await window.claude?.use?.('downloads');
    if (dl) {
      await dl.save({ filename, data });
      return;
    }
  } catch (e) {
    if (e?.code && e.code !== 'unavailable') return; // abgelehnt oder abgebrochen
  }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const daytimeLabel = (d) => (d === 'abend' ? 'abends' : 'tagsüber');
const ctxLine = (c) => `${relDay(c.date) ?? fmtShort(c.date)} · ${daytimeLabel(c.daytime)} · bis ${c.budget} €`;

const weatherGlyph = (w) => (w?.wet ? 'rain' : w?.clear ? 'sun' : 'cloud');

function weatherPill(w) {
  if (!w?.icon) return '';
  return `<span class="pill">${icon(weatherGlyph(w))}${w.temp != null ? `${w.temp}° · ` : ''}${esc(w.label)}</span>`;
}

function resolveDate(ctx) {
  const t = today();
  if (ctx.when === 'tonight') return isoDate(t);
  if (ctx.when === 'weekend') {
    const dow = t.getDay();
    return isoDate(dow === 6 || dow === 0 ? t : addDays(t, 6 - dow));
  }
  return ctx.date && ctx.date >= isoDate(t) ? ctx.date : isoDate(t);
}

/* --- Dates aus Sicht des aktuellen Nutzers ---------------------------------- */

function fullPlan(d) {
  if (!d.surprise) return d;
  const secret = S().secrets[d.id];
  return secret ? { ...secret, ...pickMeta(d) } : null;
}
const pickMeta = (d) => ({ id: d.id, date: d.date, start: d.start, end: d.end, plannedBy: d.plannedBy, surprise: d.surprise, hint: d.hint, ratings: d.ratings ?? {}, createdAt: d.createdAt });

function dateTitle(d) {
  if (isHiddenFromMe(d)) return `Überraschung von ${nameOf(d.plannedBy)}`;
  return fullPlan(d)?.title ?? 'Überraschung';
}
function dateEmoji(d) {
  if (isHiddenFromMe(d)) return '🎁';
  return fullPlan(d)?.emoji ?? '🎁';
}
function plannerLabel(d) {
  if (d.plannedBy === 'both') return 'Zusammen geplant';
  if (d.plannedBy === myRole()) return d.surprise ? 'Deine Überraschung' : 'Von dir geplant';
  return `Geplant von ${nameOf(d.plannedBy)}`;
}

/** Vergangene eigene Überraschungen automatisch auflösen, damit beide den Plan sehen. */
function autoReveal() {
  const sync = store.syncInfo();
  if (sync.mode === 'shared' && !sync.ready) return;
  const role = myRole();
  const t = isoDate(today());
  const due = S().dates.filter((d) => d.surprise && d.plannedBy === role && d.date < t && S().secrets[d.id]);
  if (due.length) due.forEach((d) => reveal(d.id, false));
}

function reveal(id, announce = true) {
  store.update((s) => {
    const d = s.dates.find((x) => x.id === id);
    const secret = s.secrets[id];
    if (!d || !secret) return;
    const { checks, ...plan } = secret;
    Object.assign(d, plan, pickMeta(d), { surprise: false, revealed: true });
    delete s.secrets[id];
  });
  if (announce) toast('Überraschung aufgelöst');
}

/* ================================================================ Wer bin ich? */

function whoAmICard() {
  const role = myRole();
  if (role) return '';
  const st = S().settings;
  const taken = st.members ?? {};
  const shared = store.syncInfo().backend === 'claude';
  return `
    <section class="panel who">
      <div class="panel-head">${icon('user')}<h2>Wer bist du?</h2></div>
      <p class="muted">Damit die App weiß, wer plant und wer überrascht wird.${!st.nameA && !st.nameB ? ' Eure Namen tragt ihr unter „Mehr“ ein.' : ''}</p>
      <div class="row gap">
        ${['a', 'b'].map((r) => `<button class="btn grow" data-claim="${r}" ${shared && taken[r] ? 'disabled' : ''}>${esc(nameOf(r))}${shared && taken[r] ? ' (vergeben)' : ''}</button>`).join('')}
      </div>
    </section>`;
}
function bindWhoAmI() {
  on('[data-claim]', 'click', (_, el) => {
    store.claimRole(el.dataset.claim);
    toast(`Hallo ${nameOf(el.dataset.claim)}!`);
    render();
  });
}

function syncChip() {
  const s = store.syncInfo();
  if (s.mode !== 'shared') return `<span class="sync local">${icon('lock')}Nur dieses Gerät</span>`;
  if (s.stale) return `<span class="sync warn">${icon('cloud')}Verbindung fehlt</span>`;
  return `<span class="sync ok">${icon('users')}Gemeinsam</span>`;
}
const settingsButton = () => `<button class="icon-btn" data-go="mehr" aria-label="Einstellungen">${icon('more')}</button>`;

/* ================================================================ Standort */

function currentPlaceName() {
  const g = L().geo;
  if (g && Date.now() - g.at < 6 * 3600 * 1000 && g.name) return g.name;
  return S().settings.city;
}

async function useGps() {
  const pos = await locate();
  let name = '';
  try {
    name = await placeName(pos.lat, pos.lon);
  } catch {
    /* Name optional */
  }
  L().geo = { lat: pos.lat, lon: pos.lon, name: name || 'Mein Standort', at: Date.now() };
  store.saveLocal();
  return L().geo;
}

/** Standort still aktualisieren, wenn die Erlaubnis schon erteilt ist. */
async function refreshGpsSilently() {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' });
    if (p?.state !== 'granted') return;
    const g = L().geo;
    if (g && Date.now() - g.at < 30 * 60 * 1000) return;
    await useGps();
    if (current.name === 'start' && !isTyping()) render();
  } catch {
    /* kein GPS: Stadt bleibt */
  }
}

/* ================================================================ Kalender-Verbindung */

function partnerBusy(iso) {
  const partner = other(myRole());
  const doc = S().busy.find((b) => b.id === partner);
  return (doc?.items ?? []).filter((x) => x.date === iso);
}

/** Hinweis, wenn an dem Tag schon Termine stehen. */
function conflictsHTML(iso) {
  const mine = L().gcal.events.filter((e) => e.date === iso);
  const own = S().events.filter((e) => e.date === iso);
  const dates = S().dates.filter((d) => d.date === iso);
  const theirs = partnerBusy(iso);
  const lines = [
    ...dates.map((d) => `${d.start} ${esc(dateTitle(d))}`),
    ...mine.map((e) => `${e.allDay ? 'ganztägig' : e.start} ${esc(e.title)}`),
    ...own.map((e) => `${e.time} ${esc(e.title)}`),
    ...theirs.map((b) => `${b.allDay ? 'ganztägig' : `${b.start}–${b.end}`} ${esc(nameOf(other(myRole())))} hat einen Termin`),
  ];
  if (!lines.length) return '';
  return `<div class="conflicts">${icon('calendar')}<div><strong>${relDay(iso) ?? fmtShort(iso)} habt ihr schon:</strong><br>${lines.join('<br>')}</div></div>`;
}

function calendarEvent(plan) {
  const desc = (plan.steps ?? []).map((s) => `${s.time} ${s.title}${s.links?.[0] ? ` – ${s.links[0].href}` : ''}`).join('\n');
  const loc = (plan.steps ?? []).find((s) => s.place)?.place;
  return { title: plan.title.startsWith('Überraschung') ? plan.title : `Date: ${plan.title}`, description: desc, location: loc ? `${loc.name}${loc.street ? ', ' + loc.street : ''}` : '', date: plan.date, start: plan.start, end: plan.end };
}

function calendarButtons() {
  return `
    <div class="cal-actions">
      <button class="btn primary" id="cal-google">${icon('calendar')}${gcal.isConnected() ? 'In Google Kalender eintragen' : 'Zu Google Kalender'}</button>
      <button class="btn" id="cal-ics">${icon('download')}Handy-Kalender (.ics)</button>
    </div>`;
}

function bindCalendarButtons(plan) {
  const evt = calendarEvent(plan);
  $('#cal-google').addEventListener('click', async (e) => {
    if (gcal.isConnected()) {
      await withBusy(e.currentTarget, async () => {
        try {
          await gcal.createEvent(evt);
          toast('In Google Kalender eingetragen');
        } catch (err) {
          toast(err.message);
        }
      });
    } else {
      window.open(gcal.templateLink(evt), '_blank', 'noopener');
    }
  });
  $('#cal-ics').addEventListener('click', () => saveFile(`date-${plan.date}.ics`, toICS(plan), 'text/calendar'));
}

function gcalBar() {
  if (store.inArtifact()) return '';
  const id = S().settings.googleClientId;
  const fetched = L().gcal.fetchedAt;
  if (!id) return `<button class="banner neutral-row" data-go="mehr">${icon('calendar')}<span class="grow"><strong>Google Kalender verbinden</strong><br><small class="muted">Dann seht ihr hier eure Termine.</small></span>${icon('right')}</button>`;
  if (!gcal.isConnected()) return `<div class="banner neutral-row">${icon('calendar')}<span class="grow"><strong>Google Kalender</strong><br><small class="muted">${fetched ? `Stand ${new Date(fetched).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Noch nicht verbunden'}</small></span><button class="btn sm primary" id="gcal-connect">Verbinden</button></div>`;
  return `<div class="banner neutral-row">${icon('check')}<span class="grow"><strong>Google Kalender verbunden</strong><br><small class="muted">${L().gcal.events.length} Termine geladen</small></span><button class="btn sm" id="gcal-refresh">Aktualisieren</button></div>`;
}

function bindGcalBar() {
  on('[data-go]', 'click', (_, el) => go(el.dataset.go));
  $('#gcal-connect')?.addEventListener('click', (e) => withBusy(e.currentTarget, connectGcal));
  $('#gcal-refresh')?.addEventListener('click', (e) => withBusy(e.currentTarget, syncGcal));
}

async function connectGcal() {
  try {
    await gcal.connect(S().settings.googleClientId);
    await syncGcal();
  } catch (e) {
    toast(e.message);
  }
}

/** Eigene Google-Termine laden; belegte Zeiten (ohne Titel) für die andere Person teilen. */
async function syncGcal() {
  try {
    const from = isoDate(addDays(today(), -7));
    const to = isoDate(addDays(today(), 120));
    const events = await gcal.listEvents(from, to);
    L().gcal = { events, fetchedAt: Date.now() };
    store.saveLocal();
    const role = myRole();
    if (role) {
      const items = events.map(({ date, start, end, allDay }) => ({ date, start, end, allDay }));
      store.update((s) => {
        const doc = s.busy.find((b) => b.id === role);
        if (doc) Object.assign(doc, { items, updatedAt: Date.now() });
        else s.busy.push({ id: role, items, updatedAt: Date.now() });
      });
    }
    toast(`${events.length} Termine aus Google geladen`);
    render();
  } catch (e) {
    toast(e.message);
  }
}

/* ================================================================ Einstellungen: Verbindungen */

let connecting = null; // nur ein Verbindungsaufbau gleichzeitig (sonst entstehen doppelte Paare)
function connectRemote(cfg, announce = false) {
  if (!connecting) connecting = doConnectRemote(cfg, announce).finally(() => (connecting = null));
  return connecting;
}

/** Server-Funktion „places“ nutzen, falls sie eingerichtet ist (Orte & Google über Supabase). */
async function enableServerPlaces(cfg) {
  try {
    const st = await callPlaces(cfg, { action: 'status' });
    if (!st?.ok) return;
    setPlacesProxy((body) => callPlaces(cfg, body));
    if (st.google) setGoogleProxy((body) => callPlaces(cfg, body));
    serverStatus = st;
    if (current.name === 'entdecken' || current.name === 'plan') render();
  } catch {
    serverStatus = null; // noch nicht eingerichtet – die App sucht wie bisher selbst
  }
}
let serverStatus = null;
/** Google-Daten verfügbar (eigener Schlüssel oder über den Server)? Liefert den Schlüssel bzw. 'server'. */
const googleKey = () => S().settings.googlePlacesKey || (googleViaServer() ? 'server' : '');

async function doConnectRemote(cfg, announce) {
  remoteError = null;
  auth.cfg = cfg;
  try {
    const { db, uid, user, community: api, photos: photosApi } = await connectSupabase(cfg);
    auth.user = user;
    auth.needed = false;
    store.attach(db, uid, { backend: 'supabase' });
    community.api = api;
    photos.setRemote(photosApi);
    enableServerPlaces(cfg);
    if (announce) toast('Willkommen bei Dately!');
    if (current.name === 'konto') current = { name: 'start', param: null };
  } catch (e) {
    if (e.code === 'auth') {
      auth.needed = true;
      current = { name: 'konto', param: null };
    } else remoteError = e.message;
  }
  render(true);
}

/** Doppelte, noch unbeantwortete Umfragen derselben Art entfernen (ältere Versionen legten sie mehrfach an). */
let surveysCleaned = false;
function cleanDuplicateSurveys() {
  const sync = store.syncInfo();
  if (surveysCleaned || (sync.mode === 'shared' && !sync.ready)) return;
  surveysCleaned = true;
  const open = S().polls.filter((p) => p.status === 'open' && p.stage === 'survey');
  const keep = new Set();
  for (const k of ['full', 'day']) {
    const list = open.filter((p) => (p.kind ?? 'full') === k).sort((a, b) => Object.keys(b.survey ?? {}).length - Object.keys(a.survey ?? {}).length || b.createdAt - a.createdAt);
    if (list[0]) keep.add(list[0].id);
  }
  if (open.some((p) => (p.kind ?? 'full') === 'full')) open.filter((p) => p.kind === 'day').forEach((p) => keep.delete(p.id));
  const drop = open.filter((p) => !keep.has(p.id) && !Object.keys(p.survey ?? {}).length).map((p) => p.id);
  if (drop.length) store.update((st) => (st.polls = st.polls.filter((p) => !drop.includes(p.id))));
}

/** Nach dem ersten Anmelden automatisch „Ich bin“ setzen und den Benutzernamen als Namen übernehmen. */
let autoClaimed = false;
function autoClaim() {
  const sync = store.syncInfo();
  if (autoClaimed || !auth.user || sync.backend !== 'supabase' || !sync.ready || myRole()) return;
  autoClaimed = true;
  const m = S().settings.members ?? {};
  const role = !m.a ? 'a' : !m.b ? 'b' : null;
  if (!role) return;
  store.claimRole(role);
}

function sharingHTML() {
  const sync = store.syncInfo();
  if (sync.backend === 'claude') {
    return `
      <p>${sync.stale ? 'Die Verbindung zum gemeinsamen Speicher fehlt gerade.' : 'Dates, Kalender, Listen und Abstimmungen werden für euch beide gespeichert.'}</p>
      <ol class="steps-list">
        <li>Oben rechts auf <strong>Teilen</strong> tippen.</li>
        <li>Die E-Mail-Adresse der anderen Person eintragen und als <strong>Editor</strong> einladen.</li>
        <li>Die andere Person öffnet den Link und wählt unter „Ich bin“ den eigenen Namen.</li>
      </ol>
      ${!sync.canWrite || sync.writeError ? `<p class="warn-text">${esc(sync.writeError ?? 'Du kannst hier nur lesen.')}</p>` : ''}
      <p class="muted small">Standort, Wetter und Ortssuche funktionieren nur in der Webseiten-Version der App.</p>`;
  }
  const cfg = getConfig();
  if (sync.backend === 'supabase' && cfg?.code) {
    return `
      <p>Verbunden. Alles, was ihr eintragt, seht ihr beide live.</p>
      <div class="field">
        <span class="label">Einladungslink für ${esc(myRole() ? nameOf(other(myRole())) : 'die andere Person')}</span>
        <div class="copy-row"><input class="input" id="invite" readonly value="${esc(inviteLink(cfg))}"><button class="btn" id="copy-invite" type="button">Kopieren</button></div>
        <small class="muted">Schick den Link per WhatsApp oder Mail. Wer ihn öffnet, ist mit euch verbunden – schick ihn also nur an die Person, mit der du Dately nutzt.</small>
      </div>
      ${sync.writeError ? `<p class="warn-text">${esc(sync.writeError)}</p>` : ''}
      <details class="join-other">
        <summary>Einladung von jemand anderem bekommen?</summary>
        <div class="row gap"><input class="input" id="join-code" placeholder="Einladungscode oder -link" autocomplete="off"><button class="btn" id="join-btn" type="button">Beitreten</button></div>
      </details>
    </section>
    <section class="panel form">
      <div class="panel-head">${icon('user')}<h2>Dein Konto</h2></div>
      <p>Angemeldet als <strong>${esc(auth.user?.email ?? '')}</strong></p>
      <div class="row gap wrap">
        <button class="btn" id="logout" type="button">Abmelden</button>
        <button class="btn ghost" id="pw-reset" type="button">Passwort ändern</button>
      </div>
      <button class="btn ghost danger" id="delete-account" type="button">${icon('trash')}Konto löschen</button>
      <small class="muted">Löscht dein Konto, deine geheimen Daten, Bewertungen und geteilten Ideen endgültig. Gemeinsame Dates bleiben für die andere Person erhalten.</small>`;
  }
  return `
    <p>Gerade liegen die Daten nur auf diesem Gerät. Mit einem kostenlosen Supabase-Projekt seht ihr beide dieselben Dates, Listen und Abstimmungen.</p>
    ${remoteError ? `<p class="warn-text">${esc(remoteError)}</p>` : ''}
    <div class="field"><label class="label" for="sb-url">Project URL</label><input class="input" id="sb-url" placeholder="https://xxxx.supabase.co" value="${esc(cfg?.url ?? '')}" autocomplete="off"></div>
    <div class="field"><label class="label" for="sb-key">Publishable / anon key</label><input class="input" id="sb-key" placeholder="eyJ… oder sb_publishable_…" value="${esc(cfg?.key ?? '')}" autocomplete="off"></div>
    <div class="field"><label class="label" for="sb-code">Einladungscode (nur wenn die andere Person schon verbunden ist)</label><input class="input" id="sb-code" placeholder="leer lassen beim ersten Einrichten" value="${esc(cfg?.code ?? '')}" autocomplete="off"></div>
    <button class="btn primary" id="sb-connect" type="button">${icon('users')}Verbinden</button>
    <p class="muted small">Die Einrichtung steht Schritt für Schritt in der Anleitung im Projekt (README).</p>`;
}

function bindSharing() {
  $('#copy-invite')?.addEventListener('click', async () => {
    const input = $('#invite');
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Link kopiert');
    } catch {
      input.select();
      toast('Link markiert – jetzt kopieren');
    }
  });
  $('#logout')?.addEventListener('click', async () => {
    await signOut(auth.cfg).catch(() => {});
    store.clearDeviceData();
    location.reload();
  });
  $('#pw-reset')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        await resetPassword(auth.cfg, auth.user.email);
        toast('Link zum Ändern des Passworts ist per E-Mail unterwegs');
      } catch (err) {
        toast(err.message);
      }
    });
  });
  const del = $('#delete-account');
  if (del) armed(del, async () => {
    try {
      await deleteAccount(auth.cfg);
      store.clearDeviceData();
      const c = getConfig();
      if (c) saveConfig({ url: c.url, key: c.key });
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  }, 'Nochmal tippen: Konto endgültig löschen');
  $('#join-btn')?.addEventListener('click', async (e) => {
    const v = $('#join-code').value.trim();
    const code = readInvite(v.includes('#') ? v.slice(v.indexOf('#')) : '')?.code ?? v;
    if (!code) return;
    await withBusy(e.currentTarget, async () => {
      const c = getConfig();
      saveConfig({ url: c.url, key: c.key, code, coupleId: null });
      location.reload();
    });
  });
  $('#sb-connect')?.addEventListener('click', async (e) => {
    const url = $('#sb-url').value.trim().replace(/\/+$/, '');
    const key = $('#sb-key').value.trim();
    const code = $('#sb-code').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) {
      remoteError = 'Bitte Project URL und Schlüssel aus Supabase eintragen.';
      return render();
    }
    saveConfig({ url, key, code: code || null, coupleId: null });
    await withBusy(e.currentTarget, () => startAccount({ url, key, code: code || null, coupleId: null }));
  });
}

function googleSettingsHTML() {
  if (store.inArtifact()) {
    return '<p>In der Claude-Version könnt ihr Dates über „Zu Google Kalender“ oder die .ics-Datei eintragen. Termine auslesen geht in der Webseiten-Version.</p>';
  }
  const id = S().settings.googleClientId ?? '';
  return `
    <p>Dates landen direkt in deinem Google Kalender, und die App zeigt, wann ihr schon etwas vorhabt. Die andere Person sieht von deinen Terminen nur „belegt“, keine Titel.</p>
    <div class="field">
      <label class="label" for="g-client">OAuth-Client-ID</label>
      <input class="input" id="g-client" data-set="googleClientId" placeholder="…apps.googleusercontent.com" value="${esc(id)}" autocomplete="off">
      <small class="muted">Einmalig für euch beide. Wie du sie bekommst, steht in der Anleitung (README).</small>
    </div>
    ${id ? (gcal.isConnected()
      ? `<div class="row gap wrap"><span class="tag ok">${icon('check')}Verbunden</span><button class="btn" id="g-sync" type="button">Termine laden</button><button class="btn ghost" id="g-off" type="button">Trennen</button></div>`
      : `<button class="btn primary" id="g-connect" type="button">${icon('calendar')}Mit Google verbinden</button>`) : ''}
    <p class="muted small">Ohne Einrichtung funktioniert immer: beim Date auf „Zu Google Kalender“ tippen.</p>`;
}

function bindGoogleSettings() {
  $('#g-connect')?.addEventListener('click', (e) => withBusy(e.currentTarget, connectGcal));
  $('#g-sync')?.addEventListener('click', (e) => withBusy(e.currentTarget, syncGcal));
  $('#g-off')?.addEventListener('click', () => {
    gcal.disconnect();
    L().gcal = { events: [], fetchedAt: 0 };
    store.saveLocal();
    const role = myRole();
    if (role) store.update((s) => (s.busy = s.busy.filter((b) => b.id !== role)));
    render();
  });
}

/* ================================================================ Entdecken */

const discover = { tab: 'fuereuch', query: '', search: null, searchLoading: false, cat: 'restaurant', radius: 15000, results: null, error: null, loading: false, cuisine: '', mood: '', sort: 'beste', community: null, cError: null, cLoading: false, myRatings: {} };
const placeIndex = new Map(); // id -> Ort (für die Detailansicht)

/* --- Umgebung: erst schauen, was es gibt, dann Dates daraus bilden --------- */

const GOOGLE_FINDABLE = new Set(['rooftop', 'livemusic', 'botanic', 'blacklight', 'xmas', 'karaoke', 'escape', 'climbing', 'cooking', 'pottery', 'arcade', 'bowling', 'spa', 'icerink', 'boat', 'bookshop']);
const feedRadiusKm = () => (feedFilter.radiusInit ? feedFilter.radiusKm : L().lastSearch?.radiusKm ?? feedFilter.radiusKm) || 15;
function currentArea() {
  const c = discoverCenter();
  return c && !store.inArtifact() ? getArea(c, feedRadiusKm()) : null;
}

/** Gibt es für die Hauptstation dieser Idee einen Ort im Umkreis? (null = noch unbekannt) */
function ideaAvailable(idea) {
  if (idea.reach === 0 || idea.custom || idea.generated || idea.event) return true;
  const a = currentArea();
  if (!a) return null;
  const main = idea.steps.map((s) => catForStep(s, isoDate(today()))).find(Boolean);
  if (!main || !(main in a.cats)) return null;
  if (a.cats[main].length) return true;
  const fb = categoryById(main)?.fallback;
  if (fb && a.cats[fb]?.length) return true;
  return googleKey() && GOOGLE_FINDABLE.has(main) ? null : false;
}

/** Umgebung im Hintergrund erkunden, sobald Ort und Umkreis bekannt sind. */
function kickArea() {
  const c = discoverCenter();
  const r = feedRadiusKm();
  if (!c || !r || store.inArtifact() || areaProgress()) return;
  if (getArea(c, r)?.done) return;
  ensureArea(c, r, isoDate(today())).catch(() => {});
}

onAreaChange((a, finished) => {
  const el = document.getElementById('area-progress');
  const pr = areaProgress();
  if (!finished && el && pr) el.textContent = `Dately erkundet eure Umgebung … (${pr.done}/${pr.total})`;
  if (finished) {
    discover.feed = null;
    discover.gen = null;
    discover.near = null;
    if (current.name === 'entdecken' && !formDirty) render();
  }
});

const AREA_LABELS = { restaurant: 'Restaurants', cafe: 'Cafés', bar: 'Bars', cinema: 'Kinos', museum: 'Museen', theatre: 'Theater', spa: 'Thermen', icerink: 'Eishallen', bowling: 'Bowling', escape: 'Escape Rooms', climbing: 'Boulderhallen', zoo: 'Zoos & Tierparks', xmas: 'Weihnachtsmärkte', minigolf: 'Minigolf', gallery: 'Galerien', park: 'Parks', viewpoint: 'Aussichtspunkte', beergarden: 'Biergärten', wine: 'Weinbars', icecream: 'Eisdielen', botanic: 'Botanische Gärten', livemusic: 'Live-Musik', rooftop: 'Rooftop-Bars', cooking: 'Kochkurse', pottery: 'Töpfereien', arcade: 'Lasertag', blacklight: 'Schwarzlicht-Minigolf', lake: 'Badeseen' };

function areaSection() {
  const c = discoverCenter();
  const r = feedRadiusKm();
  if (!c || !r || store.inArtifact()) return '';
  const a = getArea(c, r);
  const pr = areaProgress();
  const counts = a ? Object.keys(AREA_LABELS).filter((id) => a.cats[id]?.length).map((id) => [id, a.cats[id].length]) : [];
  return `
    <section class="stack area">
      <h2 class="section-title">Bei euch im Umkreis von ${r} km</h2>
      ${pr ? `<p class="muted small"><span class="spinner tiny"></span> <span id="area-progress">Dately erkundet eure Umgebung … (${pr.done}/${pr.total})</span></p>` : ''}
      ${counts.length ? `<div class="area-chips">${counts.map(([id, n]) => `<button type="button" class="area-chip" data-area-cat="${id}">${esc(AREA_LABELS[id])} <strong>${n >= 15 ? '15+' : n}</strong></button>`).join('')}</div>` : !pr ? '<p class="muted small">Noch nicht erkundet.</p>' : ''}
      ${a?.done ? '<p class="muted small">Vorschläge gibt es nur für Dates, die hier auch wirklich möglich sind.</p>' : ''}
    </section>`;
}

function discoverCenter() {
  const g = L().geo;
  if (g && Date.now() - g.at < 6 * 3600 * 1000) return { lat: g.lat, lon: g.lon, name: g.name, gps: true };
  const sg = S().settings.geo;
  if (sg) return { lat: sg.lat, lon: sg.lon, name: sg.name, gps: false };
  return null;
}

function placeLine(p, dateIso, time) {
  const when = new Date(`${dateIso}T${time}:00`);
  const open = isOpenAt(p.hours, when);
  const day = hoursOn(p.hours, when);
  const parts = [];
  if (day) parts.push(`${when.toLocaleDateString('de-DE', { weekday: 'short' })}: ${day}`);
  else if (p.hours) parts.push(formatHours(p.hours));
  if (p.price) parts.push(p.price);
  return `
    <p class="place-line">${parts.map(esc).join(' · ') || 'Öffnungszeiten auf der Webseite prüfen'}</p>
    ${open === false ? `<p class="warn-text small">${icon('clock')} Um ${time} laut Öffnungszeiten geschlossen</p>` : ''}`;
}

// Bilder und Google-Sterne werden nach dem Zeichnen nachgeladen
const imgJobs = new Map();
let imgSeq = 0;
const imgJob = (job, target) => {
  const id = `j${++imgSeq}`;
  imgJobs.set(id, { job, target });
  return id;
};
const gJobs = new Map();
const gJob = (place) => {
  const id = `g${++imgSeq}`;
  gJobs.set(id, place);
  return id;
};
// Google-Fotos brauchen die Herkunft der Seite (Schlüssel ist auf die Webseite beschränkt)
const refPol = (src) => (/googleapis\.com/.test(src) ? 'strict-origin-when-cross-origin' : 'no-referrer');
const imgTag = (src) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="${refPol(src)}" onerror="this.parentNode.classList.add('noimg');this.remove()">`;

function hydrateMedia() {
  const key = googleKey();
  $$('[data-img]', root).forEach((el) => {
    const j = imgJobs.get(el.dataset.img);
    el.removeAttribute('data-img');
    if (!j) return;
    findImage(j.job, key).then((url) => {
      if (!url) return;
      if (j.target) j.target.image = url;
      el.classList.remove('noimg');
      el.insertAdjacentHTML('afterbegin', imgTag(url));
    });
  });
  if (!key) return;
  $$('[data-grating]', root).forEach((el) => {
    const p = gJobs.get(el.dataset.grating);
    el.removeAttribute('data-grating');
    if (!p) return;
    googleDetails({ ...p, id: p.id ?? `${p.name}@${p.lat}` }, key).then((g) => {
      if (g?.rating) el.innerHTML = `${icon('star')} Google ${String(g.rating).replace('.', ',')} <span class="muted">(${g.count.toLocaleString('de-DE')})</span>`;
    }).catch(() => {});
  });
}

/** Vorschaubild für eine Idee: Foto des Orts oder ein passendes Themenbild. */
function ideaThumb(i, cls) {
  const img = i.photos?.[0] || i.image || i.steps?.find((s) => s.place?.image)?.place.image;
  const mp = i.mainPlace ?? i.steps?.find((s) => s.place?.lat != null)?.place;
  const t = topicFor(i);
  return thumb(img, i.emoji ?? '💡', cls, mp ? { place: mp, topic: t } : t ? { topic: t } : null, i);
}

const gRating = (p) => (googleKey() && p?.lat != null ? `<span class="g-rating" data-grating="${gJob(p)}"></span>` : '');

const thumb = (src, emoji, cls = '', job = null, target = null) =>
  !src && job ? `<span class="thumb noimg ${cls}" data-img="${imgJob(job, target)}"><span class="thumb-emoji" aria-hidden="true">${glyph(emoji)}</span></span>`
  : src ? `<span class="thumb ${cls}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="${refPol(src)}" onerror="this.parentNode.classList.add('noimg');this.remove()"><span class="thumb-emoji" aria-hidden="true">${glyph(emoji)}</span></span>`
    : `<span class="thumb noimg ${cls}"><span class="thumb-emoji" aria-hidden="true">${glyph(emoji)}</span></span>`;

function placeCard(p, mini = false) {
  const cat = categoryById(p.category);
  const pJob = { place: p };
  const favIdea = ideaFromPlace(p);
  const now = new Date();
  const open = isOpenAt(p.hours, now);
  const todayHours = hoursOn(p.hours, now);
  return `
    <article class="place ${mini ? 'mini' : ''}" data-open-place="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} öffnen">
      ${thumb(p.image, cat.emoji, 'wide', pJob, p)}
      ${favBtn(favIdea, 'on-img')}
      <div class="place-body">
        ${mini ? `<span class="kicker">${esc(cat.label)}</span>` : ''}
        <div class="row between top"><h3>${esc(p.name)}</h3><span class="muted small nowrap">${fmtKm(p.km)}</span></div>
        <p class="muted small">${[p.cuisine, p.street].filter(Boolean).map(esc).join(' · ') || (mini ? '' : cat.label)}</p>
        <p class="small">
          ${open === true ? '<span class="tag ok">Geöffnet</span>' : open === false ? '<span class="tag">Geschlossen</span>' : ''}
          ${todayHours ? `Heute ${esc(todayHours)}` : p.hours ? '' : '<span class="muted">Öffnungszeiten unbekannt</span>'}
          ${p.price ? ` · ${esc(p.price.text)}` : ''}${p.vegan ? ' · <span class="tag ok">vegan</span>' : ''}
        </p>
      </div>
    </article>`;
}

/** Aus einem Ort eine Date-Idee machen (Vorlage der Kategorie). */
function ideaFromPlace(p) {
  const cat = categoryById(p.category);
  const [first, ...rest] = cat.plan;
  const placeRef = { name: p.name, street: p.street, city: p.city, lat: p.lat, lon: p.lon, website: p.website, hours: p.hours, price: p.price, image: p.image, category: p.category };
  const cost = p.price?.amount != null ? Math.round(p.price.amount * 2 + (rest.length ? 15 : 0)) : cat.cost;
  return {
    id: `ort-${p.id}`,
    title: p.name,
    emoji: cat.emoji,
    teaser: `${cat.label} · ${fmtKm(p.km)} entfernt${p.street ? ` · ${p.street}` : ''}`,
    place: cat.place,
    moods: cat.moods,
    cost,
    reach: p.km > 15 ? 2 : 1,
    times: cat.times,
    image: p.image,
    steps: [
      { t: `${first[0]}: ${p.name}`, min: first[1], place: placeRef, food: !!cat.food },
      ...rest.map(([t, min, q]) => ({ t, min, q, food: !!q && /Café|Restaurant|Eisdiele/.test(q) })),
    ],
    custom: true,
    fromPlace: true,
  };
}

async function planIdeaNow(idea, el) {
  if (!myRole()) return toast('Wähle zuerst auf „Planen“, wer du bist');
  tempIdeas.set(idea.id, idea);
  const ls = L().lastSearch;
  await withBusy(el, async () => {
    await prepareSession({ date: idea.fixedDate ?? (idea.generated && idea.date) ?? resolveDate(ls), daytime: idea.times?.includes(ls.daytime) ? ls.daytime : idea.times?.[0] ?? 'abend', budget: Math.max(ls.budget, idea.cost ?? 0), reach: 2, radiusKm: (feedFilter.radiusInit ? feedFilter.radiusKm : L().lastSearch?.radiusKm) || 15 }, null);
    drafts[idea.id] = { start: idea.fixedStart ?? defaultStart(idea, session.ctx.daytime), surprise: true, hint: '', picks: {}, near: null, openAlt: null, duration: idea.fixedStart || idea.reach === 0 ? null : feedFilter.duration, variant: 0 };
    session.backTo = [current.name, current.param ?? '', current.name === 'ort' ? 'Ort' : 'Entdecken'];
    go('plan', idea.id);
  });
}

function moodChips(group, value) {
  return chips(group, [['', 'Alle'], ...MOODS.map(([v, l]) => [v, l])], value);
}

RENDER.entdecken = () => {
  const d = discover;
  if (d.tab === 'eigene') d.tab = 'gemerkt';
  const tabs = `
    <nav class="seg-tabs four" role="tablist">
      <button role="tab" data-dtab="fuereuch" aria-selected="${d.tab === 'fuereuch'}">${icon('sparkle')}Für euch</button>
      <button role="tab" data-dtab="orte" aria-selected="${d.tab === 'orte'}">${icon('pin')}Orte</button>
      <button role="tab" data-dtab="community" aria-selected="${d.tab === 'community'}">${icon('users')}Community</button>
      <button role="tab" data-dtab="gemerkt" aria-selected="${d.tab === 'gemerkt'}">${icon('heart')}Gemerkt</button>
    </nav>`;
  const subs = { fuereuch: 'Ideen und Orte, die gerade zu euch passen.', orte: 'Restaurants, Bars, Museen & mehr in eurer Nähe.', community: 'Dates, die andere Paare geplant und bewertet haben.', gemerkt: 'Eure Favoriten und eigenen Ideen.' };
  const head = topbar({ title: 'Entdecken', sub: subs[d.tab] }) + `
    <form class="search-bar" id="d-search-form" role="search">
      ${icon('search')}
      <input class="input" id="d-search" type="search" placeholder="Dates suchen, z. B. Therme, Sushi, romantisch" value="${esc(d.query)}" autocomplete="off" enterkeyhint="search">
      ${d.query ? `<button type="button" class="icon-btn small" id="d-search-clear" aria-label="Suche leeren">${icon('x')}</button>` : ''}
    </form>`;
  if (d.query) return renderSearch(head);

  if (d.tab === 'fuereuch') return renderForYou(head + tabs);
  if (d.tab === 'community') return renderCommunity(head + tabs);
  if (d.tab === 'gemerkt') return renderSaved(head + tabs);

  const center = discoverCenter();
  const m = today().getMonth() + 1;
  const seasonOk = (c) => !c.seasonal || (c.seasonal === 'summer' ? m >= 6 && m <= 8 : isXmasSeason(isoDate(today())));
  const area = currentArea();
  const cats = CATEGORIES.filter((c) => (!c.hidden || c.id === d.cat) && seasonOk(c) && (!d.mood || c.moods.includes(d.mood)) && !(area && area.cats[c.id]?.length === 0));
  if (!cats.some((c) => c.id === d.cat)) d.cat = cats[0]?.id ?? 'restaurant';
  const cat = categoryById(d.cat);
  let results = d.results ?? [];

  root.innerHTML = `
    ${head}${tabs}
    <section class="panel locbar">
      <div class="row gap">
        ${icon('pin')}
        <div class="grow"><strong>${center ? esc(center.name) : 'Kein Standort'}</strong><br><small class="muted">${center ? (center.gps ? 'Aktueller Standort' : 'Stadt aus den Einstellungen') : 'Erlaube den Standort oder trag eine Stadt ein'}</small></div>
        <button class="btn sm" id="d-gps">${icon('locate')}Standort</button>
      </div>
      ${radiusChips('radius', Math.round(d.radius / 1000))}
    </section>
    <div class="cat-scroll">${moodChips('mood', d.mood)}</div>
    <div class="cat-scroll">${chips('cat', cats.map((c) => [c.id, c.label]), d.cat, 'cats')}</div>
    ${cat.id === 'restaurant' ? `<div class="cat-scroll">${chips('cuisine', [['', 'Alle Küchen'], ...CUISINES.map((c) => [c.id, c.label])], d.cuisine, 'small-chips')}</div>` : ''}
    <section class="stack" id="results">
      ${d.loading ? '<div class="loading"><span class="spinner"></span>Suche Orte …</div>'
        : d.error ? `<div class="empty"><p>${esc(d.error)}</p></div>`
          : !center ? '<div class="empty"><p>Tippe auf „Standort“, damit die App Orte in deiner Nähe findet.</p></div>'
            : d.results ? (results.length ? `<div class="places">${results.map(placeCard).join('')}</div>` : `<div class="empty"><p>${d.cuisine ? `Keine Restaurants mit „${esc(CUISINES.find((c) => c.id === d.cuisine)?.label ?? '')}“ im Umkreis eingetragen.` : 'Nichts gefunden.'} Vergrößere den Umkreis oder wähle einen anderen Filter.</p></div>`)
              : ''}
      ${d.results?.length ? '<p class="muted small center">Orte und Bilder: OpenStreetMap & Wikimedia. Tippe auf einen Ort für Anfahrt, Reservierung und Bewertungen.</p>' : ''}
    </section>`;

  const load = async () => {
    const c = discoverCenter();
    if (!c) return;
    d.loading = true;
    d.error = null;
    if (d.cat !== 'restaurant') d.cuisine = '';
    render();
    try {
      d.results = await searchNearby(d.cat, c, d.radius, d.cat === 'restaurant' ? d.cuisine : '');
      d.results.forEach((p) => placeIndex.set(p.id, p));
    } catch (e) {
      d.results = null;
      d.error = store.inArtifact() ? 'Die Ortssuche funktioniert nur in der Webseiten-Version der App.' : e.message === 'Failed to fetch' ? 'Keine Verbindung zur Ortssuche.' : e.message;
    }
    d.loading = false;
    if (current.name === 'entdecken') render();
  };

  bindDiscoverTabs();
  bindRadius(root, 'radius', (km) => {
    d.radius = km * 1000;
    load();
  });
  bindChips(root, 'mood', (v) => {
    d.mood = v;
    const ok = CATEGORIES.filter((c) => !v || c.moods.includes(v));
    if (!ok.some((c) => c.id === d.cat)) {
      d.cat = ok[0]?.id ?? d.cat;
      return load();
    }
    render();
  });
  bindChips(root, 'cat', (v) => {
    d.cat = v;
    load();
  });
  bindChips(root, 'cuisine', (v) => {
    d.cuisine = v;
    load();
  });
  $('#d-gps').addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        await useGps();
        await load();
      } catch (err) {
        d.error = store.inArtifact() ? 'Den Standort kann die App nur in der Webseiten-Version abfragen.' : err.message;
        render();
      }
    });
  });
  on('[data-open-place]', 'click', (_, el) => (session.ortBack = null, go('ort', el.dataset.openPlace)));
  on('[data-open-place]', 'keydown', (e, el) => e.key === 'Enter' && (session.ortBack = null, go('ort', el.dataset.openPlace)));
  if (center && !d.results && !d.loading && !d.error) load();
};

function bindSearchBar() {
  const input = $('#d-search');
  if (!input) return;
  let t;
  const run = () => {
    const q = input.value.trim();
    if (q === discover.query) return;
    discover.query = q;
    discover.search = null;
    render();
    const again = $('#d-search');
    again?.focus();
    again?.setSelectionRange(again.value.length, again.value.length);
  };
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(run, 450);
  });
  $('#d-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(t);
    run();
    input.blur();
  });
  $('#d-search-clear')?.addEventListener('click', () => {
    discover.query = '';
    discover.search = null;
    render();
  });
}

const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Suchergebnisse: passende Ideen (eingebaut, eigene, Community) und Orte mit diesem Namen. */
function renderSearch(head) {
  const d = discover;
  const tokens = norm(d.query).split(/\s+/).filter(Boolean);
  const hay = (i) => norm([i.title, i.teaser, ...(i.steps ?? []).flatMap((s) => [s.t, s.q, s.place?.name]), ...(i.moods ?? []).map(moodLabel), i.place].join(' '));
  const match = (i) => tokens.every((t) => hay(i).includes(t));
  const ideas = allIdeas().filter(match).slice(0, 12);
  const com = (d.community ?? []).map(communityIdea).filter(match).slice(0, 6);
  const center = discoverCenter();
  if (center && !d.search && !d.searchLoading && !store.inArtifact()) {
    d.searchLoading = true;
    (async () => {
      const radiusKm = feedFilter.radiusKm || Math.round(d.radius / 1000) || 15;
      const cuisine = CUISINES.find((c) => norm(c.label).includes(norm(d.query)) || norm(d.query).includes(norm(c.label)));
      const catId = catForStep({ q: d.query, t: d.query }, isoDate(today())) ?? CATEGORIES.find((c) => !c.hidden && norm(c.label).includes(norm(d.query)))?.id ?? null;
      const base = { center, radiusKm, daytime: feedFilter.daytime, date: feedDate(), moods: preferredMoods(), weather: d.feedWeather, prio: 1 };
      let gen = [];
      if (cuisine) {
        const list = await searchNearby('restaurant', center, radiusKm * 1000, cuisine.id);
        gen = await generateLocalDates({ ...base, mainList: list });
      } else if (catId) {
        gen = await generateLocalDates({ ...base, onlyCategory: catId });
      }
      if (gen.length < 3) {
        const byName = await searchByName(d.query, center, radiusKm * 1000);
        gen = [...gen, ...(byName.length ? await generateLocalDates({ ...base, mainList: byName }) : [])];
      }
      const seen = new Set();
      d.search = gen.filter((i) => !seen.has(i.id) && seen.add(i.id));
      d.search.forEach((i) => tempIdeas.set(i.id, i));
    })()
      .catch(() => (d.search = []))
      .finally(() => {
        d.searchLoading = false;
        if (current.name === 'entdecken' && d.query) render();
      });
  }
  const evMatch = (d.events ?? []).filter(match);
  if (community.api && !d.community && !d.cLoading) loadCommunity();
  const gens = d.search ?? [];

  root.innerHTML = `
    ${head}
    <p class="muted small">Ergebnisse für „${esc(d.query)}“</p>
    ${center && !store.inArtifact() ? `
    <section class="stack">
      <h2 class="section-title">Dates in eurer Nähe</h2>
      ${d.searchLoading && !d.search ? '<div class="loading"><span class="spinner"></span>Stelle Dates zusammen …</div>'
        : gens.length ? gens.map(feedCard).join('') : '<p class="muted">Im Umkreis nichts Passendes gefunden. Vergrößert den Umkreis unter „Für euch → Filter“.</p>'}
    </section>` : ''}
    ${evMatch.length ? `<section class="stack"><h2 class="section-title">Veranstaltungen</h2>${evMatch.map(feedCard).join('')}</section>` : ''}
    <section class="stack">
      <h2 class="section-title">Date-Ideen</h2>
      ${ideas.length ? ideas.map(feedCard).join('') : '<p class="muted">Keine passende Idee. Versuch einen anderen Begriff oder leg eine eigene Idee an.</p>'}
    </section>
    ${com.length ? `<section class="stack"><h2 class="section-title">Aus der Community</h2>${com.map(feedCard).join('')}</section>` : ''}`;

  bindSearchBar();
  on('[data-feed-plan]', 'click', (_, el) => {
    const idea = favRegistry.get(el.dataset.feedPlan) ?? ideaById(el.dataset.feedPlan);
    if (idea) planIdeaNow(idea, el);
  });
  on('[data-open-place]', 'click', (_, el) => (session.ortBack = null, go('ort', el.dataset.openPlace)));
}

function bindDiscoverTabs() {
  bindSearchBar();
  on('[data-dtab]', 'click', (_, el) => {
    discover.tab = el.dataset.dtab;
    render();
  });
}

/* --- Ort im Detail: Bilder, Bewertungen, Reservierung, Anfahrt -------------- */

const gInfo = new Map(); // Google-Details je Ort

RENDER.ort = (id) => {
  const p = placeIndex.get(id);
  if (!p) return go('entdecken');
  const cat = categoryById(p.category);
  const g = gInfo.get(id);
  const ls = L().lastSearch;
  const date = resolveDate(ls);
  const week = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label, i) => {
    const day = addDays(today(), ((i + 1) - today().getDay() + 7) % 7);
    return [label, hoursOn(p.hours, day)];
  });
  const hasWeek = week.some(([, h]) => h);
  const img = g?.photo || p.image;
  const est = travelEstimates(p.km);
  const apple = /iPhone|iPad|Mac/.test(navigator.userAgent);

  root.innerHTML = `
    ${topbar({ title: '', back: session.ortBack ?? ['entdecken', '', 'Entdecken'] })}
    <div class="hero-img ${img ? '' : 'noimg'}">
      ${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" referrerpolicy="${refPol(img)}" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ''}
      <span class="thumb-emoji" aria-hidden="true">${glyph(cat.emoji)}</span>
    </div>
    <header class="topbar">
      <p class="eyebrow">${esc(cat.label)} · ${fmtKm(p.km)}</p>
      <h1>${esc(p.name)}</h1>
      <p class="sub">${[p.cuisine, p.street, p.city].filter(Boolean).map(esc).join(' · ')}</p>
    </header>

    <section class="panel rating-box">
      ${g?.rating ? `<div class="g-rating"><strong>${String(g.rating).replace('.', ',')}</strong>${stars(g.rating)}<span class="muted small">${g.count} Google-Bewertungen${g.price ? ` · ${g.price}` : ''}</span></div>` : `<p class="muted small">${googleKey() ? 'Keine Google-Bewertung gefunden.' : 'Bewertungen und Fotos von Google siehst du direkt bei Google Maps.'}</p>`}
      <a class="link" href="${esc(g?.mapsUri || mapLink(p))}" target="_blank" rel="noopener">Google-Bewertungen ansehen${icon('external')}</a>
    </section>

    <section class="panel stack">
      <div class="panel-head">${icon('clock')}<h2>Öffnungszeiten</h2></div>
      ${hasWeek ? `<table class="hours-table">${week.map(([l, h]) => `<tr${l === ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][today().getDay()] ? ' class="today"' : ''}><th>${l}</th><td>${esc(h ?? '–')}</td></tr>`).join('')}</table>`
        : p.hours ? `<p>${esc(formatHours(p.hours))}</p>` : '<p class="muted">Nicht bekannt – bitte auf der Webseite prüfen.</p>'}
      ${p.price ? `<p>${icon('euro')} ${esc(p.price.text)}</p>` : ''}
      ${p.phone ? `<p>Telefon: <a href="tel:${esc(p.phone.replace(/\s/g, ''))}">${esc(p.phone)}</a></p>` : ''}
    </section>

    ${cat.food || p.reservation ? `
    <section class="panel stack">
      <div class="panel-head">${icon('calendar')}<h2>Reservieren</h2></div>
      ${p.reservation === 'required' ? '<p class="warn-text small">Reservierung erforderlich.</p>' : ''}
      <div class="link-grid">${reservationLinks(p, { date, time: ls.daytime === 'tag' ? '12:30' : '19:00', city: currentPlaceName() }).map((l) => `<a class="btn ${l.primary ? 'primary' : ''}" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}${icon('external')}</a>`).join('')}</div>
      <p class="muted small">OpenTable zeigt das Restaurant, wenn es dort gelistet ist. Sonst über die Webseite oder telefonisch reservieren.</p>
    </section>` : p.website ? `<a class="btn" href="${esc(p.website)}" target="_blank" rel="noopener">Webseite${icon('external')}</a>` : ''}

    <section class="panel stack">
      <div class="panel-head">${icon('route')}<h2>So kommt ihr hin</h2></div>
      <div class="travel">
        ${est.map((t) => `<a class="travel-opt" href="${esc(directionsLink(p, t.mode))}" target="_blank" rel="noopener">${icon(t.icon)}<strong>ca. ${fmtMin(t.min)}</strong><span>${t.label}</span></a>`).join('')}
      </div>
      <p class="muted small">Geschätzt aus der Entfernung. Tippe für die genaue Route in Google Maps.</p>
      ${apple ? `<a class="btn" href="${esc(appleMapsLink(p, 'd'))}" target="_blank" rel="noopener">In Apple Karten öffnen${icon('external')}</a>` : ''}
    </section>

    <div class="actions">
      <button class="btn primary big" id="o-plan">${icon('sparkle')}Als Date planen</button>
      <button class="btn" id="o-save">${icon('heart')}${isFav(`ort-${p.id}`) ? 'Favorit ✓' : 'Als Favorit speichern'}</button>
    </div>`;

  bindBack();
  $('#o-plan').addEventListener('click', (e) => planIdeaNow(ideaFromPlace(p), e.currentTarget));
  $('#o-save').addEventListener('click', async () => {
    favRegistry.set(`ort-${p.id}`, ideaFromPlace(p));
    await toggleFav(`ort-${p.id}`);
    render();
  });
  const key = googleKey();
  if (key && !gInfo.has(id)) {
    googleDetails(p, key)
      .then((info) => {
        gInfo.set(id, info);
        if (info?.hours && !p.hours) p.hours = info.hours;
        if (current.name === 'ort' && current.param === id) render();
      })
      .catch((e) => {
        gInfo.set(id, null);
        toast(e.message);
      });
  }
};

function stars(v) {
  return `<span class="stars-ro" aria-label="${v} von 5">${[1, 2, 3, 4, 5].map((n) => `<i class="${v >= n - 0.25 ? 'on' : v >= n - 0.75 ? 'half' : ''}"></i>`).join('')}</span>`;
}

/* --- Community ---------------------------------------------------------------- */

const community = { api: null };

async function loadCommunity() {
  const d = discover;
  if (!community.api) return;
  d.cLoading = true;
  d.cError = null;
  try {
    const [list, mine] = await Promise.all([community.api.list(), community.api.myRatings()]);
    d.community = list;
    d.myRatings = mine;
  } catch (e) {
    d.cError = e.message;
  }
  d.cLoading = false;
  if (current.name === 'entdecken' && discover.tab === 'community') render();
}

function communityIdea(row) {
  return { ...row.idea, id: `com-${row.id}`, communityId: row.id, custom: true, rating: { avg: Number(row.avg_stars), count: row.rating_count } };
}

function renderCommunity(head) {
  const d = discover;
  const center = discoverCenter();
  let list = (d.community ?? []).map((r) => ({ ...r, km: center && r.lat != null ? distanceKm(center, { lat: r.lat, lon: r.lon }) : null }));
  if (d.mood) list = list.filter((r) => (r.moods ?? []).includes(d.mood));
  list.sort((a, b) => d.sort === 'neu' ? b.created_at.localeCompare(a.created_at)
    : d.sort === 'nah' ? (a.km ?? 1e9) - (b.km ?? 1e9)
      : (b.avg_stars - a.avg_stars) || (b.rating_count - a.rating_count) || (b.uses - a.uses));

  const card = (r) => {
    const i = r.idea;
    const img = i.photos?.[0] || i.image || i.steps?.find((s) => s.place?.image)?.place.image;
    const mine = d.myRatings[r.id];
    return `
      <article class="community-card">
        ${ideaThumb(i, 'wide')}
        <div class="place-body">
          <div class="row between top"><h3>${esc(i.title)}</h3>${r.rating_count ? `<span class="score">${icon('star')}${String(r.avg_stars).replace('.', ',')}<small class="muted"> (${r.rating_count})</small></span>` : '<small class="muted">neu</small>'}</div>
          <p class="muted small">${[r.city, r.km != null ? fmtKm(r.km) : '', fmtEuro(i.cost ?? 0), `${r.uses}× übernommen`].filter(Boolean).map(esc).join(' · ')}</p>
          <p class="teaser">${esc(i.teaser ?? '')}</p>
          <p class="flow">${(i.steps ?? []).map((s) => esc(s.t)).join('<span aria-hidden="true"> → </span>')}</p>
          ${(r.moods ?? []).length ? `<div class="mood-tags">${r.moods.map((m) => `<span class="tag">${esc(moodLabel(m))}</span>`).join('')}</div>` : ''}
          <div class="row gap wrap">
            <button class="btn primary sm" data-adopt="${r.id}">${icon('sparkle')}Übernehmen</button>
            ${favBtn(communityIdea(r), 'labelled')}
            <button class="btn sm ghost" data-creviews="${r.id}">Bewertungen</button>
            ${r.mine ? `<button class="btn sm ghost danger" data-cdel="${r.id}">Zurückziehen</button>` : `<button class="btn sm ghost" data-creport="${r.id}">Melden</button>`}
          </div>
          ${mine ? `<p class="muted small">Eure Bewertung: ${'★'.repeat(mine.stars)}</p>` : ''}
          <div class="reviews" id="rev-${r.id}" hidden></div>
        </div>
      </article>`;
  };

  root.innerHTML = `
    ${head}
    ${!community.api ? `
      <div class="empty">
        <p><strong>Die Community braucht die Webseiten-Version mit Supabase.</strong><br>Sobald die App verbunden ist, seht ihr hier Dates von anderen Paaren und könnt eigene teilen.</p>
        <button class="btn" data-go="mehr">Zu den Einstellungen</button>
      </div>` : `
      <div class="cat-scroll">${moodChips('mood', d.mood)}</div>
      ${chips('csort', [['beste', 'Beste'], ['nah', 'In der Nähe'], ['neu', 'Neu']], d.sort, 'seg')}
      ${d.cLoading ? '<div class="loading"><span class="spinner"></span>Lade Ideen …</div>'
        : d.cError ? `<div class="empty"><p>${esc(d.cError)}</p></div>`
          : list.length ? `<div class="places">${list.map(card).join('')}</div>`
            : '<div class="empty"><p>Noch keine geteilten Ideen. Teilt euer nächstes Date über „Mit der Community teilen“ – ihr seid die Ersten!</p></div>'}`}`;

  bindDiscoverTabs();
  on('[data-go]', 'click', (_, el) => go(el.dataset.go));
  bindChips(root, 'mood', (v) => {
    d.mood = v;
    render();
  });
  bindChips(root, 'csort', (v) => {
    d.sort = v;
    render();
  });
  const row = (id) => d.community.find((r) => r.id === id);
  on('[data-adopt]', 'click', (_, el) => {
    const r = row(el.dataset.adopt);
    community.api.use(r.id).catch(() => {});
    planIdeaNow(communityIdea(r), el);
  });
  on('[data-csave]', 'click', (_, el) => {
    const r = row(el.dataset.csave);
    store.update((s) => s.ideas.push({ ...communityIdea(r), id: `eigen-${uid()}`, createdBy: myRole(), createdAt: Date.now() }));
    community.api.use(r.id).catch(() => {});
    toast('Bei euren Ideen gemerkt');
  });
  on('[data-creviews]', 'click', async (_, el) => {
    const box = $(`#rev-${el.dataset.creviews}`);
    if (!box.hidden) return (box.hidden = true);
    box.hidden = false;
    box.innerHTML = '<span class="spinner"></span>';
    try {
      const reviews = await community.api.reviews(el.dataset.creviews);
      box.innerHTML = reviews.length ? reviews.map((v) => `<p><span class="gold">${'★'.repeat(v.stars)}</span> ${esc(v.comment ?? '')} <small class="muted">${fmtShort(v.created_at.slice(0, 10))}</small></p>`).join('') : '<p class="muted small">Noch keine Bewertungen.</p>';
    } catch (e) {
      box.textContent = e.message;
    }
  });
  on('[data-creport]', 'click', async (_, el) => {
    try {
      await community.api.report(el.dataset.creport, 'unpassend');
      toast('Danke, gemeldet');
    } catch (e) {
      toast(e.message);
    }
  });
  on('[data-cdel]', 'click', async (_, el) => {
    try {
      await community.api.remove(el.dataset.cdel);
      toast('Idee zurückgezogen');
      loadCommunity();
    } catch (e) {
      toast(e.message);
    }
  });
  if (community.api && !d.community && !d.cLoading && !d.cError) loadCommunity();
}

/* --- Mit der Community teilen ------------------------------------------------- */

/** Nur Inhalte der Idee teilen – keine Namen, Hinweise, Kosten-Einträge oder privaten Daten. */
function publicIdea(src) {
  const steps = (src.steps ?? []).map((s) => {
    const out = { t: s.t ?? s.title, min: s.min ?? 60 };
    if (s.q) out.q = s.q;
    if (s.url) out.url = s.url;
    if (s.food) out.food = true;
    const pl = s.place;
    if (pl?.lat != null) out.place = { name: pl.name, street: pl.street ?? '', city: pl.city ?? '', lat: pl.lat, lon: pl.lon, website: pl.website ?? '', hours: pl.hours ?? '', image: pl.image ?? '', category: pl.category ?? '' };
    return out;
  });
  return {
    title: src.title, emoji: src.emoji ?? '💡', teaser: src.teaser ?? '', place: src.place ?? 'drinnen', cost: src.cost ?? 0,
    reach: src.reach ?? 1, times: src.times ?? [src.daytime ?? 'abend'], moods: src.moods ?? [], steps,
    image: src.image ?? steps.find((s) => s.place?.image)?.place.image ?? '',
  };
}

RENDER.teilen = (param) => {
  const [kind, id] = param.split(':');
  const src = kind === 'idea' ? ideaById(id) : (() => {
    const d = S().dates.find((x) => x.id === id);
    if (!d) return null;
    const plan = fullPlan(d);
    if (!plan) return null;
    const idea = allIdeas().find((i) => i.id === plan.ideaId);
    return { ...plan, steps: idea?.steps?.map((st) => ({ ...st })) ?? plan.steps.map((s) => ({ t: s.title, min: s.min, place: s.place })), times: idea?.times, reach: idea?.reach };
  })();
  if (!src || !community.api) return go('entdecken');
  const pub = publicIdea(src);
  const center = discoverCenter();
  const draft = { moods: new Set(pub.moods) };

  root.innerHTML = `
    ${topbar({ title: 'Mit der Community teilen', sub: 'Andere Paare sehen Titel, Ablauf, Orte und Kosten – keine Namen und keine privaten Daten.', back: kind === 'idea' ? ['entdecken', '', 'Entdecken'] : ['date', id, 'Date'] })}
    <form class="panel form" id="share-form" novalidate>
      <div class="field"><label class="label" for="sh-title">Titel</label><input class="input" id="sh-title" maxlength="60" value="${esc(pub.title)}"></div>
      <div class="field"><label class="label" for="sh-teaser">Was macht das Date besonders?</label><input class="input" id="sh-teaser" maxlength="140" value="${esc(pub.teaser)}" placeholder="z. B. Perfekt für Regentage, das Café hat die beste Torte"></div>
      <div class="field"><span class="label">Stimmung</span><div class="chips" id="sh-moods">${MOODS.map(([v, l]) => `<button type="button" class="chip" data-m="${v}" aria-pressed="${draft.moods.has(v)}">${l}</button>`).join('')}</div></div>
      <div class="field"><label class="label" for="sh-city">Stadt</label><input class="input" id="sh-city" maxlength="60" value="${esc(currentPlaceName())}"></div>
      <div class="panel inset"><strong>Ablauf</strong><p class="flow">${pub.steps.map((s) => esc(s.t)).join(' → ')}</p><p class="muted small">${fmtEuro(pub.cost)} für zwei</p></div>
      <button class="btn primary big" type="submit">${icon('share')}Teilen</button>
    </form>`;

  bindBack();
  $('#sh-moods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    draft.moods.has(b.dataset.m) ? draft.moods.delete(b.dataset.m) : draft.moods.add(b.dataset.m);
    b.setAttribute('aria-pressed', String(draft.moods.has(b.dataset.m)));
  });
  $('#share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pubPhotos = kind === 'date' ? photoList(S().dates.find((x) => x.id === id) ?? {}).filter((ph) => ph.public && ph.url).map((ph) => ph.url) : [];
    const idea = { ...pub, title: $('#sh-title').value.trim() || pub.title, teaser: $('#sh-teaser').value.trim(), moods: [...draft.moods], ...(pubPhotos.length ? { photos: pubPhotos } : {}) };
    const firstPlace = idea.steps.find((s) => s.place)?.place;
    const loc = firstPlace ?? center;
    await withBusy(e.submitter ?? $('#share-form button[type=submit]'), async () => {
      try {
        const cid = await community.api.publish(idea, { city: $('#sh-city').value.trim(), lat: loc?.lat ?? null, lon: loc?.lon ?? null });
        store.update((s) => {
          if (kind === 'idea') {
            const i = s.ideas.find((x) => x.id === id);
            if (i) i.communityId = cid;
          } else {
            const d = s.dates.find((x) => x.id === id);
            if (d) d.sharedId = cid;
          }
        });
        discover.community = null;
        toast('Geteilt – danke!');
        go(kind === 'idea' ? 'entdecken' : 'date', kind === 'idea' ? null : id);
      } catch (err) {
        toast(err.message);
      }
    });
  });
};

/* ================================================================ Umfrage: Tag & Lust */

const SURVEY_DAYS = 14;
const surveyDays = () => Array.from({ length: SURVEY_DAYS }, (_, i) => isoDate(addDays(today(), i)));

function createSurvey(kind) {
  // Läuft schon eine offene Umfrage dieser Art? Dann diese öffnen statt eine neue anzulegen.
  const openSurveys = S().polls.filter((p) => p.status === 'open' && p.stage === 'survey').sort((a, b) => b.createdAt - a.createdAt);
  const same = openSurveys.find((p) => (p.kind ?? 'full') === kind);
  if (same) return same.id;
  // Die große Umfrage fragt die Tage mit ab – keine zweite Tagesabfrage daneben.
  const full = openSurveys.find((p) => (p.kind ?? 'full') === 'full');
  if (kind === 'day' && full) return full.id;
  const emptyDay = openSurveys.filter((p) => p.kind === 'day' && !Object.keys(p.survey ?? {}).length).map((p) => p.id);
  if (kind === 'full' && emptyDay.length) store.update((st) => (st.polls = st.polls.filter((p) => !emptyDay.includes(p.id))));
  const id = uid();
  const ls = L().lastSearch;
  store.update((s) =>
    s.polls.push({
      id,
      kind, // 'full' = Tag + Lust, danach Vorschläge und Abstimmung; 'day' = nur Tag
      stage: 'survey',
      createdBy: myRole(),
      createdAt: Date.now(),
      survey: {},
      status: 'open',
      round: 0,
      rounds: {},
      ctx: { date: isoDate(today()), daytime: ls.daytime ?? 'abend', budget: ls.budget ?? 60, reach: ls.reach ?? 1 },
    }),
  );
  return id;
}

/** Kurzer Hinweis, was an dem Tag schon ansteht (für die Tagesauswahl). */
function dayHint(iso) {
  const date = parseISO(iso);
  const n = [
    ...L().gcal.events.filter((e) => e.date === iso),
    ...S().events.filter((e) => e.date === iso),
    ...S().settings.fixed.filter((f) => f.weekday === date.getDay()),
    ...S().dates.filter((d) => d.date === iso),
  ].length;
  const partner = partnerBusy(iso).length;
  return { n, partner };
}

const weatherSnap = (w) => (w?.known ? { known: true, icon: w.icon, label: w.label, temp: w.temp ?? null, wet: w.wet, cold: w.cold, clear: w.clear } : { known: false, reason: w?.reason ?? '' });

/** Aus beiden Antworten Vorschläge erzeugen und in die Abstimmung wechseln. */
async function generateFromSurvey(pollId, date) {
  const p = S().polls.find((x) => x.id === pollId);
  if (!p || p.stage !== 'survey') return;
  const w = combineWishes(p.survey);
  const ctx = { date, daytime: w.daytime, budget: w.budget, reach: w.reach, moods: w.moods, moodsBoth: w.moodsBoth, placePref: w.placePref };
  const center = discoverCenter();
  session.ctx = ctx;
  session.weather = await getWeather(center, date, ctx.daytime);
  session.shown = new Set();
  const ideas = await reroll();
  if (!ideas.length) return toast('Keine Idee passt zu euren Wünschen – erhöht das Budget in der Umfrage.');
  const builtin = new Set((await loadIdeas()).map((i) => i.id));
  store.update((s) => {
    const x = s.polls.find((y) => y.id === pollId);
    if (!x || x.stage !== 'survey') return;
    Object.assign(x, {
      stage: 'vote',
      ctx,
      weather: weatherSnap(session.weather),
      summary: { moodsBoth: w.moodsBoth, moods: w.moods, budget: w.budget, daytime: w.daytime, placePref: w.placePref },
      round: 1,
      rounds: { r1: { ideas: ideas.map((i) => i.id), votes: { a: {}, b: {} }, snap: Object.fromEntries(ideas.filter((i) => !builtin.has(i.id)).map((i) => [i.id, i])) } },
    });
  });
  render(true);
}

function renderSurvey(p) {
  const role = myRole();
  const partner = other(role);
  const mine = p.survey?.[role];
  const theirs = p.survey?.[partner];
  const full = p.kind !== 'day';
  const title = full ? 'Worauf habt ihr Lust?' : 'Welcher Tag passt euch?';

  // Beide fertig: Ergebnis
  if (mine && theirs && session.editSurvey !== p.id) {
    const w = combineWishes(p.survey);
    const union = [...new Set([...(mine.days ?? []), ...(theirs.days ?? [])])].sort();
    const dayBtn = (iso, primary) => `<button class="btn ${primary ? 'primary' : ''}" data-pick-day="${iso}">${full ? icon('sparkle') : icon('calendar')}${full ? 'Ideen für' : 'Date am'} ${esc(relDay(iso) ?? fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' }))}${full ? ' finden' : ' planen'}</button>`;
    root.innerHTML = `
      ${topbar({ title, sub: 'Ihr habt beide geantwortet.', back: ['start', '', 'Start'] })}
      <section class="panel stack result">
        ${w.commonDays.length ? `
          <span class="kicker">Gemeinsame Tage</span>
          <div class="day-result">${w.commonDays.map((d, i) => `<span class="tag ${i === 0 ? 'ok' : ''}">${esc(fmtShort(d))}</span>`).join('')}</div>
          <p>Am besten passt <strong>${esc(relDay(w.date) ?? fmtDate(w.date))}</strong>, ${daytimeLabel(w.daytime)}.${w.daytimeConflict ? ' (Ihr wolltet unterschiedliche Tageszeiten – wir nehmen den Abend.)' : ''}</p>`
          : `<span class="kicker">Kein gemeinsamer Tag</span><p>Wählt einen der Tage, die einer von euch angegeben hat – oder startet die Umfrage neu.</p>`}
        ${full ? `
          <span class="kicker">Eure Wünsche</span>
          <p>${w.moodsBoth.length ? `Beide haben Lust auf <strong>${w.moodsBoth.map(moodLabel).join(', ')}</strong>.` : `Zusammen: ${w.moods.map(moodLabel).join(', ') || 'alles offen'}.`} Budget bis ${w.budget} € · ${REACH[w.reach]}${w.placePref ? ` · ${w.placePref === 'drinnen' ? 'Drinnen' : 'Draußen'}` : ''}</p>` : ''}
      </section>
      <div class="actions">
        ${w.commonDays.length ? dayBtn(w.date, true) + w.commonDays.slice(1, 3).map((d) => dayBtn(d, false)).join('') : union.slice(0, 5).map((d) => dayBtn(d, false)).join('')}
        <button class="btn ghost" id="survey-edit">Meine Antworten ändern</button>
        <button class="btn ghost danger" id="survey-del">${icon('trash')}Umfrage löschen</button>
      </div>
      ${full ? '<p class="hint center">Nach der Tageswahl schlägt die App drei Ideen vor, über die ihr abstimmt.</p>' : ''}`;
    bindBack();
    on('[data-pick-day]', 'click', async (_, el) => {
      const iso = el.dataset.pickDay;
      if (full) return withBusy(el, () => generateFromSurvey(p.id, iso));
      store.update((s) => {
        const x = s.polls.find((y) => y.id === p.id);
        if (x) Object.assign(x, { status: 'planned', ctx: { ...x.ctx, date: iso, daytime: w.daytime } });
      });
      Object.assign(L().lastSearch, { when: 'date', date: iso, daytime: w.daytime });
      store.saveLocal();
      session.plannerTouched = false;
      toast(`Tag steht fest: ${fmtShort(iso)}`);
      go('start');
    });
    $('#survey-edit').addEventListener('click', () => {
      session.editSurvey = p.id;
      render();
    });
    armed($('#survey-del'), () => {
      store.update((s) => (s.polls = s.polls.filter((x) => x.id !== p.id)));
      go('start');
    });
    return;
  }

  // Ich habe geantwortet, die andere Person noch nicht
  if (mine && session.editSurvey !== p.id) {
    root.innerHTML = `
      ${topbar({ title, back: ['start', '', 'Start'] })}
      <section class="surprise-card">
        <div class="gift-mark">${icon('check')}</div>
        <h1>Danke!</h1>
        <p class="sub">Sobald ${esc(nameOf(partner))} geantwortet hat, zeigt euch die App den besten Tag${full ? ' und passende Ideen' : ''}.</p>
      </section>
      <button class="btn" id="survey-edit">Meine Antworten ändern</button>`;
    bindBack();
    $('#survey-edit').addEventListener('click', () => {
      session.editSurvey = p.id;
      render();
    });
    return;
  }

  // Fragebogen
  const ls = L().lastSearch;
  const draft = {
    days: new Set(mine?.days ?? []),
    daytime: mine?.daytime ?? 'beides',
    moods: new Set(mine?.moods ?? []),
    place: mine?.place ?? 'egal',
    budget: mine?.budget ?? ls.budget ?? 60,
    reach: mine?.reach ?? 1,
  };
  root.innerHTML = `
    ${topbar({ title, sub: `Deine Antworten sieht ${esc(nameOf(partner))} erst, wenn ihr beide fertig seid.`, back: ['start', '', 'Start'] })}
    <form class="panel form" id="survey-form" novalidate>
      <div class="field">
        <span class="label">Wann hast du Zeit? <small class="muted">(mehrere möglich)</small></span>
        <div class="day-grid">
          ${surveyDays().map((iso) => {
            const d = parseISO(iso);
            const h = dayHint(iso);
            return `<button type="button" class="day-btn" data-day-opt="${iso}" aria-pressed="${draft.days.has(iso)}">
              <span class="wd">${WD_SHORT[d.getDay()]}</span><strong>${d.getDate()}</strong>
              <span class="dmarks">${h.n ? `<i class="dot gcal" title="Du hast Termine"></i>` : ''}${h.partner ? `<i class="dot busy" title="${esc(nameOf(partner))} hat Termine"></i>` : ''}</span>
            </button>`;
          }).join('')}
        </div>
        <small class="muted">Punkte zeigen Termine: <i class="dot gcal"></i> deine, <i class="dot busy"></i> ${esc(nameOf(partner))} (aus Google Kalender).</small>
      </div>
      <div class="field"><span class="label">Tageszeit</span>${chips('s-daytime', [['tag', 'Tagsüber', 'sun'], ['abend', 'Abends', 'moon'], ['beides', 'Egal']], draft.daytime, 'seg')}</div>
      ${full ? `
        <div class="field"><span class="label">Worauf hast du Lust? <small class="muted">(bis zu 3)</small></span>
          <div class="chips" id="s-moods">${MOODS.map(([v, l]) => `<button type="button" class="chip" data-m="${v}" aria-pressed="${draft.moods.has(v)}">${l}</button>`).join('')}</div></div>
        <div class="field"><span class="label">Drinnen oder draußen?</span>${chips('s-place', [['drinnen', 'Drinnen', 'home'], ['draußen', 'Draußen', 'sun'], ['egal', 'Egal']], draft.place, 'seg')}</div>
        <div class="field">
          <div class="label-row"><span class="label">Budget für euch beide</span><output id="s-budget-out" class="budget-out">${draft.budget} €</output></div>
          <input type="range" id="s-budget" min="0" max="200" step="5" value="${draft.budget}" aria-label="Budget in Euro">
        </div>
        <div class="field"><span class="label">Wie weit?</span>${chips('s-reach', [[0, 'Zuhause'], [1, 'In der Stadt'], [2, 'Ausflug']], draft.reach, 'seg')}</div>` : ''}
      <button class="btn primary big" type="submit">${icon('check')}Antworten senden</button>
    </form>`;

  bindBack();
  const form = $('#survey-form');
  form.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day-opt]');
    if (day) {
      const iso = day.dataset.dayOpt;
      draft.days.has(iso) ? draft.days.delete(iso) : draft.days.add(iso);
      day.setAttribute('aria-pressed', String(draft.days.has(iso)));
    }
    const m = e.target.closest('#s-moods [data-m]');
    if (m) {
      const v = m.dataset.m;
      if (draft.moods.has(v)) draft.moods.delete(v);
      else if (draft.moods.size < 3) draft.moods.add(v);
      else toast('Höchstens drei – entferne erst eine');
      m.setAttribute('aria-pressed', String(draft.moods.has(v)));
    }
  });
  bindChips(form, 's-daytime', (v) => (draft.daytime = v));
  bindChips(form, 's-place', (v) => (draft.place = v));
  bindChips(form, 's-reach', (v) => (draft.reach = Number(v)));
  $('#s-budget')?.addEventListener('input', (e) => {
    draft.budget = Number(e.target.value);
    $('#s-budget-out').textContent = `${draft.budget} €`;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!draft.days.size) return toast('Wähle mindestens einen Tag');
    const answer = { days: [...draft.days].sort(), daytime: draft.daytime, at: Date.now() };
    if (full) Object.assign(answer, { moods: [...draft.moods], place: draft.place, budget: draft.budget, reach: draft.reach });
    store.update((s) => {
      const x = s.polls.find((y) => y.id === p.id);
      if (x) x.survey = { ...(x.survey ?? {}), [role]: answer };
    });
    session.editSurvey = null;
    toast('Antworten gespeichert');
    render(true);
  });
}

/* ================================================================ Favoriten */

const favRegistry = new Map();
const isFav = (id) => S().favorites.some((f) => f.ideaId === id);

function favBtn(idea, cls = '') {
  favRegistry.set(idea.id, idea);
  const on = isFav(idea.id);
  return `<button type="button" class="fav ${on ? 'on' : ''} ${cls}" data-fav="${esc(idea.id)}" aria-pressed="${on}" aria-label="${on ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}">${icon('heart')}</button>`;
}

async function toggleFav(id) {
  if (!myRole()) return toast('Wähle zuerst auf „Planen“, wer du bist');
  const idea = favRegistry.get(id) ?? ideaById(id);
  if (!idea) return;
  const builtin = (await loadIdeas()).some((i) => i.id === id);
  const was = isFav(id);
  store.update((s) => {
    if (was) s.favorites = s.favorites.filter((f) => f.ideaId !== id);
    else s.favorites.push({ id: `fav-${id}`.slice(0, 180), ideaId: id, idea: builtin ? null : { ...idea, custom: true }, by: myRole(), at: Date.now() });
  });
  toast(was ? 'Aus Favoriten entfernt' : 'Als Favorit gespeichert');
  $$(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', !was);
    b.setAttribute('aria-pressed', String(!was));
  });
}

// Herz-Knöpfe sitzen oft in anklickbaren Karten: in der Capture-Phase abfangen.
root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFav(b.dataset.fav);
}, true);

/* ================================================================ Entdecken: Für euch */

const feedFilter = { budget: null, mood: '', place: '', reach: 1, radiusKm: 15, duration: null, daytime: new Date().getHours() >= 14 ? 'abend' : 'tag', open: false };
const DUR_OPTS = [['', 'Wie vorgeschlagen'], ['120', '2 Std.'], ['180', '3 Std.'], ['240', '4 Std.'], ['300', '5 Std.'], ['480', 'Ganzer Tag']];
const durLabel = (m) => DUR_OPTS.find(([v]) => v === String(m))?.[1] ?? fmtDuration(m);

const NEAR_CATS = { abend: ['restaurant', 'bar', 'cinema', 'theatre', 'wine', 'escape'], tag: ['cafe', 'museum', 'park', 'zoo', 'icecream', 'gallery'] };

function feedDate() {
  const t = today();
  const late = new Date().getHours() >= (feedFilter.daytime === 'abend' ? 21 : 16);
  return isoDate(late ? addDays(t, 1) : t);
}

async function loadFeed() {
  const d = discover;
  d.feedLoading = true;
  const center = discoverCenter();
  const date = feedDate();
  const budget = feedFilter.budget ?? L().lastSearch.budget ?? 60;
  const ctx = { date, daytime: feedFilter.daytime, budget, reach: kmToReach(feedFilter.radiusKm), radiusKm: feedFilter.radiusKm, mood: feedFilter.mood, placePref: feedFilter.place || null };
  try {
    d.feedWeather = await getWeather(center, date, ctx.daytime);
  } catch {
    d.feedWeather = { known: false };
  }
  const res = await suggest(ctx, d.feedWeather, { count: 4, dates: S().dates.map(fullPlanOrMeta), recentIds: S().dates.slice(-8).map((x) => x.ideaId) });
  d.feed = res.ideas;
  d.feedCtx = ctx;
  d.feedLoading = false;
  if (current.name === 'entdecken' && d.tab === 'fuereuch') render();
}

async function loadNear() {
  const d = discover;
  const center = discoverCenter();
  if (!center) return;
  d.nearLoading = true;
  d.nearError = null;
  let cats = [...(isXmasSeason(feedDate()) ? ['xmas'] : []), ...NEAR_CATS[feedFilter.daytime]];
  if (feedFilter.mood) cats = CATEGORIES.filter((c) => c.moods.includes(feedFilter.mood) && c.times.includes(feedFilter.daytime)).map((c) => c.id).slice(0, 6);
  if (feedFilter.place) cats = cats.filter((id) => categoryById(id).place === feedFilter.place);
  if (feedFilter.radiusKm === 0) cats = [];
  try {
    const groups = cats.length ? await searchMixed(cats, center, feedFilter.radiusKm * 1000) : {};
    const now = new Date();
    // Pro Kategorie die zwei nächsten, geöffnete zuerst
    d.near = Object.values(groups)
      .flatMap((list) => list.slice(0, 2))
      .sort((a, b) => (isOpenAt(b.hours, now) === true) - (isOpenAt(a.hours, now) === true) || a.km - b.km);
    d.near.forEach((p) => placeIndex.set(p.id, p));
  } catch (e) {
    d.near = null;
    d.nearError = store.inArtifact() ? 'Orte in der Nähe gibt es in der Webseiten-Version.' : e.message === 'Failed to fetch' ? 'Keine Verbindung zur Ortssuche.' : e.message;
  }
  d.nearLoading = false;
  if (current.name === 'entdecken' && d.tab === 'fuereuch') render();
}

function feedCard(i) {
  const img = i.photos?.[0] || i.image || i.steps?.find((s) => s.place?.image)?.place.image;
  const mp = i.mainPlace ?? i.steps?.find((s) => s.place?.lat != null)?.place;
  const job = mp ? { place: mp, topic: topicFor(i) } : topicFor(i) ? { topic: topicFor(i) } : null;
  return `
    <article class="feed-card">
      ${thumb(img, i.emoji ?? '💡', 'sq big', job, i)}
      <div class="grow">
        <div class="row between top"><h3>${esc(i.title)}</h3>${favBtn(i)}</div>
        <p class="muted small">${fmtEuro(i.cost ?? 0)} · ${fmtDuration(feedFilter.duration && i.reach !== 0 ? feedFilter.duration : ideaDuration(i))} · ${i.place === 'drinnen' ? 'Drinnen' : 'Draußen'}${i.rating?.count ? ` · ★ ${String(i.rating.avg).replace('.', ',')}` : ''}</p>
        <p class="teaser">${esc(i.teaser ?? '')}</p>
        ${genExtras(i)}
        <button class="btn sm primary" data-feed-plan="${esc(i.id)}">${icon('sparkle')}Planen</button>
      </div>
    </article>`;
}

/** Bewertung anderer Paare für ein Date mit demselben Hauptort (aus der Community). */
function communityRatingFor(i) {
  const names = new Set((i.steps ?? []).map((s) => s.place?.name).filter(Boolean).map(norm));
  if (!names.size || !discover.community) return null;
  let sum = 0;
  let n = 0;
  for (const r of discover.community) {
    if (!r.rating_count) continue;
    if ((r.idea.steps ?? []).some((s) => s.place?.name && names.has(norm(s.place.name)))) {
      sum += Number(r.avg_stars) * r.rating_count;
      n += r.rating_count;
    }
  }
  return n ? { avg: (sum / n).toFixed(1).replace('.', ','), count: n } : null;
}

/** Zusatzangaben für selbst erstellte Dates: Weg, Preis, Bewertungen, Links. */
function genExtras(i) {
  if (!i.generated) return '';
  const r = communityRatingFor(i);
  const mp = i.mainPlace ?? i.steps?.find((s) => s.place?.lat != null)?.place;
  const g = mp ? encodeURIComponent(`${mp.name} ${mp.street ?? ''} ${mp.city ?? ''}`.trim()) : '';
  const facts = [i.eventWhenText, i.km != null ? travelLine(i) : '', i.priceText, r ? `★ ${r.avg} von ${r.count} ${r.count === 1 ? 'Bewertung' : 'Bewertungen'} anderer Paare` : ''].filter(Boolean);
  const places = (i.steps ?? []).map((s) => s.place).filter((p) => p?.lat != null);
  return `
    ${facts.length ? `<p class="gen-meta">${facts.map(esc).join(' · ')}</p>` : ''}
    ${googleKey() && places.length ? `<div class="g-ratings">${places.map((p) => `<span class="g-place"><small class="muted">${esc(p.name)}</small> ${gRating(p)}</span>`).join('')}</div>` : ''}
    <div class="links">
      ${mp?.lat != null ? `<a class="link" href="https://www.google.com/maps/dir/?api=1&destination=${mp.lat},${mp.lon}" target="_blank" rel="noopener">Route${icon('external')}</a>
      <a class="link" href="https://www.google.com/maps/search/?api=1&query=${g}" target="_blank" rel="noopener">Google-Bewertungen${icon('external')}</a>` : ''}
      ${i.ticketUrl ? `<a class="link" href="${esc(i.ticketUrl)}" target="_blank" rel="noopener">Tickets${icon('external')}</a>` : ''}
    </div>`;
}

/** Vorlieben beider Personen + gewählte Stimmung. */
function preferredMoods() {
  const prefs = S().settings.prefs ?? {};
  const moods = [...(prefs.a?.moods ?? []), ...(prefs.b?.moods ?? [])];
  if (feedFilter.mood) moods.push(feedFilter.mood, feedFilter.mood);
  return moods;
}

async function loadGenerated() {
  const d = discover;
  const center = discoverCenter();
  if (!center) return;
  d.genLoading = true;
  try {
    if (!d.feedWeather) d.feedWeather = await getWeather(center, feedDate(), feedFilter.daytime).catch(() => ({ known: false }));
    const prefPlace = feedFilter.place || null;
    const budget = feedFilter.budget ?? L().lastSearch.budget ?? 200;
    d.genError = null;
    const area = currentArea();
    const all = await generateLocalDates({ center, radiusKm: feedFilter.radiusKm || 15, daytime: feedFilter.daytime, date: feedDate(), moods: preferredMoods(), weather: d.feedWeather, place: prefPlace, count: 6, budget, groups: area?.done ? area.cats : null });
    const fits = all.filter((i) => i.cost <= budget * 1.2);
    // Lieber etwas über Budget zeigen als gar nichts
    d.gen = (fits.length ? fits : [...all].sort((a, b) => a.cost - b.cost)).slice(0, 4);
    d.genOverBudget = !fits.length && all.length > 0;
    d.gen.forEach((i) => tempIdeas.set(i.id, i));
  } catch (e) {
    d.gen = [];
    d.genError = e.message || 'Ortssuche gerade nicht erreichbar.';
  }
  d.genLoading = false;
  if (current.name === 'entdecken') render();
}

async function loadEvents() {
  const d = discover;
  const center = discoverCenter();
  d.eventsLoading = true;
  d.eventsError = null;
  try {
    const from = isoDate(today());
    const to = isoDate(addDays(today(), 14));
    const evs = await fetchEvents({ key: S().settings.ticketmasterKey, center, radiusKm: Math.max(feedFilter.radiusKm || 15, 10), from, to });
    d.events = evs.map((ev) => ({ ...ideaFromEvent(ev), eventWhenText: eventWhen(ev) }));
    d.events.forEach((i) => tempIdeas.set(i.id, i));
  } catch (e) {
    d.events = [];
    d.eventsError = e.message;
  }
  d.eventsLoading = false;
  if (current.name === 'entdecken') render();
}

function renderForYou(head) {
  const d = discover;
  // Zuletzt gewählten Umkreis übernehmen (auch nach dem Neuladen)
  if (!feedFilter.radiusInit) {
    feedFilter.radiusInit = true;
    if (L().lastSearch?.radiusKm != null) feedFilter.radiusKm = L().lastSearch.radiusKm;
  }
  const center = discoverCenter();
  if (!center && !d.autoLocTried && !store.inArtifact()) {
    d.autoLocTried = true;
    useGps().then(() => {
      d.near = null;
      d.feed = null;
      if (current.name === 'entdecken') render();
    }).catch(() => {});
  }
  kickArea();
  if (!d.feed && !d.feedLoading) loadFeed();
  if (center && !d.gen && !d.genLoading && !store.inArtifact() && feedFilter.radiusKm !== 0) loadGenerated();
  if (center && S().settings.ticketmasterKey && !d.events && !d.eventsLoading && !store.inArtifact()) loadEvents();
  if (center && !d.near && !d.nearLoading && !d.nearError) loadNear();
  const recos = recommend(S().dates.map(fullPlanOrMeta), 3);
  const topCommunity = (d.community ?? []).filter((r) => r.rating_count).sort((a, b) => b.avg_stars - a.avg_stars).slice(0, 3);
  if (community.api && !d.community && !d.cLoading) loadCommunity();
  const w = d.feedWeather;
  const budget = feedFilter.budget ?? L().lastSearch.budget ?? 60;
  const f = feedFilter;

  root.innerHTML = `
    ${head}
    <section class="filter-bar">
      <button class="filter-chip" data-ftoggle>${icon('pin')}${esc(center?.name ?? 'Standort')}</button>
      <button class="filter-chip" data-ftoggle>${f.daytime === 'abend' ? 'Abends' : 'Tagsüber'}</button>
      <button class="filter-chip" data-ftoggle>bis ${budget} €</button>
      <button class="filter-chip" data-ftoggle>${f.radiusKm === 0 ? 'Zuhause' : `${f.radiusKm} km`}</button>
      ${f.mood ? `<button class="filter-chip on" data-ftoggle>${esc(moodLabel(f.mood))}</button>` : ''}
      ${f.place ? `<button class="filter-chip on" data-ftoggle>${f.place === 'drinnen' ? 'Drinnen' : 'Draußen'}</button>` : ''}
      ${f.duration ? `<button class="filter-chip on" data-ftoggle>${icon('clock')}${esc(durLabel(f.duration))}</button>` : ''}
      <button class="filter-chip strong" data-ftoggle>${icon('more')}Filter</button>
    </section>
    <section class="panel form filter-panel" ${f.open ? '' : 'hidden'}>
      <div class="field"><span class="label">Standort</span>
        <div class="row gap"><div class="input-ico grow">${icon('pin')}<input class="input" id="ff-city" value="${esc(center?.name ?? S().settings.city)}" placeholder="Stadt"></div>
        <button type="button" class="btn square" id="ff-gps" aria-label="Meinen Standort verwenden">${icon('locate')}</button></div>
      </div>
      <div class="field"><span class="label">Tageszeit</span>${chips('ff-daytime', [['tag', 'Tagsüber', 'sun'], ['abend', 'Abends', 'moon']], f.daytime, 'seg')}</div>
      <div class="field">
        <div class="label-row"><span class="label">Budget für euch beide</span><output id="ff-budget-out" class="budget-out">${budget} €</output></div>
        <input type="range" id="ff-budget" min="0" max="200" step="5" value="${budget}" aria-label="Budget in Euro">
      </div>
      <div class="field"><span class="label">Stimmung</span>${chips('ff-mood', [['', 'Alle'], ...MOODS.map(([v, l]) => [v, l])], f.mood)}</div>
      <div class="field"><span class="label">Drinnen oder draußen</span>${chips('ff-place', [['', 'Beides'], ['drinnen', 'Drinnen', 'home'], ['draußen', 'Draußen', 'sun']], f.place, 'seg')}</div>
      <div class="field"><span class="label">Wie weit?</span>${radiusChips('ff-reach', f.radiusKm, { home: true })}</div>
      <div class="field"><span class="label">Wie lange soll das Date dauern?</span>${chips('ff-dur', DUR_OPTS, String(f.duration ?? ''))}<small class="muted">Dately verteilt die Zeit auf die Stationen und rechnet die Wege mit ein.</small></div>
      <button type="button" class="btn primary" id="ff-apply">Anwenden</button>
    </section>

    ${w?.known ? `<p class="weather-line">${icon(weatherGlyph(w))} ${relDay(feedDate()) ?? fmtShort(feedDate())} ${daytimeLabel(f.daytime)}: ${esc(w.label)}${w.temp != null ? `, ${w.temp}°` : ''}${w.wet ? ' – Ideen für drinnen' : ''}</p>` : ''}

    ${f.radiusKm !== 0 ? areaSection() : ''}

    ${center && f.radiusKm !== 0 && !store.inArtifact() ? `
    <section class="stack">
      <h2 class="section-title">Neu für euch in der Nähe</h2>
      <p class="muted small">Von Dately zusammengestellt – aus echten Orten im Umkreis von ${f.radiusKm} km, passend zu euren Vorlieben${isXmasSeason(feedDate()) ? ' und zur Adventszeit' : ''}.</p>
      ${d.genLoading && !d.gen ? '<div class="loading"><span class="spinner"></span>Stelle Dates zusammen …</div>'
        : d.genError ? `<p class="muted">Die Kartendaten sind gerade nicht erreichbar (${esc(d.genError)}).</p><button class="btn soft" id="gen-retry">${icon('repeat')}Nochmal versuchen</button>`
          : d.gen?.length ? `${d.genOverBudget ? `<p class="muted small">Im Budget von ${budget} € gab es nichts – hier die günstigsten Dates.</p>` : ''}${d.gen.map(feedCard).join('')}`
            : '<p class="muted">Gerade nichts Passendes im Umkreis gefunden – vergrößert den Umkreis oder das Budget im Filter.</p>'}
      ${d.gen?.length ? `<button class="btn soft" id="gen-more">${icon('dice')}Neue Kombinationen</button>` : ''}
    </section>` : ''}

    ${S().settings.ticketmasterKey ? `
    <section class="stack">
      <h2 class="section-title">Veranstaltungen in den nächsten 2 Wochen</h2>
      ${d.eventsLoading && !d.events ? '<div class="loading"><span class="spinner"></span>Suche Veranstaltungen …</div>'
        : d.eventsError ? `<p class="muted">${esc(d.eventsError)}</p>`
          : d.events?.length ? d.events.slice(0, 6).map(feedCard).join('') : '<p class="muted">Keine Veranstaltungen im Umkreis gefunden.</p>'}
    </section>` : ''}

    <section class="stack">
      <h2 class="section-title">Ideen, die zu euch passen</h2>
      ${d.feedLoading && !d.feed ? '<div class="loading"><span class="spinner"></span>Suche Ideen …</div>'
        : d.feed?.length ? d.feed.map(feedCard).join('') : '<p class="muted">Keine Idee passt zu diesen Filtern. Erhöht das Budget oder ändert die Stimmung.</p>'}
      ${d.feed?.length ? `<button class="btn soft" id="feed-more">${icon('dice')}Andere Ideen</button>` : ''}
    </section>

    ${f.radiusKm === 0 ? '' : `
    <section class="stack">
      <div class="row between"><h2 class="section-title">In eurer Nähe</h2><button class="linkish small" data-dtab="orte">Alle Orte</button></div>
      ${!center ? `<div class="empty"><p>${store.inArtifact() ? 'Orte in der Nähe gibt es in der Webseiten-Version.' : 'Erlaube den Standort oder trag oben eine Stadt ein, dann zeigt Dately Restaurants, Bars & Co. in eurer Nähe.'}</p></div>`
        : d.nearLoading && !d.near ? '<div class="loading"><span class="spinner"></span>Suche Orte …</div>'
          : d.nearError ? `<p class="muted">${esc(d.nearError)}</p>`
            : d.near?.length ? `<div class="h-scroll">${d.near.map((p) => placeCard(p, true)).join('')}</div>` : '<p class="muted">Nichts in der Nähe gefunden.</p>'}
    </section>`}

    ${topCommunity.length ? `
    <section class="stack">
      <div class="row between"><h2 class="section-title">Beliebt bei anderen Paaren</h2><button class="linkish small" data-dtab="community">Alle</button></div>
      ${topCommunity.map((r) => feedCard(communityIdea(r))).join('')}
    </section>` : ''}

    ${recos.length ? `
    <section class="stack">
      <h2 class="section-title">Weil es euch gefallen hat</h2>
      ${recos.map(({ idea }) => feedCard(idea)).join('')}
    </section>` : ''}`;

  bindDiscoverTabs();
  on('[data-area-cat]', 'click', (_, el) => {
    d.tab = 'orte';
    d.cat = el.dataset.areaCat;
    d.results = null;
    render(true);
  });
  $('#gen-retry')?.addEventListener('click', () => {
    d.gen = null;
    d.genError = null;
    render();
  });
  $('#gen-more')?.addEventListener('click', () => {
    d.gen = null;
    render();
  });
  const refresh = () => {
    d.feed = null;
    d.gen = null;
    d.events = null;
    d.near = null;
    d.nearError = null;
    render();
  };
  on('[data-ftoggle]', 'click', () => {
    f.open = !f.open;
    $('.filter-panel').hidden = !f.open;
  });
  const panel = $('.filter-panel');
  bindChips(panel, 'ff-daytime', (v) => (f.daytime = v));
  bindChips(panel, 'ff-mood', (v) => (f.mood = v));
  bindChips(panel, 'ff-place', (v) => (f.place = v));
  bindRadius(panel, 'ff-reach', (km) => {
    f.radiusKm = km;
    L().lastSearch = { ...L().lastSearch, radiusKm: km };
    store.saveLocal();
  });
  bindChips(panel, 'ff-dur', (v) => (f.duration = v ? Number(v) : null));
  $('#ff-budget').addEventListener('input', (e) => {
    f.budget = Number(e.target.value);
    $('#ff-budget-out').textContent = `${f.budget} €`;
  });
  $('#ff-gps').addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        const g = await useGps();
        $('#ff-city').value = g.name;
      } catch (err) {
        toast(store.inArtifact() ? 'Den Standort gibt es in der Webseiten-Version.' : err.message);
      }
    });
  });
  $('#ff-apply').addEventListener('click', async (e) => {
    const city = $('#ff-city').value.trim();
    await withBusy(e.currentTarget, async () => {
      if (city && city !== center?.name) {
        L().geo = null;
        store.saveLocal();
        await ensureGeo(city);
      }
    });
    f.open = false;
    refresh();
  });
  $('#feed-more')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      const shown = new Set(d.feed.map((i) => i.id));
      const res = await suggest(d.feedCtx, d.feedWeather, { count: 4, exclude: shown, dates: S().dates.map(fullPlanOrMeta) });
      d.feed = res.ideas;
    });
    render();
  });
  on('[data-feed-plan]', 'click', (_, el) => {
    const idea = favRegistry.get(el.dataset.feedPlan) ?? ideaById(el.dataset.feedPlan);
    if (idea) planIdeaNow(idea, el);
  });
  on('[data-open-place]', 'click', (_, el) => (session.ortBack = null, go('ort', el.dataset.openPlace)));
}

/* ================================================================ Entdecken: Gemerkt */

function renderSaved(head) {
  const favs = [...S().favorites].sort((a, b) => b.at - a.at);
  const custom = S().ideas;
  const favIdeas = favs.map((f) => ({ f, idea: f.idea ?? ideaById(f.ideaId) })).filter((x) => x.idea);
  root.innerHTML = `
    ${head}
    <section class="stack">
      <h2 class="section-title">Favoriten</h2>
      ${favIdeas.length ? favIdeas.map(({ f, idea }) => `
        <article class="feed-card">
          ${ideaThumb(idea, 'sq big')}
          <div class="grow">
            <div class="row between top"><h3>${esc(idea.title)}</h3>${favBtn(idea)}</div>
            <p class="muted small">${fmtEuro(idea.cost ?? 0)} · ${fmtDuration(ideaDuration(idea))} · gemerkt von ${f.by === myRole() ? 'dir' : esc(nameOf(f.by))}</p>
            <button class="btn sm primary" data-feed-plan="${esc(idea.id)}">${icon('sparkle')}Planen</button>
          </div>
        </article>`).join('') : `<p class="muted">Tippe bei einer Idee, einem Ort oder einer Community-Idee auf ${icon('heart', 'inline')}, um sie für später zu speichern. Favoriten kommen auch bei Vorschlägen bevorzugt vor.</p>`}
    </section>
    <section class="stack">
      <div class="row between"><h2 class="section-title">Eigene Ideen</h2><button class="btn sm soft" data-go="idee">${icon('plus')}Neue Idee</button></div>
      ${custom.length ? `<div class="list-card">${custom.map((i) => `
        <div class="date-item static">
          ${ideaThumb(i, 'sq')}
          <span class="grow"><strong>${esc(i.title)}</strong><small class="muted">${i.place === 'drinnen' ? 'Drinnen' : 'Draußen'} · ${fmtEuro(i.cost)} · ${fmtDuration(ideaDuration(i))}${(i.moods ?? []).length ? ` · ${i.moods.map(moodLabel).join(', ')}` : ''}</small></span>
          <button class="icon-btn small" data-feed-plan="${i.id}" aria-label="Planen">${icon('sparkle')}</button>
          ${community.api && !i.communityId ? `<button class="icon-btn small" data-share-idea="${i.id}" aria-label="Mit der Community teilen">${icon('share')}</button>` : ''}
          <button class="icon-btn small" data-del-idea="${i.id}" aria-label="Löschen">${icon('trash')}</button>
        </div>`).join('')}</div>` : '<p class="muted">Eigene Ideen erscheinen auch bei den Vorschlägen, wenn sie zu Budget, Wetter und Stimmung passen.</p>'}
    </section>`;

  bindDiscoverTabs();
  on('[data-go]', 'click', (_, el) => go(el.dataset.go));
  on('[data-feed-plan]', 'click', (_, el) => {
    const idea = favRegistry.get(el.dataset.feedPlan) ?? ideaById(el.dataset.feedPlan);
    if (idea) planIdeaNow(idea, el);
  });
  on('[data-del-idea]', 'click', (_, el) => {
    store.update((s) => (s.ideas = s.ideas.filter((i) => i.id !== el.dataset.delIdea)));
    render();
  });
  on('[data-share-idea]', 'click', (_, el) => go('teilen', `idea:${el.dataset.shareIdea}`));
}

/* ================================================================ Eigene Idee */

const EMOJIS = ['💡', '🍷', '🍝', '☕', '🎬', '🏛️', '🎶', '🎭', '🎮', '🌲', '🥾', '🌃', '📸', '📚', '🎁', '✨'];

RENDER.idee = () => {
  const draft = { emoji: '💡', place: 'drinnen', times: 'beides', reach: 1 };
  root.innerHTML = `
    ${topbar({ title: 'Eigene Idee', sub: 'Erscheint bei euren Vorschlägen, wenn Budget, Wetter und Stimmung passen.', back: ['entdecken', '', 'Entdecken'] })}
    <form class="panel form" id="idea-form" novalidate>
      <div class="field"><label class="label" for="i-title">Titel</label><input class="input" id="i-title" required maxlength="60" placeholder="z. B. Picknick am Lieblingssee"></div>
      <div class="field"><span class="label">Symbol</span>${chips('emoji', EMOJIS.map((e) => [e, glyph(e)]), draft.emoji, 'emoji-chips')}</div>
      <div class="field"><label class="label" for="i-teaser">Beschreibung</label><input class="input" id="i-teaser" maxlength="120" placeholder="Ein Satz, worum es geht"></div>
      <div class="field"><span class="label">Wo?</span>${chips('place', [['drinnen', 'Drinnen', 'home'], ['draußen', 'Draußen', 'sun']], draft.place, 'seg')}</div>
      <div class="field"><span class="label">Tageszeit</span>${chips('times', [['tag', 'Tagsüber'], ['abend', 'Abends'], ['beides', 'Beides']], draft.times, 'seg')}</div>
      <div class="field"><span class="label">Wie weit?</span>${chips('reach', [[0, 'Zuhause'], [1, 'In der Stadt'], [2, 'Ausflug']], draft.reach, 'seg')}</div>
      <div class="field"><span class="label">Stimmung (mehrere möglich)</span><div class="chips" id="i-moods">${MOODS.map(([v, l]) => `<button type="button" class="chip" data-m="${v}" aria-pressed="false">${l}</button>`).join('')}</div></div>
      <div class="row gap">
        <div class="field grow"><label class="label" for="i-cost">Kosten für beide (€)</label><input class="input" id="i-cost" type="number" min="0" max="999" inputmode="numeric" value="20"></div>
        <div class="field grow"><label class="label" for="i-start">Startzeit (optional)</label><input class="input" id="i-start" type="time"></div>
      </div>
      <div class="field">
        <label class="label" for="i-steps">Ablauf</label>
        <textarea class="input" id="i-steps" rows="4" placeholder="Eine Station pro Zeile, mit Minuten:&#10;Picknick am See 120&#10;Sonnenuntergang 45"></textarea>
        <small class="muted">Ohne Minutenangabe rechnet die App mit 60 Minuten.</small>
      </div>
      <div class="field"><label class="label" for="i-link">Link oder Ort (optional)</label><input class="input" id="i-link" placeholder="https://… oder Suchbegriff für die Karte"></div>
      <button class="btn primary big" type="submit">${icon('check')}Idee speichern</button>
    </form>`;

  bindBack();
  const form = $('#idea-form');
  bindChips(form, 'emoji', (v) => (draft.emoji = v));
  bindChips(form, 'place', (v) => (draft.place = v));
  bindChips(form, 'times', (v) => (draft.times = v));
  bindChips(form, 'reach', (v) => (draft.reach = Number(v)));
  const moods = new Set();
  $('#i-moods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    moods.has(b.dataset.m) ? moods.delete(b.dataset.m) : moods.add(b.dataset.m);
    b.setAttribute('aria-pressed', String(moods.has(b.dataset.m)));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#i-title').value.trim();
    if (!title) {
      toast('Bitte einen Titel eintragen');
      return $('#i-title').focus();
    }
    const link = $('#i-link').value.trim();
    const isUrl = /^https?:\/\//.test(link);
    let steps = $('#i-steps').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)[\s,–-]*(\d{1,3})\s*(min\.?|minuten)?$/i);
      return m && m[1] ? { t: m[1].trim(), min: Math.max(10, Number(m[2])) } : { t: l, min: 60 };
    });
    if (!steps.length) steps = [{ t: title, min: 120 }];
    if (link) steps[0] = { ...steps[0], ...(isUrl ? { url: link } : { q: link }) };
    const times = draft.times === 'beides' ? ['tag', 'abend'] : [draft.times];
    const start = $('#i-start').value;
    const idea = {
      id: `eigen-${uid()}`,
      title,
      emoji: draft.emoji,
      teaser: $('#i-teaser').value.trim() || 'Eure eigene Idee',
      place: draft.place,
      cost: Math.max(0, Math.round(Number($('#i-cost').value) || 0)),
      reach: draft.reach,
      times,
      moods: [...moods],
      steps,
      ...(start ? { start: Object.fromEntries(times.map((t) => [t, start])) } : {}),
      custom: true,
      createdBy: myRole(),
      createdAt: Date.now(),
    };
    store.update((s) => s.ideas.push(idea));
    toast('Idee gespeichert');
    discover.tab = 'eigene';
    go('entdecken');
  });
};

/** Für das Geschmacksprofil: voller Plan, wenn sichtbar, sonst nur Metadaten. */
function fullPlanOrMeta(d) {
  return fullPlan(d) ?? d;
}

function recommendationsHTML() {
  const recos = recommend(S().dates.map(fullPlanOrMeta), 3);
  if (!recos.length) return '';
  return `
    <section class="stack">
      <h2 class="section-title">Für euch empfohlen</h2>
      <div class="reco-row">
        ${recos.map(({ idea, reason }) => `
          <button class="reco" data-reco="${idea.id}">
            ${ideaThumb(idea, 'wide reco-img')}
            <strong>${esc(idea.title)}</strong>
            <small class="muted">${esc(reason)}</small>
          </button>`).join('')}
      </div>
    </section>`;
}

/* ================================================================ Konto: Anmelden & Registrieren */

const invitePending = () => {
  const c = getConfig();
  return !!(c?.code && !c?.coupleId);
};

RENDER.konto = () => {
  const mode = auth.mode ?? (invitePending() ? 'registrieren' : 'anmelden');
  const tabs = `
    <nav class="seg-tabs" role="tablist">
      <button role="tab" data-amode="anmelden" aria-selected="${mode === 'anmelden'}">Anmelden</button>
      <button role="tab" data-amode="registrieren" aria-selected="${mode === 'registrieren'}">Konto erstellen</button>
    </nav>`;
  const pw = (id, label, auto) => `
    <div class="field"><label class="label" for="${id}">${label}</label>
      <div class="pw-row"><input class="input" id="${id}" type="password" autocomplete="${auto}" minlength="8" required>
      <button type="button" class="icon-btn small pw-toggle" data-show="${id}" aria-pressed="false" aria-label="Passwort anzeigen">${icon('eye')}</button></div></div>`;
  const forms = {
    anmelden: `
      <form class="panel form" id="auth-form" novalidate>
        <div class="field"><label class="label" for="a-email">E-Mail-Adresse</label><input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" required value="${esc(lastEmail())}"></div>
        ${pw('a-pw', 'Passwort', 'current-password')}
        <label class="switch"><input type="checkbox" id="a-remember" ${getRemember() ? 'checked' : ''}><span>Angemeldet bleiben</span></label>
        <button class="btn primary big" type="submit">Anmelden</button>
        <button class="linkish small center" type="button" data-amode="vergessen">Passwort vergessen?</button>
      </form>`,
    registrieren: `
      <form class="panel form" id="auth-form" novalidate>
        <div class="field"><label class="label" for="a-email">E-Mail-Adresse</label><input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" required></div>
        ${pw('a-pw', 'Passwort (mindestens 8 Zeichen)', 'new-password')}
        <button class="btn primary big" type="submit">Konto erstellen</button>
      </form>`,
    vergessen: `
      <form class="panel form" id="auth-form" novalidate>
        <p>Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
        <div class="field"><label class="label" for="a-email">E-Mail-Adresse</label><input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" required></div>
        <button class="btn primary big" type="submit">Link senden</button>
        <button class="linkish small center" type="button" data-amode="anmelden">Zurück zur Anmeldung</button>
      </form>`,
    'neues-passwort': `
      <form class="panel form" id="auth-form" novalidate>
        <p>Lege dein neues Passwort fest.</p>
        ${pw('a-pw', 'Neues Passwort (mindestens 8 Zeichen)', 'new-password')}
        <button class="btn primary big" type="submit">Passwort speichern</button>
      </form>`,
    bestaetigen: `
      <section class="panel stack center">
        <div class="gift-mark small">${icon('check')}</div>
        <h2>Fast geschafft</h2>
        <p>Wir haben eine E-Mail an <strong>${esc(auth.info)}</strong> geschickt. Tippe auf den Link darin – danach bist du angemeldet.</p>
        <p class="muted small">Nichts angekommen? Schau im Spam-Ordner nach.</p>
        <button class="btn" type="button" data-amode="anmelden">Ich habe bestätigt – anmelden</button>
      </section>`,
  };

  root.innerHTML = `
    <section class="auth">
      <div class="auth-brand">
        ${icon('rings', 'brand-mark big')}
        <h1 class="wordmark">Dately</h1>
        <p class="tagline">Made for moments.</p>
      </div>
      ${invitePending() && mode !== 'bestaetigen' ? `<div class="banner neutral-row">${icon('users')}<span>Du wurdest eingeladen. Erstelle ein Konto oder melde dich an – dann seid ihr verbunden.</span></div>` : ''}
      ${mode === 'anmelden' || mode === 'registrieren' ? tabs : ''}
      ${auth.error ? `<p class="warn-text" role="alert">${esc(auth.error)}</p>` : ''}
      ${auth.info && mode !== 'bestaetigen' ? `<p class="hint" role="status">${esc(auth.info)}</p>` : ''}
      ${forms[mode] ?? forms.anmelden}
      <p class="muted small center">Mit dem Konto speichert Dately eure gemeinsamen Dates, Listen und Fotos sicher – nur ihr zwei seht sie.</p>
    </section>`;

  on('[data-amode]', 'click', (_, el) => {
    auth.mode = el.dataset.amode;
    auth.error = '';
    auth.info = '';
    render();
  });
  on('[data-show]', 'click', (_, el) => {
    const input = $(`#${el.dataset.show}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.innerHTML = icon(show ? 'eyeOff' : 'eye');
    el.setAttribute('aria-pressed', String(show));
    el.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
  });
  $('#auth-form')?.addEventListener('input', () => $('.auth .warn-text')?.remove());
  $('#auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter ?? $('#auth-form button[type=submit]');
    const email = $('#a-email')?.value.trim();
    const password = $('#a-pw')?.value ?? '';
    auth.error = '';
    await withBusy(btn, async () => {
      try {
        if (mode === 'anmelden') {
          if (!email || !password) throw new Error('Bitte E-Mail und Passwort eingeben.');
          setRemember($('#a-remember').checked);
          await signIn(auth.cfg, { email, password });
          auth.mode = null;
          await connectRemote(auth.cfg, true);
        } else if (mode === 'registrieren') {
          if (password.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
          setRemember(true);
          const { session } = await signUp(auth.cfg, { email, password, invite: getConfig()?.code ?? null });
          if (session) {
            auth.mode = null;
            await connectRemote(auth.cfg, true);
          } else {
            auth.mode = 'bestaetigen';
            auth.info = email;
            render();
          }
        } else if (mode === 'vergessen') {
          if (!email) throw new Error('Bitte deine E-Mail-Adresse eingeben.');
          await resetPassword(auth.cfg, email);
          auth.mode = 'anmelden';
          auth.info = 'Wenn es ein Konto mit dieser Adresse gibt, ist der Link jetzt unterwegs.';
          render();
        } else if (mode === 'neues-passwort') {
          if (password.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
          await updatePassword(auth.cfg, password);
          auth.mode = null;
          toast('Neues Passwort gespeichert');
          await connectRemote(auth.cfg);
        }
      } catch (err) {
        auth.error = err.message;
        render();
      }
    });
  });
};

/** Supabase ist eingerichtet: angemeldet → verbinden, sonst Anmeldung zeigen. */
async function startAccount(cfg) {
  auth.cfg = cfg;
  try {
    await onAuthChange(cfg, (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        auth.needed = true;
        auth.mode = 'neues-passwort';
        current = { name: 'konto', param: null };
        render();
      } else if (event === 'SIGNED_IN' && auth.needed && auth.mode !== 'neues-passwort') {
        // z. B. nach Klick auf den Bestätigungslink
        auth.mode = null;
        connectRemote(cfg, true);
      }
    });
    const session = await currentSession(cfg);
    if (session && !/type=recovery/.test(location.hash)) return connectRemote(cfg);
    auth.needed = true;
    if (/type=recovery/.test(location.hash)) auth.mode = 'neues-passwort';
    current = { name: 'konto', param: null };
    render(true);
  } catch (e) {
    remoteError = e.message;
    render();
  }
}

/* ================================================================ Einstieg: Namen, besondere Tage, Vorlieben */

const PREF_DIET = [['alles', 'Alles'], ['vegetarisch', 'Vegetarisch'], ['vegan', 'Vegan']];

function onboardingStep() {
  const st = S().settings;
  const role = myRole();
  if (!role) return null;
  if (session.obForce) return session.obForce;
  if (!st.nameA || !st.nameB) return 'namen';
  if (st.onboarded?.[role]) return null;
  return session.obStep ?? 'tage';
}

const specialOf = (kind, who) => S().settings.specialDays.find((d) => d.kind === kind && (!who || d.who === who));

function onboardingCard() {
  const step = onboardingStep();
  if (!step) return '';
  const st = S().settings;
  const role = myRole();
  const partner = other(role);
  const nr = { namen: 1, tage: 2, vorlieben: 3 }[step];
  const head = (title, sub) => `
    <div class="ob-progress"><span class="kicker">Schritt ${nr} von 3</span><span class="dots-row">${[1, 2, 3].map((n) => `<i class="${n <= nr ? 'on' : ''}"></i>`).join('')}</span></div>
    <div class="panel-head">${icon(step === 'namen' ? 'users' : step === 'tage' ? 'heart' : 'sparkle')}<h2>${title}</h2></div>
    <p class="muted small">${sub}</p>`;

  if (step === 'namen') {
    const field = (r, label) => `<div class="field grow"><label class="label" for="nm-${r}">${label}</label><input class="input" id="nm-${r}" maxlength="30" value="${esc(r === 'a' ? st.nameA : st.nameB)}" placeholder="Name" autocomplete="${r === role ? 'given-name' : 'off'}"></div>`;
    return `
      <form class="panel form onboarding" id="ob-form" data-step="namen" novalidate>
        ${head('Wie heißt ihr?', 'Die Namen seht ihr überall in Dately. Ihr könnt sie jederzeit in den Einstellungen ändern.')}
        <div class="row gap wrap">${field(role, 'Dein Name')}${field(partner, 'Name deines Gegenübers')}</div>
        <button class="btn primary" type="submit">Weiter</button>
      </form>`;
  }

  if (step === 'tage') {
    const married = session.obMarried ?? !!(specialOf('standesamt') || specialOf('hochzeit'));
    const val = (kind, who) => esc(specialOf(kind, who)?.date ?? '');
    return `
      <form class="panel form onboarding" id="ob-form" data-step="tage" novalidate>
        ${head('Eure besonderen Tage', 'Dately erinnert euch rechtzeitig und schlägt dann besondere Dates vor. Alles ist freiwillig.')}
        <div class="field"><label class="label" for="ob-anniv">Seit wann seid ihr zusammen?</label><input class="input" type="date" id="ob-anniv" value="${esc(st.anniversary)}"></div>
        <div class="field"><span class="label">Seid ihr verheiratet?</span>${chips('ob-married', [['ja', 'Ja'], ['nein', 'Nein']], married ? 'ja' : 'nein', 'seg')}</div>
        <div class="stack-sm" id="ob-wedding" ${married ? '' : 'hidden'}>
          <div class="field"><label class="label" for="ob-standesamt">Standesamtliche Hochzeit</label><input class="input" type="date" id="ob-standesamt" value="${val('standesamt')}"></div>
          <div class="field"><label class="label" for="ob-hochzeit">Kirchliche oder freie Trauung <small class="muted">(falls an einem anderen Tag)</small></label><input class="input" type="date" id="ob-hochzeit" value="${val('hochzeit')}"></div>
        </div>
        <div class="row gap wrap">
          <div class="field grow"><label class="label" for="ob-geb-${role}">Dein Geburtstag</label><input class="input" type="date" id="ob-geb-${role}" value="${val('geburtstag', role)}"></div>
          <div class="field grow"><label class="label" for="ob-geb-${partner}">Geburtstag ${esc(nameOf(partner))}</label><input class="input" type="date" id="ob-geb-${partner}" value="${val('geburtstag', partner)}"></div>
        </div>
        <div class="row gap"><button class="btn ghost" type="button" data-ob-skip>Überspringen</button><button class="btn primary grow" type="submit">Weiter</button></div>
      </form>`;
  }

  const p = st.prefs?.[role] ?? {};
  const theirs = st.prefs?.[partner];
  return `
    <form class="panel form onboarding" id="ob-form" data-step="vorlieben" novalidate>
      ${head('Was gefällt dir bei Dates?', `Deine Antworten helfen Dately, passende Ideen für euch zu finden.${theirs ? ` ${esc(nameOf(partner))} hat schon geantwortet.` : ` ${esc(nameOf(partner))} beantwortet das auf dem eigenen Handy.`}`)}
      <div class="field"><span class="label">Worauf hast du am meisten Lust? <small class="muted">(bis zu 4)</small></span>
        <div class="chips" id="ob-moods">${MOODS.map(([v, l]) => `<button type="button" class="chip" data-m="${v}" aria-pressed="${(p.moods ?? []).includes(v)}">${l}</button>`).join('')}</div></div>
      <div class="field"><span class="label">Lieber drinnen oder draußen?</span>${chips('ob-place', [['drinnen', 'Drinnen', 'home'], ['draußen', 'Draußen', 'sun'], ['egal', 'Beides']], p.place ?? 'egal', 'seg')}</div>
      <div class="field"><span class="label">Wie isst du?</span>${chips('ob-diet', PREF_DIET, p.diet ?? 'alles', 'seg')}</div>
      <div class="field">
        <div class="label-row"><span class="label">Typisches Budget für ein Date (zu zweit)</span><output id="ob-budget-out" class="budget-out">${p.budget ?? 50} €</output></div>
        <input type="range" id="ob-budget" min="0" max="200" step="5" value="${p.budget ?? 50}" aria-label="Budget in Euro">
      </div>
      <div class="row gap"><button class="btn ghost" type="button" data-ob-skip>Überspringen</button><button class="btn primary grow" type="submit">${icon('check')}Fertig</button></div>
    </form>`;
}

function bindOnboarding() {
  const form = $('#ob-form');
  if (!form) return;
  const step = form.dataset.step;
  const role = myRole();
  const finish = () => {
    store.update((st) => (st.settings.onboarded = { ...(st.settings.onboarded ?? {}), [role]: true }));
    session.obStep = null;
    session.obForce = null;
    toast('Alles eingerichtet – viel Freude mit Dately!');
    render(true);
  };
  const next = (s) => {
    if (session.obForce) session.obForce = s;
    else session.obStep = s;
    render();
    $('#ob-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $$('[data-ob-skip]', form).forEach((b) => b.addEventListener('click', () => (step === 'tage' ? next('vorlieben') : finish())));

  if (step === 'tage') {
    bindChips(form, 'ob-married', (v) => {
      session.obMarried = v === 'ja';
      $('#ob-wedding').hidden = v !== 'ja';
    });
  }
  const moods = new Set(S().settings.prefs?.[role]?.moods ?? []);
  const prefs = { place: S().settings.prefs?.[role]?.place ?? 'egal', diet: S().settings.prefs?.[role]?.diet ?? 'alles', budget: S().settings.prefs?.[role]?.budget ?? 50 };
  if (step === 'vorlieben') {
    $('#ob-moods').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const v = b.dataset.m;
      if (moods.has(v)) moods.delete(v);
      else if (moods.size < 4) moods.add(v);
      else toast('Höchstens vier – entferne erst eine');
      b.setAttribute('aria-pressed', String(moods.has(v)));
    });
    bindChips(form, 'ob-place', (v) => (prefs.place = v));
    bindChips(form, 'ob-diet', (v) => (prefs.diet = v));
    $('#ob-budget').addEventListener('input', (e) => {
      prefs.budget = Number(e.target.value);
      $('#ob-budget-out').textContent = `${prefs.budget} €`;
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (step === 'namen') {
      const a = $('#nm-a').value.trim();
      const b = $('#nm-b').value.trim();
      if (!a || !b) return toast('Bitte beide Namen eintragen');
      store.update((st) => Object.assign(st.settings, { nameA: a, nameB: b }));
      return next('tage');
    }
    if (step === 'tage') {
      const married = !$('#ob-wedding').hidden;
      store.update((st) => {
        st.settings.anniversary = $('#ob-anniv').value || st.settings.anniversary;
        const setDay = (kind, who, date) => {
          const id = `sp-${kind}${who ? `-${who}` : ''}`;
          st.settings.specialDays = st.settings.specialDays.filter((d) => d.id !== id && !(d.kind === kind && (!who || d.who === who)));
          if (date) st.settings.specialDays.push({ id, kind, who: who ?? null, name: '', date });
        };
        setDay('standesamt', null, married ? $('#ob-standesamt').value : '');
        setDay('hochzeit', null, married ? $('#ob-hochzeit').value : '');
        setDay('geburtstag', 'a', $('#ob-geb-a').value);
        setDay('geburtstag', 'b', $('#ob-geb-b').value);
      });
      return next('vorlieben');
    }
    store.update((st) => {
      st.settings.prefs = { ...(st.settings.prefs ?? {}), [role]: { moods: [...moods], ...prefs } };
      if (prefs.diet === 'vegan') st.settings.vegan = true;
    });
    L().lastSearch.budget = prefs.budget;
    store.saveLocal();
    finish();
  });
}

/* ================================================================ 1. Start */

function inboxItems() {
  const s = S();
  const role = myRole();
  const t = isoDate(today());
  const items = [];
  const rs = rhythmStatus(s.dates, s.settings.datesPerMonth);
  const turn = nextPlanner();
  const openReq = s.requests.some((x) => x.status === 'open');
  if (role && rs.due && !openReq) {
    items.push(turn === role ? `
      <article class="inbox-item accent">
        <div class="inbox-ico">${icon('sparkle')}</div>
        <div class="grow"><strong>Du bist dran mit Planen</strong><p>Euer nächstes Date ist fällig – überrasch ${esc(nameOf(other(role)))}!</p></div>
        <button class="btn primary sm" data-scroll-form>Planen</button>
      </article>` : `
      <article class="inbox-item">
        <div class="inbox-ico">${icon('clock')}</div>
        <div class="grow"><strong>${esc(nameOf(turn))} ist dran mit Planen</strong><p>Euer nächstes Date ist fällig.</p></div>
      </article>`);
  }

  for (const r of s.requests.filter((x) => x.status === 'open')) {
    if (r.to === role) {
      items.push(`
        <article class="inbox-item accent">
          <div class="inbox-ico">${icon('gift')}</div>
          <div class="grow">
            <strong>${esc(nameOf(r.from))} wünscht sich ein Date von dir</strong>
            <p>${ctxLine(r.ctx)}${r.note ? ` · „${esc(r.note)}“` : ''}</p>
          </div>
          <button class="btn primary sm" data-plan-request="${r.id}">Planen</button>
        </article>`);
    } else if (r.from === role) {
      items.push(`
        <article class="inbox-item">
          <div class="inbox-ico">${icon('clock')}</div>
          <div class="grow">
            <strong>${esc(nameOf(r.to))} plant euer Date</strong>
            <p>${ctxLine(r.ctx)} · Lass dich überraschen</p>
          </div>
          <button class="btn ghost sm" data-cancel-request="${r.id}">Zurückziehen</button>
        </article>`);
    }
  }

  // Pro Art nur die neueste offene Umfrage zeigen
  const latestSurvey = {};
  for (const p of s.polls.filter((x) => x.status === 'open' && x.stage === 'survey')) {
    const k = p.kind ?? 'full';
    if (!latestSurvey[k] || p.createdAt > latestSurvey[k].createdAt) latestSurvey[k] = p;
  }
  delete latestSurvey.day; // „Welcher Tag passt?“ gibt es nur im Kalender
  for (const p of Object.values(latestSurvey)) {
    const mine = !!p.survey?.[role];
    const theirs = !!p.survey?.[other(role)];
    const label = mine && theirs ? 'Beide fertig – Ergebnis ansehen' : mine ? `Warte auf ${esc(nameOf(other(role)))}` : `${p.createdBy === role ? 'Deine' : `${esc(nameOf(p.createdBy))} wartet auf deine`} Antworten (1 Minute)`;
    items.push(`
      <article class="inbox-item ${!mine || theirs ? 'accent' : ''}">
        <div class="inbox-ico">${icon(p.kind === 'day' ? 'calendar' : 'vote')}</div>
        <div class="grow"><strong>${p.kind === 'day' ? 'Welcher Tag passt euch?' : 'Worauf habt ihr Lust?'}</strong><p>${label}</p></div>
        <button class="btn ${!mine || theirs ? 'primary' : ''} sm" data-open-poll="${p.id}">${!mine ? 'Antworten' : 'Öffnen'}</button>
      </article>`);
  }

  for (const p of s.polls.filter((x) => x.status === 'open' && x.stage !== 'survey')) {
    const st = pollState(p);
    const label = st.bothDone
      ? st.matches.length ? `Match: ${esc(ideaById(st.matches[0])?.title ?? '')}` : 'Kein Match – neue Runde?'
      : st.mineDone ? `Warte auf ${esc(nameOf(other(role)))}` : 'Deine Stimme fehlt noch';
    items.push(`
      <article class="inbox-item ${!st.mineDone || st.bothDone ? 'accent' : ''}">
        <div class="inbox-ico">${icon('vote')}</div>
        <div class="grow"><strong>Abstimmung für ${relDay(p.ctx.date) ?? fmtShort(p.ctx.date)}</strong><p>${label}</p></div>
        <button class="btn ${!st.mineDone || st.bothDone ? 'primary' : ''} sm" data-open-poll="${p.id}">${!st.mineDone ? 'Abstimmen' : 'Öffnen'}</button>
      </article>`);
  }

  for (const d of s.dates.filter((x) => role && dateIsOver(x) && !isHiddenFromMe(x) && !x.ratings?.[role] && daysBetween(parseISO(x.date), today()) <= 21).slice(0, 2)) {
    items.push(`
      <article class="inbox-item accent">
        <div class="inbox-ico">${icon('heart')}</div>
        <div class="grow"><strong>Wie war „${esc(dateTitle(d))}“?</strong><p>${relDay(d.date) ?? fmtShort(d.date)} · Bewertet euer Date – Dately lernt, was euch gefällt.</p></div>
        <button class="btn primary sm" data-open-date="${d.id}">Bewerten</button>
      </article>`);
  }

  for (const d of s.dates.filter((x) => isHiddenFromMe(x) && x.date >= t)) {
    const n = daysBetween(today(), parseISO(d.date));
    items.push(`
      <article class="inbox-item gift">
        <div class="inbox-ico">${icon('gift')}</div>
        <div class="grow">
          <strong>Überraschung von ${esc(nameOf(d.plannedBy))}</strong>
          <p>${n === 0 ? 'Heute' : n === 1 ? 'Morgen' : `In ${n} Tagen`}, ${d.start} Uhr${d.hint ? ` · Hinweis: ${esc(d.hint)}` : ''}</p>
        </div>
        <button class="btn sm" data-open-date="${d.id}">Ansehen</button>
      </article>`);
  }

  for (const sp of upcomingSpecials(s.settings, 21).slice(0, 2)) {
    const when = sp.days === 0 ? 'heute' : sp.days === 1 ? 'morgen' : `in ${sp.days} Tagen`;
    items.push(`
      <article class="inbox-item special">
        <div class="inbox-ico special">${icon(sp.kind === 'geburtstag' ? 'gift' : sp.kind === 'sonstiges' ? 'star' : 'heart')}</div>
        <div class="grow"><strong>${esc(sp.label)} ${when}</strong><p>${fmtDate(sp.iso)}</p></div>
        <button class="btn sm" data-special="${sp.iso}">Date planen</button>
      </article>`);
  }
  return items;
}

function nextPlanner() {
  const t = S().settings.nextTurn;
  if (t === 'a' || t === 'b') return t;
  const last = [...S().dates]
    .filter((d) => d.plannedBy === 'a' || d.plannedBy === 'b')
    .sort((x, y) => (y.date + y.start).localeCompare(x.date + x.start))[0];
  return last ? other(last.plannedBy) : 'a';
}

RENDER.start = () => {
  kickArea();
  const s = S();
  const f = { ...L().lastSearch };
  const role = myRole();
  const partner = other(role);
  const r = rhythmStatus(s.dates, s.settings.datesPerMonth);
  const pct = Math.min(100, Math.round((r.thisMonth / r.goal) * 100));
  const inbox = inboxItems();
  const hasNames = s.settings.nameA || s.settings.nameB;
  const np = nextPlanner();
  // „Wer plant?“ folgt der Reihe, bis jemand selbst etwas anderes wählt.
  if (!session.plannerTouched && role) f.planner = np === role ? 'me' : 'partner';

  root.innerHTML = `
    <header class="home-head">
      <div class="brand">${icon('rings', 'brand-mark')}<span>Dately</span></div>
      <div class="row gap">${syncChip()}${settingsButton()}</div>
    </header>
    <section class="hello">
      <p class="eyebrow">${hasNames ? `${esc(nameOf('a'))} & ${esc(nameOf('b'))}` : 'Zeit zu zweit'}</p>
      <h1>${role ? `Hallo ${esc(nameOf(role))}.` : 'Worauf habt ihr Lust?'}</h1>
    </section>

    ${whoAmICard()}
    ${onboardingCard()}

    ${inbox.length ? `<section class="stack"><h2 class="section-title">Für dich</h2>${inbox.join('')}</section>` : ''}

    ${today().getMonth() === 11 || (today().getMonth() === 0 && today().getDate() <= 20) ? `<button class="book-teaser" data-go-book>${icon('book')}<span class="grow"><strong>Euer Jahresrückblick ist da</strong><br><small class="muted">Alle Dates ${today().getMonth() === 0 ? today().getFullYear() - 1 : today().getFullYear()} als Fotobuch</small></span>${icon('right')}</button>` : ''}
    ${recommendationsHTML()}

    <section class="rhythm ${r.due ? 'due' : ''}">
      <div class="rhythm-top">
        <div>
          <span class="kicker">${MONTHS[today().getMonth()]}</span>
          <strong class="rhythm-num">${r.thisMonth}<span>/${r.goal}</span></strong>
          <span class="muted">Dates</span>
        </div>
        <div class="rhythm-side">
          ${r.due ? `<span class="tag warn">Date fällig</span>` : r.thisMonth >= r.goal ? `<span class="tag ok">Ziel erreicht</span>` : ''}
          <span class="turn">${icon('repeat')}Diesmal plant <strong>${np === role ? 'du' : esc(nameOf(np))}</strong></span>
          <button type="button" class="linkish small" id="swap-turn">Tauschen</button>
        </div>
      </div>
      <span class="progress"><span style="width:${pct}%"></span></span>
    </section>

    <form class="panel form" id="start-form" novalidate>
      <div class="panel-head">${icon('sparkle')}<h2>Neues Date</h2></div>
      <div class="field">
        <span class="label">Wer plant?</span>
        ${chips('planner', [
          ['me', role ? 'Ich' : 'Ich', 'user'],
          ['partner', partner ? esc(nameOf(partner)) : 'Andere Person', 'gift'],
          ['both', 'Zusammen', 'users'],
        ], f.planner, 'seg')}
        <p class="hint" id="planner-hint"></p>
      </div>
      <div class="field only-solo">
        <span class="label">Wann?</span>
        ${chips('when', [['tonight', 'Heute Abend'], ['weekend', 'Wochenende'], ['date', 'Datum wählen']], f.when)}
        <input type="date" id="f-date" class="input" value="${esc(f.date && f.date >= isoDate(today()) ? f.date : isoDate(addDays(today(), 1)))}" min="${isoDate(today())}" ${f.when === 'date' ? '' : 'hidden'}>
        <div id="conflicts"></div>
      </div>
      <div class="field" id="daytime-field" ${f.when === 'tonight' ? 'hidden' : ''}>
        <span class="label">Tageszeit</span>
        ${chips('daytime', [['tag', 'Tagsüber', 'sun'], ['abend', 'Abends', 'moon']], f.daytime)}
      </div>
      <div class="field only-solo">
        <div class="label-row"><span class="label">Budget für euch beide</span><output id="budget-out" class="budget-out">${f.budget} €</output></div>
        <input type="range" id="f-budget" min="0" max="200" step="5" value="${f.budget}" aria-label="Budget in Euro">
        <div class="scale"><span>0 €</span><span>50</span><span>100</span><span>150</span><span>200 €</span></div>
      </div>
      <div class="field only-solo">
        <span class="label">Wie weit darf es sein?</span>
        ${radiusChips('reach', f.radiusKm ?? reachToKm(f.reach), { home: true })}
      </div>
      <div class="field only-solo">
        <span class="label">Stimmung</span>
        ${chips('fmood', [['', 'Egal'], ...MOODS.map(([v, l]) => [v, l])], f.mood ?? '')}
      </div>
      <div class="field" id="city-field">
        <label class="label" for="f-city">Stadt</label>
        <div class="row gap">
          <div class="input-ico grow">${icon('pin')}<input id="f-city" class="input" placeholder="z. B. München" value="${esc(currentPlaceName())}" autocomplete="address-level2"></div>
          <button type="button" class="btn square" id="f-gps" aria-label="Meinen Standort verwenden" title="Meinen Standort verwenden">${icon('locate')}</button>
        </div>
        <small class="muted" id="gps-info">${L().geo && L().geo.name === currentPlaceName() ? 'Aktueller Standort · Wetter wird automatisch geprüft' : ''}</small>
      </div>
      <div class="field" id="note-field" hidden>
        <label class="label" for="f-note">Wunsch oder Hinweis (optional)</label>
        <input id="f-note" class="input" placeholder="z. B. Gern etwas Ruhiges" maxlength="120">
      </div>
      <button class="btn primary big" id="f-submit" type="submit"></button>
    </form>`;

  const form = $('#start-form');
  const updatePlanner = () => {
    const p = f.planner;
    const pn = partner ? nameOf(partner) : 'die andere Person';
    $('#planner-hint').textContent =
      p === 'me' ? `Du suchst die Idee aus und kannst sie als Überraschung vor ${pn} geheim halten.`
        : p === 'partner' ? `${pn} bekommt eine Anfrage und plant eine Überraschung für dich.`
          : 'Ihr beantwortet beide kurz, wann ihr Zeit habt und worauf ihr Lust habt. Daraus macht die App Vorschläge, über die ihr abstimmt.';
    $('#f-submit').innerHTML = p === 'me' ? `${icon('sparkle')}Ideen finden` : p === 'partner' ? `${icon('gift')}Anfrage an ${esc(pn)} senden` : `${icon('vote')}Umfrage starten`;
    $('#note-field').hidden = p !== 'partner';
    $$('.only-solo', form).forEach((el) => (el.hidden = p === 'both'));
    $('#daytime-field').hidden = p === 'both' || f.when === 'tonight';
  };
  updatePlanner();
  const showConflicts = () => {
    const iso = resolveDate({ ...f, date: $('#f-date').value });
    $('#conflicts').innerHTML = conflictsHTML(iso);
  };
  showConflicts();
  $('#f-date').addEventListener('change', showConflicts);
  $('#f-gps').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await withBusy(btn, async () => {
      try {
        const g = await useGps();
        $('#f-city').value = g.name;
        $('#gps-info').textContent = 'Aktueller Standort · Wetter wird automatisch geprüft';
      } catch (err) {
        $('#gps-info').textContent = err.message;
      }
    });
  });

  $('#f-budget').addEventListener('input', (e) => {
    f.budget = Number(e.target.value);
    $('#budget-out').textContent = `${f.budget} €`;
  });
  bindChips(form, 'planner', (v) => {
    session.plannerTouched = true;
    f.planner = v;
    updatePlanner();
  });
  bindChips(form, 'when', (v) => {
    f.when = v;
    setTimeout(showConflicts);
    $('#f-date').hidden = v !== 'date';
    $('#daytime-field').hidden = v === 'tonight' || f.planner === 'both';
  });
  bindChips(form, 'daytime', (v) => (f.daytime = v));
  bindRadius(form, 'reach', (km) => {
    f.radiusKm = km;
    f.reach = kmToReach(km);
  });
  bindChips(form, 'fmood', (v) => (f.mood = v));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!myRole()) {
      toast('Wähle zuerst oben, wer du bist');
      $('.who')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    f.date = $('#f-date').value;
    if (f.when === 'tonight') f.daytime = 'abend';
    L().lastSearch = { ...f };
    store.saveLocal();
    const radiusKm = f.radiusKm ?? reachToKm(f.reach);
    const ctx = { date: resolveDate(f), daytime: f.daytime, budget: f.budget, reach: kmToReach(radiusKm), radiusKm, mood: f.mood || '' };
    const city = $('#f-city').value.trim();

    if (f.planner === 'partner') {
      const note = $('#f-note').value.trim();
      store.update((st) => st.requests.push({ id: uid(), from: myRole(), to: other(myRole()), ctx, note, status: 'open', createdAt: Date.now() }));
      if (city) ensureGeo(city);
      toast(`Anfrage an ${nameOf(other(myRole()))} gesendet`);
      render(true);
      return;
    }
    if (f.planner === 'both') {
      if (city) ensureGeo(city);
      return go('poll', createSurvey('full'));
    }
    const btn = $('#f-submit');
    await withBusy(btn, async () => {
      await prepareSession(ctx, city);
      go('suggest');
    });
  });

  bindWhoAmI();
  bindOnboarding();
  $('#swap-turn')?.addEventListener('click', () => {
    store.update((st) => (st.settings.nextTurn = other(np)));
    session.plannerTouched = false;
    toast(`Diesmal plant ${other(np) === role ? 'du' : nameOf(other(np))}`);
    render();
  });
  on('[data-go]', 'click', (_, el) => go(el.dataset.go));
  on('[data-go-book]', 'click', () => go('rueckblick', String(today().getMonth() === 0 ? today().getFullYear() - 1 : today().getFullYear())));
  on('[data-reco]', 'click', (_, el) => {
    const idea = ideaById(el.dataset.reco);
    if (idea) planIdeaNow(idea, el);
  });
  on('[data-plan-request]', 'click', async (_, el) => {
    const req = S().requests.find((x) => x.id === el.dataset.planRequest);
    if (!req) return;
    await withBusy(el, async () => {
      await prepareSession({ ...req.ctx }, null);
      session.requestId = req.id;
      go('suggest');
    });
  });
  on('[data-cancel-request]', 'click', (_, el) => {
    store.update((st) => (st.requests = st.requests.filter((x) => x.id !== el.dataset.cancelRequest)));
    render();
  });
  on('[data-open-poll]', 'click', (_, el) => go('poll', el.dataset.openPoll));
  on('[data-open-date]', 'click', (_, el) => go('date', el.dataset.openDate));
  on('[data-scroll-form]', 'click', () => $('#start-form').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  on('[data-special]', 'click', async (_, el) => {
    if (!myRole()) return toast('Wähle zuerst oben, wer du bist');
    await withBusy(el, async () => {
      await prepareSession({ date: el.dataset.special, daytime: 'abend', budget: Math.max(150, f.budget), reach: 2, special: true }, null);
      go('suggest');
    });
  });
};

async function withBusy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    await fn();
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }
}

async function ensureGeo(cityInput) {
  const s = S();
  const city = cityInput || s.settings.city;
  if (!city) return null;
  if (s.settings.geo && s.settings.city.toLowerCase() === city.toLowerCase()) return s.settings.geo;
  try {
    const geo = await geocode(city);
    if (geo) {
      store.update((st) => {
        st.settings.city = geo.name;
        st.settings.geo = geo;
      });
      return geo;
    }
  } catch {
    /* kein Netz oder gesperrt: Stadt trotzdem merken */
  }
  if (city !== s.settings.city) store.update((st) => (st.settings.city = city));
  return null;
}

async function prepareSession(ctx, city) {
  const special = ctx.special ?? !!nearSpecial(S().settings, parseISO(ctx.date));
  const gps = L().geo;
  let geo;
  if (gps && (!city || city === gps.name)) geo = gps;
  else if (!city && !S().settings.city) geo = await useGps().catch(() => null);
  else geo = await ensureGeo(city);
  session.ctx = { ...ctx, special };
  session.weather = await getWeather(geo, ctx.date, ctx.daytime);
  session.shown = new Set();
  session.requestId = null;
  session.pollId = null;
  session.backTo = null;
  await reroll();
}

async function reroll(count = 3) {
  const recentIds = S().dates.slice(-8).map((d) => d.ideaId).filter(Boolean);
  const res = await suggest(session.ctx, session.weather, { exclude: session.shown, recentIds, count, dates: S().dates.map(fullPlanOrMeta) });
  session.moodRelaxed = res.moodRelaxed;
  if (res.exhausted) session.shown = new Set();
  res.ideas.forEach((i) => session.shown.add(i.id));
  session.current = res.ideas;
  session.exhausted = res.exhausted;
  return res.ideas;
}

/* ================================================================ 2. Vorschläge */

function weatherBanner(w) {
  if (!w.known) {
    return `
      <div class="banner neutral">
        <div class="grow"><strong>Wetter unbekannt.</strong> ${esc(w.reason ?? '')}. Wie wird es?</div>
        ${chips('wx', [['sun', 'Schön', 'sun'], ['cold', 'Kalt', 'cloud'], ['rain', 'Regen', 'rain']], '')}
      </div>`;
  }
  const t = w.temp != null ? `, ${w.temp}°` : '';
  if (w.wet) return `<div class="banner rain">${icon('rain')}<span><strong>${esc(w.label)}${t}</strong> – nur Ideen für drinnen.</span></div>`;
  if (w.cold) return `<div class="banner cold">${icon('cloud')}<span><strong>${esc(w.label)}${t}</strong> – drinnen wird bevorzugt.</span></div>`;
  return `<div class="banner sun">${icon('sun')}<span><strong>${esc(w.label)}${t}</strong> – gut für draußen.</span></div>`;
}

function bindWeatherChips(after) {
  bindChips(root, 'wx', async (v) => {
    session.weather = manualWeather(v);
    session.shown = new Set();
    await after();
  });
}

function ideaCard(i, extra = '') {
  return `
    <article class="idea" data-idea="${i.id}">
      <div class="idea-top">
        ${ideaThumb(i, 'ideaico')}
        <div class="grow">
          <h3>${esc(i.title)}</h3>
          <p class="teaser">${esc(i.teaser)}</p>
        </div>
        ${favBtn(i)}
      </div>
      <dl class="facts">
        <div><dt>${icon(i.place === 'drinnen' ? 'home' : 'sun')}</dt><dd>${i.place === 'drinnen' ? 'Drinnen' : 'Draußen'}</dd></div>
        <div><dt>${icon('euro')}</dt><dd>${fmtEuro(i.cost)}</dd></div>
        <div><dt>${icon('clock')}</dt><dd>${fmtDuration(ideaDuration(i))}</dd></div>
        ${i.special ? `<div class="special"><dt>${icon('star')}</dt><dd>Besonders</dd></div>` : ''}
      </dl>
      <p class="flow">${i.steps.map((s) => esc(s.t)).join('<span aria-hidden="true"> → </span>')}</p>
      ${extra}
    </article>`;
}

RENDER.suggest = () => {
  const { ctx, weather, current: ideas } = session;
  if (!ctx) return go('start');
  const req = session.requestId ? S().requests.find((r) => r.id === session.requestId) : null;
  const sp = ctx.special ? nearSpecial(S().settings, parseISO(ctx.date)) : null;

  root.innerHTML = `
    ${topbar({ title: 'Eure Vorschläge', sub: `${ctxLine(ctx)} · ${REACH[ctx.reach]}`, back: ['start', '', 'Ändern'], eyebrow: req ? `Wunsch von ${esc(nameOf(req.from))}${req.note ? ` · „${esc(req.note)}“` : ''}` : '' })}
    ${weatherBanner(weather)}
    ${sp ? `<div class="banner special">${icon('star')}<span><strong>${esc(sp.label)}</strong> – besondere Ideen zuerst.</span></div>` : ''}
    <div class="ideas">
      ${ideas.length ? ideas.map((i) => ideaCard(i, `<button class="btn primary" data-pick="${i.id}">Diesen Plan ansehen ${icon('right')}</button>`)).join('') : `
        <div class="empty">
          <p><strong>Nichts gefunden, das passt.</strong><br>Erhöht das Budget oder die Entfernung.</p>
          <button class="btn" data-back="start">Eingaben ändern</button>
        </div>`}
    </div>
    ${ideas.length ? `<button class="btn soft big" id="reroll">${icon('dice')}Andere Ideen</button>` : ''}
    ${session.moodRelaxed && ideas.length ? `<p class="hint">Keine Idee passt zu „${esc(moodLabel(ctx.mood))}“ und den übrigen Wünschen – hier die besten anderen.</p>` : ''}
    ${session.exhausted ? '<p class="hint center">Das waren alle passenden Ideen. Es geht von vorne los.</p>' : ''}`;

  bindBack();
  bindWeatherChips(async () => {
    await reroll();
    render();
  });
  on('[data-pick]', 'click', (_, el) => go('plan', el.dataset.pick));
  $('#reroll')?.addEventListener('click', async () => {
    await reroll();
    render(true);
  });
};

/* ================================================================ 3. Plan */

function timeline(plan, extra = () => '') {
  return `
    <ol class="timeline">
      ${plan.steps.map((s, i) => `
        <li>
          <time>${s.time}</time>
          <div class="tl-body">
            <strong>${esc(s.title)}</strong>
            ${s.note ? `<p class="note-text">${esc(s.note)}</p>` : ''}
            ${s.place ? placeLine(s.place, plan.date, s.time) : ''}
            ${s.links?.length ? `<div class="links">${s.links.map((l) => `<a class="link" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}${icon('external')}</a>`).join('')}</div>` : ''}
            ${extra(i)}
          </div>
        </li>`).join('')}
      <li class="end"><time>${plan.end}</time><div class="tl-body"><span class="muted">Ende</span></div></li>
    </ol>`;
}

function planHead(plan, eyebrow = '') {
  const day = relDay(plan.date);
  return `
    <header class="plan-head">
      <span class="plan-emoji" aria-hidden="true">${glyph(plan.emoji)}</span>
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      <h1>${esc(plan.title)}</h1>
      <p class="sub">${day ? day + ', ' : ''}${fmtDate(plan.date)} · ${plan.start}–${plan.end} Uhr</p>
      <div class="pills">
        ${weatherPill(plan.weather)}
        <span class="pill">${icon('euro')}${fmtEuro(plan.cost)}</span>
        <span class="pill">${icon('clock')}${fmtDuration(plan.duration)}</span>
      </div>
    </header>`;
}


/* --- Plan zusammensetzen: Idee, Dauer, Wege ----------------------------------- */

const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
const round15 = (m) => Math.max(15, Math.round(m / 15) * 15);

/** Mögliche weitere Stationen, wenn das Date länger dauern soll. */
function extensionsFor(lastCat, endTime) {
  const evening = endTime >= '17:00' || endTime < '04:00';
  const dinner = { t: 'Abendessen', q: 'Restaurant', min: 105, food: true, cost: 60 };
  const lunch = { t: 'Essen', q: 'Restaurant', min: 90, food: true, cost: 40 };
  const coffee = { t: 'Kaffee & Kuchen', q: 'Café', min: 60, food: true, cost: 20 };
  const drink = { t: 'Drink zum Ausklang', q: 'Bar', min: 60, cost: 30 };
  const walk = { t: 'Spaziergang', q: 'Park', min: 60 };
  const dessert = { t: 'Eis oder Dessert', q: 'Eisdiele', min: 30, food: true, cost: 12 };
  const late = endTime >= '20:30' || endTime < '04:00';
  if (late) return [drink, dessert];
  if (['restaurant', 'wine', 'xmas', 'beergarden'].includes(lastCat)) return evening ? [drink, dessert] : [walk, coffee];
  if (lastCat === 'bar') return [dinner, dessert];
  if (['cafe', 'icecream'].includes(lastCat)) return evening ? [dinner, drink] : [walk, lunch];
  return evening ? [dinner, drink] : [coffee, lunch, walk];
}

/** Stationen der Idee inkl. gewählter Variante und – bei gewünschter Dauer – weiteren Stationen. */
function effectiveSteps(idea, draft, ctx) {
  const steps = idea.steps.map((x) => ({ ...x }));
  const v = idea.variants?.[draft.variant ?? 0];
  if (v) {
    const k = steps.findIndex((x) => x.t === v.step);
    if (k >= 0) steps[k] = { ...steps[k], note: `${v.name} – ${v.text}` };
  }
  if (draft.duration && idea.reach !== 0) {
    const cats = steps.map((x) => x.cat ?? catForStep(x, ctx.date));
    let sum = steps.reduce((a, x) => a + x.min, 0);
    for (let n = 0; n < 2 && draft.duration - sum >= 75 && cats.some(Boolean); n++) {
      const lastCat = [...cats].reverse().find(Boolean);
      const ext = extensionsFor(lastCat, addMinutes(draft.start, sum)).find((e) => !cats.includes(catForStep(e, ctx.date)));
      if (!ext) break;
      steps.push({ ...ext, ext: true });
      cats.push(catForStep(ext, ctx.date));
      sum += ext.min;
    }
  }
  return steps;
}

/** Wege zwischen den Orten einfügen und die Zeit auf die gewünschte Dauer verteilen. */
function timedSteps(steps, draft, from) {
  const out = [];
  const map = [];
  let prev = from;
  let travel = 0;
  const hasPlaces = steps.some((x) => x.place?.lat != null);
  steps.forEach((x, i) => {
    const p = x.place;
    if (hasPlaces && from && !p && /^anfahrt\b/i.test(x.t ?? '')) return; // wird unten als echte Anfahrt berechnet
    if (p?.lat != null && prev?.lat != null) {
      const km = distanceKm(prev, p);
      if (km > (prev === from ? 0.3 : 0.15)) {
        const opts = travelEstimates(km);
        const t = opts.find((o) => o.mode === (km < 1.5 ? 'walking' : 'driving')) ?? opts[0];
        const min = round5(t.min);
        out.push({ t: prev === from ? `Anfahrt zu ${p.name}` : `Weg zu ${p.name}`, min, travel: true, note: `${fmtKm(km)} · ca. ${fmtMin(t.min)} ${t.mode === 'walking' ? 'zu Fuß' : 'mit dem Auto'}`, from: { lat: prev.lat, lon: prev.lon }, to: { lat: p.lat, lon: p.lon }, mode: t.mode });
        map.push(-1);
        travel += min;
      }
    }
    out.push({ ...x });
    map.push(i);
    if (p?.lat != null) prev = p;
  });
  if (draft.duration) {
    const base = out.filter((x) => !x.travel).reduce((a, x) => a + x.min, 0);
    const factor = Math.min(3, Math.max(0.5, (draft.duration - travel) / Math.max(base, 1)));
    out.forEach((x) => {
      if (!x.travel) x.min = round15(x.min * factor);
    });
  }
  return { steps: out, map };
}

RENDER.plan = (ideaId) => {
  const idea = ideaById(ideaId);
  const ctx = session.ctx;
  if (!idea || !ctx) return go('start');
  const role = myRole();
  const partner = other(role);
  const fromPoll = !!session.pollId;
  const draft = (drafts[ideaId] ??= { start: defaultStart(idea, ctx.daytime), surprise: !fromPoll, hint: '', picks: {}, near: null, openAlt: null, duration: idea.reach === 0 ? null : feedFilter.duration, variant: 0 });
  const baseSteps = effectiveSteps(idea, draft, ctx);
  const stepCats = baseSteps.map((s) => s.cat ?? catForStep(s, ctx.date));
  const center = discoverCenter();
  const wantsPlaces = stepCats.some(Boolean) && ctx.reach !== 0 && !store.inArtifact();
  const nearKey = stepCats.join('|');
  if (draft.nearKey !== nearKey) {
    draft.near = null;
    draft.nearKey = nearKey;
  }
  if (wantsPlaces && center && !draft.near && !draft.nearLoading) loadStepPlaces(baseSteps, draft, stepCats, center, ctx);
  // Gewählte Orte in die Stationen einsetzen
  const picked = baseSteps.map((s, i) => {
    const p = draft.picks[i] && placeIndex.get(draft.picks[i]);
    return p ? { ...s, note: s.place?.id && s.place.id !== p.id ? '' : s.note, t: `${s.label ?? s.t}: ${p.name}`, place: { id: p.id, name: p.name, street: p.street, city: p.city, lat: p.lat, lon: p.lon, website: p.website, hours: p.hours, price: p.price, image: p.image, category: p.category, wikipedia: p.wikipedia } } : s;
  });
  const timed = timedSteps(picked, draft, ctx.reach !== 0 ? center : null);
  const variant = idea.variants?.[draft.variant ?? 0];
  const recipe = variant ? { name: variant.name, url: variant.url ?? '', ingredients: variant.materials } : idea.recipe;
  const plan = buildPlan({ ...idea, steps: timed.steps, recipe }, { ...ctx, start: draft.start }, S().settings, session.weather);
  if (variant) plan.title = `${idea.title}: ${variant.name}`;
  if (idea.generated && !idea.event) {
    const names = picked.map((x) => x.place?.name).filter(Boolean);
    if (names.length) plan.title = names.join(' & ');
  }
  plan.cost = (idea.cost ?? 0) + baseSteps.filter((x) => x.ext).reduce((a, x) => a + (x.cost ?? 0), 0);
  const stepExtra = (k) => {
    const i = timed.map[k];
    if (i === -1) {
      const t = timed.steps[k];
      return `<div class="links"><a class="link" href="https://www.google.com/maps/dir/?api=1&origin=${t.from.lat},${t.from.lon}&destination=${t.to.lat},${t.to.lon}&travelmode=${t.mode}" target="_blank" rel="noopener">Route${icon('external')}</a></div>`;
    }
    if (!stepCats[i] || !wantsPlaces) return '';
    if (!center) return `<p class="muted small">Erlaube den Standort oder trag eine Stadt ein, dann schlägt Dately hier konkrete Orte vor.</p>`;
    if (draft.nearLoading && !draft.near) return `<p class="muted small"><span class="spinner tiny"></span> Suche passende Orte in der Nähe …</p>`;
    const list = draft.near?.[i] ?? [];
    if (!list.length && draft.nearError) return `<p class="muted small">Die Kartendaten sind gerade nicht erreichbar.</p><button type="button" class="btn sm soft" data-near-retry>${icon('repeat')}Nochmal suchen</button>`;
    if (!list.length) {
      if (!draft.near) return '';
      const cat = categoryById(stepCats[i]);
      const place = center.name && center.name !== 'Mein Standort' ? center.name : S().settings.city;
      const term = `${cat.id === 'xmas' ? 'Christkindlmarkt Weihnachtsmarkt' : cat.label} ${place}`.trim();
      return `<p class="muted small">In den Kartendaten ist hier noch nichts eingetragen.</p>
        <div class="links"><a class="link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(term)}" target="_blank" rel="noopener">${esc(cat.label)} auf Google Maps${icon('external')}</a></div>`;
    }
    const pick = draft.picks[i];
    const pp = placeIndex.get(pick);
    return `
      ${pp ? gRating(pp) : ''}
      <div class="alt-row">
        <button type="button" class="linkish small" data-open-place="${esc(pick)}" data-from-plan>Details & Fotos</button>
        ${list.length > 1 ? `<button type="button" class="btn sm soft swap-btn" data-alt="${i}">${icon('repeat')}${draft.openAlt === i ? 'Schließen' : 'Tauschen'}</button>` : ''}
      </div>
      ${draft.openAlt === i ? `<div class="alt-list"><p class="muted small">Andere passende Orte in der Nähe:</p>${list.map((p) => {
        const when = new Date(`${plan.date}T${plan.steps[k].time}:00`);
        const h = hoursOn(p.hours, when);
        return `<button type="button" class="alt ${p.id === pick ? 'on' : ''}" data-pick-step="${i}" data-pick-place="${esc(p.id)}">
          <span class="grow"><strong>${esc(p.name)}</strong><small class="muted">${fmtKm(p.distFromPrev ?? p.km)}${h ? ` · ${esc(h)}` : ''}${p.cuisine ? ` · ${esc(p.cuisine)}` : ''}</small></span>
          ${p.id === pick ? icon('check') : ''}
        </button>`;
      }).join('')}</div>` : ''}`;
  };

  root.innerHTML = `
    ${topbar({ title: '', back: fromPoll ? ['poll', session.pollId, 'Abstimmung'] : session.backTo ?? ['suggest', '', 'Vorschläge'] })}
    ${planHead(plan)}
    ${conflictsHTML(plan.date)}
    <div class="panel row between slim">
      <label for="p-start" class="label">Startzeit</label>
      <input type="time" id="p-start" class="input narrow" value="${plan.start}">
    </div>
    ${idea.reach !== 0 ? `
    <div class="panel slim field">
      <span class="label">Wie lange soll das Date dauern?</span>
      ${chips('p-dur', DUR_OPTS, String(draft.duration ?? ''))}
      ${draft.duration ? `<small class="muted">Zeit verteilt auf ${timed.steps.filter((x) => !x.travel).length} Stationen${timed.steps.some((x) => x.travel) ? ', Wege eingerechnet' : ''}.</small>` : ''}
    </div>` : ''}
    ${variant ? `
    <section class="panel idea-variant">
      <div class="panel-head">${icon('sparkle')}<h2>Eure Idee</h2></div>
      <p><strong>${esc(variant.name)}</strong></p>
      <p class="muted">${esc(variant.text)}</p>
      ${idea.variants.length > 1 ? `<button type="button" class="btn sm soft" id="p-variant">${icon('dice')}Andere Idee (${(draft.variant ?? 0) + 1}/${idea.variants.length})</button>` : ''}
    </section>` : ''}
    ${plan.recipe?.ingredients?.length && !(fromPoll && false) ? `
    <section class="panel">
      <div class="panel-head">${icon('cart')}<h2>Das braucht ihr</h2></div>
      <ul class="needs">${plan.recipe.ingredients.map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('')}</ul>
      ${plan.recipe.url ? `<a class="link" href="${esc(plan.recipe.url)}" target="_blank" rel="noopener">${/youtube/.test(plan.recipe.url) ? `Anleitung: ${esc(plan.recipe.name)}` : /chefkoch/.test(plan.recipe.url) ? `Rezept: ${esc(plan.recipe.name)}` : 'Mehr dazu'}${icon('external')}</a>` : ''}
    </section>` : ''}
    ${timeline(plan, stepExtra)}
    ${plan.todos.length ? `<p class="hint">${icon('bell')} Vorher erledigen: ${plan.todos.map(esc).join(', ')}</p>` : ''}

    ${fromPoll ? '' : `
    <section class="panel form">
      <label class="switch">
        <input type="checkbox" id="p-surprise" ${draft.surprise ? 'checked' : ''}>
        <span><strong>Als Überraschung</strong><br><small class="muted">${esc(nameOf(partner))} sieht nur Datum, Uhrzeit und deinen Hinweis.</small></span>
      </label>
      <div class="field" id="hint-field" ${draft.surprise ? '' : 'hidden'}>
        <label class="label" for="p-hint">Hinweis für ${esc(nameOf(partner))}</label>
        <input id="p-hint" class="input" maxlength="100" placeholder="z. B. Bequeme Schuhe, Jacke mitnehmen" value="${esc(draft.hint)}">
      </div>
    </section>`}

    <div class="sticky-actions">
      <button class="btn primary big" id="p-save">${icon('calendar')}Date eintragen</button>
    </div>`;

  bindBack();
  $('#p-start').addEventListener('change', (e) => {
    if (!e.target.value) return;
    draft.start = e.target.value;
    render();
  });
  on('[data-near-retry]', 'click', () => {
    draft.near = null;
    draft.nearError = false;
    render();
  });
  bindChips(root, 'p-dur', (v) => {
    draft.duration = v ? Number(v) : null;
    render();
  });
  $('#p-variant')?.addEventListener('click', () => {
    draft.variant = ((draft.variant ?? 0) + 1) % idea.variants.length;
    render();
  });
  on('[data-alt]', 'click', (_, el) => {
    const i = Number(el.dataset.alt);
    draft.openAlt = draft.openAlt === i ? null : i;
    render();
  });
  on('[data-pick-step]', 'click', (_, el) => {
    draft.picks[Number(el.dataset.pickStep)] = el.dataset.pickPlace;
    draft.openAlt = null;
    render();
    fillGoogleHours(draft);
  });
  on('[data-from-plan]', 'click', (_, el) => {
    session.ortBack = ['plan', ideaId, 'Plan'];
    go('ort', el.dataset.openPlace);
  });
  $('#p-surprise')?.addEventListener('change', (e) => {
    draft.surprise = e.target.checked;
    $('#hint-field').hidden = !draft.surprise;
  });
  $('#p-hint')?.addEventListener('input', (e) => (draft.hint = e.target.value));
  $('#p-save').addEventListener('click', () => {
    const id = uid();
    const surprise = !fromPoll && draft.surprise;
    const meta = { id, date: plan.date, start: plan.start, end: plan.end, daytime: plan.daytime, plannedBy: fromPoll ? 'both' : role, createdAt: Date.now(), ratings: {} };
    store.update((s) => {
      if (surprise) {
        s.dates.push({ ...meta, surprise: true, hint: draft.hint.trim() });
        s.secrets[id] = { ...plan, checks: {} };
      } else {
        s.dates.push({ ...plan, ...meta, surprise: false });
      }
      if (meta.plannedBy === 'a' || meta.plannedBy === 'b') s.settings.nextTurn = other(meta.plannedBy);
      const req = s.requests.find((r) => r.id === session.requestId);
      if (req) Object.assign(req, { status: 'planned', dateId: id });
      const poll = s.polls.find((p) => p.id === session.pollId);
      if (poll) Object.assign(poll, { status: 'planned', dateId: id });
    });
    delete drafts[ideaId];
    session.requestId = null;
    session.pollId = null;
    toast(surprise ? `Überraschung eingetragen – ${nameOf(partner)} sieht nur das Datum` : 'Im Kalender eingetragen');
    if (gcal.isConnected()) {
      gcal.createEvent(calendarEvent(surprise ? { ...plan, title: `Überraschung für ${nameOf(partner)}: ${plan.title}` } : plan))
        .then(() => toast('Auch in Google Kalender eingetragen'))
        .catch((e) => toast(e.message));
    }
    go('date', id);
  });
};

/** Für jede Station Orte in der Nähe suchen und automatisch den besten wählen:
 *  zur geplanten Zeit geöffnet, möglichst nah – ab der zweiten Station nah an der vorherigen. */
async function loadStepPlaces(steps, draft, stepCats, center, ctx) {
  draft.nearLoading = true;
  const ids = [...new Set(stepCats.filter(Boolean))];
  try {
    const radius = (ctx.radiusKm || reachToKm(ctx.reach) || 15) * 1000;
    const area = currentArea();
    const known = area ? ids.filter((id) => area.cats[id]?.length) : [];
    const unknown = ids.filter((id) => !known.includes(id));
    const groups = { ...Object.fromEntries(known.map((id) => [id, area.cats[id]])), ...(unknown.length ? await searchMixed(unknown, center, radius, 2) : {}) };
    // Hauptorte, die im Umkreis fehlen (z. B. Lasertag, Kochkurs), etwas weiter weg suchen
    // Wenig Auswahl beim Hauptort (z. B. nur 2 Museen)? Zum Tauschen auch Orte etwas weiter weg anbieten
    const firstCat = stepCats.find(Boolean);
    if (firstCat && radius < 80000) {
      const more = { [firstCat]: await searchNotable(firstCat, center, Math.min(radius * 2, 80000)).catch(() => []) };
      const have = new Set((groups[firstCat] ?? []).map((p) => p.name));
      groups[firstCat] = [...(groups[firstCat] ?? []), ...(more[firstCat] ?? []).filter((p) => !have.has(p.name))];
    }
    const far = ids.filter((id) => !groups[id]?.length && !categoryById(id)?.fallback && !['xmas', 'karaoke', 'bookshop', 'chocolate', 'boat', 'supermarket'].includes(id));
    if (far.length && radius < 60000) {
      const wider = await searchMixed(far, center, Math.min(radius * 3, 60000), 2).catch(() => ({}));
      for (const id of far) if (wider[id]?.length) groups[id] = wider[id];
    }
    // Weicher Wunsch ohne Treffer (z. B. Burger, Tapas): ähnlichen Ort nehmen (Restaurant, Bar …)
    const soft = ids.filter((id) => !groups[id]?.length && categoryById(id)?.fallback);
    if (soft.length) {
      const fb = await searchMixed([...new Set(soft.map((id) => categoryById(id).fallback))], center, radius, 2).catch(() => ({}));
      for (const id of soft) groups[id] = fb[categoryById(id).fallback] ?? [];
    }
    // Immer noch nichts (z. B. Schwarzlicht-Minigolf, Weihnachtsmarkt)? Mit Google-Schlüssel bei Google suchen
    const gKey = googleKey();
    const G_TEXT = { rooftop: 'Rooftop Bar', livemusic: 'Live Musik Bar', botanic: 'Botanischer Garten', blacklight: 'Schwarzlicht Minigolf', xmas: 'Weihnachtsmarkt Christkindlmarkt', karaoke: 'Karaoke Bar', escape: 'Escape Room', climbing: 'Boulderhalle', cooking: 'Kochkurs', pottery: 'Töpferkurs', arcade: 'Lasertag', bowling: 'Bowling', spa: 'Therme', icerink: 'Eishalle Eislaufen', boat: 'Bootsverleih', bookshop: 'Buchhandlung' };
    if (gKey) {
      for (const id of ids.filter((x) => !groups[x]?.length && G_TEXT[x])) {
        const found = await googleSearch(G_TEXT[id], center, Math.max(radius, 30000), gKey).catch(() => []);
        groups[id] = found.map((p) => ({ ...p, category: id, km: distanceKm(center, p) })).filter((p) => p.km <= Math.max(radius, 30000) / 1000 * 2).sort((a, b) => a.km - b.km);
      }
    }
    // Nichts gefunden (z. B. Weihnachtsmarkt nicht in den Kartendaten)? Für Nebenstationen eine passende Alternative
    const realCat = {};
    const ALT = { xmas: ctx.daytime === 'abend' ? 'bar' : 'cafe', chocolate: 'cafe', boat: 'icecream' };
    // Alternativen nur für Nebenstationen eines Dates, dessen Hauptort gefunden wurde (z. B. Punsch nach dem Eislaufen)
    const anyFound = ids.some((id) => groups[id]?.length);
    const altIds = [...new Set(steps.map((s, i) => (anyFound && !(groups[stepCats[i]] ?? []).length && ALT[stepCats[i]] && !/weihnachtsmarkt|christkindl/i.test(s.t) ? ALT[stepCats[i]] : null)).filter(Boolean))];
    if (altIds.length) {
      const extra = await searchMixed(altIds, center, radius, 2).catch(() => ({}));
      steps.forEach((s, i) => {
        const alt = ALT[stepCats[i]];
        if (!(groups[stepCats[i]] ?? []).length && alt && extra[alt]?.length && !/weihnachtsmarkt|christkindl/i.test(s.t)) {
          groups[`alt${i}`] = extra[alt];
          realCat[i] = alt;
          stepCats[i] = `alt${i}`;
        }
      });
    }
    draft.near = {};
    const used = new Set();
    let prev = center;
    let t = draft.start;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const cat = stepCats[i];
      if (cat) {
        const when = new Date(`${ctx.date}T${t}:00`);
        // Folgestation: direkt rund um den vorherigen Ort suchen (z. B. Essen in Dorfen nach dem Escape Room in Dorfen)
        if (prev !== center && !s.place?.id) {
          const near = (groups[cat] ?? []).filter((p) => distanceKm(prev, p) <= 2);
          if (near.length < 2) {
            const rc = realCat[i] ?? cat;
            const fbc = categoryById(rc)?.fallback;
            const local = await searchMixed([rc, fbc].filter(Boolean), prev, 5000, 2).catch(() => ({}));
            // Genauer Wunsch (z. B. Burger) bekommt 1,5 km Vorsprung, sonst gewinnt der nähere ähnliche Ort
            const score = (p, bonus) => distanceKm(prev, p) - bonus;
            const add = [...(local[rc] ?? []).map((p) => [p, score(p, 1.5)]), ...(local[fbc] ?? []).map((p) => [p, score(p, 0)])]
              .sort((a, b) => a[1] - b[1]).map(([p]) => ({ ...p, km: distanceKm(center, p) }));
            const have = new Set((groups[cat] ?? []).map((p) => p.name));
            groups[cat] = [...add.filter((p) => !have.has(p.name)), ...(groups[cat] ?? [])];
          }
        }
        // Von Dately bereits gewählter Ort bleibt vorausgewählt
        const fixed = s.place?.id ? { ...s.place, km: distanceKm(center, s.place) } : null;
        if (fixed) {
          placeIndex.set(fixed.id, { ...(placeIndex.get(fixed.id) ?? {}), ...fixed });
          draft.picks[i] ??= fixed.id;
        }
        const pool = [...(fixed && !(groups[cat] ?? []).some((p) => p.id === fixed.id) ? [placeIndex.get(fixed.id)] : []), ...(groups[cat] ?? [])];
        const list = pool
          .filter((p) => !used.has(p.id))
          .map((p) => ({ ...p, distFromPrev: distanceKm(prev, p), open: isOpenAt(p.hours, when) }))
          .filter((p) => p.open !== false || p.id === draft.picks[i])
          // Hauptort: zuerst im gewählten Umkreis; bekannte Orte weiter weg kommen unten dazu
          .filter((p) => cat !== firstCat || !pool.some((q) => q.km * 1000 <= radius) || p.km * 1000 <= radius || p.id === draft.picks[i])
          // Nähe zählt am meisten; bestätigt geöffnete Orte bekommen 1,5 km Vorsprung
          .sort((a, b) => (b.id === draft.picks[i]) - (a.id === draft.picks[i]) || (a.distFromPrev - (a.open === true ? 1.5 : 0)) - (b.distFromPrev - (b.open === true ? 1.5 : 0)))
          .slice(0, 7);
        // Beim Hauptort zusätzlich bekannte Orte etwas weiter weg anbieten (z. B. Deutsches Museum)
        if (cat === firstCat) {
          const fame = (p) => (p.importance ?? 0) + (p.wikipedia ? 0.05 : 0);
          const inList = new Set(list.map((p) => p.id));
          const notable = pool.filter((p) => !inList.has(p.id) && !used.has(p.id) && fame(p) > 0.25)
            .sort((a, b) => fame(b) - fame(a)).slice(0, 5)
            .map((p) => ({ ...p, distFromPrev: distanceKm(prev, p), open: isOpenAt(p.hours, when), notable: true }));
          list.push(...notable.filter((p) => p.open !== false).sort((a, b) => a.distFromPrev - b.distFromPrev));
        }
        // Gleiche Ortsart wie die Station davor (z. B. Lasertag & Arcade): denselben Ort nehmen
        if (i > 0 && stepCats[i - 1] === cat && draft.picks[i - 1] && !draft.picks[i]) draft.picks[i] = draft.picks[i - 1];
        list.forEach((p) => placeIndex.set(p.id, p));
        draft.near[i] = list;
        if (list[0]) {
          draft.picks[i] ??= list[0].id;
          used.add(draft.picks[i]);
          prev = placeIndex.get(draft.picks[i]) ?? prev;
        }
      }
      t = addMinutes(t, s.min);
    }
    draft.nearError = false;
  } catch {
    draft.near = {};
    draft.nearError = true;
  }
  draft.nearLoading = false;
  if (current.name === 'plan') render();
  fillGoogleHours(draft);
}

/** Fehlende Öffnungszeiten der gewählten Orte von Google holen (eigener Schlüssel oder Server). */
function fillGoogleHours(draft) {
  const key = googleKey();
  if (!key) return;
  for (const id of Object.values(draft.picks ?? {})) {
    const p = placeIndex.get(id);
    if (!p || p.hours || p.hoursTried) continue;
    p.hoursTried = true;
    googleDetails(p, key).then((g) => {
      if (!g?.hours) return;
      p.hours = g.hours;
      for (const list of Object.values(draft.near ?? {})) for (const x of list) if (x.id === id) x.hours = g.hours;
      if (current.name === 'plan') render();
    }).catch(() => {});
  }
}

/** Ist das Date vorbei (Datum vergangen oder heute nach dem Ende)? */
function dateIsOver(d) {
  const t = isoDate(today());
  if (d.date < t) return true;
  if (d.date > t) return false;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return d.end && d.end > d.start ? hhmm >= d.end : false;
}

/* ================================================================ Gespeichertes Date */

RENDER.date = (id) => {
  const d = S().dates.find((x) => x.id === id);
  if (!d) return go('dates');
  const role = myRole();
  const past = dateIsOver(d);

  if (isHiddenFromMe(d)) {
    const n = daysBetween(today(), parseISO(d.date));
    root.innerHTML = `
      ${topbar({ title: '', back: ['dates', '', 'Unsere Dates'] })}
      <section class="surprise-card">
        <div class="gift-mark">${icon('gift')}</div>
        <p class="eyebrow">Überraschung von ${esc(nameOf(d.plannedBy))}</p>
        <h1>${n <= 0 ? 'Heute ist es so weit' : n === 1 ? 'Morgen' : `Noch ${n} Tage`}</h1>
        <p class="sub">${fmtDate(d.date)} · ${d.start}–${d.end} Uhr</p>
        ${d.hint ? `<div class="hint-box"><span class="kicker">Hinweis</span><p>${esc(d.hint)}</p></div>` : ''}
        <p class="muted small">Was ihr macht, erfährst du ${past ? 'gleich' : 'nach dem Date'}.</p>
      </section>
      <div class="actions">${calendarButtons()}</div>`;
    bindBack();
    bindCalendarButtons({ ...d, title: `Überraschung von ${nameOf(d.plannedBy)}`, emoji: '🎁', steps: [] });
    return;
  }

  const plan = fullPlan(d);
  if (!plan) {
    root.innerHTML = `${topbar({ title: 'Überraschung', back: ['dates', '', 'Unsere Dates'] })}<p class="muted">Die Details dieser Überraschung liegen auf dem Konto von ${esc(nameOf(d.plannedBy))}.</p>`;
    return bindBack();
  }
  const mySurprise = d.surprise && d.plannedBy === role;
  const secret = mySurprise ? S().secrets[d.id] : null;
  const ratings = d.ratings ?? {};

  root.innerHTML = `
    ${topbar({ title: '', back: ['dates', '', 'Unsere Dates'] })}
    ${planHead(plan, esc(plannerLabel(d)))}
    ${mySurprise ? `
      <div class="banner secret">${icon('lock')}<span><strong>Geheim.</strong> ${esc(nameOf(other(role)))} sieht nur ${fmtShort(d.date)}, ${d.start} Uhr${d.hint ? ` und „${esc(d.hint)}“` : ''}.</span></div>` : ''}
    ${past ? `
      <section class="panel rate">
        <span class="label">Wie war’s?</span>
        ${['a', 'b'].map((r) => `
          <div class="rate-row">
            <span>${r === role ? 'Du' : esc(nameOf(r))}</span>
            <div class="stars" role="group" aria-label="Bewertung ${esc(nameOf(r))}">
              ${[1, 2, 3, 4, 5].map((n) => `<button class="star ${n <= (ratings[r] ?? 0) ? 'on' : ''}" ${r === role ? `data-rate="${n}"` : 'disabled'} aria-label="${n} von 5">${icon('heart')}</button>`).join('')}
            </div>
          </div>`).join('')}
      </section>
      ${plan.communityId && community.api ? communityRateHTML(plan.communityId) : ''}` : ''}
    ${costSummaryHTML(d)}
    ${past || d.date === isoDate(today()) || Object.keys(d.photos ?? {}).length ? photosSectionHTML(d) : ''}
    ${timeline(plan)}
    ${mySurprise && (plan.todos.length || plan.recipe) ? `
      <section class="panel">
        <div class="panel-head">${icon('list')}<h2>Deine geheime Checkliste</h2></div>
        <ul class="items">
          ${[...plan.todos, ...(plan.recipe?.ingredients ?? []).map((x) => `Besorgen: ${x}`)].map((t) => `
            <li class="item ${secret.checks?.[t] ? 'done' : ''}"><label class="check"><input type="checkbox" data-check="${esc(t)}" ${secret.checks?.[t] ? 'checked' : ''}><span class="grow">${esc(t)}</span></label></li>`).join('')}
        </ul>
      </section>` : ''}
    ${!d.surprise && (plan.todos.length || plan.recipe?.ingredients?.length) ? `
      <section class="panel">
        <div class="panel-head">${icon('cart')}<h2>Das braucht ihr</h2></div>
        <ul class="items">
          ${[...plan.todos, ...(plan.recipe?.ingredients ?? [])].map((t) => `
            <li class="item ${d.checks?.[t] ? 'done' : ''}"><label class="check"><input type="checkbox" data-dcheck="${esc(t)}" ${d.checks?.[t] ? 'checked' : ''}><span class="grow">${esc(t)}</span></label></li>`).join('')}
        </ul>
      </section>` : ''}
    <div class="actions">
      ${calendarButtons()}
      <button class="btn" data-go-cost="${d.id}">${icon('wallet')}Ausgabe eintragen</button>
      ${mySurprise ? `<button class="btn" id="reveal">${icon('eye')}Überraschung jetzt auflösen</button>` : ''}
      ${community.api && !d.surprise && !plan.communityId ? (d.sharedId ? `<p class="muted small center">${icon('check')} Mit der Community geteilt</p>` : `<button class="btn" data-share-date="${d.id}">${icon('share')}Mit der Community teilen</button>`) : ''}
      <button class="btn ghost danger" id="del">${icon('trash')}Date löschen</button>
    </div>
    ${plan.recipe?.url && !d.surprise ? `
      <details class="panel recipe">
        <summary>${esc(plan.recipe.name)} · ${plan.recipe.ingredients.length} Zutaten</summary>
        <ul>${plan.recipe.ingredients.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <a class="link" href="${esc(plan.recipe.url)}" target="_blank" rel="noopener">Rezepte ansehen${icon('external')}</a>
      </details>` : ''}`;

  bindBack();
  on('[data-rate]', 'click', (_, el) => {
    const n = Number(el.dataset.rate);
    store.update((s) => {
      const x = s.dates.find((y) => y.id === id);
      x.ratings = { ...(x.ratings ?? {}), [role]: (x.ratings?.[role] ?? 0) === n ? 0 : n };
    });
    render();
  });
  on('[data-check]', 'change', (e, el) => {
    store.update((s) => {
      const sec = s.secrets[id];
      sec.checks = { ...(sec.checks ?? {}), [el.dataset.check]: e.target.checked };
    });
    el.closest('.item').classList.toggle('done', e.target.checked);
  });
  on('[data-dcheck]', 'change', (e, el) => {
    store.update((s) => {
      const x = s.dates.find((y) => y.id === id);
      x.checks = { ...(x.checks ?? {}), [el.dataset.dcheck]: e.target.checked };
    });
    el.closest('.item').classList.toggle('done', e.target.checked);
  });
  bindCalendarButtons(mySurprise ? { ...plan, title: `Überraschung für ${nameOf(other(role))}: ${plan.title}` } : plan);
  $('#shop')?.addEventListener('click', () => {
    let added = 0;
    store.update((s) => {
      const have = new Set(s.shopping.filter((x) => !x.done).map((x) => x.text.toLowerCase()));
      for (const text of plan.recipe.ingredients) {
        if (have.has(text.toLowerCase())) continue;
        s.shopping.push({ id: uid(), text, done: false, createdAt: Date.now() });
        added++;
      }
    });
    toast(added ? `${added} Zutaten auf der Einkaufsliste` : 'Steht schon alles drauf');
  });
  $('#todos')?.addEventListener('click', () => {
    let added = 0;
    const dueDate = addDays(parseISO(plan.date), -2);
    const due = isoDate(dueDate < today() ? today() : dueDate);
    store.update((s) => {
      const have = new Set(s.todos.filter((x) => !x.done).map((x) => x.text));
      for (const t of plan.todos) {
        const text = `${t} (${plan.title})`;
        if (have.has(text)) continue;
        s.todos.push({ id: uid(), text, who: d.plannedBy === 'both' ? 'beide' : d.plannedBy, due, done: false, createdAt: Date.now() });
        added++;
      }
    });
    toast(added ? `${added} To-do${added > 1 ? 's' : ''} hinzugefügt` : 'Schon auf der Liste');
  });
  on('[data-go-cost]', 'click', (_, el) => go('kosten', `neu:${el.dataset.goCost}`));
  on('[data-share-date]', 'click', (_, el) => go('teilen', `date:${el.dataset.shareDate}`));
  bindCommunityRate();
  bindPhotosSection(d);
  $('#reveal')?.addEventListener('click', () => {
    reveal(id);
    render();
  });
  armed($('#del'), () => {
    store.update((s) => {
      s.dates = s.dates.filter((x) => x.id !== id);
      delete s.secrets[id];
      for (const r of s.requests) if (r.dateId === id) r.status = 'cancelled';
    });
    toast('Date gelöscht');
    go('dates');
  });
};

/* ================================================================ Abstimmung */

function pollRound(p) {
  return p.rounds?.[`r${p.round}`] ?? { ideas: [], votes: {} };
}

function pollState(p) {
  const role = myRole();
  const rd = pollRound(p);
  const votes = rd.votes ?? {};
  const done = (r) => rd.ideas.every((id) => votes[r]?.[id]);
  const mineDone = role ? done(role) : false;
  const bothDone = done('a') && done('b');
  const matches = bothDone ? rd.ideas.filter((id) => votes.a[id] === 1 && votes.b[id] === 1) : [];
  return { rd, votes, mineDone, partnerDone: role ? done(other(role)) : false, bothDone, matches };
}

async function createPoll() {
  const ideas = session.current;
  if (!ideas.length) {
    toast('Keine passenden Ideen – erhöht Budget oder Entfernung');
    return null;
  }
  const id = uid();
  const w = session.weather;
  store.update((s) =>
    s.polls.push({
      id,
      createdBy: myRole(),
      createdAt: Date.now(),
      ctx: session.ctx,
      weather: w.known ? { known: true, icon: w.icon, label: w.label, temp: w.temp ?? null, wet: w.wet, cold: w.cold, clear: w.clear } : { known: false, reason: w.reason ?? '' },
      round: 1,
      rounds: { r1: { ideas: ideas.map((i) => i.id), votes: { a: {}, b: {} } } },
      status: 'open',
    }),
  );
  return id;
}

RENDER.poll = (id) => {
  const p = S().polls.find((x) => x.id === id);
  if (!p) return go('start');
  const role = myRole();
  if (!role) {
    root.innerHTML = `${topbar({ title: 'Abstimmung', back: ['start', '', 'Start'] })}${whoAmICard()}`;
    bindBack();
    return bindWhoAmI();
  }
  if (p.stage === 'survey') return renderSurvey(p);
  const partner = other(role);
  const st = pollState(p);
  const ideas = st.rd.ideas.map((iid) => ideaById(iid) ?? st.rd.snap?.[iid]).filter(Boolean);
  const showTheirs = st.mineDone; // Stimmen des Partners erst nach der eigenen Abgabe zeigen

  const voteButtons = (i) => {
    const mine = st.votes[role]?.[i.id];
    const theirs = st.votes[partner]?.[i.id];
    return `
      <div class="vote-row">
        <div class="vote-btns" role="group" aria-label="Deine Stimme">
          <button class="vote no ${mine === -1 ? 'on' : ''}" data-vote="${i.id}" data-v="-1" ${p.status !== 'open' ? 'disabled' : ''}>${icon('down')}<span>Eher nicht</span></button>
          <button class="vote yes ${mine === 1 ? 'on' : ''}" data-vote="${i.id}" data-v="1" ${p.status !== 'open' ? 'disabled' : ''}>${icon('up')}<span>Gefällt mir</span></button>
        </div>
        ${showTheirs && theirs ? `<span class="their ${theirs === 1 ? 'yes' : 'no'}">${esc(nameOf(partner))}: ${theirs === 1 ? 'gefällt' : 'eher nicht'}</span>` : ''}
      </div>`;
  };

  let result = '';
  if (p.status === 'planned') {
    result = `<div class="banner sun">${icon('check')}<span><strong>Geplant.</strong> <button class="linkish" data-open-date="${p.dateId}">Zum Date</button></span></div>`;
  } else if (st.bothDone && st.matches.length) {
    result = `
      <section class="match">
        <p class="eyebrow">Ihr habt ein Match</p>
        ${st.matches.map((mid) => `
          <div class="match-row">
            <span class="idea-emoji" aria-hidden="true">${glyph(ideaById(mid)?.emoji ?? '')}</span>
            <strong class="grow">${esc(ideaById(mid)?.title ?? '')}</strong>
            <button class="btn primary sm" data-plan-match="${mid}">Planen</button>
          </div>`).join('')}
      </section>`;
  } else if (st.bothDone) {
    result = `
      <section class="match none">
        <p><strong>Kein gemeinsamer Favorit.</strong> Neue Runde mit drei anderen Ideen?</p>
        <button class="btn primary" id="new-round">${icon('dice')}Neue Runde</button>
      </section>`;
  }

  root.innerHTML = `
    ${topbar({ title: 'Abstimmung', sub: `${ctxLine(p.ctx)} · Runde ${p.round}`, back: ['start', '', 'Start'] })}
    <div class="status-row">
      <span class="status ${st.mineDone ? 'done' : ''}">${icon(st.mineDone ? 'check' : 'clock')}Du</span>
      <span class="status ${st.partnerDone ? 'done' : ''}">${icon(st.partnerDone ? 'check' : 'clock')}${esc(nameOf(partner))}</span>
      ${p.weather?.icon ? weatherPill(p.weather) : ''}
    </div>
    ${p.summary ? `<p class="hint">${icon('sparkle')} Passend zu euren Wünschen: ${p.summary.moodsBoth?.length ? p.summary.moodsBoth.map(moodLabel).join(', ') : (p.summary.moods ?? []).map(moodLabel).join(', ') || 'alles offen'} · bis ${p.summary.budget} €</p>` : ''}
    ${result}
    ${!st.mineDone && p.status === 'open' ? `<p class="hint">Stimm bei allen drei Ideen ab. ${esc(nameOf(partner))}s Stimmen siehst du danach.</p>` : ''}
    ${st.mineDone && !st.partnerDone ? `<p class="hint">Fertig. Sobald ${esc(nameOf(partner))} abgestimmt hat, seht ihr euer Match.</p>` : ''}
    <div class="ideas">${ideas.map((i) => ideaCard(i, voteButtons(i))).join('')}</div>
    <button class="btn ghost danger" id="del-poll">${icon('trash')}Abstimmung löschen</button>`;

  bindBack();
  on('[data-open-date]', 'click', (_, el) => go('date', el.dataset.openDate));
  on('[data-vote]', 'click', (_, el) => {
    const v = Number(el.dataset.v);
    store.update((s) => {
      const poll = s.polls.find((x) => x.id === id);
      const rd = poll.rounds[`r${poll.round}`];
      rd.votes = rd.votes ?? {};
      rd.votes[role] = { ...(rd.votes[role] ?? {}), [el.dataset.vote]: v };
    });
    render();
  });
  on('[data-plan-match]', 'click', (_, el) => {
    session.ctx = { ...p.ctx };
    session.weather = p.weather ?? { known: false };
    session.pollId = p.id;
    session.requestId = null;
    go('plan', el.dataset.planMatch);
  });
  $('#new-round')?.addEventListener('click', async () => {
    session.ctx = { ...p.ctx };
    session.weather = p.weather?.known ? p.weather : { known: false };
    session.shown = new Set(Object.values(p.rounds).flatMap((r) => r.ideas));
    const next = await reroll();
    if (!next.length) return toast('Keine weiteren Ideen – ändert Budget oder Entfernung');
    store.update((s) => {
      const poll = s.polls.find((x) => x.id === id);
      poll.round += 1;
      poll.rounds = { ...poll.rounds, [`r${poll.round}`]: { ideas: next.map((i) => i.id), votes: { a: {}, b: {} }, snap: Object.fromEntries(next.filter((i) => i.custom).map((i) => [i.id, i])) } };
    });
    render(true);
  });
  armed($('#del-poll'), () => {
    store.update((s) => (s.polls = s.polls.filter((x) => x.id !== id)));
    go('start');
  });
};

/* ================================================================ 4. Kalender */

const cal = { month: null, sel: null };

function entriesFor(date) {
  const s = S();
  const iso = isoDate(date);
  const list = [];
  for (const d of s.dates.filter((x) => x.date === iso)) list.push({ type: 'date', time: d.start, title: dateTitle(d), emoji: dateEmoji(d), date: d.id });
  for (const r of s.requests.filter((x) => x.status === 'open' && x.ctx.date === iso)) list.push({ type: 'pending', time: '', title: `${nameOf(r.to)} plant ein Date` });
  for (const p of s.polls.filter((x) => x.status === 'open' && x.stage !== 'survey' && x.ctx.date === iso)) list.push({ type: 'pending', time: '', title: 'Abstimmung läuft', poll: p.id });
  for (const f of s.settings.fixed.filter((x) => x.weekday === date.getDay())) list.push({ type: 'fixed', time: f.time, title: f.title });
  for (const sp of specialsOn(s.settings, date)) list.push({ type: 'special', time: '', title: sp.label });
  for (const e of s.events.filter((x) => x.date === iso)) list.push({ type: 'event', time: e.time, title: e.title, who: e.who, id: e.id });
  for (const t of s.todos.filter((x) => x.due === iso && !x.done)) list.push({ type: 'todo', time: '', title: t.text });
  for (const e of L().gcal.events.filter((x) => x.date === iso)) list.push({ type: 'gcal', time: e.start, title: e.allDay ? `${e.title} (ganztägig)` : `${e.title}${e.end ? ` bis ${e.end}` : ''}` });
  const partner = other(myRole());
  for (const b of partnerBusy(iso)) list.push({ type: 'busy', time: b.start, title: `${nameOf(partner)}: ${b.allDay ? 'ganztägig belegt' : `belegt bis ${b.end}`}` });
  return list.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
}

RENDER.kalender = () => {
  const s = S();
  if (!cal.month) {
    const t = today();
    cal.month = new Date(t.getFullYear(), t.getMonth(), 1);
    cal.sel = isoDate(t);
  }
  const m = cal.month;
  const ym = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
  const count = s.dates.filter((d) => d.date.startsWith(ym)).length;
  const goal = s.settings.datesPerMonth;
  const offset = (m.getDay() + 6) % 7;
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const todayIso = isoDate(today());

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cal-cell empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const iso = isoDate(date);
    const types = [...new Set(entriesFor(date).map((e) => e.type))];
    cells.push(`
      <button class="cal-cell ${iso === todayIso ? 'today' : ''} ${iso === cal.sel ? 'sel' : ''} ${types.includes('date') ? 'has-date' : ''}" data-day="${iso}" aria-label="${fmtDate(iso)}">
        <span class="num">${d}</span>
        <span class="dots">${types.filter((t) => t !== 'date').slice(0, 3).map((t) => `<i class="dot ${t}"></i>`).join('')}</span>
      </button>`);
  }
  const entries = entriesFor(parseISO(cal.sel));

  root.innerHTML = `
    ${topbar({ title: 'Kalender' })}
    ${gcalBar()}
    <section class="panel cal">
      <div class="cal-nav">
        <button class="icon-btn" id="prev" aria-label="Vorheriger Monat">${icon('left')}</button>
        <div class="center"><strong>${MONTHS[m.getMonth()]} ${m.getFullYear()}</strong><br><small class="muted">${count} von ${goal} Dates</small></div>
        <button class="icon-btn" id="next" aria-label="Nächster Monat">${icon('right')}</button>
      </div>
      <div class="cal-grid head">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="legend">
        <span><i class="dot date"></i>Date</span><span><i class="dot pending"></i>In Planung</span><span><i class="dot fixed"></i>Fest</span>
        <span><i class="dot special"></i>Besonderer Tag</span><span><i class="dot event"></i>Termin</span><span><i class="dot gcal"></i>Google</span>
      </div>
    </section>

    <section class="day" id="day">
      <h2>${relDay(cal.sel) ? relDay(cal.sel) + ', ' : ''}${fmtDate(cal.sel)}</h2>
      ${entries.length ? `<ul class="entries">${entries.map((e) => `
        <li class="entry ${e.type}">
          <span class="time">${e.time || ''}</span>
          ${e.date || e.poll ? `<button class="grow entry-link" ${e.date ? `data-open-date="${e.date}"` : `data-open-poll="${e.poll}"`}>${esc(e.title)}${icon('right')}</button>` : `<span class="grow">${esc(e.title)}${e.who ? ` <small class="muted">· ${esc(e.who)}</small>` : ''}</span>`}
          ${e.type === 'event' ? `<button class="icon-btn small" data-del-event="${e.id}" aria-label="Termin löschen">${icon('x')}</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Noch nichts eingetragen.</p>'}
      <form class="panel add-row" id="add-event">
        <input class="input" id="ev-title" name="title" placeholder="Eigener Termin, z. B. Yoga" required>
        <div class="row gap">
          <input class="input" id="ev-time" type="time" name="time" value="19:00" aria-label="Uhrzeit">
          <select class="input" id="ev-who" name="who" aria-label="Wer">
            <option value="Beide">Beide</option><option value="${esc(nameOf('a'))}">${esc(nameOf('a'))}</option><option value="${esc(nameOf('b'))}">${esc(nameOf('b'))}</option>
          </select>
          <button class="btn primary square" aria-label="Termin hinzufügen">${icon('plus')}</button>
        </div>
      </form>
      ${cal.sel >= todayIso ? `<button class="btn soft big" id="plan-here">${icon('sparkle')}Date für diesen Tag planen</button>` : ''}
      ${(() => {
        const dp = S().polls.filter((p) => p.status === 'open' && p.stage === 'survey' && p.kind === 'day').sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!dp || !myRole()) return '';
        const mine = !!dp.survey?.[myRole()];
        const theirs = !!dp.survey?.[other(myRole())];
        return `<div class="banner neutral-row">${icon('calendar')}<span class="grow"><strong>Welcher Tag passt euch?</strong><br><small class="muted">${mine && theirs ? 'Beide haben geantwortet – Ergebnis ansehen' : mine ? `Warte auf ${esc(nameOf(other(myRole())))}` : 'Deine Antwort fehlt noch'}</small></span><button class="btn sm ${mine && !theirs ? '' : 'primary'}" data-open-poll="${dp.id}">Öffnen</button></div>`;
      })()}
      <button class="btn big" id="find-day">${icon('vote')}Gemeinsamen Tag finden</button>
    </section>`;

  bindGcalBar();
  $('#prev').addEventListener('click', () => {
    cal.month = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    render();
  });
  $('#next').addEventListener('click', () => {
    cal.month = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    render();
  });
  on('[data-day]', 'click', (_, el) => {
    cal.sel = el.dataset.day;
    render();
    $('#day').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  on('[data-open-date]', 'click', (_, el) => go('date', el.dataset.openDate));
  on('[data-open-poll]', 'click', (_, el) => go('poll', el.dataset.openPoll));
  on('[data-del-event]', 'click', (_, el) => {
    store.update((st) => (st.events = st.events.filter((e) => e.id !== el.dataset.delEvent)));
    render();
  });
  $('#add-event').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const title = String(fd.get('title')).trim();
    if (!title) return;
    store.update((st) => st.events.push({ id: uid(), date: cal.sel, time: fd.get('time'), title, who: fd.get('who'), createdAt: Date.now() }));
    render();
  });
  $('#find-day').addEventListener('click', () => {
    if (!myRole()) return toast('Wähle zuerst auf „Planen“, wer du bist');
    go('poll', createSurvey('day'));
  });
  $('#plan-here')?.addEventListener('click', () => {
    Object.assign(L().lastSearch, { when: 'date', date: cal.sel });
    store.saveLocal();
    go('start');
  });
};

/* ================================================================ 5. Listen */

let listTab = 'todo';
RENDER.listen = () => {
  const s = S();
  const isTodo = listTab === 'todo';
  const key = isTodo ? 'todos' : 'shopping';
  const items = s[key];
  const open = items.filter((x) => !x.done);
  const done = items.filter((x) => x.done);
  const role = myRole();
  const whoLabel = (w) => (w === 'a' || w === 'b' ? (w === role ? 'Du' : nameOf(w)) : 'Beide');

  const row = (x) => `
    <li class="item ${x.done ? 'done' : ''}">
      <label class="check">
        <input type="checkbox" data-toggle="${x.id}" ${x.done ? 'checked' : ''}>
        <span class="grow">${esc(x.text)}
          ${isTodo && (x.who || x.due) ? `<small class="meta-line">${x.who ? `<span class="who ${x.who === role ? 'me' : ''}">${esc(whoLabel(x.who))}</span>` : ''}${x.due ? `<span class="${x.due < isoDate(today()) && !x.done ? 'overdue' : ''}">${fmtShort(x.due)}</span>` : ''}</small>` : ''}
        </span>
      </label>
      <button class="icon-btn small" data-del="${x.id}" aria-label="Löschen">${icon('x')}</button>
    </li>`;

  root.innerHTML = `
    ${topbar({ title: 'Listen' })}
    <nav class="seg-tabs" role="tablist">
      <button role="tab" data-tab-list="todo" aria-selected="${isTodo}">${icon('check')}To-do <span class="count">${s.todos.filter((x) => !x.done).length}</span></button>
      <button role="tab" data-tab-list="einkauf" aria-selected="${!isTodo}">${icon('cart')}Einkauf <span class="count">${s.shopping.filter((x) => !x.done).length}</span></button>
    </nav>
    <form class="panel add-row" id="add">
      <div class="row gap">
        <input class="input grow" id="li-text" name="text" placeholder="${isTodo ? 'z. B. Tisch reservieren' : 'z. B. Erdbeeren'}" required autocomplete="off">
        <button class="btn primary square" aria-label="Hinzufügen">${icon('plus')}</button>
      </div>
      ${isTodo ? `
        <div class="row gap">
          <select class="input" id="li-who" name="who" aria-label="Zuständig">
            <option value="beide">Beide</option>
            <option value="a" ${role === 'a' ? 'selected' : ''}>${esc(nameOf('a'))}</option>
            <option value="b" ${role === 'b' ? 'selected' : ''}>${esc(nameOf('b'))}</option>
          </select>
          <input class="input" id="li-due" type="date" name="due" aria-label="Fällig am">
        </div>` : ''}
    </form>
    ${open.length ? `<ul class="items panel">${open.map(row).join('')}</ul>` : `<p class="empty-line">${isTodo ? 'Alles erledigt.' : 'Die Einkaufsliste ist leer.'}</p>`}
    ${done.length ? `
      <details class="done-list">
        <summary>Erledigt (${done.length})</summary>
        <ul class="items panel">${done.map(row).join('')}</ul>
        <button class="btn ghost" id="clear">Erledigte entfernen</button>
      </details>` : ''}`;

  on('[data-tab-list]', 'click', (_, el) => {
    listTab = el.dataset.tabList;
    render();
  });
  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const text = String(fd.get('text')).trim();
    if (!text) return;
    const item = { id: uid(), text, done: false, createdAt: Date.now() };
    if (isTodo) Object.assign(item, { who: fd.get('who'), due: fd.get('due') || '' });
    store.update((st) => st[key].push(item));
    render();
    $('#li-text').focus();
  });
  on('[data-toggle]', 'change', (e, el) => {
    store.update((st) => {
      const it = st[key].find((x) => x.id === el.dataset.toggle);
      if (it) it.done = e.target.checked;
    });
    setTimeout(render, 200);
  });
  on('[data-del]', 'click', (_, el) => {
    store.update((st) => (st[key] = st[key].filter((x) => x.id !== el.dataset.del)));
    render();
  });
  $('#clear')?.addEventListener('click', () => {
    store.update((st) => (st[key] = st[key].filter((x) => !x.done)));
    render();
  });
};

/* ================================================================ Community-Bewertung im Date */

function communityRateHTML(cid) {
  const mine = discover.myRatings[cid];
  return `
    <section class="panel stack" id="crate">
      <span class="label">Bewertet die Idee für andere Paare</span>
      <div class="stars big" role="group" aria-label="Community-Bewertung">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="star ${n <= (mine?.stars ?? 0) ? 'on' : ''}" data-cstar="${n}" aria-label="${n} von 5">${icon('star')}</button>`).join('')}
      </div>
      <input class="input" id="c-comment" maxlength="300" placeholder="Kurzer Tipp für andere (optional)" value="${esc(mine?.comment ?? '')}">
      <button class="btn" id="c-send" data-cid="${cid}">${mine ? 'Bewertung ändern' : 'Bewertung senden'}</button>
    </section>`;
}

function bindCommunityRate() {
  const box = $('#crate');
  if (!box) return;
  let stars = discover.myRatings[$('#c-send').dataset.cid]?.stars ?? 0;
  on('[data-cstar]', 'click', (_, el) => {
    stars = Number(el.dataset.cstar);
    $$('[data-cstar]', box).forEach((b) => b.classList.toggle('on', Number(b.dataset.cstar) <= stars));
  });
  $('#c-send').addEventListener('click', async (e) => {
    if (!stars) return toast('Bitte Sterne wählen');
    const cid = e.currentTarget.dataset.cid;
    await withBusy(e.currentTarget, async () => {
      try {
        await community.api.rate(cid, stars, $('#c-comment').value.trim());
        discover.myRatings[cid] = { stars, comment: $('#c-comment').value.trim() };
        discover.community = null;
        toast('Danke für eure Bewertung!');
      } catch (err) {
        toast(err.message);
      }
    });
  });
  if (community.api && !Object.keys(discover.myRatings).length) {
    community.api.myRatings().then((r) => {
      discover.myRatings = r;
      if (r[$('#c-send')?.dataset.cid]) render();
    }).catch(() => {});
  }
}

/* ================================================================ Kosten */

const euro = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/** Alle Ausgaben, die ich sehen darf: gemeinsame + meine geheimen. */
function visibleExpenses() {
  const priv = Object.entries(S().secrets).filter(([, v]) => v?.kind === 'expense').map(([id, v]) => ({ ...v, id, private: true }));
  return [...S().expenses, ...priv].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

/** Saldo aus gemeinsamen Ausgaben: positiv = die Person bekommt Geld. */
function balances() {
  const bal = { a: 0, b: 0 };
  for (const e of S().expenses) {
    if (e.kind === 'settle') {
      bal[e.paidBy] += e.amount;
      bal[other(e.paidBy)] -= e.amount;
    } else if (e.split === 'half') {
      bal[e.paidBy] += e.amount / 2;
      bal[other(e.paidBy)] -= e.amount / 2;
    }
  }
  return bal;
}

function costSummaryHTML(d) {
  const list = visibleExpenses().filter((e) => e.dateId === d.id && e.kind !== 'settle');
  if (!list.length) return '';
  const total = list.reduce((a, e) => a + e.amount, 0);
  const secret = list.filter((e) => e.private).reduce((a, e) => a + e.amount, 0);
  return `<div class="banner neutral-row">${icon('wallet')}<span class="grow"><strong>Ausgaben: ${euro(total)}</strong>${secret ? `<br><small class="muted">davon ${euro(secret)} geheim – nur du siehst das</small>` : ''}</span></div>`;
}

const datesTabs = (active) => `
  <nav class="seg-tabs" role="tablist">
    <button role="tab" data-dseg="dates" aria-selected="${active === 'dates'}">${icon('bookmark')}Dates</button>
    <button role="tab" data-dseg="kosten" aria-selected="${active === 'kosten'}">${icon('wallet')}Kosten</button>
  </nav>`;
function bindDatesTabs() {
  on('[data-dseg]', 'click', (_, el) => go(el.dataset.dseg));
}

RENDER.kosten = (param) => {
  const role = myRole();
  const partner = other(role);
  const forDate = param?.startsWith('neu:') ? S().dates.find((d) => d.id === param.slice(4)) : null;
  const list = visibleExpenses();
  const now = today();
  const ym = isoDate(now).slice(0, 7);
  const month = list.filter((e) => e.date.startsWith(ym) && e.kind !== 'settle');
  const total = month.reduce((a, e) => a + e.amount, 0);
  const paid = (r) => month.filter((e) => e.paidBy === r).reduce((a, e) => a + e.amount, 0);
  const secretMonth = month.filter((e) => e.private).reduce((a, e) => a + e.amount, 0);
  const bal = balances();
  const mine = role ? Math.round(bal[role] * 100) / 100 : 0;
  const upcomingDates = S().dates.filter((d) => !isHiddenFromMe(d)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const defaultPrivate = !!(forDate?.surprise && forDate.plannedBy === role);
  const draft = { paidBy: role ?? 'a', split: forDate?.surprise ? 'gift' : 'half' };

  const groups = {};
  for (const e of list) (groups[e.date.slice(0, 7)] ??= []).push(e);

  root.innerHTML = `
    ${topbar({ title: 'Unsere Dates' })}
    ${datesTabs('kosten')}
    ${!role ? whoAmICard() : `
    <section class="cost-summary">
      <div>
        <span class="kicker">${MONTHS[now.getMonth()]}</span>
        <strong class="big-num">${euro(total)}</strong>
        <span class="muted small">für Dates ausgegeben</span>
      </div>
      <div class="split-bars">
        ${['a', 'b'].map((r) => `<div class="split-row"><span>${r === role ? 'Du' : esc(nameOf(r))}</span><span class="bar"><span style="width:${total ? Math.round((paid(r) / total) * 100) : 0}%"></span></span><strong>${euro(paid(r))}</strong></div>`).join('')}
      </div>
      ${secretMonth ? `<p class="muted small">${icon('lock')} Davon ${euro(secretMonth)} geheim – ${esc(nameOf(partner))} sieht diese Ausgaben nicht.</p>` : ''}
    </section>
    <section class="panel balance">
      <div class="grow">
        <span class="kicker">Ausgleich</span>
        <strong>${Math.abs(mine) < 0.01 ? 'Ihr seid quitt' : mine > 0 ? `${esc(nameOf(partner))} schuldet dir ${euro(mine)}` : `Du schuldest ${esc(nameOf(partner))} ${euro(-mine)}`}</strong>
        <small class="muted">Nur geteilte Ausgaben („Halbe-halbe“). Einladungen und Geheimes zählen nicht.</small>
      </div>
      ${Math.abs(mine) >= 0.01 ? `<button class="btn sm" id="settle">Ausgeglichen</button>` : ''}
    </section>

    <form class="panel form" id="exp-form" novalidate>
      <div class="panel-head">${icon('plus')}<h2>Ausgabe eintragen</h2></div>
      <div class="row gap">
        <div class="field grow"><label class="label" for="e-title">Wofür?</label><input class="input" id="e-title" maxlength="60" placeholder="z. B. Abendessen" value="${esc(forDate ? dateTitle(forDate).replace(/^Überraschung von .*/, 'Überraschung') : '')}"></div>
        <div class="field narrow-field"><label class="label" for="e-amount">Betrag €</label><input class="input" id="e-amount" inputmode="decimal" placeholder="0,00"></div>
      </div>
      <div class="field"><span class="label">Bezahlt von</span>${chips('payer', [['a', role === 'a' ? 'Mir' : esc(nameOf('a'))], ['b', role === 'b' ? 'Mir' : esc(nameOf('b'))]], draft.paidBy, 'seg')}</div>
      <div class="field"><span class="label">Aufteilung</span>${chips('split', [['half', 'Halbe-halbe'], ['gift', 'Eingeladen']], draft.split, 'seg')}</div>
      <div class="field"><label class="label" for="e-date">Zum Date</label>
        <select class="input" id="e-date"><option value="">Ohne Date</option>${upcomingDates.map((d) => `<option value="${d.id}" ${forDate?.id === d.id ? 'selected' : ''}>${esc(fmtShort(d.date))} · ${esc(dateTitle(d))}</option>`).join('')}</select>
      </div>
      <label class="switch"><input type="checkbox" id="e-private" ${defaultPrivate ? 'checked' : ''}><span><strong>Vor ${esc(nameOf(partner))} verstecken</strong><br><small class="muted">Für Überraschungen und Geschenke. Nur du siehst diese Ausgabe.</small></span></label>
      <button class="btn primary big" type="submit">${icon('check')}Speichern</button>
    </form>

    ${Object.keys(groups).length ? Object.entries(groups).map(([m, items]) => `
      <section class="stack">
        <h2 class="section-title">${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</h2>
        <div class="list-card">
          ${items.map((e) => `
            <div class="date-item static">
              <span class="exp-ico ${e.private ? 'secret' : ''}">${icon(e.kind === 'settle' ? 'repeat' : e.private ? 'lock' : 'wallet')}</span>
              <span class="grow">
                <strong>${esc(e.kind === 'settle' ? `Ausgleich an ${e.paidBy === role ? esc(nameOf(other(e.paidBy))) : 'dich'}` : e.title)}</strong>
                <small class="muted">${fmtShort(e.date)} · ${e.paidBy === role ? 'du' : esc(nameOf(e.paidBy))} · ${e.kind === 'settle' ? 'Ausgleich' : e.split === 'half' ? 'halbe-halbe' : 'eingeladen'}${e.private ? ' · geheim' : ''}</small>
              </span>
              <strong class="amount">${euro(e.amount)}</strong>
              <button class="icon-btn small" data-del-exp="${e.id}" data-priv="${e.private ? 1 : ''}" aria-label="Löschen">${icon('x')}</button>
            </div>`).join('')}
        </div>
      </section>`).join('') : '<p class="muted center">Noch keine Ausgaben eingetragen.</p>'}`}`;

  bindDatesTabs();
  bindWhoAmI();
  if (!role) return;
  const form = $('#exp-form');
  bindChips(form, 'payer', (v) => (draft.paidBy = v));
  bindChips(form, 'split', (v) => (draft.split = v));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Math.round(Number($('#e-amount').value.replace(/\./g, '').replace(',', '.')) * 100) / 100;
    const title = $('#e-title').value.trim() || 'Date';
    if (!(amount > 0)) {
      toast('Bitte einen Betrag eintragen');
      return $('#e-amount').focus();
    }
    const dateId = $('#e-date').value;
    const date = S().dates.find((d) => d.id === dateId)?.date ?? isoDate(today());
    const item = { id: `exp-${uid()}`, kind: 'expense', title, amount, paidBy: draft.paidBy, split: draft.split, date, dateId: dateId || null, createdAt: Date.now() };
    const priv = $('#e-private').checked;
    store.update((s) => {
      if (priv) s.secrets[item.id] = item;
      else s.expenses.push(item);
    });
    toast(priv ? 'Geheim gespeichert' : 'Ausgabe gespeichert');
    go('kosten');
  });
  $('#settle')?.addEventListener('click', () => {
    const debtor = mine > 0 ? partner : role;
    store.update((s) => s.expenses.push({ id: `exp-${uid()}`, kind: 'settle', title: 'Ausgleich', amount: Math.abs(mine), paidBy: debtor, split: 'settle', date: isoDate(today()), createdAt: Date.now() }));
    toast('Als ausgeglichen eingetragen');
    render();
  });
  on('[data-del-exp]', 'click', (_, el) => {
    const id = el.dataset.delExp;
    store.update((s) => {
      if (el.dataset.priv) delete s.secrets[id];
      else s.expenses = s.expenses.filter((x) => x.id !== id);
    });
    render();
  });
};

/* ================================================================ Fotos & Erinnerung am Date */

const photoList = (d) => Object.values(d.photos ?? {}).sort((a, b) => a.at - b.at);
const photoImg = (ph, cls = '') => `<img class="${cls}" data-photo="${esc(JSON.stringify(ph))}" alt="" loading="lazy">`;
let uploadVisibility = 'privat';

function photosSectionHTML(d) {
  const list = photoList(d);
  const shareable = photos.canShare();
  return `
    <section class="panel stack" id="photos-sec">
      <div class="panel-head">${icon('camera')}<h2>Fotos & Erinnerung</h2></div>
      ${list.length ? `<div class="photo-grid">${list.map((ph) => `
        <figure class="photo">
          ${photoImg(ph)}
          <span class="photo-badge">${ph.public ? 'Öffentlich' : 'Nur ihr'}</span>
          ${ph.by === myRole() || !ph.by ? `<button class="photo-del" data-del-photo="${ph.id}" aria-label="Foto löschen">${icon('x')}</button>` : ''}
        </figure>`).join('')}</div>` : '<p class="muted small">Haltet den Moment fest – die Fotos landen auch in eurem Jahresrückblick.</p>'}
      ${shareable ? chips('phvis', [['privat', 'Nur wir zwei', 'lock'], ['public', 'Öffentlich', 'users']], uploadVisibility, 'seg') : '<p class="muted small">Fotos bleiben auf diesem Gerät. Mit Supabase seht ihr sie beide.</p>'}
      <label class="btn soft" for="ph-input">${icon('camera')}Fotos hinzufügen</label>
      <input type="file" id="ph-input" accept="image/*" multiple hidden>
      ${uploadVisibility === 'public' && shareable ? '<p class="muted small">Öffentliche Fotos können andere Paare in der Community sehen.</p>' : ''}
      <div class="field">
        <label class="label" for="memory">Was war besonders?</label>
        <textarea class="input" id="memory" rows="3" maxlength="600" placeholder="Ein Satz für euren Jahresrückblick …">${esc(d.memory ?? '')}</textarea>
      </div>
    </section>`;
}

function bindPhotosSection(d) {
  const sec = $('#photos-sec');
  if (!sec) return;
  bindChips(sec, 'phvis', (v) => {
    uploadVisibility = v;
  });
  photos.hydratePhotos(sec);
  $('#ph-input').addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, 12);
    e.target.value = '';
    if (!files.length) return;
    const label = sec.querySelector('label[for="ph-input"]');
    label.classList.add('busy');
    let done = 0;
    for (const file of files) {
      label.innerHTML = `<span class="spinner"></span> ${++done}/${files.length}`;
      try {
        const ph = await photos.savePhoto(file, { dateId: d.id, isPublic: uploadVisibility === 'public', by: myRole() });
        store.update((s) => {
          const x = s.dates.find((y) => y.id === d.id);
          if (x) x.photos = { ...(x.photos ?? {}), [ph.id]: ph };
        });
        if (ph.public && d.sharedId && community.api) community.api.addPhoto(d.sharedId, ph.url).catch(() => {});
      } catch (err) {
        toast(err.message);
      }
    }
    toast(`${done} Foto${done > 1 ? 's' : ''} gespeichert`);
    render();
  });
  on('[data-del-photo]', 'click', async (_, el) => {
    const ph = d.photos?.[el.dataset.delPhoto];
    if (!ph) return;
    if (!el.dataset.armed) {
      el.dataset.armed = '1';
      el.classList.add('armed');
      return setTimeout(() => {
        delete el.dataset.armed;
        el.classList.remove('armed');
      }, 3000);
    }
    await photos.deletePhoto(ph).catch(() => {});
    store.update((s) => {
      const x = s.dates.find((y) => y.id === d.id);
      if (x?.photos) {
        const { [ph.id]: _gone, ...rest } = x.photos;
        x.photos = rest;
      }
    });
    render();
  });
  $('#memory').addEventListener('change', (e) => {
    store.update((s) => {
      const x = s.dates.find((y) => y.id === d.id);
      if (x) x.memory = e.target.value.trim();
    });
    toast('Erinnerung gespeichert');
  });
}

/* ================================================================ Jahresrückblick (Fotobuch) */

function yearDates(year) {
  const t = isoDate(today());
  return S().dates
    .filter((d) => d.date.startsWith(String(year)) && d.date <= t && !isHiddenFromMe(d))
    .map((d) => ({ d, plan: fullPlan(d) ?? d }))
    .sort((a, b) => a.d.date.localeCompare(b.d.date));
}

function bookYears() {
  const ys = new Set(S().dates.filter((d) => d.date <= isoDate(today())).map((d) => Number(d.date.slice(0, 4))));
  ys.add(today().getFullYear());
  return [...ys].sort((a, b) => b - a);
}

const avgRating = (d) => {
  const v = Object.values(d.ratings ?? {}).filter(Boolean);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

function photoLayout(list) {
  if (!list.length) return '';
  const shown = list.slice(0, 4);
  return `<div class="page-photos n${shown.length}">${shown.map((ph) => `<figure class="photo">${photoImg(ph)}</figure>`).join('')}</div>`;
}

RENDER.rueckblick = (param) => {
  const year = Number(param) || bookYears()[0];
  const entries = yearDates(year);
  const names = `${nameOf('a')} & ${nameOf('b')}`;
  const allPhotos = entries.flatMap(({ d }) => photoList(d));
  const cover = [...allPhotos].sort(() => 0.5 - Math.random()).slice(0, 4);
  const hours = Math.round(entries.reduce((a, { plan }) => a + (plan.duration ?? 0), 0) / 60);
  const moodCount = {};
  entries.forEach(({ plan }) => (plan.moods ?? []).forEach((m) => (moodCount[m] = (moodCount[m] ?? 0) + 1)));
  const favMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const best = [...entries].sort((a, b) => avgRating(b.d) - avgRating(a.d))[0];
  const places = new Set(entries.flatMap(({ plan }) => (plan.steps ?? []).filter((s) => s.place).map((s) => s.place.name)));
  const months = new Set(entries.map(({ d }) => d.date.slice(5, 7)));
  const planned = { a: 0, b: 0, both: 0 };
  let surprises = 0;
  for (const { d } of entries) {
    if (d.plannedBy in planned) planned[d.plannedBy]++;
    if (d.surprise || d.revealed) surprises++;
  }
  const maxPlanned = Math.max(1, planned.a, planned.b, planned.both);
  const canPrint = !store.inArtifact();

  const datePage = ({ d, plan }, i) => {
    const list = photoList(d);
    const r = avgRating(d);
    const stops = [...new Set((plan.steps ?? []).map((s) => s.place?.name ?? s.title).filter((x) => x && x !== plan.title))].slice(0, 4);
    return `
      <section class="page date-page ${list.length ? '' : 'nophoto'}">
        <header class="page-head">
          <span class="page-month">${MONTHS[Number(d.date.slice(5, 7)) - 1]}</span>
          <span class="page-no">${String(i + 1).padStart(2, '0')}</span>
        </header>
        ${photoLayout(list) || `<div class="page-emoji" aria-hidden="true">${glyph(plan.emoji ?? '💞')}</div>`}
        <div class="page-text">
          <h2>${esc(plan.title ?? 'Unser Date')}</h2>
          <p class="page-meta">${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}${stops.length ? ` · ${stops.map(esc).join(' → ')}` : ''}</p>
          ${d.memory ? `<blockquote>${esc(d.memory)}</blockquote>` : ''}
          ${r ? `<p class="page-hearts" aria-label="${r.toFixed(1)} von 5">${'♥'.repeat(Math.round(r))}<span>${'♥'.repeat(5 - Math.round(r))}</span></p>` : ''}
        </div>
      </section>`;
  };

  root.innerHTML = `
    <div class="no-print">
      ${topbar({ title: 'Jahresrückblick', sub: 'Euer Fotobuch mit allen Dates des Jahres.', back: ['dates', '', 'Unsere Dates'] })}
      ${chips('year', bookYears().map((y) => [y, String(y)]), year)}
      ${entries.length ? `
        <div class="row gap wrap">
          ${canPrint ? `<button class="btn primary grow" id="print">${icon('download')}Als PDF speichern</button>` : ''}
        </div>
        <p class="muted small">${canPrint ? 'Im Druckdialog „Als PDF sichern“ wählen (iPhone: Teilen → Drucken → mit zwei Fingern aufziehen → Teilen).' : 'Als PDF speichern geht in der Webseiten-Version.'} ${allPhotos.length ? '' : 'Tipp: Ladet Fotos zu euren Dates hoch, dann wird das Buch noch schöner.'}</p>` : ''}
    </div>

    ${!entries.length ? `<div class="empty"><p>Für ${year} gibt es noch keine vergangenen Dates. Euer Buch füllt sich mit jedem Date.</p></div>` : `
    <div class="book" id="book">
      <section class="page cover">
        <div class="cover-collage n${cover.length}">${cover.map((ph) => `<figure class="photo">${photoImg(ph)}</figure>`).join('')}</div>
        <div class="cover-text">
          <span class="cover-brand">Dately</span>
          <h1>${year}</h1>
          <p class="cover-names">${esc(names)}</p>
          <p class="cover-tag">Your next favorite memory</p>
        </div>
      </section>

      <section class="page stats-page">
        <h2>Euer Jahr in Zahlen</h2>
        <div class="stat-grid">
          <div><strong>${entries.length}</strong><span>${entries.length === 1 ? 'Date' : 'Dates'}</span></div>
          <div><strong>${hours}</strong><span>${hours === 1 ? 'Stunde' : 'Stunden'} zu zweit</span></div>
          <div><strong>${months.size}</strong><span>${months.size === 1 ? 'Monat' : 'Monate'} mit Dates</span></div>
          <div><strong>${places.size || allPhotos.length}</strong><span>${places.size ? 'besondere Orte' : 'Fotos'}</span></div>
        </div>
        ${favMood ? `<p class="stat-line">Eure Lieblingsstimmung: <strong>${esc(moodLabel(favMood))}</strong></p>` : ''}
        <div class="who-planned">
          <span class="kicker">Wer hat geplant?</span>
          ${[['a', nameOf('a')], ['b', nameOf('b')], ['both', 'Zusammen']].map(([k, label]) => `
            <div class="wp-row"><span>${esc(label)}</span><span class="wp-bar"><span style="width:${Math.round((planned[k] / maxPlanned) * 100)}%"></span></span><strong>${planned[k]}</strong></div>`).join('')}
          ${surprises ? `<p class="stat-line">${surprises} ${surprises === 1 ? 'Überraschung' : 'Überraschungen'} – ${planned.a === planned.b ? 'ihr überrascht euch gleich gern' : `${esc(nameOf(planned.a > planned.b ? 'a' : 'b'))} hat öfter geplant`}.</p>` : ''}
        </div>
        ${best && avgRating(best.d) ? `<p class="stat-line">Euer Highlight: <strong>${esc(best.plan.title)}</strong> im ${MONTHS[Number(best.d.date.slice(5, 7)) - 1]}</p>` : ''}
      </section>

      ${entries.map(datePage).join('')}

      <section class="page end-page">
        <p class="end-big">${entries.length === 1 ? 'Ein Date' : `${entries.length} Dates`}.<br>Unzählige Lieblingsmomente.</p>
        <p class="cover-tag">Dately · Your next favorite memory</p>
      </section>
    </div>`}`;

  bindBack();
  bindChips(root, 'year', (v) => go('rueckblick', v));
  const book = $('#book');
  if (book) photos.hydratePhotos(book);
  $('#print')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      await photos.hydratePhotos(book);
      await Promise.all([...book.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    });
    window.print();
  });
};

/* ================================================================ 6. Unsere Dates */

RENDER.dates = () => {
  const s = S();
  const t = isoDate(today());
  const upcoming = s.dates.filter((d) => d.date >= t).sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  const past = s.dates.filter((d) => d.date < t).sort((x, y) => y.date.localeCompare(x.date));

  const item = (d, isPast) => {
    const r = d.ratings ?? {};
    const vals = Object.values(r).filter(Boolean);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return `
      <button class="date-item" data-open-date="${d.id}">
        <span class="idea-emoji" aria-hidden="true">${glyph(dateEmoji(d))}</span>
        <span class="grow">
          <strong>${esc(dateTitle(d))}</strong>
          <small class="muted">${relDay(d.date) ?? fmtShort(d.date)} · ${d.start} Uhr · ${esc(plannerLabel(d))}</small>
        </span>
        ${isPast ? (avg ? `<span class="score">${icon('heart')}${avg.toFixed(1).replace('.', ',')}</span>` : '<small class="muted">bewerten</small>') : d.surprise ? `<span class="tag">${icon(isHiddenFromMe(d) ? 'gift' : 'lock')}${isHiddenFromMe(d) ? 'Überraschung' : 'Geheim'}</span>` : icon('right', 'chev')}
      </button>`;
  };

  root.innerHTML = `
    ${topbar({ title: 'Unsere Dates' })}
    ${datesTabs('dates')}
    <button class="book-teaser" data-go-book>${icon('book')}<span class="grow"><strong>Jahresrückblick ${today().getFullYear()}</strong><br><small class="muted">Euer Fotobuch mit allen Dates</small></span>${icon('right')}</button>
    <section class="stack">
      <h2 class="section-title">Geplant</h2>
      ${upcoming.length ? `<div class="list-card">${upcoming.map((d) => item(d, false)).join('')}</div>` : `
        <div class="empty"><p>Noch kein Date geplant.</p><button class="btn primary" data-back="start">Date planen</button></div>`}
    </section>
    <section class="stack">
      <h2 class="section-title">Erinnerungen</h2>
      ${past.length ? `<div class="list-card">${past.map((d) => item(d, true)).join('')}</div>` : '<p class="muted">Hier sammeln sich eure vergangenen Dates mit euren Bewertungen.</p>'}
    </section>`;
  bindBack();
  bindDatesTabs();
  on('[data-go-book]', 'click', () => go('rueckblick'));
  on('[data-open-date]', 'click', (_, el) => go('date', el.dataset.openDate));
};

/* ================================================================ 7. Mehr / Einstellungen */

RENDER.mehr = () => {
  const st = S().settings;
  const sync = store.syncInfo();
  const role = myRole();

  root.innerHTML = `
    ${topbar({ title: 'Einstellungen', sub: 'Einmal eintragen, die App erinnert euch.', back: ['start', '', 'Start'] })}

    <section class="panel form">
      <div class="panel-head">${icon('users')}<h2>Ihr zwei</h2></div>
      <div class="row gap wrap">
        <div class="field grow"><label class="label" for="s-nameA">Person 1</label><input class="input" id="s-nameA" data-set="nameA" value="${esc(st.nameA)}" placeholder="Name"></div>
        <div class="field grow"><label class="label" for="s-nameB">Person 2</label><input class="input" id="s-nameB" data-set="nameB" value="${esc(st.nameB)}" placeholder="Name"></div>
      </div>
      <div class="field">
        <span class="label">Ich bin</span>
        ${chips('me', [['a', esc(nameOf('a'))], ['b', esc(nameOf('b'))]], role ?? '', 'seg')}
      </div>
    </section>

    <section class="panel form">
      <div class="panel-head">${icon(sync.mode === 'shared' ? 'users' : 'lock')}<h2>Gemeinsam nutzen</h2></div>
      ${sharingHTML()}
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('pin')}<h2>Ort & Vorlieben</h2></div>
      <div class="field">
        <label class="label" for="s-city">Stadt</label>
        <div class="row gap"><input class="input grow" id="s-city" value="${esc(st.city)}" placeholder="z. B. München"><button class="btn" id="check-city" type="button">Prüfen</button></div>
        <small class="muted" id="city-info">${st.geo ? `${esc(st.geo.name)}, ${esc(st.geo.country)} · Wetter automatisch` : st.city ? 'Wetter wird bei der Suche abgefragt' : ''}</small>
      </div>
      <label class="switch"><input type="checkbox" id="s-vegan" data-set="vegan" ${st.vegan ? 'checked' : ''}><span><strong>Vegan bevorzugen</strong><br><small class="muted">Restaurant-Links suchen vegan, Rezepte tauschen Zutaten.</small></span></label>
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('sparkle')}<h2>Vorlieben</h2></div>
      <p class="muted small">${['a', 'b'].map((r) => { const p = st.prefs?.[r]; return `<strong>${esc(r === role ? 'Du' : nameOf(r))}:</strong> ${p?.moods?.length ? esc(p.moods.map(moodLabel).join(', ')) : 'noch nichts angegeben'}`; }).join('<br>')}</p>
      <button class="btn soft" type="button" data-ob-open="vorlieben">${icon('sparkle')}Meine Vorlieben bearbeiten</button>
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('repeat')}<h2>Date-Rhythmus</h2></div>
      <div class="row between">
        <span>Dates pro Monat</span>
        <div class="stepper">
          <button class="icon-btn" data-step="-1" type="button" aria-label="Weniger">−</button>
          <output id="per-month">${st.datesPerMonth}</output>
          <button class="icon-btn" data-step="1" type="button" aria-label="Mehr">+</button>
        </div>
      </div>
      <div class="field">
        <span class="label">Feste Termine</span>
        <ul class="mini-list">
          ${st.fixed.map((f) => `<li><span class="grow">${esc(f.title)}</span><span class="muted">${WD_SHORT[f.weekday]} · ${f.time}</span><button class="icon-btn small" data-del-fixed="${f.id}" aria-label="Entfernen">${icon('x')}</button></li>`).join('') || '<li class="muted">z. B. jeden Freitag Date-Night</li>'}
        </ul>
        <form id="add-fixed" class="stack-sm">
          <input class="input" id="fx-title" name="title" placeholder="z. B. Date-Night" required>
          <div class="row gap">
            <select class="input" id="fx-day" name="weekday" aria-label="Wochentag">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === 5 ? 'selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select>
            <input class="input" id="fx-time" type="time" name="time" value="19:00" aria-label="Uhrzeit">
            <button class="btn square" aria-label="Festen Termin hinzufügen">${icon('plus')}</button>
          </div>
        </form>
      </div>
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('star')}<h2>Besondere Tage</h2></div>
      <button class="btn soft" type="button" data-ob-open="tage">${icon('heart')}Jahrestag, Hochzeit & Geburtstage bearbeiten</button>
      <div class="field"><label class="label" for="s-anniv">Jahrestag</label><input class="input" type="date" id="s-anniv" data-set="anniversary" value="${esc(st.anniversary)}"></div>
      <label class="switch"><input type="checkbox" id="s-val" data-set="valentine" ${st.valentine ? 'checked' : ''}><span><strong>An Valentinstag erinnern</strong></span></label>
      <ul class="mini-list">
        ${st.specialDays.map((d) => `<li><span class="grow">${esc(d.kind === 'geburtstag' ? `Geburtstag ${d.who ? nameOf(d.who) : d.name}` : d.kind === 'standesamt' ? 'Hochzeitstag (Standesamt)' : d.kind === 'hochzeit' ? 'Hochzeitstag' : d.name)}</span><span class="muted">${fmtDate(d.date, { day: 'numeric', month: 'long' })}</span><button class="icon-btn small" data-del-special="${d.id}" aria-label="Entfernen">${icon('x')}</button></li>`).join('')}
      </ul>
      <form id="add-special" class="stack-sm">
        <div class="row gap">
          <select class="input" id="sp-kind" name="kind" aria-label="Art"><option value="geburtstag">Geburtstag</option><option value="sonstiges">Anderer Anlass</option></select>
          <input class="input grow" id="sp-name" name="name" placeholder="Name oder Anlass" required>
        </div>
        <div class="row gap"><input class="input grow" id="sp-date" type="date" name="date" required aria-label="Datum"><button class="btn">Hinzufügen</button></div>
      </form>
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('calendar')}<h2>Google Kalender</h2></div>
      ${googleSettingsHTML()}
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('star')}<h2>Weitere Datenquellen</h2></div>
      <p class="${serverStatus ? '' : 'muted '}small">${serverStatus ? `${icon('check', 'inline')} Dately-Server ist eingerichtet: Orte kommen schnell über euren Supabase-Server${serverStatus.google ? ', Google-Bewertungen, Fotos und Öffnungszeiten ebenfalls – ein eigener Schlüssel unten ist nicht mehr nötig' : ''}.` : 'Tipp: Mit der Server-Funktion „places“ (Anleitung im README) laden Orte viel schneller und Google-Daten kommen sicher über euren Server.'}</p>
      <p><strong>Veranstaltungen</strong> (Konzerte, Shows, Theater, Festivals): Mit einem kostenlosen Ticketmaster-Schlüssel zeigt Dately Veranstaltungen in eurem Umkreis und macht daraus Date-Ideen.</p>
      <div class="field"><label class="label" for="tm-key">Ticketmaster API Key</label><input class="input" id="tm-key" data-set="ticketmasterKey" value="${esc(S().settings.ticketmasterKey ?? '')}" placeholder="Consumer Key" autocomplete="off"><small class="muted">Kostenlos unter developer.ticketmaster.com → „Get your API Key“ (Anleitung im README).</small></div>
      <p><strong>Google-Bewertungen & Fotos:</strong> Mit einem eigenen Google-Places-Schlüssel zeigt die App bei Orten die Google-Sterne und ein Foto. Ohne Schlüssel gibt es Bilder aus Wikimedia und einen Link zu den Google-Bewertungen.</p>
      <div class="field"><label class="label" for="g-places">Places API Key</label><input class="input" id="g-places" data-set="googlePlacesKey" value="${esc(S().settings.googlePlacesKey ?? '')}" placeholder="AIza…" autocomplete="off"></div>
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('download')}<h2>Daten</h2></div>
      <div class="row gap wrap">
        <button class="btn" id="export" type="button">${icon('download')}Backup speichern</button>
        <label class="btn" for="import">${icon('repeat')}Backup laden</label>
        <input type="file" id="import" accept="application/json,.json" hidden>
        <button class="btn ghost danger" id="reset" type="button">${icon('trash')}${store.syncInfo().mode === 'shared' ? 'Alle gemeinsamen Daten löschen' : 'Alles löschen'}</button>
      </div>
    </section>`;

  bindChips(root, 'me', (v) => {
    store.claimRole(v);
    toast(`Du bist ${nameOf(v)}`);
    render();
  });
  on('[data-set]', 'change', (_, el) => {
    const k = el.dataset.set;
    store.update((s) => (s.settings[k] = el.type === 'checkbox' ? el.checked : el.value.trim()));
    toast('Gespeichert');
    if (k === 'nameA' || k === 'nameB' || k === 'googleClientId') render();
  });
  const checkCity = async () => {
    const name = $('#s-city').value.trim();
    const info = $('#city-info');
    if (!name) {
      store.update((s) => Object.assign(s.settings, { city: '', geo: null }));
      info.textContent = '';
      return;
    }
    info.textContent = 'Suche …';
    const geo = await ensureGeo(name);
    info.textContent = geo ? `${geo.name}, ${geo.country} · Wetter automatisch` : 'Gespeichert. Das Wetter wählt ihr bei der Suche selbst.';
  };
  $('#check-city').addEventListener('click', checkCity);
  $('#s-city').addEventListener('change', checkCity);
  on('[data-step]', 'click', (_, el) => {
    store.update((s) => (s.settings.datesPerMonth = Math.min(12, Math.max(1, s.settings.datesPerMonth + Number(el.dataset.step)))));
    $('#per-month').textContent = S().settings.datesPerMonth;
  });
  $('#add-special').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    store.update((s) => s.settings.specialDays.push({ id: uid(), name: String(fd.get('name')).trim(), date: fd.get('date'), kind: fd.get('kind') }));
    render();
  });
  on('[data-del-special]', 'click', (_, el) => {
    store.update((s) => (s.settings.specialDays = s.settings.specialDays.filter((d) => d.id !== el.dataset.delSpecial)));
    render();
  });
  $('#add-fixed').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    store.update((s) => s.settings.fixed.push({ id: uid(), title: String(fd.get('title')).trim(), weekday: Number(fd.get('weekday')), time: fd.get('time') }));
    render();
  });
  on('[data-del-fixed]', 'click', (_, el) => {
    store.update((s) => (s.settings.fixed = s.settings.fixed.filter((f) => f.id !== el.dataset.delFixed)));
    render();
  });
  bindBack();
  on('[data-ob-open]', 'click', (_, el) => {
    session.obForce = el.dataset.obOpen;
    go('start');
  });
  bindSharing();
  bindGoogleSettings();
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.settings || !Array.isArray(data.dates)) throw new Error();
      store.update((st) => {
        st.settings = { ...st.settings, ...data.settings, members: st.settings.members };
        for (const c of store.COLLECTIONS) if (Array.isArray(data[c])) {
          const have = new Set(st[c].map((x) => x.id));
          st[c] = [...st[c], ...data[c].filter((x) => x?.id && !have.has(x.id))];
        }
      });
      toast('Backup geladen');
      render();
    } catch {
      toast('Diese Datei ist kein Dately-Backup');
    }
  });
  $('#export').addEventListener('click', () => {
    const { secrets, ...shared } = S();
    saveFile(`dately-backup-${isoDate(today())}.json`, JSON.stringify(shared, null, 2), 'application/json');
  });
  armed($('#reset'), () => {
    store.reset();
    toast('Alles gelöscht');
    render(true);
  }, store.syncInfo().mode === 'shared' ? 'Nochmal tippen: alles für euch beide löschen' : 'Nochmal tippen: wirklich alles löschen');
  root.insertAdjacentHTML('beforeend', '<p class="signature">Dately · Made for moments.</p>');
};

/* ================================================================ Start */

(async function boot() {
  const initial = location.hash.replace('#', '');
  if (['kalender', 'dates', 'mehr', 'entdecken'].includes(initial)) current = { name: initial, param: null };
  try {
    await loadIdeas();
  } catch {
    /* ohne Ideenliste weiter */
  }
  const invite = readInvite();
  if (invite) {
    history.replaceState(null, '', location.pathname);
    saveConfig({ ...invite, coupleId: null });
  }
  render();
  autoReveal();
  if (await store.connect()) return render();
  if (!getConfig()?.url && !SUPABASE.url) {
    cleanDuplicateSurveys();
    render();
  }
  let cfg = getConfig();
  if (!cfg?.url && SUPABASE.url && SUPABASE.key) cfg = { url: SUPABASE.url, key: SUPABASE.key, coupleId: null, code: null };
  if (cfg?.url && cfg?.key) await startAccount(cfg);
  refreshGpsSilently();
})();
