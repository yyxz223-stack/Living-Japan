import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createBaselineEngine } from '../src/baseline.js';
import { buildMaterialsModel, applyMaterialSelection, materialState, materialPage } from '../ui/materials.js';
const data = JSON.parse(await fs.readFile(new URL('../data/base.json', import.meta.url), 'utf8'));
const engine = createBaselineEngine(data);
const model = buildMaterialsModel(engine);

test('materials use real control paths, retain every package once and search metadata only', () => {
  assert.deepEqual(model.roots.map(node => node.layer), ['TN', 'EX', 'IN', 'EV']);
  assert.equal(model.packageNodes.size, 879);
  assert.equal([...model.nodes.values()].filter(node => node.kind === 'package').length, 879);
  for (const item of data.packages) {
    const node = model.packageNodes.get(item.id);
    assert.ok(node);
    const path = model.path(node.id);
    assert.equal(path[0].layer, item.layer);
    assert.deepEqual(path.filter(part => part.kind === 'administrative').map(part => part.control.id), item.administrativeControlGroupIds || []);
    const group = data.controlGroups.find(group => group.controlGroupId === item.uiGroupId);
    if (group?.mode === 'singleton') assert.equal(path.some(part => part.kind === 'group' && part.control.id === group.controlGroupId), false);
  }
  assert.equal(model.search('砂质跑道围成').length, 0);
  assert.ok(model.search('川崎競馬場').some(node => node.packageId === 'LT_IN_VENUE_008'));
  const all = [...model.nodes.values()];
  assert.equal(materialPage(all, 0, 24).rows.length, 24);
  assert.equal(materialPage(all, 24, 24).rows[0].id, all[24].id);
});

test('explicit branch/leaf selection preserves unselected values and inherited pause', () => {
  const settings = engine.normalizeSettings(data.defaultSettings);
  const ex = model.packageNodes.get('LJ_METRO_D148_TYO_046_EX');
  const inside = model.packageNodes.get('LJ_METRO_D148_TYO_046_IN');
  const parent = model.nodes.get(ex.parentId);
  const administrative = model.path(ex.id).filter(node => node.kind === 'administrative').at(-1);
  const paused = applyMaterialSelection(settings, [administrative], false);
  assert.deepEqual(paused.packages, settings.packages);
  assert.equal(materialState(ex, paused, model).effective, false);
  assert.equal(materialState(inside, paused, model).effective, true);
  const changed = applyMaterialSelection(paused, [inside], false);
  assert.equal(changed.packages[ex.packageId], true);
  assert.equal(changed.packages[inside.packageId], false);
  assert.equal(changed.groups[parent.control.id], settings.groups[parent.control.id]);
  const restored = applyMaterialSelection(changed, [administrative], true);
  assert.equal(restored.packages[inside.packageId], false);
});
