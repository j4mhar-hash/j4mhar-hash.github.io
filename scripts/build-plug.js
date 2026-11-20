#!/usr/bin/env node
/**
 * Merge PLUG Charging (Wales) OCPI 2.2.1 into data/uk-chargers.js.
 * No token is read or written.
 *   node scripts/build-plug.js /path/to/plug-locations.json /path/to/plug-tariffs.json
 *
 * Matches existing Plug Charging records within 75 m, or up to 150 m when
 * the place name is the same. Plug N Go and PlugSurfing are not matched.
 * Prices exclude VAT; stored prices include the 20% VAT on each component.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'plug-merge-report.json');
const CREDIT = 'Contains PLUG Charging data licensed under the Open Government Licence v3.0';
const OPERATOR = 'PLUG Charging';

const STD = {
  IEC_62196_T2: 'T2',
  IEC_62196_T2_CABLE: 'T2',
  IEC_62196_T2_COMBO: 'CCS',
  IEC_62196_T1: 'T1',
  IEC_62196_T1_COMBO: 'CCS1',
  CHADEMO: 'CHA',
  DOMESTIC_G: '3PIN',
};

function loadWindowJson(filePath, varName) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp('(?:window\\.)?' + varName + '\\s*=\\s*([\\s\\S]*?);\\s*$');
  const m = raw.match(re);
  let body = m ? m[1] : raw.slice(raw.indexOf('=') + 1).trim().replace(/;$/, '');
  try {
    return JSON.parse(body);
  } catch {
    return Function('"use strict"; return (' + body + ')')();
  }
}

function normOp(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isPlug(op) {
  const t = normOp(op);
  return t === 'plugcharging' || t.includes('plugcharging');
}

function tokens(s) {
  const stop = new Set(['street', 'road', 'lane', 'park', 'car', 'north', 'south', 'east', 'west', 'charge', 'charging', 'point', 'station', 'centre', 'center', 'community', 'hotel', 'services', 'service', 'business', 'council', 'county', 'gardens', 'avenue', 'close', 'drive']);
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
  return evses.length > 0 && evses.every(restrictedEvse);
}

function connKw(c) {
  const declared = +c.max_electric_power;
  if (isFinite(declared) && declared > 0) return declared >= 100 ? declared / 1000 : declared;
  const v = +(c.max_voltage ?? c.voltage);
  const a = +(c.max_amperage ?? c.amperage);
  if (!(v > 0 && a > 0)) return null;
  const pt = String(c.power_type || '');
  if (pt === 'DC') return Math.round((v * a) / 100) / 10;
  if (pt === 'AC_3_PHASE' || v > 300) return Math.round(v > 300 ? (Math.sqrt(3) * v * a) / 1000 : (v * 3 * a) / 1000);
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
    if (t.id != null && price != null) map.set(String(t.id), { price, vat });
  }
  return map;
}

function money(info) {
  if (!info) return null;
  const gross = info.vat != null && isFinite(info.vat) ? info.price * (1 + info.vat / 100) : info.price;
  const label = '£' + gross.toFixed(2) + '/kWh';
  return info.vat != null ? label + ' incl. VAT' : label;
}

function feeText(loc, tariffs) {
  const counts = new Map();
  for (const e of loc.evses || []) {
    if (String(e.status || '').toUpperCase() === 'REMOVED') continue;
    for (const c of e.connectors || []) {
      const label = money(tariffs.get(String((c.tariff_ids || [])[0])));
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0][0];
  return parts.map(([label, n]) => label.replace(' incl. VAT', '') + ' (' + n + (n === 1 ? ' bay' : ' bays') + ')').join(', ') + ', incl. VAT';
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
  const o = {
    id: 'plug:' + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: OPERATOR,
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (loc.name) o.n = String(loc.name).trim();
  o.cap = evses.length;
  const ad = [loc.address, loc.city, pc].filter(Boolean).join(', ');
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
    if (!isPlug(b.op)) continue;
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metres(item.a, item.o, b.a, b.o);
    if (dist <= 75 || (dist <= 150 && samePlace(item.n, b.n))) {
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
  let s = String(source || '');
  if (s.includes('PLUG Charging data licensed under the Open Government Licence')) return s;
  const needle = 'Public Charge Point Regulations 2023';
  const at = s.lastIndexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function main() {
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
  let added = 0, matched = 0, enriched = 0, skipped = 0, represented = 0, privateMarked = 0;
  const claimed = new Set();
  const prepared = [];
  for (const loc of locations) {
    const item = compact(loc, tariffs);
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
  if (baseDoc.items.filter(s => s.note === 'Customers only').length !== outItems.filter(s => s.note === 'Customers only').length) {
    throw new Error('Customers only notes changed');
  }
  for (const prefix of ['shell:', 'zest:', 'instavolt:', 'ubitricity:', 'ionity:', 'evolt:', 'gridserve:', 'cps:', 'pogo:', 'mer:', 'arnoldclark:', 'gozero:', 'evdot:']) {
    const beforeN = baseDoc.items.filter(s => String(s.id).startsWith(prefix)).length;
    const afterN = outItems.filter(s => String(s.id).startsWith(prefix)).length;
    if (beforeN !== afterN) throw new Error(prefix + ' count changed');
  }
  const plugNGo = outItems.filter(s => /plug n go|plugsurfing/i.test(s.op || ''));
  const beforeNGo = baseDoc.items.filter(s => /plug n go|plugsurfing/i.test(s.op || ''));
  if (plugNGo.length !== beforeNGo.length) throw new Error('Plug N Go or PlugSurfing count changed');
  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    plug: { label: 'PLUG Charging', mode: 'file', raw: locations.length, added, matched, enriched, skipped, privateMarked },
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
    before: beforeCount,
    after: outItems.length,
    netNew: outItems.length - beforeCount,
    raw: locations.length,
    added, matched, enriched, represented, skipped, privateMarked,
    plugPrefix: outItems.filter(s => String(s.id).startsWith('plug:')).length,
    generated: meta.generated,
    note: 'PLUG Charging Wales OCPI 2.2.1, party GB/PLG. Prices exclude VAT and are stored including 20% VAT. Open Government Licence v3.0. No token is stored.',
  }, null, 2));
  console.log({ before: beforeCount, after: outItems.length, added, matched, enriched, represented, skipped, privateMarked });
}

main();
