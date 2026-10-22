# UK EV Charger Map (prototype)

A clean, mobile-friendly map of public EV chargers in the UK:
- **Explore**: pan or zoom (zoom 11+) and the chargers for that area load automatically, with clustered markers.
- **Search** a town, place or postcode (UK only). Postcodes go to postcodes.io; anything else goes to Nominatim.
- **Route**: enter From/To. The app draws the driving route and lists the chargers within an adjustable corridor (0.5–10 km, 3 km by default), sorted by distance from the start.
- **Filters**: power band (Slow <7 kW, Fast 7–22 kW, Rapid 23–99 kW, Ultra 100 kW+, Unknown) and connector (Type 2, CCS, CHAdeMO, Type 1, 3-pin, Tesla).
- **Live status**: shown when you run `node server.js`, using the operators' open OCPI feeds.

## Run it
- **Simplest:** open `index.html` in a browser. Everything works except live status, and it fetches from the public servers directly.
- **Recommended:** `node server.js`, then open http://localhost:8080 (Node 18+, no npm install needed). This adds:
  - `/api/live`: live EVSE status from open OCPI feeds (char.gy today), refreshed every 10 minutes.
  - `/api/overpass`: a caching proxy for OpenStreetMap Overpass (24 h disk cache, retries across mirrors, proper User-Agent).

Quick links: `?q=M1 1AE`, `?from=London&to=Birmingham&corridor=3`, `&bands=rapid,ultra`.

## Data sources
| What | Source | Key needed? |
|---|---|---|
| Charger locations, power and connectors | OpenStreetMap `amenity=charging_station` via Overpass API (ODbL) | No |
| Live status | Open OCPI feeds required by the Public Charge Point Regulations 2023 (char.gy verified) | No (needs `server.js` because the feeds have no CORS headers) |
| Postcode search | postcodes.io | No |
| Place search | Nominatim (OSM), `countrycodes=gb`, no autocomplete (per their policy) | No |
| Routing | OSRM public demo server | No (demo use only) |
| Map tiles | tile.openstreetmap.org | No (light use only) |

## Files
- `index.html`: the entire app (Leaflet and MarkerCluster are loaded from unpkg).
- `server.js`: optional local server, live-status proxy and Overpass cache.
- `scripts/build-data.js`: optional builder for an offline UK snapshot (`data/uk-chargers.js`). It's slow on the public Overpass servers. If the file exists, `index.html` will use it when you add `<script src="data/uk-chargers.js"></script>`.
- `scripts/test.js`: headless Playwright test that also takes the screenshots.
