#!/usr/bin/env node
// Builds data/uk-chargers.js: a compact snapshot of every OSM amenity=charging_station in the UK.
// Source: OpenStreetMap contributors via the Overpass API (ODbL). Run: node scripts/build-data.js
const fs = require('fs'), path = require('path');
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const Q = '[out:json][timeout:600];area["ISO3166-1"="GB"][admin_level=2]->.uk;nwr["amenity"="charging_station"](area.uk);out center tags;';
const UA = 'UK-EV-Map-Prototype/0.1 (personal prototype; contact via repo owner)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseKw(v) {
  if (!v) return null; let best = null;
  for (const part of String(v).split(/[;,/]|\s+x\s+/)) {
    const m = part.trim().match(/([\d.]+)\s*(kw|kva|w|mw)?/i); if (!m) continue;
    let n = parseFloat(m[1]); if (!isFinite(n)) continue;
    const u = (m[2] || '').toLowerCase();
    if (u === 'w' || (!u && n > 1000)) n = n / 1000; else if (u === 'mw') n *= 1000;
    if (n > 0 && n <= 1000) best = Math.max(best || 0, n);
  }
  return best;
}
const CONN = { // OSM socket key -> app connector code
  type2: 'T2', type2_cable: 'T2', type2_combo: 'CCS', chademo: 'CHA', type1: 'T1', type1_combo: 'CCS1',
  bs1363: '3PIN', tesla_supercharger: 'TSLA', tesla_destination: 'TSLA', tesla_supercharger_ccs: 'CCS', schuko: 'SCH', type3c: 'T3',
};
function compact(e) {
  const t = e.tags || {}; const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (lat == null) return null;
  if (['private', 'no'].includes(t.access)) return null;
  let kw = null; const conns = new Set();
  for (const [k, v] of Object.entries(t)) {
    const m = k.match(/^socket:([a-z0-9_]+)(?::(output|power))?$/);
    if (m) { if (CONN[m[1]] && !m[2] && v !== '0' && v !== 'no') conns.add(CONN[m[1]]); if (m[2]) kw = Math.max(kw || 0, parseKw(v) || 0) || kw; }
    if (/^(charging_station:output|maxpower|output|power)$/.test(k)) kw = Math.max(kw || 0, parseKw(v) || 0) || kw;
  }
  const o = { id: e.type[0] + e.id, a: +lat.toFixed(5), o: +lon.toFixed(5) };
  if (kw) o.k = Math.round(kw * 10) / 10;
  if (conns.size) o.c = [...conns];
  const name = t.name || t.brand || t.operator; if (name) o.n = name;
  if (t.operator && t.operator !== name) o.op = t.operator;
  if (t.capacity) o.cap = t.capacity;
  if (t.fee) o.fee = t.fee;
  if (t.access) o.acc = t.access;
  if (t.opening_hours) o.h = t.opening_hours;
  const addr = [t['addr:housenumber'], t['addr:street'], t['addr:city'] || t['addr:town'], t['addr:postcode']].filter(Boolean).join(' ');
  if (addr) o.ad = addr;
  if (t['payment:contactless'] === 'yes') o.cl = 1;
  return o;
}
async function query(q, label) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const url = MIRRORS[(attempt + 1) % MIRRORS.length]; // start on mail.ru (less loaded), rotate
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); if (j.remark && /error|timed out/i.test(j.remark)) throw new Error(j.remark);
      console.log(`  ${label}: ${j.elements.length} from ${url}`); return j;
    } catch (err) { console.log(`  ${label} attempt ${attempt + 1} ${url} failed: ${err.message}`); await sleep(Math.min(60000, 5000 * (attempt + 1))); }
  }
  throw new Error('All Overpass mirrors failed for ' + label);
}
module.exports = { compact, parseKw };
if (require.main === module) (async () => {
  // UK split into tiles (lat 49.8–60.9, lon -8.7–1.8) to keep each Overpass query small
  const tiles = []; for (let la = 49.8; la < 61; la += 1.5) for (let lo = -8.7; lo < 1.9; lo += 2) tiles.push([la, lo, Math.min(la + 1.5, 61), Math.min(lo + 2, 1.9)]);
  const seen = new Map(); let osmBase = null;
  // tiles that contain no UK land at all
  const SKIP = new Set(['49.8,-8.7', '60.3,-8.7', '60.3,-6.7', '60.3,-4.7', '60.3,1.3', '58.8,1.3', '57.3,1.3', '55.8,1.3', '54.3,1.3']);
  // tiles that also contain Ireland / France / Isle of Man need the (slower) UK area filter; the rest are plain bbox queries
  const needsArea = (s, w) => w < -4.5 || (s < 51.3 && w > 1) || (s >= 53.5 && s < 55 && w < -3);
  const cacheDir = path.join(__dirname, '..', '.tile-cache'); fs.mkdirSync(cacheDir, { recursive: true });
  for (const [s, w, n, e] of tiles) {
    const key = `${+s.toFixed(1)},${+w.toFixed(1)}`; if (SKIP.has(key)) continue;
    const cf = path.join(cacheDir, key + '.json'); let j;
    if (fs.existsSync(cf)) j = JSON.parse(fs.readFileSync(cf));
    else {
      const bb = `(${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)})`;
      const q = needsArea(s, w)
        ? `[out:json][timeout:110];area["ISO3166-1"="GB"][admin_level=2]->.uk;nwr["amenity"="charging_station"](area.uk)${bb};out center tags;`
        : `[out:json][timeout:110];nwr["amenity"="charging_station"]${bb};out center tags;`;
      j = await query(q, 'tile ' + key); fs.writeFileSync(cf, JSON.stringify(j)); await sleep(1500);
    }
    osmBase = j.osm3s?.timestamp_osm_base || osmBase;
    for (const el of j.elements) seen.set(el.type + el.id, el);
  }
  const elements = [...seen.values()];
  const items = elements.map(compact).filter(Boolean);
  const out = { generated: new Date().toISOString(), osm_base: osmBase, source: 'OpenStreetMap contributors (ODbL) via Overpass API', count: items.length, items };
  const dir = path.join(__dirname, '..', 'data'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'uk-chargers.js'), 'window.UK_CHARGERS=' + JSON.stringify(out) + ';\n');
  console.log('Wrote', items.length, 'stations (of', elements.length, 'raw)');
})();
