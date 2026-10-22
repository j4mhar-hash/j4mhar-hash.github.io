#!/usr/bin/env python3
"""Extract amenity=charging_station from Geofabrik .osm.pbf files into Overpass-style JSON.
Two light passes (no full node-location index), so it works on country-size files with little RAM.
Usage: python extract_pbf.py out.json file1.osm.pbf [file2 ...]   (needs: pip install osmium)"""
import sys, json, osmium
out, need, ways = {}, set(), {}
class A(osmium.SimpleHandler):
    def node(s, n):
        if n.tags.get('amenity') == 'charging_station':
            out['n%d' % n.id] = {'type': 'node', 'id': n.id, 'lat': n.location.lat, 'lon': n.location.lon, 'tags': dict(n.tags)}
    def way(s, w):
        if w.tags.get('amenity') == 'charging_station':
            refs = [x.ref for x in w.nodes]; ways[w.id] = (refs, dict(w.tags)); need.update(refs)
class B(osmium.SimpleHandler):
    def __init__(s): super().__init__(); s.loc = {}
    def node(s, n):
        if n.id in need: s.loc[n.id] = (n.location.lat, n.location.lon)
for f in sys.argv[2:]:
    ways.clear(); need.clear()
    A().apply_file(f)
    b = B(); b.apply_file(f)
    for wid, (refs, tags) in ways.items():
        pts = [b.loc[r] for r in refs if r in b.loc]
        if pts: out['w%d' % wid] = {'type': 'way', 'id': wid, 'center': {'lat': sum(p[0] for p in pts) / len(pts), 'lon': sum(p[1] for p in pts) / len(pts)}, 'tags': tags}
    print(f, len(out), file=sys.stderr)
json.dump({'elements': list(out.values())}, open(sys.argv[1], 'w'))
