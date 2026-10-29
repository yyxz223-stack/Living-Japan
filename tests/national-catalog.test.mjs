import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const mod = await import('../src/catalog.js').catch(() => ({}));
const factory = (...args) => {
  assert.equal(typeof mod.createCatalog, 'function', 'national catalog is implemented');
  return mod.createCatalog(...args);
};
const admin = [
  { id: 'admin:jp', name: '日本', kind: 'country', parentId: null, adminPath: [] },
  { id: 'pref_tokyo', name: '东京都', nameJa: '東京都', kind: 'prefecture', parentId: 'admin:jp', adminPath: ['admin:jp'], regionCode: '13' },
  { id: 'tokyo_chiyoda', name: '千代田区', nameJa: '千代田区', kind: 'special_ward', parentId: 'pref_tokyo', adminPath: ['admin:jp', 'pref_tokyo'], regionCode: '13', officialCode: '13101' },
];
const fixture = () => {
  const fetched = [];
  const index = { schemaVersion: 1, version: 'test', adminNodes: admin, regions: [{ code: '13', name: '东京都', mapPath: '13.json.gz', storesPath: 'stores-13.json', poiCount: 2 }], projection: { xScale: 100, xOffset: 0, yScale: -100, yOffset: 0 } };
  const region = { region: { code: '13', defaultBounds: [0, 0, 100, 100] }, geo: { land: [] }, poi: { cats: '店', list: [[20, 30, 0, '同名店', ['别名甲'], '千代田区', '地址甲', 'clothes', 8, 'unknown', 'japan-v3'], [21, 31, 0, '同名店', [], '千代田区', '地址甲', 'clothes', 8, 'unknown', 'tokyo-v2.2']] }, transport: { stations: [] }, meta: {} };
  const stores = { stores: [{ id: 's_a', name: '同名店', brandIds: ['b_a'], prefecture: '東京都', city: '千代田区', address: '地址甲', source: 'https://example.invalid/a', checkedAt: '2026-09-07' }], brands: [] };
  const fetcher = async url => {
    const name = String(url).split('/').pop(); fetched.push(name);
    const body = name === 'manifest.json' ? JSON.stringify(index) : name === '13.json.gz' ? gzipSync(JSON.stringify(region)) : JSON.stringify(stores);
    return new Response(body);
  };
  return { catalog: factory({ baseUrl: 'https://example.invalid/', baseData: { places: [], packages: [] }, fetcher }), fetched };
};

test('index does not load regions and searches retain independent source identities', async () => {
  const { catalog, fetched } = fixture();
  await catalog.loadIndex();
  assert.deepEqual(fetched, ['manifest.json']);
  const found = await catalog.search('同名店', { regionCode: '13', limit: 20 });
  assert.equal(found.length, 3);
  assert.equal(new Set(found.map(x => x.id)).size, 3);
  assert.deepEqual(found.map(x => x.packageIds), [[], [], []]);
  assert(found.every(x => x.bodyStatus === 'empty'));
  assert.equal(fetched.filter(x => x === '13.json.gz').length, 1);
  await catalog.loadRegion('13');
  assert.equal(fetched.filter(x => x === '13.json.gz').length, 1);
});

test('unlocated stores remain retrievable and administrative children are paged', async () => {
  const { catalog } = fixture(); await catalog.loadRegion('13');
  const store = await catalog.resolve('clothing:s_a', { regionCode: '13' });
  assert.equal(catalog.get('clothing:s_a').id, store.id);
  assert.equal(store.coordinates, null);
  assert.deepEqual(store.adminPath, ['admin:jp', 'pref_tokyo', 'tokyo_chiyoda']);
  assert.equal(store.source.url, 'https://example.invalid/a');
  assert.equal((await catalog.children('tokyo_chiyoda', { limit: 1 })).length, 1);
  assert.equal((await catalog.children('tokyo_chiyoda', { offset: 1, limit: 1 })).length, 1);
});

test('search uses names aliases and type, never source address or body', async () => {
  const { catalog } = fixture();
  assert.equal((await catalog.search('别名甲', { regionCode: '13' })).length, 1);
  assert.equal((await catalog.search('clothes', { regionCode: '13' })).length, 2);
  assert.equal((await catalog.search('地址甲', { regionCode: '13' })).length, 0);
});

test('baseline objects keep packages and reviewed official station administration', async () => {
  const { catalog: unused, fetched } = fixture();
  const baseData = {
    adminNodes: admin.slice(1).map(a => ({ ...a, label: a.name })),
    places: [{ placeId: 'place:station:test', kind: 'station', stationId: 'test', label: '测试站', aliases: [], adminPath: ['wrong'], bodyRecordIds: ['body:p'], coordinates: { longitude: 139, latitude: 35 } }],
    packages: [{ id: 'p', placeId: 'place:station:test', body: '' }],
    stationAdministration: { stations: [{ railStationId: 'rail_test', legacyStationIds: ['test'], officialAdminPathsJa: [['東京都', '千代田区']] }] },
  };
  const catalog = factory({ baseData, baseUrl: 'https://example.invalid/', fetcher: async () => new Response(JSON.stringify({ adminNodes: admin, regions: [], projection: {} })) });
  await catalog.loadIndex(); const entity = catalog.get('place:station:test');
  assert.deepEqual(entity.adminPath, ['admin:jp', 'pref_tokyo', 'tokyo_chiyoda']);
  assert.deepEqual(entity.packageIds, ['p']);
  assert.equal(entity.bodyStatus, 'empty');
  assert.equal(fetched.length, 0);
});

test('administrative tree expansion reads only its small index', async () => {
  const { catalog, fetched } = fixture(); await catalog.loadIndex();
  assert.equal(typeof catalog.adminChildren, 'function');
  assert.equal(catalog.adminChildren('admin:jp')[0].id, 'pref_tokyo');
  assert.equal(catalog.adminChildren('pref_tokyo')[0].id, 'tokyo_chiyoda');
  assert.deepEqual(fetched, ['manifest.json']);
});

test('URL base reaches Worker as a string and initialization failures propagate', async () => {
  const originalWorker = globalThis.Worker, originalFetch = globalThis.fetch;
  let fail = false;
  globalThis.Worker = class {
    postMessage(message) {
      structuredClone(message);
      queueMicrotask(() => this.onmessage({ data: { id: message.id, ...(fail ? { error: 'worker init failed' } : { result: true }) } }));
    }
    terminate() {}
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ adminNodes: admin, regions: [] }));
  try {
    const catalog = factory({ baseUrl: new URL('https://example.invalid/') }); await catalog.loadIndex(); catalog.destroy();
    fail = true;
    const broken = factory({ baseUrl: new URL('https://example.invalid/') });
    await assert.rejects(broken.loadIndex(), /worker init failed/); broken.destroy();
  } finally { globalThis.Worker = originalWorker; globalThis.fetch = originalFetch; }
});

test('geographic navigation hides Japan without changing official parents or loading point packages', async () => {
  const index = JSON.parse(await readFile(new URL('../data/national/manifest.json', import.meta.url), 'utf8'));
  const before = structuredClone(index.adminNodes), fetched = [];
  const catalog = factory({ useWorker: false, baseUrl: 'https://example.invalid/', fetcher: async url => { fetched.push(String(url)); return new Response(JSON.stringify(index)); } });
  await catalog.loadIndex();
  assert.equal(catalog.navigationRoot, 'navigation:root');
  const groups = catalog.navigationChildren();
  assert.equal(groups.length, 8);
  assert(groups.every(g => g.browseOnly && g.type === '地理大区' && g.kind === 'navigation-region'));
  const prefectures = groups.flatMap(g => catalog.navigationChildren(g.id));
  assert.equal(prefectures.length, 47);
  assert.equal(new Set(prefectures.map(p => p.id)).size, 47);
  assert(prefectures.every(p => p.kind === 'prefecture' && p.parentId === 'admin:jp' && p.adminPath.join() === 'admin:jp'));
  assert.deepEqual(await catalog.children(catalog.navigationRoot, { offset: 2, limit: 2 }), groups.slice(2, 4));
  assert.deepEqual((await catalog.children('navigation:shikoku')).map(p => p.regionCode), ['36', '37', '38', '39']);
  assert.deepEqual(catalog.navigationPath('tokyo_chiyoda').map(e => e.id), ['navigation:kanto', 'pref_tokyo', 'tokyo_chiyoda']);
  assert.deepEqual(catalog.navigationPath('admin:jp'), []);
  assert.deepEqual(catalog.navigationChildren('pref_tokyo').map(e => e.id), catalog.adminChildren('pref_tokyo').map(e => e.id));
  const mapRegions = catalog.regions();
  assert.equal(mapRegions.filter(r => r.groupId).length, 47);
  assert.equal(mapRegions.find(r => r.code === '13').groupName, '关东');
  assert.equal(mapRegions.find(r => r.code === 'metro').groupId, undefined);
  assert.equal(mapRegions.find(r => r.code === '00').groupId, undefined);
  assert.equal(catalog.get('navigation:kanto').browseOnly, true);
  assert.deepEqual(index.adminNodes, before);
  assert.equal(fetched.length, 1);
  catalog.destroy();
});

function stableMapService() {
  const park = { n: '示例公园', d: 'M0,0L1,0L1,1ZM3,3L4,3L4,4Z', x: 0.5, y: 0.5, a: 0.5 };
  const raw = { region: { defaultBounds: [0, 0, 120, 120] }, geo: { land: [], parkPolys: [park] }, poi: { cats: '', list: [] }, transport: { stations: [{ id: 'a', n: '甲站', x: 20, y: 40 }, { id: 'b', n: '乙站', x: 23, y: 40 }], railways: [] } };
  return { park, service: mod.createRegionService({ index: { regions: [{ code: '13', mapPath: '13.json.gz' }] }, baseUrl: 'https://example.invalid/', fetcher: async () => new Response(JSON.stringify(raw)) }) };
}

test('panning at the same zoom keeps the same geographic point representatives', async () => {
  const { service } = stableMapService();
  const before = await service.viewport('13', [0, 0, 120, 120], { mode: 'detail', limit: 50 });
  const after = await service.viewport('13', [3, 0, 123, 120], { mode: 'detail', limit: 50 });
  assert(before.entities.length > 0);
  assert.deepEqual(after.entities.map(e => e.id), before.entities.map(e => e.id));
});

test('park geometry retains its source rings and name anchor', async () => {
  const { service, park } = stableMapService();
  const view = await service.loadRegion('13');
  assert.deepEqual(view.map.parks[0], park);
});
