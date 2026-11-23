// Kleine Helfer für DOM, Datum und Formatierung.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Lokales Datum als YYYY-MM-DD (keine Zeitzonen-Verschiebung wie bei toISOString). */
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const daysBetween = (a, b) => Math.round((b - a) / 86400000);

export const fmtDate = (iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  parseISO(iso).toLocaleDateString('de-DE', opts);

export const fmtShort = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });

export function relDay(iso) {
  const n = daysBetween(today(), parseISO(iso));
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === -1) return 'Gestern';
  return null;
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} Min.`;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

export const fmtEuro = (n) => (n === 0 ? 'kostenlos' : `ca. ${n} €`);

export function addMinutes(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (h * 60 + m + min + 24 * 60) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Nächstes Vorkommen eines jährlichen Tages (MM-DD) ab `from` (inklusive). */
export function nextOccurrence(mmdd, from = today()) {
  const [m, d] = mmdd.split('-').map(Number);
  let x = new Date(from.getFullYear(), m - 1, d);
  if (x < from) x = new Date(from.getFullYear() + 1, m - 1, d);
  return x;
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Datei im Browser herunterladen. */
export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
