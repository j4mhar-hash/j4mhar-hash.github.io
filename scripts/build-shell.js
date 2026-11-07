#!/usr/bin/env node
/**
 * Merge Shell Recharge UK hubs into data/uk-chargers.js.
 *
 * Eco-Movement PCPR OCPI 2.2.1, party GB/TNM, operator Shell Recharge.
 * This feed is Shell Recharge only. It is not the ubitricity lamp-post feed.
 * No token is written to the repo.
 *   SHELL_OCPI_FILE=/path/to/shell-ocpi.json node scripts/build-shell.js
 *   node scripts/build-shell.js /path/to/shell-ocpi.json
 * Also checks uploads/shell-ocpi.json and .cache/ocpi/shell.json.
 *
 * Power: max_electric_power (watts to kW) when present. Otherwise DC and
 * single-phase are V×A/1000, and three-phase is 230 V per phase × 3 × A.
 * A voltage above 300 V is line voltage (√3×V×A).
 *
 * Dedupe: Shell Recharge, Shell Recharge (UK), and rapid Shell Recharge
 * Solutions (UK) hubs within 75 m. Slow Shell Recharge Solutions rows and
 * ubitricity: lamp posts are not the same sites. Same postcode within 100 m
 * only when the existing operator is one of those Shell Recharge hubs or
 * blank. Taxi-only and staff bays stay separate from public bays.
 *
 * New ids: shell:<ocpi-id>. Operator shown: Shell Recharge.
 *
 * Usage: node scripts/build-shell.js [snapshot.json]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'uk-chargers.js');
const MANUAL_PATH = path.join(ROOT, 'data', 'manual-chargers.js');
const REPORT_PATH = path.join(ROOT, 'data', 'shell-merge-report.json');
const CACHE_DIR = path.join(ROOT, '.cache', 'ocpi');
const CREDIT = 'Shell Recharge open data (PCPR, via Eco-Movement)';
const OPERATOR = 'Shell Recharge';

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

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function normOp(s) {
  const t = normText(s);
  if (t === 'shellrecharge' || t === 'shellrechargeuk' || t === 'shellrechargesolutionsuk' || t === 'shellrechargear') return 'shellrecharge';
  return t;
}

function hasDc(s) {
  return (s.c || []).some(c => c === 'CCS' || c === 'CHA' || c === 'CCS1');
}

function isOnStreetShell(s) {
  if (String(s.id || '').startsWith('ubitricity:')) return true;
  if (s._op !== 'shellrecharge') return false;
  if (String(s.id || '').startsWith('shell:')) return false;
  if (hasDc(s)) return false;
  if (s.k != null && s.k > 22) return false;
  return true;
}

function isShellHub(s) {
  return s._op === 'shellrecharge' && !isOnStreetShell(s);
}

function isShellOrUnknown(s) {
  if (!s._op || s._op === 'unknown') return true;
  return isShellHub(s);
}

function isRestrictedName(name) {
  const n = String(name || '');
  if (/taxi only/i.test(n)) return true;
  if (/\bstaff\b/i.test(n)) return true;
  if (/\bprivate\b|\(PRIVATE\)|\brestricted\b/i.test(n)) return true;
  return false;
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
  if (feedItem.cap != null && (base.cap == null || base.cap === '' || +feedItem.cap > +base.cap)) {
    if (base.cap !== feedItem.cap) {
      base.cap = feedItem.cap;
      changed = true;
    }
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
    const itemPriv = item.access === 'private';
    const basePriv = b.access === 'private';
    if (itemPriv !== basePriv) continue;
    const sameOp = isShellHub(item) && isShellHub(b);
    const samePc = item._pc && b._pc && item._pc === b._pc;
    let ok = false;
    if (sameOp && dist <= MATCH_OP_M) ok = true;
    else if (samePc && dist <= MATCH_PC_M && isShellOrUnknown(b)) ok = true;
    if (!ok) continue;
    if (!best || dist < best.dist) best = { i, dist, sameOp, samePc };
  }
  return best;
}

function connKw(c) {
  const declared = +c.max_electric_power;
  if (isFinite(declared) && declared > 0) return declared >= 100 ? declared / 1000 : declared;
  const v = +(c.max_voltage ?? c.voltage);
  const a = +(c.max_amperage ?? c.amperage);
  if (!isFinite(v) || !isFinite(a) || v <= 0 || a <= 0) return null;
  const pt = String(c.power_type || '');
  if (pt === 'DC') return Math.round((v * a) / 100) / 10;
  if (pt === 'AC_3_PHASE' || v > 300) {
    const kw = v > 300 ? (Math.sqrt(3) * v * a) / 1000 : (v * 3 * a) / 1000;
    return Math.round(kw);
  }
  return Math.round((v * a) / 100) / 10;
}

function assertPowerRules() {
  const cases = [
    [{ max_electric_power: 22000, power_type: 'AC_3_PHASE', max_voltage: 400, max_amperage: 32 }, 22],
    [{ max_electric_power: 7400, power_type: 'AC_1_PHASE', max_voltage: 240, max_amperage: 32 }, 7.4],
    [{ max_electric_power: 40000, power_type: 'DC', max_voltage: 400, max_amperage: 63 }, 40],
    [{ power_type: 'AC_3_PHASE', max_voltage: 230, max_amperage: 32 }, 22],
    [{ power_type: 'AC_3_PHASE', max_voltage: 400, max_amperage: 32 }, 22],
    [{ power_type: 'AC_1_PHASE', max_voltage: 240, max_amperage: 32 }, 7.7],
    [{ power_type: 'DC', max_voltage: 400, max_amperage: 125 }, 50],
    [{ power_type: 'DC', voltage: 500, amperage: 120 }, 60],
    [{ power_type: 'DC', voltage: 1000, amperage: 160 }, 160],
    [{ power_type: 'AC_1_PHASE', voltage: 230, amperage: 31 }, 7.1],
  ];
  for (const [c, expected] of cases) {
    const got = connKw(c);
    if (Math.abs(got - expected) > 0.05) throw new Error('connKw ' + JSON.stringify(c) + ' → ' + got + ', expected ' + expected);
  }
  const wrong = (400 * 32 * 3) / 1000;
  if (Math.abs(connKw({ power_type: 'AC_3_PHASE', max_voltage: 400, max_amperage: 32 }) - wrong) < 1) {
    throw new Error('three-phase used 400×A×3');
  }
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

function isPrivateLocation(loc) {
  if (loc.publish === false) return true;
  const blob = [loc.name, loc.address, loc.access].filter(Boolean).join(' ');
  if (/\(PRIVATE\)|\bprivate\b|\brestricted\b/i.test(blob)) return true;
  return false;
}

function compactOcpi(loc) {
  if (!loc || isPrivateLocation(loc)) return null;
  const coords = loc.coordinates;
  if (!coords) return null;
  const lat = +coords.latitude;
  const lon = +coords.longitude;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (!isUkLocation(loc)) return null;
  const evses = (loc.evses || []).filter(e => String(e.status || '').toUpperCase() !== 'REMOVED');
  if ((loc.evses || []).length && !evses.length) return null;
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
  const name = (loc.name && String(loc.name).trim()) || null;
  const ad = [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', ') || null;
  const o = {
    id: 'shell:' + id,
    a: +lat.toFixed(5),
    o: +lon.toFixed(5),
    op: OPERATOR,
  };
  if (bestKw != null) o.k = Math.round(bestKw * 10) / 10;
  if (conns.size) o.c = [...conns];
  if (name) o.n = name;
  if (evses.length) o.cap = evses.length;
  if (ad) o.ad = ad;
  const pc = loc.postal_code ? normPostcode(loc.postal_code) : extractPostcode(ad);
  if (pc) o._pc = pc;
  o._op = 'shellrecharge';
  o._feed = 'shell';
  if (isRestrictedName(name)) o.access = 'private';
  return o;
}

function extractLocations(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.locations)) return json.locations;
  if (json && json.data && Array.isArray(json.data.locations)) return json.data.locations;
  throw new Error('Shell Recharge payload has no locations array');
}

function resolveFile() {
  const list = [];
  if (process.argv[2]) list.push(path.resolve(process.argv[2]));
  if (process.env.SHELL_OCPI_FILE) list.push(path.resolve(process.env.SHELL_OCPI_FILE));
  list.push(path.join(ROOT, 'uploads', 'shell-ocpi.json'));
  list.push(path.join(CACHE_DIR, 'shell.json'));
  for (const file of list) {
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

function withShellCredit(source) {
  let s = String(source || 'Open Charge Map (ocm-export)');
  const escaped = CREDIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(';\\s*' + escaped, 'g'), '');
  const needle = 'InstaVolt open data (OCPI)';
  const at = s.indexOf(needle);
  if (at >= 0) return s.slice(0, at + needle.length) + '; ' + CREDIT + s.slice(at + needle.length);
  return s.replace(/;\s*$/, '') + '; ' + CREDIT;
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
  const file = resolveFile();
  if (!file) {
    console.error('No snapshot. Set SHELL_OCPI_FILE or pass a JSON path.');
    process.exit(1);
  }
  console.log('Reading Shell Recharge snapshot', file);
  const locations = extractLocations(JSON.parse(fs.readFileSync(file, 'utf8')));

  let added = 0, matched = 0, enriched = 0, skipped = 0, nonUk = 0, privateExcluded = 0;
  const sampleAdds = [];
  const sampleEnriched = [];
  let matchedOther = 0;

  for (const loc of locations) {
    if (isPrivateLocation(loc)) {
      privateExcluded++;
      skipped++;
      continue;
    }
    if (loc && loc.coordinates && !isUkLocation(loc)) {
      nonUk++;
      continue;
    }
    const item = compactOcpi(loc);
    if (!item) {
      skipped++;
      continue;
    }
    item._pc = item._pc || extractPostcode(item.ad);
    const match = findMatch(item, baseItems, grid);
    if (match) {
      matched++;
      const base = baseItems[match.i];
      if (!(isShellHub(base) || !base._op || base._op === 'unknown')) matchedOther++;
      if (enrich(base, item)) {
        enriched++;
        if (sampleEnriched.length < 8) {
          sampleEnriched.push({ id: base.id, n: base.n, op: base.op, k: base.k, c: base.c, cap: base.cap, distM: Math.round(match.dist) });
        }
      }
    } else {
      byId.set(item.id, item);
      baseItems.push(item);
      const k = cellKey(item.a, item.o);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(baseItems.length - 1);
      added++;
      if (sampleAdds.length < 8) {
        sampleAdds.push({ id: item.id, n: item.n, op: item.op, ad: item.ad, k: item.k, c: item.c, cap: item.cap, a: item.a, o: item.o });
      }
    }
  }
  if (matchedOther) throw new Error('Shell postcode rule matched ' + matchedOther + ' other-operator sites');

  const outItems = [...byId.values()].map(stripInternal);
  outItems.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const notes = outItems.filter(s => s.note === 'Customers only').length;
  if (notes < 90) throw new Error('GeniePoint customer notes were dropped (' + notes + ')');
  const addedItems = outItems.filter(s => String(s.id).startsWith('shell:'));
  if (addedItems.some(s => !isFinite(s.a))) throw new Error('A Shell coordinate was not parsed to a number');
  if (addedItems.some(s => isRestrictedName(s.n) && s.access !== 'private')) throw new Error('A staff or taxi Shell site was not marked private');
  const keptPrivate = outItems.filter(s => String(s.id).startsWith('fuuse:') && /taxi only/i.test(s.n || ''));
  if (keptPrivate.some(s => s.access !== 'private')) throw new Error('An existing taxi site lost its private flag');

  const feeds = Object.assign({}, baseDoc.feeds || {}, {
    shell: {
      label: 'Shell Recharge',
      mode: 'file',
      raw: locations.length,
      added,
      matched,
      enriched,
      skipped,
      nonUk,
      privateExcluded,
    },
  });
  const meta = {
    generated: new Date().toISOString(),
    source: withShellCredit(baseDoc.source),
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
    shellRaw: locations.length,
    privateMarked: outItems.filter(s => String(s.id).startsWith('shell:') && s.access === 'private').length,
    added,
    matched,
    enriched,
    skipped,
    nonUk,
    privateExcluded,
    sampleAdds,
    sampleEnriched,
    generated: meta.generated,
    note: 'Shell Recharge UK hubs (party GB/TNM) via Eco-Movement PCPR OCPI 2.2.1, fetched 2026-11-07. This is not the ubitricity lamp-post feed. Slow Shell Recharge Solutions rows and ubitricity: ids are not matched. Published max_electric_power is kept. Same postcode within 100 m matches only a Shell Recharge hub or a blank operator. The raw snapshot is not stored in the repo.',
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('Before:', beforeCount);
  console.log('After:', outItems.length);
  console.log('Added:', added, 'matched:', matched, 'enriched:', enriched, 'skipped:', skipped, 'private:', privateExcluded);
  console.log('Wrote', OUT_PATH);
  console.log('Wrote', REPORT_PATH);
}

main();
