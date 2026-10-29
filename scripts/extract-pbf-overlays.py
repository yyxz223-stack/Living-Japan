"""LJ-PBF-GEOMETRY: targeted reference-complete rails and validated administrative rings."""
import argparse
from array import array
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import time

import osmium

RAIL_KINDS = {'rail', 'subway', 'light_rail', 'tram'}
ADMIN_LEVELS = {'4', '6', '7', '8'}
SOURCE_SHA = '6470e8bb621687ee93e5ecf24d0cffb61f2184a0ad16d30badc2bad83fe5b031'


def checked_ring(points):
    if len(points) < 4 or points[0] != points[-1]:
        raise ValueError('unclosed_ring')
    if not all(math.isfinite(x) and math.isfinite(y) for x, y in points):
        raise ValueError('invalid_ring_location')
    if len(set(points[:-1])) < 3:
        raise ValueError('degenerate_ring')
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(points, points[1:]))
    if abs(area) < 1e-12:
        raise ValueError('zero_area_ring')
    return points


def area_rings(area):
    result = []
    for outer_index, outer in enumerate(area.outer_rings()):
        for role, ring in [('outer', outer), *(('inner', inner) for inner in area.inner_rings(outer))]:
            refs = list(ring)
            if not refs or refs[0].ref != refs[-1].ref or any(not ref.location.valid() for ref in refs):
                raise ValueError('unclosed_or_missing_ring_node')
            points = checked_ring([(ref.lon, ref.lat) for ref in refs])
            result.append({'role': role, 'outerIndex': outer_index, 'points': points})
    if not result:
        raise ValueError('no_outer_ring')
    return result


def geometry_path(parts, closed=False):
    number = lambda value: f'{value:.3f}'.rstrip('0').rstrip('.') or '0'
    paths = []
    for points in parts:
        if closed:
            checked_ring(points)
        elif len(points) < 2:
            raise ValueError('short_line')
        if not all(math.isfinite(x) and math.isfinite(y) for x, y in points):
            raise ValueError('missing_line_location')
        paths.append(''.join(('M' if i == 0 else 'L') + number(x) + ',' + number(y)
                             for i, (x, y) in enumerate(points)) + ('Z' if closed else ''))
    return ''.join(paths)


def extent(parts):
    low_x = low_y = math.inf
    high_x = high_y = -math.inf
    for points in parts:
        for x, y in points:
            low_x, low_y = min(low_x, x), min(low_y, y)
            high_x, high_y = max(high_x, x), max(high_y, y)
    return [low_x, low_y, high_x, high_y]


def intersects(a, b):
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def simplify_line(points, tolerance=4):
    if len(points) <= 2:
        return points
    keep = {0, len(points)-1}
    stack = [(0, len(points)-1)]
    while stack:
        start, end = stack.pop()
        ax, ay = points[start]; bx, by = points[end]
        dx, dy = bx-ax, by-ay; length = dx*dx+dy*dy
        best, found = tolerance*tolerance, None
        for i in range(start+1, end):
            x, y = points[i]
            t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/length)) if length else 0
            distance = (x-ax-t*dx)**2+(y-ay-t*dy)**2
            if distance > best:
                best, found = distance, i
        if found is not None:
            keep.add(found); stack.extend([(start, found), (found, end)])
    return [points[i] for i in sorted(keep)]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class PolygonIndex:
    def __init__(self, rings):
        self.bounds = extent([ring['points'] for ring in rings])
        self.buckets = [[] for _ in range(256)]
        self.scale = 255 / max(self.bounds[3]-self.bounds[1], 1e-9)
        for ring in rings:
            for a, b in zip(ring['points'], ring['points'][1:]):
                if a[1] == b[1]:
                    continue
                lo, hi = sorted((a[1], b[1]))
                for i in range(self.bucket(lo), self.bucket(hi)+1):
                    self.buckets[i].append((a, b))

    def bucket(self, y):
        return max(0, min(255, int((y-self.bounds[1])*self.scale)))

    def contains(self, point):
        x, y = point
        if not (self.bounds[0] <= x <= self.bounds[2] and self.bounds[1] <= y <= self.bounds[3]):
            return False
        inside = False
        for (ax, ay), (bx, by) in self.buckets[self.bucket(y)]:
            if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
                inside = not inside
        return inside


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    source, project = args.source.resolve(), args.project.resolve()
    output = project / 'data/national/overlays-pbf-20261027'
    work = project / 'scripts/.local/pbf-geometry-20261027'
    output.mkdir(parents=True, exist_ok=False)
    work.mkdir(parents=True, exist_ok=False)
    started = time.monotonic(); before = source.stat()
    if digest(source) != SOURCE_SHA:
        raise RuntimeError('PBF differs from audited input')
    base_manifest = json.loads((project / 'data/national/manifest.json').read_text(encoding='utf-8'))
    projection = base_manifest['projection']
    project_point = lambda p: (p[0]*projection['xScale']+projection['xOffset'], p[1]*projection['yScale']+projection['yOffset'])
    pool = osmium.io.ThreadPool(2, 8)
    errors = []; stages = {}; relations = {}
    print('Stage 1: Japanese administrative relation graph', flush=True)
    begin = time.monotonic()
    for obj in osmium.FileProcessor(source, osmium.osm.RELATION, thread_pool=pool).with_filter(osmium.filter.TagFilter(('boundary', 'administrative'))):
        tags = dict(obj.tags)
        relations[obj.id] = {'id': obj.id, 'tags': tags, 'members': [(m.type, m.ref, m.role) for m in obj.members]}
    roots = {r['tags']['ISO3166-2'][3:]: r['id'] for r in relations.values() if re.fullmatch(r'JP-(?:0[1-9]|[1-3][0-9]|4[0-7])', r['tags'].get('ISO3166-2', '')) and r['tags'].get('admin_level') == '4'}
    if set(roots) != {f'{i:02}' for i in range(1,48)}:
        raise RuntimeError('Expected exactly 47 Japan prefecture roots')
    memberships = defaultdict(set)
    for code, root in roots.items():
        queue = deque([root]); visited = set()
        while queue:
            rid = queue.popleft()
            if rid in visited:
                continue
            visited.add(rid)
            rel = relations.get(rid)
            if not rel:
                errors.append({'kind': 'missing_subarea_relation', 'relationId': rid, 'regionCodes': [code]}); continue
            level = rel['tags'].get('admin_level', '')
            if level in ADMIN_LEVELS:
                memberships[rid].add(code)
            for typ, ref, role in rel['members']:
                if typ == 'r' and role == 'subarea':
                    child = relations.get(ref)
                    if child and child['tags'].get('admin_level', '').isdigit() and int(child['tags']['admin_level']) > 8:
                        continue
                    queue.append(ref)
    unresolved = defaultdict(list)
    for entry in errors:
        if entry['kind'] == 'missing_subarea_relation':
            unresolved[entry['relationId']].append(entry)
    if unresolved:
        for obj in osmium.FileProcessor(source, osmium.osm.RELATION, thread_pool=pool).with_filter(osmium.filter.IdFilter(unresolved)):
            tags = dict(obj.tags)
            for entry in unresolved[obj.id]:
                entry.update(kind='out_of_scope_subarea', boundary=tags.get('boundary', ''), adminLevel=tags.get('admin_level', ''), name=tags.get('name', ''))
    selected = {rid: relations[rid] for rid in memberships}
    geometry_relations = {}; boundary_way_ids = set()
    for rid, rel in selected.items():
        nested = [(typ, ref, role) for typ, ref, role in rel['members'] if typ == 'r' and role in {'outer', 'inner', ''}]
        parts = [(typ, ref, role) for typ, ref, role in rel['members'] if typ == 'w' and role in {'outer', 'inner'}]
        if nested or not parts:
            errors.append({'kind': 'unsupported_nested_shape' if nested else 'no_explicit_geometry_members', 'relationId': rid, 'regionCodes': sorted(memberships[rid])}); continue
        geometry_relations[rid] = {**rel, 'geometryMembers': parts}
        boundary_way_ids.update(ref for _, ref, _ in parts)
    stages['relations'] = {'seconds': round(time.monotonic()-begin,3), 'allAdministrativeRelations': len(relations), 'japanRoots': len(roots), 'reachableTargets': len(selected), 'levels': dict(Counter(r['tags'].get('admin_level') for r in selected.values())), 'geometryRelations': len(geometry_relations), 'targetWays': len(boundary_way_ids)}
    (work / 'relation-selection.json').write_text(json.dumps({'roots': roots, 'relations': [{'id': rid, 'name': r['tags'].get('name'), 'level': r['tags'].get('admin_level'), 'regionCodes': sorted(memberships[rid])} for rid,r in selected.items()]}, ensure_ascii=False), encoding='utf-8')
    del relations
    print(json.dumps(stages['relations'], ensure_ascii=False), flush=True)
    print('Stage 2: target railway and boundary ways', flush=True)
    begin = time.monotonic(); ways = {}; rail_ids = set(); node_ids = set(); boundary_nodes = set()
    fp = osmium.FileProcessor(source, osmium.osm.WAY, thread_pool=pool).with_filter(osmium.filter.TagFilter(*[('railway', value) for value in sorted(RAIL_KINDS)]))
    for obj in fp:
        tags = dict(obj.tags)
        if tags.get('disused') == 'yes' or tags.get('abandoned') == 'yes':
            errors.append({'kind': 'railway_lifecycle_conflict', 'wayId': obj.id}); continue
        refs = array('Q', (ref.ref for ref in obj.nodes))
        ways[obj.id] = {'id': obj.id, 'tags': tags, 'nodes': refs}; rail_ids.add(obj.id); node_ids.update(refs)
    for obj in osmium.FileProcessor(source, osmium.osm.WAY, thread_pool=pool).with_filter(osmium.filter.IdFilter(boundary_way_ids)):
        refs = array('Q', (ref.ref for ref in obj.nodes))
        ways.setdefault(obj.id, {'id': obj.id, 'tags': dict(obj.tags), 'nodes': refs})
        node_ids.update(refs); boundary_nodes.update(refs)
    missing_ways = boundary_way_ids.difference(ways)
    stages['ways'] = {'seconds': round(time.monotonic()-begin,3), 'railways': len(rail_ids), 'boundaryWaysFound': len(boundary_way_ids)-len(missing_ways), 'missingBoundaryWays': len(missing_ways), 'targetNodes': len(node_ids), 'boundaryTargetNodes': len(boundary_nodes), 'targetIdSetBytes': node_ids.__sizeof__()+sum(i.__sizeof__() for i in node_ids)}
    print(json.dumps(stages['ways']), flush=True)
    print('Stage 3: target node locations only', flush=True)
    begin = time.monotonic(); location_table = osmium.index.create_map('sparse_mem_array')
    subset = work / 'boundary-reference-complete.osm.pbf'
    writer = osmium.SimpleWriter(subset, thread_pool=pool)
    found_nodes = 0
    for obj in osmium.FileProcessor(source, osmium.osm.NODE, thread_pool=pool).with_filter(osmium.filter.IdFilter(node_ids)):
        if obj.location.valid():
            location_table.set(obj.id, obj.location); found_nodes += 1
            if obj.id in boundary_nodes:
                writer.add_node(obj.replace(tags={}))
    stages['locations'] = {'seconds': round(time.monotonic()-begin,3), 'foundTargetNodes': found_nodes, 'missingTargetNodes': len(node_ids)-found_nodes, 'sparseLocationBytes': location_table.used_memory()}
    del node_ids, boundary_nodes
    invalid_ways = set()
    for wid, way in ways.items():
        if len(way['nodes']) < 2:
            invalid_ways.add(wid); continue
        try:
            if any(not location_table.get(ref).valid() for ref in way['nodes']):
                invalid_ways.add(wid)
        except KeyError:
            invalid_ways.add(wid)
    for wid in sorted(boundary_way_ids.difference(missing_ways, invalid_ways)):
        writer.add_way(osmium.osm.mutable.Way(id=wid, nodes=ways[wid]['nodes'], tags={}))
    assembly_targets = {}
    for rid, rel in sorted(geometry_relations.items()):
        missing = [ref for _,ref,_ in rel['geometryMembers'] if ref not in ways or ref in invalid_ways]
        if missing:
            errors.append({'kind': 'incomplete_boundary_references', 'relationId': rid, 'wayIds': missing, 'regionCodes': sorted(memberships[rid])}); continue
        writer.add_relation(osmium.osm.mutable.Relation(id=rid, tags=rel['tags'], members=rel['geometryMembers']))
        assembly_targets[rid] = rel
    writer.close()
    print(json.dumps(stages['locations']), flush=True)
    print('Assembling validated administrative rings', flush=True)
    begin = time.monotonic(); boundary_records = []; prefecture_indexes = {}; assembled = set(); ring_stats = Counter()
    for area in osmium.FileProcessor(subset, thread_pool=pool).with_locations('sparse_mem_array').with_areas():
        if not area.is_area() or area.from_way() or area.orig_id() not in assembly_targets:
            continue
        rid = area.orig_id(); rel = assembly_targets[rid]
        try:
            raw_rings = area_rings(area)
            rings = [{**r, 'points': checked_ring([project_point(p) for p in r['points']])} for r in raw_rings]
            path = geometry_path([r['points'] for r in rings], closed=True)
        except (ValueError, RuntimeError) as error:
            errors.append({'kind': 'invalid_assembled_ring', 'relationId': rid, 'error': str(error), 'regionCodes': sorted(memberships[rid])}); continue
        assembled.add(rid); ring_stats.update(r['role'] for r in rings)
        codes = sorted(memberships[rid]); level = int(rel['tags']['admin_level'])
        record = {'id': f'osm:relation:{rid}', 'd': path, 'b': extent([r['points'] for r in rings]), 'n': rel['tags'].get('name:ja', rel['tags'].get('name','')), 'adminLevel': level, 'outerRings': sum(r['role']=='outer' for r in rings), 'innerRings': sum(r['role']=='inner' for r in rings), 'source': 'OSM Japan 2026-10-27', '_regions': codes, '_kind': 'boundaries'}
        boundary_records.append(record)
        if level == 4:
            for code in codes:
                if roots[code] == rid:
                    prefecture_indexes[code] = PolygonIndex(rings)
    for rid in set(assembly_targets).difference(assembled):
        errors.append({'kind': 'area_assembler_did_not_produce_complete_ring', 'relationId': rid, 'regionCodes': sorted(memberships[rid])})
    if set(prefecture_indexes) != set(roots):
        errors.append({'kind': 'missing_prefecture_geometry', 'regionCodes': sorted(set(roots).difference(prefecture_indexes))})
    stages['areas'] = {'seconds': round(time.monotonic()-begin,3), 'assembledBoundaries': len(boundary_records), 'assembledPrefectures': len(prefecture_indexes), 'rings': dict(ring_stats), 'referenceSubsetBytes': subset.stat().st_size}
    print(json.dumps(stages['areas']), flush=True)
    print('Projecting rails and routing spatial blocks', flush=True)
    begin = time.monotonic(); railway_records = []; overview_rails = defaultdict(list); rail_stats = Counter(); ignored_outside = 0; uncertain_rails = 0
    for wid in sorted(rail_ids):
        way = ways[wid]; tags = way['tags']
        if wid in invalid_ways:
            errors.append({'kind': 'incomplete_railway_geometry', 'wayId': wid}); continue
        points = [project_point((location_table.get(ref).lon, location_table.get(ref).lat)) for ref in way['nodes']]
        b = extent([points]); nearby = [(code, poly) for code,poly in prefecture_indexes.items() if intersects(b, poly.bounds)]
        if not nearby:
            ignored_outside += 1; continue
        probe = [points[0], points[len(points)//2], points[-1]]
        inside_codes = [code for code,poly in nearby if any(poly.contains(p) for p in probe)]
        if not inside_codes:
            probe = points + [((a[0]+b[0])/2,(a[1]+b[1])/2) for a,b in zip(points,points[1:])]
            inside_codes = [code for code,poly in nearby if any(poly.contains(p) for p in probe)]
        if not inside_codes:
            uncertain_rails += 1
            errors.append({'kind': 'railway_japan_membership_unresolved', 'wayId': wid, 'regionCodes': [code for code,_ in nearby]}); continue
        # Bounds route complete ways into adjacent regional views; this is not administrative assignment.
        codes = [code for code,_ in nearby]
        record = {'id': f'osm:way:{wid}', 'd': geometry_path([points]), 'b': b, 'n': tags.get('name:ja', tags.get('name','')), 'kind': tags['railway'], 'service': tags.get('service',''), 'source': 'OSM Japan 2026-10-27', '_regions': codes, '_kind': 'railways'}
        railway_records.append(record); rail_stats[tags['railway']] += 1
        if not tags.get('service'):
            simple = {**record, 'd': geometry_path([simplify_line(points)])}
            for code in codes:
                overview_rails[code].append(simple)
    stages['rails'] = {'seconds': round(time.monotonic()-begin,3), 'publishedWays': len(railway_records), 'kinds': dict(rail_stats), 'outsideJapanPrefectureBounds': ignored_outside, 'japanMembershipUnresolved': uncertain_rails}
    print(json.dumps(stages['rails']), flush=True)
    del ways, location_table
    print('Writing independent overview/detail overlay assets', flush=True)
    begin = time.monotonic(); region_parts = defaultdict(list); part_specs = []
    def write_part(name, records, level, codes=None):
        data = {'railways': [], 'boundaries': []}
        for record in records:
            data[record['_kind']].append({k:v for k,v in record.items() if not k.startswith('_')})
        raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        packed = gzip.compress(raw, compresslevel=6, mtime=0)
        path = output / (name + '.json.gz'); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(packed)
        bounds = [min(r['b'][0] for r in records), min(r['b'][1] for r in records), max(r['b'][2] for r in records), max(r['b'][3] for r in records)]
        spec = {'path': path.relative_to(project/'data/national').as_posix(), 'bounds': bounds, 'level': level, 'jsonBytes': len(raw), 'bytes': len(packed), 'sha256': hashlib.sha256(packed).hexdigest(), 'railways': len(data['railways']), 'boundaries': len(data['boundaries'])}
        part_specs.append(spec)
        owner_codes = codes or sorted({code for r in records for code in r['_regions']})
        for code in owner_codes:
            region_parts[code].append(spec)
    def chunks(records):
        chunk = []; chars = 0
        for record in records:
            if chunk and chars + len(record['d']) > 1200000:
                yield chunk; chunk = []; chars = 0
            chunk.append(record); chars += len(record['d'])
        if chunk:
            yield chunk
    tiles = defaultdict(list)
    for record in railway_records + boundary_records:
        b = record['b']; key = (math.floor((b[0]+b[2])/2048), math.floor((b[1]+b[3])/2048))
        tiles[key].append(record)
    for (x,y), records in sorted(tiles.items()):
        records.sort(key=lambda r:r['id'])
        for index, chunk in enumerate(chunks(records)):
            write_part(f'detail/{x}_{y}_{index}', chunk, 'detail')
    for code in sorted(roots):
        records = overview_rails[code] + [r for r in boundary_records if r['adminLevel']==4 and code in r['_regions']]
        for index, chunk in enumerate(chunks(records)):
            write_part(f'overview/{code}_{index}', chunk, 'overview', [code])
    regions = []
    for code in sorted(roots):
        related = [e for e in errors if code in e.get('regionCodes', [])]
        rail_bad = [e for e in related if e['kind'].startswith('railway_')]
        global_rail_bad = [e for e in errors if e['kind'] == 'incomplete_railway_geometry']
        boundary_bad = [e for e in related if not e['kind'].startswith('railway_') and e['kind'] != 'out_of_scope_subarea']
        regions.append({'code': code, 'overlayParts': region_parts[code], 'overlayCoverage': {'railwayKinds': sorted(RAIL_KINDS), 'railwaysComplete': not rail_bad and not global_rail_bad and len(prefecture_indexes)==47, 'boundaryAdminLevels': [4,6,7,8], 'boundariesComplete': not boundary_bad, 'overviewRailServices': ['main_or_unspecified'], 'overviewBoundaryAdminLevels': [4], 'exceptions': {'railways':len(rail_bad)+len(global_rail_bad), 'boundaries':len(boundary_bad)}}})
    after = source.stat(); stages['output'] = {'seconds': round(time.monotonic()-begin,3), 'parts': len(part_specs), 'compressedBytes': sum(s['bytes'] for s in part_specs), 'jsonBytes': sum(s['jsonBytes'] for s in part_specs), 'maxPartBytes': max(s['bytes'] for s in part_specs)}
    manifest = {'schemaVersion': 1, 'version': 'pbf-20261027', 'sourceSha256': SOURCE_SHA, 'sourceBytes': before.st_size, 'sourceSizeAndMtimeUnchanged': (before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns), 'generatedAt': datetime.now(timezone.utc).isoformat(), 'projection': projection, 'regions': regions, 'parts': part_specs, 'stages': stages, 'elapsedSeconds': round(time.monotonic()-started,3), 'policy': {'countrySelection':'JP-01..47 administrative roots and subarea graph', 'rings':'native area assembler; every full outer/inner ring closes; never repair gaps', 'partition':'complete features occur once in detail; regional references share paths; overview separately identifies lower-detail display', 'regionalRailRouting':'verified Japanese geometry, bbox overlap only selects complete feature files; not an entity administrative assignment', 'overview':'service-untagged rails simplified at four map units; prefecture rings retained in full', 'oldAssets':'unchanged; no POI rebuild'}, 'exceptionCounts': dict(Counter(e['kind'] for e in errors)), 'exceptionsPath':'scripts/.local/pbf-geometry-20261027/exceptions.json'}
    (output/'overlay-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (work/'exceptions.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')
    (work/'extraction-report.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'completed':True,'elapsedSeconds':manifest['elapsedSeconds'],'stages':stages,'exceptions':manifest['exceptionCounts'],'manifest':str(output/'overlay-manifest.json')},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
