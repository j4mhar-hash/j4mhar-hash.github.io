#!/usr/bin/env node
/**
 * Merge extra Eco-Movement PCPR networks (GFX / Drax's platform) into data/uk-chargers.js.
 *
 * Networks in the saved snapshot: Aldi, Travis Perkins, Volvo, Southampton Apartment
 * Hotels, WCCC Edgbaston, Drax Group (Cruachan), drax-Ista, GFX-GB Drax.
 *
 * Auth (secrets — never logged or written to the repo). One token per network:
 *   ECOMOVEMENT_TOKENS, ECOM_ALDI_TOKEN, ECOM_TRAVISPERKINS_TOKEN, ECOM_VOLVO_TOKEN,
 *   ECOM_SOUTHAMPTON_TOKEN, ECOM_EDGBASTON_TOKEN, ECOM_DRAXISTA_TOKEN, ECOM_DRAX2_TOKEN
 * A value may be "Token …" or "Name: …". HTTP 429 is retried with backoff.
 *
 * Without tokens, pass a saved JSON file:
 *   node scripts/build-ecomovement-extra.js /path/to/ecomovement-extra-ocpi.json
 *
 * The operator shown is the site owner (Aldi, Travis Perkins, …). Drax-hosted
 * owners are labelled "Drax (owner)". Dedupe: same operator within 75 m
 * (Aldi matches OCM rows whose name or operator says Aldi; Drax matches the
 * manual Drax site and OCM Drax rows), or the same postcode within 100 m.
 * New ids: gfx:<ocpi-id>
 *
 * Usage: node scripts/build-ecomovement-extra.js [snapshot.json]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'ecomovement-extra-merge-report.json');
const CACHE_DIR = path.join(ROOT, '.cache', 'ocpi');
const CACHE_FILE = path.join(CACHE_DIR, 'ecomovement-extra.json');
const UA = 'UK-EV-Map-build/1.0 (https://j4mhar-hash.github.io; Eco-Movement PCPR)';

const DEFAULT_API_URL = 'https://open-chargepoints.com/api/ocpi/cpo/2.2.1';
const CREDIT = 'Aldi, Travis Perkins, Volvo & Drax network data via Eco-Movement';
const ENV_VARS = [
  'ECOMOVEMENT_TOKENS',
  'ECOM_ALDI_TOKEN',
  'ECOM_TRAVISPERKINS_TOKEN',
  'ECOM_VOLVO_TOKEN',
  'ECOM_SOUTHAMPTON_TOKEN',
  'ECOM_EDGBASTON_TOKEN',
  'ECOM_DRAXISTA_TOKEN',
  'ECOM_DRAX2_TOKEN',
];

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

function ownerName(loc) {
  return (
    (loc.owner && loc.owner.name) ||
    (loc.operator && loc.operator.name) ||
    ''
  ).trim();
}

function networkKey(loc) {
  const blob = [loc._network, ownerName(loc), loc.operator && loc.operator.name].filter(Boolean).join(' ');
  if (/drax-ista|draxissta/i.test(blob)) return 'drax-ista';
  if (/gfx-gb\s*drax/i.test(blob)) return 'gfx-gb-drax';
  if (/drax\s*group/i.test(blob)) return 'drax-group';
  if (/\baldi\b/i.test(blob)) return 'aldi';
  if (/travis\s*perkins/i.test(blob)) return 'travis-perkins';
  if (/\bvolvo\b/i.test(blob)) return 'volvo';
  if (/southampton\s+apartment/i.test(blob)) return 'southampton';
  if (/edgbaston/i.test(blob)) return 'edgbaston';
  return 'gfx';
}

function displayOp(loc) {
  const owner = ownerName(loc);
  const key = networkKey(loc);
  if (key === 'aldi') return 'Aldi';
  if (key === 'travis-perkins') return 'Travis Perkins';
  if (key === 'volvo') return 'Volvo';
  if (key === 'southampton') return 'Southampton Apartment Hotels';
  if (key === 'edgbaston') return 'WCCC Edgbaston';
  if (key === 'drax-group' || key === 'drax-ista' || key === 'gfx-gb-drax') {
    return owner ? 'Drax (' + owner + ')' : 'Drax';
  }
  return owner || 'GFX';
}

function keysFor(text) {
  const s = String(text || '');
  const keys = [];
  if (/\baldi\b/i.test(s)) keys.push('aldi');
  if (/travis\s*perkins/i.test(s)) keys.push('travis-perkins');
  if (/\bvolvo\b/i.test(s)) keys.push('volvo');
  if (/\bdrax\b/i.test(s)) keys.push('drax');
  if (/southampton\s+apartment\s+hotels/i.test(s)) keys.push('southampton');
  if (/\bedgbaston\b/i.test(s) || /wccc/i.test(s)) keys.push('edgbaston');
  return keys;
}

function matchKey(network) {
  if (network === 'drax-group' || network === 'drax-ista' || network === 'gfx-gb-drax') return 'drax';
  return network;
}

function prepareBaseItem(s) {
  const copy = { ...s };
  copy._pc = extractPostcode(s.ad) || null;
  copy._keys = new Set(keysFor(s.op).concat(keysFor(s.n)));
  return copy;
}

function enrich(base, feedItem) {
  let changed = false;
  if (feedItem.k != null && (base.k == null || feedItem.k > base.k)) {
    base.k = feedItem.k;
    changed = true;
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
    const sameOp = item._key && b._keys && b._keys.has(item._key);
    const samePc = item._pc && b._pc && item._pc === b._pc;
    let how = null;
    if (sameOp && dist <= MATCH_OP_M) how = 'operator';
    else if (samePc && dist <= MATCH_PC_M) how = 'postcode';
    if (!how) continue;
    if (!best || dist < best.dist) best = { i, dist, how };
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
      if (kw != null && isFinite(kw) && kw > 0 && kw <= 1000) bestKw = Math.max(bestKw || 0, kw);
    }
  }

  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;
  const net = networkKey(loc);
  const name = (loc.name && String(loc.name).trim()) || null;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ') || null;
  const postcode = loc.postal_code ? String(loc.postal_code).trim() : null;

  const o = {
    id: 'gfx:' + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: displayOp(loc),
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  if (evses.length) o.cap = evses.length;
  if (ad) o.ad = ad;
  o._pc = postcode ? normPostcode(postcode) : extractPostcode(ad);
  o._key = matchKey(net);
  o._net = net;
  o._keys = new Set([o._key]);
  return o;
}

function extractLocations(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.locations)) return json.locations;
  if (json && Array.isArray(json.data)) return json.data;
  throw new Error('Eco-Movement payload has no locations array');
}

function cacheLocations(locations, mode) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const slim = locations.map(loc => {
    const copy = Object.assign({}, loc);
    delete copy._token;
    return copy;
  });
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ mode, fetchedAt: new Date().toISOString(), locations: slim }));
}

function parseLinkNext(linkHeader, currentUrl) {
  if (!linkHeader) return null;
  const m = String(linkHeader).match(/<([^>]+)>\s*;\s*rel="next"/i);
  if (!m) return null;
  try {
    return new URL(m[1], currentUrl).href;
  } catch {
    return m[1];
  }
}

function cleanTok(raw) {
  const line = String(raw || '').split(/\r?\n|;/).map(s => s.trim()).find(Boolean);
  if (!line) return null;
  const labelled = line.match(/^(.*?)\s*[:=]\s*(?:token\s+)?["']?([A-Za-z0-9._~+\/=-]{16,})["']?\s*$/i);
  if (labelled) return labelled[2];
  const bare = line.replace(/^token\s+/i, '').replace(/^["']|["']$/g, '').trim();
  return /^[A-Za-z0-9._~+\/=-]{16,}$/.test(bare) ? bare : null;
}

async function fetchModule(mod, token, base) {
  let url = base + '/' + mod + '/?limit=500&offset=0';
  const out = [];
  let pages = 0;
  while (url) {
    if (++pages > 40) throw new Error(mod + ' paging did not finish');
    let r;
    let tries = 0;
    for (;;) {
      r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA, Authorization: 'Token ' + token },
        signal: AbortSignal.timeout(120000),
      });
      if (r.ok) break;
      const body = (await r.text()).replace(/[A-Za-z0-9_\-]{16,}/g, '[redacted]').slice(0, 180);
      console.error(mod, 'HTTP', r.status, body);
      if (!((r.status === 429 || r.status >= 500) && tries < 6)) throw new Error(mod + ' HTTP ' + r.status);
      tries++;
      const retryAfter = Number(r.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60000, retryAfter * 1000) : 3000 * tries;
      console.error('retry', tries, 'in', Math.round(wait / 1000) + 's');
      await sleep(wait);
    }
    const json = await r.json();
    if (json.status_code && json.status_code !== 1000) {
      throw new Error(mod + ' OCPI ' + json.status_code);
    }
    const batch = Array.isArray(json) ? json : json.data || [];
    out.push(...batch);
    const next = parseLinkNext(r.headers.get('link'), url);
    url = next && batch.length ? next : null;
    if (url) await sleep(300);
  }
  return out;
}

async function fetchLive() {
  const jobs = [];
  for (const ev of ENV_VARS) {
    const tok = cleanTok(process.env[ev]);
    if (tok) jobs.push({ ev, tok });
  }
  if (!jobs.length) return null;
  const base = (process.env.ECOM_API_URL || DEFAULT_API_URL).trim().replace(/\/$/, '');
  console.log('Fetching Eco-Movement networks (' + jobs.length + ' tokens present, not logged)…');
  const locations = [];
  const seen = new Set();
  for (const job of jobs) {
    let batch;
    try {
      batch = await fetchModule('locations', job.tok, base);
    } catch (e) {
      console.error(job.ev, 'FAILED', e.message);
      continue;
    }
    const fresh = batch.filter(loc => loc && loc.id != null && !seen.has(String(loc.id)));
    if (batch.length && !fresh.length) {
      console.error(job.ev, 'duplicate of an earlier token');
      continue;
    }
    const opCount = {};
    for (const loc of fresh) {
      const op = (loc.operator && loc.operator.name) || '(no operator)';
      opCount[op] = (opCount[op] || 0) + 1;
    }
    const mainOp = Object.entries(opCount).sort((a, b) => b[1] - a[1])[0];
    const party = [...new Set(fresh.map(loc => loc.party_id).filter(Boolean))].sort().join(',') || 'GFX';
    const label = party + ' ' + (mainOp ? mainOp[0] : '(no operator)');
    for (const loc of fresh) {
      loc._network = label;
      seen.add(String(loc.id));
      locations.push(loc);
    }
    console.log(job.ev, 'locations', fresh.length);
  }
  if (!locations.length) throw new Error('Eco-Movement tokens were set but no locations were returned');
  cacheLocations(locations, 'api');
  return locations;
}

function localCandidates() {
  const list = [];
  if (process.argv[2]) list.push(path.resolve(process.argv[2]));
  if (process.env.ECOM_EXTRA_OCPI_FILE) list.push(path.resolve(process.env.ECOM_EXTRA_OCPI_FILE));
  list.push(path.join(ROOT, 'uploads', 'ecomovement-extra-ocpi.json'));
  list.push(CACHE_FILE);
  return list;
}

function loadLocal() {
  for (const file of localCandidates()) {
    if (!file || !fs.existsSync(file)) continue;
    console.log('Reading Eco-Movement snapshot', file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const locations = extractLocations(json);
    if (path.resolve(file) !== path.resolve(CACHE_FILE)) cacheLocations(locations, 'file');
    return locations;
  }
  return null;
}

async function loadLocations() {
  const anyToken = ENV_VARS.some(ev => cleanTok(process.env[ev]));
  if (anyToken) return { mode: 'api', locations: await fetchLive() };
  const locations = loadLocal();
  if (!locations) {
    console.error('No Eco-Movement tokens and no local snapshot. Pass a JSON path.');
    process.exit(1);
  }
  return { mode: 'file', locations };
}

function blankNet() {
  return { raw: 0, added: 0, matched: 0, enriched: 0, skipped: 0 };
}

function withCredit(source) {
  let s = String(source || 'Open Charge Map (ocm-export)');
  const phrase = '; ' + CREDIT;
  s = s.split(phrase).join('');
  const needle = 'ubitricity data via Eco-Movement';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + phrase + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + phrase;
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
  const baseItems = [...byId.values()];
  const grid = buildIndex(baseItems);

  const loaded = await loadLocations();
  const rawLocations = loaded.locations || [];
  console.log('Eco-Movement feed mode:', loaded.mode, 'raw locations:', rawLocations.length);

  const perNetwork = {};
  const ensure = net => {
    if (!perNetwork[net]) perNetwork[net] = blankNet();
    return perNetwork[net];
  };
  let added = 0, matched = 0, enriched = 0, skipped = 0, nonUk = 0;
  const sampleAdds = [];
  const sampleEnriched = [];

  for (const loc of rawLocations) {
    const net = networkKey(loc);
    ensure(net).raw++;
    if (loc && loc.coordinates && !isUkLocation(loc)) {
      nonUk++;
      continue;
    }
    const item = compactOcpi(loc);
    if (!item) {
      skipped++;
      ensure(net).skipped++;
      continue;
    }
    const hit = findMatch(item, baseItems, grid);
    if (hit) {
      matched++;
      ensure(net).matched++;
      if (enrich(baseItems[hit.i], item)) {
        enriched++;
        ensure(net).enriched++;
        if (sampleEnriched.length < 8) {
          const b = baseItems[hit.i];
          sampleEnriched.push({
            network: net,
            id: b.id,
            n: b.n,
            op: b.op,
            k: b.k,
            c: b.c,
            cap: b.cap,
            distM: Math.round(hit.dist),
            how: hit.how,
          });
        }
      }
    } else {
      byId.set(item.id, item);
      baseItems.push(item);
      const k = cellKey(item.a, item.o);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(baseItems.length - 1);
      added++;
      ensure(net).added++;
      if (sampleAdds.length < 8) {
        sampleAdds.push({ network: net, id: item.id, n: item.n, op: item.op, ad: item.ad, k: item.k, c: item.c, cap: item.cap });
      }
    }
  }

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    gfx: {
      label: 'Eco-Movement GFX networks',
      mode: loaded.mode,
      raw: rawLocations.length,
      added,
      matched,
      enriched,
      skipped,
      nonUk,
      networks: perNetwork,
    },
  });

  const meta = {
    generated: new Date().toISOString(),
    source: withCredit(baseDoc.source),
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

  const report = {
    before: beforeCount,
    after: outItems.length,
    netNew: outItems.length - beforeCount,
    mode: loaded.mode,
    raw: rawLocations.length,
    added,
    matched,
    enriched,
    skipped,
    nonUk,
    perNetwork,
    sampleAdds,
    sampleEnriched,
    generated: meta.generated,
    note: 'GFX networks via Eco-Movement PCPR OCPI 2.2.1. Operator shown is the site owner; Drax-hosted owners are labelled Drax (owner). Same operator within 75 m (including OCM Aldi names and the manual Drax site) or same postcode within 100 m. Tokens and the raw snapshot are not stored in the repo.',
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

  console.log('\n=== Eco-Movement extra merge ===');
  console.log('Before:', beforeCount, 'After:', outItems.length);
  console.log('Added:', added, 'matched:', matched, 'enriched:', enriched, 'skipped:', skipped, 'nonUk:', nonUk);
  for (const [net, row] of Object.entries(perNetwork)) {
    console.log(' ', net, 'raw', row.raw, 'matched', row.matched, 'enriched', row.enriched, 'new', row.added);
  }
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', REPORT_PATH);
}

main().catch(e => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
