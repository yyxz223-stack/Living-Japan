import { createNationalMap } from '../src/national-map.js';

// LJ-EXT-MAP: frozen layout controls share real selection, map layers and v3.6 trip estimates.
const MODES = [['schem', '示意'], ['map', '地图'], ['detail', '精细'], ['ultra', '超精细']];
const TRAVEL = [['public_transit', '公共交通'], ['driving', '驾车'], ['walking', '步行'], ['bicycle', '自行车']];
const MODE_IDS = { transit: 'public_transit', drive: 'driving', walk: 'walking', bike: 'bicycle', '公共交通': 'public_transit', '驾车': 'driving', '步行': 'walking', '自行车': 'bicycle' };
const administrative = entity => !entity || ['country', 'prefecture', 'city', 'ward', 'town', 'village', 'administrative', 'region'].includes(entity.kind) || entity.id?.startsWith('admin:') || entity.source?.namespace === 'administration';
const coordinates = point => Array.isArray(point) ? { longitude: point[0], latitude: point[1] } : point;

export function nextEndpoints(origin, destination, kind, entity) {
  if (kind === 'origin') return { origin: origin?.id === entity.id ? null : entity, destination: destination?.id === entity.id ? null : destination };
  return { origin: origin?.id === entity.id ? null : origin, destination: destination?.id === entity.id ? null : entity };
}

export function toTransitEndpoint(entity, data, fields) {
  if (administrative(entity)) return null;
  const placeId = entity.legacyPlaceId || entity.id;
  const place = data.places.find(item => item.placeId === placeId);
  const crosswalk = (data.stationAdministration?.contentStationCrosswalk || []).find(item => item.placeId === placeId);
  const railId = crosswalk?.railStationId || (placeId.startsWith('place:rail_station:') ? placeId.slice(19) : null);
  const stationId = railId || place?.railStationId || place?.mapStationId || place?.stationId;
  const station = fields.transitTime.stationAnchors.find(item => [item.stationId, item.railStationId, item.mapStationId, ...(item.aliases || [])].includes(stationId));
  const areaId = place?.editorialAreaIds?.[0];
  const area = fields.transitTime.areaAnchors.find(item => item.areaId === areaId);
  if (station && (place?.kind === 'station' || railId)) { const name = station.nameJa || station.label || entity.name; return { type: 'station', id: station.stationId, label: /[站駅]$/.test(name) ? name : name + '駅', stationIds: [station.stationId], regionId: station.regionId, coordinates: { longitude: station.longitude, latitude: station.latitude } }; }
  const point = coordinates(entity.coordinates || place?.coordinates) || (area ? { longitude: area.longitude, latitude: area.latitude } : null);
  if (!point || !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude)) return null;
  return { type: place?.sourceObjectId ? 'object' : place?.kind === 'editorial_area' ? 'area' : 'place', id: place?.sourceObjectId || (place?.kind === 'editorial_area' ? areaId : placeId), label: place?.label || entity.name || placeId, areaId: areaId || null, regionId: place?.regionId || area?.regionId || '', stationIds: area?.stationIds || [], coordinates: point };
}

export function mountMap(ui) {
  const { bridge, state, esc } = ui, { catalog } = bridge, desktop = ui.layout === 'desktop';
  const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
  const local = state.mapUi ||= { mode: 'detail', full: false, details: true, query: '', history: [] };
  local.mode ||= 'detail'; local.history ||= []; local.stash ||= []; local.menu = ''; state.regionCode ||= 'metro';
  let renderedQuery = '';
  let map, mounting, suppressSelection = false, dead = false, timer, searchEpoch = 0, routeEpoch = 0, transitPromise, routeKey = '', estimates = {}, routeStatus = '', selectedEndpoints = null;
  const entities = new Map(), hosts = desktop ? [$('.map7')] : [$('#mapCanvas'), $('#fullMapCanvas')];
  const surface = document.createElement('div'); surface.className = 'lj-map-surface'; surface.style.position = 'absolute'; if (desktop) surface.style.right = 'var(--edge,0px)';
  const remember = entity => { if (entity?.id) entities.set(entity.id, entity); return entity; };
  const current = () => state.selected || catalog.get(state.selectedId) || null;
  const resolve = async id => entities.get(id) || catalog.get(id) || await catalog.resolve(id, { regionCode: state.regionCode });
  const attr = entity => `data-map-entity="${esc(entity.id)}"`;
  const action = (name, text, entity = null, extra = '') => `<button type="button" class="lj-button" data-lj-map="${name}" ${entity ? attr(entity) : ''} ${extra}>${esc(text)}</button>`;
  const run = operation => Promise.resolve().then(operation).catch(error => ui.notify(error.message, 'error'));
  const path = entity => (entity.adminNodes || []).filter(node => node.id !== 'admin:jp').map(node => node.label || node.name || node.nameJa).filter(Boolean).join(' › ');
  const label = entity => [entity.type || '地点', path(entity)].filter(Boolean).join(' · ');
  function packageIds(entity) { return [...new Set([...(entity?.packageIds || []), ...ui.engine.data.packages.filter(item => item.placeId === (entity?.legacyPlaceId || entity?.id)).map(item => item.id)])]; }
  function summary(entity) {
    if (!entity) return '在地图或搜索结果中选择地点';
    const ids = packageIds(entity), texts = ids.flatMap(id => ui.engine.editableVariantsForPackage(id));
    const overrides = bridge.store.read().livingJapanTextOverrides.records;
    const body = texts.map(item => overrides[item.slotKey]?.body ?? item.body ?? '').find(text => text.trim());
    return body ? body.replace(/\s+/g, ' ').slice(0, 130) : '暂无正文，可在查看详情中建立正文空位。';
  }
  function favorites() {
    const data = bridge.store.read(), source = data.extensionUi?.favorites || data.livingJapanUIPreferences?.transitFavoritePlaces?.slots || [];
    return Array.from({ length: 4 }, (_, index) => {
      const value = source[index] || {}, oldId = value.endpoint?.id;
      const old = oldId && (catalog.get(oldId) || catalog.get(`place:station:${oldId}`) || catalog.get(`place:content_object:${oldId}`));
      return { ...value, entityId: value.entityId || old?.id, name: value.name || old?.name, displayName: value.displayName || `常用${index + 1}` };
    });
  }
  // LJ-MAP-REGIONS-8: browse groups leave prefecture identities and map views unchanged.
  const regionOptions = () => {
    const regions = catalog.regions(), groups = new Map();
    const option = region => `<option value="${esc(region.code)}" ${String(region.code) === state.regionCode ? 'selected' : ''}>${esc(region.name || region.label || region.code)}</option>`;
    const views = ['metro', '00'].map(code => regions.find(region => String(region.code) === code)).filter(Boolean);
    const remaining = regions.filter(region => !['metro', '00'].includes(String(region.code)));
    for (const region of remaining) {
      if (!region.groupId) continue;
      if (!groups.has(region.groupId)) groups.set(region.groupId, { name: region.groupName, regions: [] });
      groups.get(region.groupId).regions.push(region);
    }
    return views.map(option).join('') + [...groups.values()].map(group => `<optgroup label="${esc(group.name)}">${group.regions.map(option).join('')}</optgroup>`).join('') + remaining.filter(region => !region.groupId).map(option).join('');
  };
  function searchMarkup() {
    return `<div class="search-float"><div class="search"><span>⌕</span><input class="search-input" data-map-query type="search" placeholder="搜索名称或类型" aria-label="搜索地图地点" autocomplete="off"><button type="button" class="v-map-search-exit" data-lj-map="exit-search" aria-label="退出搜索" hidden>×</button><select data-map-region class="lj-select" style="max-width:88px;font-size:12px" aria-label="地图地区">${regionOptions()}</select></div><div class="search-results" data-map-results hidden></div><div class="search-history" data-map-history hidden></div></div><div class="fav" data-map-favorites></div><div class="level" data-expanded="${local.full}" data-map-level-control>${MODES.map(([id, name]) => `<button type="button" data-lj-map="mode" data-map-mode="${id}">${name}</button>`).join('')}</div><div class="zoom">${action('zoom-in', '＋')}${action('zoom-out', '−')}${action('fit', '◎', null, 'title="只复原地图视野" aria-label="只复原地图视野"')}</div>`;
  }
  function prepare() {
    if (desktop) {
      $('.map7 .map-art7')?.remove(); $('.map7')?.prepend(surface);
      const input = $('#search7'); input.dataset.mapQuery = ''; input.placeholder = '搜索名称或类型';
      $('.search7 .scope7').outerHTML = `<button type="button" data-lj-map="exit-search" aria-label="退出搜索" hidden>×</button><select data-map-region class="lj-select" style="max-width:110px" aria-label="地图地区">${regionOptions()}</select>`;
      $('.recent7').dataset.mapHistory = ''; $('.fav7').dataset.mapFavorites = '';
      $$('.density7 button').forEach((node, index) => { node.dataset.ljMap = 'mode'; node.dataset.mapMode = MODES[index][0]; });
      $$('.zoom7 button').forEach((node, index) => node.dataset.ljMap = ['zoom-in', 'zoom-out', 'fit'][index]);
      $('#searchResults7').dataset.mapResults = '';
      $('#mapFullSearch7').innerHTML = '<div class="search-title7"><h3>搜索结果</h3></div><div data-map-results style="overflow:auto;min-height:0"></div>';
      $('.side7 .close7').dataset.ljMap = 'full'; $('.side7 .action7.primary').dataset.ljMap = 'read'; $('.side7 .place-append7').dataset.ljMap = 'clear-route';
      $$('.side7 .route-set7 button').forEach((node, index) => node.dataset.ljMap = index ? 'destination' : 'origin');
      $('.side7 [data-current-map-locate]').dataset.ljMap = 'locate'; $('.side7 [data-current-map-locate]').title = '只定位当前地点';
      $('.place7h').dataset.mapTitle = ''; $('.lj-full-back').dataset.ljMap = 'normal';
      $$('.tools7 [title="进入全地图"]').forEach(node => node.dataset.ljMap = 'full');
      $('#ljMapRouteTools .lj-route-summary button').dataset.ljMap = 'clear-route';
      $('.depart7').dataset.ljMap = 'depart';
    } else {
      hosts.forEach(host => {
        host.innerHTML = searchMarkup();
        host.querySelector('[data-map-level-control]').dataset.expanded = String(host.id === 'fullMapCanvas');
        if (ui.layout === 'mobile') {
          host.querySelector('[data-map-history]').setAttribute('data-search-history', '');
          host.querySelector('.search').insertAdjacentHTML('beforeend', '<button type="button" class="mini-map-list-button" data-lj-map="history-menu">最近</button><button type="button" class="mini-map-list-button" data-lj-map="stash-menu">暂存</button>');
          host.querySelector('.search-float').insertAdjacentHTML('beforeend', '<div class="mini-map-menu" data-map-menu hidden></div>');
        }
      }); hosts[0].prepend(surface);
      $('#brandButton').dataset.ljMap = 'full'; $('#fullMapReturn').dataset.ljMap = 'normal';
      $('#fullMapReturn').removeAttribute('data-go');
      for (const selector of ['#mainPlaceName', '#dockPlaceName']) $(selector).dataset.mapTitle = '';
      for (const selector of ['#mainPlaceLocate', '#dockPlaceLocate']) $(selector).dataset.ljMap = 'locate';
      $('#mainPlaceDetail').dataset.ljMap = 'read'; $('#setOrigin').dataset.ljMap = 'origin'; $('#setDestination').dataset.ljMap = 'destination';
      $('#dockActions .origin').dataset.ljMap = 'origin'; $('#dockActions .dest').dataset.ljMap = 'destination';
      $('#dockActions [data-place-detail]').dataset.ljMap = 'read'; $('#dockActions [data-place-append]').dataset.ljMap = 'append';
      $('#dockToggle').dataset.ljMap = 'details';
      for (const selector of ['#routeClear', '#fullRouteClear']) $(selector).dataset.ljMap = 'clear-route';
      $$('.route-actions>.btn.primary,.full-route-line>.btn.primary').forEach(node => node.dataset.ljMap = 'depart');
    }
    $$('[data-travel],.travel-modes7 [data-mode]').forEach(node => { node.dataset.ljMap = 'travel'; node.dataset.mapTravel = MODE_IDS[node.dataset.travel || node.dataset.mode]; });
    $$('[data-map-query]').forEach(input => {
      let composing = false;
      input.addEventListener('compositionstart', () => composing = true);
      input.addEventListener('compositionend', () => { composing = false; setQuery(input.value); });
      input.addEventListener('input', event => { if (!composing && !event.isComposing) setQuery(input.value); });
      input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setQuery(''); } });
    });
    $$('[data-map-region]').forEach(select => select.addEventListener('change', () => run(() => setRegion(select.value))));
  }
  async function ensureMap() {
    if (mounting) return mounting;
    mounting = (async () => {
      map = createNationalMap(surface, { catalog, onSelect: entity => { if (!suppressSelection) run(() => choose(entity)); }, onAppend: entity => ui.append(entity), onError: error => ui.notify(error.message || String(error), 'error') });
      await map.setRegion(state.mapView?.regionCode || state.regionCode);
      if (state.mapView) await map.setView(state.mapView);
      await map.setMode(local.mode); map.setRoute(state.routeOrigin, state.routeDestination);
      if (current()) { suppressSelection = true; try { await map.select(current(), { locate: false }); } finally { suppressSelection = false; } }
    })().catch(error => { map?.destroy(); map = null; mounting = null; throw error; });
    return mounting;
  }
  async function transitService() {
    return transitPromise ||= Promise.all([bridge.baseline.transitTime.load(), bridge.baseline.transitMap.load()]).then(([time, legacy]) => ({ estimator: time.createEstimator(time.data.transitTime), fields: time.data, format: legacy._test.buildTrafficComment })).catch(error => { transitPromise = null; throw error; });
  }
  async function refreshRoute() {
    const key = `${state.routeOrigin?.id || ''}|${state.routeDestination?.id || ''}`;
    map?.setRoute(state.routeOrigin, state.routeDestination);
    if (key === routeKey) return;
    routeKey = key; const epoch = ++routeEpoch; estimates = {}; selectedEndpoints = null;
    if (!state.routeOrigin || !state.routeDestination) { routeStatus = '选择起点和终点后估算'; renderRoute(); return; }
    routeStatus = '正在读取参考耗时'; renderRoute();
    try {
      const service = await transitService();
      const origin = toTransitEndpoint(state.routeOrigin, ui.engine.data, service.fields), destination = toTransitEndpoint(state.routeDestination, ui.engine.data, service.fields);
      const result = service.estimator.estimateAll({ origin, destination });
      if (dead || epoch !== routeEpoch) return;
      estimates = result.estimates; selectedEndpoints = { origin, destination }; routeStatus = ''; renderRoute();
    } catch (error) { if (epoch === routeEpoch) { routeKey = ''; routeStatus = error.message; renderRoute(); } }
  }
  function renderRoute() {
    const origin = state.routeOrigin, destination = state.routeDestination, selected = current(), mode = state.travelMode || 'public_transit', estimate = estimates[mode];
    const names = `${origin?.name || '未设起点'} → ${destination?.name || '未设终点'}`;
    const detail = routeStatus || (estimate?.ok ? `约 ${estimate.minutes} 分钟 · ${estimate.methodLabel}` : '当前范围没有此方式的参考路线');
    const ready = Boolean(estimate?.ok && selectedEndpoints && (mode !== 'public_transit' || estimate.railPath?.lineSegments?.length));
    if (desktop) { $('#ljRouteOrigin7').textContent = origin?.name || '未设起点'; $('#ljRouteDestination7').textContent = destination?.name || '未设终点'; $('#ljMapRouteTools').title = detail; }
    else { $('#routeLabel').textContent = names; $('#routeMeta').textContent = detail; $('[data-page-root="fullmap"] .route-status-line b').textContent = names; $('[data-page-root="fullmap"] .route-copy>span').textContent = detail; }
    $$('[data-lj-map="travel"]').forEach(node => {
      const id = node.dataset.mapTravel, value = estimates[id], name = TRAVEL.find(item => item[0] === id)?.[1] || id;
      node.classList.toggle('on', id === mode); node.classList.toggle('active', id === mode); node.setAttribute('aria-pressed', String(id === mode));
      const text = value?.ok ? `约${value.minutes}分` : origin && destination ? '暂无' : '—';
      node.innerHTML = desktop ? `<strong>${name}</strong><small>${text}</small>` : `${name} <small>${text}</small>`;
      node.title = value?.ok ? `${value.methodLabel}；${value.formula}` : origin && destination ? '当前参考资料未覆盖此路线' : '请先设起点和终点';
    });
    $$('[data-lj-map="depart"]').forEach(node => { node.disabled = !ready; node.title = detail; node.innerHTML = desktop ? '出发<small>追加交通参考</small>' : '出发'; });
    $$('[data-lj-map="origin"],[data-lj-map="destination"]').forEach(node => {
      const entity = node.dataset.mapEntity ? entities.get(node.dataset.mapEntity) || catalog.get(node.dataset.mapEntity) : selected, endpoint = node.dataset.ljMap === 'origin' ? origin : destination, role = node.dataset.ljMap === 'origin' ? '起点' : '终点';
      const active = entity?.id === endpoint?.id && Boolean(entity); node.disabled = administrative(entity); node.setAttribute('aria-pressed', String(active)); node.classList.toggle('v-endpoint-selected', active);
      node.textContent = `${active ? '取消' : endpoint ? '替换' : '设为'}${role}`;
    });
  }
  function related(entity) {
    return (ui.engine.data.walkingInterests || []).filter(row => row.anchorPlaceId === (entity?.legacyPlaceId || entity?.id)).map(row => catalog.get(row.targetPlaceId) || (() => { const p = ui.engine.data.places.find(item => item.placeId === row.targetPlaceId); return p ? { id: p.placeId, legacyPlaceId: p.placeId, name: p.label, coordinates: coordinates(p.coordinates), type: '地点', adminPath: p.adminPath, packageIds: [] } : null; })()).filter(Boolean).map(remember);
  }
  function renderSelection() {
    const entity = remember(current()), name = entity?.name || '请选择地点', meta = entity ? label(entity) : '地图与地点搜索', peers = related(entity);
    $$('[data-map-title]').forEach(node => { node.textContent = name; node.title = entity ? `${name} · 双击追加名称` : ''; });
    if (desktop) {
      $('.side7 .eyebrow7').textContent = meta; $('.side7 .sub7').textContent = summary(entity); $('.side7 .sub7').title = '';
      $('.related-title7 h4').textContent = `相关地点 ${peers.length} 个`;
      $('.related-list7').innerHTML = peers.map(item => `<li><button type="button" class="related-place7" data-lj-map="choose" ${attr(item)}><b>${esc(item.name)}</b><small>${esc(label(item))}</small></button><button type="button" class="append7" data-lj-map="append" ${attr(item)}>追加</button></li>`).join('');
      $('#mapCompact7').innerHTML = `<div class="map-compact-title lj-row"><strong class="grow" data-map-title>${esc(name)}</strong>${action('locate', '定位')}${action('details', local.details ? '收起' : '展开')}</div><div class="lj-inline" style="padding:6px 10px">${action('origin', '设为起点')}${action('destination', '设为终点')}${action('append', '追加')}${action('read', '查看详情')}</div><div class="lj-detail" ${local.details ? '' : 'hidden'}><p>${esc(meta)}</p><p>${esc(summary(entity))}</p>${peers.map(item => action('choose', item.name, item)).join('')}</div>`;
    } else {
      $('#mainPlaceKind').textContent = meta; $('#dockPlaceMeta').textContent = meta; $('#mainPlaceIntro').textContent = summary(entity);
      $('#mapFeed .related-title b').textContent = `相关地点 ${peers.length} 个`;
      $('#mapRelated').innerHTML = peers.map(item => `<div class="li"><button type="button" class="grow related-peer-name" data-lj-map="choose" ${attr(item)}><span class="name">${esc(item.name)}</span><span class="meta">${esc(label(item))}</span></button><button type="button" class="btn text" data-lj-map="append" ${attr(item)}>追加</button></div>`).join('');
      $('#dockActions').hidden = !local.details; $('#dockToggle').textContent = local.details ? '收起' : '展开'; $('#dockToggle').setAttribute('aria-expanded', String(local.details));
    }
    $$('[data-lj-map="read"],[data-lj-map="locate"],[data-lj-map="append"]').filter(node => !node.dataset.mapEntity).forEach(node => node.disabled = !entity);
    renderRoute();
  }
  function renderControls() {
    $$('[data-map-mode]').forEach(node => { const active = node.dataset.mapMode === local.mode; node.classList.toggle('on', active); node.setAttribute('aria-pressed', String(active)); });
    $$('[data-map-region]').forEach(node => { if (node.options.length !== catalog.regions().length) node.innerHTML = regionOptions(); node.value = state.regionCode; });
    $$('[data-map-favorites]').forEach(host => host.innerHTML = favorites().map((item, index) => `<button type="button" data-lj-map="favorite" data-map-favorite="${index}" title="${esc(item.name ? `${item.displayName} · ${item.name}；定位并补空端点` : `${item.displayName}：到设置选择地点`)}"><span>${esc(item.displayName)}</span></button>`).join(''));
    $$('[data-map-history]').forEach(host => { host.hidden = !local.history.length; host.dataset.covered = String(Boolean(local.query)); host.innerHTML = local.history.map(item => `<button type="button" data-lj-map="history" ${attr(item)}>${esc(item.name)}</button>`).join(''); });
    $$('[data-map-query]').forEach(input => { if (input.value !== local.query) input.value = local.query; });
    $$('[data-lj-map="exit-search"]').forEach(node => node.hidden = !local.query);
    $$('[data-map-menu]').forEach(host => {
      const active = local.menu && host.closest('.map').id === local.menuHost;
      host.hidden = !active; host.closest('.search-float').dataset.miniMenuOpen = String(Boolean(active));
      const rows = local.menu === 'stash' ? local.stash : local.history;
      host.innerHTML = active ? `<div class="mini-map-menu-head"><b>${local.menu === 'stash' ? '暂存地点' : '最近地点'}</b>${local.menu === 'stash' ? action('stash-add', '暂存当前地点') : ''}${action('menu-close', '×', null, 'aria-label="关闭地点列表"')}</div><div class="mini-map-menu-list">${rows.length ? rows.map(item => `<div class="mini-map-menu-row">${action('history', item.name, item)}${local.menu === 'stash' ? action('stash-remove', '×', item, `aria-label="移除暂存${esc(item.name)}"`) : ''}</div>`).join('') : '<p>暂无地点</p>'}</div>` : '';
      host.closest('.search-float').querySelectorAll('[data-lj-map$="-menu"]').forEach(node => node.setAttribute('aria-expanded', String(Boolean(active && node.dataset.ljMap.startsWith(local.menu)))));
    });
  }
  async function search() {
    const epoch = ++searchEpoch, query = local.query.trim();
    let results = [];
    if (query) results = await catalog.search(query, { regionCode: state.regionCode, limit: 80 });
    if (epoch !== searchEpoch || dead) return;
    results.forEach(remember);
    const rows = results.map(entity => `<div class="lj-row"><button type="button" class="lj-namebutton" data-lj-map="search-choose" ${attr(entity)}><span class="lj-name">${esc(entity.name)}</span><span class="lj-meta">${esc(label(entity))}</span></button>${action('locate', '⌖', entity, `aria-label="只定位${esc(entity.name)}" title="只移动地图，不替换当前地点"`)}${desktop ? action('origin', '设为起点', entity) + action('destination', '设为终点', entity) + action('append', '追加', entity) : ''}</div>`).join('') || '<div class="search-empty">没有匹配的名称或类型</div>';
    $$('[data-map-results]').forEach(host => { const top = renderedQuery === query ? host.scrollTop : 0; host.innerHTML = query ? rows : ''; host.hidden = !query; host.scrollTop = top; }); renderedQuery = query;
    if (desktop) { $('#work7').classList.toggle('searching', Boolean(query)); $('#work7').classList.toggle('searching7', Boolean(query)); $('.side7 .search-view7').style.display = query ? 'flex' : 'none'; $('.side7 .detail7').hidden = Boolean(query); $('#searchCount7').textContent = `${results.length}${results.length === 80 ? '+' : ''} 个地点`; $('#mapFullSearch7').hidden = !local.full || !query; }
    renderControls(); renderRoute();
  }
  function setQuery(value) {
    local.query = value; local.menu = ''; ++searchEpoch; clearTimeout(timer); renderControls();
    if (!value.trim()) run(search); else timer = setTimeout(() => run(search), 140);
  }
  async function setRegion(code) {
    await ensureMap(); await map.setRegion(code); state.regionCode = String(code); state.mapView = map.getView(); renderControls(); if (local.query) await search();
  }
  async function choose(entity, clear = false) {
    if (!entity || !(await ui.reader.close())) return false;
    remember(entity); local.history = [entity, ...local.history.filter(item => item.id !== entity.id)].slice(0, 4); local.menu = '';
    await ui.selectEntity(entity, { locate: false });
    if (clear) setQuery(''); renderControls(); return true;
  }
  async function select(entity, options = {}) {
    remember(entity); renderSelection(); await ensureMap();
    suppressSelection = true;
    try { await map.select(entity, { locate: options.locate === true }); } finally { suppressSelection = false; }
    state.regionCode = map.getView().regionCode; state.mapView = map.getView(); local.mode = state.mapView.mode; renderControls();
  }
  async function locate(entity) {
    if (!entity) return; await ensureMap();
    if (!entity.coordinates) { ui.notify('此地点暂无可定位坐标'); return; }
    await map.locate(entity); state.regionCode = map.getView().regionCode; state.mapView = map.getView(); local.mode = state.mapView.mode; renderControls();
  }
  async function endpoint(kind, entity) {
    if (administrative(entity)) return;
    const service = await transitService();
    if (!toTransitEndpoint(entity, ui.engine.data, service.fields)) { ui.notify('此地点暂无可用的交通地理锚点'); return; }
    const next = nextEndpoints(state.routeOrigin, state.routeDestination, kind, entity); state.routeOrigin = next.origin; state.routeDestination = next.destination;
    renderRoute(); await refreshRoute();
  }
  async function setFullMap(value) {
    if (!(await ui.reader.close())) return;
    if (state.page !== 'map') { await ui.showPage('map'); if (state.page !== 'map') return; }
    local.full = Boolean(value); applyFullMap(); await ensureMap();
  }
  function applyFullMap() {
    if (desktop) { $('#work7').classList.toggle('side-off', local.full); $('#ljFullMapPanels').hidden = !local.full; $('#mapFullSearch7').hidden = !local.full || !local.query; }
    else { $('[data-page-root="map"]').hidden = local.full; $('[data-page-root="fullmap"]').hidden = !local.full; (local.full ? hosts[1] : hosts[0]).prepend(surface); $('#device').classList.toggle('fullmap', local.full); }
  }
  async function depart() {
    const mode = state.travelMode || 'public_transit', estimate = estimates[mode];
    if (!estimate?.ok || !selectedEndpoints) return;
    const service = await transitService(), comment = service.format({ ...selectedEndpoints, mode, estimate });
    if (!comment) { ui.notify('当前路线缺少可用的交通说明'); return; }
    const result = await bridge.appendTraffic(comment); ui.notify(result === false || result?.ok === false ? result?.error || '没有找到聊天输入框' : result?.warning || '交通参考已追加到输入框', result?.ok === false ? 'error' : undefined);
  }
  async function click(event) {
    const node = event.target.closest('[data-lj-map]'); if (!node) return;
    const cmd = node.dataset.ljMap, entity = node.dataset.mapEntity ? local.history.find(item => item.id === node.dataset.mapEntity) || local.stash.find(item => item.id === node.dataset.mapEntity) || await resolve(node.dataset.mapEntity) : current();
    if (cmd === 'choose' || cmd === 'history' || cmd === 'search-choose') await choose(entity, cmd === 'search-choose' && !desktop);
    else if (cmd === 'locate') await locate(entity);
    else if (cmd === 'append') ui.append(entity);
    else if (cmd === 'read') await ui.openReader(entity);
    else if (cmd === 'origin' || cmd === 'destination') await endpoint(cmd, entity);
    else if (cmd === 'clear-route') { state.routeOrigin = state.routeDestination = null; await refreshRoute(); }
    else if (cmd === 'mode') { const control = node.closest('[data-map-level-control]'); if (control?.dataset.expanded === 'false' && node.dataset.mapMode === local.mode) { control.dataset.expanded = 'true'; return; } local.mode = node.dataset.mapMode; await ensureMap(); await map.setMode(local.mode); if (control && !local.full) control.dataset.expanded = 'false'; renderControls(); state.mapView = map.getView(); }
    else if (cmd === 'travel') { state.travelMode = node.dataset.mapTravel; renderRoute(); }
    else if (cmd === 'depart') await depart();
    else if (cmd === 'full' || cmd === 'normal') await setFullMap(cmd === 'full' ? !local.full : false);
    else if (cmd === 'details') { local.details = !local.details; renderSelection(); }
    else if (cmd === 'history-menu' || cmd === 'stash-menu') { const kind = cmd.split('-')[0], host = node.closest('.map').id; local.menu = local.menu === kind && local.menuHost === host ? '' : kind; local.menuHost = host; renderControls(); }
    else if (cmd === 'menu-close') { local.menu = ''; renderControls(); }
    else if (cmd === 'stash-add') { if (entity && !local.stash.some(item => item.id === entity.id)) local.stash.push(entity); renderControls(); }
    else if (cmd === 'stash-remove') { local.stash = local.stash.filter(item => item.id !== entity?.id); renderControls(); }
    else if (cmd === 'exit-search') setQuery('');
    else if (cmd === 'zoom-in' || cmd === 'zoom-out' || cmd === 'fit') { await ensureMap(); if (cmd === 'fit') map.fit(); else map.zoom(cmd === 'zoom-in' ? 1 : -1); state.mapView = map.getView(); }
    else if (cmd === 'favorite') {
      const favorite = favorites()[Number(node.dataset.mapFavorite)], target = favorite.entityId && (entities.get(favorite.entityId) || catalog.get(favorite.entityId) || await catalog.resolve(favorite.entityId, { regionCode: favorite.regionCode || state.regionCode }));
      if (!target) { await ui.showPage('settings'); document.dispatchEvent(new CustomEvent('living-japan-settings-tab', { detail: 'favorites' })); return; }
      if (!(await choose(target))) return; await locate(target);
      if (!state.routeOrigin) await endpoint('origin', target); else if (!state.routeDestination && state.routeOrigin.id !== target.id) await endpoint('destination', target);
    }
  }
  const handleClick = event => run(() => click(event));
  const doubleClick = event => { if (event.target.closest('[data-map-title]') && current()) ui.append(current()); };
  prepare(); document.addEventListener('click', handleClick); document.addEventListener('dblclick', doubleClick);
  async function render() {
    renderControls(); renderSelection(); applyFullMap(); await ensureMap(); if (local.query) await search(); await refreshRoute();
  }
  return { render, select, locate, setRegion, setFullMap, destroy() { dead = true; clearTimeout(timer); ++routeEpoch; ++searchEpoch; if (map) state.mapView = map.getView(); map?.destroy(); document.removeEventListener('click', handleClick); document.removeEventListener('dblclick', doubleClick); } };
}
