// LJ-NATIONAL-01: source identities, official administration and sparse text slots.
export function mapPointId(point) {
  const ns = point[10] || 'unknown';
  if (point[8]) return `map:${ns}:${point[8]}`;
  return `map:${ns}:legacy:${point[0]},${point[1]}:${point[2]}:${encodeURIComponent(point[3] || '')}:${encodeURIComponent(point[6] || '')}:${encodeURIComponent(point[7] || '')}`;
}

const TYPE_NAMES = { 景: '景点', 馆: '博物馆', 社: '神社', 寺: '寺院', 大: '大学', 医: '医疗', 剧: '剧场', 商: '商场', 超: '超市', 图: '图书馆', 校: '学校', 便: '便利店', 咖: '咖啡', 包: '面包店', 书: '书店', 酒: '酒吧', 歌: '卡拉OK', 宿: '住宿', 食: '餐饮', 艺: '文化艺术', 游: '娱乐', 体: '体育', 园: '公园', 店: '商店', 宗: '宗教', 服: '服装店', 政: '公共服务', 办: '办公', 交: '交通', 住: '住宅', 工: '工业', 地: '地理地点', 建: '建筑' };
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const at = () => globalThis.performance?.now?.() ?? Date.now();
const regionKey = code => String(code ?? '00').padStart(2, '0');
const nationalUrl = (baseUrl, name) => new URL(`data/national/${name}`, baseUrl || import.meta.url.replace(/src\/catalog\.js.*$/, '')).href;

export function projectCoordinates(coordinates, projection) {
  if (!coordinates) return null;
  if (Number.isFinite(coordinates.x) && Number.isFinite(coordinates.y)) return [coordinates.x, coordinates.y];
  const longitude = coordinates.longitude ?? coordinates.lng ?? coordinates.lon;
  const latitude = coordinates.latitude ?? coordinates.lat;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !projection?.xScale) return null;
  return [longitude * projection.xScale + projection.xOffset, latitude * projection.yScale + projection.yOffset];
}

function coordinatesAt(x, y, projection) {
  return { x, y, crs: 'japan-map-v3-local', ...(projection?.xScale ? {
    longitude: (x - projection.xOffset) / projection.xScale,
    latitude: (y - projection.yOffset) / projection.yScale,
    method: 'map-source-projection',
  } : {}) };
}

function administration(index) {
  const nodes = new Map((index.adminNodes || []).map(n => [n.id, n]));
  const names = new Map();
  for (const node of nodes.values()) {
    const path = [...(node.adminPath || []), node.id];
    const labelPath = path.map(id => nodes.get(id)?.nameJa || nodes.get(id)?.name || '').filter(Boolean);
    for (const label of new Set([node.name, node.nameJa, ...(node.aliases || [])])) {
      if (!label || !node.regionCode) continue;
      const key = `${node.regionCode}:${label}`;
      if (!names.has(key)) names.set(key, []);
      names.get(key).push(node);
    }
    if (node.kind === 'ward') {
      const parent = nodes.get(node.parentId);
      for (const label of [`${parent?.nameJa || ''}${node.nameJa || ''}`, `${parent?.name || ''}${node.name || ''}`]) names.set(`${node.regionCode}:${label}`, [node]);
    }
    node._labelPath = labelPath;
  }
  const resolve = (code, name = '') => {
    const candidates = names.get(`${code}:${name}`) || [];
    return candidates.length === 1 ? candidates[0] : [...nodes.values()].find(n => n.kind === 'prefecture' && n.regionCode === code);
  };
  const pathFor = node => node ? [...(node.adminPath || []), node.id] : [];
  const details = path => path.map(id => nodes.get(id)).filter(Boolean).map(n => ({ id: n.id, label: n.name, name: n.name, nameJa: n.nameJa, kind: n.kind, parentId: n.parentId, officialCode: n.officialCode }));
  return { nodes, resolve, pathFor, details };
}

function simplifyPath(path, tolerance = 1, thinExplicitLines = false) {
  let lastX = NaN, lastY = NaN, result = '';
  const tokens = String(path || '').match(/[MLZmlz]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) || [];
  let mode = 'M';
  for (let i = 0; i < tokens.length;) {
    if (/^[MLZ]$/i.test(tokens[i])) {
      mode = tokens[i++].toUpperCase();
      if (mode === 'Z') { result += 'Z'; lastX = lastY = NaN; continue; }
    }
    const x = Number(tokens[i++]), y = Number(tokens[i++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (mode === 'M' || !Number.isFinite(lastX) || Math.hypot(x - lastX, y - lastY) >= tolerance || i >= tokens.length || (thinExplicitLines ? /^[MZ]$/i : /^[MLZ]$/i).test(tokens[i])) {
      result += `${mode}${x},${y}`; lastX = x; lastY = y;
    }
    mode = 'L';
  }
  return result;
}

/** Runs inside the dedicated worker in browsers; inline only for small Node fixtures. */
export function createRegionService({ index, baseUrl, fetcher = globalThis.fetch, maxRegions = 2, maxDecodedBytes = 128 * 1024 * 1024 }) {
  const admin = administration(index), cache = new Map(), pending = new Map();
  const pointCache = new Map(), pointPending = new Map();
  const overlayCache = new Map(), overlayPending = new Map();
  const overlayBytes = () => [...overlayCache.values()].reduce((n, item) => n + item.jsonBytes, 0);
  let overviewSummary = null, overviewSerial = 0;
  let loadQueue = Promise.resolve();
  const specs = new Map([...(index.views || []), ...(index.regions || [])].map(r => [regionKey(r.code), r]));
  const projection = index.projection || {};
  async function read(path) {
    const response = await fetcher(nationalUrl(baseUrl, path));
    if (!response.ok) throw new Error(`地区资料读取失败：${path} (${response.status})`);
    if (!path.endsWith('.gz')) return response.json();
    const reader = response.body.getReader(), initial = []; let initialSize = 0;
    while (initialSize < 2) { const next = await reader.read(); if (next.done) break; initial.push(next.value); initialSize += next.value.length; }
    const magic = new Uint8Array(initialSize); let cursor = 0; for (const chunk of initial) { magic.set(chunk, cursor); cursor += chunk.length; }
    const stream = new ReadableStream({ start(controller) { for (const chunk of initial) controller.enqueue(chunk); }, async pull(controller) { const next = await reader.read(); next.done ? controller.close() : controller.enqueue(next.value); }, cancel(reason) { return reader.cancel(reason); } });
    // Hosts may transparently decode HTTP gzip; peek without buffering the whole compressed file.
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) return new Response(stream).json();
    if (!globalThis.DecompressionStream) throw new Error('此浏览器缺少压缩资料读取能力，请升级浏览器后重试。');
    return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).json();
  }
  async function pointBlock(part) {
    if (pointCache.has(part.path)) { const value = pointCache.get(part.path); pointCache.delete(part.path); pointCache.set(part.path, value); return value; }
    if (pointPending.has(part.path)) return pointPending.get(part.path);
    const request = read(part.path).then(value => { pointCache.set(part.path, value); while (pointCache.size > 4) pointCache.delete(pointCache.keys().next().value); return value; });
    pointPending.set(part.path, request); try { return await request; } finally { pointPending.delete(part.path); }
  }
  // LJ-PBF-OVERLAY-01: optional verified geometry stays in a bounded worker cache.
  async function overlayBlock(part) {
    if (overlayCache.has(part.path)) { const entry = overlayCache.get(part.path); overlayCache.delete(part.path); overlayCache.set(part.path, entry); return entry.data; }
    if (overlayPending.has(part.path)) return overlayPending.get(part.path);
    const request = read(part.path).then(data => {
      overlayCache.set(part.path, { data, jsonBytes: part.jsonBytes || JSON.stringify(data).length * 2 });
      while (overlayCache.size > 4 || overlayBytes() > 32 * 1024 * 1024) overlayCache.delete(overlayCache.keys().next().value);
      return data;
    });
    overlayPending.set(part.path, request); try { return await request; } finally { overlayPending.delete(part.path); }
  }
  async function overlaysFor(code, bounds, mode, scale) {
    const spec = specs.get(code); if (!spec?.overlayParts?.length || mode === 'schem') return null;
    let level = scale >= 0.6 ? 'detail' : 'overview';
    if (level === 'detail' && !spec.overlayParts.some(p => p.level === 'detail')) level = 'overview';
    const bandScale = 2 ** Math.ceil(Math.log2(Math.max(0.0001, scale))), summaryKey = `${code}:${mode}:${level}:${bandScale}:${scale >= 1}:${scale >= 4}`;
    if (overviewSummary?.key === summaryKey && bounds[0] >= overviewSummary.bounds[0] && bounds[1] >= overviewSummary.bounds[1] && bounds[2] <= overviewSummary.bounds[2] && bounds[3] <= overviewSummary.bounds[3]) {
      return { ...overviewSummary.value, metrics: { ...overviewSummary.value.metrics, viewCacheHit: true, overviewCacheHit: level === 'overview' } };
    }
    const marginX = (bounds[2] - bounds[0]) * 0.2, marginY = (bounds[3] - bounds[1]) * 0.2;
    const query = [bounds[0] - marginX, bounds[1] - marginY, bounds[2] + marginX, bounds[3] + marginY];
    const intersects = b => !b || !(b[2] < query[0] || b[0] > query[2] || b[3] < query[1] || b[1] > query[3]);
    const parts = [...new Map(spec.overlayParts.filter(p => p.level === level && intersects(p.bounds)).map(p => [p.path, p])).values()];
    const rails = new Map(), borders = new Map(), seenRails = new Set(), seenBorders = new Set(), railwaysActive = spec.overlayCoverage?.railwaysComplete === true;
    let railwayRecords = 0, boundaryRecords = 0;
    const maxAdminLevel = mode === 'map' ? 4 : mode === 'ultra' && scale >= 1 ? 8 : scale >= 0.6 ? 7 : 4;
    const append = (groups, key, fields, d) => {
      if (!groups.has(key)) groups.set(key, { ...fields, segments: [] });
      if (level === 'overview') d = d.split(/(?=M)/).filter(Boolean).map(ring => {
        const smaller = simplifyPath(ring, 0.6 / bandScale, true);
        return ring.includes('Z') && (smaller.match(/L/g) || []).length < 3 ? ring : smaller;
      }).join(' ');
      groups.get(key).segments.push(d);
    };
    for (const part of parts) {
      const data = await overlayBlock(part);
      if (railwaysActive) for (const rail of data.railways || []) {
        if (seenRails.has(rail.id) || !intersects(rail.b) || !rail.d || (mode === 'map' && rail.kind !== 'rail')) continue;
        const service = rail.service || '', branch = service && service !== 'main';
        if (branch && !(mode === 'ultra' && scale >= 4)) continue;
        seenRails.add(rail.id); append(rails, `${rail.kind}:${service}`, { kind: rail.kind, service }, rail.d); railwayRecords++;
      }
      for (const boundary of data.boundaries || []) {
        const adminLevel = Number(boundary.adminLevel);
        if (seenBorders.has(boundary.id) || !intersects(boundary.b) || !boundary.d || adminLevel > maxAdminLevel) continue;
        seenBorders.add(boundary.id); append(borders, adminLevel, { adminLevel }, boundary.d); boundaryRecords++;
      }
    }
    const paths = groups => [...groups.values()].map(({ segments, ...fields }) => ({ ...fields, d: segments.join(' ') }));
    const value = { level, railwaysActive, railways: paths(rails), boundaries: paths(borders), metrics: { parts: parts.length, referencedBytes: parts.reduce((n, p) => n + (p.bytes || 0), 0), railwayRecords, boundaryRecords, viewCacheHit: false, overviewCacheHit: false } };
    value.cacheKey = `${level}:${++overviewSerial}`;
    const bytes = [...value.railways, ...value.boundaries].reduce((n, record) => n + record.d.length * 2 + 128, 0);
    overviewSummary = bytes <= 32 * 1024 * 1024 ? { key: summaryKey, bounds: query, value, bytes } : null;
    return value;
  }
  async function* pointRows(region, filter = () => true) {
    if (region.raw.poi?.list?.length) { yield region.raw.poi.list; return; }
    for (const part of specs.get(region.code)?.poiParts || []) if (filter(part)) { yield (await pointBlock(part)).rows; await tick(); }
  }
  function makeEntity(row, code, cats) {
    const node = admin.resolve(code, row[5]), path = admin.pathFor(node), category = TYPE_NAMES[cats[row[2]]] || '地点';
    return { id: mapPointId(row), name: row[3], aliases: row[4] || [], type: category, subtype: row[7] || '', regionCode: code,
      adminPath: path, adminNodes: admin.details(path), coordinates: coordinatesAt(row[0], row[1], projection), address: row[6] || '',
      source: { namespace: row[10], databaseId: row[8], version: index.mapVersion || '3.0.0', reference: 'data/national/sources.json' },
      legacyPlaceId: null, packageIds: [], bodyStatus: 'empty', access: row[9] || 'unknown' };
  }
  function storeEntity(store, code) {
    code = store.regionCode || code;
    const node = admin.resolve(code, store.city), path = admin.pathFor(node);
    const coordinates = Number.isFinite(store.longitude) && Number.isFinite(store.latitude) ? { longitude: store.longitude, latitude: store.latitude, method: 'clothing-source' } : null;
    return { id: `clothing:${store.id}`, name: store.name, aliases: store.aliases || [], type: '服装店', regionCode: code,
      adminPath: path, adminNodes: admin.details(path), coordinates, source: { namespace: 'clothing-v1.3.0', id: store.id, url: store.source, checkedAt: store.checkedAt, otherSources: store.otherSources || [] },
      legacyPlaceId: null, packageIds: [], bodyStatus: 'empty', brandIds: store.brandIds || [], address: store.verifiedAddress || store.address,
      addressQuality: store.addressQuality || null, originalAddress: store.address, addressEvidence: store.addressVerificationSources || store.addressSource || null,
      temporaryNote: store.temporaryNote || null };
  }
  function stationEntity(station, code) {
    return { id: `rail:${station.id}`, name: station.n, aliases: station.ja && station.ja !== station.n ? [station.ja] : [], type: '车站', regionCode: code,
      adminPath: [], adminNodes: [], coordinates: { ...coordinatesAt(station.x, station.y, projection), ...(Number.isFinite(station.longitude) ? { longitude: station.longitude, latitude: station.latitude, method: 'MLIT N02-25' } : {}) },
      source: { namespace: 'MLIT-N02-25', id: station.id, date: station.date, group: station.group }, legacyPlaceId: null, packageIds: [], bodyStatus: 'empty' };
  }
  async function ensure(code) {
    code = regionKey(code);
    if (cache.has(code)) { const r = cache.get(code); cache.delete(code); cache.set(code, r); return r; }
    if (pending.has(code)) return pending.get(code);
    if (!specs.has(code)) throw new Error(`没有地区分包：${code}`);
    const request = loadQueue.then(async () => {
      const start = at(), spec = specs.get(code);
      const [raw, storeData] = await Promise.all([read(spec.mapPath), spec.storesPath ? read(spec.storesPath) : { stores: [] }]);
      const fetchedAt = at();
      const stores = (storeData.stores || []).map(s => storeEntity(s, code));
      const stations = (raw.transport?.stations || []).map(s => stationEntity(s, code));
      const tolerance = code === '00' ? 8 : 1;
      const map = { bounds: raw.geo?.bounds || raw.region?.defaultBounds, defaultBounds: raw.region?.defaultBounds || raw.geo?.bounds, schematic: raw.schematic || null,
        land: (raw.geo?.land || []).map(g => ({ n: g.n, code: g.code, d: simplifyPath(g.d, tolerance) })),
        rivers: (raw.geo?.rivers || []).map(g => ({ n: g.n, w: g.w, d: simplifyPath(g.d, tolerance) })),
        parks: (raw.geo?.parkPolys || []).map(g => ({ n: g.n, d: g.d, x: g.x, y: g.y, a: g.a })),
        labels: raw.geo?.labels || [],
        railways: (raw.transport?.railways || []).map(g => ({ n: g.n, c: g.c, d: simplifyPath(g.d, tolerance) })),
        pbfRailways: spec.overlayCoverage?.railwaysComplete === true && Boolean(spec.overlayParts?.length) };
      const region = { code, raw, stores, stations, map, metrics: { fetchDecodeMs: +(fetchedAt - start).toFixed(1), prepareMs: +(at() - fetchedAt).toFixed(1), rawBytes: spec.jsonBytes || 0 } };
      cache.set(code, region);
      const cachedBytes = () => [...cache.values()].reduce((n, r) => n + (r.metrics.rawBytes || 0), 0);
      while (cache.size > 1 && (cache.size > maxRegions || cachedBytes() > maxDecodedBytes)) cache.delete(cache.keys().next().value);
      return region;
    });
    loadQueue = request.then(() => undefined, () => undefined);
    pending.set(code, request);
    try { return await request; } finally { pending.delete(code); }
  }
  const rowMatches = (row, cats, query) => normalize([row[3], ...(row[4] || []), TYPE_NAMES[cats[row[2]]] || '地点', row[7]].join(' ')).includes(query);
  const entityMatches = (e, query) => normalize([e.name, ...e.aliases, e.type].join(' ')).includes(query);
  async function search(query, { regionCode = '00', limit = 100 } = {}) {
    const region = await ensure(regionCode), q = normalize(query).trim(), found = [], start = at();
    if (!q) return found;
    const max = Math.min(Math.max(limit, 1), 500), cats = region.raw.poi?.cats || '';
    for (const e of [...region.stores, ...region.stations]) if (entityMatches(e, q)) { found.push(e); if (found.length >= max) return found; }
    for await (const rows of pointRows(region)) {
      for (const row of rows) if (rowMatches(row, cats, q)) { found.push(makeEntity(row, region.code, cats)); if (found.length >= max) break; }
      if (found.length >= max) break;
    }
    if (region.code === 'metro' && found.length < max) {
      const seen = new Set(found.map(e => e.id));
      for (const code of specs.get('metro')?.regionCodes || []) {
        for (const e of await search(query, { regionCode: code, limit: max - found.length })) if (!seen.has(e.id)) { found.push(e); seen.add(e.id); }
        if (found.length >= max) break;
      }
    }
    region.metrics.lastSearchMs = +(at() - start).toFixed(1);
    return found;
  }
  async function children(id, { offset = 0, limit = 100, regionCode } = {}) {
    const node = admin.nodes.get(id), code = regionKey(regionCode || node?.regionCode), region = await ensure(code);
    const found = [], end = Math.max(0, offset) + Math.min(500, Math.max(1, limit)); let seen = 0;
    const belongs = e => e.adminPath.at(-1) === id;
    for (const entity of region.stores) if (belongs(entity)) { if (seen++ >= offset) found.push(entity); if (seen >= end) return found; }
    const cats = region.raw.poi?.cats || '', nameNodes = new Map();
    for await (const rows of pointRows(region, part => !part.municipalities || part.municipalities.some(name => admin.resolve(code, name)?.id === id))) {
      for (const row of rows) {
        if (!nameNodes.has(row[5])) nameNodes.set(row[5], admin.resolve(code, row[5])?.id);
        if (nameNodes.get(row[5]) === id) { if (seen++ >= offset) found.push(makeEntity(row, code, cats)); }
        if (seen >= end) break;
      }
      if (seen >= end) break;
    }
    return found;
  }
  async function resolve(id, { regionCode = '00' } = {}) {
    const region = await ensure(regionCode);
    const e = region.stores.find(e => e.id === id) || region.stations.find(e => e.id === id); if (e) return e;
    const cats = region.raw.poi?.cats || '';
    for await (const rows of pointRows(region)) for (const row of rows) if (mapPointId(row) === id) return makeEntity(row, region.code, cats);
    return null;
  }
  async function viewport(code, bounds, { limit = 700, detail = 'standard', mode = 'detail', focusRegionCode, scale = 800 / Math.max(1, bounds[2] - bounds[0]), includeOverlays = true } = {}) {
    const region = await ensure(code), [minX, minY, maxX, maxY] = bounds, result = [], bins = new Set();
    const max = Math.min(1200, Math.max(50, limit)), cats = region.raw.poi?.cats || '';
    // LJ-MAP-STABLE-POINTS-01: nested geographic cells retain representatives while panning.
    const spanX = Math.max(0.0001, maxX - minX), spanY = Math.max(0.0001, maxY - minY);
    let cell = 2 ** Math.ceil(Math.log2(Math.sqrt(spanX * spanY / max)));
    while ((Math.ceil(spanX / cell) + 2) * (Math.ceil(spanY / cell) + 2) > max) cell *= 2;
    const grid = [Math.floor(minX / cell), Math.floor(minY / cell), Math.floor(maxX / cell), Math.floor(maxY / cell)];
    const scan = [grid[0] * cell, grid[1] * cell, (grid[2] + 1) * cell, (grid[3] + 1) * cell];
    const consider = (x, y, make) => {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      if (gx < grid[0] || gx > grid[2] || gy < grid[1] || gy > grid[3]) return;
      const key = `${gx},${gy}`;
      if (bins.has(key)) return; bins.add(key);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) result.push(make());
    };
    if (mode !== 'map') for (const station of region.stations) consider(station.coordinates.x, station.coordinates.y, () => station);
    if (mode === 'ultra') {
      for (const store of region.stores) { const xy = projectCoordinates(store.coordinates, projection); if (xy) consider(...xy, () => store); }
      for await (const rows of pointRows(region, part => !part.bounds || !(part.bounds[2] < scan[0] || part.bounds[0] > scan[2] || part.bounds[3] < scan[1] || part.bounds[1] > scan[3]))) {
        for (const row of rows) { consider(row[0], row[1], () => makeEntity(row, region.code, cats)); if (result.length >= max) break; }
        if (result.length >= max) break;
      }
    }
    let roads = mode === 'ultra' && (maxX - minX) < 250 ? (region.raw.roads || []).filter(r => !r.b || !(r.b[2] < minX || r.b[0] > maxX || r.b[3] < minY || r.b[1] > maxY)).slice(0, 160).map(r => ({ d: r.d, k: r.k })) : [];
    if (region.code === 'metro' && mode === 'ultra' && maxX - minX < 900) {
      const center = [(minX + maxX) / 2, (minY + maxY) / 2], covered = specs.get('metro')?.coverage || [];
      const target = covered.find(r => r.code === focusRegionCode) || covered.filter(r => center[0] >= r.bounds[0] && center[0] <= r.bounds[2] && center[1] >= r.bounds[1] && center[1] <= r.bounds[3]).sort((a, b) => (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) - (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]))[0];
      if (target) { const finer = await viewport(target.code, bounds, { limit, detail, mode, scale, includeOverlays: false }); const ids = new Set(result.map(e => e.id)); for (const e of finer.entities) if (!ids.has(e.id) && result.length < max) result.push(e); roads = finer.roads; }
    }
    const overlays = includeOverlays ? await overlaysFor(region.code, bounds, mode, scale) : null;
    return { entities: result, roads, count: result.length, overlays };
  }
  return { async loadRegion(code) { const r = await ensure(code); return { code: r.code, map: r.map, poiCount: specs.get(r.code)?.poiCount || r.raw.poi?.list?.length || 0, storeCount: r.stores.length, metrics: { ...r.metrics, cachedRegions: [...cache.keys()], cachedPointBlocks: pointCache.size } }; }, search, children, resolve, viewport,
    clear() { cache.clear(); pointCache.clear(); overlayCache.clear(); overviewSummary = null; }, stats() { return { cachedRegions: [...cache.keys()], pendingRegions: [...pending.keys()], cachedPointBlocks: pointCache.size, cachedOverlayBlocks: overlayCache.size, cachedOverlayBytes: overlayBytes(), cachedOverlayViewBytes: overviewSummary?.bytes || 0, cachedOverviewBytes: overviewSummary?.value.level === 'overview' ? overviewSummary.bytes : 0 }; } };
}

function workerClient(index, baseUrl) {
  const worker = new Worker(new URL('./national-worker.js', import.meta.url), { type: 'module', name: 'Living Japan 全国资料' });
  let sequence = 0; const pending = new Map();
  worker.onmessage = ({ data }) => { const request = pending.get(data.id); if (!request) return; pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.result); };
  worker.onerror = event => { for (const p of pending.values()) p.reject(new Error(event.message || '全国资料工作线程发生错误')); pending.clear(); };
  const call = (method, ...args) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
  const ready = call('init', { index, baseUrl: String(baseUrl) });
  return { ready, call: async (method, ...args) => { await ready; return call(method, ...args); }, destroy() { worker.terminate(); for (const p of pending.values()) p.reject(new Error('资料已关闭')); pending.clear(); } };
}

export function createCatalog({ baseData = {}, baseUrl, fetcher = globalThis.fetch, useWorker = true } = {}) {
  const entities = new Map(), baselineIds = new Set(), regionViews = new Map(), loaded = new Map();
  const navigationRoot = 'navigation:root', navigation = new Map(), groupByRegion = new Map();
  let index, admin, loading, remote, local, activeCode = '00';
  const basePackages = new Map((baseData.packages || []).map(p => [p.id, p]));
  const byPlace = new Map();
  for (const p of baseData.packages || []) { if (!p.placeId) continue; if (!byPlace.has(p.placeId)) byPlace.set(p.placeId, []); byPlace.get(p.placeId).push(p.id); }
  const stationByLegacy = new Map(), railLegacy = new Map();
  for (const s of baseData.stationAdministration?.stations || []) for (const id of s.legacyStationIds || []) stationByLegacy.set(id, s);
  const remember = entity => {
    if (!entity) return entity;
    const legacy = entity.type === '车站' && railLegacy.get(`n02_station_${entity.source?.group}`);
    if (legacy) entity = { ...entity, legacyPlaceId: legacy.id, packageIds: legacy.packageIds, adminPath: legacy.adminPath, adminNodes: legacy.adminNodes, bodyStatus: legacy.bodyStatus };
    entities.set(entity.id, entity);
    if (entities.size > baselineIds.size + 6000) for (const [id] of entities) { if (!baselineIds.has(id) && !admin?.nodes.has(id)) { entities.delete(id); if (entities.size <= baselineIds.size + 4000) break; } }
    return entity;
  };
  const resolveOfficialPath = names => {
    let parentId = 'admin:jp'; const path = ['admin:jp'];
    for (const name of names || []) {
      const node = [...admin.nodes.values()].find(n => n.parentId === parentId && (n.nameJa === name || n.name === name));
      if (!node) break; path.push(node.id); parentId = node.id;
    }
    return path;
  };
  function addBaseline() {
    for (const place of baseData.places || []) {
      let path = (place.adminPath || []).filter(id => admin.nodes.has(id));
      if (path.length && path[0] !== 'admin:jp') path.unshift('admin:jp');
      const official = stationByLegacy.get(place.stationId || place.mapStationId);
      if (official?.officialAdminPathsJa?.[0]) path = resolveOfficialPath(official.officialAdminPathsJa[0]);
      const packageIds = byPlace.get(place.placeId) || [], pref = path.map(id => admin.nodes.get(id)).find(n => n?.kind === 'prefecture');
      const objectTypes = baseData.placePresentation?.objectTypes?.[place.sourceObjectId] || [];
      const e = { id: place.placeId, name: place.label, aliases: place.aliases || [], type: place.kind === 'station' ? '车站' : place.kind === 'editorial_area' ? '生活带' : objectTypes.join('／') || '具名地点', kind: place.kind,
        adminPath: path, adminNodes: admin.details(path), coordinates: place.coordinates || null, source: { namespace: 'living-japan-v3.6', objectId: place.sourceObjectId },
        legacyPlaceId: place.placeId, packageIds, regionCode: pref?.regionCode || null, bodyStatus: packageIds.some(id => String(basePackages.get(id)?.body || '').trim()) ? 'builtin' : 'empty',
        containedBy: (baseData.locationRelations?.crossObject || []).filter(r => r.sourceObjectId === place.sourceObjectId).map(r => `place:content_object:${r.targetObjectId}`) };
      entities.set(e.id, e); baselineIds.add(e.id);
      if (official) railLegacy.set(official.railStationId, e);
    }
  }
  async function loadIndex() {
    if (loading) return loading; if (index) return index;
    loading = (async () => {
      const response = await fetcher(nationalUrl(baseUrl, 'manifest.json'));
      if (!response.ok) throw new Error(`全国资料目录读取失败 (${response.status})`);
      index = await response.json(); admin = administration(index);
      for (const group of index.navigationRegions || []) {
        const node = { ...group, type: '地理大区', kind: 'navigation-region', browseOnly: true, parentId: navigationRoot };
        navigation.set(node.id, node);
        for (const code of node.regionCodes) groupByRegion.set(code, node);
      }
      for (const node of admin.nodes.values()) entities.set(node.id, { ...node, type: '行政区', aliases: node.aliases || [], coordinates: null, source: node.source || { namespace: 'MLIT-N03-2026' }, packageIds: [], legacyPlaceId: null, bodyStatus: 'empty', adminNodes: admin.details(node.adminPath || []) });
      addBaseline();
      if (useWorker && typeof Worker !== 'undefined' && fetcher === globalThis.fetch) { remote = workerClient(index, String(baseUrl || new URL('../', import.meta.url).href)); await remote.ready; }
      else local = createRegionService({ index, baseUrl, fetcher });
      return index;
    })();
    try { return await loading; } catch (error) { index = null; loading = null; throw error; }
  }
  const run = async (method, ...args) => { await loadIndex(); return remote ? remote.call(method, ...args) : local[method](...args); };
  async function loadRegion(code) {
    await loadIndex(); code = regionKey(code); activeCode = code;
    if (!loaded.has(code)) loaded.set(code, run('loadRegion', code).catch(error => { loaded.delete(code); throw error; }));
    const view = await loaded.get(code); regionViews.delete(code); regionViews.set(code, view);
    while (regionViews.size > 2) { const old = regionViews.keys().next().value; regionViews.delete(old); loaded.delete(old); }
    return view;
  }
  async function search(query, { regionCode = activeCode, limit = 100 } = {}) {
    await loadIndex(); const q = normalize(query).trim(); if (!q) return [];
    const max = Math.min(500, Math.max(1, limit));
    const viewRegions = index.views?.find(v => v.code === regionCode)?.regionCodes;
    const baseline = [...entities.values()].filter(e => (baselineIds.has(e.id) || admin.nodes.has(e.id)) && (!regionCode || regionCode === '00' || e.regionCode === regionKey(regionCode) || viewRegions?.includes(e.regionCode)) && normalize([e.name, ...(e.aliases || []), e.type].join(' ')).includes(q)).slice(0, max);
    if (baseline.length >= max || !index.regions?.length) return baseline;
    const found = await run('search', q, { regionCode, limit: max - baseline.length });
    return [...baseline, ...found.map(remember)];
  }
  async function children(id, { offset = 0, limit = 100 } = {}) {
    await loadIndex(); const max = Math.min(500, Math.max(1, limit));
    if (id === navigationRoot || navigation.has(id)) return navigationChildren(id).slice(offset, offset + max);
    const fixed = [...entities.values()].filter(e => (admin.nodes.has(e.id) && e.parentId === id) || (baselineIds.has(e.id) && e.adminPath.at(-1) === id));
    const own = fixed.slice(offset, offset + max); if (own.length >= max || !admin.nodes.get(id)?.regionCode) return own;
    const extra = await run('children', id, { offset: Math.max(0, offset - fixed.length), limit: max - own.length, regionCode: admin.nodes.get(id).regionCode });
    return [...own, ...extra.map(remember)];
  }
  const adminChildren = id => admin ? [...admin.nodes.values()].filter(node => node.parentId === id).map(node => entities.get(node.id)) : [];
  // LJ-GEOGRAPHIC-BROWSE-01: display groups never replace official administrative parents.
  function navigationChildren(id = navigationRoot) {
    if (id === navigationRoot) return [...navigation.values()];
    const group = navigation.get(id);
    return group ? group.regionCodes.flatMap(code => adminChildren('admin:jp').filter(node => node.regionCode === code)) : adminChildren(id);
  }
  function navigationPath(id) {
    if (navigation.has(id)) return [navigation.get(id)];
    const entity = entities.get(id); if (!entity) return [];
    const path = [...(entity.adminPath || []), ...(admin.nodes.has(id) ? [id] : [])].filter(key => key !== 'admin:jp').map(key => entities.get(key)).filter(Boolean);
    const group = groupByRegion.get(entity.regionCode);
    return group ? [group, ...path] : path;
  }
  return { loadIndex, loadRegion, search, children, adminChildren, navigationRoot, navigationChildren, navigationPath,
    get: id => entities.get(id) || navigation.get(id) || null,
    async resolve(id, options = {}) { await loadIndex(); return entities.get(id) || navigation.get(id) || remember(await run('resolve', id, options)); },
    regions: () => [...(index?.views || []), ...(index?.regions || [])].map(region => { const group = groupByRegion.get(region.code); return group ? { ...region, groupId: group.id, groupCode: group.code, groupName: group.name } : region; }),
    schematicEntity: id => entities.get(id) || null,
    async viewport(code, bounds, options) { const result = await run('viewport', code, bounds, options); result.entities = result.entities.map(remember); return result; },
    projection: () => index?.projection || {},
    stats: () => ({ mode: remote ? 'worker' : 'inline', entities: entities.size, regions: [...regionViews.keys()] }),
    workerStats: () => run('stats'),
    destroy() { remote?.destroy(); local?.clear(); loaded.clear(); regionViews.clear(); entities.clear(); navigation.clear(); groupByRegion.clear(); } };
}
