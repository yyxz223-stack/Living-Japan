import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nextEndpoints, toTransitEndpoint } from '../ui/map.js';
import transit from '../src/legacy/transit-time.js';
import mapModule from '../src/legacy/transit-map.js';

const base = JSON.parse(await readFile(new URL('../data/base.json', import.meta.url)));
const fields = JSON.parse(await readFile(new URL('../src/legacy/transit-data.json', import.meta.url)));

test('endpoint selection toggles only the requested slot and never leaves identical endpoints', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  assert.deepEqual(nextEndpoints(a, b, 'origin', a), { origin: null, destination: b });
  assert.deepEqual(nextEndpoints(a, b, 'origin', b), { origin: b, destination: null });
  assert.deepEqual(nextEndpoints(a, b, 'destination', c), { origin: a, destination: c });
});

test('formal station identities retain the v3.6 route and traffic-comment algorithm', () => {
  const endpoint = id => toTransitEndpoint({ id: `place:station:${id}`, legacyPlaceId: `place:station:${id}`, name: id }, base, fields);
  const origin = endpoint('ueno'), destination = endpoint('shinjuku');
  assert.equal(origin.type, 'station');
  assert.equal(origin.id, fields.transitTime.stationAnchors.find(item => item.railStationId === base.stationAdministration.contentStationCrosswalk.find(item => item.placeId === 'place:station:ueno').railStationId).stationId);
  const result = transit.createEstimator(fields.transitTime).estimateAll({ origin, destination });
  for (const mode of ['public_transit', 'driving', 'walking', 'bicycle']) {
    assert.equal(result.estimates[mode].ok, true, mode);
    const comment = mapModule._test.buildTrafficComment({ origin, destination, mode, estimate: result.estimates[mode] });
    assert.match(comment, /^<!--traffic info：/);
    assert.match(comment, /从上野駅处出发/);
    assert.match(comment, /所需时间约\d+分钟/);
  }
});

test('national source identities do not become a baseline station by matching name', () => {
  const endpoint = toTransitEndpoint({ id: 'map:test:123', name: '上野', coordinates: { longitude: 139.777, latitude: 35.713 } }, base, fields);
  assert.equal(endpoint.type, 'place');
  assert.deepEqual(endpoint.stationIds, []);
  assert.equal(transit.estimateRoute({ origin: endpoint, destination: toTransitEndpoint({ id: 'place:station:shinjuku' }, base, fields), mode: 'public_transit' }, fields.transitTime).ok, false);
});

test('administrative nodes cannot become trip endpoints', () => {
  assert.equal(toTransitEndpoint({ id: 'admin:13', kind: 'prefecture', name: '东京都' }, base, fields), null);
  assert.equal(toTransitEndpoint({ id: 'unmapped', name: '未定位地点' }, base, fields), null);
});

test('routes outside the frozen traffic data remain unavailable for all four modes', () => {
  const origin = toTransitEndpoint({ id: 'map:osaka:1', name: '大阪测试地点', coordinates: { longitude: 135.5, latitude: 34.7 } }, base, fields);
  const destination = toTransitEndpoint({ id: 'map:osaka:2', name: '大阪另一地点', coordinates: { longitude: 135.55, latitude: 34.72 } }, base, fields);
  const result = transit.estimateAll({ origin, destination }, fields.transitTime);
  assert.deepEqual(Object.values(result.estimates).map(item => item.ok), [false, false, false, false]);
});
