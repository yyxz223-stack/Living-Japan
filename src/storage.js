const PRODUCT_ID = 'living-japan';
const BACKUP_FORMAT = 'living-japan-user-backup';
const LEGACY_FORMAT = 'living-japan-text-overrides';
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function mergeObject(current, incoming) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    Object.defineProperty(merged, key, { value: isObject(value) && isObject(current[key]) ? mergeObject(current[key], value) : clone(value), enumerable: true, writable: true, configurable: true });
  }
  return merged;
}

function customSlotMap(value) {
  if (Array.isArray(value)) return Object.fromEntries(value.map(slot => [slot.id, clone(slot)]));
  return isObject(value) ? clone(value) : {};
}

function checkedRecord(value, slotKey) {
  if (!isObject(value) || typeof value.packageId !== 'string' || typeof value.body !== 'string' || !value.body.trim()) {
    throw storageError('INVALID_BACKUP', `正文记录无效：${slotKey}`);
  }
  return { ...clone(value), slotKey, calendarSegmentId: value.calendarSegmentId || null };
}

function slotMatches(slot, record) {
  return slot.packageId === record.packageId && (slot.calendarSegmentId || null) === (record.calendarSegmentId || null);
}

// LJ-USER-STORAGE: 用户文件写后读回才提交；旧正文槽保持独立身份。
export function createUserStore({ transport, initialData = {}, knownSlots = null, normalize = null } = {}) {
  if (!transport?.read || !transport?.write) throw new TypeError('缺少用户文件读写接口');
  let normalizer = normalize;
  let slotSource = knownSlots;
  let loaded = false;
  let serverSnapshot = null;
  let queue = Promise.resolve();
  const listeners = new Set();
  const previews = new WeakMap();

  function currentSlots(container) {
    return typeof slotSource === 'function' ? slotSource(container) : slotSource;
  }

  function normalizeContainer(input) {
    if (input != null && !isObject(input)) throw storageError('INVALID_DATA', '用户保存文件不是有效对象');
    if (input?.productId && input.productId !== PRODUCT_ID) throw storageError('INVALID_DATA', '用户文件不属于 Living Japan');
    if (Number(input?.storageVersion || 1) > 1) throw storageError('UNSUPPORTED_VERSION', '用户文件来自更新的保存格式，请先更新扩展');
    const source = { ...clone(initialData), ...(input == null ? {} : clone(input)) };
    let result = {
      ...source,
      productId: PRODUCT_ID,
      storageVersion: 1,
      schemaVersion: source.schemaVersion ?? 1,
      revision: source.revision ?? 0,
      livingJapanSettings: isObject(source.livingJapanSettings) ? source.livingJapanSettings : {},
      livingJapanTextOverrides: { schemaVersion: 1, records: {}, orphans: {}, ...(source.livingJapanTextOverrides || {}) },
      livingJapanUIPreferences: isObject(source.livingJapanUIPreferences) ? source.livingJapanUIPreferences : {},
      customSlots: customSlotMap(source.customSlots),
    };
    if (!Number.isSafeInteger(result.revision) || result.revision < 0) throw storageError('INVALID_DATA', '用户文件的保存版本无效');
    if (normalizer) result = normalizer(clone(result)) || result;
    const overrides = result.livingJapanTextOverrides;
    const slots = currentSlots(result);
    if (!isObject(overrides?.records) || !isObject(overrides?.orphans)) throw storageError('INVALID_DATA', '用户正文记录结构无效');
    if (slots) {
      const records = {}, orphans = {};
      for (const [slotKey, value] of Object.entries({ ...overrides.orphans, ...overrides.records })) {
        const record = checkedRecord(value, slotKey);
        const slot = slots[slotKey];
        if (slot && slotMatches(slot, record)) records[slotKey] = record;
        else orphans[slotKey] = record;
      }
      result.livingJapanTextOverrides = { ...overrides, records, orphans };
    }
    return clone(result);
  }

  let confirmed = normalizeContainer(null);
  function serial(action) {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  }
  function notify() {
    for (const listener of listeners) {
      try { listener(clone(confirmed)); } catch (error) { console.error('[Living Japan] 保存状态订阅失败', error); }
    }
  }
  async function load() {
    return serial(async () => {
      const raw = await transport.read();
      const next = normalizeContainer(raw);
      serverSnapshot = raw == null ? null : clone(raw);
      confirmed = next;
      loaded = true;
      notify();
      return clone(confirmed);
    });
  }
  function read() { return clone(confirmed); }
  function update(mutator, { expectedRevision } = {}) {
    return serial(async () => {
      if (!loaded) throw storageError('NOT_LOADED', '请先读取用户资料，再保存');
      if (expectedRevision !== undefined && expectedRevision !== confirmed.revision) throw storageError('SAVE_CONFLICT', '资料已在其他操作中改变，请重新核对后保存');
      const remote = await transport.read();
      if (!equal(remote, serverSnapshot)) throw storageError('SAVE_CONFLICT', '服务器已有更新的保存，请重新读取后核对；当前输入仍未保存');
      const draft = clone(confirmed);
      const replacement = await mutator(draft);
      const next = normalizeContainer(replacement === undefined ? draft : replacement);
      next.revision = confirmed.revision + 1;
      await transport.write(next);
      const readback = await transport.read();
      if (!equal(readback, next)) throw storageError('READBACK_MISMATCH', '保存后服务器读回不一致，尚未确认保存完成；请保留当前输入');
      serverSnapshot = clone(readback);
      confirmed = normalizeContainer(readback);
      notify();
      return read();
    });
  }
  function setKnownSlots(slots) {
    slotSource = slots;
    confirmed = normalizeContainer(confirmed);
    return read();
  }
  function setNormalizer(fn) {
    normalizer = fn;
    confirmed = normalizeContainer(confirmed);
    return read();
  }
  function exportBackup() {
    return JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, productId: PRODUCT_ID, exportedAt: new Date().toISOString(), data: read() }, null, 2);
  }

  function importBackup(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : clone(value);
    if (!isObject(parsed) || parsed.productId !== PRODUCT_ID || parsed.formatVersion !== 1 || ![BACKUP_FORMAT, LEGACY_FORMAT].includes(parsed.format)) {
      throw storageError('INVALID_BACKUP', '不是受支持的 Living Japan 用户备份');
    }
    const next = read();
    const summary = { added: 0, overwritten: 0, unresolved: 0, baseChanged: 0, imported: 0, customSlotsAdded: 0, customSlotsOverwritten: 0, settingsIncluded: false };
    let records, orphans;
    if (parsed.format === BACKUP_FORMAT) {
      if (!isObject(parsed.data)) throw storageError('INVALID_BACKUP', '用户备份缺少内容');
      const incoming = normalizeContainer(parsed.data);
      next.customSlots = { ...next.customSlots, ...incoming.customSlots };
      for (const id of Object.keys(incoming.customSlots)) {
        if (Object.hasOwn(confirmed.customSlots, id)) summary.customSlotsOverwritten += 1;
        else summary.customSlotsAdded += 1;
      }
      next.livingJapanSettings = mergeObject(next.livingJapanSettings, incoming.livingJapanSettings);
      next.livingJapanUIPreferences = mergeObject(next.livingJapanUIPreferences, incoming.livingJapanUIPreferences);
      summary.settingsIncluded = true;
      records = Object.entries(incoming.livingJapanTextOverrides.records).map(([slotKey, item]) => ({ ...item, slotKey }));
      orphans = Object.entries(incoming.livingJapanTextOverrides.orphans).map(([slotKey, item]) => ({ ...item, slotKey }));
    } else {
      records = parsed.records;
      orphans = parsed.orphans ?? [];
    }
    if (!Array.isArray(records) || !Array.isArray(orphans)) throw storageError('INVALID_BACKUP', '用户备份正文列表无效');
    const slots = currentSlots(next) || {};
    const seen = new Set();
    for (const value of [...records, ...orphans]) {
      if (typeof value?.slotKey !== 'string' || !value.slotKey || seen.has(value.slotKey)) throw storageError('INVALID_BACKUP', '用户备份包含缺失或重复的正文槽');
      seen.add(value.slotKey);
      const record = checkedRecord(value, value.slotKey);
      const slot = slots[record.slotKey];
      if (slot && !slotMatches(slot, record)) throw storageError('INVALID_BACKUP', `正文槽归属冲突：${record.slotKey}`);
      if (!slot) {
        next.livingJapanTextOverrides.orphans[record.slotKey] = record;
        summary.unresolved += 1;
      } else {
        if (Object.hasOwn(next.livingJapanTextOverrides.records, record.slotKey)) summary.overwritten += 1;
        else summary.added += 1;
        next.livingJapanTextOverrides.records[record.slotKey] = record;
        delete next.livingJapanTextOverrides.orphans[record.slotKey];
        if (record.baseBuiltinSha256 !== slot.bodySha256) summary.baseChanged += 1;
        summary.imported += 1;
      }
    }
    const preview = { format: parsed.format, summary, baseRevision: confirmed.revision };
    previews.set(preview, next);
    return preview;
  }
  function applyImport(preview) {
    const next = previews.get(preview);
    if (!next) return Promise.reject(storageError('INVALID_BACKUP', '请先预览此备份，再确认导入'));
    return update(() => clone(next), { expectedRevision: preview.baseRevision }).then(result => { previews.delete(preview); return result; });
  }
  return { load, read, update, setKnownSlots, setNormalizer, exportBackup, importBackup, previewImport: importBackup, applyImport, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

export function createSillyTavernTransport({ context, fetcher = globalThis.fetch, filename = 'living-japan-user-data.json' } = {}) {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/.test(filename)) throw new Error('用户保存文件名无效');
  const fileUrl = `/user/files/${encodeURIComponent(filename)}`;
  const requestHeaders = () => ({ 'Content-Type': 'application/json', ...(context?.getRequestHeaders?.() || {}) });
  return {
    async read() {
      const response = await fetcher(fileUrl, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 404) return null;
      if (!response.ok) throw storageError('READ_FAILED', `读取用户保存失败（${response.status}）`);
      return response.json();
    },
    async write(value) {
      const response = await fetcher('/api/files/upload', { method: 'POST', credentials: 'same-origin', headers: requestHeaders(), body: JSON.stringify({ name: filename, data: encodeUtf8Base64(JSON.stringify(value)) }) });
      if (!response.ok) throw storageError('WRITE_FAILED', `写入用户保存失败（${response.status}）`);
      const result = await response.json();
      if (typeof result?.path !== 'string' || result.path.replace(/^\//, '') !== fileUrl.slice(1)) throw storageError('WRITE_FAILED', '服务器没有确认正确的用户保存文件');
      return result;
    },
  };
}
