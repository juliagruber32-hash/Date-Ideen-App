import * as store from './store.js';
import { isHiddenFromMe, myRole, nameOf, other } from './store.js';
import { geocode, getWeather, manualWeather } from './weather.js';
import { buildPlan, defaultStart, ideaDuration, loadIdeas, REACH, rhythmStatus, suggest, toICS } from './engine.js';
import { nearSpecial, specialsOn, upcomingSpecials } from './special.js';
import { icon } from './icons.js';
import {
  $, $$, addDays, daysBetween, esc, fmtDate, fmtDuration, fmtEuro, fmtShort, isoDate, MONTHS,
  parseISO, relDay, toast, today, uid, WD_SHORT, WEEKDAYS,
} from './util.js';

const S = () => store.get();
const L = () => store.getLocal();
const root = $('#view');
let IDEAS = [];
const ideaById = (id) => IDEAS.find((i) => i.id === id);

// Sitzungszustand des aktuellen Planungsablaufs (wird nicht gespeichert).
const session = { ctx: null, weather: null, shown: new Set(), current: [], exhausted: false, requestId: null, pollId: null };
const drafts = {}; // ungespeicherte Eingaben auf dem Plan-Bildschirm, pro Idee

/* ================================================================ Navigation */

const TAB_OF = { start: 'start', suggest: 'start', plan: 'start', poll: 'start', kalender: 'kalender', listen: 'listen', dates: 'dates', date: 'dates', mehr: 'mehr' };
const RENDER = {};
let current = { name: 'start', param: null };

function go(name, param = null) {
  current = { name, param };
  render(true);
}

function render(scrollTop = false) {
  $$('.tabbar button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === TAB_OF[current.name]));
  (RENDER[current.name] ?? RENDER.start)(current.param);
  if (scrollTop) window.scrollTo(0, 0);
}

$$('.tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

// Änderungen vom Partner live übernehmen, aber nicht mitten im Tippen neu zeichnen.
let pendingRender = false;
const isTyping = () => {
  const a = document.activeElement;
  if (!a || !root.contains(a)) return false;
  if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
  return a.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(a.type);
};
store.onChange((source) => {
  if (source === 'error' && store.syncInfo().writeError) toast(store.syncInfo().writeError);
  if (source === 'local') return;
  autoReveal();
  if (isTyping()) pendingRender = true;
  else render();
});
root.addEventListener('focusout', () => {
  if (!pendingRender) return;
  setTimeout(() => {
    if (!isTyping() && pendingRender) {
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

function weatherPill(w) {
  if (!w?.icon) return '';
  return `<span class="pill">${w.icon} ${w.temp != null ? `${w.temp}° · ` : ''}${esc(w.label)}</span>`;
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
  const shared = store.syncInfo().mode === 'shared';
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

/* ================================================================ 1. Start */

function inboxItems() {
  const s = S();
  const role = myRole();
  const t = isoDate(today());
  const items = [];

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

  for (const p of s.polls.filter((x) => x.status === 'open')) {
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

  const sp = upcomingSpecials(s.settings, 21)[0];
  if (sp) {
    const when = sp.days === 0 ? 'heute' : sp.days === 1 ? 'morgen' : `in ${sp.days} Tagen`;
    items.push(`
      <article class="inbox-item special">
        <div class="inbox-ico emoji">${sp.icon}</div>
        <div class="grow"><strong>${esc(sp.label)} ${when}</strong><p>${fmtDate(sp.iso)}</p></div>
        <button class="btn sm" data-special="${sp.iso}">Date planen</button>
      </article>`);
  }
  return items;
}

function nextPlanner() {
  const last = [...S().dates]
    .filter((d) => d.plannedBy === 'a' || d.plannedBy === 'b')
    .sort((x, y) => (y.date + y.start).localeCompare(x.date + x.start))[0];
  return last ? other(last.plannedBy) : 'a';
}

RENDER.start = () => {
  const s = S();
  const f = { ...L().lastSearch };
  const role = myRole();
  const partner = other(role);
  const r = rhythmStatus(s.dates, s.settings.datesPerMonth);
  const pct = Math.min(100, Math.round((r.thisMonth / r.goal) * 100));
  const inbox = inboxItems();
  const hasNames = s.settings.nameA || s.settings.nameB;
  const np = nextPlanner();

  root.innerHTML = `
    <header class="home-head">
      <div class="brand">${icon('heart', 'brand-mark')}<span>Date-Ideen</span></div>
      ${syncChip()}
    </header>
    <section class="hello">
      <p class="eyebrow">${hasNames ? `${esc(nameOf('a'))} & ${esc(nameOf('b'))}` : 'Zeit zu zweit'}</p>
      <h1>${role ? `Hallo ${esc(nameOf(role))}.` : 'Worauf habt ihr Lust?'}</h1>
    </section>

    ${whoAmICard()}

    ${inbox.length ? `<section class="stack"><h2 class="section-title">Für dich</h2>${inbox.join('')}</section>` : ''}

    <section class="rhythm ${r.due ? 'due' : ''}">
      <div class="rhythm-top">
        <div>
          <span class="kicker">${MONTHS[today().getMonth()]}</span>
          <strong class="rhythm-num">${r.thisMonth}<span>/${r.goal}</span></strong>
          <span class="muted">Dates</span>
        </div>
        <div class="rhythm-side">
          ${r.due ? `<span class="tag warn">Date fällig</span>` : r.thisMonth >= r.goal ? `<span class="tag ok">Ziel erreicht</span>` : ''}
          <span class="muted small">Als Nächstes plant <strong>${np === role ? 'du' : esc(nameOf(np))}</strong></span>
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
          ['partner', partner ? esc(nameOf(partner)) : 'Partner*in', 'gift'],
          ['both', 'Zusammen', 'users'],
        ], f.planner, 'seg')}
        <p class="hint" id="planner-hint"></p>
      </div>
      <div class="field">
        <span class="label">Wann?</span>
        ${chips('when', [['tonight', 'Heute Abend'], ['weekend', 'Wochenende'], ['date', 'Datum wählen']], f.when)}
        <input type="date" id="f-date" class="input" value="${esc(f.date && f.date >= isoDate(today()) ? f.date : isoDate(addDays(today(), 1)))}" min="${isoDate(today())}" ${f.when === 'date' ? '' : 'hidden'}>
      </div>
      <div class="field" id="daytime-field" ${f.when === 'tonight' ? 'hidden' : ''}>
        <span class="label">Tageszeit</span>
        ${chips('daytime', [['tag', 'Tagsüber', 'sun'], ['abend', 'Abends', 'moon']], f.daytime)}
      </div>
      <div class="field">
        <div class="label-row"><span class="label">Budget für euch beide</span><output id="budget-out" class="budget-out">${f.budget} €</output></div>
        <input type="range" id="f-budget" min="0" max="200" step="5" value="${f.budget}" aria-label="Budget in Euro">
        <div class="scale"><span>0 €</span><span>50</span><span>100</span><span>150</span><span>200 €</span></div>
      </div>
      <div class="field">
        <span class="label">Wie weit?</span>
        ${chips('reach', [[0, 'Zuhause', 'home'], [1, 'In der Stadt', 'city'], [2, 'Ausflug', 'car']], f.reach)}
      </div>
      <div class="field" id="city-field">
        <label class="label" for="f-city">Stadt</label>
        <div class="input-ico">${icon('pin')}<input id="f-city" class="input" placeholder="z. B. München" value="${esc(s.settings.city)}" autocomplete="address-level2"></div>
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
    const pn = partner ? nameOf(partner) : 'dein*e Partner*in';
    $('#planner-hint').textContent =
      p === 'me' ? `Du suchst die Idee aus und kannst sie als Überraschung vor ${pn} geheim halten.`
        : p === 'partner' ? `${pn} bekommt eine Anfrage und plant eine Überraschung für dich.`
          : 'Die App schlägt drei Ideen vor, ihr stimmt beide ab.';
    $('#f-submit').innerHTML = p === 'me' ? `${icon('sparkle')}Ideen finden` : p === 'partner' ? `${icon('gift')}Anfrage an ${esc(pn)} senden` : `${icon('vote')}Abstimmung starten`;
    $('#note-field').hidden = p !== 'partner';
  };
  updatePlanner();

  $('#f-budget').addEventListener('input', (e) => {
    f.budget = Number(e.target.value);
    $('#budget-out').textContent = `${f.budget} €`;
  });
  bindChips(form, 'planner', (v) => {
    f.planner = v;
    updatePlanner();
  });
  bindChips(form, 'when', (v) => {
    f.when = v;
    $('#f-date').hidden = v !== 'date';
    $('#daytime-field').hidden = v === 'tonight';
  });
  bindChips(form, 'daytime', (v) => (f.daytime = v));
  bindChips(form, 'reach', (v) => (f.reach = Number(v)));

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
    const ctx = { date: resolveDate(f), daytime: f.daytime, budget: f.budget, reach: f.reach };
    const city = $('#f-city').value.trim();

    if (f.planner === 'partner') {
      const note = $('#f-note').value.trim();
      store.update((st) => st.requests.push({ id: uid(), from: myRole(), to: other(myRole()), ctx, note, status: 'open', createdAt: Date.now() }));
      if (city) ensureGeo(city);
      toast(`Anfrage an ${nameOf(other(myRole()))} gesendet`);
      render(true);
      return;
    }
    const btn = $('#f-submit');
    await withBusy(btn, async () => {
      await prepareSession(ctx, city);
      if (f.planner === 'both') {
        const id = await createPoll();
        if (id) go('poll', id);
      } else go('suggest');
    });
  });

  bindWhoAmI();
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
  const geo = await ensureGeo(city);
  session.ctx = { ...ctx, special };
  session.weather = await getWeather(geo, ctx.date, ctx.daytime);
  session.shown = new Set();
  session.requestId = null;
  session.pollId = null;
  await reroll();
}

async function reroll(count = 3) {
  const recentIds = S().dates.slice(-8).map((d) => d.ideaId).filter(Boolean);
  const res = await suggest(session.ctx, session.weather, { exclude: session.shown, recentIds, count });
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
        <span class="idea-emoji" aria-hidden="true">${i.emoji}</span>
        <div class="grow">
          <h3>${esc(i.title)}</h3>
          <p class="teaser">${esc(i.teaser)}</p>
        </div>
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

function timeline(plan) {
  return `
    <ol class="timeline">
      ${plan.steps.map((s) => `
        <li>
          <time>${s.time}</time>
          <div class="tl-body">
            <strong>${esc(s.title)}</strong>
            ${s.note ? `<p class="note-text">${esc(s.note)}</p>` : ''}
            ${s.links?.length ? `<div class="links">${s.links.map((l) => `<a class="link" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}${icon('external')}</a>`).join('')}</div>` : ''}
          </div>
        </li>`).join('')}
      <li class="end"><time>${plan.end}</time><div class="tl-body"><span class="muted">Ende</span></div></li>
    </ol>`;
}

function planHead(plan, eyebrow = '') {
  const day = relDay(plan.date);
  return `
    <header class="plan-head">
      <span class="plan-emoji" aria-hidden="true">${plan.emoji}</span>
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

RENDER.plan = (ideaId) => {
  const idea = ideaById(ideaId);
  const ctx = session.ctx;
  if (!idea || !ctx) return go('start');
  const role = myRole();
  const partner = other(role);
  const fromPoll = !!session.pollId;
  const draft = (drafts[ideaId] ??= { start: defaultStart(idea, ctx.daytime), surprise: !fromPoll, hint: '' });
  const plan = buildPlan(idea, { ...ctx, start: draft.start }, S().settings, session.weather);

  root.innerHTML = `
    ${topbar({ title: '', back: fromPoll ? ['poll', session.pollId, 'Abstimmung'] : ['suggest', '', 'Vorschläge'] })}
    ${planHead(plan)}
    <div class="panel row between slim">
      <label for="p-start" class="label">Startzeit</label>
      <input type="time" id="p-start" class="input narrow" value="${plan.start}">
    </div>
    ${timeline(plan)}
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
      const req = s.requests.find((r) => r.id === session.requestId);
      if (req) Object.assign(req, { status: 'planned', dateId: id });
      const poll = s.polls.find((p) => p.id === session.pollId);
      if (poll) Object.assign(poll, { status: 'planned', dateId: id });
    });
    delete drafts[ideaId];
    session.requestId = null;
    session.pollId = null;
    toast(surprise ? `Überraschung eingetragen – ${nameOf(partner)} sieht nur das Datum` : 'Im Kalender eingetragen');
    go('date', id);
  });
};

/* ================================================================ Gespeichertes Date */

RENDER.date = (id) => {
  const d = S().dates.find((x) => x.id === id);
  if (!d) return go('dates');
  const role = myRole();
  const past = d.date < isoDate(today());

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
      <div class="actions"><button class="btn" id="ics">${icon('download')}In Handy-Kalender</button></div>`;
    bindBack();
    $('#ics').addEventListener('click', () => saveFile(`date-${d.date}.ics`, toICS({ ...d, title: `Überraschung von ${nameOf(d.plannedBy)}`, emoji: '🎁', steps: [] }), 'text/calendar'));
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
      </section>` : ''}
    ${timeline(plan)}
    ${mySurprise && (plan.todos.length || plan.recipe) ? `
      <section class="panel">
        <div class="panel-head">${icon('list')}<h2>Deine geheime Checkliste</h2></div>
        <ul class="items">
          ${[...plan.todos, ...(plan.recipe?.ingredients ?? []).map((x) => `Besorgen: ${x}`)].map((t) => `
            <li class="item ${secret.checks?.[t] ? 'done' : ''}"><label class="check"><input type="checkbox" data-check="${esc(t)}" ${secret.checks?.[t] ? 'checked' : ''}><span class="grow">${esc(t)}</span></label></li>`).join('')}
        </ul>
      </section>` : ''}
    <div class="actions">
      <button class="btn primary" id="ics">${icon('download')}In Handy-Kalender</button>
      ${!d.surprise && plan.recipe ? `<button class="btn" id="shop">${icon('cart')}Zutaten auf Einkaufsliste</button>` : ''}
      ${!d.surprise && plan.todos.length ? `<button class="btn" id="todos">${icon('check')}To-dos übernehmen</button>` : ''}
      ${mySurprise ? `<button class="btn" id="reveal">${icon('eye')}Überraschung jetzt auflösen</button>` : ''}
      <button class="btn ghost danger" id="del">${icon('trash')}Date löschen</button>
    </div>
    ${plan.recipe && !d.surprise ? `
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
  $('#ics').addEventListener('click', () => saveFile(`date-${plan.date}.ics`, toICS(plan), 'text/calendar'));
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
  const partner = other(role);
  const st = pollState(p);
  const ideas = st.rd.ideas.map(ideaById).filter(Boolean);
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
            <span class="idea-emoji" aria-hidden="true">${ideaById(mid)?.emoji ?? ''}</span>
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
      poll.rounds = { ...poll.rounds, [`r${poll.round}`]: { ideas: next.map((i) => i.id), votes: { a: {}, b: {} } } };
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
  for (const p of s.polls.filter((x) => x.status === 'open' && x.ctx.date === iso)) list.push({ type: 'pending', time: '', title: 'Abstimmung läuft', poll: p.id });
  for (const f of s.settings.fixed.filter((x) => x.weekday === date.getDay())) list.push({ type: 'fixed', time: f.time, title: f.title });
  for (const sp of specialsOn(s.settings, date)) list.push({ type: 'special', time: '', title: `${sp.icon} ${sp.label}` });
  for (const e of s.events.filter((x) => x.date === iso)) list.push({ type: 'event', time: e.time, title: e.title, who: e.who, id: e.id });
  for (const t of s.todos.filter((x) => x.due === iso && !x.done)) list.push({ type: 'todo', time: '', title: t.text });
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
        <span><i class="dot special"></i>Besonderer Tag</span><span><i class="dot event"></i>Termin</span>
      </div>
    </section>

    <section class="day" id="day">
      <h2>${relDay(cal.sel) ? relDay(cal.sel) + ', ' : ''}${fmtDate(cal.sel)}</h2>
      ${entries.length ? `<ul class="entries">${entries.map((e) => `
        <li class="entry ${e.type}">
          <span class="time">${e.time || ''}</span>
          ${e.date || e.poll ? `<button class="grow entry-link" ${e.date ? `data-open-date="${e.date}"` : `data-open-poll="${e.poll}"`}>${e.emoji ? `<span aria-hidden="true">${e.emoji}</span> ` : ''}${esc(e.title)}${icon('right')}</button>` : `<span class="grow">${esc(e.title)}${e.who ? ` <small class="muted">· ${esc(e.who)}</small>` : ''}</span>`}
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
    </section>`;

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
        <span class="idea-emoji" aria-hidden="true">${dateEmoji(d)}</span>
        <span class="grow">
          <strong>${esc(dateTitle(d))}</strong>
          <small class="muted">${relDay(d.date) ?? fmtShort(d.date)} · ${d.start} Uhr · ${esc(plannerLabel(d))}</small>
        </span>
        ${isPast ? (avg ? `<span class="score">${icon('heart')}${avg.toFixed(1).replace('.', ',')}</span>` : '<small class="muted">bewerten</small>') : d.surprise ? `<span class="tag">${icon(isHiddenFromMe(d) ? 'gift' : 'lock')}${isHiddenFromMe(d) ? 'Überraschung' : 'Geheim'}</span>` : icon('right', 'chev')}
      </button>`;
  };

  root.innerHTML = `
    ${topbar({ title: 'Unsere Dates' })}
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
  on('[data-open-date]', 'click', (_, el) => go('date', el.dataset.openDate));
};

/* ================================================================ 7. Mehr / Einstellungen */

RENDER.mehr = () => {
  const st = S().settings;
  const sync = store.syncInfo();
  const role = myRole();

  root.innerHTML = `
    ${topbar({ title: 'Einstellungen', sub: 'Einmal eintragen, die App erinnert euch.' })}

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
      ${sync.mode === 'shared' ? `
        <p>${sync.stale ? 'Die Verbindung zum gemeinsamen Speicher fehlt gerade.' : 'Dates, Kalender, Listen und Abstimmungen werden für euch beide gespeichert.'}</p>
        <ol class="steps-list">
          <li>Oben rechts auf <strong>Teilen</strong> tippen.</li>
          <li>Die E-Mail-Adresse deines Partners eintragen und als <strong>Editor</strong> einladen.</li>
          <li>Dein Partner öffnet den Link und wählt unter „Ich bin“ seinen Namen.</li>
        </ol>
        ${!sync.canWrite || sync.writeError ? `<p class="warn-text">${esc(sync.writeError ?? 'Du kannst hier nur lesen.')}</p>` : ''}
        <p class="muted small">Überraschungen liegen im privaten Bereich der planenden Person. Die andere Person sieht nur Datum, Uhrzeit und Hinweis.</p>
      ` : `
        <p>Diese Daten liegen nur auf diesem Gerät. Öffnet die App über den gemeinsamen Claude-Link, damit ihr beide dieselben Dates und Listen seht.</p>`}
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
      <div class="field"><label class="label" for="s-anniv">Jahrestag</label><input class="input" type="date" id="s-anniv" data-set="anniversary" value="${esc(st.anniversary)}"></div>
      <label class="switch"><input type="checkbox" id="s-val" data-set="valentine" ${st.valentine ? 'checked' : ''}><span><strong>An Valentinstag erinnern</strong></span></label>
      <ul class="mini-list">
        ${st.specialDays.map((d) => `<li><span class="grow">${d.kind === 'geburtstag' ? 'Geburtstag ' : ''}${esc(d.name)}</span><span class="muted">${fmtDate(d.date, { day: 'numeric', month: 'long' })}</span><button class="icon-btn small" data-del-special="${d.id}" aria-label="Entfernen">${icon('x')}</button></li>`).join('')}
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
      <div class="panel-head">${icon('download')}<h2>Daten</h2></div>
      <div class="row gap wrap">
        <button class="btn" id="export" type="button">${icon('download')}Backup speichern</button>
        <button class="btn ghost danger" id="reset" type="button">${icon('trash')}Alles löschen</button>
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
    if (k === 'nameA' || k === 'nameB') render();
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
  $('#export').addEventListener('click', () => {
    const { secrets, ...shared } = S();
    saveFile(`date-ideen-backup-${isoDate(today())}.json`, JSON.stringify(shared, null, 2), 'application/json');
  });
  armed($('#reset'), () => {
    store.reset();
    toast('Alles gelöscht');
    render(true);
  }, 'Nochmal tippen: wirklich alles löschen');
};

/* ================================================================ Start */

(async function boot() {
  const initial = location.hash.replace('#', '');
  if (TAB_OF[initial] && ['kalender', 'listen', 'dates', 'mehr'].includes(initial)) current = { name: initial, param: null };
  try {
    IDEAS = await loadIdeas();
  } catch {
    IDEAS = [];
  }
  render();
  autoReveal();
  store.connect().then(() => render());
})();
