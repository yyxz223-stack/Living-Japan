import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionService } from '../src/catalog.js';
import { createNationalMap } from '../src/national-map.js';
import * as build from '../scripts/build-national.mjs';

function fixture() {
  const fetched = [], records = new Map();
  const overview = { path: 'overview.json.gz', level: 'overview', bounds: [0, 0, 500, 100], bytes: 120, jsonBytes: 1000 };
  const sharedOverview = Array.from({ length: 4 }, (_, i) => ({ ...overview, path: `overview-shared-${i}.json.gz` }));
  const parts = Array.from({ length: 5 }, (_, i) => ({ path: `detail-${i}.json.gz`, level: 'detail', bounds: [i * 100, 0, i * 100 + 99, 100], bytes: 120, jsonBytes: 1000 }));
  const rings = 'M1,1L9,1L9,9ZM3,3L3,4L4,4Z';
  for (const part of [overview, ...sharedOverview, ...parts]) {
    const b = part.bounds;
    records.set(part.path, { railways: ['rail', 'subway', 'light_rail', 'tram'].map((kind, i) => ({ id: `osm:way:${i}`, kind, service: '', n: '', b, d: `M${b[0]},1L${b[0] + 5},5` })).concat({ id: 'osm:way:yard', kind: 'rail', service: 'yard', b, d: 'M8,8L9,9' }), boundaries: [4, 7, 8].map(adminLevel => ({ id: `osm:relation:${adminLevel}`, adminLevel, b, d: rings })) });
  }
  records.set('region.json.gz', { region: { defaultBounds: [0, 0, 500, 100] }, geo: { land: [] }, transport: { stations: [], railways: [] }, poi: { cats: '', list: [] } });
  const index = { regions: [{ code: '00', mapPath: 'region.json.gz' }, { code: '13', mapPath: 'region.json.gz' }], views: [{ code: 'metro', regionCodes: ['13'], mapPath: 'region.json.gz' }] };
  assert.equal(typeof build.attachOverlayManifest, 'function');
  build.attachOverlayManifest(index, { regions: [{ code: '13', overlayParts: [overview, ...sharedOverview, ...parts], overlayCoverage: { railwayKinds: ['rail', 'subway', 'light_rail', 'tram'], railwaysComplete: true, boundariesComplete: true, boundaryAdminLevels: [4, 7, 8] } }] });
  const service = createRegionService({ index, baseUrl: 'https://example.invalid/', fetcher: async url => { const name = String(url).split('/').pop(); fetched.push(name); return new Response(JSON.stringify(records.get(name))); } });
  return { service, fetched, rings };
}

test('overlay zoom tiers fetch only intersecting blocks and retain at most four decoded parts', async () => {
  const { service, fetched } = fixture();
  const overview = await service.viewport('metro', [1, 1, 499, 99], { mode: 'detail', scale: 0.1 });
  assert.equal(overview.overlays.level, 'overview');
  assert.equal(overview.overlays.railwaysActive, true);
  assert.deepEqual(new Set(overview.overlays.railways.map(r => r.kind)), new Set(['rail', 'subway', 'light_rail', 'tram']));
  assert.equal(overview.overlays.metrics.railwayRecords, 4);
  assert(!fetched.some(f => f.startsWith('detail-')));
  const readCount = fetched.length;
  const warm = await service.viewport('metro', [2, 1, 500, 99], { mode: 'detail', scale: 0.1 });
  assert.equal(fetched.length, readCount, 'five overview parts must not thrash a four-part raw cache');
  assert.equal(warm.overlays.metrics.overviewCacheHit, true);
  assert(service.stats().cachedOverviewBytes <= 32 * 1024 * 1024);
  await service.viewport('00', [1, 1, 499, 99], { mode: 'detail', scale: 0.1 });
  assert.equal(fetched.filter(f => f === 'overview.json.gz').length, 2);
  for (let i = 0; i < 5; i++) await service.viewport('13', [i * 100 + 1, 1, i * 100 + 98, 99], { mode: 'ultra', scale: 8 });
  assert.equal(service.stats().cachedOverlayBlocks, 4);
  assert(service.stats().cachedOverlayBytes <= 32 * 1024 * 1024);
  await service.viewport('13', [1, 1, 98, 99], { mode: 'ultra', scale: 8 });
  assert.equal(fetched.filter(f => f === 'detail-0.json.gz').length, 2);
  const count = fetched.length;
  await service.viewport('13', [1, 1, 98, 99], { mode: 'schem', scale: 8 });
  assert.equal(fetched.length, count);
});

test('overlay filtering retains independent rings and exposes service tracks only at close ultra scale', async () => {
  const { service, rings } = fixture();
  const detail = await service.viewport('13', [1, 1, 98, 99], { mode: 'detail', scale: 2 });
  assert.equal(detail.overlays.railways.length, 4);
  assert(detail.overlays.boundaries.every(b => b.d === rings));
  assert.deepEqual(detail.overlays.boundaries.map(b => b.adminLevel), [4, 7]);
  const ultra = await service.viewport('13', [1, 1, 98, 99], { mode: 'ultra', scale: 8 });
  assert(ultra.overlays.railways.some(r => r.service === 'yard'));
  assert.deepEqual(ultra.overlays.boundaries.map(b => b.adminLevel), [4, 7, 8]);
  const map = await service.viewport('13', [1, 1, 98, 99], { mode: 'map', scale: 2 });
  assert.deepEqual(map.overlays.railways.map(r => r.kind), ['rail']);
  assert.deepEqual(map.overlays.boundaries.map(b => b.adminLevel), [4]);
});

test('verified PBF railways replace old lines while land is filled without its old border', async () => {
  const originalPath = globalThis.Path2D, strokes = [], fills = [];
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  const land = 'M0,0L100,0L100,100Z', oldRail = 'M0,1L99,99', newRail = 'M2,3L4,5', boundary = 'M1,1L8,1L8,8ZM3,3L4,3L4,4Z';
  const ctx = new Proxy({}, { get(_, key) {
    if (key === 'clearRect') return () => { strokes.length = fills.length = 0; };
    if (key === 'stroke') return p => { if (p?.d) strokes.push(p.d); };
    if (key === 'fill') return p => { if (p?.d) fills.push(p.d); };
    if (key === 'measureText') return () => ({ width: 20 });
    return () => {};
  }, set() { return true; } });
  const canvas = { style: {}, getContext: () => ctx, setAttribute() {}, remove() {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }) };
  const container = { style: {}, ownerDocument: { createElement: () => canvas }, appendChild() {}, getBoundingClientRect: canvas.getBoundingClientRect };
  const catalog = { projection: () => ({}), loadRegion: async () => ({ map: { defaultBounds: [0, 0, 100, 100], pbfRailways: true, land: [{ d: land }], railways: [{ d: oldRail }] } }), viewport: async () => ({ entities: [], roads: [], overlays: { railwaysActive: true, railways: [{ kind: 'rail', d: newRail }], boundaries: [{ adminLevel: 4, d: boundary }] } }) };
  const map = createNationalMap(container, { catalog });
  try {
    await map.setRegion('13'); await new Promise(resolve => setTimeout(resolve, 25));
    assert(fills.includes(land));
    assert(!strokes.includes(land));
    assert(!strokes.includes(oldRail));
    assert.equal(strokes.filter(d => d === newRail).length, 1);
    assert(strokes.includes(boundary));
  } finally { map.destroy(); globalThis.Path2D = originalPath; }
});
