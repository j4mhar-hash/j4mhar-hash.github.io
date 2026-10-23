#!/usr/bin/env node
/**
 * Merge free UK PCPR/OCPI location feeds into data/uk-chargers.js.
 *
 * Base: existing Open Charge Map snapshot (data/uk-chargers.js)
 * Plus: data/manual-chargers.js (never dropped)
 * Feeds (no API keys):
 *   - char.gy      https://char.gy/open-ocpi/locations
 *   - Clenergy/CEV https://api.clenergy.online/development/pcpr/locations
 *   - MFG          https://opendata.motorfuelgroup.net/locations
 *   - Monta        https://public-api.monta.com/api/v1/open-data/locations  (GBR/GB only)
 *
 * Dedupe vs OCM:
 *   - same normalised operator + distance ≤ 75 m, OR
 *   - same postcode + distance ≤ 100 m
 * On match: enrich power / connectors / operator; keep OCM id.
 * On no match: add with id prefix cgy: / cev: / mfg: / monta:
 * Never delete OCM-only or manual entries.
 *
 * Usage: node scripts/build-ocpi-merge.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const CACHE_DIR = path.join(ROOT, '.cache', 'ocpi');
const UA = 'UK-EV-Map-build/1.0 (https://j4mhar-hash.github.io; PCPR open-data merge)';

const MATCH_OP_M = 75;
const MATCH_PC_M = 100;

// OCPI connector standard → app codes (must match index.html CONNS)
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

const FEEDS = [
  {
    key: 'cgy',
    label: 'char.gy',
    operatorHint: 'char.gy',
    mode: 'paginate',
    url: 'https://char.gy/open-ocpi/locations',
    pageSize: 50, // char.gy silently caps at 50
  },
  {
    key: 'cev',
    label: 'Clenergy (CEV)',
    operatorHint: 'Clenergy',
    mode: 'oneshot',
    url: 'https://api.clenergy.online/development/pcpr/locations',
  },
  {
    key: 'mfg',
    label: 'MFG EV Power',
    operatorHint: 'MFG EV Power',
    mode: 'oneshot',
    url: 'https://opendata.motorfuelgroup.net/locations',
  },
  {
    key: 'monta',
    label: 'Monta open data',
    operatorHint: 'Monta',
    mode: 'monta',
    url: 'https://public-api.monta.com/api/v1/open-data/locations',
    pageSize: 100,
  },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url, { retries = 3 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const total = r.headers.get('x-total-count');
      const json = await r.json();
      return { json, total: total != null ? +total : null, headers: r.headers };
    } catch (e) {
      last = e;
      console.warn('  retry', i + 1, url.slice(0, 80), e.message);
      await sleep(500 * (i + 1));
    }
  }
  throw last;
}

function loadWindowJson(filePath, varName) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(
    '(?:window\\.)?' + varName + '\\s*=\\s*([\\s\\S]*?);\\s*$'
  );
  const m = raw.match(re);
  if (!m) {
    // try JSON object after assignment with trailing comments stripped
    const idx = raw.indexOf('{');
    if (idx < 0) throw new Error('Cannot parse ' + filePath);
    // evaluate as JS object literal via Function for trailing commas etc.
    // Safer: strip to first assignment value
    let body = raw.slice(raw.indexOf('=') + 1).trim();
    if (body.endsWith(';')) body = body.slice(0, -1);
    return Function('"use strict"; return (' + body + ')')();
  }
  // Prefer JSON.parse when possible; fall back to Function for JS object literals
  try {
    return JSON.parse(m[1]);
  } catch {
    return Function('"use strict"; return (' + m[1] + ')')();
  }
}

function connKw(c) {
  if (c.max_electric_power != null && isFinite(c.max_electric_power) && c.max_electric_power > 0) {
    const p = +c.max_electric_power;
    return p >= 100 ? p / 1000 : p; // Watts if large, else already kW
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
  const country = String(loc.country || '').toUpperCase().trim();
  if (['GBR', 'GB', 'UK', 'UNITED KINGDOM'].includes(country)) return true;
  const pc = String(loc.postal_code || '').toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) {
    // UK postcode — accept unless country is clearly another ISO3
    if (!country || country === 'DK') return true; // Monta party DK + UK postcode
    if (['GBR', 'GB', 'UK'].includes(country)) return true;
  }
  return false;
}

function compactOcpi(loc, feed) {
  if (!loc || loc.publish === false) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (!isUkLocation(loc)) return null;

  const evses = (loc.evses || []).filter(e => {
    const st = String(e.status || '').toUpperCase();
    return st !== 'REMOVED';
  });
  if ((loc.evses || []).length && evses.length === 0) return null; // all removed

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

  const opName =
    (loc.operator && loc.operator.name) ||
    (loc.suboperator && loc.suboperator.name) ||
    (loc.sub_operator && loc.sub_operator.name) ||
    feed.operatorHint;

  const name = (loc.name && String(loc.name).trim()) || null;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ') || null;
  const postcode = loc.postal_code ? String(loc.postal_code).trim() : null;

  const o = {
    id: feed.key + ':' + loc.id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  if (opName && opName !== name) o.op = opName;
  else if (opName) o.op = opName;
  const cap = evses.length || null;
  if (cap) o.cap = cap;
  if (ad) o.ad = ad;
  if (postcode) o._pc = normPostcode(postcode);
  o._op = normOp(opName || name || '');
  o._feed = feed.key;
  return o;
}

function normOp(s) {
  let t = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/&/g, 'and');
  t = t.replace(/[^a-z0-9]+/g, '');
  // aliases
  const aliases = {
    chargy: 'chargy',
    char: 'chargy',
    clenergy: 'clenergy',
    clenergycev: 'clenergy',
    cev: 'clenergy',
    mfgevpower: 'mfg',
    mfg: 'mfg',
    motorfuelgroup: 'mfg',
    motorfuel: 'mfg',
    monta: 'monta',
    montaaps: 'monta',
  };
  if (aliases[t]) return aliases[t];
  if (t.startsWith('chargy') || t === 'chargy') return 'chargy';
  if (t.includes('clenergy')) return 'clenergy';
  if (t.includes('mfgev') || t === 'mfg') return 'mfg';
  if (t.includes('monta')) return 'monta';
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

/** ~110 m cells at mid-latitudes for neighbour search */
function cellKey(lat, lon, scale = 100) {
  return Math.floor(lat * scale) + ':' + Math.floor(lon * scale);
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
  copy._op = normOp(s.op || s.n || '');
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
  // preserve any extra public fields already present on OCM rows
  for (const k of ['fee', 'acc', 'h', 'cl']) {
    if (s[k] != null) o[k] = s[k];
  }
  return o;
}

async function fetchCharGy(feed) {
  let pageSize = feed.pageSize || 100;
  const first = await fetchJson(`${feed.url}?limit=${pageSize}&offset=0`);
  const total = first.total || (first.json.data || []).length;
  const got = (first.json.data || []).length;
  // Honour silent server caps (char.gy returns max 50 regardless of limit=)
  const hdrLimit = first.headers && first.headers.get && +first.headers.get('x-limit');
  if (got > 0 && got < pageSize) pageSize = got;
  else if (hdrLimit && hdrLimit < pageSize) pageSize = hdrLimit;
  const pages = [first.json.data || []];
  console.log(`  ${feed.label}: total ${total}, pageSize ${pageSize}`);
  const offsets = [];
  for (let off = pageSize; off < total; off += pageSize) offsets.push(off);
  while (offsets.length) {
    const batch = offsets.splice(0, 4);
    const res = await Promise.all(
      batch.map(off =>
        fetchJson(`${feed.url}?limit=${pageSize}&offset=${off}`)
          .then(x => x.json.data || [])
          .catch(e => {
            console.warn('  page fail', off, e.message);
            return [];
          })
      )
    );
    pages.push(...res);
    const n = pages.reduce((a, p) => a + p.length, 0);
    process.stdout.write(`  … ${n}/${total}\r`);
    await sleep(200);
  }
  const flat = pages.flat();
  // de-dupe by id in case of overlap
  const seen = new Set();
  const uniq = [];
  for (const loc of flat) {
    if (!loc || loc.id == null) continue;
    if (seen.has(loc.id)) continue;
    seen.add(loc.id);
    uniq.push(loc);
  }
  console.log(`  ${feed.label}: fetched ${uniq.length}`);
  return uniq;
}

async function fetchOneshot(feed) {
  console.log(`  ${feed.label}: downloading…`);
  const { json } = await fetchJson(feed.url);
  const data = json.data || json || [];
  console.log(`  ${feed.label}: ${data.length} locations`);
  return data;
}

async function fetchMonta(feed) {
  const pageSize = feed.pageSize || 100;
  let after = null;
  const all = [];
  let pages = 0;
  for (;;) {
    let url = `${feed.url}?per_page=${pageSize}`;
    if (after != null) url += `&after=${after}`;
    const { json } = await fetchJson(url);
    const data = json.data || [];
    all.push(...data);
    pages++;
    const meta = (json.meta && json.meta.pagination) || {};
    if (pages % 20 === 0 || !meta.has_more) {
      console.log(`  ${feed.label}: pages ${pages}, locations ${all.length}, has_more=${meta.has_more}`);
    }
    if (!meta.has_more || !data.length) break;
    after = meta.after;
    if (after == null) break;
    await sleep(80);
  }
  return all;
}

async function loadFeed(feed) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, feed.key + '.json');
  // Reuse cache fresher than 12 h
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 12 * 3600 * 1000) {
      console.log(`  ${feed.label}: using cache (${(age / 60000).toFixed(0)} min old)`);
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }
  let data;
  if (feed.mode === 'paginate') data = await fetchCharGy(feed);
  else if (feed.mode === 'monta') data = await fetchMonta(feed);
  else data = await fetchOneshot(feed);
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
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
    let ok = false;
    if (sameOp && dist <= MATCH_OP_M) ok = true;
    else if (samePc && dist <= MATCH_PC_M) ok = true;
    if (!ok) continue;
    if (!best || dist < best.dist) best = { i, dist, sameOp, samePc };
  }
  return best;
}

async function main() {
  console.log('Loading base snapshot…');
  const baseDoc = loadWindowJson(OUT_PATH, 'UK_CHARGERS');
  if (!baseDoc || !Array.isArray(baseDoc.items)) {
    console.error('Missing or invalid', OUT_PATH);
    process.exit(1);
  }
  const beforeCount = baseDoc.items.length;
  console.log('  OCM/base items:', beforeCount);

  const manualDoc = loadWindowJson(MANUAL_PATH, 'MANUAL_CHARGERS');
  const manualItems = (manualDoc && manualDoc.items) || [];
  console.log('  Manual items:', manualItems.length);

  // Start with OCM base + manuals (manuals win on id collision)
  const byId = new Map();
  for (const s of baseDoc.items) byId.set(s.id, prepareBaseItem(s));
  for (const s of manualItems) byId.set(s.id, prepareBaseItem(s));

  let baseItems = [...byId.values()];
  let grid = buildIndex(baseItems);

  const stats = {};
  const sampleAdds = [];

  for (const feed of FEEDS) {
    console.log('\nFetching', feed.label, '…');
    const raw = await loadFeed(feed);
    let added = 0,
      enriched = 0,
      skipped = 0,
      nonUk = 0;
    for (const loc of raw) {
      const item = compactOcpi(loc, feed);
      if (!item) {
        // distinguish non-UK roughly for monta
        if (loc && loc.coordinates && !isUkLocation(loc)) nonUk++;
        else skipped++;
        continue;
      }
      const match = findMatch(item, baseItems, grid);
      if (match) {
        if (enrich(baseItems[match.i], item)) enriched++;
      } else {
        // add
        byId.set(item.id, item);
        added++;
        if (sampleAdds.length < 12) {
          sampleAdds.push({
            id: item.id,
            n: item.n,
            op: item.op,
            ad: item.ad,
            k: item.k,
            c: item.c,
            a: item.a,
            o: item.o,
          });
        }
      }
    }
    // rebuild index after each feed so later feeds can match newly added sites
    baseItems = [...byId.values()];
    grid = buildIndex(baseItems);
    stats[feed.key] = {
      label: feed.label,
      raw: raw.length,
      added,
      enriched,
      skipped,
      nonUk,
    };
    console.log(
      `  → added ${added}, enriched ${enriched}, skipped ${skipped}` +
        (nonUk ? `, non-UK ${nonUk}` : '')
    );
  }

  const items = [...byId.values()].map(stripInternal);
  // stable-ish order: keep previous order for existing ids, append new
  items.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const sources = [
    baseDoc.source || 'Open Charge Map (ocm-export)',
    'char.gy open OCPI (PCPR)',
    'Clenergy / CEV PCPR locations',
    'Motor Fuel Group (MFG) open OCPI',
    'Monta open-data locations (GB)',
    manualItems.length ? 'manual additions' : null,
  ].filter(Boolean);

  const out = {
    generated: new Date().toISOString(),
    source: sources.join('; '),
    regions: 'United Kingdom (GB)',
    count: items.length,
    items,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  // One site per line. A single multi-megabyte line can fail to parse on phones.
  const meta = { generated: out.generated, source: out.source, regions: out.regions, count: out.count };
  fs.writeFileSync(
    OUT_PATH,
    'window.UK_CHARGERS=' +
      JSON.stringify(meta).slice(0, -1) +
      ',"items":[\n' +
      items.map(i => JSON.stringify(i)).join(',\n') +
      '\n]};\n'
  );
  const size = fs.statSync(OUT_PATH).size;

  console.log('\n=== Merge report ===');
  console.log('Before:', beforeCount, '(+ manual', manualItems.length, 'already merged into base map)');
  console.log('After:', items.length);
  console.log('Net new:', items.length - beforeCount);
  console.log('File size:', (size / 1024 / 1024).toFixed(2), 'MB');
  for (const [k, s] of Object.entries(stats)) {
    console.log(
      `  ${k} (${s.label}): raw=${s.raw} added=${s.added} enriched=${s.enriched} skipped=${s.skipped}` +
        (s.nonUk ? ` nonUk=${s.nonUk}` : '')
    );
  }
  console.log('Sample new sites:');
  for (const s of sampleAdds) {
    console.log(
      `  ${s.id} | ${s.n || '?'} | ${s.op || ''} | ${s.ad || ''} | ${s.k || '?'}kW | ${(s.c || []).join(',')}`
    );
  }
  // write a small report sidecar for the parent
  const reportPath = path.join(ROOT, 'data', 'ocpi-merge-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        before: beforeCount,
        after: items.length,
        netNew: items.length - beforeCount,
        fileBytes: size,
        stats,
        sampleAdds,
        generated: out.generated,
      },
      null,
      2
    )
  );
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', reportPath);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
