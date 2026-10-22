// Turns Overpass-style JSON files (from extract_pbf.py or Overpass) into data/uk-chargers.js
// Usage: node scripts/build-snapshot.js "<regions label>" in1.json [in2.json ...]
const fs = require('fs'), path = require('path'); const { compact } = require('./build-data.js');
const [label, ...files] = process.argv.slice(2); const seen = new Map();
for (const f of files) for (const e of JSON.parse(fs.readFileSync(f)).elements) seen.set(e.type[0] + e.id, e);
const items = [...seen.values()].map(compact).filter(Boolean);
const out = { generated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), Geofabrik extracts', regions: label, count: items.length };
const file = path.join(__dirname, '..', 'data', 'uk-chargers.js');
// One site per line so mobile browsers can parse a full-UK file (a single multi-megabyte line can fail).
fs.writeFileSync(file, 'window.UK_CHARGERS=' + JSON.stringify(out).slice(0, -1) + ',"items":[\n' + items.map(i => JSON.stringify(i)).join(',\n') + '\n]};\n');
console.log('wrote', items.length, 'stations');
