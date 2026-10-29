import test from 'node:test';
import assert from 'node:assert/strict';
const build = await import('../scripts/build-national.mjs').catch(() => ({}));

test('source identities distinguish namespaces and preserve zero-id records', () => {
  assert.equal(typeof build.mapPointId, 'function');
  const a = [1, 2, 0, '店', [], '', '', '', 12, 'unknown', 'japan-v3'];
  assert.notEqual(build.mapPointId(a), build.mapPointId([...a.slice(0, 10), 'tokyo-v2.2']));
  a[8] = 0;
  assert.equal(build.mapPointId(a), build.mapPointId(structuredClone(a)));
  const b = structuredClone(a); b[0] = 2;
  assert.notEqual(build.mapPointId(a), build.mapPointId(b));
});

test('administrative hierarchy retains wards and separate prefecture branches', () => {
  assert.equal(typeof build.deriveAdministration, 'function');
  const nodes = build.deriveAdministration([
    { code: '13', name: '东京都', name_ja: '東京都', land: [{ code: '13101', n: '千代田区', ja: '千代田区' }] },
    { code: '14', name: '神奈川县', name_ja: '神奈川県', land: [{ code: '14117', n: '横滨市青叶区', ja: '横浜市青葉区' }] },
  ], { adminNodes: [{ id: 'pref_tokyo', label: '东京都', nameJa: '東京都', kind: 'prefecture', parentId: null }, { id: 'tokyo_chiyoda', label: '千代田区', nameJa: '千代田区', kind: 'special_ward', parentId: 'pref_tokyo' }] });
  const ward = nodes.find(n => n.officialCode === '14117');
  assert.equal(nodes.find(n => n.id === ward.parentId).nameJa, '横浜市');
  assert.equal(nodes.find(n => n.officialCode === '13101').id, 'tokyo_chiyoda');
  assert.equal(ward.adminPath.at(-1), ward.parentId);
});

test('clothing JSON marker excludes its explicit end marker', () => {
  assert.equal(typeof build.parseWorldbook, 'function');
  assert.deepEqual(build.parseWorldbook({ entries: { 0: { content: '<% /* JPF-DATA:v1\n{"id":"stores13","items":[]}\nJPF-DATA-END\n*/ -%>' } } }), [{ id: 'stores13', items: [] }]);
});

test('eight geographic browse groups cover every prefecture once', () => {
  assert.equal(typeof build.buildNavigationRegions, 'function');
  const groups = build.buildNavigationRegions();
  assert.deepEqual(groups.map(g => [g.name, g.regionCodes.length]), [['北海道', 1], ['东北', 6], ['关东', 7], ['中部', 9], ['近畿', 7], ['中国', 5], ['四国', 4], ['九州·冲绳', 8]]);
  const codes = groups.flatMap(g => g.regionCodes);
  assert.equal(codes.length, 47);
  assert.equal(new Set(codes).size, 47);
  assert.deepEqual([...codes].sort(), Array.from({ length: 47 }, (_, n) => String(n + 1).padStart(2, '0')));
  assert.deepEqual(groups.find(g => g.code === 'shikoku').regionCodes, ['36', '37', '38', '39']);
  assert(groups.find(g => g.code === 'kinki').regionCodes.includes('24'));
  assert(groups.find(g => g.code === 'chubu').regionCodes.includes('19'));
  assert(groups.find(g => g.code === 'kyushu-okinawa').regionCodes.includes('47'));
});
