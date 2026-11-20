#!/usr/bin/env node
/**
 * Merge six keyless UK PCPR open-data feeds into data/uk-chargers.js.
 * No tokens are read or written. Pass nothing; paths are the gunzipped files
 * given on the command line as pairs are described in the header comment.
 *
 *   node scripts/build-pcpr-open.js
 *
 * Each feed is matched only to its own operator within 75 m, or up to 150 m
 * when the place name is the same. Unpublished rows and locations with no
 * EVSE are skipped. Taxi, staff, fleet and residents-only sites are private.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'pcpr-open-merge-report.json');
const CREDIT = 'ChargePlace Scotland, PoGo Charge, Mer, Arnold Clark Charge, Go Zero and EV Dot open data, published under the Public Charge Point Regulations 2023';

const STD = {
  IEC_62196_T2: 'T2',
  IEC_62196_T2_CABLE: 'T2',
  IEC_62196_T2_COMBO: 'CCS',
  IEC_62196_T1: 'T1',
  IEC_62196_T1_COMBO: 'CCS1',
  CHADEMO: 'CHA',
  DOMESTIC_G: '3PIN',
};

const FEEDS = [
  { key: 'cps', prefix: 'cps:', operator: 'ChargePlace Scotland', file: process.argv[2], tariff: process.argv[3] },
  { key: 'pogo', prefix: 'pogo:', operator: 'PoGo Charge', file: process.argv[4], tariff: process.argv[5] },
  { key: 'mer', prefix: 'mer:', operator: 'Mer', file: process.argv[6] },
  { key: 'arnoldclark', prefix: 'arnoldclark:', operator: 'Arnold Clark', file: process.argv[7], tariff: process.argv[8] },
  { key: 'gozero', prefix: 'gozero:', operator: 'Go Zero', file: process.argv[9] },
  { key: 'evdot', prefix: 'evdot:', operator: 'EV Dot', file: process.argv[10], tariff: process.argv[11] },
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadWindowJson(filePath, varName) {
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

function asArray(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node;
  if (Array.isArray(node.data)) return node.data;
  if (node.locations && Array.isArray(node.locations.data)) return node.locations.data;
  if (node.tariffs && Array.isArray(node.tariffs.data)) return node.tariffs.data;
  return [];
}

function locationsOf(json, key) {
  if (key === 'mer') return asArray(json.data && json.data.locations);
  return asArray(json);
}

function tariffsOf(json, key, tariffFile) {
  if (tariffFile) return asArray(loadJson(tariffFile));
  if (key === 'mer') return asArray(json.data && json.data.tariffs);
  return [];
}

function normOp(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function compatible(feedKey, op) {
  const t = normOp(op);
  if (feedKey === 'cps') return t.includes('chargeplacescotland') || t.includes('chargeplace');
  if (feedKey === 'pogo') return t.includes('pogo');
  if (feedKey === 'mer') return t === 'mer' || t === 'meruk';
  if (feedKey === 'arnoldclark') return t.includes('arnoldclark');
  if (feedKey === 'gozero') return t.includes('gozero');
  if (feedKey === 'evdot') return t.includes('evdot') || t.includes('globeev');
  return false;
}

function tokens(s) {
  const stop = new Set(['street', 'road', 'lane', 'park', 'car', 'north', 'south', 'east', 'west', 'charge', 'charging', 'point', 'station', 'centre', 'center', 'community', 'hotel', 'services', 'service', 'business', 'council', 'county', 'gardens', 'avenue', 'close', 'drive', 'royal', 'hospital']);
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 6 && !stop.has(w));
}

function samePlace(a, b) {
  const tb = new Set(tokens(b));
  return tokens(a).some(w => tb.has(w));
}

function metres(a, o, b, p) {
  const r = Math.PI / 180;
  const x = (p - o) * r * Math.cos(((a + b) / 2) * r);
  const y = (b - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function cellKey(lat, lon) {
  return Math.floor(lat * 100) + ':' + Math.floor(lon * 100);
}

function buildIndex(items) {
  const grid = new Map();
  for (let i = 0; i < items.length; i++) {
    const k = cellKey(items[i].a, items[i].o);
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

function restrictedName(name, address) {
  const blob = String(name || '') + ' ' + String(address || '');
  if (/stafford/i.test(blob)) return false;
  return /\b(taxi|staff|fleet|residents?|private|restricted)\b/i.test(blob);
}

function restrictedEvse(e) {
  const pr = e.parking_restrictions;
  const list = Array.isArray(pr) ? pr : pr ? [pr] : [];
  return list.some(v => /TAXI|EMPLOYEE|STAFF|FLEET|RESIDENT/i.test(String(v)));
}

function isPrivateLocation(loc) {
  if (restrictedName(loc.name, loc.address)) return true;
  const evses = loc.evses || [];
  if (evses.length && evses.every(restrictedEvse)) return true;
  return false;
}

function connKw(c) {
  const declared = +c.max_electric_power;
  if (isFinite(declared) && declared > 0) return declared >= 100 ? declared / 1000 : declared;
  const v = +(c.max_voltage ?? c.voltage);
  const a = +(c.max_amperage ?? c.amperage);
  if (!(v > 0 && a > 0)) return null;
  const pt = String(c.power_type || '');
  if (pt === 'DC') return Math.round((v * a) / 100) / 10;
  if (pt === 'AC_3_PHASE' || v > 300) {
    const kw = v > 300 ? (Math.sqrt(3) * v * a) / 1000 : (v * 3 * a) / 1000;
    return Math.round(kw);
  }
  return Math.round((v * a) / 100) / 10;
}

function tariffMap(tariffs) {
  const map = new Map();
  for (const t of tariffs) {
    let price = null;
    let vat = null;
    for (const el of t.elements || []) {
      for (const p of el.price_components || []) {
        if (p.type === 'ENERGY' && +p.price > 0) {
          price = +p.price;
          vat = p.vat == null || p.vat === '' ? null : +p.vat;
        }
      }
    }
    if (t.id && price != null) map.set(String(t.id), { price, vat });
  }
  return map;
}

function money(info) {
  if (!info) return null;
  if (info.vat != null && isFinite(info.vat)) {
    const gross = info.price * (1 + info.vat / 100);
    return '£' + gross.toFixed(2) + '/kWh incl. VAT';
  }
  return '£' + (+info.price).toFixed(2) + '/kWh';
}

function feeText(loc, tariffs) {
  const counts = new Map();
  for (const e of loc.evses || []) {
    for (const c of e.connectors || []) {
      const id = (c.tariff_ids || [])[0];
      const label = money(id && tariffs.get(String(id)));
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0][0];
  return parts.map(([label, n]) => label.replace(' incl. VAT', '') + ' (' + n + (n === 1 ? ' bay' : ' bays') + ')').join(', ') + (parts[0][0].includes('incl. VAT') ? ', incl. VAT' : '');
}

function compact(loc, feed, tariffs) {
  if (!loc || loc.publish === false) return null;
  const country = String(loc.country || loc.country_code || '').toUpperCase();
  if (country && !['GBR', 'GB', 'UK'].includes(country)) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < 49 || lat > 61 || lon < -8.7 || lon > 2) return null;
  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;
  const evses = (loc.evses || []).filter(e => String(e.status || '').toUpperCase() !== 'REMOVED');
  if (!evses.length) return null;
  const conns = new Set();
  let bestKw = null;
  for (const e of evses) {
    for (const c of e.connectors || []) {
      const code = STD[c.standard];
      if (code) conns.add(code);
      const kw = connKw(c);
      if (kw != null && kw > 0 && kw <= 1000) bestKw = Math.max(bestKw || 0, kw);
    }
  }
  const pc = String(loc.postal_code || '').trim();
  const ad = [loc.address, loc.city, pc].filter(Boolean).join(', ') || null;
  const name = (loc.name && String(loc.name).trim()) || null;
  const o = {
    id: feed.prefix + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: feed.operator,
    _feed: feed.key,
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  o.cap = evses.length;
  if (ad) o.ad = ad;
  const fee = feeText(loc, tariffs);
  if (fee) o.fee = fee;
  if (isPrivateLocation(loc)) o.access = 'private';
  return o;
}

function findMatch(item, baseItems, grid) {
  let best = null;
  for (const i of neighbours(grid, item.a, item.o)) {
    const b = baseItems[i];
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metres(item.a, item.o, b.a, b.o);
    if (dist > 150) continue;
    const same = compatible(item._feed, b.op);
    const named = same && samePlace(item.n, b.n);
    const evoltCps = item._feed === 'cps' && normOp(b.op) === 'evolt' && dist <= 75 && samePlace(item.n, b.n);
    if (same && dist <= 75) {
      if (!best || dist < best.dist) best = { i, dist, kind: 'op' };
    } else if (named && dist <= 150) {
      if (!best || dist < best.dist) best = { i, dist, kind: 'name' };
    } else if (evoltCps) {
      if (!best || dist < best.dist) best = { i, dist, kind: 'evolt-name' };
    }
  }
  return best;
}

function applyOfficial(base, feedItem) {
  let changed = false;
  if (feedItem.k != null && base.k !== feedItem.k) {
    base.k = feedItem.k;
    changed = true;
  }
  if (feedItem.c && feedItem.c.length && JSON.stringify(base.c || []) !== JSON.stringify(feedItem.c)) {
    base.c = feedItem.c.slice();
    changed = true;
  }
  if (feedItem.cap != null && base.cap !== feedItem.cap) {
    base.cap = feedItem.cap;
    changed = true;
  }
  if (feedItem.fee && base.fee !== feedItem.fee) {
    base.fee = feedItem.fee;
    changed = true;
  }
  if (base.op !== feedItem.op) {
    base.op = feedItem.op;
    changed = true;
  }
  if (feedItem.access === 'private' && base.access !== 'private' && (feedItem._dist <= 40 || samePlace(feedItem.n, base.n))) {
    base.access = 'private';
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
  if (s.access) o.access = s.access;
  if (s.fee) o.fee = s.fee;
  for (const k of ['acc', 'h', 'cl', 'dev']) if (s[k] != null) o[k] = s[k];
  return o;
}

function withCredit(source) {
  let s = String(source || '');
  if (s.includes(CREDIT)) return s;
  const needle = 'GRIDSERVE Open Data API';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function main() {
  if (FEEDS.some(f => !f.file || !fs.existsSync(f.file))) {
    console.error('Missing a feed file argument.');
    process.exit(1);
  }
  const baseDoc = loadWindowJson(OUT_PATH, 'UK_CHARGERS');
  const beforeCount = baseDoc.items.length;
  const privateIds = new Set(baseDoc.items.filter(s => s.access === 'private').map(s => s.id));
  const byId = new Map();
  for (const s of baseDoc.items) byId.set(s.id, { ...s });
  const manual = loadWindowJson(MANUAL_PATH, 'MANUAL_CHARGERS');
  for (const s of (manual && manual.items) || []) {
    if (!s || s.access === 'private') continue;
    if (!byId.has(s.id)) byId.set(s.id, { ...s });
  }
  let baseItems = [...byId.values()];
  let grid = buildIndex(baseItems);
  const reports = [];

  for (const feed of FEEDS) {
    const json = loadJson(feed.file);
    const locations = locationsOf(json, feed.key);
    const tariffs = tariffMap(tariffsOf(json, feed.key, feed.tariff));
    let added = 0, matched = 0, enriched = 0, skipped = 0, represented = 0, privateMarked = 0;
    const claimed = new Set();
    const prepared = [];
    for (const loc of locations) {
      if (loc && loc.publish === false) { skipped++; continue; }
      const item = compact(loc, feed, tariffs);
      if (!item) { skipped++; continue; }
      prepared.push({ item, match: findMatch(item, baseItems, grid) });
    }
    prepared.sort((a, b) => (a.match ? a.match.dist : 1e9) - (b.match ? b.match.dist : 1e9));
    for (const { item, match } of prepared) {
      if (item.access === 'private') privateMarked++;
      if (match) {
        const base = baseItems[match.i];
        if (claimed.has(base.id)) {
          if (samePlace(item.n, base.n) && match.dist <= 40) { matched++; represented++; continue; }
          byId.set(item.id, item);
          baseItems.push(item);
          const k = cellKey(item.a, item.o);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(baseItems.length - 1);
          added++;
          continue;
        }
        claimed.add(base.id);
        matched++;
        item._dist = match.dist;
        if (applyOfficial(base, item)) enriched++;
      } else {
        byId.set(item.id, item);
        baseItems.push(item);
        const k = cellKey(item.a, item.o);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(baseItems.length - 1);
        added++;
      }
    }
    reports.push({ key: feed.key, operator: feed.operator, raw: locations.length, added, matched, enriched, represented, skipped, privateMarked });
    console.log(feed.key, { raw: locations.length, added, matched, enriched, represented, skipped, privateMarked });
  }

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const id of privateIds) {
    const now = outItems.find(s => s.id === id);
    if (!now || now.access !== 'private') throw new Error('Existing private flag lost on ' + id);
  }
  const notesBefore = baseDoc.items.filter(s => s.note === 'Customers only').length;
  const notesAfter = outItems.filter(s => s.note === 'Customers only').length;
  if (notesAfter !== notesBefore) throw new Error('Customers only notes changed');
  for (const prefix of ['shell:', 'zest:', 'instavolt:', 'ubitricity:', 'ionity:', 'evolt:', 'gridserve:', 'bppulse:']) {
    const beforeN = baseDoc.items.filter(s => String(s.id).startsWith(prefix)).length;
    const afterN = outItems.filter(s => String(s.id).startsWith(prefix)).length;
    if (beforeN !== afterN) throw new Error(prefix + ' count changed ' + beforeN + ' -> ' + afterN);
  }

  const feeds = Object.assign({}, baseDoc.feeds || {});
  for (const r of reports) feeds[r.key] = { label: r.operator, mode: 'file', raw: r.raw, added: r.added, matched: r.matched, enriched: r.enriched, skipped: r.skipped, privateMarked: r.privateMarked };
  const meta = {
    generated: new Date().toISOString(),
    source: withCredit(baseDoc.source),
    regions: baseDoc.regions || 'United Kingdom (GB)',
    count: outItems.length,
    feeds,
  };
  fs.writeFileSync(
    OUT_PATH,
    'window.UK_CHARGERS=' + JSON.stringify(meta).slice(0, -1) + ',"items":[\n' + outItems.map(i => JSON.stringify(i)).join(',\n') + '\n]};\n'
  );
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ before: beforeCount, after: outItems.length, netNew: outItems.length - beforeCount, feeds: reports, generated: meta.generated }, null, 2));
  console.log('Before', beforeCount, 'After', outItems.length, 'net', outItems.length - beforeCount);
}

main();
