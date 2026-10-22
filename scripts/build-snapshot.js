// Turns Overpass-style JSON files (from extract_pbf.py or Overpass) into data/uk-chargers.js
// Usage: node scripts/build-snapshot.js "<regions label>" in1.json [in2.json ...]
const fs = require('fs'), path = require('path'); const { compact } = require('./build-data.js');
const [label, ...files] = process.argv.slice(2); const seen = new Map();
for (const f of files) for (const e of JSON.parse(fs.readFileSync(f)).elements) seen.set(e.type[0] + e.id, e);
const items = [...seen.values()].map(compact).filter(Boolean);
const out = { generated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), Geofabrik extracts', regions: label, count: items.length, items };
fs.writeFileSync(path.join(__dirname, '..', 'data', 'uk-chargers.js'), 'window.UK_CHARGERS=' + JSON.stringify(out) + ';\n');
console.log('wrote', items.length, 'stations');
