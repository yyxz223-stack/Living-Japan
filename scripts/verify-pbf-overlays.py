"""LJ-PBF-GEOMETRY-VERIFY: one finite readback of generated geometry assets."""
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import time


def main():
    project = Path(__file__).resolve().parents[1]
    national = project / 'data/national'
    folder = national / 'overlays-pbf-20261027'
    manifest = json.loads((folder/'overlay-manifest.json').read_text(encoding='utf-8'))
    started = time.monotonic(); counts = Counter(); detail_ids = set(); overview_ids = set(); multi = []; holes = []
    checked = []
    for spec in manifest['parts']:
        packed = (national/spec['path']).read_bytes()
        assert len(packed) == spec['bytes'] and hashlib.sha256(packed).hexdigest() == spec['sha256'], spec['path']
        raw = gzip.decompress(packed)
        assert len(raw) == spec['jsonBytes']
        payload = json.loads(raw)
        for kind in ['railways', 'boundaries']:
            for row in payload[kind]:
                assert re.fullmatch(r'osm:(?:way|relation):\d+', row['id']), row['id']
                if spec['level'] == 'detail':
                    assert row['id'] not in detail_ids, row['id']
                    detail_ids.add(row['id'])
                else:
                    overview_ids.add(row['id'])
                path = row['d']
                assert path.startswith('M') and re.fullmatch(r'[MLZ0-9.,-]+', path), row['id']
                groups = [part for part in path.split('M') if part]
                if kind == 'railways':
                    assert len(groups) == 1 and 'Z' not in path
                    assert row['kind'] in manifest['regions'][0]['overlayCoverage']['railwayKinds']
                else:
                    assert path.count('Z') == len(groups) == row['outerRings']+row['innerRings']
                    assert row['adminLevel'] in {4,6,7,8}
                    if row['outerRings'] > 1 and spec['level']=='detail': multi.append(row['id'])
                    if row['innerRings'] and spec['level']=='detail': holes.append(row['id'])
                all_points = []
                for group in groups:
                    if kind == 'boundaries': assert group.endswith('Z'), row['id']
                    tokens = group.rstrip('Z').split('L')
                    points = [tuple(map(float, token.split(','))) for token in tokens]
                    assert all(len(p)==2 and all(math.isfinite(v) for v in p) for p in points)
                    if kind == 'boundaries':
                        assert len(points)>=4 and points[0]==points[-1] and len(set(points[:-1]))>=3, row['id']
                    else:
                        assert len(points)>=2
                    all_points.extend(points)
                for x,y in all_points:
                    assert row['b'][0]-.001 <= x <= row['b'][2]+.001 and row['b'][1]-.001 <= y <= row['b'][3]+.001, row['id']
                assert spec['bounds'][0] <= row['b'][0] and spec['bounds'][1] <= row['b'][1] and spec['bounds'][2] >= row['b'][2] and spec['bounds'][3] >= row['b'][3]
                counts[f"{spec['level']}:{kind}"] += 1
                counts[f"{spec['level']}:vertices"] += len(all_points)
        checked.append({'path': spec['path'], 'sha256': spec['sha256'], 'bytes': len(packed)})
    assert overview_ids.issubset(detail_ids)
    assert {r['code'] for r in manifest['regions']} == {f'{i:02}' for i in range(1,48)}
    expected_rails = manifest['stages']['rails']['publishedWays']
    expected_boundaries = manifest['stages']['areas']['assembledBoundaries']
    assert counts['detail:railways'] == expected_rails and counts['detail:boundaries'] == expected_boundaries
    report = {'status':'passed', 'checkedParts':len(checked), 'counts':counts, 'detailIdsUnique':True, 'overviewIdsExistInDetail':True,
              'completeClosedSubpaths':True, 'multipleOuterBoundaryCount':len(multi), 'holeBoundaryCount':len(holes),
              'multipleOuterExamples':multi[:12], 'holeExamples':holes[:12], 'elapsedSeconds':round(time.monotonic()-started,3),
              'manifestSha256':hashlib.sha256((folder/'overlay-manifest.json').read_bytes()).hexdigest(), 'files':checked,
              'scope':'gzip/hash/count/path closure/finite coordinates/feature bounds; not a visual or live Tavern test'}
    output = project/'scripts/.local/pbf-geometry-20261027/verification.json'
    if output.exists():
        output = output.with_name('verification-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    with output.open('x',encoding='utf-8') as handle: json.dump(report,handle,ensure_ascii=False,indent=2)
    print(json.dumps({k:report[k] for k in ['status','checkedParts','counts','multipleOuterBoundaryCount','holeBoundaryCount','elapsedSeconds']},ensure_ascii=False))


if __name__ == '__main__':
    main()
