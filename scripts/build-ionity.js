#!/usr/bin/env node
/**
 * Merge IONITY UK hubs into data/uk-chargers.js.
 *
 * OCPI 2.2.1 party GB/IOY. No token is read or written.
 *   node scripts/build-ionity.js /path/to/ionity-ocpi.json [/path/to/ionity-tariffs.json]
 *
 * Match only existing Ionity records, within 75 m. Two known pins sit just
 * outside that: ocm-485175 (Abergavenny, feed 960) and ocm-127714
 * (MK Coachway, feed 269). Other operators at the same services are not matched.
 * New ids: ionity:<ocpi-id>. Operator shown: IONITY.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'ionity-merge-report.json');
const CREDIT = 'IONITY (via Eco-Movement, PCPR open data)';
const OPERATOR = 'IONITY';
const MATCH_M = 75;
const FORCE = { '960': 'ocm-485175', '269': 'ocm-127714' };
const TARIFF_GBP = {
  'GB*HPC*ADHOC*004': 0.6944,
  'GB*ONHW*HPC*ADHOC*001': 0.7417,
  'GB*MC*ADHOC*004': 0.519,
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
    .replace(/[^a-z0-9]+/g, '');
  if (t.includes('ionity')) return 'ionity';
  return t;
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
  return copy;
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
  if (s.access) o.access = s.access;
  if (s.fee) o.fee = s.fee;
  for (const k of ['acc', 'h', 'cl', 'dev']) {
    if (s[k] != null) o[k] = s[k];
  }
  return o;
}

function fixPostcode(pc) {
  const raw = String(pc || '').trim();
  if (raw.replace(/\s+/g, '').toUpperCase() === 'P243QL') return 'IP24 3QL';
  return raw;
}

function siteName(loc) {
  return String(loc.name || '')
    .replace(/^IONITY GmbH\s+/i, '')
    .trim();
}

function feeText(loc) {
  const counts = new Map();
  for (const e of loc.evses || []) {
    for (const c of e.connectors || []) {
      const id = (c.tariff_ids || [])[0];
      if (!id || TARIFF_GBP[id] == null) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!parts.length) return null;
  const money = id => '£' + TARIFF_GBP[id] + '/kWh';
  if (parts.length === 1) return money(parts[0][0]) + ' incl. VAT';
  return parts.map(([id, n]) => money(id) + ' (' + n + (n === 1 ? ' bay' : ' bays') + ')').join(', ') + ', incl. VAT';
}

function compactOcpi(loc) {
  if (!loc || loc.publish === false) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const country = String(loc.country || loc.country_code || '').toUpperCase();
  if (country && !['GBR', 'GB', 'UK'].includes(country)) return null;
  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;
  const evses = loc.evses || [];
  if (!evses.length) return null;
  let bestKw = null;
  const conns = new Set();
  for (const e of evses) {
    for (const c of e.connectors || []) {
      if (c.standard === 'IEC_62196_T2_COMBO') conns.add('CCS');
      else if (c.standard === 'CHADEMO') conns.add('CHA');
      else if (c.standard === 'IEC_62196_T2' || c.standard === 'IEC_62196_T2_CABLE') conns.add('T2');
      const p = +c.max_electric_power;
      if (p > 0) bestKw = Math.max(bestKw || 0, p >= 100 ? p / 1000 : p);
    }
  }
  const pc = fixPostcode(loc.postal_code);
  const ad = [loc.address, loc.city, pc].filter(Boolean).join(', ') || null;
  const o = {
    id: 'ionity:' + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: OPERATOR,
    _op: 'ionity',
    _feedId: id,
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  const name = siteName(loc);
  if (name) o.n = name;
  if (evses.length) o.cap = evses.length;
  if (ad) o.ad = ad;
  const fee = feeText(loc);
  if (fee) o.fee = fee;
  if (loc.opening_times && loc.opening_times.twentyfourseven) o.h = '24/7';
  return o;
}

function extractLocations(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.locations)) return json.locations;
  if (json && Array.isArray(json.data)) return json.data;
  throw new Error('IONITY payload has no locations array');
}

function findMatch(item, baseItems, grid, idIndex) {
  const forcedId = FORCE[item._feedId];
  if (forcedId) {
    if (!idIndex.has(forcedId)) throw new Error('Forced Ionity match missing: ' + forcedId);
    const i = idIndex.get(forcedId);
    const b = baseItems[i];
    return { i, dist: metresBetween(item.a, item.o, b.a, b.o), forced: true };
  }
  const idxs = neighbours(grid, item.a, item.o);
  let best = null;
  for (const i of idxs) {
    const b = baseItems[i];
    if (b._op !== 'ionity') continue;
    if ((item.access === 'private') !== (b.access === 'private')) continue;
    const dist = metresBetween(item.a, item.o, b.a, b.o);
    if (dist > MATCH_M) continue;
    if (!best || dist < best.dist) best = { i, dist, forced: false };
  }
  return best;
}

function applyOfficial(base, feed) {
  let changed = false;
  if (feed.k != null && base.k !== feed.k) {
    base.k = feed.k;
    changed = true;
  }
  const nextC = feed.c || [];
  if (JSON.stringify(base.c || []) !== JSON.stringify(nextC)) {
    base.c = nextC.slice();
    changed = true;
  }
  if (feed.cap != null && base.cap !== feed.cap) {
    base.cap = feed.cap;
    changed = true;
  }
  if (feed.fee && base.fee !== feed.fee) {
    base.fee = feed.fee;
    changed = true;
  }
  if (base.op !== OPERATOR) {
    base.op = OPERATOR;
    base._op = 'ionity';
    changed = true;
  }
  if (!base.h && feed.h) {
    base.h = feed.h;
    changed = true;
  }
  return changed;
}

function withCredit(source) {
  let s = String(source || 'Open Charge Map (ocm-export)');
  const escaped = CREDIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(';\\s*' + escaped, 'g'), '');
  const needle = 'Shell Recharge open data (PCPR, via Eco-Movement)';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pass the IONITY locations JSON path.');
    process.exit(1);
  }
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
  const idIndex = new Map(baseItems.map((s, i) => [s.id, i]));
  const locations = extractLocations(JSON.parse(fs.readFileSync(file, 'utf8')));

  let added = 0, matched = 0, enriched = 0, skipped = 0;
  const sampleAdds = [];
  const sampleEnriched = [];
  const matchedIds = new Set();

  for (const loc of locations) {
    const item = compactOcpi(loc);
    if (!item) {
      skipped++;
      continue;
    }
    const match = findMatch(item, baseItems, grid, idIndex);
    if (match) {
      matched++;
      const base = baseItems[match.i];
      if (base._op !== 'ionity' && !FORCE[item._feedId]) {
        throw new Error('IONITY matched a non-Ionity site ' + base.id);
      }
      if (matchedIds.has(base.id)) throw new Error('Two IONITY locations matched ' + base.id);
      matchedIds.add(base.id);
      if (applyOfficial(base, item)) {
        enriched++;
        if (sampleEnriched.length < 8) {
          sampleEnriched.push({ id: base.id, n: base.n, op: base.op, k: base.k, c: base.c, cap: base.cap, fee: base.fee, distM: Math.round(match.dist) });
        }
      }
    } else {
      byId.set(item.id, item);
      added++;
      if (sampleAdds.length < 8) {
        sampleAdds.push({ id: item.id, n: item.n, op: item.op, ad: item.ad, k: item.k, c: item.c, cap: item.cap, fee: item.fee, a: item.a, o: item.o });
      }
    }
  }

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const prefixCount = (rows, prefix) => rows.filter(s => String(s.id).startsWith(prefix)).length;
  for (const prefix of ['shell:', 'zest:', 'instavolt:', 'ubitricity:', 'chargepoint:', 'rawcharging:', 'fuuse:', 'bppulse:']) {
    const beforeN = prefixCount(baseDoc.items, prefix);
    const afterN = prefixCount(outItems, prefix);
    if (afterN !== beforeN) throw new Error(prefix + ' count changed ' + beforeN + ' -> ' + afterN);
  }
  const privateBefore = baseDoc.items.filter(s => s.access === 'private').length;
  const privateAfter = outItems.filter(s => s.access === 'private').length;
  if (privateAfter !== privateBefore) throw new Error('private access changed ' + privateBefore + ' -> ' + privateAfter);
  const notesBefore = baseDoc.items.filter(s => s.note === 'Customers only').length;
  const notesAfter = outItems.filter(s => s.note === 'Customers only').length;
  if (notesAfter !== notesBefore) throw new Error('Customers only notes changed ' + notesBefore + ' -> ' + notesAfter);
  const thetford = outItems.find(s => s.id === 'ionity:2061');
  if (!thetford || !/IP24 3QL/.test(thetford.ad || '')) throw new Error('Thetford postcode was not corrected');
  if (outItems.some(s => /(?<![A-Z])P24 3QL/.test(s.ad || ''))) throw new Error('P24 3QL typo remains');

  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    ionity: { label: 'IONITY', mode: 'file', raw: locations.length, added, matched, enriched, skipped },
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
    mode: 'file',
    ionityRaw: locations.length,
    added,
    matched,
    enriched,
    skipped,
    ionityPrefix: outItems.filter(s => String(s.id).startsWith('ionity:')).length,
    sampleAdds,
    sampleEnriched,
    generated: meta.generated,
    note: 'IONITY UK OCPI 2.2.1, party GB/IOY, fetched 2026-11-17T11:41:14Z. Matched only existing Ionity records within 75 m, plus Abergavenny (ocm-485175, feed 960, 112 m) and MK Coachway (ocm-127714, feed 269, 116 m). Other operators at the same services were not matched. Thetford postcode P24 3QL is stored as IP24 3QL. Ad hoc tariffs are on the fee field, incl. VAT. The raw snapshot and any token are not stored.',
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('Before:', beforeCount);
  console.log('After:', outItems.length);
  console.log('Added:', added, 'matched:', matched, 'enriched:', enriched, 'skipped:', skipped);
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', REPORT_PATH);
}

main();
