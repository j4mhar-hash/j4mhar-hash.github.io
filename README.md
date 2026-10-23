# UK EV Charger Map (prototype)

A clean, mobile-friendly map of public EV chargers in the UK:
- **Explore**: the saved UK dataset is drawn straight away (clustered). Zoom in for individual sites. From zoom 11 the map can also refresh that area from OpenStreetMap. **Map / Satellite** at the top of the panel switches the base map; streets stay the default.
- **Search** a town, place or postcode (UK only). Postcodes go to postcodes.io; anything else goes to Nominatim.
- **Route**: enter From/To. The app draws the driving route and lists the chargers within an adjustable corridor (0.5–10 km, 3 km by default), sorted by distance from the start. **Fit route** frames that corridor; **Whole map** frames Britain and shows every charger while the route line stays on the map.
- **Filters**: power band (Slow <7 kW, Fast 7–22 kW, Rapid 23–99 kW, Ultra 100 kW+, Unknown) and connector (Type 2, CCS, CHAdeMO, Type 1, 3-pin, Tesla).
- **Live status**: shown when you run `node server.js`, using the operators' open OCPI feeds.

## Run it
- **Simplest:** open `index.html` in a browser, or use the GitHub Pages site. Chargers come from `data/uk-chargers.js` (Open Charge Map merged with open PCPR/OCPI feeds and Fastned UK locations), so the map does not need `server.js` or a live Overpass response. Live bay status still needs `node server.js`.
- **Recommended:** `node server.js`, then open http://localhost:8080 (Node 18+, no npm install needed). This adds:
  - `/api/live`: live EVSE status from open OCPI feeds (char.gy today), refreshed every 10 minutes.
  - `/api/overpass`: a caching proxy for OpenStreetMap Overpass (24 h disk cache, retries across mirrors, proper User-Agent).

Quick links: `?q=M1 1AE`, `?from=London&to=Birmingham&corridor=3`, `&bands=rapid,ultra`.

## Data sources
| What | Source | Key needed? |
|---|---|---|
| Charger locations, power and connectors (built-in snapshot) | [Open Charge Map](https://openchargemap.org) public export (`ocm-export` GB POIs; CC BY 4.0 and other licences), merged with open PCPR/OCPI location feeds: [char.gy](https://char.gy/open-ocpi/locations), [Clenergy/CEV](https://api.clenergy.online/development/pcpr/locations), [MFG](https://opendata.motorfuelgroup.net/locations), [Monta](https://public-api.monta.com/api/v1/open-data/locations) (GB only), [Fastned](https://www.fastnedcharging.com/en-gb/uk-open-data) UK Open Data API / OCPI 2.2.1 (adapted; source: Fastned), [Osprey Charging](https://www.ospreycharging.co.uk/) open data / UK PCPR OCPI 2.2.1 (adapted; source: Osprey Charging), plus `data/manual-chargers.js` | No key in the repo. Fastned: `FASTNED_API_HEADER` and `FASTNED_API_KEY` (default URL `https://uk-public.api.fastned.nl/uk-public/ocpi/cpo/2.2.1/locations`, override with `FASTNED_API_URL`). Osprey: HTTP Basic Auth via `OSPREY_API_USER` and `OSPREY_API_PASSWORD` against `https://apigw.ospreycharging.co.uk/portal/backend/opendata/ocpi221` (override with `OSPREY_API_URL`). Those values are never committed. |
| Live area / route refresh | OpenStreetMap `amenity=charging_station` via Overpass API (ODbL), from zoom 11 | No |
| Live status | Open OCPI feeds required by the Public Charge Point Regulations 2023 (char.gy verified) | No (needs `server.js` because the feeds have no CORS headers) |
| Postcode search | postcodes.io | No |
| Place search | Nominatim (OSM), `countrycodes=gb`, no autocomplete (per their policy) | No |
| Routing | OSRM public demo server | No (demo use only) |
| Map tiles | OpenStreetMap (`tile.openstreetmap.org`, default). Satellite is Esri World Imagery plus Esri road and place-name overlays (no key) | No (light use only) |

## Files
- `index.html`: the entire app (Leaflet and MarkerCluster are loaded from unpkg).
- `server.js`: optional local server, live-status proxy and Overpass cache.
- `data/uk-chargers.js`: saved public charging sites for the whole UK. `index.html` loads it automatically.
- `data/manual-chargers.js`: hand-added public sites missing from OCM/OCPI (Drax Hub Visitors). The merge script folds these into the snapshot; the page also merges them at load time so an Open Charge Map-only rebuild does not drop them.
- `data/ocpi-merge-report.json`: counts from the last PCPR/OCPI merge.
- `data/fastned-merge-report.json`: counts from the last Fastned merge.
- `data/osprey-merge-report.json`: counts from the last Osprey merge.
- `scripts/build-ocpi-merge.js`: merges the free PCPR/OCPI feeds (char.gy, Clenergy, MFG, Monta GB) and `data/manual-chargers.js` into `data/uk-chargers.js`. No API keys. Run: `node scripts/build-ocpi-merge.js`.
- `scripts/build-fastned.js`: merges Fastned UK sites into that snapshot (`fastned:` ids) from the UK Open Data OCPI 2.2.1 locations endpoint. Header name and value come from the environment and are not written into the repo. Without them it reads Fastned’s public UK station pages. Run: `node scripts/build-fastned.js`.
- `scripts/build-osprey.js`: merges Osprey Charging UK sites (`osprey:` ids) from their OCPI 2.2.1 open-data feed. A live refresh uses HTTP Basic Auth (`OSPREY_API_USER`, `OSPREY_API_PASSWORD`); the password is never logged or written into the repo. Without a password, pass a saved JSON file: `node scripts/build-osprey.js /path/to/osprey-ocpi.json`.
- `scripts/build-ocm.js`: builds an OCM-only `data/uk-chargers.js` from the Open Charge Map public export (no API key). Sparse-checkout `data/GB/` and `data/referencedata.json` from [openchargemap/ocm-export](https://github.com/openchargemap/ocm-export), then `node scripts/build-ocm.js [/path/to/ocm-export]`.
- `scripts/build-data.js`, `scripts/extract_pbf.py`, `scripts/build-snapshot.js`: older OSM Overpass / Geofabrik builders.
- `scripts/test.js`: headless Playwright test that also takes the screenshots.
