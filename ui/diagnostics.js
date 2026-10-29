const LABELS = { TN: '时间与自然', EX: '外部地域', IN: '内部场所', EV: '明确场景事件' };
const TABS = [['results', '资料结果'], ['prompt', '提示词全文'], ['channels', '读取通道'], ['raw', '原始 JSON']];

// LJ-DIAGNOSTICS-LIVE: 实际宏记录与当前试算分开，完整报告只取真实运行结果。
export function mountDiagnostics(ui) {
  const { session, catalog } = ui.bridge, esc = ui.esc;
  const desktop = ui.layout === 'desktop';
  const records = document.getElementById(desktop ? 'check11Records' : 'diagRecords');
  const summary = document.getElementById(desktop ? 'check11Summary' : 'diagSummary');
  const tabs = document.getElementById(desktop ? 'check11Tabs' : 'diagTabs');
  const main = document.getElementById(desktop ? 'check11Content' : 'diagResults');
  const report = desktop ? main : document.getElementById('diagReport');
  const filterBar = document.getElementById('diagFilter');
  if (!records || !summary || !tabs || !main) return { render() {} };
  let recordKind = 'actual', tab = 'results', filter = 'all', query = '', previewing = false;
  const currentRecord = () => recordKind === 'preview' ? session.runtime.getLastPreview() : session.runtime.getLastActualInjection();
  const packageById = id => ui.engine.data.packages.find(item => item.id === id);
  function reasonText(reason) {
    if (!reason) return '';
    const code = String(reason);
    if (code.startsWith('control_group_off:')) {
      const id = code.slice('control_group_off:'.length), group = ui.engine.data.controlGroups.find(item => item.controlGroupId === id);
      return `由“${group?.label || id}”暂停`;
    }
    return ({ master_off: '提示注入已关闭', layer_off: '本通道已暂停', named_places_off: '具名地点正文已关闭', package_off: '本级正文已关闭', missing_station_package: '未找到站点正文包', waiting_for_macro: '等待宏展开', macro_not_expanded: '本轮没有展开 Living Japan 宏', disabled: '未启用', direct: '本轮直接命中', linked: '由已登记关系联动', empty: '当前有效正文为空' })[code] || code;
  }
  function rowData(record) {
    const diagnostic = record?.diagnostics || {}, result = [], occupied = new Set();
    const add = (input, status, explanation = '') => {
      const id = typeof input === 'string' ? input : input.id || input.packageId;
      if (!id || occupied.has(id)) return;
      occupied.add(id);
      const item = packageById(id), detail = typeof input === 'string' ? {} : input;
      result.push({ id, name: detail.displayName || item?.displayName || id, layer: item?.layer || detail.layer || '', status, reason: explanation || reasonText(detail.blocker || detail.reason), trigger: detail.trigger || '', custom: Boolean(detail.customText) });
    };
    (diagnostic.injectedPackages || record?.packageIds || []).forEach(item => add(item, 'injected'));
    (diagnostic.blockedPackages || []).forEach(item => add(item, 'closed'));
    (diagnostic.recognizedEmptyBodies || []).forEach(item => add(item, 'empty', '已识别，当前有效正文为空'));
    (diagnostic.duplicatesRemoved || []).forEach(item => add(item, 'merged', '正文重复，合并输出'));
    for (const parent of diagnostic.namedStationParents || []) {
      for (const station of parent.stationStates || []) add(station, station.selected ? 'selected' : 'candidate', station.blocker ? reasonText(station.blocker) : station.selected ? '已选中；最终是否输出见正文结果' : '属于上层站候选，本次未选中');
    }
    (diagnostic.matchedBeforeLinks || []).forEach(item => add(item, 'candidate', '已识别候选，未列入最终正文'));
    return result;
  }
  function statusLabel(value) {
    return ({ injected: recordKind === 'preview' ? '预计输出' : '宏已展开', closed: '受开关限制', empty: '空正文', merged: '已合并', selected: '已选中', candidate: '候选' })[value] || value;
  }
  function statusText(record) {
    if (!record) return recordKind === 'preview' ? '尚未试算当前聊天' : '尚无本聊天的实际宏记录';
    return ({ preview: '仅当前聊天试算', expanded: '本轮宏已展开；不代表模型已接收', pending: '本轮等待宏展开', macro_not_expanded: '本轮未展开宏', rejected: '本轮生成类型未进入注入', error: '本轮发生错误' })[record.status] || '运行记录';
  }
  function filtersHtml() {
    return `<div class="lj-inline lj-diagnostic-filters">${[['all','全部'],['injected','输出'],['closed','开关限制'],['empty','空正文'],['candidate','候选/选中'],['merged','合并']].map(([id,label]) => `<button type="button" class="lj-button${filter === id ? ' primary' : ''}" data-lj-diag-filter="${id}" aria-pressed="${filter === id}">${label}</button>`).join('')}</div>`;
  }
  function resultsHtml(record) {
    const rows = rowData(record).filter(item => (filter === 'all' || item.status === filter || filter === 'candidate' && item.status === 'selected') && (!query || `${item.name} ${item.trigger} ${LABELS[item.layer] || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    return (desktop ? filtersHtml() : '') + `<div class="lj-find"><input type="search" data-lj-diag-query aria-label="检索诊断条目名称" placeholder="检索名称、类型或命中词" value="${esc(query)}"></div><div data-lj-diag-list>${rows.length ? rows.map(item => `<div class="lj-row"><button type="button" class="lj-namebutton grow" data-lj-diag-package="${esc(item.id)}"><span class="lj-name">${esc(item.name)}</span><span class="lj-meta">${esc(LABELS[item.layer] || item.layer)}${item.trigger ? ` · 命中“${esc(item.trigger)}”` : ''}${item.custom ? ' · 使用修改稿' : ''}</span>${item.reason ? `<span class="lj-meta">${esc(item.reason)}</span>` : ''}</button><span class="tag">${statusLabel(item.status)}</span></div>`).join('') : `<p class="lj-empty">${record ? '当前筛选没有条目。' : statusText(record)}</p>`}</div>`;
  }
  function channelsHtml(record) {
    const diagnostic = record?.diagnostics || {}, saved = ui.engine.normalizeSettings(ui.bridge.store.read().livingJapanSettings);
    return Object.entries(LABELS).map(([key, label]) => {
      const channel = diagnostic.channels?.[key];
      return `<section class="lj-setting-group"><div class="lj-inline"><h3>${label}</h3><button type="button" class="lj-button" data-lj-diag-settings="${key}">读取设置</button></div><p class="lj-meta">${channel ? `本记录回看 ${channel.actualHistoryChecked ?? 0} 层；${channel.recognized?.length ?? 0} 个识别，${channel.blocked?.length ?? 0} 个受开关限制。` : '此记录没有通道读取信息。'}</p><p class="lj-meta">当前设置优先标签：${esc(saved.channelTags[key].priority.join('、') || '未设置')}<br>当前排除标签：${esc(saved.channelTags[key].excluded.join('、') || '未设置')}</p>${channel ? `<details><summary>查看本记录读取来源</summary><pre class="lj-report">${esc(JSON.stringify(channel, null, 2))}</pre></details>` : ''}</section>`;
    }).join('');
  }
  function render() {
    const record = currentRecord(), rows = rowData(record), count = kind => rows.filter(item => item.status === kind).length;
    records.innerHTML = `<button type="button" data-lj-diag-record="actual" class="${recordKind === 'actual' ? 'on' : ''}" aria-pressed="${recordKind === 'actual'}">上一轮实际记录</button><button type="button" data-lj-diag-record="preview" class="${recordKind === 'preview' ? 'on' : ''}" aria-pressed="${recordKind === 'preview'}">当前聊天预览</button>`;
    summary.innerHTML = desktop ? `<div class="check11-outcome"><strong>${esc(statusText(record))}</strong><small>${esc(record?.completedAt || record?.startedAt || '')}${record?.error ? ` · ${esc(record.error)}` : ''}</small></div><div class="check11-metrics"><span><b>${count('injected')}</b>输出</span><span><b>${count('closed')}</b>开关限制</span><span><b>${count('empty')}</b>空正文</span></div>` : `<div class="metric"><b>${count('injected')}</b><span>输出</span></div><div class="metric"><b>${count('closed')}</b><span>开关限制</span></div><div class="metric"><b>${count('empty')}</b><span>空正文</span></div><span class="lj-meta">${esc(statusText(record))}</span>`;
    tabs.innerHTML = TABS.map(([id,label]) => `<button type="button" data-lj-diag-tab="${id}" class="${tab === id ? 'on' : ''}" aria-pressed="${tab === id}">${label}</button>`).join('');
    if (!desktop) { main.hidden = tab !== 'results'; report.hidden = tab === 'results'; if (filterBar) { filterBar.hidden = tab !== 'results'; filterBar.innerHTML = filtersHtml(); } }
    const target = tab === 'results' ? main : report;
    if (tab === 'results') target.innerHTML = resultsHtml(record);
    else if (tab === 'channels') target.innerHTML = channelsHtml(record);
    else target.innerHTML = `<pre class="lj-report">${esc(tab === 'prompt' ? record?.prompt || '本记录没有提示词正文。' : JSON.stringify(record || { status: 'no_record' }, null, 2))}</pre>`;
    document.querySelectorAll('[data-lj-diag-action="preview"]').forEach(node => { node.disabled = previewing; node.textContent = previewing ? '正在试算…' : '刷新预览'; });
  }
  async function copyReport() {
    const record = currentRecord();
    if (!record) { ui.notify('当前没有可复制的诊断记录'); return; }
    const text = `Living Japan · ${recordKind === 'preview' ? '当前聊天预览' : '上一轮实际宏记录'}\n${statusText(record)}\n\n${JSON.stringify(record, null, 2)}`;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else { const input = document.createElement('textarea'); input.value = text; document.body.append(input); input.select(); const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('当前浏览器没有允许复制，请在原始JSON页手动复制'); }
    ui.notify('已复制完整诊断记录');
  }
  async function action(event) {
    const target = event.target.closest('[data-lj-diag-record],[data-lj-diag-tab],[data-lj-diag-filter],[data-lj-diag-action],[data-lj-diag-package],[data-lj-diag-settings]'); if (!target) return;
    try {
      if (target.dataset.ljDiagRecord) { recordKind = target.dataset.ljDiagRecord; render(); }
      else if (target.dataset.ljDiagTab) { tab = target.dataset.ljDiagTab; render(); }
      else if (target.dataset.ljDiagFilter) { filter = target.dataset.ljDiagFilter; render(); }
      else if (target.dataset.ljDiagAction === 'preview') { if (previewing) return; previewing = true; render(); await session.preview(); recordKind = 'preview'; ui.notify('当前聊天预览已更新，上一轮实际记录保留'); }
      else if (target.dataset.ljDiagAction === 'copy') await copyReport();
      else if (target.dataset.ljDiagPackage) {
        const item = packageById(target.dataset.ljDiagPackage); if (!item) throw new Error('此旧记录的正文包已不在当前版本');
        const entity = catalog.get(item.placeId) || { id: item.placeId || `package:${item.id}`, name: item.displayName, type: LABELS[item.layer], packageIds: [item.id], coordinates: null };
        await ui.openReader(entity, item.id);
      } else if (target.dataset.ljDiagSettings) {
        await ui.showPage('settings');
        document.dispatchEvent(new CustomEvent('living-japan-settings-tab', { detail: { tab: 'reading', channel: target.dataset.ljDiagSettings } }));
      }
    } catch (error) { ui.notify(error.message || String(error), 'error'); }
    finally { if (previewing) { previewing = false; render(); } }
  }
  const page = desktop ? document.getElementById('ljDiagnosticsPage') : records.closest('.page') || records.parentElement;
  page.addEventListener('click', action);
  const actionHost = desktop ? document.querySelector('#check11Window .check11-actions') : document.getElementById('diagCopy')?.parentElement;
  if (actionHost) actionHost.innerHTML = `<button type="button" class="${desktop ? 'check11-action' : 'btn'}" data-lj-diag-action="preview">刷新预览</button><button type="button" class="${desktop ? 'check11-action primary' : 'btn primary'}" data-lj-diag-action="copy">复制完整诊断结果</button>`;
  main.addEventListener('input', event => {
    if (!event.target.matches('[data-lj-diag-query]')) return;
    query = event.target.value;
    const selection = event.target.selectionStart;
    main.innerHTML = resultsHtml(currentRecord());
    const input = main.querySelector('[data-lj-diag-query]'); input.focus(); input.setSelectionRange(selection, selection);
  });
  render();
  return { render };
}
