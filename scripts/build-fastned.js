#!/usr/bin/env node
/**
 * Merge Fastned UK locations into data/uk-chargers.js.
 *
 * Auth (secrets — never logged or written to the repo):
 *   process.env.FASTNED_API_HEADER  — HTTP header name (e.g. x-api-key)
 *   process.env.FASTNED_API_KEY     — HTTP header value
 *   process.env.FASTNED_API_URL     — optional OCPI locations base URL
 *     (e.g. https://example/ocpi/cpo/2.2.1/locations). When unset, falls
 *     back to Fastned's public UK station pages on fastnedcharging.com.
 *
 * Dedupe: same normalised operator + ≤75 m, or same postcode + ≤100 m.
 * New ids: fastned:<slug-or-ocpi-id>
 *
 * Usage: node scripts/build-fastned.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'fastned-merge-report.json');
const CACHE_DIR = path.join(ROOT, '.cache', 'ocpi');
const UA = 'UK-EV-Map-build/1.0 (https://j4mhar-hash.github.io; Fastned UK open data / public pages)';

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
  let t = String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  if (t.includes('fastned') || t === 'fastned' || t === 'fst') return 'fastned';
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
  for (const k of ['fee', 'acc', 'h', 'cl']) {
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
    // Also match any nearby Fastned-labelled OCM row even if op spelling differs
    const baseIsFastned = b._op === 'fastned' || /fastned/i.test(b.op || '') || /fastned/i.test(b.n || '');
    const itemIsFastned = item._op === 'fastned';
    let ok = false;
    if (sameOp && dist <= MATCH_OP_M) ok = true;
    else if (samePc && dist <= MATCH_PC_M) ok = true;
    else if (itemIsFastned && baseIsFastned && dist <= MATCH_OP_M) ok = true;
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
  const country = String(loc.country || '').toUpperCase().trim();
  if (['GBR', 'GB', 'UK', 'UNITED KINGDOM'].includes(country)) return true;
  const pc = String(loc.postal_code || '').toUpperCase().replace(/\s+/g, '');
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

  const evses = (loc.evses || []).filter(e => {
    const st = String(e.status || '').toUpperCase();
    return st !== 'REMOVED';
  });
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

  const opName =
    (loc.operator && loc.operator.name) ||
    (loc.suboperator && loc.suboperator.name) ||
    'Fastned';
  const name = (loc.name && String(loc.name).trim()) || null;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ') || null;
  const postcode = loc.postal_code ? String(loc.postal_code).trim() : null;

  const o = {
    id: 'fastned:' + loc.id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  else o.c = ['CCS']; // Fastned UK is DC CCS-focused
  if (name) o.n = name;
  o.op = opName;
  const cap = evses.length || null;
  if (cap) o.cap = cap;
  if (ad) o.ad = ad;
  if (postcode) o._pc = normPostcode(postcode);
  o._op = 'fastned';
  o._feed = 'fastned';
  return o;
}

async function fetchApiLocations(baseUrl) {
  const headerName = process.env.FASTNED_API_HEADER;
  const headerVal = process.env.FASTNED_API_KEY;
  if (!headerName || !headerVal) {
    throw new Error('FASTNED_API_HEADER and FASTNED_API_KEY must be set for API mode');
  }
  // Never log header name/value
  console.log('Fetching Fastned OCPI locations via API (credentials present, not logged)…');
  const all = [];
  let offset = 0;
  let pageSize = 100;
  let guard = 0;
  while (guard++ < 200) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}limit=${pageSize}&offset=${offset}`;
    const headers = {
      Accept: 'application/json',
      'User-Agent': UA,
    };
    headers[headerName] = headerVal;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Fastned API HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    const json = await r.json();
    const data = Array.isArray(json) ? json : json.data || json.locations || [];
    all.push(...data);
    const total = r.headers.get('x-total-count');
    console.log(`  … got ${data.length} (running ${all.length}${total ? '/' + total : ''})`);
    if (!data.length || data.length < pageSize) break;
    if (total != null && all.length >= +total) break;
    offset += data.length;
    await sleep(200);
  }
  return all;
}

async function scrapePublicUkPages() {
  console.log('FASTNED_API_URL not set — scraping Fastned public UK station pages…');
  const indexUrl = 'https://www.fastnedcharging.com/en-gb/locations/united-kingdom';
  const indexHtml = await (await fetch(indexUrl, { headers: { 'User-Agent': UA } })).text();
  const slugs = [
    ...new Set(
      [...indexHtml.matchAll(/\/en-gb\/locations\/united-kingdom\/([a-z0-9-]+)/g)].map(m => m[1])
    ),
  ].filter(s => s && s !== 'united-kingdom');
  console.log('  slugs:', slugs.length);

  const rows = [];
  // modest concurrency
  const queue = [...slugs];
  async function one(slug) {
    const url = `https://www.fastnedcharging.com/en-gb/locations/united-kingdom/${slug}`;
    const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    let lat = null,
      lon = null;
    let m = html.match(/"latitude"\s*:\s*"([-+]?\d+\.?\d*)"[\s\S]{0,80}?"longitude"\s*:\s*"([-+]?\d+\.?\d*)"/);
    if (!m) {
      m = html.match(/latitude["'>\s:]+([-+]?\d+\.\d+)[\s\S]{0,80}?longitude["'>\s:]+([-+]?\d+\.\d+)/i);
    }
    if (m) {
      lat = +m[1];
      lon = +m[2];
    }
    let name = null;
    const h1 = html.match(/<h1[^>]*>([^<]+)/i);
    if (h1) name = h1[1].trim();
    else {
      const t = html.match(/<title>([^|<]+)/i);
      if (t) name = t[1].trim();
    }
    const addr = (html.match(/"streetAddress"\s*:\s*"([^"]+)"/) || [])[1] || null;
    const city = (html.match(/"addressLocality"\s*:\s*"([^"]+)"/) || [])[1] || null;
    const pc = (html.match(/"postalCode"\s*:\s*"([^"]+)"/) || [])[1] || null;
    const powers = [...html.matchAll(/(\d+)\s*kW/gi)]
      .map(x => +x[1])
      .filter(p => p >= 3 && p <= 400);
    const best = powers.length ? Math.max(...powers) : null;
    // Fastned UK: CCS ultra-rapid; CHAdeMO sometimes present historically
    const conns = ['CCS'];
    if (/chademo/i.test(html)) conns.push('CHA');
    if (/type\s*2|IEC_62196_T2/i.test(html) && !/type\s*2\s*combo/i.test(html)) conns.push('T2');
    return {
      id: 'fastned:' + slug,
      a: lat != null ? +lat.toFixed(5) : null,
      o: lon != null ? +lon.toFixed(5) : null,
      n: name,
      op: 'Fastned',
      ad: [addr, city, pc].filter(Boolean).join(', ') || null,
      k: best,
      c: conns,
      _pc: pc ? normPostcode(pc) : extractPostcode([addr, city, pc].filter(Boolean).join(', ')),
      _op: 'fastned',
      _feed: 'fastned-web',
      _slug: slug,
    };
  }

  while (queue.length) {
    const batch = queue.splice(0, 6);
    const got = await Promise.all(
      batch.map(s =>
        one(s).catch(e => {
          console.warn('  fail', s, e.message);
          return null;
        })
      )
    );
    for (const g of got) if (g && g.a != null && g.o != null) rows.push(g);
    process.stdout.write(`  … ${rows.length}/${slugs.length}\r`);
    await sleep(100);
  }
  console.log(`  scraped ${rows.length} UK stations`);
  return rows;
}

async function loadFastnedItems() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, 'fastned.json');
  if (fs.existsSync(cacheFile)) {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 6 * 3600 * 1000) {
      console.log(`  using cache (${(age / 60000).toFixed(0)} min old)`);
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  const apiUrl = process.env.FASTNED_API_URL && String(process.env.FASTNED_API_URL).trim();
  let items;
  let mode;
  if (apiUrl) {
    const raw = await fetchApiLocations(apiUrl);
    items = raw.map(compactOcpi).filter(Boolean);
    mode = 'api';
  } else {
    items = await scrapePublicUkPages();
    mode = 'web';
  }
  fs.writeFileSync(cacheFile, JSON.stringify({ mode, items, fetchedAt: new Date().toISOString() }));
  return { mode, items };
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
  for (const s of manualItems) byId.set(s.id, prepareBaseItem(s));

  let baseItems = [...byId.values()];
  let grid = buildIndex(baseItems);

  const { mode, items: feedItems } = await loadFastnedItems();
  // loadFastnedItems may return cached {mode,items} or we normalised above
  const list = Array.isArray(feedItems) ? feedItems : (feedItems && feedItems.items) || [];
  // If cache wrapped
  const feedList = list.length
    ? list
    : Array.isArray(arguments[0])
      ? []
      : (() => {
          const cached = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'fastned.json'), 'utf8'));
          return cached.items || [];
        })();

  // Re-read properly
  const cached = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'fastned.json'), 'utf8'));
  const modeUsed = cached.mode || mode;
  const feeds = cached.items || feedList;

  let added = 0,
    enriched = 0,
    skipped = 0;
  const sampleAdds = [];
  for (const item of feeds) {
    if (!item || item.a == null || item.o == null) {
      skipped++;
      continue;
    }
    // ensure internals
    item._op = item._op || 'fastned';
    item._pc = item._pc || extractPostcode(item.ad);
    if (!item.op) item.op = 'Fastned';
    if (!item.c || !item.c.length) item.c = ['CCS'];

    const match = findMatch(item, baseItems, grid);
    if (match) {
      if (enrich(baseItems[match.i], item)) enriched++;
    } else {
      byId.set(item.id, item);
      added++;
      if (sampleAdds.length < 20) {
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

  baseItems = [...byId.values()];
  const outItems = baseItems.map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const sources = [
    baseDoc.source || 'Open Charge Map (ocm-export)',
  ];
  // Ensure Fastned credit (required by Fastned UK Open Data fair-use policy)
  if (!/Fastned/i.test(sources.join('; '))) {
    sources.push(
      modeUsed === 'api'
        ? 'Fastned UK Open Data API (adapted)'
        : 'Fastned public UK station pages (adapted; Fastned UK Open Data API pending endpoint URL)'
    );
  }

  const out = {
    generated: new Date().toISOString(),
    source: sources.join('; '),
    regions: 'United Kingdom (GB)',
    count: outItems.length,
    feeds: Object.assign({}, baseDoc.feeds || {}, {
      fastned: {
        label: 'Fastned',
        mode: modeUsed,
        raw: feeds.length,
        added,
        enriched,
        skipped,
      },
    }),
    items: outItems,
  };

  // One site per line. A single multi-megabyte line can fail to parse on phones.
  const meta = {
    generated: out.generated,
    source: out.source,
    regions: out.regions,
    count: out.count,
    feeds: out.feeds,
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
    mode: modeUsed,
    fastnedRaw: feeds.length,
    added,
    enriched,
    skipped,
    sampleAdds,
    generated: out.generated,
    note:
      modeUsed === 'web'
        ? 'API base URL unknown; used public Fastned UK station pages. Set FASTNED_API_URL to use the open-data API with FASTNED_API_HEADER/KEY.'
        : 'Fetched via Fastned open-data API.',
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== Fastned merge report ===');
  console.log('Mode:', modeUsed);
  console.log('Before:', beforeCount);
  console.log('After:', outItems.length);
  console.log('Added:', added, 'enriched:', enriched, 'skipped:', skipped);
  console.log('File size:', (size / 1024 / 1024).toFixed(2), 'MB');
  console.log('Sample new:');
  for (const s of sampleAdds) {
    console.log(
      `  ${s.id} | ${s.n || '?'} | ${s.ad || ''} | ${s.k || '?'}kW | ${(s.c || []).join(',')}`
    );
  }
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', REPORT_PATH);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
