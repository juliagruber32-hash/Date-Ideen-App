import * as store from './store.js';
import { geocode, getWeather } from './weather.js';
import { buildPlan, defaultStart, ideaDuration, loadIdeas, REACH, rhythmStatus, suggest, toICS } from './engine.js';
import { nearSpecial, specialsOn, upcomingSpecials } from './special.js';
import {
  $, $$, addDays, download, esc, fmtDate, fmtDuration, fmtEuro, fmtShort, isoDate, MONTHS,
  parseISO, relDay, toast, today, uid, WD_SHORT, WEEKDAYS,
} from './util.js';

const view = $('#view');
const S = () => store.get();

// Sitzungszustand für den Vorschlags-Ablauf (nicht gespeichert).
const session = { ctx: null, weather: null, shown: new Set(), current: [], exhausted: false };

/* ------------------------------------------------------------------ Router */

const routes = [
  [/^#\/?$/, renderStart],
  [/^#\/vorschlaege$/, renderSuggestions],
  [/^#\/plan\/([\w-]+)$/, renderNewPlan],
  [/^#\/date\/([\w-]+)$/, renderSavedPlan],
  [/^#\/kalender$/, renderCalendar],
  [/^#\/listen(?:\/(todo|einkauf))?$/, renderLists],
  [/^#\/dates$/, renderDates],
  [/^#\/einstellungen$/, renderSettings],
];

function router() {
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const tab = hash.match(/^#\/(kalender|listen|dates|einstellungen)/)?.[1] ?? (hash.startsWith('#/date/') ? 'dates' : 'start');
    $$('.tabbar a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === tab));
    window.scrollTo(0, 0);
    fn(...m.slice(1));
    return;
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', router);

/* ------------------------------------------------------------------ Bausteine */

const chips = (group, options, value) => `
  <div class="chips" role="group" data-group="${group}">
    ${options.map(([v, label]) => `<button type="button" class="chip" data-value="${esc(v)}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}
  </div>`;

function bindChips(root, group, onChange) {
  const wrap = $(`[data-group="${group}"]`, root);
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    $$('.chip', wrap).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    onChange(btn.dataset.value);
  });
}

const backLink = (href, label = 'Zurück') => `<a class="back" href="${href}">‹ ${label}</a>`;

const weatherPill = (w) =>
  w?.icon ? `<span class="pill">${w.icon} ${w.temp}° · ${esc(w.label)}</span>` : '';

/** Datum aus der Start-Auswahl auflösen. */
function resolveDate(ctx) {
  const t = today();
  if (ctx.when === 'tonight') return isoDate(t);
  if (ctx.when === 'weekend') {
    const dow = t.getDay();
    if (dow === 6 || dow === 0) return isoDate(t);
    return isoDate(addDays(t, 6 - dow));
  }
  return ctx.date || isoDate(t);
}

/* ------------------------------------------------------------------ 1. Start */

function remindersHTML() {
  const s = S();
  const out = [];
  if (!s.settings.city || !s.settings.anniversary) {
    out.push(`<a class="note note-setup" href="#/einstellungen">
      <span class="note-icon">👋</span>
      <span><strong>Kurz einrichten</strong><br>Stadt, Jahrestag und euer Date-Ziel eintragen – dauert eine Minute.</span></a>`);
  }
  const sp = upcomingSpecials(s.settings, 21)[0];
  if (sp) {
    const when = sp.days === 0 ? 'heute' : sp.days === 1 ? 'morgen' : `in ${sp.days} Tagen`;
    out.push(`<button class="note note-special" data-special="${sp.iso}">
      <span class="note-icon">${sp.icon}</span>
      <span><strong>${esc(sp.label)} ${when}</strong><br>${fmtDate(sp.iso)} – besonderes Date planen ›</span></button>`);
  }
  const r = rhythmStatus(s.dates, s.settings.datesPerMonth);
  const pct = Math.min(100, Math.round((r.thisMonth / r.goal) * 100));
  out.push(`<div class="note note-rhythm ${r.due ? 'due' : ''}">
    <span class="note-icon">${r.thisMonth >= r.goal ? '🎉' : r.due ? '⏰' : '💑'}</span>
    <span class="grow"><strong>${r.thisMonth} von ${r.goal} Dates</strong> diesen Monat
      ${r.due ? '<br>Ein Date ist fällig!' : r.thisMonth >= r.goal ? '<br>Ziel erreicht – stark!' : ''}
      <span class="progress"><span style="width:${pct}%"></span></span></span></div>`);
  return out.join('');
}

function renderStart() {
  const s = S();
  const f = { ...s.lastSearch };
  const { a, b } = store.names();
  const hasNames = s.settings.nameA || s.settings.nameB;

  view.innerHTML = `
    <header class="hero">
      <p class="eyebrow">${hasNames ? `${esc(a)} & ${esc(b)}` : 'Zeit zu zweit'}</p>
      <h1>Worauf habt ihr Lust?</h1>
    </header>
    <div class="stack">${remindersHTML()}</div>

    <form class="card form" id="start-form" novalidate>
      <div class="field">
        <span class="label">Wann wollt ihr los?</span>
        ${chips('when', [['tonight', 'Heute Abend'], ['weekend', 'Wochenende'], ['date', 'Datum']], f.when)}
        <input type="date" id="date" class="input" value="${esc(f.date || isoDate(addDays(today(), 1)))}" min="${isoDate(today())}" ${f.when === 'date' ? '' : 'hidden'}>
      </div>
      <div class="field" id="daytime-field" ${f.when === 'tonight' ? 'hidden' : ''}>
        <span class="label">Tageszeit</span>
        ${chips('daytime', [['tag', '☀️ Tagsüber'], ['abend', '🌙 Abends']], f.daytime)}
      </div>
      <div class="field">
        <span class="label">Budget für euch beide</span>
        <div class="budget">
          <output id="budget-out">${f.budget} €</output>
          <input type="range" id="budget" min="0" max="200" step="5" value="${f.budget}" aria-label="Budget in Euro">
        </div>
        ${chips('budget', [[0, '0 €'], [30, '30 €'], [80, '80 €'], [150, '150 €']], f.budget)}
      </div>
      <div class="field">
        <span class="label">Wie weit dürft ihr fahren?</span>
        ${chips('reach', [[0, '🏠 Zuhause'], [1, '🏙️ In der Stadt'], [2, '🚗 Ausflug']], f.reach)}
      </div>
      <label class="field">
        <span class="label">Stadt</span>
        <input id="city" class="input" placeholder="z. B. München" value="${esc(s.settings.city)}" autocomplete="address-level2">
      </label>
      <button class="btn primary big" id="find" type="submit">Date finden</button>
    </form>`;

  const form = $('#start-form');
  const budget = $('#budget');
  const setBudget = (v) => {
    f.budget = Number(v);
    budget.value = f.budget;
    $('#budget-out').textContent = `${f.budget} €`;
    $$('[data-group="budget"] .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === f.budget)));
  };
  budget.addEventListener('input', () => setBudget(budget.value));
  bindChips(form, 'budget', setBudget);
  bindChips(form, 'when', (v) => {
    f.when = v;
    $('#date').hidden = v !== 'date';
    $('#daytime-field').hidden = v === 'tonight';
  });
  bindChips(form, 'daytime', (v) => (f.daytime = v));
  bindChips(form, 'reach', (v) => (f.reach = Number(v)));

  $$('[data-special]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const ctx = { when: 'date', date: btn.dataset.special, daytime: 'abend', budget: Math.max(f.budget, 150), reach: 2, special: true };
      runSearch(ctx, btn);
    }),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    f.date = $('#date').value;
    if (f.when === 'tonight') f.daytime = 'abend';
    const ctx = { ...f };
    store.update((st) => (st.lastSearch = { ...f }));
    runSearch(ctx, $('#find'), $('#city').value.trim());
  });
}

async function ensureGeo(cityInput) {
  const s = S();
  const city = cityInput ?? s.settings.city;
  if (!city) return null;
  if (s.settings.geo && s.settings.city.toLowerCase() === city.toLowerCase()) return s.settings.geo;
  try {
    const geo = await geocode(city);
    if (!geo) {
      toast(`„${city}“ nicht gefunden – Wetter wird übersprungen`);
      return null;
    }
    store.update((st) => {
      st.settings.city = geo.name;
      st.settings.geo = geo;
    });
    return geo;
  } catch {
    store.update((st) => (st.settings.city = city));
    return null;
  }
}

async function runSearch(ctx, button, cityInput) {
  const label = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Suche …';
  }
  try {
    const date = resolveDate(ctx);
    const special = ctx.special ?? !!nearSpecial(S().settings, parseISO(date));
    const geo = await ensureGeo(cityInput);
    const weather = await getWeather(geo, date, ctx.daytime);
    session.ctx = { ...ctx, date, special };
    session.weather = weather;
    session.shown = new Set();
    await reroll();
    location.hash = '#/vorschlaege';
    if (location.hash === '#/vorschlaege') renderSuggestions();
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = label;
    }
  }
}

async function reroll() {
  const recentIds = S().dates.slice(-8).map((d) => d.ideaId);
  const res = await suggest(session.ctx, session.weather, { exclude: session.shown, recentIds });
  if (res.exhausted) session.shown = new Set();
  res.ideas.forEach((i) => session.shown.add(i.id));
  session.current = res.ideas;
  session.exhausted = res.exhausted;
}

/* ------------------------------------------------------------------ 2. Vorschläge */

function weatherBanner(w, ctx) {
  if (!w.known) return `<div class="banner muted">🌡️ ${esc(w.reason)} – wir schlagen drinnen & draußen vor.</div>`;
  if (w.wet) return `<div class="banner rain">${w.icon} ${esc(w.label)}, ${w.temp}° (Regenrisiko ${w.prob} %) – nur Drinnen-Ideen.</div>`;
  if (w.cold) return `<div class="banner cold">${w.icon} ${w.temp}° – eher frisch, Drinnen-Ideen bevorzugt.</div>`;
  return `<div class="banner sun">${w.icon} ${esc(w.label)}, ${w.temp}° – gutes Wetter für draußen!</div>`;
}

function renderSuggestions() {
  const { ctx, weather, current } = session;
  if (!ctx) return (location.hash = '#/');
  const sp = ctx.special ? nearSpecial(S().settings, parseISO(ctx.date)) : null;
  const day = relDay(ctx.date) ?? fmtDate(ctx.date);

  view.innerHTML = `
    ${backLink('#/', 'Ändern')}
    <header class="page-head">
      <h1>Eure Vorschläge</h1>
      <p class="sub">${esc(day)} · ${ctx.daytime === 'abend' ? 'abends' : 'tagsüber'} · bis ${ctx.budget} € · ${REACH[ctx.reach]}</p>
    </header>
    ${weatherBanner(weather, ctx)}
    ${sp ? `<div class="banner special">${sp.icon} ${esc(sp.label)} – besondere Ideen zuerst.</div>` : ''}
    <div class="cards">
      ${current.length ? current.map((i) => ideaCard(i)).join('') : `
        <div class="empty">
          <p class="big-emoji">🤷</p>
          <p>Nichts gefunden, das passt.<br>Erhöht das Budget oder die Entfernung.</p>
          <a class="btn" href="#/">Eingaben ändern</a>
        </div>`}
    </div>
    ${current.length ? `<button class="btn secondary big" id="reroll">🎲 Andere Ideen</button>` : ''}
    ${session.exhausted ? '<p class="hint center">Das waren alle passenden Ideen – es geht von vorne los.</p>' : ''}`;

  $('#reroll')?.addEventListener('click', async () => {
    await reroll();
    renderSuggestions();
  });
}

function ideaCard(i) {
  const w = session.weather;
  const wIcon = i.place === 'drinnen' ? '🏠' : w?.known ? w.icon : '🌳';
  return `
    <a class="idea-card" href="#/plan/${i.id}">
      <div class="idea-top">
        <span class="idea-emoji">${i.emoji}</span>
        <div class="grow">
          <h2>${esc(i.title)}</h2>
          <p class="teaser">${esc(i.teaser)}</p>
        </div>
      </div>
      <div class="meta">
        <span class="pill">${wIcon} ${i.place === 'drinnen' ? 'Drinnen' : 'Draußen'}</span>
        <span class="pill">💶 ${fmtEuro(i.cost)}</span>
        <span class="pill">⏱️ ${fmtDuration(ideaDuration(i))}</span>
        ${i.special ? '<span class="pill accent">✨ Besonders</span>' : ''}
      </div>
      <p class="flow">${i.steps.map((s) => esc(s.t)).join(' → ')}</p>
    </a>`;
}

/* ------------------------------------------------------------------ 3. Date-Plan */

async function renderNewPlan(ideaId) {
  const ideas = await loadIdeas();
  const idea = ideas.find((i) => i.id === ideaId);
  if (!idea) return (location.hash = '#/');
  const ls = S().lastSearch;
  const ctx = session.ctx ?? { ...ls, date: resolveDate(ls) };
  const state = { start: defaultStart(idea, ctx.daytime) };

  const draw = () => {
    const plan = buildPlan(idea, { ...ctx, start: state.start }, S().settings, session.weather);
    view.innerHTML = `
      ${backLink(session.ctx ? '#/vorschlaege' : '#/', 'Vorschläge')}
      ${planHeader(plan)}
      <label class="start-time card row">
        <span>Startzeit</span>
        <input type="time" id="start" class="input slim" value="${plan.start}">
      </label>
      ${timeline(plan)}
      ${plan.todos.length ? `<p class="hint">📌 Vorher erledigen: ${plan.todos.map(esc).join(', ')}</p>` : ''}
      <div class="actions sticky">
        <button class="btn primary big" id="save">📅 In Kalender eintragen</button>
      </div>`;
    $('#start').addEventListener('change', (e) => {
      if (e.target.value) {
        state.start = e.target.value;
        draw();
      }
    });
    $('#save').addEventListener('click', () => {
      const saved = { ...plan, id: uid(), createdAt: Date.now(), rating: 0 };
      store.update((st) => st.dates.push(saved));
      toast('Im Kalender eingetragen ✓');
      location.hash = `#/date/${saved.id}`;
    });
  };
  draw();
}

function planHeader(plan) {
  const day = relDay(plan.date);
  return `
    <header class="plan-head">
      <span class="plan-emoji">${plan.emoji}</span>
      <h1>${esc(plan.title)}</h1>
      <p class="sub">${day ? day + ', ' : ''}${fmtDate(plan.date)} · ${plan.start}–${plan.end} Uhr</p>
      <div class="meta center">
        ${weatherPill(plan.weather)}
        <span class="pill">💶 ${fmtEuro(plan.cost)}</span>
        <span class="pill">⏱️ ${fmtDuration(plan.duration)}</span>
      </div>
    </header>`;
}

function timeline(plan) {
  return `
    <ol class="timeline">
      ${plan.steps.map((s) => `
        <li>
          <time>${s.time}</time>
          <div class="tl-body">
            <strong>${esc(s.title)}</strong>
            ${s.note ? `<p class="note-text">${esc(s.note)}</p>` : ''}
            ${s.links.length ? `<div class="links">${s.links.map((l) => `<a class="link-btn" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>` : ''}
          </div>
        </li>`).join('')}
      <li class="end"><time>${plan.end}</time><div class="tl-body"><span class="muted">Ende</span></div></li>
    </ol>`;
}

function renderSavedPlan(id) {
  const plan = S().dates.find((d) => d.id === id);
  if (!plan) return (location.hash = '#/dates');
  const past = parseISO(plan.date) < today();

  view.innerHTML = `
    ${backLink('#/dates', 'Unsere Dates')}
    ${planHeader(plan)}
    ${past ? `
      <div class="card rate">
        <span>Wie war’s?</span>
        <div class="hearts" role="radiogroup" aria-label="Bewertung">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="heart" data-rate="${n}" aria-pressed="${n <= plan.rating}" aria-label="${n} von 5">${n <= plan.rating ? '❤️' : '🤍'}</button>`).join('')}
        </div>
      </div>` : ''}
    ${timeline(plan)}
    <div class="actions">
      <button class="btn primary" id="ics">📲 In Handy-Kalender</button>
      ${plan.recipe ? `<button class="btn" id="shop">🛒 Zutaten auf Einkaufsliste</button>` : ''}
      ${plan.todos.length ? `<button class="btn" id="todos">✅ To-dos übernehmen</button>` : ''}
      <button class="btn ghost danger" id="del">Date löschen</button>
    </div>
    ${plan.recipe ? `
      <details class="card recipe">
        <summary>🧾 ${esc(plan.recipe.name)} – ${plan.recipe.ingredients.length} Zutaten</summary>
        <ul>${plan.recipe.ingredients.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <a class="link-btn" href="${esc(plan.recipe.url)}" target="_blank" rel="noopener">Rezepte ansehen ↗</a>
      </details>` : ''}`;

  $$('.heart').forEach((h) =>
    h.addEventListener('click', () => {
      const n = Number(h.dataset.rate);
      store.update(() => (plan.rating = plan.rating === n ? 0 : n));
      renderSavedPlan(id);
    }),
  );
  $('#ics').addEventListener('click', () => download(`date-${plan.date}.ics`, toICS(plan), 'text/calendar'));
  $('#shop')?.addEventListener('click', () => {
    let added = 0;
    store.update((st) => {
      const have = new Set(st.shopping.filter((x) => !x.done).map((x) => x.text.toLowerCase()));
      for (const text of plan.recipe.ingredients) {
        if (have.has(text.toLowerCase())) continue;
        st.shopping.push({ id: uid(), text, done: false });
        added++;
      }
    });
    toast(added ? `${added} Zutaten auf der Einkaufsliste` : 'Steht schon alles drauf');
  });
  $('#todos')?.addEventListener('click', () => {
    let added = 0;
    store.update((st) => {
      const have = new Set(st.todos.filter((x) => !x.done).map((x) => x.text));
      const due = isoDate(addDays(parseISO(plan.date), -2)) < isoDate(today()) ? isoDate(today()) : isoDate(addDays(parseISO(plan.date), -2));
      for (const t of plan.todos) {
        const text = `${t} (${plan.title})`;
        if (have.has(text)) continue;
        st.todos.push({ id: uid(), text, who: 'beide', due, done: false });
        added++;
      }
    });
    toast(added ? `${added} To-do${added > 1 ? 's' : ''} hinzugefügt` : 'Schon auf der Liste');
  });
  $('#del').addEventListener('click', () => {
    if (!confirm('Dieses Date wirklich löschen?')) return;
    store.update((st) => (st.dates = st.dates.filter((d) => d.id !== id)));
    location.hash = '#/dates';
  });
}

/* ------------------------------------------------------------------ 4. Kalender */

const cal = { month: null, sel: null };

function entriesFor(date) {
  const s = S();
  const iso = isoDate(date);
  const list = [];
  for (const d of s.dates.filter((x) => x.date === iso)) list.push({ type: 'date', time: d.start, title: `${d.emoji} ${d.title}`, href: `#/date/${d.id}` });
  for (const f of s.settings.fixed.filter((x) => x.weekday === date.getDay())) list.push({ type: 'fixed', time: f.time, title: `🔁 ${f.title}` });
  for (const sp of specialsOn(s.settings, date)) list.push({ type: 'special', time: '', title: `${sp.icon} ${sp.label}` });
  for (const e of s.events.filter((x) => x.date === iso)) list.push({ type: 'event', time: e.time, title: e.title, who: e.who, id: e.id });
  for (const t of s.todos.filter((x) => x.due === iso && !x.done)) list.push({ type: 'todo', time: '', title: `☐ ${t.text}` });
  return list.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
}

function renderCalendar() {
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
  const offset = (m.getDay() + 6) % 7; // Montag zuerst
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const todayIso = isoDate(today());
  const { a, b } = store.names();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cal-cell empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const iso = isoDate(date);
    const types = [...new Set(entriesFor(date).map((e) => e.type))];
    cells.push(`
      <button class="cal-cell ${iso === todayIso ? 'today' : ''} ${iso === cal.sel ? 'sel' : ''} ${types.includes('date') ? 'has-date' : ''}" data-day="${iso}" aria-label="${fmtDate(iso)}">
        <span class="num">${d}</span>
        <span class="dots">${types.slice(0, 4).map((t) => `<i class="dot ${t}"></i>`).join('')}</span>
      </button>`);
  }

  const selDate = parseISO(cal.sel);
  const entries = entriesFor(selDate);

  view.innerHTML = `
    <header class="page-head"><h1>Unser Kalender</h1></header>
    <div class="card goal">
      <div class="row"><strong>${count} von ${goal} Dates</strong><span class="muted">${MONTHS[m.getMonth()]}</span></div>
      <span class="progress"><span style="width:${Math.min(100, (count / goal) * 100)}%"></span></span>
    </div>
    <div class="card cal">
      <div class="cal-nav">
        <button class="icon-btn" id="prev" aria-label="Vorheriger Monat">‹</button>
        <strong>${MONTHS[m.getMonth()]} ${m.getFullYear()}</strong>
        <button class="icon-btn" id="next" aria-label="Nächster Monat">›</button>
      </div>
      <div class="cal-grid head">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <div class="legend">
        <span><i class="dot date"></i>Date</span><span><i class="dot fixed"></i>Fester Termin</span>
        <span><i class="dot special"></i>Besonderer Tag</span><span><i class="dot event"></i>Eigener Termin</span>
      </div>
    </div>

    <section class="day">
      <h2>${relDay(cal.sel) ? relDay(cal.sel) + ', ' : ''}${fmtDate(cal.sel)}</h2>
      ${entries.length ? `<ul class="entries">${entries.map((e) => `
        <li class="entry ${e.type}">
          <span class="time">${e.time || '–'}</span>
          ${e.href ? `<a href="${e.href}" class="grow">${esc(e.title)}</a>` : `<span class="grow">${esc(e.title)}${e.who ? ` <small class="muted">· ${esc(e.who)}</small>` : ''}</span>`}
          ${e.type === 'event' ? `<button class="icon-btn small" data-del-event="${e.id}" aria-label="Termin löschen">×</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="muted">Noch nichts geplant.</p>'}
      <form class="card add-event" id="add-event">
        <input class="input grow" name="title" placeholder="Eigener Termin, z. B. Yoga" required>
        <div class="row gap">
          <input class="input slim" type="time" name="time" value="19:00" aria-label="Uhrzeit">
          <select class="input slim" name="who" aria-label="Wer">
            <option value="Beide">Beide</option><option value="${esc(a)}">${esc(a)}</option><option value="${esc(b)}">${esc(b)}</option>
          </select>
          <button class="btn primary">+</button>
        </div>
      </form>
      <a class="btn secondary big" href="#/" id="plan-here">💡 Date für diesen Tag finden</a>
    </section>`;

  $('#prev').addEventListener('click', () => {
    cal.month = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    renderCalendar();
  });
  $('#next').addEventListener('click', () => {
    cal.month = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    renderCalendar();
  });
  $$('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      cal.sel = btn.dataset.day;
      renderCalendar();
      $('.day').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }),
  );
  $$('[data-del-event]').forEach((btn) =>
    btn.addEventListener('click', () => {
      store.update((st) => (st.events = st.events.filter((e) => e.id !== btn.dataset.delEvent)));
      renderCalendar();
    }),
  );
  $('#add-event').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const title = String(fd.get('title')).trim();
    if (!title) return;
    store.update((st) => st.events.push({ id: uid(), date: cal.sel, time: fd.get('time'), title, who: fd.get('who') }));
    renderCalendar();
  });
  $('#plan-here').addEventListener('click', () => {
    const past = cal.sel < todayIso;
    store.update((st) => {
      st.lastSearch.when = 'date';
      st.lastSearch.date = past ? todayIso : cal.sel;
    });
  });
}

/* ------------------------------------------------------------------ 5. Listen */

function renderLists(tab = 'todo') {
  const s = S();
  const { a, b } = store.names();
  const isTodo = tab === 'todo';
  const items = isTodo ? s.todos : s.shopping;
  const open = items.filter((x) => !x.done);
  const done = items.filter((x) => x.done);
  const whoLabel = (w) => (w === 'a' ? a : w === 'b' ? b : 'Beide');

  const row = (x) => `
    <li class="item ${x.done ? 'done' : ''}">
      <label class="check">
        <input type="checkbox" data-toggle="${x.id}" ${x.done ? 'checked' : ''}>
        <span class="grow">${esc(x.text)}
          ${isTodo && (x.who || x.due) ? `<small class="muted">${x.who ? '👤 ' + esc(whoLabel(x.who)) : ''}${x.due ? ` · 📅 ${fmtShort(x.due)}` : ''}</small>` : ''}
        </span>
      </label>
      <button class="icon-btn small" data-del="${x.id}" aria-label="Löschen">×</button>
    </li>`;

  view.innerHTML = `
    <header class="page-head"><h1>Listen</h1></header>
    <nav class="tabs">
      <a href="#/listen/todo" aria-current="${isTodo}">✅ To-do <span class="count">${s.todos.filter((x) => !x.done).length}</span></a>
      <a href="#/listen/einkauf" aria-current="${!isTodo}">🛒 Einkauf <span class="count">${s.shopping.filter((x) => !x.done).length}</span></a>
    </nav>
    <form class="card add-item" id="add">
      <div class="row gap">
        <input class="input grow" name="text" placeholder="${isTodo ? 'z. B. Tisch reservieren' : 'z. B. Erdbeeren'}" required autocomplete="off">
        <button class="btn primary" aria-label="Hinzufügen">+</button>
      </div>
      ${isTodo ? `
        <div class="row gap">
          <select class="input slim" name="who" aria-label="Zuständig">
            <option value="beide">👥 Beide</option><option value="a">👤 ${esc(a)}</option><option value="b">👤 ${esc(b)}</option>
          </select>
          <input class="input slim" type="date" name="due" aria-label="Fällig am">
        </div>` : ''}
    </form>
    ${open.length ? `<ul class="items card">${open.map(row).join('')}</ul>` : `<p class="muted center">${isTodo ? 'Alles erledigt 🎉' : 'Die Einkaufsliste ist leer.'}</p>`}
    ${done.length ? `
      <details class="done-list">
        <summary>Erledigt (${done.length})</summary>
        <ul class="items card">${done.map(row).join('')}</ul>
        <button class="btn ghost" id="clear">Erledigte löschen</button>
      </details>` : ''}`;

  const key = isTodo ? 'todos' : 'shopping';
  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const text = String(fd.get('text')).trim();
    if (!text) return;
    const item = { id: uid(), text, done: false };
    if (isTodo) Object.assign(item, { who: fd.get('who'), due: fd.get('due') || '' });
    store.update((st) => st[key].push(item));
    renderLists(tab);
    $('#add input[name=text]').focus();
  });
  $$('[data-toggle]').forEach((cb) =>
    cb.addEventListener('change', () => {
      store.update((st) => {
        const it = st[key].find((x) => x.id === cb.dataset.toggle);
        if (it) it.done = cb.checked;
      });
      setTimeout(() => renderLists(tab), 180);
    }),
  );
  $$('[data-del]').forEach((btn) =>
    btn.addEventListener('click', () => {
      store.update((st) => (st[key] = st[key].filter((x) => x.id !== btn.dataset.del)));
      renderLists(tab);
    }),
  );
  $('#clear')?.addEventListener('click', () => {
    store.update((st) => (st[key] = st[key].filter((x) => !x.done)));
    renderLists(tab);
  });
}

/* ------------------------------------------------------------------ 6. Unsere Dates */

function renderDates() {
  const s = S();
  const t = isoDate(today());
  const upcoming = s.dates.filter((d) => d.date >= t).sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  const past = s.dates.filter((d) => d.date < t).sort((x, y) => y.date.localeCompare(x.date));

  const item = (d, isPast) => `
    <a class="date-item card" href="#/date/${d.id}">
      <span class="idea-emoji">${d.emoji}</span>
      <span class="grow">
        <strong>${esc(d.title)}</strong>
        <small class="muted">${relDay(d.date) ?? fmtShort(d.date)} · ${d.start} Uhr · ${fmtEuro(d.cost)}</small>
      </span>
      ${isPast ? `<span class="stars">${d.rating ? '❤️'.repeat(d.rating) : '<small class="muted">bewerten</small>'}</span>` : '<span class="chev">›</span>'}
    </a>`;

  view.innerHTML = `
    <header class="page-head"><h1>Unsere Dates</h1></header>
    <section>
      <h2 class="section-title">Geplant</h2>
      ${upcoming.length ? upcoming.map((d) => item(d, false)).join('') : `
        <div class="empty small"><p>Noch kein Date geplant.</p><a class="btn primary" href="#/">Date finden</a></div>`}
    </section>
    <section>
      <h2 class="section-title">Vergangen</h2>
      ${past.length ? past.map((d) => item(d, true)).join('') : '<p class="muted">Hier sammeln sich eure Erinnerungen.</p>'}
    </section>`;
}

/* ------------------------------------------------------------------ 7. Einstellungen */

function renderSettings() {
  const st = S().settings;
  view.innerHTML = `
    <header class="page-head"><h1>Einstellungen</h1><p class="sub">Einmal eintragen – die App erinnert euch.</p></header>

    <section class="card form">
      <h2>Ihr zwei</h2>
      <div class="row gap">
        <label class="field grow"><span class="label">Name 1</span><input class="input" data-set="nameA" value="${esc(st.nameA)}" placeholder="z. B. Julia"></label>
        <label class="field grow"><span class="label">Name 2</span><input class="input" data-set="nameB" value="${esc(st.nameB)}" placeholder="z. B. Alex"></label>
      </div>
      <label class="field"><span class="label">Stadt (für Wetter & Orte)</span>
        <div class="row gap"><input class="input grow" id="set-city" value="${esc(st.city)}" placeholder="z. B. München"><button class="btn" id="check-city" type="button">Prüfen</button></div>
        <small class="muted" id="city-info">${st.geo ? `📍 ${esc(st.geo.name)}, ${esc(st.geo.country)}` : ''}</small>
      </label>
      <label class="switch"><input type="checkbox" data-set="vegan" ${st.vegan ? 'checked' : ''}><span>🌱 Vegane Restaurants & Rezepte bevorzugen</span></label>
    </section>

    <section class="card form">
      <h2>Date-Rhythmus</h2>
      <div class="row between">
        <span>Dates pro Monat</span>
        <div class="stepper">
          <button class="icon-btn" data-step="-1" type="button" aria-label="Weniger">−</button>
          <output id="per-month">${st.datesPerMonth}</output>
          <button class="icon-btn" data-step="1" type="button" aria-label="Mehr">+</button>
        </div>
      </div>
    </section>

    <section class="card form">
      <h2>Besondere Tage</h2>
      <label class="field"><span class="label">💍 Jahrestag</span><input class="input" type="date" data-set="anniversary" value="${esc(st.anniversary)}"></label>
      <label class="switch"><input type="checkbox" data-set="valentine" ${st.valentine ? 'checked' : ''}><span>💘 An Valentinstag erinnern</span></label>
      <ul class="mini-list">
        ${st.specialDays.map((d) => `<li><span>${d.kind === 'geburtstag' ? '🎂' : '⭐'} ${esc(d.name)}</span><span class="muted">${fmtDate(d.date, { day: 'numeric', month: 'long' })}</span><button class="icon-btn small" data-del-special="${d.id}" aria-label="Entfernen">×</button></li>`).join('')}
      </ul>
      <form id="add-special" class="stack-sm">
        <div class="row gap">
          <select class="input slim" name="kind" aria-label="Art"><option value="geburtstag">🎂 Geburtstag</option><option value="sonstiges">⭐ Sonstiges</option></select>
          <input class="input grow" name="name" placeholder="Name / Anlass" required>
        </div>
        <div class="row gap"><input class="input grow" type="date" name="date" required aria-label="Datum"><button class="btn">Hinzufügen</button></div>
      </form>
    </section>

    <section class="card form">
      <h2>Feste Termine</h2>
      <ul class="mini-list">
        ${st.fixed.map((f) => `<li><span>🔁 ${esc(f.title)}</span><span class="muted">${WD_SHORT[f.weekday]} ${f.time}</span><button class="icon-btn small" data-del-fixed="${f.id}" aria-label="Entfernen">×</button></li>`).join('') || '<li class="muted">z. B. jeden Freitag Date-Night</li>'}
      </ul>
      <form id="add-fixed" class="stack-sm">
        <input class="input" name="title" placeholder="z. B. Date-Night" required>
        <div class="row gap">
          <select class="input slim" name="weekday" aria-label="Wochentag">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === 5 ? 'selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select>
          <input class="input slim" type="time" name="time" value="19:00" aria-label="Uhrzeit">
          <button class="btn">+</button>
        </div>
      </form>
    </section>

    <section class="card form">
      <h2>Daten</h2>
      <p class="muted">Alles wird nur auf diesem Gerät gespeichert.</p>
      <div class="row gap">
        <button class="btn" id="export" type="button">Backup herunterladen</button>
        <button class="btn ghost danger" id="reset" type="button">Alles löschen</button>
      </div>
    </section>`;

  $$('[data-set]').forEach((el) =>
    el.addEventListener('change', () => {
      const k = el.dataset.set;
      store.update((s) => (s.settings[k] = el.type === 'checkbox' ? el.checked : el.value.trim()));
      toast('Gespeichert');
    }),
  );

  const checkCity = async () => {
    const name = $('#set-city').value.trim();
    const info = $('#city-info');
    if (!name) {
      store.update((s) => {
        s.settings.city = '';
        s.settings.geo = null;
      });
      info.textContent = '';
      return;
    }
    info.textContent = 'Suche …';
    try {
      const geo = await geocode(name);
      if (!geo) {
        info.textContent = `„${name}“ nicht gefunden.`;
        return;
      }
      store.update((s) => {
        s.settings.city = geo.name;
        s.settings.geo = geo;
      });
      $('#set-city').value = geo.name;
      info.textContent = `📍 ${geo.name}, ${geo.country}`;
    } catch {
      store.update((s) => (s.settings.city = name));
      info.textContent = 'Offline – Stadt gespeichert, Wetter folgt später.';
    }
  };
  $('#check-city').addEventListener('click', checkCity);
  $('#set-city').addEventListener('change', checkCity);

  $$('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      store.update((s) => (s.settings.datesPerMonth = Math.min(12, Math.max(1, s.settings.datesPerMonth + Number(btn.dataset.step)))));
      $('#per-month').textContent = S().settings.datesPerMonth;
    }),
  );

  $('#add-special').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    store.update((s) => s.settings.specialDays.push({ id: uid(), name: String(fd.get('name')).trim(), date: fd.get('date'), kind: fd.get('kind') }));
    renderSettings();
  });
  $$('[data-del-special]').forEach((btn) =>
    btn.addEventListener('click', () => {
      store.update((s) => (s.settings.specialDays = s.settings.specialDays.filter((d) => d.id !== btn.dataset.delSpecial)));
      renderSettings();
    }),
  );
  $('#add-fixed').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    store.update((s) => s.settings.fixed.push({ id: uid(), title: String(fd.get('title')).trim(), weekday: Number(fd.get('weekday')), time: fd.get('time') }));
    renderSettings();
  });
  $$('[data-del-fixed]').forEach((btn) =>
    btn.addEventListener('click', () => {
      store.update((s) => (s.settings.fixed = s.settings.fixed.filter((f) => f.id !== btn.dataset.delFixed)));
      renderSettings();
    }),
  );
  $('#export').addEventListener('click', () => download(`date-ideen-backup-${isoDate(today())}.json`, JSON.stringify(S(), null, 2), 'application/json'));
  $('#reset').addEventListener('click', () => {
    if (!confirm('Wirklich alle Daten (Dates, Listen, Einstellungen) löschen?')) return;
    store.reset();
    toast('Alles zurückgesetzt');
    renderSettings();
  });
}

/* ------------------------------------------------------------------ Start */

router();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
