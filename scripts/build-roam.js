#!/usr/bin/env node
/**
 * Merge ROAM Charging UK open data into data/uk-chargers.js.
 * No token. Prices are used as published (no VAT is added).
 *   node scripts/build-roam.js locations.json tariffs.json
 *
 * Matches existing Roam Charging pins within 75 m, or 150 m when the name
 * is the same. Another operator is updated only when the name is the same
 * charger within 30 m.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'roam-merge-report.json');
const CREDIT = 'ROAM Charging open data (https://data.evc.ninja/public/v1/data)';
const OPERATOR = 'Roam Charging';

const STD = {
  IEC_62196_T2: 'T2',
  IEC_62196_T2_CABLE: 'T2',
  IEC_62196_T2_COMBO: 'CCS',
  IEC_62196_T1: 'T1',
  IEC_62196_T1_COMBO: 'CCS1',
  CHADEMO: 'CHA',
};

function loadWindowJson(filePath, varName) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp('(?:window\\.)?' + varName + '\\s*=\\s*([\\s\\S]*?);\\s*$');
  const m = raw.match(re);
  const body = m ? m[1] : raw.slice(raw.indexOf('=') + 1).trim().replace(/;$/, '');
  try { return JSON.parse(body); } catch { return Function('"use strict"; return (' + body + ')')(); }
}

function normOp(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isRoam(op) {
  return normOp(op).includes('roamcharging');
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
  const stop = new Set(['street', 'road', 'lane', 'park', 'car', 'north', 'south', 'east', 'west', 'hotel', 'close', 'drive', 'avenue', 'gardens', 'house']);
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
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const list = grid.get(cy + dy + ':' + (cx + dx));
    if (list) out.push(...list);
  }
  return out;
}

function isPrivateText(name, address) {
  const blob = String(name || '') + ' ' + String(address || '');
  if (/stafford/i.test(blob)) return false;
  if (/\bresidents?\b/i.test(blob)) return true;
  if (/\bdepot\b/i.test(blob)) return true;
  if (/\bstaff\b/i.test(blob)) return true;
  if (/\bprivate\b/i.test(blob)) return true;
  if (/\brestricted\b/i.test(blob)) return true;
  if (/\bfleet\s+(depot|services|only|yard|vehicles)\b/i.test(blob)) return true;
  if (/\b(staff|private|company)\s+fleet\b/i.test(blob)) return true;
  const cleaned = blob.replace(/\bschool\s+(rd|road|st|street|lane|close|avenue|drive|way)\b/gi, ' ');
  if (/\b(school|academy)\b/i.test(cleaned)) return true;
  return false;
}

function connKw(c) {
  const declared = +c.max_electric_power;
  if (isFinite(declared) && declared > 0) return declared >= 100 ? declared / 1000 : declared;
  const v = +(c.voltage ?? c.max_voltage);
  const a = +(c.amperage ?? c.max_amperage);
  if (!(v > 0 && a > 0)) return null;
  const pt = String(c.power_type || '');
  const kw = pt === 'AC_3_PHASE' ? (v * a * 3) / 1000 : (v * a) / 1000;
  return pt === 'AC_3_PHASE' ? Math.round(kw) : Math.round(kw * 10) / 10;
}

function tariffMap(tariffs) {
  const map = new Map();
  for (const t of tariffs) {
    const prices = [];
    const saysExcl = /excl|excluding/i.test(JSON.stringify(t.tariff_alt_text || '') + (t.type || ''));
    for (const el of t.elements || []) {
      for (const p of el.price_components || []) {
        if (p.type !== 'ENERGY' || !(+p.price > 0)) continue;
        let price = +p.price;
        if (saysExcl || (p.vat != null && +p.vat > 0 && /excl/i.test(JSON.stringify(p)))) price = price * (1 + (+p.vat) / 100);
        prices.push(price);
      }
    }
    const unique = [...new Set(prices.map(p => Math.round(p * 100)))].sort((a, b) => a - b);
    if (!unique.length || t.id == null) continue;
    const label = unique.length === 1
      ? '£' + (unique[0] / 100).toFixed(2) + '/kWh'
      : unique[0] + '–' + unique[unique.length - 1] + 'p/kWh';
    map.set(String(t.id), label);
  }
  return map;
}

function penceOf(label) {
  const pound = String(label).match(/£(\d+(?:\.\d+)?)/);
  if (pound) return [Math.round(parseFloat(pound[1]) * 100)];
  const range = String(label).match(/(\d+)\s*[–-]\s*(\d+)p/);
  if (range) return [+range[1], +range[2]];
  return [];
}

function feeText(loc, tariffs) {
  const pence = new Set();
  let single = null;
  for (const e of loc.evses || []) {
    if (['PLANNED', 'REMOVED'].includes(String(e.status || '').toUpperCase())) continue;
    for (const c of e.connectors || []) {
      const label = tariffs.get(String(c.tariff_id || (c.tariff_ids || [])[0]));
      if (!label) continue;
      single = label;
      for (const p of penceOf(label)) pence.add(p);
    }
  }
  const nums = [...pence].sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return single && single.startsWith('£') ? single : '£' + (nums[0] / 100).toFixed(2) + '/kWh';
  return nums[0] + '–' + nums[nums.length - 1] + 'p/kWh';
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
      const code = STD[c.standard];
      if (code) conns.add(code);
      const kw = connKw(c);
      if (kw != null && kw > 0 && kw <= 1000) bestKw = Math.max(bestKw || 0, kw);
    }
  }
  const pc = String(loc.postal_code || '').trim();
  const o = { id: 'roam:' + id, a: +lat.toFixed(5), o: +lon.toFixed(5), op: OPERATOR };
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
    if (String(b.id).startsWith('roam:')) continue;
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metres(item.a, item.o, b.a, b.o);
    if (dist > 150) continue;
    const own = isRoam(b.op);
    const named = samePlace(item.n, b.n) || sameCharger(item.n, b.n);
    if ((own && dist <= 75) || (own && named && dist <= 150) || (!own && named && dist <= 75 && sameCharger(item.n, b.n))) {
      if (!best || dist < best.dist) best = { i, dist };
    }
  }
  return best;
}

const NAME_REFRESH = new Set(['3crAuMu6S5du7AK0SvxC', 'W3gkniZzfBiZCg1G7Oxo']);

function applyInPlace(base, feed) {
  let changed = false;
  if (feed.n && base.n !== feed.n) { base.n = feed.n; changed = true; }
  if (feed.a != null && (base.a !== feed.a || base.o !== feed.o)) { base.a = feed.a; base.o = feed.o; changed = true; }
  if (feed.cap != null && base.cap !== feed.cap) { base.cap = feed.cap; changed = true; }
  if (feed.k != null && base.k !== feed.k) { base.k = feed.k; changed = true; }
  if (feed.c && feed.c.length && JSON.stringify(base.c || []) !== JSON.stringify(feed.c)) { base.c = feed.c.slice(); changed = true; }
  if (feed.fee && base.fee !== feed.fee) { base.fee = feed.fee; changed = true; }
  if (feed.access === 'private' && base.access !== 'private') { base.access = 'private'; changed = true; }
  return changed;
}

function applyOfficial(base, feed, dist) {
  let changed = false;
  if (feed.k != null && base.k !== feed.k) { base.k = feed.k; changed = true; }
  if (feed.c && feed.c.length && JSON.stringify(base.c || []) !== JSON.stringify(feed.c)) { base.c = feed.c.slice(); changed = true; }
  if (feed.cap != null && base.cap !== feed.cap) { base.cap = feed.cap; changed = true; }
  if (feed.fee && base.fee !== feed.fee) { base.fee = feed.fee; changed = true; }
  if (isRoam(base.op) && base.op !== OPERATOR) { base.op = OPERATOR; changed = true; }
  if (!isRoam(base.op) && sameCharger(feed.n, base.n)) { base.op = OPERATOR; changed = true; }
  if (feed.access === 'private' && base.access !== 'private' && (dist <= 40 || sameCharger(feed.n, base.n))) {
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
  if (s.includes('ROAM Charging open data')) return s;
  const needle = 'Connected Kerb CPMS Public API, published under the Public Charge Point Regulations 2023';
  const at = s.lastIndexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function assertPrivate() {
  if (isPrivateText('Cally Palace Hotel and Golf Course', 'Cally Ave, Gatehouse of Fleet, Castle Douglas')) {
    throw new Error('Gatehouse of Fleet was marked private');
  }
  if (isPrivateText('Birstall Council Sibson Road Car Park', 'School Lane, Birstall')) {
    throw new Error('School Lane was marked private');
  }
  if (!isPrivateText('Cheney School', 'Cheney Ln Headington')) throw new Error('School not private');
  if (!isPrivateText('Residents Bay', 'High Street')) throw new Error('Residents not private');
  if (!isPrivateText('Staff car park', 'Depot Lane')) throw new Error('Staff depot not private');
}

function main() {
  assertPrivate();
  const file = process.argv[2];
  const tariffFile = process.argv[3];
  if (!file || !tariffFile) { console.error('Pass locations and tariffs JSON.'); process.exit(1); }
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
  let added = 0, matched = 0, enriched = 0, skipped = 0, represented = 0, privateMarked = 0;
  const claimed = new Set();
  const prepared = [];
  for (const loc of locations) {
    const item = compact(loc, tariffs);
    if (!item) { skipped++; continue; }
    prepared.push({ item, locId: String(loc.id), match: findMatch(item, baseItems, grid) });
  }
  prepared.sort((a, b) => (a.match ? a.match.dist : 1e9) - (b.match ? b.match.dist : 1e9));
  const welwyn = { matchedId: null, added: false };
  for (const { item, locId, match } of prepared) {
    if (item.access === 'private') privateMarked++;
    const existing = byId.get(item.id);
    if (existing && String(existing.id).startsWith('roam:')) {
      matched++;
      if (applyInPlace(existing, item)) enriched++;
      continue;
    }
    if (match) {
      const base = baseItems[match.i];
      if (claimed.has(base.id)) {
        if ((samePlace(item.n, base.n) || sameCharger(item.n, base.n)) && match.dist <= 40) { matched++; represented++; continue; }
        byId.set(item.id, item); added++;
        if (locId === 'KwieeoonSWHtLmRWMth5') welwyn.added = true;
        continue;
      }
      claimed.add(base.id);
      matched++;
      if (isRoam(base.op)) {
        if (NAME_REFRESH.has(locId) && item.n && base.n !== item.n) { base.n = item.n; enriched++; }
      } else if (applyOfficial(base, item, match.dist)) {
        if (item.n && base.n !== item.n) base.n = item.n;
        enriched++;
      }
      if (locId === 'KwieeoonSWHtLmRWMth5') welwyn.matchedId = base.id;
    } else {
      byId.set(item.id, item);
      added++;
      if (locId === 'KwieeoonSWHtLmRWMth5') welwyn.added = true;
    }
  }
  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const id of privateIds) {
    const now = outItems.find(s => s.id === id);
    if (!now || now.access !== 'private') throw new Error('Existing private flag lost on ' + id);
  }
  if (outItems.filter(s => s.note === 'Customers only').length < 90) throw new Error('Customer notes dropped');
  for (const prefix of ['shell:', 'plug:', 'ck:', 'zest:', 'instavolt:', 'ubitricity:', 'ionity:', 'evolt:', 'gridserve:', 'cps:', 'pogo:', 'mer:', 'gozero:', 'evdot:']) {
    const beforeN = baseDoc.items.filter(s => String(s.id).startsWith(prefix)).length;
    const afterN = outItems.filter(s => String(s.id).startsWith(prefix)).length;
    if (beforeN !== afterN) throw new Error(prefix + ' count changed');
  }
  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    roam: { label: 'ROAM Charging', mode: 'file', raw: locations.length, added, matched, enriched, skipped, privateMarked },
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
    raw: locations.length, added, matched, enriched, represented, skipped, privateMarked,
    roamPrefix: outItems.filter(s => String(s.id).startsWith('roam:')).length,
    generated: meta.generated,
    welwyn,
    note: 'ROAM Charging refresh from https://data.evc.ninja/public/v1/data (25 Nov 2026). Existing roam: ids are updated in place. Prices are used as published; the tariffs have no VAT field, so 20% was not added.',
  }, null, 2));
  console.log({ before: beforeCount, after: outItems.length, added, matched, enriched, represented, skipped, privateMarked, welwyn });
}

main();
