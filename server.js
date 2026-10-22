#!/usr/bin/env node
// Optional local server for the UK EV map. No dependencies (Node 18+).
//   node server.js            -> http://localhost:8080
// Serves the static app AND /api/live: live EVSE status from open OCPI feeds that UK charge point
// operators must publish under the Public Charge Point Regulations 2023. Browsers can't read these
// feeds directly (no CORS headers), so this server fetches and caches them.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 8080, ROOT = __dirname, REFRESH_MS = 10 * 60 * 1000;
const UA = 'UK-EV-Map-Prototype/0.1';

// Open OCPI "locations" feeds that work anonymously (verified). Add more as you find them.
const FEEDS = [
  { operator: 'char.gy', url: 'https://char.gy/open-ocpi/locations', pageSize: 50 },
];
const STD = { IEC_62196_T2: 'T2', IEC_62196_T2_COMBO: 'CCS', CHADEMO: 'CHA', IEC_62196_T1: 'T1', IEC_62196_T1_COMBO: 'CCS1', DOMESTIC_G: '3PIN', TESLA_S: 'TSLA', TESLA_R: 'TSLA' };
function connKw(c) {
  if (c.max_electric_power) return c.max_electric_power / 1000;
  if (c.max_voltage && c.max_amperage) return (c.max_voltage * c.max_amperage * (c.power_type === 'AC_3_PHASE' ? 3 : 1)) / 1000;
  return null;
}
let cache = { updated: null, status: 'not loaded yet', items: [], feeds: FEEDS.map(f => f.operator) };
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  return { json: await r.json(), total: +r.headers.get('x-total-count') || null };
}
async function crawl(feed) {
  const out = []; const first = await getJson(`${feed.url}?limit=${feed.pageSize}&offset=0`);
  const total = first.total || first.json.data.length; const pages = [first.json.data];
  const offsets = []; for (let off = feed.pageSize; off < total; off += feed.pageSize) offsets.push(off);
  while (offsets.length) { // 4 requests at a time, politely
    const batch = offsets.splice(0, 4);
    const res = await Promise.all(batch.map(off => getJson(`${feed.url}?limit=${feed.pageSize}&offset=${off}`).then(x => x.json.data).catch(() => [])));
    pages.push(...res); await new Promise(r => setTimeout(r, 250));
  }
  for (const loc of pages.flat()) {
    if (!loc || loc.publish === false || !loc.coordinates) continue;
    const evses = (loc.evses || []).map(e => {
      const kws = (e.connectors || []).map(connKw).filter(Boolean);
      return { id: e.evse_id || e.uid, st: e.status, kw: kws.length ? Math.round(Math.max(...kws) * 10) / 10 : null, c: [...new Set((e.connectors || []).map(c => STD[c.standard] || c.standard))], upd: e.last_updated };
    });
    const kws = evses.map(e => e.kw).filter(Boolean);
    out.push({ id: feed.operator + ':' + loc.id, a: +(+loc.coordinates.latitude).toFixed(5), o: +(+loc.coordinates.longitude).toFixed(5),
      n: loc.name, ad: [loc.address, loc.city, loc.postal_code].filter(Boolean).join(', '), op: loc.operator?.name || feed.operator,
      k: kws.length ? Math.max(...kws) : null, c: [...new Set(evses.flatMap(e => e.c))], evses, upd: loc.last_updated });
  }
  return out;
}
async function refresh() {
  try {
    cache.status = 'refreshing';
    const all = (await Promise.all(FEEDS.map(f => crawl(f).catch(err => { console.error(f.operator, err.message); return []; })))).flat();
    cache = { ...cache, updated: new Date().toISOString(), status: 'ok', items: all };
    console.log(new Date().toISOString(), 'live feeds refreshed:', all.length, 'locations');
  } catch (err) { cache.status = 'error: ' + err.message; }
}

// Overpass proxy with a 24 h disk cache: sends a proper User-Agent, retries across public mirrors,
// and avoids re-asking the (often overloaded) public servers for areas already fetched.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OCACHE = path.join(ROOT, '.cache', 'overpass'); fs.mkdirSync(OCACHE, { recursive: true });
async function overpassProxy(query) {
  const f = path.join(OCACHE, crypto.createHash('sha1').update(query).digest('hex') + '.json');
  try { const st = fs.statSync(f); if (Date.now() - st.mtimeMs < 86400000) return fs.readFileSync(f, 'utf8'); } catch {}
  let last;
  for (let round = 0; round < 2; round++) for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
      const txt = await r.text(); const j = JSON.parse(txt);
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
      fs.writeFileSync(f, txt); return txt;
    } catch (e) { last = e; }
  }
  throw last;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/live') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(cache));
  }
  if (u.pathname === '/api/overpass' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try { const q = new URLSearchParams(body).get('data'); const txt = await overpassProxy(q); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(txt); }
      catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Overpass unavailable: ' + e.message); }
    });
    return;
  }
  let p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(buf);
  });
}).listen(PORT, () => { console.log(`UK EV map on http://localhost:${PORT}`); refresh(); setInterval(refresh, REFRESH_MS); });
