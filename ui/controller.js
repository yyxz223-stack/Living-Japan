import { $, $$, esc, ask, status, applyTheme } from './dom.js';
import { createReader } from './reader.js';
import { mountBrowser } from './browse.js';
import { mountMaterials } from './materials.js';
import { mountSettings } from './settings.js';
import { mountDiagnostics } from './diagnostics.js';
import { mountMap } from './map.js';

// LJ-EXT-VIEW: the approved three layouts share the same live state and operations.
const bridge=parent.LivingJapanBridge, layout=document.body.dataset.layout;
const pageIds={map:'ljMapPage',region:'ljLocationsPage',package:'ljPackagesPage',diagnostic:'ljDiagnosticsPage',settings:'ljSettingsPage'};
let modules={}, refreshing=false;
const ui={bridge,layout,state:bridge.state,esc,ask,notify:status,
  get engine(){return bridge.session.engine;},
  getEntityForPackage(id){
    const p=ui.engine.data.packages.find(x=>x.id===id);if(!p)return null;
    const known=bridge.catalog.get(p.placeId);if(known)return known;
    const custom=Object.values(bridge.store.read().customSlots).find(s=>'LJ_USER_'+encodeURIComponent(s.id)===id);
    return {id:custom?.entityId||p.placeId||`package:${id}`,legacyPlaceId:p.placeId,name:custom?.name||p.displayName,packageIds:[id],adminPath:custom?.adminPath||[],adminNodes:custom?.adminNodes||[],coordinates:custom?.coordinates||null,regionCode:custom?.regionCode||null,type:p.channel||'资料'};
  },
  async showPage(page){
    page=({locations:'region',packages:'package',check:'diagnostic'})[page]||page;
    if(!pageIds[page])return;
    if(!(await ui.reader.close()))return;
    if(ui.state.page==='settings'&&page!=='settings'&&modules.settings.requestLeave&&!(await modules.settings.requestLeave()))return;
    ui.state.page=page;
    if(layout==='desktop')for(const [key,id]of Object.entries(pageIds))$('#'+id).hidden=key!==page;
    else{$$('[data-page-root]').forEach(n=>{const active=n.dataset.pageRoot===page;n.hidden=!active;n.classList.toggle('active',active);});$$('[data-go]').forEach(n=>n.classList.toggle('active',n.dataset.go===page));}
    await modules[page]?.render?.();
  },
  async selectEntity(entity,options={}){if(!entity)return;ui.state.selected=entity;ui.state.selectedId=entity.id;await modules.map?.select?.(entity,options);},
  async openReader(entity,packageId,editing=false){if(!entity&&packageId)entity=ui.getEntityForPackage(packageId);if(entity)await ui.reader.open(entity,packageId,editing);},
  append(entity){const name=typeof entity==='string'?entity:entity?.name;if(!name)return;const result=bridge.append(name);ui.notify(result?.ok?'名称已追加到输入框':result?.error||'没有找到聊天输入框',result?.ok?'':'error');return result;},
  async refresh(){if(refreshing)return;refreshing=true;try{await bridge.session.refresh();renderTools();await modules[ui.state.page]?.render?.();}finally{refreshing=false;}},
};
ui.reader=createReader(ui);
modules.region=mountBrowser(ui);modules.package=mountMaterials(ui);modules.settings=mountSettings(ui);modules.diagnostic=mountDiagnostics(ui);modules.map=mountMap(ui);
function renderTools(){
  const data=bridge.store.read(),settings=ui.engine.normalizeSettings(data.livingJapanSettings),prefs=data.extensionUi||{};
  applyTheme(prefs.theme||'auto');
  for(const n of $$('.auto-scan7,#autoScanToggle,[data-action="master-toggle"]')){n.setAttribute('aria-pressed',String(settings.masterEnabled!==false));n.classList.toggle('on',settings.masterEnabled!==false);}
  const pinned=(prefs.pinned??data.livingJapanUIPreferences?.panelPinned)!==false;
  for(const n of $$('#lockButton,.tools7 button[title^="锁定界面"]')){n.setAttribute('aria-pressed',String(pinned));n.classList.toggle('active',pinned);n.classList.toggle('on',pinned);}
}
async function savePreference(key,value){await bridge.store.update(data=>{data.extensionUi={...data.extensionUi,[key]:value};return data;});renderTools();}
document.addEventListener('click',async event=>{
  const n=event.target.closest('button');if(!n)return;
  try{
    if(n.dataset.go&&n.dataset.go!=='fullmap'){await ui.showPage(n.dataset.go);return;}
    if(n.closest('.nav7')){const page={'地图':'map','地点':'region','地区':'region','资料':'package','检查':'diagnostic','诊断':'diagnostic'}[n.textContent.trim()];if(page)await ui.showPage(page);return;}
    const title=n.getAttribute('title')||'';
    if(n.id==='settingsButton'||(n.closest('.tools7')&&title==='设置'))await ui.showPage('settings');
    if(n.id==='themeButton'||title.startsWith('切换明暗')){const current=document.body.dataset.theme;await savePreference('theme',current==='night'?'day':'night');}
    if(n.id==='lockButton'||title.startsWith('锁定界面')){const data=bridge.store.read();await savePreference('pinned',(data.extensionUi?.pinned??data.livingJapanUIPreferences?.panelPinned)===false);}
    if(title==='关闭')await bridge.close();
    if(title.startsWith('切换横版'))await bridge.setLayout(layout==='desktop'?'portrait':'desktop');
    if(title==='切换到横版')await bridge.setLayout('desktop');
    if(n.matches('.auto-scan7,#autoScanToggle,[data-action="master-toggle"]')){const settings=ui.engine.normalizeSettings(bridge.store.read().livingJapanSettings);settings.masterEnabled=!settings.masterEnabled;await bridge.session.runtime.saveSettings(settings);ui.notify(settings.masterEnabled?'自动提示注入已开启':'自动提示注入已暂停');renderTools();}
  }catch(error){ui.notify(error.message,'error');}
});
document.addEventListener('living-japan-settings-tab',async event=>{await ui.showPage('settings');modules.settings.openTab?.(event.detail?.tab||event.detail||'reading');});
const unsubscribe=bridge.subscribe(()=>{renderTools();if(['diagnostic','map'].includes(ui.state.page))modules[ui.state.page]?.render?.();});
globalThis.LivingJapanView={ui,modules,async leave(){if(!(await ui.reader.close()))return false;return modules.settings.requestLeave?modules.settings.requestLeave():true;}};
window.addEventListener('unload',()=>{unsubscribe();modules.map?.destroy?.();},{once:true});
try{renderTools();await ui.showPage(ui.state.page||'map');$('#ljLoading').remove();}catch(error){$('#ljLoading').textContent=`资料读取失败：${error.message}`;console.error(error);}
