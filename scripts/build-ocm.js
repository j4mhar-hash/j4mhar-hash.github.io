#!/usr/bin/env node
// Builds data/uk-chargers.js from the Open Charge Map public export (GB POIs).
// No API key required — uses the GitHub snapshot at https://github.com/openchargemap/ocm-export
//
// Usage:
//   1. Sparse-checkout GB + referencedata (once):
//        mkdir -p /workspace/ocm-export && cd /workspace/ocm-export
//        git init && git remote add origin https://github.com/openchargemap/ocm-export.git
//        git config core.sparseCheckout true
//        printf 'data/GB/\ndata/referencedata.json\n' > .git/info/sparse-checkout
//        git fetch --depth 1 origin main && git checkout main
//   2. node scripts/build-ocm.js [/path/to/ocm-export]
//
// Default export path: /workspace/ocm-export
const fs = require('fs');
const path = require('path');

const EXPORT_ROOT = process.argv[2] || '/workspace/ocm-export';
const GB_DIR = path.join(EXPORT_ROOT, 'data', 'GB');
const REF_PATH = path.join(EXPORT_ROOT, 'data', 'referencedata.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'uk-chargers.js');

// OCM ConnectionTypeID → app connector codes (must match index.html CONNS / OSMCONN)
const CONN = {
  1: 'T1',      // Type 1 (J1772)
  25: 'T2',     // Type 2 socket
  1036: 'T2',   // Type 2 tethered
  33: 'CCS',    // CCS Type 2 (Combo)
  32: 'CCS1',   // CCS Type 1
  2: 'CHA',     // CHAdeMO
  3: '3PIN',    // BS1363
  27: 'TSLA',   // NACS / Tesla Supercharger
  30: 'TSLA',   // Tesla Model S/X
  8: 'TSLA',    // Tesla Roadster (legacy)
  28: 'SCH',    // Schuko
  26: 'T3',     // SCAME Type 3C
};

// UsageTypeID: keep public / unknown; drop private
const PRIVATE_USAGE = new Set([2, 3, 6]);
// StatusTypeID: drop not-operational / removed / planned
const BAD_STATUS = new Set([100, 150, 200, 210]);

function loadOperators(ref) {
  const map = new Map();
  for (const o of ref.Operators || []) {
    if (o && o.ID != null && o.Title) map.set(o.ID, o.Title);
  }
  return map;
}

function maxPower(connections) {
  let best = null;
  for (const c of connections || []) {
    const kw = c.PowerKW;
    if (kw == null || !isFinite(kw) || kw <= 0) continue;
    best = Math.max(best || 0, kw);
  }
  return best;
}

function connectorCodes(connections) {
  const set = new Set();
  for (const c of connections || []) {
    const code = CONN[c.ConnectionTypeID];
    if (code) set.add(code);
  }
  return set.size ? [...set] : null;
}

function address(ai) {
  if (!ai) return null;
  const parts = [ai.AddressLine1, ai.Town, ai.Postcode]
    .map(s => (s == null ? '' : String(s).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function compact(poi, operators) {
  const ai = poi.AddressInfo || {};
  const lat = ai.Latitude, lon = ai.Longitude;
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null;
  if (PRIVATE_USAGE.has(poi.UsageTypeID)) return null;
  if (BAD_STATUS.has(poi.StatusTypeID)) return null;

  const o = {
    id: 'ocm-' + poi.ID,
    a: +(+lat).toFixed(5),
    o: +(+lon).toFixed(5),
  };

  const kw = maxPower(poi.Connections);
  if (kw != null) o.k = Math.round(kw * 10) / 10;

  const c = connectorCodes(poi.Connections);
  if (c) o.c = c;

  const title = ai.Title && String(ai.Title).trim();
  if (title) o.n = title;

  const opTitle =
    (poi.OperatorInfo && poi.OperatorInfo.Title) ||
    (poi.OperatorID != null ? operators.get(poi.OperatorID) : null);
  if (opTitle && opTitle !== title) o.op = opTitle;

  if (poi.NumberOfPoints != null && poi.NumberOfPoints !== '') o.cap = poi.NumberOfPoints;

  const ad = address(ai);
  if (ad) o.ad = ad;

  return o;
}

function main() {
  if (!fs.existsSync(GB_DIR)) {
    console.error('Missing GB POI directory:', GB_DIR);
    console.error('Sparse-checkout openchargemap/ocm-export data/GB/ first (see script header).');
    process.exit(1);
  }
  if (!fs.existsSync(REF_PATH)) {
    console.error('Missing referencedata.json:', REF_PATH);
    process.exit(1);
  }

  const ref = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
  const operators = loadOperators(ref);
  const files = fs.readdirSync(GB_DIR).filter(f => f.endsWith('.json'));
  console.log('Reading', files.length, 'GB POI files from', GB_DIR);

  const items = [];
  let skipped = 0, parseErr = 0;
  for (let i = 0; i < files.length; i++) {
    let poi;
    try {
      poi = JSON.parse(fs.readFileSync(path.join(GB_DIR, files[i]), 'utf8'));
    } catch (e) {
      parseErr++;
      continue;
    }
    const row = compact(poi, operators);
    if (row) items.push(row);
    else skipped++;
    if ((i + 1) % 5000 === 0) console.log('  …', i + 1, '/', files.length);
  }

  const out = {
    generated: new Date().toISOString(),
    source: 'Open Charge Map contributors and data providers (CC BY 4.0 and other licences), via ocm-export',
    regions: 'United Kingdom (GB)',
    count: items.length,
    items,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, 'window.UK_CHARGERS=' + JSON.stringify(out) + ';\n');
  const size = fs.statSync(OUT_PATH).size;
  console.log('Wrote', items.length, 'stations →', OUT_PATH);
  console.log('Skipped', skipped, '(private/removed/no coords); parse errors', parseErr);
  console.log('File size', (size / 1024 / 1024).toFixed(2), 'MB');
}

main();
