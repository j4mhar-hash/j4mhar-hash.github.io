# UK EV Charger Map (prototype)

A clean, mobile-friendly map of public EV chargers in the UK:
- **Explore**: the saved UK dataset is drawn straight away (clustered). Zoom in for individual sites. From zoom 11 the map can also refresh that area from OpenStreetMap.
- **Search** a town, place or postcode (UK only). Postcodes go to postcodes.io; anything else goes to Nominatim.
- **Route**: enter From/To. The app draws the driving route and lists the chargers within an adjustable corridor (0.5–10 km, 3 km by default), sorted by distance from the start.
- **Filters**: power band (Slow <7 kW, Fast 7–22 kW, Rapid 23–99 kW, Ultra 100 kW+, Unknown) and connector (Type 2, CCS, CHAdeMO, Type 1, 3-pin, Tesla).
- **Live status**: shown when you run `node server.js`, using the operators' open OCPI feeds.

## Run it
- **Simplest:** open `index.html` in a browser, or use the GitHub Pages site. Chargers come from `data/uk-chargers.js` (a full UK snapshot), so the map does not need `server.js` or a live Overpass response. Live bay status still needs `node server.js`.
- **Recommended:** `node server.js`, then open http://localhost:8080 (Node 18+, no npm install needed). This adds:
  - `/api/live`: live EVSE status from open OCPI feeds (char.gy today), refreshed every 10 minutes.
  - `/api/overpass`: a caching proxy for OpenStreetMap Overpass (24 h disk cache, retries across mirrors, proper User-Agent).

Quick links: `?q=M1 1AE`, `?from=London&to=Birmingham&corridor=3`, `&bands=rapid,ultra`.

## Data sources
| What | Source | Key needed? |
|---|---|---|
| Charger locations, power and connectors | OpenStreetMap `amenity=charging_station` (ODbL). The site includes a saved UK extract; Overpass can refresh one area from zoom 11 | No |
| Live status | Open OCPI feeds required by the Public Charge Point Regulations 2023 (char.gy verified) | No (needs `server.js` because the feeds have no CORS headers) |
| Postcode search | postcodes.io | No |
| Place search | Nominatim (OSM), `countrycodes=gb`, no autocomplete (per their policy) | No |
| Routing | OSRM public demo server | No (demo use only) |
| Map tiles | tile.openstreetmap.org | No (light use only) |

## Files
- `index.html`: the entire app (Leaflet and MarkerCluster are loaded from unpkg).
- `server.js`: optional local server, live-status proxy and Overpass cache.
- `data/uk-chargers.js`: saved public charging sites for the whole UK. `index.html` loads it automatically.
- `scripts/build-data.js`, `scripts/extract_pbf.py`, `scripts/build-snapshot.js`: rebuild that snapshot from Overpass or a Geofabrik extract.
- `scripts/test.js`: headless Playwright test that also takes the screenshots.
