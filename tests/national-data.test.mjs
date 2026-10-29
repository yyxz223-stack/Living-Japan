import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const root = new URL('../data/national/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', root)));

test('published regional packages retain counts and fit ordinary GitHub file limits', async () => {
  assert.equal(manifest.regions.length, 48);
  assert.equal(manifest.counts.poiRecords, 4156953);
  assert.equal(manifest.policy.pbfIncluded, false);
  assert.equal(manifest.defaultView, 'metro');
  for (const region of [...manifest.regions, ...manifest.views]) {
    const bytes = await fs.readFile(new URL(region.mapPath, root));
    assert(bytes.length < 95 * 1024 * 1024);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), region.sha256);
    if (region.poiParts) {
      assert.equal(region.poiParts.reduce((n, part) => n + part.count, 0), region.poiCount);
      for (const part of region.poiParts) {
        assert(part.count <= 20000);
        const block = await fs.readFile(new URL(part.path, root));
        assert.equal(createHash('sha256').update(block).digest('hex'), part.sha256);
      }
    }
  }
});

test('47 clothing partitions preserve 12656 separate source identities and unlocated records', async () => {
  const stores = [];
  for (const region of manifest.regions.filter(r => r.code !== '00')) stores.push(...JSON.parse(await fs.readFile(new URL(region.storesPath, root))).stores);
  assert.equal(stores.length, 12656);
  assert.equal(new Set(stores.map(s => s.id)).size, 12656);
  assert.equal(stores.filter(s => !Number.isFinite(s.longitude) || !Number.isFinite(s.latitude)).length, 9181);
  assert(stores.every(s => s.source && s.address && Array.isArray(s.brandIds)));
});

test('administrative parents and source codes are complete; default metro is a light four-prefecture view', async () => {
  const ids = new Set(manifest.adminNodes.map(n => n.id));
  assert.equal(ids.size, manifest.adminNodes.length);
  assert(manifest.adminNodes.every(n => !n.parentId || ids.has(n.parentId)));
  assert.equal(manifest.adminNodes.filter(n => n.kind === 'prefecture').length, 47);
  const metro = manifest.views.find(v => v.code === 'metro');
  assert.deepEqual(metro.regionCodes, ['13', '14', '11', '12']);
  const data = JSON.parse(gunzipSync(await fs.readFile(new URL(metro.mapPath, root))));
  assert.equal(data.poi.list.length, 0, 'default view must not eagerly embed four full POI libraries');
  assert.equal(data.schematic.lines.length, 6);
  assert.equal(data.schematic.stations.length, 145);
  assert(!('characters' in data || 'interiors' in data || 'tasks' in data));
});
