import { loadBaseline, addUserSlotsToData } from './baseline.js';
import { createSession } from './session.js';
import { createUserStore, createSillyTavernTransport } from './storage.js';
import { createUpdateManager } from './updates.js';
import { createCatalog } from './catalog.js';

// LJ-EXT-COMPOSITION: assemble independent data, storage, session and approved UI modules.
export async function startLivingJapan({ baseUrl, context: suppliedContext } = {}) {
  const context = suppliedContext || globalThis.SillyTavern?.getContext?.();
  if (!context) throw new Error('请在 SillyTavern 中启用扩展，或打开独立预览入口');
  const button = document.createElement('button');
  button.id = 'living-japan-open'; button.textContent = 'LJ'; button.title = '打开 Living Japan';
  button.setAttribute('aria-label', '打开 Living Japan');
  document.body.append(button);
  const started = performance.now();
  const baseline = await loadBaseline(baseUrl, { fetcher: fetch });
  const store = createUserStore({
    transport: createSillyTavernTransport({ context, fetcher: fetch }),
    initialData: {
      livingJapanSettings: baseline.data.defaultSettings,
      livingJapanUIPreferences: baseline.data.defaultUIPreferences || {},
    },
    knownSlots: container => addUserSlotsToData(baseline.data, container.customSlots).editableTextSlots.slots,
  });
  await store.load();
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const session = createSession({ engine: baseline.engine, store, context: () => suppliedContext || globalThis.SillyTavern.getContext(), onChange: emit });
  await session.start();
  const catalog = createCatalog({ baseData: baseline.data, baseUrl, fetcher: fetch });
  await catalog.loadIndex();
  const updates = createUpdateManager({ context, extensionName: String(baseUrl).split('/').filter(Boolean).at(-1) || 'Living-Japan' });
  let shell = null, frame = null, activeLayout = null;
  let requestedLayout = store.read().extensionUi?.layout || 'auto';
  const isPinned=data=>(data.extensionUi?.pinned??data.livingJapanUIPreferences?.panelPinned)!==false;
  let pinned=isPinned(store.read());
  const state = { regionCode: 'metro', selectedId: null, routeOrigin: null, routeDestination: null, travelMode: 'public_transit', page: 'map', history: [] };
  function layout() { return window.innerWidth <= 600 ? 'mobile' : requestedLayout === 'portrait' ? 'portrait' : requestedLayout === 'mobile' ? 'mobile' : 'desktop'; }
  function renderFrame() {
    const next = layout();
    shell.dataset.layout = next;
    if (activeLayout === next) return;
    activeLayout = next;
    frame.src = new URL(`ui/${next}.html`, baseUrl).href;
  }
  async function close() {
    const view = frame?.contentWindow?.LivingJapanView;
    if (view?.leave && !(await view.leave())) return;
    if (shell) shell.hidden = true;
  }
  async function open() {
    if (!shell) {
      shell = document.createElement('section'); shell.id = 'living-japan-shell'; shell.setAttribute('aria-label', 'Living Japan');
      frame = document.createElement('iframe'); frame.title = 'Living Japan 工作区';
      const exit = document.createElement('button'); exit.id = 'living-japan-close'; exit.textContent = '×'; exit.title = '收起 Living Japan'; exit.setAttribute('aria-label', '收起 Living Japan'); exit.addEventListener('click', close);
      shell.append(frame, exit); document.body.append(shell);
    }
    shell.hidden = false; renderFrame();
  }
  const bridge = {
    baseline, session, store, catalog, updates, context, baseUrl, state,
    get engine() { return session.engine; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async refresh() { await session.refresh(); emit(); },
    async setLayout(value) {
      if (!['auto', 'desktop', 'portrait', 'mobile'].includes(value)) return;
      if (frame?.contentWindow?.LivingJapanView?.leave && !(await frame.contentWindow.LivingJapanView.leave())) return;
      await store.update(data => { data.extensionUi = { ...data.extensionUi, layout: value }; return data; });
      requestedLayout = value; if (shell) renderFrame();
    },
    append(name) { return session.engine.appendPlaceNameToChatInput(document, session.engine.outputTextForScript(name,session.engine.normalizeSettings(store.read().livingJapanSettings))); },
    appendTraffic(text) { return session.engine.appendTrafficToChatInput(document, session.engine.outputTextForScript(text,session.engine.normalizeSettings(store.read().livingJapanSettings))); },
    open, close,
    metrics: { startupMs: Math.round(performance.now() - started), baselineRelease: baseline.data.releaseId },
    destroy() { session.stop(); catalog.destroy?.(); document.removeEventListener('click',outsideClick); unsubscribeStore(); shell?.remove(); button.remove(); listeners.clear(); },
  };
  globalThis.LivingJapanBridge = bridge;
  button.addEventListener('click', open);
  button.disabled = false;
  const position = store.read().extensionUi?.entryPosition;
  if (position) { button.style.left = `${Math.max(0, Math.min(innerWidth - 42, position.x))}px`; button.style.top = `${Math.max(0, Math.min(innerHeight - 42, position.y))}px`; button.style.right = 'auto'; }
  let drag = null, dragged = false;
  button.addEventListener('pointerdown', event => { drag = {x:event.clientX,y:event.clientY,left:button.offsetLeft,top:button.offsetTop}; dragged = false; button.setPointerCapture(event.pointerId); });
  button.addEventListener('pointermove', event => { if (!drag) return; const dx=event.clientX-drag.x,dy=event.clientY-drag.y; if(Math.hypot(dx,dy)<6&&!dragged)return; dragged=true; button.style.left=`${Math.max(0,Math.min(innerWidth-42,drag.left+dx))}px`; button.style.top=`${Math.max(0,Math.min(innerHeight-42,drag.top+dy))}px`;button.style.right='auto'; });
  button.addEventListener('pointerup', async()=>{ if(dragged) { await store.update(data=>{data.extensionUi={...data.extensionUi,entryPosition:{x:button.offsetLeft,y:button.offsetTop}};return data;}).catch(console.error); } drag=null; });
  button.addEventListener('click', event=>{if(dragged){event.stopImmediatePropagation();dragged=false;}},true);
  const outsideClick=event=>{if(shell&&!shell.hidden&&!pinned&&!shell.contains(event.target)&&!button.contains(event.target))void close();};
  document.addEventListener('click',outsideClick);
  const unsubscribeStore=store.subscribe(data => { pinned=isPinned(data);button.style.filter = data.livingJapanSettings.masterEnabled === false ? 'grayscale(1)' : ''; emit(); });
  return bridge;
}
