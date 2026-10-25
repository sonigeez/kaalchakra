// Builds worker/og-data.json: everything the Worker needs to write link previews.
// Uses the same engine as the app, so a preview never disagrees with the map.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { geoMercator, geoPath, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const root = new URL('../public/js/', import.meta.url);
const ctx = { window: {}, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext('var window = this.window; var KC;', ctx);
for (const f of ['data/polities.js', 'data/places.js', 'data/stories.js', 'data/towns.js', 'engine.js']) {
  const src = fs.readFileSync(new URL(f, root), 'utf8').replace('window.KC = window.KC || {};', 'window.KC = window.KC || {}; KC = window.KC;');
  vm.runInContext(src, ctx, { filename: f });
}
const KC = ctx.window.KC, E = KC.engine;

const box = { type: 'MultiPoint', coordinates: [[66, 6.5], [93, 35.5]] };
const land50 = feature(require('world-atlas/land-50m.json'), require('world-atlas/land-50m.json').objects.land);
const land110 = feature(require('world-atlas/land-110m.json'), require('world-atlas/land-110m.json').objects.land);

// scoring projection (any Mercator works; results are scale-free)
const proj = geoMercator().fitExtent([[0, 0], [2000, 2000]], box);
const geo = E.bind(proj);
// a coastal city may sit just offshore in the coastline data: step to the nearest land
function onLand(ll) {
  if (geoContains(land50, ll)) return ll;
  for (let r = .02; r <= .4; r += .02) for (let a = 0; a < 16; a++) {
    const p = [ll[0] + r * Math.cos(a / 16 * 2 * Math.PI), ll[1] + r * Math.sin(a / 16 * 2 * Math.PI)];
    if (geoContains(land50, p)) return p;
  }
  return ll;
}

// mini map used by every card: 360×400 box, India outline plus region circles
const MW = 360, MH = 400;
const mini = geoMercator().fitExtent([[10, 10], [MW - 10, MH - 10]], box).clipExtent([[-20, -20], [MW + 20, MH + 20]]);
const landPath = geoPath(mini).digits(1)(land110);
const pt = ll => mini(ll).map(v => +v.toFixed(1));
const BIG = ['Indus', 'Sutlej', 'Ganga', 'Yamuna', 'Brahmaputra', 'Narmada', 'Godavari', 'Krishna', 'Kaveri', 'Mahanadi'];
const riverPath = geoPath(mini).digits(1)({ type: 'MultiLineString', coordinates: KC.rivers.filter(r => BIG.includes(r[0])).map(r => r[1]) });
const regions = {};
for (const [k, [lon, lat, km]] of Object.entries(KC.regions)) {
  const c = mini([lon, lat]), e = mini([lon + km / (111.32 * Math.cos(lat * Math.PI / 180)), lat]);
  regions[k] = [+c[0].toFixed(1), +c[1].toFixed(1), +((e[0] - c[0]) * E.REACH * .8).toFixed(1)];
}

const PL = E.PL;
const towns = {};
for (const t of KC.towns) {
  const [px, py] = proj(onLand(t.ll)), h = geo.history(px, py);
  const top = [...h.total].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pi, yrs]) => pi);
  towns[t.id] = {
    name: t.name, region: t.region, xy: pt(t.ll), powers: h.powers, changes: h.changes,
    longest: h.longest ? [h.longest.p.name, h.longest.years] : null,
    first: h.ruled.length ? PL[h.ruled[0].pi].name : null,
    last: h.ruled.length ? PL[h.ruled[h.ruled.length - 1].pi].name : null,
    runs: h.runs.map(r => [r.from, r.to, r.pi]),
    names: top
  };
}
const out = {
  version: '',
  regions, landPath, riverPath, mini: [MW, MH],
  polities: PL.map(p => ({ name: p.name, color: p.color, conf: p.conf || null, culture: !!p.culture,
    phases: p.phases.map(ph => [ph.from, ph.to, ph.regions, E.areaOf(ph.regions)]), rulers: p.rulers || [] })),
  eras: KC.eras,
  towns,
  cities: Object.fromEntries(KC.cities.map(c => [c.id, { names: c.names, fact: c.fact, xy: pt(c.ll) }])),
  journeys: Object.fromEntries(KC.journeys.map(j => [j.id, { who: j.who, title: j.title, color: j.color,
    stops: j.stops.map(([y, ll, place, text]) => [y, pt(ll), place, text]) }]))
};
out.version = crypto.createHash('sha1').update(JSON.stringify(out)).digest('hex').slice(0, 8);
fs.writeFileSync(new URL('../worker/og-data.json', import.meta.url), JSON.stringify(out));
console.log(`og-data.json: ${Object.keys(towns).length} towns, ${PL.length} powers, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB, version ${out.version}`);
