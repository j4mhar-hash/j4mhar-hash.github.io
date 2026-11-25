#!/usr/bin/env node
/**
 * Merge Allego, ev-point (EG Group) and Lidl GB from Eco-Movement PCPR.
 * No token is read or written. All three numeric prices exclude VAT, so 20% is added.
 *   node scripts/build-allego-evpoint-lidl.js allego.json allego-tariffs.json evpoint.json evpoint-tariffs.json lidl.json lidl-tariffs.json
 *
 * A pin within 75 m is enriched when it is the same charger. A different network
 * beside it is left alone. Lidl AC is 55p and DC is 74p even when the socket
 * is tagged with the rapid tariff.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'allego-evpoint-lidl-merge-report.json');
const CREDIT = 'Allego, ev-point (EG Group) and Lidl GB open data via Eco-Movement PCPR';
const LIDL_DEPOT = 'd7d1002f-5ac8-4ea8-a33d-95a589d38fd5';

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
  try { return JSON.parse(body); } catch { return Function('"use strict"; return (' + body + ')')(); }
}

function loadLocations(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.locations)) return j.locations;
  if (Array.isArray(j.data)) return j.data;
  throw new Error('No locations in ' + file);
}

function loadTariffs(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.tariffs)) return j.tariffs;
  if (Array.isArray(j.data)) return j.data;
  return [];
}

function normOp(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isUnknown(op) {
  const t = normOp(op);
  return !t || t === 'none' || t === 'unknown' || t === 'unknownoperator';
}

function placeKey(s) {
  return String(s || '').toLowerCase()
    .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/g, ' ')
    .replace(/\b(allego|lidl|gb|uk|london|store|the|and|road|street|avenue|lane)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^\d+/, '');
}

function samePlace(a, b) {
  const ca = placeKey(a);
  const cb = placeKey(b);
  if (ca.length < 6 || cb.length < 6) return false;
  const short = ca.length <= cb.length ? ca : cb;
  const long = ca.length <= cb.length ? cb : ca;
  return long.includes(short);
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

function allowed(feed, base, item, dist) {
  const t = normOp(base.op);
  const named = samePlace(item.n, base.n);
  if (dist > 75 && !named) return false;
  if (dist > 150) return false;
  if (feed === 'allego') {
    if (t.includes('allego') || isUnknown(base.op)) return dist <= 75 || named;
    if (named && dist <= 75 && String(base.id).startsWith('ubitricity:') && dist > 10) return false;
    return named && dist <= 75;
  }
  if (feed === 'evpoint') {
    if (t.includes('chargepoint') && String(base.id).startsWith('chargepoint:') && !named && !/eg group|eurogarage|ev point/i.test(base.n || '')) return false;
    if (t.includes('chargepoint') || t.includes('evpoint') || t.includes('eggroup') || isUnknown(base.op)) return dist <= 75 || named;
    if (t.includes('geniepoint') && /eurogarage/i.test(base.n || '')) return dist <= 75;
    if (/caird/.test(normOp(base.n)) && /caird/.test(normOp(item.n))) return dist <= 75;
    if (t.includes('fuuse') && /blyth/.test(normOp(base.n)) && /blyth/.test(normOp(item.n))) return dist <= 75;
    return false;
  }
  if (feed === 'lidl') {
    if (t.includes('podpoint') || t.includes('lidl') || isUnknown(base.op) || /\blidl\b/i.test(base.n || '')) return dist <= 75 || named;
    return false;
  }
  return false;
}

function isPrivate(feed, loc) {
  if (feed === 'lidl' && String(loc.id) === LIDL_DEPOT) return true;
  const blob = String(loc.name || '') + ' ' + String(loc.address || '');
  if (/stafford/i.test(blob)) return false;
  if (/aberdeen motor company/i.test(blob)) return false;
  if (/\b(staff|residents?)\b/i.test(String(loc.name || ''))) return true;
  const cleaned = blob.replace(/\b(school|depot)\s+(rd|road|st|street|lane|close|avenue|drive|way)\b/gi, ' ');
  return /\b(school|academy|depot)\b/i.test(cleaned);
}

function connKw(c) {
  const declared = +c.max_electric_power;
  if (isFinite(declared) && declared > 0) return declared >= 100 ? declared / 1000 : declared;
  const v = +(c.max_voltage ?? c.voltage);
  const a = +(c.max_amperage ?? c.amperage);
  if (!(v > 0 && a > 0)) return null;
  const pt = String(c.power_type || '');
  if (pt === 'AC_3_PHASE') return Math.round((v * a * 3) / 1000);
  return Math.round((v * a) / 1000);
}

function isDc(c) {
  const pt = String(c.power_type || '');
  const std = String(c.standard || '');
  return pt === 'DC' || pt.startsWith('DC') || /COMBO|CHADEMO/.test(std);
}

function incVatPence(exVat) {
  return Math.round(+exVat * 1.2 * 100);
}

function penceText(pence) {
  const nums = [...new Set(pence)].filter(n => n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const one = n => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
  if (nums.length === 1) return one(nums[0]) + 'p/kWh';
  return one(nums[0]) + '–' + one(nums[nums.length - 1]) + 'p/kWh';
}

function tariffMap(tariffs) {
  const map = new Map();
  for (const t of tariffs) {
    const energy = [];
    let idle = null;
    for (const el of t.elements || []) {
      const minDur = el.restrictions && +el.restrictions.min_duration;
      for (const p of el.price_components || []) {
        if (!(+p.price > 0)) continue;
        if (p.type === 'ENERGY') energy.push(incVatPence(p.price));
        if ((p.type === 'PARKING_TIME' || p.type === 'TIME') && minDur >= 60) {
          const perMin = (+p.price / 60) * 1.2 * 100;
          const after = Math.round(minDur / 60);
          idle = penceText([Math.round(perMin * 10) / 10]).replace('p/kWh', 'p/min') + ' after ' + after + ' min';
        }
      }
    }
    const bits = [];
    const energyText = penceText(energy);
    if (energyText) bits.push(energyText);
    if (idle) bits.push('idle ' + idle);
    if (t.id != null && bits.length) map.set(String(t.id), bits.join(', '));
  }
  return map;
}

function cleanName(feed, name) {
  let n = String(name || '').trim();
  if (feed === 'allego') n = n.replace(/^Allego\s*-\s*/i, '').replace(/^GB,\s*/i, '').replace(/,?\s*London$/i, '').trim();
  return n;
}

function feeFor(feed, loc, tariffs) {
  if (feed === 'lidl') {
    let ac = false;
    let dc = false;
    for (const e of loc.evses || []) {
      if (['PLANNED', 'REMOVED'].includes(String(e.status || '').toUpperCase())) continue;
      for (const c of e.connectors || []) {
        if (isDc(c)) dc = true;
        else ac = true;
      }
    }
    if (ac && dc) return '55p/kWh AC, 74p/kWh DC';
    if (dc) return '74p/kWh';
    if (ac) return '55p/kWh';
    return null;
  }
  const labels = new Set();
  for (const e of loc.evses || []) {
    if (['PLANNED', 'REMOVED'].includes(String(e.status || '').toUpperCase())) continue;
    for (const c of e.connectors || []) {
      const id = c.tariff_id || (c.tariff_ids || [])[0];
      const label = id && tariffs.get(String(id));
      if (label) labels.add(label);
    }
  }
  return [...labels].slice(0, 2).join('; ') || null;
}

function compact(loc, feed) {
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
  const name = cleanName(feed.key, loc.name);
  const o = { id: feed.prefix + id, a: +lat.toFixed(5), o: +lon.toFixed(5), op: feed.operator, _feed: feed.key, _src: String(loc.id) };
  if (bestKw != null) o.k = bestKw;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  o.cap = evses.length;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ');
  if (ad) o.ad = ad;
  const fee = feeFor(feed.key, loc, feed.tariffs);
  if (fee) o.fee = fee;
  if (isPrivate(feed.key, loc)) o.access = 'private';
  return o;
}

function findMatch(item, baseItems, grid) {
  let best = null;
  for (const i of neighbours(grid, item.a, item.o)) {
    const b = baseItems[i];
    if (String(b.id).startsWith(item._feed === 'evpoint' ? 'evpoint:' : item._feed + ':')) continue;
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metres(item.a, item.o, b.a, b.o);
    if (!allowed(item._feed, b, item, dist)) continue;
    if (!best || dist < best.dist) best = { i, dist };
  }
  return best;
}

function applyOfficial(base, feed, dist) {
  let changed = false;
  if (feed.k != null && base.k !== feed.k) { base.k = feed.k; changed = true; }
  if (feed.c && feed.c.length && JSON.stringify(base.c || []) !== JSON.stringify(feed.c)) { base.c = feed.c.slice(); changed = true; }
  if (feed.cap != null && base.cap !== feed.cap) { base.cap = feed.cap; changed = true; }
  if (feed.fee && base.fee !== feed.fee) { base.fee = feed.fee; changed = true; }
  if (base.op !== feed.op) { base.op = feed.op; changed = true; }
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
  if (s.includes('Allego, ev-point (EG Group) and Lidl')) return s;
  const needle = 'EZO, ESB ecars and ESB Energy open data via Eco-Movement PCPR';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function assertRules() {
  if (isPrivate('allego', { id: 'x', name: 'School Rd', address: 'School Rd' })) throw new Error('School Rd marked private');
  if (isPrivate('allego', { id: 'x', name: 'UK, Aberdeen Motor Company, Aberdeen', address: 'Mugiemoss Road' })) throw new Error('Dealership marked private');
  if (!isPrivate('lidl', { id: LIDL_DEPOT, name: 'BRS-Horfield', address: 'First Bus Depot, Muller Road' })) throw new Error('Horfield depot not private');
  const sample = tariffMap([{ id: 'ac', elements: [{ price_components: [{ type: 'ENERGY', price: 0.525 }] }] }, { id: 'dc', elements: [{ restrictions: { min_duration: 2700 }, price_components: [{ type: 'PARKING_TIME', price: 10.8 }] }, { price_components: [{ type: 'ENERGY', price: 0.7 }] }] }]);
  if (sample.get('ac') !== '63p/kWh') throw new Error('Allego AC price ' + sample.get('ac'));
  if (!/84p\/kWh, idle 21\.6p\/min after 45 min/.test(sample.get('dc'))) throw new Error('Allego DC price ' + sample.get('dc'));
  const ev = tariffMap([
    { id: 'a', elements: [{ price_components: [{ type: 'ENERGY', price: 0.5416 }] }] },
    { id: 'b', elements: [{ price_components: [{ type: 'ENERGY', price: 0.625 }] }] },
    { id: 'c', elements: [{ price_components: [{ type: 'ENERGY', price: 0.6666 }] }] },
  ]);
  if (ev.get('a') !== '65p/kWh' || ev.get('b') !== '75p/kWh' || ev.get('c') !== '80p/kWh') throw new Error('ev-point prices ' + [...ev.values()]);
}

function main() {
  assertRules();
  const files = process.argv.slice(2);
  if (files.length < 6) {
    console.error('Pass locations and tariffs for allego, evpoint and lidl.');
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
  const specs = [
    { key: 'allego', prefix: 'allego:', operator: 'Allego', loc: files[0], tar: files[1] },
    { key: 'evpoint', prefix: 'evpoint:', operator: 'ev-point (EG Group)', loc: files[2], tar: files[3] },
    { key: 'lidl', prefix: 'lidl:', operator: 'Lidl', loc: files[4], tar: files[5] },
  ];
  const reports = [];
  for (const spec of specs) {
    spec.tariffs = spec.key === 'lidl' ? new Map() : tariffMap(loadTariffs(spec.tar));
    const locations = loadLocations(spec.loc);
    let added = 0, matched = 0, enriched = 0, skipped = 0, represented = 0, privateMarked = 0;
    const claimed = new Set();
    const prepared = [];
    for (const loc of locations) {
      const item = compact(loc, spec);
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
          byId.set(item.id, item); added++; continue;
        }
        claimed.add(base.id);
        matched++;
        if (applyOfficial(base, item, match.dist)) enriched++;
      } else {
        byId.set(item.id, item);
        added++;
      }
    }
    reports.push({ key: spec.key, operator: spec.operator, raw: locations.length, added, matched, enriched, represented, skipped, privateMarked });
    console.log(spec.key, reports[reports.length - 1]);
  }
  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const id of privateIds) {
    const now = outItems.find(s => s.id === id);
    if (!now || now.access !== 'private') throw new Error('Existing private flag lost on ' + id);
  }
  if (outItems.filter(s => s.note === 'Customers only').length < 90) throw new Error('Customer notes dropped');
  for (const prefix of ['shell:', 'plug:', 'ck:', 'roam:', 'zest:', 'instavolt:', 'ubitricity:', 'cps:', 'ezo:', 'esbecars:', 'esbenergy:']) {
    const beforeN = baseDoc.items.filter(s => String(s.id).startsWith(prefix)).length;
    const afterN = outItems.filter(s => String(s.id).startsWith(prefix)).length;
    if (beforeN !== afterN) throw new Error(prefix + ' count changed');
  }
  const keep = [
    ['instavolt:GBICPL1788424825315', /instavolt/i],
    ['ocm-134180', /ezo/i],
    ['fastned:hemel-hempstead', /fastned/i],
    ['ocm-193535', /instavolt/i],
    ['shell:417', /shell/i],
    ['chargepoint:GBCPIL6782025', /chargepoint/i],
    ['ubitricity:4376', /ubitricity/i],
  ];
  for (const [id, re] of keep) {
    const row = outItems.find(s => s.id === id);
    if (!row || !re.test(row.op || '')) throw new Error('Neighbour overwritten: ' + id + ' ' + (row && row.op));
  }
  const deal = outItems.find(s => /aberdeen motor company/i.test(s.n || ''));
  if (deal && deal.access === 'private') throw new Error('Aberdeen dealership is private');
  const depot = outItems.find(s => s.id === 'lidl:' + LIDL_DEPOT);
  if (!depot || depot.access !== 'private') throw new Error('Horfield depot missing or public');
  const feeds = Object.assign({}, baseDoc.feeds || {});
  for (const r of reports) feeds[r.key] = { label: r.operator, mode: 'file', raw: r.raw, added: r.added, matched: r.matched, enriched: r.enriched, skipped: r.skipped, privateMarked: r.privateMarked };
  const meta = {
    generated: new Date().toISOString(),
    source: withCredit(baseDoc.source),
    regions: baseDoc.regions || 'United Kingdom (GB)',
    count: outItems.length,
    feeds,
  };
  fs.writeFileSync(OUT_PATH, 'window.UK_CHARGERS=' + JSON.stringify(meta).slice(0, -1) + ',"items":[\n' + outItems.map(i => JSON.stringify(i)).join(',\n') + '\n]};\n');
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ before: beforeCount, after: outItems.length, netNew: outItems.length - beforeCount, feeds: reports, generated: meta.generated }, null, 2));
  console.log('Before', beforeCount, 'After', outItems.length);
}

main();
