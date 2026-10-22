// Headless test + screenshots. Usage: node scripts/test.js [baseUrl]
const { chromium } = require('/workspace/tools/node_modules/playwright');
const BASE = process.argv[2] || 'http://localhost:8080/index.html';
const OUT = __dirname + '/../screenshots/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const report = {};
  async function page(w = 1366, h = 860, mobile = false) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGE ERROR', e.message)); return p;
  }
  const stats = p => p.evaluate(() => { const b = map.getBounds(); const inView = visible.filter(s => b.contains([s.a, s.o]));
    const c = {}; for (const s of inView) { const k = bandOf(s); c[k] = (c[k] || 0) + 1; }
    return { total: stations.length, osm: osmById.size, live: stations.filter(s => s.src === 'live').length, visible: visible.length, inView: inView.length, bands: c, zoom: map.getZoom() }; });
  const waitLoaded = async p => { await sleep(1500); for (let i = 0; i < 300; i++) { if (await p.evaluate(() => { const b = map.getBounds(), c = Math.floor(b.getCenter().lat / CELL) + ':' + Math.floor(b.getCenter().lng / CELL); return (loading === 0 && loadedCells.has(c)) || (window.UK_CHARGERS && osmById.size > 0); })) return true; await sleep(1000); } return false; };
  const waitLive = async p => { for (let i = 0; i < 30; i++) { if (await p.evaluate(() => !!(live && live.items && live.items.length))) return true; await sleep(1000); } return false; };

  for (const [name, q] of [['london', 'Trafalgar Square, London'], ['manchester', 'M1 1AE']]) {
    const p = await page();
    await p.goto(`${BASE}?q=${encodeURIComponent(q)}`); await waitLive(p); await waitLoaded(p); await sleep(2500);
    report[name] = await stats(p);
    await p.screenshot({ path: OUT + `area-${name}.png` });
    if (name === 'london') {
      // power filter: only rapid + ultra
      await p.evaluate(() => document.querySelector('#qres').hidden = true); await p.click('#bands .chip[data-b=slow]'); await p.click('#bands .chip[data-b=fast]'); await p.click('#bands .chip[data-b=unknown]'); await sleep(2500);
      report.london_rapid_ultra_only = await stats(p);
      await p.screenshot({ path: OUT + 'area-london-rapid-filter.png' });
      await p.evaluate(() => { const s = visible.find(x => x.src === 'live') || visible[0]; });
    }
    await p.close();
  }
  { // live popup in Haringey (char.gy area)
    const p = await page(); await p.goto(`${BASE}?q=N15 6BT`); await waitLive(p); await waitLoaded(p); await sleep(2000);
    await p.evaluate(() => { map.setZoom(17); }); await sleep(2000);
    await p.evaluate(() => { const c = map.getCenter(); const s = visible.filter(x => x.src === 'live').sort((a, b) => Math.hypot(a.a - c.lat, a.o - c.lng) - Math.hypot(b.a - c.lat, b.o - c.lng))[0]; focusStation(s.id); });
    await sleep(2500); await p.screenshot({ path: OUT + 'live-status-popup.png' }); report.haringey = await stats(p); await p.close();
  }
  { // route
    const p = await page(); await p.goto(`${BASE}?from=London&to=Birmingham&corridor=3`); await waitLive(p);
    for (let i = 0; i < 600 && !(await p.evaluate(() => !!(state.route && state.route.width != null))); i++) await sleep(1000);
    await sleep(4000);
    report.route = await p.evaluate(() => ({ km: Math.round(state.route.distance / 1000), mins: Math.round(state.route.duration / 60), corridorKm: state.route.width, hits: state.route.hits.length, shown: state.route.hits.filter(passes).length,
      bands: state.route.hits.filter(passes).reduce((c, s) => (c[bandOf(s)] = (c[bandOf(s)] || 0) + 1, c), {}), first: state.route.hits.slice(0, 3).map(s => [s.n, Math.round(s.along), +s.dist.toFixed(2)]) }));
    await p.screenshot({ path: OUT + 'route-london-birmingham.png' });
    await p.fill('#corr', '1'); await p.dispatchEvent('#corr', 'change'); await sleep(2000);
    report.route_1km = await p.evaluate(() => state.route.hits.length);
    await p.close();
  }
  { // mobile
    const p = await page(390, 844, true); await p.goto(`${BASE}?q=Leeds`); await waitLive(p); await waitLoaded(p); await sleep(2500);
    report.mobile_leeds = await stats(p); await p.screenshot({ path: OUT + 'mobile-leeds.png' }); await p.close();
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})();
