// Kaalchakra Worker: serves the static atlas, writes per-link preview tags, and draws
// a 1200×630 preview image for every shareable link.
import { ImageResponse } from 'workers-og';
import D from './og-data.json';
import eczar from '@fontsource/eczar/files/eczar-latin-600-normal.woff';
import serif from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff';
import serifBold from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff';
import mono from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff';
import fell from '@fontsource/im-fell-english-sc/files/im-fell-english-sc-latin-400-normal.woff';

const FONTS = [
  { name: 'Eczar', data: eczar, weight: 600, style: 'normal' },
  { name: 'Serif', data: serif, weight: 400, style: 'normal' },
  { name: 'Serif', data: serifBold, weight: 600, style: 'normal' },
  { name: 'Mono', data: mono, weight: 500, style: 'normal' },
  { name: 'Fell', data: fell, weight: 400, style: 'normal' }
];
const C = { paper: '#f2ece0', ink: '#1f1b16', ink2: '#4d463d', ink3: '#6f665a', acc: '#c8361f', sea: '#dde3df', track: '#e6dfd0' };
const MIN = -2600, MAX = 1857, SEG = [[-2600, 0], [-600, 0.14], [MAX, 1]];
const SITE = 'kaalchakra.anokha.space';

// ---------- helpers
const y2p = y => { for (let i = 1; i < SEG.length; i++) if (y <= SEG[i][0]) { const [y0, p0] = SEG[i - 1], [y1, p1] = SEG[i]; return p0 + (y - y0) / (y1 - y0) * (p1 - p0); } return 1; };
const fmtY = y => y < 0 ? `${-y} BCE` : `${y} CE`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
function activeAt(y) {
  const out = [];
  D.polities.forEach((p, pi) => { const ph = p.phases.find(ph => y >= ph[0] && y < ph[1]); if (ph) out.push({ p, pi, regions: ph[2], area: ph[3] }); });
  return out.sort((a, b) => b.area - a.area);
}
const rulerOf = (p, y) => { const r = p.rulers.find(r => y >= r[0] && y < r[1]); return r ? r[2] : null; };
const eraOf = y => { const e = D.eras.find(e => y >= e[0] && y < e[1]); return e ? e[2] : ''; };
// "the Pandya Kingdom", "the Mughal Empire", but plain "Avanti" or "Kashi"
const the = n => /^(The |Kingdom of )/.test(n) || !/(Kingdom|Empire|Dynasty|Sultanate|Company|Republic|Confederacy|Civilisation|Kings|Kingdoms|Persia|Satraps|Huns|Chalukyas|Cholas|Gangas|Nagas|Abhiras|Maukharis|Guptas|Kalachuris|Ikshvakus|Vishnukundinas|Maitrakas|Aulikaras|Panduvamshis|Somavamshis|Shahis|Gahadavalas|Chodas|Marathas|Nizams|Nawabs|Paramaras|Chandelas|Pratiharas|Palas|Senas|Yadavas|Hoysalas|Kakatiyas|Durranis|Scythians|tribes|Chutus)/.test(n) ? n : 'the ' + n;
const nameAt = (c, y) => { const n = c.names.find(n => y >= n[0] && y < n[1]); return n ? n[2] : null; };

// ---------- what each link is about
function describe(url) {
  const q = url.searchParams, origin = url.hostname === 'localhost' ? url.origin : `https://${url.host}`;
  const img = (path) => `${origin}/og/${path}.png?v=${D.version}`;
  const home = q.get('home'), p = q.get('p'), j = q.get('j'), y = parseInt(q.get('y'), 10);
  if (home && D.towns[home]) {
    const t = D.towns[home];
    return t.powers
      ? { title: `Who ruled ${t.name}? ${t.powers} powers since 2600 BCE`, desc: `${t.first === t.last ? `Ruled by ${the(t.first)}` : `From ${the(t.first)} to ${the(t.last)}`}: every power that held ${t.name}, on one map of 4,000 years. Find who ruled your city.`, image: img(`home/${home}`) }
      : { title: `Who ruled ${t.name}?`, desc: `Trace who held ${t.name} across 4,000 years of Indian history.`, image: img(`home/${home}`) };
  }
  if (j && D.journeys[j]) {
    const J = D.journeys[j], k = Math.min(J.stops.length, Math.max(1, parseInt(q.get('s'), 10) || 1)) - 1, s = J.stops[k];
    return { title: `${J.who} at ${s[2]}, ${fmtY(s[0])}`, desc: clip(s[3], 180), image: img(`j/${j}/${k + 1}`) };
  }
  if (p && D.cities[p]) {
    const c = D.cities[p], names = [...new Set(c.names.map(n => n[2]))];
    return { title: names.length > 1 ? `${names.join(' → ')}` : `${names[0]} through history`, desc: c.fact, image: img(`p/${p}`) };
  }
  if (q.has('quiz')) return { title: 'Kaalchakra daily quiz: can you find 5 lost cities?', desc: 'A new map quiz every day. Find Pataliputra, Vijayanagara and more on an unlabelled map of India.', image: img('quiz') };
  if (Number.isFinite(y) && y >= MIN && y <= MAX && y !== 0) {
    const act = activeAt(y), top = act[0], r = top && rulerOf(top.p, y);
    return { title: `India in ${fmtY(y)}: ${act.length} power${act.length === 1 ? '' : 's'} on one map`,
      desc: act.length ? `${r ? r + "'s " : ''}${top.p.name}${act.length > 1 ? `, ${act.slice(1, 4).map(a => a.p.name).join(', ')} and more` : ''}. Drag through 4,000 years of Indian history.` : 'Drag through 4,000 years of Indian history.',
      image: img(`y/${y}`) };
  }
  return { title: 'Kaalchakra · 4,000 years of India on one map', desc: 'Watch empires rise and fall, follow Xuanzang and Ibn Battuta, and find out who ruled your city.', image: img('default') };
}

// ---------- mini map (SVG, embedded as an image)
function miniMap({ year = null, faint = false, pins = [], route = null, routeColor = C.acc, current = -1 }) {
  const [W, H] = D.mini;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<defs><clipPath id="l"><path d="${D.landPath}"/></clipPath><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter></defs>`;
  s += `<rect width="${W}" height="${H}" fill="${C.sea}"/>`;
  let hatch = ''; for (let y = 2; y < H; y += 5) hatch += `M0 ${y}H${W}`;
  s += `<path d="${hatch}" stroke="#5f7c8c" stroke-opacity=".28" stroke-width=".6"/>`;
  s += `<path d="${D.landPath}" fill="${C.paper}"/>`;
  if (year !== null) {
    s += `<g clip-path="url(#l)">`;
    activeAt(year).slice().reverse().forEach(a => {
      s += `<g opacity="${faint ? .35 : .6}" fill="${a.p.color}" filter="url(#soft)">` + a.regions.map(k => { const [x, y, r] = D.regions[k]; return `<circle cx="${x}" cy="${y}" r="${r}"/>`; }).join('') + `</g>`;
    });
    s += `</g>`;
  }
  s += `<path d="${D.riverPath}" fill="none" stroke="#5d86a0" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
  s += `<path d="${D.landPath}" fill="none" stroke="${C.ink2}" stroke-width=".8"/>`;
  if (route) {
    s += `<path d="M${route.map(p => p.join(',')).join('L')}" fill="none" stroke="${routeColor}" stroke-width="2.4" stroke-linejoin="round" stroke-dasharray="1 0"/>`;
    route.forEach((p, i) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="${i === current ? 0 : 3.2}" fill="${C.paper}" stroke="${routeColor}" stroke-width="1.6"/>`; });
  }
  pins.forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${C.acc}" stroke-width="2.4"/><circle cx="${x}" cy="${y}" r="7" fill="${C.acc}" stroke="${C.paper}" stroke-width="2"/>`; });
  s += `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.ink2}" stroke-opacity=".5"/></svg>`;
  return `<img src="data:image/svg+xml;base64,${btoa(s)}" width="300" height="${Math.round(300 * H / W)}" />`;
}

// ---------- card frame
function card(left, map, foot = 'Who ruled your city?') {
  return `<div style="display:flex;width:1200px;height:630px;background:${C.paper};padding:22px;font-family:Serif;color:${C.ink}">
  <div style="display:flex;flex-direction:column;flex:1;border:2px solid ${C.ink};padding:28px 40px 22px">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(31,27,22,.4);padding-bottom:12px">
      <div style="display:flex;flex:1;font-family:Fell;font-size:30px">Kaalchakra</div>
      <div style="display:flex;flex-grow:0;font-family:Mono;font-size:16px;color:${C.ink3};letter-spacing:2px">AN ATLAS OF INDIA · 2600 BCE – 1857</div>
    </div>
    <div style="display:flex;flex:1;margin-top:22px">
      <div style="display:flex;flex-direction:column;flex:1;padding-right:30px">${left}</div>
      <div style="display:flex;align-items:center">${map}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(31,27,22,.4);padding-top:12px">
      <div style="display:flex;flex:1;font-weight:600;font-size:22px">${esc(foot)}</div>
      <div style="display:flex;flex-grow:0;font-family:Mono;font-size:18px;color:${C.acc}">${SITE}</div>
    </div>
  </div></div>`;
}
const kicker = t => `<span style="font-family:Mono;font-size:17px;letter-spacing:2px;color:${C.acc}">${esc(t.toUpperCase())}</span>`;
const big = (t, max = 96) => { const size = t.length <= 8 ? max : t.length <= 12 ? Math.round(max * .8) : t.length <= 18 ? Math.round(max * .62) : Math.round(max * .5); return `<span style="font-family:Eczar;font-size:${size}px;line-height:1.05;margin-top:6px;letter-spacing:-1px">${esc(t)}</span>`; };

function homeCard(id) {
  const t = D.towns[id];
  const strip = t.runs.map(([a, b, pi]) => `<div style="display:flex;width:${Math.max(1, (y2p(b) - y2p(a)) * 640).toFixed(1)}px;height:100%;background:${pi < 0 ? C.track : D.polities[pi].color}"></div>`).join('');
  const left = `${kicker('Who ruled the ground in')}${big(t.name)}
    <span style="font-size:24px;color:${C.ink2};margin-top:2px">${esc(t.region)}</span>
    <div style="display:flex;align-items:center;margin-top:14px">
      <span style="font-family:Eczar;font-size:120px;line-height:1;letter-spacing:-3px">${t.powers}</span>
      <div style="display:flex;flex-direction:column;margin-left:18px">
        <span style="font-weight:600;font-size:28px">${t.powers === 1 ? 'power ruled here' : 'powers ruled here'}</span>
        ${t.longest ? `<span style="font-size:21px;color:${C.ink2};margin-top:4px">Longest: ${esc(t.longest[0])}, ${t.longest[1]} yrs</span>` : ''}
      </div>
    </div>
    <div style="display:flex;width:640px;height:28px;border:1.5px solid ${C.ink};margin-top:16px;overflow:hidden">${strip}</div>
    <div style="display:flex;justify-content:space-between;width:640px;margin-top:6px;font-family:Mono;font-size:14px;color:${C.ink3}"><span>2600 BCE</span><span>1 CE</span><span>1857</span></div>`;
  return card(left, miniMap({ pins: [t.xy] }));
}
function yearCard(y) {
  const act = activeAt(y), top = act[0], r = top && rulerOf(top.p, y);
  const chips = act.slice(0, 8).map(a => `<div style="display:flex;align-items:center;width:310px;margin-top:9px"><div style="display:flex;width:14px;height:14px;background:${a.p.color};margin-right:10px"></div><span style="font-size:21px">${esc(clip(a.p.name, 26))}</span></div>`).join('');
  const left = `${kicker(eraOf(y) || 'India')}${big(fmtY(y), 110)}
    <span style="font-weight:600;font-size:28px;margin-top:4px">${act.length} power${act.length === 1 ? '' : 's'} shared the subcontinent</span>
    ${r ? `<span style="font-size:22px;color:${C.ink2};margin-top:4px">${esc(r)} · ${esc(top.p.name)}</span>` : ''}
    <div style="display:flex;flex-wrap:wrap;margin-top:8px">${chips}</div>`;
  return card(left, miniMap({ year: y }), 'Drag through 4,000 years');
}
function journeyCard(id, n) {
  const J = D.journeys[id], k = Math.min(J.stops.length, Math.max(1, n)) - 1, s = J.stops[k];
  const left = `${kicker(`${J.who} · ${J.title}`)}${big(s[2], 88)}
    <span style="font-size:24px;color:${C.ink2};margin-top:4px">${fmtY(s[0])} · stop ${k + 1} of ${J.stops.length}</span>
    <span style="font-size:27px;line-height:1.4;margin-top:18px">${esc(clip(s[3], 170))}</span>`;
  return card(left, miniMap({ year: s[0], faint: true, route: J.stops.map(x => x[1]), routeColor: J.color, current: k, pins: [s[1]] }), `Follow ${J.who}'s journey`);
}
function placeCard(id) {
  const c = D.cities[id], last = c.names[c.names.length - 1][2];
  const rows = c.names.slice(0, 5).map(n => `<div style="display:flex;justify-content:space-between;align-items:baseline;width:560px;border-bottom:1px solid rgba(31,27,22,.18);padding:7px 0"><span style="font-size:27px">${esc(n[2])}</span><span style="font-family:Mono;font-size:16px;color:${C.ink3}">from ${fmtY(Math.max(n[0], MIN))}</span></div>`).join('');
  const left = `${kicker('Trace a place')}${big(last)}
    <div style="display:flex;flex-direction:column;margin-top:10px">${rows}</div>
    <span style="font-size:21px;color:${C.ink2};line-height:1.4;margin-top:12px">${esc(clip(c.fact, 130))}</span>`;
  return card(left, miniMap({ pins: [c.xy] }));
}
function introCard(quiz) {
  const left = quiz
    ? `${kicker('Daily quiz')}${big('Can you find 5 lost cities?', 92)}<span style="font-size:27px;color:${C.ink2};margin-top:16px;line-height:1.4">Pataliputra, Vijayanagara, Muziris… A new map quiz every day.</span>`
    : `${kicker('An atlas of India')}${big('4,000 years of India on one map', 92)}<span style="font-size:27px;color:${C.ink2};margin-top:16px;line-height:1.4">Watch empires rise and fall. Follow Xuanzang and Ibn Battuta. Find out who ruled your city.</span>`;
  return card(left, miniMap({ year: quiz ? 640 : 1030 }), quiz ? 'Play today’s map' : 'Who ruled your city?');
}

async function ogImage(url, ctx) {
  const cache = caches.default, hit = await cache.match(url.toString());
  if (hit) return hit;
  const parts = url.pathname.replace(/^\/og\//, '').replace(/\.png$/, '').split('/');
  let html;
  if (parts[0] === 'home' && D.towns[parts[1]]) html = homeCard(parts[1]);
  else if (parts[0] === 'y' && Number.isFinite(+parts[1]) && +parts[1] >= MIN && +parts[1] <= MAX) html = yearCard(+parts[1]);
  else if (parts[0] === 'j' && D.journeys[parts[1]]) html = journeyCard(parts[1], +parts[2] || 1);
  else if (parts[0] === 'p' && D.cities[parts[1]]) html = placeCard(parts[1]);
  else html = introCard(parts[0] === 'quiz');
  const img = new ImageResponse(html, { width: 1200, height: 630, fonts: FONTS });
  const res = new Response(img.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800, immutable' } });
  ctx.waitUntil(cache.put(url.toString(), res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/og/')) return ogImage(url, ctx);
    const res = await env.ASSETS.fetch(request);
    if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
    const m = describe(url), full = `${m.title} · Kaalchakra`.replace(' · Kaalchakra · Kaalchakra', ' · Kaalchakra');
    const set = (sel, val) => [sel, { element(el) { el.setAttribute('content', val); } }];
    let rw = new HTMLRewriter()
      .on('title', { element(el) { el.setInnerContent(full); } })
      .on('link[rel="canonical"]', { element(el) { el.setAttribute('href', url.toString()); } });
    for (const [sel, h] of [set('meta[name="description"]', m.desc), set('meta[property="og:title"]', m.title), set('meta[property="og:description"]', m.desc),
      set('meta[property="og:image"]', m.image), set('meta[property="og:url"]', url.toString()), set('meta[name="twitter:title"]', m.title),
      set('meta[name="twitter:description"]', m.desc), set('meta[name="twitter:image"]', m.image)]) rw = rw.on(sel, h);
    const out = rw.transform(res);
    const headers = new Headers(out.headers); headers.set('cache-control', 'public, max-age=0, must-revalidate');
    return new Response(out.body, { status: out.status, headers });
  }
};
