// LJ-EXTENSION-UPDATE: 扩展更新只调用酒馆更新接口，用户保存独立保留。
export function createUpdateManager({ context, fetcher = globalThis.fetch, extensionName = 'Living-Japan', global: isGlobal = false } = {}) {
  async function request(action) {
    const response = await fetcher(`/api/extensions/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(context?.getRequestHeaders?.() || {}) },
      body: JSON.stringify({ extensionName, global: isGlobal }),
    });
    if (!response.ok) throw new Error(`扩展${action === 'update' ? '更新' : '检查'}失败（${response.status}）`);
    return response.json();
  }
  return {
    async check() {
      const result = await request('version');
      const supported = Boolean(result.currentCommitHash && result.remoteUrl);
      return { ...result, supported, available: supported && result.isUpToDate === false };
    },
    async update() {
      const result = await request('update');
      if (!result.shortCommitHash || typeof result.isUpToDate !== 'boolean') throw new Error('服务器未确认扩展更新结果');
      return { ...result, reloadRequired: result.isUpToDate === false };
    },
  };
}

export function inspectBuiltinChanges(container, manifest = {}) {
  const slots = manifest.slots || manifest.editableTextSlots?.slots || {};
  const records = container?.livingJapanTextOverrides?.records || {};
  const changedSlotKeys = [], missingSlotKeys = [];
  for (const [slotKey, record] of Object.entries(records)) {
    if (!slots[slotKey]) missingSlotKeys.push(slotKey);
    else if (record.baseBuiltinSha256 !== slots[slotKey].bodySha256) changedSlotKeys.push(slotKey);
  }
  return { dataVersion: manifest.dataVersion || manifest.version || null, changedSlotKeys, missingSlotKeys };
}
