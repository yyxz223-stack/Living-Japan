import { $, $$, esc, button, ask } from './dom.js';
import { userPackageId } from '../src/baseline.js';

// LJ-EXT-READER: one text-slot editor shared by map, geography and material entries.
export function createReader(ui) {
  let active=null, overlay=null, mode='read', base='', buffer='', busy=false;
  const buffers=new Map();
  const engine=()=>ui.bridge.session.engine;
  const saved=variant=>ui.bridge.store.read().livingJapanTextOverrides.records[variant.slotKey]?.body ?? variant.body ?? '';
  function packageIds(entity) { return [...new Set([...(entity.packageIds||[]),...engine().data.packages.filter(p=>p.placeId===(entity.legacyPlaceId||entity.id)||p.placeId===entity.id).map(p=>p.id)])]; }
  function variantsFor(entity) { return packageIds(entity).flatMap(id=>engine().editableVariantsForPackage(id).map(v=>({...v,title:engine().data.packages.find(p=>p.id===id)?.displayName||entity.name}))); }
  function isDirty() { return Boolean(active&&buffer!==base); }
  async function save() {
    if(!active||busy)return false;
    const target=active.variant,body=buffer;
    busy=true;render();
    try { await ui.bridge.session.runtime.saveTextOverride(target.packageId,target.calendarSegmentId,body);base=saved(target);buffer=base;buffers.delete(target.slotKey);ui.notify('修改稿已保存并读回');ui.refresh();return true; }
    catch(error){ui.notify(error.message,'error');return false;}
    finally{busy=false;render();}
  }
  async function leave() {
    if(busy){ui.notify('正在保存并读回，请稍候');return false;}
    if(!isDirty())return true;
    const result=await ui.ask({title:'还有未保存的修改',message:'离开前可以保存，也可以放弃这次修改。',choices:[{id:'cancel',label:'继续编辑'},{id:'discard',label:'放弃修改'},{id:'save',label:'保存并离开',primary:true}]});
    if(result==='save')return save();
    if(result==='discard'){buffers.delete(active.variant.slotKey);buffer=base;return true;}
    return false;
  }
  function closeNow() {overlay?.remove();overlay=null;active=null;}
  async function close() {if(await leave()){closeNow();return true;}return false;}
  async function newSlot(entity) {
    const result=await ask({title:'新增正文空位',message:`为“${entity.name}”保存一份独立正文。空位数量可继续增加。`,fields:[{id:'title',label:'正文名称',value:`${entity.name} · 新正文`},{id:'layer',label:'所属资料',options:[{value:'EX',label:'外部地域'},{value:'IN',label:'内部场所'}]}],choices:[{id:'cancel',label:'取消'},{id:'create',label:'建立空位',primary:true}]});
    if(result.id!=='create')return null;
    const id=crypto.randomUUID(), definition={id,entityId:entity.legacyPlaceId||entity.id,name:entity.name,title:result.values.title.trim()||entity.name,layer:result.values.layer,adminPath:entity.adminPath||[],adminNodes:entity.adminNodes||[],aliases:entity.aliases||[],fullNames:[entity.name],type:entity.type,coordinates:entity.coordinates||null,regionCode:entity.regionCode||ui.state.regionCode};
    await ui.bridge.store.update(data=>{data.customSlots[id]=definition;return data;});await ui.bridge.refresh();
    return userPackageId(id);
  }
  async function open(entity, packageId=null, editing=false) {
    if(!(await leave()))return;
    let variants=variantsFor(entity), filtered=packageId?variants.filter(v=>v.packageId===packageId):variants;
    if(!variants.length){const id=await newSlot(entity);if(!id)return;variants=variantsFor(entity);filtered=variants.filter(v=>v.packageId===id);editing=true;}
    if(!filtered.length)filtered=variants;
    active={entity,variants,variant:filtered[0]};base=saved(active.variant);buffer=buffers.get(active.variant.slotKey)??base;mode=editing?'edit':'read';mount();render();
  }
  function mount() {
    overlay?.remove();overlay=document.createElement('section');overlay.className='lj-reader-overlay';overlay.setAttribute('aria-label','正文阅读与编辑');
    const root=ui.layout==='desktop'?$('#work7:not([hidden]),#loc10Window')?.closest('[id$="Page"]')?.querySelector('.work7'):$('#device');
    const desktopRoot=$$('.work7').find(n=>!n.closest('[hidden]'));
    (ui.layout==='desktop'?desktopRoot||document.body:root||document.body).append(overlay);
    overlay.addEventListener('click',async event=>{const target=event.target.closest('[data-reader]');if(!target||busy)return;const action=target.dataset.reader;
      if(action==='close')await close();
      if(['read','original','edit'].includes(action)){mode=action;render();}
      if(action==='save')await save();
      if(action==='restore'){
        const confirmed=await ui.ask({title:'恢复当前正文的内置原文',message:'只移除当前这份修改稿，其他正文和空位保持不变。',choices:[{id:'cancel',label:'取消'},{id:'restore',label:'恢复原文',primary:true}]});
        if(confirmed==='restore'){try{await ui.bridge.session.runtime.removeTextOverride(active.variant.packageId,active.variant.calendarSegmentId);base=saved(active.variant);buffer=base;buffers.delete(active.variant.slotKey);ui.notify('当前正文已恢复原文');ui.refresh();render();}catch(error){ui.notify(error.message,'error');}}
      }
      if(action==='new'){if(!(await leave()))return;const entity=active.entity;const id=await newSlot(entity);if(id)await open(entity,id,true);}
    });
    overlay.addEventListener('input',event=>{if(event.target.matches('textarea')){buffer=event.target.value;buffers.set(active.variant.slotKey,buffer);const status=$('[data-reader-state]',overlay);status.textContent=isDirty()?'有未保存修改':'与已保存内容一致';const saveButton=$('[data-reader="save"]',overlay);saveButton.disabled=busy||!isDirty();}});
    overlay.addEventListener('change',async event=>{if(event.target.matches('select')){const key=event.target.value;if(!(await leave())){event.target.value=active.variant.slotKey;return;}active.variant=active.variants.find(v=>v.slotKey===key);base=saved(active.variant);buffer=buffers.get(key)??base;render();}});
  }
  function render() {
    if(!overlay||!active)return;
    const v=active.variant, record=ui.bridge.store.read().livingJapanTextOverrides.records[v.slotKey], changed=record&&record.baseBuiltinSha256!==v.bodySha256;
    overlay.innerHTML=`<header class="lj-reader-head"><button class="lj-button" data-reader="close">← 返回</button><strong>${esc(active.entity.name)}</strong><button class="lj-button" data-reader="new">新增空位</button></header><div class="lj-reader-tabs">${[['read','有效正文'],['original','内置原文'],['edit','编辑修改稿']].map(([id,label])=>`<button class="lj-button ${mode===id?'primary':''}" data-reader="${id}" aria-pressed="${mode===id}">${label}</button>`).join('')}<select class="lj-select" aria-label="正文与日期分支">${active.variants.map(variant=>`<option value="${esc(variant.slotKey)}" ${variant.slotKey===v.slotKey?'selected':''}>${esc(variant.title+(variant.calendarSegmentId?' · '+variant.label:''))}</option>`).join('')}</select></div><div class="lj-reader-main"><div class="lj-status">${esc(changed?'内置原文已更新；你的修改稿已保留。':record?'当前使用你保存的修改稿。':v.body?'当前使用内置原文。':'此空位尚无正文，可以补写。')}</div>${mode==='edit'?`<textarea aria-label="编辑修改稿" spellcheck="false">${esc(buffer)}</textarea>`:`<article tabindex="0">${esc(mode==='original'?(v.body||'此空位没有内置原文。'):(saved(v)||'此空位尚未保存正文。'))}</article>`}</div><footer class="lj-reader-footer"><span class="lj-status" data-reader-state>${busy?'正在保存并确认…':isDirty()?'有未保存修改':'当前没有待保存修改'}</span><button class="lj-button" data-reader="restore" ${record?'':'disabled'}>恢复内置原文</button><button class="lj-button primary" data-reader="save" ${busy||!isDirty()?'disabled':''}>保存修改稿</button></footer>`;
    if(busy)overlay.querySelectorAll('button,textarea,select').forEach(node=>{node.disabled=true;});
  }
  window.addEventListener('beforeunload',event=>{if(isDirty()){event.preventDefault();event.returnValue='';}});
  return {open,close,leave,isDirty,packageIds,variantsFor,newSlot,render};
}
