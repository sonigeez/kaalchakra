(() => {
'use strict';
const KC = window.KC;
const $ = s => document.querySelector(s);
const { MIN, MAX, REACH, PL, pIndex, rng, fbm, ANG, areaOf, activeAt, BOUNDS } = KC.engine;
const SEG = [[-2600, 0], [-600, 0.14], [MAX, 1]];   // compress the long Bronze/Vedic span

// ---------- helpers
const fmtY = y => y < 0 ? `${-y} BCE` : `${y} CE`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const hav = (a, b) => {
  const r = Math.PI / 180, dLat = (b[1]-a[1])*r, dLon = (b[0]-a[0])*r;
  const s = Math.sin(dLat/2)**2 + Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dLon/2)**2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
};
const inR = (y, a, b) => y >= a && y < b;
function y2p(y) {
  for (let i = 1; i < SEG.length; i++) if (y <= SEG[i][0]) {
    const [y0, p0] = SEG[i-1], [y1, p1] = SEG[i];
    return p0 + (y - y0) / (y1 - y0) * (p1 - p0);
  }
  return 1;
}
function p2y(p) {
  p = Math.max(0, Math.min(1, p));
  for (let i = 1; i < SEG.length; i++) if (p <= SEG[i][1]) {
    const [y0, p0] = SEG[i-1], [y1, p1] = SEG[i];
    return Math.round(y0 + (p - p0) / (p1 - p0) * (y1 - y0));
  }
  return MAX;
}
const isMobile = () => innerWidth < 760;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200);
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

// ---------- data prep
const cityById = Object.fromEntries(KC.cities.map(c => [c.id, c]));
const cityName = (c, y) => { const n = c.names.find(n => inR(y, n[0], n[1])); return n ? n[2] : null; };
const rulerOf = (p, y) => { const r = (p.rulers || []).find(r => inR(y, r[0], r[1])); return r ? r[2] : null; };
const evLL = e => typeof e[2] === 'string' ? cityById[e[2]].ll : e[2];
function polityAtPoint(ll, y) {
  if (y === state.year && G.target) {           // what the map shows: nearest owned land cell
    const [x, yy] = projection(ll), gx = Math.floor((x - G.x0) / G.cell), gy = Math.floor((yy - G.y0) / G.cell);
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const cx = gx + dx, cy = gy + dy;
      if (cx < 0 || cy < 0 || cx >= G.w || cy >= G.h) continue;
      const o = G.target[cy * G.w + cx];
      if (o >= 0) return PL[o];
    }
    return null;
  }
  let best = null, bestRatio = 1.35;   // drawn fields extend ~1.2–1.5× the core radius
  // smallest power first, so a local kingdom wins over an overlord claiming the same ground
  for (const a of activeAt(y).reverse()) for (const k of a.phase.regions) {
    const [lon, lat, km] = KC.regions[k];
    const ratio = hav(ll, [lon, lat]) / km;
    if (ratio < bestRatio) { bestRatio = ratio; best = a.p; }
  }
  return best;
}

// ---------- state
const state = { year: -250, mode: 'explore', playing: false, hover: null, journey: null, step: 0, quiz: null, place: null };
let T = d3.zoomIdentity, dragging = false;

// ---------- svg scaffold
const svg = d3.select('#map');
const defs = svg.append('defs');
const landClip = defs.append('clipPath').attr('id', 'landClip').append('path');
const chiefHatch = defs.append('pattern').attr('id', 'chiefHatch').attr('width', 6).attr('height', 6).attr('patternUnits', 'userSpaceOnUse')
  .attr('patternTransform', 'rotate(45)');
chiefHatch.append('path').attr('d', 'M0 0V6').attr('stroke', '#4d463d').attr('stroke-width', .8).attr('opacity', .32);
const hatch = defs.append('pattern').attr('id', 'hatch').attr('width', 6).attr('height', 4).attr('patternUnits', 'userSpaceOnUse');
hatch.append('path').attr('d', 'M0 .5H6').attr('stroke', '#5f7c8c').attr('stroke-width', .5).attr('opacity', .35);
svg.append('rect').attr('class', 'sea-hatch').attr('fill', 'url(#hatch)').attr('pointer-events', 'none');
const gMap = svg.append('g');
const gGrat = gMap.append('path').attr('class', 'graticule');
const gHalo = gMap.append('path').attr('class', 'halo');
const gLand = gMap.append('path').attr('class', 'land');
const gChief = gMap.append('path').attr('class', 'chief').attr('clip-path', 'url(#landClip)');
const gPol = gMap.append('g').attr('clip-path', 'url(#landClip)');
const gRivers = gMap.append('g').attr('class', 'rivers');
const gRoads = gMap.append('g').attr('class', 'roads');
const gOver = svg.append('g');
const gRoute = gOver.append('g').attr('class', 'route');
const gPolLabels = gOver.append('g').attr('class', 'pol-labels');
const gCities = gOver.append('g').attr('class', 'cities');
const gQuiz = gOver.append('g').attr('class', 'quizmarks');
const gHome = gOver.append('g').attr('class', 'homepin');
const gPulse = gOver.append('g');

const projection = d3.geoMercator();
const path = d3.geoPath(projection);
let land = null, pxPerKm = 1, base = {}, geo = null;

function fit() {
  const w = innerWidth, h = innerHeight, m = isMobile();
  svg.attr('viewBox', `0 0 ${w} ${h}`);
  const box = { type: 'MultiPoint', coordinates: [[66, 6.5], [93, 35.5]] };
  const ext = m ? [[16, 205], [w - 16, h - 150]] : [[330, 96], [w - 40, h - 110]];
  projection.fitExtent(ext, box);
  geo = KC.engine.bind(projection); base = geo.base; pxPerKm = geo.pxPerKm;
  svg.select('.sea-hatch').attr('width', w).attr('height', h);
  KC.cities.forEach(c => c.xy = projection(c.ll));
  gGrat.attr('d', path(d3.geoGraticule().step([5, 5]).extent([[40, -5], [110, 50]])()));
  if (land) drawLand();
  gRivers.selectAll('path').data(KC.rivers).join('path')
    .attr('class', d => d[2] === 'paleo' ? 'river paleo' : 'river').attr('d', d => path({ type: 'LineString', coordinates: d[1] }));
  gRoads.selectAll('path').data(KC.roads).join('path').attr('class', 'road')
    .attr('d', d => path({ type: 'LineString', coordinates: d.path }));
  zoom.translateExtent([[-w * .6, -h * .6], [w * 1.6, h * 1.6]]);
  buildGrid();
  updateTerritories('instant');
  renderOverlay();
}

function drawLand() { const d = path(land); gLand.attr('d', d); gHalo.attr('d', d); landClip.attr('d', d); }

// ---------- zoom
const zoom = d3.zoom().scaleExtent([1, 10]).clickDistance(6).on('zoom', e => {
  T = e.transform;
  gMap.attr('transform', T);
  chiefHatch.attr('patternTransform', `rotate(45) scale(${1 / T.k})`);
  renderOverlay();
});
svg.call(zoom).on('dblclick.zoom', null);
function viewCenter() {
  const w = innerWidth, h = innerHeight;
  if (isMobile()) return [w / 2, document.body.classList.contains('has-card') || state.mode !== 'explore' ? (205 + h * .62) / 2 : (205 + h - 150) / 2];
  const right = document.body.classList.contains('has-card') || state.mode !== 'explore' || state.place ? w - 400 : w;
  return [(300 + right) / 2, (72 + h - 90) / 2];
}
function flyTo(ll, k = 2.6, dur = 1100) {
  const [x, y] = projection(ll), [cx, cy] = viewCenter();
  svg.transition().duration(dur).ease(d3.easeCubicInOut)
    .call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(k).translate(-x, -y));
}
function flyHome(dur = 900) { svg.transition().duration(dur).call(zoom.transform, d3.zoomIdentity); }

// ---------- territories
// Every patch of land goes to the strongest nearby power; each power's cells are then
// traced with d3.contours into one smooth outline, so neighbours share real borders.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = { cell: 4, x0: 0, y0: 0, w: 0, h: 0, n: 0, land: null, n1: null, n2: null, cur: null, target: null, key: '', anim: null, shapes: new Map() };

function buildGrid() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k in base) {
    const [x, y, r] = base[k], R = r * REACH;
    x0 = Math.min(x0, x - R); y0 = Math.min(y0, y - R); x1 = Math.max(x1, x + R); y1 = Math.max(y1, y + R);
  }
  const cell = Math.max(2.5, Math.sqrt((x1 - x0) * (y1 - y0) / (isMobile() ? 30000 : 52000)));
  Object.assign(G, { cell, x0, y0, w: Math.ceil((x1 - x0) / cell), h: Math.ceil((y1 - y0) / cell), key: '', anim: null });
  G.n = G.w * G.h;
  G.cur = new Int16Array(G.n).fill(-1);
  G.target = new Int16Array(G.n).fill(-1);
  G.shapes = new Map();
  buildLandMask(); buildNoise(); buildReach();
}
// cells within reach of any region: land the atlas speaks for (not Tibet or Burma)
function buildReach() {
  const { w, h, n, cell, x0, y0, land: L } = G;
  G.reach = new Uint8Array(n);
  for (const k in KC.regions) {
    const [cx, cy, r] = base[k], R = r * REACH;
    const gx0 = Math.max(0, Math.floor((cx - R - x0) / cell)), gx1 = Math.min(w - 1, Math.floor((cx + R - x0) / cell));
    const gy0 = Math.max(0, Math.floor((cy - R - y0) / cell)), gy1 = Math.min(h - 1, Math.floor((cy + R - y0) / cell));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const i = gy * w + gx;
      if (L[i] && Math.hypot(x0 + (gx + .5) * cell - cx, y0 + (gy + .5) * cell - cy) <= R * .85) G.reach[i] = 1;
    }
  }
}
function buildLandMask() {
  G.land = new Uint8Array(G.n).fill(1);
  if (!land) return;
  const cv = document.createElement('canvas'); cv.width = G.w; cv.height = G.h;
  const ctx = cv.getContext('2d');
  ctx.setTransform(1 / G.cell, 0, 0, 1 / G.cell, -G.x0 / G.cell, -G.y0 / G.cell);
  ctx.beginPath(); d3.geoPath(projection, ctx)(land); ctx.fill();
  const px = ctx.getImageData(0, 0, G.w, G.h).data;
  for (let i = 0; i < G.n; i++) G.land[i] = px[i * 4 + 3] > 40 ? 1 : 0;
}
function buildNoise() {
  const { w, h, n, cell, x0, y0 } = G, toKm = geo.toKm;
  G.n1 = new Float32Array(n); G.n2 = new Float32Array(n);
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
    const [X, Y] = toKm(x0 + (gx + .5) * cell, y0 + (gy + .5) * cell), i = gy * w + gx;
    G.n1[i] = fbm(X, Y, 1); G.n2[i] = fbm(X, Y, 2);
  }
}
function ownershipAt(y) {
  const act = activeAt(y), own = new Int16Array(G.n).fill(-1), best = new Float32Array(G.n).fill(.06);
  const { w, h, cell, x0, y0, land: L, n1, n2 } = G;
  act.forEach((a, rank) => {
    const pi = pIndex.get(a.p.id), ca = Math.cos(ANG[pi]), sa = Math.sin(ANG[pi]);
    const bias = rank * 1e-4;   // act runs large to small, so a vassal shows through its overlord on exact ties
    for (const k of a.phase.regions) {
      const [cx, cy, r] = base[k], R = r * REACH;
      const gx0 = Math.max(0, Math.floor((cx - R - x0) / cell)), gx1 = Math.min(w - 1, Math.floor((cx + R - x0) / cell));
      const gy0 = Math.max(0, Math.floor((cy - R - y0) / cell)), gy1 = Math.min(h - 1, Math.floor((cy + R - y0) / cell));
      for (let gy = gy0; gy <= gy1; gy++) {
        const dy = y0 + (gy + .5) * cell - cy, row = gy * w;
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = row + gx;
          if (!L[i]) continue;
          const dx = x0 + (gx + .5) * cell - cx, d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) continue;
          const sc = 1 - d / R + .22 * (n1[i] * ca + n2[i] * sa) + bias;
          if (sc > best[i]) { best[i] = sc; own[i] = pi; }
        }
      }
    }
  });
  return own;
}
const homeOf = pi => { const k = PL[pi].phases[0].regions[0]; return base[k]; };

function updateTerritories(mode) {
  const act = activeAt(state.year);
  const key = act.map(a => a.p.id + a.phase.key).join('|');
  if (key === G.key && mode !== 'instant') return;
  G.key = key;
  G.target = ownershipAt(state.year);
  let pending = [];
  if (G.anim) { cancelAnimationFrame(G.anim.raf); pending = [...G.anim.touched]; G.anim = null; }
  if (mode === 'instant' || reduceMotion) { G.cur.set(G.target); retrace(null); return; }
  // ink spread: gained cells flood outward from the power's homeland, lost cells dry from the far edge in
  const { n, w, cell, x0, y0, cur, target } = G, idx = [], grp = [], dist = [], maxD = new Map();
  for (let i = 0; i < n; i++) {
    if (cur[i] === target[i]) continue;
    const gain = target[i] >= 0, pi = gain ? target[i] : cur[i], hm = homeOf(pi), g = gain ? pi : -1 - pi;
    const d = Math.hypot(x0 + (i % w + .5) * cell - hm[0], y0 + ((i / w | 0) + .5) * cell - hm[1]);
    idx.push(i); grp.push(g); dist.push(d); maxD.set(g, Math.max(maxD.get(g) || 1, d));
  }
  if (!idx.length) { retrace(pending.length ? pending : null); return; }
  const t = new Float32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    let f = dist[k] / maxD.get(grp[k]); if (grp[k] < 0) f = 1 - f;
    const nz = G.n1[idx[k]] * .5 + .5;
    t[k] = Math.min(1, Math.max(0, f * .82 + nz * .18));
  }
  const order = Array.from(idx.keys()).sort((a, b) => t[a] - t[b]);
  G.anim = { idx, t, order, k: 0, touched: new Set(), start: performance.now(), dur: state.playing || dragging ? 650 : 1200 };
  pending.forEach(pi => G.anim.touched.add(pi));
  G.anim.raf = requestAnimationFrame(stepSpread);
}
function stepSpread(now) {
  const A = G.anim; if (!A) return;
  const p = Math.min(1, (now - A.start) / A.dur), pe = 1 - (1 - p) * (1 - p), dirty = new Set();
  while (A.k < A.order.length && A.t[A.order[A.k]] <= pe) {
    const i = A.idx[A.order[A.k++]], was = G.cur[i], now2 = G.target[i];
    G.cur[i] = now2;
    if (was >= 0) dirty.add(was);
    if (now2 >= 0) dirty.add(now2);
  }
  dirty.forEach(pi => A.touched.add(pi));
  if (p < 1) {
    if (dirty.size) retrace([...dirty], false);
    A.raf = requestAnimationFrame(stepSpread);
  } else { G.anim = null; retrace([...A.touched], true); }
}

// trace one power's cells into a smooth outline; drop slivers and pinholes.
// Works on the power's own bounding box so animation frames stay cheap.
function trace(pi, withAnchor) {
  const { n, w, h, cell, x0, y0, cur } = G;
  let cnt = 0, sx = 0, sy = 0, minx = w, miny = h, maxx = -1, maxy = -1;
  for (let i = 0; i < n; i++) if (cur[i] === pi) {
    const x = i % w, y = i / w | 0;
    cnt++; sx += x; sy += y;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  if (!cnt) return null;
  const pad = 3, bx = Math.max(0, minx - pad), by = Math.max(0, miny - pad);
  const bw = Math.min(w, maxx + pad + 1) - bx, bh = Math.min(h, maxy + pad + 1) - by;
  const v = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) { const row = (y + by) * w + bx; for (let x = 0; x < bw; x++) if (cur[row + x] === pi) v[y * bw + x] = 1; }
  const depth = withAnchor ? Float32Array.from(v) : null;
  d3.blur2({ data: v, width: bw, height: bh }, 1);
  const mp = d3.contours().size([bw, bh]).thresholds([.5])(v)[0];
  const minIsland = 140 / (cell * cell);
  // keep a hole only if another power sits inside it; unclaimed gaps inside an empire are filled
  const holeOwned = ring => {
    let hx = 0, hy = 0; for (const [x, y] of ring) { hx += x; hy += y; }
    const gx = bx + Math.floor(hx / ring.length), gy = by + Math.floor(hy / ring.length);
    const o = gx >= 0 && gy >= 0 && gx < w && gy < h ? cur[gy * w + gx] : -1;
    return o >= 0 && o !== pi;
  };
  const polys = mp.coordinates.filter(poly => Math.abs(d3.polygonArea(poly[0])) > minIsland)
    .map(poly => [poly[0], ...poly.slice(1).filter(holeOwned)]);
  if (!polys.length) return null;
  const X = x0 + bx * cell, Y = y0 + by * cell;
  const d = polys.map(poly => poly.map(ring => 'M' + ring.map(([x, y]) => (X + x * cell).toFixed(1) + ',' + (Y + y * cell).toFixed(1)).join('L') + 'Z').join('')).join('');
  let ax, ay;
  if (withAnchor) {   // label anchor: the deep interior cell closest to the centroid
    d3.blur2({ data: depth, width: bw, height: bh }, 6);
    const mx = sx / cnt - bx, my = sy / cnt - by;
    let bi = 0, bs = -Infinity;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (cur[(y + by) * w + bx + x] !== pi) continue;
      const sc = depth[y * bw + x] * 40 - Math.hypot(x - mx, y - my);
      if (sc > bs) { bs = sc; bi = y * bw + x; }
    }
    ax = X + (bi % bw + .5) * cell; ay = Y + ((bi / bw | 0) + .5) * cell;
  } else {            // mid-animation: keep the old anchor so labels don't jitter
    const prev = G.shapes.get(pi);
    ax = prev ? prev.x : x0 + (sx / cnt + .5) * cell; ay = prev ? prev.y : y0 + (sy / cnt + .5) * cell;
  }
  return { p: PL[pi], d, n: cnt, x: ax, y: ay };
}
function retrace(list, withAnchor = true) {
  if (!list) { G.shapes.clear(); list = [...new Set(G.cur)].filter(i => i >= 0); }
  for (const pi of list) { const s = trace(pi, withAnchor); if (s) G.shapes.set(pi, s); else G.shapes.delete(pi); }
  traceUnclaimed(withAnchor);
  paintTerritories();
  renderOverlay();
}
// land inside the atlas that no mapped power holds: hatched, with a quiet label on big stretches
function traceUnclaimed(withLabels) {
  const { n, w, h, cell, x0, y0, cur, reach } = G, v = new Float32Array(n);
  let any = 0;
  for (let i = 0; i < n; i++) if (reach[i] && cur[i] < 0) { v[i] = 1; any++; }
  if (!any) { G.unclaimed = null; return; }
  let labels = G.unclaimed && !withLabels ? G.unclaimed.labels : [];
  if (withLabels) {
    const depth = Float32Array.from(v), comp = new Int32Array(n).fill(-1);
    d3.blur2({ data: depth, width: w, height: h }, 5);
    labels = [];
    for (let i = 0; i < n; i++) {
      if (!v[i] || comp[i] >= 0) continue;
      const id = labels.length, q = [i]; comp[i] = id;
      let size = 0, best = i;
      while (q.length) {
        const j = q.pop(), x = j % w; size++;
        if (depth[j] > depth[best]) best = j;
        for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w])
          if (k >= 0 && k < n && v[k] && comp[k] < 0) { comp[k] = id; q.push(k); }
      }
      labels.push({ n: size, depth: depth[best], x: x0 + (best % w + .5) * cell, y: y0 + ((best / w | 0) + .5) * cell });
    }
  }
  d3.blur2({ data: v, width: w, height: h }, 1);
  const mp = d3.contours().size([w, h]).thresholds([.5])(v)[0], minIsland = 400 / (cell * cell);
  const d = mp.coordinates.filter(poly => Math.abs(d3.polygonArea(poly[0])) > minIsland)
    .map(poly => poly.map(ring => 'M' + ring.map(([x, y]) => (x0 + x * cell).toFixed(1) + ',' + (y0 + y * cell).toFixed(1)).join('L') + 'Z').join('')).join('');
  G.unclaimed = { d, labels };
}
function paintTerritories() {
  gChief.attr('d', G.unclaimed ? G.unclaimed.d : null);
  const data = [...G.shapes.values()].sort((a, b) => b.n - a.n);
  gPol.selectAll('g.pol').data(data, d => d.p.id).join(en => {
    const g = en.append('g').attr('class', 'pol');
    g.append('clipPath').attr('id', d => 'cp-' + d.p.id).append('path');
    g.append('path').attr('class', 'wash');
    g.append('path').attr('class', 'band').attr('clip-path', d => `url(#cp-${d.p.id})`);
    g.append('path').attr('class', 'edge');
    return g;
  })
  .classed('low', d => d.p.conf === 'low')
  .classed('dim', d => state.hover && state.hover !== d.p.id)
  .each(function (d) {
    const g = d3.select(this);
    g.selectAll('path').attr('d', d.d);
    g.select('.wash').attr('fill', d.p.color);
    g.select('.band').attr('stroke', d.p.color);
    g.select('.edge').attr('stroke', d3.color(d.p.color).darker(.8));
  });
}

// ---------- overlay (labels, cities) in screen space
function polLabelData() {
  const placed = [], out = [];
  const shapes = [...G.shapes.values()].sort((a, b) => b.n - a.n);
  for (const sh of shapes) {
    const [x, y] = T.apply([sh.x, sh.y]);
    const areaPx = sh.n * G.cell * G.cell * T.k * T.k;
    if (areaPx < 900) continue;
    const size = Math.max(11.5, Math.min(isMobile() ? 17 : 23, Math.sqrt(areaPx) / 9.5));
    const label = sh.p.name + (sh.p.conf === 'low' ? ' ≈' : '');
    const w = label.length * size * .86, h = size * 1.3;
    const box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
    placed.push(box);
    out.push({ p: sh.p, x, y, size, label });
  }
  if (G.unclaimed) G.unclaimed.labels.forEach((L, k) => {
    const areaPx = L.n * G.cell * G.cell * T.k * T.k;
    if (areaPx < 14000 || L.depth < .75) return;
    const [x, y] = T.apply([L.x, L.y]), size = 12.5;
    const label = state.year < -600 ? 'Village cultures' : 'Local chiefdoms';
    const w = label.length * size * .5, h = size * 1.3, box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) return;
    placed.push(box);
    out.push({ key: 'chief' + k, chief: true, x, y, size, label });
  });
  return { out, placed };
}
function renderOverlay() {
  const quiz = state.mode === 'quiz';
  const { out, placed } = quiz ? { out: [], placed: [] } : polLabelData();
  gPolLabels.selectAll('text').data(out, d => d.p ? d.p.id : d.key).join(en => en.append('text').on('click', (e, d) => d.p && openPolity(d.p.id)))
    .attr('x', d => d.x).attr('y', d => d.y).attr('font-size', d => d.size)
    .classed('chief', d => !!d.chief)
    .classed('dim', d => state.hover && (!d.p || state.hover !== d.p.id))
    .text(d => d.label);

  // cities
  const maxTier = T.k < 1.6 ? 1 : T.k < 3 ? 2 : 3;
  const vis = quiz ? [] : KC.cities.map(c => ({ c, name: cityName(c, state.year) }))
    .filter(d => d.name && d.c.t <= maxTier).sort((a, b) => a.c.t - b.c.t);
  const w = innerWidth, h = innerHeight;
  vis.forEach(d => {
    [d.x, d.y] = T.apply(d.c.xy);
    const fs = d.c.t === 1 ? 12.5 : 11.5, lw = d.name.length * fs * .52;
    const box = [d.x + 6, d.y - fs * .7, d.x + 8 + lw, d.y + fs * .6];
    d.label = d.x > -20 && d.x < w + 20 && d.y > -20 && d.y < h + 20 &&
      !placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]));
    if (d.label) placed.push(box);
  });
  gCities.selectAll('g.city').data(vis, d => d.c.id).join(en => {
    const g = en.append('g').attr('class', 'city').on('click', (e, d) => { e.stopPropagation(); openPlace(d.c.id); });
    g.append('circle').attr('class', 'hit').attr('r', 12);
    g.append('circle').attr('class', 'dot').attr('r', 2.5);
    g.append('text').attr('x', 7).attr('dy', '.35em');
    return g;
  }).attr('transform', d => `translate(${d.x},${d.y})`)
    .classed('t1', d => d.c.t === 1).classed('sel', d => state.place === d.c.id)
    .select('text').text(d => d.label || state.place === d.c.id ? d.name : '');

  renderRoute();
  renderQuizMarks();
  renderHomePin();
}

// ---------- year & UI
const ui = { year: $('#year'), era: $('#era'), head: $('#headline'), ticker: $('#ticker'), legend: $('#legend'), handle: $('#handle'), track: $('#track') };
let lastLegendKey = '', hashTimer = null, lastYear = state.year;

function setYear(y, opts = {}) {
  y = Math.max(MIN, Math.min(MAX, Math.round(y)));
  if (y === 0) y = lastYear < 0 ? 1 : -1;
  const prev = lastYear; lastYear = y;
  state.year = y;
  const act = activeAt(y);
  updateTerritories(opts.instant ? 'instant' : 'animate');
  renderOverlay();
  ui.year.textContent = fmtY(y).replace(' ', ' ');
  ui.year.classList.toggle('bce', y < 0);
  const era = KC.eras.find(e => inR(y, e[0], e[1]));
  ui.era.textContent = era ? era[2] : '';
  if (act.length) {
    const top = act[0], r = rulerOf(top.p, y);
    ui.head.innerHTML = r ? `<b>${esc(r)}</b> · ${esc(top.p.name)}` : `<b>${esc(top.p.name)}</b>`;
  } else ui.head.innerHTML = '<b>Village cultures</b> · no states mapped';
  const ev = [...KC.events].reverse().find(e => e[0] <= y && y - e[0] <= 45);
  if (ev) { ui.ticker.hidden = false; ui.ticker.innerHTML = `<span>${esc(fmtY(ev[0]))}</span> ${esc(ev[1])}`; ui.ticker.onclick = () => { flyTo(evLL(ev), 3); setTimeout(() => pulse(evLL(ev), '#c8361f'), 900); }; }
  else ui.ticker.hidden = true;
  if (state.playing) KC.events.filter(e => e[0] > prev && e[0] <= y).forEach(e => pulse(evLL(e), '#c8361f'));
  ui.handle.style.left = (y2p(y) * 100) + '%';
  ui.track.setAttribute('aria-valuenow', y); ui.track.setAttribute('aria-valuetext', fmtY(y));
  renderLegend(act);
  if (!isMobile()) ui.legend.style.top = Math.round($('.yearbox').getBoundingClientRect().bottom + 22) + 'px';
  if (state.place && !opts.keepCard) renderPlaceCard();
  if (state.home) syncHomeCard();
  if (state.mode !== 'quiz') { clearTimeout(hashTimer); hashTimer = setTimeout(writeHash, 250); }
}

function renderLegend(act) {
  const key = act.map(a => a.p.id + rulerOf(a.p, state.year)).join('|') + state.hover;
  if (key === lastLegendKey) return; lastLegendKey = key;
  ui.legend.innerHTML = `<div class="legend-h">${act.length} power${act.length === 1 ? '' : 's'} on the map</div>` + act.map(a => {
    const r = rulerOf(a.p, state.year);
    return `<button class="lg ${state.hover && state.hover !== a.p.id ? 'dim' : ''}" data-id="${a.p.id}">
      <i style="--c:${a.p.color}"></i><span><b>${esc(a.p.name)}${a.p.conf === 'low' ? ' ≈' : ''}</b>${r ? `<small>${esc(r)}</small>` : ''}</span></button>`;
  }).join('');
}
ui.legend.addEventListener('pointerover', e => { const b = e.target.closest('.lg'); if (b && e.pointerType === 'mouse') setHover(b.dataset.id); });
ui.legend.addEventListener('pointerleave', () => setHover(null));
ui.legend.addEventListener('click', e => { const b = e.target.closest('.lg'); if (b) openPolity(b.dataset.id); });
function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  gPol.selectAll('g.pol').classed('dim', d => id && id !== d.p.id);
  gPolLabels.selectAll('text').classed('dim', d => id && (!d.p || id !== d.p.id));
  lastLegendKey = ''; renderLegend(activeAt(state.year));
}

function pulse(ll, color) {
  const [x, y] = T.apply(projection(ll));
  gPulse.append('circle').attr('class', 'pulse').attr('cx', x).attr('cy', y).attr('r', 4).attr('stroke', color)
    .transition().duration(1400).ease(d3.easeCubicOut).attr('r', 40).style('opacity', 0).remove();
}

// ---------- timeline
function buildTimeline() {
  $('.eras').innerHTML = KC.eras.map(([a, b, n], i) =>
    `<div class="era-band e${i % 2}" style="left:${y2p(a) * 100}%;width:${(y2p(Math.min(b, MAX)) - y2p(a)) * 100}%"><span>${n}</span></div>`).join('');
  const ticks = [-2600, -600, -300, 1, 300, 600, 900, 1200, 1500, 1857];
  const mobileTicks = [-2600, 1, 600, 1200, 1857];
  $('.ticks').innerHTML = ticks.map(t => `<span class="${mobileTicks.includes(t) ? 'm' : ''}" style="left:${y2p(t) * 100}%">${t < 0 ? -t + ' BCE' : t === 1 ? '1 CE' : t}</span>`).join('');
  const minor = [];
  for (let y = -2500; y < -600; y += 500) minor.push(y);
  for (let y = -500; y < MAX; y += 100) minor.push(y || 1);
  $('.minor').innerHTML = minor.map(y => `<i class="${y % 500 === 0 ? 'mj' : ''}" style="left:${y2p(y) * 100}%"></i>`).join('');
  requestAnimationFrame(fitEraLabels);
  $('.evdots').innerHTML = KC.events.map(e => `<i style="left:${y2p(e[0]) * 100}%" title="${esc(fmtY(e[0]) + ' · ' + e[1])}"></i>`).join('');
  const track = ui.track;
  const frac = e => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  let dragFrac = null, dragRaf = 0;
  const applyDrag = () => { dragRaf = 0; if (dragFrac === null) return; setYear(p2y(dragFrac)); ui.handle.style.left = dragFrac * 100 + '%'; };
  track.addEventListener('pointerdown', e => {
    if (state.mode === 'quiz') return;
    e.preventDefault();
    stopPlay(); track.setPointerCapture(e.pointerId); track.classList.add('drag'); dragging = true;
    dragFrac = frac(e); applyDrag();
    const mv = ev => { dragFrac = frac(ev); if (!dragRaf) dragRaf = requestAnimationFrame(applyDrag); };
    const up = () => { dragging = false; dragFrac = null; track.classList.remove('drag'); track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
    track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  });
}
function fitEraLabels() {
  document.querySelectorAll('.era-band span').forEach(sp => { sp.style.visibility = ''; sp.style.visibility = sp.scrollWidth > sp.parentElement.clientWidth - 6 ? 'hidden' : ''; });
}
let raf = null, lastT = 0;
function startPlay() {
  if (state.mode === 'quiz') return;
  if (state.year >= MAX - 1) setYear(MIN);
  state.playing = true; $('#play').classList.add('on'); $('#play').setAttribute('aria-label', 'Pause');
  lastT = performance.now();
  let pos = y2p(state.year);
  const tick = t => {
    const dt = Math.min(.1, (t - lastT) / 1000); lastT = t;
    pos += dt / 75;                                    // whole timeline in ~75 s
    setYear(p2y(pos));
    if (pos >= 1) return stopPlay();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function stopPlay() {
  state.playing = false; cancelAnimationFrame(raf);
  $('#play').classList.remove('on'); $('#play').setAttribute('aria-label', 'Play');
}
$('#play').onclick = () => state.playing ? stopPlay() : startPlay();

addEventListener('keydown', e => {
  if (e.target.closest('input,textarea')) return;
  if (e.key === 'Escape') { closeCard(); closeModal(); return; }
  if (state.mode === 'quiz') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault(); stopPlay();
    if (state.mode === 'journey') return goStep(state.step + (e.key === 'ArrowRight' ? 1 : -1));
    const d = (e.shiftKey ? 100 : 10) * (e.key === 'ArrowRight' ? 1 : -1);
    setYear(state.year + (state.year < -600 ? d * 5 : d));
  } else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); state.playing ? stopPlay() : startPlay(); }
});

// ---------- cards
const card = $('#card');
function showCard(html, cls) {
  card.className = 'card ' + (cls || ''); card.innerHTML = `<button class="x" aria-label="Close">×</button>` + html; card.hidden = false;
  card.querySelector('.x').onclick = closeCard;
  document.body.classList.add('has-card');
}
function closeCard() {
  if (card.hidden) return;
  card.hidden = true; document.body.classList.remove('has-card');
  if (state.mode === 'journey') endJourney();
  if (state.mode === 'quiz') endQuiz();
  state.place = null; state.home = null; renderOverlay(); writeHash();
}

function openPlace(id) {
  state.home = null;
  if (state.mode === 'quiz') return;
  if (state.mode === 'journey') endJourney();
  state.place = id; stopPlay();
  renderPlaceCard();
  flyTo(cityById[id].ll, Math.max(T.k, 2.4));
  renderOverlay(); writeHash();
}
function renderPlaceCard() {
  const c = cityById[state.place], y = state.year, now = cityName(c, y);
  const ruler = polityAtPoint(c.ll, y);
  const evs = KC.events.filter(e => e[2] === c.id);
  showCard(`
    <div class="kicker">Trace a place</div>
    <h2>${esc(now || c.names[c.names.length - 1][2])}</h2>
    <p class="sub">${now ? `In ${fmtY(y)}${ruler ? `, under <b class="pname" style="--c:${ruler.color}">${esc(ruler.name)}</b>` : ', outside the mapped states'}` : `Not yet founded or abandoned in ${fmtY(y)}`}</p>
    <div class="names">${c.names.map(n => `<button class="nm ${inR(y, n[0], n[1]) ? 'on' : ''}" data-y="${Math.max(n[0], MIN)}"><b>${esc(n[2])}</b><span>${esc(fmtY(n[0]))} – ${n[1] >= MAX ? 'now' : esc(fmtY(n[1]))}</span></button>`).join('')}</div>
    <p class="fact">${esc(c.fact)}</p>
    ${evs.length ? `<div class="evs">${evs.map(e => `<button data-y="${e[0]}"><span>${esc(fmtY(e[0]))}</span>${esc(e[1])}</button>`).join('')}</div>` : ''}
    <div class="row"><button class="btn" id="share-place">Share this place</button></div>`, 'place');
  card.querySelectorAll('[data-y]').forEach(b => b.onclick = () => setYear(+b.dataset.y + (+b.dataset.y === 0 ? 1 : 0)));
  $('#share-place').onclick = () => share(`${now || c.names[0][2]} has had ${c.names.length} name${c.names.length > 1 ? 's' : ''} in Indian history. Trace it on Kaalchakra:`);
}

function openPolity(id) {
  const p = KC.polities.find(p => p.id === id), y = state.year;
  const peak = p.phases.reduce((a, b) => areaOf(b.regions) > areaOf(a.regions) ? b : a);
  showCard(`
    <div class="kicker">${esc(fmtY(p.span[0]))} – ${p.span[1] >= MAX ? '1857 CE' : esc(fmtY(p.span[1]))}${p.conf === 'low' ? ' · uncertain' : ''}</div>
    <h2>${esc(p.name)}</h2>
    ${p.capital ? `<p class="sub">Capital: ${esc(p.capital)}</p>` : ''}
    <p class="fact">${esc(p.note || '')}</p>
    ${(p.rulers || []).length ? `<div class="evs">${p.rulers.map(r => `<button data-y="${r[0]}" class="${inR(y, r[0], r[1]) ? 'on' : ''}"><span>${esc(fmtY(r[0]))}</span>${esc(r[2])}</button>`).join('')}</div>` : ''}
    <div class="row"><button class="btn" id="peak">Jump to its peak</button></div>`, 'polity');
  card.querySelectorAll('[data-y]').forEach(b => b.onclick = () => setYear(+b.dataset.y));
  $('#peak').onclick = () => { setYear(Math.round((peak.from + peak.to) / 2)); flyHome(); };
  state.place = null;
}

// ---------- journeys
function openJourneys() {
  stopPlay();
  openModal(`<h2>Journeys</h2><p class="sub">Follow a traveller. The map moves through time with them.</p>
    <div class="jgrid">${KC.journeys.map(j => `<button class="jcard" data-id="${j.id}" style="--c:${j.color}">
      <span class="jy">${esc(j.years)}</span><b>${esc(j.who)}</b><em>${esc(j.title)}</em><small>${esc(j.blurb)}</small><span class="jn">${j.stops.length} stops</span></button>`).join('')}</div>`);
  document.querySelectorAll('.jcard').forEach(b => b.onclick = () => { closeModal(); startJourney(b.dataset.id); });
}
function startJourney(id, step = 0) {
  state.home = null;
  if (state.mode === 'quiz') endQuiz();
  state.journey = KC.journeys.find(j => j.id === id); if (!state.journey) return;
  state.mode = 'journey'; state.place = null; document.body.classList.add('journey');
  goStep(step);
}
function goStep(i) {
  const j = state.journey; if (!j) return;
  i = Math.max(0, Math.min(j.stops.length - 1, i)); state.step = i;
  const [y, ll, place, text] = j.stops[i];
  setYear(y, { keepCard: true });
  flyTo(ll, isMobile() ? 2.4 : 2.3);
  setTimeout(() => pulse(ll, j.color), 900);
  const ruler = polityAtPoint(ll, y);
  showCard(`
    <div class="kicker">${esc(j.who)} · ${esc(j.title)}</div>
    <h2>${esc(place)}</h2>
    <p class="sub">${esc(fmtY(y))}${ruler ? ` · in the <b class="pname" style="--c:${ruler.color}">${esc(ruler.name)}</b>` : ''}</p>
    <p class="fact big">${esc(text)}</p>
    ${j.note && i === 0 ? `<p class="note">${esc(j.note)}</p>` : ''}
    <div class="dots">${j.stops.map((s, k) => `<button data-k="${k}" class="${k === i ? 'on' : k < i ? 'past' : ''}" aria-label="Stop ${k + 1}"></button>`).join('')}<span class="stopn">Stop ${i + 1} of ${j.stops.length}</span></div>
    <div class="row">
      <button class="btn ghost" id="jprev" ${i === 0 ? 'disabled' : ''}>← Back</button>
      <button class="btn" id="jnext">${i === j.stops.length - 1 ? 'Finish' : 'Next stop →'}</button>
      <button class="btn ghost icon" id="jshare" aria-label="Share">↗</button>
    </div>`, 'journey');
  card.querySelectorAll('[data-k]').forEach(b => b.onclick = () => goStep(+b.dataset.k));
  $('#jprev').onclick = () => goStep(i - 1);
  $('#jnext').onclick = () => i === j.stops.length - 1 ? (closeCard(), flyHome()) : goStep(i + 1);
  $('#jshare').onclick = () => share(`${j.who} in ${place}, ${fmtY(y)}. Follow the whole journey on Kaalchakra:`);
  renderRoute(); writeHash();
}
function endJourney() {
  state.mode = 'explore'; state.journey = null; document.body.classList.remove('journey');
  gRoute.selectAll('*').remove();
}
function renderRoute() {
  const j = state.journey;
  if (!j) { gRoute.selectAll('*').remove(); return; }
  const pts = j.stops.map(s => T.apply(projection(s[1])));
  const line = d3.line().curve(d3.curveCatmullRom.alpha(.5));
  const done = pts.slice(0, state.step + 1);
  gRoute.selectAll('path.all').data([pts]).join('path').attr('class', 'all').attr('d', line);
  gRoute.selectAll('path.done').data([done]).join('path').attr('class', 'done').attr('stroke', j.color).attr('d', d => d.length > 1 ? line(d) : null);
  gRoute.selectAll('g.stop').data(pts).join(en => { const g = en.append('g').attr('class', 'stop'); g.append('circle'); g.append('text').attr('dy', '.35em'); return g; })
    .attr('transform', d => `translate(${d})`).classed('on', (d, k) => k === state.step).classed('past', (d, k) => k < state.step)
    .on('click', (e, d) => { e.stopPropagation(); goStep(pts.indexOf(d)); })
    .each(function (d, k) {
      const g = d3.select(this);
      g.select('circle').attr('r', k === state.step ? 10 : 7.5).attr('fill', k <= state.step ? j.color : '#f7f2e7').attr('stroke', j.color);
      g.select('text').text(k + 1);
    });
}

// ---------- daily quiz
const QUIZ_EPOCH = Date.UTC(2026, 9, 25);
const dayNo = () => { const d = new Date(); return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - QUIZ_EPOCH) / 864e5) + 1; };
function pickQuiz(seed) {
  const r = rng(seed * 7919 + 13), pool = KC.quiz.slice();
  for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]]; }
  return pool.slice(0, 5).sort((a, b) => a[1] - b[1]);
}
const scoreFor = km => Math.round(1000 * Math.exp(-km / 260));
const emojiFor = km => km < 75 ? '🟩' : km < 250 ? '🟨' : km < 600 ? '🟧' : '🟥';
const titleFor = s => s >= 4200 ? 'Chakravartin' : s >= 3200 ? 'Samrat' : s >= 2200 ? 'Maharaja' : s >= 1200 ? 'Senapati' : s >= 500 ? 'Wandering pilgrim' : 'Lost in the Thar';

function startQuiz(practice = false) {
  state.home = null;
  stopPlay(); if (state.mode === 'journey') endJourney();
  const n = dayNo(), done = !practice && store.get('kc-daily-' + n);
  state.mode = 'quiz'; state.place = null; document.body.classList.add('quiz');
  state.quiz = { n, practice, items: pickQuiz(practice ? Math.floor(Math.random() * 1e9) : n), i: 0, results: [], answered: false };
  if (done) { state.quiz.results = done; return quizSummary(); }
  flyHome(); askQ();
}
function askQ() {
  const q = state.quiz, [id, y, hint] = q.items[q.i], c = cityById[id];
  q.answered = false; gQuiz.selectAll('*').remove();
  setYear(y, { keepCard: true });
  showCard(`
    <div class="kicker">${q.practice ? 'Practice round' : 'Daily quiz #' + q.n} · ${q.i + 1} / 5</div>
    <h2>Find ${esc(cityName(c, y))}</h2>
    <p class="sub">${esc(fmtY(y))}</p>
    <p class="fact">${esc(hint)}</p>
    <p class="note">Tap the map where you think it was. The empires of the time are shown as a clue.</p>
    <div class="qbar">${q.items.map((_, k) => `<i>${q.results[k] ? emojiFor(q.results[k]) : ''}</i>`).join('')}</div>`, 'quizcard');
  renderOverlay();
}
svg.on('click', e => {
  const q = state.quiz;
  if (state.mode !== 'quiz' || !q || q.answered || q.i >= 5) return;
  const [mx, my] = d3.pointer(e, svg.node());
  const guess = projection.invert(T.invert([mx, my]));
  const [id, y] = q.items[q.i], c = cityById[id];
  const km = Math.round(hav(guess, c.ll));
  q.answered = true; q.results.push(km); q.guess = guess;
  renderQuizMarks();
  const last = q.i === 4;
  showCard(`
    <div class="kicker">${q.practice ? 'Practice round' : 'Daily quiz #' + q.n} · ${q.i + 1} / 5</div>
    <h2>${emojiFor(km)} ${km < 25 ? 'Bullseye!' : km.toLocaleString() + ' km away'}</h2>
    <p class="sub">${esc(cityName(c, y))}, ${esc(fmtY(y))} · <b>+${scoreFor(km)}</b> points</p>
    <p class="fact">${esc(c.fact)}</p>
    <div class="qbar">${q.items.map((_, k) => `<i>${q.results[k] !== undefined ? emojiFor(q.results[k]) : ''}</i>`).join('')}</div>
    <div class="row"><button class="btn" id="qnext">${last ? 'See my score' : 'Next place →'}</button></div>`, 'quizcard');
  $('#qnext').onclick = () => { if (last) { if (!q.practice) store.set('kc-daily-' + q.n, q.results); quizSummary(); } else { q.i++; askQ(); } };
});
function renderQuizMarks() {
  const q = state.quiz;
  if (state.mode !== 'quiz' || !q || !q.answered || !q.guess) { gQuiz.selectAll('*').remove(); return; }
  const c = cityById[q.items[q.i][0]], g = T.apply(projection(q.guess)), t = T.apply(c.xy);
  gQuiz.selectAll('line').data([0]).join('line').attr('x1', g[0]).attr('y1', g[1]).attr('x2', t[0]).attr('y2', t[1]);
  gQuiz.selectAll('circle.guess').data([0]).join('circle').attr('class', 'guess').attr('cx', g[0]).attr('cy', g[1]).attr('r', 6);
  gQuiz.selectAll('circle.truth').data([0]).join('circle').attr('class', 'truth').attr('cx', t[0]).attr('cy', t[1]).attr('r', 7);
  gQuiz.selectAll('text').data([0]).join('text').attr('x', t[0] + 11).attr('y', t[1]).attr('dy', '.35em').text(cityName(c, q.items[q.i][1]));
}
function quizSummary() {
  const q = state.quiz, total = q.results.reduce((s, km) => s + scoreFor(km), 0), title = titleFor(total);
  q.i = 5; q.answered = false; gQuiz.selectAll('*').remove();
  const emo = q.results.map(emojiFor).join('');
  q.shareText = `Kaalchakra ${q.practice ? 'practice' : '#' + q.n} 🗺️\n${emo} ${total.toLocaleString()}/5,000\nRank: ${title}`;
  showCard(`
    <div class="kicker">${q.practice ? 'Practice round' : 'Daily quiz #' + q.n} · results</div>
    <h2 class="rank">${esc(title)}</h2>
    <div class="score">${total.toLocaleString()}<small> / 5,000</small></div>
    <div class="qbar big">${emo.match(/./gu).map(e => `<i>${e}</i>`).join('')}</div>
    <p class="note">${q.items.map((it, k) => `${esc(cityName(cityById[it[0]], it[1]))}: ${q.results[k].toLocaleString()} km`).join(' · ')}</p>
    <div class="row">
      <button class="btn" id="qshare">Share result</button>
      <button class="btn ghost" id="qpractice">Practice round</button>
    </div>
    ${q.practice ? '' : '<p class="note">A new set of five places every day.</p>'}`, 'quizcard');
  $('#qshare').onclick = () => share(q.shareText, location.origin + location.pathname + '?quiz');
  $('#qpractice').onclick = () => startQuiz(true);
}
function endQuiz() {
  state.mode = 'explore'; state.quiz = null; document.body.classList.remove('quiz');
  gQuiz.selectAll('*').remove(); renderOverlay();
}

// ---------- who ruled the ground you're standing on
const townById = Object.fromEntries(KC.towns.map(t => [t.id, t]));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// search items: modern towns, plus historic names that point at them
const searchItems = [
  ...KC.towns.map(t => ({ town: t, names: [t.name, ...t.alt].map(norm), label: t.name, sub: t.region })),
  ...KC.cities.filter(c => !KC.towns.some(t => hav(t.ll, c.ll) < 15)).map(c => {
    const last = c.names[c.names.length - 1][2].replace(/ \(ruins\)/, '');
    return { town: { id: null, hid: c.id, name: last, region: 'Historic site', ll: c.ll, alt: [] }, names: c.names.map(n => norm(n[2])), label: last, sub: 'Historic site' };
  })
];
function landPoint(ll) {   // a coastal city may sit on a sea cell: step to the nearest land cell
  let [px, py] = projection(ll);
  const gx = Math.floor((px - G.x0) / G.cell), gy = Math.floor((py - G.y0) / G.cell);
  if (gx < 0 || gy < 0 || gx >= G.w || gy >= G.h) return null;
  if (G.land[gy * G.w + gx]) return [px, py];
  for (let r = 1; r <= 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const cx = gx + dx, cy = gy + dy;
    if (cx >= 0 && cy >= 0 && cx < G.w && cy < G.h && G.land[cy * G.w + cx]) return [G.x0 + (cx + .5) * G.cell, G.y0 + (cy + .5) * G.cell];
  }
  return [px, py];
}
function historyAt(ll) {
  const pt = landPoint(ll);
  return pt ? geo.history(pt[0], pt[1]) : null;
}

const POPULAR = ['delhi', 'mumbai', 'kolkata', 'chennai', 'bengaluru', 'hyderabad', 'lahore', 'dhaka', 'madurai', 'indore'];
// city search used by the finder card and the intro
function bindSearch(input, sugg, onPick = openHome) {
  const show = q => {
    q = norm(q.trim());
    const items = !q ? POPULAR.map(id => searchItems.find(i => i.town.id === id)) : searchItems
      .map(i => ({ i, s: i.names[0].startsWith(q) ? 3 : i.names.some(n => n.startsWith(q)) ? 2 : i.names.some(n => n.includes(q)) ? 1 : 0 }))
      .filter(x => x.s).sort((a, b) => b.s - a.s || a.i.label.length - b.i.label.length).slice(0, 8).map(x => x.i);
    sugg.innerHTML = items.length ? items.map((it, k) => {
      const viaOld = q && !it.names[0].startsWith(q) && it.names.find(n => n.includes(q));
      return `<button role="option" data-k="${k}"><b>${esc(it.label)}</b><span>${esc(it.sub)}${viaOld && it.sub !== 'Historic site' ? ' · was ' + esc(it.town.alt.find(a => norm(a).includes(q)) || '') : ''}</span></button>`;
    }).join('') : `<p class="note">No match yet. Try a nearby bigger city.</p>`;
    sugg.querySelectorAll('button').forEach(b => b.onclick = () => onPick(items[+b.dataset.k].town));
    sugg._items = items;
  };
  input.oninput = () => show(input.value);
  input.onkeydown = e => { if (e.key === 'Enter' && sugg._items && sugg._items[0]) onPick(sugg._items[0].town); };
  show('');
}
function openFinder() {
  stopPlay();
  if (state.mode === 'journey') endJourney();
  if (state.mode === 'quiz') endQuiz();
  state.place = null; state.home = null;
  showCard(`
    <div class="kicker">Your city</div>
    <h2>Who ruled the ground you're standing on?</h2>
    <p class="sub">Pick a city or town and see every power that held it, from 2600 BCE to 1857.</p>
    <label class="field-l" for="finder">City, town or old name</label>
    <input id="finder" class="field" type="search" placeholder="Indore, Madurai, Pataliputra…" autocomplete="off" spellcheck="false">
    <div class="sugg" id="sugg" role="listbox" aria-label="Matching places"></div>
    <div class="row"><button class="btn ghost" id="locate">Use my location</button></div>
    <p class="note">Your location stays on this device and is only used to find the nearest city.</p>`, 'finder');
  bindSearch($('#finder'), $('#sugg'));
  if (!isMobile()) $('#finder').focus();
  $('#locate').onclick = locateMe;
}
function locateMe() {
  if (!navigator.geolocation) return toast('Location is not available in this browser');
  $('#locate').textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.longitude, pos.coords.latitude];
    const near = KC.towns.map(t => ({ t, d: hav(ll, t.ll) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 120) openHome(near.t, { near: true });
    else if (landPoint(ll)) openHome({ id: null, name: 'Your location', region: '', ll, alt: [] });
    else { toast('That looks outside the map. Try searching instead.'); $('#locate').textContent = 'Use my location'; }
  }, () => { toast('Could not get your location. Try searching instead.'); $('#locate').textContent = 'Use my location'; },
  { maximumAge: 600000, timeout: 10000 });
}

function openHome(town, opts = {}) {
  if (runIntro.finish) { runIntro.finish(); runIntro.finish = null; }
  const hist = historyAt(town.ll);
  if (!hist) return toast('That place is outside the map.');
  state.place = null;
  state.home = { ...town, hist, near: !!opts.near };
  renderHomeCard();
  flyTo(town.ll, Math.max(T.k, 2.2));
  renderOverlay(); writeHash();
}
function renderHomeCard() {
  const h = state.home, H = h.hist;
  const strip = H.runs.map(r => r.pi < 0 ? '' :
    `<i style="left:${y2p(r.from) * 100}%;width:${(y2p(r.to) - y2p(r.from)) * 100}%;background:${PL[r.pi].color}" title="${esc(PL[r.pi].name)}"></i>`).join('');
  showCard(`
    <div class="kicker">Who ruled the ground</div>
    <h2>${esc(h.name)}</h2>
    <p class="sub">${esc(h.region)}${h.near ? ' · nearest city to you' : ''}</p>
    ${H.powers ? `
    <div class="hstat"><b>${H.powers}</b><span>power${H.powers > 1 ? 's' : ''} ruled this ground between 2600 BCE and 1857</span></div>
    <div class="hstrip" aria-hidden="true">${strip}<em class="now"></em></div>
    <div class="hscale"><span>2600 BCE</span><span>1 CE</span><span>1857</span></div>
    <dl class="hfacts">
      <div><dt>Longest rule</dt><dd>${esc(H.longest.p.name)}, ${H.longest.years.toLocaleString()} years</dd></div>
      <div><dt>Changed hands</dt><dd>${H.changes} time${H.changes === 1 ? '' : 's'}</dd></div>
    </dl>
    <div class="row tight"><button class="btn" id="homeshare">Share as image</button><button class="btn ghost" id="homeagain">Another city</button></div>
    <div class="hruns">${H.ruled.map((r, k) => `<button data-k="${k}" style="--c:${PL[r.pi].color}"><i></i><b>${esc(PL[r.pi].name)}</b><span>${esc(fmtY(r.from))} – ${r.to >= MAX ? '1857' : esc(fmtY(r.to))}</span></button>`).join('')}</div>`
    : `<p class="fact">No mapped state reached this spot. The atlas only draws major powers, so local chiefdoms here are not shown.</p>
    <div class="row"><button class="btn ghost" id="homeagain">Another city</button></div>`}`, 'home');
  card.querySelectorAll('.hruns button').forEach(b => b.onclick = () => { const r = H.ruled[+b.dataset.k]; setYear(Math.round((r.from + Math.min(r.to, MAX)) / 2)); });
  $('#homeagain').onclick = openFinder;
  if ($('#homeshare')) $('#homeshare').onclick = shareHomeImage;
  syncHomeCard();
}
function syncHomeCard() {
  if (!state.home || card.hidden || !card.classList.contains('home')) return;
  const y = state.year;
  card.querySelectorAll('.hruns button').forEach(b => { const r = state.home.hist.ruled[+b.dataset.k]; b.classList.toggle('on', y >= r.from && y < r.to); });
  const now = card.querySelector('.hstrip .now'); if (now) now.style.left = y2p(y) * 100 + '%';
}
function renderHomePin() {
  const h = state.home;
  if (!h || state.mode === 'quiz') { gHome.selectAll('*').remove(); return; }
  const [x, y] = T.apply(projection(h.ll));
  const g = gHome.selectAll('g').data([h]).join(en => { const g = en.append('g'); g.append('circle').attr('class', 'ring').attr('r', 14); g.append('circle').attr('class', 'pin').attr('r', 5.5); g.append('text').attr('x', 18).attr('dy', '.35em'); return g; });
  g.attr('transform', `translate(${x},${y})`).select('text').text(h.name);
}

// ---------- portrait share card (1080×1350) drawn on a canvas
async function drawHomeImage(h) {
  const W = 1080, Hh = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const c = cv.getContext('2d'), H = h.hist;
  await Promise.all(['600 120px Eczar', '30px "IM Fell English SC"', '500 24px "IBM Plex Mono"', '30px "Source Serif 4"', '600 30px "Source Serif 4"']
    .map(f => document.fonts.load(f).catch(() => {})));
  const INK = '#1f1b16', INK2 = '#4d463d', INK3 = '#6f665a', PAPER = '#f2ece0', ACC = '#c8361f', RULE = 'rgba(31,27,22,.55)';
  c.fillStyle = PAPER; c.fillRect(0, 0, W, Hh);
  c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(36, 36, W - 72, Hh - 72);
  c.lineWidth = 1; c.strokeRect(44, 44, W - 88, Hh - 88);
  const fit = (txt, font, max, size) => { let s = size; do { c.font = font.replace('$', s); s -= 2; } while (c.measureText(txt).width > max && s > 20); };
  // masthead
  c.textBaseline = 'alphabetic'; c.fillStyle = INK; c.font = '34px "IM Fell English SC"'; c.fillText('Kaalchakra', 84, 116);
  const mw = c.measureText('Kaalchakra').width; c.fillStyle = ACC; c.font = '600 30px Eczar'; c.fillText('कालचक्र', 84 + mw + 14, 116);
  c.fillStyle = INK3; c.font = '500 22px "IBM Plex Mono"'; c.textAlign = 'right'; c.fillText('AN ATLAS OF INDIA', W - 84, 114); c.textAlign = 'left';
  c.strokeStyle = RULE; c.beginPath(); c.moveTo(84, 140); c.lineTo(W - 84, 140); c.stroke();
  // headline
  c.fillStyle = ACC; c.font = '500 24px "IBM Plex Mono"'; c.fillText('WHO RULED THE GROUND IN', 84, 204);
  c.fillStyle = INK; fit(h.name, '600 $px Eczar', W - 168, 124); c.fillText(h.name, 80, 320);
  c.fillStyle = INK2; c.font = '32px "Source Serif 4"'; c.fillText(h.region || 'South Asia', 84, 372);
  // big number
  c.fillStyle = INK; c.font = '600 250px Eczar'; c.fillText(String(H.powers), 76, 640);
  c.font = '600 38px "Source Serif 4"'; c.fillText(H.powers === 1 ? 'power ruled here' : 'powers ruled here', 84, 700);
  c.fillStyle = INK3; c.font = '500 24px "IBM Plex Mono"'; c.fillText('2600 BCE – 1857 CE', 84, 742);
  // mini map
  const mx0 = 600, my0 = 410, mx1 = W - 84, my1 = 770;
  c.save(); c.beginPath(); c.rect(mx0, my0, mx1 - mx0, my1 - my0); c.clip();
  c.fillStyle = '#dde3df'; c.fillRect(mx0, my0, mx1 - mx0, my1 - my0);
  c.strokeStyle = 'rgba(95,124,140,.3)'; c.lineWidth = 1;
  for (let yy = my0; yy < my1; yy += 7) { c.beginPath(); c.moveTo(mx0, yy + .5); c.lineTo(mx1, yy + .5); c.stroke(); }
  const pj = d3.geoMercator().fitExtent([[mx0 + 14, my0 + 14], [mx1 - 14, my1 - 14]], { type: 'MultiPoint', coordinates: [[66, 6.5], [93, 35.5]] });
  const gp = d3.geoPath(pj, c);
  if (land) { c.beginPath(); gp(land); c.fillStyle = PAPER; c.fill(); c.strokeStyle = INK2; c.lineWidth = 1; c.stroke(); }
  c.strokeStyle = 'rgba(93,134,160,.8)'; c.lineWidth = 1;
  KC.rivers.filter(r => r[2] !== 'paleo').forEach(r => { c.beginPath(); gp({ type: 'LineString', coordinates: r[1] }); c.stroke(); });
  const [px, py] = pj(h.ll);
  c.strokeStyle = ACC; c.lineWidth = 3; c.beginPath(); c.arc(px, py, 20, 0, 7); c.stroke();
  c.fillStyle = ACC; c.beginPath(); c.arc(px, py, 9, 0, 7); c.fill();
  c.restore(); c.strokeStyle = RULE; c.lineWidth = 1; c.strokeRect(mx0 + .5, my0 + .5, mx1 - mx0 - 1, my1 - my0 - 1);
  // time strip
  const sx0 = 84, sx1 = W - 84, sy = 830, sh = 56, X = y => sx0 + y2p(y) * (sx1 - sx0);
  c.fillStyle = INK3; c.font = '500 22px "IBM Plex Mono"'; c.fillText('WHO HELD IT, YEAR BY YEAR', sx0, sy - 16);
  c.fillStyle = '#e6dfd0'; c.fillRect(sx0, sy, sx1 - sx0, sh);
  H.ruled.forEach(r => { c.fillStyle = PL[r.pi].color; c.fillRect(X(r.from), sy, Math.max(2, X(Math.min(r.to, MAX)) - X(r.from)), sh); });
  c.strokeStyle = INK; c.lineWidth = 1.5; c.strokeRect(sx0, sy, sx1 - sx0, sh);
  c.fillStyle = INK3; c.font = '20px "IBM Plex Mono"';
  [[-2600, '2600 BCE', 'left'], [1, '1 CE', 'center'], [1000, '1000', 'center'], [MAX, '1857', 'right']].forEach(([y, t, al]) => { c.textAlign = al; c.fillText(t, X(y), sy + sh + 30); });
  c.textAlign = 'left';
  // the longest rulers, in historical order
  const top = [...H.total].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([pi, yrs]) => ({ pi, yrs, from: H.ruled.find(r => r.pi === pi).from }))
    .sort((a, b) => a.from - b.from);
  const colW = (W - 168 - 40) / 2;
  top.forEach((t, k) => {
    const col = k < Math.ceil(top.length / 2) ? 0 : 1, row = col ? k - Math.ceil(top.length / 2) : k;
    const x = 84 + col * (colW + 40), y = 966 + row * 54;
    c.fillStyle = PL[t.pi].color; c.fillRect(x, y - 22, 22, 22);
    c.fillStyle = INK; fit(PL[t.pi].name, '600 $px "Source Serif 4"', colW - 150, 27); c.fillText(PL[t.pi].name, x + 36, y - 2);
    c.fillStyle = INK3; c.font = '20px "IBM Plex Mono"'; c.textAlign = 'right'; c.fillText(t.yrs.toLocaleString() + ' yrs', x + colW, y - 3); c.textAlign = 'left';
  });
  // footer
  c.strokeStyle = RULE; c.beginPath(); c.moveTo(84, Hh - 128); c.lineTo(W - 84, Hh - 128); c.stroke();
  c.fillStyle = INK; c.font = '600 30px "Source Serif 4"'; c.fillText('Who ruled your city?', 84, Hh - 80);
  c.fillStyle = ACC; c.font = '500 24px "IBM Plex Mono"'; c.textAlign = 'right'; c.fillText(location.host || 'kaalchakra', W - 84, Hh - 82); c.textAlign = 'left';
  return new Promise(res => cv.toBlob(res, 'image/png'));
}
async function shareHomeImage() {
  const h = state.home; if (!h) return;
  const btn = $('#homeshare'); if (btn) btn.textContent = 'Drawing…';
  const blob = await drawHomeImage(h);
  if (btn) btn.textContent = 'Share as image';
  const url = URL.createObjectURL(blob), file = new File([blob], `kaalchakra-${(h.id || 'my-place')}.png`, { type: 'image/png' });
  const link = location.origin + location.pathname + (h.id ? '?home=' + h.id : '');
  const text = `${h.name} has been ruled by ${h.hist.powers} power${h.hist.powers > 1 ? 's' : ''} between 2600 BCE and 1857. Who ruled your city?`;
  openModal(`<h2>Your card</h2><p class="sub">Save it or send it straight to your family group.</p>
    <img class="sharecard" src="${url}" alt="Share card: ${esc(h.name)}, ruled by ${h.hist.powers} powers">
    <div class="row">
      ${navigator.canShare && navigator.canShare({ files: [file] }) ? '<button class="btn" id="cardshare">Share</button>' : ''}
      <a class="btn ${navigator.canShare && navigator.canShare({ files: [file] }) ? 'ghost' : ''}" id="carddl" href="${url}" download="${file.name}">Download image</a>
      <button class="btn ghost" id="cardlink">Copy link</button>
    </div>`);
  if ($('#cardshare')) $('#cardshare').onclick = async () => { try { await navigator.share({ files: [file], text, url: link }); } catch {} };
  $('#cardlink').onclick = async () => { try { await navigator.clipboard.writeText(text + '\n' + link); toast('Link copied'); } catch { toast('Could not copy'); } };
}


// ---------- cold open: the map drifts through time behind one question
function runIntro() {
  const el = $('#intro');
  el.innerHTML = `
    <div class="i-fade"></div>
    <div class="i-body">
      <div class="i-year"><span id="iyear"></span> · <span id="iera"></span></div>
      <h1>Who ruled the ground you’re standing on?</h1>
      <p>Pick your city to see every power that held it, from 2600 BCE to 1857.</p>
      <div class="i-search">
        <input id="ifind" class="field" type="search" placeholder="Search your city or town" autocomplete="off" spellcheck="false" aria-label="Search your city or town">
        <div class="sugg" id="isugg" role="listbox" aria-label="Matching places"></div>
      </div>
      <div class="i-actions"><button class="btn" id="locate">Use my location</button><button class="i-explore" id="iexplore">Explore the map →</button></div>
    </div>`;
  el.hidden = false; document.body.classList.add('intro-on'); dragging = true;
  let done = false, raf, t0 = performance.now();
  const LOOP = 42000;   // one slow pass through 4,000 years
  const finish = () => {
    if (done) return; done = true; cancelAnimationFrame(raf); dragging = false;
    el.hidden = true; el.innerHTML = ''; document.body.classList.remove('intro-on');
    removeEventListener('keydown', onKey); store.set('kc-intro', 1);
  };
  const onKey = e => { if (e.key === 'Escape') { finish(); setYear(-250); } };
  addEventListener('keydown', onKey);
  bindSearch($('#ifind'), $('#isugg'), town => { finish(); openHome(town); });
  $('#locate').onclick = () => { const orig = openHome; locateMe(); };
  $('#iexplore').onclick = () => { finish(); setYear(-250); };
  const tick = now => {
    if (done) return;
    const y = p2y(((now - t0) % LOOP) / LOOP);
    setYear(y === 0 ? 1 : y);
    $('#iyear').textContent = fmtY(state.year);
    const era = KC.eras.find(e => inR(state.year, e[0], e[1])); $('#iera').textContent = era ? era[2] : '';
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  runIntro.finish = finish;
}
// ---------- modal
function openModal(html) { const m = $('#modal'); m.querySelector('.modal-inner').innerHTML = `<button class="x" aria-label="Close">×</button>` + html; m.hidden = false; m.querySelector('.x').onclick = closeModal; }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function openAbout() {
  openModal(`<h2>About Kaalchakra</h2>
    <p>Kaalchakra, the wheel of time, puts 4,000 years of the subcontinent on one map, from the Harappan cities to the uprising of 1857.</p>
    <p><b>How to read the map.</b> Glowing fields show where each power held sway. They are schematic zones built from core regions, not surveyed borders. Overlaps are deliberate: overlords, vassals and rivals often claimed the same land. A ≈ marks powers whose extent or dates are especially uncertain.</p>
    <p><b>Controls.</b> Drag the timeline or press ▶. Use ← and → to step through time, with Shift for bigger jumps. Tap a city to trace its names through history, or tap a kingdom to see its rulers.</p>
    <p><b>Sources.</b> The data is hand-compiled from standard histories and should be treated as an approximation. For serious work, see Joseph Schwartzberg’s <i>Historical Atlas of South Asia</i>. Coastlines come from Natural Earth via world-atlas.</p>
    <p class="note">Found an error? Dates and extents are easy to fix in the data files.</p>`);
}

// ---------- share & hash
function writeHash() {
  if (state.mode === 'quiz') return;
  let h = 'y=' + state.year;
  if (state.mode === 'journey' && state.journey) h = `j=${state.journey.id}&s=${state.step + 1}`;
  else if (state.place) h += '&p=' + state.place;
  else if (state.home && state.home.id) h += '&home=' + state.home.id;
  history.replaceState(null, '', '#' + h);
}
const linkParams = () => new URLSearchParams(location.hash.length > 1 ? location.hash.slice(1) : location.search.slice(1));
// the link people share: query parameters, which servers and link-preview bots can read
function shareUrl() {
  const q = new URLSearchParams();
  if (state.mode === 'quiz') q.set('quiz', '');
  else if (state.mode === 'journey' && state.journey) { q.set('j', state.journey.id); q.set('s', state.step + 1); }
  else if (state.home && state.home.id) q.set('home', state.home.id);
  else { q.set('y', state.year); if (state.place) q.set('p', state.place); }
  return location.origin + location.pathname + '?' + q.toString().replace(/=$/, '').replace('quiz=', 'quiz');
}
function readHash() {
  const h = linkParams();
  if (location.hash === '#quiz' || h.has('quiz')) return startQuiz();
  if (h.get('j')) return startJourney(h.get('j'), (+h.get('s') || 1) - 1);
  if (h.get('y')) setYear(+h.get('y'));
  if (h.get('p') && cityById[h.get('p')]) openPlace(h.get('p'));
  if (h.get('home') && townById[h.get('home')]) openHome(townById[h.get('home')]);
}
async function share(text, url) {
  url = url || shareUrl();
  try {
    if (navigator.share && isMobile()) { await navigator.share({ text, url }); return; }
    await navigator.clipboard.writeText(text + '\n' + url); toast('Copied to clipboard');
  } catch { toast('Could not share. Copy the address bar instead.'); }
}
function shareMoment() {
  const act = activeAt(state.year), y = fmtY(state.year);
  const text = act.length > 1
    ? `In ${y}, ${act.length} powers shared the Indian subcontinent. How many can you name?`
    : act.length ? `In ${y}, the ${act[0].p.name} dominated the map of India.` : `${y} on the map of India.`;
  share(text + ' Scrub 4,000 years on Kaalchakra:');
}

$('#btn-journeys').onclick = openJourneys;
$('#btn-quiz').onclick = () => startQuiz();
$('#btn-share').onclick = () => state.mode === 'quiz' && state.quiz?.shareText ? share(state.quiz.shareText) : shareMoment();
$('#btn-about').onclick = openAbout;
$('#btn-home').onclick = openFinder;
$('#cta-home').onclick = openFinder;
addEventListener('hashchange', () => { if (state.mode !== 'quiz') readHash(); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { svg.call(zoom.transform, d3.zoomIdentity); fit(); fitEraLabels(); }, 150); });

// ---------- boot
buildTimeline();
{ // start on the linked year so a shared link never animates in from the default
  const h = linkParams(), j = KC.journeys.find(j => j.id === h.get('j'));
  if (j) state.year = (j.stops[(+h.get('s') || 1) - 1] || j.stops[0])[0];
  else if (+h.get('y')) state.year = +h.get('y');
}
fit();
setYear(state.year);
readHash();
// first visit, arriving with no specific link: play the cold open
if (location.search.length < 2 && location.hash.length < 2 && !store.get('kc-intro') && !reduceMotion) setTimeout(runIntro, 600);
fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json').then(r => r.json()).then(topo => {
  land = topojson.feature(topo, topo.objects.land);
  drawLand(); buildLandMask(); buildReach(); updateTerritories('instant');
  document.body.classList.add('ready');
}).catch(() => toast('Could not load coastlines. Check your connection.'));
window.kaalchakra = { setYear, startJourney, startQuiz, activeAt, state };
})();
