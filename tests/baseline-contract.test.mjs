import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { loadBaseline, createBaselineEngine, addUserSlotsToData, userPackageId } from '../src/baseline.js';

const root = new URL('../', import.meta.url);
const requests = [];
const fetcher = async url => {
  requests.push(String(url));
  return { ok: true, json: async () => JSON.parse(await fs.readFile(url, 'utf8')) };
};

test('existing v3.6 inputs produce identical prompt bytes without loading the map', async () => {
  const release = JSON.parse(await fs.readFile(new URL('../交付/酒馆助手脚本-Living Japan重构版_v3.6.json', root), 'utf8'));
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(release.content, sandbox);
  const old = sandbox.module.exports;
  const { engine, data } = await loadBaseline(root, { fetcher });
  assert.equal(data.packages.length, 879);
  assert.equal(data.editableTextSlots.slotCount, 1334);
  for (const message of ['东京站。', '新宿御苑。', '国立科学博物馆。', '松户站。', '池袋的GiGO。', '下雨了，下午三点，走进便利店。']) {
    const messages = [{ role: 'user', message }];
    const options = { random: () => 0 };
    assert.equal(engine.runEngine(messages, data.defaultSettings, options).prompt,
      old.runEngine(messages, old.data.defaultSettings, options).prompt, message);
  }
  assert.equal(requests.some(url => url.includes('transit-data')), false);
});

test('a user slot keeps stable identity, empty-body semantics and independent EX/IN parent controls', async () => {
  const { data } = await loadBaseline(root, { fetcher });
  const slot = { id: 'test:venue/inside', entityId: 'national:fixture:1', name: '测试青叶阅读馆', title: '私人的窗边资料稿', layer: 'IN', adminPath: ['pref_tokyo', 'tokyo_taito'], aliases: ['阅读馆'] };
  const expanded = addUserSlotsToData(data, [slot]);
  assert.equal(data.packages.length, 879);
  assert.equal(expanded.packages.length, 880);
  const engine = createBaselineEngine(expanded);
  const id = userPackageId(slot.id);
  assert.equal(expanded.packages.find(item => item.id === id).displayName, slot.title);
  const messages = [{ role: 'user', message: slot.name }];
  const settings = engine.normalizeSettings(data.defaultSettings);
  const blank = engine.runEngine(messages, settings);
  assert.equal(blank.packageIds.includes(id), false);
  assert.equal(blank.diagnostics.recognizedEmptyBodies.some(item => item.id === id), true);
  const overrides = engine.emptyTextOverrides();
  const variant = engine.editableVariantsForPackage(id)[0];
  overrides.records[variant.slotKey] = engine.createOverrideRecord(variant, '个人保存的测试阅读馆正文。');
  assert.equal(variant.slotKey, `P/${id}`);
  const run = () => engine.runEngine(messages, settings, { textOverrides: overrides });
  assert.equal(run().packageIds.includes(id), true);
  settings.groups.LJ_ADMIN_EX_TOKYO_TAITO = false;
  assert.equal(run().packageIds.includes(id), true);
  settings.groups.LJ_ADMIN_IN_TOKYO_TAITO = false;
  assert.equal(run().packageIds.includes(id), false);
  assert.equal(settings.packages[id], true);
  settings.groups.LJ_ADMIN_IN_TOKYO_TAITO = true;
  assert.equal(run().packageIds.includes(id), true);
  assert.equal(engine.runEngine([{ role: 'user', message: '阅读馆' }], settings, { textOverrides: overrides }).packageIds.includes(id), false);
  assert.equal(engine.runEngine([{ role: 'user', message: slot.title }], settings, { textOverrides: overrides }).packageIds.includes(id), false);
});

test('user administrative controls skip country while preserving official Tokyo and Osaka paths', async () => {
  const { data } = await loadBaseline(root, { fetcher });
  const country = { id: 'admin:jp', label: '日本', nameJa: '日本', kind: 'country', parentId: null };
  const osakaNodes = [
    country,
    { id: 'admin:jp:27', label: '大阪府', nameJa: '大阪府', kind: 'prefecture', parentId: 'admin:jp' },
    { id: 'admin:jp:city:27:大阪市', label: '大阪市', nameJa: '大阪市', kind: 'city', parentId: 'admin:jp:27' },
    { id: 'admin:jp:27102', label: '都岛区', nameJa: '都島区', kind: 'ward', parentId: 'admin:jp:city:27:大阪市' },
  ];
  const slots = [
    { id: 'country-test:tokyo', entityId: 'fixture:tokyo', name: '东京父控测试场馆', layer: 'EX', adminPath: ['admin:jp', 'pref_tokyo', 'tokyo_taito'], adminNodes: [country] },
    { id: 'country-test:osaka', entityId: 'fixture:osaka', name: '大阪父控测试场馆', layer: 'EX', adminPath: osakaNodes.map(node => node.id), adminNodes: osakaNodes },
  ];
  const expanded = addUserSlotsToData(data, slots);
  assert.equal(expanded.controlGroups.some(group => group.adminNodeId === 'admin:jp'), false);
  assert.equal(expanded.adminNodes.find(node => node.id === 'admin:jp').label, '日本');
  for (const slot of slots) {
    assert.deepEqual(expanded.places.find(place => place.placeId === slot.entityId).adminPath, slot.adminPath);
    const item = expanded.packages.find(pkg => pkg.id === userPackageId(slot.id));
    const controls = item.administrativeControlGroupIds.map(id => expanded.controlGroups.find(group => group.controlGroupId === id));
    assert.deepEqual(controls.map(group => group.adminNodeId), slot.adminPath.slice(1));
    assert.equal(controls[0].parentControlGroupId, null);
    for (let i = 1; i < controls.length; i++) assert.equal(controls[i].parentControlGroupId, controls[i - 1].controlGroupId);
  }
  const tokyoId = expanded.packages.find(pkg => pkg.id === userPackageId(slots[0].id)).administrativeControlGroupIds[0];
  assert.equal(tokyoId, data.controlGroups.find(group => group.layer === 'EX' && group.adminNodeId === 'pref_tokyo').controlGroupId);
  assert.equal(expanded.adminNodes.find(node => node.id === 'admin:jp:27').parentId, 'admin:jp');
  assert.equal(data.packages.length, 879);
});
