const clone = value => JSON.parse(JSON.stringify(value));
const CHANNELS = [['TN', '时间与自然'], ['EX', '外部地域'], ['IN', '内部场所'], ['EV', '明确场景事件']];
const TABS = [['common', '常用设置'], ['reading', '读取设置'], ['favorites', '常用地点'], ['backup', '备份与说明']];
const READING_KEYS = ['textScript', 'wrapperMode', 'historyDepth', 'currentUserBoundary', 'channelTags'];
const splitTags = value => [...new Set(String(value).split(/[，,、;；\n]+/).map(item => item.trim()).filter(Boolean))];

// LJ-SETTINGS-LIVE: 四组保存范围独立，模板入口接真实用户保存与扩展更新。
export function mountSettings(ui) {
  const { store, session, catalog, updates } = ui.bridge;
  const esc = ui.esc;
  const desktop = ui.layout === 'desktop';
  const content = document.getElementById(desktop ? 'set12Content' : 'settingsScroll');
  const tabs = document.getElementById(desktop ? 'set12Tabs' : 'settingsTabs');
  if (!content || !tabs) return { render() {} };
  content.classList.add('lj-settings-content');
  let tab = 'common', reading = null, favorites = null, readingDirty = false, favoritesDirty = false, busy = false;
  let status = '', tone = '', updateResult = null;
  const favoriteMatches = new Map();
  const favoriteQueries = new Map();
  const scrolls = {};
  const settings = () => ui.engine.normalizeSettings(store.read().livingJapanSettings);
  const group = (title, note, body) => `<section class="lj-setting-group set12-group"><div class="set12-grouphead"><h3>${esc(title)}</h3><span>${esc(note || '')}</span></div>${body}</section>`;
  const button = (action, text, primary = false, extra = '') => `<button type="button" class="lj-button${primary ? ' primary' : ''}" data-settings-action="${action}" ${extra}>${esc(text)}</button>`;
  const row = (label, control, note = '') => `<div class="lj-setting-row"><label>${esc(label)}${note ? `<small class="lj-meta">${esc(note)}</small>` : ''}</label>${control}</div>`;
  const select = (key, value, choices, scope = 'common') => `<select data-settings-${scope}="${key}" aria-label="${esc(key)}">${choices.map(([id, label]) => `<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  const toggle = (key, on, label) => `<button type="button" class="lj-switch" data-settings-common="${key}" aria-label="${esc(label)}" aria-pressed="${Boolean(on)}"></button>`;
  function initDrafts() {
    if (!reading || !readingDirty) {
      const saved = settings();
      reading = Object.fromEntries(READING_KEYS.map(key => [key, clone(saved[key])]));
    }
    if (!favorites || !favoritesDirty) {
      const saved = store.read();
      const existing = saved.extensionUi?.favorites || saved.livingJapanUIPreferences?.transitFavoritePlaces?.slots || [];
      favorites = Array.from({ length: 4 }, (_, index) => {
        const item = existing[index] || {};
        let entity = item.entityId ? catalog.get(item.entityId) : null;
        if (!entity && item.endpoint?.id) entity = catalog.get(item.endpoint.id) || catalog.get(`place:station:${item.endpoint.id}`) || catalog.get(`place:content_object:${item.endpoint.id}`);
        return { slotId: item.slotId || `favorite_${index + 1}`, displayName: item.displayName || '', entityId: item.entityId || entity?.id || '', regionCode: item.regionCode || entity?.regionCode || '', name: item.name || entity?.name || item.endpoint?.name || item.endpoint?.displayName || '' };
      });
    }
  }
  function commonHtml() {
    const saved = store.read(), value = settings();
    return group('界面与常用开关', '修改后即时保存',
      row('横版／竖版／手机版', select('layout', ui.layout, [['desktop', '横版'], ['portrait', '竖版'], ['mobile', '手机版']])) +
      row('界面主题', select('theme', saved.extensionUi?.theme || 'auto', [['auto', '跟随系统'], ['day', '日间'], ['night', '夜间']])) +
      row('锁定界面', toggle('pinned', saved.extensionUi?.pinned ?? saved.livingJapanUIPreferences?.panelPinned, '锁定界面'), '锁定后点击面板外部不关闭，位置仍可调整。') +
      row('提示注入', toggle('masterEnabled', value.masterEnabled, '提示注入'), '控制自动读取；手动追加地点名称与路线独立。') +
      row('具名地点正文', toggle('namedPlaceBodiesEnabled', value.namedPlaceBodiesEnabled, '具名地点正文')) +
      row('详细诊断', toggle('diagnostics', value.diagnostics, '详细诊断'))) +
      group('资料通道', '暂停通道保留各项选择', CHANNELS.map(([key, name]) => row(name, toggle(`layer:${key}`, value.layers[key], name))).join(''));
  }
  function readingHtml() {
    const wrapperChoices = Object.entries(ui.engine.data.wrappers || {}).map(([id, value]) => [id, value.label || id]);
    return group('文字与读取范围', '只由本组按钮统一保存',
      row('界面与新输出文字', select('textScript', reading.textScript, [['simplified', '简体中文'], ['traditional', '繁體中文（港台）']], 'reading')) +
      row('描写档位', select('wrapperMode', reading.wrapperMode, wrapperChoices, 'reading')) +
      row('回看 AI 回复层数', `<input type="number" min="0" step="1" data-settings-reading="historyDepth" value="${esc(reading.historyDepth)}" aria-label="回看 AI 回复层数">`) +
      `<div class="lj-reading-grid"><label>本轮输入开始标签<input type="text" data-settings-boundary="start" value="${esc(reading.currentUserBoundary.start)}"></label><label>本轮输入结束标签<input type="text" data-settings-boundary="end" value="${esc(reading.currentUserBoundary.end)}"></label></div>`) +
      group('四条读取通道', '多个标签用顿号或逗号分隔', `<div class="lj-reading-grid">${CHANNELS.map(([key, name]) => `<section class="lj-setting-channel" id="lj-channel-${key}"><h4>${name}</h4><label>优先标签<input type="text" data-settings-channel="${key}" data-tag-kind="priority" value="${esc(reading.channelTags[key].priority.join('、'))}"></label><label>排除标签<input type="text" data-settings-channel="${key}" data-tag-kind="excluded" value="${esc(reading.channelTags[key].excluded.join('、'))}"></label></section>`).join('')}</div>`) +
      `<div class="lj-settings-save">${button('save-reading', '保存读取设置', true)}<span data-settings-dirty="reading">${readingDirty ? '读取设置尚未保存' : '当前为已保存设置'}</span></div>`;
  }
  function favoritesHtml() {
    return group('四个常用地点', '独立保存', `<p class="lj-meta">自定义名建议五字以内；较长名称完整保留。地点填写资料中已有的完整名称。</p>${favorites.map((item, index) => `<section class="lj-favorite-form"><div class="lj-reading-grid"><label>槽位 ${index + 1} · 自定义名<input type="text" data-favorite-index="${index}" data-favorite-field="displayName" value="${esc(item.displayName)}"></label><label>地点全名<input type="text" list="lj-favorite-results-${index}" data-favorite-index="${index}" data-favorite-field="name" value="${esc(item.name)}"></label></div><datalist id="lj-favorite-results-${index}"></datalist><div class="lj-inline">${button('favorite-current', '使用当前地点', false, `data-index="${index}"`)}${button('favorite-clear', '清空', false, `data-index="${index}"`)}<span class="lj-meta" id="lj-favorite-hint-${index}">${item.entityId ? '已对应独立地点' : '尚未选择地点'}</span></div></section>`).join('')}`) +
      `<div class="lj-settings-save">${button('save-favorites', '保存常用地点', true)}<span data-settings-dirty="favorites">${favoritesDirty ? '常用地点尚未保存' : '与读取设置分开保存'}</span></div>`;
  }
  function backupHtml() {
    const state = store.read(), overrides = state.livingJapanTextOverrides;
    return group('用户资料备份', `${Object.keys(overrides.records).length} 段修改稿 · ${Object.keys(overrides.orphans).length} 段未对应`, `<p class="lj-meta">完整用户备份包含修改稿、空位、开关与偏好，不包含内置资料。</p><div class="lj-inline">${button('export', '导出用户备份')}${button('import', '导入备份')}<input type="file" accept="application/json,.json" data-settings-file hidden></div>`) +
      group('扩展更新', '更新程序与内置资料，保留用户保存', `<div class="lj-inline">${button('check-update', '检查更新')}${button('update', '更新扩展', false, !updateResult?.available ? 'disabled' : '')}</div><p class="lj-meta">${esc(updateResult ? (!updateResult.supported ? '当前安装没有可更新的仓库信息。' : updateResult.available ? '发现可用更新，保存当前输入后更新。' : '当前扩展已是仓库最新版本。') : '由酒馆现有扩展接口检查与更新。')}</p>`) +
      group('使用说明', '按当前任务查看', `<div class="lj-inline">${[['map','地图'],['locations','地区'],['packages','资料'],['check','检查'],['save','保存与恢复']].map(([id,label]) => button(`guide-${id}`, label)).join('')}</div><article id="lj-settings-guide" class="lj-meta"></article>`) +
      (Object.keys(overrides.orphans).length ? group('未对应旧稿', '仍在备份中保留', `<ul>${Object.entries(overrides.orphans).map(([key, item]) => `<li>${esc(item.packageId || key)} · ${esc(key)}</li>`).join('')}</ul>`) : '');
  }
  function render(force = false) {
    if (!force && content.contains(document.activeElement) && (readingDirty || favoritesDirty)) return;
    initDrafts();
    tabs.innerHTML = TABS.map(([id, label]) => `<button type="button" data-lj-settings-tab="${id}" class="${tab === id ? 'on' : ''}" aria-pressed="${tab === id}">${label}</button>`).join('');
    const note = document.getElementById('set12Headnote');
    if (note) note.textContent = { common: '常用设置即时保存', reading: '读取设置由本组统一保存', favorites: '四个常用地点独立保存', backup: '个人备份与扩展更新分开' }[tab];
    content.innerHTML = `<p class="lj-status ${tone}" role="status" id="lj-settings-status">${esc(status)}</p>${tab === 'common' ? commonHtml() : tab === 'reading' ? readingHtml() : tab === 'favorites' ? favoritesHtml() : backupHtml()}`;
    content.scrollTop = scrolls[tab] || 0;
    content.querySelectorAll('button,select,input').forEach(node => { if (busy) node.disabled = true; });
  }
  function message(text, type = '') {
    status = text; tone = type;
    const target = document.getElementById('lj-settings-status');
    if (target) { target.textContent = text; target.className = `lj-status ${type}`; }
    ui.notify(text, type);
  }
  async function saving(operation, success) {
    if (busy) return false;
    busy = true;
    try { await operation(); await session.refresh(); message(success, 'success'); return true; }
    catch (error) { message(error.message || String(error), 'error'); return false; }
    finally { busy = false; render(true); }
  }
  async function saveReading() {
    if (!Number.isFinite(reading.historyDepth) || reading.historyDepth < 0 || !Number.isInteger(reading.historyDepth)) { message('回看层数请填写0或正整数', 'error'); return false; }
    if (Boolean(reading.currentUserBoundary.start.trim()) !== Boolean(reading.currentUserBoundary.end.trim())) { message('本轮输入的开始与结束标签请成对填写，或一起留空', 'error'); return false; }
    return saving(async () => { await store.update(draft => { draft.livingJapanSettings = ui.engine.normalizeSettings({ ...draft.livingJapanSettings, ...clone(reading) }); }); readingDirty = false; }, '读取设置已保存');
  }
  async function saveFavorites() {
    const unmatched = favorites.find(item => item.name.trim() && !item.entityId);
    if (unmatched) { message(`“${unmatched.name}”尚未对应唯一地点，请先选择明确地点`, 'error'); return false; }
    return saving(async () => { await store.update(draft => { draft.extensionUi ||= {}; draft.extensionUi.favorites = clone(favorites); }); favoritesDirty = false; }, '四个常用地点已保存');
  }
  async function requestLeave() {
    if (!readingDirty && !favoritesDirty) return true;
    const choice = await ui.ask({ title: '设置尚未保存', message: '读取设置或常用地点有本次修改。', choices: [{ id: 'save', label: '保存并继续', primary: true }, { id: 'discard', label: '不保存并继续' }, { id: 'cancel', label: '留在设置' }] });
    if (choice === 'save') { if (readingDirty && !(await saveReading())) return false; if (favoritesDirty && !(await saveFavorites())) return false; return true; }
    if (choice === 'discard') { readingDirty = favoritesDirty = false; initDrafts(); render(true); return true; }
    return false;
  }
  function markDraft(kind) {
    if (kind === 'reading') readingDirty = true; else favoritesDirty = true;
    const node = content.querySelector(`[data-settings-dirty="${kind}"]`);
    if (node) node.textContent = kind === 'reading' ? '读取设置尚未保存' : '常用地点尚未保存';
  }
  async function searchFavorite(index, name) {
    const ticket = Symbol(); favoriteQueries.set(index, ticket);
    const found = name.trim() ? await catalog.search(name.trim(), { regionCode: ui.state.regionCode || '13', limit: 100 }) : [];
    if (favoriteQueries.get(index) !== ticket) return;
    favoriteMatches.set(index, found);
    const list = document.getElementById(`lj-favorite-results-${index}`);
    if (list) list.innerHTML = [...new Set(found.map(item => item.name))].map(value => `<option value="${esc(value)}"></option>`).join('');
    const exact = found.filter(item => item.name === name.trim());
    if (exact.length === 1) Object.assign(favorites[index], { entityId: exact[0].id, regionCode: exact[0].regionCode || ui.state.regionCode });
    const hint = document.getElementById(`lj-favorite-hint-${index}`);
    if (hint) hint.textContent = exact.length === 1 ? '已对应独立地点' : exact.length > 1 ? '同名地点不唯一，请在地区或地图选中后使用当前地点' : '请填写已收录全名，或使用当前地点';
  }
  tabs.addEventListener('click', event => {
    const target = event.target.closest('[data-lj-settings-tab]'); if (!target) return;
    scrolls[tab] = content.scrollTop; tab = target.dataset.ljSettingsTab; render(true);
  });
  content.addEventListener('input', event => {
    const input = event.target;
    if (input.dataset.settingsReading) { const key = input.dataset.settingsReading; reading[key] = key === 'historyDepth' ? Number(input.value) : input.value; markDraft('reading'); }
    if (input.dataset.settingsBoundary) { reading.currentUserBoundary[input.dataset.settingsBoundary] = input.value; markDraft('reading'); }
    if (input.dataset.settingsChannel) { reading.channelTags[input.dataset.settingsChannel][input.dataset.tagKind] = splitTags(input.value); markDraft('reading'); }
    if (input.dataset.favoriteField) {
      const index = Number(input.dataset.favoriteIndex); favorites[index][input.dataset.favoriteField] = input.value;
      if (input.dataset.favoriteField === 'name') { favorites[index].entityId = ''; favorites[index].regionCode = ''; searchFavorite(index, input.value).catch(error => message(error.message, 'error')); }
      markDraft('favorites');
    }
  });
  async function commonChange(key, value) {
    if (key === 'layout') { if (await requestLeave()) await ui.bridge.setLayout(value); return; }
    const succeeded = await saving(() => store.update(draft => {
      if (key === 'theme' || key === 'pinned') { draft.extensionUi ||= {}; draft.extensionUi[key] = value; }
      else { const next = ui.engine.normalizeSettings(draft.livingJapanSettings); if (key.startsWith('layer:')) next.layers[key.slice(6)] = value; else next[key] = value; draft.livingJapanSettings = next; }
    }), '常用设置已保存');
    if (key === 'theme' && succeeded) document.body.dataset.theme = value === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day') : value;
  }
  content.addEventListener('change', async event => {
    const input = event.target;
    if (input.matches('select[data-settings-common]')) { try { await commonChange(input.dataset.settingsCommon, input.value); } catch (error) { message(error.message, 'error'); } }
    if (!input.matches('[data-settings-file]')) return;
    const file = input.files?.[0]; input.value = ''; if (!file) return;
    try {
      const preview = store.importBackup(await file.text()), s = preview.summary;
      const choice = await ui.ask({ title: '导入用户备份', message: `新增 ${s.added} 段，覆盖 ${s.overwritten} 段，未对应 ${s.unresolved} 段；${s.baseChanged} 段的原文基准有变化。${s.settingsIncluded ? '此完整备份还会合并开关、偏好与自建空位。' : '此文件只导入修改稿。'}`, choices: [{ id: 'cancel', label: '取消' }, { id: 'import', label: '确认导入', primary: true }] });
      if (choice === 'import') await saving(() => store.applyImport(preview), '用户备份已导入并读回确认');
    } catch (error) { message(error.message, 'error'); }
  });
  content.addEventListener('click', async event => {
    const common = event.target.closest('button[data-settings-common]');
    if (common) { await commonChange(common.dataset.settingsCommon, common.getAttribute('aria-pressed') !== 'true'); return; }
    const target = event.target.closest('[data-settings-action]'); if (!target || busy) return;
    const action = target.dataset.settingsAction;
    try {
      if (action === 'save-reading') {
        await saveReading();
      } else if (action === 'save-favorites') {
        await saveFavorites();
      } else if (action === 'favorite-current') {
        const entity = ui.state.selected; if (!entity?.id) throw new Error('请先在地图或地区选择地点');
        Object.assign(favorites[Number(target.dataset.index)], { entityId: entity.id, name: entity.name, regionCode: entity.regionCode || ui.state.regionCode }); markDraft('favorites'); render(true);
      } else if (action === 'favorite-clear') {
        Object.assign(favorites[Number(target.dataset.index)], { entityId: '', name: '', displayName: '', regionCode: '' }); markDraft('favorites'); render(true);
      } else if (action === 'export') {
        const url = URL.createObjectURL(new Blob([store.exportBackup()], { type: 'application/json;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Living-Japan-用户备份-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); message('用户备份已开始下载');
      } else if (action === 'import') content.querySelector('[data-settings-file]').click();
      else if (action === 'check-update') { if (!updates) throw new Error('当前预览未连接酒馆更新接口'); updateResult = await updates.check(); render(true); }
      else if (action === 'update') {
        const choice = await ui.ask({ title: '更新扩展', message: '更新程序与内置资料，用户保存保留。更新后需刷新，当前未保存输入请先处理。', choices: [{ id: 'cancel', label: '取消' }, { id: 'update', label: '开始更新', primary: true }] });
        if (choice === 'update') { target.disabled = true; const result = await updates.update(); message(result.reloadRequired ? '扩展已更新；保存当前输入后刷新页面应用' : '当前扩展已是最新版'); updateResult = null; render(true); }
      } else if (action.startsWith('guide-')) {
        const guides = { map: '地图选中地点后可查看正文、设起终点或追加名称。定位图钉只移动地图视野；出发只追加路线备注，不自动发送。', locations: '地区按真实行政层级查找。名称查看本项，下级入口进入下一级；独立地点不会自动算成车站子级。', packages: '整支暂停保留下级选择；本级开关只控制当前正文。阅读有效正文、查看内置原文与编辑修改稿在同一对象内切换。', check: '上一轮实际记录与当前预览分别保存。预览只试算；宏展开记录也不等于模型已经收到。复制导出的是完整当前记录。', save: '正文明确保存后等待服务器读回确认。备份下载为JSON，无需解压。导入先预览覆盖范围；更新程序不覆盖个人稿件。' };
        document.getElementById('lj-settings-guide').textContent = guides[action.slice(6)] || '';
      }
    } catch (error) { message(error.message || String(error), 'error'); }
  });
  document.addEventListener('living-japan-settings-tab', event => {
    scrolls[tab] = content.scrollTop; tab = event.detail?.tab || 'reading'; render(true);
    if (event.detail?.channel) document.getElementById(`lj-channel-${event.detail.channel}`)?.scrollIntoView({ block: 'nearest' });
  });
  render();
  return { render, requestLeave, openTab(value) { scrolls[tab] = content.scrollTop; tab = value === 'places' ? 'favorites' : value; render(true); }, hasUnsaved: () => readingDirty || favoritesDirty };
}
