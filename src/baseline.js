import { createEngine } from './legacy/engine.js';
import textScript from './legacy/text-script.js';

// LJ-EXT-BASELINE
const clone = value => JSON.parse(JSON.stringify(value));
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const userPackageId = id => 'LJ_USER_' + encodeURIComponent(String(id));

export function createBaselineEngine(data) {
  const engine = createEngine(data, {}, {}, textScript);
  engine.withUserSlots = slots => createBaselineEngine(addUserSlotsToData(data, slots));
  return engine;
}

export async function loadBaseline(baseUrl, { fetcher = globalThis.fetch.bind(globalThis) } = {}) {
  const root = new URL('./', baseUrl);
  const response = await fetcher(new URL('data/base.json', root));
  if (!response.ok) throw new Error('Living Japan 内置资料读取失败：' + response.status);
  const data = await response.json();
  let transitPromise;
  const loadData = () => transitPromise ||= (async () => {
    const result = await fetcher(new URL('src/legacy/transit-data.json', root));
    if (!result.ok) throw new Error('Living Japan 交通资料读取失败：' + result.status);
    const fields = await result.json();
    Object.assign(data, fields);
    return fields;
  })().catch(error => { transitPromise = null; throw error; });
  return {
    engine: createBaselineEngine(data), data,
    transitMap: { async load() { const [module, fields] = await Promise.all([import('./legacy/transit-map.js'), loadData()]); return { ...module.default, data: fields }; } },
    transitTime: { async load() { const [module, fields] = await Promise.all([import('./legacy/transit-time.js'), loadData()]); return { ...module.default, data: fields }; } }
  };
}

export function addUserSlotsToData(baseData, customSlots = {}) {
  const slots = Array.isArray(customSlots) ? customSlots : Object.values(customSlots || {});
  if (!slots.length) return clone(baseData);
  const data = clone(baseData);
  const nodeById = new Map(data.adminNodes.map(node => [node.id, node]));
  const placeById = new Map(data.places.map(place => [place.placeId, place]));
  const groupById = new Map(data.controlGroups.map(group => [group.controlGroupId, group]));
  const packageIds = new Set(data.packages.map(item => item.id));
  let order = Math.max(...data.packages.map(item => item.order)) + 1;
  for (const slot of slots) {
    if (!slot?.id || !slot.entityId || !String(slot.name || '').trim() || !['EX', 'IN'].includes(slot.layer)) throw new Error('用户正文空位缺少稳定身份、完整名称或 EX/IN 层级');
    const id = userPackageId(slot.id);
    if (packageIds.has(id)) continue;
    packageIds.add(id);
    const adminPath = (slot.adminPath || []).map(node => typeof node === 'string' ? node : node.id).filter(Boolean);
    const suppliedNodes = new Map((slot.adminNodes || []).map(node => [node.id, node]));
    const adminControls = [];
    adminPath.forEach((nodeId, index) => {
      if (!nodeById.has(nodeId)) {
        const supplied = suppliedNodes.get(nodeId) || {};
        const node = { ...supplied, id: nodeId, label: supplied.label || supplied.name || nodeId, nameJa: supplied.nameJa || supplied.name || supplied.label || nodeId, kind: supplied.kind || 'administrative', parentId: supplied.parentId ?? adminPath[index - 1] ?? null };
        data.adminNodes.push(node); nodeById.set(nodeId, node);
      }
      if (nodeId === 'admin:jp') return;
      let group = data.controlGroups.find(item => item.kind === 'administrative' && item.layer === slot.layer && item.adminNodeId === nodeId);
      if (!group) {
        const groupId = 'LJ_USER_ADMIN_' + slot.layer + '_' + encodeURIComponent(nodeId);
        group = { controlGroupId: groupId, kind: 'administrative', mode: 'administrative', label: nodeById.get(nodeId).label, layer: slot.layer, adminNodeId: nodeId, parentControlGroupId: adminControls.at(-1) || null, memberPackageIds: [], globalMemberCount: 0, canonicalPackageId: null, legacyGroupId: null };
        data.controlGroups.push(group); groupById.set(groupId, group);
        data.defaultSettings.groups[groupId] = true; data.groupLabels[groupId] = group.label;
      }
      group.memberPackageIds.push(id); group.globalMemberCount = group.memberPackageIds.length;
      adminControls.push(group.controlGroupId);
    });
    const sourceObjectId = 'user:' + slot.entityId;
    const placeId = slot.entityId;
    const groupId = 'LJ_USER_OBJECT_' + encodeURIComponent(slot.entityId);
    let group = groupById.get(groupId);
    if (!group) {
      group = { controlGroupId: groupId, mode: 'multiple', label: slot.name, parentControlGroupId: null, memberPackageIds: [], globalMemberCount: 0, canonicalPackageId: null, legacyGroupId: null };
      data.controlGroups.push(group); groupById.set(groupId, group);
      data.defaultSettings.groups[groupId] = true; data.groupLabels[groupId] = slot.name;
    }
    group.memberPackageIds.push(id); group.globalMemberCount = group.memberPackageIds.length;
    const fullTriggers = Array.from(new Set([slot.name, ...(slot.fullNames || [])].map(value => String(value).trim()).filter(Boolean)));
    const item = {
      id, order: order++, sourceOrder: order, layer: slot.layer, uiGroupId: groupId, parentGroup: '用户正文', displayName: slot.title || slot.name,
      switchId: 'SW_' + id, defaultEnabled: true, matchMode: 'direct', activation: null,
      directTriggers: fullTriggers, fullTriggers, aliasTriggers: [], conditionalTriggers: [], blockedTerms: [], links: [], triggerLinks: [], dateConditionalTriggers: [],
      regionId: null, conflictGroup: slot.layer + '_NAMED_VENUE', locationComposite: null,
      body: '', bodySha256: emptyHash, allowEmptyBody: true, sourceObjectId, sourceLeafId: id, relationGroupId: groupId,
      placeId, placeKind: 'content_object', bodyRecordId: 'body:' + id, controlGroupIds: [...adminControls, groupId],
      administrativeNodeId: adminPath.at(-1) || null, administrativeAssignmentStatus: adminPath.length ? 'verified' : 'unresolved', administrativeControlGroupIds: adminControls,
      userSlotId: slot.id
    };
    data.packages.push(item); data.defaultSettings.packages[id] = true;
    const slotKey = 'P/' + id;
    data.editableTextSlots.slots[slotKey] = { slotKey, packageId: id, calendarSegmentId: null, bodySha256: emptyHash };
    data.editableTextSlots.staticCount += 1; data.editableTextSlots.slotCount += 1;
    data.bodyRecords.push({ bodyRecordId: item.bodyRecordId, packageId: id, ownerPlaceId: placeId, builtinStatus: 'empty', fallbackRecordIds: [], editableSlotKey: slotKey, bodySha256: emptyHash });
    let place = placeById.get(placeId);
    if (!place) {
      place = { placeId, kind: 'content_object', label: slot.name, nameJa: slot.name, aliases: slot.aliases || [], sourceObjectId, adminNodeId: adminPath.at(-1) || null, adminNodeIds: adminPath.length ? [adminPath.at(-1)] : [], adminPath, coordinates: slot.coordinates || null, bodyRecordIds: [], controlGroupIds: [groupId], editorialAreaIds: [] };
      data.places.push(place); placeById.set(placeId, place);
    }
    place.bodyRecordIds.push(item.bodyRecordId);
  }
  return data;
}
