#!/usr/bin/env node
/**
 * Merge Evolt Network (SWARCO Smart Charging, party GB/SSM) into data/uk-chargers.js.
 *
 * Public feed, no token:
 *   node scripts/build-evolt.js /path/to/evolt-locations.json /path/to/evolt-tariffs.json
 *
 * Match existing Evolt / Swarco records within 75 m, or the same postcode within
 * 100 m when the operator is Evolt or unknown. A different operator matches only
 * when the place name is the same and the pin is within 35 m, or within 35 m for
 * Chargeplace Scotland / Charge Your Car when a specific name token is shared.
 * New ids: evolt:<ocpi-id>. Operator shown: Evolt.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'evolt-merge-report.json');
const CREDIT = 'Evolt Network open data (SWARCO Smart Charging)';
const OPERATOR = 'Evolt';
const MATCH_OP_M = 75;
const MATCH_PC_M = 100;
const MATCH_NAME_M = 35;

const STOP = new Set(['car', 'park', 'street', 'road', 'lane', 'the', 'and', 'hub', 'centre', 'center', 'station', 'north', 'south', 'east', 'west', 'charging', 'charger', 'carpark', 'avenue', 'close', 'drive', 'court', 'place', 'house', 'building', 'visitor', 'visitors', 'national', 'council', 'county', 'office', 'offices', 'primary', 'school', 'rank', 'only', 'staff', 'taxi', 'gate', 'multi', 'storey', 'community', 'housing', 'hotel', 'college', 'terminal', 'arena', 'hydro', 'stadium', 'square', 'association', 'services', 'service', 'laboratory', 'limited', 'ltd']);
const GENERIC = new Set(['university', 'scotland', 'william', 'dumfries', 'nairn', 'solihull', 'launceston', 'lanarkshire', 'aberdeen', 'glasgow', 'edinburgh', 'dundee', 'london', 'cardiff', 'belfast', 'manchester', 'birmingham', 'leeds', 'bristol', 'liverpool', 'cambridge', 'oxford', 'norwich', 'swindon', 'reading', 'coventry', 'leicester', 'nottingham', 'plymouth', 'southampton', 'portsmouth', 'brighton', 'york', 'exeter', 'chester', 'preston', 'blackpool', 'sunderland', 'newcastle', 'inverness']);

const STD = {
  IEC_62196_T2: 'T2',
  IEC_62196_T2_CABLE: 'T2',
  IEC_62196_T2_COMBO: 'CCS',
  IEC_62196_T1: 'T1',
  IEC_62196_T1_COMBO: 'CCS1',
  CHADEMO: 'CHA',
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
  const t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (t.includes('evolt') || t.includes('swarco')) return 'evolt';
  if (!t || t.includes('unknown')) return 'unknown';
  if (t.includes('chargeplacescotland')) return 'chargeplacescotland';
  if (t.includes('chargeyourcar')) return 'chargeyourcar';
  return t;
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return normName(s).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
}

function sharedWord(a, b) {
  const tb = new Set(tokens(b));
  return tokens(a).filter(w => tb.has(w) && w.length >= 6 && !GENERIC.has(w));
}

function containedName(a, b) {
  const ca = normName(a).replace(/ /g, '');
  const cb = normName(b).replace(/ /g, '');
  const short = ca.length <= cb.length ? ca : cb;
  const long = ca.length <= cb.length ? cb : ca;
  return short.length >= 12 && long.includes(short);
}

function samePlaceName(a, b) {
  return containedName(a, b) || sharedWord(a, b).length > 0;
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

function postcodeOf(s) {
  const m = String(s || '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return m ? m[1].replace(/\s/g, '') : '';
}

function isRestricted(name, address) {
  const blob = String(name || '') + ' ' + String(address || '');
  if (/stafford/i.test(blob)) return false;
  return /\b(taxi|staff|private|restricted)\b/i.test(blob);
}

function prepareBaseItem(s) {
  const copy = { ...s };
  copy._op = normOp(s.op || '');
  copy._pc = postcodeOf(s.ad);
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

function feeText(loc, tariffById) {
  const counts = new Map();
  for (const e of loc.evses || []) {
    for (const c of e.connectors || []) {
      const id = (c.tariff_ids || [])[0];
      const t = id && tariffById.get(id);
      if (!t) continue;
      counts.set(t.label, (counts.get(t.label) || 0) + 1);
    }
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0][0];
  return parts.map(([label, n]) => label.replace(' incl. VAT', '') + ' (' + n + (n === 1 ? ' bay' : ' bays') + ')').join(', ') + ', incl. VAT';
}

function tariffLabel(tariff) {
  let price = null;
  let vat = null;
  for (const el of tariff.elements || []) {
    for (const p of el.price_components || []) {
      if (p.type === 'ENERGY' && p.price > 0) {
        price = +p.price;
        vat = p.vat != null ? +p.vat : 0;
      }
    }
  }
  if (price == null) return null;
  const gross = vat ? price * (1 + vat / 100) : price;
  return '£' + gross.toFixed(2) + '/kWh incl. VAT';
}

function loadTariffs(file) {
  const map = new Map();
  if (!file || !fs.existsSync(file)) return map;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(json) ? json : json.data || json.tariffs || [];
  for (const t of list) {
    const label = tariffLabel(t);
    if (t.id && label) map.set(t.id, { label });
  }
  return map;
}

function compactOcpi(loc, tariffById) {
  if (!loc || loc.publish === false) return null;
  const country = String(loc.country || loc.country_code || '').toUpperCase();
  if (!['GBR', 'GB', 'UK'].includes(country)) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  let lat = +coords.latitude;
  let lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  // Glasgow G2 was published at +4.26, east of the UK. The postcode is west of Greenwich.
  if (lon > 2 && lon < 8) lon = -lon;
  const id = loc.id != null ? String(loc.id) : null;
  if (!id) return null;
  const evses = loc.evses || [];
  if (!evses.length) return null;
  const conns = new Set();
  let bestKw = null;
  for (const e of evses) {
    for (const c of e.connectors || []) {
      const code = STD[c.standard];
      if (code) conns.add(code);
      const p = +c.max_electric_power;
      if (p > 0) bestKw = Math.max(bestKw || 0, p >= 100 ? p / 1000 : p);
    }
  }
  const pc = String(loc.postal_code || '').trim();
  const ad = [loc.address, loc.city, pc].filter(Boolean).join(', ') || null;
  const name = (loc.name && String(loc.name).trim()) || null;
  const o = {
    id: 'evolt:' + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: OPERATOR,
    _op: 'evolt',
    _pc: pc.replace(/\s/g, '').toUpperCase(),
    _feedId: id,
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  if (evses.length) o.cap = evses.length;
  if (ad) o.ad = ad;
  const fee = feeText(loc, tariffById);
  if (fee) o.fee = fee;
  if (isRestricted(name, loc.address)) o.access = 'private';
  return o;
}

function findMatch(item, baseItems, grid) {
  const idxs = neighbours(grid, item.a, item.o);
  let best = null;
  for (const i of idxs) {
    const b = baseItems[i];
    if (item.access !== 'private' && b.access === 'private') continue;
    const dist = metresBetween(item.a, item.o, b.a, b.o);
    if (dist > MATCH_PC_M) continue;
    const bop = b._op;
    let kind = null;
    if (bop === 'evolt' && dist <= MATCH_OP_M) kind = 'evolt';
    else if (item._pc && b._pc === item._pc && dist <= MATCH_PC_M && (bop === 'evolt' || bop === 'unknown')) kind = 'pc';
    else if (dist <= 20 && containedName(item.n, b.n)) kind = 'name';
    else if (dist <= MATCH_NAME_M && sharedWord(item.n, b.n).length && (bop === 'chargeplacescotland' || bop === 'chargeyourcar' || bop === 'unknown')) kind = 'name';
    if (!kind) continue;
    if (!best || dist < best.dist) best = { i, dist, kind };
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
    base._op = 'evolt';
    changed = true;
  }
  if (feed.access === 'private' && base.access !== 'private') {
    base.access = 'private';
    changed = true;
  }
  return changed;
}

function withCredit(source) {
  let s = String(source || 'Open Charge Map (ocm-export)');
  const escaped = CREDIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(';\\s*' + escaped, 'g'), '');
  const needle = 'IONITY (via Eco-Movement, PCPR open data)';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
}

function main() {
  const file = process.argv[2];
  const tariffFile = process.argv[3];
  if (!file) {
    console.error('Pass the Evolt locations JSON path.');
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
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const locations = Array.isArray(json) ? json : json.data || json.locations;
  if (!Array.isArray(locations)) throw new Error('Evolt payload has no locations array');
  const tariffById = loadTariffs(tariffFile);

  let added = 0, matched = 0, enriched = 0, skipped = 0, nonUk = 0, represented = 0, privateMarked = 0;
  const sampleAdds = [];
  const sampleEnriched = [];
  const claimed = new Map();

  const prepared = [];
  for (const loc of locations) {
    const country = String(loc.country || loc.country_code || '').toUpperCase();
    if (country && !['GBR', 'GB', 'UK'].includes(country)) {
      nonUk++;
      continue;
    }
    const item = compactOcpi(loc, tariffById);
    if (!item) {
      skipped++;
      continue;
    }
    const match = findMatch(item, baseItems, grid);
    prepared.push({ item, match });
  }
  prepared.sort((a, b) => {
    const da = a.match ? a.match.dist : 1e9;
    const db = b.match ? b.match.dist : 1e9;
    return da - db;
  });

  for (const { item, match } of prepared) {
    if (match) {
      const base = baseItems[match.i];
      if (claimed.has(base.id)) {
        const words = sharedWord(item.n, base.n);
        const compactSame = samePlaceName(item.n, base.n) && match.dist <= 40;
        if (words.length || compactSame) {
          matched++;
          represented++;
          continue;
        }
      }
      if (claimed.has(base.id)) {
        byId.set(item.id, item);
        added++;
        if (item.access === 'private') privateMarked++;
        continue;
      }
      claimed.set(base.id, item.id);
      matched++;
      if (applyOfficial(base, item)) {
        enriched++;
        if (base.access === 'private') privateMarked++;
        if (sampleEnriched.length < 8) {
          sampleEnriched.push({ id: base.id, n: base.n, op: base.op, k: base.k, c: base.c, cap: base.cap, fee: base.fee, access: base.access, distM: Math.round(match.dist), kind: match.kind });
        }
      }
    } else {
      byId.set(item.id, item);
      added++;
      if (item.access === 'private') privateMarked++;
      if (sampleAdds.length < 8) {
        sampleAdds.push({ id: item.id, n: item.n, op: item.op, ad: item.ad, k: item.k, c: item.c, cap: item.cap, fee: item.fee, access: item.access, a: item.a, o: item.o });
      }
    }
  }

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const prefixCount = (rows, prefix) => rows.filter(s => String(s.id).startsWith(prefix)).length;
  for (const prefix of ['shell:', 'zest:', 'instavolt:', 'ubitricity:', 'chargepoint:', 'rawcharging:', 'fuuse:', 'bppulse:', 'ionity:']) {
    const beforeN = prefixCount(baseDoc.items, prefix);
    const afterN = prefixCount(outItems, prefix);
    if (afterN !== beforeN) throw new Error(prefix + ' count changed ' + beforeN + ' -> ' + afterN);
  }
  for (const s of baseDoc.items) {
    if (s.access !== 'private') continue;
    const now = outItems.find(x => x.id === s.id);
    if (!now || now.access !== 'private') throw new Error('Existing private flag lost on ' + s.id);
  }
  const notesBefore = baseDoc.items.filter(s => s.note === 'Customers only').length;
  const notesAfter = outItems.filter(s => s.note === 'Customers only').length;
  if (notesAfter !== notesBefore) throw new Error('Customers only notes changed ' + notesBefore + ' -> ' + notesAfter);

  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    evolt: { label: 'Evolt', mode: 'file', raw: locations.length, added, matched, enriched, skipped, nonUk, represented, privateMarked },
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
    evoltRaw: locations.length,
    added,
    matched,
    enriched,
    represented,
    skipped,
    nonUk,
    privateMarked,
    evoltPrefix: outItems.filter(s => String(s.id).startsWith('evolt:')).length,
    sampleAdds,
    sampleEnriched,
    generated: meta.generated,
    note: 'Evolt Network open data from SWARCO Smart Charging (party GB/SSM), public locations feed. One Australian location is excluded. Glasgow G2 longitude +4.26 is stored as -4.26. Evolt or Swarco within 75 m, or the same postcode within 100 m when the operator is Evolt or unknown, is updated in place. A different operator is updated only when the place name matches within 35 m. Taxi, staff and restricted sites are access private. Tariffs are the VAT-inclusive energy price on fee. The raw snapshot is not stored.',
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('Before:', beforeCount);
  console.log('After:', outItems.length);
  console.log('Added:', added, 'matched:', matched, 'enriched:', enriched, 'represented:', represented, 'skipped:', skipped, 'nonUk:', nonUk, 'privateMarked:', privateMarked);
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', REPORT_PATH);
}

main();
