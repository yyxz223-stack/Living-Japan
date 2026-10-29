// LJ-EXT-SESSION
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export function createSession({ engine: initialEngine, store, context = {}, onChange = () => {} }) {
  let engine = initialEngine;
  let started = false;
  let slotSignature = null;
  let settings, textOverrides, uiPreferences;
  let currentRequest = null;
  let requestSerial = 0;
  let lastDiagnostics = null;
  let lastActualInjection = null;
  let lastPreview = null;
  let macroContext = null;
  const listeners = [];
  const readContext = () => (typeof context === 'function' ? context() : context) || {};
  const messages = () => (readContext().chat || []).slice();
  const now = () => new Date().toISOString();
  const notify = (type, error) => onChange({ type, error, runtime, engine });

  function refreshCaches() {
    const state = store.read();
    const slots = state.customSlots || {};
    const signature = JSON.stringify(slots);
    if (signature !== slotSignature) {
      const hasSlots = Array.isArray(slots) ? slots.length > 0 : Object.keys(slots).length > 0;
      engine = hasSlots && initialEngine.withUserSlots ? initialEngine.withUserSlots(slots) : initialEngine;
      slotSignature = signature;
      store.setKnownSlots?.(engine.data.editableTextSlots.slots);
    }
    settings = engine.normalizeSettings(state[engine.data.settingsKey]);
    textOverrides = engine.normalizeTextOverrides(state[engine.data.textOverrideKey]);
    uiPreferences = engine.normalizeUIPreferences(state[engine.data.uiPreferencesKey]);
    return state;
  }

  async function saveField(key, value, normalize) {
    const normalized = normalize(value);
    await store.update(draft => { draft[key] = normalized; });
    refreshCaches();
    return clone(normalized);
  }

  function handleGeneration(type = 'normal', options = {}, dryRun = false) {
    const gate = engine.requestGate(type, options, dryRun);
    currentRequest = { id: ++requestSerial, type, gate, dryRun: Boolean(dryRun), macroExpanded: false, parentStationSelectionCache: {}, interestSelectionCache: {} };
    if (!dryRun) lastActualInjection = {
      kind: 'actual', status: gate.allowed ? 'pending' : 'rejected', requestId: currentRequest.id,
      startedAt: now(), completedAt: gate.allowed ? null : now(), prompt: '', packageIds: [],
      diagnostics: { route: 'macro', macro: '{{' + engine.data.macroName + '}}', requestType: type, gate, packageIds: [], reason: gate.allowed ? 'waiting_for_macro' : gate.reason }, error: null
    };
    if (!gate.allowed) lastDiagnostics = clone(lastActualInjection?.diagnostics || { requestType: type, gate, packageIds: [] });
    notify('generation');
  }

  function expandMacro() {
    if (!started) return '';
    const request = currentRequest || { type: 'normal', gate: engine.requestGate('normal', {}, false), parentStationSelectionCache: {}, interestSelectionCache: {} };
    if (!request.gate.allowed) return '';
    try {
      if (currentRequest) currentRequest.macroExpanded = true;
      const result = engine.runEngine(messages(), settings, { requestType: request.type, textOverrides, parentStationSelectionCache: request.parentStationSelectionCache, interestSelectionCache: request.interestSelectionCache });
      lastDiagnostics = { ...result.diagnostics, route: 'macro', macro: '{{' + engine.data.macroName + '}}', gate: request.gate, packageIds: result.packageIds, actualPrompt: result.prompt };
      if (currentRequest && !currentRequest.dryRun) lastActualInjection = {
        kind: 'actual', status: 'expanded', requestId: request.id, startedAt: lastActualInjection?.startedAt || now(), completedAt: now(), prompt: result.prompt, packageIds: [...result.packageIds], diagnostics: clone(lastDiagnostics), error: null
      };
      notify('actual');
      return result.prompt;
    } catch (error) {
      lastDiagnostics = { route: 'macro', macro: '{{' + engine.data.macroName + '}}', requestType: request.type, gate: request.gate, packageIds: [], error: String(error?.message || error) };
      if (currentRequest && !currentRequest.dryRun) lastActualInjection = { kind: 'actual', status: 'error', requestId: request.id, startedAt: lastActualInjection?.startedAt || now(), completedAt: now(), prompt: '', packageIds: [], diagnostics: clone(lastDiagnostics), error: lastDiagnostics.error };
      notify('error', error);
      return '';
    }
  }

  function resetRequest() {
    if (currentRequest && !currentRequest.dryRun && !currentRequest.macroExpanded && lastActualInjection?.status === 'pending') {
      lastDiagnostics = { route: 'macro', macro: '{{' + engine.data.macroName + '}}', requestType: currentRequest.type, gate: currentRequest.gate, packageIds: [], reason: 'macro_not_expanded' };
      lastActualInjection = { ...lastActualInjection, status: 'macro_not_expanded', completedAt: now(), diagnostics: clone(lastDiagnostics) };
    }
    currentRequest = null;
    notify('generation-ended');
  }

  function onChatChanged() {
    currentRequest = lastDiagnostics = lastActualInjection = lastPreview = null;
    notify('chat-changed');
  }

  async function previewCurrent(settingsOverride) {
    const result = engine.runEngine(messages(), engine.normalizeSettings(settingsOverride || settings), { requestType: 'normal', textOverrides, parentStationSelectionCache: {}, interestSelectionCache: {} });
    lastPreview = { kind: 'preview', status: 'preview', startedAt: now(), completedAt: now(), prompt: result.prompt, packageIds: [...result.packageIds], diagnostics: { ...result.diagnostics, route: 'panel_preview', macro: '{{' + engine.data.macroName + '}}', packageIds: [...result.packageIds], previewPrompt: result.prompt }, error: null };
    notify('preview');
    return result;
  }

  async function start() {
    if (started) return { started: true, duplicate: false };
    refreshCaches();
    const target = readContext();
    for (const [name, callback] of [['GENERATION_AFTER_COMMANDS', handleGeneration], ['GENERATION_ENDED', resetRequest], ['GENERATION_STOPPED', resetRequest], ['CHAT_CHANGED', onChatChanged]]) {
      const event = target.eventTypes?.[name] || name;
      if (target.eventSource?.on) { target.eventSource.on(event, callback); listeners.push([target.eventSource, event, callback]); }
    }
    started = true;
    try {
      if (typeof target.registerMacro === 'function') {
        target.registerMacro(engine.data.macroName, expandMacro, 'Living Japan 背景资料锚点');
        macroContext = target;
      }
    } catch (error) { stop(); throw error; }
    notify('ready');
    return { started: true, duplicate: false };
  }

  function stop() {
    if (macroContext) macroContext.unregisterMacro?.(engine.data.macroName);
    macroContext = null;
    for (const [source, event, callback] of listeners.splice(0)) {
      if (source.removeListener) source.removeListener(event, callback);
      else source.off?.(event, callback);
    }
    started = false;
    currentRequest = lastDiagnostics = lastActualInjection = lastPreview = null;
    notify('stopped');
  }

  const runtime = {
    start, stop, handleGeneration, expandMacro, previewCurrent,
    isBooted: () => started,
    isMacroRegistered: () => Boolean(macroContext),
    getLastDiagnostics: () => clone(lastDiagnostics),
    getLastActualInjection: () => clone(lastActualInjection),
    getLastPreview: () => clone(lastPreview),
    readSettings: async () => { refreshCaches(); return clone(settings); },
    readTextOverrides: async () => { refreshCaches(); return clone(textOverrides); },
    readUIPreferences: async () => { refreshCaches(); return clone(uiPreferences); },
    saveSettings: value => saveField(engine.data.settingsKey, value, engine.normalizeSettings),
    saveTextOverrides: value => saveField(engine.data.textOverrideKey, value, engine.normalizeTextOverrides),
    saveUIPreferences: value => saveField(engine.data.uiPreferencesKey, value, engine.normalizeUIPreferences),
    async saveTextOverride(packageId, calendarSegmentId, body) {
      const variant = engine.editableVariantsForPackage(packageId).find(item => (item.calendarSegmentId || null) === (calendarSegmentId || null));
      if (!variant) throw new Error('找不到当前资料包正文分支');
      await store.update(draft => {
        const next = engine.normalizeTextOverrides(draft[engine.data.textOverrideKey]);
        next.records[variant.slotKey] = engine.createOverrideRecord(variant, body);
        delete next.orphans[variant.slotKey];
        draft[engine.data.textOverrideKey] = next;
      });
      refreshCaches(); return clone(textOverrides);
    },
    async removeTextOverride(packageId, calendarSegmentId) {
      const variant = engine.editableVariantsForPackage(packageId).find(item => (item.calendarSegmentId || null) === (calendarSegmentId || null));
      if (!variant) throw new Error('找不到当前资料包正文分支');
      await store.update(draft => { const next = engine.normalizeTextOverrides(draft[engine.data.textOverrideKey]); delete next.records[variant.slotKey]; draft[engine.data.textOverrideKey] = next; });
      refreshCaches(); return clone(textOverrides);
    },
    exportTextOverrides: () => engine.serializeTextOverrides(textOverrides),
    async importTextOverrides(value) {
      const parsed = engine.parseTextOverrideImport(value, textOverrides);
      parsed.store = await saveField(engine.data.textOverrideKey, parsed.store, engine.normalizeTextOverrides);
      return clone(parsed);
    }
  };
  refreshCaches();
  return { get runtime() { return runtime; }, get engine() { return engine; }, start, stop, async refresh() { refreshCaches(); notify('refreshed'); return engine; }, preview: previewCurrent };
}
