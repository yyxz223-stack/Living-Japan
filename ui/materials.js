// LJ-EXT-MATERIALS
const layerNames = { TN: '时间与自然', EX: '外部地域', IN: '内部场所', EV: '明确场景' };
const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
const copy = value => JSON.parse(JSON.stringify(value));

export function buildMaterialsModel(engine) {
  const data = engine.data, nodes = new Map(), packageNodes = new Map();
  const controls = new Map(data.controlGroups.map(group => [group.controlGroupId, group]));
  const register = node => { nodes.set(node.id, node); return node; };
  const roots = data.layerOrder.map(layer => register({ id: 'layer:' + layer, name: layerNames[layer], layer, kind: 'layer', type: '资料层', parentId: null, children: [], control: { kind: 'layer', id: layer }, terms: [layerNames[layer]] }));
  for (const group of data.controlGroups.filter(group => group.kind === 'administrative')) {
    const admin = data.adminNodes.find(node => node.id === group.adminNodeId) || {};
    register({ id: 'admin:' + group.controlGroupId, name: group.label, layer: group.layer, kind: 'administrative', type: '行政分支', parentId: group.parentControlGroupId ? 'admin:' + group.parentControlGroupId : 'layer:' + group.layer, children: [], control: { kind: 'group', id: group.controlGroupId }, terms: [group.label, admin.nameJa, ...((data.placeNameAliases?.administrativeNames || {})[group.label] || []), ...((data.placeNameAliases?.administrativeNames || {})[admin.nameJa] || [])] });
  }
  for (const item of data.packages) {
    const group = controls.get(item.uiGroupId);
    let parentId = item.administrativeControlGroupIds?.length ? 'admin:' + item.administrativeControlGroupIds.at(-1) : 'layer:' + item.layer;
    if (!nodes.has(parentId)) parentId = 'layer:' + item.layer;
    if (group?.mode !== 'singleton') {
      const viewId = 'group:' + item.layer + ':' + parentId + ':' + item.uiGroupId;
      if (!nodes.has(viewId)) register({ id: viewId, name: group?.label || item.parentGroup || item.uiGroupId, layer: item.layer, kind: 'group', type: '资料组', parentId, children: [], control: { kind: 'group', id: item.uiGroupId }, terms: [group?.label || item.parentGroup || item.uiGroupId] });
      parentId = viewId;
    }
    const presentation = engine.getPlacePresentation(item);
    const place = data.places.find(place => place.placeId === item.placeId);
    const node = register({ id: 'package:' + item.id, name: item.displayName, layer: item.layer, kind: 'package', type: (presentation.typeLabels || []).join('／') || (item.placeKind === 'station' ? '站点正文' : '正文'), parentId, children: [], packageId: item.id, package: item, control: { kind: 'package', id: item.id }, terms: [item.displayName, ...(item.fullTriggers || []), ...(item.aliasTriggers || []), ...(place?.aliases || []), ...(presentation.searchTerms || []), ...((data.placeNameAliases?.objects || {})[item.sourceObjectId] || [])] });
    packageNodes.set(item.id, node);
  }
  for (const node of nodes.values()) {
    if (node.parentId) nodes.get(node.parentId)?.children.push(node.id);
    node.searchText = normalized([...node.terms, node.type].filter(Boolean).join(' '));
  }
  const path = id => { const result = []; let node = nodes.get(typeof id === 'string' ? id : id.id); while (node) { result.unshift(node); node = nodes.get(node.parentId); } return result; };
  return { roots, nodes, packageNodes, path, search(query) { const q = normalized(query); return q ? [...nodes.values()].filter(node => node.searchText.includes(q)) : []; } };
}

export function applyMaterialSelection(settings, selectedNodes, enabled) {
  const next = copy(settings);
  for (const node of selectedNodes) {
    const target = node.control.kind === 'layer' ? next.layers : node.control.kind === 'package' ? next.packages : next.groups;
    target[node.control.id] = Boolean(enabled);
  }
  return next;
}

export function materialState(node, settings, model) {
  const ownValue = part => (part.control.kind === 'layer' ? settings.layers : part.control.kind === 'package' ? settings.packages : settings.groups)[part.control.id] !== false;
  const reasons = [];
  if (!settings.masterEnabled) reasons.push('自动扫描已关闭');
  for (const part of model.path(node.id)) if (!ownValue(part)) reasons.push(part.name + (part.kind === 'package' ? '本级正文已关闭' : '分支已暂停'));
  if (node.package?.sourceObjectId && settings.namedPlaceBodiesEnabled === false) reasons.push('具名地点正文已暂停');
  if (node.package) {
    for (const id of node.package.controlGroupIds || []) {
      if (settings.groups[id] !== false || model.path(node.id).some(part => part.control.id === id)) continue;
      reasons.push('共享对象开关已暂停');
    }
  }
  return { own: ownValue(node), effective: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function materialPage(rows, offset = 0, pageSize = 24) {
  const size = Math.min(48, Math.max(1, pageSize));
  const start = Math.min(Math.max(0, offset), Math.max(0, Math.floor((rows.length - 1) / size) * size));
  return { rows: rows.slice(start, start + size), offset: start, total: rows.length, hasPrevious: start > 0, hasNext: start + size < rows.length, pageSize: size };
}

export function mountMaterials(ui) {
  const desktop = ui.layout === 'desktop';
  const doc = document, select = id => doc.getElementById(id);
  const esc = ui.esc || (value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]));
  const list = select(desktop ? 'pkg10List' : 'packageList');
  if (!list) return { render() {}, locate() {} };
  const root = list.closest(desktop ? '#ljPackagesPage' : '[data-page-root]') || list.parentElement.parentElement;
  const roots = select(desktop ? 'pkg10Roots' : 'packageRoots');
  const crumbs = select(desktop ? 'pkg10Crumbs' : 'packageCrumbs');
  const currentSwitch = select(desktop ? 'pkg10CurrentSwitch' : 'packageCurrentSwitch');
  const effective = select(desktop ? 'pkg10Effective' : 'packageEffective');
  const sibling = select(desktop ? 'pkg10SiblingSelect' : 'packageSibling');
  const back = select(desktop ? 'pkg10Back' : 'packageBack');
  const modified = select(desktop ? 'pkg10ModifiedOnly' : 'packageModifiedOnly');
  const state = ui.state.materials ||= { currentId: 'layer:TN', query: '', offset: 0, multi: false, selected: [], modified: false, drill: false, source: null, searchBase: null, highlighted: null };
  let model, modelData, busy = false, composing = false;
  const pageSize = desktop ? 48 : 24;
  if (!select('ljMaterialsStyle')) { const style = doc.createElement('link'); style.id = 'ljMaterialsStyle'; style.rel = 'stylesheet'; style.href = new URL('./materials.css', import.meta.url).href; doc.head.append(style); }
  const searchBar = doc.createElement('div'); searchBar.className = desktop ? 'pkg10-searchfield lj-material-search' : 'mv-search lj-material-search';
  searchBar.innerHTML = '<span aria-hidden="true">⌕</span><input type="search" aria-label="搜索资料名称、别名或类型" placeholder="搜索名称、内置别名或类型"><button type="button" data-material-action="clear" aria-label="退出资料搜索">×</button>';
  const head = desktop ? root.querySelector('.loc10-pagehead') : roots;
  if (desktop) head?.insertBefore(searchBar, head.lastElementChild); else head?.after(searchBar);
  const input = searchBar.querySelector('input'); input.value = state.query;
  const toolbar = doc.createElement('div'); toolbar.className = 'lj-selectbar lj-material-tools';
  list.before(toolbar);
  const footer = doc.createElement('div'); footer.className = 'lj-selectbar lj-material-pages'; list.after(footer);
  if (modified) modified.checked = state.modified;
  function getModel() { if (modelData !== ui.engine.data) { modelData = ui.engine.data; model = buildMaterialsModel(ui.engine); } if (!model.nodes.has(state.currentId)) state.currentId = model.roots[0].id; return model; }
  function mode() { return state.drill ? 'normal' : state.query ? 'search' : state.modified ? 'modified' : 'normal'; }
  function snapshot() { return { currentId: state.currentId, offset: state.offset, modified: state.modified, highlighted: state.highlighted, drill: state.drill, source: state.source, scrollTop: list.scrollTop }; }
  function savedPackages() { return new Set(Object.values(ui.bridge.store.read().livingJapanTextOverrides?.records || {}).map(record => record.packageId)); }
  function rows() { const currentMode = mode(); if (currentMode === 'search') return model.search(state.query); if (currentMode === 'modified') { const saved = savedPackages(); return [...model.packageNodes.values()].filter(node => saved.has(node.packageId)); } return model.nodes.get(state.currentId).children.map(id => model.nodes.get(id)); }
  const button = (text, action, attributes = '') => `<button type="button" class="lj-button" data-material-action="${action}" ${attributes}>${text}</button>`;
  const switchHTML = (node, on) => `<button type="button" class="${desktop ? 'pkg10-switch' : 'switch'} ${on ? 'on' : ''}" data-material-toggle="${esc(node.id)}" aria-pressed="${on}" aria-label="${esc(node.name)}${node.kind === 'package' ? '本级正文' : '整支'}开关"></button>`;
  function statusHTML(node, settings) { const status = materialState(node, settings, model); return status.effective ? '' : `<button type="button" class="lj-material-paused" data-material-reason="${esc(node.id)}" title="${esc(status.reasons.join('；'))}">暂停</button>`; }
  function rowHTML(node, settings, saved) {
    const control = materialState(node, settings, model), pick = state.multi && mode() === 'search', selected = state.selected.includes(node.id);
    const path = mode() === 'normal' ? '' : model.path(node.id).slice(0, -1).map(part => part.name).join(' › ');
    const details = [node.kind === 'package' ? saved.has(node.packageId) ? '有修改稿' : node.package.body ? '内置正文' : '正文空位' : node.children.length + ' 个直接内容', path].filter(Boolean).join(' · ');
    const action = pick ? 'data-material-pick' : node.kind === 'package' ? 'data-material-read' : 'data-material-enter';
    const pickHTML = pick ? `<input class="lj-material-pick" type="checkbox" data-material-pick="${esc(node.id)}" ${selected ? 'checked' : ''} aria-label="选择${esc(node.name)}${node.kind === 'package' ? '本级正文' : '分支'}">` : '';
    const read = node.kind === 'package' ? button('正文', 'read', `data-material-id="${esc(node.id)}"`) : `<button type="button" class="lj-enter" data-material-enter="${esc(node.id)}" aria-label="进入${esc(node.name)}下级">下级 ›</button>`;
    if (desktop) return `<article class="pkg10-row lj-material-row ${control.effective ? '' : 'inherited'} ${selected || state.highlighted === node.id ? 'selected' : ''}"><div class="pkg10-namecell">${pickHTML}<button type="button" class="pkg10-open" ${action}="${esc(node.id)}"><span class="pkg10-name">${esc(node.name)}</span></button>${statusHTML(node, settings)}</div><div class="pkg10-kind">${esc(node.type)}</div><div class="pkg10-count"><span>${esc(details)}</span>${read}</div><div class="pkg10-switchwrap">${switchHTML(node, control.own)}</div></article>`;
    return `<article class="lj-row lj-material-row ${selected || state.highlighted === node.id ? 'selected' : ''}">${pickHTML}<button type="button" class="lj-namebutton" ${action}="${esc(node.id)}"><span class="lj-name">${esc(node.name)}</span><span class="lj-meta">${esc(node.type + ' · ' + details)}</span></button><div class="lj-material-actions">${statusHTML(node, settings)}${read}${switchHTML(node, control.own)}</div></article>`;
  }
  function render() {
    const previousScroll = list.scrollTop;
    getModel();
    const settings = ui.engine.normalizeSettings(ui.bridge.store.read().livingJapanSettings), current = model.nodes.get(state.currentId), path = model.path(current.id), currentMode = mode();
    const allRows = rows(), page = materialPage(allRows, state.offset, pageSize), saved = savedPackages(); state.offset = page.offset;
    roots.innerHTML = model.roots.map(node => `<button type="button" class="${desktop ? 'pkg10-root ' : ''}${node.id === path[0].id ? 'on ' : ''}${settings.layers[node.layer] ? 'enabled' : ''}" data-material-enter="${esc(node.id)}"><span><i></i>${esc(node.name)}</span></button>`).join('');
    crumbs.innerHTML = path.map(node => `<button type="button" data-material-enter="${esc(node.id)}">${esc(node.name)}</button>`).join('<span aria-hidden="true">›</span>');
    const siblings = current.parentId ? model.nodes.get(current.parentId).children.map(id => model.nodes.get(id)) : model.roots;
    sibling.innerHTML = siblings.map(node => `<option value="${esc(node.id)}" ${node.id === current.id ? 'selected' : ''}>${esc(node.name)}</option>`).join('');
    sibling.title = current.name;
    back.disabled = !current.parentId && !state.source; back.textContent = state.source ? '← 返回' + (state.source.mode === 'search' ? '搜索' : '修改稿') : '← 上一级';
    const status = materialState(current, settings, model); currentSwitch.classList.toggle('on', status.own); currentSwitch.setAttribute('aria-pressed', String(status.own)); currentSwitch.setAttribute('aria-label', current.name + (current.kind === 'package' ? '本级正文' : '整支') + '开关'); currentSwitch.disabled = busy;
    effective.textContent = !status.own ? current.kind === 'package' ? '本级关闭' : '本分支暂停' : status.effective ? current.kind === 'package' ? '本级开启' : '本分支开放' : '随上级暂停'; effective.title = status.reasons.join('；');
    const selected = state.selected.filter(id => allRows.some(node => node.id === id));
    toolbar.innerHTML = currentMode === 'search' ? `<span>全资料 · ${allRows.length} 项匹配</span>${button(state.multi ? '完成多选' : '多选', 'multi')}${state.multi ? `<span>已选 ${selected.length} 项</span>${button('全选匹配', 'all')}${button('取消勾选', 'none')}${button('开启所选', 'bulk-on', selected.length && !busy ? '' : 'disabled')}${button('关闭所选', 'bulk-off', selected.length && !busy ? '' : 'disabled')}` : ''}` : `<span>${currentMode === 'modified' ? '全部修改稿' : esc(current.name)} · ${allRows.length} 项</span>${state.source ? button('返回' + (state.source.mode === 'search' ? '搜索' : '修改稿'), 'source') : ''}${statusHTML(current, settings)}`;
    list.innerHTML = page.rows.map(node => rowHTML(node, settings, saved)).join('') || '<div class="lj-empty">' + (currentMode === 'search' ? '没有匹配的名称、别名或类型。' : currentMode === 'modified' ? '尚未保存修改稿。' : '当前层暂无直接内容。') + '</div>';
    footer.innerHTML = `<span>${page.total ? page.offset + 1 : 0}–${Math.min(page.offset + pageSize, page.total)} / ${page.total}</span>${button('上一页', 'prev', page.hasPrevious ? '' : 'disabled')}${button('下一页', 'next', page.hasNext ? '' : 'disabled')}`;
    const count = select(desktop ? 'pkg10ListCount' : 'packageOffCount'); if (count) count.textContent = allRows.filter(node => !materialState(node, settings, model).own).length + ' 项本级关闭';
    searchBar.querySelector('button').hidden = !state.query;
    if (modified) { modified.checked = state.modified; modified.closest('label').hidden = Boolean(state.query); }
    root.querySelectorAll('[data-material-toggle]').forEach(node => { node.disabled = busy; });
    list.scrollTop = previousScroll;
  }
  async function enter(id) {
    if (ui.reader && !(await ui.reader.close())) return;
    const currentMode = mode(); if (currentMode !== 'normal') state.source = { ...snapshot(), mode: currentMode };
    state.currentId = id; state.offset = 0; state.drill = Boolean(state.query || state.modified); state.highlighted = null; render(); list.scrollTop = 0;
  }
  function returnSource() { if (!state.source) return; const original = state.source; Object.assign(state, original); state.source = null; state.drill = false; render(); list.scrollTop = original.scrollTop || 0; }
  function queryChanged() {
    const value = input.value.trim();
    if (!value) { const original = state.searchBase; if (original) Object.assign(state, original); else { state.source = null; state.drill = false; } state.query = ''; state.searchBase = null; state.multi = false; state.selected = []; render(); list.scrollTop = original?.scrollTop || 0; return; }
    if (!state.query) state.searchBase = snapshot();
    if (value !== state.query) state.selected = [];
    state.query = value; state.offset = 0; state.source = null; state.drill = false; render(); list.scrollTop = 0;
  }
  async function save(nodes, value) {
    if (busy || !nodes.length) return; busy = true; render();
    try {
      await ui.bridge.store.update(draft => { draft.livingJapanSettings = applyMaterialSelection(ui.engine.normalizeSettings(draft.livingJapanSettings), nodes, value); });
      await ui.bridge.session.refresh();
      ui.notify(nodes.length === 1 ? nodes[0].kind === 'package' ? '已' + (value ? '开启' : '关闭') + '本级正文' : '已' + (value ? '开放' : '暂停') + '当前分支，下级选择保留' : '已更新明确选中的 ' + nodes.length + ' 项');
    } catch (error) { ui.notify(error.message, 'error'); }
    finally { busy = false; render(); }
  }
  async function read(id) { const node = model.nodes.get(id); if (!node?.packageId) return; state.highlighted = id; const entity = await ui.getEntityForPackage(node.packageId); await ui.openReader(entity || { id: node.package.placeId || node.packageId, name: node.name, packageIds: [node.packageId] }, node.packageId); }
  root.addEventListener('click', async event => {
    const target = event.target.closest('button,input[data-material-pick]'); if (!target || target.disabled) return;
    try {
      if (target.dataset.materialPick) { const id = target.dataset.materialPick; state.selected = state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id]; render(); }
      else if (target.dataset.materialToggle) { const node = model.nodes.get(target.dataset.materialToggle), settings = ui.engine.normalizeSettings(ui.bridge.store.read().livingJapanSettings); await save([node], !materialState(node, settings, model).own); }
      else if (target.dataset.materialRead) await read(target.dataset.materialRead);
      else if (target.dataset.materialEnter) await enter(target.dataset.materialEnter);
      else if (target.dataset.materialReason) { const node = model.nodes.get(target.dataset.materialReason), status = materialState(node, ui.engine.normalizeSettings(ui.bridge.store.read().livingJapanSettings), model); await ui.ask({ title: node.name, message: status.reasons.join('；'), choices: [{ id: 'ok', label: '知道了' }] }); }
      else if (target.dataset.materialAction) {
        const action = target.dataset.materialAction;
        if (action === 'read') await read(target.dataset.materialId);
        if (action === 'clear') { input.value = ''; queryChanged(); }
        if (action === 'multi') { state.multi = !state.multi; render(); }
        if (action === 'all') { state.selected = rows().map(node => node.id); render(); }
        if (action === 'none') { state.selected = []; render(); }
        if (action === 'source') returnSource();
        if (action === 'prev' || action === 'next') { state.offset += action === 'next' ? pageSize : -pageSize; render(); list.scrollTop = 0; }
        if (action === 'bulk-on' || action === 'bulk-off') await save(rows().filter(node => state.selected.includes(node.id)), action === 'bulk-on');
      }
    } catch (error) { ui.notify(error.message, 'error'); }
  });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; queryChanged(); });
  input.addEventListener('input', event => { if (!composing && !event.isComposing) queryChanged(); });
  modified?.addEventListener('change', () => { state.modified = modified.checked; state.offset = 0; state.drill = false; state.source = null; render(); });
  sibling.onchange = () => enter(sibling.value);
  back.onclick = () => state.source ? returnSource() : enter(model.nodes.get(state.currentId).parentId);
  currentSwitch.onclick = () => { const node = model.nodes.get(state.currentId); save([node], !materialState(node, ui.engine.normalizeSettings(ui.bridge.store.read().livingJapanSettings), model).own); };
  return { render, async locate(packageId) { getModel(); const node = model.packageNodes.get(packageId); if (!node) return false; if (mode() !== 'normal') state.source = { ...snapshot(), mode: mode() }; state.currentId = node.parentId; state.drill = Boolean(state.query || state.modified); state.highlighted = node.id; state.offset = Math.floor(model.nodes.get(node.parentId).children.indexOf(node.id) / pageSize) * pageSize; await ui.showPage('packages'); render(); list.scrollTop = 0; return true; } };
}
