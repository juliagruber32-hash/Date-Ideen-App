import * as store from './store.js';
import { isHiddenFromMe, myRole, nameOf, other } from './store.js';
import { geocode, geocodeList, getWeather, manualWeather } from './weather.js';
import { setAvailability } from './engine.js';
import { agbHTML, datenschutzHTML, impressumHTML, legalComplete } from './legal.js';
import { allIdeas, buildPlan, combineWishes, setPreferences, defaultStart, ideaDuration, loadIdeas, MOODS, moodLabel, REACH, recommend, rhythmStatus, setExtraIdeas, stepLinks, suggest, toICS } from './engine.js';
import { isCasualFood, searchNotable } from './places.js';
import { appleMapsLink, CATEGORIES, CUISINES, catForStep, isXmasSeason, categoryById, directionsLink, distanceKm, fmtKm, fmtMin, formatHours, hoursOn, isOpenAt, locate, mapLink, placeName, reservationLinks, searchByName, searchMixed, searchNearby, travelEstimates } from './places.js';
import { googleDetails, googleSearch, googleViaServer, setGoogleProxy } from './gplaces.js';
import { setPlacesProxy } from './places.js';
import { generateLocalDates, travelLine } from './generate.js';
import { eventWhen, fetchEvents, ideaFromEvent } from './events.js';
import { allowedImage, findImage, imageCredit, topicFor } from './images.js';
import { areaProgress, ensureArea, getArea, onAreaChange } from './area.js';
import { buildProfile, learnScore, mainCat } from './taste.js';
import * as photos from './photos.js';
import { SUPABASE } from './config.js';
import * as gcal from './gcal.js';
import { callNotify, callPlaces, connectSupabase, currentSession, logClientError, deleteAccount, getConfig, getRemember, lastEmail, setRemember, inviteErrorText, invitationInfo, inviteLinkFor, normCode, onAuthChange, readInvite, resetPassword, saveConfig, signIn, signInWithApple, signOut, signUp, updatePassword } from './remote.js';
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

const TAB_OF = { start: 'start', suggest: 'start', plan: 'start', poll: 'start', match: 'start', neu: 'start', impressum: 'mehr', datenschutz: 'mehr', agb: 'mehr', entdecken: 'entdecken', idee: 'entdecken', ort: 'entdecken', teilen: 'entdecken', kosten: 'dates', eigen: 'dates', moderation: 'mehr', einladen: 'mehr', code: 'mehr', trennen: 'mehr', rueckblick: 'dates', kalender: 'kalender', listen: 'listen', dates: 'dates', date: 'dates', mehr: 'mehr' };
const RENDER = {};
// Ohne Anmeldung erreichbar: Anmeldung und rechtliche Seiten
const OPEN_ROUTES = new Set(['konto', 'impressum', 'datenschutz', 'agb']);
let current = { name: 'start', param: null };

/* --- Navigation: Seite in der Adresse merken, Zurück per Wischen ------------- */

let navIdx = 0;
const hashOf = (c) => `#${c.name}${c.param ? `/${encodeURIComponent(c.param)}` : c.name === 'entdecken' && discover?.tab && discover.tab !== 'fuereuch' ? `/${discover.tab}` : ''}`;
function parseHash(h = location.hash) {
  const m = h.match(/^#([a-z]+)(?:\/([^&=]+))?$/);
  if (!m || !RENDER[m[1]] || m[1] === 'konto') return null;
  const param = m[2] ? decodeURIComponent(m[2]) : null;
  if (m[1] === 'entdecken') return { name: 'entdecken', param: null, tab: param };
  return { name: m[1], param };
}

function go(name, param = null, { replace = false } = {}) {
  if (auth.needed && !OPEN_ROUTES.has(name)) name = 'konto';
  current = { name, param };
  if (name !== 'konto') {
    if (replace) history.replaceState({ dately: true, idx: navIdx }, '', hashOf(current));
    else history.pushState({ dately: true, idx: ++navIdx }, '', hashOf(current));
  }
  render(true);
}

/** Zurück: zur vorherigen Seite – oder, wenn es keine gibt, zum Start. */
function goBack(fallback = ['start', null]) {
  if (history.state?.dately && history.state.idx > 0) history.back();
  else go(fallback[0], fallback[1], { replace: true });
}

window.addEventListener('popstate', (e) => {
  const c = parseHash();
  if (!c) return;
  navIdx = e.state?.idx ?? 0;
  if (c.tab) discover.tab = c.tab;
  current = { name: c.name, param: c.param };
  render(true);
});

// Von links nach rechts wischen = zurück (nicht in Karussells, Karten und beim Date-Match)
(() => {
  let x0 = null;
  let y0 = 0;
  let edge = false;
  const blocked = (el) => el?.closest?.('.hero-row, .mini-row, .cat-row, .cuis-row, .filter-bar, .h-scroll, .swipe-card, .plan-map, .pl-map, .reco-row, input, textarea, select, .leaflet-container, .match-flash');
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || blocked(e.target)) return (x0 = null);
    x0 = t.clientX;
    y0 = t.clientY;
    edge = x0 < 36;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    const t = e.touches[0];
    const dx = t.clientX - x0;
    const dy = Math.abs(t.clientY - y0);
    if (dy > 40 && dy > dx) return (x0 = null);
    if (dx > 12) root.style.transform = `translateX(${Math.min(dx, 160) * 0.35}px)`;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = Math.abs(t.clientY - y0);
    x0 = null;
    root.style.transform = '';
    if (current.name === 'start' && !(history.state?.idx > 0)) return;
    if (dx > (edge ? 60 : 110) && dy < 60) goBack();
  }, { passive: true });
})();

function render(scrollTop = false) {
  if (auth.needed && !OPEN_ROUTES.has(current.name)) current = { name: 'konto', param: null };
  const obStep = !auth.needed && !OPEN_ROUTES.has(current.name) ? onboardingStep() : null;
  document.body.classList.toggle('auth-screen', current.name === 'konto' || !!obStep);
  formDirty = false;
  pendingRender = false;
  setPreferences(S().settings.prefs);
  setAvailability(ideaAvailable);
  try {
    buildProfile({ dates: S().dates.map(fullPlanOrMeta), favorites: S().favorites, learn: S().settings.learn ?? {}, ideaById });
  } catch {
    /* Lernprofil ist optional */
  }
  setExtraIdeas([...S().ideas, ...S().favorites.filter((f) => f.idea).map((f) => ({ ...f.idea, id: f.ideaId }))]);
  $$('.tabbar button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === TAB_OF[current.name]));
  if (!scrollTop) {
    root.classList.remove('enter');
    clearTimeout(enterTimer);
  }
  (obStep ? RENDER.onboarding : RENDER[current.name] ?? RENDER.start)(current.param);
  offlineNote();
  enhanceDateInputs();
  hydrateMedia();
  if (current.name === 'plan' || current.name === 'date') drawPlanMap(lastPlan ?? { steps: [] });
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

/** Paar-Funktionen sind ohne verbundenen Partner sichtbar, aber ausgegraut. */
const pairLocked = () => store.syncInfo().backend === 'supabase' && !!myRole() && !partnerJoined();
const lockAttr = () => (pairLocked() ? ' data-pair-lock aria-disabled="true"' : '');
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-pair-lock]');
  if (!el || !pairLocked()) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const p = partnerName();
  openSheet('Das macht ihr zusammen', `
    <p>${esc(el.dataset.pairLockText || 'Diese Funktion ist für euch zwei gemacht.')} ${coupleState() === 'offen' ? `Sobald ${esc(p || 'dein Lieblingsmensch')} dabei ist, geht es los.` : ''}</p>
    <button type="button" class="btn primary big" data-sheet-invite>${icon('heart')}${coupleState() === 'offen' ? 'Erinnerung schicken' : 'Partner einladen'}</button>`, (sh) => {
    sh.querySelector('[data-sheet-invite]').addEventListener('click', () => {
      closeSheet();
      if (coupleState() === 'offen') shareInvite(partnerState.invite);
      else go('einladen');
    });
  });
}, true);

/** Leere Datumsfelder zeigen „TT.MM.JJJJ“ (iPhone zeigt sonst ein leeres Feld). */
function enhanceDateInputs() {
  $$('input[type="date"]', root).forEach((inp) => {
    if (inp.parentNode.classList.contains('date-wrap')) return;
    const wrap = document.createElement('span');
    wrap.className = 'date-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    wrap.insertAdjacentHTML('beforeend', '<span class="date-ph" aria-hidden="true">TT.MM.JJJJ</span>');
    const sync = () => wrap.classList.toggle('is-empty', !inp.value);
    inp.addEventListener('input', sync);
    inp.addEventListener('change', sync);
    sync();
  });
}

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

const RADIUS_STEPS = [5, 15, 40, 100];
/** Budget-Regler: ganz rechts heißt „200 €+“ – dann gibt es keine Obergrenze. */
const budgetVal = (b) => (Number(b) >= 200 ? 100000 : Number(b));
const budgetLabel = (b) => (Number(b) >= 200 ? '200 €+' : `${b} €`);
const kmToReach = (km) => (km === 0 ? 0 : km <= 15 ? 1 : 2);
const reachToKm = (reach) => (reach === 0 ? 0 : reach === 2 ? 60 : 15);

/** Chips: (Zuhause) · 5 · 15 · 40 · 60 · 100 km · Eigener, plus Eingabefeld für den eigenen Wert. */
function radiusChips(group, km, { home = false } = {}) {
  const custom = km > 0 && !RADIUS_STEPS.includes(km);
  const opts = [...(home ? [[0, 'Zuhause', 'home']] : []), ...RADIUS_STEPS.map((k) => [k, `${k} km`]), ['eigen', custom ? `${km} km` : 'Eigene Entfernung']];
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
    // Wie der Zurück-Knopf des Handys: zur vorherigen Seite, sonst zum angegebenen Ziel
    goBack([name, param || null]);
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
/** „Heute Abend“, „Morgen tagsüber“, „Freitagabend“ … */
const whenLabel = (iso, d) => {
  const rel = relDay(iso);
  if (rel) return d === 'abend' ? `${rel} Abend` : `${rel} tagsüber`;
  const wd = new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long' });
  return d === 'abend' ? `${wd}abend` : `${wd} tagsüber`;
};
const ctxLine = (c) => `${relDay(c.date) ?? fmtShort(c.date)} · ${daytimeLabel(c.daytime)} · bis ${c.budget} €`;

const weatherGlyph = (w) => (w?.wet ? 'rain' : w?.clear ? 'sun' : 'cloud');

function weatherPill(w, daytime = '') {
  if (!w?.icon) return '';
  const g = weatherGlyph(w);
  return `<span class="pill">${icon(g === 'sun' && daytime === 'abend' ? 'moon' : g)}${w.temp != null ? `${w.temp}° · ` : ''}${esc(w.label)}</span>`;
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

const noRoleMsg = () => (store.syncInfo().backend === 'supabase' ? 'Einen Moment – dein Konto wird noch geladen' : 'Wähle zuerst auf der Startseite, wer du bist');

function whoAmICard() {
  const role = myRole();
  if (role) return '';
  // Mit Konto ordnet Datewell dich automatisch zu
  if (store.syncInfo().backend === 'supabase') {
    const m = S().settings.members ?? {};
    return m.a && m.b && store.syncInfo().ready ? `<section class="panel who"><p>Dieses Paar ist schon vollständig verbunden. Prüfe in den Einstellungen, ob du den richtigen Einladungslink geöffnet hast.</p></section>` : '';
  }
  const st = S().settings;
  const taken = st.members ?? {};
  const shared = store.syncInfo().backend === 'claude';
  return `
    <section class="panel who">
      <div class="panel-head">${icon('user')}<h2>Wer bist du?</h2></div>
      <p class="muted">Damit die App weiß, wer plant und wer überrascht wird.${!st.nameA && !st.nameB ? ' Eure Namen tragt ihr in den Einstellungen ein.' : ''}</p>
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

/** Dezenter Hinweis unten, wenn die Verbindung zum gemeinsamen Speicher fehlt. */
function offlineNote() {
  let el = document.getElementById('offline-note');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline-note';
    el.className = 'offline-note';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  const offline = navigator.onLine === false;
  const stale = store.syncInfo().stale || offline || (!!remoteError && store.syncInfo().mode !== 'shared');
  el.hidden = !stale || current.name === 'konto';
  el.innerHTML = `${icon('cloud')}<span>${offline ? 'Offline – Änderungen werden gespeichert, sobald die Verbindung zurück ist.' : 'Verbindung zum Konto wird wiederhergestellt …'}</span>`;
}
window.addEventListener('online', () => offlineNote());
window.addEventListener('offline', () => offlineNote());

function syncChip() {
  const s = store.syncInfo();
  if (s.mode !== 'shared' || s.stale) return ''; // Verbindungshinweis erscheint dezent unten
  return partnerJoined() ? `<span class="sync ok">${icon('rings')}Mit ${esc(nameOf(other(myRole())))} verbunden</span>` : '';
}

/** Oberste Karte: allein → einladen; Einladung offen → erinnern/zurückziehen. Dazu Hinweise in der App. */
function inviteCard() {
  if (!myRole() || store.syncInfo().backend !== 'supabase') return '';
  const st = S().settings;
  const notes = [];
  if (st.notice?.type === 'getrennt') notes.push(['getrennt', `Die Verbindung mit ${st.notice.name || 'deinem Partner'} wurde getrennt.`]);
  if (st.notice?.type === 'getrennt-selbst') notes.push(['getrennt', `Ihr seid nicht mehr verbunden. Eure vergangenen Dates findest du weiter unter „Dates“.`]);
  if (st.pairNotice && st.pairNotice.by !== myRole()) notes.push(['pair', st.pairNotice.text]);
  if (session.inviteError) notes.push(['invite', session.inviteError]);
  const noteHTML = notes.map(([k, t]) => `<div class="banner neutral-row note-${k}">${icon('users')}<span class="grow">${esc(t)}</span><button type="button" class="icon-btn small" data-dismiss-note="${k}" aria-label="Ausblenden">${icon('x')}</button></div>`).join('');
  const state = coupleState();
  if (state === 'verbunden' || !canInvite()) return noteHTML;
  const p = partnerName();
  if (state === 'offen') {
    return `${noteHTML}
    <section class="panel invite-card">
      <div class="row gap"><span class="invite-ico">${icon('clock')}</span>
        <div class="grow"><strong>${esc(p || 'Dein Lieblingsmensch')} ist noch nicht dabei</strong><br><small class="muted">Code ${esc(partnerState.invite.code)} · gültig bis ${esc(fmtExpiry(partnerState.invite.expires_at))}</small></div></div>
      <button type="button" class="btn primary" id="invite-remind">${icon('share')}Erinnerung schicken</button>
      <button type="button" class="linkish small center" id="invite-revoke">Einladung zurückziehen</button>
    </section>`;
  }
  return `${noteHTML}
    <section class="panel invite-card">
      <div class="row gap"><span class="invite-ico">${icon('heart')}</span>
        <div class="grow"><strong>Lad deinen Lieblingsmenschen ein</strong><br><small class="muted">Zu zweit plant ihr abwechselnd, wischt beim Date-Match und überrascht euch.</small></div></div>
      <button type="button" class="btn primary" data-go="einladen">${icon('heart')}Einladen</button>
    </section>`;
}
function bindInviteCard() {
  $('#invite-remind')?.addEventListener('click', () => shareInvite(partnerState.invite));
  const rv = $('#invite-revoke');
  if (rv) armed(rv, async () => {
    try {
      await partnerState.api.revoke();
      partnerState.invite = null;
      toast('Einladung zurückgezogen');
      render();
    } catch (err) {
      toast(err.message);
    }
  }, 'Nochmal tippen zum Zurückziehen');
  on('[data-dismiss-note]', 'click', (_, el) => {
    const k = el.dataset.dismissNote;
    if (k === 'invite') session.inviteError = null;
    else store.update((st) => (k === 'pair' ? delete st.settings.pairNotice : delete st.settings.notice));
    render();
  });
}
const settingsButton = () => `<button class="icon-btn" data-go="mehr" aria-label="Einstellungen">${icon('gear')}</button>`;

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
      <button class="btn" id="cal-ics">${icon('calendar')}Apple Kalender</button>
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

/** Blatt, das von unten einfährt. Gibt das Element zurück; close() schließt es. */
function openSheet(title, html, bind = () => {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-sheet-close aria-label="Schließen">${icon('x')}</button></header>
      <div class="sheet-body">${html}</div>
    </section>`;
  document.body.append(wrap);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => wrap.classList.add('in'));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-sheet-close]')) closeSheet();
  });
  const sheet = wrap.querySelector('.sheet');
  bind(sheet);
  sheet.querySelector('input, select, textarea')?.focus({ preventScroll: true });
  return sheet;
}
function closeSheet() {
  const w = document.querySelector('.sheet-backdrop');
  if (!w) return;
  document.body.classList.remove('sheet-open');
  w.classList.remove('in');
  w.classList.add('out');
  setTimeout(() => w.parentNode?.removeChild(w), 220);
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeSheet());
window.addEventListener('hashchange', closeSheet);

/* --- Kalender verbinden: Apple (Abo) und Google ---------------------------- */

const feedToken = () => S().secrets['calendar-feed']?.token ?? '';
function ensureFeedToken(renew = false) {
  if (feedToken() && !renew) return feedToken();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  store.update((st) => (st.secrets['calendar-feed'] = { kind: 'feed', token, createdAt: Date.now() }));
  return token;
}
const feedUrl = (token) => `${(getConfig()?.url || SUPABASE.url).replace(/\/$/, '')}/functions/v1/calendar?t=${token}`;
const feedAvailable = () => store.syncInfo().mode === 'shared' && store.syncInfo().backend === 'supabase' && !!store.syncInfo().uid;

function upcomingICS() {
  const plans = S().dates.filter((d) => d.date >= isoDate(today())).map((d) => (isHiddenFromMe(d) ? { ...d, title: dateTitle(d), emoji: '🎁', steps: [] } : fullPlanOrMeta(d)));
  const parts = plans.map((p) => toICS({ ...p, steps: (p.steps ?? []).map((x) => ({ ...x, title: x.title ?? x.t ?? '', time: x.time ?? '', links: x.links ?? [] })), emoji: p.emoji ?? '', title: p.title ?? 'Date' }));
  const events = parts.map((t) => t.split('BEGIN:VEVENT')[1]?.split('END:VEVENT')[0]).filter(Boolean).map((e) => `BEGIN:VEVENT${e}END:VEVENT`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Datewell//DE', 'X-WR-CALNAME:Datewell', ...events, 'END:VCALENDAR'].join('\r\n');
}

function openCalendarSheet() {
  const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const gId = S().settings.googleClientId;
  const hasFeed = feedAvailable();
  const tok = hasFeed ? feedToken() : '';
  const order = apple ? ['apple', 'google'] : ['google', 'apple'];
  const blocks = {
    apple: `
      <article class="cal-choice">
        <div class="cal-choice-head"><span class="cal-logo apple">${icon('calendar')}</span><div><h3>Apple Kalender</h3><p class="muted small">iPhone, iPad und Mac</p></div></div>
        ${hasFeed ? `
        <p class="small">Eure Dates erscheinen in deinem Apple Kalender und bleiben automatisch aktuell. Überraschungen für dich zeigen nur Uhrzeit und Hinweis.</p>
        <button type="button" class="btn primary" id="feed-apple">${icon('calendar')}${tok ? 'Erneut im Apple Kalender öffnen' : 'Im Apple Kalender abonnieren'}</button>`
        : `<p class="small">Ladet eure kommenden Dates als Kalenderdatei und öffnet sie im Apple Kalender.</p>
        <button type="button" class="btn primary" id="ics-all">${icon('download')}Kommende Dates hinzufügen</button>`}
        <p class="muted small">Apple erlaubt Web-Apps keinen Zugriff auf deine anderen Termine. Deshalb zeigt Datewell sie hier nicht an.</p>
      </article>`,
    google: `
      <article class="cal-choice">
        <div class="cal-choice-head"><span class="cal-logo google">${icon('calendar')}</span><div><h3>Google Kalender</h3><p class="muted small">Android, Web und iPhone mit Google-Konto</p></div></div>
        ${gId ? (gcal.isConnected()
          ? `<p class="small">Verbunden: ${L().gcal.events.length} Termine geladen. Belegte Zeiten (ohne Titel) helfen bei der Planung.</p><button type="button" class="btn" id="gcal-refresh-s">${icon('repeat')}Aktualisieren</button>`
          : `<p class="small">Datewell zeigt deine Termine im Kalender und trägt Dates direkt ein.</p><button type="button" class="btn primary" id="gcal-connect-s">${icon('calendar')}Mit Google verbinden</button>`)
          : hasFeed ? '<p class="small">Abonniere eure Dates in Google: Kopiere den Link und füge ihn bei Google Kalender unter „Weitere Kalender → Per URL“ ein.</p>' : '<p class="small">Google-Verbindung ist in dieser Version noch nicht eingerichtet.</p>'}
        ${hasFeed ? `<button type="button" class="btn soft" id="feed-copy">${icon('share')}Kalender-Link kopieren</button>` : ''}
      </article>`,
  };
  openSheet('Kalender verbinden', `
    ${order.map((k) => blocks[k]).join('')}
    ${hasFeed && tok ? '<button type="button" class="linkish small" id="feed-renew">Link erneuern (alter Link wird ungültig)</button>' : ''}`, (sh) => {
    const openFeed = () => {
      const url = feedUrl(ensureFeedToken());
      // Kurz warten, damit der neue Schlüssel auf dem Server gespeichert ist
      setTimeout(() => (location.href = url.replace(/^https:/, 'webcal:')), feedToken() ? 0 : 1200);
    };
    sh.querySelector('#feed-apple')?.addEventListener('click', openFeed);
    sh.querySelector('#feed-copy')?.addEventListener('click', async () => {
      const url = feedUrl(ensureFeedToken());
      try {
        await navigator.clipboard.writeText(url);
        toast('Link kopiert');
      } catch {
        prompt('Kalender-Link', url);
      }
    });
    sh.querySelector('#feed-renew')?.addEventListener('click', () => {
      ensureFeedToken(true);
      toast('Neuer Link erstellt – bitte neu abonnieren');
      closeSheet();
    });
    sh.querySelector('#ics-all')?.addEventListener('click', () => saveFile('datewell-dates.ics', upcomingICS(), 'text/calendar'));
    sh.querySelector('#gcal-connect-s')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      await connectGcal();
      closeSheet();
    }));
    sh.querySelector('#gcal-refresh-s')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      await syncGcal();
      closeSheet();
    }));
  });
}

function gcalBar() {
  if (store.inArtifact()) return '';
  const parts = [feedToken() ? 'Apple/Abo' : '', gcal.isConnected() ? 'Google' : ''].filter(Boolean);
  return `<button type="button" class="banner neutral-row" id="cal-connect">${icon(parts.length ? 'check' : 'calendar')}<span class="grow"><strong>${parts.length ? 'Kalender verbunden' : 'Kalender verbinden'}</strong><br><small class="muted">${parts.length ? parts.join(' · ') : 'Apple oder Google – eure Dates automatisch im Kalender'}</small></span>${icon('right')}</button>`;
}

function bindGcalBar() {
  $('#cal-connect')?.addEventListener('click', openCalendarSheet);
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
/* --- Mitteilungen aufs Handy ------------------------------------------------- */

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const PUSH_KINDS = [['dates', 'Erinnerungen an eure Dates'], ['wishes', 'Date-Wünsche'], ['match', 'Date-Match'], ['idle', '„Mal wieder Zeit für ein Date?“'], ['partner', 'Einladung und Verbindung'], ['community', 'Community']];
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const b64ToBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function enablePush() {
  if (!auth.cfg) throw new Error('Mitteilungen gibt es mit gemeinsamem Konto.');
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'Auf dem iPhone: Datewell zuerst über Teilen → „Zum Home-Bildschirm“ hinzufügen und von dort öffnen.' : 'Dieses Gerät unterstützt keine Mitteilungen.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt. Du kannst sie in den Einstellungen des Handys für Datewell erlauben.');
  const { publicKey } = await callNotify(auth.cfg, { action: 'vapid' });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await callNotify(auth.cfg, { action: 'subscribe', subscription: sub.toJSON(), role: myRole() });
  L().push = { on: true, at: Date.now() };
  store.saveLocal();
}

async function disablePush() {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await callNotify(auth.cfg, { action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  L().push = { on: false, at: Date.now() };
  store.saveLocal();
}

/** Nach einer Änderung (neues Date, Match …) den Server sofort prüfen lassen. */
let nudgeTimer = null;
function nudgePush() {
  if (!auth.cfg) return;
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => callNotify(auth.cfg, { action: 'nudge' }).catch(() => {}), 2500);
}

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
    const pend = pendingInvite();
    const res = await connectSupabase(pend?.code ? { ...cfg, invite: pend.code } : cfg);
    const { db, uid, user, community: api, photos: photosApi } = res;
    if (pend) setPendingInvite(null);
    partnerState.api = res.partner;
    if (res.inviteError) session.inviteError = res.inviteError;
    if (res.joined) {
      setJoinInfo({ oldSettings: res.joined.oldSettings, oldRole: res.joined.oldRole, inviter: res.joined.inviter });
      try {
        localStorage.removeItem('date-ideen.v1'); // alter Zwischenspeicher gehört zum bisherigen Konto
      } catch {
        /* egal */
      }
    }
    auth.user = user;
    auth.needed = false;
    store.attach(db, uid, { backend: 'supabase' });
    community.api = api;
    photos.setRemote(photosApi);
    enableServerPlaces(cfg);
    loadInvite();
    if (announce && !res.joined) toast('Willkommen bei Datewell!');
    if (current.name === 'konto') current = { name: 'start', param: null };
    connectTries = 0;
    clearTimeout(retryConnect);
  } catch (e) {
    if (e.code === 'auth') {
      auth.needed = true;
      current = { name: 'konto', param: null };
    } else {
      remoteError = e.message;
      // Automatisch erneut versuchen: nach 3 s, 8 s, 20 s, dann alle 60 s
      connectTries++;
      clearTimeout(retryConnect);
      retryConnect = setTimeout(() => connectRemote(cfg), [3000, 8000, 20000][connectTries - 1] ?? 60000);
    }
  }
  render(current.name === 'konto');
}
// Fehlerprotokoll: höchstens 5 Meldungen pro Sitzung, nur mit Konto, ohne Inhalte
const APP_VERSION = 'v57';
let errorsSent = 0;
function reportError(err) {
  if (!auth.user || !auth.cfg || errorsSent >= 5 || navigator.onLine === false) return;
  const message = String(err?.message ?? err ?? '').slice(0, 600);
  if (!message || /Failed to fetch|NetworkError|Load failed|AbortError|ResizeObserver/i.test(message)) return;
  errorsSent++;
  logClientError(auth.cfg, { version: APP_VERSION, screen: current.name, message, stack: String(err?.stack ?? '').slice(0, 2000) }).catch(() => {});
}
window.addEventListener('error', (e) => reportError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
let connectTries = 0;
let retryConnect = null;
// Sobald wieder Netz da ist bzw. die App wieder geöffnet wird: Verbindung erneut aufbauen
const reconnectIfNeeded = () => {
  if (auth.cfg && remoteError && store.syncInfo().mode !== 'shared') connectRemote(auth.cfg);
};
window.addEventListener('online', reconnectIfNeeded);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reconnectIfNeeded());

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
  if (sync.backend === 'supabase' && auth.user) {
    const state = coupleState();
    const inv = partnerState.invite;
    const p = partnerName();
    const since = S().settings.connectedSince;
    return `
      ${state === 'verbunden' ? `
      <p>${icon('rings')} Verbunden mit <strong>${esc(p || nameOf(other(myRole())))}</strong>${since ? ` seit ${esc(fmtDate(since, { day: 'numeric', month: 'long', year: 'numeric' }))}` : ''}.</p>
      <button class="btn soft" type="button" data-ob-open="tage">${icon('heart')}Eure besonderen Tage bearbeiten</button>`
      : state === 'offen' ? `
      <p><strong>${esc(inv.partner_name || p || 'Dein Lieblingsmensch')}</strong> ist eingeladen, aber noch nicht dabei.</p>
      <p class="muted small">Code <strong>${esc(inv.code)}</strong> · gültig bis ${esc(fmtExpiry(inv.expires_at))}</p>
      <div class="row gap wrap">
        <button class="btn primary" type="button" id="pt-share">${icon('share')}Erneut teilen</button>
        <button class="btn" type="button" id="pt-copy">Code kopieren</button>
        <button class="btn ghost" type="button" data-go="einladen">Name ändern · Zurückziehen</button>
      </div>`
      : `
      <p>Du nutzt Datewell gerade allein. Zu zweit plant ihr abwechselnd, wischt beim Date-Match und überrascht euch.</p>
      <div class="row gap wrap">
        <button class="btn primary" type="button" data-go="einladen">${icon('heart')}Partner einladen</button>
        <button class="btn" type="button" data-go="code">Ich habe einen Code</button>
      </div>`}
      ${sync.writeError ? `<p class="warn-text">${esc(sync.writeError)}</p>` : ''}
      ${state === 'verbunden' ? '<button class="btn ghost danger" type="button" data-go="trennen">Verbindung trennen</button>' : ''}
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
  // Eingebautes Konto vorhanden, aber Verbindung gerade weg: Status statt Technik-Felder zeigen
  if (SUPABASE.url && auth.cfg) {
    return `
      <p>${remoteError ? 'Die Verbindung zu eurem Konto ist gerade unterbrochen. Datewell versucht es automatisch weiter – eure Daten gehen nicht verloren.' : 'Verbindung zu eurem Konto wird hergestellt …'}</p>
      ${remoteError ? `<p class="muted small">${esc(remoteError)}</p>` : ''}
      <button class="btn primary" id="sb-retry" type="button">${icon('repeat')}Jetzt erneut verbinden</button>`;
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
  $('#pt-share')?.addEventListener('click', () => shareInvite(partnerState.invite));
  $('#pt-copy')?.addEventListener('click', () => copyCode(partnerState.invite.code));
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
  $('#sb-retry')?.addEventListener('click', async (e) => {
    connectTries = 0;
    await withBusy(e.currentTarget, () => connectRemote(auth.cfg));
    toast(store.syncInfo().mode === 'shared' ? 'Verbunden' : 'Noch keine Verbindung – Datewell versucht es weiter.');
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

const GOOGLE_FINDABLE = new Set(['dance', 'planetarium', 'massage', 'brewery', 'karting', 'highropes', 'casino', 'rooftop', 'livemusic', 'botanic', 'blacklight', 'xmas', 'karaoke', 'escape', 'climbing', 'cooking', 'pottery', 'arcade', 'bowling', 'spa', 'icerink', 'boat', 'bookshop']);
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
  if (!finished && el && pr) el.textContent = `Datewell erkundet eure Umgebung … (${pr.done}/${pr.total})`;
  if (finished) {
    discover.feed = null;
    discover.gen = null;
    discover.near = null;
    if (current.name === 'entdecken' && !formDirty) render();
  }
});

const AREA_LABELS = { restaurant: 'Restaurants', cafe: 'Cafés', bar: 'Bars', cinema: 'Kinos', museum: 'Museen', theatre: 'Theater', spa: 'Thermen', icerink: 'Eishallen', bowling: 'Bowling', escape: 'Escape Rooms', climbing: 'Boulderhallen', zoo: 'Zoos & Tierparks', xmas: 'Weihnachtsmärkte', minigolf: 'Minigolf', gallery: 'Galerien', park: 'Parks', viewpoint: 'Aussichtspunkte', beergarden: 'Biergärten', wine: 'Weinbars', icecream: 'Eisdielen', botanic: 'Botanische Gärten', livemusic: 'Live-Musik', rooftop: 'Rooftop-Bars', cooking: 'Kochkurse', pottery: 'Töpfereien', arcade: 'Lasertag', blacklight: 'Schwarzlicht-Minigolf', lake: 'Badeseen', dance: 'Tanzschulen', planetarium: 'Planetarien', massage: 'Massage', brewery: 'Brauereien', castle: 'Schlösser', market: 'Wochenmärkte', karting: 'Kartbahnen', billiards: 'Billard', highropes: 'Kletterwälder', casino: 'Spielbanken' };

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
      ${pr ? `<p class="muted small"><span class="spinner tiny"></span> <span id="area-progress">Datewell erkundet eure Umgebung … (${pr.done}/${pr.total})</span></p>` : ''}
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

/** Urheber und Lizenz unter freie Fotos schreiben; Fotos ohne freie Lizenz ausblenden. */
function creditImages() {
  $$('.thumb > img, .hero-img > img', root).forEach((img) => {
    if (img.dataset.cr) return;
    img.dataset.cr = '1';
    const src = img.getAttribute('src');
    if (!/upload\.wikimedia\.org/.test(src)) return;
    imageCredit(src).then((cr) => {
      if (cr === null) {
        img.parentNode?.classList.add('noimg');
        img.hidden = true;
      } else if (cr && img.isConnected && !img.parentNode.querySelector('.img-credit')) {
        img.insertAdjacentHTML('afterend', `<span class="img-credit">${esc(cr)}</span>`);
      }
    });
  });
}

function hydrateMedia() {
  const key = googleKey();
  $$('[data-img]', root).forEach((el) => {
    const j = imgJobs.get(el.dataset.img);
    el.removeAttribute('data-img');
    if (!j) return;
    findImage(j.job).then((url) => {
      if (!url) return;
      if (j.target) j.target.image = url;
      el.classList.remove('noimg');
      el.insertAdjacentHTML('afterbegin', imgTag(url));
      creditImages();
    });
  });
  creditImages();
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
  return thumb(img, i.emoji ?? '💡', cls, ideaJobFor(i), i);
}

const gRating = (p) => (googleKey() && p?.lat != null ? `<span class="g-rating" data-grating="${gJob(p)}"></span>` : '');

// Farbstimmung für Karten ohne Foto – passend zur Art des Dates
const TONES = { romantisch: 'rose', kultur: 'ink', aktiv: 'olive', abenteuerlich: 'olive', kulinarisch: 'clay', gemütlich: 'sand', entspannt: 'sage', lustig: 'plum', kreativ: 'plum' };
const toneOf = (t) => TONES[t?.moods?.[0]] ?? TONES[categoryById(t?.category)?.moods?.[0]] ?? 'rose';
const thumb = (src, emoji, cls = '', job = null, target = null) => thumbHTML(allowedImage(src) ? src : '', emoji, cls, job, target);
const thumbHTML = (src, emoji, cls = '', job = null, target = null) =>
  !src && job ? `<span class="thumb noimg ${cls}" data-tone="${toneOf(target)}" data-img="${imgJob(job, target)}"><span class="thumb-emoji" aria-hidden="true">${glyph(emoji)}</span></span>`
  : !src ? `<span class="thumb noimg ${cls}" data-tone="${toneOf(target)}"><span class="thumb-emoji" aria-hidden="true">${glyph(emoji)}</span></span>`
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
  if (!myRole()) return toast(noRoleMsg());
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
  const subs = { fuereuch: '', orte: 'Restaurants, Bars, Museen & mehr in eurer Nähe.', community: 'Dates, die andere Paare geplant und bewertet haben.', gemerkt: 'Eure Favoriten und eigenen Ideen.' };
  const head = topbar({ title: 'Entdecken', sub: subs[d.tab] }) + `
    <form class="search-bar" id="d-search-form" role="search">
      ${icon('search')}
      <input class="input" id="d-search" type="search" placeholder="Therme, Sushi, Picknick …" value="${esc(d.query)}" autocomplete="off" enterkeyhint="search">
      ${d.query ? `<button type="button" class="icon-btn small" id="d-search-clear" aria-label="Suche leeren">${icon('x')}</button>` : ''}
    </form>`;
  if (d.query) return renderSearch(head);

  if (d.tab === 'fuereuch') return renderForYou(head + tabs);
  if (d.tab === 'community') return renderCommunity(head + tabs);
  if (d.tab === 'gemerkt') return renderSaved(head + tabs);

  return renderPlaces(head + tabs);
};

/* --- Entdecken: Orte (mehrere Kategorien, Küchen, Karte) ------------------- */

const PLACE_TILES = ['restaurant', 'cafe', 'bar', 'wine', 'cinema', 'museum', 'theatre', 'spa', 'icerink', 'bowling', 'escape', 'climbing', 'minigolf', 'zoo', 'park', 'viewpoint', 'gallery', 'beergarden', 'icecream', 'xmas', 'brewery', 'castle', 'karting', 'dance', 'livemusic', 'rooftop', 'cocktail', 'massage', 'planetarium', 'lake', 'openair'];

// Ohne Filter: das Wichtigste in der Nähe
const PLACE_DEFAULT = ['restaurant', 'cafe', 'bar', 'wine', 'museum', 'cinema', 'theatre', 'spa', 'bowling', 'escape', 'icerink'];

function renderPlaces(head) {
  const d = discover;
  const center = discoverCenter();
  const area = currentArea();
  const m = today().getMonth() + 1;
  const seasonOk = (c) => !c.seasonal || (c.seasonal === 'summer' ? m >= 5 && m <= 9 : isXmasSeason(isoDate(today())));
  // Nur Arten zeigen, die es im Umkreis gibt (sofern schon erkundet)
  const tiles = PLACE_TILES.map(categoryById).filter((c) => c && seasonOk(c) && !(area && area.cats[c.id]?.length === 0));
  d.sel ??= new Set();
  d.cuis ??= new Set();
  for (const id of [...d.sel]) if (!tiles.some((c) => c.id === id)) d.sel.delete(id);
  const km = Math.round(d.radius / 1000);
  const count = d.sel.size + d.cuis.size + (d.openNow ? 1 : 0);
  const now = new Date();
  let list = d.results ?? [];
  if (d.openNow) list = list.filter((p) => isOpenAt(p.hours, now) === true);
  const label = (id) => AREA_LABELS[id] ?? categoryById(id)?.label ?? id;
  const cuisLabel = (id) => CUISINES.find((c) => c.id === id)?.label ?? id;
  // Entwurf, solange das Filter-Menü offen ist (erst „Anzeigen“ übernimmt)
  const dr = d.filterOpen ? (d.draft ??= { sel: new Set(d.sel), cuis: new Set(d.cuis), openNow: !!d.openNow }) : null;

  root.innerHTML = `
    ${head}
    <button type="button" class="ctx-strip" id="pl-loc" aria-expanded="${!!d.locOpen}">
      <span class="ctx-main">${icon('pin')}<span>${esc(center?.name ?? 'Standort wählen')} · ${km} km</span></span>
      <span class="ctx-filter">${icon('sliders')}</span>
    </button>
    <section class="panel form" id="pl-loc-panel" ${d.locOpen ? '' : 'hidden'}>
      <div class="field"><span class="label">Standort</span>${locField('pl-city', center ? { name: center.name, sub: center.gps ? 'Aktueller Standort' : S().settings.geo?.sub ?? '' } : null)}</div>
      <div class="field"><span class="label">Umkreis</span>${radiusChips('radius', km)}</div>
    </section>

    <div class="pl-bar">
      <button type="button" class="pl-filter-btn ${count ? 'active' : ''}" id="pl-filter" aria-expanded="${!!d.filterOpen}">
        ${icon('sliders')}<span>Filter</span>${count ? `<b>${count}</b>` : ''}${icon(d.filterOpen ? 'chevup' : 'chevdown')}
      </button>
      <button type="button" class="chip ${d.showMap ? 'on' : ''}" id="pl-map" aria-pressed="${!!d.showMap}">${icon('pin')}<span>Karte</span></button>
      ${d.results ? `<span class="muted small pl-count">${list.length} ${list.length === 1 ? 'Ort' : 'Orte'}</span>` : ''}
    </div>

    ${count && !d.filterOpen ? `
    <div class="pl-active">
      ${[...d.sel].map((id) => `<button type="button" class="act-chip" data-rm-cat="${id}">${esc(label(id))}${icon('x')}</button>`).join('')}
      ${[...d.cuis].map((id) => `<button type="button" class="act-chip" data-rm-cuis="${id}">${esc(cuisLabel(id))}${icon('x')}</button>`).join('')}
      ${d.openNow ? `<button type="button" class="act-chip" data-rm-open>Jetzt geöffnet${icon('x')}</button>` : ''}
      <button type="button" class="linkish small" id="pl-clear">Alle löschen</button>
    </div>` : !d.filterOpen ? '<p class="muted small">Ohne Filter: das Wichtigste in eurer Nähe.</p>' : ''}

    ${dr ? `
    <section class="panel pl-dropdown" id="pl-dropdown">
      <div class="field">
        <span class="label">Was sucht ihr? <small class="muted">(mehrere möglich)</small></span>
        <div class="tile-grid">
          ${tiles.map((c) => {
            const n = area?.cats[c.id]?.length;
            return `<button type="button" class="cat-tile ${dr.sel.has(c.id) ? 'on' : ''}" data-tile="${c.id}" aria-pressed="${dr.sel.has(c.id)}">${glyph(c.emoji)}<span>${esc(label(c.id))}</span>${n ? `<small>${n >= 15 ? '15+' : n}</small>` : ''}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="field" id="pl-cuis-field" ${dr.sel.has('restaurant') ? '' : 'hidden'}>
        <span class="label">Küche</span>
        <div class="chips wrap">${CUISINES.map((c) => `<button type="button" class="chip ${dr.cuis.has(c.id) ? 'on' : ''}" data-cuis="${c.id}" aria-pressed="${dr.cuis.has(c.id)}"><span>${esc(c.label)}</span></button>`).join('')}</div>
      </div>
      <label class="switch"><input type="checkbox" id="pl-open" ${dr.openNow ? 'checked' : ''}><span><strong>Nur jetzt geöffnet</strong></span></label>
      <div class="row gap pl-dd-actions">
        <button type="button" class="btn ghost" id="pl-dd-clear">Alle löschen</button>
        <button type="button" class="btn primary grow" id="pl-dd-apply">Anzeigen</button>
      </div>
    </section>` : ''}

    ${d.showMap && list.length && !d.filterOpen ? '<div class="plan-map pl-map" id="pl-mapbox"></div>' : ''}
    <section class="stack" id="results">
      ${d.loading ? '<div class="loading"><span class="spinner"></span>Suche Orte …</div>'
        : d.error ? `<div class="empty"><p>${esc(d.error)}</p></div>`
          : !center ? '<div class="empty"><p>Wähle oben euren Standort, dann zeigt Datewell Orte in der Nähe.</p></div>'
            : d.results ? (list.length ? `<div class="idea-rows">${list.map(placeRow).join('')}</div>` : `<div class="empty"><p>${d.openNow ? 'Gerade hat nichts davon geöffnet.' : 'Nichts gefunden.'} Vergrößere den Umkreis oder ändere die Filter.</p></div>`)
              : ''}
      ${list.length ? '<p class="muted small center">Orte: OpenStreetMap. Tippe auf einen Ort für Anfahrt, Reservierung und Bewertungen.</p>' : ''}
    </section>`;

  const load = async () => {
    const c = discoverCenter();
    if (!c) return;
    d.loading = true;
    d.error = null;
    render();
    try {
      const ids = d.sel.size ? [...d.sel] : PLACE_DEFAULT.filter((id) => tiles.some((t) => t.id === id));
      const byCuisine = d.sel.has('restaurant') && d.cuis.size;
      const plain = byCuisine ? ids.filter((x) => x !== 'restaurant') : ids;
      const groups = plain.length ? await searchMixed(plain, c, d.radius, 1) : {};
      let all = plain.flatMap((id) => groups[id] ?? []);
      if (byCuisine) {
        // Restaurants der Umgebung nach Küche filtern – zusätzlich gezielt suchen (falls der Kartendienst antwortet)
        const rest = (await searchMixed(['restaurant'], c, d.radius, 1).catch(() => ({}))).restaurant ?? [];
        for (const cu of d.cuis) {
          const def = CUISINES.find((x) => x.id === cu);
          const words = [def?.label, ...(def?.tags ?? [])].filter(Boolean).map((w) => w.toLowerCase());
          all = all.concat(rest.filter((p) => words.some((w) => `${p.cuisine ?? ''} ${p.name}`.toLowerCase().includes(w))));
          all = all.concat(await searchNearby('restaurant', c, d.radius, cu).catch(() => []));
        }
      }
      const seen = new Set();
      d.results = all.filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((x, y) => x.km - y.km);
      d.results.forEach((p) => placeIndex.set(p.id, p));
    } catch (e) {
      d.results = null;
      d.error = store.inArtifact() ? 'Die Ortssuche funktioniert nur in der Webseiten-Version der App.' : e.message === 'Failed to fetch' ? 'Keine Verbindung zur Ortssuche.' : e.message;
    }
    d.loading = false;
    if (current.name === 'entdecken') render();
  };

  bindDiscoverTabs();
  $('#pl-loc').addEventListener('click', () => {
    d.locOpen = !d.locOpen;
    $('#pl-loc-panel').hidden = !d.locOpen;
  });
  bindLocField('pl-city', (g) => {
    setHome(g);
    d.locOpen = false;
    d.results = null;
    load();
  });
  bindRadius(root, 'radius', (k) => {
    d.radius = k * 1000;
    load();
  });
  $('#pl-filter').addEventListener('click', () => {
    d.filterOpen = !d.filterOpen;
    d.draft = null;
    render();
  });
  // Im Menü: nur markieren, ohne neu zu laden (nichts springt)
  on('[data-tile]', 'click', (_, el) => {
    const id = el.dataset.tile;
    if (dr.sel.has(id)) dr.sel.delete(id);
    else dr.sel.add(id);
    el.classList.toggle('on', dr.sel.has(id));
    el.setAttribute('aria-pressed', dr.sel.has(id));
    const cf = $('#pl-cuis-field');
    if (cf) cf.hidden = !dr.sel.has('restaurant');
    if (!dr.sel.has('restaurant')) dr.cuis.clear();
    updApply();
  });
  on('[data-cuis]', 'click', (_, el) => {
    const id = el.dataset.cuis;
    if (dr.cuis.has(id)) dr.cuis.delete(id);
    else dr.cuis.add(id);
    el.classList.toggle('on', dr.cuis.has(id));
    el.setAttribute('aria-pressed', dr.cuis.has(id));
    updApply();
  });
  $('#pl-open')?.addEventListener('change', (e) => {
    dr.openNow = e.target.checked;
    updApply();
  });
  function updApply() {
    const n = dr.sel.size + dr.cuis.size + (dr.openNow ? 1 : 0);
    const btn = $('#pl-dd-apply');
    if (btn) btn.textContent = n ? `Anzeigen (${n} ${n === 1 ? 'Filter' : 'Filter'})` : 'Alles anzeigen';
  }
  if (dr) updApply();
  $('#pl-dd-clear')?.addEventListener('click', () => {
    dr.sel.clear();
    dr.cuis.clear();
    dr.openNow = false;
    $$('#pl-dropdown .on').forEach((x) => x.classList.remove('on'));
    $('#pl-open').checked = false;
    $('#pl-cuis-field').hidden = true;
    updApply();
  });
  $('#pl-dd-apply')?.addEventListener('click', () => {
    d.sel = new Set(dr.sel);
    d.cuis = new Set(dr.cuis);
    d.openNow = dr.openNow;
    d.filterOpen = false;
    d.draft = null;
    load();
  });
  // Aktive Filter einzeln entfernen
  on('[data-rm-cat]', 'click', (_, el) => {
    d.sel.delete(el.dataset.rmCat);
    if (!d.sel.has('restaurant')) d.cuis.clear();
    load();
  });
  on('[data-rm-cuis]', 'click', (_, el) => {
    d.cuis.delete(el.dataset.rmCuis);
    load();
  });
  on('[data-rm-open]', 'click', () => {
    d.openNow = false;
    render();
  });
  $('#pl-clear')?.addEventListener('click', () => {
    d.sel.clear();
    d.cuis.clear();
    d.openNow = false;
    load();
  });
  $('#pl-map').addEventListener('click', () => {
    d.showMap = !d.showMap;
    render();
  });
  on('[data-open-place]', 'click', (_, el) => (session.ortBack = null, go('ort', el.dataset.openPlace)));
  on('[data-open-place]', 'keydown', (e, el) => e.key === 'Enter' && (session.ortBack = null, go('ort', el.dataset.openPlace)));
  if (d.showMap && list.length && !d.filterOpen) drawPlacesMap(list, center);
  if (center && !d.results && !d.loading && !d.error) load();
}

/** Kompakte Zeile für einen Ort. */
function placeRow(p) {
  const cat = categoryById(p.category);
  const open = isOpenAt(p.hours, new Date());
  const meta = [fmtKm(p.km), p.cuisine || (AREA_LABELS[p.category] ?? cat?.label ?? ''), open === true ? 'Jetzt geöffnet' : open === false ? 'Gerade geschlossen' : ''].filter(Boolean);
  return `
    <article class="idea-row" data-open-place="${esc(p.id)}" role="button" tabindex="0">
      ${thumb(p.image, cat?.emoji ?? '📍', 'row', { place: p }, p)}
      <div class="grow">
        <h3>${esc(p.name)}</h3>
        <p class="clamp muted small">${esc([p.street, p.city].filter(Boolean).join(', ') || cat?.label || '')}</p>
        <p class="ir-meta ${open === false ? 'closed' : ''}">${meta.map(esc).join(' · ')}</p>
        ${gRating(p)}
      </div>
      ${icon('right')}
    </article>`;
}

let placesMap = null;
/** Aufklappbare Karte mit allen gefundenen Orten. */
function drawPlacesMap(list, center) {
  const el = document.getElementById('pl-mapbox');
  if (!el) return;
  loadLeaflet().then((Lf) => {
    if (!document.body.contains(el)) return;
    placesMap?.remove();
    placesMap = Lf.map(el, { zoomControl: true, scrollWheelZoom: false, tap: false });
    Lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(placesMap);
    const pts = [];
    if (center) {
      Lf.circleMarker([center.lat, center.lon], { radius: 7, color: '#F3EFE8', weight: 3, fillColor: '#302B29', fillOpacity: 1 }).addTo(placesMap).bindTooltip('Ihr');
      pts.push([center.lat, center.lon]);
    }
    list.slice(0, 60).forEach((p, i) => {
      const mk = Lf.marker([p.lat, p.lon], { icon: Lf.divIcon({ className: 'map-pin', html: `<span>${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: p.name }).addTo(placesMap);
      mk.bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(fmtKm(p.km))}<br><a href="#" data-map-open="${esc(p.id)}">Details</a>`);
      mk.on('popupopen', (e) => e.popup.getElement()?.querySelector('[data-map-open]')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        session.ortBack = null;
        go('ort', p.id);
      }));
      pts.push([p.lat, p.lon]);
    });
    if (pts.length === 1) placesMap.setView(pts[0], 14);
    else placesMap.fitBounds(pts, { padding: [24, 24], maxZoom: 15 });
  }).catch(() => el.remove());
}

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
    history.replaceState(history.state, '', hashOf(current));
    render();
  });
}

/* --- Ort im Detail: Bilder, Bewertungen, Reservierung, Anfahrt -------------- */

const gInfo = new Map(); // Google-Details je Ort

const ssGet = (k) => {
  try {
    return JSON.parse(sessionStorage.getItem(k));
  } catch {
    return null;
  }
};
const ssSet = (k, v) => {
  try {
    sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* egal */
  }
};

RENDER.ort = (id) => {
  // Nach dem Neuladen: zuletzt geöffneten Ort wiederherstellen
  if (!placeIndex.has(id) && ssGet('dately.place')?.id === id) placeIndex.set(id, ssGet('dately.place'));
  const p = placeIndex.get(id);
  if (!p) return go('entdecken', null, { replace: true });
  ssSet('dately.place', p);
  const cat = categoryById(p.category);
  const g = gInfo.get(id);
  const ls = L().lastSearch;
  const date = resolveDate(ls);
  const week = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label, i) => {
    const day = addDays(today(), ((i + 1) - today().getDay() + 7) % 7);
    return [label, hoursOn(p.hours, day)];
  });
  const hasWeek = week.some(([, h]) => h);
  const img = allowedImage(p.image) ? p.image : '';
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
          <p class="muted small">${[r.display_name ? `von ${r.display_name}` : r.city ? `Ein Paar aus ${r.city}` : 'Ein Paar', r.display_name ? r.city : '', r.km != null ? fmtKm(r.km) : '', fmtEuro(i.cost ?? 0), r.uses ? `${r.uses}× übernommen` : ''].filter(Boolean).map(esc).join(' · ')}</p>
          <p class="teaser">${esc(i.teaser ?? '')}</p>
          <p class="flow">${(i.steps ?? []).map((s) => esc(s.t)).join('<span aria-hidden="true"> → </span>')}</p>
          ${(r.moods ?? []).length ? `<div class="mood-tags">${r.moods.map((m) => `<span class="tag">${esc(moodLabel(m))}</span>`).join('')}</div>` : ''}
          <div class="row gap wrap">
            <button class="btn primary sm" data-adopt="${r.id}">${icon('sparkle')}Übernehmen</button>
            ${favBtn(communityIdea(r), 'labelled')}
            <button class="btn sm ghost" data-creviews="${r.id}">Bewertungen</button>
            ${r.mine ? `<button class="btn sm ghost danger" data-cdel="${r.id}">Zurückziehen</button>` : `<button class="icon-btn small more-btn" data-cmenu="${r.id}" aria-label="Mehr">⋯</button>`}
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
      ${myCommunityHTML()}
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
      box.innerHTML = reviews.length ? reviews.map((v) => `<p><span class="gold">${'★'.repeat(v.stars)}</span> ${esc(v.comment ?? '')} <small class="muted">${fmtShort(v.created_at.slice(0, 10))}</small>${v.id && v.comment && !v.mine ? ` <button type="button" class="linkish small" data-rreport="${v.id}" data-ridea="${el.dataset.creviews}">Melden</button>` : ''}</p>`).join('') : '<p class="muted small">Noch keine Bewertungen.</p>';
      box.querySelectorAll('[data-rreport]').forEach((btn) => btn.addEventListener('click', () => openReportSheet(btn.dataset.ridea, btn.dataset.rreport)));
    } catch (e) {
      box.textContent = e.message;
    }
  });
  on('[data-creport]', 'click', (_, el) => openReportSheet(el.dataset.creport));
  on('[data-cmenu]', 'click', (_, el) => {
    const id = el.dataset.cmenu;
    const r = row(id);
    openSheet(r?.idea?.title ?? 'Date', `
      <button type="button" class="btn big" data-m-report>${icon('bell')}Melden</button>
      <button type="button" class="btn big ghost" data-m-hide>${icon('x')}Diese Person ausblenden</button>
      <p class="muted small">Ausgeblendete Personen siehst du nicht mehr. Das lässt sich in den Einstellungen rückgängig machen.</p>`, (sh) => {
      sh.querySelector('[data-m-report]').addEventListener('click', () => openReportSheet(id));
      sh.querySelector('[data-m-hide]').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
        try {
          await community.api.block(id);
          closeSheet();
          toast('Ausgeblendet');
          d.community = null;
          loadCommunity();
        } catch (err) {
          toast(err.message);
        }
      }));
    });
  });
  on('[data-cdel]', 'click', async (_, el) => {
    try {
      await community.api.remove(el.dataset.cdel);
      toast('Idee zurückgezogen');
      d.cMine = null;
      loadCommunity();
      loadMyCommunity();
    } catch (e) {
      toast(e.message);
    }
  });
  on('[data-appeal]', 'click', async (_, el) => {
    const text = $(`[data-appeal-text="${el.dataset.appeal}"]`).value.trim();
    if (text.length < 5) return toast('Bitte kurz begründen');
    await withBusy(el, async () => {
      try {
        await community.api.appeal(el.dataset.appeal, text);
        toast('Einspruch eingereicht – wir prüfen das');
        d.cMine = null;
        loadMyCommunity();
      } catch (e) {
        toast(e.message);
      }
    });
  });
  if (community.api && !d.community && !d.cLoading && !d.cError) loadCommunity();
  if (community.api && !d.cMine && !d.cMineLoading) {
    d.cMineLoading = true;
    loadMyCommunity().finally(() => (d.cMineLoading = false));
  }
  syncCommunityNames();
}

/* --- Community: Anzeigename, Paarname mit Zustimmung, Melden, Blockieren ------- */

const REPORT_REASONS = [
  ['unangemessen', 'Unangemessen'],
  ['spam', 'Spam oder Werbung'],
  ['gefahr', 'Gefährlich'],
  ['falsch', 'Falsche Infos'],
  ['sonstiges', 'Anderes'],
];
// Grobe Vorprüfung vor dem Teilen – die eigentliche Kontrolle sind Meldungen und Moderation
const BLOCKED_WORDS = /\b(fick\w*|fotze|hure\w*|nutte\w*|schlampe|wichs\w*|porn\w*|sex(?:treff|date|party)\w*|escort\w*|nazi\w*|hitler|heil\s+h|kanake\w*|neger\w*|schwuchtel\w*|missgeburt|kill\s+yourself|bitch|whore|cunt|nigg\w*)\b/i;
const unsafeText = (...texts) => texts.some((t) => BLOCKED_WORDS.test(String(t ?? '')));
/** Anzeigenamen prüfen: 2–24 Zeichen, nichts Beleidigendes, keine E-Mail-Adresse oder Telefonnummer. */
function nameProblem(n) {
  const v = String(n ?? '').trim();
  if (v.length < 2 || v.length > 24) return 'Der Name braucht 2 bis 24 Zeichen.';
  if (/@|\bwww\.|https?:/i.test(v)) return 'Bitte keine E-Mail-Adresse oder Webadresse.';
  if ((v.match(/\d/g) ?? []).length >= 5) return 'Bitte keine Telefonnummer.';
  if (unsafeText(v)) return 'Bitte wähle einen freundlichen Namen.';
  return '';
}

const commPrefs = (role = myRole()) => S().settings.community?.[role] ?? {};
const pairName = () => S().settings.communityPair ?? null;
const pairAgreed = () => {
  const p = pairName();
  return !!(p?.name && p.consent?.a === true && p.consent?.b === true);
};
const firstName = (role) => (S().settings[role === 'b' ? 'nameB' : 'nameA'] ?? '').trim().split(/\s+/)[0] || '';

/** Unter welchem Namen erscheinen meine geteilten Dates? null = ohne Namen. */
function displayNameFor(role = myRole()) {
  const mode = commPrefs(role).mode ?? 'vorname';
  if (mode === 'anonym') return null;
  if (mode === 'fantasie' && commPrefs(role).alias) return commPrefs(role).alias;
  if (mode === 'paar' && pairAgreed()) return pairName().name;
  return firstName(role) || null;
}

/** Hat der Partner einen Paarnamen vorgeschlagen, dem ich noch nicht zugestimmt habe? */
function pairConsentPending() {
  const p = pairName();
  const role = myRole();
  return !!(role && p?.name && p.proposedBy && p.proposedBy !== role && p.consent?.[role] == null);
}

/** Wenn sich der Anzeigename ändert (z. B. Zustimmung kam später): eigene geteilte Dates nachziehen. */
async function syncCommunityNames() {
  if (!community.api || !myRole() || session.namesSynced === displayNameFor()) return;
  const name = displayNameFor();
  try {
    const mine = await community.api.mine();
    const ids = mine.filter((r) => 'display_name' in r && (r.display_name ?? null) !== name).map((r) => r.id);
    await community.api.setDisplayName(ids, name);
    session.namesSynced = name;
    if (ids.length) discover.community = null;
  } catch {
    /* später erneut */
  }
}

/** Ort nur grob: Stadt/Region, Koordinaten auf ca. 10 km gerundet, bei „Zuhause“ gar keine. */
function coarseLocation(pub, cityText) {
  const venue = pub.steps.find((s) => s.place?.lat != null)?.place;
  // Nur ein öffentlicher Ort (Restaurant, Kino …) ergibt einen Punkt – nie euer Standort oder Zuhause
  const base = pub.reach === 0 ? null : venue ?? null;
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return { city: cityText.replace(/\d{4,5}|\b\d+[a-z]?\b/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 50), lat: round(base?.lat), lon: round(base?.lon) };
}

function defaultCity() {
  const g = S().settings.geo;
  const raw = g?.city || S().settings.city || currentPlaceName() || '';
  // Adresse → nur der Ort (letzter Teil ohne Hausnummer/PLZ)
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  return (parts.length > 1 ? parts.at(-1) : parts[0] ?? '').replace(/\b\d{4,5}\b/g, '').trim();
}

/** Blatt „Melden“ – für geteilte Dates und Kommentare. */
function openReportSheet(ideaId, reviewId = null) {
  openSheet(reviewId ? 'Kommentar melden' : 'Date melden', `
    <p class="muted small">Was stimmt nicht? Wir prüfen jede Meldung und entfernen Inhalte, die gegen die Regeln verstoßen. Die meldende Person bleibt anonym.</p>
    <div class="report-reasons" role="radiogroup">
      ${REPORT_REASONS.map(([v, l], k) => `<label class="radio-row"><input type="radio" name="rr" value="${v}" ${k === 0 ? '' : ''}><span>${l}</span></label>`).join('')}
    </div>
    <div class="field"><label class="label" for="rr-note">Was genau? <small class="muted">(optional)</small></label><textarea class="input" id="rr-note" rows="2" maxlength="500"></textarea></div>
    <label class="switch"><input type="checkbox" id="rr-block"><span><strong>Inhalte dieser Person nicht mehr anzeigen</strong><br><small class="muted">Du siehst ihre Dates und Kommentare dann nicht mehr. Aufheben in den Einstellungen.</small></span></label>
    <button type="button" class="btn primary big" id="rr-send">Meldung senden</button>
    ${reviewId ? '' : '<button type="button" class="linkish center" id="rr-only-block">Nur ausblenden, ohne zu melden</button>'}
    <p class="muted small">Bei Gefahr für Leib und Leben wende dich bitte direkt an die Polizei (110).</p>`, (sh) => {
    sh.querySelector('#rr-send').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const reason = sh.querySelector('input[name=rr]:checked')?.value;
      if (!reason) return toast('Bitte einen Grund wählen');
      try {
        await community.api.report(ideaId, { reviewId, reason, note: sh.querySelector('#rr-note').value.trim(), block: sh.querySelector('#rr-block').checked });
        closeSheet();
        toast('Danke – wir sehen uns das an');
        if (sh.querySelector('#rr-block').checked) {
          discover.community = null;
          loadCommunity();
        }
      } catch (err) {
        toast(err.message);
      }
    }));
    sh.querySelector('#rr-only-block')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try {
        await community.api.block(ideaId);
        closeSheet();
        toast('Blockiert – du siehst diese Inhalte nicht mehr');
        discover.community = null;
        loadCommunity();
      } catch (err) {
        toast(err.message);
      }
    }));
  });
}

/** Eigene geteilte Dates mit Status (auch ausgeblendete, mit Begründung und Einspruch). */
function myCommunityHTML() {
  const list = discover.cMine ?? [];
  if (!list.length) return '';
  return `
    <details class="panel my-shared" ${list.some((r) => r.hidden) ? 'open' : ''}>
      <summary><strong>Eure geteilten Dates</strong> <span class="muted small">(${list.length})</span></summary>
      ${list.map((r) => `
        <div class="my-shared-row">
          <div class="grow"><strong>${esc(r.idea?.title ?? 'Date')}</strong><br>
            <small class="muted">${r.hidden ? `${icon('lock')} Ausgeblendet${r.mod_reason ? ` – ${esc(r.mod_reason)}` : ''}` : `Sichtbar${r.display_name ? ` als „${esc(r.display_name)}“` : ' ohne Namen'}`}${r.city ? ` · ${esc(r.city)}` : ''}</small>
            ${r.hidden ? (r.appeal ? `<p class="muted small">Einspruch eingereicht: „${esc(r.appeal)}“ – wir melden uns.</p>` : `
              <div class="appeal"><textarea class="input" rows="2" maxlength="500" data-appeal-text="${r.id}" placeholder="Warum ist das ein Irrtum?"></textarea>
              <button type="button" class="btn sm" data-appeal="${r.id}">Einspruch einlegen</button></div>`) : ''}
          </div>
          <button type="button" class="btn sm ghost danger" data-cdel="${r.id}">Zurückziehen</button>
        </div>`).join('')}
    </details>`;
}

async function loadMyCommunity() {
  if (!community.api) return;
  try {
    discover.cMine = await community.api.mine();
  } catch {
    discover.cMine = [];
  }
  if (current.name === 'entdecken' && discover.tab === 'community') render();
}

/* --- Moderation (nur für eingetragene Moderator:innen) ------------------------ */

const MOD_REASONS = ['Verstoß gegen die Community-Regeln', 'Anstößige oder sexuelle Inhalte', 'Beleidigung oder Hass', 'Persönliche Daten anderer', 'Werbung oder Spam', 'Falsche oder gefährliche Angaben'];

RENDER.moderation = () => {
  const m = session.mod ??= { list: null, loading: false, error: '' };
  if (!m.list && !m.loading && community.api) {
    m.loading = true;
    community.api.queue().then((l) => (m.list = l)).catch((e) => (m.error = e.message)).finally(() => {
      m.loading = false;
      if (current.name === 'moderation') render();
    });
  }
  const label = (v) => REPORT_REASONS.find(([k]) => k === v)?.[1] ?? v ?? '–';
  root.innerHTML = `
    ${topbar({ title: 'Moderation', sub: 'Gemeldete Inhalte und Einsprüche. Bitte zeitnah entscheiden (Ziel: innerhalb von 24 Stunden).', back: ['mehr', '', 'Einstellungen'] })}
    ${!community.api ? '<p class="muted">Nur mit Konto verfügbar.</p>'
      : m.loading ? '<div class="loading"><span class="spinner"></span>Lade Meldungen …</div>'
        : m.error ? `<p class="warn-text">${esc(m.error)}</p>`
          : !m.list?.length ? '<div class="empty"><p>Keine offenen Meldungen. 🎉</p></div>'
            : m.list.map((q, k) => `
      <article class="panel mod-card">
        <div class="row between"><strong>${esc(q.title ?? 'Date')}</strong>${q.hidden ? '<span class="tag">ausgeblendet</span>' : '<span class="tag ok">sichtbar</span>'}</div>
        <p class="muted small">${q.review_id ? 'Kommentar' : 'Geteiltes Date'} · ${esc(q.display_name ?? 'ohne Namen')}${q.city ? ` · ${esc(q.city)}` : ''} · ${q.reports} Meldung${q.reports === 1 ? '' : 'en'}</p>
        ${q.review_id ? `<blockquote>${esc(q.comment ?? '')}</blockquote>` : `<p class="small">${esc(q.content?.teaser ?? '')}</p><p class="flow">${(q.content?.steps ?? []).map((s) => esc(s.t)).join(' → ')}</p>`}
        ${q.reports ? `<p class="small"><strong>Gründe:</strong> ${(q.reasons ?? []).filter(Boolean).map((r) => esc(label(r))).join(', ') || '–'}</p>` : ''}
        ${(q.notes ?? []).length ? `<p class="small muted">${q.notes.map((n) => `„${esc(n)}“`).join(' · ')}</p>` : ''}
        ${q.appeal ? `<p class="small"><strong>Einspruch:</strong> „${esc(q.appeal)}“</p>` : ''}
        <div class="field"><label class="label" for="mr-${k}">Begründung für die Person</label>
          <select class="input" id="mr-${k}">${MOD_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
        <div class="row gap wrap">
          <button class="btn sm" data-mod="keep" data-k="${k}">In Ordnung${q.hidden ? ' – wieder zeigen' : ''}</button>
          <button class="btn sm primary" data-mod="hide" data-k="${k}">Ausblenden</button>
          <button class="btn sm ghost danger" data-mod="delete" data-k="${k}">Löschen</button>
          <button class="btn sm ghost danger" data-mod="ban" data-k="${k}">Person sperren</button>
        </div>
      </article>`).join('')}`;
  bindBack();
  on('[data-mod]', 'click', async (_, el) => {
    const q = m.list[Number(el.dataset.k)];
    const action = el.dataset.mod;
    if (action === 'ban' && !confirm('Diese Person kann dann nichts mehr teilen oder bewerten, und alle ihre Inhalte sind ausgeblendet. Sperren?')) return;
    if (action === 'delete' && !confirm('Endgültig löschen?')) return;
    await withBusy(el, async () => {
      try {
        await community.api.moderate(q.idea_id, q.review_id, action, $(`#mr-${el.dataset.k}`).value);
        m.list = null;
        discover.community = null;
        toast('Erledigt');
        render();
      } catch (e) {
        toast(e.message);
      }
    });
  });
};

/* --- Mit der Community teilen ------------------------------------------------- */

/** Nur Inhalte der Idee teilen – keine Namen, Hinweise, Kosten-Einträge, Adressen oder privaten Daten. */
function publicIdea(src) {
  const isVenue = (pl) => pl?.lat != null && (pl.category || (pl.kind && pl.kind !== 'adresse'));
  const steps = (src.steps ?? []).map((s) => {
    const out = { t: s.t ?? s.title, min: s.min ?? 60 };
    if (s.q && src.reach !== 0) out.q = s.q;
    if (s.url) out.url = s.url;
    if (s.food) out.food = true;
    const pl = s.place;
    // Nur öffentliche Orte (Restaurant, Kino …) – nie eine Wohnadresse oder den Startpunkt
    if (src.reach !== 0 && isVenue(pl)) out.place = { name: pl.name, street: pl.street ?? '', city: pl.city ?? '', lat: pl.lat, lon: pl.lon, website: pl.website ?? '', hours: pl.hours ?? '', image: pl.image ?? '', category: pl.category ?? '' };
    return out;
  });
  return {
    title: src.title, emoji: src.emoji ?? '💡', teaser: src.teaser ?? '', place: src.place || 'drinnen', cost: src.cost ?? 0,
    reach: src.reach ?? 1, times: src.times ?? [src.daytime ?? 'abend'], moods: src.moods ?? [], steps,
    image: src.image && allowedImage(src.image) ? src.image : steps.find((s) => allowedImage(s.place?.image))?.place.image ?? '',
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
  if (!src || !community.api) {
    toast('Teilen geht nur mit Konto und Internetverbindung');
    return go(kind === 'idea' ? 'entdecken' : 'date', kind === 'idea' ? null : id, { replace: true });
  }
  const role = myRole();
  const partner = other(role);
  const pub = publicIdea(src);
  const draft = { moods: new Set(pub.moods) };
  const prefs = commPrefs();
  const firstTime = !prefs.rulesAt;
  const pair = pairName();
  const mode = session.shareMode ?? prefs.mode ?? 'vorname';
  const pairState = pair?.name ? (pairAgreed() ? 'ok' : pair.consent?.[partner] === false ? 'nein' : 'wartet') : null;
  const shownAs = displayNameFor();

  const nameChooser = `
    <div class="field"><span class="label">Wie sollen andere euch sehen?</span>
      <div class="radio-list" role="radiogroup">
        <label class="radio-row"><input type="radio" name="sh-mode" value="vorname" ${mode === 'vorname' ? 'checked' : ''}><span><strong>${esc(firstName(role) || 'Mit Vornamen')}</strong><br><small class="muted">Dein Vorname</small></span></label>
        ${partnerJoined() ? `<label class="radio-row"><input type="radio" name="sh-mode" value="paar" ${mode === 'paar' ? 'checked' : ''}><span><strong>Als Paar</strong><br><small class="muted">z. B. „Die Abenteurer“ – erscheint erst, wenn ${esc(nameOf(partner))} zustimmt</small></span></label>` : ''}
        <label class="radio-row"><input type="radio" name="sh-mode" value="fantasie" ${mode === 'fantasie' ? 'checked' : ''}><span><strong>Fantasiename</strong><br><small class="muted">z. B. „Sonntagskinder“</small></span></label>
      </div>
      <div class="field" id="sh-alias-field" ${mode === 'fantasie' ? '' : 'hidden'}>
        <input class="input" id="sh-alias" maxlength="24" placeholder="Dein Fantasiename" value="${esc(prefs.alias ?? '')}">
      </div>
      <div class="field" id="sh-pair-field" ${mode === 'paar' ? '' : 'hidden'}>
        <input class="input" id="sh-pair" maxlength="30" placeholder="Euer Paarname" value="${esc(pair?.name ?? '')}">
        ${pairState === 'wartet' ? `<small class="muted">${esc(nameOf(partner))} hat noch nicht zugestimmt – bis dahin erscheint dein Vorname.</small>` : pairState === 'nein' ? `<small class="muted">${esc(nameOf(partner))} möchte keinen Paarnamen – bis ihr euch einig seid, erscheint dein Vorname.</small>` : ''}
      </div>
    </div>`;

  root.innerHTML = `
    ${topbar({ title: 'Mit der Community teilen', sub: 'Andere Paare sehen Titel, Ablauf, öffentliche Orte und Kosten – nie eure Adresse, Fotos nur, wenn ihr sie freigebt.', back: kind === 'idea' ? ['entdecken', '', 'Entdecken'] : ['date', id, 'Date'] })}
    <form class="panel form" id="share-form" novalidate>
      <div class="field"><label class="label" for="sh-title">Titel</label><input class="input" id="sh-title" maxlength="60" value="${esc(pub.title)}"></div>
      <div class="field"><label class="label" for="sh-teaser">Was macht das Date besonders?</label><input class="input" id="sh-teaser" maxlength="140" value="${esc(pub.teaser)}" placeholder="z. B. Perfekt für Regentage, das Café hat die beste Torte"></div>
      <div class="field"><span class="label">Stimmung</span><div class="chips" id="sh-moods">${MOODS.map(([v, l]) => `<button type="button" class="chip" data-m="${v}" aria-pressed="${draft.moods.has(v)}">${l}</button>`).join('')}</div></div>
      <div class="field"><label class="label" for="sh-city">Stadt oder Region</label><input class="input" id="sh-city" maxlength="50" value="${esc(defaultCity())}" placeholder="z. B. München">
        <small class="muted">${pub.reach === 0 ? 'Ein Date zuhause: Wir zeigen nur die Region, keinen Ort auf der Karte.' : 'Wir zeigen nur die Stadt – nie euren Startpunkt oder eure Adresse.'}</small></div>
      <div class="panel inset"><strong>So sehen es andere</strong><p class="flow">${pub.steps.map((s) => esc(s.t) + (s.place ? ` <small class="muted">(${esc(s.place.name)})</small>` : '')).join(' → ')}</p><p class="muted small">${fmtEuro(pub.cost)} für zwei · ${firstTime ? 'von euch' : shownAs ? `von „${esc(shownAs)}“` : 'ohne Namen'}</p></div>
      ${firstTime ? `
      <section class="first-share">
        <h2>Bevor ihr zum ersten Mal teilt</h2>
        ${nameChooser}
        <label class="switch"><input type="checkbox" id="sh-rules"><span>Ich halte mich an die <a href="#agb" data-legal="agb">Community-Regeln</a>: nichts Anstößiges, Beleidigendes oder Werbung und keine Fotos oder Daten anderer ohne Erlaubnis. Verstöße werden entfernt.</span></label>
      </section>` : `
      <details class="share-name"><summary>Erscheint ${shownAs ? `als „${esc(shownAs)}“` : 'ohne Namen'} · ändern</summary>${nameChooser}</details>`}
      <button class="btn primary big" type="submit">${icon('share')}Teilen</button>
    </form>`;

  bindBack();
  bindLegalLinks();
  $$('input[name=sh-mode]').forEach((r) => r.addEventListener('change', () => {
    session.shareMode = r.value;
    $('#sh-pair-field').hidden = r.value !== 'paar';
    $('#sh-alias-field').hidden = r.value !== 'fantasie';
    if (r.value === 'paar') $('#sh-pair').focus();
    if (r.value === 'fantasie') $('#sh-alias').focus();
  }));
  $('#sh-moods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    draft.moods.has(b.dataset.m) ? draft.moods.delete(b.dataset.m) : draft.moods.add(b.dataset.m);
    b.setAttribute('aria-pressed', String(draft.moods.has(b.dataset.m)));
  });
  $('#share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (firstTime && !$('#sh-rules').checked) return toast('Bitte bestätige die Community-Regeln');
    const chosen = $('input[name=sh-mode]:checked')?.value ?? mode;
    const pairText = $('#sh-pair')?.value.trim() ?? '';
    if (chosen === 'paar' && !pairText) return toast('Wie heißt ihr als Paar?');
    const aliasText = $('#sh-alias')?.value.trim() ?? '';
    const bad = chosen === 'paar' ? nameProblem(pairText) : chosen === 'fantasie' ? nameProblem(aliasText) : '';
    if (bad) return toast(bad);
    const title = $('#sh-title').value.trim() || pub.title;
    const teaser = $('#sh-teaser').value.trim();
    if (unsafeText(title, teaser, pairText, ...pub.steps.map((s) => s.t))) return toast('Bitte formuliere den Text ohne anstößige Wörter');
    // Auswahl speichern (Paarname braucht die Zustimmung beider)
    store.update((st) => {
      st.settings.community = { ...(st.settings.community ?? {}), [role]: { ...(st.settings.community?.[role] ?? {}), mode: chosen, ...(chosen === 'fantasie' ? { alias: aliasText } : {}), rulesAt: st.settings.community?.[role]?.rulesAt ?? Date.now() } };
      if (chosen === 'paar') {
        const same = st.settings.communityPair?.name === pairText;
        st.settings.communityPair = { name: pairText, proposedBy: same ? st.settings.communityPair.proposedBy : role, consent: { ...(same ? st.settings.communityPair.consent : {}), [role]: true, ...(same ? {} : { [partner]: null }) } };
      }
    });
    session.shareMode = null;
    const pubPhotos = kind === 'date' ? photoList(S().dates.find((x) => x.id === id) ?? {}).filter((ph) => ph.public && ph.url).map((ph) => ph.url) : [];
    const idea = { ...pub, title, teaser, moods: [...draft.moods], ...(pubPhotos.length ? { photos: pubPhotos } : {}) };
    const loc = coarseLocation(pub, $('#sh-city').value.trim());
    await withBusy(e.submitter ?? $('#share-form button[type=submit]'), async () => {
      try {
        const cid = await community.api.publish(idea, { ...loc, displayName: displayNameFor() });
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
        discover.cMine = null;
        session.namesSynced = displayNameFor();
        toast(chosen === 'paar' && !pairAgreed() ? `Geteilt – der Paarname erscheint, sobald ${nameOf(partner)} zustimmt` : 'Geteilt – danke!');
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
  if (!myRole()) return toast(noRoleMsg());
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
  const budget = budgetVal(feedFilter.budget ?? L().lastSearch.budget ?? 60);
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

/** Gezeigt, aber nicht gewählt → beim nächsten Mal etwas seltener vorschlagen. */
function rememberSkips(list) {
  if (!list.length) return;
  store.update((s) => {
    const L = (s.settings.learn ??= {});
    L.skip ??= {};
    L.catSkip ??= {};
    const now = Date.now();
    for (const i of list.slice(0, 8)) {
      if (i.generated) {
        const c = mainCat(i);
        if (c) L.catSkip[c] = [Math.min((L.catSkip[c]?.[0] ?? 0) + 1, 6), now];
      } else if (i.id && !i.event) {
        L.skip[i.id] = [Math.min((L.skip[i.id]?.[0] ?? 0) + 1, 6), now];
      }
    }
  });
}

/* --- Bausteine für „Für euch“ ------------------------------------------------ */

const secHead = (title, action = '') => `<div class="sec-head"><h2 class="section-title">${esc(title)}</h2>${action}</div>`;

function ideaJobFor(i) {
  let mp = i.mainPlace ?? i.steps?.find((s) => s.place?.lat != null)?.place;
  if (!mp && i.reach !== 0) {
    // Allgemeine Idee: Foto des nächsten passenden Orts aus eurer Umgebung
    const c = mainCat(i);
    const near = c ? currentArea()?.cats[c]?.find((p) => p.lat != null) : null;
    if (near) mp = near;
  }
  const t = topicFor(i);
  return mp ? { place: mp, topic: t } : t ? { topic: t } : null;
}
const ideaImg = (i) => i.photos?.[0] || i.image || i.steps?.find((s) => s.place?.image)?.place.image;

/** Was gerade zur Jahreszeit passt – solange ihr noch nichts bewertet habt. */
const SEASON_WORDS = {
  advent: ['Beliebt in der Adventszeit', /weihnacht|advent|punsch|glüh|plätzchen|fondue|eislauf|eisstock|lichter|therme|kamin|raclette/i],
  winter: ['Beliebt im Winter', /fondue|eislauf|eisstock|therme|sauna|kamin|raclette|schnee|rodel|kino|museum/i],
  fruehling: ['Beliebt im Frühling', /picknick|radtour|blüte|garten|wander|markt|café|spazier/i],
  sommer: ['Beliebt im Sommer', /see|picknick|open-air|biergarten|eis|sonnenuntergang|rooftop|radtour|baden/i],
  herbst: ['Beliebt im Herbst', /wander|weinfest|wein|kürbis|museum|kino|töpfer|koch|therme|café/i],
};
function seasonalPicks(iso) {
  const m = Number(iso.slice(5, 7));
  const key = isXmasSeason(iso) ? 'advent' : m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'fruehling' : m <= 8 ? 'sommer' : 'herbst';
  const [title, re] = SEASON_WORDS[key];
  const md = iso.slice(5);
  const inSeason = (i) => !i.season || (i.season[0] <= i.season[1] ? md >= i.season[0] && md <= i.season[1] : md >= i.season[0] || md <= i.season[1]);
  const list = allIdeas()
    .filter((i) => inSeason(i) && !i.generated && !i.event)
    .map((i) => ({ i, s: (i.season ? 2 : 0) + (re.test(`${i.title} ${i.teaser ?? ''}`) ? 1 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((x) => x.i);
  return { title, list };
}

/** Kurze Angaben: Entfernung, Preis, Dauer, Bewertung. */
function ideaMeta(i) {
  const r = communityRatingFor(i);
  const t = i.travel?.find((x) => x.mode === (i.km < 1.5 ? 'walking' : 'driving'));
  return [
    i.eventWhenText,
    i.km != null ? `${fmtKm(i.km)}${t ? ` · ${fmtMin(t.min)}` : ''}` : '',
    fmtEuro(i.cost ?? 0),
    i.event ? '' : fmtDuration(feedFilter.duration && i.reach !== 0 ? feedFilter.duration : ideaDuration(i)),
    r ? `★ ${r.avg}` : i.rating?.count ? `★ ${String(i.rating.avg).replace('.', ',')}` : '',
  ].filter(Boolean);
}

const shownWhy = new Set();
/** Große Fotokarte zum Durchwischen. */
function heroCard(i) {
  favRegistry.set(i.id, i);
  const tag = i.event ? 'Veranstaltung' : i.generated ? 'In eurer Nähe' : '';
  // Begründung – jede höchstens einmal, damit nicht überall dasselbe steht
  let why = learnScore(i, { date: feedDate(), weather: discover.feedWeather }).reason;
  if (!why || shownWhy.has(why)) {
    const prefMoods = preferredMoods();
    const m = (i.moods ?? []).find((x) => prefMoods.includes(x));
    why = m ? `Passt zu eurer Vorliebe: ${moodLabel(m)}` : '';
    if (shownWhy.has(why)) why = '';
  }
  if (why) shownWhy.add(why);
  return `
    <article class="hero-card" data-open-idea="${esc(i.id)}" role="button" tabindex="0">
      ${thumb(ideaImg(i), i.emoji ?? '💡', 'cover', ideaJobFor(i), i)}
      ${tag ? `<span class="hc-tag">${tag}</span>` : ''}
      ${favBtn(i, 'fav-pos')}
      <div class="hc-body">
        <h3>${esc(i.title)}</h3>
        ${i.subtitle ? `<p class="hc-places">${icon('pin')}${esc(i.subtitle)}</p>` : ''}
        <p class="hc-teaser">${esc(i.teaser ?? '')}</p>
        <p class="hc-meta">${ideaMeta(i).map(esc).join(' · ')}</p>
        ${why ? `<p class="hc-why">${icon('sparkle')}${esc(why)}</p>` : ''}
      </div>
    </article>`;
}

/** Kompakte Zeile in der Ideen-Liste. */
function ideaRow(i) {
  favRegistry.set(i.id, i);
  return `
    <article class="idea-row" data-open-idea="${esc(i.id)}" role="button" tabindex="0">
      ${thumb(ideaImg(i), i.emoji ?? '💡', 'row', ideaJobFor(i), i)}
      <div class="grow">
        <h3>${esc(i.title)}</h3>
        <p class="clamp muted small">${esc(i.subtitle ?? i.teaser ?? '')}</p>
        <p class="ir-meta">${ideaMeta(i).map(esc).join(' · ')}</p>
      </div>
      ${favBtn(i)}
    </article>`;
}

/** Kleine Karte im Karussell. */
function miniCard(i) {
  favRegistry.set(i.id, i);
  return `
    <article class="mini-card" data-open-idea="${esc(i.id)}" role="button" tabindex="0">
      ${thumb(ideaImg(i), i.emoji ?? '💡', 'cover', ideaJobFor(i), i)}
      <div class="mc-body"><h3>${esc(i.title)}</h3><p class="ir-meta">${ideaMeta(i).slice(0, 2).map(esc).join(' · ')}</p></div>
    </article>`;
}

/** Kacheln: was es im Umkreis gibt. */
function areaTiles() {
  const c = discoverCenter();
  const r = feedRadiusKm();
  if (!c || !r || store.inArtifact()) return '';
  const a = getArea(c, r);
  const pr = areaProgress();
  const counts = a ? Object.keys(AREA_LABELS).filter((id) => a.cats[id]?.length).map((id) => [id, a.cats[id].length]) : [];
  if (!counts.length && !pr) return '';
  return `
    <section class="stack">
      ${secHead(`Bei euch in der Nähe`, '<button type="button" class="linkish small" data-dtab="orte">Alle Orte</button>')}
      ${pr ? `<p class="muted small"><span class="spinner tiny"></span> <span id="area-progress">Datewell erkundet eure Umgebung … (${pr.done}/${pr.total})</span></p>` : ''}
      ${counts.length ? `<div class="cat-row">${counts.map(([id, n]) => `<button type="button" class="cat-tile" data-area-cat="${id}">${glyph(categoryById(id)?.emoji ?? '📍')}<strong>${n >= 15 ? '15+' : n}</strong><span>${esc(AREA_LABELS[id])}</span></button>`).join('')}</div>` : ''}
    </section>`;
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
    const budget = budgetVal(feedFilter.budget ?? L().lastSearch.budget ?? 200);
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
  // Persönliche Empfehlungen erst, wenn ihr schon Dates bewertet habt
  const rated = S().dates.some((x) => Object.values(x.ratings ?? {}).some((v) => v > 0));
  const recos = rated ? recommend(S().dates.map(fullPlanOrMeta), 3) : [];
  const season = recos.length ? null : seasonalPicks(feedDate());
  const topCommunity = (d.community ?? []).filter((r) => r.rating_count).sort((a, b) => b.avg_stars - a.avg_stars).slice(0, 3);
  if (community.api && !d.community && !d.cLoading) loadCommunity();
  const w = d.feedWeather;
  const budget = feedFilter.budget ?? L().lastSearch.budget ?? 60;
  const f = feedFilter;

  // Ein gemeinsamer Bereich: Dates aus echten Orten in der Nähe und passende Ideen, abwechselnd
  const heroes = [];
  const gq = [...(d.gen ?? [])];
  const fq = [...(d.feed ?? [])];
  while (gq.length || fq.length) {
    if (gq.length) heroes.push(gq.shift());
    if (fq.length) heroes.push(fq.shift());
  }
  heroes.splice(2, 0, ...(d.events ?? []).slice(0, 2));
  const genBusy = center && f.radiusKm !== 0 && !store.inArtifact() && d.genLoading && !d.gen;
  const allBusy = (d.feedLoading && !d.feed) && (genBusy || !center);
  const ctxParts = [center?.name ?? 'Standort wählen', f.radiusKm === 0 ? 'Zuhause' : `${f.radiusKm} km`];
  const extras = [f.mood ? moodLabel(f.mood) : '', f.place === 'drinnen' ? 'Drinnen' : f.place === 'draußen' ? 'Draußen' : '', f.duration ? durLabel(f.duration) : ''].filter(Boolean);

  shownWhy.clear();
  root.innerHTML = `
    ${head}
    <button type="button" class="ctx-strip" data-ftoggle aria-expanded="${f.open}">
      <span class="ctx-main">${icon('pin')}<span>${ctxParts.map(esc).join(' · ')}</span></span>
      ${w?.known ? `<span class="ctx-weather">${icon(weatherGlyph(w) === 'sun' && f.daytime === 'abend' ? 'moon' : weatherGlyph(w))}${w.temp != null ? `${w.temp}°` : ''}</span>` : ''}
      <span class="ctx-filter">${icon('sliders')}${extras.length ? `<b>${extras.length}</b>` : ''}</span>
    </button>
    ${extras.length ? `<p class="ctx-extras">${extras.map(esc).join(' · ')}${w?.wet ? ' · bei Regen nur drinnen' : ''}</p>` : w?.wet ? '<p class="ctx-extras">Regen angesagt – Ideen für drinnen</p>' : ''}
    <section class="panel form filter-panel" ${f.open ? '' : 'hidden'}>
      <div class="field"><span class="label">Standort</span>
        ${locField('ff-city', center ? { name: center.name, sub: center.gps ? 'Aktueller Standort' : S().settings.geo?.sub ?? '' } : null)}
      </div>
      <div class="field"><span class="label">Tageszeit</span>${chips('ff-daytime', [['tag', 'Tagsüber', 'sun'], ['abend', 'Abends', 'moon']], f.daytime, 'seg')}</div>
      <div class="field">
        <div class="label-row"><span class="label">Budget für euch beide</span><output id="ff-budget-out" class="budget-out">${budgetLabel(budget)}</output></div>
        <input type="range" id="ff-budget" min="0" max="200" step="5" value="${budget}" aria-label="Budget in Euro">
      </div>
      <div class="field"><span class="label">Stimmung</span>${chips('ff-mood', [['', 'Alle'], ...MOODS.map(([v, l]) => [v, l])], f.mood)}</div>
      <div class="field"><span class="label">Drinnen oder draußen</span>${chips('ff-place', [['', 'Beides'], ['drinnen', 'Drinnen', 'home'], ['draußen', 'Draußen', 'sun']], f.place, 'seg')}</div>
      <div class="field"><span class="label">Wie weit?</span>${radiusChips('ff-reach', f.radiusKm, { home: true })}</div>
      <div class="field"><span class="label">Wie lange soll das Date dauern?</span>${chips('ff-dur', DUR_OPTS, String(f.duration ?? ''))}<small class="muted">Datewell verteilt die Zeit auf die Stationen und rechnet die Wege mit ein.</small></div>
      <button type="button" class="btn primary" id="ff-apply">Anwenden</button>
    </section>

    <section class="stack">
      ${secHead(`${whenLabel(feedDate(), f.daytime)}${isXmasSeason(feedDate()) ? ' · Adventszeit' : ''}`, heroes.length ? `<button type="button" class="linkish small" id="mix-all">${icon('dice')}Neu mischen</button>` : '')}
      ${heroes.length && myRole() ? `<button type="button" class="match-inline" id="start-match"${lockAttr()} data-pair-lock-text="Beim Date-Match wischt ihr beide und seht, worauf ihr gemeinsam Lust habt.">${icon('heart')}<span><strong>Date-Match</strong> · Gemeinsam wischen – findet heraus, worauf ihr beide Lust habt</span>${icon('right')}</button>` : ''}
      ${allBusy && !heroes.length ? '<div class="loading"><span class="spinner"></span>Suche Dates für euch …</div>'
        : heroes.length ? `<div class="hero-row">${heroes.map(heroCard).join('')}</div>${genBusy ? '<p class="muted small"><span class="spinner tiny"></span> Stelle zusätzlich Dates aus euren Orten zusammen …</p>' : ''}`
          : '<p class="muted">Gerade passt nichts – lockert die Filter oben.</p>'}
      ${d.genError ? `<p class="muted small">Die Kartendaten sind gerade nicht erreichbar. <button type="button" class="linkish small" id="gen-retry">Nochmal versuchen</button></p>` : ''}
    </section>

    ${f.radiusKm !== 0 ? areaTiles() : ''}

    ${recos.length ? `
    <section class="stack">
      ${secHead('Weil es euch gefallen hat')}
      <div class="mini-row">${recos.map(({ idea }) => miniCard(idea)).join('')}</div>
    </section>` : season?.list.length ? `
    <section class="stack">
      ${secHead(season.title)}
      <div class="mini-row">${season.list.map(miniCard).join('')}</div>
    </section>` : ''}

    ${topCommunity.length ? `
    <section class="stack">
      ${secHead('Beliebt bei anderen Paaren', '<button type="button" class="linkish small" data-dtab="community">Alle</button>')}
      <div class="mini-row">${topCommunity.map((r) => miniCard(communityIdea(r))).join('')}</div>
    </section>` : ''}`;

  bindDiscoverTabs();
  on('[data-area-cat]', 'click', (_, el) => {
    d.tab = 'orte';
    d.cat = el.dataset.areaCat;
    d.results = null;
    render(true);
  });
  $('#start-match')?.addEventListener('click', (e) => startMatch(e.currentTarget));
  on('[data-open-idea]', 'click', (e, el) => {
    if (e.target.closest('[data-fav]')) return;
    const idea = favRegistry.get(el.dataset.openIdea) ?? ideaById(el.dataset.openIdea);
    if (idea) planIdeaNow(idea, el);
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
    $('#ff-budget-out').textContent = budgetLabel(f.budget);
  });
  let pickedLoc = null;
  bindLocField('ff-city', (g) => (pickedLoc = g));
  $('#ff-apply').addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      if (pickedLoc) setHome(pickedLoc);
      else {
        // Nur getippt, nichts gewählt: besten Treffer nehmen
        const city = $('#ff-city').value.trim();
        if (city && city !== center?.name) {
          const best = (await geocodeList(city).catch(() => []))[0];
          if (best) setHome(best);
        }
      }
    });
    f.open = false;
    refresh();
  });
  $('#mix-all')?.addEventListener('click', async (e) => {
    rememberSkips([...(d.gen ?? []), ...(d.feed ?? [])]);
    await withBusy(e.currentTarget, async () => {
      const shown = new Set((d.feed ?? []).map((i) => i.id));
      const res = await suggest(d.feedCtx, d.feedWeather, { count: 4, exclude: shown, dates: S().dates.map(fullPlanOrMeta) });
      d.feed = res.ideas;
      d.gen = null; // neue Kombinationen aus euren Orten
    });
    render();
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
  // Zurückgezogene Community-Ideen bleiben gemerkt, sind aber nicht mehr verfügbar
  const needFeed = community.api && favIdeas.some(({ idea }) => idea.communityId);
  if (needFeed && !discover.community && !discover.cLoading) loadCommunity().then(() => current.name === 'entdecken' && discover.tab === 'gemerkt' && render());
  const gone = (idea) => !!(idea.communityId && discover.community && !discover.community.some((r) => r.id === idea.communityId));
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
            ${gone(idea) ? '<span class="tag">Nicht mehr verfügbar</span>' : `<button class="btn sm primary" data-feed-plan="${esc(idea.id)}">${icon('sparkle')}Planen</button>`}
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
          ${community.api ? (i.communityId ? `<button class="btn sm ghost" data-unshare-idea="${i.id}">Nicht mehr teilen</button>` : `<button class="icon-btn small" data-share-idea="${i.id}" aria-label="Mit der Community teilen">${icon('share')}</button>`) : ''}
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
  on('[data-unshare-idea]', 'click', async (_, el) => {
    const i = S().ideas.find((x) => x.id === el.dataset.unshareIdea);
    if (!i?.communityId) return;
    await withBusy(el, async () => {
      try {
        await community.api.remove(i.communityId);
        store.update((st) => delete st.ideas.find((x) => x.id === i.id).communityId);
        discover.community = null;
        toast('Nicht mehr geteilt');
        render();
      } catch (err) {
        toast(err.message);
      }
    });
  });
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
      ${community.api ? '<label class="switch"><input type="checkbox" id="i-share"><span><strong>Mit der Community teilen</strong><br><small class="muted">Andere Paare sehen deine Idee mit Anzeigenamen und Stadt. Eure Namen und Fotos von euch bleiben privat.</small></span></label>' : ''}
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
    discover.tab = 'gemerkt';
    if ($('#i-share')?.checked) return go('teilen', `idea:${idea.id}`, { replace: true });
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
            <small class="reco-meta">${fmtEuro(idea.cost ?? 0)} · ${fmtDuration(ideaDuration(idea))}</small>
            ${idea.moods?.[0] ? `<span class="mood-tag">${icon('heart')}${esc(moodLabel((idea.moods ?? []).find((m) => reason.toLowerCase().includes(moodLabel(m).toLowerCase())) ?? idea.moods[0]))}</span>` : ''}
          </button>`).join('')}
      </div>
    </section>`;
}

/* ================================================================ Konto: Anmelden & Registrieren */

const invitePending = () => {
  const c = getConfig();
  return !!(pendingInvite()?.code || (c?.code && !c?.coupleId));
};

RENDER.konto = () => {
  const pend = pendingInvite();
  const mode = auth.mode ?? (pend?.code ? 'einladung' : getConfig()?.code && !getConfig()?.coupleId ? 'registrieren' : lastEmail() ? 'anmelden' : 'willkommen');
  const tabs = `
    <nav class="seg-tabs" role="tablist">
      <button role="tab" data-amode="anmelden" aria-selected="${mode === 'anmelden'}">Anmelden</button>
      <button role="tab" data-amode="registrieren" aria-selected="${mode === 'registrieren'}">Konto erstellen</button>
    </nav>`;
  const pw = (id, label, auto) => `
    <div class="field"><label class="label" for="${id}">${label}</label>
      <div class="pw-row"><input class="input" id="${id}" type="password" autocomplete="${auto}" minlength="8" required>
      <button type="button" class="pw-toggle" data-show="${id}" aria-pressed="false" aria-label="Passwort anzeigen">${icon('eye')}</button></div></div>`;
  const appleBtn = SUPABASE.apple ? `<div class="or-line"><span>oder</span></div><button type="button" class="btn big apple-btn" id="apple-login"><svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9ZM14 5.4c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4Z"/></svg>Mit Apple anmelden</button>` : '';
  const forms = {
    anmelden: `
      <form class="panel form" id="auth-form" novalidate>
        <div class="field"><label class="label" for="a-email">E-Mail-Adresse</label><input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" required value="${esc(lastEmail())}"></div>
        ${pw('a-pw', 'Passwort', 'current-password')}
        <label class="switch"><input type="checkbox" id="a-remember" ${getRemember() ? 'checked' : ''}><span>Angemeldet bleiben</span></label>
        <button class="btn primary big" type="submit">Anmelden</button>
        <button class="linkish small center" type="button" data-amode="vergessen">Passwort vergessen?</button>
        ${appleBtn}
      </form>`,
    registrieren: `
      <form class="panel form" id="auth-form" novalidate>
        ${SUPABASE.apple ? appleBtn.replace('<div class="or-line"><span>oder</span></div>', '') + '<div class="or-line"><span>oder</span></div>' : ''}
        <div class="field"><label class="label" for="a-email">E-Mail-Adresse</label><input class="input" id="a-email" type="email" autocomplete="email" inputmode="email" required></div>
        ${pw('a-pw', 'Passwort', 'new-password')}
        <small class="muted pw-hint" id="pw-hint">Mindestens 8 Zeichen</small>
        <label class="switch"><input type="checkbox" id="a-age"><span>Ich bin mindestens 16 Jahre alt.</span></label>
        <button class="btn primary big" type="submit" id="a-create" disabled>Konto erstellen</button>
        <p class="muted small center consent">Mit der Registrierung akzeptierst du die <a href="#agb" data-legal="agb">AGB</a> und die <a href="#datenschutz" data-legal="datenschutz">Datenschutzerklärung</a>.</p>
        <button class="linkish small center" type="button" data-amode="anmelden">Ich habe schon ein Konto</button>
      </form>`,
    willkommen: `
      <section class="welcome">
        <ul class="welcome-points">
          <li>${icon('sun')}<span>Ideen nach Wetter und Budget</span></li>
          <li>${icon('users')}<span>Gemeinsam planen</span></li>
          <li>${icon('album')}<span>Eure Momente sammeln</span></li>
        </ul>
        <button class="btn primary big" type="button" data-amode="registrieren">Loslegen</button>
        <button class="linkish center" type="button" data-amode="anmelden">Ich habe schon ein Konto</button>
      </section>`,
    einladung: pend?.status && pend.status !== 'ok' ? `
      <section class="panel stack center">
        <h2>Diese Einladung ist nicht mehr gültig.</h2>
        <p>Bitte ${esc(pend.inviter || 'die Person, die dich eingeladen hat')} um eine neue.</p>
        <button class="btn primary" type="button" data-amode="willkommen" data-drop-invite>Trotzdem loslegen</button>
      </section>` : `
      <section class="welcome invite-welcome">
        <h2 class="ob-title">${esc(pend?.inviter || 'Dein Lieblingsmensch')} hat dich zu Datewell eingeladen 💌</h2>
        <p class="ob-sub">Plant gemeinsam Dates, passend zu Wetter und Budget.</p>
        <button class="btn primary big" type="button" data-amode="registrieren">Einladung annehmen</button>
        <button class="linkish center" type="button" data-amode="anmelden">Ich habe schon ein Konto</button>
      </section>`,
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
        <h1 class="wordmark logo">Date<i>well</i></h1>
        <p class="tagline">For the moments that matter.</p>
      </div>
      ${invitePending() && ['anmelden', 'registrieren'].includes(mode) ? `<div class="banner neutral-row">${icon('users')}<span>${pend?.inviter ? `Einladung von ${esc(pend.inviter)}: ` : ''}Erstelle ein Konto oder melde dich an – dann seid ihr verbunden.</span></div>` : ''}
      ${mode === 'anmelden' ? `<button type="button" class="linkish small" data-amode="${pend?.code ? 'einladung' : 'willkommen'}">${icon('left')}Zurück</button>` : mode === 'registrieren' ? `<button type="button" class="linkish small" data-amode="${pend?.code ? 'einladung' : 'willkommen'}">${icon('left')}Zurück</button>` : ''}
      ${auth.error ? `<p class="warn-text" role="alert">${esc(auth.error)}</p>` : ''}
      ${auth.info && mode !== 'bestaetigen' ? `<p class="hint" role="status">${esc(auth.info)}</p>` : ''}
      ${forms[mode] ?? forms.anmelden}
      <p class="muted small center">Datewell speichert eure gemeinsamen Dates, Listen und Fotos sicher – privat für euch zwei.</p>
      ${legalLinks()}
    </section>`;

  on('[data-amode]', 'click', (_, el) => {
    if (el.hasAttribute('data-drop-invite')) setPendingInvite(null);
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
  $('#apple-login')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        await signInWithApple(auth.cfg);
      } catch (err) {
        auth.error = err.message;
        render();
      }
    });
  });
  $('#auth-form')?.addEventListener('input', () => $('.auth .warn-text')?.remove());
  // Registrierung: Knopf erst aktiv, wenn alles gültig ist; Hinweis direkt unter dem Passwort
  if (mode === 'registrieren') {
    const check = () => {
      const okMail = /^\S+@\S+\.\S+$/.test($('#a-email').value.trim());
      const pwLen = $('#a-pw').value.length;
      $('#pw-hint').classList.toggle('bad', pwLen > 0 && pwLen < 8);
      $('#pw-hint').textContent = pwLen > 0 && pwLen < 8 ? `Noch ${8 - pwLen} Zeichen – mindestens 8` : 'Mindestens 8 Zeichen';
      $('#a-create').disabled = !(okMail && pwLen >= 8 && $('#a-age').checked);
    };
    ['input', 'change'].forEach((ev) => $('#auth-form').addEventListener(ev, check));
    check();
  }
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
          const { session } = await signUp(auth.cfg, { email, password, invite: pendingInvite()?.code ?? getConfig()?.code ?? null });
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
  bindLegalLinks();
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
const REL_OPTS = [['zusammen', 'Zusammen'], ['verlobt', 'Verlobt'], ['verheiratet', 'Verheiratet']];
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/* --- Partner-Zustand: allein · Einladung offen · verbunden --------------------- */

const partnerState = { api: null, invite: undefined, loading: false };
const partnerJoined = () => {
  const role = myRole();
  return !!(role && (S().settings.members ?? {})[other(role)]);
};
const canInvite = () => store.syncInfo().backend === 'supabase' && !!partnerState.api;
const coupleState = () => (partnerJoined() ? 'verbunden' : partnerState.invite ? 'offen' : 'allein');
const myNameKey = (role) => (role === 'a' ? 'nameA' : 'nameB');
const myName = () => (S().settings[myNameKey(myRole())] ?? '').trim();
const partnerName = () => (S().settings[myNameKey(other(myRole()))] ?? '').trim() || partnerState.invite?.partner_name || '';

async function loadInvite() {
  if (!partnerState.api || partnerState.loading) return;
  partnerState.loading = true;
  try {
    partnerState.invite = partnerJoined() ? null : await partnerState.api.mine();
  } catch {
    partnerState.invite = partnerState.invite ?? null;
  }
  partnerState.loading = false;
  if (['start', 'mehr', 'einladen'].includes(current.name) || onboardingStep()) render();
}

const inviteMessage = (inv) => {
  const p = (inv?.partner_name || partnerName()).trim();
  return `Hey${p ? ` ${p}` : ''} 💛 Ich habe uns bei Datewell angemeldet – da finden wir zusammen schöne Date-Ideen, passend zu Wetter und Budget. Komm dazu: ${inviteLinkFor(inv.code)} Oder gib in der App den Code ${inv.code} ein.`;
};
async function shareInvite(inv) {
  const text = inviteMessage(inv);
  if (navigator.share) {
    try {
      return await navigator.share({ title: 'Datewell', text });
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Einladung kopiert – füge sie in WhatsApp oder eine Nachricht ein');
  } catch {
    prompt('Einladung', text);
  }
}
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast('Code kopiert');
  } catch {
    prompt('Einladungscode', code);
  }
}
const fmtExpiry = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });

/* --- Einladung, die noch vor der Anmeldung geöffnet wurde (Weg B) --------------- */

const PENDING_KEY = 'date-ideen.invite';
function pendingInvite() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY)) ?? null;
  } catch {
    return null;
  }
}
function setPendingInvite(v) {
  try {
    if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* egal */
  }
}
const JOIN_KEY = 'date-ideen.joined';
function joinInfo() {
  try {
    return JSON.parse(localStorage.getItem(JOIN_KEY)) ?? null;
  } catch {
    return null;
  }
}
function setJoinInfo(v) {
  try {
    if (v) localStorage.setItem(JOIN_KEY, JSON.stringify(v));
    else localStorage.removeItem(JOIN_KEY);
  } catch {
    /* egal */
  }
}

/* --- Schritte ------------------------------------------------------------------ */

// Weg A: Name → Partner (Einladen / Code / allein) → Besondere Tage → Vorlieben → Berechtigungen → Abschluss
// Weg B (eingeladen): Bist du …? → Stimmt das so? → Vorlieben → Berechtigungen → Ihr seid verbunden
const A_ALL = ['name', 'partner', 'tage', 'vorlieben', 'rechte', 'fertig'];
const B_STEPS = ['bname', 'check', 'vorlieben', 'rechte', 'verbunden'];
// Ohne Konto (nur dieses Gerät) gibt es nichts einzuladen
const aSteps = () => (canInvite() ? A_ALL : A_ALL.filter((x) => x !== 'partner'));
const COUNTED = { get a() { return aSteps().slice(0, aSteps().indexOf('rechte')); }, b: ['bname', 'check', 'vorlieben'] };
const SUBSTEP = { einladen: 'partner', code: 'partner' };

/** Weg B, wenn ich eingeladen wurde (der Server merkt sich, wer beigetreten ist). */
function obFlow() {
  const st = S().settings;
  const r = myRole();
  return st.invitee === r && st.members?.[other(r)] ? 'b' : 'a';
}

function onboardingStep() {
  const st = S().settings;
  const role = myRole();
  if (!role) return null;
  // Erst fragen, wenn die Daten aus eurem Konto da sind – sonst fragt Datewell unnötig erneut
  const sync = store.syncInfo();
  if (sync.mode === 'shared' && !sync.ready) return null;
  if (session.obForce) return session.obForce;
  if (st.onboarded?.[role]) return null;
  const flow = obFlow();
  const saved = st.obStep?.[role];
  if (flow === 'b') {
    if (saved === 'code' || saved === 'partner') return 'check'; // per Code verbunden: weiter ab „Stimmt das so?“
    if (B_STEPS.includes(saved)) return saved;
    return 'bname';
  }
  if (!myName()) return 'name';
  // Schon verbunden (z. B. gleichzeitig eingeladen worden): Partner-Schritt überspringen
  if (partnerJoined() && (!saved || saved === 'name' || saved === 'partner' || SUBSTEP[saved])) return 'tage';
  if (aSteps().includes(saved) || SUBSTEP[saved]) return saved === 'name' ? aSteps()[1] : saved;
  return aSteps()[1];
}

function setObStep(step) {
  const role = myRole();
  store.update((st) => (st.settings.obStep = { ...(st.settings.obStep ?? {}), [role]: step }));
}

const specialOf = (kind, who) => S().settings.specialDays.find((d) => d.kind === kind && (!who || d.who === who));
const relationOf = (st) => st.relationship ?? (specialOf('standesamt') || specialOf('hochzeit') ? 'verheiratet' : specialOf('hochzeit-geplant') ? 'verlobt' : 'zusammen');

/** Geburtstag: Tag und Monat, Jahr freiwillig. */
function bdayField(id, iso) {
  const [y, m, d] = String(iso || '').split('-');
  return `
    <div class="bday" role="group" aria-labelledby="${id}-l">
      <select class="input" id="${id}-d" aria-label="Tag"><option value="">Tag</option>${Array.from({ length: 31 }, (_, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === d ? 'selected' : ''}>${i + 1}.</option>`; }).join('')}</select>
      <select class="input" id="${id}-m" aria-label="Monat"><option value="">Monat</option>${MONTH_NAMES.map((n, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${v === m ? 'selected' : ''}>${n}</option>`; }).join('')}</select>
      <input class="input" id="${id}-y" inputmode="numeric" maxlength="4" placeholder="Jahr" aria-label="Jahr (freiwillig)" value="${y && y !== '0000' ? esc(y) : ''}">
    </div>`;
}
function readBday(id) {
  const d = $(`#${id}-d`)?.value;
  const m = $(`#${id}-m`)?.value;
  const y = $(`#${id}-y`)?.value.trim();
  if (!d || !m) return '';
  return `${/^(19|20)\d\d$/.test(y) ? y : '0000'}-${m}-${d}`;
}
const todayIsoStr = () => isoDate(today());
const fmtDay = (iso) => (iso ? fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric' }) : '–');

/* --- Bildschirme ----------------------------------------------------------------- */

function obHead(step, title, sub = '') {
  const flow = session.obForce ? null : obFlow();
  const counted = flow ? COUNTED[flow] : [];
  const base = SUBSTEP[step] ?? step;
  const idx = counted.indexOf(base);
  const steps = flow === 'b' ? B_STEPS : aSteps();
  const canBack = !session.obForce && steps.indexOf(base) > (flow === 'b' ? 0 : 0) && base !== 'fertig' && base !== 'verbunden' && !(flow === 'a' && base === 'name');
  return `
    <div class="ob-top">
      ${canBack || SUBSTEP[step] ? `<button type="button" class="icon-btn ob-back" data-ob-back aria-label="Zurück">${icon('left')}</button>` : '<span></span>'}
      ${idx >= 0 ? `<div class="ob-progress"><span class="kicker">Schritt ${idx + 1} von ${counted.length}</span><span class="ob-bar"><i style="width:${Math.round(((idx + 1) / counted.length) * 100)}%"></i></span></div>` : '<span></span>'}
    </div>
    <h1 class="ob-title">${title}</h1>
    ${sub ? `<p class="ob-sub">${sub}</p>` : ''}`;
}

function onboardingScreen(step) {
  const st = S().settings;
  const role = myRole();
  const pName = partnerName();
  const skip = (label = 'Überspringen') => (session.obForce ? '<button class="btn ghost" type="button" data-ob-cancel>Abbrechen</button>' : `<button class="linkish center" type="button" data-ob-skip>${label}</button>`);
  let body = '';

  if (step === 'name' || step === 'bname') {
    const pre = st[myNameKey(role)] ?? '';
    body = step === 'bname'
      ? `${obHead(step, pre ? `Bist du ${esc(pre)}?` : 'Wie heißt du?', pre ? 'So hat dich dein Lieblingsmensch eingetragen. Du kannst den Namen ändern.' : 'So begrüßt dich Datewell.')}
        <div class="field"><label class="label" for="ob-name">Dein Vorname</label><input class="input" id="ob-name" maxlength="30" value="${esc(pre)}" autocomplete="given-name" autocapitalize="words"></div>
        <div class="ob-actions"><button class="btn primary big" type="submit" id="ob-go" ${pre ? '' : 'disabled'}>${pre ? 'Ja, das bin ich' : 'Weiter'}</button></div>`
      : `${obHead(step, 'Wie heißt du?', 'So begrüßt dich Datewell.')}
        <div class="field"><label class="label" for="ob-name">Dein Vorname</label><input class="input" id="ob-name" maxlength="30" value="${esc(pre)}" placeholder="z. B. Julia" autocomplete="given-name" autocapitalize="words"></div>
        <div class="ob-actions"><button class="btn primary big" type="submit" id="ob-go" ${pre ? '' : 'disabled'}>Weiter</button></div>`;
  } else if (step === 'partner') {
    body = `
      ${obHead(step, 'Nutzt du Datewell mit jemandem?', 'Datewell ist für zwei gemacht. Ihr habt jeder ein eigenes Konto und plant gemeinsam.')}
      <div class="ob-choices">
        <button type="button" class="ob-choice main" data-ob-to="einladen">${icon('heart')}<span><strong>Partner einladen</strong><small>Code oder Link per Nachricht schicken</small></span>${icon('right')}</button>
        <button type="button" class="ob-choice" data-ob-to="code">${icon('users')}<span><strong>Mein Partner hat mich eingeladen</strong><small>Code eingeben</small></span>${icon('right')}</button>
      </div>
      <div class="ob-actions"><button type="button" class="linkish center" data-ob-alone>Erstmal allein umschauen</button></div>`;
  } else if (step === 'einladen') {
    const inv = partnerState.invite;
    body = `
      ${obHead(step, 'Wie heißt dein Lieblingsmensch?')}
      <div class="field"><label class="label" for="ob-pname">Vorname</label>
        <div class="row gap"><input class="input grow" id="ob-pname" maxlength="30" value="${esc(inv?.partner_name ?? pName)}" placeholder="z. B. Maxi" autocapitalize="words">
        ${inv ? '' : `<button type="button" class="btn" id="ob-mkinvite" ${pName ? '' : 'disabled'}>Einladen</button>`}</div></div>
      ${inv ? `
      <div class="invite-box">
        <span class="kicker">Dein Einladungscode</span>
        <strong class="invite-code">${esc(inv.code)}</strong>
        <small class="muted">Gültig bis ${esc(fmtExpiry(inv.expires_at))} · nur einmal verwendbar</small>
        <button type="button" class="btn primary" id="ob-share">${icon('share')}Einladung teilen</button>
        <button type="button" class="btn ghost" id="ob-copy">Code kopieren</button>
      </div>` : ''}
      <div class="ob-actions">
        ${inv ? '<button class="btn big" type="submit">Weiter</button>' : ''}
        <button type="button" class="linkish center" data-ob-later>Später einladen</button>
      </div>`;
  } else if (step === 'code') {
    body = `
      ${obHead(step, 'Gib den Code ein, den du bekommen hast')}
      <div class="field"><label class="label" for="ob-code">Einladungscode</label>
        <input class="input code-input" id="ob-code" value="DW-" autocapitalize="characters" autocomplete="one-time-code" spellcheck="false" maxlength="12"></div>
      <button type="button" class="linkish small" id="ob-paste">Aus der Zwischenablage einfügen</button>
      <p class="warn-text" id="ob-code-err" role="alert" hidden></p>
      <div class="ob-actions"><button class="btn primary big" type="submit">Verbinden</button></div>`;
  } else if (step === 'tage' || step === 'check') {
    const paired = step === 'check' || partnerJoined() || !!partnerState.invite;
    const rel = session.obRel ?? relationOf(st);
    const wed = rel === 'verheiratet' ? specialOf('hochzeit')?.date ?? specialOf('standesamt')?.date ?? '' : '';
    const planned = specialOf('hochzeit-geplant')?.date ?? '';
    const me = specialOf('geburtstag', role)?.date ?? '';
    const ji = step === 'check' ? joinInfo() : null;
    const conflicts = step === 'check' ? joinConflicts(ji) : [];
    const hasPair = !!(st.anniversary || st.relationship || wed || planned);
    if (step === 'check' && hasPair && !session.obEditPair) {
      const rows = [
        ['Ihr seid', REL_OPTS.find(([v]) => v === rel)?.[1] ?? 'Zusammen'],
        ['Zusammen seit', fmtDay(st.anniversary)],
        ...(rel === 'verheiratet' ? [['Euer Hochzeitstag', fmtDay(wed)]] : rel === 'verlobt' ? [['Wann heiratet ihr?', planned ? fmtDay(planned) : 'noch offen']] : []),
      ];
      body = `
        ${obHead(step, conflicts.length ? 'Kurz abstimmen' : 'Stimmt das so?', conflicts.length ? '' : `${esc(pName || 'Dein Lieblingsmensch')} hat schon eingetragen:`)}
        ${conflicts.length ? conflicts.map((c, k) => `
          <div class="field conflict"><span class="label">${esc(c.label)}</span>
            <p class="small">${esc(pName || 'Dein Partner')} hat ${esc(c.theirsText)} eingetragen, du ${esc(c.mineText)}. Welcher stimmt?</p>
            ${chips(`ob-cf-${k}`, [['theirs', c.theirsText], ['mine', c.mineText]], 'theirs', 'seg')}</div>`).join('') : `
        <ul class="ob-pairdata">${rows.map(([l, v]) => `<li><button type="button" data-ob-editpair><span class="muted small">${esc(l)}</span><strong>${esc(v)}</strong>${icon('right')}</button></li>`).join('')}</ul>`}
        <div class="field"><span class="label" id="ob-bday-l">Dein Geburtstag</span>${bdayField('ob-bday', me)}</div>
        <div class="ob-actions"><button class="btn primary big" type="submit">Passt so</button></div>`;
    } else {
      const maxToday = todayIsoStr();
      body = paired ? `
        ${obHead(step, 'Eure besonderen Tage', 'Datewell erinnert euch rechtzeitig und schlägt dann besondere Dates vor. Alles ist freiwillig.')}
        <div class="field"><span class="label">Ihr seid</span>${chips('ob-rel', REL_OPTS, rel, 'seg')}</div>
        <div class="field"><label class="label" for="ob-anniv">Zusammen seit</label><input class="input" type="date" id="ob-anniv" max="${maxToday}" value="${esc(st.anniversary ?? '')}"></div>
        <div class="field" data-rel="verlobt" ${rel === 'verlobt' ? '' : 'hidden'}><label class="label" for="ob-geplant">Wann heiratet ihr? <small class="muted">(freiwillig)</small></label><input class="input" type="date" id="ob-geplant" min="${maxToday}" value="${esc(planned)}"></div>
        <div class="field" data-rel="verheiratet" ${rel === 'verheiratet' ? '' : 'hidden'}><label class="label" for="ob-hochzeit">Euer Hochzeitstag</label><input class="input" type="date" id="ob-hochzeit" max="${maxToday}" value="${esc(wed)}"></div>
        <div class="field"><span class="label" id="ob-bday-l">Dein Geburtstag</span>${bdayField('ob-bday', me)}</div>
        <div class="ob-actions"><button class="btn primary big" type="submit">Weiter</button>${step === 'check' ? '' : skip()}</div>`
        : `
        ${obHead(step, 'Wann hast du Geburtstag?', 'Datewell denkt rechtzeitig daran. Das Jahr ist freiwillig.')}
        <div class="field"><span class="label" id="ob-bday-l">Dein Geburtstag</span>${bdayField('ob-bday', me)}</div>
        <div class="ob-actions"><button class="btn primary big" type="submit">Weiter</button>${skip()}</div>`;
    }
  } else if (step === 'vorlieben') {
    const p = st.prefs?.[role] ?? {};
    const paired = partnerJoined() || !!partnerState.invite;
    body = `
      ${obHead(step, 'Was gefällt dir bei Dates?', `Deine Antworten helfen Datewell, passende Ideen für euch zu finden.${paired && pName ? ` ${esc(pName)} beantwortet das auf dem eigenen Handy.` : ''}`)}
      <div class="field"><span class="label">Worauf hast du am meisten Lust? <small class="muted">(bis zu 4)</small></span>
        <div class="chips" id="ob-moods">${MOODS.map(([v, l]) => `<button type="button" class="chip" data-m="${v}" aria-pressed="${(p.moods ?? []).includes(v)}">${l}</button>`).join('')}</div>
        <small class="muted" id="ob-moods-hint" hidden>Du kannst bis zu 4 auswählen.</small></div>
      <div class="field"><span class="label">Lieber drinnen oder draußen?</span>${chips('ob-place', [['drinnen', 'Drinnen', 'home'], ['draußen', 'Draußen', 'sun'], ['egal', 'Beides']], p.place ?? 'egal', 'seg')}</div>
      <div class="field"><span class="label">Wie isst du?</span>${chips('ob-diet', PREF_DIET, p.diet ?? 'alles', 'seg')}</div>
      <div class="field">
        <div class="label-row"><span class="label">Typisches Budget für ein Date (zu zweit)</span><output id="ob-budget-out" class="budget-out">${budgetLabel(p.budget ?? 50)}</output></div>
        <input type="range" id="ob-budget" min="0" max="200" step="10" value="${p.budget ?? 50}" aria-label="Budget in Euro">
        <div class="scale"><span>0 €</span><span>50</span><span>100</span><span>150</span><span>200 €+</span></div>
      </div>
      <div class="ob-actions"><button class="btn primary big" type="submit">${session.obForce ? 'Speichern' : 'Weiter'}</button>${skip()}</div>`;
  } else if (step === 'rechte') {
    const pushOn = !!L().push?.on;
    const pushState = session.permPush ?? (pushOn ? 'ok' : '');
    const geoState = session.permGeo ?? (L().geo ? 'ok' : '');
    const status = (s) => (s === 'ok' ? `<span class="perm-ok">${icon('check')}Erlaubt</span>` : s ? `<span class="muted small">${esc(s)}</span>` : '');
    body = `
      ${obHead(step, 'Fast geschafft')}
      <article class="perm-card">
        <span class="perm-ico" aria-hidden="true">🔔</span>
        <div class="grow"><strong>Mitteilungen</strong><p class="small">Wir sagen euch Bescheid, wenn es Zeit für euer nächstes Date ist – und denken an euren Jahrestag.</p>
          ${pushState ? status(pushState) : '<button type="button" class="btn sm primary" id="ob-push">Mitteilungen erlauben</button>'}</div>
      </article>
      <article class="perm-card">
        <span class="perm-ico" aria-hidden="true">📍</span>
        <div class="grow"><strong>Standort</strong><p class="small">So finden wir die schönsten Ideen ganz in eurer Nähe – nur, während du Datewell nutzt.</p>
          ${geoState ? status(geoState) : '<button type="button" class="btn sm primary" id="ob-geo">Standort erlauben</button>'}</div>
      </article>
      <div class="ob-actions"><button class="btn primary big" type="submit">Fertig</button><button class="linkish center" type="button" data-ob-skip>Später</button></div>`;
  } else if (step === 'fertig') {
    body = `
      <div class="ob-moment" data-ob-next>
        ${icon('rings', 'brand-mark big')}
        <h1 class="ob-title">Willkommen bei Datewell, ${esc(myName())}.</h1>
      </div>`;
  } else if (step === 'verbunden') {
    body = `
      <div class="ob-moment">
        <span class="rings-anim" aria-hidden="true"><i></i><i></i></span>
        <h1 class="ob-title">Ihr seid verbunden.</h1>
        <p class="oclock"><b>It’s date</b> <i>o’clock.</i></p>
        <button class="btn primary big" type="submit">Los geht’s</button>
      </div>`;
  }
  return `
    <section class="ob-screen">
      <form class="form ob-form" id="ob-form" data-step="${step}" novalidate>${body}</form>
    </section>`;
}

/** Abweichende Paar-Daten zwischen dem eigenen Allein-Konto und dem des Partners. */
function joinConflicts(ji) {
  const old = ji?.oldSettings;
  if (!old) return [];
  const st = S().settings;
  const out = [];
  const oldDay = (kind) => (old.specialDays ?? []).find((d) => d.kind === kind)?.date ?? '';
  const add = (key, label, mine, theirs, fmt) => {
    if (mine && theirs && mine !== theirs) out.push({ key, label, mine, theirs, mineText: fmt(mine), theirsText: fmt(theirs) });
  };
  add('anniversary', 'Zusammen seit', old.anniversary, st.anniversary, (v) => `den ${fmtDate(v, { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
  add('relationship', 'Ihr seid', old.relationship, st.relationship, (v) => `„${REL_OPTS.find(([x]) => x === v)?.[1] ?? v}“`);
  add('hochzeit', 'Hochzeitstag', oldDay('hochzeit'), specialOf('hochzeit')?.date ?? '', (v) => `den ${fmtDate(v, { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
  add('hochzeit-geplant', 'Hochzeitsdatum', oldDay('hochzeit-geplant'), specialOf('hochzeit-geplant')?.date ?? '', (v) => `den ${fmtDate(v, { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
  return out;
}

RENDER.onboarding = () => {
  const step = onboardingStep();
  root.innerHTML = onboardingScreen(step);
  bindOnboarding();
};

function bindOnboarding() {
  const form = $('#ob-form');
  if (!form) return;
  const step = form.dataset.step;
  const role = myRole();
  const flow = obFlow();
  const steps = flow === 'b' ? B_STEPS : aSteps();
  const finish = () => {
    store.update((st) => {
      st.settings.onboarded = { ...(st.settings.onboarded ?? {}), [role]: true };
      if (st.settings.obStep) delete st.settings.obStep[role];
    });
    setJoinInfo(null);
    session.obRel = null;
    session.obEditPair = false;
    go('start', null, { replace: true });
    render(true);
  };
  const goStep = (s) => {
    if (session.obForce) {
      session.obForce = null;
      toast('Gespeichert');
      return go('mehr', null, { replace: true });
    }
    if (s === 'done') return finish();
    setObStep(s);
    render(true);
  };
  const next = () => {
    const base = SUBSTEP[step] ?? step;
    const i = steps.indexOf(base);
    goStep(i < 0 || i >= steps.length - 1 ? 'done' : steps[i + 1]);
  };
  $$('[data-ob-skip]', form).forEach((b) => b.addEventListener('click', next));
  $('[data-ob-cancel]', form)?.addEventListener('click', () => {
    session.obForce = null;
    go('mehr', null, { replace: true });
  });
  $('[data-ob-back]', form)?.addEventListener('click', () => {
    if (SUBSTEP[step]) return goStep(SUBSTEP[step]);
    const i = steps.indexOf(step);
    let prev = steps[Math.max(0, i - 1)];
    if (flow === 'a' && prev === 'name') prev = 'name';
    goStep(prev);
  });

  // Name
  if (step === 'name' || step === 'bname') {
    const inp = $('#ob-name');
    inp.addEventListener('input', () => ($('#ob-go').disabled = !inp.value.trim()));
    if (!inp.value) inp.focus();
  }
  // Partner-Auswahl
  on('[data-ob-to]', 'click', (_, el) => goStep(el.dataset.obTo));
  $('[data-ob-alone]', form)?.addEventListener('click', () => goStep('tage'));
  // Einladen
  if (step === 'einladen') {
    const inp = $('#ob-pname');
    const savePName = () => {
      const v = inp.value.trim();
      if (v) store.update((st) => (st.settings[myNameKey(other(role))] = v));
    };
    inp.addEventListener('input', () => $('#ob-mkinvite') && ($('#ob-mkinvite').disabled = !inp.value.trim()));
    $('#ob-mkinvite')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      const v = inp.value.trim();
      if (!v) return toast('Wie heißt dein Lieblingsmensch?');
      savePName();
      try {
        partnerState.invite = await partnerState.api.create(v);
        render();
      } catch (err) {
        toast(err.message);
      }
    }));
    $('#ob-share')?.addEventListener('click', () => shareInvite(partnerState.invite));
    $('#ob-copy')?.addEventListener('click', () => copyCode(partnerState.invite.code));
    $('[data-ob-later]', form).addEventListener('click', () => {
      savePName();
      goStep('tage');
    });
  }
  // Code eingeben
  if (step === 'code') {
    const inp = $('#ob-code');
    inp.addEventListener('input', () => {
      const pos = inp.value;
      inp.value = normCode(pos).slice(0, 12);
      $('#ob-code-err').hidden = true;
    });
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    $('#ob-paste').addEventListener('click', async () => {
      try {
        const t = await navigator.clipboard.readText();
        const m = t.match(/DW-?[A-Z0-9]{4,8}/i);
        inp.value = normCode(m ? m[0] : t).slice(0, 12);
      } catch {
        toast('Einfügen ist hier nicht erlaubt – bitte von Hand eintippen');
      }
    });
  }
  // Besondere Tage
  if (step === 'tage' || step === 'check') {
    bindChips(form, 'ob-rel', (v) => {
      session.obRel = v;
      $$('[data-rel]', form).forEach((el) => (el.hidden = el.dataset.rel !== v));
    });
    on('[data-ob-editpair]', 'click', () => {
      session.obEditPair = true;
      render();
    });
  }
  // Vorlieben
  const moods = new Set(S().settings.prefs?.[role]?.moods ?? []);
  const prefs = { place: S().settings.prefs?.[role]?.place ?? 'egal', diet: S().settings.prefs?.[role]?.diet ?? 'alles', budget: S().settings.prefs?.[role]?.budget ?? 50 };
  if (step === 'vorlieben') {
    $('#ob-moods').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const v = b.dataset.m;
      if (moods.has(v)) moods.delete(v);
      else if (moods.size < 4) moods.add(v);
      else $('#ob-moods-hint').hidden = false;
      b.setAttribute('aria-pressed', String(moods.has(v)));
    });
    bindChips(form, 'ob-place', (v) => (prefs.place = v));
    bindChips(form, 'ob-diet', (v) => (prefs.diet = v));
    $('#ob-budget').addEventListener('input', (e) => {
      prefs.budget = Number(e.target.value);
      $('#ob-budget-out').textContent = budgetLabel(prefs.budget);
    });
  }
  // Berechtigungen – die Systemabfrage kommt erst nach unserer Erklärung und dem Tippen
  if (step === 'rechte') {
    $('#ob-push')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try {
        await enablePush();
        session.permPush = 'ok';
      } catch (err) {
        session.permPush = /nicht erlaubt/.test(err.message) ? 'Nicht erlaubt – änderbar in den Einstellungen' : err.message;
      }
      render();
    }));
    $('#ob-geo')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try {
        await useGps();
        session.permGeo = 'ok';
      } catch {
        session.permGeo = 'Nicht erlaubt – änderbar in den Einstellungen';
      }
      render();
    }));
  }
  // Abschluss-Moment: nach 1,5 Sekunden oder per Tippen weiter
  if (step === 'fertig') {
    const t = setTimeout(finish, 1600);
    $('[data-ob-next]', form).addEventListener('click', () => {
      clearTimeout(t);
      finish();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (step === 'name' || step === 'bname') {
      const n = $('#ob-name').value.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase());
      if (!n) return $('#ob-name').focus();
      store.update((st) => (st.settings[myNameKey(role)] = n));
      return next();
    }
    if (step === 'einladen') return goStep('tage');
    if (step === 'code') {
      const code = normCode($('#ob-code').value);
      const err = $('#ob-code-err');
      const btn = e.submitter ?? $('#ob-form button[type=submit]');
      return withBusy(btn, async () => {
        try {
          const res = await partnerState.api.accept(code);
          if (res.error) {
            err.textContent = res.error;
            err.hidden = false;
            return;
          }
          if (res.old_settings) setJoinInfo({ oldSettings: res.old_settings, oldRole: res.old_role, inviter: res.inviter });
          // Neu verbinden: ab jetzt das gemeinsame Konto
          const c = getConfig();
          saveConfig({ url: c.url, key: c.key, coupleId: res.couple_id });
          location.replace(location.pathname); // neu laden, zur Startseite
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
    }
    if (step === 'tage' || step === 'check') {
      const rel = session.obRel ?? relationOf(S().settings);
      const v = (id) => $(`#${id}`)?.value ?? '';
      const bday = readBday('ob-bday');
      const conflicts = step === 'check' && !session.obEditPair ? joinConflicts(joinInfo()) : [];
      const before = JSON.stringify([S().settings.anniversary, S().settings.relationship, specialOf('hochzeit')?.date, specialOf('hochzeit-geplant')?.date]);
      store.update((st) => {
        const setDay = (kind, who, date) => {
          const id = `sp-${kind}${who ? `-${who}` : ''}`;
          st.settings.specialDays = st.settings.specialDays.filter((d) => d.id !== id && !(d.kind === kind && (!who || d.who === who)));
          if (date) st.settings.specialDays.push({ id, kind, who: who ?? null, name: '', date });
        };
        if ($('#ob-anniv') || $('[data-group="ob-rel"]')) {
          st.settings.relationship = rel;
          st.settings.anniversary = v('ob-anniv') || (step === 'check' ? st.settings.anniversary : '') || '';
          setDay('hochzeit-geplant', null, rel === 'verlobt' ? v('ob-geplant') : '');
          if (rel === 'verheiratet') {
            setDay('hochzeit', null, v('ob-hochzeit'));
          } else {
            setDay('hochzeit', null, '');
            setDay('standesamt', null, '');
          }
        }
        conflicts.forEach((c, k) => {
          const pick = $(`[data-group="ob-cf-${k}"] [aria-pressed="true"]`)?.dataset.value ?? 'theirs';
          if (pick !== 'mine') return;
          if (c.key === 'anniversary' || c.key === 'relationship') st.settings[c.key] = c.mine;
          else setDay(c.key, null, c.mine);
        });
        if (bday) setDay('geburtstag', role, bday);
      });
      // Ändert die eingeladene Person Paar-Daten, bekommt die andere einen dezenten Hinweis in der App
      const after = JSON.stringify([S().settings.anniversary, S().settings.relationship, specialOf('hochzeit')?.date, specialOf('hochzeit-geplant')?.date]);
      if (step === 'check' && before !== after && partnerJoined()) {
        store.update((st) => (st.settings.pairNotice = { by: role, at: Date.now(), text: `${myName() || 'Dein Partner'} hat eure besonderen Tage aktualisiert.` }));
      }
      session.obRel = null;
      session.obEditPair = false;
      setJoinInfo(null);
      return next();
    }
    if (step === 'vorlieben') {
      store.update((st) => {
        st.settings.prefs = { ...(st.settings.prefs ?? {}), [role]: { moods: [...moods], ...prefs } };
        if (prefs.diet === 'vegan') st.settings.vegan = true;
      });
      L().lastSearch.budget = prefs.budget;
      store.saveLocal();
      return next();
    }
    if (step === 'rechte') return next();
    if (step === 'verbunden') return finish();
  });
}

/* --- Einladen, Code eingeben, Trennen (außerhalb des Einstiegs) ---------------- */

RENDER.einladen = () => {
  const inv = partnerState.invite;
  const p = partnerName();
  if (partnerJoined()) return go('mehr', null, { replace: true });
  root.innerHTML = `
    ${topbar({ title: inv ? `${esc(inv.partner_name || p || 'Dein Lieblingsmensch')} einladen` : 'Lieblingsmensch einladen', back: ['mehr', '', 'Einstellungen'] })}
    <section class="panel form">
      <div class="field"><label class="label" for="iv-name">Wie heißt dein Lieblingsmensch?</label>
        <input class="input" id="iv-name" maxlength="30" value="${esc(inv?.partner_name ?? p)}" placeholder="z. B. Maxi" autocapitalize="words"></div>
      ${inv ? `
      <div class="invite-box">
        <span class="kicker">Einladungscode</span>
        <strong class="invite-code">${esc(inv.code)}</strong>
        <small class="muted">Gültig bis ${esc(fmtExpiry(inv.expires_at))} · nur einmal verwendbar</small>
        <button type="button" class="btn primary" id="iv-share">${icon('share')}Einladung teilen</button>
        <button type="button" class="btn ghost" id="iv-copy">Code kopieren</button>
      </div>
      <button type="button" class="btn ghost" id="iv-rename">Name ändern (neuer Code)</button>
      <button type="button" class="btn ghost danger" id="iv-revoke">Einladung zurückziehen</button>` : `
      <button type="button" class="btn primary big" id="iv-create">${icon('heart')}Einladung erstellen</button>`}
    </section>`;
  bindBack();
  const nameVal = () => $('#iv-name').value.trim();
  const create = (btn) => withBusy(btn, async () => {
    if (!nameVal()) return toast('Wie heißt dein Lieblingsmensch?');
    store.update((st) => (st.settings[myNameKey(other(myRole()))] = nameVal()));
    try {
      partnerState.invite = await partnerState.api.create(nameVal());
      render();
      shareInvite(partnerState.invite);
    } catch (err) {
      toast(err.message);
    }
  });
  $('#iv-create')?.addEventListener('click', (e) => create(e.currentTarget));
  $('#iv-rename')?.addEventListener('click', (e) => create(e.currentTarget));
  $('#iv-share')?.addEventListener('click', () => shareInvite(inv));
  $('#iv-copy')?.addEventListener('click', () => copyCode(inv.code));
  $('#iv-revoke') && armed($('#iv-revoke'), async () => {
    try {
      await partnerState.api.revoke();
      partnerState.invite = null;
      toast('Einladung zurückgezogen');
      go('mehr', null, { replace: true });
    } catch (err) {
      toast(err.message);
    }
  }, 'Nochmal tippen: Einladung zurückziehen');
};

RENDER.code = () => {
  root.innerHTML = `
    ${topbar({ title: 'Ich habe einen Code', back: ['mehr', '', 'Einstellungen'] })}
    <form class="panel form" id="cd-form" novalidate>
      <div class="field"><label class="label" for="cd-code">Gib den Code ein, den du bekommen hast</label>
        <input class="input code-input" id="cd-code" value="DW-" autocapitalize="characters" spellcheck="false" maxlength="12"></div>
      <p class="warn-text" id="cd-err" role="alert" hidden></p>
      <button class="btn primary big" type="submit">Verbinden</button>
      <small class="muted">Deine eigenen Ideen, Merkliste und Dates nimmst du mit.</small>
    </form>`;
  bindBack();
  const inp = $('#cd-code');
  inp.addEventListener('input', () => {
    inp.value = normCode(inp.value).slice(0, 12);
    $('#cd-err').hidden = true;
  });
  $('#cd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      try {
        const res = await partnerState.api.accept(inp.value);
        if (res.error) {
          $('#cd-err').textContent = res.error;
          $('#cd-err').hidden = false;
          return;
        }
        if (res.old_settings) setJoinInfo({ oldSettings: res.old_settings, oldRole: res.old_role, inviter: res.inviter });
        const c = getConfig();
        saveConfig({ url: c.url, key: c.key, coupleId: res.couple_id });
        session.justJoined = true;
        location.replace(location.pathname); // neu laden, zur Startseite
      } catch (err) {
        $('#cd-err').textContent = err.message;
        $('#cd-err').hidden = false;
      }
    });
  });
};

RENDER.trennen = () => {
  const p = partnerName() || 'deinem Partner';
  if (!partnerJoined()) return go('mehr', null, { replace: true });
  root.innerHTML = `
    ${topbar({ title: 'Verbindung trennen', back: ['mehr', '', 'Einstellungen'] })}
    <section class="panel form">
      <p>Wenn du die Verbindung mit ${esc(p)} trennst, könnt ihr nicht mehr gemeinsam planen. Das passiert mit euren Daten:</p>
      <ul class="trenn-list">
        <li><strong>Vergangene Dates, Erinnerungen, Fotos:</strong> Ihr behaltet beide eine Kopie (Archiv, nur lesbar).</li>
        <li><strong>Geplante Dates:</strong> bleiben bei der Person, die sie geplant hat.</li>
        <li><strong>Eigene Ideen und Merkliste:</strong> bleiben bei der Person, die sie erstellt hat.</li>
        <li><strong>Versteckte Dates und Ausgaben:</strong> bleiben bei dir bzw. ${esc(p)}.</li>
        <li><strong>Kostenausgleich:</strong> wird mit dem aktuellen Stand abgeschlossen und bleibt lesbar.</li>
        <li><strong>Jahrestag und Beziehungsstatus:</strong> werden in beiden Konten gelöscht.</li>
        <li><strong>Geteilte Community-Dates unter eurem Paarnamen:</strong> erscheinen wieder unter dem Vornamen.</li>
      </ul>
      <p class="muted small">${esc(p)} bekommt keinen Push, sieht aber beim nächsten Öffnen einen neutralen Hinweis. Ihr könnt euch später wieder verbinden.</p>
      <div class="field"><label class="label" for="tr-word">Zum Bestätigen „TRENNEN“ eintippen</label><input class="input" id="tr-word" autocapitalize="characters" autocomplete="off"></div>
      <button type="button" class="btn danger big" id="tr-go" disabled>Endgültig trennen</button>
    </section>`;
  bindBack();
  const w = $('#tr-word');
  w.addEventListener('input', () => ($('#tr-go').disabled = w.value.trim().toUpperCase() !== 'TRENNEN'));
  $('#tr-go').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const n = await partnerState.api.disconnect();
      const c = getConfig();
      saveConfig({ url: c.url, key: c.key, coupleId: n });
      store.clearDeviceData();
      location.replace(location.pathname); // neu laden, zur Startseite
    } catch (err) {
      toast(err.message);
    }
  }));
};

/* ================================================================ 1. Start */

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Schöne Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Schöne Nacht';
}

/* --- Rundum-Service: Vorbereitung und Begleiter am Date-Tag ---------------- */

/** Was vor dem Date zu tun ist – automatisch aus dem Plan abgeleitet. */
function prepTasks(plan) {
  const out = [];
  const add = (text, href = '', label = '') => out.some((x) => x.text === text) || out.push({ text, href, label });
  const firstTravel = plan.steps.find((x) => /^anfahrt/i.test(x.title ?? ''));
  const firstPlace = plan.steps.find((x) => x.place?.lat != null)?.place;
  if (firstTravel && firstPlace) add(`Um ${firstTravel.time} Uhr losfahren`, directionsLink(firstPlace, /zu fuß/i.test(firstTravel.note ?? '') ? 'walking' : 'driving'), 'Route');
  for (const st of plan.steps) {
    const p = st.place;
    if (!p) continue;
    const food = st.links?.some((l) => l.label === 'Reservieren') || ['restaurant', 'finedining', 'tapas', 'burger', 'brunch'].includes(p.category);
    if (food) {
      const res = p.reservationUrl || p.website || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.street ?? ''} reservieren`)}`;
      add(`Tisch für ${st.time} Uhr reservieren: ${p.name}`, res, p.reservationUrl ? 'Reservieren' : p.website ? 'Webseite' : 'Suchen');
    }
    if (['escape', 'cooking', 'pottery', 'theatre', 'bowling', 'spa', 'arcade', 'blacklight'].includes(p.category)) {
      add(`${['spa'].includes(p.category) ? 'Eintritt & Öffnungszeiten prüfen' : 'Termin buchen'}: ${p.name}`, p.website || mapLink(p), p.website ? 'Webseite' : 'Karte');
    }
  }
  for (const t of plan.todos ?? []) add(t);
  const w = plan.weather;
  if (w?.temp != null && w.temp <= 5) add(`Warm anziehen – um die ${w.temp} °`);
  if (w?.label && /regen|schauer|gewitter/i.test(w.label)) add('Regenschirm einpacken');
  for (const x of plan.recipe?.ingredients ?? []) add(`Besorgen: ${x}`);
  return out;
}

function prepPanel(plan, checks, attr, title) {
  const tasks = prepTasks(plan);
  if (!tasks.length) return '';
  const done = tasks.filter((t) => checks?.[t.text]).length;
  return `
    <section class="panel prep">
      <div class="panel-head">${icon('check')}<h2>${title}</h2><span class="prep-count">${done}/${tasks.length}</span></div>
      <ul class="items">
        ${tasks.map((t) => `
          <li class="item ${checks?.[t.text] ? 'done' : ''}">
            <label class="check"><input type="checkbox" ${attr}="${esc(t.text)}" ${checks?.[t.text] ? 'checked' : ''}><span class="grow">${esc(t.text)}</span></label>
            ${t.href ? `<a class="link sm" href="${esc(t.href)}" target="_blank" rel="noopener">${esc(t.label || 'Öffnen')}${icon('external')}</a>` : ''}
          </li>`).join('')}
      </ul>
    </section>`;
}

/** Karte auf der Startseite: heute oder morgen ist Date-Tag. */
function dateDayCard() {
  const t = isoDate(today());
  const tm = isoDate(addDays(today(), 1));
  const d = S().dates.filter((x) => (x.date === t || x.date === tm) && !dateIsOver(x)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  if (!d) return '';
  const when = d.date === t ? 'Heute' : 'Morgen';
  if (isHiddenFromMe(d)) {
    return `
      <article class="dateday">
        <p class="eyebrow">${when}, ${esc(d.start)} Uhr</p>
        <h2>Überraschung von ${esc(nameOf(d.plannedBy))}</h2>
        ${d.hint ? `<p class="muted">Hinweis: „${esc(d.hint)}“</p>` : '<p class="muted">Lass dich überraschen.</p>'}
      </article>`;
  }
  const plan = fullPlan(d);
  if (!plan) return '';
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = d.date === t ? plan.steps.find((x, i) => (plan.steps[i + 1]?.time ?? plan.end) > hhmm && !/^(weg|anfahrt)/i.test(x.title)) : null;
  const tasks = prepTasks(plan);
  const checks = d.surprise ? S().secrets[d.id]?.checks : d.checks;
  const open = tasks.filter((x) => !checks?.[x.text]).length;
  const target = (next ?? plan.steps.find((x) => x.place))?.place;
  return `
    <article class="dateday">
      <p class="eyebrow">${when}, ${esc(plan.start)}–${esc(plan.end)} Uhr</p>
      <h2>${esc(plan.title)}</h2>
      ${next ? `<p class="dd-next">${icon('clock')}<span>Als Nächstes · <strong>${esc(next.time)}</strong> ${esc(next.title)}</span></p>` : ''}
      ${open ? `<p class="muted small">${open} ${open === 1 ? 'Sache' : 'Sachen'} noch vorzubereiten</p>` : tasks.length ? `<p class="muted small">${icon('check', 'inline')} Alles vorbereitet</p>` : ''}
      <div class="row gap">
        <button class="btn primary sm" data-open-date="${d.id}">${d.date === t ? 'Zum Date' : 'Vorbereiten'}</button>
        ${target?.lat != null ? `<a class="btn sm" href="${esc(directionsLink(target, 'driving'))}" target="_blank" rel="noopener">${icon('route')}Route</a>` : ''}
      </div>
    </article>`;
}

function inboxItems() {
  const s = S();
  const role = myRole();
  const t = isoDate(today());
  const items = [];
  const rs = rhythmStatus(s.dates, s.settings.datesPerMonth);
  const turn = nextPlanner();
  const openReq = s.requests.some((x) => x.status === 'open');
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

  for (const p of s.polls.filter((x) => x.status === 'open' && x.kind === 'swipe')) {
    const m = matchState(p);
    const label = m.matches.length ? `${m.matches.length} ${m.matches.length === 1 ? 'Match' : 'Matches'} – jetzt planen` : !m.mineDone ? `${p.createdBy === role ? 'Wisch weiter' : `${esc(nameOf(p.createdBy))} hat gestartet – wisch mit`} (${m.mine}/${p.deck.length})` : `Warte auf ${esc(nameOf(other(role)))} (${m.theirs}/${p.deck.length})`;
    items.push(`
      <article class="inbox-item ${!m.mineDone || m.matches.length ? 'accent' : ''}">
        <div class="inbox-ico">${icon('heart')}</div>
        <div class="grow"><strong>Date-Match für ${relDay(p.ctx.date) ?? fmtShort(p.ctx.date)}</strong><p>${label}</p></div>
        <button class="btn ${!m.mineDone || m.matches.length ? 'primary' : ''} sm" data-open-poll="${p.id}">${!m.mineDone ? 'Wischen' : 'Öffnen'}</button>
      </article>`);
  }

  for (const p of s.polls.filter((x) => x.status === 'open' && x.stage !== 'survey' && x.kind !== 'swipe')) {
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
        <div class="grow"><strong>Wie war „${esc(dateTitle(d))}“?</strong><p>${relDay(d.date) ?? fmtShort(d.date)} · Bewertet euer Date – Datewell lernt, was euch gefällt.</p></div>
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
  for (const u of session.reportUpdates ?? []) {
    items.push(`
      <article class="inbox-item">
        <div class="inbox-ico">${icon('check')}</div>
        <div class="grow"><strong>Danke für deine Meldung</strong><p>${u.outcome === 'keep' ? `Wir haben „${esc(u.title ?? 'das Date')}“ geprüft und keinen Verstoß gefunden.` : `Wir haben „${esc(u.title ?? 'das Date')}“ geprüft und entfernt.`}</p></div>
        <button class="btn sm ghost" data-report-seen="${u.id}">OK</button>
      </article>`);
  }
  if (session.modOpen > 0) {
    items.push(`
      <article class="inbox-item">
        <div class="inbox-ico">${icon('check')}</div>
        <div class="grow"><strong>${session.modOpen} offene Meldung${session.modOpen === 1 ? '' : 'en'}</strong><p>In der Community wurde etwas gemeldet. Bitte zeitnah prüfen.</p></div>
        <button class="btn sm" data-go="moderation">Prüfen</button>
      </article>`);
  }
  if (pairConsentPending()) {
    const pp = pairName();
    items.push(`
      <article class="inbox-item accent">
        <div class="inbox-ico">${icon('users')}</div>
        <div class="grow">
          <strong>Paarname für die Community?</strong>
          <p>${esc(nameOf(pp.proposedBy))} möchte geteilte Dates als „${esc(pp.name)}“ zeigen. Das geht nur, wenn du einverstanden bist.</p>
          <div class="row gap"><button class="btn primary sm" data-pair-consent="1">Einverstanden</button><button class="btn ghost sm" data-pair-consent="0">Lieber nicht</button></div>
        </div>
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

RENDER.neu = () => RENDER.start();

RENDER.start = () => {
  const planMode = current.name === 'neu';
  kickArea();
  const s = S();
  const f = { ...L().lastSearch };
  const role = myRole();
  const partner = other(role);
  const r = rhythmStatus(s.dates, s.settings.datesPerMonth);
  const pct = Math.min(100, Math.round((r.thisMonth / r.goal) * 100));
  // Für Moderator:innen: offene Meldungen einmal pro Sitzung prüfen
  if (community.api && session.reportUpdates === undefined) {
    session.reportUpdates = [];
    community.api.reportUpdates().then((l) => {
      session.reportUpdates = l;
      if (l.length && current.name === 'start') render();
    }).catch(() => {});
  }
  if (community.api && session.modChecked === undefined) {
    session.modChecked = false;
    community.api.isModerator().then(async (yes) => {
      if (!yes) return;
      session.modOpen = (await community.api.queue().catch(() => [])).length;
      if (session.modOpen && current.name === 'start') render();
    });
  }
  const inbox = inboxItems();
  const hasNames = s.settings.nameA || s.settings.nameB;
  const np = nextPlanner();
  // „Wer plant?“ folgt der Reihe, bis jemand selbst etwas anderes wählt.
  if (!session.plannerTouched && role) f.planner = np === role ? 'me' : 'partner';
  if (pairLocked()) f.planner = 'me';

  const turnMine = np === role;
  const homeHTML = `
    <header class="home-head">
      <div class="brand">${icon('rings', 'brand-mark')}<span class="logo">Date<i>well</i></span></div>
      <div class="row gap">${syncChip()}${settingsButton()}</div>
    </header>
    <section class="hello">
      <p class="eyebrow">${(store.syncInfo().backend === 'supabase' ? partnerJoined() : hasNames) ? `${esc(nameOf('a'))} & ${esc(nameOf('b'))}` : 'Zeit zu zweit'}</p>
      <h1>${role && S().settings[myNameKey(role)]?.trim() ? `${greeting()}, ${esc(nameOf(role))}.` : 'Willkommen bei Datewell.'}</h1>
    </section>

    ${whoAmICard()}
    ${inviteCard()}
    ${dateDayCard()}
    ${myRole() ? `<button type="button" class="oclock-cta" data-go-neu><span><b>It’s date</b> <i>o’clock</i></span><small>Neues Date planen</small>${icon('right')}</button>
    <button type="button" class="linkish center own-link" data-go-own>${icon('plus')}Schon etwas vor? Eigenes Date eintragen</button>` : ''}

    ${role ? `
    <section class="rhythm ${r.due ? 'due' : ''}">
      <div class="row between"><span class="kicker">${MONTHS[today().getMonth()]} · ${r.thisMonth}/${r.goal} Dates</span>${r.due ? '<span class="tag warn">Date fällig</span>' : r.thisMonth >= r.goal ? '<span class="tag ok">Ziel erreicht</span>' : ''}</div>
      <span class="progress"><span style="width:${pct}%"></span></span>
      ${pairLocked() ? `<p class="rhythm-msg">${r.due ? 'Zeit für ein Date!' : 'Plant euer nächstes Date.'}</p>
      <div class="row gap rhythm-actions"><button type="button" class="btn primary sm" data-go-neu>${icon('sparkle')}Planen</button></div>` : `
      <p class="rhythm-msg">${turnMine ? (r.due ? `Du bist dran – überrasch ${esc(nameOf(partner))}!` : `Als Nächstes planst du – überrasch ${esc(nameOf(partner))}!`) : `${esc(nameOf(np))} ist dran${r.due ? ' – lass dich überraschen.' : '.'}`}</p>
      <div class="row gap rhythm-actions">${turnMine ? `<button type="button" class="btn primary sm" data-go-neu>${icon('sparkle')}Planen</button>` : ''}<button type="button" class="linkish small" id="swap-turn">${icon('repeat')}Tauschen</button></div>`}
    </section>` : ''}

    ${S().polls.some((x) => x.kind === 'swipe' && x.status === 'open') ? '' : `
    <button class="match-teaser" id="start-match"${lockAttr()} data-pair-lock-text="Beim Date-Match wischt ihr beide auf dem eigenen Handy und seht, worauf ihr gemeinsam Lust habt.">
      <span class="mt-ico">${icon('heart')}</span>
      <span class="grow"><strong>Date-Match</strong><br><small>${pairLocked() ? (coupleState() === 'offen' ? `Sobald ${esc(partnerName() || 'dein Partner')} dabei ist` : 'Braucht deinen Partner') : 'Gemeinsam wischen – ihr wischt beide auf eurem eigenen Handy.'}</small></span>
      ${icon('right')}
    </button>`}

    ${inbox.length ? `<section class="stack"><h2 class="section-title">Für dich</h2>${inbox.join('')}</section>` : ''}

    ${today().getMonth() === 11 || (today().getMonth() === 0 && today().getDate() <= 20) ? `<button class="book-teaser" data-go-book>${icon('book')}<span class="grow"><strong>Euer Jahresrückblick ist da</strong><br><small class="muted">Alle Dates ${today().getMonth() === 0 ? today().getFullYear() - 1 : today().getFullYear()} als Fotobuch</small></span>${icon('right')}</button>` : ''}
    ${recommendationsHTML()}
    ${role && !L().tipCommunity && S().settings.onboarded?.[role] ? `<div class="banner neutral-row tip">${icon('sparkle')}<span class="grow">Tipp: Unter <strong>Entdecken → Community</strong> findet ihr Ideen von anderen Paaren.</span><button type="button" class="icon-btn small" id="tip-close" aria-label="Ausblenden">${icon('x')}</button></div>` : ''}`;

  const formHTML = `
    ${topbar({ title: '', back: ['start', '', 'Start'] })}
    <form class="panel form" id="start-form" novalidate>
      <div class="oclock"><h2><span>It’s date</span> <i>o’clock.</i></h2><p class="muted">Was habt ihr vor?</p></div>
      <div class="field"${lockAttr()} data-pair-lock-text="Abwechselnd planen, überraschen oder zusammen abstimmen – das geht, sobald ihr verbunden seid.">
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
        <div class="label-row"><span class="label">Budget für euch beide</span><output id="budget-out" class="budget-out">${budgetLabel(f.budget)}</output></div>
        <input type="range" id="f-budget" min="0" max="200" step="5" value="${f.budget}" aria-label="Budget in Euro">
        <div class="scale"><span>0 €</span><span>50</span><span>100</span><span>150</span><span>200 €+</span></div>
      </div>
      <div class="field only-solo">
        <span class="label">Wie weit darf es sein?</span>
        ${radiusChips('reach', f.radiusKm ?? reachToKm(f.reach), { home: true })}
      </div>
      <div class="field only-solo">
        <span class="label">Stimmung</span>
        ${chips('fmood', [['', 'Überrascht uns'], ...MOODS.map(([v, l]) => [v, l])], f.mood ?? '')}
      </div>
      <div class="field" id="city-field">
        <label class="label" for="f-city">Wo?</label>
        ${locField('f-city', currentPlaceName() ? { name: currentPlaceName(), sub: L().geo && L().geo.name === currentPlaceName() ? 'Aktueller Standort' : S().settings.geo?.sub ?? '' } : null)}
      </div>
      <div class="field" id="note-field" hidden>
        <label class="label" for="f-note">Wunsch oder Hinweis (optional)</label>
        <input id="f-note" class="input" placeholder="z. B. Gern etwas Ruhiges" maxlength="120">
      </div>
      <button class="btn primary big" id="f-submit" type="submit"></button>
    </form>`;

  root.innerHTML = planMode ? formHTML : homeHTML;
  bindBack();
  on('[data-go-neu]', 'click', () => go('neu'));
  on('[data-go-own]', 'click', () => go('eigen'));
  on('[data-report-seen]', 'click', (_, el) => {
    community.api.reportSeen(el.dataset.reportSeen).catch(() => {});
    session.reportUpdates = (session.reportUpdates ?? []).filter((u) => u.id !== el.dataset.reportSeen);
    render();
  });
  $('#tip-close')?.addEventListener('click', () => {
    L().tipCommunity = true;
    store.saveLocal();
    render();
  });
  on('[data-pair-consent]', 'click', (_, el) => {
    const yes = el.dataset.pairConsent === '1';
    store.update((st) => (st.settings.communityPair = { ...st.settings.communityPair, consent: { ...(st.settings.communityPair?.consent ?? {}), [myRole()]: yes } }));
    toast(yes ? 'Danke – euer Paarname erscheint jetzt' : `Okay – ${nameOf(other(myRole()))} erscheint weiter mit Vornamen`);
    render();
  });
  const form = $('#start-form');
  if (form) {
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
  bindLocField('f-city', (g) => setHome(g));

  $('#f-budget').addEventListener('input', (e) => {
    f.budget = Number(e.target.value);
    $('#budget-out').textContent = budgetLabel(f.budget);
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
      toast(noRoleMsg());
      $('.who')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    f.date = $('#f-date').value;
    if (f.when === 'tonight') f.daytime = 'abend';
    L().lastSearch = { ...f };
    store.saveLocal();
    const radiusKm = f.radiusKm ?? reachToKm(f.reach);
    const ctx = { date: resolveDate(f), daytime: f.daytime, budget: budgetVal(f.budget), reach: kmToReach(radiusKm), radiusKm, mood: f.mood || '' };
    const city = $('#f-city').value.trim();

    if (f.planner === 'partner') {
      const note = $('#f-note').value.trim();
      store.update((st) => st.requests.push({ id: uid(), from: myRole(), to: other(myRole()), ctx, note, status: 'open', createdAt: Date.now() }));
      nudgePush();
      if (city) ensureGeo(city);
      toast(`Anfrage an ${nameOf(other(myRole()))} gesendet`);
      go('start', null, { replace: true });
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
  }

  bindWhoAmI();
  bindInviteCard();
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
  $('#start-match')?.addEventListener('click', (e) => startMatch(e.currentTarget));
  on('[data-scroll-form]', 'click', () => go('neu'));
  on('[data-special]', 'click', async (_, el) => {
    if (!myRole()) return toast(noRoleMsg());
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

/* --- Standort genau wählen: Vorschlagsliste mit Landkreis bzw. Adresse ------- */

/** Eingabefeld mit Vorschlägen. Nach der Auswahl steht darunter, welcher Ort genau gilt. */
function locField(id, geo, placeholder = 'Ort oder Adresse, z. B. Wartenberg') {
  return `
    <div class="loc-field">
      <div class="row gap"><div class="input-ico grow">${icon('pin')}<input class="input" id="${id}" value="${esc(geo?.name ?? '')}" placeholder="${esc(placeholder)}" autocomplete="off"></div>
      <button type="button" class="btn square" data-loc-gps="${id}" aria-label="Meinen Standort verwenden">${icon('locate')}</button></div>
      <div class="loc-suggest" id="${id}-list" hidden></div>
      <p class="loc-confirm small" id="${id}-ok">${geo?.name ? `${icon('check', 'inline')} ${esc(geo.name)}${geo.sub ? ` <span class="muted">· ${esc(geo.sub)}</span>` : ''}` : '<span class="muted">Tippe und wähle den richtigen Ort aus der Liste.</span>'}</p>
    </div>`;
}

function bindLocField(id, onPick) {
  const input = document.getElementById(id);
  const list = document.getElementById(`${id}-list`);
  const ok = document.getElementById(`${id}-ok`);
  if (!input) return;
  let timer = null;
  let seq = 0;
  const pick = (g) => {
    list.hidden = true;
    input.value = g.name;
    ok.innerHTML = `${icon('check', 'inline')} ${esc(g.name)}${g.sub ? ` <span class="muted">· ${esc(g.sub)}</span>` : ''}`;
    onPick(g);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      list.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      const my = ++seq;
      list.hidden = false;
      list.innerHTML = '<p class="muted small"><span class="spinner tiny"></span> Suche …</p>';
      const res = await geocodeList(q, discoverCenter()).catch(() => []);
      if (my !== seq) return;
      list.innerHTML = res.length
        ? res.map((g, k) => `<button type="button" class="loc-opt" data-k="${k}">${icon(g.kind === 'adresse' ? 'home' : 'pin')}<span><strong>${esc(g.name)}</strong><small class="muted">${esc(g.sub)}</small></span></button>`).join('')
        : '<p class="muted small">Nichts gefunden – versuch es mit Ort und Straße.</p>';
      list.querySelectorAll('.loc-opt').forEach((b) => b.addEventListener('click', () => pick(res[Number(b.dataset.k)])));
    }, 350);
  });
  document.querySelector(`[data-loc-gps="${id}"]`)?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        const g = await useGps();
        pick({ name: g.name, sub: 'Aktueller Standort', lat: g.lat, lon: g.lon, gps: true });
      } catch (err) {
        toast(store.inArtifact() ? 'Den Standort gibt es in der Webseiten-Version.' : err.message);
      }
    });
  });
}

/** Gewählten Ort für beide übernehmen (GPS-Standort wird dann nicht mehr bevorzugt). */
function setHome(g) {
  if (!g.gps) {
    L().geo = null;
    store.saveLocal();
  }
  store.update((st) => {
    st.settings.city = g.town || g.name;
    st.settings.geo = { name: g.kind === 'adresse' && g.town ? `${g.name}, ${g.town}` : g.name, sub: g.sub ?? '', lat: g.lat, lon: g.lon };
  });
  discover.feed = null;
  discover.gen = null;
  discover.near = null;
  discover.results = null;
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
  const stops = plan.steps.filter((x) => x.place?.lat != null);
  const main = stops[0]?.place;
  const t = topicFor(plan) ?? (plan.ideaId ? topicFor({ id: plan.ideaId }) : null);
  const job = main ? { place: main, topic: t } : t ? { topic: t } : null;
  const img = plan.image || main?.image;
  return `
    <header class="plan-head">
      ${img || job ? thumb(img, plan.emoji, 'hero', job, null) : `<span class="plan-emoji" aria-hidden="true">${glyph(plan.emoji)}</span>`}
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      <h1>${esc(plan.title)}</h1>
      ${plan.subtitle ? `<p class="plan-places">${esc(plan.subtitle)}</p>` : ''}
      <p class="sub">${day ? day + ', ' : ''}${fmtDate(plan.date)} · ${plan.start}–${plan.end} Uhr</p>
      <div class="pills">
        ${weatherPill(plan.weather, plan.daytime)}
        <span class="pill">${icon('euro')}${fmtEuro(plan.cost)}</span>
        <span class="pill">${icon('clock')}${fmtDuration(plan.duration)}</span>
      </div>
    </header>
    ${stops.length ? `<div class="plan-map" id="plan-map" aria-label="Karte mit den Stationen"></div>` : ''}`;
}

/* --- Karte im Plan (Leaflet + OpenStreetMap) ------------------------------- */

let leafletLoading = null;
function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  leafletLoading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'js/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'js/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('Karte konnte nicht geladen werden'));
    document.head.append(js);
  });
  return leafletLoading;
}

let planMap = null;
let lastPlan = null; // zuletzt gezeigter Plan (für die Karte)
/** Stationen nummeriert auf der Karte zeigen, mit Linie in der Reihenfolge des Dates. */
function drawPlanMap(plan) {
  const el = document.getElementById('plan-map');
  if (!el) return;
  const stops = plan.steps.filter((x) => x.place?.lat != null).map((x) => x.place);
  const seen = new Set();
  const uniq = stops.filter((p) => !seen.has(`${p.lat},${p.lon}`) && seen.add(`${p.lat},${p.lon}`));
  loadLeaflet().then((Lf) => {
    if (!document.body.contains(el)) return;
    planMap?.remove();
    planMap = Lf.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !Lf.Browser.mobile, tap: false });
    Lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(planMap);
    const pts = uniq.map((p) => [p.lat, p.lon]);
    uniq.forEach((p, i) => {
      Lf.marker([p.lat, p.lon], { icon: Lf.divIcon({ className: 'map-pin', html: `<span>${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: p.name }).addTo(planMap);
    });
    if (pts.length > 1) Lf.polyline(pts, { color: '#562F37', weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(planMap);
    if (pts.length === 1) planMap.setView(pts[0], 15);
    else planMap.fitBounds(pts, { padding: [28, 28], maxZoom: 16 });
  }).catch(() => el.remove());
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
function timedSteps(steps, draft, from, home = false) {
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
    // Zuhause-Date: nach der Besorgung wieder heim
    if (home && from && !p && prev && prev !== from && prev.lat != null) {
      const km = distanceKm(prev, from);
      const opts = travelEstimates(km);
      const t = opts.find((o) => o.mode === (km < 1.5 ? 'walking' : 'driving')) ?? opts[0];
      out.push({ t: 'Zurück nach Hause', min: round5(t.min), travel: true, note: `${fmtKm(km)} · ca. ${fmtMin(t.min)}`, from: { lat: prev.lat, lon: prev.lon }, to: { lat: from.lat, lon: from.lon }, mode: t.mode });
      map.push(-1);
      travel += round5(t.min);
      prev = from;
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
  // Nach dem Neuladen: Plan-Sitzung wiederherstellen
  if (!session.ctx || !ideaById(ideaId)) {
    const saved = ssGet('dately.plan');
    if (saved?.ideaId === ideaId) {
      session.ctx ??= saved.ctx;
      session.weather ??= saved.weather;
      if (saved.idea && !ideaById(ideaId)) tempIdeas.set(ideaId, saved.idea);
      if (saved.draft && !drafts[ideaId]) drafts[ideaId] = { ...saved.draft, near: null, nearLoading: false };
    }
  }
  const idea = ideaById(ideaId);
  const ctx = session.ctx;
  if (!idea || !ctx) return go('start', null, { replace: true });
  ssSet('dately.plan', { ideaId, ctx, weather: session.weather, idea: tempIdeas.get(ideaId) ?? null, draft: drafts[ideaId] ? { ...drafts[ideaId], near: null } : null });
  const role = myRole();
  const partner = other(role);
  const fromPoll = !!session.pollId;
  const draft = (drafts[ideaId] ??= { start: defaultStart(idea, ctx.daytime), surprise: !fromPoll, hint: '', picks: {}, near: null, openAlt: null, duration: idea.reach === 0 ? null : feedFilter.duration, variant: 0 });
  const baseSteps = effectiveSteps(idea, draft, ctx);
  // Dates zuhause: nur kurze Besorgungen in der Nähe (z. B. Bäcker), keine Ausflüge
  const stepCats = baseSteps.map((s) => (idea.reach === 0 && !s.near ? null : s.cat ?? catForStep(s, ctx.date)));
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
  const timed = timedSteps(picked, draft, ctx.reach !== 0 ? center : null, idea.reach === 0);
  const travelMin = timed.steps.filter((x) => x.travel).reduce((a, x) => a + x.min, 0);
  const actMin = timed.steps.filter((x) => !x.travel).reduce((a, x) => a + x.min, 0);
  const variant = idea.variants?.[draft.variant ?? 0];
  const recipe = variant ? { name: variant.name, url: variant.url ?? '', ingredients: variant.materials } : idea.recipe;
  const plan = buildPlan({ ...idea, steps: timed.steps, recipe }, { ...ctx, start: draft.start }, S().settings, session.weather);
  lastPlan = plan;
  if (variant) plan.title = `${idea.title}: ${variant.name}`;
  if (idea.generated && !idea.event) {
    const names = picked.map((x) => x.place?.name).filter(Boolean);
    if (names.length) plan.subtitle = names.join(' · '); // kurzer Titel bleibt, Orte stehen darunter
  }
  plan.cost = (idea.cost ?? 0) + baseSteps.filter((x) => x.ext).reduce((a, x) => a + (x.cost ?? 0), 0);
  const stepExtra = (k) => {
    const i = timed.map[k];
    if (i === -1) {
      const t = timed.steps[k];
      return `<div class="links"><a class="link" href="https://www.google.com/maps/dir/?api=1&origin=${t.from.lat},${t.from.lon}&destination=${t.to.lat},${t.to.lon}&travelmode=${t.mode}" target="_blank" rel="noopener">Route${icon('external')}</a></div>`;
    }
    if (!stepCats[i] || !wantsPlaces) return '';
    if (!center) return `<p class="muted small">Erlaube den Standort oder trag eine Stadt ein, dann schlägt Datewell hier konkrete Orte vor.</p>`;
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
    ${travelMin >= 30 && travelMin > actMin * 0.4 ? `<div class="banner warn">${icon('car')}<span><strong>Viel Fahrzeit:</strong> ca. ${fmtMin(travelMin)} unterwegs bei ${fmtMin(actMin)} Date. Tauscht einen Ort gegen etwas Näheres – oder genießt den Ausflug.</span></div>` : ''}
    ${timeline(plan, stepExtra)}
    ${plan.todos.length ? `<p class="hint">${icon('bell')} Vorher erledigen: ${plan.todos.map(esc).join(', ')}</p>` : ''}

    ${fromPoll ? '' : `
    <section class="panel form">
      <label class="switch"${lockAttr()} data-pair-lock-text="Überraschungen plant ihr füreinander – das geht, sobald ihr verbunden seid.">
        <input type="checkbox" id="p-surprise" ${draft.surprise && !pairLocked() ? 'checked' : ''}>
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
    nudgePush();
    const when = `${new Date(`${plan.date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long' })}, ${plan.start}`;
    toast(surprise ? `Euer Date steht. It’s date o’clock am ${when} – ${nameOf(partner)} sieht nur Tag und Uhrzeit.` : `Euer Date steht. It’s date o’clock am ${when}.`);
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
    // Anfahrt höchstens etwa ein Viertel der Date-Dauer (2,5 Std. Date → ca. 25 km)
    const durMin = steps.reduce((a, x) => a + (x.min ?? 0), 0);
    const reasonable = Math.max(12000, durMin * 0.25 * 700);
    const wideR = Math.min(radius * 3, Math.max(radius, reasonable), 60000);
    if (far.length && wideR > radius) {
      const wider = await searchMixed(far, center, wideR, 2).catch(() => ({}));
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
        // Von Datewell bereits gewählter Ort bleibt vorausgewählt
        const fixed = s.place?.id ? { ...s.place, km: distanceKm(center, s.place) } : null;
        if (fixed) {
          placeIndex.set(fixed.id, { ...(placeIndex.get(fixed.id) ?? {}), ...fixed });
          draft.picks[i] ??= fixed.id;
        }
        const pool = [...(fixed && !(groups[cat] ?? []).some((p) => p.id === fixed.id) ? [placeIndex.get(fixed.id)] : []), ...(groups[cat] ?? [])];
        const maxKm = s.near ?? (['supermarket', 'chocolate'].includes(realCat[i] ?? cat) ? 8 : null);
        const wishes = [[/sushi|japan/, /sushi|japan/i], [/ital|pasta|pizza/, /ital|pizza|trattoria|osteria/i], [/fondue|raclette|schweiz/, /fondue|schweiz|swiss|käse/i], [/burger/, /burger/i], [/steak/, /steak|grill/i], [/indisch|curry/, /indisch|india/i], [/griech/, /griech|greek/i], [/bayer|bräu|wirtshaus/, /bayer|regional|deutsch|bräu|wirt/i]];
        const wish = wishes.find(([re]) => re.test(`${s.t} ${s.q ?? ''}`.toLowerCase()))?.[1] ?? null;
        // Nach einem schicken Ort (Weinbar, Cocktailbar, Theater …) kein Imbiss oder Asia-Wok
        const prevChic = ['wine', 'cocktail', 'finedining', 'theatre', 'rooftop', 'livemusic', 'spa'].includes(prev?.category);
        const styleOk = (p) => !prevChic || !['restaurant', 'finedining', 'burger'].includes(realCat[i] ?? cat) || !isCasualFood(p);
        const list = pool
          .filter((p) => !used.has(p.id) && (maxKm == null || p.km <= maxKm) && styleOk(p))
          .map((p) => ({ ...p, distFromPrev: distanceKm(prev, p), open: isOpenAt(p.hours, when) }))
          .filter((p) => p.open !== false || p.id === draft.picks[i])
          // Hauptort: zuerst im gewählten Umkreis; bekannte Orte weiter weg kommen unten dazu
          .filter((p) => cat !== firstCat || !pool.some((q) => q.km * 1000 <= radius) || p.km * 1000 <= radius || p.id === draft.picks[i])
          // Nähe zählt am meisten; bestätigt geöffnete Orte bekommen 1,5 km Vorsprung
          // Wunschküche (z. B. „Sushi“, „Italienisch“, „Fondue“) bekommt 2 km Vorsprung
          .sort((a, b) => (b.id === draft.picks[i]) - (a.id === draft.picks[i]) || (a.distFromPrev - (a.open === true ? 1.5 : 0) - (wish && wish.test(`${a.cuisine ?? ''} ${a.name}`) ? 2 : 0)) - (b.distFromPrev - (b.open === true ? 1.5 : 0) - (wish && wish.test(`${b.cuisine ?? ''} ${b.name}`) ? 2 : 0)))
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
    lastPlan = null;
    return;
  }

  const plan = fullPlan(d);
  lastPlan = plan;
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
    ${!past && mySurprise ? prepPanel(plan, secret?.checks, 'data-check', 'Deine geheime Vorbereitung') : ''}
    ${!past && !d.surprise ? prepPanel(plan, d.checks, 'data-dcheck', 'Vorbereitung') : ''}
    ${timeline(plan)}
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
  if (p.kind === 'swipe') return go('match', id);
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

/* ================================================================ Rechtliches */

const legalLinks = () => `<nav class="legal-links"><a href="#impressum" data-legal="impressum">Impressum</a> · <a href="#datenschutz" data-legal="datenschutz">Datenschutz</a> · <a href="#agb" data-legal="agb">AGB</a></nav>`;
function bindLegalLinks() {
  on('[data-legal]', 'click', (e, el) => {
    e.preventDefault();
    go(el.dataset.legal);
  });
}
const LEGAL_PAGES = { impressum: ['Impressum', impressumHTML], datenschutz: ['Datenschutzerklärung', datenschutzHTML], agb: ['AGB', agbHTML] };
for (const [route, [title, html]] of Object.entries(LEGAL_PAGES)) {
  RENDER[route] = () => {
    root.innerHTML = `
      ${topbar({ title, back: [auth.needed ? 'konto' : 'mehr', '', auth.needed ? 'Anmelden' : 'Einstellungen'] })}
      ${legalComplete() ? '' : '<div class="banner warn">Vorlage: Die Angaben in [eckigen Klammern] müssen vor der Veröffentlichung in js/legal.js ergänzt werden.</div>'}
      <article class="panel legal">${html()}</article>
      ${legalLinks()}`;
    bindBack();
    bindLegalLinks();
  };
}

/** Alle eigenen Daten als Datei (Recht auf Datenübertragbarkeit). */
function exportMyData() {
  const st = S();
  const data = {
    exportiert: new Date().toISOString(),
    app: 'Datewell',
    konto: { email: auth.user?.email ?? null, rolle: myRole() },
    einstellungen: st.settings,
    dates: st.dates,
    meine_geheimen_planungen: st.secrets,
    termine: st.events,
    ausgaben: st.expenses,
    abstimmungen: st.polls,
    wuensche: st.requests,
    eigene_ideen: st.ideas,
    favoriten: st.favorites,
    listen: { todos: st.todos, einkauf: st.shopping },
  };
  saveFile(`datewell-meine-daten-${isoDate(today())}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/* ================================================================ Date-Match (gemeinsam wischen) */

/** Stand eines Date-Matches: wie weit ist wer, welche Karten mögen beide? */
function matchState(p) {
  const role = myRole() ?? 'a';
  const partner = other(role);
  const v = p.votes ?? {};
  const mine = Object.keys(v[role] ?? {}).length;
  const theirs = Object.keys(v[partner] ?? {}).length;
  const matches = p.deck.filter((id) => v.a?.[id] === 1 && v.b?.[id] === 1);
  return { mine, theirs, mineDone: mine >= p.deck.length, theirsDone: theirs >= p.deck.length, matches, next: p.deck.find((id) => v[role]?.[id] == null) };
}

const matchIdea = (p, id) => p.snap?.[id] ?? ideaById(id);

/** Kartenstapel aus Dates in eurer Nähe und passenden Ideen bauen. */
async function buildDeck(ctx, weather, exclude = new Set()) {
  const center = discoverCenter();
  const res = await suggest(ctx, weather, { count: 7, exclude, dates: S().dates.map(fullPlanOrMeta), recentIds: S().dates.slice(-8).map((x) => x.ideaId) });
  let gen = [];
  if (center && !store.inArtifact() && ctx.radiusKm) {
    const area = currentArea();
    gen = await generateLocalDates({ center, radiusKm: ctx.radiusKm, daytime: ctx.daytime, date: ctx.date, moods: ctx.moods ?? [], weather, count: 6, budget: ctx.budget, groups: area?.done ? area.cats : null }).catch(() => []);
  }
  const deck = [];
  const g = gen.filter((i) => !exclude.has(i.id));
  const f = res.ideas.filter((i) => !exclude.has(i.id));
  while ((g.length || f.length) && deck.length < 10) {
    if (g.length) deck.push(g.shift());
    if (f.length && deck.length < 10) deck.push(f.shift());
  }
  return deck;
}

async function startMatch(el) {
  if (!myRole()) return toast(noRoleMsg());
  await withBusy(el, async () => {
    const r = feedRadiusKm();
    const ctx = { date: feedDate(), daytime: feedFilter.daytime, budget: budgetVal(feedFilter.budget ?? L().lastSearch.budget ?? 60), reach: kmToReach(r), radiusKm: r, moods: preferredMoods() };
    const weather = discover.feedWeather ?? (await getWeather(discoverCenter(), ctx.date, ctx.daytime).catch(() => ({ known: false })));
    const deck = await buildDeck(ctx, weather);
    if (!deck.length) return toast('Gerade keine passenden Dates – lockert die Filter unter Entdecken.');
    const builtin = new Set((await loadIdeas()).map((i) => i.id));
    const poll = { id: uid(), kind: 'swipe', stage: 'swipe', status: 'open', createdBy: myRole(), createdAt: Date.now(), ctx, weather: weatherSnap(weather), deck: deck.map((i) => i.id), titles: Object.fromEntries(deck.map((i) => [i.id, i.title])), snap: Object.fromEntries(deck.filter((i) => !builtin.has(i.id)).map((i) => [i.id, i])), votes: { a: {}, b: {} } };
    store.update((st) => {
      // Nur ein offenes Date-Match gleichzeitig
      st.polls = st.polls.filter((x) => !(x.kind === 'swipe' && x.status === 'open'));
      st.polls.push(poll);
    });
    nudgePush();
    go('match', poll.id);
  });
}

let matchFlash = null; // gerade entstandenes Match (für die Einblendung)

RENDER.match = (id) => {
  const p = S().polls.find((x) => x.id === id);
  if (!p || p.kind !== 'swipe') return go('start');
  const role = myRole();
  if (!role) {
    root.innerHTML = `${topbar({ title: 'Date-Match', back: ['start', '', 'Start'] })}${whoAmICard()}`;
    bindBack();
    return bindWhoAmI();
  }
  const partner = other(role);
  const m = matchState(p);
  for (const i of Object.values(p.snap ?? {})) tempIdeas.set(i.id, i);
  const cur = m.next ? matchIdea(p, m.next) : null;
  const flash = matchFlash && matchIdea(p, matchFlash);

  root.innerHTML = `
    ${topbar({ title: 'Date-Match', sub: `${whenLabel(p.ctx.date, p.ctx.daytime)} · bis ${p.ctx.budget} €`, back: ['start', '', 'Start'] })}
    <div class="match-progress">
      <span class="status ${m.mineDone ? 'done' : ''}">${icon(m.mineDone ? 'check' : 'heart')}Du ${m.mine}/${p.deck.length}</span>
      <span class="status ${m.theirsDone ? 'done' : ''}">${icon(m.theirsDone ? 'check' : 'clock')}${esc(nameOf(partner))} ${m.theirs}/${p.deck.length}</span>
    </div>
    ${cur ? `
      <p class="muted small center">→ Lust · ← eher nicht. ${esc(nameOf(partner))} sieht nur eure Matches.</p>
      <div class="swipe-stage">
        <article class="swipe-card" id="swipe-card" data-id="${esc(cur.id)}">
          ${thumb(ideaImg(cur), cur.emoji ?? '💡', 'cover', ideaJobFor(cur), cur)}
          <span class="swipe-label yes">Lust!</span><span class="swipe-label no">Eher nicht</span>
          <div class="sc-body">
            <h2>${esc(cur.title)}</h2>
            <p class="muted">${esc(cur.teaser ?? '')}</p>
            <p class="hc-meta">${ideaMeta(cur).map(esc).join(' · ')}</p>
            ${cur.steps?.length > 1 ? `<p class="sc-steps">${cur.steps.map((x) => esc(x.label ?? x.t.split(':')[0])).join(' → ')}</p>` : ''}
          </div>
        </article>
      </div>
      <div class="swipe-btns">
        <button class="swipe-btn no" data-swipe="-1" aria-label="Eher nicht">${icon('x')}</button>
        <button class="swipe-btn yes" data-swipe="1" aria-label="Hab Lust">${icon('heart')}</button>
      </div>` : `
      <section class="panel center">
        <h2>${m.theirsDone ? (m.matches.length ? 'Eure Matches' : 'Diesmal kein Match') : `Fertig gewischt`}</h2>
        <p class="muted">${m.theirsDone ? (m.matches.length ? 'Diese Dates wollt ihr beide. Plant eins davon!' : 'Mischt einen neuen Stapel – vielleicht passt der nächste.') : `Sobald ${esc(nameOf(partner))} fertig ist, seht ihr alle Matches. Neue Matches erscheinen sofort.`}</p>
        ${m.theirsDone && !m.matches.length ? `<button class="btn primary" id="more-cards">${icon('dice')}Neuer Stapel</button>` : ''}
      </section>`}
    ${m.matches.length ? `
      <section class="stack">
        ${secHead(m.matches.length === 1 ? 'Euer Match' : `Eure ${m.matches.length} Matches`)}
        <div class="idea-rows">${m.matches.map((mid) => {
          const i = matchIdea(p, mid);
          return i ? `<article class="idea-row" data-plan-match="${esc(mid)}" role="button" tabindex="0">${thumb(ideaImg(i), i.emoji ?? '💡', 'row', ideaJobFor(i), i)}<div class="grow"><h3>${esc(i.title)}</h3><p class="ir-meta">${ideaMeta(i).map(esc).join(' · ')}</p></div><span class="btn primary sm">Planen</span></article>` : '';
        }).join('')}</div>
      </section>` : ''}
    <button class="btn ghost danger" id="del-match">${icon('trash')}Date-Match beenden</button>
    ${flash ? `
      <div class="match-flash" id="match-flash" role="dialog" aria-label="Match">
        <div class="mf-card">
          <p class="eyebrow">Ihr habt ein Match</p>
          ${icon('heart', 'mf-heart')}
          <h2>${esc(flash.title)}</h2>
          <p class="muted">${esc(nameOf(partner))} hat auch Lust darauf.</p>
          <div class="row gap center"><button class="btn primary" data-plan-match="${esc(flash.id)}">Jetzt planen</button><button class="btn" id="mf-close">Weiter wischen</button></div>
        </div>
      </div>` : ''}`;
  matchFlash = null;

  bindBack();
  const vote = (v) => {
    if (!cur) return;
    const theirs = p.votes?.[partner]?.[cur.id];
    store.update((st) => {
      const x = st.polls.find((y) => y.id === id);
      x.votes ??= { a: {}, b: {} };
      x.votes[role] = { ...(x.votes[role] ?? {}), [cur.id]: v };
    });
    if (v === 1 && theirs === 1) {
      matchFlash = cur.id;
      nudgePush();
    }
    if (v === -1) rememberSkips([cur]);
    render();
  };
  on('[data-swipe]', 'click', (_, el) => vote(Number(el.dataset.swipe)));
  // Wischen mit dem Finger
  const card = $('#swipe-card');
  if (card) {
    let x0 = null;
    let dx = 0;
    card.addEventListener('pointerdown', (e) => {
      x0 = e.clientX;
      dx = 0;
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      card.classList.toggle('to-yes', dx > 40);
      card.classList.toggle('to-no', dx < -40);
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      card.style.transition = '';
      if (Math.abs(dx) > 90) {
        card.style.transform = `translateX(${dx > 0 ? 600 : -600}px) rotate(${dx / 10}deg)`;
        setTimeout(() => vote(dx > 0 ? 1 : -1), 180);
      } else {
        card.style.transform = '';
        card.classList.remove('to-yes', 'to-no');
      }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }
  on('[data-plan-match]', 'click', async (_, el) => {
    const idea = matchIdea(p, el.dataset.planMatch);
    if (!idea) return;
    tempIdeas.set(idea.id, idea);
    await prepareSession({ ...p.ctx, reach: p.ctx.reach ?? 2 }, null);
    session.pollId = p.id;
    session.requestId = null;
    drafts[idea.id] = { start: defaultStart(idea, p.ctx.daytime), surprise: false, hint: '', picks: {}, near: null, openAlt: null, duration: null, variant: 0 };
    go('plan', idea.id);
  });
  $('#mf-close')?.addEventListener('click', () => $('#match-flash')?.remove());
  $('#more-cards')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      const weather = p.weather?.known ? p.weather : { known: false };
      const deck = await buildDeck(p.ctx, weather, new Set(p.deck));
      if (!deck.length) return toast('Keine weiteren Dates – ändert Budget oder Umkreis unter Entdecken.');
      store.update((st) => {
        const x = st.polls.find((y) => y.id === id);
        x.deck = [...x.deck, ...deck.map((i) => i.id)];
        x.titles = { ...(x.titles ?? {}), ...Object.fromEntries(deck.map((i) => [i.id, i.title])) };
        x.snap = { ...(x.snap ?? {}), ...Object.fromEntries(deck.filter((i) => i.generated || i.custom).map((i) => [i.id, i])) };
      });
    });
    render();
  });
  armed($('#del-match'), () => {
    store.update((st) => (st.polls = st.polls.filter((x) => x.id !== id)));
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

// Vier Farben im Kalender: Date · Geplant · Besonderer Tag · Termin
const DOT_OF = { date: 'date', pending: 'pending', special: 'special', fixed: 'event', event: 'event', todo: 'event', gcal: 'event', busy: 'event' };

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
    const types = [...new Set(entriesFor(date).map((e) => DOT_OF[e.type] ?? 'event'))];
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
        <span><i class="dot date"></i>Date</span><span><i class="dot pending"></i>Geplant</span>
        <span><i class="dot special"></i>Besonderer Tag</span><span><i class="dot event"></i>Termin</span>
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
      <button type="button" class="linkish add-toggle" id="ev-toggle" aria-expanded="${!!cal.addOpen}" ${cal.addOpen ? 'hidden' : ''}>${icon('plus')}Termin</button>
      <form class="panel add-row" id="add-event" ${cal.addOpen ? '' : 'hidden'}>
        <input class="input" id="ev-title" name="title" placeholder="Termin, z. B. Yoga" required>
        <div class="row gap">
          <input class="input" id="ev-time" type="time" name="time" value="19:00" aria-label="Uhrzeit">
          <select class="input" id="ev-who" name="who" aria-label="Wer">
            <option value="Beide">Beide</option><option value="${esc(nameOf('a'))}">${esc(nameOf('a'))}</option><option value="${esc(nameOf('b'))}">${esc(nameOf('b'))}</option>
          </select>
          <button class="btn primary square" aria-label="Termin hinzufügen">${icon('plus')}</button>
        </div>
      </form>
      ${cal.sel >= todayIso ? `<button class="btn soft big" id="plan-here">${icon('sparkle')}Date für diesen Tag planen</button>
      <button class="linkish center add-toggle" id="own-here">${icon('plus')}Eigenes Date an diesem Tag eintragen</button>` : ''}
      ${(() => {
        const dp = S().polls.filter((p) => p.status === 'open' && p.stage === 'survey' && p.kind === 'day').sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!dp || !myRole()) return '';
        const mine = !!dp.survey?.[myRole()];
        const theirs = !!dp.survey?.[other(myRole())];
        return `<div class="banner neutral-row">${icon('calendar')}<span class="grow"><strong>Welcher Tag passt euch?</strong><br><small class="muted">${mine && theirs ? 'Beide haben geantwortet – Ergebnis ansehen' : mine ? `Warte auf ${esc(nameOf(other(myRole())))}` : 'Deine Antwort fehlt noch'}</small></span><button class="btn sm ${mine && !theirs ? '' : 'primary'}" data-open-poll="${dp.id}">Öffnen</button></div>`;
      })()}
      <button class="btn big" id="find-day"${lockAttr()} data-pair-lock-text="Ihr gebt beide an, wann ihr Zeit habt, und Datewell findet den passenden Tag.">${icon('vote')}Gemeinsamen Tag finden</button>
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
  $('#ev-toggle').addEventListener('click', (e) => {
    cal.addOpen = true;
    e.currentTarget.hidden = true;
    $('#add-event').hidden = false;
    $('#ev-title').focus();
  });
  $('#add-event').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const title = String(fd.get('title')).trim();
    if (!title) return;
    store.update((st) => st.events.push({ id: uid(), date: cal.sel, time: fd.get('time'), title, who: fd.get('who'), createdAt: Date.now() }));
    cal.addOpen = false;
    render();
  });
  $('#find-day').addEventListener('click', () => {
    if (!myRole()) return toast(noRoleMsg());
    go('poll', createSurvey('day'));
  });
  $('#own-here')?.addEventListener('click', () => go('eigen', cal.sel));
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
function balances(archived = false) {
  const bal = { a: 0, b: 0 };
  for (const e of S().expenses.filter((x) => !!x.archived === archived)) {
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
    <button role="tab" data-dseg="dates" aria-selected="${active === 'dates'}">${icon('album')}Dates</button>
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
  const formHTML = () => `
    <form class="form" id="exp-form" novalidate>
      <div class="row gap">
        <div class="field grow"><label class="label" for="e-title">Wofür?</label><input class="input" id="e-title" maxlength="60" placeholder="z. B. Abendessen" value="${esc(forDate ? dateTitle(forDate).replace(/^Überraschung von .*/, 'Überraschung') : '')}"></div>
        <div class="field narrow-field"><label class="label" for="e-amount">Betrag €</label><input class="input" id="e-amount" inputmode="decimal" placeholder="0,00"></div>
      </div>
      <div class="field"><span class="label">Bezahlt von</span>${chips('payer', [['a', role === 'a' ? 'Mir' : esc(nameOf('a'))], ['b', role === 'b' ? 'Mir' : esc(nameOf('b'))]], draft.paidBy, 'seg')}</div>
      <div class="field"><span class="label">Aufteilung</span>${chips('split', [['half', 'Halbe-halbe'], ['gift', 'Eingeladen']], draft.split, 'seg')}</div>
      <div class="field"><label class="label" for="e-date">Zum Date</label>
        <select class="input" id="e-date"><option value="">Ohne Date</option>${upcomingDates.map((d) => `<option value="${d.id}" ${forDate?.id === d.id ? 'selected' : ''}>${esc(fmtShort(d.date))} · ${esc(dateTitle(d))}</option>`).join('')}</select>
      </div>
      <label class="switch"${lockAttr()} data-pair-lock-text="Ausgaben vor deinem Partner verstecken – etwa für Geschenke – geht, sobald ihr verbunden seid."><input type="checkbox" id="e-private" ${defaultPrivate && !pairLocked() ? 'checked' : ''}><span><strong>Vor ${esc(nameOf(partner))} verstecken</strong><br><small class="muted">Für Überraschungen und Geschenke. Nur du siehst diese Ausgabe.</small></span></label>
      <button class="btn primary big" type="submit">${icon('check')}Speichern</button>
    </form>`;

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
    <section class="panel balance"${lockAttr()} data-pair-lock-text="Der Kostenausgleich rechnet aus, wer wem etwas schuldet – dafür braucht es euch zwei. Eigene Ausgaben kannst du schon eintragen.">
      <div class="grow">
        <span class="kicker">Ausgleich</span>
        <strong>${Math.abs(mine) < 0.01 ? 'Ihr seid quitt' : mine > 0 ? `${esc(nameOf(partner))} schuldet dir ${euro(mine)}` : `Du schuldest ${esc(nameOf(partner))} ${euro(-mine)}`}</strong>
        <small class="muted">Nur geteilte Ausgaben („Halbe-halbe“). Einladungen und Geheimes zählen nicht.</small>
      </div>
      ${Math.abs(mine) >= 0.01 ? `<button class="btn sm" id="settle">Ausgeglichen</button>` : ''}
    </section>
    ${(() => {
      // Nach dem Trennen: abgeschlossener Ausgleich bleibt lesbar
      if (!S().expenses.some((x) => x.archived)) return '';
      const ab = balances(true);
      const v = Math.round((ab[role] ?? 0) * 100) / 100;
      const who = S().settings.formerName || 'deinem früheren Partner';
      return `<p class="muted small">${icon('lock')} Abgeschlossen (Zeit mit ${esc(who)}): ${Math.abs(v) < 0.01 ? 'ausgeglichen' : v > 0 ? `offen – ${esc(who)} schuldet dir ${euro(v)}` : `offen – du schuldest ${esc(who)} ${euro(-v)}`}</p>`;
    })()}

    <button type="button" class="btn primary big exp-add" id="exp-open">${icon('plus')}Ausgabe eintragen</button>

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
  const openForm = () => openSheet('Ausgabe eintragen', formHTML(), (sh) => {
    const form = sh.querySelector('#exp-form');
    bindChips(form, 'payer', (v) => (draft.paidBy = v));
    bindChips(form, 'split', (v) => (draft.split = v));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Math.round(Number(form.querySelector('#e-amount').value.replace(/\./g, '').replace(',', '.')) * 100) / 100;
      const title = form.querySelector('#e-title').value.trim() || 'Date';
      if (!(amount > 0)) {
        toast('Bitte einen Betrag eintragen');
        return form.querySelector('#e-amount').focus();
      }
      const dateId = form.querySelector('#e-date').value;
      const date = S().dates.find((d) => d.id === dateId)?.date ?? isoDate(today());
      const item = { id: `exp-${uid()}`, kind: 'expense', title, amount, paidBy: draft.paidBy, split: draft.split, date, dateId: dateId || null, createdAt: Date.now() };
      const priv = form.querySelector('#e-private').checked;
      store.update((s) => {
        if (priv) s.secrets[item.id] = item; // nur in deinem privaten Bereich gespeichert – für die andere Person auf dem Server nicht lesbar
        else s.expenses.push(item);
      });
      toast(priv ? 'Geheim gespeichert' : 'Ausgabe gespeichert');
      closeSheet();
      if (forDate) go('kosten', null, { replace: true });
      else render();
    });
  });
  $('#exp-open').addEventListener('click', openForm);
  if (forDate) openForm();
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
          <span class="cover-brand">Datewell</span>
          <h1>${year}</h1>
          <p class="cover-names">${esc(names)}</p>
          <p class="cover-tag">For the moments that matter.</p>
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
        <p class="cover-tag">Datewell · For the moments that matter.</p>
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
          <small class="muted">${relDay(d.date) ?? fmtShort(d.date)} · ${d.start} Uhr · ${esc(plannerLabel(d))}${d.archived ? ' · Archiv' : ''}</small>
        </span>
        ${isPast ? (avg ? `<span class="score">${icon('heart')}${avg.toFixed(1).replace('.', ',')}</span>` : '<small class="muted">bewerten</small>') : d.surprise ? `<span class="tag">${icon(isHiddenFromMe(d) ? 'gift' : 'lock')}${isHiddenFromMe(d) ? 'Überraschung' : 'Geheim'}</span>` : icon('right', 'chev')}
      </button>`;
  };

  root.innerHTML = `
    ${topbar({ title: 'Unsere Dates' })}
    ${datesTabs('dates')}
    ${past.length ? `<button class="book-teaser" data-go-book>${icon('book')}<span class="grow"><strong>Jahresrückblick ${today().getFullYear()}</strong><br><small class="muted">Euer Fotobuch mit allen Dates</small></span>${icon('right')}</button>`
      : upcoming.length ? `<div class="book-teaser waiting" aria-disabled="true">${icon('book')}<span class="grow"><strong>Jahresrückblick ${today().getFullYear()}</strong><br><small class="muted">Füllt sich mit eurem ersten Date</small></span></div>` : ''}
    <section class="stack">
      <div class="row between"><h2 class="section-title">Geplant</h2><button type="button" class="btn sm soft" data-go-own>${icon('plus')}Eigenes Date</button></div>
      ${upcoming.length ? `<div class="list-card">${upcoming.map((d) => item(d, false)).join('')}</div>` : `
        <div class="empty"><p>Noch kein Date geplant.</p><div class="row gap center-row"><button class="btn primary" data-go-neu>Date planen</button><button class="btn" data-go-own>Eigenes eintragen</button></div></div>`}
    </section>
    <section class="stack">
      <h2 class="section-title">Erinnerungen</h2>
      ${past.length ? `<div class="list-card">${past.map((d) => item(d, true)).join('')}</div>` : '<p class="muted">Hier sammeln sich eure vergangenen Dates mit euren Bewertungen.</p>'}
    </section>`;
  bindBack();
  bindDatesTabs();
  on('[data-go-book]', 'click', () => go('rueckblick'));
  on('[data-go-own]', 'click', () => go('eigen'));
  on('[data-go-neu]', 'click', () => go('neu'));
  on('[data-open-date]', 'click', (_, el) => go('date', el.dataset.openDate));
};

/* ================================================================ Eigenes Date eintragen */

const ownDraft = { stations: [] };
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};

RENDER.eigen = (param) => {
  const role = myRole();
  const d = ownDraft;
  if (d.key !== param || !d.stations.length) {
    Object.assign(d, {
      key: param,
      title: '',
      emoji: '✨',
      date: /^\d{4}-\d{2}-\d{2}$/.test(param ?? '') ? param : isoDate(today()),
      start: '19:00',
      end: '',
      cost: '',
      note: '',
      surprise: false,
      hint: '',
      saveIdea: false,
      stations: [{ k: uid(), time: '', text: '', place: null }],
    });
  }
  const canSurprise = !!role && (store.syncInfo().mode !== 'shared' || partnerJoined());
  root.innerHTML = `
    ${topbar({ title: 'Eigenes Date', sub: 'Ihr habt schon etwas vor? Tragt es hier ein.', back: ['dates', '', 'Dates'] })}
    <form class="panel form" id="own-form" novalidate>
      <div class="field"><label class="label" for="o-title">Was habt ihr vor?</label><input class="input" id="o-title" maxlength="60" required placeholder="z. B. Konzert & Dinner" value="${esc(d.title)}"></div>
      <div class="field"><span class="label">Symbol</span>${chips('o-emoji', ['✨', ...EMOJIS.filter((e) => e !== '💡')].slice(0, 12).map((e) => [e, glyph(e)]), d.emoji, 'emoji-chips')}</div>
      <div class="field"><label class="label" for="o-date">Wann?</label><input class="input" type="date" id="o-date" value="${esc(d.date)}"></div>
      <div class="row gap">
        <div class="field grow"><label class="label" for="o-start">Von</label><input class="input" type="time" id="o-start" value="${esc(d.start)}"></div>
        <div class="field grow"><label class="label" for="o-end">Bis <small class="muted">(optional)</small></label><input class="input" type="time" id="o-end" value="${esc(d.end)}"></div>
      </div>

      <div class="field">
        <span class="label">Ablauf <small class="muted">(optional)</small></span>
        <div class="own-stations">
          ${d.stations.map((st, i) => `
            <div class="own-station" data-k="${st.k}">
              <div class="row gap">
                <input class="input own-time" type="time" data-st-time="${st.k}" value="${esc(st.time)}" aria-label="Uhrzeit Station ${i + 1}">
                <input class="input grow" data-st-text="${st.k}" maxlength="60" placeholder="${i === 0 ? 'z. B. Aperitif' : 'z. B. Abendessen'}" value="${esc(st.text)}" aria-label="Station ${i + 1}">
                ${d.stations.length > 1 ? `<button type="button" class="icon-btn small" data-st-del="${st.k}" aria-label="Station entfernen">${icon('x')}</button>` : ''}
              </div>
              ${locField(`o-loc-${st.k}`, st.place, 'Ort (optional), z. B. Restaurant oder Adresse')}
            </div>`).join('')}
        </div>
        <button type="button" class="linkish add-toggle" id="o-add">${icon('plus')}Station</button>
      </div>

      <div class="field"><label class="label" for="o-cost">Kosten ca. für euch beide (€)</label><input class="input" id="o-cost" inputmode="decimal" placeholder="z. B. 60" value="${esc(d.cost)}"></div>
      <div class="field"><label class="label" for="o-note">Notiz <small class="muted">(optional)</small></label><textarea class="input" id="o-note" rows="2" maxlength="300" placeholder="z. B. Tickets liegen in der Mail">${esc(d.note)}</textarea></div>
      ${canSurprise ? `
      <label class="switch"><input type="checkbox" id="o-surprise" ${d.surprise ? 'checked' : ''}><span><strong>Als Überraschung planen</strong><br><small class="muted">${esc(nameOf(other(role)))} sieht nur Tag, Uhrzeit und deinen Hinweis.</small></span></label>
      <div class="field" id="o-hint-field" ${d.surprise ? '' : 'hidden'}><label class="label" for="o-hint">Hinweis</label><input class="input" id="o-hint" maxlength="80" placeholder="z. B. Bequeme Schuhe anziehen" value="${esc(d.hint)}"></div>` : ''}
      ${community.api ? `<label class="switch"><input type="checkbox" id="o-share" ${d.share ? 'checked' : ''}><span><strong>Mit der Community teilen</strong><br><small class="muted">Aus: nur für euch zwei. An: andere Paare sehen Ablauf und Stadt – nie eure Adresse.</small></span></label>` : ''}
      <label class="switch"><input type="checkbox" id="o-idea" ${d.saveIdea ? 'checked' : ''}><span><strong>Auch als Idee merken</strong><br><small class="muted">Dann könnt ihr das Date später einfach wiederholen.</small></span></label>
      <button class="btn primary big" type="submit">${icon('check')}Date speichern</button>
    </form>`;

  bindBack();
  const form = $('#own-form');
  const read = () => {
    d.title = $('#o-title').value;
    d.date = $('#o-date').value;
    d.start = $('#o-start').value;
    d.end = $('#o-end').value;
    d.cost = $('#o-cost').value;
    d.note = $('#o-note').value;
    d.surprise = !!$('#o-surprise')?.checked;
    d.hint = $('#o-hint')?.value ?? '';
    d.saveIdea = $('#o-idea').checked;
    d.share = !!$('#o-share')?.checked;
    for (const st of d.stations) {
      st.time = $(`[data-st-time="${st.k}"]`)?.value ?? st.time;
      st.text = $(`[data-st-text="${st.k}"]`)?.value ?? st.text;
      const typed = $(`#o-loc-${st.k}`)?.value.trim() ?? '';
      if (st.place && typed !== st.place.name) st.place = typed ? { name: typed } : null;
      else if (!st.place && typed) st.place = { name: typed };
    }
  };
  bindChips(form, 'o-emoji', (v) => (d.emoji = v));
  for (const st of d.stations) bindLocField(`o-loc-${st.k}`, (g) => (st.place = { name: g.name, sub: g.sub, lat: g.lat, lon: g.lon, kind: g.gps ? 'adresse' : g.kind ?? 'adresse' }));
  $('#o-surprise')?.addEventListener('change', (e) => ($('#o-hint-field').hidden = !e.target.checked));
  $('#o-add').addEventListener('click', () => {
    read();
    d.stations.push({ k: uid(), time: '', text: '', place: null });
    render();
    $(`[data-st-text="${d.stations.at(-1).k}"]`)?.focus();
  });
  on('[data-st-del]', 'click', (_, el) => {
    read();
    d.stations = d.stations.filter((x) => x.k !== el.dataset.stDel);
    render();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    read();
    const title = d.title.trim();
    if (!title) {
      toast('Was habt ihr vor?');
      return $('#o-title').focus();
    }
    if (!d.date) {
      toast('Bitte ein Datum wählen');
      return $('#o-date').focus();
    }
    const start = d.start || '19:00';
    // Stationen mit Uhrzeiten: fehlende Zeiten im Stundentakt ergänzen
    const filled = d.stations.filter((x) => x.text.trim() || x.place?.name);
    let t = start;
    const timed = (filled.length ? filled : [{ text: title, place: null, time: start }]).map((x, i) => {
      const time = x.time || (i === 0 ? start : addMinutes(t, 60));
      t = time;
      return { ...x, time };
    });
    const endTime = d.end || addMinutes(timed.at(-1).time, timed.length > 1 ? 60 : 120);
    const steps = timed.map((x, i) => {
      const nextT = timed[i + 1]?.time ?? endTime;
      let min = toMin(nextT) - toMin(x.time);
      if (min <= 0) min += 24 * 60;
      const place = x.place?.name ? { name: x.place.name, street: x.place.sub ?? '', city: '', lat: x.place.lat ?? null, lon: x.place.lon ?? null, website: '', hours: '', price: '', image: '', category: '', kind: x.place.kind ?? 'adresse' } : null;
      const raw = { t: x.text.trim() || place?.name || title, min, ...(place?.lat != null ? { place } : place ? { q: place.name } : {}) };
      const step = { time: x.time, title: raw.t, min, note: '', links: stepLinks(raw, {}, { city: S().settings.city, vegan: S().settings.vegan }) };
      if (place?.lat != null) step.place = place;
      else if (place) step.note = place.name;
      return step;
    });
    let duration = toMin(endTime) - toMin(start);
    if (duration <= 0) duration += 24 * 60;
    const cost = Math.max(0, Math.round(Number(String(d.cost).replace(',', '.')) || 0));
    const ideaId = `eigen-${uid()}`;
    const plan = {
      ideaId, title, subtitle: '', emoji: d.emoji, teaser: d.note.trim(), place: '', moods: [], communityId: null, cost, duration,
      date: d.date, daytime: toMin(start) >= 17 * 60 ? 'abend' : 'tag', start, end: endTime, steps, recipe: null, todos: [], weather: null, own: true,
      ...(d.note.trim() ? { notes: d.note.trim() } : {}),
    };
    const id = uid();
    const surprise = d.surprise && !!role;
    const meta = { id, date: plan.date, start: plan.start, end: plan.end, daytime: plan.daytime, plannedBy: role ?? 'both', createdAt: Date.now(), ratings: {} };
    store.update((s) => {
      if (surprise) {
        s.dates.push({ ...meta, surprise: true, hint: d.hint.trim() });
        s.secrets[id] = { ...plan, checks: {} };
      } else {
        s.dates.push({ ...plan, ...meta, surprise: false });
      }
      if (meta.plannedBy === 'a' || meta.plannedBy === 'b') s.settings.nextTurn = other(meta.plannedBy);
      if (d.saveIdea) {
        s.ideas.push({
          id: ideaId, title, emoji: d.emoji, teaser: d.note.trim() || 'Euer eigenes Date', place: 'drinnen', cost, reach: 1,
          times: [plan.daytime], moods: [], custom: true, createdBy: role, createdAt: Date.now(),
          steps: steps.map((x) => ({ t: x.title, min: x.min, ...(x.place ? { place: x.place } : {}) })),
          start: { [plan.daytime]: start },
        });
      }
    });
    const share = d.share && !surprise;
    ownDraft.stations = [];
    ownDraft.key = null;
    ownDraft.share = false;
    nudgePush();
    toast(surprise ? 'Überraschung gespeichert' : 'Date gespeichert');
    go('date', id, { replace: true });
    if (share) go('teilen', `date:${id}`);
  });
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
        ${(role === 'b' ? ['b', 'a'] : ['a', 'b']).map((r) => `<div class="field grow"><label class="label" for="s-name${r.toUpperCase()}">${!role ? (r === 'a' ? 'Person 1' : 'Person 2') : r === role ? 'Dein Name' : 'Name deines Schatzes'}</label><input class="input" id="s-name${r.toUpperCase()}" data-set="name${r.toUpperCase()}" value="${esc(r === 'a' ? st.nameA : st.nameB)}" placeholder="Name"></div>`).join('')}
      </div>
      ${store.syncInfo().backend === 'supabase' ? '' : `<div class="field">
        <span class="label">Ich bin</span>
        ${chips('me', [['a', esc(nameOf('a'))], ['b', esc(nameOf('b'))]], role ?? '', 'seg')}
      </div>`}
    </section>

    <section class="panel form">
      <div class="panel-head">${icon(sync.mode === 'shared' ? 'users' : 'lock')}<h2>${store.syncInfo().backend === 'supabase' ? 'Partner' : 'Gemeinsam nutzen'}</h2></div>
      ${sharingHTML()}
    </section>

    <section class="panel form">
      <div class="panel-head">${icon('pin')}<h2>Ort & Vorlieben</h2></div>
      <div class="field">
        <label class="label" for="s-city">Euer Zuhause (Ort oder Adresse)</label>
        ${locField('s-city', st.geo ? { name: st.geo.name, sub: st.geo.sub ?? st.geo.country ?? '' } : st.city ? { name: st.city } : null)}
        <small class="muted">Von hier aus sucht Datewell Orte und berechnet Wege. Unterwegs nutzt Datewell auf Wunsch den aktuellen Standort.</small>
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
        ${st.specialDays.map((d) => `<li><span class="grow">${esc(d.kind === 'geburtstag' ? `Geburtstag ${d.who ? nameOf(d.who) : d.name}` : d.kind === 'standesamt' ? 'Hochzeitstag (Standesamt)' : d.kind === 'hochzeit' ? 'Hochzeitstag' : d.kind === 'verlobung' ? 'Tag der Verlobung' : d.kind === 'hochzeit-geplant' ? 'Eure Hochzeit' : d.name)}</span><span class="muted">${fmtDate(d.date, { day: 'numeric', month: 'long' })}</span><button class="icon-btn small" data-del-special="${d.id}" aria-label="Entfernen">${icon('x')}</button></li>`).join('')}
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
      <div class="panel-head">${icon('bell')}<h2>Mitteilungen</h2></div>
      <p>Erinnerungen am Vorabend und kurz vor dem Date, „Wie war’s?“ am Tag danach – und sofort, wenn ${esc(nameOf(other(myRole() ?? 'a')))} eine Überraschung plant, sich ein Date wünscht oder ihr ein Match habt. Überraschungen bleiben geheim.</p>
      ${!auth.cfg ? '<p class="muted small">Mitteilungen gibt es, sobald ihr ein gemeinsames Konto nutzt.</p>'
        : isIOS() && !isStandalone() ? `<p class="hint">${icon('share')} Auf dem iPhone funktionieren Mitteilungen nur, wenn Datewell auf dem Home-Bildschirm liegt: in Safari auf <strong>Teilen → „Zum Home-Bildschirm“</strong> tippen und Datewell von dort öffnen.</p>`
          : L().push?.on && window.Notification?.permission === 'granted'
            ? `<p class="small">${icon('check', 'inline')} Mitteilungen sind auf diesem Handy aktiv.</p><div class="row gap"><button class="btn sm" id="push-test">Test-Mitteilung</button><button class="btn ghost sm" id="push-off">Ausschalten</button></div>`
            : `<button class="btn primary" id="push-on">${icon('bell')}Mitteilungen aktivieren</button>`}
      ${auth.cfg && myRole() ? `
      <details class="push-types"><summary>Welche Mitteilungen?</summary>
        ${PUSH_KINDS.map(([k, l]) => `<label class="switch"><input type="checkbox" data-push-kind="${k}" ${(S().settings.pushOff?.[myRole()] ?? []).includes(k) ? '' : 'checked'}><span>${l}</span></label>`).join('')}
        <small class="muted">Zwischen 21 und 8 Uhr kommen nur Erinnerungen an geplante Dates, alles andere am Morgen.</small>
      </details>` : ''}
    </section>
    <section class="panel form">
      <div class="panel-head">${icon('star')}<h2>Weitere Datenquellen</h2></div>
      <p class="${serverStatus ? '' : 'muted '}small">${serverStatus ? `${icon('check', 'inline')} Datewell-Server ist eingerichtet: Orte kommen schnell über euren Supabase-Server${serverStatus.google ? ', Google-Bewertungen, Fotos und Öffnungszeiten ebenfalls – ein eigener Schlüssel unten ist nicht mehr nötig' : ''}.` : 'Tipp: Mit der Server-Funktion „places“ (Anleitung im README) laden Orte viel schneller und Google-Daten kommen sicher über euren Server.'}</p>
      <p><strong>Veranstaltungen</strong> (Konzerte, Shows, Theater, Festivals): Mit einem kostenlosen Ticketmaster-Schlüssel zeigt Datewell Veranstaltungen in eurem Umkreis und macht daraus Date-Ideen.</p>
      <div class="field"><label class="label" for="tm-key">Ticketmaster API Key</label><input class="input" id="tm-key" data-set="ticketmasterKey" value="${esc(S().settings.ticketmasterKey ?? '')}" placeholder="Consumer Key" autocomplete="off"><small class="muted">Kostenlos unter developer.ticketmaster.com → „Get your API Key“ (Anleitung im README).</small></div>
      <p><strong>Google-Bewertungen & Fotos:</strong> Mit einem eigenen Google-Places-Schlüssel zeigt die App bei Orten die Google-Sterne und ein Foto. Ohne Schlüssel gibt es Bilder aus Wikimedia und einen Link zu den Google-Bewertungen.</p>
      <div class="field"><label class="label" for="g-places">Places API Key</label><input class="input" id="g-places" data-set="googlePlacesKey" value="${esc(S().settings.googlePlacesKey ?? '')}" placeholder="AIza…" autocomplete="off"></div>
    </section>

    ${community.api ? `
    <section class="panel form" id="community-settings">
      <div class="panel-head">${icon('users')}<h2>Community</h2></div>
      ${commPrefs().rulesAt ? `<p>Eure geteilten Dates erscheinen ${displayNameFor() ? `als <strong>„${esc(displayNameFor())}“</strong>` : '<strong>ohne Namen</strong>'}.</p>
      ${chips('cm-mode', [['vorname', esc(firstName(myRole()) || 'Vorname')], ...(partnerJoined() ? [['paar', 'Paarname']] : []), ['fantasie', esc(commPrefs().alias || 'Fantasiename')]], commPrefs().mode ?? 'vorname', 'seg')}` : '<p class="muted small">Eigene Dates sind privat. Wenn ihr zum ersten Mal eines teilt, wählt ihr euren Anzeigenamen.</p>'}
      ${pairName()?.name ? `<small class="muted">Paarname „${esc(pairName().name)}“: ${pairAgreed() ? 'beide haben zugestimmt' : pairName().consent?.[other(myRole())] === false ? `${esc(nameOf(other(myRole())))} möchte das nicht` : `wartet auf ${esc(nameOf(other(myRole())))}`}</small>
      ${pairName().consent?.[myRole()] ? '<button class="linkish small" type="button" id="cm-revoke">Meine Zustimmung zum Paarnamen zurückziehen</button>' : ''}` : ''}
      <div class="row between"><span>Blockierte Personen: <strong id="cm-blocked">…</strong></span><button class="btn sm ghost" type="button" id="cm-unblock" hidden>Alle wieder anzeigen</button></div>
      <button class="btn soft" type="button" id="cm-mod" hidden>${icon('check')}Moderation öffnen</button>
    </section>` : ''}

    <section class="panel form">
      <div class="panel-head">${icon('download')}<h2>Daten & Rechtliches</h2></div>
      <button class="btn" id="export-me" type="button">${icon('download')}Meine Daten herunterladen</button>
      <small class="muted">Alle Daten, die Datewell zu dir speichert, als Datei – inklusive deiner geheimen Planungen.</small>
      ${legalLinks()}
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
  $('#push-on')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        await enablePush();
        toast('Mitteilungen sind aktiv');
        callNotify(auth.cfg, { action: 'test' }).catch(() => {});
      } catch (err) {
        toast(err.message);
      }
    });
    render();
  });
  $('#push-off')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, disablePush);
    toast('Mitteilungen ausgeschaltet');
    render();
  });
  on('[data-push-kind]', 'change', (_, el) => {
    const r = myRole();
    store.update((st) => {
      const off = new Set(st.settings.pushOff?.[r] ?? []);
      if (el.checked) off.delete(el.dataset.pushKind);
      else off.add(el.dataset.pushKind);
      st.settings.pushOff = { ...(st.settings.pushOff ?? {}), [r]: [...off] };
    });
  });
  $('#push-test')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        const r = await callNotify(auth.cfg, { action: 'test' });
        toast(r.devices ? 'Test-Mitteilung verschickt' : 'Kein Handy angemeldet – bitte neu aktivieren');
      } catch (err) {
        toast(err.message);
      }
    });
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
  bindLocField('s-city', (g) => {
    setHome(g);
    toast(`Zuhause: ${g.name}`);
  });
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
  on('[data-go]', 'click', (_, el) => go(el.dataset.go));
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
      toast('Diese Datei ist kein Datewell-Backup');
    }
  });
  $('#export-me')?.addEventListener('click', exportMyData);
  if ($('#community-settings')) {
    bindChips(root, 'cm-mode', (v) => {
      if ((v === 'paar' && !pairName()?.name) || (v === 'fantasie' && !commPrefs().alias)) {
        toast('Den Namen wählst du beim nächsten Teilen');
        return;
      }
      store.update((st) => {
        st.settings.community[myRole()] = { ...st.settings.community[myRole()], mode: v };
        if (v === 'paar') st.settings.communityPair.consent = { ...st.settings.communityPair.consent, [myRole()]: true };
      });
      session.namesSynced = undefined;
      syncCommunityNames().then(render);
    });
    $('#cm-revoke')?.addEventListener('click', () => {
      store.update((st) => (st.settings.communityPair.consent = { ...st.settings.communityPair.consent, [myRole()]: false }));
      session.namesSynced = undefined;
      syncCommunityNames();
      toast('Zustimmung zurückgezogen');
      render();
    });
    community.api.blockedCount().then((n) => {
      if (!$('#cm-blocked')) return;
      $('#cm-blocked').textContent = String(n);
      $('#cm-unblock').hidden = !n;
    });
    $('#cm-unblock').addEventListener('click', async (e) => {
      await withBusy(e.currentTarget, () => community.api.unblockAll());
      discover.community = null;
      toast('Alle Blockierungen aufgehoben');
      render();
    });
    community.api.isModerator().then((yes) => $('#cm-mod') && ($('#cm-mod').hidden = !yes));
    $('#cm-mod').addEventListener('click', () => go('moderation'));
  }
  bindLegalLinks();
  $('#export').addEventListener('click', () => {
    const { secrets, ...shared } = S();
    saveFile(`datewell-backup-${isoDate(today())}.json`, JSON.stringify(shared, null, 2), 'application/json');
  });
  armed($('#reset'), () => {
    store.reset();
    toast('Alles gelöscht');
    render(true);
  }, store.syncInfo().mode === 'shared' ? 'Nochmal tippen: alles für euch beide löschen' : 'Nochmal tippen: wirklich alles löschen');
  root.insertAdjacentHTML('beforeend', '<p class="signature"><span class="logo">Date<i>well</i></span> · <i>For the moments that matter.</i></p>');
};

/* ================================================================ Start */

(async function boot() {
  // Einladungslink zuerst lesen – der Router schreibt die Adresse gleich um
  const invite = readInvite();
  if (invite) history.replaceState(null, '', location.pathname);
  const initial = location.hash.replace('#', '');
  if (['kalender', 'dates', 'mehr', 'entdecken'].includes(initial)) current = { name: initial, param: null };
  const deep = parseHash(location.hash);
  if (deep) {
    current = { name: deep.name, param: deep.param };
    if (deep.tab) discover.tab = deep.tab;
  }
  navIdx = history.state?.dately ? history.state.idx ?? 0 : 0; // nach dem Neuladen bleibt der Verlauf erhalten
  history.replaceState({ dately: true, idx: navIdx }, '', hashOf(current));
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const m = String(e.data?.url ?? '').match(/#(date|match)\/([\w-]+)$/);
    if (e.data?.type === 'open' && m) go(m[1], m[2]);
  });
  try {
    await loadIdeas();
  } catch {
    /* ohne Ideenliste weiter */
  }
  if (invite?.invite) {
    setPendingInvite({ code: invite.invite });
    // Wer lädt ein? (ohne Konto abrufbar, verrät nur den Vornamen)
    invitationInfo({ url: SUPABASE.url, key: SUPABASE.key }, invite.invite).then((info) => {
      setPendingInvite({ code: invite.invite, ...info });
      if (current.name === 'konto') render();
    }).catch(() => {});
  } else if (invite) {
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
