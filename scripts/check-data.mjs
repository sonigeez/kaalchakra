// Checks the data files: unknown keys, duplicate ids, quiz cities alive in their quiz year,
// and coverage (core regions no mapped power holds, per era). Usage: node scripts/check-data.mjs [--cities a,b,c]
import fs from 'node:fs';
import vm from 'node:vm';
import { geoMercator } from 'd3-geo';

const root = new URL('../public/js/', import.meta.url);
const ctx = { window: {}, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext('var window = this.window; var KC;', ctx);
for (const f of ['data/polities.js', 'data/places.js', 'data/stories.js', 'data/towns.js', 'engine.js']) {
  const src = fs.readFileSync(new URL(f, root), 'utf8').replace('window.KC = window.KC || {};', 'window.KC = window.KC || {}; KC = window.KC;');
  vm.runInContext(src, ctx, { filename: f });
}
const KC = ctx.window.KC, E = KC.engine, errs = [];
const err = m => errs.push(m);
const dupes = (list, what) => { const s = new Set(); list.forEach(id => { if (s.has(id)) err(`duplicate ${what} id: ${id}`); s.add(id); }); };

dupes(KC.polities.map(p => p.id), 'polity');
dupes(KC.cities.map(c => c.id), 'city');
dupes(KC.towns.map(t => t.id), 'town');
dupes(KC.journeys.map(j => j.id), 'journey');
const PALETTE = new Set(['#c08a2a', '#8a9a48', '#3f7f62', '#8e3b5c', '#5d86b0', '#a65a32', '#3e5a8c', '#a8433f', '#6f8f6a', '#7a5a3a', '#d9822b', '#6b665e']);
for (const p of KC.polities) {
  p.phases.forEach(ph => {
    ph.regions.forEach(k => KC.regions[k] || err(`${p.id}: unknown region ${k}`));
    if (ph.from >= ph.to) err(`${p.id}: empty phase ${ph.key}`);
  });
  for (let i = 1; i < p.phases.length; i++) if (p.phases[i].from < p.phases[i - 1].to) err(`${p.id}: overlapping phases`);
  if (!PALETTE.has(p.color)) err(`${p.id}: colour ${p.color} not in the palette`);
  (p.rulers || []).forEach(r => { if (r[0] >= r[1]) err(`${p.id}: ruler ${r[2]} has empty dates`); });
  if (p.span[0] < E.MIN || p.span[1] > E.MAX + 1) err(`${p.id}: outside ${E.MIN}..${E.MAX}`);
}
const unusedRegions = Object.keys(KC.regions).filter(k => !KC.polities.some(p => p.phases.some(ph => ph.regions.includes(k))));
unusedRegions.forEach(k => err(`region ${k} is used by no power`));
const cityById = Object.fromEntries(KC.cities.map(c => [c.id, c]));
const alive = (c, y) => c.names.some(n => y >= n[0] && y < n[1]);
for (const c of KC.cities) {
  if (!Array.isArray(c.ll) || c.ll.length !== 2 || !c.fact || !c.names.length) err(`city ${c.id}: malformed`);
  c.names.forEach(n => { if (n[0] >= n[1]) err(`city ${c.id}: empty name span ${n[2]}`); });
}
for (const [id, y] of KC.quiz) { const c = cityById[id]; if (!c) err(`quiz: unknown city ${id}`); else if (!alive(c, y)) err(`quiz: ${id} has no name in ${y}`); }
dupes(KC.quiz.map(q => q[0] + '@' + q[1]), 'quiz');
for (const e of KC.events) {
  if (typeof e[2] === 'string' && !cityById[e[2]]) err(`event ${e[0]}: unknown city ${e[2]}`);
  if (e[0] < E.MIN || e[0] > E.MAX) err(`event ${e[0]} outside the timeline`);
}
for (const j of KC.journeys) {
  if (!j.id || !j.who || !j.title || !j.color || !j.years || !j.blurb) err(`journey ${j.id}: missing fields`);
  j.stops.forEach((s, k) => { if (s.length !== 4 || !Array.isArray(s[1])) err(`journey ${j.id}: stop ${k + 1} malformed`); if (k && s[0] < j.stops[k - 1][0]) err(`journey ${j.id}: stop ${k + 1} goes back in time`); });
}
for (const t of KC.towns) if (!t.id || !t.name || !t.region || !Number.isFinite(t.ll[0]) || !Number.isFinite(t.ll[1])) err(`town ${t.id}: malformed`);

// coverage: for each era, the share of sampled years in which no power holds a region's centre
const proj = geoMercator().fitExtent([[0, 0], [2000, 2000]], { type: 'MultiPoint', coordinates: [[66, 6.5], [93, 35.5]] });
const geo = E.bind(proj);
// the 48 original core regions, so coverage stays comparable as finer cores are added
const CORE = ('bactria kabul arachosia baluch gandhara kashmir punjab sindh kuru delhi doab kosala magadha anga bengal ebengal assam kalinga ' +
  'dkosala bundel malwa rajputana gujarat saurashtra khandesh vidarbha maha konkan goa telangana andhra karnN karnS tonda chola pandya ' +
  'kerala lanka kaushambi kashi vajji panchala mathura matsya ashmaka yaudheya padmavati tripuri').split(' ');
let emptyTotal = 0;
const rows = [];
for (const [a, b, name] of KC.eras) {
  const years = []; for (let y = a; y < b; y += 10) years.push(y || 1);
  const empty = CORE.filter(k => { const [x, y] = geo.base[k]; return years.filter(yr => geo.ownerAt(x, y, yr) < 0).length / years.length > .5; });
  emptyTotal += empty.length;
  rows.push(`${name.padEnd(22)} ${String(empty.length).padStart(3)} empty  ${empty.join(' ')}`);
}
console.log(`${KC.polities.length} powers, ${Object.keys(KC.regions).length} regions, ${KC.cities.length} cities, ${KC.events.length} events, ${KC.journeys.length} journeys, ${KC.quiz.length} quiz, ${KC.towns.length} towns`);
console.log('\nCore regions (the original 48) empty for most of each era:'); rows.forEach(r => console.log('  ' + r));
console.log(`  total empty region-eras: ${emptyTotal}`);

const want = (process.argv.find(a => a.startsWith('--cities=')) || '').slice(9);
if (want) {
  const townById = Object.fromEntries(KC.towns.map(t => [t.id, t]));
  for (const id of want.split(',')) {
    const t = townById[id]; if (!t) { console.log(`\n${id}: not in towns`); continue; }
    const [x, y] = proj(t.ll), h = geo.history(x, y);
    console.log(`\n${t.name} (${h.powers} powers, ${h.changes} changes): ` + h.ruled.map(r => `${E.PL[r.pi].name} ${r.from}..${r.to}`).join(' → '));
  }
}
if (errs.length) { console.log(`\n${errs.length} problem(s):`); errs.forEach(e => console.log('  ✗ ' + e)); process.exitCode = 1; }
else console.log('\nAll checks passed.');
