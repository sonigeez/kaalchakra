// Kaalchakra engine: the rules that decide who holds which ground in which year.
// Shared by the app (browser) and the build script that makes link previews (Node),
// so a preview card can never disagree with the painted map.
(function (root) {
  const KC = root.KC;
  if (KC.engine) return;
  const MIN = -2600, MAX = 1857, REACH = 1.62;
  const inR = (y, a, b) => y >= a && y < b;

  // phases: [from, to, 'regions'] → objects; a list starting with '+' extends the previous phase
  KC.polities.forEach(p => {
    let prev = [];
    p.phases = p.phases.map(([from, to, s]) => {
      let list = s.trim().split(/\s+/);
      if (list[0] === '+') list = [...new Set(prev.concat(list.slice(1)))];
      prev = list;
      return { from, to, regions: list, key: from + ':' + to };
    });
    p.span = [p.phases[0].from, p.phases[p.phases.length - 1].to];
  });
  const PL = KC.polities;
  const pIndex = new Map(PL.map((p, i) => [p.id, i]));
  const areaOf = regions => regions.reduce((s, k) => s + KC.regions[k][2] ** 2, 0);

  function rng(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // border wobble: smooth value noise in kilometre space, identical on every device
  const hash2 = (x, y, sd) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(sd, 1442695041);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296 * 2 - 1;
  };
  function vnoise(X, Y, L, sd) {
    const gx = X / L, gy = Y / L, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, sd), b = hash2(ix + 1, iy, sd), c = hash2(ix, iy + 1, sd), d = hash2(ix + 1, iy + 1, sd);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  }
  const fbm = (X, Y, sd) => .7 * vnoise(X, Y, 160, sd) + .3 * vnoise(X, Y, 60, sd + 17);
  // each power mixes two shared noise fields at its own angle, so its borders wobble differently
  const ANG = PL.map((p, i) => rng(i * 977 + 3)() * Math.PI * 2);

  function activeAt(y) {
    const out = [];
    for (const p of PL) {
      const ph = p.phases.find(ph => inR(y, ph.from, ph.to));
      if (ph) out.push({ p, phase: ph, area: areaOf(ph.regions) });
    }
    return out.sort((a, b) => b.area - a.area);
  }
  // years where any power's extent changes: a point's owner can only change at these
  const BOUNDS = [...new Set(PL.flatMap(p => p.phases.flatMap(ph => [ph.from, ph.to])).concat(MIN))]
    .filter(y => y >= MIN && y < MAX).sort((a, b) => a - b);

  // Scoring works in any Mercator projection: distances are compared as ratios and
  // noise is sampled in kilometres, so results don't depend on screen size.
  function bind(projection) {
    const a = projection([80, 22]), b = projection([80 + 1 / (111.32 * Math.cos(22 * Math.PI / 180)), 22]);
    const pxPerKm = b[0] - a[0], kmOrigin = a, base = {};
    for (const [k, [lon, lat, km]] of Object.entries(KC.regions)) {
      const c = projection([lon, lat]), e = projection([lon + km / (111.32 * Math.cos(lat * Math.PI / 180)), lat]);
      base[k] = [c[0], c[1], e[0] - c[0]];
    }
    const toKm = (px, py) => [(px - kmOrigin[0]) / pxPerKm, (py - kmOrigin[1]) / pxPerKm];
    function ownerAt(px, py, y) {
      const [X, Y] = toKm(px, py), a1 = fbm(X, Y, 1), a2 = fbm(X, Y, 2);
      let best = .06, own = -1;
      activeAt(y).forEach((a, rank) => {
        const pi = pIndex.get(a.p.id), nz = a1 * Math.cos(ANG[pi]) + a2 * Math.sin(ANG[pi]);
        for (const k of a.phase.regions) {
          const [cx, cy, r] = base[k], R = r * REACH, d = Math.hypot(px - cx, py - cy);
          if (d > R) continue;
          const sc = 1 - d / R + .22 * nz + rank * 1e-4;   // smaller powers win exact ties
          if (sc > best) { best = sc; own = pi; }
        }
      });
      return own;
    }
    // every power that held a projected point, 2600 BCE to 1857
    function history(px, py) {
      const runs = [];
      BOUNDS.forEach((y, k) => {
        const to = BOUNDS[k + 1] ?? MAX, o = ownerAt(px, py, y), last = runs[runs.length - 1];
        if (last && last.pi === o) last.to = to; else runs.push({ pi: o, from: y, to });
      });
      const ruled = runs.filter(r => r.pi >= 0), total = new Map();
      ruled.forEach(r => total.set(r.pi, (total.get(r.pi) || 0) + r.to - r.from));
      // cultures without known rulers and uncertain powers don't count as the "longest rule"
      const ranked = [...total].sort((a, b) => b[1] - a[1]);
      const longest = ranked.find(([pi]) => !PL[pi].culture && PL[pi].conf !== 'low') || ranked.find(([pi]) => !PL[pi].culture) || ranked[0];
      return { runs, ruled, powers: total.size, total, changes: Math.max(0, ruled.length - 1),
        longest: longest ? { p: PL[longest[0]], years: longest[1] } : null };
    }
    return { base, pxPerKm, toKm, ownerAt, history };
  }

  KC.engine = { MIN, MAX, REACH, PL, pIndex, rng, fbm, ANG, areaOf, activeAt, BOUNDS, bind, inR };
})(typeof window !== 'undefined' ? window : globalThis);
