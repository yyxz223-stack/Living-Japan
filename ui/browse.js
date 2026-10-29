import { $, $$, esc, button } from './dom.js';

// LJ-EXT-GEOGRAPHY: hierarchy browsing, selection and map location are separate actions.
export function mountBrowser(ui) {
  const catalog=ui.bridge.catalog, desktop=ui.layout==='desktop';
  const list=$(desktop?'#loc10List':'#regionList'), tree=$(desktop?'.loc10-tree':'#regionTree'), search=$(desktop?'#loc10Search':'#regionSearch');
  const modified=$(desktop?'#loc10ModifiedOnly':'#regionModifiedOnly');
  const top=catalog.navigationRoot;
  const state=ui.state.browser||{current:top,offset:0,query:'',selectedId:null,expanded:[],modified:false};
  if(state.current==='admin:jp')state.current=top;
  const expanded=new Set(state.expanded);let {current,offset,query,selectedId}=state;let request=0,items=[],modifiedPackages=new Set();
  search.value=query;if(modified)modified.checked=state.modified;
  if(desktop){$('#loc10DetailName').textContent='选择地点';$('#loc10DetailKind').textContent='';$('#loc10DetailBody').innerHTML='<div class="lj-empty">选择本层地点查看正文；「下级」进入它的行政下层。</div>';}
  const remember=()=>{ui.state.browser={current,offset,query,selectedId,expanded:[...expanded],modified:Boolean(modified?.checked)};};
  const admin=e=>e?.type==='行政区'||e?.browseOnly;
  const pathLabel=e=>(e?.adminNodes||[]).filter(n=>n.id!=='admin:jp').map(n=>n.label||n.name||n.nameJa).filter(Boolean).join(' › ');
  function hasDraft(e){return ui.reader.packageIds(e).some(id=>modifiedPackages.has(id));}
  function row(e){const isAdmin=admin(e);return `<li class="lj-row ${e.id===selectedId?'selected':''}" data-entity-row="${esc(e.id)}"><button class="lj-namebutton" data-select="${esc(e.id)}"><span class="lj-name">${esc(e.name||e.label)}</span><span class="lj-meta">${esc(e.type||e.kind||'行政区域')}${isAdmin?'':` · ${hasDraft(e)?'有修改稿':(e.packageIds||[]).length?'已有正文空位':'可补写'}${e.coordinates?'':' · 坐标未收录'}`}</span></button>${isAdmin?`<button class="lj-enter" data-enter="${esc(e.id)}">下级 ›</button>`:button('查看','browse-read',`data-id="${esc(e.id)}"`)}</li>`;}
  async function renderTree(){
    if(!tree)return;
    remember();
    const walk=async(id,depth)=>{const e=catalog.get(id);if(!e)return'';const children=catalog.navigationChildren(id);return `<div class="lj-row" style="padding-left:${6+depth*13}px"><button class="lj-arrow" data-expand="${esc(id)}" aria-label="${expanded.has(id)?'收起':'展开'}${esc(e.name)}" aria-expanded="${expanded.has(id)}">${children.length?(expanded.has(id)?'⌄':'›'):''}</button><button class="lj-namebutton" data-select="${esc(id)}"><span class="lj-name">${esc(e.name||e.label)}</span></button><button class="lj-enter" data-enter="${esc(id)}">下级</button></div>${expanded.has(id)?(await Promise.all(children.map(n=>walk(n.id,depth+1)))).join(''):''}`;};
    tree.innerHTML=(await Promise.all(catalog.navigationChildren(top).map(n=>walk(n.id,0)))).join('');
  }
  function crumbs(){const nodes=catalog.navigationPath(current);const html=[`<button class="lj-button" data-enter="${esc(top)}">地理大区</button>`,...nodes.map(n=>`<button class="lj-button" data-enter="${esc(n.id)}">${esc(n.name||n.label)}</button>`)].join('<span>›</span>');
    if(desktop){$('#loc10AdminHead').innerHTML='<b>地区分类</b>';$('#loc10ListHead').innerHTML=`<div class="lj-inline">${html}</div>`;}else{for(const node of $$('#regionCrumb,#regionDrawerCrumb'))node.innerHTML=html;}
  }
  async function render(){
    if(!list)return;const ticket=++request;
    modifiedPackages=new Set(Object.values(ui.bridge.store.read().livingJapanTextOverrides.records).map(r=>r.packageId));
    list.innerHTML='<div class="lj-empty">正在读取本层资料…</div>';crumbs();
    try{
      let found=query?await catalog.search(query,{regionCode:ui.state.regionCode,limit:100}):await catalog.children(current,{offset,limit:48});
      if(ticket!==request)return;const hasNext=found.length===48;if(modified?.checked)found=found.filter(hasDraft);items=found;
      list.innerHTML=found.map(row).join('')||'<div class="lj-empty">本层没有符合筛选的地点。</div>';
      if(query)list.insertAdjacentHTML('afterbegin',`<div class="lj-page-note">名称、别名、类型 · 当前地区搜索</div>`);
      else list.insertAdjacentHTML('beforeend',`<div class="lj-inline" style="padding:8px">${offset?button('上一页','browse-prev'):''}${hasNext?button('下一页','browse-next'):''}</div>`);
      if(!desktop&&selectedId&&catalog.get(selectedId)){const rowNode=$(`[data-entity-row="${CSS.escape(selectedId)}"]`,list);rowNode?.insertAdjacentHTML('afterend',detail(catalog.get(selectedId)));}
    }catch(error){if(ticket===request)list.innerHTML=`<div class="lj-empty">${esc(error.message)} ${button('重试','browse-retry')}</div>`;}
    await renderTree();
  }
  function detail(e){if(e.browseOnly)return `<article class="lj-detail"><h3>${esc(e.name)}</h3><p>地理大区</p><div class="lj-body-list">${catalog.navigationChildren(e.id).map(n=>`<button class="lj-button" data-enter="${esc(n.id)}">${esc(n.name)} ›</button>`).join('')}</div></article>`;const ids=ui.reader.packageIds(e);return `<article class="lj-detail"><h3>${esc(e.name||e.label)}</h3><p>${esc([e.type,pathLabel(e)].filter(Boolean).join(' · '))}</p><div class="lj-status">${e.coordinates?'已收录地图坐标':'坐标尚未收录，仍可阅读和保存正文。'}</div><div class="lj-body-list">${ids.map(id=>{const p=ui.engine.data.packages.find(x=>x.id===id);return button(p?.displayName||e.name,'browse-body',`data-package="${esc(id)}" data-id="${esc(e.id)}"`);}).join('')}</div><div class="lj-inline">${button('地图定位','browse-map',`data-id="${esc(e.id)}" ${e.coordinates?'':'disabled'}`)}${button(ids.length?'阅读／编辑':'从空白补写','browse-read',`data-id="${esc(e.id)}"`)}${button('新增正文空位','browse-new',`data-id="${esc(e.id)}"`)}${button('追加名称','browse-append',`data-id="${esc(e.id)}"`)}</div></article>`;}
  async function select(id){const e=catalog.get(id);if(!e)return;selectedId=id;remember();if(!e.browseOnly)await ui.selectEntity(e,{page:false});if(desktop){$('#loc10DetailName').textContent=e.name||e.label;$('#loc10DetailKind').textContent=e.type||'行政区域';$('#loc10DetailBody').innerHTML=detail(e);list.querySelectorAll('[data-entity-row]').forEach(n=>n.classList.toggle('selected',n.dataset.entityRow===id));}else await render();}
  async function enter(id){if(!(await ui.reader.close()))return;const e=catalog.get(id);if(!e&&id!==top)return;current=id;offset=0;query='';search.value='';if(e?.regionCode){ui.state.regionCode=e.regionCode;await catalog.loadRegion(e.regionCode);}for(const a of catalog.navigationPath(id))expanded.add(a.id);expanded.add(id);$('#regionDrawer')?.setAttribute('hidden','');await render();}
  const root=$(desktop?'#ljLocationsPage':'[data-page-root="region"]');
  root?.addEventListener('click',async event=>{
    const n=event.target.closest('button');if(!n)return;
    try{
      if(n.dataset.expand){const id=n.dataset.expand;if(expanded.has(id))expanded.delete(id);else expanded.add(id);await renderTree();}
      else if(n.dataset.enter)await enter(n.dataset.enter);
      else if(n.dataset.select)await select(n.dataset.select);
      else if(n.id==='openRegionDrawer'){$('#regionDrawer').hidden=false;await renderTree();}
      else if(n.id==='closeRegionDrawer')$('#regionDrawer').hidden=true;
      else if(n.dataset.action?.startsWith('browse-')){const action=n.dataset.action,e=catalog.get(n.dataset.id);
        if(action==='browse-next'){offset+=48;await render();}if(action==='browse-prev'){offset=Math.max(0,offset-48);await render();}if(action==='browse-retry')await render();
        if(action==='browse-map'){await ui.selectEntity(e,{locate:true});await ui.showPage('map');}
        if(action==='browse-read')await ui.openReader(e);
        if(action==='browse-body')await ui.openReader(e,n.dataset.package);
        if(action==='browse-append')ui.append(e);
        if(action==='browse-new'){const id=await ui.reader.newSlot(e);if(id)await ui.openReader(e,id,true);}
      }
    }catch(error){ui.notify(error.message,'error');}
  });
  let timer;search?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{query=search.value.trim();offset=0;render();},160);});search?.setAttribute('placeholder','搜索名称、内置别名或类型');
  modified?.addEventListener('change',render);
  return{render,async locate(entity){selectedId=entity.id;await enter(entity.adminPath?.at(-1)||top);await select(entity.id);}};
}
