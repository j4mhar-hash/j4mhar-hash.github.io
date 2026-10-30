#!/usr/bin/env node
/**
 * Merge three free OCPI 2.2.1 open-data feeds into data/uk-chargers.js:
 *   ParkRecharge (party HUB), GeniePoint (party GPT), Urban Fox (party UFX).
 *
 *   node scripts/build-open-feeds.js [parkrecharge.json] [geniepoint.json] [urbanfox.json]
 *
 * Without arguments, each feed is read from uploads/<name>-ocpi.json or
 * .cache/ocpi/<name>.json. The raw snapshots are not written into the repo.
 *
 * Dedupe: same normalised operator within 75 m, or same postcode within 100 m.
 * New ids: parkrecharge:, geniepoint:, urbanfox:.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const CACHE_DIR = path.join(ROOT, '.cache', 'ocpi');
const CREDIT = 'ParkRecharge, GeniePoint and Urban Fox open data (PCPR)';

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
  if (t.includes('bppulse')) return 'bppulse';
  if (t.includes('geniepoint')) return 'geniepoint';
  if (t.includes('urbanfox')) return 'urbanfox';
  if (t.includes('park') && t.includes('recharge')) return 'parkrecharge';
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
  // A postcode match can be a different brand nearby. The customers note belongs on GeniePoint only.
  if (feedItem.note && !base.note && feedItem._op && base._op === feedItem._op) {
    base.note = feedItem.note;
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
  if (s.note) o.note = s.note;
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
    let ok = false;
    if (sameOp && dist <= MATCH_OP_M) ok = true;
    else if (samePc && dist <= MATCH_PC_M) ok = true;
    if (!ok) continue;
    if (!best || dist < best.dist) best = { i, dist, sameOp, samePc };
  }
  return best;
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

function activeEvses(loc) {
  return (loc.evses || []).filter(e => String(e.status || '').toUpperCase() !== 'REMOVED');
}

function kwFromDeclared(c) {
  // Use the published wattage. Do not recompute from voltage (ParkRecharge quotes 415 V).
  const p = +c.max_electric_power;
  if (!isFinite(p) || p <= 0) return null;
  return p >= 100 ? p / 1000 : p;
}

function urbanKw(c) {
  // 230 V phase voltage. phases × V × A / 1000.
  // Single-phase 22 A → 5.1 kW, 30 A → 6.9 kW. Three-phase 16 A → 11 kW, 32 A → 22 kW.
  const a = +(c.max_amperage ?? c.amperage);
  if (!isFinite(a) || a <= 0) return null;
  const phases = c.power_type === 'AC_3_PHASE' ? 3 : 1;
  const kw = (phases * 230 * a) / 1000;
  return phases === 3 ? Math.round(kw) : Math.round(kw * 10) / 10;
}

function assertPowerRules() {
  const park = kwFromDeclared({ max_electric_power: 22000, max_voltage: 415, max_amperage: 32, power_type: 'AC_3_PHASE' });
  if (park !== 22) throw new Error('ParkRecharge 22 kW declared power became ' + park);
  const wrong = (415 * 32 * Math.sqrt(3)) / 1000;
  if (Math.abs(park - wrong) < 0.5) throw new Error('ParkRecharge power was recomputed from 415 V');
  if (urbanKw({ power_type: 'AC_1_PHASE', max_voltage: 230, max_amperage: 22 }) !== 5.1) throw new Error('Urban Fox 22 A');
  if (urbanKw({ power_type: 'AC_1_PHASE', max_voltage: 230, max_amperage: 30 }) !== 6.9) throw new Error('Urban Fox 30 A');
  if (urbanKw({ power_type: 'AC_3_PHASE', max_voltage: 230, max_amperage: 16 }) !== 11) throw new Error('Urban Fox 16 A 3-phase');
  if (urbanKw({ power_type: 'AC_3_PHASE', max_voltage: 230, max_amperage: 32 }) !== 22) throw new Error('Urban Fox 32 A 3-phase');
}

function isParkTest(loc) {
  const n = String(loc.name || '');
  const id = String(loc.id || '');
  return /TR0047/i.test(n) || /TR0047/i.test(id) || /Hubeleon Test Centre/i.test(n)
    || /PR06767/i.test(n) || /PR06767/i.test(id) || /H19 Test Unit/i.test(n);
}

function allRemoved(loc) {
  const ev = loc.evses || [];
  return ev.length > 0 && ev.every(e => String(e.status || '').toUpperCase() === 'REMOVED');
}

function customersOnly(loc) {
  const ev = activeEvses(loc);
  if (!ev.length) return false;
  // PLUGGED is not a real OCPI restriction. CUSTOMERS on every live EVSE is the note.
  return ev.every(e => (e.parking_restrictions || []).includes('CUSTOMERS'));
}

function roundKw(kw) {
  if (kw == null || !isFinite(kw)) return null;
  return Math.round(kw * 10) / 10;
}

function compactLocation(loc, feed) {
  if (!loc || loc.publish === false) return null;
  if (loc.party_id && String(loc.party_id).toUpperCase() !== feed.party) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (!isUkLocation(loc)) return null;
  const evses = activeEvses(loc);
  if ((loc.evses || []).length && evses.length === 0) return null;
  const conns = new Set();
  let bestKw = null;
  for (const e of evses) {
    for (const c of e.connectors || []) {
      const code = STD[c.standard];
      if (code) conns.add(code);
      const kw = feed.kw(c);
      if (kw != null && isFinite(kw) && kw > 0 && kw <= 1000) bestKw = Math.max(bestKw || 0, kw);
    }
  }
  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;
  const name = (loc.name && String(loc.name).trim()) || null;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ') || null;
  const o = {
    id: feed.prefix + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: feed.operator,
  };
  const k = roundKw(bestKw);
  if (k != null) o.k = k;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  if (evses.length) o.cap = evses.length;
  if (ad) o.ad = ad;
  const pc = loc.postal_code ? normPostcode(loc.postal_code) : extractPostcode(ad);
  if (pc) o._pc = pc;
  o._op = feed.opKey;
  o._feed = feed.key;
  if (feed.note && feed.note(loc)) o.note = feed.note(loc);
  return o;
}

const FEEDS = [
  {
    key: 'parkrecharge',
    label: 'ParkRecharge',
    party: 'HUB',
    prefix: 'parkrecharge:',
    operator: 'Park&Recharge',
    opKey: 'parkrecharge',
    file: 'parkrecharge-ocpi.json',
    kw: kwFromDeclared,
    skip(loc) {
      if (isParkTest(loc)) return 'test';
      if (allRemoved(loc)) return 'removed';
      return null;
    },
  },
  {
    key: 'geniepoint',
    label: 'GeniePoint',
    party: 'GPT',
    prefix: 'geniepoint:',
    operator: 'GeniePoint',
    opKey: 'geniepoint',
    file: 'geniepoint-ocpi.json',
    kw: kwFromDeclared,
    note(loc) {
      return customersOnly(loc) ? 'Customers only' : null;
    },
  },
  {
    key: 'urbanfox',
    label: 'Urban Fox',
    party: 'UFX',
    prefix: 'urbanfox:',
    operator: 'Urban Fox',
    opKey: 'urbanfox',
    file: 'urbanfox-ocpi.json',
    kw: urbanKw,
  },
];

function extractLocations(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.locations)) return json.locations;
  if (json && Array.isArray(json.data)) return json.data;
  throw new Error('OCPI payload has no locations array');
}

function resolveFeedFile(feed, explicit) {
  const list = [];
  if (explicit) list.push(path.resolve(explicit));
  list.push(path.join(ROOT, 'uploads', feed.file));
  list.push(path.join(CACHE_DIR, feed.file));
  for (const file of list) {
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

function withOpenCredit(source) {
  let s = String(source || 'Open Charge Map (ocm-export)');
  const escaped = CREDIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(';\\s*' + escaped, 'g'), '');
  const needle = 'bp pulse data via Eco-Movement';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function mergeFeed(feed, locations, byId, baseItems, grid) {
  const stats = {
    label: feed.label,
    raw: locations.length,
    added: 0,
    matched: 0,
    enriched: 0,
    skipped: 0,
    nonUk: 0,
    testExcluded: 0,
    removedExcluded: 0,
    customersOnly: 0,
  };
  const sampleAdds = [];
  const sampleEnriched = [];
  for (const loc of locations) {
    const reason = feed.skip ? feed.skip(loc) : null;
    if (reason === 'test') {
      stats.testExcluded++;
      stats.skipped++;
      continue;
    }
    if (reason === 'removed') {
      stats.removedExcluded++;
      stats.skipped++;
      continue;
    }
    if (loc && loc.coordinates && !isUkLocation(loc)) {
      stats.nonUk++;
      continue;
    }
    const item = compactLocation(loc, feed);
    if (!item) {
      stats.skipped++;
      continue;
    }
    if (item.note) stats.customersOnly++;
    item._pc = item._pc || extractPostcode(item.ad);
    const match = findMatch(item, baseItems, grid);
    if (match) {
      stats.matched++;
      if (enrich(baseItems[match.i], item)) {
        stats.enriched++;
        if (sampleEnriched.length < 8) {
          const b = baseItems[match.i];
          sampleEnriched.push({ id: b.id, n: b.n, op: b.op, k: b.k, c: b.c, cap: b.cap, note: b.note, distM: Math.round(match.dist) });
        }
      }
    } else {
      byId.set(item.id, item);
      baseItems.push(item);
      const k = cellKey(item.a, item.o);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(baseItems.length - 1);
      stats.added++;
      if (sampleAdds.length < 8) {
        sampleAdds.push({ id: item.id, n: item.n, op: item.op, ad: item.ad, k: item.k, c: item.c, cap: item.cap, note: item.note, a: item.a, o: item.o });
      }
    }
  }
  return { stats, sampleAdds, sampleEnriched };
}

function main() {
  assertPowerRules();
  const baseDoc = loadWindowJson(OUT_PATH, 'UK_CHARGERS');
  if (!baseDoc || !Array.isArray(baseDoc.items)) {
    console.error('Missing or invalid', OUT_PATH);
    process.exit(1);
  }
  const beforeCount = baseDoc.items.length;
  const manualDoc = loadWindowJson(MANUAL_PATH, 'MANUAL_CHARGERS');
  const manualItems = (manualDoc && manualDoc.items) || [];
  const byId = new Map();
  for (const s of baseDoc.items) byId.set(s.id, prepareBaseItem(s));
  for (const s of manualItems) {
    if (!s || s.access === 'private') continue;
    if (!byId.has(s.id)) byId.set(s.id, prepareBaseItem(s));
  }
  const baseItems = [...byId.values()];
  const grid = buildIndex(baseItems);
  const args = process.argv.slice(2);
  const feedsOut = {};
  const reports = [];

  FEEDS.forEach((feed, i) => {
    const file = resolveFeedFile(feed, args[i]);
    if (!file) {
      console.error('No snapshot for', feed.label, '(uploads/' + feed.file + ')');
      process.exit(1);
    }
    console.log('Reading', feed.label, file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const locations = extractLocations(json);
    const result = mergeFeed(feed, locations, byId, baseItems, grid);
    feedsOut[feed.key] = result.stats;
    const report = Object.assign({
      before: beforeCount,
      feed: feed.key,
      operator: feed.operator,
      prefix: feed.prefix,
      generated: new Date().toISOString(),
      sampleAdds: result.sampleAdds,
      sampleEnriched: result.sampleEnriched,
      note: feed.key === 'parkrecharge'
        ? 'ParkRecharge open data (party HUB). max_electric_power is used as published. Locations whose EVSEs are all REMOVED are excluded, as are TR0047 Hubeleon Test Centre and PR06767 H19 Test Unit.'
        : feed.key === 'geniepoint'
          ? "GeniePoint open data (party GPT). Operator is owner.name GeniePoint. Sites whose EVSEs are all parking_restrictions CUSTOMERS stay public and carry note 'Customers only'. PLUGGED is ignored."
          : 'Urban Fox open data (party UFX). Operator Urban Fox. Power is phases × 230 V × A / 1000 (single-phase 5.1 or 6.9 kW, three-phase 11 or 22 kW).',
    }, result.stats);
    reports.push({ feed, report });
    console.log(feed.label, 'raw', result.stats.raw, 'added', result.stats.added, 'matched', result.stats.matched, 'enriched', result.stats.enriched, 'skipped', result.stats.skipped);
  });

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (outItems.some(s => /Hubeleon Test Centre|H19 Test Unit/i.test(s.n || ''))) {
    throw new Error('A ParkRecharge test site was written into the snapshot');
  }

  const meta = {
    generated: new Date().toISOString(),
    source: withOpenCredit(baseDoc.source),
    regions: baseDoc.regions || 'United Kingdom (GB)',
    count: outItems.length,
    feeds: Object.assign({}, baseDoc.feeds || {}, feedsOut),
  };
  fs.writeFileSync(
    OUT_PATH,
    'window.UK_CHARGERS=' +
      JSON.stringify(meta).slice(0, -1) +
      ',"items":[\n' +
      outItems.map(i => JSON.stringify(i)).join(',\n') +
      '\n]};\n'
  );

  for (const { feed, report } of reports) {
    report.after = outItems.length;
    report.netNew = outItems.length - beforeCount;
    const reportPath = path.join(ROOT, 'data', feed.key + '-merge-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log('Wrote', reportPath);
  }
  console.log('Before:', beforeCount, 'After:', outItems.length);
  console.log('Wrote', OUT_PATH);
}

main();
