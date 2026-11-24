// Automatische Prüfungen für Datewell – laufen bei jeder Änderung (GitHub Actions) und lokal mit:
//   node tests/run.mjs
// Geprüft werden die Logik ohne Browser: Öffnungszeiten, Ortsarten, Date-Abläufe, Mitteilungen.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}\n  ${e.message}`);
  }
}

const places = await import(pathToFileURL(join(root, 'js/places.js')).href);
const gen = await import(pathToFileURL(join(root, 'js/generate.js')).href);

await test('Öffnungszeiten werden richtig gelesen', () => {
  const tue = new Date('2026-11-24T14:00:00');
  const mon = new Date('2026-11-23T14:00:00');
  assert.equal(places.isOpenAt('Mo off; Tu-Su 10:00-18:00', tue), true);
  assert.equal(places.isOpenAt('Mo off; Tu-Su 10:00-18:00', mon), false);
  assert.equal(places.isOpenAt('Fr 18:00-01:00', new Date('2026-11-28T00:30:00')), true); // über Mitternacht
});

await test('Jede Station einer Idee bekommt eine sinnvolle Ortsart', () => {
  const ideas = JSON.parse(readFileSync(join(root, 'data/ideas.json'), 'utf8'));
  assert.ok(ideas.length >= 70, 'zu wenige Ideen');
  const ids = new Set();
  for (const i of ideas) {
    assert.ok(!ids.has(i.id), `doppelte Idee ${i.id}`);
    ids.add(i.id);
    for (const s of i.steps) {
      const c = places.catForStep(s, '2026-06-01');
      if (c) assert.ok(places.categoryById(c), `${i.id}: unbekannte Ortsart ${c}`);
    }
  }
  assert.equal(places.catForStep({ t: 'Weinprobe', q: 'Weinbar' }), 'wine');
  assert.equal(places.catForStep({ t: 'Schwarzlicht-Minigolf', q: 'Schwarzlicht Minigolf' }), 'blacklight');
  assert.equal(places.catForStep({ t: 'Anfahrt', q: 'Therme' }), null);
});

await test('Weinbar ist Aperitif vor dem Essen, Essen gegen 18:45', async () => {
  const P = (id, cat, name, extra = {}) => ({ id, category: cat, name, lat: 48.3, lon: 11.9, km: 3, hours: '', ...extra });
  const groups = { wine: [P('w1', 'wine', 'Vin')], restaurant: [P('r1', 'restaurant', 'Asia Wok', { cuisine: 'Asiatisch' }), P('r2', 'restaurant', 'Trattoria', { cuisine: 'Italienisch' })] };
  const out = await gen.generateLocalDates({ center: { lat: 48.3, lon: 11.9 }, radiusKm: 15, daytime: 'abend', date: '2026-11-27', mainList: groups.wine, groups: { ...groups, cafe: [], xmas: [] } });
  const d = out[0];
  assert.equal(d.steps[0].label, 'Aperitif');
  assert.match(d.steps[1].t, /Trattoria/, 'zum schicken Weinlokal kein Imbiss');
  assert.equal(d.start.abend, '17:45');
});

await test('Mitteilungen: Überraschungen bleiben geheim', async () => {
  // Server-Funktion ohne web-push laden
  const src = readFileSync(join(root, 'supabase/functions/notify/index.ts'), 'utf8').replace(/^import webpush.*$/m, 'const webpush = {};');
  const dir = mkdtempSync(join(tmpdir(), 'dw-'));
  writeFileSync(join(dir, 'notify.mjs'), src);
  globalThis.Deno = { env: { get: () => '' } };
  const { dueNotifications } = await import(pathToFileURL(join(dir, 'notify.mjs')).href);
  const docs = {
    'shared/settings': { nameA: 'Julia', nameB: 'Maxi' },
    'dates/d1': { id: 'd1', date: '2026-11-25', start: '19:00', plannedBy: 'a', surprise: true, hint: 'Warme Schuhe', createdAt: Date.now() },
  };
  const list = dueNotifications({ docs, now: { date: '2026-11-24', time: '18:30' }, secrets: { d1: { title: 'Eislaufen' } } });
  const forB = list.filter((n) => n.role === 'b').map((n) => n.title + n.body).join(' ');
  assert.ok(!forB.includes('Eislaufen'), 'Maxi darf den Titel der Überraschung nicht sehen');
  assert.ok(list.some((n) => n.role === 'a' && n.body.includes('Eislaufen')));
});

await test('Rechtliche Seiten sind vorhanden', async () => {
  const legal = await import(pathToFileURL(join(root, 'js/legal.js')).href);
  for (const f of [legal.impressumHTML, legal.datenschutzHTML, legal.agbHTML]) assert.ok(f().length > 500);
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
