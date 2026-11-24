#!/usr/bin/env node
/**
 * Merge EZO, ESB ecars (Northern Ireland) and ESB Energy (Great Britain).
 * No token is read or written.
 *   node scripts/build-esb-ezo.js ezo.json ezo-tariffs.json ecars.json ecars-tariffs.json energy.json energy-tariffs.json
 *
 * EZO prices exclude VAT. ESB prices already include VAT. EZO may take over
 * a ChargePlace Scotland pin. A different operator is left alone unless it
 * is the same EZO site.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'esb-ezo-merge-report.json');
const CREDIT = 'EZO, ESB ecars and ESB Energy open data via Eco-Movement PCPR';

const EZO_PRIVATE = new Set([
  '832721', '3893663', '3284721', '843566', '3196949', '3284709', '3369465',
  '3290275', '3284719', '3284707', '3040643', '3927779', '3369510',
]);

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

function tokens(s) {
  const stop = new Set(['street', 'road', 'lane', 'park', 'car', 'north', 'south', 'east', 'west', 'hotel', 'close', 'drive', 'avenue', 'energy', 'ecars']);
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !stop.has(w));
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

function isUnknown(op) {
  const t = normOp(op);
  return !t || t === 'none' || t === 'unknown' || t === 'unknownoperator';
}

function allowed(feed, op) {
  const t = normOp(op);
  if (feed === 'ezo') return t.includes('ezo') || t.includes('chargeplace') || isUnknown(op);
  if (feed === 'esbecars') return t.includes('esbecars');
  if (feed === 'esbenergy') return t.includes('esbenergy') || isUnknown(op);
  return false;
}

function isPrivate(feed, loc) {
  const id = String(loc.id);
  if (feed === 'ezo' && EZO_PRIVATE.has(id)) return true;
  if (feed === 'esbenergy' && (id === '1652' || /\bolive school\b/i.test(loc.name || ''))) return true;
  const name = String(loc.name || '');
  if (/stafford/i.test(name)) return false;
  if (/\b(depot|academy|ysgol|comprehensive)\b/i.test(name)) return true;
  const withoutStreet = name.replace(/\bschool\s+(rd|road|st|street|lane|close|avenue|drive)\b/gi, ' ');
  if (/\b(school|primary)\b/i.test(withoutStreet)) return true;
  const dirs = JSON.stringify(loc.directions || '');
  if (/workplace|employees only|staff charging|private business/i.test(dirs)) return true;
  return false;
}

function connKw(c) {
  const declared = +c.max_electric_power;
  if (isFinite(declared) && declared > 0) return declared >= 100 ? declared / 1000 : declared;
  const v = +(c.max_voltage ?? c.voltage);
  const a = +(c.max_amperage ?? c.amperage);
  if (!(v > 0 && a > 0)) return null;
  const pt = String(c.power_type || '');
  const kw = pt === 'AC_3_PHASE' ? (v * a * 3) / 1000 : (v * a) / 1000;
  return pt === 'AC_3_PHASE' ? Math.round(kw) : Math.round(kw * 10) / 10;
}

function penceText(pence) {
  const nums = [...new Set(pence)].sort((a, b) => a - b);
  if (!nums.length) return null;
  const one = n => Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  if (nums.length === 1) return one(nums[0]) + 'p/kWh';
  return one(nums[0]) + '–' + one(nums[nums.length - 1]) + 'p/kWh';
}

function tariffInfo(tariffs, addVat) {
  const map = new Map();
  for (const t of tariffs) {
    const energy = [];
    let flat = null;
    let overstay = null;
    for (const el of t.elements || []) {
      const minDur = el.restrictions && +el.restrictions.min_duration > 0;
      for (const p of el.price_components || []) {
        if (!(+p.price > 0)) continue;
        const gross = addVat ? +p.price * 1.2 : +p.price;
        if (p.type === 'ENERGY') energy.push(Math.round(gross * 1000) / 10);
        if (p.type === 'FLAT') flat = Math.round(gross * 100);
        if (p.type === 'TIME' && minDur) {
          const perMin = (gross / 60) * 100;
          overstay = Math.round(perMin);
        }
      }
    }
    const bits = [];
    const energyText = penceText(energy);
    if (energyText) bits.push(energyText);
    if (flat) bits.push(flat + 'p session');
    if (overstay) bits.push('overstay ' + overstay + 'p/min');
    if (t.id != null && bits.length) map.set(String(t.id), bits.join(', '));
  }
  return map;
}

function feeText(loc, tariffs) {
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
  const pc = String(loc.postal_code || '').trim();
  let name = String(loc.name || '').trim();
  name = name.replace(/^(EZO|ESB ecars|ESB Energy)\s+/i, '');
  const o = { id: feed.prefix + id, a: +lat.toFixed(5), o: +lon.toFixed(5), op: feed.operator, _feed: feed.key };
  if (bestKw != null) o.k = bestKw;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  o.cap = evses.length;
  const ad = [loc.address, loc.city, pc].filter(Boolean).join(', ');
  if (ad) o.ad = ad;
  const fee = feeText(loc, feed.tariffs);
  if (fee) o.fee = fee;
  if (isPrivate(feed.key, loc)) o.access = 'private';
  return o;
}

function findMatch(item, baseItems, grid) {
  let best = null;
  for (const i of neighbours(grid, item.a, item.o)) {
    const b = baseItems[i];
    if (String(b.id).startsWith(item.id.split(':')[0] + ':')) continue;
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metres(item.a, item.o, b.a, b.o);
    if (dist > 150) continue;
    const named = samePlace(item.n, b.n);
    if (!allowed(item._feed, b.op)) continue;
    if (dist <= 75 || named) {
      if (!best || dist < best.dist) best = { i, dist };
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
  if (s.includes('EZO, ESB ecars and ESB Energy')) return s;
  const needle = 'ROAM Charging open data';
  const at = s.indexOf(needle);
  if (at >= 0) {
    const end = s.indexOf(')', at);
    const cut = end >= 0 ? end + 1 : at + needle.length;
    return s.slice(0, cut) + '; ' + CREDIT + s.slice(cut);
  }
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length < 6) {
    console.error('Pass ezo locations, ezo tariffs, ecars locations, ecars tariffs, energy locations, energy tariffs.');
    process.exit(1);
  }
  if (isPrivate('ezo', { id: 'x', name: 'Hanover Street', address: '8 School St Car Park' })) throw new Error('School St marked private');
  if (isPrivate('ezo', { id: '3369477', name: 'Macduff Industrial Estate, Aberdeenshire Council', address: 'Depot Car Park' })) throw new Error('Macduff depot car park marked private');
  if (!isPrivate('ezo', { id: '843566', name: 'Lidl RDC Nutts Corner', address: '' })) throw new Error('Lidl not private');
  if (!isPrivate('esbenergy', { id: '1652', name: 'Olive School Car Park', address: '' })) throw new Error('Olive School not private');
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
    { key: 'ezo', prefix: 'ezo:', operator: 'EZO', addVat: true, loc: files[0], tar: files[1] },
    { key: 'esbecars', prefix: 'esbecars:', operator: 'ESB ecars', addVat: false, loc: files[2], tar: files[3] },
    { key: 'esbenergy', prefix: 'esbenergy:', operator: 'ESB Energy', addVat: false, loc: files[4], tar: files[5] },
  ];
  const reports = [];
  for (const spec of specs) {
    spec.tariffs = tariffInfo(loadTariffs(spec.tar), spec.addVat);
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
  for (const prefix of ['shell:', 'plug:', 'ck:', 'roam:', 'zest:', 'instavolt:', 'ubitricity:', 'cps:', 'pogo:', 'mer:']) {
    const beforeN = baseDoc.items.filter(s => String(s.id).startsWith(prefix)).length;
    const afterN = outItems.filter(s => String(s.id).startsWith(prefix)).length;
    if (beforeN !== afterN) throw new Error(prefix + ' count changed');
  }
  const fast = outItems.find(s => s.id === 'ocm-309137');
  if (!fast || /esb/i.test(fast.op || '')) throw new Error('Fastned at The Junction was overwritten');
  const tesla = outItems.find(s => s.id === 'ocm-168593');
  if (!tesla || tesla.op !== 'Tesla (including non-tesla)') throw new Error('Inverness Tesla was overwritten');
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
