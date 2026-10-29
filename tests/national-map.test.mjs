import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/national-map.js').catch(() => ({}));
function host() {
  const callbacks = new Map();
  const context = new Proxy({}, { get(_, key) { return key === 'measureText' ? () => ({ width: 20 }) : () => {}; }, set() { return true; } });
  const canvas = { style: {}, getContext: () => context, setAttribute() {}, remove() {}, addEventListener(k, fn) { callbacks.set(k, fn); }, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }), setPointerCapture() {}, releasePointerCapture() {} };
  return { callbacks, container: { style: {}, ownerDocument: { createElement: () => canvas }, appendChild() {}, getBoundingClientRect: canvas.getBoundingClientRect } };
}
const entity = { id: 'map:japan-v3:1', name: '测试店', coordinates: { x: 50, y: 50 }, regionCode: '13' };
function make(container, options) { assert.equal(typeof module.createNationalMap, 'function'); return module.createNationalMap(container, options); }

test('map selection does not append; a double click appends the exact selected entity once', async () => {
  const { container, callbacks } = host(); const appended = [];
  const catalog = { projection: () => ({}), loadRegion: async code => ({ code, map: { defaultBounds: [0, 0, 100, 100], land: [], rivers: [], railways: [] } }), viewport: async () => ({ entities: [entity], roads: [] }) };
  const map = make(container, { catalog, onAppend: e => appended.push(e.id) });
  await map.setRegion('13'); await map.select(entity);
  assert.equal(appended.length, 0);
  callbacks.get('dblclick')({ clientX: 400, clientY: 250, preventDefault() {} });
  assert.deepEqual(appended, [entity.id]);
  map.destroy();
});

test('rapid region changes cannot let an older load replace the latest map', async () => {
  const { container } = host(); const releases = new Map();
  const catalog = { projection: () => ({}), loadRegion: code => new Promise(resolve => releases.set(code, resolve)), viewport: async () => ({ entities: [], roads: [] }) };
  const map = make(container, { catalog });
  const first = map.setRegion('13'), second = map.setRegion('27');
  releases.get('27')({ code: '27', map: { defaultBounds: [0, 0, 100, 100], land: [], rivers: [], railways: [] } }); await second;
  releases.get('13')({ code: '13', map: { defaultBounds: [0, 0, 100, 100], land: [], rivers: [], railways: [] } }); await first;
  assert.equal(map.getView().regionCode, '27');
  map.setDetail('detailed'); assert.equal(map.getView().detail, 'detailed');
  map.destroy();
});

test('touch double tap and its synthesized double click append only once', async () => {
  const { container, callbacks } = host(); let count = 0;
  const catalog = { projection: () => ({}), loadRegion: async code => ({ code, map: { defaultBounds: [0, 0, 100, 100], land: [], rivers: [], railways: [] } }), viewport: async () => ({ entities: [entity], roads: [] }) };
  const map = make(container, { catalog, onAppend: () => count++ }); await map.setRegion('13'); await map.select(entity);
  const event = { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 250, preventDefault() {} };
  for (let i = 0; i < 2; i++) { callbacks.get('pointerdown')(event); callbacks.get('pointerup')({ ...event, type: 'pointerup' }); }
  callbacks.get('dblclick')(event);
  assert.equal(count, 1); map.destroy();
});

test('four map representations are independent of density and locate preserves selection', async () => {
  const { container } = host(); const selected = [];
  const catalog = { projection: () => ({}), loadRegion: async code => ({ code, map: { defaultBounds: [0, 0, 100, 100], land: [], rivers: [], railways: [] } }), viewport: async () => ({ entities: [entity], roads: [] }) };
  const map = make(container, { catalog, onSelect: e => selected.push(e.id) }); await map.setRegion('13'); await map.select(entity);
  assert.equal(typeof map.setMode, 'function');
  map.setMode('ultra'); map.setDetail('overview');
  assert.equal(map.getView().mode, 'ultra'); assert.equal(map.getView().detail, 'overview');
  await map.locate({ ...entity, id: 'map:japan-v3:2', coordinates: { x: 70, y: 70 } });
  assert.deepEqual(selected, [entity.id]); assert.equal(map.getView().selectedId, entity.id);
  const location = map.getView().center;
  await map.select({ ...entity, id: 'map:japan-v3:3', coordinates: { x: 20, y: 20 } }, { locate: false });
  assert.deepEqual(map.getView().center, location);
  assert.equal(map.getView().selectedId, 'map:japan-v3:3');
  map.destroy();
});
