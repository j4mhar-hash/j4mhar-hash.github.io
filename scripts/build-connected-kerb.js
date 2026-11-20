#!/usr/bin/env node
/**
 * Merge Connected Kerb CPMS public locations into data/uk-chargers.js.
 * No token is read or written.
 *   node scripts/build-connected-kerb.js locations.json tariffs.json
 *
 * Only publish:true pools. PLANNED and REMOVED EVSEs are dropped. Prices
 * exclude VAT and are stored including 20%. A tariff with several unrestricted
 * prices is shown as a range.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'connected-kerb-merge-report.json');
const CREDIT = 'Connected Kerb data via the Connected Kerb CPMS Public API, published under the Public Charge Point Regulations 2023';
const OPERATOR = 'Connected Kerb';

const STD = {
  IEC_62196_T2: 'T2',
  IEC_62196_T2_CABLE: 'T2',
  IEC_62196_T2_COMBO: 'CCS',
  CHADEMO: 'CHA',
  DOMESTIC_G: '3PIN',
};

function loadWindowJson(filePath, varName) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp('(?:window\\.)?' + varName + '\\s*=\\s*([\\s\\S]*?);\\s*$');
  const m = raw.match(re);
  const body = m ? m[1] : raw.slice(raw.indexOf('=') + 1).trim().replace(/;$/, '');
  try {
    return JSON.parse(body);
  } catch {
    return Function('"use strict"; return (' + body + ')')();
  }
}

function normOp(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isConnectedKerb(op) {
  return normOp(op).includes('connectedkerb');
}

function compactName(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '');
}

function sameCharger(a, b) {
  const ca = compactName(a);
  const cb = compactName(b);
  const short = ca.length <= cb.length ? ca : cb;
  const long = ca.length <= cb.length ? cb : ca;
  return short.length >= 10 && long.includes(short);
}

function tokens(s) {
  const stop = new Set(['street', 'road', 'lane', 'park', 'car', 'north', 'south', 'east', 'west', 'close', 'drive', 'avenue', 'gardens', 'point', 'charge', 'charging']);
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

function isPrivateText(name, address) {
  const blob = String(name || '') + ' ' + String(address || '');
  if (/\bresidents?\b/i.test(blob)) return true;
  if (/\bdepot\b/i.test(blob)) return true;
  if (/\bstaff\b/i.test(blob) && !/stafford/i.test(blob)) return true;
  if (/\bcouncil offices\b/i.test(blob) || /\bgeneral offices\b/i.test(blob)) return true;
  if (/\bbus\s+(depot|station)\b/i.test(blob)) return true;
  const withoutStreet = blob.replace(/\bschool\s+(road|lane|street|close|avenue|drive|way|hill|gardens|place|court)\b/gi, ' ');
  if (/\b(school|ysgol|primary|comprehensive)\b/i.test(withoutStreet)) return true;
  return false;
}

function connInfo(c) {
  if (+c.max_electric_power > 0) {
    const p = +c.max_electric_power;
    return { kw: p >= 100 ? p / 1000 : p, code: STD[c.standard] };
  }
  let v = +(c.max_voltage ?? c.voltage);
  let a = +(c.max_amperage ?? c.amperage);
  if (v > 0 && a > 0 && v < 60 && a >= 100) {
    const swap = v;
    v = a;
    a = swap;
  }
  const pt = String(c.power_type || '');
  const std = String(c.standard || '');
  let phases = +c.phases;
  if (!phases) phases = pt === 'AC_3_PHASE' ? 3 : 1;
  let kw = null;
  if (v > 0 && a > 0) {
    if (pt === 'DC') kw = (v * a) / 1000;
    else if (pt === 'AC_3_PHASE' || phases >= 3) kw = v > 300 ? (Math.sqrt(3) * v * a) / 1000 : (v * a * phases) / 1000;
    else if (v > 300) kw = (Math.sqrt(3) * v * a) / 1000;
    else kw = (v * a) / 1000;
  }
  // A Type 2 or CHAdeMO bay whose figures are a 7 kW post was mistagged as DC.
  if (pt === 'DC' && (std === 'IEC_62196_T2' || std === 'CHADEMO') && kw != null && kw > 0 && kw <= 11) {
    return { kw: 7, code: 'T2' };
  }
  if (kw == null) return { kw: null, code: STD[std] };
  const rounded = pt === 'AC_3_PHASE' || phases >= 3 || v > 300 ? Math.round(kw) : Math.round(kw * 10) / 10;
  return { kw: rounded, code: STD[std] };
}

function tariffMap(tariffs) {
  const map = new Map();
  for (const t of tariffs) {
    const prices = [];
    for (const el of t.elements || []) {
      const restrictions = el.restrictions;
      const blocked = restrictions && Object.entries(restrictions).some(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0));
      if (blocked) continue;
      for (const p of el.price_components || []) {
        if (p.type === 'ENERGY' && +p.price > 0) prices.push(+p.price * (1 + (+p.vat || 0) / 100));
      }
    }
    if (!prices.length) {
      for (const el of t.elements || []) {
        for (const p of el.price_components || []) {
          if (p.type === 'ENERGY' && +p.price > 0) prices.push(+p.price * (1 + (+p.vat || 0) / 100));
        }
      }
    }
    const unique = [...new Set(prices.map(p => Math.round(p * 100)))].sort((a, b) => a - b);
    if (!unique.length || t.id == null) continue;
    const label = unique.length === 1
      ? '£' + (unique[0] / 100).toFixed(2) + '/kWh incl. VAT'
      : unique[0] + '–' + unique[unique.length - 1] + 'p/kWh incl. VAT';
    map.set(String(t.id), label);
  }
  return map;
}

function feeText(loc, tariffs) {
  const counts = new Map();
  for (const e of loc.evses || []) {
    if (['PLANNED', 'REMOVED'].includes(String(e.status || '').toUpperCase())) continue;
    for (const c of e.connectors || []) {
      const label = tariffs.get(String((c.tariff_ids || [])[0]));
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0][0];
  return parts.map(([label, n]) => label.replace(' incl. VAT', '') + ' (' + n + ')').join(', ') + ', incl. VAT';
}

function compact(loc, tariffs) {
  if (!loc || loc.publish === false) return null;
  const country = String(loc.country || loc.country_code || '').toUpperCase();
  if (country && !['GBR', 'GB', 'UK'].includes(country)) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon) || lat < 49 || lat > 61 || lon < -8.7 || lon > 2) return null;
  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;
  const evses = (loc.evses || []).filter(e => !['PLANNED', 'REMOVED'].includes(String(e.status || '').toUpperCase()));
  if (!evses.length) return null;
  const conns = new Set();
  let bestKw = null;
  for (const e of evses) {
    for (const c of e.connectors || []) {
      const info = connInfo(c);
      if (info.code) conns.add(info.code);
      if (info.kw != null && info.kw > 0 && info.kw <= 1000) bestKw = Math.max(bestKw || 0, info.kw);
    }
  }
  const pc = String(loc.postal_code || '').trim();
  const o = { id: 'ck:' + id, a: +lat.toFixed(5), o: +lon.toFixed(5), op: OPERATOR };
  if (bestKw != null) o.k = bestKw;
  if (conns.size) o.c = [...conns];
  if (loc.name) o.n = String(loc.name).trim();
  o.cap = evses.length;
  const ad = [loc.address, loc.city, pc].filter(Boolean).join(', ');
  if (ad) o.ad = ad;
  const fee = feeText(loc, tariffs);
  if (fee) o.fee = fee;
  if (isPrivateText(loc.name, loc.address)) o.access = 'private';
  return o;
}

function findMatch(item, baseItems, grid) {
  let best = null;
  for (const i of neighbours(grid, item.a, item.o)) {
    const b = baseItems[i];
    if (String(b.id).startsWith('ck:')) continue;
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metres(item.a, item.o, b.a, b.o);
    if (dist > 150) continue;
    const own = isConnectedKerb(b.op);
    const named = samePlace(item.n, b.n);
    const clear = !own && dist <= 30 && sameCharger(item.n, b.n);
    if ((own && dist <= 75) || (own && named && dist <= 150) || clear) {
      if (!best || dist < best.dist) best = { i, dist, own };
    }
  }
  return best;
}

function applyOfficial(base, feed, dist) {
  let changed = false;
  if (feed.k != null && base.k !== feed.k) { base.k = feed.k; changed = true; }
  if (feed.c && feed.c.length && JSON.stringify(base.c || []) !== JSON.stringify(feed.c)) { base.c = feed.c.slice(); changed = true; }
  if (feed.cap != null && base.cap !== feed.cap) { base.cap = feed.cap; changed = true; }
  if (feed.fee && base.fee !== feed.fee) { base.fee = feed.fee; changed = true; }
  if (base.op !== OPERATOR) { base.op = OPERATOR; changed = true; }
  if (feed.access === 'private' && base.access !== 'private' && (dist <= 40 || samePlace(feed.n, base.n))) {
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
  const s = String(source || '');
  if (s.includes('Connected Kerb CPMS Public API')) return s;
  const needle = 'Open Government Licence v3.0';
  const at = s.lastIndexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function assertPrivateRules() {
  const cases = [
    ['Bush Close', 'Bush Close', false],
    ['Limebush Close', '24-71 Limebush Close', false],
    ['School Lane Car Park', 'School Lane', false],
    ['1 Baker Crescent (School Road)', '1 Baker Crescent (School Road)', false],
    ['Blenheim Road Primary School', 'Blenheim Road', true],
    ['Oakley Libraries Depot', 'Oakley Libraries Depot', true],
    ['Barry Docks Bus Station Car Park', 'Broad Street', true],
    ['Residents Bay', 'High Street', true],
  ];
  for (const [name, address, expected] of cases) {
    if (isPrivateText(name, address) !== expected) {
      throw new Error('Private rule failed for ' + name);
    }
  }
}

function main() {
  assertPrivateRules();
  const file = process.argv[2];
  const tariffFile = process.argv[3];
  if (!file || !tariffFile) {
    console.error('Pass locations JSON and tariffs JSON.');
    process.exit(1);
  }
  const baseDoc = loadWindowJson(OUT_PATH, 'UK_CHARGERS');
  const beforeCount = baseDoc.items.length;
  const privateIds = new Set(baseDoc.items.filter(s => s.access === 'private').map(s => s.id));
  const byId = new Map(baseDoc.items.map(s => [s.id, { ...s }]));
  const manual = loadWindowJson(MANUAL_PATH, 'MANUAL_CHARGERS');
  for (const s of (manual && manual.items) || []) {
    if (!s || s.access === 'private' || byId.has(s.id)) continue;
    byId.set(s.id, { ...s });
  }
  const baseItems = [...byId.values()];
  const grid = buildIndex(baseItems);
  const locations = JSON.parse(fs.readFileSync(file, 'utf8')).data;
  const tariffs = tariffMap(JSON.parse(fs.readFileSync(tariffFile, 'utf8')).data || []);
  let added = 0, matched = 0, enriched = 0, skipped = 0, unpublished = 0, excluded = 0, represented = 0, privateMarked = 0;
  const claimed = new Set();
  const prepared = [];
  for (const loc of locations) {
    if (loc && loc.publish === false) { unpublished++; continue; }
    const item = compact(loc, tariffs);
    if (!item) { excluded++; continue; }
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
        added++;
        continue;
      }
      claimed.add(base.id);
      matched++;
      if (applyOfficial(base, item, match.dist)) enriched++;
    } else {
      byId.set(item.id, item);
      added++;
    }
  }
  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const id of privateIds) {
    const now = outItems.find(s => s.id === id);
    if (!now || now.access !== 'private') throw new Error('Existing private flag lost on ' + id);
  }
  if (outItems.filter(s => s.note === 'Customers only').length < 90) throw new Error('Customer notes dropped');
  const bush = outItems.find(s => s.n === 'Bush Close' && String(s.id).startsWith('ck:'));
  if (bush && bush.access === 'private') throw new Error('Bush Close was marked private');
  for (const prefix of ['shell:', 'plug:', 'zest:', 'instavolt:', 'ubitricity:', 'ionity:', 'evolt:', 'gridserve:', 'cps:', 'pogo:', 'mer:', 'gozero:', 'evdot:']) {
    const beforeN = baseDoc.items.filter(s => String(s.id).startsWith(prefix)).length;
    const afterN = outItems.filter(s => String(s.id).startsWith(prefix)).length;
    if (beforeN !== afterN) throw new Error(prefix + ' count changed ' + beforeN + ' -> ' + afterN);
  }
  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    connectedkerb: { label: 'Connected Kerb', mode: 'file', raw: locations.length, added, matched, enriched, skipped, unpublished, excluded, privateMarked },
  });
  const meta = {
    generated: new Date().toISOString(),
    source: withCredit(baseDoc.source),
    regions: baseDoc.regions || 'United Kingdom (GB)',
    count: outItems.length,
    feeds,
  };
  fs.writeFileSync(OUT_PATH, 'window.UK_CHARGERS=' + JSON.stringify(meta).slice(0, -1) + ',"items":[\n' + outItems.map(i => JSON.stringify(i)).join(',\n') + '\n]};\n');
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    before: beforeCount, after: outItems.length, netNew: outItems.length - beforeCount,
    raw: locations.length, added, matched, enriched, represented, skipped, unpublished, excluded, privateMarked,
    ckPrefix: outItems.filter(s => String(s.id).startsWith('ck:')).length,
    generated: meta.generated,
  }, null, 2));
  console.log({ before: beforeCount, after: outItems.length, added, matched, enriched, represented, unpublished, excluded, privateMarked });
}

main();
