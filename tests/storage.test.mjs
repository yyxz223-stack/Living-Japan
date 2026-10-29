import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserStore, createSillyTavernTransport } from '../src/storage.js';

const clone = value => value == null ? value : structuredClone(value);
function memoryTransport(initial = null) {
  let value = clone(initial);
  return { read: async () => clone(value), write: async next => { value = clone(next); }, peek: () => clone(value) };
}
const slots = {
  'P/park': { packageId: 'park', calendarSegmentId: null, bodySha256: 'new-park' },
  'P/greenhouse': { packageId: 'greenhouse', calendarSegmentId: null, bodySha256: 'greenhouse' },
};
const record = (id, body, hash = 'old-park') => ({ slotKey: `P/${id}`, packageId: id, calendarSegmentId: null, body, baseBuiltinSha256: hash });
const legacyBackup = records => ({ format: 'living-japan-text-overrides', formatVersion: 1, productId: 'living-japan', records, orphans: [] });

test('first load is read only; snapshots cannot mutate saved content', async () => {
  const transport = memoryTransport();
  const store = createUserStore({ transport, initialData: { livingJapanSettings: { masterEnabled: true } } });
  await store.load();
  const copy = store.read();
  copy.livingJapanSettings.masterEnabled = false;
  assert.equal(store.read().livingJapanSettings.masterEnabled, true);
  assert.equal(transport.peek(), null);
});

test('save commits only after server write and readback, and serial updates retain both edits', async () => {
  let releaseWrite, announceWrite;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  const started = new Promise(resolve => { announceWrite = resolve; });
  const transport = memoryTransport();
  const normalWrite = transport.write;
  transport.write = async value => { announceWrite(); await gate; await normalWrite(value); };
  const store = createUserStore({ transport });
  await store.load();
  let notices = 0;
  store.subscribe(() => { notices += 1; });
  const first = store.update(value => { value.livingJapanSettings.first = true; });
  const second = store.update(value => { value.livingJapanSettings.second = true; });
  await started;
  assert.equal(store.read().livingJapanSettings.first, undefined);
  assert.equal(notices, 0);
  releaseWrite();
  await Promise.all([first, second]);
  assert.deepEqual(store.read().livingJapanSettings, { first: true, second: true });
  assert.equal(store.read().revision, 2);
  assert.equal(notices, 2);
  const reopened = createUserStore({ transport });
  await reopened.load();
  assert.deepEqual(reopened.read(), store.read());
});

test('write failure and changed readback do not replace the last confirmed snapshot', async () => {
  const transport = memoryTransport();
  const store = createUserStore({ transport });
  await store.load();
  const before = store.read();
  transport.write = async () => { throw new Error('server offline'); };
  await assert.rejects(store.update(value => { value.livingJapanSettings.changed = true; }), /server offline/);
  assert.deepEqual(store.read(), before);
  transport.write = async value => { transport.read = async () => ({ ...clone(value), revision: value.revision + 1 }); };
  await assert.rejects(store.update(value => { value.livingJapanSettings.changed = true; }), error => error.code === 'READBACK_MISMATCH');
  assert.deepEqual(store.read(), before);
});

test('another client saved revision is not silently overwritten', async () => {
  const transport = memoryTransport();
  const first = createUserStore({ transport });
  const second = createUserStore({ transport });
  await Promise.all([first.load(), second.load()]);
  await first.update(value => { value.livingJapanSettings.writer = 'first'; });
  await assert.rejects(second.update(value => { value.livingJapanSettings.writer = 'second'; }), error => error.code === 'SAVE_CONFLICT');
  assert.equal(transport.peek().livingJapanSettings.writer, 'first');
  assert.equal(second.read().livingJapanSettings.writer, undefined);
});

test('legacy import previews first, preserves different body slots, and retains unknown records', async () => {
  const transport = memoryTransport();
  const store = createUserStore({ transport, knownSlots: slots });
  await store.load();
  await store.update(value => { value.livingJapanTextOverrides.records['P/greenhouse'] = record('greenhouse', '温室原有稿'); });
  const before = store.read();
  const preview = store.importBackup(legacyBackup([record('park', '公园用户稿'), record('unknown', '未对应稿')]));
  assert.equal(preview.summary.added, 1);
  assert.equal(preview.summary.unresolved, 1);
  assert.equal(preview.summary.baseChanged, 1);
  assert.deepEqual(store.read(), before);
  assert.deepEqual(transport.peek(), before);
  await store.applyImport(preview);
  const saved = store.read().livingJapanTextOverrides;
  assert.equal(saved.records['P/park'].body, '公园用户稿');
  assert.equal(saved.records['P/greenhouse'].body, '温室原有稿');
  assert.equal(saved.orphans['P/unknown'].body, '未对应稿');
  assert.match(store.exportBackup(), /未对应稿/);
});

test('a stale import preview cannot overwrite newer edits; empty legacy records are rejected', async () => {
  const store = createUserStore({ transport: memoryTransport(), knownSlots: slots });
  await store.load();
  const preview = store.importBackup(legacyBackup([record('park', '导入稿')]));
  await store.update(value => { value.livingJapanTextOverrides.records['P/park'] = record('park', '之后保存的稿'); });
  await assert.rejects(store.applyImport(preview), error => error.code === 'SAVE_CONFLICT');
  assert.equal(store.read().livingJapanTextOverrides.records['P/park'].body, '之后保存的稿');
  assert.throws(() => store.importBackup(legacyBackup([record('park', '  ')])), /正文|body/);
});

test('full personal backup restores settings, user slots and text without copying the old revision', async () => {
  const source = createUserStore({ transport: memoryTransport(), knownSlots: slots });
  await source.load();
  await source.update(value => {
    value.livingJapanSettings = { masterEnabled: false, groups: { EX: false } };
    value.livingJapanUIPreferences = { transitFavoritePlaces: { slots: [{ slotId: 'favorite_1', displayName: '家' }] } };
    value.customSlots['custom:shop:1'] = { id: 'custom:shop:1', entityId: 'clothing:shop:1', name: '同名分店', layer: 'IN', adminPath: ['JP-13'] };
    value.livingJapanTextOverrides.records['P/park'] = record('park', '自定义公园');
  });
  const destination = createUserStore({ transport: memoryTransport(), knownSlots: slots });
  await destination.load();
  const preview = destination.importBackup(source.exportBackup());
  assert.equal(preview.summary.customSlotsAdded, 1);
  await destination.applyImport(preview);
  assert.equal(destination.read().livingJapanSettings.masterEnabled, false);
  assert.equal(destination.read().customSlots['custom:shop:1'].entityId, 'clothing:shop:1');
  assert.equal(destination.read().livingJapanTextOverrides.records['P/park'].body, '自定义公园');
  assert.equal(destination.read().revision, 1);
});

test('known slot metadata changes retain user text and its original builtin hash', async () => {
  const transport = memoryTransport();
  const first = createUserStore({ transport, knownSlots: slots });
  await first.load();
  await first.applyImport(first.importBackup(legacyBackup([record('park', '用户稿')])));
  const updated = createUserStore({ transport, knownSlots: { ...slots, 'P/park': { ...slots['P/park'], bodySha256: 'next-release' } } });
  await updated.load();
  assert.equal(updated.read().livingJapanTextOverrides.records['P/park'].body, '用户稿');
  assert.equal(updated.read().livingJapanTextOverrides.records['P/park'].baseBuiltinSha256, 'old-park');
});

test('SillyTavern transport uses user file read/upload and reports HTTP failure', async () => {
  let stored = null;
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/files/upload') {
      const request = JSON.parse(options.body);
      assert.equal(request.name, 'living-japan-user-data.json');
      assert.equal(options.headers['X-CSRF-Token'], 'test-token');
      stored = JSON.parse(Buffer.from(request.data, 'base64').toString('utf8'));
      return Response.json({ path: 'user/files/living-japan-user-data.json' });
    }
    assert.match(url, /^\/user\/files\/living-japan-user-data\.json/);
    assert.equal(options.cache, 'no-store');
    return stored ? Response.json(stored) : new Response('', { status: 404 });
  };
  const transport = createSillyTavernTransport({ context: { getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-token' }) }, fetcher });
  assert.equal(await transport.read(), null);
  await transport.write({ revision: 1, text: '中文稿与 emoji 🌸' });
  assert.deepEqual(await transport.read(), { revision: 1, text: '中文稿与 emoji 🌸' });
  assert.equal(calls.length, 3);
  const failing = createSillyTavernTransport({ fetcher: async () => new Response('failed', { status: 500 }) });
  await assert.rejects(failing.write({ revision: 2 }), /500/);
  await assert.rejects(failing.read(), /500/);
});
