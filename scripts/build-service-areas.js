#!/usr/bin/env node
/**
 * Build data/service-areas.js from an Overpass JSON extract of highway=services
 * in the United Kingdom. No API key. The extract is not stored in the repo.
 *
 *   node scripts/build-service-areas.js /path/to/overpass.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'service-areas.js');

const BRANDS = [
  ['welcome break', 'Welcome Break'],
  ['roadchef', 'Roadchef'],
  ['westmorland', 'Westmorland'],
  ['extramsa', 'Extra'],
  ['extra', 'Extra'],
  ['euro garages', 'EG'],
  ['eurogarages', 'EG'],
  ['eg group', 'EG'],
  ['eg on the move', 'EG'],
  ['applegreen', 'Applegreen'],
  ['gridserve', 'GRIDSERVE'],
  ['moto', 'Moto'],
];

function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function prettyBrand(raw) {
  const f = fold(raw);
  if (!f) return '';
  for (const [key, label] of BRANDS) {
    if (f === key || f.startsWith(key + ' ')) return label;
  }
  return String(raw).trim();
}

function roadOf(tags) {
  const bits = [tags.motorway, tags.ref, tags['addr:street'], tags.name];
  for (const bit of bits) {
    const m = String(bit || '').toUpperCase().match(/\b([AM]\d{1,4})\b/);
    if (m) return m[1];
  }
  return '';
}

function parseName(rawName, operator) {
  let s = String(rawName || '').trim();
  let op = prettyBrand(operator);
  const folded = fold(s);
  for (const [key, label] of BRANDS) {
    if (folded.startsWith(key + ' ')) {
      if (!op) op = label;
      s = s.replace(new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '');
      break;
    }
  }
  let dir = '';
  const dm = s.match(/\b(northbound|southbound|eastbound|westbound)\b/i);
  if (dm) {
    dir = dm[1].toLowerCase();
    s = s.replace(dm[0], ' ');
  }
  s = s.replace(/\bservices\b/ig, ' ').replace(/\s+/g, ' ').replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  return { n: s || String(rawName).trim(), dir, op };
}

function pos(el) {
  if (el.lat != null) return { a: +el.lat, o: +el.lon };
  if (el.center) return { a: +el.center.lat, o: +el.center.lon };
  return null;
}

function metres(a, o, b, p) {
  const r = Math.PI / 180;
  const x = (p - o) * r * Math.cos(((a + b) / 2) * r);
  const y = (b - a) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function knownBrand(tags) {
  const raw = fold((tags && (tags.operator || tags.brand)) || '');
  return BRANDS.some(([key]) => raw === key || raw.startsWith(key + ' '));
}

function keep(el) {
  const name = el.tags && el.tags.name;
  if (!name) return false;
  if (/\b(school|hospital|airport|pest|coach)\b/i.test(name)) return false;
  if (/\bservice station\b/i.test(name) && !/\bservices\b/i.test(name)) return false;
  if (/\bservices\b/i.test(name)) return true;
  if (/\b(northbound|southbound|eastbound|westbound)\b/i.test(name) && knownBrand(el.tags)) return true;
  if (knownBrand(el.tags)) return true;
  return false;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Pass an Overpass JSON file.');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const elements = (doc.elements || []).filter(keep);
  const rows = [];
  for (const el of elements) {
    const p = pos(el);
    if (!p || !isFinite(p.a) || !isFinite(p.o)) continue;
    if (p.a < 49 || p.a > 61 || p.o < -8.7 || p.o > 2) continue;
    const parsed = parseName(el.tags.name, el.tags.operator || el.tags.brand || '');
    if (!parsed.n || parsed.n.length < 3) continue;
    const road = roadOf(el.tags);
    const junction = el.tags['junction:ref'] || '';
    rows.push({
      n: parsed.n,
      dir: parsed.dir,
      op: parsed.op,
      road,
      j: String(junction || '').trim(),
      a: +p.a.toFixed(5),
      o: +p.o.toFixed(5),
      rank: (el.tags.operator ? 2 : 0) + (el.type === 'way' ? 1 : 0),
    });
  }
  rows.sort((a, b) => b.rank - a.rank || a.n.localeCompare(b.n));
  const kept = [];
  for (const row of rows) {
    const key = fold(row.n) + '|' + row.dir;
    const dup = kept.find(k => fold(k.n) + '|' + k.dir === key && metres(k.a, k.o, row.a, row.o) < 180);
    if (dup) continue;
    kept.push(row);
  }
  kept.sort((a, b) => a.n.localeCompare(b.n) || a.dir.localeCompare(b.dir));
  const items = kept.map(r => {
    const o = { n: r.n, a: r.a, o: r.o };
    if (r.dir) o.dir = r.dir;
    if (r.op) o.op = r.op;
    if (r.road) o.road = r.road;
    if (r.j) o.j = r.j;
    return o;
  });
  const meta = {
    generated: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL), highway=services in the United Kingdom',
    count: items.length,
  };
  fs.writeFileSync(
    OUT,
    'window.SERVICE_AREAS=' +
      JSON.stringify(meta).slice(0, -1) +
      ',"items":[\n' +
      items.map(i => JSON.stringify(i)).join(',\n') +
      '\n]};\n'
  );
  console.log('Wrote', items.length, 'service areas to', OUT);
  for (const q of ['tebay', 'leigh delamere', 'gordano', 'washington', 'wetherby', 'cobham', 'rugby']) {
    const hits = items.filter(s => fold(s.n + ' ' + (s.dir || '') + ' ' + (s.op || '')).includes(q.replace(' ', '')) || fold(s.n + ' ' + (s.op || '')).includes(q));
    console.log(q, hits.map(s => [s.n, s.dir || '', s.op || '', s.road || ''].filter(Boolean).join(' · ')).join(' | '));
  }
}

main();
