#!/usr/bin/env node
/**
 * Merge Osprey Charging UK locations into data/uk-chargers.js.
 *
 * Auth (secrets — never logged or written to the repo):
 *   process.env.OSPREY_API_PASSWORD — HTTP Basic password. Required for a live fetch.
 *   process.env.OSPREY_API_USER     — HTTP Basic username. Defaults to the
 *     operator account below when unset.
 *   process.env.OSPREY_API_URL      — optional. Defaults to the UK open-data URL.
 *
 * Without a password, pass a saved OCPI JSON file:
 *   node scripts/build-osprey.js /path/to/osprey-ocpi.json
 * Also checks uploads/osprey-ocpi.json and .cache/ocpi/osprey.json.
 *
 * Dedupe: same normalised operator + ≤75 m, or same postcode + ≤100 m.
 * New ids: osprey:<ocpi-id>
 *
 * Usage: node scripts/build-osprey.js [snapshot.json]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'osprey-merge-report.json');
const CACHE_DIR = path.join(ROOT, '.cache', 'ocpi');
const CACHE_FILE = path.join(CACHE_DIR, 'osprey.json');
const UA = 'UK-EV-Map-build/1.0 (https://j4mhar-hash.github.io; Osprey Charging UK open data)';

const DEFAULT_API_URL = 'https://apigw.ospreycharging.co.uk/portal/backend/opendata/ocpi221';
const DEFAULT_API_USER = 'jamesharrop67@aol.com';

const MATCH_OP_M = 75;
const MATCH_PC_M = 100;

const STD = {
  IEC_62196_T2: 'T2',
  IEC_62196_T2_CABLE: 'T2',
  IEC_62196_T2_COMBO: 'CCS',
  IEC_62196_T1: 'T1',
  IEC_62196_T1_COMBO: 'CCS1',
  CHADEMO: 'CHA',
  DOMESTIC_G: '3PIN',
  DOMESTIC_A: '3PIN',
  TESLA_S: 'TSLA',
  TESLA_R: 'TSLA',
  NACS: 'TSLA',
};

function loadWindowJson(filePath, varName) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp('(?:window\\.)?' + varName + '\\s*=\\s*([\\s\\S]*?);\\s*$');
  const m = raw.match(re);
  let body;
  if (m) body = m[1];
  else {
    body = raw.slice(raw.indexOf('=') + 1).trim();
    if (body.endsWith(';')) body = body.slice(0, -1);
  }
  try {
    return JSON.parse(body);
  } catch {
    return Function('"use strict"; return (' + body + ')')();
  }
}

function normOp(s) {
  const t = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  if (t.includes('osprey')) return 'osprey';
  return t;
}

function normPostcode(pc) {
  return String(pc || '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

function extractPostcode(ad) {
  if (!ad) return null;
  const m = String(ad)
    .toUpperCase()
    .match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return m ? normPostcode(m[1]) : null;
}

function metresBetween(a1, o1, a2, o2) {
  const r = Math.PI / 180;
  const x = (o2 - o1) * r * Math.cos(((a1 + a2) / 2) * r);
  const y = (a2 - a1) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function cellKey(lat, lon) {
  return Math.floor(lat * 100) + ':' + Math.floor(lon * 100);
}

function buildIndex(items) {
  const grid = new Map();
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    const k = cellKey(s.a, s.o);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return grid;
}

function neighbours(grid, lat, lon) {
  const out = [];
  const cy = Math.floor(lat * 100);
  const cx = Math.floor(lon * 100);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = grid.get(cy + dy + ':' + (cx + dx));
      if (list) out.push(...list);
    }
  }
  return out;
}

function prepareBaseItem(s) {
  const copy = { ...s };
  copy._op = normOp(s.op || '');
  copy._pc = extractPostcode(s.ad) || null;
  return copy;
}

function enrich(base, feedItem) {
  let changed = false;
  if (feedItem.k != null) {
    if (base.k == null || feedItem.k > base.k) {
      base.k = feedItem.k;
      changed = true;
    }
  }
  if (feedItem.c && feedItem.c.length) {
    const set = new Set(base.c || []);
    const before = set.size;
    for (const c of feedItem.c) set.add(c);
    if (set.size !== before || !base.c) {
      base.c = [...set];
      changed = true;
    }
  }
  if ((!base.op || base.op === base.n) && feedItem.op) {
    base.op = feedItem.op;
    changed = true;
  }
  if (!base.n && feedItem.n) {
    base.n = feedItem.n;
    changed = true;
  }
  if (!base.ad && feedItem.ad) {
    base.ad = feedItem.ad;
    changed = true;
  }
  if ((base.cap == null || base.cap === '') && feedItem.cap != null) {
    base.cap = feedItem.cap;
    changed = true;
  }
  return changed;
}

function stripInternal(s) {
  const o = { id: s.id, a: s.a, o: s.o };
  if (s.k != null) o.k = s.k;
  if (s.c) o.c = s.c;
  if (s.n) o.n = s.n;
  if (s.op) o.op = s.op;
  if (s.cap != null && s.cap !== '') o.cap = s.cap;
  if (s.ad) o.ad = s.ad;
  for (const k of ['fee', 'acc', 'h', 'cl', 'dev']) {
    if (s[k] != null) o[k] = s[k];
  }
  return o;
}

function findMatch(item, baseItems, grid) {
  const idxs = neighbours(grid, item.a, item.o);
  let best = null;
  for (const i of idxs) {
    const b = baseItems[i];
    const dist = metresBetween(item.a, item.o, b.a, b.o);
    if (dist > MATCH_PC_M) continue;
    const sameOp = item._op && b._op && item._op === b._op;
    const samePc = item._pc && b._pc && item._pc === b._pc;
    const baseIsOsprey = b._op === 'osprey' || /osprey/i.test(b.op || '');
    let ok = false;
    if (sameOp && dist <= MATCH_OP_M) ok = true;
    else if (samePc && dist <= MATCH_PC_M) ok = true;
    else if (item._op === 'osprey' && baseIsOsprey && dist <= MATCH_OP_M) ok = true;
    if (!ok) continue;
    if (!best || dist < best.dist) best = { i, dist, sameOp, samePc };
  }
  return best;
}

function connKw(c) {
  if (c.max_electric_power != null && isFinite(c.max_electric_power) && c.max_electric_power > 0) {
    const p = +c.max_electric_power;
    return p >= 100 ? p / 1000 : p;
  }
  const v = c.max_voltage ?? c.voltage;
  const a = c.max_amperage ?? c.amperage;
  if (v && a && isFinite(v) && isFinite(a) && v > 0 && a > 0) {
    const mult = c.power_type === 'AC_3_PHASE' ? 3 : 1;
    return (v * a * mult) / 1000;
  }
  return null;
}

function isUkLocation(loc) {
  const country = String(loc.country || loc.country_code || '')
    .toUpperCase()
    .trim();
  if (['GBR', 'GB', 'UK', 'UNITED KINGDOM'].includes(country)) return true;
  const pc = String(loc.postal_code || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) {
    if (!country || ['GBR', 'GB', 'UK'].includes(country)) return true;
  }
  return false;
}

function compactOcpi(loc) {
  if (!loc || loc.publish === false) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (!isUkLocation(loc)) return null;

  const evses = (loc.evses || []).filter(e => String(e.status || '').toUpperCase() !== 'REMOVED');
  if ((loc.evses || []).length && evses.length === 0) return null;

  const conns = new Set();
  let bestKw = null;
  for (const e of evses) {
    for (const c of e.connectors || []) {
      const code = STD[c.standard];
      if (code) conns.add(code);
      const kw = connKw(c);
      if (kw != null && isFinite(kw) && kw > 0 && kw <= 1000) {
        bestKw = Math.max(bestKw || 0, kw);
      }
    }
  }

  const opName = (loc.operator && loc.operator.name) || 'Osprey';
  const name = (loc.name && String(loc.name).trim()) || null;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ') || null;
  const postcode = loc.postal_code ? String(loc.postal_code).trim() : null;
  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;

  const o = {
    id: 'osprey:' + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  o.op = opName;
  if (evses.length) o.cap = evses.length;
  if (ad) o.ad = ad;
  if (postcode) o._pc = normPostcode(postcode);
  o._op = 'osprey';
  o._feed = 'osprey';
  return o;
}

function extractLocations(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.locations)) return json.locations;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && json.data && Array.isArray(json.data.locations)) return json.data.locations;
  throw new Error('Osprey payload has no locations array');
}

function cacheLocations(locations, mode) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ mode, fetchedAt: new Date().toISOString(), locations })
  );
}

async function fetchLive() {
  const pass = process.env.OSPREY_API_PASSWORD;
  if (!pass) return null;
  const user = (process.env.OSPREY_API_USER || DEFAULT_API_USER).trim();
  const url = (process.env.OSPREY_API_URL || DEFAULT_API_URL).trim();
  console.log('Fetching Osprey OCPI locations (Basic Auth credentials present, not logged)…');
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
      Authorization: 'Basic ' + Buffer.from(user + ':' + pass, 'utf8').toString('base64'),
    },
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('Osprey OCPI HTTP ' + r.status);
  const json = await r.json();
  const locations = extractLocations(json);
  cacheLocations(locations, 'api');
  return locations;
}

function localCandidates() {
  const list = [];
  if (process.argv[2]) list.push(path.resolve(process.argv[2]));
  if (process.env.OSPREY_OCPI_FILE) list.push(path.resolve(process.env.OSPREY_OCPI_FILE));
  list.push(path.join(ROOT, 'uploads', 'osprey-ocpi.json'));
  list.push(CACHE_FILE);
  return list;
}

function loadLocal() {
  for (const file of localCandidates()) {
    if (!file || !fs.existsSync(file)) continue;
    console.log('Reading Osprey snapshot', file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const locations = extractLocations(json);
    if (path.resolve(file) !== path.resolve(CACHE_FILE)) cacheLocations(locations, 'file');
    return locations;
  }
  return null;
}

async function loadOspreyLocations() {
  if (process.env.OSPREY_API_PASSWORD) {
    const live = await fetchLive();
    return { mode: 'api', locations: live };
  }
  const locations = loadLocal();
  if (!locations) {
    console.error(
      'No OSPREY_API_PASSWORD and no local snapshot. Pass a JSON path, or place uploads/osprey-ocpi.json or .cache/ocpi/osprey.json.'
    );
    process.exit(1);
  }
  return { mode: 'file', locations };
}

async function main() {
  console.log('Loading base snapshot…');
  const baseDoc = loadWindowJson(OUT_PATH, 'UK_CHARGERS');
  if (!baseDoc || !Array.isArray(baseDoc.items)) {
    console.error('Missing or invalid', OUT_PATH);
    process.exit(1);
  }
  const beforeCount = baseDoc.items.length;
  console.log('  base items:', beforeCount);

  const manualDoc = loadWindowJson(MANUAL_PATH, 'MANUAL_CHARGERS');
  const manualItems = (manualDoc && manualDoc.items) || [];

  const byId = new Map();
  for (const s of baseDoc.items) byId.set(s.id, prepareBaseItem(s));
  for (const s of manualItems) {
    if (!byId.has(s.id)) byId.set(s.id, prepareBaseItem(s));
  }

  let baseItems = [...byId.values()];
  let grid = buildIndex(baseItems);

  const loaded = await loadOspreyLocations();
  const rawLocations = loaded.locations || [];
  console.log('Osprey feed mode:', loaded.mode, 'raw locations:', rawLocations.length);

  let added = 0,
    matched = 0,
    enriched = 0,
    skipped = 0,
    nonUk = 0;
  const sampleAdds = [];
  const sampleEnriched = [];

  for (const loc of rawLocations) {
    if (loc && loc.coordinates && !isUkLocation(loc)) {
      nonUk++;
      continue;
    }
    const item = compactOcpi(loc);
    if (!item) {
      skipped++;
      continue;
    }
    item._pc = item._pc || extractPostcode(item.ad);
    const match = findMatch(item, baseItems, grid);
    if (match) {
      matched++;
      if (enrich(baseItems[match.i], item)) {
        enriched++;
        if (sampleEnriched.length < 8) {
          const b = baseItems[match.i];
          sampleEnriched.push({ id: b.id, n: b.n, op: b.op, k: b.k, cap: b.cap, distM: Math.round(match.dist) });
        }
      }
    } else {
      byId.set(item.id, item);
      baseItems.push(item);
      grid = buildIndex(baseItems);
      added++;
      if (sampleAdds.length < 12) {
        sampleAdds.push({
          id: item.id,
          n: item.n,
          op: item.op,
          ad: item.ad,
          k: item.k,
          c: item.c,
          cap: item.cap,
          a: item.a,
          o: item.o,
        });
      }
    }
  }

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const ospreyCredit = 'Osprey Charging open data / UK PCPR OCPI 2.2.1 (adapted; source: Osprey Charging)';
  const baseParts = String(baseDoc.source || 'Open Charge Map (ocm-export)')
    .split(/;\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(part => !/Osprey/i.test(part));
  const sources = [...baseParts, ospreyCredit];

  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    osprey: {
      label: 'Osprey Charging',
      mode: loaded.mode,
      raw: rawLocations.length,
      added,
      matched,
      enriched,
      skipped,
      nonUk,
    },
  });

  const meta = {
    generated: new Date().toISOString(),
    source: sources.join('; '),
    regions: baseDoc.regions || 'United Kingdom (GB)',
    count: outItems.length,
    feeds,
  };

  fs.writeFileSync(
    OUT_PATH,
    'window.UK_CHARGERS=' +
      JSON.stringify(meta).slice(0, -1) +
      ',"items":[\n' +
      outItems.map(i => JSON.stringify(i)).join(',\n') +
      '\n]};\n'
  );
  const size = fs.statSync(OUT_PATH).size;

  const report = {
    before: beforeCount,
    after: outItems.length,
    netNew: outItems.length - beforeCount,
    fileBytes: size,
    mode: loaded.mode,
    ospreyRaw: rawLocations.length,
    added,
    matched,
    enriched,
    skipped,
    nonUk,
    sampleAdds,
    sampleEnriched,
    generated: meta.generated,
    note: 'Osprey Charging UK open data, OCPI 2.2.1. Credentials are not stored.',
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== Osprey merge report ===');
  console.log('Mode:', loaded.mode);
  console.log('Before:', beforeCount);
  console.log('After:', outItems.length);
  console.log('Added:', added, 'matched:', matched, 'enriched:', enriched, 'skipped:', skipped, 'nonUk:', nonUk);
  console.log('Net new:', outItems.length - beforeCount);
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', REPORT_PATH);
}

main().catch(e => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
